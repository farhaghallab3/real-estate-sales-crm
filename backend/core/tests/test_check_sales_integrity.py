"""check_sales_integrity: read-only, exit code 1 only for the critical checks (A, B, C), informational for D and E, no personal data in the output."""
import io
import json
from decimal import Decimal
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from commissions import services as commission_services
from commissions.models import Commission
from core.management.commands.check_sales_integrity import Command
from deals.models import Deal, Offer
from leads.models import Lead
from properties.models import Property
from users.models import Role

from .base import ApiTestCase, make_user


class CheckSalesIntegrityTests(ApiTestCase):
    def run_check(self, *args):
        out, err = io.StringIO(), io.StringIO()
        try:
            call_command("check_sales_integrity", *args, stdout=out, stderr=err)
            code = 0
        except CommandError as e:
            code = e.returncode
            err.write(str(e))
        return code, out.getvalue(), err.getvalue()

    # ---- builders --------------------------------------------------------------------------------------------------------
    def sale_through_the_service(self):
        """A sale made the normal way: closed deal, its commission, the property marked sold."""
        deal = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        self.assertEqual(self.as_user(self.manager).post(f"/api/deals/{deal.pk}/move/", {"stage": "closed"}, format="json").status_code, 200)
        return Deal.objects.get(pk=deal.pk)

    def closed_by_hand(self, prop=None, commission=True, **kw):
        deal = self.deal(self.sales_a, prop=prop, stage=Deal.Stage.CLOSED, sale_price=Decimal("900000"), closed_at=timezone.now(), **kw)
        if commission:
            commission_services.create_for_deal(deal, self.manager)
        return deal

    # ---- healthy data ----------------------------------------------------------------------------------------------------
    def test_an_empty_database_and_normal_sales_are_clean(self):
        code, out, _ = self.run_check()
        self.assertEqual(code, 0)
        self.assertIn("RESULT: OK", out)
        self.sale_through_the_service()
        self.sale_through_the_service()
        self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        self.deal(self.sales_a, stage=Deal.Stage.LOST, lost_reason="x")
        code, out, _ = self.run_check()
        self.assertEqual(code, 0, out)
        for check in ("A", "B", "C", "D1", "D2", "E1", "E2"):
            self.assertRegex(out, rf"{check}\s+.*: 0  OK")

    @override_settings(DEBUG=True)
    def test_the_demo_data_passes(self):
        call_command("seed_demo", "--force", verbosity=0)
        code, out, _ = self.run_check()
        self.assertEqual(code, 0, out)

    # ---- critical findings: exit code 1 -----------------------------------------------------------------------------------
    def test_a_closed_deal_without_a_commission_is_critical(self):
        deal = self.closed_by_hand(commission=False)
        code, out, err = self.run_check()
        self.assertEqual(code, 1)
        self.assertRegex(out, r"B\s+.*: 1")
        self.assertIn(f"deal_id={deal.pk}", out)
        self.assertIn("B=1", err)

    def test_a_commission_on_a_deal_that_is_not_closed_is_critical(self):
        deal = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        commission = Commission.objects.create(deal=deal, sale_price=Decimal("1"), commission_rate=Decimal("1"), agent_split=Decimal("50"))
        code, out, err = self.run_check()
        self.assertEqual(code, 1)
        self.assertRegex(out, r"C\s+.*: 1")
        self.assertIn(f"commission_id={commission.pk}, deal_id={deal.pk}, deal_stage=negotiation", out)
        self.assertIn("C=1", err)

    # ---- informational findings: reported, exit code stays 0 ---------------------------------------------------------------
    def test_property_status_mismatches_are_reported_but_not_critical(self):
        unsold = self.closed_by_hand().property  # closed deal + commission, but the property was left "available"
        sold_without_deal = self.prop(self.sales_a, status=Property.Status.SOLD)
        code, out, _ = self.run_check()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"D1\s+.*: 1")
        self.assertIn(f"property_id={unsold.pk}, status=available", out)
        self.assertRegex(out, r"D2\s+.*: 1")
        self.assertIn(f"property_id={sold_without_deal.pk}", out)
        self.assertIn("RESULT: OK", out)

    def test_offers_that_do_not_match_their_deal_are_reported_but_not_critical(self):
        deal = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        wrong_property = Offer.objects.create(deal=deal, lead=deal.lead, property=self.prop(self.sales_a), amount=Decimal("1"), submitted_by=self.sales_a)
        wrong_lead = Offer.objects.create(deal=deal, lead=self.lead(self.sales_b), property=deal.property, amount=Decimal("1"), submitted_by=self.sales_a)
        Offer.objects.create(deal=deal, lead=deal.lead, property=deal.property, amount=Decimal("1"), submitted_by=self.sales_a)  # a matching one
        code, out, _ = self.run_check()
        self.assertEqual(code, 0, out)
        self.assertRegex(out, r"E1\s+.*: 1")
        self.assertIn(f"offer_id={wrong_property.pk}, deal_id={deal.pk}", out)
        self.assertRegex(out, r"E2\s+.*: 1")
        self.assertIn(f"offer_id={wrong_lead.pk}, deal_id={deal.pk}", out)

    def test_informational_findings_never_hide_or_cause_a_critical_exit(self):
        self.prop(self.sales_a, status=Property.Status.SOLD)
        self.closed_by_hand(commission=False)
        code, out, _ = self.run_check()
        self.assertEqual(code, 1, "the critical one decides the exit code")
        self.assertRegex(out, r"D2\s+.*: 1")
        self.assertRegex(out, r"B\s+.*: 1")

    # ---- output ----------------------------------------------------------------------------------------------------------------
    def test_the_examples_are_limited_and_the_total_is_still_reported(self):
        for _ in range(3):
            self.closed_by_hand(commission=False)
        code, out, _ = self.run_check("--limit", "2")
        self.assertEqual(code, 1)
        self.assertRegex(out, r"B\s+.*: 3")
        self.assertIn("... and 1 more", out)
        self.assertEqual(out.count("deal_id="), 2)

    def test_json_output(self):
        self.closed_by_hand(commission=False)
        code, out, _ = self.run_check("--json")
        report = json.loads(out)
        self.assertEqual(code, 1)
        self.assertFalse(report["ok"])
        by_code = {c["code"]: c for c in report["checks"]}
        self.assertEqual([by_code[k]["count"] for k in ("A", "B", "C")], [0, 1, 0])
        self.assertEqual(by_code["B"]["severity"], "critical")
        self.assertEqual(by_code["D1"]["severity"], "info")

    def test_the_output_contains_ids_only_no_personal_data(self):
        lead = self.lead(self.sales_a, first_name="Confidentialname", phone="01099998888", email="secret.person@example.test")
        self.closed_by_hand(commission=False, lead=lead)
        _, out, err = self.run_check("--json")
        _, text, _ = self.run_check()
        for blob in (out, text, err):
            for private in ("Confidentialname", "01099998888", "secret.person"):
                self.assertNotIn(private, blob)

    # ---- read-only -----------------------------------------------------------------------------------------------------------
    def snapshot(self):
        return (
            list(Deal.objects.order_by("pk").values_list("pk", "stage", "updated_at")),
            list(Property.objects.order_by("pk").values_list("pk", "status", "updated_at")),
            list(Commission.objects.order_by("pk").values_list("pk", "status", "updated_at")),
            list(Offer.objects.order_by("pk").values_list("pk", "status", "updated_at")),
        )

    def test_the_command_changes_nothing_even_with_findings_everywhere(self):
        # (check A needs two closed deals on one property, which the database now refuses: it is covered by DuplicateClosedDealsTests below)
        self.closed_by_hand(commission=False)
        self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        Commission.objects.create(deal=self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION), sale_price=Decimal("1"), commission_rate=Decimal("1"), agent_split=Decimal("50"))
        self.prop(self.sales_a, status=Property.Status.SOLD)
        before = self.snapshot()
        self.run_check()
        self.run_check("--json")
        self.assertEqual(self.snapshot(), before)

    def test_the_database_itself_refuses_a_write_from_inside_the_check(self):
        prop = self.prop(self.sales_a, title="Untouched")

        def sneaky(self_, limit):
            Property.objects.filter(pk=prop.pk).update(title="Changed by the check")
            return []

        with mock.patch.object(Command, "collect", sneaky):
            code, _, err = self.run_check()
        self.assertEqual(code, 2, "the check is reported as incomplete, never as clean")
        self.assertIn("could not be completed", err)
        self.assertEqual(Property.objects.get(pk=prop.pk).title, "Untouched")

    def test_the_read_only_setting_does_not_leak_out_of_the_command(self):
        self.run_check()
        self.assertTrue(Property.objects.create(title="Still writable", address="a", city="c", price=Decimal("1")).pk)

    # ---- statement timeout ---------------------------------------------------------------------------------------------------
    @staticmethod
    def slow_collect(self_, limit):
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_sleep(5)")
        return []

    def test_a_timeout_is_reported_clearly_with_exit_code_2_and_nothing_is_left_behind(self):
        self.closed_by_hand(commission=False)  # a critical finding exists, but an incomplete check must never be read as "clean" or as "found"
        with mock.patch.object(Command, "collect", self.slow_collect):
            code, out, err = self.run_check("--timeout", "0.3")
        self.assertEqual(code, 2)
        self.assertIn("timed out after 0.3 s", err)
        self.assertIn("incomplete", err)
        self.assertNotIn("RESULT", out)
        with connection.cursor() as cursor:  # neither setting survived the failed check
            cursor.execute("SHOW statement_timeout")
            self.assertEqual(cursor.fetchone()[0], "0")
            cursor.execute("SHOW transaction_read_only")
            self.assertEqual(cursor.fetchone()[0], "off")
        self.assertEqual(self.run_check()[0], 1, "and the next, normal run works")

    def test_a_timeout_in_json_mode_is_still_parseable(self):
        with mock.patch.object(Command, "collect", self.slow_collect):
            code, out, _ = self.run_check("--json", "--timeout", "0.3")
        report = json.loads(out)
        self.assertEqual(code, 2)
        self.assertEqual((report["ok"], report["error"]), (False, "incomplete"))
        self.assertIn("timed out", report["message"])

    def test_the_timeout_is_applied_to_the_check_and_a_zero_timeout_means_none(self):
        seen = []

        def look(self_, limit):
            with connection.cursor() as cursor:
                cursor.execute("SHOW statement_timeout")
                seen.append(cursor.fetchone()[0])
            return []

        with mock.patch.object(Command, "collect", look):
            self.run_check("--timeout", "7")
            self.run_check("--timeout", "0")
            self.run_check()
        self.assertEqual(seen, ["7s", "0", "1min"], "explicit, none, and the default of 60 s")

    # ---- JSON and --limit ----------------------------------------------------------------------------------------------------
    def test_json_on_success_is_parseable(self):
        self.sale_through_the_service()
        code, out, err = self.run_check("--json")
        report = json.loads(out)
        self.assertEqual((code, err), (0, ""))
        self.assertTrue(report["ok"])
        self.assertEqual([c["code"] for c in report["checks"]], ["A", "B", "C", "D1", "D2", "E1", "E2"])
        self.assertTrue(all(c["count"] == 0 and c["examples"] == [] for c in report["checks"]))

    def test_limit_never_hides_the_total_in_text_or_json(self):
        for _ in range(4):
            self.closed_by_hand(commission=False)
        for limit, shown in (("1", 1), ("0", 0)):
            with self.subTest(limit=limit):
                _, out, _ = self.run_check("--json", "--limit", limit)
                b = {c["code"]: c for c in json.loads(out)["checks"]}["B"]
                self.assertEqual((b["count"], len(b["examples"])), (4, shown))
                _, text, err = self.run_check("--limit", limit)
                self.assertRegex(text, r"B\s+.*: 4")
                self.assertIn(f"... and {4 - shown} more", text)
                self.assertIn("B=4", err, "the exit summary carries the real total")


class RealConnectionTests(TransactionTestCase):
    """Without the test wrapper: the settings of the check must not outlive its transaction on a real (autocommit) connection."""

    def test_nothing_leaks_after_the_check(self):
        call_command("check_sales_integrity", "--timeout", "5", stdout=io.StringIO())
        with connection.cursor() as cursor:
            cursor.execute("SHOW transaction_read_only")
            self.assertEqual(cursor.fetchone()[0], "off")
            cursor.execute("SHOW statement_timeout")
            self.assertEqual(cursor.fetchone()[0], "0")
        self.assertTrue(Property.objects.create(title="Writable", address="a", city="c", price=Decimal("1")).pk)

    def test_a_timeout_leaks_nothing_either(self):
        with mock.patch.object(Command, "collect", CheckSalesIntegrityTests.slow_collect):
            with self.assertRaises(CommandError) as raised:
                call_command("check_sales_integrity", "--timeout", "0.3", stdout=io.StringIO())
        self.assertEqual(raised.exception.returncode, 2)
        with connection.cursor() as cursor:
            cursor.execute("SHOW statement_timeout")
            self.assertEqual(cursor.fetchone()[0], "0")
        self.assertTrue(Property.objects.create(title="Writable", address="a", city="c", price=Decimal("1")).pk)


class DuplicateClosedDealsTests(TransactionTestCase):
    """Check A needs a property with TWO closed deals. The database no longer allows that (deals.0003), so these tests run on the schema as it was
    before that migration (a migration state, not a DROP INDEX): the test database is moved back to deals.0002, the duplicate is created, the
    command is run, and the schema is brought back to the latest state in tearDown whatever happens."""

    def migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(targets)

    def setUp(self):
        self.migrate([("deals", "0002_initial")])
        self.manager = make_user("m-audit@t.test", Role.MANAGER)
        self.sales = make_user("s-audit@t.test", Role.SALESPERSON)

    def tearDown(self):
        try:
            with connection.cursor() as cursor:
                cursor.execute("TRUNCATE TABLE deals_deal CASCADE")  # the duplicate would stop the migration forward
        finally:
            executor = MigrationExecutor(connection)
            executor.loader.build_graph()
            executor.migrate(executor.loader.graph.leaf_nodes())

    def closed_deal(self, prop, name):
        lead = Lead.objects.create(first_name=name, last_name="x", phone="0100000000", assigned_to=self.sales)
        deal = Deal.objects.create(lead=lead, property=prop, assigned_to=self.sales, stage=Deal.Stage.CLOSED, sale_price=Decimal("900000"), closed_at=timezone.now())
        commission_services.create_for_deal(deal, self.manager)
        return deal

    @staticmethod
    def run_check(*args):
        out, err = io.StringIO(), io.StringIO()
        try:
            call_command("check_sales_integrity", *args, stdout=out, stderr=err)
            code = 0
        except CommandError as e:
            code = e.returncode
            err.write(str(e))
        return code, out.getvalue(), err.getvalue()

    def test_the_schema_of_this_class_really_has_no_index_and_the_normal_schema_comes_back(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM pg_indexes WHERE indexname = 'uniq_closed_deal_per_property'")
            self.assertEqual(cursor.fetchone()[0], 0)

    def test_a_property_with_two_closed_deals_is_critical(self):
        prop = Property.objects.create(title="Dup", address="a", city="c", price=Decimal("1"))
        first, second = self.closed_deal(prop, "a"), self.closed_deal(prop, "b")
        other = Property.objects.create(title="Fine", address="a", city="c", price=Decimal("1"))
        self.closed_deal(other, "c")  # a normal sale elsewhere is not reported
        code, out, err = self.run_check()
        self.assertEqual(code, 1)
        self.assertRegex(out, r"A\s+.*: 1")
        self.assertIn(f"property_id={prop.pk}, closed_deal_ids=[{first.pk}, {second.pk}]", out)
        self.assertIn("A=1", err)
        self.assertNotIn(f"property_id={other.pk}", out.split("B ")[0])

    def test_the_command_changes_nothing_when_it_finds_a_duplicate(self):
        prop = Property.objects.create(title="Dup", address="a", city="c", price=Decimal("1"))
        self.closed_deal(prop, "a")
        self.closed_deal(prop, "b")

        def snapshot():
            return (
                list(Deal.objects.order_by("pk").values_list("pk", "stage", "updated_at")),
                list(Commission.objects.order_by("pk").values_list("pk", "status", "updated_at")),
                list(Property.objects.order_by("pk").values_list("pk", "status", "updated_at")),
            )

        before = snapshot()
        self.assertEqual(self.run_check()[0], 1)
        self.assertEqual(self.run_check("--json")[0], 1)
        self.assertEqual(snapshot(), before)

    def test_json_reports_the_duplicate_with_the_real_total(self):
        for n in range(3):
            prop = Property.objects.create(title=f"Dup{n}", address="a", city="c", price=Decimal("1"))
            self.closed_deal(prop, f"x{n}")
            self.closed_deal(prop, f"y{n}")
        code, out, _ = self.run_check("--json", "--limit", "1")
        a = {c["code"]: c for c in json.loads(out)["checks"]}["A"]
        self.assertEqual((code, a["count"], len(a["examples"])), (1, 3, 1))

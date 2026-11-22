"""deals.0003: one closed deal per property, enforced by a partial unique index in PostgreSQL.

The application already enforces it (locks in deals.services); the index is the net under it for every writer that does not take those locks.
Covered: the index itself, what it forbids and what it must leave alone (history), the API answering 400 (not 500) to a second sale, commissions
and property status staying consistent, the migration (preflight, success, failure, rollback) and two writers racing around the services.
"""
import threading
import time
from decimal import Decimal
from unittest import mock

from django.db import IntegrityError, connection, connections, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from commissions.models import Commission
from core.exceptions import BusinessRuleViolation
from deals import services
from deals.models import Deal
from leads.models import Lead
from properties.models import Property
from users.models import Role, User

from .base import ApiTestCase, make_user

INDEX = "uniq_closed_deal_per_property"


class ClosedDealIndexTests(ApiTestCase):
    def closed(self, prop, **kw):
        return self.deal(self.sales_a, prop=prop, stage=Deal.Stage.CLOSED, sale_price=Decimal("1"), closed_at=timezone.now(), **kw)

    def test_the_index_exists_and_is_partial_and_unique(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT indexdef FROM pg_indexes WHERE tablename = 'deals_deal' AND indexname = %s", [INDEX])
            row = cursor.fetchone()
        self.assertIsNotNone(row, "the index exists")
        definition = row[0]
        self.assertIn("UNIQUE", definition)
        self.assertIn("(property_id)", definition)
        self.assertIn("'closed'", definition, "only closed deals are covered")

    def test_a_second_closed_deal_on_a_property_is_refused_by_the_database(self):
        prop = self.prop(self.sales_a)
        self.closed(prop)
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.closed(prop)

    def test_moving_another_deal_to_closed_with_a_plain_update_is_refused_too(self):
        prop = self.prop(self.sales_a)
        self.closed(prop)
        other = self.deal(self.sales_a, prop=prop, stage=Deal.Stage.NEGOTIATION)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Deal.objects.filter(pk=other.pk).update(stage=Deal.Stage.CLOSED)
        self.assertEqual(Deal.objects.get(pk=other.pk).stage, Deal.Stage.NEGOTIATION)

    def test_history_is_not_affected_any_number_of_interested_open_and_lost_deals_are_allowed(self):
        prop = self.prop(self.sales_a)
        for _ in range(3):
            self.deal(self.sales_a, prop=prop, stage=Deal.Stage.INTERESTED)  # different leads, all interested
        self.deal(self.sales_a, prop=prop, stage=Deal.Stage.VIEWING)
        self.deal(self.sales_a, prop=prop, stage=Deal.Stage.NEGOTIATION)
        for reason in ("a", "b", "c"):
            self.deal(self.sales_a, prop=prop, stage=Deal.Stage.LOST, lost_reason=reason)
        self.closed(prop)                                      # and one sale next to all of them
        self.closed(self.prop(self.sales_a))                   # another property sold as well
        self.assertEqual(Deal.objects.filter(property=prop).count(), 9)
        self.assertEqual(Deal.objects.filter(stage=Deal.Stage.CLOSED).count(), 2)

    def test_a_double_sale_through_the_api_is_a_400_not_a_500_and_leaves_commissions_and_status_consistent(self):
        prop = self.prop(self.sales_a)
        first, second = (self.deal(self.sales_a, prop=prop, stage=Deal.Stage.NEGOTIATION) for _ in range(2))
        api = self.as_user(self.manager)
        self.assertEqual(api.post(f"/api/deals/{first.pk}/move/", {"stage": "closed"}, format="json").status_code, 200)
        refused = api.post(f"/api/deals/{second.pk}/move/", {"stage": "closed"}, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertIn("already been sold", refused.content.decode())
        self.assertEqual(list(Commission.objects.values_list("deal_id", flat=True)), [first.pk], "one commission, for the real sale")
        self.assertEqual(Property.objects.get(pk=prop.pk).status, Property.Status.SOLD)
        self.assertEqual(Deal.objects.get(pk=second.pk).stage, Deal.Stage.NEGOTIATION)
        self.assertIsNone(Deal.objects.get(pk=second.pk).closed_at)

    def test_only_this_index_is_translated_every_other_database_error_is_raised_as_it_is(self):
        prop = self.prop(self.sales_a)
        deal = self.deal(self.sales_a, prop=prop, stage=Deal.Stage.NEGOTIATION)
        for error in (IntegrityError("some other constraint"), IntegrityError(f"mentions {INDEX} only in its text")):
            with self.subTest(error=str(error)), mock.patch.object(Deal, "save", side_effect=error):
                with self.assertRaises(IntegrityError):
                    services.move_stage(Deal.objects.get(pk=deal.pk), Deal.Stage.CLOSED, self.manager)
        self.assertEqual(Deal.objects.get(pk=deal.pk).stage, Deal.Stage.NEGOTIATION)

    def test_the_service_refuses_before_the_database_has_to(self):
        prop = self.prop(self.sales_a)
        first, second = (self.deal(self.sales_a, prop=prop, stage=Deal.Stage.NEGOTIATION) for _ in range(2))
        services.move_stage(first, Deal.Stage.CLOSED, self.manager)
        with self.assertRaises(BusinessRuleViolation):  # not an IntegrityError: the application rule comes first
            services.move_stage(second, Deal.Stage.CLOSED, self.manager)

    def test_closing_still_works_for_every_property_independently(self):
        api = self.as_user(self.manager)
        deals = [self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION) for _ in range(4)]
        for deal in deals:
            self.assertEqual(api.post(f"/api/deals/{deal.pk}/move/", {"stage": "closed"}, format="json").status_code, 200)
        self.assertEqual(Commission.objects.count(), 4)
        self.assertEqual(Property.objects.filter(status=Property.Status.SOLD).count(), 4)


class ClosedDealIndexMigrationTests(TransactionTestCase):
    """The migration on a throw-away PostgreSQL (the test database): the schema is moved back to the state before it, data is created there,
    and the migration is run forward and backward. The schema is put back at the latest state afterwards, whatever happens."""

    before = [("deals", "0002_initial")]
    after = [("deals", "0003_uniq_closed_deal_per_property")]

    def migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        try:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM deals_deal")  # duplicates would stop the migration forward
        finally:
            executor = MigrationExecutor(connection)
            executor.loader.build_graph()
            executor.migrate(executor.loader.graph.leaf_nodes())  # the other tests need the latest schema

    @staticmethod
    def index_exists():
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM pg_indexes WHERE indexname = %s", [INDEX])
            return cursor.fetchone()[0] == 1

    @staticmethod
    def closed_deals(apps, properties=1, per_property=1):
        """`properties` properties, each with `per_property` closed deals (historical models: no custom save, no signals)."""
        P, L, D = (apps.get_model(app, model) for app, model in (("properties", "Property"), ("leads", "Lead"), ("deals", "Deal")))
        made = []
        for i in range(properties):
            prop = P.objects.create(title=f"p{i}", address="a", city="c", price=Decimal("1"), reference=f"PR-M{i}")
            ids = [
                D.objects.create(lead=L.objects.create(first_name=f"l{i}-{j}", last_name="x", phone="0100000000"), property=prop, stage="closed").pk
                for j in range(per_property)
            ]
            made.append((prop.pk, ids))
        return made

    def test_clean_data_migrates_the_index_appears_and_the_rollback_only_drops_it(self):
        old = self.migrate(self.before)
        self.assertFalse(self.index_exists(), "not there before the migration")
        [(prop_id, [deal_id])] = self.closed_deals(old)
        self.migrate(self.after)
        self.assertTrue(self.index_exists())
        rows_before = Deal.objects.order_by("pk").values_list("pk", "stage", "property_id", "updated_at")
        snapshot = list(rows_before)
        self.migrate(self.before)  # roll back
        self.assertFalse(self.index_exists(), "the rollback removes the index")
        self.assertEqual(list(Deal.objects.order_by("pk").values_list("pk", "stage", "property_id", "updated_at")), snapshot, "and touches no data")
        self.assertEqual(snapshot[0][:3], (deal_id, "closed", prop_id))
        self.migrate(self.after)  # and it can be applied again
        self.assertTrue(self.index_exists())

    def test_history_next_to_a_sale_does_not_stop_the_migration(self):
        old = self.migrate(self.before)
        [(prop_id, _)] = self.closed_deals(old)
        D, L = old.get_model("deals", "Deal"), old.get_model("leads", "Lead")
        for stage in ("interested", "negotiation", "lost", "lost"):
            D.objects.create(lead=L.objects.create(first_name=stage, last_name="x", phone="0100000000"), property_id=prop_id, stage=stage)
        self.migrate(self.after)
        self.assertTrue(self.index_exists())

    def test_a_duplicate_stops_the_migration_before_changing_anything_and_names_the_property(self):
        old = self.migrate(self.before)
        [(prop_id, deal_ids)] = self.closed_deals(old, per_property=2)
        with self.assertRaises(RuntimeError) as raised:
            self.migrate(self.after)
        message = str(raised.exception)
        self.assertIn(f"property {prop_id} (2 closed deals)", message)
        self.assertIn("Nothing was changed", message)
        self.assertIn("check_sales_integrity", message)
        self.assertFalse(self.index_exists(), "no index was built")
        self.assertEqual(Deal.objects.filter(pk__in=deal_ids, stage="closed").count(), 2, "the preflight deleted and edited nothing")
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM django_migrations WHERE app = 'deals' AND name = %s", [self.after[0][1]])
            self.assertEqual(cursor.fetchone()[0], 0, "the migration is not recorded as applied")

    def test_the_message_counts_all_the_properties_and_lists_the_first_twenty(self):
        old = self.migrate(self.before)
        self.closed_deals(old, properties=22, per_property=2)
        with self.assertRaises(RuntimeError) as raised:
            self.migrate(self.after)
        self.assertIn("22 properties have more than one closed deal", str(raised.exception))
        self.assertIn("... and 2 more", str(raised.exception))

    def test_after_the_duplicate_is_resolved_by_a_person_the_migration_goes_through(self):
        old = self.migrate(self.before)
        [(prop_id, deal_ids)] = self.closed_deals(old, per_property=2)
        with self.assertRaises(RuntimeError):
            self.migrate(self.after)
        old.get_model("deals", "Deal").objects.filter(pk=deal_ids[1]).update(stage="lost")  # what a human decided
        self.migrate(self.after)
        self.assertTrue(self.index_exists())


class ConcurrentClosedWritesTests(TransactionTestCase):
    def test_two_writers_that_skip_the_application_locks_cannot_both_close_the_property(self):
        manager = make_user("m-idx@t.test", Role.MANAGER)
        prop = Property.objects.create(title="C", address="a", city="c", price=Decimal("1"))
        deals = [
            Deal.objects.create(
                lead=Lead.objects.create(first_name=f"l{i}", last_name="x", phone="0100000000", assigned_to=manager),
                property=prop, assigned_to=manager, stage=Deal.Stage.NEGOTIATION,
            )
            for i in range(2)
        ]
        barrier, outcomes = threading.Barrier(2), []

        def writer(deal):
            try:
                barrier.wait(timeout=5)
                with transaction.atomic():
                    Deal.objects.filter(pk=deal.pk).update(stage=Deal.Stage.CLOSED, closed_at=timezone.now())
                outcomes.append("closed")
            except IntegrityError:
                outcomes.append("refused")
            finally:
                connections.close_all()

        threads = [threading.Thread(target=writer, args=(d,)) for d in deals]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(sorted(outcomes), ["closed", "refused"], "exactly one writer wins")
        self.assertEqual(Deal.objects.filter(property=prop, stage=Deal.Stage.CLOSED).count(), 1)
        self.assertEqual(Deal.objects.filter(property=prop, stage=Deal.Stage.NEGOTIATION).count(), 1, "the loser is untouched")
        self.assertEqual(Commission.objects.count(), 0, "a raw writer creates no commission: nothing half-done is left either")

    def test_the_services_and_a_raw_writer_racing_for_the_same_property_leave_one_sale_and_one_commission(self):
        manager = make_user("m-idx2@t.test", Role.MANAGER)
        prop = Property.objects.create(title="C2", address="a", city="c", price=Decimal("1"))
        deals = [
            Deal.objects.create(
                lead=Lead.objects.create(first_name=f"r{i}", last_name="x", phone="0100000000", assigned_to=manager),
                property=prop, assigned_to=manager, stage=Deal.Stage.NEGOTIATION, offer_amount=Decimal("900000"),
            )
            for i in range(2)
        ]
        barrier, outcomes = threading.Barrier(2), {}

        def through_the_services():
            try:
                barrier.wait(timeout=5)
                services.move_stage(Deal.objects.get(pk=deals[0].pk), Deal.Stage.CLOSED, manager)
                outcomes["services"] = "closed"
            except BusinessRuleViolation:
                outcomes["services"] = "refused"
            finally:
                connections.close_all()

        def raw():
            try:
                barrier.wait(timeout=5)
                with transaction.atomic():
                    Deal.objects.filter(pk=deals[1].pk).update(stage=Deal.Stage.CLOSED, closed_at=timezone.now())
                outcomes["raw"] = "closed"
            except IntegrityError:
                outcomes["raw"] = "refused"
            finally:
                connections.close_all()

        threads = [threading.Thread(target=through_the_services), threading.Thread(target=raw)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(Deal.objects.filter(property=prop, stage=Deal.Stage.CLOSED).count(), 1, outcomes)
        self.assertEqual(sorted(outcomes.values()).count("closed"), 1, outcomes)
        if outcomes["services"] == "closed":
            self.assertEqual(Commission.objects.filter(deal=deals[0]).count(), 1)
            self.assertEqual(Property.objects.get(pk=prop.pk).status, Property.Status.SOLD)
        else:
            self.assertEqual(Commission.objects.count(), 0)

    def test_a_request_that_loses_to_a_writer_that_skipped_the_locks_gets_a_400_not_a_500(self):
        manager = make_user("m-idx3@t.test", Role.MANAGER)
        prop = Property.objects.create(title="C3", address="a", city="c", price=Decimal("1"))
        winner, loser = (
            Deal.objects.create(
                lead=Lead.objects.create(first_name=f"w{i}", last_name="x", phone="0100000000", assigned_to=manager),
                property=prop, assigned_to=manager, stage=Deal.Stage.NEGOTIATION, offer_amount=Decimal("900000"),
            )
            for i in range(2)
        )
        written, commit, outcome = threading.Event(), threading.Event(), {}

        def raw_writer():  # holds an uncommitted closing of `winner`, taking no property lock
            try:
                with transaction.atomic():
                    Deal.objects.filter(pk=winner.pk).update(stage=Deal.Stage.CLOSED, closed_at=timezone.now())
                    written.set()
                    commit.wait(15)
            finally:
                connections.close_all()

        def request():  # a normal API closing of `loser`: its application check cannot see the uncommitted sale, the index decides
            try:
                client = APIClient(raise_request_exception=False)
                client.force_authenticate(user=User.objects.get(pk=manager.pk))
                response = client.post(f"/api/deals/{loser.pk}/move/", {"stage": "closed"}, format="json")
                outcome["status"], outcome["body"] = response.status_code, response.content.decode()
            finally:
                connections.close_all()

        t1 = threading.Thread(target=raw_writer)
        t1.start()
        self.assertTrue(written.wait(10))
        t2 = threading.Thread(target=request)
        t2.start()
        deadline, queued = time.time() + 10, False
        with connection.cursor() as cursor:  # the request is blocked on the index, waiting for the writer's transaction
            while time.time() < deadline and not queued:
                cursor.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
                queued = cursor.fetchone()[0] >= 1
                time.sleep(0.03)
        self.assertTrue(queued, "the request waits for the other writer's uncommitted sale")
        commit.set()
        t1.join(15)
        t2.join(15)
        self.assertEqual(outcome["status"], 400, outcome)
        self.assertIn("already been sold", outcome["body"])
        self.assertEqual(Deal.objects.get(pk=winner.pk).stage, Deal.Stage.CLOSED)
        loser.refresh_from_db()
        self.assertEqual((loser.stage, loser.closed_at, loser.sale_price), (Deal.Stage.NEGOTIATION, None, None))
        self.assertEqual(Commission.objects.count(), 0, "the refused closing left no commission behind")
        self.assertEqual(Property.objects.get(pk=prop.pk).status, Property.Status.AVAILABLE, "and did not touch the property")

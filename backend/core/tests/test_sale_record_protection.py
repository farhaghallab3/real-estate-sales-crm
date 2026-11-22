"""A completed sale is never deleted: not through the API, not through the Django admin, not through the ORM, and not by a cascade.

Covered here: a closed deal WITH its commission and one WITHOUT it (old or hand-made data); property, lead, deal and document deletion; admin
single and bulk deletion; ORM deletion (single instance, queryset, stale copy); what stays deletable (records with only open or lost deals);
deletion racing a closing (both orders) and a mixed storm of requests; and the migration state of the on_delete change.
"""
import io
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from unittest import mock

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection, connections, transaction
from django.db.models import ProtectedError
from django.db.models.signals import pre_delete, pre_save
from django.test import Client, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from commissions.models import Commission
from core.exceptions import api_exception_handler
from core.models import Activity
from deals import protection, services
from deals.models import Deal, Offer
from documents import services as document_services
from documents.models import Document
from leads.models import Lead
from properties.models import Property
from users.models import Role, User

from .base import ApiTestCase, make_user

def wait_for_a_lock_waiter(timeout=8) -> bool:
    """True once some database session is blocked waiting for a row lock: the queued request really is queued (not merely slow to start)."""
    deadline = time.time() + timeout
    with connection.cursor() as cursor:
        while time.time() < deadline:
            cursor.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
            if cursor.fetchone()[0] >= 1:
                return True
            time.sleep(0.05)
    return False


MESSAGE = protection.SALE_RECORD_MESSAGE
STATIC = {**settings.STORAGES, "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}}


class SaleDeletionChecks:
    """The rules, checked for a sale with and without its commission. Concrete classes decide how the sale is built."""

    with_commission = True

    def build_sale(self):
        self.prop_ = self.prop(self.sales_a, title="Sold")
        self.deal_ = self.deal(self.sales_a, prop=self.prop_, stage=Deal.Stage.NEGOTIATION)
        self.lead_ = self.deal_.lead
        self.offer = Offer.objects.create(
            deal=self.deal_, lead=self.lead_, property=self.prop_, amount=Decimal("900000"), submitted_by=self.sales_a
        )
        self.doc = self.document(self.deal_, self.sales_a)
        if self.with_commission:
            response = self.as_user(self.manager).post(f"/api/deals/{self.deal_.pk}/move/", {"stage": "closed"}, format="json")
            self.assertEqual(response.status_code, 200, response.content)
            self.assertTrue(Commission.objects.filter(deal=self.deal_).exists())
        else:  # closed by hand (old data / shell): no commission row exists
            Deal.objects.filter(pk=self.deal_.pk).update(stage=Deal.Stage.CLOSED, sale_price=Decimal("900000"), closed_at=timezone.now())
            self.assertFalse(Commission.objects.filter(deal=self.deal_).exists())
        self.activities = Activity.objects.filter(deal=self.deal_).count()

    def assert_sale_intact(self):
        self.assertTrue(Property.objects.filter(pk=self.prop_.pk).exists())
        self.assertTrue(Lead.objects.filter(pk=self.lead_.pk).exists())
        self.assertTrue(Deal.objects.filter(pk=self.deal_.pk, stage="closed").exists())
        self.assertTrue(Offer.objects.filter(pk=self.offer.pk).exists())
        doc = Document.objects.get(pk=self.doc.pk)
        self.assertTrue(doc.file.storage.exists(doc.file.name), "the stored file is still there")
        self.assertEqual(Commission.objects.filter(deal=self.deal_).exists(), self.with_commission)
        self.assertEqual(Activity.objects.filter(deal=self.deal_).count(), self.activities)

    # ---- API ---------------------------------------------------------------------------------------------------------
    def test_deleting_the_property_the_lead_or_the_deal_is_refused_with_a_clear_message(self):
        api = self.as_user(self.manager)
        for name, url in {
            "property": f"/api/properties/{self.prop_.pk}/",
            "lead": f"/api/leads/{self.lead_.pk}/",
            "deal": f"/api/deals/{self.deal_.pk}/",
        }.items():
            with self.subTest(record=name):
                response = api.delete(url)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn(MESSAGE, response.content.decode())
                self.assert_sale_intact()

    def test_the_admin_role_is_refused_too(self):
        for url in (f"/api/leads/{self.lead_.pk}/", f"/api/deals/{self.deal_.pk}/"):
            self.assertEqual(self.as_user(self.admin).delete(url).status_code, 400)
        self.assert_sale_intact()

    def test_the_documents_of_the_sale_cannot_be_deleted_changed_or_re_linked(self):
        url = f"/api/documents/{self.doc.pk}/"
        for actor in (self.sales_a, self.manager, self.admin):  # the uploader, a manager and an admin
            with self.subTest(actor=actor.role):
                response = self.as_user(actor).delete(url)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn(MESSAGE, response.content.decode())
        other_deal = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        for method in ("patch", "put"):
            with self.subTest(method=method):
                response = getattr(self.as_user(self.manager), method)(url, {"deal": other_deal.pk, "name": "x"}, format="json")
                self.assertEqual(response.status_code, 405, "the API has no way to edit or re-link a document")
        self.assertEqual(Document.objects.get(pk=self.doc.pk).deal_id, self.deal_.pk)
        self.assert_sale_intact()

    # ---- ORM ---------------------------------------------------------------------------------------------------------
    def test_the_orm_refuses_every_way_of_deleting_the_sale(self):
        attempts = {
            "deal.delete()": lambda: Deal.objects.get(pk=self.deal_.pk).delete(),
            "property.delete()": lambda: Property.objects.get(pk=self.prop_.pk).delete(),
            "lead.delete()": lambda: Lead.objects.get(pk=self.lead_.pk).delete(),
            "Deal queryset delete": lambda: Deal.objects.filter(pk=self.deal_.pk).delete(),
            "Property queryset delete": lambda: Property.objects.filter(pk=self.prop_.pk).delete(),
            "Lead queryset delete": lambda: Lead.objects.filter(pk=self.lead_.pk).delete(),
            "everything": lambda: Property.objects.all().delete(),
        }
        for name, attempt in attempts.items():
            with self.subTest(attempt=name), self.assertRaises(ProtectedError), transaction.atomic():
                attempt()
            self.assert_sale_intact()

    # ---- what stays deletable ------------------------------------------------------------------------------------------
    def test_records_without_a_closed_deal_are_deleted_exactly_as_before(self):
        api = self.as_user(self.manager)
        open_prop, lost_prop = self.prop(self.sales_a, title="Open"), self.prop(self.sales_a, title="Lost")
        open_deal = self.deal(self.sales_a, prop=open_prop, stage=Deal.Stage.NEGOTIATION)
        Offer.objects.create(deal=open_deal, lead=open_deal.lead, property=open_prop, amount=Decimal("1"), submitted_by=self.sales_a)
        lost_deal = self.deal(self.sales_a, prop=lost_prop, stage=Deal.Stage.LOST, lost_reason="x")
        bare_prop, bare_lead = self.prop(self.sales_a, title="Bare"), self.lead(self.sales_a, first_name="Bare")
        self.assertEqual(api.delete(f"/api/properties/{open_prop.pk}/").status_code, 204)
        self.assertEqual(api.delete(f"/api/leads/{lost_deal.lead_id}/").status_code, 204)
        self.assertEqual(api.delete(f"/api/properties/{bare_prop.pk}/").status_code, 204)
        self.assertEqual(api.delete(f"/api/leads/{bare_lead.pk}/").status_code, 204)
        self.assertFalse(Deal.objects.filter(pk__in=[open_deal.pk, lost_deal.pk]).exists(), "their deals went with them, as before")
        self.assertFalse(Offer.objects.filter(deal=open_deal).exists())
        self.assert_sale_intact()

    def test_open_and_lost_deals_and_the_documents_of_open_deals_are_still_deletable(self):
        api = self.as_user(self.manager)
        open_deal = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        doc = self.document(open_deal, self.sales_a)
        name = doc.file.name
        with self.captureOnCommitCallbacks(execute=True):  # the file is removed after the commit
            self.assertEqual(api.delete(f"/api/documents/{doc.pk}/").status_code, 204)
        self.assertFalse(Document.objects.filter(pk=doc.pk).exists())
        self.assertFalse(doc.file.storage.exists(name), "the file of a deleted, ordinary document is removed as before")
        self.assertEqual(api.delete(f"/api/deals/{open_deal.pk}/").status_code, 204)
        lost = self.deal(self.sales_a, stage=Deal.Stage.LOST, lost_reason="x")
        self.assertEqual(api.delete(f"/api/deals/{lost.pk}/").status_code, 204)
        self.assert_sale_intact()


class ClosedDealWithCommissionTests(SaleDeletionChecks, ApiTestCase):
    with_commission = True

    def setUp(self):
        self.build_sale()


class ClosedDealWithoutCommissionTests(SaleDeletionChecks, ApiTestCase):
    with_commission = False

    def setUp(self):
        self.build_sale()


class StaleCopyTests(ApiTestCase):
    def test_a_deal_copy_loaded_before_the_closing_cannot_delete_the_sale(self):
        deal = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        stale = Deal.objects.get(pk=deal.pk)
        self.assertEqual(self.as_user(self.manager).post(f"/api/deals/{deal.pk}/move/", {"stage": "closed"}, format="json").status_code, 200)
        Commission.objects.filter(deal=deal).delete()  # even with the commission gone, the closed stage alone protects the deal
        self.assertEqual(stale.stage, "negotiation")
        with self.assertRaises(ProtectedError), transaction.atomic():
            stale.delete()
        self.assertTrue(Deal.objects.filter(pk=deal.pk, stage="closed").exists())


@override_settings(STORAGES=STATIC)
class AdminDeletionTests(ApiTestCase):
    """Real admin requests: the refusal is server-side. Property and lead (single and bulk), the closed deal, its offers and its documents."""

    def setUp(self):
        self.prop_ = self.prop(self.sales_a, title="Admin sold")
        self.deal_ = self.deal(self.sales_a, prop=self.prop_, stage=Deal.Stage.NEGOTIATION)
        self.lead_ = self.deal_.lead
        self.offer = Offer.objects.create(deal=self.deal_, lead=self.lead_, property=self.prop_, amount=Decimal("1"), submitted_by=self.sales_a)
        self.doc = self.document(self.deal_, self.sales_a)
        self.assertEqual(self.as_user(self.manager).post(f"/api/deals/{self.deal_.pk}/move/", {"stage": "closed"}, format="json").status_code, 200)
        su = User.objects.create_superuser("su-sale@t.test", "Correct-Horse-9-Battery!")
        self.site = Client()
        self.site.force_login(su)

    def bulk(self, model, pk):
        return self.site.post(f"/django-admin/{model}/", {"action": "delete_selected", "_selected_action": [pk], "post": "yes"})

    def assert_intact(self, commission=True):
        checks = [(Property, self.prop_.pk), (Lead, self.lead_.pk), (Deal, self.deal_.pk), (Offer, self.offer.pk), (Document, self.doc.pk)]
        if commission:
            checks.append((Commission, self.deal_.commission.pk))
        for model, pk in checks:
            self.assertTrue(model.objects.filter(pk=pk).exists(), model.__name__)

    def test_nothing_of_the_sale_can_be_deleted_in_the_admin(self):
        targets = {
            "properties/property": self.prop_.pk, "leads/lead": self.lead_.pk, "deals/deal": self.deal_.pk,
            "deals/offer": self.offer.pk, "documents/document": self.doc.pk,
        }
        for model, pk in targets.items():
            with self.subTest(model=model):
                self.assertEqual(self.site.post(f"/django-admin/{model}/{pk}/delete/", {"post": "yes"}).status_code, 403)
                self.assertIn(self.bulk(model, pk).status_code, (200, 403), "refused (403) or the admin's own \"cannot delete: protected\" page (200)")
                self.assert_intact()

    def test_a_closed_deal_without_its_commission_is_protected_in_the_admin_too(self):
        Commission.objects.filter(deal=self.deal_).delete()  # old or hand-made data: the closed stage alone must protect the sale
        for model, pk in {"properties/property": self.prop_.pk, "leads/lead": self.lead_.pk, "deals/deal": self.deal_.pk}.items():
            with self.subTest(model=model):
                self.assertEqual(self.site.post(f"/django-admin/{model}/{pk}/delete/", {"post": "yes"}).status_code, 403)
                self.assertEqual(self.bulk(model, pk).status_code, 403)
                self.assert_intact(commission=False)

    def test_a_document_of_the_sale_cannot_be_changed_in_the_admin(self):
        body = {"category": "contract", "name": "tampered.pdf", "size": 1, "uploaded_by": self.sales_a.pk, "deal": self.deal(self.sales_a).pk}
        self.assertEqual(self.site.post(f"/django-admin/documents/document/{self.doc.pk}/change/", body).status_code, 403)
        fresh = Document.objects.get(pk=self.doc.pk)
        self.assertEqual((fresh.name, fresh.deal_id), (self.doc.name, self.deal_.pk))

    def test_a_document_of_an_open_deal_stays_editable_but_keeps_its_deal(self):
        open_deal, other = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION), self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        doc = self.document(open_deal, self.sales_a)
        body = {"category": "agreement", "name": "renamed.pdf", "size": 1, "uploaded_by": self.sales_a.pk, "deal": other.pk}
        self.assertEqual(self.site.post(f"/django-admin/documents/document/{doc.pk}/change/", body).status_code, 302)
        fresh = Document.objects.get(pk=doc.pk)
        self.assertEqual((fresh.name, fresh.deal_id), ("renamed.pdf", open_deal.pk), "re-linking is not possible")
        self.assertEqual(self.bulk("documents/document", doc.pk).status_code, 302)
        self.assertFalse(Document.objects.filter(pk=doc.pk).exists())

    def test_records_without_a_closed_deal_are_still_deletable_in_the_admin(self):
        prop, lead = self.prop(self.sales_a, title="Free"), self.lead(self.sales_a, first_name="Free")
        self.assertEqual(self.bulk("properties/property", prop.pk).status_code, 302)
        self.assertEqual(self.site.post(f"/django-admin/leads/lead/{lead.pk}/delete/", {"post": "yes"}).status_code, 302)
        self.assertFalse(Property.objects.filter(pk=prop.pk).exists() or Lead.objects.filter(pk=lead.pk).exists())
        self.assert_intact()


class ErrorAndMigrationStateTests(ApiTestCase):
    def test_the_api_reports_a_protected_deletion_as_a_400(self):
        prop = self.prop(self.sales_a)
        response = api_exception_handler(ProtectedError("x", {self.deal(self.sales_a, prop=prop, stage=Deal.Stage.CLOSED)}), {})
        self.assertEqual((response.status_code, str(response.data["detail"])), (400, MESSAGE))
        other = api_exception_handler(ProtectedError("x", {prop}), {})
        self.assertEqual(other.status_code, 400)
        self.assertNotIn("sale", str(other.data["detail"]), "a protected reference that is not a sale gets the general message")

    def test_the_model_state_and_the_migrations_agree(self):
        out = io.StringIO()
        call_command("makemigrations", "--check", "--dry-run", stdout=out)  # exits with an error if a migration is missing

    def test_changing_on_delete_to_protect_changes_nothing_in_the_database(self):
        out = io.StringIO()
        call_command("sqlmigrate", "commissions", "0003", stdout=out)
        sql = [line for line in out.getvalue().splitlines() if line.strip() and not line.startswith("--")]
        self.assertEqual([line for line in sql if line.upper() not in ("BEGIN;", "COMMIT;")], [], "a state-only migration: no ALTER, no DROP")
        self.assertEqual(Commission._meta.get_field("deal").remote_field.on_delete.__name__, "PROTECT")


class DeletionRacingAClosingTests(TransactionTestCase):
    """Real transactions. The closing and the deletion take the same locks in the same order, so they are ordered, never interleaved."""

    def setUp(self):
        self.manager = make_user("m-del@t.test", Role.MANAGER)
        self.sales = make_user("s-del@t.test", Role.SALESPERSON)

    def sale(self, name="x"):
        prop = Property.objects.create(title=f"P-{name}", address="a", city="c", price=Decimal("1000000"))
        lead = Lead.objects.create(first_name=name, last_name="x", phone="0100000000", assigned_to=self.sales)
        deal = Deal.objects.create(lead=lead, property=prop, assigned_to=self.sales, stage=Deal.Stage.NEGOTIATION, offer_amount=Decimal("900000"))
        return prop, lead, deal

    def call(self, method, url, body=None):
        try:
            client = APIClient(raise_request_exception=False)
            client.force_authenticate(user=User.objects.get(pk=self.manager.pk))
            return getattr(client, method)(url, body, format="json").status_code
        finally:
            connections.close_all()

    def race(self, first, second, hold):
        """Start `first`; once it is paused at `hold`, start `second`, give it time to queue on the locks, then let `first` finish."""
        inside, release = threading.Event(), threading.Event()
        results = {}

        def run(key, fn):
            results[key] = fn()

        def pause(*a, **k):
            inside.set()
            release.wait(timeout=5)

        t1 = threading.Thread(target=run, args=("first", first))
        with hold(pause):
            t1.start()
            self.assertTrue(inside.wait(timeout=5), "the first request reached the pause point")
            t2 = threading.Thread(target=run, args=("second", second))
            t2.start()
            self.assertTrue(wait_for_a_lock_waiter(), "the second request waits for the first one's locks")
            release.set()
            t1.join(timeout=10)
            t2.join(timeout=10)
        return results

    @staticmethod
    def hold_closing(pause):
        """Pause every closing right after its locks are taken, just before the stage is written."""
        class Ctx:
            def __enter__(self_inner):
                def hook(sender, instance, **kw):
                    if instance.pk and instance.stage == Deal.Stage.CLOSED:
                        pause()
                pre_save.connect(hook, sender=Deal, dispatch_uid="sale-del-hold", weak=False)
            def __exit__(self_inner, *exc):
                pre_save.disconnect(sender=Deal, dispatch_uid="sale-del-hold")
        return Ctx()

    @staticmethod
    def hold_deletion(pause):
        """Pause every API deletion right after its locks are taken, just before it decides."""
        class Ctx:
            def __enter__(self_inner):
                self_inner.original = protection.refuse_if_sold
                def slow(deals):
                    pause()
                    return self_inner.original(deals)
                protection.refuse_if_sold = slow
            def __exit__(self_inner, *exc):
                protection.refuse_if_sold = self_inner.original
        return Ctx()

    def test_a_closing_in_progress_wins_and_the_property_deletion_is_refused(self):
        prop, lead, deal = self.sale()
        r = self.race(lambda: self.call("post", f"/api/deals/{deal.pk}/move/", {"stage": "closed"}),
                      lambda: self.call("delete", f"/api/properties/{prop.pk}/"), self.hold_closing)
        self.assertEqual((r["first"], r["second"]), (200, 400), r)
        self.assertTrue(Property.objects.filter(pk=prop.pk).exists())
        self.assertEqual(Commission.objects.filter(deal=deal).count(), 1)

    def test_a_closing_in_progress_wins_and_the_lead_deletion_is_refused(self):
        prop, lead, deal = self.sale()
        r = self.race(lambda: self.call("post", f"/api/deals/{deal.pk}/move/", {"stage": "closed"}),
                      lambda: self.call("delete", f"/api/leads/{lead.pk}/"), self.hold_closing)
        self.assertEqual((r["first"], r["second"]), (200, 400), r)
        self.assertTrue(Lead.objects.filter(pk=lead.pk).exists())
        self.assertEqual(Commission.objects.filter(deal=deal).count(), 1)

    def test_a_deletion_in_progress_wins_and_the_closing_finds_the_deal_gone(self):
        prop, lead, deal = self.sale()
        r = self.race(lambda: self.call("delete", f"/api/properties/{prop.pk}/"),
                      lambda: self.call("post", f"/api/deals/{deal.pk}/move/", {"stage": "closed"}), self.hold_deletion)
        self.assertEqual(r["first"], 204, r)
        self.assertIn(r["second"], (400, 404), r)
        self.assertFalse(Deal.objects.filter(pk=deal.pk).exists())
        self.assertFalse(Commission.objects.exists(), "no commission without a deal, and no closed deal that was half deleted")

    def test_a_lead_deletion_in_progress_wins_and_the_closing_finds_the_deal_gone(self):
        prop, lead, deal = self.sale()
        r = self.race(lambda: self.call("delete", f"/api/leads/{lead.pk}/"),
                      lambda: self.call("post", f"/api/deals/{deal.pk}/move/", {"stage": "closed"}), self.hold_deletion)
        self.assertEqual(r["first"], 204, r)
        self.assertIn(r["second"], (400, 404), r)
        self.assertFalse(Deal.objects.filter(pk=deal.pk).exists())
        self.assertFalse(Commission.objects.exists())

    def test_a_storm_of_closings_and_deletions_never_loses_a_sale_or_fails(self):
        sales = [self.sale(f"s{i}") for i in range(6)]
        ops = []
        for i, (prop, lead, deal) in enumerate(sales):
            ops += [("post", f"/api/deals/{deal.pk}/move/", {"stage": "closed"})] * 2
            ops.append([("delete", f"/api/properties/{prop.pk}/", None), ("delete", f"/api/leads/{lead.pk}/", None),
                        ("delete", f"/api/deals/{deal.pk}/", None)][i % 3])
        with ThreadPoolExecutor(8) as pool:
            codes = list(pool.map(lambda op: self.call(*op), ops))
        self.assertLess(max(codes), 500, f"a server error (a deadlock would be one): {sorted(set(codes))}")
        for deal in Deal.objects.filter(stage=Deal.Stage.CLOSED):
            self.assertTrue(Commission.objects.filter(deal=deal).exists(), "every surviving closed deal still has its commission")
            self.assertTrue(Property.objects.filter(pk=deal.property_id).exists() and Lead.objects.filter(pk=deal.lead_id).exists())
        self.assertEqual(Commission.objects.count(), Deal.objects.filter(stage=Deal.Stage.CLOSED).count())


class DocumentFileDeletionTests(ApiTestCase):
    """The row goes first, inside the transaction; the stored file only after that transaction has committed (transaction.on_commit)."""

    def setUp(self):
        self.open_deal = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        self.closed_deal = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        self.open_doc = self.document(self.open_deal, self.sales_a)
        self.closed_doc = self.document(self.closed_deal, self.sales_a)
        self.assertEqual(
            self.as_user(self.manager).post(f"/api/deals/{self.closed_deal.pk}/move/", {"stage": "closed"}, format="json").status_code, 200
        )
        self.storage = self.open_doc.file.storage

    def request(self, doc):
        client = APIClient(raise_request_exception=False)  # a server error must be an answer here, not an exception in the test
        client.force_authenticate(user=self.manager)
        return client.delete(f"/api/documents/{doc.pk}/")

    def stored_deletions(self):
        """Patch the storage so every deletion is counted (and still performed)."""
        calls, real = [], FileSystemStorage.delete

        def counting(storage, name):
            calls.append(name)
            return real(storage, name)

        return calls, mock.patch.object(FileSystemStorage, "delete", counting)

    def test_a_closed_deals_document_is_refused_without_touching_the_storage(self):
        calls, patch = self.stored_deletions()
        with patch, self.captureOnCommitCallbacks(execute=True) as callbacks:
            response = self.request(self.closed_doc)
        self.assertEqual(response.status_code, 400)
        self.assertIn(MESSAGE, response.content.decode())
        self.assertEqual((calls, len(callbacks)), ([], 0), "storage.delete was never called and no deletion was even scheduled")
        self.assertTrue(self.storage.exists(self.closed_doc.file.name))
        self.assertTrue(Document.objects.filter(pk=self.closed_doc.pk).exists())

    def test_a_failure_while_deleting_the_row_keeps_the_file(self):
        calls, patch = self.stored_deletions()
        with patch, self.captureOnCommitCallbacks(execute=True) as callbacks:
            with mock.patch.object(Document, "delete", side_effect=RuntimeError("database failure")):
                response = self.request(self.open_doc)
        self.assertEqual(response.status_code, 500)
        self.assertEqual((calls, len(callbacks)), ([], 0))
        self.assertTrue(Document.objects.filter(pk=self.open_doc.pk).exists())
        self.assertTrue(self.storage.exists(self.open_doc.file.name), "a document is never left pointing at a deleted file")

    def test_a_normal_deletion_removes_the_row_first_and_the_file_only_after_the_commit(self):
        name = self.open_doc.file.name
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            response = self.request(self.open_doc)
            self.assertEqual(response.status_code, 204)
            self.assertFalse(Document.objects.filter(pk=self.open_doc.pk).exists(), "the row is already gone")
            self.assertTrue(self.storage.exists(name), "the file is still there: the transaction has not committed yet")
        self.assertEqual(len(callbacks), 1, "exactly one deletion of the file is scheduled for the commit")
        callbacks[0]()  # the commit happens
        self.assertFalse(self.storage.exists(name))

    def test_a_storage_failure_after_the_commit_is_logged_and_does_not_bring_the_row_back_or_fail_the_request(self):
        name = self.open_doc.file.name
        with mock.patch.object(FileSystemStorage, "delete", side_effect=OSError("storage unavailable")):
            with self.assertLogs("crm.documents", level="ERROR") as logged, self.captureOnCommitCallbacks(execute=True):
                response = self.request(self.open_doc)
        self.assertEqual(response.status_code, 204, "the user is not told about a leftover file")
        self.assertFalse(Document.objects.filter(pk=self.open_doc.pk).exists())
        self.assertTrue(self.storage.exists(name), "an orphan file remains (harmless), never the other way round")
        self.assertIn(name, "\n".join(logged.output), "the log names the file so it can be swept")

    def test_the_permissions_to_delete_a_document_did_not_change(self):
        other = self.deal(self.sales_b, stage=Deal.Stage.NEGOTIATION)
        doc = self.document(other, self.sales_b)
        self.assertIn(self.as_user(self.sales_a).delete(f"/api/documents/{doc.pk}/").status_code, (403, 404), "not your deal")
        self.assertTrue(Document.objects.filter(pk=doc.pk).exists())
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.as_user(self.sales_b).delete(f"/api/documents/{doc.pk}/").status_code, 204)


class DocumentFileCommitTests(TransactionTestCase):
    """With real commits (no test wrapper): the file is removed once the request has committed, and not before."""

    def test_the_file_is_removed_after_a_real_commit(self):
        manager = make_user("m-file@t.test", Role.MANAGER)
        prop = Property.objects.create(title="F", address="a", city="c", price=Decimal("1"))
        lead = Lead.objects.create(first_name="F", last_name="x", phone="0100000000", assigned_to=manager)
        deal = Deal.objects.create(lead=lead, property=prop, assigned_to=manager, stage=Deal.Stage.NEGOTIATION)
        with tempfile.TemporaryDirectory() as media, override_settings(MEDIA_ROOT=media):
            doc = document_services.create_document(deal, "contract", SimpleUploadedFile("c.pdf", b"%PDF-1.4 x", "application/pdf"), manager)
            storage, name = doc.file.storage, doc.file.name
            self.assertTrue(storage.exists(name))
            client = APIClient(raise_request_exception=False)
            client.force_authenticate(user=manager)
            self.assertEqual(client.delete(f"/api/documents/{doc.pk}/").status_code, 204)
            self.assertFalse(Document.objects.filter(pk=doc.pk).exists())
            self.assertFalse(storage.exists(name), "removed after the commit")


class OrmDeletionVsClosingTests(TransactionTestCase):
    """Deleting through the ORM (what the Django admin and any script do) while a deal of the same property is being closed. The closing holds
    the property row and then wants a deal; the deletion used to lock the deals first and delete the property row afterwards, so the two waited
    on each other (PostgreSQL: "deadlock detected", the closing got a 500). The guard now locks property, then deal, like the closing does."""

    def setUp(self):
        self.manager = make_user("m-orm@t.test", Role.MANAGER)
        self.sales = make_user("s-orm@t.test", Role.SALESPERSON)
        self.prop_ = Property.objects.create(title="Orm flat", address="a", city="c", price=Decimal("1000000"))
        self.leads = [Lead.objects.create(first_name=f"L{i}", last_name="x", phone="0100000000", assigned_to=self.sales) for i in range(2)]
        self.deals = [
            Deal.objects.create(lead=l, property=self.prop_, assigned_to=self.sales, stage=Deal.Stage.NEGOTIATION, offer_amount=Decimal("900000"))
            for l in self.leads
        ]

    def close(self, deal):
        try:
            client = APIClient(raise_request_exception=False)
            client.force_authenticate(user=User.objects.get(pk=self.manager.pk))
            return client.post(f"/api/deals/{deal.pk}/move/", {"stage": "closed"}, format="json").status_code
        finally:
            connections.close_all()

    def race_orm_deletion(self, delete, last_deal):
        """Run `delete` (an ORM deletion); pause it right after its guard has locked `last_deal`, start a closing of `last_deal`, let it queue,
        then let the deletion go on. Returns what the deletion and the closing answered."""
        inside, release, out = threading.Event(), threading.Event(), {}
        original = protection.refuse_closed_deal_deletion

        def guard(deal, using):
            original(deal, using)
            if deal.pk == last_deal.pk:  # the last deal of the cascade is locked; the property row is deleted next
                inside.set()
                release.wait(timeout=8)

        def deleter():
            try:
                delete()
                out["deletion"] = "ok"
            except Exception as e:  # noqa: BLE001
                out["deletion"] = f"{type(e).__name__}: {e}"[:160]
            finally:
                connections.close_all()

        def closer():
            out["closing"] = self.close(last_deal)

        with mock.patch.object(protection, "refuse_closed_deal_deletion", guard):
            t1 = threading.Thread(target=deleter)
            t1.start()
            self.assertTrue(inside.wait(timeout=8), "the deletion reached the pause point")
            t2 = threading.Thread(target=closer)
            t2.start()
            self.assertTrue(wait_for_a_lock_waiter(), "the closing is queued on a lock")
            release.set()
            t1.join(timeout=15)
            t2.join(timeout=15)
        return out

    def assert_clean(self, out):
        self.assertEqual(out["deletion"], "ok", out)
        self.assertIn(out["closing"], (400, 404), f"the closing is told the deal is gone, not a server error (deadlock): {out}")
        self.assertFalse(Commission.objects.exists(), "no commission without its deal")

    def test_property_delete_against_a_closing_does_not_deadlock(self):
        out = self.race_orm_deletion(lambda: Property.objects.get(pk=self.prop_.pk).delete(), self.deals[1])
        self.assert_clean(out)
        self.assertFalse(Property.objects.filter(pk=self.prop_.pk).exists() or Deal.objects.exists())

    def test_lead_delete_against_a_closing_does_not_deadlock(self):
        out = self.race_orm_deletion(lambda: Lead.objects.get(pk=self.leads[1].pk).delete(), self.deals[1])
        self.assert_clean(out)
        self.assertFalse(Lead.objects.filter(pk=self.leads[1].pk).exists())
        self.assertTrue(Deal.objects.filter(pk=self.deals[0].pk).exists(), "the other lead's deal is untouched")

    def test_deleting_several_deals_with_a_queryset_against_a_closing_does_not_deadlock(self):
        out = self.race_orm_deletion(lambda: Deal.objects.filter(property=self.prop_).delete(), self.deals[1])
        self.assert_clean(out)
        self.assertFalse(Deal.objects.exists())
        self.assertTrue(Property.objects.filter(pk=self.prop_.pk).exists(), "only the deals were deleted")

    def test_a_closing_that_finishes_first_makes_the_orm_deletion_refuse(self):
        self.assertEqual(self.close(self.deals[1]), 200)
        for delete in (lambda: Property.objects.get(pk=self.prop_.pk).delete(), lambda: Lead.objects.get(pk=self.leads[1].pk).delete(),
                       lambda: Deal.objects.filter(property=self.prop_).delete()):
            with self.assertRaises(ProtectedError), transaction.atomic():
                delete()
        self.assertTrue(Deal.objects.filter(pk=self.deals[1].pk, stage="closed").exists())
        self.assertTrue(Deal.objects.filter(pk=self.deals[0].pk).exists(), "nothing was deleted, not even the open deal")

    def test_the_collector_hands_the_deals_to_the_guard_in_id_order(self):
        seen = []
        recorder = lambda sender, instance, **kw: seen.append(instance.pk)  # noqa: E731
        pre_delete.connect(recorder, sender=Deal, weak=False, dispatch_uid="order-recorder")
        try:
            Property.objects.get(pk=self.prop_.pk).delete()
        finally:
            pre_delete.disconnect(sender=Deal, dispatch_uid="order-recorder")
        self.assertEqual(seen, sorted(seen))
        self.assertEqual(len(seen), 2)

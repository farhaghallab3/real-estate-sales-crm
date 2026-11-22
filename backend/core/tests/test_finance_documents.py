"""Commissions (money) and documents (contracts, IDs): the two places where a wrong role does the most damage."""
from django.core.files.uploadedfile import SimpleUploadedFile

from commissions.models import Commission
from documents.models import Document

from .base import ApiTestCase, ids


class CommissionPermissionTests(ApiTestCase):
    def setUp(self):
        _, self.commission = self.closed_deal_with_commission(self.sales_a)

    def _status(self):
        return Commission.objects.get(pk=self.commission.pk).status

    def test_salesperson_cannot_approve_pay_or_edit_terms_even_on_their_own_commission(self):
        client = self.as_user(self.sales_a)
        responses = [
            client.post(f"/api/commissions/{self.commission.pk}/approve/"),
            client.post(f"/api/commissions/{self.commission.pk}/mark-paid/"),
            client.patch(f"/api/commissions/{self.commission.pk}/terms/", {"deductions": "0"}, format="json"),
        ]
        for response in responses:
            self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(self._status(), Commission.Status.PENDING)

    def test_salesperson_cannot_act_on_someone_elses_commission(self):
        client = self.as_user(self.sales_b)
        for action in ("approve", "mark-paid"):
            self.assertIn(client.post(f"/api/commissions/{self.commission.pk}/{action}/").status_code, (403, 404))
        self.assertEqual(self._status(), Commission.Status.PENDING)

    def test_admin_can_approve_then_pay(self):
        client = self.as_user(self.admin)
        self.assertEqual(client.post(f"/api/commissions/{self.commission.pk}/approve/").status_code, 200)
        self.assertEqual(client.post(f"/api/commissions/{self.commission.pk}/mark-paid/").status_code, 200)

    def test_manager_can_follow_commission_status_read_only(self):
        client = self.as_user(self.manager)
        self.assertIn(self.commission.pk, ids(client.get("/api/commissions/")))
        self.assertEqual(client.get(f"/api/commissions/{self.commission.pk}/").status_code, 200)
        self.assertEqual(client.get("/api/commissions/summary/").status_code, 200)

    def test_manager_cannot_approve_pay_or_edit_commission_terms(self):
        client = self.as_user(self.manager)
        responses = [
            client.post(f"/api/commissions/{self.commission.pk}/approve/"),
            client.post(f"/api/commissions/{self.commission.pk}/mark-paid/"),
            client.patch(f"/api/commissions/{self.commission.pk}/terms/", {"deductions": "0"}, format="json"),
        ]
        for response in responses:
            self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(self._status(), Commission.Status.PENDING)

    def test_salesperson_cannot_create_edit_or_delete_commission_records_directly(self):
        client = self.as_user(self.sales_a)
        self.assertEqual(client.post("/api/commissions/", {}, format="json").status_code, 405)
        self.assertEqual(client.put(f"/api/commissions/{self.commission.pk}/", {}, format="json").status_code, 405)
        self.assertEqual(client.delete(f"/api/commissions/{self.commission.pk}/").status_code, 405)

    def test_commission_summary_only_counts_the_callers_own_money_for_a_salesperson(self):
        self.closed_deal_with_commission(self.sales_b)
        own = self.as_user(self.sales_a).get("/api/commissions/summary/").json()
        everyone = self.as_user(self.manager).get("/api/commissions/summary/").json()
        self.assertLess(float(own["pending"]["net"]), float(everyone["pending"]["net"]))


class DocumentPermissionTests(ApiTestCase):
    def setUp(self):
        self.deal_a = self.deal(self.sales_a)
        self.deal_b = self.deal(self.sales_b)

    def upload(self, actor, deal, name="id.pdf", content=b"%PDF-1.4 test"):
        return self.as_user(actor).post(
            "/api/documents/",
            {"deal": deal.pk, "category": "identification", "file": SimpleUploadedFile(name, content, "application/pdf")},
            format="multipart",
        )

    def test_salesperson_can_upload_to_their_own_deal_only(self):
        self.assertEqual(self.upload(self.sales_a, self.deal_a).status_code, 201)
        self.assertDenied(self.upload(self.sales_a, self.deal_b))
        self.assertFalse(Document.objects.filter(deal=self.deal_b).exists())

    def test_manager_and_admin_can_upload_to_any_deal(self):
        for actor in (self.manager, self.admin):
            self.assertEqual(self.upload(actor, self.deal_a).status_code, 201)

    def test_dangerous_or_empty_files_are_refused(self):
        for name, content in (("run.exe", b"MZ"), ("page.html", b"<script>"), ("empty.pdf", b"")):
            with self.subTest(name=name):
                self.assertDenied(self.upload(self.sales_a, self.deal_a, name, content))

    def test_documents_are_deletable_only_by_their_uploader_or_a_manager(self):
        uploaded_by_manager = self.document(self.deal_a, self.manager, "from-manager.pdf")
        own = self.document(self.deal_a, self.sales_a, "own.pdf")
        # sales_a owns the deal but did not upload the manager's document
        self.assertDenied(self.as_user(self.sales_a).delete(f"/api/documents/{uploaded_by_manager.pk}/"))
        self.assertTrue(Document.objects.filter(pk=uploaded_by_manager.pk).exists())
        self.assertEqual(self.as_user(self.sales_a).delete(f"/api/documents/{own.pk}/").status_code, 204)
        self.assertEqual(self.as_user(self.manager).delete(f"/api/documents/{uploaded_by_manager.pk}/").status_code, 204)

    def test_salesperson_cannot_see_or_delete_documents_on_other_deals(self):
        theirs = self.document(self.deal_b, self.sales_b)
        self.assertNotIn(theirs.pk, ids(self.as_user(self.sales_a).get("/api/documents/")))
        self.assertEqual(self.as_user(self.sales_a).delete(f"/api/documents/{theirs.pk}/").status_code, 404)
        self.assertTrue(Document.objects.filter(pk=theirs.pk).exists())

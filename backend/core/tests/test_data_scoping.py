"""Who can see which records. Salespeople see only their own; managers and admins see the whole company."""
from notifications.models import Notification

from .base import ApiTestCase, ids, results


class DataScopingTests(ApiTestCase):
    def setUp(self):
        # Everything exists once for sales_a and once for sales_b.
        self.lead_a, self.lead_b = self.lead(self.sales_a), self.lead(self.sales_b)
        self.deal_a = self.deal(self.sales_a, lead=self.lead_a)
        self.deal_b = self.deal(self.sales_b, lead=self.lead_b)
        self.task_a, self.task_b = self.task(self.sales_a), self.task(self.sales_b)
        self.viewing_a, self.viewing_b = self.viewing(self.sales_a), self.viewing(self.sales_b)
        _, self.commission_a = self.closed_deal_with_commission(self.sales_a)
        _, self.commission_b = self.closed_deal_with_commission(self.sales_b)
        self.doc_a = self.document(self.deal_a, self.sales_a)
        self.doc_b = self.document(self.deal_b, self.sales_b)

    def resources(self):
        return {
            "leads": (self.lead_a, self.lead_b),
            "deals": (self.deal_a, self.deal_b),
            "tasks": (self.task_a, self.task_b),
            "viewings": (self.viewing_a, self.viewing_b),
            "commissions": (self.commission_a, self.commission_b),
            "documents": (self.doc_a, self.doc_b),
        }

    def test_salesperson_lists_only_their_own_records(self):
        client = self.as_user(self.sales_a)
        for name, (mine, theirs) in self.resources().items():
            with self.subTest(resource=name):
                listed = ids(client.get(f"/api/{name}/"))
                self.assertIn(mine.pk, listed)
                self.assertNotIn(theirs.pk, listed)

    def test_salesperson_cannot_open_change_or_delete_someone_elses_record(self):
        client = self.as_user(self.sales_a)
        for name, (_, theirs) in self.resources().items():
            with self.subTest(resource=name):
                self.assertEqual(client.get(f"/api/{name}/{theirs.pk}/").status_code, 404)
                self.assertIn(client.patch(f"/api/{name}/{theirs.pk}/", {}, format="json").status_code, (404, 405))
                self.assertIn(client.delete(f"/api/{name}/{theirs.pk}/").status_code, (403, 404, 405))
        # and nothing was removed
        for name, (_, theirs) in self.resources().items():
            self.assertTrue(type(theirs).objects.filter(pk=theirs.pk).exists(), name)

    def test_managers_and_admins_see_every_record(self):
        for actor in (self.manager, self.admin):
            client = self.as_user(actor)
            for name, (a, b) in self.resources().items():
                with self.subTest(actor=actor.role, resource=name):
                    self.assertTrue({a.pk, b.pk} <= ids(client.get(f"/api/{name}/")))

    def test_search_and_filters_cannot_reveal_another_salespersons_records(self):
        client = self.as_user(self.sales_a)
        self.assertEqual(results(client.get("/api/leads/", {"search": self.lead_b.last_name})), [])
        self.assertNotIn(self.lead_b.pk, ids(client.get("/api/leads/", {"assigned_to": self.sales_b.pk})))
        self.assertNotIn(self.deal_b.pk, ids(client.get("/api/deals/", {"assigned_to": self.sales_b.pk})))

    def test_documents_cannot_be_downloaded_across_salespeople(self):
        self.assertEqual(self.as_user(self.sales_a).get(f"/api/documents/{self.doc_a.pk}/download/").status_code, 200)
        self.assertEqual(self.as_user(self.sales_a).get(f"/api/documents/{self.doc_b.pk}/download/").status_code, 404)
        self.assertEqual(self.as_user(self.manager).get(f"/api/documents/{self.doc_b.pk}/download/").status_code, 200)

    def test_pipeline_board_contains_only_own_deals_for_a_salesperson(self):
        board = self.as_user(self.sales_a).get("/api/deals/pipeline/").json()
        shown = {card["id"] for column in board["columns"] for card in column["deals"]}
        self.assertIn(self.deal_a.pk, shown)
        self.assertNotIn(self.deal_b.pk, shown)

    def test_notifications_are_private_to_their_owner(self):
        kind = Notification._meta.get_field("kind").choices[0][0]
        mine = Notification.objects.create(user=self.sales_a, kind=kind, title="mine")
        theirs = Notification.objects.create(user=self.sales_b, kind=kind, title="theirs")
        for actor in (self.sales_a, self.manager, self.admin):
            with self.subTest(actor=actor.role):
                listed = ids(self.as_user(actor).get("/api/notifications/")) & {mine.pk, theirs.pk}
                self.assertEqual(listed, {mine.pk} if actor == self.sales_a else set())
        self.assertEqual(self.as_user(self.sales_a).get(f"/api/notifications/{theirs.pk}/").status_code, 404)

    def test_dashboard_scope_is_personal_for_salespeople_and_team_for_managers(self):
        personal = self.as_user(self.sales_a).get("/api/dashboard/").json()
        self.assertEqual((personal["scope"], personal["team"]), ("personal", []))
        for actor in (self.manager, self.admin):
            self.assertEqual(self.as_user(actor).get("/api/dashboard/").json()["scope"], "team")

    def test_analytics_salesperson_filter_cannot_widen_a_salespersons_scope(self):
        spoofed = self.as_user(self.sales_a).get("/api/analytics/summary/", {"salesperson": self.sales_b.pk}).json()
        nobody = self.as_user(self.sales_a).get("/api/analytics/summary/", {"salesperson": 999999}).json()
        as_manager = self.as_user(self.manager).get("/api/analytics/summary/", {"salesperson": self.sales_b.pk}).json()
        self.assertEqual(spoofed["metrics"], nobody["metrics"], "a salesperson asking for someone else's numbers got data")
        self.assertNotEqual(as_manager["metrics"], nobody["metrics"], "control: a manager does see that salesperson's data")
        self.assertEqual({row["id"] for row in spoofed["team"]} - {self.sales_a.pk}, set())

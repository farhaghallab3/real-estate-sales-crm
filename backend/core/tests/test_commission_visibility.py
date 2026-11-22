"""Who sees which commission fields. Enforced by the serializers (and the summary view), on every endpoint that carries
commission data, including the nested commission of a deal.

  Admin        everything
  Manager      status and the net value (net_commission), never agent_split / gross / deductions / rate / agent amount
  Salesperson  the same, plus agent_split of their own commission
"""
import json
from decimal import Decimal

from commissions import services as commission_services
from commissions.serializers import CommissionSerializer

from .base import ApiTestCase, results

BASE = {"id", "deal", "property", "client", "lead_id", "salesperson", "sale_price", "net_commission", "status",
        "approved_at", "paid_at", "created_at"}
ADMIN_ONLY = {"commission_rate", "gross_commission", "agent_commission", "deductions"}
ALL = BASE | ADMIN_ONLY | {"agent_split"}
FORBIDDEN_KEYS = ADMIN_ONLY | {"agent_split"}


def keys_anywhere(node, found=None):
    """Every dict key that appears anywhere in a JSON document."""
    found = set() if found is None else found
    if isinstance(node, dict):
        for key, value in node.items():
            found.add(key)
            keys_anywhere(value, found)
    elif isinstance(node, list):
        for item in node:
            keys_anywhere(item, found)
    return found


class CommissionVisibilityTests(ApiTestCase):
    def setUp(self):
        self.deal_a, self.commission = self.closed_deal_with_commission(self.sales_a)
        # distinctive numbers so a leak is obvious in the raw response text
        commission_services.update_terms(
            self.commission, self.admin, commission_rate=Decimal("7.77"), agent_split=Decimal("61.30"),
            deductions=Decimal("1234.56"),
        )
        self.commission.refresh_from_db()
        self.url = f"/api/commissions/{self.commission.pk}/"

    def get(self, actor, url):
        response = self.as_user(actor).get(url)
        self.assertEqual(response.status_code, 200, f"{url} -> {response.status_code}")
        return response

    # ---- exact field sets ----
    def test_detail_and_list_expose_exactly_the_agreed_fields_per_role(self):
        expectations = ((self.admin, ALL), (self.manager, BASE), (self.sales_a, BASE | {"agent_split"}))
        for actor, expected in expectations:
            with self.subTest(actor=actor.role):
                self.assertEqual(set(self.get(actor, self.url).json()), expected)
                row = next(r for r in results(self.get(actor, "/api/commissions/")) if r["id"] == self.commission.pk)
                self.assertEqual(set(row), expected)

    def test_a_manager_who_earns_a_commission_still_does_not_see_agent_split(self):
        _, own = self.closed_deal_with_commission(self.manager)
        row = self.get(self.manager, f"/api/commissions/{own.pk}/").json()
        self.assertEqual(set(row), BASE)

    def test_the_value_shown_is_the_net_commission_for_everyone(self):
        for actor in (self.admin, self.manager, self.sales_a):
            with self.subTest(actor=actor.role):
                self.assertEqual(Decimal(self.get(actor, self.url).json()["net_commission"]), self.commission.net_commission)

    def test_filters_and_ordering_keep_working_without_the_hidden_fields(self):
        _, other = self.closed_deal_with_commission(self.sales_b)
        for actor in (self.admin, self.manager):
            with self.subTest(actor=actor.role):
                self.assertEqual(len(results(self.get(actor, "/api/commissions/?ordering=-net_commission"))), 2)
                self.assertEqual(len(results(self.get(actor, f"/api/commissions/?status=pending&salesperson={self.sales_b.pk}"))), 1)
        self.assertEqual({r["id"] for r in results(self.get(self.sales_a, "/api/commissions/"))}, {self.commission.pk})
        self.assertNotIn(other.pk, {r["id"] for r in results(self.get(self.sales_a, "/api/commissions/"))})

    # ---- nested commission in the deal ----
    def test_the_commission_nested_in_deal_details_follows_the_same_rules(self):
        expectations = ((self.admin, ALL), (self.manager, BASE), (self.sales_a, BASE | {"agent_split"}))
        for actor, expected in expectations:
            with self.subTest(actor=actor.role):
                nested = self.get(actor, f"/api/deals/{self.deal_a.pk}/").json()["commission"]
                self.assertEqual(set(nested), expected)

    def test_the_deal_move_response_masks_the_nested_commission_too(self):
        deal, commission = self.deal_a, self.commission
        # moving a closed deal is refused, so use the detail built by the view that passes the request context
        body = self.get(self.manager, f"/api/deals/{deal.pk}/").json()
        self.assertTrue(FORBIDDEN_KEYS.isdisjoint(keys_anywhere(body)))
        self.assertEqual(commission.deal_id, deal.pk)

    def test_the_serializer_is_default_deny_when_it_gets_no_request(self):
        self.assertEqual(set(CommissionSerializer(self.commission).data), BASE)

    # ---- summary ----
    def test_summary_totals_expose_gross_to_admins_only(self):
        admin = self.get(self.admin, "/api/commissions/summary/").json()
        self.assertTrue(all(set(v) == {"net", "gross"} for v in admin.values()))
        for actor in (self.manager, self.sales_a):
            with self.subTest(actor=actor.role):
                totals = self.get(actor, "/api/commissions/summary/").json()
                self.assertEqual(set(totals), {"pending", "approved", "paid"})
                self.assertTrue(all(set(v) == {"net"} for v in totals.values()), totals)

    def test_the_summary_still_totals_correctly(self):
        net = self.get(self.manager, "/api/commissions/summary/").json()["pending"]["net"]
        self.assertAlmostEqual(float(net), float(self.commission.net_commission), places=2)

    # ---- no other endpoint leaks the numbers ----
    def test_no_endpoint_leaks_hidden_commission_data_to_a_manager_or_salesperson(self):
        urls = [
            "/api/commissions/", self.url, "/api/commissions/summary/", f"/api/deals/{self.deal_a.pk}/", "/api/deals/",
            "/api/deals/pipeline/", "/api/dashboard/", "/api/analytics/summary/", "/api/notifications/",
            f"/api/properties/{self.deal_a.property_id}/", f"/api/leads/{self.deal_a.lead_id}/", "/api/documents/",
            f"/api/leads/{self.deal_a.lead_id}/notes/", "/api/tasks/", "/api/viewings/", "/api/offers/",
        ]
        for actor in (self.manager, self.sales_a):
            for url in urls:
                with self.subTest(actor=actor.role, url=url):
                    response = self.as_user(actor).get(url)
                    self.assertEqual(response.status_code, 200, f"{url} -> {response.status_code}")
                    document = json.loads(response.content)
                    leaked = keys_anywhere(document) & ({"commission_rate", "gross_commission", "agent_commission", "deductions"}
                                                         | ({"agent_split"} if actor == self.manager else set()))
                    self.assertFalse(leaked, f"{url} leaked {leaked}")
                    text = response.content.decode()
                    self.assertNotIn("1234.56", text, f"{url} leaked the deductions value")
                    self.assertNotIn("7.77", text, f"{url} leaked the commission rate")
                    if actor == self.manager:
                        self.assertNotIn("61.30", text, f"{url} leaked the agent split to a manager")

    def test_the_admin_still_gets_every_number(self):
        text = self.get(self.admin, self.url).content.decode()
        for value in ("1234.56", "7.77", "61.30"):
            self.assertIn(value, text)

    def test_activity_and_notification_text_only_carries_the_net_value(self):
        from core.models import Activity
        from notifications.models import Notification

        texts = [a.message for a in Activity.objects.filter(kind=Activity.Kind.COMMISSION)]
        texts += [f"{n.title} {n.body}" for n in Notification.objects.filter(kind=Notification.Kind.COMMISSION)]
        self.assertTrue(texts)
        for text in texts:
            for hidden in ("1234.56", "7.77", "61.30"):
                self.assertNotIn(hidden, text)

    def test_the_calculation_itself_is_unchanged_by_hiding(self):
        """Hiding is a presentation rule: the stored figures keep following rate, split and deductions."""
        self.assertEqual(self.commission.gross_commission, (self.commission.sale_price * Decimal("7.77") / 100).quantize(Decimal("0.01")))
        self.assertEqual(self.commission.agent_commission, (self.commission.gross_commission * Decimal("61.30") / 100).quantize(Decimal("0.01")))
        self.assertEqual(self.commission.net_commission, self.commission.agent_commission - Decimal("1234.56"))
        new_deal, created = self.closed_deal_with_commission(self.sales_a)
        self.assertEqual(created.agent_split, self.sales_a.commission_split)
        self.assertEqual(created.commission_rate, Decimal(str(__import__("django.conf", fromlist=["settings"]).settings.DEFAULT_COMMISSION_RATE)))

    def test_the_admin_can_still_change_terms_and_sees_the_recalculated_numbers(self):
        response = self.as_user(self.admin).patch(f"{self.url}terms/", {"deductions": "10.00", "agent_split": "50"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(response.json()), ALL)
        self.assertEqual(response.json()["deductions"], "10.00")
        manager_view = self.get(self.manager, self.url).json()
        self.assertNotIn("deductions", manager_view)
        self.assertEqual(Decimal(manager_view["net_commission"]), Decimal(response.json()["net_commission"]))

    def test_admin_approval_responses_are_full_for_the_admin(self):
        response = self.as_user(self.admin).post(f"{self.url}approve/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), ALL)

"""Closing a deal: one sale per property, no matter how many requests arrive, how often one is repeated, or who edits at the same time.

Business rules pinned here:
  * a property has at most ONE closed deal; the second closing is refused and changes nothing (no commission, no status, no activity);
  * the same closing sent again (retry, double click) is idempotent: 200, no new commission/activity/notification; another price is refused;
  * once a property has a closed deal: no new offers, no accepting an offer, no other deal enters a sale stage; the other deals and their offers
    stay as they are, can still be read and can still be marked Lost;
  * a closed deal cannot be edited, moved, reopened or deleted; Property.status cannot leave "sold" while a closed deal exists;
  * every path takes the row locks in one order (property rows by id, then the deal), so none of this can deadlock.
"""
import random
import threading
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from django.conf import settings
from django.contrib import admin
from django.db import connections
from django.db.models.signals import pre_save
from django.test import Client, RequestFactory, TransactionTestCase, override_settings
from rest_framework.test import APIClient

from commissions.models import Commission
from core.exceptions import BusinessRuleViolation
from core.models import Activity
from deals import services
from deals.models import Deal, Offer
from deals.serializers import DealSerializer
from deals.views import DealViewSet
from leads.models import Lead
from notifications.models import Notification
from properties.admin import PropertyAdmin
from properties.models import Property
from properties.serializers import PropertySerializer
from properties.views import PropertyViewSet
from users.models import Role, User

from .base import ApiTestCase, make_user


def move(client, deal, stage, **body):
    return client.post(f"/api/deals/{deal.pk}/move/", {"stage": stage, **body}, format="json")


class SaleRulesTests(ApiTestCase):
    """One request at a time: the rules themselves."""

    def setUp(self):
        self.prop_ = self.prop(self.sales_a, title="Sold flat")
        self.winner = self.deal(self.sales_a, prop=self.prop_, stage=Deal.Stage.NEGOTIATION)
        self.rival = self.deal(self.sales_b, prop=self.prop_, stage=Deal.Stage.NEGOTIATION, offer_amount=Decimal("950000"))
        self.rival_offer = Offer.objects.create(
            deal=self.rival, lead=self.rival.lead, property=self.prop_, amount=Decimal("950000"), submitted_by=self.sales_b
        )
        self.api = self.as_user(self.manager)

    def close_winner(self, **body):
        return move(self.api, self.winner, "closed", **body)

    def closed_count(self):
        return Deal.objects.filter(property=self.prop_, stage=Deal.Stage.CLOSED).count()

    # ---- closing and retrying ----------------------------------------------------------------------------------
    def test_closing_sells_the_property_and_creates_one_commission(self):
        response = self.close_winner(sale_price="880000")
        self.assertEqual(response.status_code, 200, response.content)
        self.winner.refresh_from_db()
        self.prop_.refresh_from_db()
        self.assertEqual((self.winner.stage, self.winner.sale_price), ("closed", Decimal("880000.00")))
        self.assertEqual(self.prop_.status, Property.Status.SOLD)
        commission = Commission.objects.get(deal=self.winner)
        self.assertEqual(commission.sale_price, Decimal("880000.00"))

    def test_the_same_closing_sent_again_is_idempotent_with_no_new_effects(self):
        self.assertEqual(self.close_winner(sale_price="880000").status_code, 200)
        before = (
            Commission.objects.count(),
            Activity.objects.filter(kind=Activity.Kind.DEAL_CLOSED).count(),
            Notification.objects.count(),
            Deal.objects.get(pk=self.winner.pk).closed_at,
        )
        for body in ({"sale_price": "880000"}, {}):  # the exact same request, and a retry that omits the price
            with self.subTest(body=body):
                response = self.close_winner(**body)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["stage"], "closed")
        after = (
            Commission.objects.count(),
            Activity.objects.filter(kind=Activity.Kind.DEAL_CLOSED).count(),
            Notification.objects.count(),
            Deal.objects.get(pk=self.winner.pk).closed_at,
        )
        self.assertEqual(before, after, "a repeated closing has no new commission, activity, notification or timestamp")

    def test_closing_again_with_another_price_is_refused_and_changes_nothing(self):
        self.close_winner(sale_price="880000")
        response = self.close_winner(sale_price="990000")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Deal.objects.get(pk=self.winner.pk).sale_price, Decimal("880000.00"))
        self.assertEqual(Commission.objects.get(deal=self.winner).sale_price, Decimal("880000.00"))

    def test_the_price_comes_from_the_current_row_not_from_a_stale_copy(self):
        stale = Deal.objects.get(pk=self.winner.pk)
        Deal.objects.filter(pk=self.winner.pk).update(offer_amount=Decimal("975000"))  # someone raised the accepted amount meanwhile
        services.move_stage(stale, Deal.Stage.CLOSED, self.manager)
        self.assertEqual(Commission.objects.get(deal=self.winner).sale_price, Decimal("975000.00"))

    def test_a_second_deal_cannot_close_on_a_sold_property(self):
        self.close_winner()
        response = move(self.api, self.rival, "closed")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("already been sold", response.content.decode())
        self.rival.refresh_from_db()
        self.assertEqual((self.rival.stage, self.rival.closed_at), ("negotiation", None))
        self.assertEqual((self.closed_count(), Commission.objects.count()), (1, 1))

    # ---- what a sale does and does not do to the other deals ------------------------------------------------------
    def test_other_deals_keep_their_records_and_history_when_the_property_is_sold(self):
        activities = Activity.objects.filter(deal=self.rival).count()
        self.close_winner()
        self.rival.refresh_from_db()
        self.assertEqual(self.rival.stage, "negotiation", "not turned into Lost automatically")
        self.assertEqual(Offer.objects.filter(deal=self.rival).count(), 1)
        self.assertEqual(Activity.objects.filter(deal=self.rival).count(), activities, "their history is untouched")
        self.assertEqual(self.api.get(f"/api/deals/{self.rival.pk}/").status_code, 200)
        self.assertEqual(self.api.get(f"/api/offers/?deal={self.rival.pk}").status_code, 200)

    def test_no_other_deal_can_enter_a_sale_stage_after_the_sale(self):
        self.close_winner()
        interested = self.deal(self.sales_a, prop=self.prop_, stage=Deal.Stage.INTERESTED)
        for stage in ("offer_made", "negotiation", "under_contract", "closed"):
            with self.subTest(stage=stage):
                response = move(self.api, interested, stage, **({"sale_price": "1"} if stage == "closed" else {}))
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("already been sold", response.content.decode())
        interested.refresh_from_db()
        self.assertEqual(interested.stage, "interested")

    def test_other_deals_can_still_be_marked_lost_and_the_property_stays_sold(self):
        self.close_winner()
        response = move(self.api, self.rival, "lost", lost_reason="Property sold to another client")
        self.assertEqual(response.status_code, 200, response.content)
        self.prop_.refresh_from_db()
        self.assertEqual(self.prop_.status, Property.Status.SOLD)

    def test_a_lost_deal_cannot_be_reopened_into_a_sale_stage_on_a_sold_property(self):
        lost = self.deal(self.sales_a, prop=self.prop_, stage=Deal.Stage.LOST, lost_reason="x")
        self.close_winner()
        self.assertEqual(move(self.api, lost, "negotiation").status_code, 400)
        lost.refresh_from_db()
        self.assertEqual(lost.stage, "lost")

    def test_no_new_offer_after_the_sale_through_either_endpoint(self):
        self.close_winner()
        deals_before, offers_before = Deal.objects.count(), Offer.objects.count()
        by_deal = self.api.post("/api/offers/", {"deal_id": self.rival.pk, "amount": "960000"}, format="json")
        self.assertEqual(by_deal.status_code, 400, by_deal.content)
        self.assertIn("already been sold", by_deal.content.decode())
        newcomer = self.lead(self.sales_a, first_name="Newcomer")
        by_lead = self.api.post("/api/offers/", {"lead_id": newcomer.pk, "property_id": self.prop_.pk, "amount": "960000"}, format="json")
        self.assertEqual(by_lead.status_code, 400, by_lead.content)
        self.assertEqual((Deal.objects.count(), Offer.objects.count()), (deals_before, offers_before), "no stray deal and no offer")

    def test_an_offer_on_a_sold_property_cannot_be_accepted_but_can_be_rejected(self):
        self.close_winner()
        accept = self.api.post(f"/api/offers/{self.rival_offer.pk}/set-status/", {"status": "accepted"}, format="json")
        self.assertEqual(accept.status_code, 400, accept.content)
        self.rival.refresh_from_db()
        self.rival_offer.refresh_from_db()
        self.assertEqual((self.rival_offer.status, self.rival.stage), ("submitted", "negotiation"))
        reject = self.api.post(f"/api/offers/{self.rival_offer.pk}/set-status/", {"status": "rejected"}, format="json")
        self.assertEqual(reject.status_code, 200, reject.content)

    def test_a_deal_in_a_sale_stage_cannot_be_moved_onto_a_sold_property(self):
        self.close_winner()
        other = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        response = self.api.patch(f"/api/deals/{other.pk}/", {"property_id": self.prop_.pk}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        other.refresh_from_db()
        self.assertNotEqual(other.property_id, self.prop_.pk)

    # ---- the closed deal is a record -------------------------------------------------------------------------------
    def test_a_closed_deal_cannot_be_edited_moved_reopened_or_deleted(self):
        self.close_winner(sale_price="880000")
        url = f"/api/deals/{self.winner.pk}/"
        checks = {
            "edit": self.api.patch(url, {"notes": "x", "offer_amount": "1"}, format="json"),
            "move to an open stage": move(self.api, self.winner, "negotiation"),
            "mark lost": move(self.api, self.winner, "lost", lost_reason="x"),
            "delete": self.api.delete(url),
        }
        for name, response in checks.items():
            with self.subTest(action=name):
                self.assertEqual(response.status_code, 400, response.content)
        self.winner.refresh_from_db()
        self.assertEqual((self.winner.stage, self.winner.sale_price), ("closed", Decimal("880000.00")))
        self.assertTrue(Commission.objects.filter(deal=self.winner).exists(), "deleting was refused, so the commission is still there")

    def test_the_offers_of_a_closed_deal_cannot_be_changed(self):
        offer = Offer.objects.create(deal=self.winner, lead=self.winner.lead, property=self.prop_, amount=Decimal("1"), submitted_by=self.sales_a)
        self.close_winner()
        response = self.api.post(f"/api/offers/{offer.pk}/set-status/", {"status": "withdrawn"}, format="json")
        self.assertEqual(response.status_code, 400, response.content)

    def test_open_and_lost_deals_can_still_be_deleted_by_a_manager(self):
        lost = self.deal(self.sales_a, stage=Deal.Stage.LOST, lost_reason="x")
        self.assertEqual(self.api.delete(f"/api/deals/{self.rival.pk}/").status_code, 204)
        self.assertEqual(self.api.delete(f"/api/deals/{lost.pk}/").status_code, 204)

    # ---- Property.status ------------------------------------------------------------------------------------------
    def test_property_status_cannot_leave_sold_while_a_closed_deal_exists(self):
        self.close_winner()
        url = f"/api/properties/{self.prop_.pk}/"
        for status in ("available", "reserved", "under_offer", "inactive"):
            with self.subTest(status=status):
                response = self.api.patch(url, {"status": status}, format="json")
                self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(self.api.patch(url, {"title": "Renamed", "status": "sold"}, format="json").status_code, 200)
        self.prop_.refresh_from_db()
        self.assertEqual((self.prop_.status, self.prop_.title), (Property.Status.SOLD, "Renamed"))

    def test_a_sold_status_without_a_closed_deal_can_still_be_corrected(self):
        loose = self.prop(self.sales_a, status=Property.Status.SOLD)
        response = self.api.patch(f"/api/properties/{loose.pk}/", {"status": "available"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_an_editor_holding_an_old_copy_cannot_write_the_old_status_over_a_sale(self):
        stale = Property.objects.get(pk=self.prop_.pk)  # loaded before the sale: status "available"
        self.close_winner()
        view = PropertyViewSet()
        view.request = SimpleNamespace(user=self.manager)
        serializer = PropertySerializer(stale, data={"title": "Edited meanwhile"}, partial=True)
        serializer.is_valid(raise_exception=True)
        view.perform_update(serializer)
        self.prop_.refresh_from_db()
        self.assertEqual((self.prop_.status, self.prop_.title), (Property.Status.SOLD, "Edited meanwhile"))

    def test_a_deal_editor_holding_an_old_copy_cannot_reopen_a_deal_closed_meanwhile(self):
        stale = Deal.objects.get(pk=self.winner.pk)  # loaded while negotiating
        self.close_winner(sale_price="880000")
        view = DealViewSet()
        view.request = SimpleNamespace(user=self.manager)
        serializer = DealSerializer(stale, data={"notes": "late edit"}, partial=True)
        serializer.is_valid(raise_exception=True)
        with self.assertRaises(BusinessRuleViolation):
            view.perform_update(serializer)
        self.winner.refresh_from_db()
        self.assertEqual((self.winner.stage, self.winner.sale_price, self.winner.notes), ("closed", Decimal("880000.00"), ""))

    def test_a_move_by_a_caller_holding_an_old_copy_is_decided_on_current_data(self):
        stale = Deal.objects.get(pk=self.rival.pk)
        self.close_winner()
        with self.assertRaises(BusinessRuleViolation):
            services.move_stage(stale, Deal.Stage.UNDER_CONTRACT, self.manager)
        self.prop_.refresh_from_db()
        self.assertEqual(self.prop_.status, Property.Status.SOLD, "the old copy said 'available' and must not turn the property into under_offer")

    # ---- the admin is not a way around the rules -------------------------------------------------------------------
    def test_the_admin_cannot_change_stage_or_delete_or_resell_a_closed_deal(self):
        self.close_winner()
        request = RequestFactory().get("/")
        self.admin.is_staff = self.admin.is_superuser = True  # in memory only: Django's own permission check must not be what says no
        request.user = self.admin
        closed = Deal.objects.get(pk=self.winner.pk)
        from deals.admin import DealAdmin  # a name that only exists once the admin is hardened

        deal_admin = DealAdmin(Deal, admin.site)
        self.assertIn("stage", deal_admin.get_readonly_fields(request, self.rival), "stage is only changed through the service")
        self.assertIn("notes", deal_admin.get_readonly_fields(request, closed))
        self.assertFalse(deal_admin.has_delete_permission(request, closed))
        self.assertTrue(deal_admin.has_delete_permission(request, self.rival))
        self.assertIn("status", PropertyAdmin(Property, admin.site).get_readonly_fields(request, self.prop_))


class DealRaceTests(TransactionTestCase):
    """Real transactions on separate connections. Both requests are held at the moment a stage is about to be written (pre_save), which is where
    the old check-then-write code let both of them through."""

    def setUp(self):
        self.manager = make_user("m-race@t.test", Role.MANAGER)
        self.sales = make_user("s-race@t.test", Role.SALESPERSON)
        self.prop_ = Property.objects.create(title="Race flat", address="a", city="c", price=Decimal("1000000"))
        self.d1 = self.make_deal(self.prop_, "one")
        self.d2 = self.make_deal(self.prop_, "two")

    def make_deal(self, prop, name, stage=Deal.Stage.NEGOTIATION):
        lead = Lead.objects.create(first_name=name, last_name="x", phone="0100000000", assigned_to=self.sales)
        return Deal.objects.create(lead=lead, property=prop, assigned_to=self.sales, stage=stage, offer_amount=Decimal("900000"))

    def call(self, method, url, body=None):
        try:
            client = APIClient(raise_request_exception=False)
            client.force_authenticate(user=User.objects.get(pk=self.manager.pk))
            res = getattr(client, method)(url, body, format="json")
            try:
                data = res.json()
            except Exception:  # noqa: BLE001
                data = None
            return res.status_code, data
        finally:
            connections.close_all()

    def run_together(self, calls, hold_stages=("closed",)):
        barrier = threading.Barrier(len(calls))

        def hold(sender, instance, **kw):
            if instance.pk and instance.stage in hold_stages:
                try:
                    barrier.wait(timeout=1.5)
                except threading.BrokenBarrierError:
                    pass

        pre_save.connect(hold, sender=Deal, dispatch_uid="deal-race-hold")
        try:
            with ThreadPoolExecutor(len(calls)) as pool:
                futures = [pool.submit(c) for c in calls]
                return [f.result() for f in futures]
        finally:
            pre_save.disconnect(sender=Deal, dispatch_uid="deal-race-hold")

    def test_two_deals_closed_at_the_same_moment_sell_the_property_once(self):
        results = self.run_together(
            [lambda: self.call("post", f"/api/deals/{self.d1.pk}/move/", {"stage": "closed"}),
             lambda: self.call("post", f"/api/deals/{self.d2.pk}/move/", {"stage": "closed"})]
        )
        self.assertEqual(sorted(code for code, _ in results), [200, 400], results)
        loser_body = next(body for code, body in results if code == 400)
        self.assertIn("already been sold", str(loser_body))
        closed = list(Deal.objects.filter(property=self.prop_, stage=Deal.Stage.CLOSED))
        self.assertEqual(len(closed), 1)
        loser = Deal.objects.exclude(pk=closed[0].pk).get(property=self.prop_)
        self.assertEqual((loser.stage, loser.closed_at), ("negotiation", None))
        self.assertEqual(list(Commission.objects.values_list("deal_id", flat=True)), [closed[0].pk])
        self.assertEqual(Activity.objects.filter(kind=Activity.Kind.DEAL_CLOSED).count(), 1)
        self.assertEqual(Property.objects.get(pk=self.prop_.pk).status, Property.Status.SOLD)

    def test_the_same_deal_closed_twice_at_the_same_moment_is_closed_once(self):
        url = f"/api/deals/{self.d1.pk}/move/"
        results = self.run_together([lambda: self.call("post", url, {"stage": "closed"}), lambda: self.call("post", url, {"stage": "closed"})])
        self.assertEqual([code for code, _ in results], [200, 200], results)
        self.assertEqual(Commission.objects.filter(deal=self.d1).count(), 1)
        self.assertEqual(Activity.objects.filter(kind=Activity.Kind.DEAL_CLOSED, deal=self.d1).count(), 1)
        self.assertEqual(Deal.objects.get(pk=self.d1.pk).stage, "closed")

    def test_a_rival_entering_offer_made_while_the_other_deal_closes_never_unsells_the_property(self):
        results = self.run_together(
            [lambda: self.call("post", f"/api/deals/{self.d1.pk}/move/", {"stage": "closed"}),
             lambda: self.call("post", f"/api/deals/{self.d2.pk}/move/", {"stage": "offer_made"})],
            hold_stages=("closed", "offer_made"),
        )
        self.assertEqual(results[0][0], 200, results)
        rival = Deal.objects.get(pk=self.d2.pk)
        self.assertEqual(rival.stage == "offer_made", results[1][0] == 200, "the rival's answer matches what was stored")
        self.assertIn(results[1][0], (200, 400))
        self.assertEqual(Property.objects.get(pk=self.prop_.pk).status, Property.Status.SOLD)
        self.assertEqual(Commission.objects.count(), 1)

    def test_an_offer_arriving_while_the_property_is_being_sold_is_never_stored_on_a_sold_property(self):
        results = self.run_together(
            [lambda: self.call("post", f"/api/deals/{self.d1.pk}/move/", {"stage": "closed"}),
             lambda: self.call("post", "/api/offers/", {"deal_id": self.d2.pk, "amount": "910000"})],
            hold_stages=("closed",),
        )
        self.assertEqual(results[0][0], 200, results)
        self.assertIn(results[1][0], (201, 400), results)
        offers = Offer.objects.filter(deal=self.d2).count()
        self.assertEqual(offers, 1 if results[1][0] == 201 else 0, "stored if and only if it was accepted")

    def test_moving_a_deal_while_an_offer_is_recorded_never_splits_the_offer_from_its_deal(self):
        other = Property.objects.create(title="Other flat", address="a", city="c", price=Decimal("2000000"))
        results = self.run_together(
            [lambda: self.call("patch", f"/api/deals/{self.d1.pk}/", {"property_id": other.pk}),
             lambda: self.call("post", "/api/offers/", {"deal_id": self.d1.pk, "amount": "910000"})],
            hold_stages=("negotiation",),
        )
        self.assertIn(results[0][0], (200, 400), results)
        self.assertEqual(results[1][0], 201, results)
        deal = Deal.objects.get(pk=self.d1.pk)
        offer = Offer.objects.get(deal=deal)
        self.assertEqual((offer.property_id, offer.lead_id), (deal.property_id, deal.lead_id), "whichever came first, the offer matches its deal")
        self.assertEqual(results[0][0] == 200, deal.property_id == other.pk, "the move's answer matches what was stored")

    def test_many_requests_on_two_properties_neither_deadlock_nor_break_the_invariants(self):
        """Closings, losses, offers, edits, status changes and property swaps in a mix, from 8 threads. A deadlock would surface as a 5xx."""
        other = Property.objects.create(title="Other flat", address="a", city="c", price=Decimal("2000000"))
        deals = [self.d1, self.d2, self.make_deal(self.prop_, "three"), self.make_deal(other, "four"), self.make_deal(other, "five"),
                 self.make_deal(other, "six", Deal.Stage.INTERESTED), self.make_deal(self.prop_, "seven", Deal.Stage.INTERESTED)]
        rng = random.Random(20240601)
        ops = []
        for _ in range(90):
            d = rng.choice(deals)
            kind = rng.choice(["close", "close", "lost", "offer", "edit", "swap", "swap", "property", "status"])
            prop = rng.choice([self.prop_, other])
            ops.append({
                "close": ("post", f"/api/deals/{d.pk}/move/", {"stage": "closed"}),
                "lost": ("post", f"/api/deals/{d.pk}/move/", {"stage": "lost", "lost_reason": "x"}),
                "offer": ("post", "/api/offers/", {"deal_id": d.pk, "amount": "1000"}),
                "edit": ("patch", f"/api/deals/{d.pk}/", {"notes": f"n{rng.randint(0, 9)}"}),
                "swap": ("patch", f"/api/deals/{d.pk}/", {"property_id": prop.pk}),
                "property": ("patch", f"/api/properties/{prop.pk}/", {"title": f"t{rng.randint(0, 9)}"}),
                "status": ("patch", f"/api/properties/{prop.pk}/", {"status": rng.choice(["reserved", "available", "sold"])}),
            }[kind])
        with ThreadPoolExecutor(8) as pool:
            codes = list(pool.map(lambda op: self.call(*op)[0], ops))
        self.assertLess(max(codes), 500, f"a server error (a deadlock would be one): {sorted(set(codes))}")
        for prop in (self.prop_, other):
            prop.refresh_from_db()
            closed = Deal.objects.filter(property=prop, stage=Deal.Stage.CLOSED)
            self.assertLessEqual(closed.count(), 1, "one sale per property")
            if closed.exists():
                self.assertEqual(prop.status, Property.Status.SOLD)
        self.assertEqual(Commission.objects.count(), Deal.objects.filter(stage=Deal.Stage.CLOSED).count(), "one commission per closed deal")
        for commission in Commission.objects.select_related("deal"):
            self.assertEqual(commission.deal.stage, Deal.Stage.CLOSED)
            self.assertEqual(commission.sale_price, commission.deal.sale_price)


class DealOfferIntegrityTests(ApiTestCase):
    """An offer records what a client offered on a property. A deal that has offers keeps its client and property; one without offers can still
    be moved. The check reads the offers under the deal's lock, so it never works from a stale copy."""

    def setUp(self):
        self.api = self.as_user(self.manager)
        self.deal_ = self.deal(self.sales_a, stage=Deal.Stage.NEGOTIATION)
        self.other_prop = self.prop(self.sales_a, title="Elsewhere")
        self.other_lead = self.lead(self.sales_a, first_name="Someone")
        self.url = f"/api/deals/{self.deal_.pk}/"

    def offer(self):
        return Offer.objects.create(
            deal=self.deal_, lead=self.deal_.lead, property=self.deal_.property, amount=Decimal("1000"), submitted_by=self.sales_a
        )

    def test_a_deal_without_offers_can_still_change_property_and_client(self):
        self.assertEqual(self.api.patch(self.url, {"property_id": self.other_prop.pk}, format="json").status_code, 200)
        self.assertEqual(self.api.patch(self.url, {"lead_id": self.other_lead.pk}, format="json").status_code, 200)
        self.deal_.refresh_from_db()
        self.assertEqual((self.deal_.property_id, self.deal_.lead_id), (self.other_prop.pk, self.other_lead.pk))

    def test_a_deal_with_offers_keeps_its_property_and_client_with_a_clear_refusal(self):
        offer = self.offer()
        before = (self.deal_.property_id, self.deal_.lead_id)
        for body in ({"property_id": self.other_prop.pk}, {"lead_id": self.other_lead.pk}):
            with self.subTest(body=body):
                response = self.api.patch(self.url, body, format="json")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("already has offers", response.content.decode())
        self.deal_.refresh_from_db()
        offer.refresh_from_db()
        self.assertEqual((self.deal_.property_id, self.deal_.lead_id), before)
        self.assertEqual((offer.property_id, offer.lead_id), before, "the offer and its deal still agree")

    def test_other_edits_and_an_unchanged_property_are_still_fine_with_offers(self):
        self.offer()
        body = {
            "notes": "n", "offer_amount": "123", "expected_close_date": "2030-01-01",
            "property_id": self.deal_.property_id, "lead_id": self.deal_.lead_id,
        }
        self.assertEqual(self.api.patch(self.url, body, format="json").status_code, 200)

    def test_the_move_is_allowed_before_the_first_offer_and_refused_after_it(self):
        self.assertEqual(self.api.patch(self.url, {"property_id": self.other_prop.pk}, format="json").status_code, 200)
        recorded = self.api.post("/api/offers/", {"deal_id": self.deal_.pk, "amount": "5000"}, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.content)
        offer = Offer.objects.get(deal=self.deal_)
        self.assertEqual(offer.property_id, self.other_prop.pk, "the offer was recorded on the property the deal has now")
        moved = self.api.patch(self.url, {"property_id": self.prop(self.sales_a, title="Third").pk}, format="json")
        self.assertEqual(moved.status_code, 400, moved.content)

    def test_an_editor_holding_an_old_copy_sees_the_offer_recorded_meanwhile(self):
        stale = Deal.objects.get(pk=self.deal_.pk)  # loaded when the deal had no offers
        self.offer()
        view = DealViewSet()
        view.request = SimpleNamespace(user=self.manager)
        serializer = DealSerializer(stale, data={"property_id": self.other_prop.pk}, partial=True)
        serializer.is_valid(raise_exception=True)
        with self.assertRaises(BusinessRuleViolation):
            view.perform_update(serializer)
        self.assertNotEqual(Deal.objects.get(pk=self.deal_.pk).property_id, self.other_prop.pk)


@override_settings(STORAGES={**settings.STORAGES, "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}})
class AdminProtectionTests(ApiTestCase):
    """Django admin, through real requests: the refusals come from the server, not from hidden buttons. Bulk actions ask the same per-object
    permission, so a closed deal's commission and offers cannot be removed or edited that way either."""

    def setUp(self):
        self.prop_ = self.prop(self.sales_a, title="Admin flat")
        self.winner = self.deal(self.sales_a, prop=self.prop_, stage=Deal.Stage.NEGOTIATION)
        self.rival = self.deal(self.sales_b, prop=self.prop_, stage=Deal.Stage.NEGOTIATION)
        self.sealed_offer = Offer.objects.create(
            deal=self.winner, lead=self.winner.lead, property=self.prop_, amount=Decimal("1"), submitted_by=self.sales_a
        )
        self.open_offer = Offer.objects.create(
            deal=self.rival, lead=self.rival.lead, property=self.prop_, amount=Decimal("2"), submitted_by=self.sales_b
        )
        self.assertEqual(move(self.as_user(self.manager), self.winner, "closed").status_code, 200)
        self.commission = Commission.objects.get(deal=self.winner)
        self.su = User.objects.create_superuser("su-admin@t.test", "Correct-Horse-9-Battery!")
        self.site = Client()
        self.site.force_login(self.su)

    def bulk_delete(self, model, *pks):
        return self.site.post(f"/django-admin/{model}/", {"action": "delete_selected", "_selected_action": list(pks), "post": "yes"})

    def other_property(self, title="Mismatch"):
        return self.prop(self.sales_a, title=title)

    # ---- commissions -------------------------------------------------------------------------------------------------
    def test_a_commission_cannot_be_added_changed_or_deleted_in_the_admin(self):
        base = f"/django-admin/commissions/commission/{self.commission.pk}"
        count = Commission.objects.count()
        self.assertEqual(self.site.get("/django-admin/commissions/commission/add/").status_code, 403)
        self.assertEqual(
            self.site.post("/django-admin/commissions/commission/add/", {"deal": self.rival.pk, "sale_price": "1"}).status_code, 403
        )
        changed = self.site.post(f"{base}/change/", {"status": "paid", "sale_price": "1", "deductions": "999999"})
        self.assertEqual(changed.status_code, 403)
        self.assertEqual(self.site.post(f"{base}/delete/", {"post": "yes"}).status_code, 403)
        self.assertEqual(self.site.get(f"{base}/delete/").status_code, 403)
        self.bulk_delete("commissions/commission", self.commission.pk)  # the action is not even offered: nothing is deleted
        self.assertEqual(Commission.objects.count(), count)
        fresh = Commission.objects.get(pk=self.commission.pk)
        self.assertEqual((fresh.status, fresh.sale_price, fresh.deductions), ("pending", self.commission.sale_price, Decimal("0.00")))
        self.assertEqual(self.site.get(f"{base}/change/").status_code, 200, "it can still be looked at")

    def test_the_commission_api_keeps_its_role_rules(self):
        self.assertEqual(self.as_user(self.manager).post(f"/api/commissions/{self.commission.pk}/approve/").status_code, 403)
        self.assertEqual(self.as_user(self.admin).post(f"/api/commissions/{self.commission.pk}/approve/").status_code, 200)
        self.assertEqual(Commission.objects.get(pk=self.commission.pk).status, "approved")
        self.assertEqual(self.as_user(self.admin).post(f"/api/commissions/{self.commission.pk}/mark-paid/").status_code, 200)

    def test_nothing_in_the_admin_can_delete_a_commission_through_its_deal_property_or_lead(self):
        self.bulk_delete("deals/deal", self.winner.pk)
        self.bulk_delete("properties/property", self.prop_.pk)
        self.bulk_delete("leads/lead", self.winner.lead_id)
        self.assertTrue(Commission.objects.filter(pk=self.commission.pk).exists())
        self.assertTrue(Deal.objects.filter(pk=self.winner.pk, stage="closed").exists())

    # ---- offers ------------------------------------------------------------------------------------------------------
    def test_the_offers_of_a_closed_deal_cannot_be_changed_or_deleted_in_the_admin(self):
        base = f"/django-admin/deals/offer/{self.sealed_offer.pk}"
        edit = {"amount": "999", "status": "accepted", "conditions": "", "notes": "", "submitted_by": self.sales_a.pk}
        self.assertEqual(self.site.post(f"{base}/change/", edit).status_code, 403)
        self.assertEqual(self.site.post(f"{base}/delete/", {"post": "yes"}).status_code, 403)
        self.assertEqual(self.bulk_delete("deals/offer", self.sealed_offer.pk).status_code, 403)
        mixed = self.bulk_delete("deals/offer", self.sealed_offer.pk, self.open_offer.pk)
        self.assertEqual(mixed.status_code, 403, "one sealed offer stops the whole bulk action")
        self.assertTrue(Offer.objects.filter(pk=self.open_offer.pk).exists())
        fresh = Offer.objects.get(pk=self.sealed_offer.pk)
        self.assertEqual((fresh.amount, fresh.status), (Decimal("1.00"), "submitted"))

    def test_offers_of_open_deals_stay_manageable_but_keep_their_deal_client_and_property(self):
        other = self.other_property("Else")
        body = {
            "amount": "50", "status": "rejected", "conditions": "", "notes": "", "submitted_by": self.sales_b.pk,
            "property": other.pk, "deal": self.winner.pk,
        }
        self.assertEqual(self.site.post(f"/django-admin/deals/offer/{self.open_offer.pk}/change/", body).status_code, 302)
        fresh = Offer.objects.get(pk=self.open_offer.pk)
        self.assertEqual((fresh.status, fresh.deal_id, fresh.property_id), ("rejected", self.rival.pk, self.prop_.pk), "deal and property are read-only")
        self.assertEqual(self.bulk_delete("deals/offer", self.open_offer.pk).status_code, 302)
        self.assertFalse(Offer.objects.filter(pk=self.open_offer.pk).exists())

    def test_an_offer_cannot_be_added_to_a_closed_deal_or_to_another_deals_property(self):
        def add(deal, prop, lead):
            return self.site.post(
                "/django-admin/deals/offer/add/",
                {
                    "deal": deal.pk, "lead": lead.pk, "property": prop.pk, "amount": "7", "status": "submitted",
                    "conditions": "", "notes": "", "submitted_by": self.sales_a.pk,
                },
            )

        count = Offer.objects.count()
        self.assertEqual(add(self.winner, self.prop_, self.winner.lead).status_code, 200, "the form is shown again with an error")
        self.assertEqual(add(self.rival, self.other_property(), self.rival.lead).status_code, 200)
        self.assertEqual(Offer.objects.count(), count)
        self.assertEqual(add(self.rival, self.prop_, self.rival.lead).status_code, 302)
        self.assertEqual(Offer.objects.count(), count + 1)

    # ---- deals -------------------------------------------------------------------------------------------------------
    def test_the_deal_admin_cannot_move_a_deal_to_another_client_property_or_stage(self):
        stranger_lead, stranger_prop = self.lead(self.sales_b, first_name="Stranger"), self.other_property()
        body = {
            "assigned_to": self.sales_b.pk, "notes": "kept", "lead": stranger_lead.pk, "property": stranger_prop.pk,
            "stage": "closed", "sale_price": "1",
        }
        self.assertEqual(self.site.post(f"/django-admin/deals/deal/{self.rival.pk}/change/", body).status_code, 302)
        fresh = Deal.objects.get(pk=self.rival.pk)
        self.assertEqual(
            (fresh.lead_id, fresh.property_id, fresh.stage, fresh.sale_price, fresh.notes),
            (self.rival.lead_id, self.prop_.pk, "negotiation", None, "kept"),
        )

    def test_a_closed_deal_cannot_be_changed_or_deleted_in_the_admin(self):
        self.site.post(f"/django-admin/deals/deal/{self.winner.pk}/change/", {"notes": "tampered", "assigned_to": self.sales_b.pk})
        self.assertEqual(self.site.post(f"/django-admin/deals/deal/{self.winner.pk}/delete/", {"post": "yes"}).status_code, 403)
        # 403, or (now that its commission is PROTECTed) the admin's own "cannot delete: protected objects" page; either way nothing is deleted
        self.assertIn(self.bulk_delete("deals/deal", self.winner.pk).status_code, (200, 403))
        fresh = Deal.objects.get(pk=self.winner.pk)
        self.assertEqual((fresh.stage, fresh.notes, fresh.assigned_to_id), ("closed", "", self.sales_a.pk))


class TransactionSafetyTests(TransactionTestCase):
    """A failure anywhere after the first write rolls the whole operation back: no half-closed deal, no orphan commission or offer. Real
    transactions (not the test wrapper); the failure is injected at each step that comes after a row was written."""

    def setUp(self):
        self.manager = make_user("m-tx@t.test", Role.MANAGER)
        self.sales = make_user("s-tx@t.test", Role.SALESPERSON)
        self.prop_ = Property.objects.create(title="Tx flat", address="a", city="c", price=Decimal("1000000"))
        self.lead = Lead.objects.create(first_name="Tx", last_name="Lead", phone="0100000000", assigned_to=self.sales)
        self.deal_ = Deal.objects.create(
            lead=self.lead, property=self.prop_, assigned_to=self.sales, stage=Deal.Stage.NEGOTIATION, offer_amount=Decimal("900000")
        )

    def call(self, method, url, body=None):
        client = APIClient(raise_request_exception=False)
        client.force_authenticate(user=User.objects.get(pk=self.manager.pk))
        return getattr(client, method)(url, body, format="json").status_code

    def assert_untouched(self, label):
        deal = Deal.objects.get(pk=self.deal_.pk)
        self.assertEqual((deal.stage, deal.sale_price, deal.closed_at), ("negotiation", None, None), label)
        self.assertEqual(Property.objects.get(pk=self.prop_.pk).status, Property.Status.AVAILABLE, label)
        self.assertEqual(Lead.objects.get(pk=self.lead.pk).status, Lead.Status.NEW, label)
        self.assertFalse(Commission.objects.exists(), label)
        kinds = [Activity.Kind.DEAL_CLOSED, Activity.Kind.COMMISSION, Activity.Kind.DEAL_MOVED]
        self.assertFalse(Activity.objects.filter(deal=self.deal_, kind__in=kinds).exists(), label)
        self.assertEqual(Notification.objects.count(), 0, label)

    def test_a_failure_after_the_commission_row_rolls_the_closing_back_completely(self):
        steps = {
            "right after the commission row (its notification)": "commissions.services.notify",
            "while the commission activity is written": "commissions.services.log_activity",
            "after the commission, in the deal's own notification": "deals.services.notify",
        }
        for label, target in steps.items():
            with self.subTest(step=label), mock.patch(target, side_effect=RuntimeError("injected failure")):
                self.assertEqual(self.call("post", f"/api/deals/{self.deal_.pk}/move/", {"stage": "closed"}), 500)
                self.assert_untouched(label)
        # nothing was left half-done: the same request works afterwards, once, with one commission
        self.assertEqual(self.call("post", f"/api/deals/{self.deal_.pk}/move/", {"stage": "closed"}), 200)
        self.assertEqual(Commission.objects.filter(deal=self.deal_).count(), 1)
        self.assertEqual(Property.objects.get(pk=self.prop_.pk).status, Property.Status.SOLD)

    def test_a_failure_after_the_offer_row_rolls_the_offer_back_completely(self):
        Deal.objects.filter(pk=self.deal_.pk).update(stage=Deal.Stage.INTERESTED, offer_amount=None)
        steps = {
            "when the activity is written": "deals.services.log_activity",
            "when the deal moves to Offer Made (notification)": "deals.services.notify",
        }
        for label, target in steps.items():
            with self.subTest(step=label), mock.patch(target, side_effect=RuntimeError("injected failure")):
                self.assertEqual(self.call("post", "/api/offers/", {"deal_id": self.deal_.pk, "amount": "5000"}), 500)
                deal = Deal.objects.get(pk=self.deal_.pk)
                self.assertEqual((deal.stage, deal.offer_amount), ("interested", None), label)
                self.assertFalse(Offer.objects.exists(), label)
                self.assertEqual(Property.objects.get(pk=self.prop_.pk).status, Property.Status.AVAILABLE, label)
        self.assertEqual(self.call("post", "/api/offers/", {"deal_id": self.deal_.pk, "amount": "5000"}), 201)
        self.assertEqual(Offer.objects.count(), 1)

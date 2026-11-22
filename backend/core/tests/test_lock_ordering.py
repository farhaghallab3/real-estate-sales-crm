"""Lock ordering when a deal is moved to another property while locks are being taken.

Every path that touches a sale takes its row locks in one order: property rows by ascending id, then the deal row. The retry in lock_deal,
lock_sale_records and the deletion guard used to keep the locks of the attempt before it: a deal found to have moved meanwhile made the next
attempt ask for a LOWER property id while still holding a higher one (and for property rows while holding the deal row), which deadlocks with
any other request taking the same rows in the right order ("deadlock detected", a 500). Each attempt now runs in its own savepoint and is
given back completely before the next one starts.

The three scenario tests are deterministic (they queue the competing sessions by looking at pg_stat_activity, no sleeps decide anything); the
storm tests add random pressure on top.
"""
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from django.db import connection, connections, transaction
from django.db.models import ProtectedError
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from commissions.models import Commission
from deals import protection, services
from deals.models import Deal
from leads.models import Lead
from properties.models import Property
from users.models import Role, User

from .base import make_user


def wait_for_lock_waiters(count: int, timeout: float = 10) -> bool:
    """True once at least `count` database sessions are blocked waiting for a lock."""
    deadline = time.time() + timeout
    with connection.cursor() as cursor:
        while time.time() < deadline:
            cursor.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
            if cursor.fetchone()[0] >= count:
                return True
            time.sleep(0.03)
    return False


class Base(TransactionTestCase):
    def setUp(self):
        self.manager = make_user("m-lock@t.test", Role.MANAGER)
        self.sales = make_user("s-lock@t.test", Role.SALESPERSON)

    def prop(self, title):
        return Property.objects.create(title=title, address="a", city="c", price=Decimal("1000000"))

    def lead(self, name):
        return Lead.objects.create(first_name=name, last_name="x", phone="0100000000", assigned_to=self.sales)

    def deal(self, prop, lead=None, stage=Deal.Stage.NEGOTIATION):
        return Deal.objects.create(lead=lead or self.lead(f"L{Deal.objects.count()}"), property=prop, assigned_to=self.sales, stage=stage,
                                   offer_amount=Decimal("900000"))

    def api(self, method, url, body=None):
        try:
            client = APIClient(raise_request_exception=False)
            client.force_authenticate(user=User.objects.get(pk=self.manager.pk))
            return getattr(client, method)(url, body, format="json").status_code
        finally:
            connections.close_all()


class MovedWhileWaitingTests(Base):
    """A deal is moved from the HIGH property to the LOW one while a request is queued for the HIGH property's lock.

    B holds HIGH, moves the deal to LOW (without taking LOW's lock) and commits last. C holds LOW and then asks for HIGH. A is the function under
    test: it first read "the deal is on HIGH", queues behind B for HIGH, wins HIGH when B commits, finds the deal on LOW and must ask for LOW,
    which C holds while waiting for HIGH. If A still held HIGH at that point, A and C would wait for each other forever (deadlock).
    """

    def setUp(self):
        super().setUp()
        self.low, self.high = self.prop("low"), self.prop("high")
        self.assertLess(self.low.pk, self.high.pk)
        self.lead_ = self.lead("mover")
        self.deal_ = self.deal(self.high, lead=self.lead_, stage=Deal.Stage.INTERESTED)

    def scenario(self, target):
        """Run `target` (a callable, executed in its own thread inside a transaction when it needs one) in the scenario; return what every thread did."""
        events = {name: threading.Event() for name in ("c_has_low", "c_go", "b_ready", "b_commit")}
        out = {}

        def run(key, fn):
            try:
                out[key] = fn() or "ok"
            except Exception as e:  # noqa: BLE001
                out[key] = f"{type(e).__name__}: {str(e).splitlines()[0][:110]}"
            finally:
                connections.close_all()

        def c():
            with transaction.atomic():
                Property.objects.select_for_update(no_key=True).get(pk=self.low.pk)  # blocks a FOR UPDATE on LOW, not the foreign-key check of B
                events["c_has_low"].set()
                events["c_go"].wait(10)
                Property.objects.select_for_update().get(pk=self.high.pk)

        def b():
            with transaction.atomic():
                Property.objects.select_for_update().get(pk=self.high.pk)
                Deal.objects.filter(pk=self.deal_.pk).update(property_id=self.low.pk)
                events["b_ready"].set()
                events["b_commit"].wait(10)

        threads = {}
        threads["c"] = threading.Thread(target=run, args=("c", c))
        threads["c"].start()
        self.assertTrue(events["c_has_low"].wait(10))
        threads["b"] = threading.Thread(target=run, args=("b", b))
        threads["b"].start()
        self.assertTrue(events["b_ready"].wait(10))
        threads["a"] = threading.Thread(target=run, args=("a", target))
        threads["a"].start()
        self.assertTrue(wait_for_lock_waiters(1), "A is queued behind B for the HIGH property")
        events["c_go"].set()
        self.assertTrue(wait_for_lock_waiters(2), "C is queued behind A for the HIGH property, holding LOW")
        events["b_commit"].set()
        for t in threads.values():
            t.join(30)
        return out

    def assert_no_deadlock(self, out):
        self.assertEqual(out, {"a": "ok", "b": "ok", "c": "ok"}, f"every session finished (a deadlock kills one of them): {out}")
        self.assertEqual(Deal.objects.get(pk=self.deal_.pk).property_id, self.low.pk)

    def test_lock_deal_retry_does_not_keep_the_lock_of_the_first_attempt(self):
        def a():
            with transaction.atomic():
                deal = Deal.objects.get(pk=self.deal_.pk)
                services.lock_deal(deal, extra_property_ids=[self.high.pk])  # a request that asks for HIGH as the target of a move
                assert deal.property_id == self.low.pk

        self.assert_no_deadlock(self.scenario(a))

    def test_lock_sale_records_retry_does_not_keep_the_locks_of_the_first_attempt(self):
        def a():
            with transaction.atomic():
                locked = protection.lock_sale_records(lead_id=self.lead_.pk)  # deleting the lead through the API
                assert [d.pk for d in locked] == [self.deal_.pk]

        self.assert_no_deadlock(self.scenario(a))

    def test_the_deletion_guard_retry_inside_the_collector_does_not_keep_the_locks_of_the_first_attempt(self):
        def a():
            Lead.objects.get(pk=self.lead_.pk).delete()  # the ORM / admin: the collector sends pre_delete for the deal, the guard retries inside it

        out = self.scenario(a)
        self.assertEqual(out, {"a": "ok", "b": "ok", "c": "ok"}, out)
        self.assertFalse(Deal.objects.filter(pk=self.deal_.pk).exists() or Lead.objects.filter(pk=self.lead_.pk).exists(), "the cascade completed")


class SavepointReleasesRowLocksTests(Base):
    """The fix relies on this: rolling back a savepoint gives back the row locks taken inside it, while the transaction goes on."""

    def test_rolling_back_a_savepoint_releases_property_and_deal_locks_but_keeps_the_earlier_ones(self):
        prop, other = self.prop("held"), self.prop("early")
        deal = self.deal(prop)
        taken, release, result = threading.Event(), threading.Event(), {}

        def holder():
            try:
                with transaction.atomic():
                    Property.objects.select_for_update().get(pk=other.pk)  # taken BEFORE the savepoint: must stay locked
                    try:
                        with transaction.atomic():
                            Property.objects.select_for_update().get(pk=prop.pk)
                            Deal.objects.select_for_update().get(pk=deal.pk)
                            raise RuntimeError("give the attempt back")
                    except RuntimeError:
                        pass
                    taken.set()          # the transaction is still open, the attempt has been rolled back to its savepoint
                    release.wait(15)
            finally:
                connections.close_all()

        def probe(model, pk):
            try:
                with transaction.atomic():
                    model.objects.select_for_update(nowait=True).get(pk=pk)
                return "free"
            except Exception as e:  # noqa: BLE001
                return type(e).__name__
            finally:
                connections.close_all()

        thread = threading.Thread(target=holder)
        thread.start()
        self.assertTrue(taken.wait(15))
        with ThreadPoolExecutor(3) as pool:
            result = {name: pool.submit(probe, model, pk).result() for name, model, pk in
                      (("property taken inside the savepoint", Property, prop.pk), ("deal taken inside the savepoint", Deal, deal.pk),
                       ("property taken before the savepoint", Property, other.pk))}
        release.set()
        thread.join(15)
        self.assertEqual(result["property taken inside the savepoint"], "free")
        self.assertEqual(result["deal taken inside the savepoint"], "free")
        self.assertEqual(result["property taken before the savepoint"], "OperationalError", "locks of earlier work are not given back")

    def test_lock_deal_outside_a_transaction_is_refused_instead_of_locking_nothing(self):
        deal = self.deal(self.prop("p"))
        with self.assertRaises(transaction.TransactionManagementError):
            services.lock_deal(deal)


class LockOrderStormTests(Base):
    """Random pressure: moves of the same deal, swaps between deals, closings, deletions through the API and the ORM, from many threads."""

    def assert_sane(self, props):
        for prop in Property.objects.filter(pk__in=[p.pk for p in props]):
            self.assertLessEqual(Deal.objects.filter(property=prop, stage=Deal.Stage.CLOSED).count(), 1, "one sale per property")
        closed = Deal.objects.filter(stage=Deal.Stage.CLOSED)
        self.assertEqual(Commission.objects.count(), closed.count(), "one commission per closed deal, none without one")
        for deal in closed:
            self.assertTrue(Commission.objects.filter(deal=deal).exists())
            self.assertEqual(Property.objects.get(pk=deal.property_id).status, Property.Status.SOLD)
        for commission in Commission.objects.select_related("deal"):
            self.assertEqual((commission.deal.stage, commission.sale_price), (Deal.Stage.CLOSED, commission.deal.sale_price))

    def test_the_same_deal_moved_between_two_properties_by_many_requests(self):
        low, high = self.prop("low"), self.prop("high")
        deal = self.deal(high, stage=Deal.Stage.INTERESTED)
        rng = random.Random(11)
        ops = [("patch", f"/api/deals/{deal.pk}/", {"property_id": rng.choice([low.pk, high.pk])}) for _ in range(96)]
        with ThreadPoolExecutor(8) as pool:
            codes = list(pool.map(lambda op: self.api(*op), ops))
        self.assertLess(max(codes), 500, f"a server error (a deadlock would be one): {sorted(set(codes))}")
        self.assertIn(Deal.objects.get(pk=deal.pk).property_id, (low.pk, high.pk))
        self.assert_sane([low, high])

    def test_deals_swapping_properties_with_each_other_and_closing(self):
        props = [self.prop(f"p{i}") for i in range(3)]
        deals = [self.deal(props[i % 3], stage=Deal.Stage.INTERESTED if i % 2 else Deal.Stage.NEGOTIATION) for i in range(6)]
        rng = random.Random(5)
        ops = []
        for _ in range(120):
            d, p = rng.choice(deals), rng.choice(props)
            ops.append(rng.choice([
                ("patch", f"/api/deals/{d.pk}/", {"property_id": p.pk}),
                ("patch", f"/api/deals/{d.pk}/", {"property_id": p.pk}),
                ("post", f"/api/deals/{d.pk}/move/", {"stage": "closed"}),
            ]))
        with ThreadPoolExecutor(8) as pool:
            codes = list(pool.map(lambda op: self.api(*op), ops))
        self.assertLess(max(codes), 500, f"a server error (a deadlock would be one): {sorted(set(codes))}")
        self.assert_sane(props)

    def test_deletions_through_the_api_and_the_orm_against_moves_and_closings(self):
        props = [self.prop(f"p{i}") for i in range(3)]
        leads = [self.lead(f"l{i}") for i in range(6)]
        deals = [self.deal(props[i % 3], lead=leads[i], stage=Deal.Stage.NEGOTIATION) for i in range(6)]
        rng = random.Random(9)
        failures = []

        def orm(kind, pk):
            try:
                if kind == "property":
                    Property.objects.filter(pk=pk).first().delete()
                elif kind == "lead":
                    Lead.objects.filter(pk=pk).first().delete()
                else:
                    Deal.objects.filter(pk=pk).delete()
                return 204
            except AttributeError:
                return 404                               # already deleted by someone else
            except ProtectedError:
                return 400                               # a completed sale: refused, as it should be
            except Exception as e:  # noqa: BLE001
                failures.append(f"{type(e).__name__}: {str(e).splitlines()[0][:90]}")
                return 500
            finally:
                connections.close_all()

        ops = []
        for _ in range(90):
            d, p = rng.choice(deals), rng.choice(props)
            ops.append(rng.choice([
                lambda d=d, p=p: self.api("patch", f"/api/deals/{d.pk}/", {"property_id": p.pk}),
                lambda d=d: self.api("post", f"/api/deals/{d.pk}/move/", {"stage": "closed"}),
                lambda p=p: self.api("delete", f"/api/properties/{p.pk}/"),
                lambda d=d: self.api("delete", f"/api/leads/{d.lead_id}/"),
                lambda p=p: orm("property", p.pk),
                lambda d=d: orm("lead", d.lead_id),
                lambda d=d: orm("deal", d.pk),
            ]))
        with ThreadPoolExecutor(8) as pool:
            codes = list(pool.map(lambda op: op(), ops))
        self.assertEqual(failures, [], "no deadlock or other database error in the ORM deletions")
        self.assertLess(max(codes), 500, f"a server error (a deadlock would be one): {sorted(set(codes))}")
        self.assert_sane(props)
        # whatever was deleted, a surviving closed deal still has its property, its lead and its commission
        for deal in Deal.objects.filter(stage=Deal.Stage.CLOSED):
            self.assertTrue(Property.objects.filter(pk=deal.property_id).exists() and Lead.objects.filter(pk=deal.lead_id).exists())

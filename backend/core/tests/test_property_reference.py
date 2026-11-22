"""Property.reference: assigned in the same INSERT as the id, never changed afterwards, never empty, safe under concurrent creation.

The old design inserted reference="" and then UPDATEd it. Two simultaneous creations collided on the unique index (HTTP 500), and a crash between
the two statements left an empty reference that failed every later creation. These tests pin the new behaviour down.
"""
import threading
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from django.core.management import call_command
from django.db import connection, connections
from django.db.models.signals import post_save
from django.test import TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from properties.models import Property
from users.models import Role, User

from .base import ApiTestCase, make_user


def payload(i=0, **extra):
    return dict(title=f"Flat {i}", address=f"{i} Test St", city="Cairo", price=Decimal("1000000"), **extra)


def set_sequence(next_value: int):
    """Make the NEXT id handed out by the table's sequence equal next_value."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT setval(pg_get_serial_sequence('properties_property', 'id'), %s, false)", [next_value])


def statements(ctx, verb):
    return [q["sql"] for q in ctx.captured_queries if q["sql"].lstrip().upper().startswith(verb) and "properties_property" in q["sql"]]


class ReferenceFormatAndWritesTests(ApiTestCase):
    def test_reference_is_pr_and_the_id_in_one_insert_with_no_update(self):
        with CaptureQueriesContext(connection) as ctx:
            prop = Property.objects.create(**payload(1))
        self.assertEqual(prop.reference, f"PR-{prop.pk:05d}")
        inserts = statements(ctx, "INSERT")
        self.assertEqual(len(inserts), 1, "exactly one INSERT")
        self.assertEqual(statements(ctx, "UPDATE"), [], "no UPDATE after the INSERT")
        self.assertIn('"id"', inserts[0], "the id is part of the INSERT")
        self.assertIn('"reference"', inserts[0])
        self.assertEqual(sum("nextval" in q["sql"] for q in ctx.captured_queries), 1, "the id is taken from the sequence once")
        row = Property.objects.values_list("reference", flat=True).get(pk=prop.pk)
        self.assertEqual(row, prop.reference)

    def test_references_are_unique_and_follow_the_ids(self):
        props = [Property.objects.create(**payload(i)) for i in range(20)]
        refs = [p.reference for p in props]
        self.assertEqual(len(set(refs)), 20)
        self.assertTrue(all(p.reference == f"PR-{p.pk:05d}" for p in props))

    def test_updating_an_existing_property_never_changes_or_regenerates_the_reference(self):
        prop = Property.objects.create(**payload(2))
        before = prop.reference
        prop.title, prop.price = "Renamed", Decimal("1234567")
        with CaptureQueriesContext(connection) as ctx:
            prop.save()
        self.assertEqual(sum("nextval" in q["sql"] for q in ctx.captured_queries), 0, "no new id is allocated for an update")
        self.assertEqual(len(statements(ctx, "UPDATE")), 1)
        self.assertEqual(len(statements(ctx, "INSERT")), 0)
        fresh = Property.objects.get(pk=prop.pk)
        self.assertEqual((fresh.reference, fresh.title), (before, "Renamed"))
        fresh.save(update_fields=["title"])
        self.assertEqual(Property.objects.get(pk=prop.pk).reference, before)

    def test_updating_through_the_api_keeps_the_reference(self):
        manager = make_user("m-ref@t.test", Role.MANAGER)
        prop = Property.objects.create(**payload(3))
        res = self.as_user(manager).patch(f"/api/properties/{prop.pk}/", {"title": "Via API", "reference": "HACKED"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()["reference"], prop.reference)
        self.assertEqual(Property.objects.get(pk=prop.pk).reference, prop.reference)

    def test_an_explicit_id_is_kept_and_needs_no_sequence_call(self):
        with CaptureQueriesContext(connection) as ctx:
            prop = Property(pk=424242, **payload(4))
            prop.save()
        self.assertEqual((prop.pk, prop.reference), (424242, "PR-424242"))
        self.assertEqual(sum("nextval" in q["sql"] for q in ctx.captured_queries), 0)
        self.assertEqual(len(statements(ctx, "INSERT")), 1)
        self.assertEqual(statements(ctx, "UPDATE"), [])

    def test_ids_from_the_sequence_never_collide_with_ids_from_other_inserts(self):
        first = Property.objects.create(**payload(5))
        # bulk_create inserts with the database's own default for the id: it draws from the SAME sequence
        bulk = Property.objects.bulk_create([Property(reference=f"BULK-{i}", **payload(100 + i)) for i in range(10)])
        second = Property.objects.create(**payload(6))
        ids = [first.pk, *[p.pk for p in bulk], second.pk]
        self.assertEqual(len(set(ids)), len(ids))
        self.assertGreater(second.pk, max(p.pk for p in bulk))

    def test_the_api_response_is_unchanged(self):
        manager = make_user("m-api@t.test", Role.MANAGER)
        res = self.as_user(manager).post("/api/properties/", payload(9) | {"price": "250000"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        expected = {"id", "reference", "title", "address", "city", "price", "property_type", "bedrooms", "bathrooms", "area_sqm", "status",
                    "description", "assigned_to", "cover_image", "image_count", "created_at", "updated_at"}
        self.assertEqual(set(body), expected)
        self.assertEqual(body["reference"], f"PR-{body['id']:05d}")

    def test_the_admin_site_creates_properties_through_the_same_path(self):
        tech = User.objects.create_user("tech-ref@t.test", "Correct-Horse-9-Battery!", role=Role.ADMIN, is_staff=True, is_superuser=True)
        self.client.force_login(tech)
        form = {"title": "Admin flat", "address": "1 Admin St", "city": "Cairo", "price": "900000", "property_type": "apartment",
                "bedrooms": 2, "bathrooms": 1, "status": "available", "description": "",
                "images-TOTAL_FORMS": 0, "images-INITIAL_FORMS": 0, "images-MIN_NUM_FORMS": 0, "images-MAX_NUM_FORMS": 1000}
        res = self.client.post("/django-admin/properties/property/add/", form)
        self.assertEqual(res.status_code, 302, getattr(res, "content", b"")[:300])
        prop = Property.objects.get(title="Admin flat")
        self.assertEqual(prop.reference, f"PR-{prop.pk:05d}")

    @override_settings(DEBUG=True)
    def test_the_demo_seed_command_uses_the_same_path(self):
        call_command("seed_demo", "--force", verbosity=0)
        props = list(Property.objects.all())
        self.assertGreater(len(props), 10)
        self.assertTrue(all(p.reference == f"PR-{p.pk:05d}" for p in props))
        self.assertEqual(len({p.reference for p in props}), len(props))


class LargeNumberTests(TransactionTestCase):
    reset_sequences = True

    def test_references_grow_past_five_digits_without_truncation(self):
        set_sequence(99999)
        refs = [Property.objects.create(**payload(i)).reference for i in range(3)]
        self.assertEqual(refs, ["PR-99999", "PR-100000", "PR-100001"])
        set_sequence(12345678)
        big = Property.objects.create(**payload(9))
        self.assertEqual(big.reference, "PR-12345678")
        self.assertLessEqual(len(big.reference), 20)
        self.assertEqual(Property.objects.get(pk=big.pk).reference, "PR-12345678")


class ConcurrencyTests(TransactionTestCase):
    """Real transactions on separate connections (threads)."""

    reset_sequences = True

    def setUp(self):
        self.manager = make_user("m-conc@t.test", Role.MANAGER)

    def test_two_creations_at_the_worst_moment_both_succeed(self):
        """Every creation pauses right after its INSERT (post_save): that is where the old design held an empty reference."""
        barrier = threading.Barrier(2)

        def pause(sender, instance, created, **kw):
            if created:
                try:
                    barrier.wait(timeout=1.5)
                except threading.BrokenBarrierError:
                    pass

        post_save.connect(pause, sender=Property, dispatch_uid="reference-test-pause")
        errors = []

        def worker(i):
            try:
                Property.objects.create(**payload(i))
            except Exception as e:  # noqa: BLE001
                errors.append(f"{type(e).__name__}: {e}")
            finally:
                connections.close_all()

        try:
            threads = [threading.Thread(target=worker, args=(i,)) for i in range(2)]
            [t.start() for t in threads]
            [t.join() for t in threads]
        finally:
            post_save.disconnect(sender=Property, dispatch_uid="reference-test-pause")
        self.assertEqual(errors, [])
        refs = sorted(Property.objects.values_list("reference", flat=True))
        self.assertEqual(len(refs), 2)
        self.assertEqual(len(set(refs)), 2)
        self.assertTrue(all(r.startswith("PR-") and r != "" for r in refs))

    def test_many_simultaneous_creations_all_succeed_with_distinct_references(self):
        failures = []

        def one(i):
            try:
                Property.objects.create(**payload(i))
            except Exception as e:  # noqa: BLE001
                failures.append(f"{type(e).__name__}: {e}")
            finally:
                connections.close_all()

        with ThreadPoolExecutor(8) as pool:
            list(pool.map(one, range(60)))
        self.assertEqual(failures, [])
        props = list(Property.objects.all())
        self.assertEqual(len(props), 60)
        self.assertEqual(len({p.reference for p in props}), 60)
        self.assertTrue(all(p.reference == f"PR-{p.pk:05d}" for p in props))

    def test_a_crash_right_after_the_insert_cannot_poison_later_creations(self):
        crashes = []

        def crash_once(sender, instance, created, **kw):
            if created and not crashes:
                crashes.append(instance.pk)
                raise RuntimeError("simulated crash right after the INSERT")

        post_save.connect(crash_once, sender=Property, dispatch_uid="reference-test-crash")
        try:
            with self.assertRaises(RuntimeError):
                Property.objects.create(**payload(1))
        finally:
            post_save.disconnect(sender=Property, dispatch_uid="reference-test-crash")
        self.assertEqual(Property.objects.filter(reference="").count(), 0, "no row without a reference, ever")
        survivor = Property.objects.get(pk=crashes[0])
        self.assertEqual(survivor.reference, f"PR-{survivor.pk:05d}")
        again = Property.objects.create(**payload(2))   # the old design failed here, and on every creation after it
        self.assertEqual(again.reference, f"PR-{again.pk:05d}")

    def test_simultaneous_requests_through_the_api(self):
        results = []

        def post(i):
            try:
                client = APIClient()
                client.force_authenticate(user=User.objects.get(pk=self.manager.pk))
                res = client.post("/api/properties/", payload(i) | {"price": "500000"}, format="json")
                results.append((res.status_code, res.json() if res.status_code == 201 else res.content[:120]))
            finally:
                connections.close_all()

        with ThreadPoolExecutor(8) as pool:
            list(pool.map(post, range(40)))
        self.assertEqual({code for code, _ in results}, {201}, [r for r in results if r[0] != 201][:3])
        refs = [body["reference"] for _, body in results]
        self.assertEqual(len(set(refs)), 40)
        self.assertTrue(all(body["reference"] == f"PR-{body['id']:05d}" for _, body in results))

"""Technical (staff / superuser) accounts belong to the provider. They never appear in, are never reachable through, and
are never selectable by the company-facing API, and they never count as a Company Admin. Records that already point at
a technical account must keep working."""
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Activity
from documents.models import Document
from leads.models import Lead, LeadNote
from properties.models import Property
from tasks.models import Task
from users.models import Role, User
from viewings.models import Viewing

from .base import PASSWORD, ApiTestCase, ids, make_user, results
from .test_assignment_rules import when


class TechnicalAccountTestCase(ApiTestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls.tech = User.objects.create_superuser("tech@t.test", PASSWORD, first_name="Provider", last_name="Tech")
        cls.staff_only = make_user("staff.only@t.test", Role.MANAGER, is_staff=True, first_name="Staffy")

    def technical(self):
        return (self.tech, self.staff_only)


class TechnicalAccountVisibilityTests(TechnicalAccountTestCase):
    def test_they_never_appear_in_the_user_list_for_any_role(self):
        for actor in (self.admin, self.manager, self.sales_a, self.tech):
            with self.subTest(actor=actor.email):
                listed = ids(self.as_user(actor).get("/api/users/"))
                self.assertFalse({self.tech.pk, self.staff_only.pk} & listed)
                self.assertTrue({self.admin.pk, self.manager.pk, self.sales_a.pk} <= listed)

    def test_they_cannot_be_found_through_search_or_filters(self):
        client = self.as_user(self.admin)
        for params in ({"search": "tech"}, {"search": "Provider"}, {"search": "staff.only"}, {"search": "Staffy"},
                       {"role": "admin"}, {"role": "manager"}, {"is_active": "true"}):
            with self.subTest(params=params):
                found = ids(client.get("/api/users/", params))
                self.assertFalse({self.tech.pk, self.staff_only.pk} & found)

    def test_their_detail_is_not_found_for_any_role(self):
        for actor in (self.admin, self.manager, self.sales_a):
            for target in self.technical():
                with self.subTest(actor=actor.role, target=target.email):
                    self.assertEqual(self.as_user(actor).get(f"/api/users/{target.pk}/").status_code, 404)

    def test_the_team_view_still_lists_every_company_account(self):
        listed = ids(self.as_user(self.admin).get("/api/users/"))
        self.assertEqual(listed, set(User.objects.filter(is_superuser=False, is_staff=False).values_list("id", flat=True)))

    def test_a_technical_account_can_still_log_in_and_use_its_own_profile(self):
        login = APIClient().post("/api/auth/login/", {"email": "tech@t.test", "password": PASSWORD}, format="json")
        self.assertEqual(login.status_code, 200)
        me = self.as_user(self.tech).get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["email"], "tech@t.test")

    def test_a_technical_admin_account_can_still_manage_company_users(self):
        response = self.as_user(self.tech).patch(f"/api/users/{self.sales_a.pk}/", {"job_title": "Senior"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)


class TechnicalAccountImmutabilityTests(TechnicalAccountTestCase):
    def snapshot(self, user):
        user.refresh_from_db()
        return (user.email, user.role, user.is_active, user.first_name, user.is_staff, user.is_superuser, user.password)

    def test_no_company_role_can_change_or_delete_a_technical_account(self):
        attempts = {
            "password": {"password": "Taken-Over-By-Admin-1!"},
            "role": {"role": "salesperson"},
            "email": {"email": "taken@t.test"},
            "deactivate": {"is_active": False},
            "name": {"first_name": "Hijacked"},
            "split": {"commission_split": "1.00"},
            "flags": {"is_staff": False, "is_superuser": False},
        }
        for actor in (self.admin, self.manager, self.sales_a):
            for target in self.technical():
                before = self.snapshot(target)
                for name, body in attempts.items():
                    with self.subTest(actor=actor.role, target=target.email, change=name):
                        client = self.as_user(actor)
                        full = {"email": target.email, "role": target.role, **body}
                        self.assertIn(client.patch(f"/api/users/{target.pk}/", body, format="json").status_code, (403, 404))
                        self.assertIn(client.put(f"/api/users/{target.pk}/", full, format="json").status_code, (403, 404))
                self.assertIn(self.as_user(actor).delete(f"/api/users/{target.pk}/").status_code, (403, 404, 405))
                self.assertEqual(self.snapshot(target), before, f"{actor.role} changed {target.email}")

    def test_a_superusers_password_cannot_be_replaced_so_the_old_one_still_works(self):
        self.as_user(self.admin).patch(f"/api/users/{self.tech.pk}/", {"password": "Taken-Over-By-Admin-1!"}, format="json")
        ok = APIClient().post("/api/auth/login/", {"email": "tech@t.test", "password": PASSWORD}, format="json")
        stolen = APIClient().post(
            "/api/auth/login/", {"email": "tech@t.test", "password": "Taken-Over-By-Admin-1!"}, format="json"
        )
        self.assertEqual((ok.status_code, stolen.status_code), (200, 401))

    def test_a_company_admin_cannot_create_an_account_that_clashes_with_a_technical_email(self):
        response = self.as_user(self.admin).post(
            "/api/users/",
            {"email": "TECH@t.test", "first_name": "X", "last_name": "Y", "role": "admin", "password": "Initial-Pass-12!"},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(User.objects.filter(email__iexact="tech@t.test").count(), 1)

    def test_creating_users_through_the_api_never_produces_a_technical_account(self):
        for role in ("admin", "manager", "salesperson"):
            response = self.as_user(self.admin).post(
                "/api/users/",
                {"email": f"{role}.n@t.test", "first_name": "N", "last_name": "N", "role": role,
                 "password": "Initial-Pass-12!", "is_staff": True, "is_superuser": True},
                format="json",
            )
            self.assertEqual(response.status_code, 201, response.content)
            created = User.objects.get(email=f"{role}.n@t.test")
            self.assertEqual((created.is_staff, created.is_superuser), (False, False))


class LastCompanyAdminWithTechnicalAccountsTests(TechnicalAccountTestCase):
    """A technical account with role=admin must never count as the remaining Company Admin."""

    def setUp(self):
        User.objects.filter(role=Role.ADMIN, is_superuser=False).exclude(pk=self.admin.pk).update(role=Role.MANAGER)
        self.assertEqual(self.tech.role, Role.ADMIN)  # create_superuser forces role=admin

    def attempt(self, method, body, target=None):
        target = target or self.admin
        payload = body if method == "patch" else {"email": target.email, "role": target.role, "is_active": True, **body}
        return getattr(self.as_user(self.admin), method)(f"/api/users/{target.pk}/", payload, format="json")

    def test_the_only_company_admin_cannot_step_down_just_because_a_superuser_exists(self):
        for method in ("patch", "put"):
            with self.subTest(method=method):
                response = self.attempt(method, {"role": "manager"})
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("At least one active Company Admin", response.content.decode())
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, Role.ADMIN)

    def test_the_only_company_admin_cannot_be_deactivated_just_because_a_superuser_exists(self):
        for method in ("patch", "put"):
            with self.subTest(method=method):
                self.assertEqual(self.attempt(method, {"is_active": False}).status_code, 400)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_several_technical_admins_still_do_not_count(self):
        User.objects.create_superuser("tech2@t.test", PASSWORD)
        self.assertEqual(self.attempt("patch", {"role": "salesperson", "is_active": False}).status_code, 400)

    def test_a_second_real_company_admin_unlocks_the_first_one(self):
        second = make_user("admin2@t.test", Role.ADMIN)
        self.assertEqual(self.attempt("patch", {"role": "manager"}).status_code, 200)
        # now `second` is the last one and is protected in turn
        self.assertEqual(self.as_user(second).patch(f"/api/users/{second.pk}/", {"role": "manager"}, format="json").status_code, 400)

    def test_an_inactive_company_admin_does_not_count_either(self):
        make_user("admin3@t.test", Role.ADMIN, is_active=False)
        self.assertEqual(self.attempt("patch", {"role": "manager"}).status_code, 400)

    def test_the_company_admin_can_still_edit_other_fields_of_their_own_account(self):
        self.assertEqual(self.attempt("patch", {"first_name": "Renamed", "phone": "01"}).status_code, 200)


class AssigningWorkToTechnicalAccountsTests(TechnicalAccountTestCase):
    """New assignments to a technical account are refused everywhere a user can be chosen."""

    def setUp(self):
        self.lead_a = self.lead(self.sales_a)
        self.deal_a = self.deal(self.sales_a, lead=self.lead_a)
        self.task_a = self.task(self.sales_a, lead=self.lead_a)
        self.viewing_a = self.viewing(self.sales_a, lead=self.lead_a)
        self.prop_a = self.prop(self.sales_a)

    def refused(self, response, what):
        self.assertEqual(response.status_code, 400, f"{what}: {response.status_code} {response.content[:200]!r}")
        self.assertIn("assigned_to_id", response.json(), what)

    def test_every_assignment_path_refuses_a_technical_account(self):
        slot = {"start_at": when(4), "end_at": when(4)}
        for target in self.technical():
            for actor in (self.manager, self.admin):
                with self.subTest(actor=actor.role, target=target.email):
                    c, t = self.as_user(actor), target.pk
                    self.refused(c.post("/api/leads/", {"first_name": "N", "phone": "01", "assigned_to_id": t}, format="json"), "lead create")
                    self.refused(c.patch(f"/api/leads/{self.lead_a.pk}/", {"assigned_to_id": t}, format="json"), "lead patch")
                    self.refused(c.post(f"/api/leads/{self.lead_a.pk}/assign/", {"assigned_to_id": t}, format="json"), "lead assign")
                    self.refused(c.patch(f"/api/deals/{self.deal_a.pk}/", {"assigned_to_id": t}, format="json"), "deal patch")
                    self.refused(
                        c.post("/api/deals/", {"lead_id": self.lead(self.sales_b).pk, "property_id": self.prop().pk, "assigned_to_id": t}, format="json"),
                        "deal create",
                    )
                    self.refused(c.post("/api/tasks/", {"title": "T", "due_at": when(), "type": "call", "assigned_to_id": t}, format="json"), "task create")
                    self.refused(c.patch(f"/api/tasks/{self.task_a.pk}/", {"assigned_to_id": t}, format="json"), "task patch")
                    self.refused(
                        c.post("/api/viewings/", {"lead_id": self.lead_a.pk, "property_id": self.prop().pk, "assigned_to_id": t, **slot}, format="json"),
                        "viewing create",
                    )
                    self.refused(c.patch(f"/api/viewings/{self.viewing_a.pk}/", {"assigned_to_id": t}, format="json"), "viewing patch")
                    self.refused(
                        c.post("/api/properties/", {"title": "P", "address": "A", "city": "C", "price": "1", "assigned_to_id": t}, format="json"),
                        "property create",
                    )
                    self.refused(c.patch(f"/api/properties/{self.prop_a.pk}/", {"assigned_to_id": t}, format="json"), "property patch")
        # nothing was reassigned
        self.assertEqual(Lead.objects.filter(assigned_to__in=self.technical()).count(), 0)
        self.assertEqual(Task.objects.filter(assigned_to__in=self.technical()).count(), 0)
        self.assertEqual(Viewing.objects.filter(assigned_to__in=self.technical()).count(), 0)
        self.assertEqual(Property.objects.filter(assigned_to__in=self.technical()).count(), 0)

    def test_regular_and_inactive_assignees_behave_as_before(self):
        c = self.as_user(self.manager)
        self.assertEqual(c.patch(f"/api/leads/{self.lead_a.pk}/", {"assigned_to_id": self.sales_b.pk}, format="json").status_code, 200)
        User.objects.filter(pk=self.sales_a.pk).update(is_active=False)
        self.refused(c.patch(f"/api/leads/{self.lead_a.pk}/", {"assigned_to_id": self.sales_a.pk}, format="json"), "inactive user")

    def test_a_manager_can_still_assign_to_a_company_admin(self):
        self.assertEqual(
            self.as_user(self.manager).patch(f"/api/leads/{self.lead_a.pk}/", {"assigned_to_id": self.admin.pk}, format="json").status_code, 200
        )

    def test_the_acting_technical_users_own_records_are_unaffected(self):
        """A technical admin using the CRM still owns what they create; only picking one as someone else's assignee is refused."""
        response = self.as_user(self.tech).post("/api/leads/", {"first_name": "Own", "phone": "01"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)


class LegacyRecordsLinkedToTechnicalAccountsTests(TechnicalAccountTestCase):
    """Old rows that point at a technical account must stay readable and editable."""

    def setUp(self):
        self.lead_t = self.lead(self.tech, first_name="Legacy")
        self.deal_t = self.deal(self.tech, lead=self.lead_t)
        self.task_t = self.task(self.tech, lead=self.lead_t)  # created_by is the owner too
        self.viewing_t = self.viewing(self.tech, lead=self.lead_t)
        self.prop_t = self.prop(self.tech)

    def test_records_assigned_to_a_technical_account_are_listed_and_show_who_owns_them(self):
        client = self.as_user(self.manager)
        for name, record in (("leads", self.lead_t), ("deals", self.deal_t), ("tasks", self.task_t),
                             ("viewings", self.viewing_t), ("properties", self.prop_t)):
            with self.subTest(resource=name):
                self.assertIn(record.pk, ids(client.get(f"/api/{name}/")))
                detail = client.get(f"/api/{name}/{record.pk}/")
                self.assertEqual(detail.status_code, 200)
                self.assertEqual(detail.json()["assigned_to"]["full_name"], "Provider Tech")

    def test_resending_the_unchanged_technical_assignee_keeps_old_records_editable(self):
        c, t = self.as_user(self.manager), self.tech.pk
        for url, body in ((f"/api/leads/{self.lead_t.pk}/", {"assigned_to_id": t, "first_name": "Edited"}),
                          (f"/api/deals/{self.deal_t.pk}/", {"assigned_to_id": t, "notes": "edited"}),
                          (f"/api/tasks/{self.task_t.pk}/", {"assigned_to_id": t, "title": "edited"}),
                          (f"/api/viewings/{self.viewing_t.pk}/", {"assigned_to_id": t}),
                          (f"/api/properties/{self.prop_t.pk}/", {"assigned_to_id": t, "title": "edited"})):
            with self.subTest(url=url):
                self.assertEqual(c.patch(url, body, format="json").status_code, 200)
        self.lead_t.refresh_from_db()
        self.assertEqual((self.lead_t.assigned_to, self.lead_t.first_name), (self.tech, "Edited"))

    def test_after_handing_a_legacy_record_to_a_company_member_it_cannot_go_back(self):
        c = self.as_user(self.manager)
        self.assertEqual(c.patch(f"/api/leads/{self.lead_t.pk}/", {"assigned_to_id": self.sales_a.pk}, format="json").status_code, 200)
        self.assertEqual(c.patch(f"/api/leads/{self.lead_t.pk}/", {"assigned_to_id": self.tech.pk}, format="json").status_code, 400)

    def test_the_unchanged_allowance_does_not_open_a_door_to_other_technical_accounts(self):
        response = self.as_user(self.manager).patch(
            f"/api/leads/{self.lead_t.pk}/", {"assigned_to_id": self.staff_only.pk}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_a_salesperson_still_cannot_use_the_allowance_to_reassign(self):
        Lead.objects.filter(pk=self.lead_t.pk).update(assigned_to=self.sales_a)
        response = self.as_user(self.sales_a).patch(f"/api/leads/{self.lead_t.pk}/", {"assigned_to_id": self.tech.pk}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_old_authorship_and_audit_history_linked_to_a_technical_account_still_reads(self):
        LeadNote.objects.create(lead=self.lead_t, author=self.tech, body="note by provider")
        doc = self.document(self.deal_t, self.tech)
        Activity.objects.create(actor=self.tech, kind=Activity.Kind.COMMISSION, message="done by provider", lead=self.lead_t)
        manager = self.as_user(self.manager)
        notes = manager.get(f"/api/leads/{self.lead_t.pk}/notes/")
        self.assertEqual(notes.status_code, 200)
        self.assertIn("Provider Tech", notes.content.decode())
        docs = manager.get("/api/documents/")
        self.assertIn(doc.pk, ids(docs))
        self.assertIn("Provider Tech", docs.content.decode())
        dash = manager.get("/api/dashboard/")
        self.assertEqual(dash.status_code, 200)
        self.assertIn("done by provider", dash.content.decode())
        self.assertIn("Provider Tech", dash.content.decode())
        self.assertEqual(Task.objects.get(pk=self.task_t.pk).created_by, self.tech)
        self.assertEqual(manager.get(f"/api/tasks/{self.task_t.pk}/").status_code, 200)

    def test_a_commission_earned_by_a_technical_account_stays_visible_to_admin_and_manager(self):
        deal, commission = self.closed_deal_with_commission(self.tech)
        for actor in (self.admin, self.manager):
            with self.subTest(actor=actor.role):
                rows = {r["id"]: r for r in results(self.as_user(actor).get("/api/commissions/"))}
                self.assertEqual(rows[commission.pk]["salesperson"]["full_name"], "Provider Tech")
                self.assertEqual(self.as_user(actor).get(f"/api/deals/{deal.pk}/").status_code, 200)

    def test_records_of_a_deactivated_technical_account_still_read(self):
        User.objects.filter(pk=self.tech.pk).update(is_active=False)
        detail = self.as_user(self.manager).get(f"/api/leads/{self.lead_t.pk}/")
        self.assertEqual(detail.status_code, 200)


class DemoSeedTests(ApiTestCase):
    def test_seeded_demo_accounts_are_company_accounts_and_the_demo_admin_is_a_company_admin(self):
        with self.settings(DEBUG=True):  # the test runner forces DEBUG off, and seed_demo refuses to run without it
            call_command("seed_demo", force=True, verbosity=0)
        self.assertFalse(User.objects.filter(email__endswith="@crm.local").filter(is_staff=True).exists())
        self.assertFalse(User.objects.filter(email__endswith="@crm.local").filter(is_superuser=True).exists())
        admin = User.objects.get(email="admin@crm.local")
        self.assertEqual(admin.role, Role.ADMIN)
        listed = ids(self.as_user(self.manager).get("/api/users/"))
        self.assertIn(admin.pk, listed)

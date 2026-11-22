"""Account protection and commission permissions: normal flows plus attempts to get around them (PATCH and PUT)."""
from commissions.models import Commission
from users.models import Role, User

from .base import PASSWORD, ApiTestCase, make_user, results


def user_body(email, role="salesperson", **extra):
    return {"email": email, "first_name": "N", "last_name": "H", "role": role, "password": "Initial-Pass-12!", **extra}


class EmailHandlingTests(ApiTestCase):
    def post(self, email, **extra):
        return self.as_user(self.admin).post("/api/users/", user_body(email, **extra), format="json")

    def test_every_case_variant_of_an_existing_email_is_a_clean_400_not_a_500(self):
        for variant in ("sales.a@t.test", "SALES.A@T.TEST", "Sales.A@T.Test", "  sales.a@t.test "):
            with self.subTest(email=variant):
                response = self.post(variant)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("email", response.json())
                self.assertIn("already exists", response.content.decode())
        self.assertEqual(User.objects.filter(email__iexact="sales.a@t.test").count(), 1)

    def test_new_emails_are_stored_lowercase_and_trimmed(self):
        self.assertEqual(self.post("  New.Person@T.Test ").status_code, 201)
        self.assertTrue(User.objects.filter(email="new.person@t.test").exists())

    def test_changing_an_email_to_one_that_exists_in_another_case_is_refused(self):
        response = self.as_user(self.admin).patch(
            f"/api/users/{self.sales_b.pk}/", {"email": "SALES.A@t.test"}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.sales_b.refresh_from_db()
        self.assertEqual(self.sales_b.email, "sales.b@t.test")

    def test_resending_ones_own_email_in_another_case_is_not_a_clash(self):
        response = self.as_user(self.admin).patch(
            f"/api/users/{self.sales_b.pk}/", {"email": "Sales.B@T.test", "first_name": "Bee"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.sales_b.refresh_from_db()
        self.assertEqual((self.sales_b.email, self.sales_b.first_name), ("sales.b@t.test", "Bee"))

    def test_login_still_works_in_any_case(self):
        self.post("Case.Test@T.Test")
        from rest_framework.test import APIClient

        response = APIClient().post(
            "/api/auth/login/", {"email": "CASE.TEST@t.test", "password": "Initial-Pass-12!"}, format="json"
        )
        self.assertEqual(response.status_code, 200)


class LastAdminProtectionTests(ApiTestCase):
    """role=admin and active: at least one must always remain. Counts only active admins."""

    def setUp(self):
        User.objects.exclude(pk=self.admin.pk).filter(role=Role.ADMIN).update(role=Role.MANAGER)

    def attempt(self, method, body, target=None):
        target = target or self.admin
        payload = body if method == "patch" else {"email": target.email, "role": target.role, "is_active": True, **body}
        return getattr(self.as_user(self.admin), method)(f"/api/users/{target.pk}/", payload, format="json")

    def test_the_only_admin_cannot_be_demoted_by_patch_or_put(self):
        for method in ("patch", "put"):
            with self.subTest(method=method):
                response = self.attempt(method, {"role": "manager"})
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("At least one active Company Admin", response.content.decode())
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, Role.ADMIN)

    def test_the_only_admin_cannot_be_deactivated_by_patch_or_put(self):
        for method in ("patch", "put"):
            with self.subTest(method=method):
                response = self.attempt(method, {"is_active": False})
                self.assertEqual(response.status_code, 400, response.content)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_demoting_and_deactivating_in_one_request_is_still_refused(self):
        self.assertEqual(self.attempt("patch", {"role": "salesperson", "is_active": False}).status_code, 400)

    def test_the_only_admin_can_still_edit_everything_else(self):
        self.assertEqual(self.attempt("patch", {"first_name": "Renamed", "phone": "01", "role": "admin"}).status_code, 200)
        self.assertEqual(self.attempt("patch", {"password": "Another-Good-9!"}).status_code, 200)

    def test_an_admin_can_be_demoted_or_deactivated_while_another_active_admin_exists(self):
        second = make_user("admin2@t.test", Role.ADMIN)
        self.assertEqual(self.attempt("patch", {"role": "manager"}, target=second).status_code, 200)
        second.refresh_from_db()
        self.assertEqual(second.role, Role.MANAGER)
        Role_admin_again = self.as_user(self.admin).patch(f"/api/users/{second.pk}/", {"role": "admin"}, format="json")
        self.assertEqual(Role_admin_again.status_code, 200)
        self.assertEqual(self.attempt("patch", {"is_active": False}, target=second).status_code, 200)

    def test_an_inactive_admin_does_not_count_as_the_remaining_admin(self):
        other = make_user("admin2@t.test", Role.ADMIN, is_active=False)
        self.assertEqual(self.attempt("patch", {"role": "manager"}).status_code, 400)
        self.assertEqual(self.attempt("patch", {"is_active": True}, target=other).status_code, 200)  # reactivating is fine
        self.assertEqual(self.attempt("patch", {"role": "manager"}).status_code, 200)  # now someone else remains

    def test_promoting_a_successor_first_lets_the_original_admin_step_down(self):
        self.assertEqual(self.attempt("patch", {"role": "manager"}).status_code, 400)
        self.assertEqual(self.attempt("patch", {"role": "admin"}, target=self.manager).status_code, 200)
        self.assertEqual(self.attempt("patch", {"role": "manager"}).status_code, 200)

    def test_demoting_a_non_admin_or_editing_an_inactive_admin_is_never_blocked(self):
        self.assertEqual(self.attempt("patch", {"role": "salesperson"}, target=self.manager).status_code, 200)
        self.assertEqual(self.attempt("patch", {"is_active": False}, target=self.sales_a).status_code, 200)


class DjangoAdminAccessTests(ApiTestCase):
    """Company Admins are application admins only. Django-admin access is for technical accounts."""

    def test_users_created_through_the_api_are_never_staff_or_superuser(self):
        for role in ("admin", "manager", "salesperson"):
            with self.subTest(role=role):
                response = self.as_user(self.admin).post("/api/users/", user_body(f"{role}.x@t.test", role), format="json")
                self.assertEqual(response.status_code, 201, response.content)
                created = User.objects.get(email=f"{role}.x@t.test")
                self.assertEqual((created.is_staff, created.is_superuser), (False, False))

    def test_promoting_or_editing_an_admin_through_the_api_never_grants_staff(self):
        client = self.as_user(self.admin)
        self.assertEqual(client.patch(f"/api/users/{self.manager.pk}/", {"role": "admin"}, format="json").status_code, 200)
        self.assertEqual(client.patch(f"/api/users/{self.admin.pk}/", {"first_name": "Renamed"}, format="json").status_code, 200)
        for user in (self.admin, self.manager):
            user.refresh_from_db()
            self.assertFalse(user.is_staff, user.email)

    def test_staff_and_superuser_cannot_be_granted_or_revoked_through_the_api(self):
        client = self.as_user(self.admin)
        client.patch(f"/api/users/{self.sales_a.pk}/", {"is_staff": True, "is_superuser": True}, format="json")
        self.sales_a.refresh_from_db()
        self.assertEqual((self.sales_a.is_staff, self.sales_a.is_superuser), (False, False))
        # technical accounts themselves are out of reach of this API: see test_technical_accounts.py

    def test_a_company_admin_cannot_use_the_django_admin_site_but_a_technical_account_can(self):
        """The site is mounted by Django itself (production nginx additionally blocks the path). What keeps a Company
        Admin out is is_staff=False; a technical staff account still gets in."""
        self.client.force_login(self.admin)
        response = self.client.get("/django-admin/")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/django-admin/login/", response["Location"])
        from django.contrib import admin
        from django.test import RequestFactory

        def may_use_admin_site(user):  # the permission rule itself (rendering needs collected static files)
            request = RequestFactory().get("/django-admin/")
            request.user = user
            return admin.site.has_permission(request)

        self.assertFalse(may_use_admin_site(self.admin))
        self.assertFalse(may_use_admin_site(self.manager))
        self.assertTrue(may_use_admin_site(User.objects.create_superuser("tech@t.test", PASSWORD)))


class CommissionSplitVisibilityTests(ApiTestCase):
    """commission_split is Admin-only data, removed by the serializer itself (not hidden by the frontend)."""

    def listed(self, actor):
        response = self.as_user(actor).get("/api/users/")
        self.assertEqual(response.status_code, 200)
        return results(response)

    def test_admin_receives_it_in_list_detail_create_and_update(self):
        client = self.as_user(self.admin)
        self.assertTrue(all("commission_split" in row for row in self.listed(self.admin)))
        self.assertEqual(client.get(f"/api/users/{self.sales_a.pk}/").json()["commission_split"], "40.00")
        created = client.post("/api/users/", user_body("split@t.test", commission_split="35.00"), format="json")
        self.assertEqual(created.json()["commission_split"], "35.00")
        updated = client.patch(f"/api/users/{self.sales_a.pk}/", {"commission_split": "45.50"}, format="json")
        self.assertEqual(updated.json()["commission_split"], "45.50")
        self.sales_a.refresh_from_db()
        self.assertEqual(str(self.sales_a.commission_split), "45.50")

    def test_manager_never_receives_it_in_list_or_detail(self):
        client = self.as_user(self.manager)
        rows = self.listed(self.manager)
        self.assertTrue(rows)
        self.assertFalse([r for r in rows if "commission_split" in r])
        for target in (self.sales_a, self.admin, self.manager):
            self.assertNotIn("commission_split", client.get(f"/api/users/{target.pk}/").json())

    def test_manager_still_receives_the_professional_contact_data(self):
        row = next(r for r in self.listed(self.manager) if r["id"] == self.sales_a.pk)
        self.assertTrue({"id", "email", "phone", "job_title", "role", "is_active", "full_name"} <= set(row))

    def test_salesperson_never_receives_it_in_the_team_list(self):
        rows = self.listed(self.sales_a)
        self.assertFalse([r for r in rows if "commission_split" in r])
        self.assertNotIn("email", rows[0])  # still only id / full_name / role

    def test_own_profile_and_login_payload_only_include_it_for_admins(self):
        from rest_framework.test import APIClient

        for user, expected in ((self.admin, True), (self.manager, False), (self.sales_a, False)):
            with self.subTest(user=user.role):
                me = self.as_user(user).get("/api/auth/me/").json()
                self.assertEqual("commission_split" in me, expected)
                patched = self.as_user(user).patch("/api/auth/me/", {"first_name": "Same"}, format="json").json()
                self.assertEqual("commission_split" in patched, expected)
                login = APIClient().post("/api/auth/login/", {"email": user.email, "password": PASSWORD}, format="json").json()
                self.assertEqual("commission_split" in login["user"], expected)

    def test_non_admins_cannot_write_it(self):
        for actor in (self.manager, self.sales_a):
            with self.subTest(actor=actor.role):
                response = self.as_user(actor).patch(
                    f"/api/users/{self.sales_b.pk}/", {"commission_split": "99.00"}, format="json"
                )
                self.assertEqual(response.status_code, 403)
        self.as_user(self.sales_a).patch("/api/auth/me/", {"commission_split": "99.00"}, format="json")
        self.sales_a.refresh_from_db()
        self.assertEqual(str(self.sales_a.commission_split), "40.00")

    def test_the_split_still_drives_new_commissions(self):
        """Hiding the field must not change the calculation that uses it."""
        _, commission = self.closed_deal_with_commission(self.sales_a)
        self.assertEqual(str(commission.agent_split), "40.00")


class CommissionApprovalTests(ApiTestCase):
    def setUp(self):
        _, self.commission = self.closed_deal_with_commission(self.sales_a)
        self.url = f"/api/commissions/{self.commission.pk}"

    def status(self):
        return Commission.objects.get(pk=self.commission.pk).status

    def attempts(self, client):
        return {
            "approve": client.post(f"{self.url}/approve/"),
            "mark-paid": client.post(f"{self.url}/mark-paid/"),
            "terms PATCH": client.patch(f"{self.url}/terms/", {"deductions": "1.00"}, format="json"),
        }

    def test_manager_cannot_approve_pay_or_change_terms_but_is_refused_cleanly(self):
        for name, response in self.attempts(self.as_user(self.manager)).items():
            with self.subTest(action=name):
                self.assertEqual(response.status_code, 403, response.content)
        self.commission.refresh_from_db()
        self.assertEqual((self.commission.status, str(self.commission.deductions)), ("pending", "0.00"))

    def test_manager_cannot_pay_even_after_an_admin_approved(self):
        self.assertEqual(self.as_user(self.admin).post(f"{self.url}/approve/").status_code, 200)
        self.assertEqual(self.as_user(self.manager).post(f"{self.url}/mark-paid/").status_code, 403)
        self.assertEqual(self.status(), Commission.Status.APPROVED)

    def test_salesperson_cannot_approve_pay_or_change_terms_on_their_own_commission(self):
        for name, response in self.attempts(self.as_user(self.sales_a)).items():
            with self.subTest(action=name):
                self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(self.status(), Commission.Status.PENDING)

    def test_admin_runs_the_whole_flow_and_records_who_approved(self):
        client = self.as_user(self.admin)
        self.assertEqual(client.patch(f"{self.url}/terms/", {"deductions": "10.00"}, format="json").status_code, 200)
        self.assertEqual(client.post(f"{self.url}/mark-paid/").status_code, 400)  # must be approved first
        self.assertEqual(client.post(f"{self.url}/approve/").status_code, 200)
        self.assertEqual(client.post(f"{self.url}/approve/").status_code, 400)  # already approved
        self.assertEqual(client.post(f"{self.url}/mark-paid/").status_code, 200)
        self.assertEqual(client.patch(f"{self.url}/terms/", {"deductions": "0"}, format="json").status_code, 400)  # paid
        self.commission.refresh_from_db()
        self.assertEqual((self.commission.status, self.commission.approved_by), ("paid", self.admin))

    def test_manager_can_follow_the_status_of_the_whole_teams_commissions(self):
        _, other = self.closed_deal_with_commission(self.sales_b)
        client = self.as_user(self.manager)
        rows = {r["id"]: r for r in results(client.get("/api/commissions/"))}
        self.assertTrue({self.commission.pk, other.pk} <= set(rows))
        self.assertEqual(rows[self.commission.pk]["status"], "pending")
        self.assertEqual(client.get(f"{self.url}/").status_code, 200)
        self.assertEqual(client.get("/api/commissions/", {"status": "pending", "salesperson": self.sales_b.pk}).status_code, 200)
        self.assertEqual(client.get("/api/commissions/summary/").status_code, 200)

    def test_salesperson_still_sees_only_their_own_commissions(self):
        _, other = self.closed_deal_with_commission(self.sales_b)
        ids_seen = {r["id"] for r in results(self.as_user(self.sales_a).get("/api/commissions/"))}
        self.assertEqual(ids_seen, {self.commission.pk})
        self.assertEqual(self.as_user(self.sales_a).get(f"/api/commissions/{other.pk}/").status_code, 404)

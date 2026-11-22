from users.models import Role, User

from .base import PASSWORD, ApiTestCase, ids, make_user, results


def new_user(email="new.hire@t.test", role="salesperson", **extra):
    return {
        "email": email, "first_name": "New", "last_name": "Hire", "role": role, "password": "Initial-Pass-12!", **extra
    }


class UserManagementTests(ApiTestCase):
    # ---- who may manage accounts ----
    def test_admin_can_create_every_role(self):
        client = self.as_user(self.admin)
        for role in ("salesperson", "manager", "admin"):
            with self.subTest(role=role):
                response = client.post("/api/users/", new_user(f"{role}.new@t.test", role), format="json")
                self.assertEqual(response.status_code, 201, response.content)
                created = User.objects.get(email=f"{role}.new@t.test")
                self.assertEqual(created.role, role)
                self.assertFalse(created.is_superuser, "API-created users must never be Django superusers")
                self.assertTrue(created.check_password("Initial-Pass-12!"))

    def test_manager_and_salesperson_cannot_create_users(self):
        for actor in (self.manager, self.sales_a):
            with self.subTest(actor=actor.role):
                response = self.as_user(actor).post("/api/users/", new_user(f"x.{actor.role}@t.test"), format="json")
                self.assertEqual(response.status_code, 403)
                self.assertFalse(User.objects.filter(email=f"x.{actor.role}@t.test").exists())

    def test_manager_and_salesperson_cannot_edit_anyone_including_themselves(self):
        for actor in (self.manager, self.sales_a):
            for target in (self.sales_b, actor):
                with self.subTest(actor=actor.role, target=target.email):
                    for method in ("patch", "put"):
                        response = getattr(self.as_user(actor), method)(
                            f"/api/users/{target.pk}/", {"role": "admin", "first_name": "Hacked"}, format="json"
                        )
                        self.assertEqual(response.status_code, 403)
        self.sales_a.refresh_from_db()
        self.manager.refresh_from_db()
        self.assertEqual((self.sales_a.role, self.manager.role), ("salesperson", "manager"))

    def test_admin_can_change_role_deactivate_and_reset_password(self):
        client = self.as_user(self.admin)
        self.assertEqual(
            client.patch(f"/api/users/{self.sales_a.pk}/", {"role": "manager"}, format="json").status_code, 200
        )
        self.assertEqual(
            client.patch(f"/api/users/{self.sales_a.pk}/", {"is_active": False}, format="json").status_code, 200
        )
        self.assertEqual(
            client.patch(f"/api/users/{self.sales_b.pk}/", {"password": "Reset-By-Admin-1!"}, format="json").status_code,
            200,
        )
        self.sales_a.refresh_from_db()
        self.sales_b.refresh_from_db()
        self.assertEqual((self.sales_a.role, self.sales_a.is_active), ("manager", False))
        self.assertTrue(self.sales_b.check_password("Reset-By-Admin-1!"))
        self.assertFalse(self.sales_b.check_password(PASSWORD))

    def test_users_cannot_be_deleted_through_the_api(self):
        for actor in (self.admin, self.manager, self.sales_a):
            self.assertIn(self.as_user(actor).delete(f"/api/users/{self.sales_b.pk}/").status_code, (403, 405))
        self.assertTrue(User.objects.filter(pk=self.sales_b.pk).exists())

    def test_superuser_and_staff_flags_cannot_be_set_through_the_api(self):
        client = self.as_user(self.admin)
        client.post("/api/users/", new_user("flags@t.test", is_superuser=True, is_staff=True), format="json")
        self.assertFalse(User.objects.get(email="flags@t.test").is_superuser)
        client.patch(f"/api/users/{self.sales_b.pk}/", {"is_superuser": True}, format="json")
        self.sales_b.refresh_from_db()
        self.assertFalse(self.sales_b.is_superuser)

    # ---- validation ----
    def test_password_is_required_and_validated_on_create(self):
        client = self.as_user(self.admin)
        no_pw = new_user("nopw@t.test")
        no_pw.pop("password")
        self.assertEqual(client.post("/api/users/", no_pw, format="json").status_code, 400)
        self.assertEqual(
            client.post("/api/users/", new_user("short@t.test", password="short"), format="json").status_code, 400
        )
        self.assertEqual(
            client.post("/api/users/", new_user("common@t.test", password="password123"), format="json").status_code, 400
        )

    def test_duplicate_email_is_rejected(self):
        response = self.as_user(self.admin).post("/api/users/", new_user("sales.a@t.test"), format="json")
        self.assertEqual(response.status_code, 400)

    def test_email_is_stored_lowercase(self):
        self.as_user(self.admin).post("/api/users/", new_user("Mixed.Case@T.Test"), format="json")
        self.assertTrue(User.objects.filter(email="mixed.case@t.test").exists())

    def test_email_differing_only_by_case_is_a_clean_400(self):
        client = self.as_user(self.admin)
        client.raise_request_exception = False
        response = client.post("/api/users/", new_user("SALES.A@T.TEST"), format="json")
        self.assertEqual(response.status_code, 400, f"got {response.status_code}")

    # ---- what each role can see of the team ----
    def test_salesperson_sees_only_active_users_with_minimal_fields(self):
        User.objects.filter(pk=self.sales_b.pk).update(is_active=False)
        response = self.as_user(self.sales_a).get("/api/users/")
        self.assertEqual(response.status_code, 200)
        rows = results(response)
        self.assertNotIn(self.sales_b.pk, {r["id"] for r in rows})
        self.assertEqual({tuple(sorted(r)) for r in rows}, {("full_name", "id", "role")})

    def test_manager_sees_inactive_users_too(self):
        User.objects.filter(pk=self.sales_b.pk).update(is_active=False)
        self.assertIn(self.sales_b.pk, ids(self.as_user(self.manager).get("/api/users/")))

    def test_manager_sees_the_professional_contact_data_needed_to_run_the_team(self):
        row = next(r for r in results(self.as_user(self.manager).get("/api/users/")) if r["id"] == self.sales_a.pk)
        self.assertTrue({"email", "phone", "job_title", "role", "is_active", "full_name"} <= set(row))

    def test_admin_sees_commission_split(self):
        row = next(r for r in results(self.as_user(self.admin).get("/api/users/")) if r["id"] == self.sales_a.pk)
        self.assertEqual(row["commission_split"], "40.00")

    def test_manager_never_receives_commission_split(self):
        client = self.as_user(self.manager)
        listed = results(client.get("/api/users/"))
        self.assertTrue(listed)
        self.assertFalse([r for r in listed if "commission_split" in r], "commission_split leaked in the list")
        detail = client.get(f"/api/users/{self.sales_a.pk}/").json()
        self.assertNotIn("commission_split", detail, "commission_split leaked in the detail")

    # ---- guardrails the Company Admin needs ----
    def _only_admin(self):
        User.objects.exclude(pk=self.admin.pk).filter(role=Role.ADMIN).update(role=Role.MANAGER)
        self.assertEqual(User.objects.filter(role=Role.ADMIN, is_active=True).count(), 1)

    def test_last_admin_cannot_demote_themselves(self):
        self._only_admin()
        response = self.as_user(self.admin).patch(f"/api/users/{self.admin.pk}/", {"role": "manager"}, format="json")
        self.assertDenied(response)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, Role.ADMIN)

    def test_last_admin_cannot_deactivate_themselves(self):
        self._only_admin()
        response = self.as_user(self.admin).patch(f"/api/users/{self.admin.pk}/", {"is_active": False}, format="json")
        self.assertDenied(response)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.is_active)

    def test_an_admin_may_demote_themselves_when_another_active_admin_exists(self):
        other = make_user("admin2@t.test", Role.ADMIN)
        response = self.as_user(self.admin).patch(f"/api/users/{self.admin.pk}/", {"role": "manager"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(User.objects.get(pk=other.pk).is_active)

    def test_company_admin_never_becomes_django_staff(self):
        client = self.as_user(self.admin)
        client.patch(f"/api/users/{self.admin.pk}/", {"first_name": "Renamed"}, format="json")
        client.patch(f"/api/users/{self.manager.pk}/", {"role": "admin"}, format="json")
        self.admin.refresh_from_db()
        self.manager.refresh_from_db()
        self.assertFalse(self.admin.is_staff)
        self.assertFalse(self.manager.is_staff)

"""Forced password change and token revocation, tested with REAL tokens (force_authenticate would bypass both rules)."""
import time

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from users.models import Role, User

from .base import PASSWORD, ApiTestCase, make_user

NEW = "Brand-New-Passw0rd!"
TEMP = "Temporary-Pass-77!"


def login(email, password):
    return APIClient().post("/api/auth/login/", {"email": email, "password": password}, format="json")


def bearer(access):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    return client


def refresh(token):
    return APIClient().post("/api/auth/refresh/", {"refresh": token}, format="json")


class MustChangePasswordEnforcementTests(ApiTestCase):
    """An account flagged must_change_password can do exactly two things until it changes the password."""

    def setUp(self):
        self.user = make_user("fresh@t.test", Role.ADMIN, must_change_password=True)
        self.tokens = login("fresh@t.test", PASSWORD).json()
        self.client = bearer(self.tokens["access"])

    def test_login_itself_works_and_reports_the_flag(self):
        response = login("fresh@t.test", PASSWORD)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["user"]["must_change_password"])

    def test_every_other_endpoint_is_blocked_by_the_server_with_a_clear_code(self):
        blocked = ["/api/leads/", "/api/properties/", "/api/deals/", "/api/tasks/", "/api/viewings/", "/api/commissions/",
                   "/api/documents/", "/api/notifications/", "/api/users/", "/api/dashboard/", "/api/analytics/summary/"]
        for url in blocked:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 403, url)
                self.assertEqual(response.json()["code"], "password_change_required")

    def test_writes_are_blocked_too_even_for_an_admin(self):
        self.assertEqual(self.client.post("/api/leads/", {"first_name": "X", "phone": "01"}, format="json").status_code, 403)
        self.assertEqual(self.client.post("/api/users/", {"email": "n@t.test", "password": "Initial-Pass-12!"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch("/api/auth/me/", {"first_name": "Z"}, format="json").status_code, 403)

    def test_only_reading_the_own_profile_and_changing_the_password_are_allowed(self):
        me = self.client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertTrue(me.json()["must_change_password"])
        wrong = self.client.post("/api/auth/change-password/", {"current_password": "nope", "new_password": NEW}, format="json")
        self.assertEqual(wrong.status_code, 400)  # reachable, and validated

    def test_the_refresh_endpoint_keeps_working_while_the_change_is_pending(self):
        self.assertEqual(refresh(self.tokens["refresh"]).status_code, 200)

    def test_a_normal_account_is_not_affected(self):
        normal = login("sales.a@t.test", PASSWORD).json()
        self.assertEqual(bearer(normal["access"]).get("/api/leads/").status_code, 200)

    def test_changing_the_password_lifts_the_restriction_and_clears_the_flag(self):
        response = self.client.post("/api/auth/change-password/", {"current_password": PASSWORD, "new_password": NEW}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        fresh = bearer(response.json()["access"])
        self.assertEqual(fresh.get("/api/leads/").status_code, 200)
        self.assertEqual(fresh.get("/api/users/").status_code, 200)
        self.user.refresh_from_db()
        self.assertFalse(self.user.must_change_password)
        self.assertTrue(self.user.check_password(NEW))

    def test_the_new_password_must_differ_and_must_be_strong(self):
        for body, label in (({"current_password": PASSWORD, "new_password": PASSWORD}, "same"),
                            ({"current_password": PASSWORD, "new_password": "short"}, "short"),
                            ({"current_password": PASSWORD, "new_password": "password123"}, "common")):
            with self.subTest(case=label):
                self.assertEqual(self.client.post("/api/auth/change-password/", body, format="json").status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.must_change_password)
        self.assertTrue(self.user.check_password(PASSWORD))


class TokenRevocationTests(ApiTestCase):
    def setUp(self):
        self.old = login("sales.a@t.test", PASSWORD).json()

    def change_own_password(self, tokens=None):
        tokens = tokens or self.old
        return bearer(tokens["access"]).post(
            "/api/auth/change-password/", {"current_password": PASSWORD, "new_password": NEW}, format="json"
        )

    def test_old_access_and_refresh_tokens_stop_working_after_the_owner_changes_the_password(self):
        self.assertEqual(bearer(self.old["access"]).get("/api/leads/").status_code, 200)
        self.assertEqual(self.change_own_password().status_code, 200)
        self.assertEqual(bearer(self.old["access"]).get("/api/leads/").status_code, 401)
        self.assertEqual(refresh(self.old["refresh"]).status_code, 401)

    def test_the_tokens_returned_by_the_change_keep_the_session_alive(self):
        new = self.change_own_password().json()
        self.assertEqual(bearer(new["access"]).get("/api/leads/").status_code, 200)
        renewed = refresh(new["refresh"])
        self.assertEqual(renewed.status_code, 200)
        self.assertEqual(bearer(renewed.json()["access"]).get("/api/leads/").status_code, 200)

    def test_a_token_issued_right_after_the_change_works_even_within_the_same_second(self):
        self.change_own_password()
        again = login("sales.a@t.test", NEW).json()
        self.assertEqual(bearer(again["access"]).get("/api/leads/").status_code, 200)

    def test_another_session_of_the_same_user_is_revoked_too(self):
        other_device = login("sales.a@t.test", PASSWORD).json()
        self.change_own_password()
        self.assertEqual(bearer(other_device["access"]).get("/api/leads/").status_code, 401)
        self.assertEqual(refresh(other_device["refresh"]).status_code, 401)

    def test_an_admin_resetting_a_password_revokes_that_users_tokens_and_requires_a_new_one(self):
        admin = self.as_user(self.admin)
        response = admin.patch(f"/api/users/{self.sales_a.pk}/", {"password": TEMP}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["must_change_password"])
        self.assertEqual(bearer(self.old["access"]).get("/api/leads/").status_code, 401)
        self.assertEqual(refresh(self.old["refresh"]).status_code, 401)
        self.assertEqual(login("sales.a@t.test", PASSWORD).status_code, 401)  # the old password is gone
        fresh = login("sales.a@t.test", TEMP).json()
        self.assertEqual(bearer(fresh["access"]).get("/api/leads/").status_code, 403)  # must change first
        changed = bearer(fresh["access"]).post("/api/auth/change-password/", {"current_password": TEMP, "new_password": NEW}, format="json")
        self.assertEqual(bearer(changed.json()["access"]).get("/api/leads/").status_code, 200)

    def test_an_admin_resetting_their_own_password_is_not_forced_to_change_it_again(self):
        response = self.as_user(self.admin).patch(f"/api/users/{self.admin.pk}/", {"password": TEMP}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["must_change_password"])

    def test_an_admin_can_decide_explicitly_whether_a_reset_forces_a_change(self):
        client = self.as_user(self.admin)
        keep = client.patch(f"/api/users/{self.sales_b.pk}/", {"password": TEMP, "must_change_password": False}, format="json")
        self.assertFalse(keep.json()["must_change_password"])

    def test_users_created_by_an_admin_start_with_a_temporary_password(self):
        created = self.as_user(self.admin).post(
            "/api/users/", {"email": "new.hire@t.test", "first_name": "N", "last_name": "H", "role": "salesperson", "password": TEMP}, format="json"
        )
        self.assertEqual(created.status_code, 201, created.content)
        self.assertTrue(created.json()["must_change_password"])
        tokens = login("new.hire@t.test", TEMP).json()
        self.assertEqual(bearer(tokens["access"]).get("/api/leads/").status_code, 403)

    def test_any_password_change_path_revokes_tokens_including_the_django_admin_and_shell(self):
        user = User.objects.get(pk=self.sales_a.pk)
        user.set_password("Changed-From-Shell-9!")
        user.save()
        self.assertEqual(bearer(self.old["access"]).get("/api/leads/").status_code, 401)
        user.set_password("Changed-Again-From-Shell-9!")
        user.save(update_fields=["password"])  # callers that only save the password field are covered too
        user.refresh_from_db()
        self.assertEqual(user.token_version, int(user.password_changed_at.timestamp() * 1000))

    def test_deactivated_accounts_still_lose_access_and_refresh(self):
        User.objects.filter(pk=self.sales_a.pk).update(is_active=False)
        self.assertEqual(bearer(self.old["access"]).get("/api/leads/").status_code, 401)
        self.assertEqual(refresh(self.old["refresh"]).status_code, 401)

    def test_garbage_and_forged_tokens_are_rejected(self):
        self.assertEqual(bearer("not.a.token").get("/api/leads/").status_code, 401)
        self.assertEqual(refresh("not-a-token").status_code, 401)
        forged = RefreshToken.for_user(self.sales_a)
        forged["pwv"] = 123  # a wrong version for this account
        self.assertEqual(bearer(str(forged.access_token)).get("/api/leads/").status_code, 401)
        self.assertEqual(refresh(str(forged)).status_code, 401)


class ExistingAccountsKeepWorkingTests(ApiTestCase):
    """Accounts and tokens that predate this feature must not be locked out when it is deployed."""

    def test_new_fields_have_safe_defaults(self):
        must = User._meta.get_field("must_change_password")
        changed = User._meta.get_field("password_changed_at")
        self.assertIs(must.default, False)
        self.assertTrue(changed.null)
        self.assertEqual(User.objects.get(pk=self.sales_a.pk).must_change_password, False)

    def test_a_legacy_token_without_the_version_claim_still_works_for_a_legacy_account(self):
        User.objects.filter(pk=self.sales_a.pk).update(password_changed_at=None)  # as every pre-existing account
        legacy = RefreshToken.for_user(self.sales_a)  # plain SimpleJWT token: no "pwv" claim at all
        self.assertNotIn("pwv", legacy)
        self.assertEqual(bearer(str(legacy.access_token)).get("/api/leads/").status_code, 200)
        self.assertEqual(refresh(str(legacy)).status_code, 200)

    def test_a_legacy_session_survives_until_that_accounts_password_changes(self):
        User.objects.filter(pk=self.sales_a.pk).update(password_changed_at=None)
        legacy = RefreshToken.for_user(self.sales_a)
        client = bearer(str(legacy.access_token))
        client.post("/api/auth/change-password/", {"current_password": PASSWORD, "new_password": NEW}, format="json")
        self.assertEqual(client.get("/api/leads/").status_code, 401)

    def test_a_legacy_superuser_without_the_flags_is_never_forced(self):
        tech = User.objects.create_superuser("tech@t.test", PASSWORD)
        User.objects.filter(pk=tech.pk).update(password_changed_at=None, must_change_password=False)
        tokens = login("tech@t.test", PASSWORD).json()
        self.assertEqual(bearer(tokens["access"]).get("/api/auth/me/").status_code, 200)
        self.assertEqual(bearer(tokens["access"]).get("/api/users/").status_code, 200)


class PasswordLifecycleMigrationTests(TransactionTestCase):
    """Applies 0002 on top of rows created at 0001, exactly like a production deployment would."""

    def test_existing_rows_get_safe_values_and_nobody_is_locked_out(self):
        executor = MigrationExecutor(connection)
        before = [("users", "0001_initial")]
        executor.migrate(before)
        old_apps = executor.loader.project_state(before).apps
        OldUser = old_apps.get_model("users", "User")
        OldUser.objects.create(email="legacy.admin@t.test", password="!", role="admin", is_staff=True, is_superuser=True)
        OldUser.objects.create(email="legacy.sales@t.test", password="!", role="salesperson")

        executor = MigrationExecutor(connection)
        started = time.monotonic()
        executor.migrate([("users", "0002_password_lifecycle")])
        elapsed = time.monotonic() - started
        NewUser = executor.loader.project_state([("users", "0002_password_lifecycle")]).apps.get_model("users", "User")
        rows = list(NewUser.objects.order_by("email").values_list("email", "must_change_password", "password_changed_at"))
        self.assertEqual(rows, [("legacy.admin@t.test", False, None), ("legacy.sales@t.test", False, None)])
        self.assertLess(elapsed, 5, "the migration only adds two columns and must be instant")

        with connection.cursor() as cursor:
            cursor.execute("select column_name, is_nullable, column_default from information_schema.columns "
                           "where table_name='users_user' and column_name in ('must_change_password','password_changed_at') order by 1")
            print("\nMIGRATION COLUMNS:", cursor.fetchall())

        # and it is reversible
        MigrationExecutor(connection).migrate(before)
        with connection.cursor() as cursor:
            cursor.execute("select count(*) from information_schema.columns where table_name='users_user' and column_name in ('must_change_password','password_changed_at')")
            self.assertEqual(cursor.fetchone()[0], 0)
        MigrationExecutor(connection).migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())


class OtherSupportedPasswordPathsTests(ApiTestCase):
    """The provider's own tools change passwords too: they must revoke old sessions exactly like the API does."""

    def setUp(self):
        self.old = login("sales.a@t.test", PASSWORD).json()
        self.assertEqual(bearer(self.old["access"]).get("/api/leads/").status_code, 200)

    def assert_old_session_is_dead_and_new_password_works(self, new_password):
        self.assertEqual(bearer(self.old["access"]).get("/api/leads/").status_code, 401)
        self.assertEqual(refresh(self.old["refresh"]).status_code, 401)
        fresh = login("sales.a@t.test", new_password)
        self.assertEqual(fresh.status_code, 200)
        self.assertEqual(bearer(fresh.json()["access"]).get("/api/leads/").status_code, 200)
        renewed = refresh(fresh.json()["refresh"])
        self.assertEqual(renewed.status_code, 200)
        self.assertEqual(bearer(renewed.json()["access"]).get("/api/leads/").status_code, 200)

    def test_the_django_admin_password_form(self):
        from django.contrib.auth.forms import AdminPasswordChangeForm

        form = AdminPasswordChangeForm(User.objects.get(pk=self.sales_a.pk), {"password1": "Set-In-Admin-Site-5!", "password2": "Set-In-Admin-Site-5!"})
        self.assertTrue(form.is_valid(), form.errors)
        form.save()
        self.assert_old_session_is_dead_and_new_password_works("Set-In-Admin-Site-5!")

    def test_the_changepassword_management_command(self):
        from unittest import mock

        from django.core.management import call_command

        with mock.patch("getpass.getpass", side_effect=["Set-By-Command-6!", "Set-By-Command-6!"]):
            call_command("changepassword", "sales.a@t.test", verbosity=0)
        self.assert_old_session_is_dead_and_new_password_works("Set-By-Command-6!")

    def test_provisioned_and_admin_created_accounts_both_get_working_tokens_after_their_first_change(self):
        for email, temp in (("p1@t.test", TEMP), ("p2@t.test", "Another-Temp-Pass-5!")):
            created = self.as_user(self.admin).post(
                "/api/users/", {"email": email, "first_name": "P", "last_name": "Q", "role": "salesperson", "password": temp}, format="json"
            )
            self.assertEqual(created.status_code, 201, created.content)
            first = login(email, temp).json()
            changed = bearer(first["access"]).post("/api/auth/change-password/", {"current_password": temp, "new_password": NEW}, format="json")
            self.assertEqual(changed.status_code, 200)
            self.assertEqual(bearer(first["access"]).get("/api/leads/").status_code, 401)   # the temporary session is gone
            self.assertEqual(bearer(changed.json()["access"]).get("/api/leads/").status_code, 200)

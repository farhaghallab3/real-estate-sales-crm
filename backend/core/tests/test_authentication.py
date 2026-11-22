from django.conf import settings
from rest_framework.test import APIClient

from users.models import User

from .base import PASSWORD, ApiTestCase

ENDPOINTS = [
    "/api/leads/", "/api/properties/", "/api/deals/", "/api/tasks/", "/api/viewings/", "/api/commissions/",
    "/api/documents/", "/api/notifications/", "/api/users/", "/api/offers/", "/api/lead-properties/",
    "/api/dashboard/", "/api/analytics/summary/", "/api/auth/me/",
]


class AuthenticationTests(ApiTestCase):
    def login(self, email, password=PASSWORD):
        return APIClient().post("/api/auth/login/", {"email": email, "password": password}, format="json")

    def test_every_api_endpoint_requires_authentication(self):
        for url in ENDPOINTS:
            with self.subTest(url=url):
                self.assertEqual(APIClient().get(url).status_code, 401)

    def test_only_health_is_public(self):
        self.assertEqual(APIClient().get("/api/health/").status_code, 200)

    def test_login_is_case_and_whitespace_tolerant_and_returns_the_user(self):
        response = self.login("  SALES.A@T.TEST ")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["user"]["role"], "salesperson")
        self.assertIn("access", body)
        self.assertNotIn("password", body["user"])

    def test_wrong_password_and_unknown_email_are_401_not_500(self):
        self.assertEqual(self.login("sales.a@t.test", "wrong-password-1").status_code, 401)
        self.assertEqual(self.login("nobody@t.test").status_code, 401)

    def test_inactive_user_cannot_log_in(self):
        User.objects.filter(pk=self.sales_a.pk).update(is_active=False)
        self.assertEqual(self.login("sales.a@t.test").status_code, 401)

    def test_access_token_stops_working_when_the_user_is_deactivated(self):
        token = self.login("sales.a@t.test").json()["access"]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        self.assertEqual(client.get("/api/auth/me/").status_code, 200)
        User.objects.filter(pk=self.sales_a.pk).update(is_active=False)
        self.assertEqual(client.get("/api/auth/me/").status_code, 401)

    def test_refresh_token_stops_working_when_the_user_is_deactivated(self):
        refresh = self.login("sales.a@t.test").json()["refresh"]
        User.objects.filter(pk=self.sales_a.pk).update(is_active=False)
        response = APIClient().post("/api/auth/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(response.status_code, 401, "a deactivated user must not be able to mint new access tokens")

    def test_invalid_refresh_token_is_401_not_500(self):
        response = APIClient().post("/api/auth/refresh/", {"refresh": "not-a-token"}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_me_cannot_change_role_email_split_or_active_flag(self):
        client = self.as_user(self.sales_a)
        response = client.patch(
            "/api/auth/me/",
            {"role": "admin", "email": "x@t.test", "commission_split": "99.00", "is_active": False, "first_name": "New"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.sales_a.refresh_from_db()
        self.assertEqual(
            (self.sales_a.role, self.sales_a.email, str(self.sales_a.commission_split), self.sales_a.is_active),
            ("salesperson", "sales.a@t.test", "40.00", True),
        )
        self.assertEqual(self.sales_a.first_name, "New")

    def test_change_password_requires_the_current_password(self):
        client = self.as_user(self.sales_a)
        wrong = client.post(
            "/api/auth/change-password/", {"current_password": "nope", "new_password": "Another-Good-1!"}, format="json"
        )
        self.assertEqual(wrong.status_code, 400)
        ok = client.post(
            "/api/auth/change-password/", {"current_password": PASSWORD, "new_password": "Another-Good-1!"}, format="json"
        )
        self.assertEqual(ok.status_code, 200)
        self.assertIn("access", ok.json())  # a fresh token pair: the old tokens are revoked by the change
        self.assertEqual(self.login("sales.a@t.test", "Another-Good-1!").status_code, 200)

    def test_demo_mode_is_off_by_default(self):
        self.assertFalse(settings.DEMO_MODE)
        self.assertFalse(any("DemoMode" in m for m in settings.MIDDLEWARE))

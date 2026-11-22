"""Deep health check (liveness vs readiness) and structured, redacted logging."""
import io
import json
import logging
import re
import uuid
from unittest import mock

from django.conf import settings
from django.db import OperationalError, connection
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from core.logs import JsonFormatter, redact, reset_known_secrets

from .base import PASSWORD, ApiTestCase
from .urls_boom import SECRET_IN_ERROR

TOKEN = "monitor-token-for-tests-0123456789"
ACCESS_BEARER = re.compile(r"Bearer\s+[A-Za-z0-9._-]{20,}")


class capture:
    """Attach a JSON formatter handler to some loggers for the duration of a block."""

    def __init__(self, *names):
        self.names, self.stream = names, io.StringIO()

    def __enter__(self):
        self.handler = logging.StreamHandler(self.stream)
        self.handler.setFormatter(JsonFormatter())
        for name in self.names:
            logging.getLogger(name).addHandler(self.handler)
        return self

    def __exit__(self, *exc):
        for name in self.names:
            logging.getLogger(name).removeHandler(self.handler)

    @property
    def text(self):
        return self.stream.getvalue()

    @property
    def lines(self):
        return [json.loads(line) for line in self.text.splitlines() if line.strip()]


class RedactionTests(SimpleTestCase):
    CASES = [
        ("Authorization: Bearer abc.def.ghi", "abc.def.ghi"),
        ("GET /api/x/?search=ali&page=2", "search=ali"),
        ("postgres://crm:S3cretPass@db.internal/crm", "S3cretPass"),
        ("redis://:onlypass@cache:6379/0", "onlypass"),
        ("password=hunter2 next", "hunter2"),
        ('{"password": "p@ss w0rd", "note": "hello"}', "p@ss w0rd"),
        ('{"refresh_token": "abcdefghij"}', "abcdefghij"),
        ("token: 12345abcdef", "12345abcdef"),
        ("contact user.name+tag@example.co.uk now", "user.name+tag@example.co.uk"),
        ("X-Amz-Signature=deadbeef0123&X-Amz-Credential=AKIAABCDEFGHIJKLMNOP", "deadbeef0123"),
        ("key AKIAABCDEFGHIJKLMNOP used", "AKIAABCDEFGHIJKLMNOP"),
        ("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij", "eyJhbGciOiJIUzI1NiJ9"),
        ("csrfmiddlewaretoken=abcd1234", "abcd1234"),
        ("Cookie: sessionid=abc123", "abc123"),
    ]

    def test_secrets_are_removed_from_free_text(self):
        for text, secret in self.CASES:
            with self.subTest(text=text):
                self.assertNotIn(secret, redact(text))

    def test_ordinary_text_is_left_alone(self):
        for text in ("Why is this? just a question", "lead 42 reassigned to team", "access denied for the page", "status=200 path=/api/leads/"):
            self.assertEqual(redact(text), text)

    def test_the_exact_secret_values_of_this_deployment_are_removed_wherever_they_appear(self):
        reset_known_secrets()
        for value in (settings.SECRET_KEY, settings.DATABASES["default"].get("PASSWORD")):
            with self.subTest(value=value[:3] + "..."):
                self.assertNotIn(value, redact(f"unexpected failure near {value} while saving"))
        with override_settings(READINESS_TOKEN=TOKEN):
            reset_known_secrets()
            self.assertNotIn(TOKEN, redact(f"header was {TOKEN}"))
        reset_known_secrets()


class JsonFormatterTests(SimpleTestCase):
    def format(self, **extra):
        logger = logging.getLogger("crm.test")
        with capture("crm.test") as c:
            logger.warning("hello %s", "world", extra=extra)
        return c.lines[0]

    def test_one_json_object_per_line_with_the_agreed_fields(self):
        line = self.format(method="GET", path="/api/x/", status=200, duration_ms=1.5, user_id=7)
        self.assertEqual(
            {"ts", "level", "logger", "msg", "request_id", "instance", "method", "path", "status", "duration_ms", "user_id"}, set(line)
        )
        self.assertEqual((line["level"], line["msg"], line["user_id"]), ("WARNING", "hello world", 7))

    def test_nothing_outside_the_allow_list_can_reach_a_log_line(self):
        line = self.format(body="BODY-MARKER", authorization="Bearer x", email="a@b.co", headers={"x": 1}, query="q=1", password="p")
        text = json.dumps(line)
        for forbidden in ("BODY-MARKER", "authorization", "a@b.co", "headers", "query", "password"):
            self.assertNotIn(forbidden, text)

    def test_messages_and_paths_are_redacted(self):
        logger = logging.getLogger("crm.test")
        with capture("crm.test") as c:
            logger.error("bad login for owner@acme.test with password=%s", "hunter2", extra={"path": "/api/x/?token=abc123"})
        text = c.text
        for secret in ("owner@acme.test", "hunter2", "abc123"):
            self.assertNotIn(secret, text)

    def test_an_exception_is_logged_as_type_plus_a_redacted_traceback(self):
        logger = logging.getLogger("crm.test")
        with capture("crm.test") as c:
            try:
                raise ValueError("postgres://u:Sup3rSecret@h/db failed, token=zzzz9999 for a@b.co")
            except ValueError:
                logger.exception("save failed")
        line = c.lines[0]
        self.assertEqual(line["exc_type"], "ValueError")
        self.assertIn("Traceback", line["exc"])
        for secret in ("Sup3rSecret", "zzzz9999", "a@b.co"):
            self.assertNotIn(secret, c.text)


class AccessLogTests(ApiTestCase):
    def setUp(self):
        self.token = APIClient().post("/api/auth/login/", {"email": "sales.a@t.test", "password": PASSWORD}, format="json").json()["access"]
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")

    def test_one_line_per_request_with_the_path_only(self):
        with capture("crm.access") as c:
            response = self.client.get("/api/leads/?search=Secret-Query-Value&token=querytoken123")
        self.assertEqual(response.status_code, 200)
        (line,) = c.lines
        self.assertEqual((line["method"], line["path"], line["status"]), ("GET", "/api/leads/", 200))
        self.assertEqual(line["user_id"], self.sales_a.pk)
        self.assertIsInstance(line["duration_ms"], (int, float))
        for secret in ("Secret-Query-Value", "querytoken123", self.token, "sales.a@t.test", "?"):
            self.assertNotIn(secret, c.text)
        self.assertFalse(ACCESS_BEARER.search(c.text))

    def test_login_logs_neither_the_email_nor_the_password_nor_the_body(self):
        with capture("crm.access") as c:
            APIClient().post("/api/auth/login/", {"email": "sales.a@t.test", "password": PASSWORD, "note": "BODY-MARKER-XYZ"}, format="json")
        self.assertEqual(c.lines[0]["path"], "/api/auth/login/")
        for secret in ("sales.a@t.test", PASSWORD, "BODY-MARKER-XYZ"):
            self.assertNotIn(secret, c.text)

    def test_anonymous_and_refused_requests_are_logged_without_a_user(self):
        with capture("crm.access") as c:
            APIClient().get("/api/leads/")
        self.assertEqual((c.lines[0]["status"], c.lines[0].get("user_id")), (401, None))

    def test_a_request_body_with_secrets_is_never_logged(self):
        with capture("crm.access") as c:
            self.client.post("/api/leads/", {"first_name": "BODY-MARKER-XYZ", "phone": "0100", "email": "private@client.test"}, format="json")
        self.assertNotIn("BODY-MARKER-XYZ", c.text)
        self.assertNotIn("private@client.test", c.text)

    def test_the_request_id_is_echoed_when_valid_and_replaced_when_not(self):
        valid = "abc12345-edge-request-id"
        response = self.client.get("/api/leads/", HTTP_X_REQUEST_ID=valid)
        self.assertEqual(response["X-Request-ID"], valid)
        for bad in ("short", "has spaces in it 123456", "x" * 200, "id\r\nInjected: header"):
            with self.subTest(bad=bad[:12]):
                try:
                    response = self.client.get("/api/leads/", HTTP_X_REQUEST_ID=bad)
                except Exception:
                    continue  # a header the HTTP layer itself refuses
                self.assertNotEqual(response["X-Request-ID"], bad)
                self.assertTrue(re.fullmatch(r"[0-9a-f]{32}", response["X-Request-ID"]))

    def test_every_line_of_one_request_shares_its_request_id(self):
        with capture("crm.access") as c:
            response = self.client.get("/api/leads/")
        self.assertEqual(c.lines[0]["request_id"], response["X-Request-ID"])

    def test_the_liveness_probe_does_not_flood_the_log(self):
        with capture("crm.access") as c:
            for _ in range(3):
                APIClient().get("/api/health/")
        self.assertEqual(c.lines, [])


@override_settings(ROOT_URLCONF="core.tests.urls_boom")
class ExceptionLoggingTests(ApiTestCase):
    def test_a_crash_is_logged_with_its_request_id_and_nothing_secret(self):
        client = APIClient(raise_request_exception=False)
        with capture("django.request", "crm.access") as c:
            response = client.get("/boom/?token=querysecret99", HTTP_X_REQUEST_ID="req-for-the-crash-0001", HTTP_AUTHORIZATION="Bearer abcdefghijklmnopqrstuvwx.yz")
        self.assertEqual(response.status_code, 500)
        lines = c.lines
        self.assertTrue(any(line["logger"] == "django.request" and line["exc_type"] == "RuntimeError" for line in lines))
        self.assertTrue(any(line["logger"] == "crm.access" and line["status"] == 500 for line in lines))
        self.assertEqual({line["request_id"] for line in lines}, {"req-for-the-crash-0001"})
        db_password = settings.DATABASES["default"].get("PASSWORD")
        for secret in (SECRET_IN_ERROR, "abc123tokenvalue", "abc.def.ghi", "owner@acme.test", "querysecret99", "abcdefghijklmnopqrstuvwx", db_password):
            self.assertNotIn(secret, c.text, f"leaked: {secret[:6]}...")
        self.assertIn("[REDACTED", c.text)
        self.assertIn("Traceback", next(line["exc"] for line in lines if "exc" in line))


class HealthTests(ApiTestCase):
    def ready(self, token=TOKEN, method="get", **extra):
        client = APIClient()
        headers = {"HTTP_X_MONITOR_TOKEN": token} if token is not None else {}
        return getattr(client, method)("/api/health/ready/", **headers, **extra)

    def test_liveness_needs_no_authentication_and_returns_only_status(self):
        response = APIClient().get("/api/health/")
        self.assertEqual((response.status_code, response.json()), (200, {"status": "ok"}))

    def test_liveness_stays_green_when_the_database_is_down(self):
        with mock.patch.object(connection, "cursor", side_effect=OperationalError("db is down")):
            self.assertEqual(APIClient().get("/api/health/").status_code, 200)

    @override_settings(READINESS_TOKEN="")
    def test_readiness_does_not_exist_without_a_configured_token(self):
        self.assertEqual(self.ready(TOKEN).status_code, 404)
        self.assertEqual(self.ready(None).status_code, 404)
        self.assertEqual(self.ready("").status_code, 404)

    @override_settings(READINESS_TOKEN=TOKEN)
    def test_readiness_refuses_requests_without_or_with_a_wrong_token(self):
        for token in (None, "", "wrong", TOKEN[:-1], TOKEN + "x"):
            with self.subTest(token=token):
                self.assertEqual(self.ready(token).status_code, 404)
        # being a logged-in admin is not a substitute for the monitoring token
        admin = APIClient()
        admin.force_authenticate(self.admin)
        self.assertEqual(admin.get("/api/health/ready/").status_code, 404)

    @override_settings(READINESS_TOKEN=TOKEN)
    def test_readiness_reports_only_booleans_when_everything_is_fine(self):
        response = self.ready()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "database": "ok", "migrations": "ok"})
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(self.ready(method="post").status_code, 405)

    @override_settings(READINESS_TOKEN=TOKEN)
    def test_a_database_failure_is_503_without_any_detail_and_the_log_is_redacted(self):
        with capture("crm.health") as c, mock.patch.object(
            connection, "cursor", side_effect=OperationalError("could not connect: postgres://crm:Hunter2pass@neon.internal/db")
        ):
            response = self.ready()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable", "database": "error", "migrations": "unknown"})
        for secret in ("Hunter2pass", "neon.internal", "postgres"):
            self.assertNotIn(secret, response.content.decode())
        self.assertNotIn("Hunter2pass", c.text)
        self.assertEqual(c.lines[0]["exc_type"], "OperationalError")

    @override_settings(READINESS_TOKEN=TOKEN)
    def test_a_pending_migration_makes_the_instance_not_ready(self):
        executor = mock.Mock()
        executor.migration_plan.return_value = [("users.0099_future", False)]
        with mock.patch("core.health.MigrationExecutor", return_value=executor):
            response = self.ready()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable", "database": "ok", "migrations": "pending"})

    @override_settings(READINESS_TOKEN=TOKEN)
    def test_the_check_itself_is_rate_independent_of_authentication_throttles(self):
        for _ in range(25):
            self.assertEqual(self.ready().status_code, 200)

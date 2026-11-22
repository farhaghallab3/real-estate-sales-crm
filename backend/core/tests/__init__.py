"""Permission and role tests. They only ever run against a local, disposable PostgreSQL.

Django's test runner creates and drops its own `test_<name>` database, but we still refuse to start if the configured
server is not a local/test host, so a stray DATABASE_URL can never point these tests (which create users, leads and
deals) at a real instance.
"""
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

_SAFE_HOSTS = {"", "localhost", "127.0.0.1", "::1", "crm-test-db"}
_host = (settings.DATABASES["default"].get("HOST") or "").strip().lower()
if _host not in _SAFE_HOSTS:
    raise ImproperlyConfigured(
        f"Refusing to run tests against database host {_host!r}. Use the isolated test database "
        f"(see backend/core/tests/README.md)."
    )

"""Test-only URL configuration: the real routes plus a view that fails with a message full of secrets."""
from django.conf import settings
from django.urls import include, path

from config.urls import urlpatterns as real_urlpatterns

SECRET_IN_ERROR = "Hunter2-Pass-7788"


def boom(request):
    raise RuntimeError(
        f"cannot connect: postgres://crm:{SECRET_IN_ERROR}@db.internal:5432/crm?sslmode=require "
        f"token=abc123tokenvalue Authorization: Bearer abc.def.ghi owner@acme.test "
        f"db_password={settings.DATABASES['default'].get('PASSWORD')}"
    )


urlpatterns = [path("boom/", boom), *real_urlpatterns]

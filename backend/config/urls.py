from django.conf import settings
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path, re_path
from django.views.static import serve


def health(request):
    """Liveness probe for the hosting platform (no auth, no database access)."""
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("api/health/", health),
    # Property photos from local storage only. Transaction documents live under media/documents/ and must
    # stay behind the authenticated /api/documents/<id>/download/ endpoint, so /media/ is NOT served
    # wholesale. With S3-compatible storage configured, photo URLs are signed bucket URLs instead.
    re_path(r"^media/(?P<path>properties/.+)$", serve, {"document_root": settings.MEDIA_ROOT}),
    path("django-admin/", admin.site.urls),
    path("api/", include("users.urls")),
    path("api/", include("leads.urls")),
    path("api/", include("properties.urls")),
    path("api/", include("tasks.urls")),
    path("api/", include("viewings.urls")),
    path("api/", include("deals.urls")),
    path("api/", include("commissions.urls")),
    path("api/", include("documents.urls")),
    path("api/", include("notifications.urls")),
    path("api/", include("analytics.urls")),
]

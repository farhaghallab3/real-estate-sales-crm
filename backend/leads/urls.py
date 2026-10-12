from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import LeadPropertyViewSet, LeadViewSet

router = DefaultRouter()
router.register("leads", LeadViewSet, basename="lead")
router.register("lead-properties", LeadPropertyViewSet, basename="lead-property")

urlpatterns = [path("", include(router.urls))]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CommissionViewSet

router = DefaultRouter()
router.register("commissions", CommissionViewSet, basename="commission")

urlpatterns = [path("", include(router.urls))]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DealViewSet, OfferViewSet

router = DefaultRouter()
router.register("deals", DealViewSet, basename="deal")
router.register("offers", OfferViewSet, basename="offer")

urlpatterns = [path("", include(router.urls))]

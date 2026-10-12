from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ViewingViewSet

router = DefaultRouter()
router.register("viewings", ViewingViewSet, basename="viewing")

urlpatterns = [path("", include(router.urls))]

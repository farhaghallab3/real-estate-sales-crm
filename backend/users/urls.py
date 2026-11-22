from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .tokens import CRMTokenRefreshView
from .views import ChangePasswordView, LoginView, MeView, UserViewSet

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("auth/login/", LoginView.as_view()),
    path("auth/refresh/", CRMTokenRefreshView.as_view()),
    path("auth/me/", MeView.as_view()),
    path("auth/change-password/", ChangePasswordView.as_view()),
    path("", include(router.urls)),
]

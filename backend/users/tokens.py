"""Refresh endpoint that honours password changes and deactivation. Kept apart from authentication.py because that
module is imported while Django REST framework itself loads, and must not import any DRF view."""
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.views import TokenRefreshView

from .authentication import token_is_current
from .models import User


class CRMTokenRefreshSerializer(TokenRefreshSerializer):
    """A refresh token stops working once the password changed or the account was deactivated."""

    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])
        user = User.objects.filter(pk=refresh.get(api_settings.USER_ID_CLAIM)).first()
        if user is None or not user.is_active or not token_is_current(refresh, user):
            raise TokenError("Token is no longer valid")
        return super().validate(attrs)


class CRMTokenRefreshView(TokenRefreshView):
    serializer_class = CRMTokenRefreshSerializer

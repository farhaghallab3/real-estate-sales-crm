"""JWT authentication that (1) revokes tokens issued before the last password change and (2) blocks everything except
changing the password while the account is flagged must_change_password. Both are enforced here, on the server."""
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication

TOKEN_VERSION_CLAIM = "pwv"
# What an account that must change its password may still call: read its own profile, and change the password.
ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED = {("GET", "/api/auth/me/"), ("POST", "/api/auth/change-password/")}


class PasswordChangeRequired(PermissionDenied):
    def __init__(self):
        super().__init__(
            detail={"detail": "You must change your temporary password before continuing.", "code": "password_change_required"}
        )


def token_is_current(claims, user) -> bool:
    return int(claims.get(TOKEN_VERSION_CLAIM, 0) or 0) == user.token_version


class CRMJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        if not token_is_current(validated_token, user):
            raise AuthenticationFailed("This session is no longer valid. Please sign in again.", code="token_revoked")
        return user

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, _ = result
        if user.must_change_password and (request.method, request.path) not in ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED:
            raise PasswordChangeRequired()
        return result

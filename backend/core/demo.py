"""Guard rails for the public portfolio demo (DEMO_MODE=true). Not used on real instances."""
import re

from django.http import JsonResponse

_WRITE = {"POST", "PUT", "PATCH", "DELETE"}
_BLOCKED = [
    (re.compile(r"^/api/users/"), _WRITE),
    (re.compile(r"^/api/auth/change-password/$"), _WRITE),
    (re.compile(r"^/api/company/settings/"), _WRITE),
    (re.compile(r"^/api/documents/$"), {"POST"}),
    (re.compile(r"^/api/properties/\d+/images/"), _WRITE),
]


class DemoModeMiddleware:
    """Rejects uploads, user management and password changes so a shared public login cannot be abused."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        for pattern, methods in _BLOCKED:
            if request.method in methods and pattern.match(request.path):
                return JsonResponse({"detail": "This action is disabled in the public demo."}, status=403)
        return self.get_response(request)

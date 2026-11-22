"""Request id propagation and the access log (replaces gunicorn's access log, which prints query strings)."""
import logging
import re
import time
import uuid

from .logs import request_id_var

access_log = logging.getLogger("crm.access")
_VALID_ID = re.compile(r"[A-Za-z0-9._-]{8,64}")
_QUIET_PATHS = {"/api/health/"}  # liveness probes run every few seconds: not worth a line each


class RequestLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        supplied = request.headers.get("X-Request-ID", "")
        request_id = supplied if _VALID_ID.fullmatch(supplied) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.monotonic()
        status = 500
        try:
            response = self.get_response(request)
            status = response.status_code
            response["X-Request-ID"] = request_id
            return response
        finally:
            if request.path not in _QUIET_PATHS:
                user = getattr(request, "user", None)  # set by DRF once the request authenticated
                access_log.info(
                    "request",
                    extra={
                        "method": request.method,
                        "path": request.path[:200],          # the path only: never the query string
                        "status": status,
                        "duration_ms": round((time.monotonic() - started) * 1000, 1),
                        "user_id": user.pk if getattr(user, "is_authenticated", False) else None,
                    },
                )
            request_id_var.reset(token)

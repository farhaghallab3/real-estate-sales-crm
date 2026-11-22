"""Health endpoints.

  /api/health/        liveness: no authentication, no database. Used by Docker/nginx health checks. It must stay this simple so a
                      slow or cold database (Neon wakes up from idle) can never make the platform restart a healthy container.
  /api/health/ready/  readiness: can the app serve right now (database answers, no migration pending)? Meant for the edge and for
                      authorised monitoring ONLY: it needs the secret header X-Monitor-Token (READINESS_TOKEN) and the edge does not
                      route it from the internet. Without a configured token it does not exist (404). It reports booleans only,
                      never exception text, versions or names.
"""
import hmac
import logging

from django.conf import settings
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.http import Http404, JsonResponse
from django.views.decorators.http import require_GET

log = logging.getLogger("crm.health")


@require_GET
def liveness(request):
    return JsonResponse({"status": "ok"})


@require_GET
def readiness(request):
    expected = getattr(settings, "READINESS_TOKEN", "") or ""
    supplied = request.headers.get("X-Monitor-Token", "")
    if not expected or not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise Http404  # indistinguishable from "no such page"

    result = {"status": "ok", "database": "ok", "migrations": "ok"}
    code = 200
    try:
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = 3000")
            cursor.execute("SELECT 1")
    except Exception:
        log.error("readiness: database check failed", exc_info=True)  # the traceback is redacted by the log formatter
        result.update(database="error", migrations="unknown")
        code = 503
    else:
        try:
            executor = MigrationExecutor(connection)
            if executor.migration_plan(executor.loader.graph.leaf_nodes()):
                result["migrations"] = "pending"
                code = 503
        except Exception:
            log.error("readiness: migration check failed", exc_info=True)
            result["migrations"] = "unknown"
            code = 503
    if code != 200:
        result["status"] = "unavailable"
    response = JsonResponse(result, status=code)
    response["Cache-Control"] = "no-store"
    return response

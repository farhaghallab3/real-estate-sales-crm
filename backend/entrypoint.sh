#!/bin/sh
set -e

python - <<'PY'
import os, socket, time
from urllib.parse import urlparse

url = os.environ.get("DATABASE_URL")
if url:
    parsed = urlparse(url)
    host, port = parsed.hostname, parsed.port or 5432
else:
    host = os.environ.get("POSTGRES_HOST", "db")
    port = int(os.environ.get("POSTGRES_PORT", "5432"))
print(f"Waiting for PostgreSQL at {host}:{port}...", flush=True)
for _ in range(60):
    try:
        socket.create_connection((host, port), timeout=2).close()
        break
    except OSError:
        time.sleep(1)
else:
    raise SystemExit("PostgreSQL is not reachable")
PY

python manage.py migrate --noinput
# Dev serves admin static via runserver; collectstatic (slow on bind mounts) is only needed with gunicorn.
if [ "${DJANGO_DEBUG}" != "true" ]; then
  python manage.py collectstatic --noinput >/dev/null 2>&1 || true
fi

if [ -n "${DJANGO_SUPERUSER_EMAIL}" ] && [ -n "${DJANGO_SUPERUSER_PASSWORD}" ]; then
  python manage.py shell -c "
from users.models import User
import os
e, p = os.environ['DJANGO_SUPERUSER_EMAIL'], os.environ['DJANGO_SUPERUSER_PASSWORD']
if not User.objects.filter(email=e).exists():
    User.objects.create_superuser(e, p, first_name='Admin')
"
fi

if [ "${SEED_DEMO_DATA}" = "true" ] || [ "${SEED_DEMO_DATA}" = "1" ]; then
  python manage.py seed_demo
fi

exec "$@"

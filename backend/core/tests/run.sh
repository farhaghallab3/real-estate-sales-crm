#!/usr/bin/env bash
# Runs the permission tests against a THROWAWAY PostgreSQL in Docker (private network, random password, removed at the end).
# It never reads DATABASE_URL from your environment or .env files, so it cannot reach Neon or any real database.
#
#   bash backend/core/tests/run.sh                 # normal run: known gaps are expected failures
#   RUN_KNOWN_GAPS=1 bash backend/core/tests/run.sh   # also run the gap tests as ordinary tests (shows the raw failures)
#   bash backend/core/tests/run.sh core.tests.test_assignment_rules   # any Django test label
set -uo pipefail
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"; BACKEND="$(cd "$HERE/../.." && pwd)"
hp() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
NET=crm-permtest; DB=crm-test-db; IMG=crm-backend:test
PW="$(head -c 40 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
cleanup() { docker rm -f "$DB" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; }
trap cleanup EXIT; cleanup

docker image inspect "$IMG" >/dev/null 2>&1 || { echo "building $IMG (first run only)..."; docker build -q --target base -t "$IMG" "$(hp "$BACKEND")" >/dev/null || exit 2; }
docker network create "$NET" >/dev/null || exit 2
docker run -d --name "$DB" --network "$NET" -e POSTGRES_PASSWORD="$PW" postgres:16-alpine >/dev/null || exit 2
for _ in $(seq 1 60); do docker exec "$DB" pg_isready -U postgres -q 2>/dev/null && break; sleep 1; done

LABELS=("$@"); [ ${#LABELS[@]} -gt 0 ] || LABELS=(core.tests)
docker run --rm --network "$NET" --user 0:0 --entrypoint python \
  -v "$(hp "$BACKEND"):/app" -e PYTHONDONTWRITEBYTECODE=1 \
  -e DATABASE_URL="postgres://postgres:${PW}@${DB}:5432/postgres" -e DJANGO_DEBUG=true -e DJANGO_SECRET_KEY=test-only-key \
  -e RUN_KNOWN_GAPS="${RUN_KNOWN_GAPS:-0}" -e DEMO_MODE=false \
  "$IMG" manage.py test "${LABELS[@]}" --noinput -v 2 2>&1 | sed -E "s#${PW}#<redacted>#g"
exit "${PIPESTATUS[0]}"

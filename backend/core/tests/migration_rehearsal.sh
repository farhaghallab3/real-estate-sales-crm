#!/usr/bin/env bash
# Rehearses core/0003_companysettings on a THROWAWAY PostgreSQL that already holds "old" data (schema at core/0002):
# prints the SQL, applies the migration, checks the old rows are untouched, then reverses it and re-applies it.
set -uo pipefail
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"; BACKEND="$(cd "$HERE/../.." && pwd)"
hp() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else echo "$1"; fi; }
NET=crm-migtest; DB=crm-migtest-db; IMG=crm-backend:test
PW="$(head -c 40 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
cleanup() { docker rm -f "$DB" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; }
trap cleanup EXIT; cleanup
docker network create "$NET" >/dev/null || exit 2
docker run -d --name "$DB" --network "$NET" -e POSTGRES_PASSWORD="$PW" postgres:16-alpine >/dev/null || exit 2
for _ in $(seq 1 60); do docker exec "$DB" pg_isready -U postgres -q 2>/dev/null && break; sleep 1; done
run() {
  docker run --rm --network "$NET" --user 0:0 --entrypoint python -v "$(hp "$BACKEND"):/app" -e PYTHONDONTWRITEBYTECODE=1 \
    -e DATABASE_URL="postgres://postgres:${PW}@${DB}:5432/postgres" -e DJANGO_DEBUG=true -e DJANGO_SECRET_KEY=test-only-key \
    -e DEMO_MODE=false "$IMG" "$@" 2>&1 | sed -E "s#${PW}#<redacted>#g"
}
echo "=== sqlmigrate core 0003 ==="; run manage.py sqlmigrate core 0003
echo "=== migrate everything EXCEPT core 0003 (an 'old' instance) ==="; run manage.py migrate --noinput -v 0
run manage.py migrate core 0002 --noinput -v 0
run manage.py shell -c "
from users.models import User
from properties.models import Property
from leads.models import Lead
u = User.objects.create_user('old@x.test', 'Correct-Horse-9-Battery!', role='admin')
Property.objects.create(title='Old flat', address='1 St', city='Cairo', price=1000000, assigned_to=u)
Lead.objects.create(first_name='Old', last_name='Lead', phone='01', assigned_to=u)
print('old rows created')"
echo "=== apply 0003 ==="; run manage.py migrate core 0003 --noinput
run manage.py shell -c "
from users.models import User
from properties.models import Property
from leads.models import Lead
from core.models import CompanySettings
print('users', User.objects.count(), 'properties', Property.objects.count(), 'leads', Lead.objects.count())
print('company settings rows right after migrate:', CompanySettings.objects.count(), '(created lazily on first read)')
c = CompanySettings.load(); print('defaults:', c.company_name, c.workspace_label, c.currency_code, c.locale, c.language)"
echo "=== reverse then re-apply ==="; run manage.py migrate core 0002 --noinput -v 0; run manage.py migrate core --noinput -v 0
run manage.py showmigrations core
run manage.py makemigrations --check --dry-run

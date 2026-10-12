# Keystone — Real Estate Sales CRM

Internal sales workspace for a real-estate company: leads and clients, property inventory, lead–property
matching, follow-up tasks, viewings, a deal pipeline, offers, commissions, documents, analytics and
notifications. It is an internal tool for salespeople, managers and admins — not a public marketplace.

| Layer    | Stack |
|----------|-------|
| Frontend | Next.js 15 (App Router), TypeScript (strict), Tailwind CSS, React Hook Form, TanStack Query |
| Backend  | Python, Django 5, Django REST Framework, django-filter, SimpleJWT |
| Database | PostgreSQL |
| Infra    | Docker / Docker Compose for local development; Vercel + Neon + a container host for production |

```
backend/    Django project, one app per domain (users, leads, properties, tasks, viewings, deals,
            commissions, documents, notifications, analytics) plus core (activity log, permissions)
frontend/   Next.js app (src/app routes, src/components, src/lib API client and queries)
docs/       ARCHITECTURE.md (design), DEPLOYMENT.md (production setup)
```

## Local development

Requirements: Docker with Compose.

```bash
cp .env.example .env     # set the passwords and secret key
docker compose up --build
```

| Service  | URL |
|----------|-----|
| App      | http://localhost:3000 |
| API      | http://localhost:8000/api/ |
| Admin    | http://localhost:8000/django-admin/ |

On first start the backend runs migrations and, when `SEED_DEMO_DATA=true` (development only), loads demo data:
users, properties, leads at every funnel stage, viewings, offers, deals, commissions and documents.

Demo accounts (password is `DEMO_PASSWORD` from your `.env`):

| Email | Role |
|-------|------|
| `admin@crm.local` | Admin |
| `manager@crm.local` | Manager |
| `sofia@crm.local`, `marcus@crm.local`, `priya@crm.local`, `tom@crm.local` | Salesperson |

Useful commands:

```bash
docker compose exec backend python manage.py seed_demo --force   # re-seed (development only)
docker compose exec backend python manage.py notify_overdue_tasks
docker compose exec frontend npm run typecheck
docker compose down -v                                            # stop and delete all local data
```

## Production

Frontend on Vercel, PostgreSQL on Neon, Django as a container on any host, uploads in an S3-compatible bucket.
Step-by-step setup and the full environment variable list are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Key points:

- Django reads `DATABASE_URL`, `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DJANGO_CORS_ALLOWED_ORIGINS` and
  `DJANGO_CSRF_TRUSTED_ORIGINS` from the environment and refuses to start in production without them.
- The frontend reads the API location from `NEXT_PUBLIC_API_URL`.
- No secrets are stored in the repository; `.env.example` files contain placeholders only.

## Roles

| Capability | Salesperson | Manager | Admin |
|---|:-:|:-:|:-:|
| Own leads, tasks, viewings, deals | ✓ | ✓ (all) | ✓ (all) |
| Reassign leads and tasks | | ✓ | ✓ |
| Approve / pay commissions | | ✓ | ✓ |
| Team analytics | own only | ✓ | ✓ |
| Manage users and roles | | | ✓ |

Data scoping is enforced in the API, not only in the UI.

## Extending

- **Background jobs** — add Redis and a Celery worker (service stub in `docker-compose.yml`); move
  `notifications.services.notify_overdue_tasks` to a scheduled task.
- **Email / SMS** — implement `notifications.channels.BaseChannel` and register it in `NOTIFICATION_CHANNELS`.
- **Post-viewing follow-up** — implemented in `viewings.services.complete_viewing` (`VIEWING_AUTO_FOLLOWUP`).

## Notes

- API authentication uses JWT access/refresh tokens stored in `localStorage`. For a stricter deployment, move to
  httpOnly cookies.

# Deployment guide

Target architecture:

```
Browser ──► Vercel (Next.js, /frontend) ──── HTTPS + CORS ───► Django API (/backend, container host)
                                                                   │            │
                                                                   ▼            ▼
                                                          Neon PostgreSQL   S3-compatible bucket
                                                                            (photos, documents)
```

The browser calls the Django API directly using `NEXT_PUBLIC_API_URL`; no proxy is involved in production.

## 1. Database — Neon

1. Create a Neon project and database.
2. Copy the connection string. Use the **pooled** host for the app. It must end with `?sslmode=require`:
   `postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/DBNAME?sslmode=require`
3. This value becomes `DATABASE_URL` on the Django host.

Migrations run automatically on container start (`backend/entrypoint.sh`). For several replicas, run
`python manage.py migrate` once as a release step instead.

## 2. Backend — Django container

The `backend/Dockerfile` has a `prod` target (gunicorn on port 8000). Any container host works
(Render, Railway, Fly.io, Google Cloud Run, a VPS…). Build context is `backend/`, target `prod`.

Environment variables:

| Variable | Required | Example / notes |
|---|---|---|
| `DJANGO_DEBUG` | yes | `false` |
| `DJANGO_SECRET_KEY` | yes | long random string (`python -c "import secrets;print(secrets.token_urlsafe(64))"`) |
| `DATABASE_URL` | yes | Neon URL from step 1 |
| `DJANGO_ALLOWED_HOSTS` | yes | `api.example.com` (your API hostname, comma separated) |
| `DJANGO_CORS_ALLOWED_ORIGINS` | yes | `https://crm.example.com` (the Vercel production domain) |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | yes | `https://crm.example.com,https://api.example.com` |
| `DJANGO_CORS_ALLOWED_ORIGIN_REGEXES` | no | allow Vercel preview URLs, e.g. `^https://crm-[a-z0-9-]+-team\.vercel\.app$` |
| `AWS_STORAGE_BUCKET_NAME` | yes* | private S3-compatible bucket (*see note) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | yes* | bucket credentials |
| `AWS_S3_REGION_NAME` / `AWS_S3_ENDPOINT_URL` | depends | endpoint is required for R2 / B2 / MinIO |
| `DJANGO_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` | first deploy | creates the first admin if missing |
| `JWT_ACCESS_MINUTES`, `JWT_REFRESH_DAYS`, `DEFAULT_COMMISSION_RATE`, `MAX_UPLOAD_MB`, `DJANGO_TIME_ZONE` | no | defaults in `.env.example` |
| `SEED_DEMO_DATA` | no | leave `false`/unset in production (seeding is refused when `DJANGO_DEBUG=false`) |

\* Container filesystems are ephemeral on most hosts. Without a bucket, uploaded photos and documents are lost on
redeploy. Keep the bucket private: the API returns short-lived signed URLs and streams documents through
authenticated endpoints.

Health check path: `/api/health/` (exempt from the HTTPS redirect).

Production behaviour when `DJANGO_DEBUG=false`: no SQLite or localhost fallbacks, startup fails fast if
`DJANGO_SECRET_KEY`, `DATABASE_URL` or `DJANGO_ALLOWED_HOSTS` is missing, HTTPS redirect, HSTS, secure cookies,
`X-Forwarded-Proto` trusted from the platform proxy, static files served by WhiteNoise.

Verify a deployment: `python manage.py check --deploy` (run in the container with production variables).

## 3. Frontend — Vercel

1. Import the GitHub repository in Vercel.
2. **Root Directory:** `frontend`. Framework preset: Next.js (detected).
3. Environment variable (Production and Preview):
   `NEXT_PUBLIC_API_URL` = `https://api.example.com` (no trailing `/api`).
4. Deploy. Add the resulting production domain to `DJANGO_CORS_ALLOWED_ORIGINS` and `DJANGO_CSRF_TRUSTED_ORIGINS`
   on the backend, then redeploy the backend.

`NEXT_PUBLIC_API_URL` is inlined at build time, so changing it requires a new Vercel deployment.

## 4. First-run checklist

- [ ] Backend `/api/health/` returns `{"status":"ok"}` over HTTPS.
- [ ] Sign in with the superuser, create team members under **Settings → Team**.
- [ ] Upload a property photo and a deal document; confirm both survive a backend redeploy.
- [ ] Browser console shows no CORS errors.

## Local development (unchanged)

`docker compose up --build` still runs PostgreSQL, Django and Next.js locally with the `POSTGRES_*` variables from
`.env`; the Next.js dev server proxies `/api` and `/media` to the backend container.

# Architecture — Real Estate Sales CRM (internal)

Internal sales workspace for salespeople, managers and admins. Not a public marketplace.

## 1. Information architecture

```
Sales workspace
├─ Dashboard            role-aware ops view (personal for salesperson, team for manager/admin)
├─ Leads / Clients      table → lead profile (overview, matched properties, viewings, offers, tasks, notes, timeline)
├─ Properties           internal inventory table/grid → property page (interested leads, viewings, offers)
├─ Pipeline             kanban of deals Interested → Viewing → Offer Made → Negotiation → Under Contract → Closed (+ Lost)
├─ Tasks                my / today / upcoming / overdue / completed
├─ Viewings             weekly calendar + list, conflict warnings, feedback
├─ Deals                table → deal page (offers, documents + checklist, commission)
├─ Commissions          persisted backend calculations, pending → approved → paid
├─ Documents            transaction documents across deals
├─ Reports              manager analytics with filters
├─ Notifications        in-app inbox
└─ Settings             profile, password, team management (admin)
```

Core workflow: lead → match property → follow-up task → viewing → offer → deal pipeline → closed/lost → commission.

## 2. Data model

```
User(role: admin|manager|salesperson, commission_split)
Lead ──< LeadNote
Lead >──< Property   through LeadProperty(status: suggested|interested|viewing_scheduled|rejected|offer_made|purchased)
Property ──< PropertyImage
Task      → Lead?, Property?, Deal?, assigned_to
Viewing   → Lead, Property, assigned_to        (conflict detection; completion hook → follow-up Task)
Deal      → Lead, Property, assigned_to        (stage machine, one open deal per lead+property)
Deal ──< Offer
Deal ──1 Commission   (rate, split, deductions → gross/agent/net persisted by backend service)
Deal ──< Document     (category; required-document checklist)
Notification → User   (kind, link, dedupe_key; channels pluggable)
Activity  → actor, Lead?, Property?, Deal?    (timeline + dashboard feed)
```

## 3. Backend (Django + DRF) — organised by domain

```
backend/
  config/         settings, root urls
  core/           TimeStampedModel, Activity log, permissions/scoping, pagination, exception handler, seed_demo
  users/          custom email-login user, JWT auth, role permissions
  leads/          Lead, LeadNote, LeadProperty + services
  properties/     Property, PropertyImage + services (price change)
  tasks/          Task + filters (scope: today/upcoming/overdue/completed)
  viewings/       Viewing + conflict detection + completion hook
  deals/          Deal, Offer + stage machine service
  commissions/    Commission + calculation service
  documents/      Document + checklist + secure download
  notifications/  Notification + channel dispatcher (in-app now; email/SMS later)
  analytics/      dashboard + reports endpoints (read-only aggregation)
```

Rules: business logic lives in `services.py` (not views, not frontend). Role scoping: salesperson sees own
leads/tasks/viewings/deals/commissions; manager/admin see everything.

### API
```
POST   /api/auth/login/  /api/auth/refresh/      GET|PATCH /api/auth/me/      POST /api/auth/change-password/
GET|POST|PATCH /api/users/
GET    /api/dashboard/?days=
GET    /api/analytics/summary/?date_from&date_to&salesperson&property&source&location&deal_status
CRUD   /api/leads/   +assign/ +change-status/ +timeline/ +notes/ ; GET /api/leads/status-counts/
CRUD   /api/lead-properties/ (+set-status/)
CRUD   /api/properties/ (+images/)
CRUD   /api/tasks/ (+complete/ +reopen/)
CRUD   /api/viewings/ (+complete/ +cancel/)
CRUD   /api/deals/ (+move/) ; GET /api/deals/pipeline/ ; GET /api/deals/{id}/checklist/
CRUD   /api/offers/
GET    /api/commissions/ (+approve/ +mark-paid/ PATCH deductions/rate)
CRUD   /api/documents/ (+download/)
GET    /api/notifications/ (+mark-read/ +mark-all-read/ +unread-count/)
```

## 4. Frontend (Next.js App Router, TS strict, Tailwind, RHF, TanStack Query)

```
src/app/
  login/
  (app)/layout.tsx          auth guard + sidebar shell
  (app)/dashboard/
  (app)/leads/  leads/[id]/
  (app)/properties/  properties/[id]/
  (app)/pipeline/
  (app)/tasks/
  (app)/viewings/
  (app)/deals/  deals/[id]/
  (app)/commissions/
  (app)/documents/
  (app)/reports/
  (app)/notifications/
  (app)/settings/
src/components/ui/          Button, Input, Badge, Modal, Tabs, Table, Pagination…
src/components/layout/      Sidebar, Topbar, PageHeader
src/features/<domain>/      typed hooks (TanStack Query) + forms + domain components
src/lib/                    api client (JWT + refresh), formatters, constants
src/types/                  API types
```
Browser talks to `/api/*` on the Next origin; Next rewrites to the Django container (no CORS in production).

## 5. Docker

```
docker-compose.yml        dev: db + backend (runserver, bind mount) + frontend (next dev)
docker-compose.prod.yml   overrides: gunicorn + next standalone build, no bind mounts
volumes: postgres_data, media_data
Extension points: redis/celery services stubbed in compose comments; STORAGES driven by env for S3 later;
notification channels registry for email/SMS.
```

# Permission matrix

Status: **proposal agreed on the product decisions below; enforcement is verified by `backend/core/tests/`.**
Legend: ✅ enforced and tested today · ⚠️ **known gap** (the tests describe the desired behaviour and are marked
`known_gap`; they are expected to fail until the fix phase) · ❓ open decision (the tests only record today's behaviour).

## Product decisions

1. **Company Admin** (`role=admin`) is the only role that creates users, edits accounts, changes roles and activates or
   deactivates accounts. It is **not** a Django superuser and never needs Django's admin site.
2. **Manager** follows up the team and distributes work (assign/reassign leads, tasks, deals, viewings, properties). A
   manager cannot create or edit accounts or change anybody's role, their own included.
3. **Salesperson** works only on records assigned to them. Salespeople never reassign anything.
4. The product owner (provider) provisions each deployment and the first Company Admin. That is an operations task
   (a management command, planned), not an in-app role. Django superusers are provider-only.
5. Single-tenant: one backend, database and storage per customer, so there is no cross-company access to model.

## Accounts

| Capability | Admin | Manager | Salesperson | Notes |
|---|:-:|:-:|:-:|---|
| List users (assignee pickers) | ✅ all | ✅ all | ✅ active only, `id/full_name/role` | |
| See email, phone, job title, role, `is_active` of others | ✅ | ✅ | ✅ no (only `id/full_name/role`) | Professional contact data a manager needs to run the team. |
| See or edit **`commission_split`** | ✅ | ✅ never returned | ✅ never returned (not even their own) | Removed by the serializers (list, detail, `/auth/me/`, login), not by the UI. |
| Create user, choose role | ✅ | ✅ denied (403) | ✅ denied | |
| Edit user, change role, deactivate, set a new password | ✅ | ✅ denied | ✅ denied | |
| Delete user | ✅ not supported (405) | same | same | Deactivate instead. |
| Edit own name/phone/job title | ✅ | ✅ | ✅ | `/auth/me/` |
| Change own role, email, split, active flag | ✅ not possible | same | same | Read-only on `/auth/me/`. |
| Change own password (needs current password) | ✅ | ✅ | ✅ | |
| Demote or deactivate **the last active Company Admin** | ✅ refused (400, PATCH and PUT) | n/a | n/a | Only non-technical admins count; a superuser never stands in for one. |
| Company Admins never get `is_staff`/`is_superuser` through the API | ✅ | n/a | n/a | The API never touches those flags. |
| Create a user whose email differs only by letter case | ✅ clean 400 | n/a | n/a | Case-insensitive check. |
| Deactivated user: login, access token and refresh token stop working | ✅ | ✅ | ✅ | |

## Work records

"Own" means `assigned_to` (commissions: `salesperson`; documents: via the deal) is the current user.

| Resource and action | Admin | Manager | Salesperson |
|---|:-:|:-:|:-:|
| **Leads** list / view | all | all | own |
| create | ✅ (any assignee) | ✅ (any assignee) | ✅ forced to self |
| edit | ✅ | ✅ | own |
| reassign (`assigned_to_id`, `/assign/`) | ✅ | ✅ | ✅ denied |
| delete | ✅ | ✅ | ✅ denied |
| **Properties** list / view | all | all | all (shared catalogue) |
| create | ✅ | ✅ (chooses the owner) | ✅ always assigned to self, any `assigned_to_id` is ignored |
| edit | ✅ | ✅ | unassigned or own only |
| reassign, unassign or claim (`assigned_to_id`) | ✅ | ✅ | ✅ denied (400); resending the current owner is fine |
| delete | ✅ | ✅ | ✅ denied |
| **Deals** list / view / pipeline | all | all | own |
| create | ✅ | ✅ | only for own leads, assignee forced to self |
| edit (PATCH/PUT), move stage | ✅ | ✅ | own (the PATCH crash is fixed) |
| reassign (`assigned_to_id`) | ✅ | ✅ | ✅ denied (400) |
| point at another lead (`lead_id`) | ✅ | ✅ | ✅ own leads only (400 otherwise) |
| delete | ✅ | ✅ | ✅ denied |
| closed or lost deals | read-only for everyone | | |
| **Tasks** list / view | all | all | own |
| create | ✅ any assignee | ✅ any assignee | for self and own leads |
| reassign (`assigned_to_id`) | ✅ | ✅ | ✅ denied |
| point at another lead (`lead_id`) or deal (`deal_id`) | ✅ | ✅ | ✅ own leads and deals only (400 otherwise); unchanged links stay editable |
| **Viewings** list / view | all | all | own |
| create | ✅ | ✅ | own leads only, assignee forced to self |
| reassign (`assigned_to_id`) / change `lead_id` | ✅ | ✅ | ✅ denied (400) unless it is their own lead |
| **Offers** list | all | all | own deals |
| record an offer | ✅ | ✅ | own deals/leads only |
| **Documents** list / download | all | all | own deals only |
| upload | ✅ | ✅ | own deals only |
| delete | ✅ | ✅ | only what they uploaded |
| **Commissions** list / detail / nested in a deal | all, every field | all, status + net value only | own, status + net value + own `agent_split` |
| field-level visibility | see the table below | see the table below | see the table below |
| edit terms, **approve, mark paid** | ✅ | ✅ denied (403) | ✅ denied (403) |
| **Notifications** | own only | own only | own only |
| **Dashboard / analytics** | team scope | team scope | personal scope; the `salesperson` filter cannot widen it |

Decided: commission approval and payout are **Company Admin only**; managers follow status and value read-only.

### Commission fields by role (enforced in `CommissionSerializer`, the summary view and the nested deal commission)

| Field | Admin | Manager | Salesperson |
|---|:-:|:-:|:-:|
| id, deal, property, client, salesperson, `sale_price`, **`net_commission`**, status, approved/paid/created dates | ✅ | ✅ | ✅ (own) |
| `agent_split` | ✅ | ❌ | ✅ (own commission only) |
| `gross_commission`, `deductions` | ✅ | ❌ | ❌ |
| `commission_rate`, `agent_commission` | ✅ | ❌ | ❌ (hidden because with the sale price they reveal gross and deductions) |
| `/commissions/summary/` → `gross` | ✅ | ❌ (net only) | ❌ (net only) |

Without a request the serializer returns the narrowest view (default-deny). Calculations use the stored model values and are not affected.

### Technical accounts (staff / superuser)

Provider tooling, never part of the company-facing API: hidden from `/api/users/` (list, detail, search, filters, Team), not
editable or deletable through it (404, including password, role, email and active flag), never selectable as an assignee
(400), never counted as a Company Admin. Records already assigned to one stay readable; re-sending the unchanged assignee
keeps old records editable, but a technical account cannot be chosen anew. A technical account can still sign in and use the
product as itself.

## Passwords and sessions

- A new account (created by an Admin or by `provision_company_admin`) and any account whose password an Admin resets starts
  with a **temporary password**: `must_change_password` is set and the **API itself** refuses every request except
  reading the own profile and changing the password (403, code `password_change_required`).
- Changing a password (by the owner, an Admin, the shell or the Django admin) **revokes every access and refresh token issued
  before**; the change-password call returns a fresh pair so the caller keeps working. Deactivating an account also stops
  refresh. Accounts and tokens that predate this feature are not affected until their password changes.
- An Admin resetting **their own** password through Team is not forced to change it again.
- The first Company Admin of a deployment is created with `provision_company_admin` (a management command: `python manage.py provision_company_admin --help`).


## Company settings

- One row per deployment (`CompanySettings`): company name, workspace label, **base currency**, number/date locale and an optional logo.
  The interface language stays English (`language=en`, `direction=ltr`); the fields exist so Arabic/RTL can be added later.
- `GET /api/config/` (and `/api/config/logo/`) are **public** and return only those branding fields: no hosts, versions, counts, users
  or storage details. Rate-limited (`public_config`, 120/min).
- `GET/PATCH /api/company/settings/` and `POST/DELETE /api/company/settings/logo/` are **Company Admin only** (role `admin`).
  Managers and salespeople get 403, anonymous callers 401. Blocked in the public demo.
- **One base currency, no conversion.** Stored amounts have no currency of their own, so changing the code would silently change
  what every amount means. It is therefore refused (400, and `CurrencyLocked` at model level) as soon as any property, lead budget,
  offer, deal amount or commission exists. A future, separate financial migration is the only path (`save(allow_currency_change=True)`).
- Logo: PNG, JPEG or WEBP only, at most 1 MB and 4096 px a side, identified from the **file's bytes** (never Content-Type or the
  file name), structure checked, markup refused, **no SVG**. The stored name is generated; the old file is deleted on replace.
- Instance defaults (`COMPANY_NAME`, `COMPANY_CURRENCY`, `COMPANY_LOCALE` in `instance.env`) are applied **once**, by
  `apply_instance_defaults` at the first deploy. Afterwards the Company Admin's values are the source of truth; a redeploy or rollback
  never reverts them, and an instance whose settings were already edited is never overwritten.

## Health and logging

- `/api/health/` is liveness (no database), safe for container restarts. `/api/health/ready/` checks the database and pending
  migrations; it answers 404 unless the request carries `X-Monitor-Token` (`READINESS_TOKEN` in `secrets.env`) and the edge only lets
  `MONITOR_ALLOW` and loopback reach it. It is not a public endpoint.
- Logs are JSON lines on stdout with a request id (`X-Request-ID`, generated by the edge). Request bodies, Authorization headers,
  query strings, e-mail addresses, tokens, passwords and secret values are never logged, including inside exceptions and tracebacks.

## Not part of the product role model

- `/django-admin/` (provider tooling, blocked at nginx in production).
- Demo mode: `DEMO_MODE=true` disables uploads, user management and password changes on a **separate** deployment.
  It is never enabled on a customer deployment (the production compose file forces `DEMO_MODE=false`).

## How this is verified

`python manage.py test core.tests` runs against an isolated PostgreSQL test database (see
`backend/core/tests/README.md`). Gap tests are marked `@known_gap`: they assert the **desired** behaviour and are
expected to fail today. When a gap is fixed its test starts passing, the runner reports an "unexpected success", and the
marker must be removed. `RUN_KNOWN_GAPS=1` runs them as ordinary tests to show the raw failures.

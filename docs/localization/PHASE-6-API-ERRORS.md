# Phase 6: backend errors in the user's language

Implemented on 2026-11-22. Nothing is committed or deployed. No further phase is started. Backend code, response shapes, statuses, field names, payloads, authentication and permissions are untouched; the backend sends English prose and this phase does not change that.

## Why a frontend table, and not backend codes

The plan (row 6) proposed additive `code` and `params` fields on the backend. The owner's constraint for this phase is no backend contract change, so the translation is a **narrow, centralized table of the backend's own known messages** (`frontend/src/lib/api-errors.ts`). What the backend offers as stable identifiers is very little: `password_change_required` and `scheduling_conflict` (in the body), and `token_revoked` / `token_not_valid` (in the exception, not always in the body). Everything else is a status plus English prose. If the backend later adds codes, the table can be keyed by them without touching a screen.

## How an error becomes text

1. `describeError(error)` (pure) classifies by, in this order: a failed fetch (no connection); 5xx; 429 (with the wait in seconds when the server says it); the stable body codes; 401; the known message table; 403; 404; unknown.
2. `errorText(error, t, language, fallback?)` turns that into text:
   - **known message**: the `errors.*` catalogue message. English is the backend's own wording for every backend-owned message (a test checks it), so English users see the same text as before;
   - **status without a known message**: the generic message of that status (401 session expired, 403 forbidden, 404 not found, 429 too many requests, no connection, 5xx server error);
   - **unknown 4xx message**: never hidden. English shows it exactly as before (`ApiError.message`); another language shows `errors.unknownWithDetail` ("Something went wrong: ...") followed by the server's own text, which stays English because it is not translatable safely;
   - **5xx, a body that is not JSON, and any technical failure**: a safe generic message; the server's text is never shown (it may be a stack trace or an HTML page);
   - **not an HTTP answer** (for example a programming error): the action's own fallback message ("Could not save the lead."), never the technical text.
3. `fieldErrorTexts` translates the DRF field errors one by one and keeps them on their own fields (the form still calls `setError(field, ...)`).
4. `useApiErrors()` gives components `errorText` and `errorFields`. `ApiError.message`, `.status`, `.data` and `.fieldErrors` are unchanged.

## Error categories covered

| Category | Where it appears | Result |
|---|---|---|
| Authentication: wrong password (401) | sign-in | existing `auth.incorrectEmailOrPassword` |
| Authentication: too many attempts (429) | sign-in | `errors.rateLimited` / `rateLimitedWait` (plural in Arabic) |
| Authentication: no connection | sign-in | `errors.network` |
| Authentication: session expired or revoked (401) | any action | `errors.sessionExpired` / `sessionRevoked` / `notAuthenticated` (the redirect to sign-in is unchanged) |
| Temporary password gate (403 `password_change_required`) | any action | `errors.passwordChangeRequired` (the redirect is unchanged) |
| Validation (400, per field) | lead, property, task, viewing, offer, settings, password forms | the DRF and backend field messages of the table, on the original field |
| Business rules (400 `detail`) | deals, offers, commissions, documents, leads, properties, tasks, viewings, users | backend-owned messages of the table (91 entries in all: 76 exact messages and 15 messages with values such as file size, file type, stage, seconds) |
| Permissions (403 and the "own records / managers only" rules) | forms and toasts | `errors.forbidden` and the specific rule messages |
| Not found (404) | detail pages | `errors.notFound` (friendlier than "No Lead matches the given query.") |
| Conflicts (409, scheduling) | schedule viewing | existing conflict flow, plus `errors.schedulingConflict` |
| Rate limits (429) | any request | `errors.rateLimited`, with the wait when known |
| Network and server failures | forms, toasts, list pages | `errors.network`, `errors.server` |
| Unknown | anywhere | `errors.unknown` / `errors.unknownWithDetail` |

Surfaces: inline field errors, form-level errors (`FormError`), toasts and page-level `ErrorState` (about 45 call sites moved to `errorText`).

## Catalogue

A new namespace `errors` (19 namespaces now) with 96 keys in each language, exact parity, valid ICU. Four messages use ICU plurals with the six Arabic categories (the wait in seconds, and character counts); `catalogue-ar.test.ts` now compares a plural by its argument only, because the branches differ by language.

## Deliberate wording changes in English

- 404: "This item could not be found. It may have been removed." instead of the technical "No Lead matches the given query." / "Not found.".
- 5xx: "Something went wrong on our side. Please try again in a moment." instead of whatever text the server returned (previously the sign-in page showed its own message and other screens showed the raw text).
- Network failure: "Could not reach the server..." instead of the action's generic failure message.
- Password-similarity validation: one message without the attribute word ("This password is too similar to your name or email.").

## Limitations (documented, not worked around)

- Messages not in the table cannot be translated without a backend change: an unknown 4xx message stays English in Arabic (shown after a localized sentence). New backend messages need a table entry (the test that checks the table against the backend source catches a changed wording, not a new message).
- Django admin messages (`deals/admin.py`) are not reachable from the application and are not mapped.
- Composite messages such as several field errors in one banner use the first message only for the classification; the form shows field errors on their fields.
- Only the first message of each field is shown (as before).
- A dynamic value inside a message (file extension list, stage code) is shown as the backend sent it.
- Session expiry is shown by the message of the failing request and by the existing redirect; there is no separate "your session expired" banner on the sign-in page (that would be a new behaviour).
- Retry behaviour is unchanged (react-query retries 5xx and network failures up to twice, never 4xx).

## Tests

- `src/lib/api-errors.test.ts` (47): the table against the backend source and against both catalogues; English equals the backend wording; classification for network, 5xx, 401, 403, 404, 429, 409 and 400; known and unknown errors in both languages; the secret in a 5xx body never shown; Arabic plurals of the wait; field errors; the `ApiError` contract; the module makes no request.
- `e2e/errors.spec.ts` (English and Arabic): wrong password (real backend), 429, dropped connection and 500 on sign-in; validation on its own field, business rule, 403, unknown message, 500 and dropped connection in the lead form; a 403 toast; list pages with a dropped connection, a 500 and a 429; a real 404 lead. The failures that cannot be caused safely on the real backend are answered by the browser for one request; nothing reaches the backend and no test data changes.

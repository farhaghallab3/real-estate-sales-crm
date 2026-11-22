# Localization: final QA and release-readiness handoff

Date: 2026-11-22. Scope: the English/Arabic localization of the Real Estate CRM frontend (Phases 1 to 6). Nothing is committed, pushed or deployed. This document is an assessment, not a release.

## Verdict: CONDITIONAL

The localization is technically complete and passes every automated check performed. No code blocker was found. It is **not cleared for a customer release** until the items under "Release prerequisites" are done; two of them (human readability review, real-infrastructure verification) cannot be satisfied by tests.

## Blockers and conditions

| # | Item | Severity | Evidence | Status |
|---|---|---|---|---|
| C1 | Arabic wording has not been reviewed by Egyptian and Saudi readers | **Release condition** (human) | `GLOSSARY-AR-EN.md` section 15 and `PHASE-4-ARABIC-CATALOGUE.md` list the open terms; no review has happened | PENDING (not claimed done) |
| C2 | ARM64 on real hardware and Vercel itself were never exercised (Docker ARM64 ran under QEMU; Vercel was never built) | **Release condition** (infrastructure) | `PHASE-1.1-DEPENDENCY-GATE.md` "not proven yet" | PENDING |
| C3 | The language is saved per browser (cookie), not per user: a user who signs in on another device starts in the company language | **Known limitation** (needs backend `User.language`) | ADR-0001 decision 13(i); the switcher writes the `crm_lang` cookie only | OPEN, documented |
| C4 | Backend messages that are not in the frontend table stay English in Arabic (shown after a localized sentence) | **Known limitation** (API contract) | `PHASE-6-API-ERRORS.md` | OPEN, documented |
| C5 | EGP and SAR amounts, and the Egypt/Saudi week start, are verified by unit tests only: the demo company is USD / en-US and the base currency is locked once financial data exists | **Verification gap** | `src/lib/format.test.ts`; no browser test can change the currency | OPEN |
| C6 | KI-1 (intermittent next-intl webpack cache warnings): none seen in the last full runs; cause and effect on other builders unproven | Low | 0 occurrences in the final E2E builds; `PHASE-1.1-DEPENDENCY-GATE.md` section 13 | OPEN, unchanged |
| C7 | Two company-configuration requests on the `/` redirect and extra browser prefetch requests (observation from Phase 1.3) | Low | no user-visible effect; not re-measured in this pass | OPEN, unchanged |

No item is a code defect that blocks release.

## Defects found by this QA and fixed (all confirmed, all low risk)

All were English text living outside JSX text and attributes, where the lint guard cannot see it:

1. `window.confirm` dialogs in English in three places (remove a matched property, delete a document, cancel a viewing) -> catalogue keys `leads.confirmRemoveProperty`, `documents.confirmDelete`, `viewings.confirmCancel`.
2. `UserSelect` default empty label "Unassigned" (lead form, property form, assign dialog) -> `common.unassigned`.
3. Default placeholders "Search lead by name or phone…", "Search property by title or address…", "Search…", and the "No location" fallback in the pickers -> `leads.pickerPlaceholder`, `properties.pickerPlaceholder`, `ui.searchPlaceholder`, `leads.noLocation`.
4. Password validation messages in English on the change-password and settings forms -> `auth.newPasswordMustDiffer`, `auth.passwordsDoNotMatch`, `settings.passwordsDoNotMatch`.
5. The salesperson filter on the Deals and Commissions pages had no accessible name (also in English; an accessibility gap, not a translation gap) -> `aria-label` with the existing `common.salesperson`.

New guards so these cannot return: `src/i18n/release-guards.test.ts` (no literal text in `confirm/alert/prompt`; no English default parameter or `||` fallback in a component) and the Arabic dialog and accessibility audits in `e2e/release-qa.spec.ts`.

Files changed in this pass: `src/components/forms/pickers.tsx`, `src/components/ui/primitives.tsx`, `src/components/domain/documents-panel.tsx`, `src/components/domain/viewing-row.tsx`, `src/app/(app)/leads/[id]/page.tsx`, `src/app/(app)/deals/page.tsx`, `src/app/(app)/commissions/page.tsx`, `src/app/(app)/settings/page.tsx`, `src/app/change-password/page.tsx`, `messages/en.json`, `messages/ar.json` (both gained the same 12 keys); new `src/i18n/release-guards.test.ts`, `e2e/release-qa.spec.ts`, this document.

## What was verified

- **Switching and persistence:** the profile menu and the sign-in page switch both ways; the choice survives a reload, other pages and a new tab; the `crm_lang` cookie is `Path=/`, `SameSite=Lax`, not HttpOnly, one year; a saved language beats the company language, which beats the browser language; with nothing saved the default is English.
- **`lang` and `dir`:** `ar`/`rtl` and `en`/`ltr` on every route, in the initial HTML as well.
- **RTL geometry, 375 / 768 / 1280 px:** every authenticated route and the sign-in page, no horizontal overflow, sidebar and drawer on the right, dialogs fit, long Arabic names and unbroken Latin tokens do not break the layout.
- **Font:** IBM Plex Sans Arabic only under `:lang(ar)`. Across 14 representative screens Arabic transferred 6 files, 193,584 bytes (189 KB, budget 200 KB); English requested no font file.
- **Coverage:** no English catalogue text on any Arabic screen, dialog, attribute (`aria-label`, `title`, `placeholder`, `alt`) or browser dialog; no Arabic-Indic digits anywhere.
- **Accessibility (automated, both languages, 3 viewports):** one `h1` per page, document title, language attribute, accessible names on buttons, links and fields (Arabic has no more unnamed controls than English, and after the fix above neither language has any). This is an automated audit, not a screen-reader or WCAG audit.
- **Dates, relative time, amounts, phone and e-mail:** Arabic month and day-period words, `قبل / بعد` relative time, Latin digits, week header (Monday for the en-US demo company, Saturday/Sunday starts for EG/SA by unit test), phone numbers and e-mail addresses isolated left to right.
- **Errors:** known messages translated, unknown 4xx shown (English as before, Arabic after a localized sentence), 5xx and non-JSON bodies never shown, 401/403/404/429 and no connection handled, an expired session returns to the sign-in page in the same language with tokens cleared.
- **Catalogues:** 19 namespaces, exact key parity, valid ICU, same arguments and structure, Arabic plural categories, glossary terms.
- **Production isolation:** the normal build contains no pseudo-locale generator, no `en-XA` and no marker text (searched in `.next/static` and `.next/server` after the product phase), `I18N_PSEUDO` is empty in the server files, the flag is refused for a standalone or Vercel build, and a normal build refuses the `en-XA` cookie.
- **English regression:** the whole English suite (navigation, smoke for three roles, company settings, RTL, responsive, long text, forms, errors) passes in the same runs.

## Release prerequisites (before any customer release)

1. **Human review (C1):** Egyptian and Saudi readers review the glossary and the catalogue, starting with the open terms (`Under Offer`, `Listing portal`, `Lead`, commission `Pending`, `Funnel`, `Cold call`, `Sales pipeline`, `م²`, the greetings, the error messages). Record the outcome in the glossary; update `messages/ar.json` and the glossary test.
2. **Infrastructure (C2):** build and run on real ARM64 hardware and on Vercel (or the chosen host) with `NEXT_OUTPUT` and the environment of that host; confirm the Arabic font files are served with long-lived caching and that `I18N_PSEUDO` is not set.
3. **Decision on C3:** either accept per-browser language for the first release, or schedule the backend `User.language` field (own design, then the frontend change; ADR-0001 13(i) requirements 1 to 3).
4. **Accept or schedule C4:** new backend messages need a table entry; a stable `code` on the backend would remove the table.
5. **Real data pass:** one run on staging with an EGP or SAR company (the currency cannot be changed once data exists) to see amounts and the week start in the browser (C5).
6. Keep KI-1 and C7 on the list; re-check after the next dependency update.

## Evidence

- Static: `tsc` clean; `npm run lint` (including `lint:i18n`) clean, baseline empty.
- Vitest: 626 of 626 in 21 files.
- Docker E2E, one full isolated two-phase run after the last code change, reported separately: pseudo-locale phase 66 of 66; product phase 383 of 383 (includes `release-qa.spec.ts` and every earlier phase spec). An earlier full run before the picker, search-placeholder, password-message and select-label fixes gave 66 of 66 and 380 of 380; the accessibility audit measured 0 unnamed controls in Arabic and in English at all three widths after the fixes. Font transfer measured 193,584 bytes in 6 files for Arabic, 0 files for English.
- Safety: C: 21 GiB free; containers, volumes and networks unchanged; `crm-backend:e2e` unchanged; the only image difference is the temporary tag `crm-e2e-tmp:e12-...` that the stack retags. No dependency was added; the backend was not touched.


## Addendum (2026-11-22): infrastructure verification notes and the branding fallback

### Font note (correction to the QA statement "English requests no font file")
The English sign-in page loads **one** Arabic font file (`ibm-plex-sans-arabic-arabic-400`, 42,848 bytes) because the language switcher displays "العربية" and that label carries `lang="ar"`, so the browser fetches the Arabic face for those glyphs. The English application screens request no font file, and the app-shell language menu is expected to load the same single file when it is opened (not retested). Accepted as is: the label needs Arabic glyphs anyway. The Arabic budget (189 KB over 14 screens) is unchanged.

### Branding fallback (`/api/config/`): investigation result
Method: a local stand-in for the config endpoint (fast, slow 2 s and 3 s, HTTP 500, invalid JSON, never answering) in front of the standalone amd64 image; a browser check for hydration; no real API.

How it works: the root layout and the locale resolution both read the company configuration on the server (`getCompany`, 2.5 s timeout, one call per page render). The company language is the third source (saved cookie, then company, then browser, then default); when the configuration is unavailable the company language is simply missing and the browser language takes its place.

| Situation | Result |
|---|---|
| API fast | cookie, then company language (default `en`), as designed; the browser language never matters (the company always has a language) |
| API slow (2 s) | same result, first byte delayed by the API time |
| API slow over 2.5 s, hanging, HTTP 500, invalid JSON | company language is ignored: a visitor **without a saved language** gets the browser language, or English; company name falls back to "Keystone" and currency/locale to USD / en-US until the browser's own retry succeeds |
| A user with `crm_lang` saved | **language never affected** in any case; only the delay applies |

Findings:
1. **No hydration defect.** Six cases (config ok, timeout, 500, client retry succeeding or failing, Arabic and English, with and without cookie): 0 hydration errors. Server and client start from the same defaults; the client retry updates branding and currency after hydration (a visible "Keystone" to company-name swap, not a mismatch). `html lang` and `dir` never change after load, so a language chosen by the fallback stays until the next full request.
2. **Confirmed behavior, low severity (outage only): the first-visit language of a visitor with no saved language is not stable.** With a company language of `ar` and a slow or failing API, an English-browser visitor gets English instead of Arabic; with the API healthy the same visitor gets Arabic. With a company language of `en`, an Arabic-browser visitor gets Arabic only while the API is failing. Once the user saves a language (the switcher), it is stable.
3. **Confirmed delay, not a language defect: every page render waits for the configuration, also for users with a saved language.** When the API hangs a page waits 2.5 s; `/` waits **5 s** (two sequential calls, because the redirect re-renders the layout) and then `/dashboard` another 2.5 s. One page render makes one call otherwise. Whether soft client-side navigations re-run the layout was not measured (it needs an authenticated session): check it on staging.
4. This is the documented fallback ("render with the defaults, the browser retries"), not a regression of Phases 1 to 6.

Candidate fixes, **not implemented, each needs approval**:
- F1 (item 2, smallest): when the configuration is unavailable, treat the company language as the default language instead of falling through to the browser language. One line in `src/i18n/server-locale.ts` plus a test. Result: the same language on every outage for first-time visitors (English), and the same as the healthy-API result for the default company. It does not help an Arabic company during an outage.
- F2 (item 3): replace `redirect("/dashboard")` in `src/app/page.tsx` by a `redirects()` entry in `next.config.mjs`, so `/` no longer renders the layout twice. Own check needed (this config deliberately has no locale redirects).
- F3 (outage only): a shorter timeout, or serving the last good configuration for a short time. The latter would be module-level state, which the current design deliberately avoids; not recommended without a decision.
Recommendation: do nothing before the staging measurements (real API latency from the Vercel region); then decide on F1/F2. No confirmed defect blocks release.

### Memory limit (256 MB) for the frontend container: provisional
- Native amd64, standalone image: about 50 MiB idle; about 60 MiB peak sampled during bursts of 450 and then 600 page requests with 30 in parallel (sign-in page, both languages); no restart, no OOM kill. These are small unauthenticated pages (the application data is loaded by the browser, not rendered on the server), so authenticated navigation is not covered.
- The V8 heap limit inside the 256 MB container is 259 MB, i.e. equal to the container limit: a memory leak would be killed by the container before V8 collects hard. A lower `--max-old-space-size` would be a configuration change (not applied, needs approval).
- Emulated ARM64 (QEMU) used about 208 MiB: emulation overhead, **not representative**.
- Verdict: 256 MB is acceptable as a **provisional** limit for amd64. **Native ARM64 memory is unverified.** Re-measure on a real ARM64 host and with authenticated navigation on staging before fixing the number.

### Local resources left in place (for the owner to remove)
Images `crm-frontend:qa-amd64`, `crm-frontend:qa-arm64`; stopped containers `qa-frontend-amd64`, `qa-frontend-arm64`, `qa-branding`.

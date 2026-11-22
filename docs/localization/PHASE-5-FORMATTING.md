# Phase 5: locale-aware dates, numbers, currency and the calendar

Implemented on 2026-11-22. Nothing is committed or deployed. Phase 6 (backend error texts) is not started. Backend, authentication, permissions, production data and API contracts are untouched.

## What changed

- **One place for formatting:** `frontend/src/lib/format.ts` (`makeFormatters`) and the hooks in `src/lib/company.tsx` (`useFormat()`, `useMoney()`, `useWeek()`). The formatters are built from an explicit config (interface language, company locale, base currency), with no module-level state. Every page and component that formatted a date, time, relative time or amount now uses `useFormat()`; `lib/format.ts` no longer exports date functions that ignore the language.
- **Formatting locale (ADR-0001 2.4):** `formattingLocale(language, companyLocale)`: language from the interface, region from the company locale, Latin digits, Gregorian calendar.
- **Amounts:** `Intl.NumberFormat` with the company's base currency (`currency_code`), no conversion, stored values and precision unchanged. `currencyDisplay: "symbol" | "code"` is supported by the formatter; there is no company setting for it yet (needs a backend field), so the interface uses the symbol.
- **Dates and times:** English keeps its exact previous output (date-fns patterns `MMM d`, `MMM d, yyyy`, `h:mm a`). Other languages use `Intl.DateTimeFormat`. "Today, / Tomorrow, / Yesterday," and the date-time joiner are catalogue messages (`ui.whenToday`, `ui.whenTomorrow`, `ui.whenYesterday`, `ui.dateTime`).
- **Relative time:** English output is unchanged (`5 days ago`, `3 hours from now`, from `ui.relativeAgo` / `ui.relativeFromNow`). Arabic uses `Intl.RelativeTimeFormat` with the same count and unit (`قبل يومين`, `خلال 3 ساعات`); the two Arabic catalogue messages are the fallback if `Intl.RelativeTimeFormat` fails. Deviation from the plan text: English does not use `Intl.RelativeTimeFormat`, because its wording ("from now") would change, and the owner asked to preserve English.
- **Catalogue:** the three date patterns of `viewings` (`mmmD`, `mmmDYyyy`, `eee`) were removed (they were format patterns, not text); six `ui` messages were added to both catalogues. Net: 592 - 3 + 6 = 595 messages in each.
- **Week start and weekend:** `src/lib/week.ts`, defaults from the company region. EG, QA, KW, BH, OM: week starts Saturday, weekend Friday-Saturday; SA: Sunday, Friday-Saturday; AE: Monday, Saturday-Sunday (CLDR data of the runtime's Intl). Every other region keeps Monday and Saturday-Sunday, exactly the behaviour before Phase 5 (the demo company is en-US, so nothing changes there). The viewings week view uses it. There is no company override yet (needs a backend setting).
- **RTL display of phone numbers and e-mail addresses:** the `Ltr` primitive (`<bdi dir="ltr">`) wraps phone numbers and e-mail addresses in the lists, the lead and property pages, the settings team table, the dashboard and the profile menu.
- **Unchanged on purpose:** `toLocalInput` / `fromLocalInput`, ISO payloads, `fileSize` (Latin units, as in the catalogue's "10 MB"), `pct` (`12.5%`, Latin digits), sorting, filtering and every form payload.

## Behaviour change for English (the only one)

For an English-language user in a company whose locale is not `en-*` (for example `ar-EG` with EGP) amounts used to be formatted with the company locale itself (Arabic pattern, Latin digits); they now follow the user's language (`EGP 1,234,568`), as ADR-0001 2.4 and the plan require. The default demo company (en-US, USD) is byte-identical to before (checked by `src/lib/format.test.ts` against a copy of the old implementation).

## Formatting examples

| | English (en-US, USD) | Arabic (ar-EG, EGP) | Arabic (ar-SA, SAR) |
|---|---|---|---|
| amount | `$1,234,568` | `‏1,234,568 ج.م.‏` | `‏1,234,568 ر.س.‏` |
| compact | `$1.2M` | `1.2 مليون ج.م.‏` | `1.2 مليون ر.س.‏` |
| date | `Mar 4` / `Mar 4, 2025` | `4 مارس` / `4 مارس 2025` | `4 مارس` |
| time | `2:30 PM` | `2:30 م` | `2:30 م` |
| when | `Today, 4:00 PM` | `اليوم، 4:00 م` | |
| relative | `2 days ago` | `قبل يومين` | |

## Open observations (not resolved, no application change made)

1. **Lead detail E2E failure: RESOLVED in the follow-up pass (2026-11-22), root cause proven.** A diagnostic run that started the pseudo build phase and then the product phase on the same backend reproduced it and captured the data: the suite's lead id was 51, a long-text lead created by the FIRST phase's global setup (Arabic long name, `assigned_to: null`); the current user was sofia@crm.local (salesperson); `GET /api/leads/51/` as sales answered 404 "No Lead matches the given query" (salespeople see only leads assigned to them, which is correct), while the manager got 200; the sales user's own list (13 leads) did not contain it. Cause: `e2e/global-setup.ts` took `first("leads")` from the MANAGER's list, newest first; in a two-phase run the second phase's newest lead is the first phase's long-text lead. Fix (test setup only; no permission, authorization or application change): the lead and deal ids are taken from the SALES user's own list (so every role can open them), and records whose name or title carries the long-text marker are skipped (also for the property). After the fix the same two-phase diagnostic chose lead 5 (Mei Tanaka, assigned to Sofia) and the sales user got 200.
2. **Viewings "Scheduled" tab repeated requests: FIXED.** Exact source: `viewings/page.tsx` built the list parameters with `start_after: new Date().toISOString()` on every render, so the react-query key (`["viewings", params]`) changed on every render. Fix: the parameters are built by pure functions (`src/lib/viewings-query.ts`) and the clock is read once per genuine view change, `useMemo(() => new Date().toISOString(), [tab, f.assigned, f.page])`; the request is otherwise identical (same filters, ordering and page size). Consequence to know: "upcoming" is measured from when the view was opened or last changed, not from every render. Regression tests: `src/lib/viewings-query.test.ts` (parameters are a pure function of their inputs even when the clock moves; genuine changes give different parameters) and `e2e/viewings-requests.spec.ts` (an unchanged Scheduled or Week view requests once and goes network-idle; changing tab or week requests again). With the bug put back temporarily, the two Scheduled-tab tests failed in English and Arabic (4 failures) and the Week-tab and booking tests passed; with the fix restored they pass.
3. The Phase 4 terminology review list and the Egyptian/Saudi readability gate remain open (`PHASE-4-ARABIC-CATALOGUE.md`). New wording to include in that review: `اليوم، / غدًا، / أمس،` as the prefix of a time, the Arabic `قبل / بعد` fallback messages, the week-start defaults, م / ص as day-period marks.
4. Not done in Phase 5: a company-level override for week start, weekend and currency display (they need backend settings), the Arabic-Indic numbering option and Hijri dates (not part of the MVP), and the multi-language consistency risk of ADR-0001 decision 13.

## Tests

- `src/lib/format.test.ts` (40): English equals the old implementation for dates, times, when, relative time (offsets from seconds to years) and amounts; EGP and SAR in English and Arabic; KWD/BHD/OMR three decimals; ISO-code display; no crash for unknown currency or locale; Arabic dates, times, today/tomorrow/yesterday, weekday and relative time; Latin digits; week start for EG, SA, AE and the default; no shared state.
- `e2e/formatting.spec.ts` (English and Arabic): every route has Latin digits and, in Arabic, no English month, relative time or AM/PM; relative time and day-period marks; the week header (first day Monday for en-US, range format and weekday names); amounts; the lead form sends the same API values in both languages (the request is intercepted, nothing is created); phone numbers and e-mail addresses are isolated left-to-right runs in an Arabic page, in the right order.

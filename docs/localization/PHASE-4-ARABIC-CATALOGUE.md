# Phase 4: the Arabic catalogue and the language switcher

Implemented on 2026-11-22. Nothing is committed or deployed. Phase 5 (dates, numbers, currency) and Phase 6 (backend error texts) are not started.

## What was done

- `frontend/messages/ar.json`: the Arabic catalogue, **same keys, same order, same 18 namespaces** as `messages/en.json` (592 messages, 539 top-level entries counting each enum kind once; the English catalogue gained one key, `shell.language`, the accessible name of the switcher, so both hold 592). Modern Standard Arabic, neutral between Egyptian and Saudi usage, written to `GLOSSARY-AR-EN.md`.
- `SUPPORTED` is now `["en", "ar"]`; `messages.ts` lists the Arabic catalogue (literal import). Resolution precedence is unchanged (saved language, then company language, then browser, default `en`), so English stays the default and the pseudo-locale stays E2E-only (its source is still the English catalogue).
- `<html lang="ar" dir="rtl">` comes from the existing engine (`directionFor`), with the Phase 2 logical CSS and the IBM Plex Sans Arabic font (only requested for Arabic pages).
- Language switcher (`src/components/layout/language-switcher.tsx`): the profile menu (radio items) and the sign-in page (toggle buttons). It uses `useLanguage()` (the `crm_lang` cookie, then a refresh). Language names are endonyms kept in code (`LANGUAGE_NAMES`), not translated. **Per-user persistence is still deferred**: it needs `User.language` on the backend, which is out of scope.
- `e2e/strings.ts` now reads the real catalogues (no literal interface text any more).

## Terminology decisions that go beyond the glossary text

| English | Arabic | Note |
|---|---|---|
| Lead (singular, in a sentence) | عميل / عميل محتمل | plural labels and navigation use العملاء, as the glossary says |
| Offer (the document) / Offer made | عرض سعر / تقديم عرض | `enums.dealStage.offer_made` is the action stage |
| Pending commission | بانتظار الاعتماد | |
| Under offer | عليه عرض | |
| Area unit m² | م² | |
| Sample location in a placeholder | وسط المدينة | the English example was a place name |
| "The interface language stays English" (company settings) | rewritten: the setting does not change the interface language | the literal translation would have been false in Arabic |

Date patterns (`viewings.mmmD`, `mmmDYyyy`, `eee`) are format patterns, not text: they stay identical until Phase 5.

## Needs review by Egyptian and by Saudi readers (NOT done)

The glossary review is still open and is not claimed complete. In particular:

1. `Under Offer` as عليه عرض, and the property-status set as a whole.
2. `Listing portal` as بوابة الإعلانات العقارية.
3. `Lead` as عميل محتمل vs عميل متوقع.
4. Commission `Pending` as بانتظار الاعتماد vs معلّقة.
5. `Funnel` as قمع المبيعات / قمع العملاء.
6. `Cold call` as اتصال مباشر (a Saudi reader may prefer اتصال بارد/اتصال تسويقي).
7. `Sales pipeline` as مسار المبيعات (also used for the Deals/Pipeline screens).
8. م² vs متر مربع, and "MB" kept Latin.
9. The greeting pair (صباح الخير / مساء الخير for afternoon and evening) and short imperative labels (e.g. "تأكيد الدفع").
10. An e-mail address inside an Arabic sentence (`auth.accountEmailWasSetUp`) relies on the browser's bidirectional handling; check the display with real addresses.

## Plural forms

The English catalogue has no plural message, so no Arabic message uses plural branches yet. `src/i18n/catalogue-ar.test.ts` fixes the contract for the first one: six categories (zero, one, two, few, many, other), only valid categories or `=N`, an `other` branch always, checked on 0, 1, 2, 3-10, 11-99 and 100.

## Tests

- Vitest `src/i18n/catalogue-ar.test.ts` (parity, ICU validity, same arguments and structure, formatting of every message without an error, no left-over English, Latin digits, glossary checks, plural contract). The tests that assumed Arabic was unsupported were updated to the new rule.
- Playwright `e2e/arabic.spec.ts` (every route and `/login` at 375, 768 and 1280 px: `lang`/`dir`, font, no English interface text, no problems, RTL geometry, dialogs, switcher both ways) and an updated `e2e/i18n-shell.spec.ts`.

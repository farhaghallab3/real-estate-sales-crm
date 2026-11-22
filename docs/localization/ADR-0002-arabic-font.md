# ADR-0002: Arabic font (open licence, self-hosted)

* **Status:** Candidate (owner review of Phase 0, 2026-11-18). The final approval follows a visual review in Phase 2 (section 5), with Noto Sans Arabic as the fallback.
* **Decision in one line:** use **IBM Plex Sans Arabic**, weights **400 / 500 / 600**, self-hosted from the pinned `@fontsource/ibm-plex-sans-arabic` package, applied **only under `:lang(ar)`**. Fallback if the Phase 2 check fails: **Noto Sans Arabic**.

## 1. Requirements

* Open licence that allows self-hosting and redistribution inside our Docker images and on Vercel.
* No request to a third party (Google Fonts) at build or at run time: customers' browsers and our CI must not depend on it, and no visitor data leaves the deployment.
* Good Arabic shaping and readability at 13-14 px (the UI is dense: tables, badges at 11-12 px).
* A **Latin face that matches**, because the content is bilingual (English names, addresses, references, numbers next to Arabic words).
* Weights actually used: counted in the code, `font-medium` 43 times (500), `font-semibold` 34 times (600), regular text 400, **no bold (700)**.
* English UI unchanged: the English interface keeps its current system font stack, with no new bytes.

## 2. Candidates, measured

Both are SIL Open Font License 1.1 (checked in the npm packages: `@fontsource/ibm-plex-sans-arabic@5.3.0`, `@fontsource/noto-sans-arabic@5.3.0`, `@fontsource-variable/noto-sans-arabic@5.3.0`; each ships its `LICENSE`). Sizes are the real `woff2` files from those packages (bytes, already compressed).

| | IBM Plex Sans Arabic | Noto Sans Arabic (static) | Noto Sans Arabic (variable) |
|---|---|---|---|
| Licence | OFL-1.1 | OFL-1.1 | OFL-1.1 |
| Arabic subset, weight 400 / 500 / 600 | 42.8 / 45.3 / 45.7 KB | 48.8 / 53.1 / 53.3 KB | **one file, all weights: 166.0 KB** |
| Latin subset, 400 / 500 / 600 | 19.2 / 20.1 / 20.5 KB | 10.7 / 10.8 / 10.7 KB | 31.4 KB (all weights) |
| Latin-ext subset (per weight) | ~6.6 KB | ~6.5 KB | 16.8 KB |
| **Worst-case first view in Arabic** (3 weights, Arabic + Latin) | **~194 KB** (134 + 60) | ~187 KB (155 + 32) | ~197 KB |
| Weights available | 100-700 static | 100-900 static | 100-900 variable (+ width) |
| Latin side | its Latin subset is about twice the size of Noto's (19-20 KB per weight), which suggests a fuller Latin design from the same family (IBM Plex Sans); to be confirmed by eye in the Phase 2 gate | a smaller Latin subset (10.7 KB per weight); its coverage and design were not inspected here, to be checked in the same gate | same smaller Latin |
| Subsets by `unicode-range` | yes (`400.css` etc.) | yes | yes |

Reading of the numbers: transfer cost is a tie (~190-200 KB worst case, and only for Arabic sessions; browsers fetch only the subsets a page needs). What differs is the Latin side: with a bilingual CRM, English words, names and numbers sit next to Arabic ones on almost every screen, and Plex is expected to give one coherent family for both (to be confirmed in the gate). Noto's strengths are breadth (many Arabic-script languages, one variable file) and neutral shapes; we only need Arabic.

## 3. Decision

IBM Plex Sans Arabic, because: matching Latin in the same family for bilingual screens; static weights let us ship exactly the three we use; the same transfer budget; OFL, and the package is versioned and pinned in `package-lock.json`.

How it is loaded:

* Dependency: `@fontsource/ibm-plex-sans-arabic` (exact version, dev-time asset only).
* CSS: import the **weight files that carry `unicode-range`** (`@fontsource/ibm-plex-sans-arabic/400.css`, `500.css`, `600.css`); the browser then downloads only the Arabic and Latin subsets a page really uses. (The `arabic-400.css`-style files have no `unicode-range`, so they are not used.) `font-display: swap` is already in those files.
* Applied with `:lang(ar) { font-family: "IBM Plex Sans Arabic", <existing system stack> }` and `html[lang="ar"]` rules; **English keeps `ui-sans-serif, system-ui, ...` unchanged.**
* Next.js bundles the referenced font files into `.next/static/media` (self-hosted by our own server or Vercel; no external request). Unused subsets are copied to disk but never transferred.
* Licence: keep the package `LICENSE` (OFL text and the IBM copyright) in the build output or in `docs/third-party/`, as the OFL requires when redistributing.
* Arabic typography rules that go with it (Phase 2): no letter-spacing (`tracking-*`) and no `uppercase` under `:lang(ar)`; minimum text size 12-13 px instead of the 11 px `text-2xs`; a taller line-height for body text; the Inter-specific `font-feature-settings: "cv11","ss01"` is dropped for Arabic.

## 4. Alternatives considered

* **Noto Sans Arabic variable:** a valid fallback (the whole range of weights in one request and the broadest tooling), at the price of a weaker Latin companion. Chosen only if the Plex check fails.
* **`next/font/google`:** self-hosts at build time but needs the Google Fonts network during the build: rejected (reproducible, offline-capable builds).
* **`next/font/local` with files committed to the repo:** equivalent to the npm package but we would own the binaries; the npm package is simpler to update and audit.
* **System fonts only:** inconsistent between Windows, Android, iOS and Linux (Inter has no Arabic); not acceptable for a product sold on its interface.
* **Cairo / Tajawal / Almarai:** not evaluated; they are display-oriented by design and the UI is dense with tables, so they were not shortlisted.

## 5. Phase 2 gate (what must be true before the font is locked)

On the real screens (dashboard, leads list, lead detail, deal detail, pipeline), in Arabic with long names, at 375 / 768 / 1280 px:

1. **Tabular figures:** `font-variant-numeric: tabular-nums` is used in 58 places; the digits in columns must line up with this font. If the Latin digits of Plex do not provide the tabular feature, numbers get an explicit tabular font fallback.
2. Readability at 12-14 px (digits, diacritics, ligatures) approved by the reviewers (one Egyptian, one Saudi) against a Noto Sans Arabic rendering of the same screens.
3. Transfer measured in the browser for a cold Arabic load stays within the budget in the plan (<= ~200 KB of font, Arabic session only).
4. The English UI is pixel-identical (no new font requests when `lang="en"`).

If any of 1-3 fails: switch to Noto Sans Arabic (variable) and repeat the check; this ADR is updated either way.

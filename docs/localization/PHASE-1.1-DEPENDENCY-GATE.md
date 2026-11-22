# Phase 1.1: Dependency and build compatibility gate (report)

* **Status:** **Phase 1.1 ACCEPTED by the owner on 2026-11-20.** Gate complete (parts A and B); decision: `next-intl@4.15.1`, pinned exactly, fallback `use-intl@4.15.1` ([ADR-0001](ADR-0001-localization-architecture.md) section 2.1 and decisions 8 to 10). The dependency, the plugin, an empty `messages/en.json` and a placeholder `src/i18n/request.ts` are in the working tree (E1) and were verified on the real project (E1.1, E1.2: section 12). **Accepted with these limitations:** ARM64 on **real hardware was not tested** (QEMU only); the Vercel-style build was run **locally**, not on Vercel; the 188 E2E ran with a **temporary copy of `stack.mjs` that differs from the original by two lines** (section 12); one **known issue** is recorded (section 13). **Nothing is committed, pushed or deployed yet.**
* **Dates:** part A on 2026-11-18 (footprint, audit, amd64 builds); part B on 2026-11-20 (runtime, SSR, native files in production, ARM64 under QEMU, repeated timing, repeated audit); acceptance runs E1, E1.1, E1.2 on 2026-11-20. **Related:** [plan](MVP-AND-PHASE-1-PLAN.md) step 1.1.
* Parts A and B ran in isolated copies of `frontend/` outside the repo. The dependency was added to the repository afterwards, in its own steps (E1 and later), after the separate Next.js 15.5.29 update.

> Correction of the first version of this report: it said that Docker had stopped answering, that four checks were therefore not done, and that the `crm-fe-gate:*` images were still to be removed. That is history. The disk problem was resolved, Docker was healthy again, the missing checks were run in part B, and every temporary resource of the gate was removed (section 11).

## 1. What was compared

All builds use the **repo's own Dockerfile** (`node:22-alpine`, `npm install`, `next build` with `NEXT_OUTPUT=standalone`, then the minimal standalone `prod` stage), from isolated copies of `frontend/`, with a throw-away probe (provider in the root layout, one client page using translations, `en`/`ar` catalogs).

**Part A (2026-11-18), amd64:**

| Name | Next.js | i18n package |
|---|---|---|
| `base` | 15.5.27 (what the repo has) | none |
| `base29` | 15.5.29 (latest 15.x) | none |
| `n440` | 15.5.29 | `next-intl@4.4.0` (former first candidate) |
| `n4151` | 15.5.29 | `next-intl@4.15.1` |
| `uintl` | 15.5.29 | `use-intl@4.15.1` only |

**Part B (2026-11-20):** same Next.js **15.5.27** and React **19.3.0** as the project (no upgrade; the lockfile resolved the same versions in every variant), exact versions added with `npm install --save-exact --package-lock-only`:

| Name | i18n package | Platforms |
|---|---|---|
| `base` | none (project as is) | amd64 |
| `ni` | `next-intl@4.15.1` | amd64 and **ARM64 under QEMU** |
| `ui` | `use-intl@4.15.1` | amd64 |

The part B probe: root layout computes the locale from the `NEXT_LOCALE` cookie (`ar` or `en`), renders `<html lang dir>` from it and wraps the tree in `NextIntlClientProvider` (`ni`) or a client wrapper around `IntlProvider` (`ui`); a client page `/probe` uses `useTranslations`. **The probe is a copy of the layout, not the real one**; see the limits in section 10.

## 2. Dependency footprint (from the resolved lockfiles)

| Candidate | Packages added to the lockfile | Native packages | Licences |
|---|---|---|---|
| `next-intl@4.4.0` | 11 | none (pure JS) | MIT, BSD-3-Clause |
| **`next-intl@4.15.1`** | **46** (changed existing packages: 0) | **`@swc/core` 1.16.22 and `@parcel/watcher` 2.6.0, both with install scripts**, their per-platform binary packages (29 lockfile entries under `@swc/` and `@parcel/`; one binary per family is installed per platform; `linux-x64-musl` and `linux-arm64-musl` both exist), `@eloqnt/*`, `po-parser`, `next-intl-swc-plugin-extractor` | MIT (30), Apache-2.0 AND MIT (11), Apache-2.0 (4), BSD-3-Clause (1) |
| **`use-intl@4.15.1`** | **7** (`@formatjs/*`, `icu-minify`, `intl-messageformat`, `@schummar/icu-type-parser`; changed existing packages: 0) | none, no install scripts | MIT (6), BSD-3-Clause (1) |

* The native packages of `next-intl` >= 4.5.0 belong to its **message-extraction feature** (not used by us). They are regular dependencies with install scripts, so they run at `npm install`.
* Packages actually installed on the build platform (Alpine): project baseline 368; `next-intl` 393 on ARM64 (the amd64 install step was served from the build cache in the recorded run, so no amd64 number is claimed).
* **Version skew (part A):** `next-intl@4.4.0` pulls `use-intl@4.15.1` and `icu-minify@4.15.2` through caret ranges while its own `use-intl@4.4.0` ends up nested; pinning `next-intl@4.4.0` alone does not give a consistent set.

## 3. Security (`npm audit` against the registry, plus the public GitHub advisory database)

**Part B (lockfile audit of the three part B trees):** **identical in all three** (baseline, `next-intl@4.15.1`, `use-intl@4.15.1`): 3 vulnerabilities (1 critical, 1 high, 1 moderate), **all already present in the project**; **neither candidate adds one.**

| Item | Finding |
|---|---|
| `next` 15.5.27 (critical) | GHSA-2464-fhr4-w9xw: remote code execution in the Image Optimization API when SVG files are used; GHSA-p3m5-59mp-jv5r (CVE-2026-94482, high): DoS in the App Router for applications that use **Server Actions**. Both patched in **15.5.28**; **15.5.29** is the latest 15.x. The code uses neither `next/image` nor Server Actions (checked by search) and the Docker image is musl (Alpine), so practical exposure looks low, but the project is also deployable on Vercel. **Independent of i18n; a separate, prerequisite change is recommended** (and `npm audit` reports a fix available). |
| `postcss` (high), `postcss-selector-parser` (moderate) | build-time tooling (XSS in stringify output, file read, quadratic selector parsing); fix available. Pre-existing backlog. |
| Part A: `next-intl` <= 4.9.1 (so `4.4.0`) | GHSA-8f24-v5vv-gm5j (open redirect, middleware with `localePrefix: 'as-needed'`) and GHSA-4c35-wcg5-mm9h (prototype pollution with `experimental.messages` + `messages.precompile`): neither feature is used here, but `npm audit` flags `4.4.0` (moderate). `4.15.1` and `use-intl@4.15.1` are not flagged. |
| Supply-chain surface | `next-intl@4.15.1` adds two packages with install scripts and 39 more packages than the fallback (46 vs 7). Not a vulnerability; a larger surface to keep audited (mitigation in ADR-0001 section 2.1). |

Caveat: in part A the output of `npm audit` varied between two runs on the same lockfile (a longer list of build-tool advisories once, 3 totals later); the facts above were identical in the runs that are quoted and were confirmed against the public advisory records. In part B the three trees gave the same 3 totals. No source-code review of the packages was done.

## 4. Compatibility and runtime results (part B)

| Check | `next-intl@4.15.1`, amd64 | `use-intl@4.15.1`, amd64 | `next-intl@4.15.1`, ARM64 (QEMU) |
|---|---|---|---|
| `npm install` | passed | passed | passed (the install scripts ran) |
| Production build with the repo's Dockerfile (standalone, type check, lint) | passed | passed | passed |
| Standalone production container starts and serves | yes | yes | yes (`aarch64`, Node 22) |
| `/probe` without cookie: `<html ...>` | `lang="en" dir="ltr"` | `lang="en" dir="ltr"` | `lang="en" dir="ltr"` |
| `/probe` with `NEXT_LOCALE=ar`: `<html ...>` | `lang="ar" dir="rtl"` | `lang="ar" dir="rtl"` | `lang="ar" dir="rtl"` |
| Translated text present in the **server-rendered HTML** | `3 items` / `Hello probe`; `3 عناصر` / `مرحبا بالاختبار` | same | same |
| Real `/login` page still renders | yes | yes | yes |
| Versions inside the production image | next 15.5.27, react 19.3.0, react-dom 19.3.0 | same | same |
| Peers (`next` ^12-^16, `react` ^19, TypeScript ^5) | satisfied | satisfied | satisfied |
| Existing routes and shared JS | identical to the baseline (`/leads` 4.09 kB / 154 kB, `/login` 5.64 kB / 130 kB, shared 103 kB) | identical | same |

Checks were made by running the production image **without network** and requesting pages from inside the container, with and without the cookie.

**ARM64 under QEMU:** passed with no illegal-instruction, crash or install error. What differs is only time (section 7). Hence there is **no sign of a problem in the library on `linux-arm64-musl`**; the slowness is the emulation. **Real ARM64 hardware was not tested.**

A note on the first part B build attempt: it failed because the probe layout left an unused variable that the project's ESLint rule turns into a build error. That was a defect of the probe (fixed), not of either library.

## 5. Native packages in production (part B)

| Where | `next-intl@4.15.1` amd64 | `next-intl@4.15.1` ARM64 | `use-intl@4.15.1` amd64 |
|---|---|---|---|
| `@swc/core` in the **final production image** | **absent** | **absent** | absent |
| `@parcel/watcher` in the final production image | **absent** | **absent** | absent |
| `/app/node_modules/@swc` | only `helpers` (Next's own, pure JS) | only `helpers` | only `helpers` |
| `next-intl` / `use-intl` as folders in the image | absent (bundled into `.next/server`) | absent | absent |
| Search of the whole image for `*swc*` and `*parcel*watcher*` | only Next's internal files | same | same |
| **Builder stage** (build time only) | `@swc/core` 1.16.22 and `@parcel/watcher` (`linux-x64-musl`) both **load** | both load (`linux-arm64-musl`) | not present |

Effect: **no effect on the production image content or on running it**, apart from the size below. At build time the builder `node_modules` is ≈ 570 MB (`next-intl`) vs ≈ 551 MB (`use-intl`), and the two install scripts run on every `npm install`.

## 6. Bundle size and image size

| | First Load JS shared | Probe page (uses translations) | Production image (amd64, bytes) | vs baseline |
|---|---|---|---|---|
| baseline | 103 kB | n/a | 78,680,581 | |
| `next-intl@4.15.1` | 103 kB | 366 B own, **115 kB** first load | 78,725,469 | **+44.9 KB** |
| `use-intl@4.15.1` | 103 kB | 313 B own, **114 kB** first load | 78,720,783 | **+40.2 KB** |
| `next-intl@4.15.1`, ARM64 | 103 kB | 115 kB | 78,780,424 | (no ARM64 baseline built) |

Reading: a page that uses translations pays about **+11 to +12 kB** of first-load JS; the provider alone adds nothing measurable. Expect about +12 kB on every migrated route.

## 7. Build time

Single measurements are **not evidence** (part A: the baseline itself moved from 17 s to 27 s between two Next patch versions with no code change). Part B repeated `npm run build` inside the builder images, amd64 native, **3 interleaved rounds**, one container at a time:

| Variant | wall seconds (round 1 / 2 / 3) | `Compiled successfully in` (s) |
|---|---|---|
| baseline | 99.5 / 74.8 / 78.7 | 26.0 / 18.2 / 20.0 |
| `next-intl@4.15.1` | 85.4 / 76.3 / 78.0 | 20.8 / 16.7 / 17.5 |
| `use-intl@4.15.1` | 77.4 / 83.8 / 78.7 | 20.5 / 20.9 / 20.8 |

The three variants are **indistinguishable within the noise** (the spread inside one variant is larger than the differences between variants): no build-time cost from either library was observed. Install: baseline 368 packages in about 1 minute.

Under **QEMU emulation (ARM64, `next-intl`)**: `npm install` about 383 s, `next build` about 1,196 s (compile about 5.5 min), whole production build 1,639 s, i.e. roughly 15 times slower than native amd64. That is the cost of emulation, not a property of the library; it is the number to expect only if ARM64 images are built under QEMU.

## 8. Recommendation (final)

1. **`next-intl@4.15.1`, pinned exactly.** It passed every check that could be run: install, build, runtime, SSR with correct `lang`/`dir` and translated text in both languages, on amd64 and on ARM64 under QEMU; no new advisory; the native packages are **build-time only** and absent from both production images; same +≈12 kB per translated page as the fallback. It gives the official Next.js integration the ADR needs (plugin, `getRequestConfig`, `getLocale`, `getMessages`, `getTranslations`). Cost: 39 more lockfile packages than the fallback and two packages with install scripts at build time.
2. **Fallback: `use-intl@4.15.1`** (+7 pure-JS packages, no install scripts). Switch if an install script fails or is blocked on a supported platform (Windows developer machines, Vercel, a native ARM64 runner) or if the surface is judged too large. Its server-side locale wiring is code we would write; this was exercised only in the probe.
3. **Not `next-intl@4.4.0`** (flagged by `npm audit`, behind, version skew).
4. **Separate prerequisite, not i18n:** raise Next.js to **15.5.29** (patched, builds identically in part A) in its own reviewed change. The localization work in part B stayed on 15.5.27 by decision.

## 9. What is proven and what is not (open items)

**Proven (probe, isolated copies):** peers; install and production build with the repo's Dockerfile; standalone runtime; SSR of `<html lang dir>` and of translated text for `en` and `ar`; absence of `@swc/core` and `@parcel/watcher` in the final images; ARM64 under QEMU; no new advisories; no measurable build-time cost; size cost.

**Not proven (status after the acceptance of 2026-11-20):**

* **Integration with the real layout.** The probe layout computes `lang`/`dir` from the library's locale in a copy; the real root layout reads them from the company config (`GET /api/config/`), wraps the tree in the company and auth providers and the real pages. A passing probe does **not** show that the integration works. In the real project the layout is unchanged and nothing calls the library yet, so the language behaviour is unchanged (E2E 188/188); the integration itself is Phase 1.3 and must be proven there (initial HTML, hydration, DOM-text snapshot).
* **Real ARM64 hardware.** ARM64 was proven only under emulation (probe in part B and the real project in E1.2). Recommended before the first customer release on the OCI ARM target.
* **Vercel itself.** The Vercel-style build (no `BACKEND_INTERNAL_URL`, no `NEXT_PUBLIC_API_URL`, no standalone output) was run **locally**; it was not run on Vercel's runner, so the install scripts there and the catalog import are unconfirmed.
* **Behaviour with the two install scripts disabled** (an option to shrink the surface): not tested.
* **Known issue KI-1** (section 13): effect of the webpack warnings on the persistent cache and on other builders.

**Proven since part B (see section 12):** Windows native install/build, Vercel-style local build, the 188 E2E, `next dev`, Docker amd64 and ARM64 builds of the real project, absence of `@swc/core` and `@parcel/watcher` in both real production images.

## 10. Method limits

* Probe code in isolated copies only; no source-code review of the packages; advisory data from `npm audit` and the public GitHub records at the time of the runs.
* Part A used Next 15.5.29 for four of its five variants; part B used the project's 15.5.27. Numbers of the two parts are not mixed in the comparisons above.
* Timing was measured on one machine with other work stopped as far as possible; amd64 runs were native in Docker Desktop (WSL2), the ARM64 run was QEMU.

## 11. Resources created and removed

* Part A (2026-11-18): seven local images `crm-fe-gate:*` (five production images and two builder images): **removed by exact tag in the Docker clean-up of 2026-11-19/20**. Of its build cache, the records of the 2026-11-18 builds were removed only in part, one by one by id: **27 of the 45 records (about 5.8 GB) are still in the cache**, kept on purpose pending a later decision. They are unused, private and removable the same way, but are not removed by this report.
* Part B (2026-11-20): **8 temporary images** (`crm-gateb:*`: baseline, `ni`, `ui` builder and production stages, and the ARM64 ones) removed by exact tag after checking tag, label and id; **42 build-cache records** created by part B removed one by one by id (children first), none of the 256 earlier records touched; throw-away smoke containers were started with `--rm`. Docker lists before and after are identical (32 images, 21 containers, 208 volumes, 11 networks, 256 cache records, 16.93 GB of cache); no prune, no volume touched, the project files unchanged. The ARM64 build pulled the `node:22-alpine` arm64 base layers (≈ 50 MB), which do not show as an image and were not removed.
* Disk: free space on `C:` went from 20.54 GiB to 14.58 GiB during part B although Docker's own accounting is back to the starting values: the virtual disk file `docker_data.vhdx` grows and does not shrink by itself. Compacting it is a separate decision.
* The isolated workspace (project copies without `node_modules`, logs) is in the session scratch folder, outside the repository.

## 12. Acceptance results on the real project (2026-11-20)

Order of the changes: **D** (Next.js 15.5.27 to 15.5.29, its own change), **E1** (the dependency), **E1.1** and **E1.2** (acceptance runs). No commit was made.

| Check | Result |
|---|---|
| **D: Next.js 15.5.29** | `npm audit`: no advisory specific to Next any more (critical 0; 3 left, all through the nested `postcss` and `postcss-selector-parser`, build-time); typecheck, lint, local build, Docker amd64 build with smoke, 188 E2E: all passed; 11 lockfile entries changed (`next`, `@next/env`, eight `@next/swc-*`, the root range), no other package |
| **E1: dependency added** | `next-intl@4.15.1` exact (no `^`/`~`); lockfile: **+46 packages, 0 removed, 0 changed versions or integrity**; the `dev`/`optional` flags of `is-glob`, `is-extglob` and `detect-libc` changed (accepted by the owner); same 46-package set as the gate probe; no change to React, Next.js or any other package |
| **E1: files** | `package.json`, `package-lock.json`, `next.config.mjs` (plugin wrapper, no routing, no middleware), `messages/en.json` (`{}`), `src/i18n/request.ts` (placeholder returning `en` and the empty catalog; called by nothing); the root layout, providers and company code are identical to HEAD |
| **Windows native (win32-x64, Node 24)** | `@parcel/watcher-win32-x64` and `@swc/core-win32-x64-msvc` installed; `@parcel/watcher` loads; the nested `@swc/core` 1.16.22 loads and transforms TypeScript; `next-intl` and `next-intl/plugin` load; `npm ci --dry-run` consistent with the lockfile |
| **typecheck, lint** | passed (no warnings) |
| **`npm audit`** | 3 vulnerabilities (1 high, 2 moderate), identical to the baseline after D; **no i18n package flagged** |
| **Vercel-style build (local)** | `npm run build` with `BACKEND_INTERNAL_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_OUTPUT` unset: passed; built `routes-manifest`: empty rewrites, `i18n: null`; route table and shared JS identical to the build before the dependency (20 lines) |
| **Docker amd64 (E1.1)** | repo Dockerfile, target `prod`: passed (323 s); image 78,682,988 bytes (33 bytes smaller than the build without `next-intl`); smoke without network: `/login` served, `/` 307, next 15.5.29, react 19.3.0, Node 22.23.5; **no `@swc/core`, `@parcel/watcher` or `next-intl` folder** in the image (search of the whole image); route table identical to the Docker build without `next-intl` |
| **188 E2E (E1.2)** | **188 passed, 0 failed, 0 flaky** (5.4 min), Run ID `i89bxvuh`; per file 7 / 10 / 96 / 45 / 30 (the 10 include the deliberately failing local-only guard test, counted as passed, as before). **Run with a temporary copy of `stack.mjs` outside the repository, which differs from the original in exactly two lines**: the `here` constant (absolute path of `frontend/e2e`, because the copy lives elsewhere) and the `IMAGE` constant (a unique temporary backend image tag instead of `crm-backend:e2e`, because the original script rebuilds and re-tags that image on every run and it must not be replaced). The original script was not modified. |
| **ARM64 under QEMU (E1.2)** | real project, Next 15.5.29 + `next-intl@4.15.1`: build passed (1,745 s: install 205 s, build 1,473 s with compile 5.0 min, i.e. emulation cost); smoke: `aarch64`, `/login` served, next 15.5.29, no `@swc/core`/`@parcel/watcher`/`next-intl`; image 78,737,758 bytes; route table identical to amd64. **Real ARM64 hardware not tested.** |
| **`next dev` (E1.2)** | dev server with the plugin: "Ready in 8.7s", `/login` HTTP 200 (second request 0.31 s), no plugin error; no tracked file changed |
| **Resources** | temporary images (1 frontend amd64, 1 temporary backend tag, 1 frontend ARM64, probe images) and the build-cache records they created were removed by exact tag / id after identity checks; Docker lists before and after identical (33 images, 21 containers, 208 volumes, 11 networks, 258 cache records), and `crm-backend:e2e` is still `e396709020e7` |

## 13. Known issues

### KI-1: webpack cache warnings about `next-intl`'s message extractor

* **Exact text (two lines per occurrence):**
  ```
  <w> [webpack.cache.PackFileCacheStrategy/webpack.FileSystemInfo] Parsing of <project>\frontend\node_modules\next-intl\dist\esm\production\extractor\format\index.js for build dependencies failed at 'import(t(c).href)'.
  <w> Build dependencies behind this expression are ignored and might cause incorrect cache invalidation.
  ```
* **When it appears:** whenever webpack (the default builder here) compiles with the `next-intl@4.15.1` plugin: **3 occurrences per production `next build`** and 2 in a short `next dev` session (`/login`). Seen in: the local Windows build, the Docker amd64 build, the Docker ARM64/QEMU build, the build inside the E2E run, and `next dev`. **Not seen** in the Next 15.5.29 builds without `next-intl` (0 occurrences). The module named is part of the message-extraction feature (the codec loader of the extractor, a dynamic `import()`), which this project does not use.
* **Known impact:** none observed. Every build ended `Compiled successfully` with exit code 0, the route tables and image contents are unchanged, the 188 E2E passed, and `/login` is served in production and in dev. They are warnings, not errors.
* **Theoretical impact:** webpack's persistent file-system cache cannot track the build dependencies behind that `import()`, so a change in those (unused) extractor codecs would not invalidate the cache by itself.
* **Not proven yet:** (a) whether the warning has any effect on incremental builds or dev rebuilds after dependency changes; (b) its effect on a Vercel build or a CI that treats warnings as failures (none is configured here); (c) whether it disappears in a later `next-intl` release or with an upstream setting; (d) whether it can be silenced safely (for example with a webpack `ignoreWarnings` rule, a `infrastructureLogging` level, or by avoiding the extractor import). None of (c) and (d) was tried.
* **Decision (owner, 2026-11-20):** record it as a known issue; **do not suppress the warnings and do not add a workaround now.** Revisit at every `next-intl` upgrade and in the Phase 1.8 close-out.

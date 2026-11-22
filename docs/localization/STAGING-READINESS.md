# Staging readiness: Vercel Preview and staging checklist

Date: 2026-11-22. Status: **not started**. Everything below that is not marked "read-only" needs the owner's approval first. Nothing here touches production.

## What the local verification already proved, and what it did not

Proved locally (Docker amd64, emulated arm64, simulated Vercel build, a local stand-in for the config endpoint): the build, the standalone image under a read-only filesystem, language resolution, cookie behavior on localhost, font assets and cache headers, Intl output, and the branding-fallback behavior (`QA` notes in `RELEASE-QA-HANDOFF.md`).
**Not proved:** real ARM64, a real Vercel build and runtime (Node and ICU version, CDN headers, cold starts), HTTPS cookie behavior on a real host, CORS from a real preview URL, and a real EGP/SAR company.

## Prerequisites and exact approvals

| # | Need | Why | Approval or access required |
|---|---|---|---|
| 1 | A branch with the localization work (everything is currently uncommitted: modified and untracked files) | Vercel builds from Git; a build from `main` today contains none of the localization | Owner approves a commit and a push of a **non-main branch** (for example `localization/staging`), and what goes in it. The GitHub repository is **PUBLIC** (viewer permission ADMIN): the branch will be public. Run a secret scanner (for example gitleaks or trufflehog) over the final tree and review the diff for secrets first. |
| 2 | A staging backend reachable over HTTPS with demo data only | The preview needs an API that is not production. The local rehearsal stack is not reachable from Vercel. | Owner chooses the host (a second customer instance on a non-production host, or another staging host with TLS), and approves creating it. Its own database (not the production Neon database) and its own bucket. |
| 3 | CORS and CSRF for the preview on the **staging** backend only | A preview URL is not in any allow-list | On the staging backend: `DJANGO_CORS_ALLOWED_ORIGINS` (the fixed staging frontend URL) or `DJANGO_CORS_ALLOWED_ORIGIN_REGEXES` for preview URLs, and `DJANGO_CSRF_TRUSTED_ORIGINS`. **Never** on the production API. |
| 4 | A separate Vercel project (not the production one) | Keeps production settings, env and domains untouched | Vercel account or team access; owner approves creating the project and connecting the GitHub repository. Settings: Root Directory `frontend`; Node.js version 22.x (the Docker runtime is 22.23.5); build command default (`npm run build`); **Deployment Protection on** (the staging data is demo data, but the repository is public). |
| 5 | Vercel environment variables for that project | The browser calls the API directly | `NEXT_PUBLIC_API_URL=https://<staging-api>` (no `/api`), Preview and Production scopes of the staging project. Do not set `I18N_PSEUDO` (the build refuses it on Vercel anyway) and do not set `NEXT_PUBLIC_DEMO_*` unless a demo is wanted. Changing it later needs a new deployment (it is inlined at build time). |
| 6 | A staging company with EGP (or SAR) | The base currency is locked once data exists, so it must be chosen before seeding | Owner approves seeding the staging database with an EGP company (the demo seed uses USD by default). |
| 7 | A real ARM64 host that is not the production VM | The production host runs the live API and must not be loaded | SSH access (user, key) to a spare ARM64 host (for example a second spare ARM64 instance); owner approves running a container there. |

## Checklist

### A. Read-only, can be done now with no new access
- [x] Local build, standalone image, ARM64 emulation, branding-fallback experiments (done, see the QA notes).
- [ ] `gh repo view` / branch list: permission is ADMIN, repository PUBLIC (done, read-only).
- [ ] Review of the diff to be pushed for secrets and for files that must not be committed (`.env`, `e2e/.auth`, `test-results`, `playwright-report`, `tsconfig.tsbuildinfo`): needs the owner's go-ahead only to run the secret scan.

### B. Staging actions (approval 1 to 6)
1. Push the branch; create the Vercel staging project; set the two settings and the one variable above.
2. First preview deployment. Record: the build log (Node version, warnings including KI-1), the route table, and that the pseudo-locale refusal did not trigger.
3. Open the preview: `lang`/`dir` for English and Arabic, the language switch, the `crm_lang` cookie (`Secure`, one year), reload and new tab.
4. DevTools: no hydration errors; font files served with `immutable` caching from the CDN; Arabic page transfers 6 font files, about 189 KB; English transfers only the one file for the language switcher label.
5. Server-side branding: the time to first byte of `/login` and `/dashboard` with the staging API warm and cold (the layout waits up to 2.5 s for `/api/config/`; `/` makes two sequential calls, see the QA notes); company name and currency correct on first paint.
6. Run the Playwright suite against the preview with the existing `E2E_BASE_URL` option (the product specs; not the pseudo-locale project): language, RTL geometry, dates, amounts with the staging EGP company, errors, accessibility audit.
7. Verify the Egypt week start (Saturday) and Arabic amounts (`ج.م.`) in the browser with the staging EGP company.
8. Check an expired session, a 429 and a dropped connection on the preview.

### C. Real ARM64 (approval 7)
1. `docker buildx build --platform linux/arm64` is not needed on a native host: `docker build --target prod -t crm-frontend:qa-arm64 frontend` there, run with the instance settings (`read_only`, tmpfs, `cap_drop ALL`, memory limit 256m).
2. Record `uname -m`, memory after idle and after a burst, start-up time, and the same curl and browser checks as the local run.
3. Decide the memory limit from native numbers (see the QA notes: the QEMU figure is not representative).

### D. Production-impacting: **do not do** without a separate explicit approval
Changing production Vercel settings or variables, changing the production API's CORS or environment, running anything on the production API host, DNS or certificate changes, a production deploy or release.

## Exit criteria for "staging verified"
Build log clean except known warnings; no hydration errors; cookie and language checks pass over HTTPS; the Playwright product suite passes against the preview; EGP/SAR amounts and the Egypt week start confirmed in the browser; native ARM64 numbers recorded; the human Arabic review (still pending) scheduled.

# Stouchi Rebuild — Phase 7: Hardening and launch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is **lean by design**: files, behaviour, interfaces and test cases, not code. **Every production step needs the user's explicit approval at the moment it runs**, even when this plan lists it.

**Goal:** the new Stouchi replaces the legacy app in production on **Sunday 1 November 2026, in the morning**. The legacy data is backfilled into the new tables. The legacy app stays reachable, read-only, for 14 days. The new app meets the §8 budgets: first-load JS, offline start, accessibility and observability.

**Architecture (rewritten 2026-09-27 for Cloudflare Pages):**

- **Two repos and two hosts.**
  - The new app lives in `stouchi` (`main`) and is served by **Cloudflare Pages**, project `stouchi-app`. `/api/aam` runs as a Pages Function (`functions/api/aam.ts`).
  - The legacy app lives in `budget-maison` (`master`) and stays on **Vercel**, at `https://budget-maison-xi.vercel.app/`.
- **The address changes at launch.** The fast-forward of `master` that the Vercel plan relied on no longer applies. The new app goes live on its own address (D9). The old address keeps serving the legacy app, frozen read-only, with a banner that links to the new address. **So the `stouchi-ancien` project is no longer needed:** the legacy Vercel project becomes the read-only app (D3, revised).
- **Rollback:** unfreeze the legacy tables (`legacy_read_write.sql`) and tell people to go back to the old address. The new app's Pages deployment can stay or be rolled back in the Pages dashboard.
- **Session D** (day +14): archive the legacy tables, and point the old address at the new one.

**Tech Stack:** Phase 0–6 stack, plus:

- `@supabase/auth-js` and `@supabase/postgrest-js` as direct dependencies (D8, done);
- PostHog (`posthog-js`, `posthog-node`), already in the repo;
- Sentry (`@sentry/browser`, `@sentry/node`) only if D10 keeps it.

**Spec:**

- redesign spec §2 (success criteria at +30 days);
- §8.3 (new version, offline), §8.4 (performance budgets), §8.5 (security and privacy), §8.6 (quality gates), §8.7 (observability);
- §9 (migration and rollout), §10 item 7;
- the Phase 6 plan's "Phase 6 outcome" (deferred minors).

---

## Where Phase 7 stands (2026-09-27)

| Part | State |
|---|---|
| Session A: hardening (Tasks 1–5) | **Done.** First-load JS is 124.9 kB, the app works offline and shows "Nouvelle version", the a11y sweep passes, and Lighthouse LCP is 2.2 s. |
| Session B: cut-over prep (Tasks 6–9) | **Done, except two user steps:** the Auth diff and the backfill dry run on production. |
| **Session B′: Cloudflare readiness (Tasks 12–17)** | **New, not started.** Everything Sessions A and B built assumed Vercel. This is the work between now and launch. |
| Session C: launch day (Task 10) | Runbook rewritten below for Cloudflare. |
| Session D: day +14 (Task 11) | Updated below. |

### What was missing before the app fully works in production (see "Session B′ outcome" for what is done)

Ordered by risk. Each line points to its task.

1. **The offline start may break on Cloudflare Pages** (Task 13). The service worker precaches `/index.html` and serves it for offline navigations. Pages normally answers `/index.html` with a redirect to `/`, and a navigation can't be answered with a redirected response. The Session A review hit the same risk on Vercel, where it was fine. On Pages it has to be checked and very likely fixed.
2. **Production builds would point at `stouchi-test`** (Task 13). `VITE_*` values are baked in at build time. A local `npm run build` reads `.env`, which points at the test project. The production build must run with production values (the Pages build env, or a production env file for a direct upload).
3. **`/api/aam` has never run on Cloudflare** (Task 13).
   - On the Workers Free plan, each request gets **10 ms of CPU time**. Zod validation, the carnet and JSON parsing may go over it (waiting on Gemini doesn't count).
   - `lib/ai-observability.js` uses `require('posthog-node')`, and `lib/aam-salah` is CommonJS. Both need a check under `nodejs_compat`.
   - The rate limit and the 32 kB cap need a live check too.
4. **Error tracking isn't wired for Cloudflare** (Task 12, decision D10).
   - `_headers` doesn't allow Sentry, the Pages Function doesn't report errors, and the release reads `VERCEL_GIT_COMMIT_SHA`. On Pages the SHA is `CF_PAGES_COMMIT_SHA`.
   - PostHog is loaded with its defaults, so autocapture and possibly session replay can record amounts and labels. That breaks the "nothing the user typed leaves the device" rule in D4.
5. **Everyone gets signed out at launch, because the address changes** (Tasks 16, 10). Task 2 kept the auth storage key so that nobody would be signed out, but that only holds on the same origin. With a new address, people log in again. Legacy local data doesn't carry over; the server data does, through the backfill.
   - Supabase Auth on production needs the new address as its Site URL and in the redirect allow-list.
   - The announcement must say "nouvelle adresse, reconnecte-toi".
6. **The legacy banner links to the old address** (Task 16). On `legacy`, `read-only.js` links to `https://budget-maison-xi.vercel.app/`, which will be the frozen app itself. The link must point at the new address.
7. **Who deploys to Pages, and when, isn't set** (Task 13, decision D11). If `stouchi-app` is connected to Git with `main` as its production branch, every merge already deploys "production". Before launch, that deployment would either point at `stouchi-test` or reach the production database early.
8. **CI and the repo aren't launch-ready** (Task 14).
   - The `stouchi` repo has **no GitHub Actions secrets**, so the E2E job, the eval and `db-backup.yml` can't run. The backup is scheduled every Sunday and will fail.
   - `eval.yml` lost its nightly schedule, which §8.6 requires.
   - Eight Dependabot PRs are open. Two of them (TypeScript 7, ESLint 10) break the pinned tool versions.
9. **Known reliability findings aren't fixed** (Task 15).
   - The sync loop waits 60 s after a failed first round on reconnect.
   - The WebKit input flake on iPhone 13 grew during Session A.
   - E2E `couple:168` hits the day's request cap.
10. **Leftovers from Session B, for the user:** the Auth diff, the backfill dry run on production, and rotating the `stouchi-test` keys that were pasted in chat (Task 17).
11. **No end-to-end rehearsal on Cloudflare** (Task 17). The Session B rehearsal checked the SQL and the backfill, not the hosting. A Pages preview on `stouchi-test` must pass: login, keypad and chat, push, offline start, the update prompt, and the legacy banner's link.
12. **Stale docs** (Task 14). The spec (§8.5, §8.6) and several comments still say Vercel and `master`, and `api/aam.ts` and `vercel.json` are still in the repo.

Left for after launch (listed at the end): M5, M6, M7, M9, the `couple_request` dedupe, M3 against the device clock, Session A minors m4–m7, Realtime, visual diffs.

---

## Decisions

### Approved on 2026-09-26 (still valid unless marked)

- **D1, legacy shared Envies (M10).** They go private to the anchor, with the `shared_wants_private` issue. Launching on the 1st keeps this harmless.
- **D2, launch day.** The 1st of a month, in the morning. **Sunday 1 November 2026** (confirmed 2026-09-27).
- **D3, the legacy app for 14 days. Revised 2026-09-27:**
  - The database refuses its writes (`legacy_read_only.sql`).
  - The app shows a banner and stops retrying (Task 8).
  - It is served by **its existing Vercel project** at its existing address, because the new app moves to Cloudflare. `stouchi-ancien` is dropped.
  - At +14 days, the tables move to `archive` and the old address redirects to the new one. The tables are dropped at +90 days.
- **D4, observability.**
  - Nothing the user typed leaves the device: no amounts, labels, e-mails or chat text.
  - Errors are reported from the browser and from `/api/aam`, tagged with the release SHA.
  - `ai_dashboard.sql` and `launch_metrics.sql` are saved queries.
  - **Which tool is open: see D10.**
- **D5, offline shell.** A hand-written service worker, with navigations network-first and `/assets/*` cache-first. A new version waits for "Recharger". **Done.**
- **D6, deferred minors** M1, M2, M3, M4, M8 and M11. **Done.**
- **D7, out of scope:** visual screenshot diffs, Realtime, new analytics events.
- **D8, the thin Supabase client and the 150 kB CI gate.** **Done.**

### Decided on 2026-09-27

- The code moved to the `stouchi` repo (PR #9).
- Production host: **Cloudflare Pages**, project `stouchi-app`.
- Launch on Sunday 1 November 2026.

### Decided on 2026-09-27 (D9–D11, as recommended)

- **D9, the production address.** Either `https://stouchi-app.pages.dev` or a custom domain on the same Pages project.
  - **Recommended: a custom domain if you have one**, because it survives a later host change. Otherwise `stouchi-app.pages.dev`.
  - Every task below writes it as `<PROD_URL>`.
- **D10, errors: PostHog or Sentry.**
  - **Recommended: PostHog.** It is already loaded on demand, already in the CSP (EU host), and has exception capture. That means one vendor, and no new origin or dependency.
  - Cost: Task 12 must lock down its privacy (see below), and the existing `scrub()` becomes its `before_send`.
  - Sentry means adding `*.sentry.io` to `_headers`, reporting from the Pages Function (`@sentry/cloudflare` or a fetch-based reporter, not `@sentry/node`), and reading the release from `CF_PAGES_COMMIT_SHA`.
- **D11, how production gets deployed.**
  - **Recommended:** connect `stouchi-app` to Git, with the production branch set to **`production`** (not `main`). Merges to `main` then make preview deployments, on `stouchi-test`.
  - Launch is `git push origin main:production`. A rollback is the Pages dashboard's "Rollback" to a previous production deployment.
  - The alternative is a direct upload with `wrangler pages deploy dist` from a build that used production values. It's more manual and easier to get wrong (fact 2).

---

## Facts for Cloudflare (2026-09-27)

- `wrangler.jsonc`: project `stouchi-app`, output `./dist`, `nodejs_compat`. Wrangler isn't installed in the repo. Whether the Pages project exists and is connected to Git isn't known from the code: **the user checks it (Task 13).**
- `src/public/_headers` holds the CSP, HSTS, `nosniff`, `Referrer-Policy` and `Permissions-Policy`. The CSP allows Supabase and the PostHog EU hosts. `vercel.json` still carries the older copy.
- The service worker serves the cached `'/index.html'` for navigations (`src/public/sw.js`, the `page()` function). Its precache list comes from `scripts/sw-inject.ts`.
- `functions/api/aam.ts` passes `env` to `serveAam`, so no `process.env` is needed. It lists its variables in its header comment.
- `lib/chat-context.js` falls back to the production project URL when `SUPABASE_URL` is unset. That is a trap for previews: the Preview env must set `SUPABASE_URL`.
- `vite.config.mts` sets `VITE_SENTRY_RELEASE` from `VERCEL_GIT_COMMIT_SHA`.
- `notify-run` hard-codes no domain. Its notification clicks open relative hash routes.
- **GitHub (`stouchi` repo):** no Actions secrets. The CI `e2e` job runs only on `workflow_dispatch`. `eval.yml` only has `workflow_dispatch`. `db-backup.yml` is scheduled weekly and needs `SUPABASE_DB_URL`, `BACKUP_AGE_RECIPIENT` and the `R2_*` secrets.
- **Open Dependabot PRs:**
  - #1–#3: GitHub Actions to v7;
  - #4: TypeScript 7, which breaks the 6.0.x pin;
  - #5: `@types/node` 26;
  - #6: Babel 8, CI fails;
  - #7 and #8: ESLint 10, which breaks the ESLint 9 pin.
- The repo still holds `budget-facts.js` (for the backfill's `appDiffs`), `api/aam.ts` and `vercel.json`. There is no legacy `app.js` in this repo.

### Production env for Pages (replaces Session B's Vercel list)

- **Build variables, Production** (read by `vite build`; they are public by nature):
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, on production `gfbakmwllhuhfdydbcfa`;
  - `VITE_VAPID_PUBLIC_KEY`, from the production pair;
  - `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`;
  - `VITE_SENTRY_DSN` only if D10 keeps Sentry.
- **Function variables, Production** (encrypted):
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (without them, `/api/aam` answers 503);
  - `GEMINI_API_KEY`, `MISTRAL_API_KEY`;
  - optional: `TOKENROUTER_API_KEY` (only if `AAM_MODELS` names it), `AAM_MODELS`, `AAM_DEADLINE_MS`;
  - `POSTHOG_API_KEY`, `POSTHOG_HOST`.
  - **Never** `SUPABASE_SERVICE_ROLE_KEY`, and never `POSTHOG_CAPTURE_CONTENT` (it would send chat text, against §8.5).
- **Preview:** the same names, on `stouchi-test`, `SUPABASE_URL` included (see the `chat-context` trap above).
- **`notify-run` secrets on production** (unchanged): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `GEMINI_API_KEY`, optional `NOTIFY_MODEL`, `POSTHOG_API_KEY` and `POSTHOG_HOST`. Then the Vault secrets `notify_url` and `notify_secret`, and `supabase/sql/notify-schedule.sql`.

### Production database (from Session B, unchanged)

Missing migrations, to apply **one by one, in this order**. Don't use `supabase db push`: the versions on production don't match the file names.

1. `20260902_budget_data_rls`
2. `20260925_phase3_incomes_soft_delete`
3. `20260926_phase4_notify`
4. `20260927_notify_cron_secret`
5. `20260928_phase5_plan_and_delete`
6. `20260929_phase6_couple`
7. `20260930_legacy_join_limit`
8. `20261001_push_subscription_limits` (added 2026-09-27: it was missing from this list, and from `stouchi-test`)
9. `20261002_currency` (currency choice, added 2026-09-27; before the app build that writes `profiles.currency`)

### Supabase Auth on production (updated for D9)

- Site URL = `<PROD_URL>`. Sign-up has no `emailRedirectTo`, so confirmation links use the Site URL.
- The redirect allow-list holds `<PROD_URL>` and `<PROD_URL>/**`. Google OAuth's `redirectTo` is the origin plus the path.
- The Google provider is on. The Google Cloud client is unchanged, because its callback is Supabase's.
- Keep the old address in the allow-list until Session D, so that a legacy session still works read-only.
- Compare e-mail confirmation with `stouchi-test`.

---

## Things only the user can do

1. **Now:** decide D9, D10 and D11.
2. **Cloudflare:** confirm that `stouchi-app` exists, connect it to Git as D11 says, set the Production and Preview variables above, and add the custom domain if D9 picks one.
3. **GitHub secrets on `stouchi`:**
   - `GEMINI_API_KEY`;
   - the E2E ones (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `TEST_USER_*`, `TEST_PARTNER_*`, all on `stouchi-test`);
   - the `db-backup.yml` ones: `SUPABASE_DB_URL`, `BACKUP_AGE_RECIPIENT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`. If they aren't ready, disable the schedule until they are.
4. **Before Session C:**
   - generate a production VAPID key pair;
   - check the AI providers' data retention: the launch needs a Gemini tier that doesn't train on prompts;
   - lock PostHog's project settings as Task 12 lists them.
5. **Supabase Auth on production:** as listed above.
6. **Rotate the `stouchi-test` keys** that were pasted in chat, then update `.env` and the GitHub secrets.
7. **The backfill dry run on production:** put the production service key in `.env` for that step only.
8. Approve each Session C step, and do the phone smoke test.
9. At +30 days, read `launch_metrics.sql`. At +90 days, approve dropping `archive.*`.

## Global Constraints

- **Money:** integer millimes only (`src/shared/money.ts`). **Dates:** Africa/Tunis; figures use the viewer's pay period.
- **UI text:** French, in `src/shared/i18n/fr.json`. The legacy banner (`read-only.js` on `legacy`) is the one exception.
- **Production** (`gfbakmwllhuhfdydbcfa`, the Pages production deployment, Vercel `budget-maison`): nothing runs there without approval at that moment. `npm run backfill -- --apply` only with approval.
- **Secrets:** Claude never prints or commits one. `SUPABASE_SERVICE_ROLE_KEY` never goes to Cloudflare, Vercel or GitHub.
- **CSP:** a new origin goes into `connect-src` in `src/public/_headers`, and nothing else is loosened.
- **Performance (§8.4):** first-load JS ≤ 150 kB gzipped, gated in CI (`npm run check:size`).
- **Legacy tables:** never dropped in Phase 7. They are archived at +14 days and dropped at +90 with approval.
- **Tool versions:** TypeScript 6.0.x, ESLint 9.
- **Git:** work on a branch and merge through a PR. Commit messages are in French: `Refonte : …`.

## Review Focus (for the new work)

1. **Offline start on Pages.** An offline cold start and a slow-network start must get the shell, never a redirect error, a white screen or a stale `index.html` paired with missing assets. The tests are in Task 13.
2. **Error-report privacy.** No amount, label, e-mail, chat text or JWT reaches PostHog or Sentry, whether through exceptions, autocapture or replay. The tests are in Task 12.
3. **`/api/aam` on Workers.** It stays under the CPU limit on real turns, and the rate limit, the 32 kB cap, the 503 and the fallbacks behave as on Vercel. The tests are in Task 13.
4. **Wrong-backend builds.** No production deployment may carry `stouchi-test` values, and no preview may reach production. The checks are in Task 13 and in Session C step 8.
5. **From Sessions A and B (still apply):**
   - no legacy write is lost in the gap (freeze before the final `--apply`);
   - a backfilled user's first open writes no deposit for the launch period;
   - the update flow never reloads under the user.

---

## Sessions A and B — done (summary)

The full task texts are in git history (`git log -- docs/superpowers/plans/2026-09-26-stouchi-phase-7-launch.md`).

### Session A (2026-09-26): hardening

- **Task 1**, the Phase 6 minors M1, M2, M3, M4, M8 and M11: `60b9ad5`, plus the review fix `00fb65b`. `build:notify` is capped at 200 kB.
- **Task 2**, the thin Supabase client and the size gate: `2dbc5dc`. First-load JS went from ~152 to 124 kB, and `npm run check:size` runs in CI.
- **Task 3**, offline shell and "Nouvelle version": `a3f009c`, plus review fixes (second window, check on resume, 3 s fallback to the cached shell).
- **Task 4**, accessibility: `a11y.spec.ts` passes 29/29 on both devices.
  - Lighthouse mobile: score 98, FCP 1.8 s, LCP 2.2 s, TBT 30 ms, CLS 0.
- **Task 5**, monitoring: `5db1f2a`. Sentry is inert without a DSN, plus `scrub()`, `sync_failed`, `supabase/queries/ai_dashboard.sql` and `launch_metrics.sql`. **Wired for Vercel only; Task 12 revisits it.**
- **Deferred minors:**
  - m3: monitoring loads at `setTimeout(0)` (folded into Task 12);
  - m4: breadcrumbs lose their timestamps;
  - m5: `sync_failed` can have an empty `code`;
  - m6: the worker's version ignores a change to `index.html` alone (folded into Task 13);
  - m7: the a11y spec skips the receipt card and the edit sheet.

### Session B (2026-09-26): cut-over prep

- **Task 6**, the end of `/api/chat`: `a8b7009`. Only `api/chat.js` was deleted; `lib/chat-context.js` stays.
- **Task 7**, the cut-over SQL: `ce9fe42`, plus review fixes.
  - `supabase/cutover/`: `legacy_read_only.sql` (self-checking; it records the grants in `cutover.legacy_grants`), `legacy_read_write.sql`, `validate_constraints.sql` and `archive_legacy.sql`.
  - Tested in `tests/db/cutover.test.ts`.
- **Task 8**, the frozen legacy app on the `legacy` branch of `budget-maison` (local, not pushed): `098b8e3`, `15654e0`, `831a4e4` and `c0fdff0`.
  - `read-only.js` provides `isReadOnlyError` and a probe on open.
  - The banner shows on 42501, and sync stops.
  - **Its link still points at the old address: Task 16.**
- **Task 9**, readiness and the rehearsal: the env, migration and auth facts are above. The rehearsal on `stouchi-test` passed end to end: legacy write → freeze → banner → backfill → validation → first open with no deposit → unfreeze.
  - **Not done** (user steps, now in Task 17): the Auth diff and the backfill dry run on production.
- **The Session B review's minors, for the record:**
  - m5: a lost session between steps 4 and 5 can show the banner early (42501 also comes from RLS);
  - m7: during the switch, the banner's link could open the frozen app. **Task 16 removes this**, because the link now goes to the new address.

---

## Session B′ — Cloudflare readiness (new, before launch)

A sensible order: Task 14 (CI first, so everything after it is gated), then Task 13, Task 12, Task 15, Task 16 and Task 17. One session per task, or 12 and 13 together. Run `npm run check` before every commit. Run `npm run e2e` at the end of Tasks 13, 15 and 17.

### Task 12: Error tracking for Cloudflare (D10)

**Files (PostHog path, recommended):**

- Modify:
  - `src/main.tsx`: init PostHog after `load` and idle (Session A m3), with:
    - autocapture off, or masked so it records no element text;
    - session recording off, or masked so it records all text and inputs;
    - exception capture on;
    - `before_send` = the existing `scrub()`.
  - `src/app/monitoring.ts`: report through PostHog. Remove the Sentry import.
  - the outbox's permanent-failure path: `sync_failed` becomes a PostHog event with `{ kind, code }` only (Session A m5: never an empty `code`).
  - `functions/api/aam.ts` and `src/server/aam/http`: report unexpected errors through `posthog-node` or a fetch capture, scrubbed and flushed with `waitUntil`, with no change to the 503 and fallback paths.
  - `vite.config.mts`: the release comes from `CF_PAGES_COMMIT_SHA`, falling back to `dev`.
  - `package.json`: drop `@sentry/*`.
  - `.env.example`.
- Delete: `src/server/monitoring.ts` once nothing imports it (it served `api/aam.ts`, which Task 13 deletes).
- Test: `tests/unit/app/monitoring.test.ts`, plus a unit test of the server capture.

**If D10 keeps Sentry:**

- Add `https://*.ingest.sentry.io` (or the exact ingest host) to `connect-src` in `_headers`.
- Report from the Pages Function with a Workers-compatible SDK.
- Read the release from `CF_PAGES_COMMIT_SHA`.
- Keep `scrub()`.

**Behaviour:**

- With no key or DSN (dev, E2E, CI), nothing loads and nothing is sent.
- No event carries an amount, a label, an e-mail, chat text or a JWT: not in exceptions, custom events, autocapture or replay.
- `identify` uses the user's UUID, never the e-mail.
- **The user, in PostHog's project settings:**
  - turn session replay off, or "mask all text and inputs";
  - turn off the capture of network bodies;
  - set up the alerts from §8.7: an `/api/aam` error rate above 5 % over 15 min, and a spike of `sync_failed`.

**Tests:**

- `scrub` on a crafted exception holding an amount, a label, an e-mail, a JWT and chat text leaves none of them.
- The PostHog init options have autocapture and replay locked down (assert on the options passed).
- Without a key, nothing is imported.
- The server capture never changes the response.
- `npm run check:size` still passes.

- [ ] TDD → `npm run check`, `npm run build && npm run check:size` → commit `Refonte : lancement — suivi des erreurs sur Cloudflare`

### Task 13: Cloudflare hosting fixes and the Pages setup (D9, D11)

**Files:**

- Modify:
  - `src/public/sw.js`: key the shell on what Pages actually serves for `/`. If `/index.html` is redirected, precache `/` and look it up with `'/'`. Either way, never store or serve a redirected response.
  - `scripts/sw-inject.ts`: the same key. Session A m6: the version also hashes `index.html`.
  - `src/public/_headers`: align with `vercel.json`, check `Cache-Control` for `sw.js` (never long-cached) and for `/assets/*` (immutable), and keep the CSP as it is.
  - `package.json`: `wrangler` as a dev dependency, pinned; a `preview:pages` script (`wrangler pages dev dist`) for local checks of the Function and the headers.
  - `CLAUDE.md`: hosting notes.
- Delete: `api/aam.ts` and `vercel.json`, once the Pages Function passes its checks, so that one host is left in this repo. Also remove any Vercel-only test that goes with them.
- Test:
  - `tests/unit/sw/*`: the shell key and redirect refusal, against a fake cache and fetch;
  - `tests/e2e/pwa.spec.ts`: run once against a Pages preview URL, besides `vite preview`.

**Steps:**

- [ ] **The user:** confirm that the Pages project exists, connect Git as D11 says (production branch `production`), and set the Production and Preview variables listed above. Claude doesn't set any secret.
- [ ] **Measure on a preview** (read-only):
  - `curl -I <preview>/index.html` and `curl -I <preview>/`: record the status and any `Location`;
  - `curl -I <preview>/sw.js`: record the cache headers;
  - check that the response headers match `_headers`.
- [ ] Fix the service worker if needed (TDD) → `npm run e2e` → a `pwa.spec` run against the preview.
- [ ] **`/api/aam` on the preview, against `stouchi-test`:**
  - one keypad-like turn and one receipt turn;
  - 31 turns in 10 minutes gets the rate-limit reply;
  - a 33 kB body is refused;
  - without `SUPABASE_*`, it answers 503;
  - in Pages → Functions metrics, record the CPU time per request. If it exceeds the free plan's 10 ms, the user chooses between Workers Paid and cutting server-side work.
- [ ] Run `npm run eval -- --min-rate 0.9167` against the preview's `/api/aam` if the eval script can target a URL. Otherwise run it locally and note that.
- [ ] Check that the preview's bundle holds the `stouchi-test` URL and not the production one (a grep of `dist/assets`, or DevTools).
- [ ] Delete `api/aam.ts` and `vercel.json` → `npm run check` → commit `Refonte : lancement — hébergement Cloudflare Pages`

**Behaviour:**

- An offline cold start renders Budget.
- A 3 s stall gets the cached shell.
- An update still waits for "Recharger".
- `/api/aam` behaves exactly as on Vercel.

### Task 14: CI, secrets and repo hygiene

**Files:**

- Modify:
  - `.github/workflows/eval.yml`: add the nightly `schedule` back (§8.6), and a `push` trigger on `lib/aam-salah/**` and `scripts/eval-aam-salah.js`.
  - `.github/workflows/db-backup.yml`: keep the schedule only once the secrets exist. Otherwise comment the schedule out, with a note.
  - `.github/dependabot.yml`: ignore `typescript` ≥ 6.1, `eslint` and `@eslint/js` ≥ 10, and `@babel/core` ≥ 8 until it's tested.
  - the spec, §8.5 and §8.6: Vercel becomes Cloudflare Pages, `vercel.json` becomes `_headers`, and `master` becomes `main`.
- Delete: `posthog-ai-observability-report.md` from the repo root, if it's a one-off report. Ask the user first.

**Steps:**

- [ ] **The user** adds the GitHub secrets (listed in "Things only the user can do").
- [ ] Close Dependabot #4, #6, #7 and #8 with a comment (pinned versions). Test #1–#3 (Actions v7) and #5 (`@types/node` 26) on a branch, and merge them if CI is green.
- [ ] Run the E2E and eval workflows once by hand from the Actions tab: both green, or the known flakes noted.
- [ ] Commit `Refonte : lancement — CI et dépendances`

### Task 15: Reliability carry-overs

**Files:**

- Modify: `src/data/sync.ts` (the sync-loop fix); the E2E helpers or specs behind the WebKit input flake; the `couple:168` fixture.
- Test: `tests/unit/data/sync.test.ts`; the E2E specs involved.

**Behaviour:**

- **Sync loop:** after a round that failed on the network while `navigator.onLine`, retry once in about 2 s, then fall back to the normal backoff. Never more than one pending retry.
- **WebKit input flake** (`core:44`, `me:60`, `onboarding:47`, `chat:121`/`194` on iPhone 13):
  - find out whether it's the test (`fill()` on a controlled Preact input) or the app (an input that drops keystrokes on iOS);
  - if it's the app, fix it with a failing test first, because a real iPhone user would lose input;
  - if it's the test, switch those steps to `pressSequentially`, or wait for hydration.
- **`couple:168`:** clean up that user's `couple_request` rows before the test, or use a fresh pair, so that the day's cap of 10 isn't reached.
- **M5** (a dead card after an offline request): only if it's cheap. Otherwise it stays after launch.

**Tests:**

- The sync unit test: a failed round while online → one retry at about 2 s → success; no retry storm.
- `npm run e2e` three times in a row on both devices: only failures with a known, noted cause.

- [ ] TDD → `npm run check` → `npm run e2e` ×3 → commit `Refonte : lancement — fiabilité (sync, saisie iPhone)`

### Task 16: The legacy side (`budget-maison` repo, branch `legacy`)

**Files (in `../budget-maison`, on `legacy`):**

- Modify:
  - `read-only.js`: the banner's link becomes `<PROD_URL>`;
  - its test: the link.
  - Wording: "Cette version de Stouchi est en lecture seule. Tes données sont dans la nouvelle version :" plus the link. Add "Reconnecte-toi avec le même e-mail." if it fits.

**Behaviour:**

- Before the freeze, the legacy app works as today.
- After it, the banner shows, and its link opens the new app.
- Nothing else changes.

- [ ] TDD on `legacy` → `npm run test:legacy` → commit `Ancienne version : lien vers la nouvelle adresse` (on `legacy`, not pushed yet: that's Session C step 2)

### Task 17: The Cloudflare rehearsal and the go/no-go

**Steps:**

- [ ] **The Auth diff** (the user, in the dashboard), as listed above. The user fixes the differences on production.
- [ ] **The backfill dry run on production** (approval; the service key goes in `.env` for this step only). Run `npm run backfill`, never `--apply`.
  - Verification passes.
  - Every issue is read with the user (`shared_wants_private` is expected).
  - `.backfill/` stays gitignored.
  - Remove the key afterwards.
- [ ] **Rehearsal on a Pages preview against `stouchi-test`**, on a throwaway account deleted afterwards:
  1. The legacy app runs locally against test, and a legacy row is written.
  2. Apply `legacy_read_only.sql`: the banner shows, and **its link opens the preview address** (point it there for the rehearsal).
  3. Run the backfill dry run, then `--apply` (approval for test).
  4. Apply `validate_constraints.sql`.
  5. **On a real iPhone and a real Android phone**, on the preview:
     - log in;
     - the figures match the report;
     - add an expense by keypad and by chat;
     - search Historique;
     - check Objectif;
     - enable push, and a manual `notify-run` on test delivers one;
     - install the PWA, go into airplane mode, reopen: Budget shows;
     - deploy a no-op change: "Nouvelle version" appears and reloads only on tap.
  6. An error sent on purpose reaches PostHog (or Sentry), with nothing typed in it.
  7. Apply `legacy_read_write.sql`.
- [ ] **Go/no-go** (the user, by 29 October):
  - Tasks 12–17 done;
  - `npm run check` and `npm run e2e` green, or only known flakes;
  - the variables are set;
  - the VAPID pair is ready;
  - the Gemini tier is checked.
- [ ] Update this plan and `CLAUDE.md` → commit `Refonte : phase 7 — prêt pour la bascule (Cloudflare)`

---

## Session B′ outcome (2026-09-27, one session, on branch `phase-7-plan-cloudflare`)

**Decisions:** D9 = `https://stouchi-app.pages.dev` (swap in a custom domain later if there is one), D10 = PostHog, D11 = Pages production branch `production`.

**New facts found:**

- **Cloudflare Pages redirects `/index.html` to `/` (308).** Checked with `wrangler pages dev`. The old worker precached `/index.html`, so the offline start would have broken on Pages. Fixed (Task 13).
- **The repo is connected to a Vercel project `stouchi`**, and it deploys `main` to Vercel "Production" on every merge. **The user disconnects it** (Cloudflare is the host), after checking which Supabase project its env points at.
- **Cloudflare has a Worker `stouchi` connected to the repo (Workers Builds), and its builds fail**, because `wrangler.jsonc` is a Pages config. No Pages project `stouchi-app` is visible from here (wrangler isn't logged in). **The user creates the Pages project** `stouchi-app` from the GitHub repo (build `npm run build`, output `dist`, production branch `production`, previews for the other branches), then deletes the `stouchi` Worker or disconnects its builds.
- **The iPhone "input flake" wasn't lost input.** The typed value and the app state were right. The save waited behind the first pull's single IndexedDB transaction: 214 rows took ~7 s to commit in Playwright's WebKit, and every write that touches the outbox waited. A backfilled account with years of rows would hit the same thing on a real phone's first open. Fixed by batching (Task 15).
- `/api/aam` runs under Cloudflare's runtime (`workerd`, locally): a real turn against `stouchi-test` got 200 in about 2 s, a 33 kB body 413, GET 405, no JWT 401. The CommonJS pipeline and `posthog-node` load fine. **The CPU time per request on the real edge (the free plan's limit is 10 ms) is still to read on a preview** (Pages → Functions → Metrics).

**Done (code; `npm run check` 1265/1265, first-load JS 125.3 kB):**

- **Task 12, errors on PostHog:**
  - `src/app/monitoring.ts` loads PostHog after `load` and idle, with exception capture on and autocapture, replay, heatmaps, dead clicks, rage clicks and surveys off, text masked;
  - `before_send` = the new `scrubCapture()` (`src/shared/scrub.ts`): it drops element text, strips queries from every URL, masks exception messages, and keeps only PostHog's own person properties;
  - `sync_failed` never has an empty `code`;
  - `/api/aam` reports a scrubbed `$exception` with one `fetch` (`src/server/monitoring.ts`);
  - the release comes from `CF_PAGES_COMMIT_SHA`;
  - `@sentry/*` removed.
- **Task 13, hosting:**
  - the shell is precached and served as `/`, a redirected response is stored as a plain copy, and a failed precache fails the install;
  - the worker's version also hashes `index.html` (Session A m6);
  - `_headers`: `sw.js` `no-cache`, `/assets/*` immutable;
  - `api/aam.ts` and `vercel.json` deleted;
  - `wrangler` 4.141.0 pinned, `npm run preview:pages`;
  - **the E2E suite now runs on a local Cloudflare Pages server** (`playwright.config.ts`), so the redirect, `_headers` and the Function are exercised on every run;
  - `.node-version` = 24 for the Pages build.
- **Task 14, CI:**
  - `eval.yml` nightly at 02:00 UTC, plus on pushes to `main` touching the assistant;
  - `db-backup.yml` skips green (with a warning) while its secrets are missing, and fails on a manual run;
  - `dependabot.yml` ignores TypeScript ≥ 6.1, ESLint and `@eslint/js` ≥ 10, and Babel ≥ 8;
  - the spec's §8.1, §8.5, §8.6 and §8.7 no longer say Vercel, `master` or Sentry.
- **Task 15, reliability:**
  - `pull` writes in batches of 50 rows (`PULL_BATCH`), one transaction each; a waiting local write still wins;
  - each batch saves the cursor of its last row (rows come oldest first), so a pull cut short resumes instead of starting over;
  - "Hors ligne" clears as soon as the server answers, unless the browser has gone offline since;
  - the router catches a hash change made before its listener attached (`startRouter`), which made a navigation during boot land on the wrong screen;
  - Phase 6 M6 (`couple:132`): the baseline is read once it's stable, the server row is checked first, and the couple tests get 60 s;
  - a failed round while the browser says online is retried once after 2 s;
  - `couple:168` skips with a reason when the day's request cap is used up.
  - On iPhone 13, `core`, `me`, `onboarding` and `chat` pass (23/23, and `core` twice in a row).
- **Task 16, legacy banner** (in `budget-maison`, branch `legacy`, worktree `%TEMP%/bm-legacy`, **not committed**):
  - `read-only.js` links to `https://stouchi-app.pages.dev/`, with a test that it never points at the old address;
  - the banner says "reconnecte-toi avec le même e-mail";
  - `npm run test:legacy` 15/15.

**Still to do:**

- **The user:**
  - create the Pages project and set its variables (the lists above);
  - disconnect the Vercel `stouchi` project and the failing `stouchi` Worker;
  - add the GitHub secrets;
  - lock PostHog's project settings (replay off, alerts);
  - the Auth settings on production;
  - the production VAPID pair;
  - the Gemini tier;
  - rotate the `stouchi-test` keys;
  - the backfill dry run on production.
- **Claude, once the Pages preview exists:**
  - rerun Task 13's preview checks (headers, 308, Function CPU time);
  - the full `npm run e2e` three times;
  - Task 17's rehearsal with the user's phones.
- Close Dependabot #4, #6, #7 and #8 (the new ignore rules keep them from coming back). Merge #1, #2, #3 and #5 after a rebase: their CI is green.

## Session C — launch day (Sunday 1 November 2026, morning)

### Task 10: Runbook (rewritten for Cloudflare Pages)

Each numbered step is announced, approved, run, then checked. If a check fails, stop and roll back (below).

1. **Announce** in the legacy household, if the user wants:
   - the time of the switch;
   - the new address `<PROD_URL>`;
   - "reconnecte-toi avec le même e-mail";
   - the old address stays readable for 14 days.
2. **Legacy read-only build to production** (`budget-maison`):
   - push `legacy`;
   - merge it into `master` through a PR;
   - Vercel deploys it.
   - Check: the legacy app works normally. It shows no banner while unfrozen, and it accepts both join replies.
3. **Production migrations**: the 7 files listed above, one by one, in order. Then `npm run check:supabase` against production, with the anon key and no service key. The legacy app still works, because the migrations are additive.
4. **Freeze:** `legacy_read_only.sql`. If it raises `freeze failed: … still writable`, it changed nothing: stop and look.
   - Check: opening the legacy app shows the banner (the probe on open), and its link opens `<PROD_URL>`.
5. **Final backfill:**
   - `npm run backfill`: verification passes, with the dry run's issues plus any rows added since;
   - then `npm run backfill -- --apply`;
   - then `validate_constraints.sql`;
   - remove the service key from `.env`.
6. **`notify-run` on production:**
   - `npm run build:notify`;
   - `npx supabase functions deploy notify-run --no-verify-jwt --use-api --project-ref gfbakmwllhuhfdydbcfa`;
   - the secrets, the Vault entries and `notify-schedule.sql`;
   - a manual run answers 200.
7. **Supabase Auth on production:** Site URL = `<PROD_URL>`, and the allow-list as listed above (if Task 17 didn't already do it).
8. **Pages Production variables:** a final check against the list above, the production VAPID public key included. Nothing points at `stouchi-test`.
9. **Launch:** `git push origin main:production` (D11). Pages builds and deploys.
   - Check: `<PROD_URL>` serves the new app;
   - the bundle holds the production Supabase URL;
   - `/api/aam` answers `401` without a JWT, not `503`.
10. **Smoke test on phones** (the user):
    - log in with a real account: Budget's figures match the backfill report for this period;
    - add an expense by keypad and by chat;
    - Historique finds a legacy expense;
    - Objectif shows the legacy savings;
    - enable push;
    - on the installed iPhone PWA, in airplane mode, reopen: Budget shows;
    - PostHog (or Sentry) receives the release.
11. **Watch** for two hours: errors, `ai_dashboard.sql`, the next `notify-run` runs, and the Pages Function metrics (CPU and errors).

**Rollback, from step 9 on:**

1. Apply `legacy_read_write.sql`. The legacy app at the old address works normally again: the banner only shows on 42501.
2. Tell the household to go back to the old address.
3. If the new app itself is broken, use Pages → Deployments → Rollback, or take the production deployment down.
4. Rows written in the new tables since step 9 stay there. List them with a query on `created_at`, and the user decides what to do with them.

**Before step 9**, the rollback is only `legacy_read_write.sql`.

- [ ] Steps 1–11 → update this plan (outcome) and `CLAUDE.md` (status: launched on Cloudflare at `<PROD_URL>`) → commit `Refonte : phase 7 — lancement`

---

## Session D — day +14

### Task 11: Close the legacy app

**Files:**

- `stouchi`:
  - Delete `budget-facts.js` and the backfill's `appDiffs` dependency on it. Keep the backfill for the record without the comparison, or delete it if the user agrees.
  - Update `CLAUDE.md`: remove the legacy-app section.
- `budget-maison`:
  - on `master`, `vercel.json` gets a permanent redirect from every path to `<PROD_URL>`, so that old bookmarks keep working;
  - or the project is deleted, if the user prefers.

**Steps:**

- [ ] With approval: apply `archive_legacy.sql` on production.
- [ ] With approval: deploy the redirect on `budget-maison`, or delete the project. Remove the legacy env vars from Vercel.
- [ ] Remove the old address from the Supabase Auth allow-list.
- [ ] `npm run check`, `npm run e2e` → commit `Refonte : fin de l'ancienne version`
- [ ] Remind the user (via `/schedule`): at +30 days, run `launch_metrics.sql` against §2's targets; at +90 days, drop `archive.*` (approval).

---

## After launch (backlog, not blocking)

- **Phase 6:**
  - M5: an offline request leaves a dead card;
  - M6 and M7: E2E ordering;
  - M9: a pending inviter must cancel before joining another code;
  - the Phase 6 ledger items.
- **Session A:**
  - `couple_request`'s per-day dedupe swallows a second request after an edit (needs a migration);
  - M3 compares against the device clock;
  - m4: breadcrumb timestamps;
  - m7: a11y on the receipt card and the edit sheet.
- **Session B:** m5 (an early banner after a lost session).
- **Out of scope in D7:** Realtime (§8.3 two-device sync), Playwright visual diffs (§8.6), and "median time to log", which isn't measured.

# Stouchi Rebuild — Phase 7: Hardening and launch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is **lean by design**: files, behaviour, interfaces and test cases, not code. **Every production step (Session C) needs the user's explicit approval at the moment it runs**, even when this plan lists it.

**Goal:** Stouchi's rebuild replaces the legacy app in production. The legacy data is backfilled into the new tables. The legacy app stays reachable in read-only mode for 14 days, and the new app meets the §8 budgets (first-load JS, offline start, accessibility, observability).

**Architecture:** Sessions A and B are code on `rebuild` plus one small `legacy` branch cut from `master`; nothing touches production. Session C is a runbook: freeze legacy writes, apply the migrations and the backfill, deploy `notify-run`, then fast-forward `master` to `rebuild`, so Vercel's production deploy becomes the new app. Rollback is a Vercel Instant Rollback plus an "unfreeze" SQL. Session D, 14 days later, archives the legacy tables and deletes the legacy code.

**Tech Stack:** Phase 0–6 stack. New dependencies: `@sentry/browser` and `@sentry/node` (D4 only). `@supabase/auth-js` and `@supabase/postgrest-js` become direct dependencies, pinned to the versions already in the lockfile (D8).

**Spec:** redesign spec §8.3 (new version, offline), §8.4 (performance budgets), §8.5 (remove `/api/chat`, provider retention), §8.6 (quality gates), §8.7 (observability), §9 (migration and rollout), §10 item 7, §2 (success criteria at +30 days). Phase 6 plan, "Phase 6 outcome" (deferred minors M1–M11, legacy join limit).

---

## Facts found while planning (2026-09-26)

- `master` has no commits beyond its merge base with `rebuild` (`a9a1826`), so the launch merge is a **fast-forward**.
- First-load JS is **~152 kB gzipped**: `index` 73.7 kB plus `supabase` 78.4 kB. The budget is 150 kB, so D8 is needed.
- The legacy app has **no service worker** and no manifest, so once the domain serves the new app, no old cached shell survives.
- The legacy `budget-facts.js` is read by the backfill (`appDiffs`), so the legacy files stay until Session D.
- `src/public/sw.js` is push-only and calls `skipWaiting()` on install. Offline caching and the update prompt are still to build (§8.3).
- Sentry is absent. The security headers, axe checks, CI, `npm audit` and Dependabot are already in place.
- The constraints to validate after the backfill are `expenses_shared_needs_only` and `incomes_shared_needs_only` (`20260929_phase6_couple.sql`, added `not valid`).
- `lib/chat-context.js` (used by `api/chat.js`) hard-codes the production project.

## Decisions (approved by the user on 2026-09-26, as proposed)

**Execution:** inline in each session, with one Opus review of Task 1.

1. **M10, legacy shared Envies (D1).** Keep Task 10's rule: a legacy household's shared Envies go private to the anchor, with the `shared_wants_private` issue. To make it harmless, **launch on the 1st** (D2). The legacy payday is 1, so the anchor's current-period Envies start empty and absorb nothing. The older rows only change the anchor's history.
2. **Launch day (D2).** The 1st of a month, in the morning, after Sessions A and B are done and the rehearsal (Task 9) passed. The target is **Sunday 1 November 2026**. Thursday 1 October is possible only if A and B are done by 29 September.
3. **The legacy app for 14 days (D3).**
   - The database refuses its writes: `supabase/cutover/legacy_read_only.sql` revokes writes on the legacy tables and functions.
   - The app says so: it shows a banner and stops retrying (Task 8).
   - It is served by a **second Vercel project**, `stouchi-ancien`, from a frozen `legacy` branch. A former production deployment URL isn't enough, because Vercel's deployment protection would ask visitors to log in.
   - After 14 days, the project is deleted and the tables move to an `archive` schema. They are dropped after 90 days (§9.5).
4. **Observability (D4).**
   - **Sentry** on the free plan, in the browser, loaded after first paint so it isn't counted in first-load JS. Also in `api/aam.ts`. Release tag = the commit SHA.
   - `beforeSend` strips everything the user typed: amounts, labels, e-mails, chat text.
   - `notify-run` stays on Supabase's function logs.
   - The `ai_events` dashboard is a saved SQL query, not code.
   - The alternative is no Sentry, but then the "crash-free sessions" criterion can't be measured.
5. **Offline shell (D5).** A hand-written service worker precaches the build's shell; there is no new dependency. Navigation is network-first with a cached `index.html` fallback, and `/assets/*` is cache-first. Supabase and `/api/*` are never cached. A new version **waits**, and the app shows "Nouvelle version — Recharger" (§8.3).
6. **Deferred minors fixed in Phase 7 (D6):**
   - M1 Historique mismatch;
   - M2 `verse_ce_mois`;
   - M3 stale requests;
   - M4 pot from category;
   - M8 Moi stat;
   - M11 `notify-run` bundle.

   Left for after launch: M5, M6, M7, M9 and the Phase 6 ledger items.
7. **Out of scope (D7):**
   - Playwright visual screenshot diffs (§8.6 "Visual").
   - Realtime.
   - New analytics events. The +30-day metrics use what the tables already hold, and "median time to log" is reported as not measured.
8. **First-load budget (D8).** Replace `createClient` from `@supabase/supabase-js` with a thin client built from `@supabase/auth-js` + `@supabase/postgrest-js`. Realtime, storage and functions are unused. Add a CI gate: JS loaded by `index.html` ≤ 150 kB gzipped.

## Session split

- **Session A** covers Tasks 1–5, the code hardening on `rebuild`. Task 1 is money and data work: an Opus reviewer checks it before Task 2.
- **Session B** covers Tasks 6–9: retiring `/api/chat`, the cut-over SQL, the `legacy` branch and the rehearsal on `stouchi-test`. It ends with the backfill dry run on production data (read-only, approval needed).
- **Session C** is launch day: Task 10, step by step, each production step approved.
- **Session D** is day +14: Task 11.

Run `npm run check` before every commit and `npm run e2e` at the end of Sessions A and B. Commit messages are in French: `Refonte : …`.

## Things only the user can do

1. Approve D1–D8.
2. **Before Session C:**
   - Create the Sentry project (D4) and put the DSN in Vercel.
   - Create the `stouchi-ancien` Vercel project (D3).
   - Generate a production VAPID key pair.
   - Review the AI providers' data-retention settings (§8.5). A free Gemini tier may use prompts for training, and the launch needs a tier that doesn't.
3. **Supabase Auth on production:** check that the site URL, redirect allow-list, Google provider and e-mail settings match what the new app needs (Task 9 lists the differences).
4. Put the production `SUPABASE_SERVICE_ROLE_KEY` in `.env` for the dry run and the apply, and remove it afterwards.
5. Approve each Session C step, and do the phone smoke test.
6. At +30 days, read the metrics query. At +90 days, approve dropping the archived tables. `/schedule` can remind you.

## Global Constraints

- **Money:** integer millimes only (`src/shared/money.ts`). **Dates:** Africa/Tunis; figures use the viewer's pay period.
- **UI text:** French, in `src/shared/i18n/fr.json`. The legacy banner in `app.js` is the one exception, since the legacy app has no `fr.json`.
- **Production** (`gfbakmwllhuhfdydbcfa`): nothing runs there before Session C, and nothing in Session C runs without approval at that moment. `npm run backfill -- --apply` only with approval.
- **Secrets:** Claude never prints or commits a secret. `SUPABASE_SERVICE_ROLE_KEY` never goes to Vercel. Sentry's DSN is public by nature, but it lives in Vercel env (`VITE_SENTRY_DSN`, `SENTRY_DSN`), not in the code.
- **CSP:** any new origin (Sentry ingest) is added to `connect-src` in `vercel.json`, and nowhere else is loosened.
- **Performance (§8.4):** first-load JS ≤ 150 kB gzipped, and it is gated in CI.
- **Legacy tables:** never dropped in Phase 7. They are archived at +14 days and dropped at +90 with approval.
- **Tool versions:** TypeScript 6.0.x, ESLint 9.

## Review Focus

1. **Legacy writes lost in the gap.** An expense typed in the legacy app after the final backfill must not silently vanish. So the freeze comes **before** the final `--apply` (Task 10 order), and a frozen legacy app says it is read-only instead of queueing writes forever. The test is in Task 7 (writes refused with `42501` after the freeze, reads still allowed) and Task 8 (the banner on `42501`).
2. **A backfilled user's first open.** The first open writes at most the **current** period's payday deposit, once, and never deposits for periods before the launch. The test is in Task 7: the fixture's converted rows are fed to `dueDeposits` on launch day and mid-period.
3. **Service worker update and offline start.** A deploy must never reload under the user or pair a stale `index.html` with missing hashed assets. An offline cold start must keep the outbox. The tests are in Task 3: a unit test of the update flow, and an E2E offline reload with a pending write that syncs later.
4. **Sentry leaks.** No amount, label, e-mail, chat text or JWT leaves the device. The test is in Task 5: a unit test of `scrub()` on a crafted event.
5. **The thin Supabase client.** Session refresh, sign-out, "session lost" and RPC errors must behave exactly as before. The test is in Task 2: a unit test of the client factory, plus the whole E2E suite.

---

## Session A — hardening

### Task 1: Phase 6 deferred fixes (M1, M2, M3, M4, M8, M11)

**Files:**

- Modify:
  - the Historique figures, in the `src/features/history/` module that computes the "Tout" cards (M1);
  - `lib/aam-salah` carnet `verse_ce_mois` (M2);
  - the partner-request accept path in `src/features/notifications/` (M3, M4);
  - the Moi stat (M8);
  - `src/server/notify/load.ts` and `src/server/aam/load.ts` (M11).
- Create: `src/shared/floor.ts` (M11, `floorFor` moved here as is, re-exported nowhere else)
- Test: unit tests next to each module; add `tests/unit/notify/bundle-size.test.ts` only if the build script can be driven from Vitest, otherwise add a check in `scripts/build-notify.mjs`

**Behaviour:**

- **M1:** In couple mode, Historique "Tout" compares shared Besoins spending with the **household** Besoins budget (the Budget screen's figure). Its Épargne card counts **my** deposits only. "Moi" compares my rows with my own budgets.
- **M2:** `verse_ce_mois` counts my own deposits only (D2).
- **M3:** Accepter first re-reads the expense. If it is gone, no longer in my household, or updated after the request, the card says `couple.request.stale` ("Cette demande n'est plus à jour"), marks the notification read and changes nothing.
- **M4:** When a request changes the category and names no pot, Accepter derives the pot from `src/shared/categories.ts`.
- **M8:** Moi's "N dépenses" counts rows where `user_id` is me.
- **M11:** The `notify-run` bundle no longer pulls in zod. `build:notify` fails above 200 kB.

**Tests:**

- M1: Tout and Moi figures for a couple fixture.
- M2: a partner's deposit is excluded.
- M3: three stale cases (deleted, left, edited after the request) change nothing and show the stale copy.
- M4: a category-only change moves the pot.
- M8: the partner's shared rows are not counted.
- M11: the bundle-size check.

- [ ] TDD per minor → `npm run check` → commit `Refonte : phase 6 — mineurs M1 à M11`
- [ ] **Opus review** of Task 1 (money and data); fix findings with a failing test first

### Task 2: First-load budget — thin Supabase client and the size gate

**Files:**

- Modify: the Supabase client module in `src/data/` (where `createClient` is called), `package.json` (direct deps `@supabase/auth-js`, `@supabase/postgrest-js` at the lockfile's versions; drop `@supabase/supabase-js` from the app bundle only if nothing else in `src/` imports it), `.github/workflows/ci.yml` (run the gate after `npm run build`)
- Create: `scripts/check-size.mjs`. It reads `dist/.vite/manifest.json` (turn on `build.manifest`), walks the entry's static imports, gzips each JS file and fails above 150 kB. It prints the total either way.
- Test: `tests/unit/data/client.test.ts`; `tests/unit/scripts/check-size.test.ts` (manifest-walk on a fixture manifest)

**Interfaces:**

- Produces: the same exported client object and type the repositories use today (`auth.*`, `from()`, `rpc()`), so no caller changes.

**Behaviour:** Auth persists and refreshes as before, with the same storage key, so signed-in users stay signed in across the deploy. `from`/`rpc` send the user's JWT. Measure first with `npx vite-bundle-visualizer`. If the thin client alone doesn't reach 150 kB, lazy-load the next-largest first-load module that isn't needed for the first Budget paint.

**Tests:**

- The client factory reuses the **same storage key** as supabase-js (so there is no sign-out at launch).
- A refreshed token is used by the next `from()` call.
- `rpc()` errors keep the `{ code, message }` shape the callers read.
- `check-size` sums only the entry's static graph and fails at 150.001 kB.

- [ ] Measure → TDD → `npm run build && node scripts/check-size.mjs` ≤ 150 kB → `npm run e2e` → commit `Refonte : lancement — budget du premier chargement`

### Task 3: Offline shell and "Nouvelle version"

**Files:**

- Modify: `src/public/sw.js`, which becomes a template with `__PRECACHE__` and `__VERSION__`, keeping the push and notificationclick handlers unchanged; `vite.config.mts` (a small plugin that, in `generateBundle`, writes `sw.js` with the entry's JS/CSS, fonts, icons and `index.html`, and the version = build hash); `src/main.tsx` (registration)
- Create: `src/app/update.ts` (watches `registration.waiting` / `updatefound`; exposes `updateReady` signal and `applyUpdate()`), `src/app/UpdateToast.tsx` (mounted in `Shell.tsx`), `fr.json` keys `update.ready` ("Nouvelle version"), `update.reload` ("Recharger")
- Test: `tests/unit/app/update.test.ts` (fake registration), `tests/e2e/pwa.spec.ts` + a Playwright project `pwa` in `playwright.config.ts` that runs against `npm run build && npm run preview`

**Behaviour:**

- **Install:** precache the shell. There is **no** `skipWaiting` on install.
- **Activate:** delete caches from other versions, then `clients.claim()`.
- **Fetch:**
  - A same-origin navigation is network-first, falling back to the cached `index.html`.
  - A same-origin `/assets/*` request is cache-first, and a miss is cached.
  - Everything else passes through untouched: Supabase, `/api/*`, cross-origin requests.
- **Update:** `applyUpdate()` posts `SKIP_WAITING`. The page reloads once, on `controllerchange`, and only after the user tapped "Recharger". It never reloads while a sheet is open with unsaved input: the toast stays, and the reload waits for the sheet to close.
- **First install:** there is no prompt.

**Tests:**

- Unit:
  - a waiting worker sets `updateReady`;
  - `applyUpdate()` posts `SKIP_WAITING` and reloads once on `controllerchange`;
  - no reload without the tap;
  - no prompt on first install.
- E2E `pwa`:
  - load → offline → reload: Budget renders from the mirror;
  - log an expense offline → reload offline: it is still there → back online: it syncs once.

- [ ] TDD → `npm run e2e` → commit `Refonte : lancement — hors ligne et nouvelle version`

### Task 4: Accessibility sweep and Lighthouse

**Files:**

- Create: `tests/e2e/a11y.spec.ts`. It uses the existing axe helper in `tests/e2e/helpers.ts` on:
  - screens: Budget, each pot ledger, Historique (with search results), Objectif, Moi and every settings screen, Partager à deux (solo), Notifications, login, each onboarding step;
  - sheets: the add sheet, the chat sheet with a receipt card, the edit sheet.
- Modify: whatever it flags. Any fix must keep the prototype's look.

**Behaviour:** No serious or critical axe violation anywhere (§8.6). Then, **manually** and once: Lighthouse mobile on `npm run preview` (throttled 4G). Record LCP, TBT and CLS in this plan, and fix anything over the §8.4 budget.

**Tests:** the new spec on iPhone 13 and Pixel 7.

- [ ] Write the spec → fix → `npm run e2e` → Lighthouse figures noted here → commit `Refonte : lancement — accessibilité, tous les écrans`

### Task 5: Observability (D4)

**Files:**

- Create: `src/app/monitoring.ts` (`initMonitoring()` dynamic-imports `@sentry/browser` after first paint, only if `VITE_SENTRY_DSN` is set; `scrub(event)`), `src/server/monitoring.ts` (`@sentry/node` for `api/aam.ts`, same `scrub`, flush before the response ends), `supabase/queries/ai_dashboard.sql` (last 7 days: turns, p50/p95 latency, fallback rate, validation drops, error rate per 15 min), `supabase/queries/launch_metrics.sql` (+30 days: onboarded vs signed-up accounts, users logging ≥ 3 expenses/week, chat p95; states which §2 metrics are not measured)
- Modify: `src/main.tsx`, `api/aam.ts`, the outbox's permanent-failure path (`captureMessage('sync_failed', { kind, code })`, no row content), `vercel.json` (Sentry ingest origin in `connect-src`), `.env.example` (`VITE_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_RELEASE` from `VERCEL_GIT_COMMIT_SHA`)
- Test: `tests/unit/app/monitoring.test.ts`, `tests/unit/server/monitoring.test.ts`

**Behaviour:**

- With no DSN (dev, E2E, CI), nothing loads and nothing is sent.
- `scrub` drops request bodies, breadcrumbs' data, user e-mail and `Authorization` headers, and replaces any digit run of 2 or more in messages with `#`.
- The release is the commit SHA.
- **Alerts** are set by the user in Sentry: `api/aam` error rate > 5 % over 15 min, and a spike of `sync_failed`.

**Tests:**

- `scrub` on a crafted event holding an amount, a label, an e-mail, a JWT and chat text leaves none of them.
- With no DSN, `initMonitoring` imports nothing.
- The server wrapper flushes and rethrows nothing to the user (the 503/fallback paths are unchanged).
- The size gate from Task 2 still passes.

- [ ] TDD → `npm run check`, `npm run build && node scripts/check-size.mjs` → commit `Refonte : lancement — suivi des erreurs`

**Session A ends:** `npm run e2e` green. Update this plan with the outcome and the Lighthouse figures.

### Session A progress (2026-09-26, Tasks 1–3)

- **Commits:**
  - `60b9ad5` M1–M11;
  - `00fb65b` the fix from the Task 1 review;
  - `2dbc5dc` the thin Supabase client and the size gate;
  - `a3f009c` offline shell and "Nouvelle version".
- **Gate:** `npm run check` 1207/1207.
- **First-load JS:** 124.1 kB gzipped (it was ~152). `npm run check:size` runs in CI, with `build:notify` and its 200 kB cap.
- **Task 1 review (Opus):** 0 Critical. Two findings were fixed, each with a test that failed first:
  - I1: Historique "Tout" used the household budget for periods from before the pairing;
  - m2: Historique now uses `planFor`, like Budget.

  Deferred:
  - `couple_request`'s per-day dedupe key swallows a second request made the same day after an edit (the fix needs a migration);
  - M3 compares a pending local edit against the device clock.
- **Rulings:** listed in the ledger (`.superpowers/sdd/2026-09-26-stouchi-phase-7-launch/progress.md`). Among them:
  - the worker precaches every built asset;
  - the update bar hides while a sheet is open;
  - `pwa.spec.ts` runs on Chromium only, and the iPhone offline check is manual (Task 10);
  - `ignoreVary` on cache lookups.
- **E2E status on 2026-09-26** (`stouchi-test`):
  - `couple.spec:168` fails because the day's `couple_request` cap (10) was used up by the day's runs. It passes the next day.
  - On iPhone 13, `me.spec:60` and `onboarding.spec:47` fail because WebKit's `fill()` doesn't register. They fail on the old client too.
- **Finding for the user (sync loop, not fixed):** after a reconnect, if the first round fails (the network isn't usable yet), nothing retries until the 60 s interval. `postgrest-js`'s own 1/2/4 s GET retry partly hides this. `core.spec:93` on iPhone 13 is flaky because of it (old client 1/5, new client 6/9). The proposed fix: after a round that failed on the network while `navigator.onLine`, retry in ~2 s (`src/data/sync.ts`).
- **Next:** Tasks 4 and 5, in a fresh session.

### Session A progress (Task 4)

- **`tests/e2e/a11y.spec.ts`:** 29/29 on iPhone 13 and Pixel 7. It covers every screen and sub-screen, Historique search, and the add and chat sheets. The onboarding steps and login are already in `onboarding.spec.ts`.
- **Fixed:** the split editor's segments had white 15px text on the pot colours (2.7–4.2:1). They now use the colours' `-ink` shades (5–6:1).
- **Lighthouse** (2026-09-26, mobile with 4G throttling, `vite preview`, signed out):
  - performance score 98;
  - FCP 1.8 s;
  - LCP 2.2 s (budget 2.5 s);
  - TBT 30 ms;
  - CLS 0;
  - Speed Index 1.8 s.

### Session A outcome (2026-09-26)

- **Commits:**
  - `5db1f2a` Task 5: Sentry, with nothing sent without a DSN; `scrub()`; `sync_failed`; `supabase/queries/ai_dashboard.sql` and `launch_metrics.sql`;
  - then the fixes from the review.
- **Gate:** `npm run check` 1227/1227. First-load JS 124.9 kB, with Sentry in its own lazy chunk.
- **Final review** (Opus, Tasks 2–5): 0 Critical. Fixed, each with a test that failed first:
  - **I1:** a second window whose update was accepted in another window got stuck. It now keeps "Recharger", which reloads it. The worker keeps the previous version's cache, so that window can still load its chunks, and it serves the running version's shell.
  - **m1** (re-graded): a resumed app now checks for a new version when it comes back on screen, at most once an hour.
  - **m2** (re-graded): a page load on a connection that never answers gets the cached shell after 3 s, instead of a white screen.
- **Deferred minors** (the user decides):
  - **m3:** Sentry loads at `setTimeout(0)`, so it competes with the first load. Load it after `load` and idle, and re-measure signed in with the DSN set.
  - **m4:** breadcrumbs lose their timestamps.
  - **m5:** `sync_failed` can have an empty `code` tag.
  - **m6:** the worker's version ignores a change to `index.html` alone.
  - **m7:** `a11y.spec.ts` doesn't cover the receipt card and the edit sheet. `chat.spec.ts` checks them.
- **`npm run e2e`:** 97 passed, 7 failed, 1 skipped. None of the failures comes from Session A:
  - `couple:168` hit the day's cap on partner requests.
  - `core:93` on Pixel 7 is flaky and passes on a rerun.
  - On iPhone 13, `core:44`, `me:35`, `onboarding:47` and `chat:194` fail because typed input doesn't register. `core:44` also fails 2 times in 3 on the code from before Session A, checked in a baseline worktree at `0a5a494`.
  - `couple:129` is Phase 6 M6.

  **The WebKit input flake grew during the day. Look into it before launch.**
- **Still open for the user:** the sync-loop finding (above) and commit `e07fb40`. That commit holds another session's files under a Phase 7 message.

---

## Session B — getting ready to cut over

### Task 6: Retire `/api/chat` (§8.5)

**Files:**

- Delete: `api/chat.js`, and the `lib/` modules that only it imports. Find them with a grep of every `require`/`import` from `api/aam.ts`, `lib/aam-salah/`, `scripts/` and `src/`. `lib/aam-salah/` stays.
- Delete: the legacy tests of the deleted modules (`test/chat-backend.test.js`, plus any other test of a deleted module). Before deleting them, discard the uncommitted Prettier reformat of these files.
- Modify: `.env.example` (drop `CHAT_PROVIDER`, `TOKENROUTER_*`, `CHAT_MODEL`, `CHAT_API_URL` and `PORT` only if nothing left reads them), `CLAUDE.md` (the "Chat and Aam Salah" line)

**Behaviour:** `npm run eval` and the Aam Salah tests are unchanged. The legacy app on `stouchi-ancien` keeps its own copy of `api/chat.js` (Task 8's branch), so nothing live breaks.

**Tests:** `npm run check` (legacy tests minus the deleted ones), `npm run eval -- --min-rate 0.9167` once if the quota allows. Otherwise, note it.

- [ ] Delete → `npm run check` → commit `Refonte : lancement — fin de /api/chat`

### Task 7: Cut-over SQL (freeze, unfreeze, validate, archive)

**Files:**

- Create:
  - `supabase/cutover/legacy_read_only.sql`: revokes `insert, update, delete` on `budget_data`, `household_shared_data` and the legacy household tables (`households`, `household_members`, the shopping-list, activity and recurring-bill tables from 20260809–20260811) from `authenticated` and `anon`, and revokes `execute` on the legacy functions (`create_household`, `join_household`, `merge_household_data`, and the others those migrations define). Reads stay.
  - `supabase/cutover/legacy_read_write.sql`: the exact inverse, for rollback.
  - `supabase/cutover/validate_constraints.sql`: validates `expenses_shared_needs_only` and `incomes_shared_needs_only` in one transaction.
  - `supabase/cutover/archive_legacy.sql`, for Session D: `create schema archive`, moves the legacy tables there with no grants, and drops the legacy functions.
- These files sit **outside** `supabase/migrations/`, so the `tests/db` harness, `stouchi-test`'s history and the legacy tests aren't affected.
- Test: `tests/db/cutover.test.ts` (applies them on top of the migrations in PGlite); `tests/unit/backfill/first-open.test.ts`

**Interfaces:**

- Consumes: the harness's users (Alice, Bob, outsider) and a legacy `budget_data` row.

**Behaviour:**

- After the freeze, the legacy tables are read-only, and a write from `authenticated` fails with `42501`. The new tables and the `couple_*` RPCs are unaffected.
- The rollback SQL restores the exact previous grants.
- Validation passes on backfilled rows. It fails loudly, with nothing applied, if one shared Envies row exists.
- The archive keeps every row.
- The first open after the backfill writes at most the current period's payday deposit, and nothing for earlier periods (Review Focus 2).

**Tests:**

- The freeze:
  - Alice can read, but can't upsert her `budget_data` (`42501`);
  - `join_household` is refused;
  - Alice can still insert an expense and call `couple_state`.
- The rollback: after it, the upsert works again.
- Validation:
  - it passes on the backfill fixture's rows;
  - with one shared `wants` row, it fails and both constraints stay `not valid`.
- The archive: row counts are equal before and after, and `authenticated` can't read `archive.*`.
- First open: the fixture household converted by `scripts/backfill` is fed to `dueDeposits` at "1st, 09:00" and at "15th": the expected deposit count, and none before the launch period.

- [ ] TDD → `npm run check` → commit `Refonte : lancement — scripts de bascule`

### Task 8: The frozen legacy app (branch `legacy`)

**Files (branch `legacy`, cut from `master`; never merged back into `rebuild`):**

- Modify:
  - `app.js`: the join-limit hunk from `f618dcf`, cherry-picked (it handles both the old thrown error and the new `{error}` reply). It also gets read-only mode: the first write refused with `42501` (or `permission denied`) shows a fixed banner, and sync stops retrying. The banner reads "Cette version de Stouchi est en lecture seule. Tes données sont dans la nouvelle version :" with a link to the production domain. Local edits are not sent.
  - `styles.css`: the banner.
  - `lib/chat-context.js`, `vercel.json`: unchanged, since `stouchi-ancien` uses the same legacy build.
- Test: `test/legacy-read-only.test.js` (the pure `isReadOnlyError(err)` helper that `app.js` exposes, as the legacy tests already do for its pure helpers)

**Behaviour:** Before the freeze, the legacy app works as today. After it, the app still opens and shows everything, but new edits are refused with the banner, never lost silently.

**Tests:**

- `isReadOnlyError` is true for `{code: '42501'}` and for a `permission denied` message, and false for a network error.
- Manually, in the rehearsal (Task 9), with `npm start` against `stouchi-test`.

- [ ] TDD on `legacy` → `npm run test:legacy` → commit `Ancienne version : lecture seule après la bascule` (on `legacy`; pushing it is part of Task 10)

### Task 9: Production readiness and the rehearsal

**Files:**

- Modify: this plan, where the Task 10 checklist gets its facts.

**Steps:**

- [ ] **Env list.** From the code (`import.meta.env.*`, `process.env.*` in `api/`, `lib/aam-salah/`, `src/server/`), write the exact Vercel variables for **Production**. They must point at production: the `VITE_SUPABASE_*`, `SUPABASE_URL`/`SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, the provider keys `lib/aam-salah` reads, `VITE_VAPID_PUBLIC_KEY`, the Sentry vars, and `AAM_MODELS` if it is set. **Preview** stays on `stouchi-test`. Also list the `notify-run` secrets for production (VAPID ×3, `GEMINI_API_KEY`), and the Vault secrets and schedule from Phase 4 (`notify-schedule.sql`). Check that the GitHub repo has the secret `eval.yml` needs, because the nightly eval starts running from `master` at the merge (§8.6).
- [ ] **Offline shell on Vercel:** on a preview, `/index.html` answers 200 with no redirect. A redirected response can't answer a navigation, which would break the offline start (from the Session A review).
- [ ] **Production migration state** (read-only): `npx supabase migration list --project-ref gfbakmwllhuhfdydbcfa`. List which of `20260923`–`20260930` are missing, in order.
- [ ] **Auth diff** (read-only, dashboard or CLI): the site URL, redirect URLs, Google provider and e-mail confirmation on production against `stouchi-test`. The user fixes the differences.
- [ ] **Rehearsal on `stouchi-test`** (approval for the `--apply` on test):
  1. Run the legacy app locally against test and write a legacy row.
  2. Apply `legacy_read_only.sql`, then check the banner (Task 8).
  3. Run `npm run backfill` against test, then `-- --apply`.
  4. Apply `validate_constraints.sql`.
  5. Open the new app: the figures match the report, and at most one deposit is written.
  6. Apply `legacy_read_write.sql`, so the test project keeps its legacy writes for the E2E and legacy tests.
- [ ] **Backfill dry run on production** (approval; the service key goes in `.env` for this step only). Run `npm run backfill`, never `--apply`.
  - The report must pass verification.
  - Every issue is read with the user (`shared_wants_private` = M10, expected).
  - `.backfill/` stays gitignored.
  - Fix any failure on `rebuild` with a test, then run it again.
- [ ] `npm run check` and `npm run e2e` green → update this plan and `CLAUDE.md` status → commit `Refonte : phase 7 — prêt pour la bascule`

---

## Session C — launch day (the 1st, morning)

### Task 10: Runbook

Each numbered step is announced, approved, run, then checked. If a check fails, stop and roll back (below).

1. **Announce** in the legacy app's household, if the user wants: the time of the switch.
2. **Legacy app on its own project.**
   - Push the `legacy` branch.
   - `stouchi-ancien` deploys it with the legacy env vars.
   - Check that it opens and reads data.
3. **Merge `legacy` → `master`** (the join-limit and read-only `app.js`) and let Vercel deploy it to production. Check that the legacy app still works: the new `app.js` accepts both join replies.
4. **Production migrations** `20260923`–`20260930`, in order, as found in Task 9. Run `npm run check:supabase` against production (with the anon key; no service key). The legacy app still works, because the migrations are additive.
5. **Freeze:** `legacy_read_only.sql`. Check that a legacy write shows the banner.
6. **Final backfill:**
   - `npm run backfill`: verification passes, with the same issues as the dry run plus any rows added since.
   - Then `npm run backfill -- --apply`.
   - Then `validate_constraints.sql`.
   - Remove the service key from `.env`.
7. **`notify-run` on production:**
   - Run `npm run build:notify`.
   - Deploy with `npx supabase functions deploy notify-run --no-verify-jwt --use-api --project-ref gfbakmwllhuhfdydbcfa`.
   - Set the secrets (VAPID ×3, `GEMINI_API_KEY`), the Vault entries and `notify-schedule.sql`.
   - A manual run answers 200.
8. **Vercel production env** set from Task 9's list, Sentry included.
9. **Launch:** `git checkout master && git merge --ff-only rebuild && git push`. Vercel deploys the new app.
10. **Smoke test on phones** (the user):
    - log in with a real account: Budget's figures match the backfill report for this period;
    - log an expense by keypad and by chat;
    - Historique finds a legacy expense;
    - Objectif shows the legacy savings;
    - enable push;
    - on the installed iPhone PWA, in airplane mode, reopen the app: Budget shows (Playwright can't test this on WebKit);
    - Sentry receives the release.
11. **Watch** for two hours: the Sentry issues, `ai_dashboard.sql`, and `notify-run`'s next runs.

**Rollback** (any step from 9 on):

1. Use Vercel's Instant Rollback to the step-3 deployment.
2. Apply `legacy_read_write.sql`.
3. Rows written in the new tables since step 9 stay there. They are listed with a query on `created_at`, and the user decides what to do with them.

Before step 9, rollback is only `legacy_read_write.sql`.

- [ ] Steps 1–11 → update this plan (outcome) and `CLAUDE.md` (status: launched; `master` is the new app) → commit `Refonte : phase 7 — lancement`

---

## Session D — day +14

### Task 11: Close the legacy app

**Files:**

- Delete: the legacy app files (`index.html` at the root, `app.js`, `styles.css`, `budget-facts.js`, `server.js`, `assets/` used only by them), the legacy tests that test only them, and the backfill's `appDiffs` dependency on `budget-facts.js`. The backfill is kept for the record but no longer compares, or it is deleted with the user's agreement.
- Modify: `package.json` (`start`, `test:legacy` in `check`), `CLAUDE.md` (the "Two apps" section)

**Steps:**

- [ ] With approval: apply `archive_legacy.sql` on production. Delete the `stouchi-ancien` Vercel project and remove the legacy env vars from the main project.
- [ ] Delete the legacy code → `npm run check`, `npm run e2e` → commit `Refonte : fin de l'ancienne version`
- [ ] Remind the user (via `/schedule`): +30 days, run `launch_metrics.sql` against §2's targets; +90 days, drop `archive.*` (approval).

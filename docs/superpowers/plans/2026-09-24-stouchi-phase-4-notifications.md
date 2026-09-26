# Stouchi Rebuild — Phase 4: Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is **lean by design**: it gives files, behaviour, interfaces and test cases, not code. Port the bell and the Notifications screen from `prototype/index.html` (`.bell`, `#s-notif`, `renderNotif`, `notifAction`, around lines 177, 835–882 and 1355–1430); do not redesign.

**Goal:** Aam Salah writes to the user at the right moments. A rules engine runs every 15 minutes and writes `notifications` rows. The bell on Budget shows a dot for unread rows, and the Notifications screen lists them with one-tap actions. After the first week, the user can opt in to web push.

**Architecture:** A scheduled job reads every user's data, so it runs as a **Supabase Edge Function** (`notify-run`), scheduled by `pg_cron` + `pg_net` every 15 minutes. The service key is built into Supabase and never reaches Vercel or `.env`. The rules, caps, templates and writer checks are pure TypeScript in `src/shared/notify/`. The run loop is in `src/server/notify/` and takes injected dependencies (database, clock, writer, push sender), so Vitest covers it. esbuild bundles both into the function, and a thin Deno adapter wires in the real clients. The app reads its notifications through the local mirror and marks them read through the outbox, as a `read_at`-only update.

**Tech Stack:** Phase 0–3 stack. Edge Function on Deno (Supabase), `npm:web-push` inside the function only, and esbuild (already installed through Vite) for the bundle. The app gets no new runtime dependency. The service worker is hand-written (`public/sw.js`) and handles push only; offline caching waits for Phase 7.

**Spec:** redesign spec §4.5 (screen, caps, opt-in), §4.6 (payday), §7 (`notifications`, `push_subscriptions`), §8.1, §8.5 (cron exception) and §5.6. Assistant spec §6 (triggers table and writer prompt). The prototype wins on looks; the specs win on behaviour.

---

## Session A outcome (2026-09-24): read this before Session B

Tasks 1–5 are done (commits `f9e1cd0`..`c7aace2`, check 716/716). The migration is applied on `stouchi-test`. Session B must take these changes to the plan into account:

- **Trigger `pot_80` is `pot_near`.** The existing check on `notifications.trigger` allows no digits. The dedupe key stays `pot80:…`.
- **`weekly_recap` is uncapped.** It has one window a week, and an alert earlier that Sunday would otherwise cancel it. The recap still respects quiet hours and is still written by the model.
- **A bill due in the *next* period** gets its 3-day notice with `action: null`. "Marquer payée" would record the current period. Task 8's `pay_bill` therefore only ever pays the current period.
- **Writer:** `compose(candidate, firstName, callModel?)`. It refuses numbers written in words ("le double", "deux cents").
- **Button and done strings** are already in `fr.json`: `notify.buttons.<kind>` and `notify.done.<kind>`, plus `…_already`. Task 7's filter groups and icons come from `src/shared/notify/triggers.ts`.
- **Task 5 is live on `stouchi-test` (2026-09-24):**
  - **Secrets:** the function has 4 secrets (VAPID ×3, `GEMINI_API_KEY`). The cron secret was generated inside Vault and is read by `public.notify_cron_secret()` (migration 20260927), so `NOTIFY_CRON_SECRET` no longer exists.
  - **Deploy:** `npm run build:notify`, then `npx supabase functions deploy notify-run --no-verify-jwt --use-api --project-ref sfradlloqjmphjmlvaaw`.
  - **Checks passed:** 401 without the secret, and a real run through `net.http_post` → 200 with `{users: 2, errors: 0}`. `web-push` loads on the edge runtime.
  - **Schedule:** the `notify-run` pg_cron job runs `*/15 * * * *`.
  - **Still to do:** one real push to a phone, once Session B builds the opt-in (Task 9, then Task 10).
- **Deferred minors** are listed in the ledger (`.superpowers/sdd/…/progress.md`). Task 10 must note the 24-hour reminder window in assistant spec §6.

## Session B outcome (2026-09-24)

Tasks 6–10 are done (commits `b18bb00`..`91e47b8`, check 788/788; the notifications E2E pass 13/13 on both devices). The full `npm run e2e` has 3 iPhone failures (`chat.spec:95`, `core.spec:45`, `onboarding.spec:47`); they fail the same way on `bf82d25`, before this session, so they predate Phase 4.

- **Rulings worth knowing:**
  - Local DB is v4 (v3 was Phase 3's chat).
  - The service worker is `src/public/sw.js`, because Vite's root is `src/`.
  - New routes: `#/history/<category>` and `#/notifications/<id>` (opened from a push, marks that row read).
  - Done lines (`actedOn`) live in IndexedDB meta `acted:<userId>`.
  - A new device owner drops the device's push subscription.
  - Marquer payée works only on a row from the current pay period.
- **Still for the user:** set `VITE_VAPID_PUBLIC_KEY` in the Vercel preview, then send one real push to Android Chrome and one to an installed iPhone PWA through `notify-run` on `stouchi-test`.
- **Deferred minors: resolved (2026-09-24, after Session B).**
  - **Fixed:**
    - The run logs the error kind (class and table, no user data).
    - A run stopped at 120 s starts at a different point each 15-minute slot.
    - Payday catches up for 2 days after a failed day.
    - A failed notifications pull is retried the next round.
    - `subscribe()` and `unsubscribe()` errors are handled.
    - `read_at` only moves forward in a pull.
    - An old tab gives way on a DB upgrade.
    - Read marks are neither pending nor failed writes.
    - The `webpush` timeout was already in place.
  - **Left as is:**
    - The 24-hour reminder window is intended and recorded in assistant spec §6.
    - The `reminders_due` index isn't needed, since the per-user query uses `(user_id, remind_at)`.
    - The writer can't tell a real fact number used in the wrong role.
  - **Also fixed: the 3 iPhone E2E failures.**
    - The first pull kept an IndexedDB transaction open for seconds, and every write waited behind it.
    - Playwright now blocks service workers, which let WebKit requests slip past `page.route`.
  - **Result:** full E2E 61/61.
  - **Redeployed to `stouchi-test` (2026-09-25).** The first deploy failed every run (500): the rotating start cursor wasn't a uuid, and Postgres refused it. After fix `d8b18a3`, a manual run answered 200 with `{users: 2, errors: 0}`. The test fake now refuses non-uuid cursors.

## Session split

Run it as **two sessions**. Session A covers Tasks 1–5: schema, rules, writer, run loop and function. Session B covers Tasks 6–10: the client, push and E2E. Run `npm run check` before every commit and `npm run e2e` at the end of Session B. Commit messages are in French: `Refonte : …`.

## Things only the user can do

> **2026-09-24: the user approved this plan's decisions, together with items 1 and 3 (for `stouchi-test` only).** Items 2 and 4 still need the user. Anything touching production still needs a fresh approval.

1. **Approve the migration in Task 1** and the schedule SQL in Task 5. Both go to `stouchi-test` only. Production waits for Phase 7.
2. **Keys.** Generate VAPID keys (`npx web-push generate-vapid-keys`). Set these **Supabase function secrets** on `stouchi-test`: `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (a `mailto:`), `GEMINI_API_KEY` and `NOTIFY_CRON_SECRET` (random, 32+ bytes). Put the same cron secret in Supabase Vault (Task 5). Set `VITE_VAPID_PUBLIC_KEY` in `.env` and in the Vercel preview. Claude never prints or commits any of them.
3. **Approve the deploy** of the `notify-run` function to `stouchi-test` (Task 5).
4. **Test push on real phones** in Task 10: Android Chrome, and an iPhone with the PWA added to the Home Screen (iOS 16.4+).

## Global Constraints

- **Service-key code is scoped per user.** Every query the run makes goes through `forUser(userId)`, which adds `user_id = …`. The run never builds figures from more than one user's rows at once. It writes to `notifications`, `savings_moves` (payday deposit only) and `push_subscriptions` (deleting expired ones only). The run log holds counts only: no names, amounts or text.
- Money stays in integer millimes. Figures in notification text come from `formatTnd` on `computeFacts` output and are never computed by the model.
- All times are Africa/Tunis. Quiet hours run from 21:00 to 08:00 local time. Tunisia has no DST, but still use `tunisInstant` and `todayTunis` and never the server's local clock.
- Every UI string and every template goes in `fr.json`. The writer's text is rendered as text only, never with `dangerouslySetInnerHTML`.
- The Notifications screen is a lazy chunk, and first-load JS stays ≤ 150 kB gzipped.
- The §5.6 accessibility rules apply: the bell has a label and announces the unread count, rows and buttons are ≥ 44 px, and reduced motion stops the bell ring.
- Legacy `server.js`, `api/chat.js` and `test/` stay working.

## Decisions this plan makes (the specs leave them open)

- **Cron host.** Supabase Edge Function plus `pg_cron`, not Vercel. Vercel's free plan only runs a cron once a day, and CLAUDE.md keeps the service key out of Vercel. Update spec §8.1 (`/api/notify/run` becomes the `notify-run` function) and §8.5.
- **No `/api/push/subscribe`.** The existing RLS policies already allow a user to insert and delete their own `push_subscriptions` rows, so the app writes them directly with the user's JWT. Update spec §8.1.
- **Cron auth.** The function is deployed with `verify_jwt = false`. It accepts only `Authorization: Bearer <NOTIFY_CRON_SECRET>`, compared in constant time. Anything else gets 401.
- **Timing.** A trigger fires on the first run at or after its time, so it can be up to 15 minutes late. Anything that comes due during quiet hours waits for the first run after 08:00. Dedupe keys are per period or per week, so waiting drops nothing.
- **User reminders ignore quiet hours.** The user picked that time. This is the only exception to 21:00–08:00; update assistant spec §6.
- **Daily cap.** At most one *capped* notification per user per Tunis day. It is counted from today's rows whose trigger is capped. Uncapped triggers are `bill_due`, `user_reminder` and `payday`. Payday is the salary landing, and a missed payday message would be a bug; update assistant spec §6. When several capped triggers are due at once, the first in this order wins: `pot_over`, `pot_80`, `owed_to_me`, `category_spike`, `savings_opportunity`, `weekly_recap`, `quiet_week`. The rest stay candidates for the next day, if their keys are still new.
- **Dedupe keys** (`notifications_dedupe` is already unique per user):
  - `payday:<period_start>`, `bill:<bill_id>:<due_on>:d3|d0`, `pot80:<period_start>:<pot>`, `potover:<period_start>:<pot>`
  - `spike:<iso_week>`, `owed:<debt_id>:<iso_week>`, `savings:<period_start>`, `recap:<iso_week>`, `quiet:<iso_week>`, `reminder:<reminder_id>`
  - The run inserts with `on conflict do nothing` and sends push **only for rows actually inserted**, so two runs never notify twice.
- **Trigger details** (the assistant spec §6 table, made precise):
  - **Pot fill** is `1 − left / (budget + moved)`. A pot that is already over when the 80 % check runs gets only `pot_over`.
  - **Category spike:** this period's total is ≥ 50 TND and ≥ 1.3 × the median of the same category over the previous 3 periods, and that median is > 0.
  - **Owed to you:** `owed_to_me`, not settled or deleted, `created_at` more than 10 days ago.
  - **Savings opportunity:** the same rule as the carnet's `a_signaler`. Extract it into `src/shared/nudges.ts` so both use one function.
  - **Weekly recap:** Sunday from 19:00, skipped when nothing was logged that week.
  - **Quiet week:** the newest non-deleted expense `created_at` is more than 3 days old, and the user onboarded more than 3 days ago.
  - **Bill due:** 3 days before the due date and on it, from 08:00, skipped if that period's `bill_payments` row exists.
  - **User reminder:** `remind_at ≤ now`, not done and not deleted.
- **Payday.** From 08:00 on payday the run writes the payday deposit with the same `paydayId` the device uses (insert-ignore), then the `payday` notification. Whichever of the device and the cron writes first, there is one row.
- **Writer.** Only the advice triggers (`pot_80`, `pot_over`, `category_spike`, `owed_to_me`, `savings_opportunity`, `weekly_recap`, `quiet_week`) go through the model. `payday`, `bill_due` and `user_reminder` always use templates: deterministic, never lost, and never paid for. Button labels always come from `fr.json` per action; the model is not asked for `bouton`. Update the assistant spec §6 prompt. The model's output falls back to the template when:
  - it isn't JSON, the title is over 40 characters or the text over 140;
  - it uses a non-Latin script or an emoji;
  - it contains a number that is not in the facts;
  - the call takes more than 6 s;
  - the run has already made 40 writer calls.
- **`action` jsonb** is `{ kind, ref? }`, validated by zod on both sides. Kinds: `open_pot` (ref `needs|wants`), `pay_bill` (ref bill id), `open_goal`, `open_history`, `open_category` (ref category), `remind_debt` and `settle_debt` (ref debt id), `log_expense`. An unknown kind shows the row with no buttons.
- **One-tap actions** (Task 8):
  - Marquer payée: the same bill-payment write as the chat's `pay_bill`. Move it into `src/data/repos.ts` if it lives in `features/chat`.
  - C'est réglé: sets `settled_at`.
  - Rappelle-moi: a reminder for next Sunday at 10:00 Tunis, or the Sunday after when today is Sunday. Its text is "Relancer <person> pour les <amount> TND".
  - Every button also marks its row read. After the action, the row's body is replaced locally by a done line from `fr.json`. The server row is never edited.
- **Local mirror.** Add `notifications` to IndexedDB (DB version 3, upgrade keeps everything). Pull the last 60 days, 200 rows at most, when the app opens, when it returns to the foreground, and when the service worker posts a `notify` message. Marking read is a new outbox op, `patch`, which sends `update … set read_at where id = …`, never an upsert. The table grants only `update (read_at)`.
- **Push opt-in.** A card on the Notifications screen, never during onboarding. It shows when all of these hold:
  - the user onboarded at least 7 days ago;
  - `Notification.permission === 'default'`;
  - `PushManager` exists;
  - on iOS, the app runs standalone;
  - the user hasn't dismissed the card on this device.

  "Plus tard" hides it for 30 days. The same screen has an on/off switch in its footer.
- **Sign-out** unsubscribes the device from push, deletes its `push_subscriptions` row and clears the local notifications. This keeps the next user on the device from receiving the first user's pushes.
- **Service worker** `public/sw.js`, registered only in production builds:
  - `push`: `showNotification(title, { body, tag: id, data: { id } })`, then post `notify` to open clients.
  - `notificationclick`: focus or open `/#/notifications`, and post the id so the app marks it read.
  - It has no fetch handler; caching comes in Phase 7.
- **Out of scope:** Moi settings (Phase 5), notifying the partner in couple mode (Phase 6), the 90-day purge and push for the legacy app (Phase 7).

## Review Focus

1. **Cross-user leakage in service-key code.** With two users' rows in the fake database, a run builds facts, notifications and pushes only from each user's own rows. Every recorded query carries a `user_id` filter. (Tests in Task 4.)
2. **Time rules.** Quiet hours at 20:59, 21:00, 07:59 and 08:00; a reminder at 22:30 still fires; the recap on Sunday at 18:59 and 19:00; one capped notification per day with bills and reminders on top; payday on day 31 in a 30-day month, and payday "fin du mois". (Tests in Task 2.)
3. **Idempotency.** Two runs in a row, or two overlapping runs, give no duplicate rows and no second push. The payday deposit written by the cron and by the device is one row. (Tests in Tasks 2 and 4.)
4. **Writer inventing a figure.** The model writes "450 TND" when the facts say 415, adds an emoji, answers in Arabic script, times out or returns 300 characters. In every case the template is used and the row is still written. (Tests in Task 3.)
5. **`read_at` write path and device hand-over.** Mark read offline, then reconnect: only `read_at` is sent. User B signing in after A never sees A's notifications or gets A's pushes. (Tests in Tasks 6 and 9.)

---

# Session A — schema, rules, writer, run, function

### Task 1: Migration — scheduler extensions, action check — *careful review*

**Files:** create `supabase/migrations/20260926_phase4_notify.sql`. Modify `src/shared/schemas.ts`, `tests/db/rls.test.ts` and `scripts/supabase-check/tables.ts` (only if the checks change).

**Behaviour:**
- Enable `pg_cron` and `pg_net` (in the `extensions` schema).
- Add a check on `notifications.action`: null, or an object with a text `kind`.
- Add a partial index `reminders (remind_at) where done_at is null and deleted_at is null`.
- The table grants and policies from Phase 0 don't change.
- In zod, add `NotificationRow` and `NotificationAction` (the kinds from Decisions) and `PushSubscriptionInsert`.
- Apply the migration to `stouchi-test` only.

**Tests:**
- [ ] RLS: a user reads only their own notifications and can update `read_at` but not `title`, `body` or `action`. They can't insert or delete. `anon` gets nothing.
- [ ] RLS: a user inserts and deletes only their own `push_subscriptions` rows, and can't update them. An `http://` endpoint is rejected.
- [ ] The check refuses `action = '[]'` and `'{"x":1}'`.
- [ ] zod rejects an unknown action kind, and `open_pot` with ref `savings`.

- [ ] Commit: `Refonte : migration phase 4 — planificateur, contrôle des actions de notification`

### Task 2: Rules engine (`src/shared/notify/rules.ts`) — *careful review*

**Files:** create `src/shared/notify/rules.ts`, `src/shared/notify/triggers.ts` (trigger list, capped or not, priority, filter group, icon) and `src/shared/nudges.ts` (the savings-opportunity rule, extracted from `carnet.ts`). Modify `src/shared/carnet.ts` to use `nudges.ts`. Test: `tests/unit/notify/rules.test.ts`, `tests/unit/nudges.test.ts`.

**Interfaces (produces):**
- `UserSnapshot` is `FactsInput` plus `goals`, `reminders`, `debts`, `firstName`, `onboardedAt` and the newest expense `createdAt`.
- `evaluate(snapshot, now: Date, sentToday: { trigger; dedupeKey }[], sentKeys: Set<string>): Candidate[]`.
- `Candidate = { trigger; dedupeKey; facts: Record<string, string>; action: NotificationAction | null; paydayDeposit?: SavingsMoveInsert }`. `facts` values are already-formatted strings, such as `"415"`, `"Envies"` and `"12 oct."`.

**Behaviour:**
- `evaluate` applies every rule from Decisions.
- It drops keys already in `sentKeys`.
- It applies quiet hours; `user_reminder` is exempt.
- It keeps every uncapped candidate, and at most one capped one, by priority, only when `sentToday` holds no capped row.
- Every figure comes from `computeFacts`, `periodTotals`, `billDueDates` and `payPeriod`. Nothing is computed ad hoc.

**Tests:**
- [ ] Each trigger fires on its condition and not on the day before or the hour before (**Review Focus 2**).
- [ ] Quiet hours: nothing at 21:00 or 07:59 except a user reminder. The bill `d0` comes at 08:00.
- [ ] Cap: `pot_over` and `weekly_recap` due together → only `pot_over`. With one capped row already today, the next capped candidate is dropped, while a bill and a reminder still fire.
- [ ] Pot already over → `pot_over` only. Crossing 80 % in a new period fires again (new key).
- [ ] Spike: 49 TND never fires; median 0 never fires; exactly 1.3 × fires.
- [ ] The bill `d3` is skipped once that period's payment exists.
- [ ] The payday candidate carries a deposit with the same id as `dueDeposits` on the device.
- [ ] `nudges.ts` gives the same answers as the Phase 3 carnet tests (they still pass unchanged).

- [ ] Commit: `Refonte : moteur de règles des notifications`

### Task 3: Writer and templates (`src/shared/notify/writer.ts`) — *careful review*

**Files:** create `src/shared/notify/writer.ts`. Modify `src/shared/i18n/fr.json` (`notify.templates.<trigger>`, `notify.buttons.<kind>` and `notify.done.<kind>`). Test: `tests/unit/notify/writer.test.ts`.

**Interfaces (produces):**
- `writerPrompt(trigger, facts, firstName): string`: the assistant spec §6 prompt without `bouton`.
- `acceptWriter(raw: string, facts): { title; body } | null`.
- `templateFor(trigger, facts): { title; body }`.
- `compose(candidate, callModel?: (prompt) => Promise<string>): Promise<{ title; body; source: 'model'|'template' }>`, with the 6 s timeout inside.

**Behaviour:** as in Decisions. The number check pulls every number out of the text (handling `12,5`, `12.5` and `1 200`) and requires each one to appear in `facts`. Each template is a fixed French line filled only from `facts`. Titles and bodies are cut to the database limits (80 / 300) no matter what.

**Tests:**
- [ ] **Review Focus 4:** an invented figure, an emoji, Arabic script, non-JSON, a 41-character title, a 141-character text, a timeout → template.
- [ ] A valid answer is kept as written, and `facts` numbers written with a comma or a space pass.
- [ ] Every trigger has a template, and every template renders from its trigger's example facts with no `{placeholder}` left.
- [ ] `payday`, `bill_due` and `user_reminder` never call the model.

- [ ] Commit: `Refonte : rédacteur des notifications et modèles de secours`

### Task 4: Run loop (`src/server/notify/run.ts`) — *careful review*

**Files:** create `src/server/notify/run.ts`, `src/server/notify/load.ts` (`forUser(db, userId)` loads one snapshot) and `src/server/notify/push.ts` (payload plus the expired-subscription rule). Test: `tests/unit/server/notify-run.test.ts`, with a fake database that records every query, a fake clock, a fake writer and a fake push sender.

**Interfaces:**
- Consumes `evaluate` (Task 2) and `compose` (Task 3).
- Produces `runNotify(deps: { db; now; callModel?; sendPush; log }): Promise<RunReport>`.
- `RunReport = { users; inserted; pushed; expiredSubs; writerCalls; errors }`: counts only.

**Behaviour:**
1. List onboarded profiles, in pages of 100.
2. For each user: load their snapshot, today's rows and their keys (the last 40 days), then evaluate.
3. For each candidate: write the payday deposit first (insert-ignore), then compose and insert the notification (`on conflict do nothing`, returning the row).
4. For each inserted row, push to each of the user's subscriptions. A 404 or 410 deletes that subscription; other errors are counted.
5. One user's error is logged by count and never stops the run.
6. Stop taking new users after 120 s, and report it.

**Tests:**
- [ ] **Review Focus 1:** two users with different rows get their own figures. Every query carries a `user_id` filter, the only exception being the profile listing. Neither user's pushes go to the other's endpoints.
- [ ] **Review Focus 3:** two runs at the same `now` → the second inserts and pushes nothing. When the payday deposit already exists, the notification is still written once.
- [ ] A 410 deletes the subscription; a 500 doesn't.
- [ ] A throwing user is skipped and the next one runs.
- [ ] The writer cap: the 41st advice candidate uses a template.
- [ ] `RunReport` and the log calls contain no names, amounts or notification text.

- [ ] Commit: `Refonte : boucle d'envoi des notifications, cloisonnée par utilisateur`

### Task 5: Edge Function, bundle and schedule

**Files:** create `supabase/functions/notify-run/index.ts` (Deno adapter), `supabase/functions/notify-run/deno.json`, `scripts/build-notify.mjs` (esbuild: `src/server/notify/run.ts` becomes `supabase/functions/notify-run/core.js`, an ESM file with `fr.json` inlined) and `supabase/sql/notify-schedule.sql` (not a migration, because its URL is different on each project). Modify `package.json` (`build:notify`), `.gitignore` (`core.js`) and `.env.example`.

**Behaviour:**
- The adapter checks the cron secret, then builds the Supabase client from the function's built-in `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, the Gemini call (`NOTIFY_MODEL`, by default the eval model) and `sendPush` via `npm:web-push`. It calls `runNotify` and returns the report as JSON.
- **Spike first:** deploy a hello-push version and send one push to a test subscription. If `npm:web-push` fails on the edge runtime, switch to `jsr:@negrel/webpush` behind the same `sendPush` shape, and note which one in the commit body.
- `notify-schedule.sql` reads `notify_url` and `notify_secret` from Vault and schedules `*/15 * * * *` with `net.http_post`. Running it again replaces the job.
- Deploy to `stouchi-test` with `verify_jwt = false`, after the user approves.

**Tests:**
- [ ] `npm run build:notify` produces one file with no `node:` imports other than those Deno supports.
- [ ] Manual: POST without the secret → 401. With the secret → a JSON report. With a test user whose bill is due today, a row appears and the next run adds none.
- [ ] Manual: `cron.job_run_details` shows successful runs every 15 minutes.

- [ ] Commit: `Refonte : fonction notify-run sur Supabase, planifiée toutes les 15 minutes`

---

# Session B — the client

### Task 6: Local mirror and `read_at` outbox — *careful review*

**Files:** modify `src/data/localdb.ts` (version 3: the `notifications` store), `src/data/remote.ts` and `src/data/sync.ts` (pull the notifications window; push `patch` ops), `src/data/outbox.ts` (the `patch` op: table, id, and columns from an allow-list, which for now is `notifications.read_at` only), `src/data/store.ts` (`notifications` and `unreadCount` signals) and `src/data/app.ts` (sign-out clears notifications). Create `src/data/notifications.ts` (`markRead(ids)` and `markAllRead()`). Test: `tests/unit/data/notifications.test.ts`, `tests/unit/data/sync.test.ts`.

**Behaviour:**
- `markRead` sets `read_at` locally at once (optimistic) and queues one `patch` per row. A row that is already read is skipped.
- The pull merges server rows but keeps a local `read_at` that is still waiting in the outbox.
- `patch` is sent as `update`, never `upsert`.
- The v2 → v3 upgrade keeps every row and the outbox.

**Tests:**
- [ ] **Review Focus 5:** mark read offline → the outbox holds a `patch` with only `read_at`. On reconnect the request is an update with only `read_at`, and a pull in between doesn't bring the unread state back.
- [ ] A `patch` for a column that isn't allowed is rejected before it is queued.
- [ ] `unreadCount` follows reads. Sign-out empties the store. User B never sees user A's rows.
- [ ] Opening a v2 database with a pending outbox entry upgrades it with the entry intact.

- [ ] Commit: `Refonte : notifications en local, lecture synchronisée par la file d'attente`

### Task 7: Bell and Notifications screen

**Files:** create `src/features/notifications/NotificationsScreen.tsx`, `NotificationRow.tsx`, `notifications.css` and `group.ts` (Aujourd'hui / Cette semaine / Plus tôt in Tunis time, plus the filter mapping). Modify `src/app/router.ts` (`notifications` route, lazy), `src/features/budget/BudgetScreen.tsx` (a bell in the header with the dot, which rings once when the unread count rises, unless motion is reduced) and `src/shared/i18n/fr.json`. Test: `tests/unit/notifications/screen.test.tsx`, `tests/unit/notifications/group.test.ts`.

**Behaviour:**
- Port the prototype's markup and styles.
- Filters: Tout / Alertes (`pot_*`, `bill_due`, `payday`), Conseils (`category_spike`, `savings_opportunity`, `weekly_recap`, `quiet_week`) and Rappels (`user_reminder`, `owed_to_me`).
- "Tout lire" is disabled when nothing is unread.
- Tapping a row marks it read.
- The icon and colour come from `triggers.ts`.
- The time shows as `HH:MM` today, the weekday this week, and the date before that.
- The empty state is an Aam Salah line from `fr.json`, and loading shows a skeleton.
- The footer line comes from the prototype.

**Tests:**
- [ ] Grouping at the edges: 00:00 Tunis today, and 7 days ago.
- [ ] Each filter shows only its triggers. "Tout lire" marks every row and becomes disabled.
- [ ] A body containing `<b>` renders literally. An unknown action kind shows no buttons.
- [ ] The bell's label includes the unread count, and the dot hides at 0.
- [ ] The empty state and the skeleton render.

- [ ] Commit: `Refonte : cloche et écran des notifications`

### Task 8: One-tap actions

**Files:** create `src/features/notifications/actions.ts`. Modify `src/data/repos.ts` (move the bill-payment and debt-settle writes here if they live in `features/chat`, and keep the chat using them) and `fr.json`. Test: `tests/unit/notifications/actions.test.ts` with `fake-indexeddb`.

**Behaviour:** as in Decisions.
- `open_*` kinds navigate: pot ledger, goal, Historique filtered to the category, or the keypad for `log_expense`.
- `pay_bill` when the payment already exists → no second write, and the done line says it was already paid.
- `settle_debt` on a deleted or settled debt → no write, and a "déjà réglé" line.
- The row's buttons disappear once acted on, and stay gone after a reload (tracked by the row's `read_at` plus a local `actedOn` set).

**Tests:**
- [ ] Marquer payée writes one expense and one `bill_payments` row, and a second tap writes nothing.
- [ ] Rappelle-moi on a Wednesday → Sunday at 10:00 Tunis; on a Sunday → the Sunday after.
- [ ] C'est réglé sets `settled_at`, and the debt leaves À venir.
- [ ] Every action marks its row read.

- [ ] Commit: `Refonte : actions en un geste depuis les notifications`

### Task 9: Web push — service worker, opt-in, sign-out — *careful review*

**Files:** create `public/sw.js`, `src/data/push.ts` (`canAskPush`, `enablePush`, `disablePush`, and the service-worker message listener) and `src/features/notifications/PushCard.tsx`. Modify `src/main.tsx` (register the service worker in production only), `src/data/app.ts` (sign-out calls `disablePush` before clearing the session), `NotificationsScreen.tsx` (the card and the footer switch) and `fr.json`. Test: `tests/unit/data/push.test.ts`, `tests/unit/notifications/push-card.test.tsx`.

**Behaviour:**
- `enablePush`: asks permission, subscribes with `VITE_VAPID_PUBLIC_KEY` (`userVisibleOnly`), and inserts the row with the user's JWT, upserting on the same endpoint.
- `disablePush`: unsubscribes, then deletes the row. If the network is down, the delete is retried at the next sign-in by the same user; the local unsubscribe happens anyway.
- The service worker `notify` message triggers a pull. A notification click opens the screen and marks that id read.
- The card shows under the conditions in Decisions.

**Tests:**
- [ ] `canAskPush` is false during the first 7 days, when permission is `denied` or `granted`, in iOS Safari outside standalone mode, and within 30 days of "Plus tard".
- [ ] `enablePush` inserts one row. Enabling twice keeps one row.
- [ ] **Review Focus 5:** sign-out unsubscribes and deletes the row before the session ends, so user B signing in on the same device has no subscription until they opt in.
- [ ] `sw.js`, in a small harness with fake `self`, `clients` and `registration`: `push` shows the title and body with `tag` = id. A click focuses an existing client or opens `/#/notifications`.

- [ ] Commit: `Refonte : notifications push — service worker, accord après une semaine, déconnexion propre`

### Task 10: Phase 4 E2E and hand-over

**Files:** create `tests/e2e/notifications.spec.ts`. It stubs the `notifications` REST calls with `page.route`, because only the service role can insert rows. It records `PATCH` bodies and stubs `pushManager.subscribe` through `addInitScript`. Modify these specs:
- redesign spec: §8.1 (the `notify-run` Edge Function and pg_cron; no `/api/push/subscribe`), §8.5 (where the service key lives) and §4.5 (the reminder exception to quiet hours);
- assistant spec §6: the uncapped triggers, template-only triggers, the writer prompt without `bouton`, and the fallback checks.

Then update `CLAUDE.md` (Status).

**Tests** (both devices, axe with the screen open):
- [ ] Three stubbed rows → the bell dot shows. Open → grouped rows. Tap one → a `PATCH` with only `read_at`. "Tout lire" → the dot disappears.
- [ ] Voir Envies → the Envies ledger. Marquer payée → the bill leaves À venir and the row shows its done line.
- [ ] A user onboarded 8 days ago sees the push card, and "Activer" inserts a subscription. At 2 days, no card.
- [ ] Reduced motion: the bell doesn't ring.

- [ ] Run `npm run check`, `npm run e2e` and `npm run build`: the Notifications screen must be a separate chunk and first-load JS ≤ 150 kB gzipped.
- [ ] **User:** one real push on Android Chrome and one on an installed iPhone PWA, both through `notify-run` against `stouchi-test`.
- [ ] Update `CLAUDE.md` **Status**: Phase 4 done; next is the Phase 5 plan (Objectif and Moi).
- [ ] Commit: `Refonte : E2E phase 4 — notifications, actions, push`

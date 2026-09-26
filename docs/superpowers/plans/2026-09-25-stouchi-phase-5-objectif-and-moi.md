# Stouchi Rebuild — Phase 5: Objectif and Moi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is **lean by design**: files, behaviour, interfaces and test cases, not code. Port markup and styles from `prototype/index.html`; do not redesign. Prototype places: `#s-goal` (≈926) and `renderGoal` (≈1434); `#s-me` / `#s-set` (≈945–960); `renderMe` (≈2237); `openSet` / `renderSplit` / `moveHandle` / `saveSplit` (≈2290–2405); `renderBills` (≈2409); `renderNotifSet` (≈2439); `openEdit` sheets `profile`, `salary`, `payday`, `export`, `delete`, `deposit`, `discard`, `bill` (≈2506–2645); `updateDepositEd` / `updateSalaryEd` (≈2650–2690).

**Goal:** The Objectif tab shows the goal: how much is saved, the percentage, the date it will be reached, an "et si +50/+100/+200" simulation, the deposits, and a Verser button. Moi holds every setting: profile, salary, split, fixed bills, payday, notifications and reminders, hiding amounts, export, sign out and account deletion.

**Architecture:** The goal figures are pure functions in `src/shared/goal.ts`, which reuses `goalEta` and `activeGoal`. A salary or split change that waits for the next payday is stored on `profiles` as `next_*` columns. A pure `planFor(profile, period)` resolves it wherever a period's budget is computed (facts, carnet, payday deposit), so no job has to apply it. The client folds it into the main columns once that period opens. Account deletion is a `security definer` RPC that deletes the caller's `auth.users` row; every table cascades from it. Export is a client-side CSV of the user's own rows, fetched with the caller's JWT. The settings screens are push screens under `#/me/<sub>`, and the edits are sheets.

**Tech Stack:** Phase 0–4 stack. No new runtime dependency.

**Spec:** redesign spec §3 (Objectif and Moi rows), §4.6 (salary/split change "appliquer maintenant"), §4.7 (sharing: Phase 6, not here), §7 (`profiles`, `goals`, `savings_moves`, `bills`, `reminders`), §8.3, §8.5 (export and deletion), §5.6. The prototype wins on looks; the spec wins on behaviour.

---

## Decisions for the user to approve (defaults proposed)

1. **Pending plan change (D1).** Add `next_salary_mil`, `next_split_needs/wants/savings` and `next_from` (a date, the start of the period it applies from) to `profiles`. They are all null or all set, and the next split adds up to 100. `planFor(profile, period)` returns the next plan when `period.start >= next_from`. "Dès ce mois" writes the main columns and clears `next_*`. A payday change moves `next_from` to the new next payday.
2. **Account deletion (D2).** Migration: `public.delete_my_account()`, `security definer`, `search_path = ''`. It runs `delete from auth.users where id = auth.uid()`; execute is granted to `authenticated` only. Every table cascades from `auth.users`, legacy `budget_data` included. Couple households are Phase 6's problem. For now, a member row cascades, and a household left with no member is deleted in the same function.
3. **Export (D3).** CSV only, readable by Excel: UTF-8 BOM, `;` separator, amounts as `12,500`. Choices: Ce mois / 12 derniers mois / Tout. The file holds expenses, incomes and savings moves, one row each, plus bills and debts as their own sections. The rows come from Supabase with the caller's JWT, so exporting needs a connection. No PDF.
4. **Verser (D4).** A manual deposit is `kind: 'deposit'`, `from_pot: null`: money already set aside, so the period's budget does not move (prototype copy). The toast offers undo, which hard-deletes the move. Withdrawals stay in the chat only.
5. **Out of scope (D5).** These prototype rows are not built: Langue, Verrouiller l'app, avatar colour, changer le mot de passe, Aide et contact, Partager à deux (Phase 6), "week-end : payé le vendredi", "Tout mettre à l'épargne" on a raise. None of them has a spec line or a column.

## Session A outcome (2026-09-25): read this before Session B

Tasks 1–5 are done (commits `2060b13`..`134cf2c`, check 856/856). An Opus reviewer checked the whole session; its three Important findings are fixed, each with a test.

- **Live on `stouchi-test` (2026-09-25, approved by the user):** migration `phase5_plan_and_delete` applied (`delete_my_account` owned by `postgres`, not executable by anon); `check:supabase` passes all 14 tables; `notify-run` redeployed, and a manual run answered 200 with `{users: 2, errors: 0}`. `check:supabase` reads `SUPABASE_URL` / `SUPABASE_ANON_KEY`, while `.env` only has the `VITE_` names: pass them in the environment.
- **Rulings Session B must know:**
  - **Profile writes go through the plan helpers.** `nextPlanPatch` and `paydayPatch` (`src/shared/plan.ts`) first fold a pending plan that is already in force but not yet folded. The fold itself is `foldPatch`, applied in `runPayday`. There is no `src/data/plan.ts`.
  - **"Dès ce mois" can keep a pending change.** It gives the pending plan the new value, and clears it only when the two plans become the same. A pending salary therefore survives a split changed "now". This refines Review Focus 1.
  - **zod:** the `next_*` columns are `.nullable().optional()`.
  - **Verser undo:** the deposit is held on the device for 8 s (`writeMine(..., { holdMs })`), and undo drops it with `undoHeld` / `discardHeld`. There is no server delete. `flush` reads each entry again before sending it.
  - **Goal figures:** `goalView`, `sooner` and `depositGain` live in `src/shared/goal.ts`. The percentage is rounded down and stays at 99 % or below until the goal is reached.
  - **CSS:** `.visually-hidden` is now in `src/design/base.css`. Onboarding's CSS loads lazily, so screens outside onboarding must not rely on its classes (`.amt-in`, `.qchips`, `.goals`).
  - **Buttons:** sheet CTAs use `class="cta"` (from add.css): full width, ink colour.
- **Deferred minors:**
  - Budget, Pot and the carnet's `salaire`/`repartition` still read the split from the profile, not from `planFor`. Fix this in Task 6 or 8.
  - `delete_my_account` should lock the household row, so two last members deleting at once cannot leave an empty household.
  - `pendingPlan` uses `as number` casts.
  - The live anon check of `check:supabase` cannot see grant drift.

## Session B outcome (2026-09-25): read this before Session C

Tasks 6–9 are done (commits `d00ad57`..`bd305d1`, check 926/926). An Opus reviewer checked the whole session and found no Critical finding. The one Important finding is fixed with a test, and so is a Minor that was upgraded (hidden amounts).

- **Rulings Session C must know:**
  - **Default timing: "Dès ce mois", as in the prototype (the user's choice, 2026-09-25).** Spec §4.6 says "from the next payday unless appliquer maintenant"; the user chose the prototype instead. Exception: when a change is already pending, the salary sheet and Répartition open on the pending value with "Au <prochaine paie>" picked, so saving without a change writes nothing (review fix).
  - **Routes:** `#/me/split|bills|notifications` parse to `{ name: 'me', params: { sub } }`. `MeScreen` dispatches `split` and `bills`. **Task 10 adds `notifications` there.** Until then, the row shows Moi. The sub-screens are not Shell "push" screens: push screens are white, and the prototype's `#s-set` is grey.
  - **Store:** `store.email` is set from the session in `boot` (null offline).
  - **Shared helpers:**
    - `periodsSince` is in `dates.ts`.
    - `billsDueTotal`, `billsMeter` and `billStatus` are in `bills.ts`.
    - `moveHandle`, `SPLIT_PRESETS`, `splitTip`, `splitText` and `sameSplit` are in `split.ts`.
    - `Facts` now carries `split` (through `planFor`). Budget, Pot and the carnet read it.
  - **Moi rows:** Exporter and "Supprimer mon compte" are rendered but do nothing yet. **Tasks 11 and 12 wire them.**
  - **CSS:**
    - Sheet styles are scoped under `.me-sheet` in `me.css`, and screen styles under `.me`.
    - `.btn2`, `.btn2.red`, `.cta.red`, `.confirm` and `.big-ic` exist there for the delete sheet.
- **Deferred minors:**
  - Moi rows and sheets read `currentPlan`, not `planFor`: offline, before the fold, they show the old plan.
  - The undo toasts re-write the whole previous profile row.
  - "Mois suivis" slices `onboarded_at`'s UTC date.
  - The discard sheet only catches the in-app back button.
  - Répartition's "next" figures use today's salary when a different salary is pending.
  - History and GoalSheet still read split and salary from the profile.
  - A failed write in the salary or bill sheets is silent.

## Session C outcome (2026-09-25): read this before Phase 6

Tasks 10–13 are done (commits `4d21b69`..HEAD, check 976/976, E2E green on iPhone 13 and Pixel 7). Phase 5 is done in code.

- **Still for the user:** delete a throwaway account on `stouchi-test` from a phone (Task 12). Never on the shared test user.
- **Rulings:**
  - **Notifications screen:** the push switch and the reminders only. The prototype's per-kind switches and "Heures calmes" are not built: no plan line and no column. The screen has its own switch (disabled, with the reason, where push can't work) and reuses `PushApi`. Title "Notifications", as in the prototype.
  - **Export:** CSV only (D3), chips Ce mois / 12 derniers mois / Tout. Expenses are negative, incomes positive, savings moves signed as stored. Bills (active) and debts (not deleted) follow as sections and are not range-filtered. `fetchExportRows` reads the caller's rows (`user_id`), paged by offset in `id` order. The CTA is ink, like every sheet CTA (Session A).
  - **Deletion:** `deleteAccount()` calls the RPC first; only then does it drop the device's push subscription, clear every IndexedDB store (then a best-effort `deleteDB`), clear `localStorage` and sign out with `scope: 'local'`. The sheet then goes to `#/intro` and reloads. With unsent writes the sheet warns first ("Continuer"; closing the sheet cancels). Hold: 2 s, pointer or Space/Enter.
  - **CSS:** Session B's `.confirm` in `me.css` clashed with add.css's `.confirm` (each leaked into the other): it is now `.del-confirm`. `.set-h1` lost to the shell's `.top h1` (Répartition and Factures fixes had a 26 px title): it is now `.top .set-h1`, 18 px. `.goal-move__a` failed colour contrast (axe, found by the E2E): it now uses `--save-ink` and `#7a4f0e`.
  - **E2E:** `restoreOnboarded` also clears `next_*`. On WebKit a `fill` right after a sheet opens can be lost, so the salary and bill fields are filled until they hold. `goal.spec` gives the first pull 20 s to reach the goals.
- **Session C bug found by the E2E:** commit `a29f264` lost `app.ts`'s `dates` import, so every pull stopped after `profiles` (the error was swallowed by sync). `4ccc308` fixes it. The unit suite can't see it: the tests mock or bypass `oldestKept`.
- **Open E2E issues (full run, 75/77):**
  - `chat.spec` "offline: … 30 café again" fails on iPhone 13 in full runs (the second offline receipt never shows) and passes alone. A longer timeout did not help. Not checked against the pre-Session-C code.
  - `goal.spec` "hidden amounts" failed once on Pixel 7 in a full run (goal not pulled within 20 s) and passed 2 × 3 alone. The first pull is slow on the shared test account.
- **Final review (Opus, whole session):** no Critical finding. Fixed, each with a test:
  - After the RPC succeeds, `deleteAccount` never throws: each wipe step is tried on its own.
  - An iPhone Safari tab now gets the "ajoute Stouchi à ton écran d’accueil" reason.
  - The delete sheet hides the savings amount when amounts are hidden.
- **Deferred minors:**
  - The push switch stays disabled if `enable`/`disable`/`isOn` rejects. A failed reminder write is silent.
  - HoldButton: a hold can finish after the button turns disabled mid-hold. The hint isn't linked with `aria-describedby`, doesn't mention Entrée, and a screen reader's synthetic click does nothing.
  - The delete sheet's "depuis <mois>" comes from `onboarded_at` and the 12 kept periods, so it understates for backfilled users.
  - The sync loop and payday runner aren't stopped between the RPC and the reload. The server is safe (FK cascades), but a late pull can refill IndexedDB until `deleteDB` runs.
  - Export: a tap on Exporter in the frame right after a chip change can export the previous period. Paging stops on a short page, so a PostgREST `max_rows` below 1000 would truncate.
  - `localStorage.clear()` also clears the legacy app's keys if both ever share an origin (Phase 7).
  - Check a CSV download from the installed iPhone PWA (blob downloads have been unreliable there).

## Session split

Run it as **three sessions**. Session A covers Tasks 1–5 (data and Objectif). Session B covers Tasks 6–9 (Moi and the plan settings). Session C covers Tasks 10–13 (notifications, export, deletion, E2E). Run `npm run check` before every commit and `npm run e2e` at the end of Session C. Commit messages are in French: `Refonte : …`.

## Things only the user can do

1. Approve decisions D1–D5.
2. Approve the Task 1 migration on `stouchi-test` only. Production waits for Phase 7.
3. Approve the `notify-run` redeploy to `stouchi-test` in Task 2 (its payday deposit uses `planFor`).
4. Try deleting a throwaway account on `stouchi-test` from a phone (Task 12).

## Global Constraints

- **Money:** integer millimes only (`src/shared/money.ts`); amounts typed through `AmountInput` / `digits` never become floats.
- **Dates:** Africa/Tunis. Every "ce mois" is the pay period (`src/shared/dates.ts`, `payPeriod`).
- **UI text:** French, in `src/shared/i18n/fr.json`; the i18n test must still pass (no unused or missing keys).
- **Writes:** go through `write()` / the repos and the outbox, never to Supabase directly. The exceptions are the export read and the deletion RPC, which both need a connection and say so.
- **Grants:** `anon` gets nothing new. `authenticated` gets only the columns and functions it needs. `scripts/check-supabase.ts` must still pass.
- **No service key** in the app or on Vercel.
- **Accessibility (§5.6):** the split editor handles are sliders (`role="slider"`, `aria-valuenow`, arrow keys ±5). The delete hold button also works from the keyboard (hold Space or Enter). Every switch is `role="switch"`.

## Review Focus

1. **Two plan edits before payday.** "Au prochain paie" then "dès ce mois": the second clears `next_*`, and the home figures use the new main values. The reverse order keeps both. (Task 2)
2. **Payday changed while a change is pending:** `next_from` follows the new next payday, and the pending plan never applies mid-period. (Task 2)
3. **Target lowered below what is saved:** the percentage is capped at 100, the card shows the reached state, ETA says "atteint", and "et si" is hidden. It must not crash or print "−2 mois". (Task 3)
4. **Hostile labels in the export:** a label with `;`, `"`, a newline or a leading `=`, `+`, `-` or `@` comes out quoted and neutralised, with no formula. (Task 11)
5. **Deletion with unsent writes or offline:** offline, the button is disabled and says why. With pending writes, the sheet warns first (as sign-out does). After success, IndexedDB and the push subscription are wiped before going to Intro. (Task 12)

---

## Session A — data and Objectif

### Task 1: Migration — pending plan and account deletion

**Files:**

- Create: `supabase/migrations/20260928_phase5_plan_and_delete.sql`
- Modify: `src/shared/schemas.ts` (`ProfileBase` gets the five `next_*` fields, nullable, all-or-none refine, next split sums 100)
- Modify: `scripts/check-supabase.ts` / `scripts/supabase-check/` (expect the new function and its grants)
- Test: `tests/db/rls.test.ts`, `tests/unit/schemas.test.ts`

**Behaviour:** as described in D1 and D2. The checks go in the database (`profiles_next_all_or_none`, `profiles_next_split_is_100`) and are mirrored in zod. If `profiles` update grants are column-scoped, the new columns are added to them. The function refuses when `auth.uid()` is null.

**Tests (db):** a user can set and clear their own `next_*`, and cannot touch another user's. A partial `next_*` is rejected. `delete_my_account()` as A removes A's rows from every public table (loop over the tables list) and leaves B's untouched. `anon` cannot execute it. A household whose last member is A disappears.
**Tests (unit):** the schema accepts all-null and all-set with a sum of 100, and rejects a partial set or a sum of 99.

- [ ] Write failing db and schema tests → implement → `npx vitest run tests/db` and `npm run check` green
- [ ] Apply to `stouchi-test` only after approval (Supabase MCP `apply_migration`, project `sfradlloqjmphjmlvaaw`), then run `npm run check:supabase`
- [ ] Commit `Refonte : migration phase 5 — plan en attente, suppression du compte`

### Task 2: `planFor` everywhere a budget is computed

**Files:**

- Create: `src/shared/plan.ts`
- Modify: `src/shared/facts.ts` (`computeFacts` uses `planFor(profile, period)`), `src/shared/carnet.ts` (monthly savings rate), `src/shared/payday.ts` (`dueDeposits` amount per period)
- Create: `src/data/plan.ts`: `foldPlan(store)`, called after the first pull and on each period change
- Test: `tests/unit/plan.test.ts`, plus additions to `facts.test.ts`, `payday.test.ts`, `carnet.test.ts`

**Interfaces (produced):**

- `planFor(profile: Profile, period: PayPeriod): { salary_mil: Mil; split: Split }`
- `pendingPlan(profile): { salary_mil; split; from: ISODate } | null`
- `nextPlanPatch(profile, change: { salary_mil?: Mil; split?: Split }, when: 'now' | 'next', today: ISODate): Partial<Profile>`: the profile patch every settings sheet writes. `now` → main columns plus `next_*` null. `next` → `next_*` carrying the other half from the current or pending plan, and `next_from` = start of the next period.
- `paydayPatch(profile, payday, today): Partial<Profile>`: moves `next_from` to the new next period start when a change is pending.
- `foldPlan`: when `pendingPlan(p)` exists and today's period start is on or after `from`, it writes the main columns = next values and nulls `next_*`. Running it twice writes nothing the second time.

**Tests:** Review Focus 1 and 2. `planFor` before, on and after `next_from`. A payday deposit for a period after `next_from` uses the next split. A salary-only "next" keeps the pending split, and the reverse.

- [ ] TDD the pure functions → wire them in → check green
- [ ] `npm run build:notify`, then redeploy `notify-run` to `stouchi-test` after approval (command in the Phase 4 plan); a manual run answers 200
- [ ] Commit `Refonte : plan en attente — planFor dans les chiffres et la paie`

### Task 3: Goal figures

**Files:**

- Create: `src/shared/goal.ts`
- Test: `tests/unit/goal.test.ts`

**Interfaces (produced):**

- `goalView(goal: Goal, moves: SavingsMove[], monthly: Mil, today: ISODate): { saved: Mil; pct: number /* 0–100 int */; reached: boolean; eta: ISODate | null; deposits: SavingsMove[] /* newest first */; depositsTotal: Mil }`
- `sooner(goal, saved, monthly, extraMil, today): { eta: ISODate; months: number } | null`: null when reached or when the extra gains nothing.
- `monthly` comes from `planFor(profile, currentPeriod)` savings.

**Tests:** Review Focus 3. Nothing saved; exactly reached; over target; monthly 0 (ETA null, "et si" still shows the extra's own ETA); deposits and withdrawals summed with their signs; moves of an archived goal ignored.

- [ ] TDD → check green → commit `Refonte : objectif — calculs`

### Task 4: Objectif screen

**Files:**

- Modify: `src/features/goal/GoalScreen.tsx` (replaces the placeholder)
- Create: `src/features/goal/goal.css`, `src/features/goal/DepositRow.tsx`
- Modify: `src/shared/i18n/fr.json` (drop `goal.soon.*`, add `goal.*`)
- Test: `tests/unit/goal/GoalScreen.test.tsx`

**Behaviour:** port `#s-goal`. It has a dark card (icon and name, % chip, saved, "sur X TND", bar, "Au rythme de X / mois", ETA), an "Et si tu mettais plus chaque mois ?" card with +50/+100/+200 chips (none selected at first; picking one shows "<date> — N mois plus tôt"), and Versements (count · total, the 6 newest, icon `coins` for payday and `hand-coins` otherwise, withdrawals in warn colour). The empty deposits row reads "Ton premier versement arrive le <date>, avec ta paie." States:

- **No active goal** (backfilled or archived): an EmptyState with a "Choisir un objectif" button, which opens Task 5's goal sheet.
- **Reached:** a "Atteint, mabrouk" chip; "et si" is hidden; a "Nouvel objectif" button.
- **Amounts hidden:** follows `hideAmounts`, as Budget does.

**Tests:** renders the saved/target/pct from fixtures; the +100 chip shows the months-sooner line; the reached and no-goal states; hidden amounts.

- [ ] TDD → compare with the prototype at `#app` (Objectif tab) at 390 px → commit `Refonte : écran Objectif`

### Task 5: Verser and goal edit sheets

**Files:**

- Create: `src/features/goal/DepositSheet.tsx`, `src/features/goal/GoalSheet.tsx`
- Modify: `src/features/onboarding/draft.ts`: export `GOAL_PRESETS`, `goalTarget` and `goalLabel` unchanged, for reuse
- Test: `tests/unit/goal/DepositSheet.test.tsx`, `tests/unit/goal/GoalSheet.test.tsx`

**Behaviour:**

- **Verser:** the amount input with 50/100/200/500 quick chips. The Aam Salah tip is "Tu passes à X / Y TND, N mois plus tôt : <date>", or "atteint. Mabrouk !". The Verser button is disabled at 0. Saving writes a `savings_moves` row (D4); the toast "X TND versés" undoes it by deleting the move.
- **Goal sheet:** opened by tapping the goal card, or from the no-goal and reached states. Edit mode offers the type chips, a name (1–40) and a target (> 0), and saves with `update` on `goals`. New mode archives the current goal (`archived_at = now`) and inserts the new one; its moves stay with the old goal. It ports `StepGoal`'s fields, without "déjà épargné" in edit mode.

**Tests:** a deposit writes the right row (sign, kind, from_pot null, today's Tunis date); undo removes it; editing the target updates the row; a new goal archives the old one, and `activeGoal` picks the new one; an empty name is refused inline.

- [ ] TDD → check green → commit `Refonte : objectif — verser et modifier`

---

## Session B — Moi and the plan settings

### Task 6: Moi screen and profile

**Files:**

- Modify: `src/features/me/MeScreen.tsx`, `src/features/me/me.css`
- Create: `src/features/me/SettingRow.tsx` (`srow` / `trow` ports), `src/features/me/ProfileSheet.tsx`
- Modify: `src/app/router.ts`: `#/me/split|bills|notifications` → `{ name: 'me', params: { sub } }`, round-trip in `routePath`
- Test: `tests/unit/me/me.test.tsx` (extend), `tests/unit/app/router.test.ts`

**Behaviour:** port `renderMe`, keeping only the in-scope rows (D5). It has:

- **A profile card:** initials, first name and e-mail. It opens the profile sheet, which edits the first name (1–40) and shows the e-mail read-only.
- **Stats:** months tracked (pay periods since `onboarded_at`), TND saved (the active goal's `saved`) and expenses noted (live expenses in the mirror).
- **Mon plan:** Salaire, Répartition, Factures fixes and Jour de paie. A pending change shows as its sub-line: "Passe à X TND le <date>".
- **Aam Salah:** Notifications et rappels.
- **Confidentialité:** Masquer les montants (the `hideAmounts` switch) and Exporter.
- **At the bottom:** Se déconnecter (existing behaviour kept) and "Supprimer mon compte" in the footer.

**Tests:** the rows' values come from the store; the pending sub-line; the hide switch toggles the signal; the router parses and prints the three subs and sends an unknown sub to Budget.

- [ ] TDD → commit `Refonte : écran Moi et profil`

### Task 7: Salary and payday sheets

**Files:**

- Create: `src/features/me/SalarySheet.tsx`, `src/features/me/PaydaySheet.tsx`
- Test: `tests/unit/me/SalarySheet.test.tsx`, `tests/unit/me/PaydaySheet.test.tsx`

**Behaviour:**

- **Salary:** the amount (≥ 100 TND, or the inline error), a split preview with counting deltas, and "Dès ce mois / Au <next payday>" (default: dès ce mois). The warn tip shows when bills exceed 80 % of the new Besoins. Save writes `nextPlanPatch`; the toast "Salaire : X TND" undoes a "now" change by restoring the previous values.
- **Payday:** the 1er, 5, 10, 15, 20, 25, 28 and fin du mois days, with a hint showing the next payday date. Save writes `paydayPatch`; the change is immediate.

**Tests:** below 100 is refused; "next" writes only `next_*`; "now" clears a pending change; payday saves 0 for "fin du mois"; a payday change moves `next_from`.

- [ ] TDD → commit `Refonte : Moi — salaire et jour de paie`

### Task 8: Répartition screen

**Files:**

- Create: `src/features/me/SplitScreen.tsx`, `src/features/me/SplitEditor.tsx`, `src/shared/split.ts` (`moveHandle` as a pure function)
- Test: `tests/unit/splitEditor.test.ts`, `tests/unit/me/SplitScreen.test.tsx`

**Behaviour:** port `renderSplit`. It has:

- **The editor:** two drag handles in steps of 5 %, each pot kept at ≥ 5 %, preset chips (50/30/20, 60/20/20, 70/20/10) and amounts per pot.
- **Timing:** "Dès ce mois / Au <date>".
- **Leaving:** Enregistrer appears once something has changed. Back with an unsaved change opens the discard sheet (Appliquer / Ne pas garder).
- **Saving:** writes `nextPlanPatch({ split })`, with an undo toast for "now".

**Tests:** `moveHandle` clamps (a handle cannot pass the other or leave a pot under 5 %); the arrow keys move ±5 and update `aria-valuenow`; a preset sets the values; the discard sheet shows only when something changed.

- [ ] TDD → compare with the prototype → commit `Refonte : Moi — répartition`

### Task 9: Factures fixes screen

**Files:**

- Create: `src/features/me/BillsScreen.tsx`, `src/features/me/BillSheet.tsx`
- Test: `tests/unit/me/BillsScreen.test.tsx`

**Behaviour:** port `renderBills`. It has:

- **Header meter:** "X TND réservés sur Y de Besoins": amber above 80 %, with an explanation above 100 % (same rule as `StepBills`).
- **The list:** active bills with a "+ Ajouter" button.
- **The bill sheet:** label (1–60), amount, frequency, day (1–31), and suggestion chips from `StepBills`' presets for a new bill.
- **Deletion:** there is no delete policy, so "Supprimer la facture" sets `active = false`. It is a two-tap arm (3 s), with an undo toast. A bill already paid this period keeps its expense.

**Tests:** add, edit and deactivate write the right rows; the meter colours at 80 % and 100 %; a deactivated bill leaves "À venir" (via facts).

- [ ] TDD → commit `Refonte : Moi — factures fixes`

---

## Session C — notifications, export, deletion, E2E

### Task 10: Notifications et rappels screen

**Files:**

- Create: `src/features/me/NotifSettings.tsx`
- Modify: `src/features/notifications/PushCard.tsx` if its subscribe/unsubscribe logic needs extracting (reuse `src/data/push.ts`; do not duplicate it)
- Test: `tests/unit/me/NotifSettings.test.tsx`

**Behaviour:** port `renderNotifSet`. It has:

- **A push switch:** on means subscribed. Where push is unsupported, it is disabled with the reason. It is not gated on the first week: here the user asks for it.
- **Upcoming reminders:** text and date. Deleting one is a soft delete (`deleted_at`) with an undo toast.

**Tests:** the switch reflects the subscription and calls subscribe/unsubscribe; deleting a reminder writes `deleted_at`, and undo clears it; done or deleted reminders are hidden.

- [ ] TDD → commit `Refonte : Moi — notifications et rappels`

### Task 11: Export

**Files:**

- Create: `src/shared/exportCsv.ts` (pure), `src/data/exportRows.ts` (fetch with the caller's JWT, paged), `src/features/me/ExportSheet.tsx`
- Test: `tests/unit/exportCsv.test.ts`, `tests/unit/me/ExportSheet.test.tsx`

**Interfaces:** `toCsv(input: { expenses; incomes; savingsMoves; bills; debts; goals }, range: { from: ISODate | null; to: ISODate }): string`, with columns `Date;Type;Pot;Catégorie;Libellé;Montant (TND)`. Bills and debts follow in their own sections.

**Behaviour:** D3. The period chips show a summary ("N lignes · X TND"); Exporter downloads `stouchi-<from>-<to>.csv`. Offline, the button is disabled with "Connecte-toi pour exporter". A fetch error shows as an inline error, and nothing is downloaded. Deleted rows are left out.

**Tests:** Review Focus 4. The BOM and `;`; `12,500` for 12 500 millimes; negative moves; range edges in Tunis dates; the empty range still gives a header row; deleted rows are left out.

- [ ] TDD → commit `Refonte : Moi — export CSV`

### Task 12: Delete account

**Files:**

- Create: `src/features/me/DeleteSheet.tsx`, `src/features/me/HoldButton.tsx`
- Modify: `src/data/app.ts`: `deleteAccount()` calls the RPC, then unsubscribes push, wipes IndexedDB and signs out locally
- Test: `tests/unit/me/DeleteSheet.test.tsx`, `tests/unit/data/deleteAccount.test.ts`

**Behaviour:** port the prototype's `delete` sheet. It lists what goes (expenses since <first month>, the goal and X TND of savings history, the Aam Salah conversations), offers "D'abord exporter mes données" (which opens Task 11's sheet), and has a "Maintenir pour supprimer" button that must be held 2 s. With pending writes, the sheet first warns (reuses `me.signOut.pending`'s pattern). If the RPC fails, the error is shown and nothing local is wiped. On success, the app goes to Intro.

**Tests:** Review Focus 5. A hold shorter than 2 s does nothing; a hold with Space works; the wipe order (RPC first); an RPC error keeps the data.

- [ ] TDD → run on `stouchi-test` with a throwaway account (user) → commit `Refonte : Moi — supprimer le compte`

### Task 13: E2E and handover

**Files:**

- Create: `tests/e2e/goal.spec.ts`, `tests/e2e/me.spec.ts`
- Modify: this plan (outcome section), `CLAUDE.md` status line

**Scenarios (iPhone 13 and Pixel 7):**

- Verser 100 → the card and list update → undo.
- Edit the target below saved → reached state.
- Salary "au prochain paie" → the Budget figures are unchanged, and Moi shows the pending line.
- Split "dès ce mois" → the Budget pots change.
- Add a bill → it appears in À venir → deactivate it.
- Hide amounts → the goal card is masked.
- Export → a download event with a `.csv` name.
- Deletion is covered only up to the hold sheet (never run it on the shared test user).

- [ ] `npm run check` and `npm run e2e` green → compare each new screen with the prototype at 390 px → update this plan and `CLAUDE.md` → commit `Refonte : phase 5 — E2E et bilan`

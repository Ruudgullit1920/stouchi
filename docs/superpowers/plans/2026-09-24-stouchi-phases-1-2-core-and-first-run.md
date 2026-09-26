# Stouchi Rebuild — Phases 1 + 2: Core budget and First run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is **lean by design**: it gives files, behaviour, interfaces and test cases, not code. Port markup and styles from `prototype/index.html`; do not redesign.

**Goal:** A signed-in user can see what they can still spend, log, edit, delete (with undo) and find expenses, including offline. A new user can go through intro → login → 5-question setup → reveal, and each payday opens a new period on its own.

**Architecture:** The app is local-first. Every row the screens show lives in an IndexedDB mirror exposed as Preact signals. Writes land in that mirror and in an outbox at the same moment, and a sync loop pushes the outbox and pulls changes since a cursor. All derived figures come from pure modules in `src/shared/` (`facts.ts`, `bills.ts`, `ledger.ts`, `search.ts`, `payday.ts`), which Phase 3's carnet will reuse. Routing is a small hash router with a gate: no session → intro/login, not onboarded → setup, otherwise the tabs.

**Tech Stack:** Phase 0's stack, plus `@preact/signals` (state), `idb` (IndexedDB wrapper) and `fake-indexeddb` (dev, for unit tests). No router library and no service worker in this plan (the service worker comes in Phase 4 with push).

**Spec:** `docs/superpowers/specs/2026-09-23-stouchi-redesign-design.md`: §3 IA, §4.1–4.4 and §4.6 flows, §5 design, §7 data, §8.3 reliability, §8.6 gates. The prototype wins on looks, the spec wins on behaviour.

---

## Session split

Run it as **two sessions** (one phase each). Session A covers Tasks 1–10 (Phase 1). Session B covers Tasks 11–16 (Phase 2). Run `npm run check` before every commit and `npm run e2e` at the end of each session. Commit messages are in French, in the history's style (`Refonte : …`).

## Things only the user can do

1. **Confirm the E2E target.** The E2E tests sign in as the Phase 0 test account (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD`) and write rows to the **new tables on the production project**; the live app never reads those tables. The alternative is a separate free Supabase project for tests. Decide before Task 10.
2. **Enable Google sign-in** in the Supabase dashboard (Auth → Providers). Add `http://localhost:5173` and the Vercel preview domain to the redirect URLs (Task 12).
3. **Say whether e-mail confirmation stays on** for sign-up (Task 12 handles both cases).

## Global Constraints

- Money is integer millimes via `src/shared/money.ts`, never floats. Cap `MAX_MIL` = 1 000 000 000.
- Dates are `YYYY-MM-DD` in Africa/Tunis, via `src/shared/dates.ts`. All figures use the **pay period** (payday 1–28, or 0 = last day), labelled by the month it mostly covers.
- The split defaults to 50/30/20 and always sums to 100. "Reste à dépenser" = what is left in Besoins + Envies. **Bills are reserved inside Besoins.**
- Every UI string goes in `src/shared/i18n/fr.json`. French, "tu", Lucide icons only, no emoji in chrome.
- Every screen has designed loading (skeleton), empty and error states. No spinner over 300 ms without a skeleton.
- WCAG 2.1 AA (§5.6): targets ≥ 44 px, labelled icon buttons, `aria-selected`/`aria-pressed`/`aria-checked`, sheets trap and return focus, live region for toasts. All §5.5 motion goes off under `prefers-reduced-motion`, and motion never blocks input.
- Components stay one per file and under ~300 lines. No feature imports another feature's internals; shared pieces go in `src/design/components` or `src/shared`.
- Coverage stays ≥ 90 % on `src/shared`.
- Onboarding and login are lazy-loaded chunks. First-load JS stays ≤ 150 kB gzipped; check the `npm run build` output at the end of each session.

## Decisions this plan makes (the spec leaves them open)

- **Debts** appear in À venir but **do not** reduce "Reste". **Unpaid bills due in the period** do reduce Besoins.
- A bill counts as **paid** for a period only if its `bill_payments` row points to an expense that is **not** deleted. Its expense then counts as spent, so nothing is counted twice.
- **Overspending:** a pot's `left` can go negative, and the screen shows "dépassé de …". Total `left` can go negative too, and `perDay` is then 0.
- **The 08:00 rule** decides only when the payday deposit is written. Figures switch periods on the date (as `dates.ts` already does).
- The **payday deposit** is a `savings_moves` row, `kind = 'payday'`, with a **deterministic id**: uuidv5 of `payday:<user_id>:<period_start>`. It is written once for each period that started after `onboarded_at`, and the Phase 4 cron will use the same id, so both converge. It is inserted with `ON CONFLICT DO NOTHING` (the table has no update grant). The first period after onboarding gets no payday deposit; "déjà épargné" covers it.
- **Salary or split changes mid-period** ("appliquer maintenant") are Phase 5. Until then, figures always use the current profile.
- **Bills entered in setup** are monthly. Their `day` = payday, or 31 when payday is 0 (clamped to the month's end).
- **Setup resume:** a local draft (step and answers, plus ids generated once for bills and goal) is saved after every step, and every step also upserts its rows. `onboarded_at` is set when the reveal is shown.
- **In Phase 1, + opens the keypad directly.** The two-choice bubble arrives with chat in Phase 3. The bell is hidden until Phase 4. Objectif shows an empty state until Phase 5. Moi shows only the first name and "Se déconnecter" until Phase 5.
- **Historique's Aam Salah line** is a deterministic template built from facts (biggest category and its change from the previous period), stored in `fr.json`. Phase 3 may replace it.

## Review Focus

1. **Deleting a bill-paid expense** puts the bill's reservation back. The bill does not stay "paid" with nothing spent. (Test in Task 1.)
2. **Offline create → edit → delete of the same expense** before reconnecting leaves exactly one server row, soft-deleted. Pending rows survive a reload while still offline. (Tests in Task 3.)
3. **A different user signs in** on a device holding a previous user's unsynced writes. Those writes are never pushed under the new session and are never discarded silently. (Tests in Tasks 3 and 12.)
4. **Search input variety:** "cafe" finds "Café", "12,5", "12.500" and "12" each find a 12 000-millime expense exactly, and whitespace-only input returns nothing. (Tests in Task 2.)
5. **Payday edges:** payday 0 in February (leap and non-leap years); 07:59 versus 08:00 on payday; an app not opened for three paydays gets exactly one deposit per period, and running it twice adds nothing. (Tests in Task 11.)

---

# Session A — Phase 1: Core budget

### Task 1: Budget maths (`facts.ts`, `bills.ts`)

**Files:** create `src/shared/facts.ts`, `src/shared/bills.ts`. Test: `tests/unit/facts.test.ts`, `tests/unit/bills.test.ts`.

**Interfaces (produces):**
- `billDueDates(bill: Bill, period: PayPeriod): ISODate[]`. Monthly bills fall due each month on `day` (clamped to the month's end). Bimonthly, quarterly and yearly bills step from `starts_on`. Inactive bills, and bills before `starts_on`, return nothing.
- `computeFacts(input: FactsInput): Facts`, where `FactsInput = { profile: Profile; expenses: Expense[]; bills: Bill[]; billPayments: BillPayment[]; debts: Debt[]; today: ISODate }`.
- `Facts` holds:
  - `period` and `daysLeft`;
  - `salary`;
  - `pots.needs` and `pots.wants`, each `{ budget, spent, reserved, left, ratio, warn }`, where `warn` is true when ratio ≥ 0.8 (`reserved` is always 0 for `wants`);
  - `pots.savings.budget`;
  - `left` and `perDay`;
  - `upcoming` (unpaid bills plus unsettled debts due in the period, date-sorted);
  - `recent` (5 newest).
- Add a `BillPayment` zod schema and type to `src/shared/schemas.ts`.

**Behaviour:** Deleted expenses are ignored. `spent` counts only expenses whose `spent_on` falls in the period. `perDay = max(0, floor(left / daysLeft))`.

**Tests:**
- [ ] Budgets come from `splitSalary` and a custom split.
- [ ] A deleted expense is ignored.
- [ ] An expense on the period's first day and last day counts; the day before and the day after do not.
- [ ] An unpaid bill reduces Besoins `left`.
- [ ] A paid bill is not reserved, and its expense counts once.
- [ ] **Review Focus 1:** a paid bill whose expense is deleted is reserved again.
- [ ] Overspent pot gives negative `left`, and `perDay` is 0.
- [ ] `warn` is true at 80 %.
- [ ] Debts appear in `upcoming` but do not change `left`.
- [ ] Bill frequencies step correctly across a year boundary, `day` 31 clamps in February, and a bill before `starts_on` yields nothing.

- [ ] Commit: `Refonte : facts.ts — reste, pots, réservé des factures, à venir`

### Task 2: Ledger, history and search (`ledger.ts`, `search.ts`)

**Files:** create `src/shared/ledger.ts`, `src/shared/search.ts`. Test: `tests/unit/ledger.test.ts`, `tests/unit/search.test.ts`.

**Interfaces (produces):**
- `potBreakdown(expenses, pot, period): { total: Mil; categories: { key: CategoryKey; total: Mil; tint: 100|70|48|30|18 }[] }`. Categories are sorted by total, and those beyond 5 fold into the lowest tint.
- `groupByDay(expenses): { date: ISODate; items: Expense[]; total: Mil }[]`, newest first.
- `periodTotals(expenses, periods: PayPeriod[]): { period: PayPeriod; needs: Mil; wants: Mil }[]`, used by the 12-bar chart.
- `historyLine(facts: Facts, prev: PeriodTotals): { key: StringKey; vars } | null`, used by Historique's one-liner.
- `searchExpenses(expenses, query, periods): { period: PayPeriod; count; total; items: { expense; ranges: [start, end][] }[] }[]`.

**Search behaviour:** The query matches `label`, the category label and the pot label, case-insensitive and **accent-insensitive**. It also matches the exact amount when `parseTnd(query)` succeeds. Only the given periods are searched (the last 12). Newest period comes first.

**Tests:**
- [ ] Tints are assigned in order.
- [ ] `groupByDay` ordering and per-day totals are correct.
- [ ] Totals are split per period and per pot.
- [ ] **Review Focus 4:** accent-insensitive matching, amount formats, whitespace-only query, match ranges correct on accented text.
- [ ] Nothing older than 12 periods is returned.

- [ ] Commit: `Refonte : ledger.ts et search.ts — ventilation, jours, recherche sur 12 périodes`

### Task 3: Local store, outbox and sync (`src/data/`) — *careful review*

**Files:** create:
- `src/data/supabase.ts` (client from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`);
- `src/data/localdb.ts` (idb: one store per table plus `outbox` and `meta`);
- `src/data/remote.ts` (`Remote` interface plus its Supabase implementation);
- `src/data/outbox.ts`;
- `src/data/sync.ts`;
- `src/data/store.ts` (signals);
- `src/data/expenses.ts` (repository).

Test: `tests/unit/data/outbox.test.ts`, `tests/unit/data/sync.test.ts`, `tests/unit/data/expenses.test.ts` (with fake-indexeddb and an in-memory `Remote`). Add a case to `tests/db/rls.test.ts` asserting that the owner can set `deleted_at` back to null (undo).

**Interfaces (produces):**
- `Remote`:
  - `upsert(table, rows, mode: 'merge' | 'ignore')`;
  - `pullSince(table, cursor: string | null): { rows; cursor }`.
- `store`: signals `profile`, `expenses`, `bills`, `billPayments`, `debts`, `goals`, `savingsMoves`, and `sync` (`{ online; pending; failed: OutboxEntry[]; authLost }`).
- `expensesRepo`:
  - `create(e: NewExpense)`;
  - `update(id, patch)`;
  - `remove(id)` (sets `deleted_at`);
  - `restore(id)`.
  Each writes the mirror and the outbox together, in one IndexedDB transaction.
- `writeRow(table, row, mode)` does the same for any other table. Setup (Task 14) and payday (Task 11) use it for `profiles` (conflict key `user_id`), `bills`, `goals` and `savings_moves`.
- `outbox`:
  - `enqueue(userId, table, row, mode)`;
  - `flush(remote, userId)`;
  - `retry(entryId)`;
  - `discard(entryId)`.

**Behaviour:**
- Entries for the same `(table, id)` coalesce into the latest full row.
- `flush` pushes only entries with the **current user's** `userId`.
- Network and 5xx errors cause an exponential-backoff retry (1 s, doubling, capped at 60 s).
- A check or validation error (Postgres class 22/23) marks the entry `failed` and keeps it.
- A 401 sets `authLost` and pauses flushing without dropping anything.
- `sync.start()` flushes and pulls on load, on `online`, on window focus and every 60 s. The pull cursor is `max(updated_at)` per table, saved in `meta`, and the pull keeps the last 12 periods.
- Pulled rows replace the local rows (last write wins; the server's `updated_at` is the truth).
- Expenses use `merge`; `savings_moves` and `bill_payments` use `ignore`.

**Tests:**
- [ ] **Review Focus 2:** create → update → delete offline gives one pushed row with `deleted_at` set.
- [ ] Pending rows are still in the mirror after reopening the database.
- [ ] Backoff timing (fake timers).
- [ ] A validation error is kept as failed; retry and discard both work.
- [ ] 401 pauses without loss.
- [ ] **Review Focus 3:** entries of user A are not flushed while B is signed in, and are still present.
- [ ] Pull applies a remote edit and a remote soft delete.
- [ ] The cursor advances.

- [ ] Commit: `Refonte : magasin local, outbox et synchro — écritures optimistes, idempotentes, jamais perdues`

### Task 4: App shell

**Files:**
- Create: `src/app/router.ts`, `src/app/Shell.tsx`, `src/app/TabBar.tsx`, `src/app/SheetHost.tsx`, `src/app/ToastHost.tsx`, `src/app/OfflineBadge.tsx`, `src/app/shell.css`, `src/features/goal/GoalScreen.tsx` (empty state), `src/features/me/MeScreen.tsx` (first name and sign-out).
- Modify: `src/app/App.tsx`. The gallery moves to `#/gallery`; update `tests/e2e/design.spec.ts` to match.
- Test: `tests/unit/app/router.test.ts`, `tests/unit/app/shell.test.tsx`.

**Interfaces (produces):**
- Router:
  - `route` signal: `{ name: 'budget'|'pot'|'history'|'goal'|'me'|'intro'|'login'|'setup'|'reveal'|'gallery'; params }`;
  - `navigate(path)`;
  - `back()`.
- Sheets: `openSheet(node)` and `closeSheet()`.
- Toasts: `toast({ text, action?: { label, run }, ms? })`.

**Behaviour:**
- Floating tab bar: Budget, Historique, raised +, Objectif, Moi.
- The pot ledger is a push screen at `#/pot/needs` or `#/pot/wants`.
- Screen-enter motion follows §5.5.
- The offline badge shows while `sync.online` is false. A failed-writes toast offers "Réessayer / Supprimer".

**Tests:**
- [ ] Path parse and serialise; unknown path → budget.
- [ ] Tab bar exposes `aria-selected`.
- [ ] Sheet traps and returns focus.
- [ ] Toast is announced in a live region.
- [ ] Failed entry shows the retry toast.

- [ ] Commit: `Refonte : coque de l'app — routeur, barre d'onglets, feuilles, toasts, badge hors ligne`

### Task 5: Budget screen

**Files:** create `src/features/budget/BudgetScreen.tsx`, plus sub-components as needed (`PotCard.tsx`, `UpcomingList.tsx`, `budget.css`), porting `#s-budget`. Test: `tests/unit/budget/budget.test.tsx`.

**Behaviour:**
- Period pill; "Reste à dépenser" with per-day and days-left figures; a segmented bar (Besoins spent, Envies spent, reserved bills, left).
- Salary line; three pot cards that tap through to the ledger (Épargne goes to Objectif).
- À venir and Récent, where "Tout voir" goes to Historique and tapping a row opens the detail sheet (Task 8).
- The eye toggle hides amounts and is remembered in localStorage.
- Numbers roll to their new values after a write.

**Tests:**
- [ ] Skeleton before the first load; empty state with no expenses; error state when the load fails.
- [ ] Figures match `computeFacts` for a fixture.
- [ ] Overspent pot shows "dépassé de".
- [ ] Eye toggle exposes `aria-pressed`.
- [ ] Pot names are shown next to their colours.

- [ ] Commit: `Refonte : écran Budget`

### Task 6: Pot ledger

**Files:** create `src/features/pot/PotScreen.tsx`, plus sub-components, porting `#s-pot`. Create `src/design/components/MonthSwitcher.tsx`. Test: `tests/unit/pot/pot.test.tsx`.

**Behaviour:**
- Month switcher across the last 12 pay periods (no future periods).
- Category pills filter the list.
- Summary card with a tinted segmented bar and legend.
- "il te reste … · …/jour" only for the current period.
- The list is grouped by day with day headers (§5.4).
- The search button filters within the pot.

**Tests:**
- [ ] Prev/next stop at the limits.
- [ ] A pill filter narrows the list and the pill exposes `aria-pressed`.
- [ ] Past periods hide the per-day line.
- [ ] Empty period shows the empty state.

- [ ] Commit: `Refonte : écran enveloppe (ledger du pot)`

### Task 7: Manual add (keypad sheet)

**Files:** create `src/features/add/AddSheet.tsx` and `src/features/add/Keypad.tsx`. Test: `tests/unit/add/add.test.tsx`.

**Behaviour:**
- Keypad input goes through `parseTnd`, one decimal separator, up to 3 decimals, capped at `MAX_MIL`.
- A Besoins/Envies switch shows what is left in each pot, followed by that pot's category icons.
- Date defaults to today; it cannot be in the future or older than 12 periods.
- Optional note, up to 60 characters.
- Enregistrer validates with `ExpenseInsert`, calls `expensesRepo.create`, closes the sheet and shows a toast.
- The expense id is generated when the sheet opens, so a double tap creates one expense.

**Tests:**
- [ ] Keypad edge cases: leading zero, second comma, backspace, cap.
- [ ] Enregistrer is disabled at 0.
- [ ] A double submit creates one row.
- [ ] Switching pot resets the category to that pot's first one.
- [ ] Future date is refused.

- [ ] Commit: `Refonte : saisie manuelle au clavier`

### Task 8: Detail sheet — edit, delete, undo

**Files:** create `src/features/add/ExpenseDetailSheet.tsx` (it reuses the Keypad). Test: `tests/unit/add/detail.test.tsx`.

**Behaviour:**
- The sheet edits amount, category (the pot follows the category), date and note.
- Supprimer asks for confirmation, then calls `remove`. The toast offers "Annuler" for 6 s, which calls `restore`.
- The sheet opens from any ledger, Historique or Récent row.

**Tests:**
- [ ] An edit updates the row.
- [ ] Delete → the row is gone → Annuler within 6 s restores it; after 6 s the toast is gone.
- [ ] Confirmation is focus-trapped.

- [ ] Commit: `Refonte : détail d'une dépense — modifier, supprimer, annuler`

### Task 9: Historique

**Files:** create `src/features/history/HistoryScreen.tsx`, `src/design/components/MonthBars.tsx` and `src/design/components/SearchField.tsx`, porting `#s-history`. Test: `tests/unit/history/history.test.tsx`.

**Behaviour:**
- Search field; quick chips on focus (top categories, "Besoins", "Envies").
- Search results are grouped by month with count and total; matched text is highlighted with `<mark>` (never raw HTML).
- The 12-bar chart doubles as the month picker. It is keyboard-operable (arrow keys, Home/End, `aria-selected`).
- Pot mini-cards; the Aam Salah line; category chips that filter on tap; the ledger list.

**Tests:**
- [ ] Typing shows grouped results with highlights.
- [ ] Clearing the query restores browse mode.
- [ ] Arrow keys move the selected month.
- [ ] A category chip filters the list.
- [ ] Empty search shows the empty state.

- [ ] Commit: `Refonte : Historique — parcours par mois et recherche`

### Task 10: Phase 1 E2E

**Files:** create `tests/e2e/auth.setup.ts` (signs the test account in with supabase-js and saves the session as Playwright `storageState`), `tests/e2e/helpers.ts` (tags labels with a per-run `e2e-<id>` and soft-deletes tagged rows in teardown) and `tests/e2e/core.spec.ts`. Modify `playwright.config.ts` to add the setup project.

**Tests** (iPhone 13 and Pixel 7, axe on every screen visited):
- [ ] Manual log: Budget's Reste drops by the amount.
- [ ] Edit an expense.
- [ ] Delete, then undo.
- [ ] Search finds the logged expense.
- [ ] Month switch in the pot ledger and in Historique.
- [ ] Offline log (`context.setOffline(true)`) shows immediately with the badge; going back online syncs it, and a page reload shows it from the server.

- [ ] Run `npm run check`, `npm run e2e` and `npm run build` (check the JS size).
- [ ] Commit: `Refonte : E2E phase 1 — saisie, modification, suppression, recherche, hors ligne`

---

# Session B — Phase 2: First run

### Task 11: Payday logic (`payday.ts`) — *careful review*

**Files:**
- Create: `src/shared/payday.ts` and `src/data/payday.ts` (runs it on start and focus).
- Move: `scripts/backfill/uuid5.ts` → `src/shared/uuid5.ts`, updating the backfill imports.
- Test: `tests/unit/payday.test.ts`.

**Interfaces (produces):**
- `paydayOpensAt(period): string`, the instant 08:00 Africa/Tunis on `period.start`.
- `dueDeposits({ profile, goal, moves, now }): NewSavingsMove[]`. It returns one `payday` move per period that started after `onboarded_at` and opened at or before `now`, has no move yet, and has an active goal. The amount is the savings share of the salary. The id is deterministic (see Decisions). At most 12 are returned.
- `goalEta(target, saved, monthly, today): ISODate | null` (null when `monthly` is 0).

**Tests** (**Review Focus 5**):
- [ ] 07:59 versus 08:00 on payday.
- [ ] Payday 0 in February, leap and non-leap.
- [ ] Payday 28.
- [ ] Three missed paydays give three moves; running again gives none.
- [ ] No goal gives none.
- [ ] Onboarding mid-period gives no deposit for that period.
- [ ] The ids match uuidv5 fixtures.
- [ ] `goalEta` handles already-reached and zero cases.

- [ ] Commit: `Refonte : logique du jour de paie — versement d'épargne idempotent à 08:00`

### Task 12: Auth and Login

**Files:** create `src/data/auth.ts`, `src/features/onboarding/LoginScreen.tsx` (porting `#f-login`) and `src/app/gate.ts`. Test: `tests/unit/onboarding/login.test.tsx`, `tests/unit/app/gate.test.ts`.

**Interfaces (produces):**
- `auth`:
  - `session` signal;
  - `signIn(email, pw)`;
  - `signUp(email, pw)`;
  - `signInWithGoogle()`;
  - `signOut()`.
- Supabase errors map to `fr.json` keys.
- `gate(session, profile, introSeen) → 'intro' | 'login' | 'setup' | 'reveal' | 'app'`.

**Behaviour:**
- Inline validation: red underline, shake, one-line reason.
- "Créer un compte" uses the same screen. If e-mail confirmation is required, show "Vérifie ta boîte mail". Google pre-fills the first name.
- `signOut` with pending writes asks for confirmation first.
- When the session is lost (`authLost`), the app shows Login and keeps the outbox. Once the same user is back, it flushes.

**Tests:**
- [ ] Invalid e-mail and short password messages.
- [ ] Error mapping.
- [ ] The gate's truth table.
- [ ] **Review Focus 3:** sign-in as another user leaves A's entries untouched and unflushed.
- [ ] Sign-out warns when writes are pending.

- [ ] Commit: `Refonte : connexion — e-mail, Google, session perdue sans perte d'écritures`

### Task 13: Intro

**Files:** create `src/features/onboarding/IntroScreen.tsx` (porting `#f-intro`). Test: `tests/unit/onboarding/intro.test.tsx`.

**Behaviour:** Three slides (split, three-second logging, goal), with swipe, the arrow button and dots. "Passer" skips. The `introSeen` flag is kept in localStorage.

**Tests:**
- [ ] Arrow and dots advance, and the dots expose `aria-selected`.
- [ ] Passer goes to Login.
- [ ] Reduced motion disables the slide animation.

- [ ] Commit: `Refonte : intro en trois écrans`

### Task 14: Setup — 5 questions

**Files:** create `src/features/onboarding/SetupScreen.tsx`, one step component per question (`StepName`, `StepSalary`, `StepPayday`, `StepBills`, `StepGoal`) and `src/features/onboarding/draft.ts`, porting `#f-setup`. Test: `tests/unit/onboarding/setup.test.tsx`, `tests/unit/onboarding/draft.test.ts`.

**Behaviour:**
- One question per screen, with a progress bar and back. Aam Salah asks each one.
- **Salary:** live 50/30/20 preview.
- **Payday:** the day grid 1er, 5, 10, 15, 20, 25, 28, fin du mois.
- **Bills:** toggle cards with an editable amount, and a "réservé dans Besoins" meter that turns amber above 80 % and explains itself above 100 %. It can be skipped.
- **Goal:** six types with prefilled targets (Sécurité = 3 × salary), "déjà épargné", and a live target date via `goalEta`.
- After every step, the draft is saved and that step's rows are upserted with stable ids (profile; bills; goal plus an opening `deposit` move when "déjà épargné" > 0). Reopening the app resumes at the saved step.

**Tests:**
- [ ] Each step validates its input.
- [ ] Back keeps answers.
- [ ] Meter thresholds at 80 % and 100 %.
- [ ] Sécurité prefill.
- [ ] Resume after remount.
- [ ] Repeating a step does not duplicate the bill or goal rows (same ids).
- [ ] Skipping bills writes none.

- [ ] Commit: `Refonte : configuration en cinq questions, reprise possible`

### Task 15: Reveal

**Files:** create `src/features/onboarding/RevealScreen.tsx` (porting `#f-reveal`). Test: `tests/unit/onboarding/reveal.test.tsx`.

**Behaviour:**
- On mount, set `onboarded_at`.
- The salary coin shows, the three pots drop in with counting amounts, and confetti plays once.
- "Ouvrir mon budget" is usable at once and goes to Budget.
- Under reduced motion there are no drops, counts or confetti.

**Tests:**
- [ ] `onboarded_at` is written once.
- [ ] Pot amounts match `splitSalary`.
- [ ] The button works before the animations end.
- [ ] Reduced-motion path.

- [ ] Commit: `Refonte : révélation des trois pots`

### Task 16: Phase 2 E2E

**Files:** create `tests/e2e/onboarding.spec.ts`. Add `resetOnboarding()` to `tests/e2e/helpers.ts`, which sets the test profile's `onboarded_at` to null, archives its goals and deactivates its bills.

**Tests** (both devices, axe on each screen):
- [ ] Intro → Passer → Login (existing session skipped via `storageState`) → 5 steps → reveal → Budget shows the expected Reste.
- [ ] A reload at step 3 resumes at step 3 with the earlier answers kept.
- [ ] Login shows the invalid e-mail message.
- [ ] With Playwright's clock set to payday at 08:01, opening the app writes one payday move; a reload writes none.

- [ ] Run `npm run check`, `npm run e2e` and `npm run build` (check the JS size and that onboarding is a separate chunk).
- [ ] Update `CLAUDE.md` **Status**: Phases 1 and 2 done; next is the Phase 3 plan.
- [ ] Commit: `Refonte : E2E phase 2 — premier lancement et jour de paie`

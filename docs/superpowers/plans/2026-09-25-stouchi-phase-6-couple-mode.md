# Stouchi Rebuild — Phase 6: Couple mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is **lean by design**: files, behaviour, interfaces and test cases, not code. Port markup and styles from `prototype/index.html`; do not redesign. Prototype places: couple CSS (≈716–735); Moi row "Partager à deux" (≈2278); `renderCouple` (≈2463–2500); `openEdit` sheets `invite`, `joincode`, `unshare` (≈2614–2647); handlers `inv-*`, `e-join`, `e-unshare`, `data-cmode` (≈2789–2845); the carnet's `mode` (≈1535). Open the three states with `#set-couple`, `#set-couple-pending`, `#set-couple-on`.

**Goal:** Two accounts can share one household. Moi → Partager à deux → invite code, joined from the partner's own Moi. Once joined, the partners share Besoins, fixed bills and the goal; Envies, salary, debts, reminders and conversations stay private. The home number becomes the household's. Each shared expense shows who logged it, Historique gets a Tout / Moi filter, and Aam Salah proposes (never makes) changes to the partner's expenses, and the partner gets a notification. Either partner can stop sharing, and each keeps their own money.

**Architecture:** The data model already has `households` and `household_members` (legacy, 20260809) and a `household_id` on `expenses` and `bills`, which RLS already shares through `visible_to_me`. Phase 6 adds `household_id` to `goals` and `incomes`, a `household_invites` table, and five `security definer` RPCs (`couple_state`, `couple_invite`, `couple_cancel`, `couple_join`, `couple_leave`) plus `couple_request` for Aam Salah's proposals. Every join and leave change happens inside one RPC transaction. The figures stay one pure function: `computeFacts` gets an optional `couple` input (my id, the partner's Besoins budget) and is used unchanged by the screens, the carnet and `notify-run`. The client keeps the household id in its store; when it changes, the device rebuilds its mirror and re-stamps its pending writes.

**Tech Stack:** Phase 0–5 stack. No new runtime dependency.

**Spec:** redesign spec §4.7 (couple mode), §3 (Moi "sharing" row), §7 (household rows readable and writable by members only), §8.3 (two partners editing: last write wins; Realtime is not needed, pulls suffice), §8.5; Aam Salah spec §4 ("Couple mode adds `mode: couple`, the partner's first name, and `qui`") and §9.2 (the instruction line). The prototype wins on looks; the spec wins on behaviour.

---

## Decisions for the user to approve (defaults proposed)

1. **What is shared (D1).** Shared: Besoins expenses, incomes to Besoins, fixed bills, and the active goal with all its moves. Private: Envies expenses and incomes, debts, reminders, salary and split, notifications, chat. The database enforces it: on `expenses` and `incomes`, `household_id` may be set only when `pot = 'needs'` (check added `not valid`, so legacy backfilled rows don't block the migration; Task 10 fixes the backfill).
2. **The household figures (D2).** Each partner sees their **own** pay period. Besoins budget = my Besoins budget + the partner's Besoins budget (the partner's plan in force at my period start). Spent, reserved and moved in Besoins count every shared row. Envies = mine only. Reste à dépenser = shared Besoins left + my Envies left. Épargne shows my savings budget; the goal's saved total counts both partners' moves. The partner's salary and split are never sent: `couple_state` returns only their Besoins amount. Different paydays give the two partners slightly different figures; that is accepted.
3. **Qui met combien (D3).** Only "Selon les salaires" (each brings their own Besoins share, which is what D2 computes). "Moitié-moitié" is not built: it has no spec line or column, and it would move money between a partner's private pots. The couple screen shows the "selon les salaires" hint as a fixed line, without the switch.
4. **Invites (D4).** A new table `household_invites` (`code` pk, `household_id`, `created_by`, `expires_at` = now + 48 h, `used_at`) with no table grants; the RPCs are the only access. The code is `STC-` plus **6** symbols from the legacy alphabet (no 0/O/1/I/L): the prototype shows 4, but codes are guessable by design (legacy precedent). A code works once; a new invite replaces the previous one. Wrong tries are limited through the legacy `household_join_attempts` table, with the legacy limit. Inviting creates a one-member household ("En attente"): nothing is shared until the partner joins. The legacy functions (`create_household`, `join_household`, `merge_household_data`, …) stay untouched: production's legacy app still uses them.
5. **Join (D5).** The joiner must not already be in a two-member household; a pending one of their own is dropped. In one transaction, `couple_join` locks the household (two-member cap), adds the member, marks the invite used, and tags with `household_id`: both members' active bills, plus both members' Besoins expenses and Besoins incomes of their **current** pay period (so this period's shared figure is right). Older expenses stay private. The household goal is the inviter's active goal, else the joiner's. The other active goal is archived, and its moves are repointed to the household goal, so the two savings add up.
6. **Leave (D6).** Either partner can stop sharing. In one transaction, `couple_leave` sets every shared row's `household_id` to null, so each row stays with its author (`user_id`). The goal stays with its owner. The other partner gets a copy (same name, icon, target) with their own moves repointed to it. Then the household, its members and its invites are deleted. `delete_my_account()` runs the same leave first, so a deleted partner never takes the survivor's savings or bills with them (the FK cascade from `goals` would).
7. **Who can edit what (D7).** RLS already lets either partner edit a shared expense or bill by hand, as the legacy app did; this is kept. A shared expense can't be made private by an update: a trigger (`keep_household_id`) refuses clearing or changing `household_id` outside the couple RPCs. Moving a shared expense to Envies therefore soft-deletes the shared row and inserts a private copy with a new id, so the partner's device receives the deletion. **Aam Salah** never edits or deletes the partner's expenses. The server validator turns such an action into a `partner_request`; after Oui, `couple_request` inserts a notification for the partner. That notification is in-app only (no push in Phase 6), capped at 10 per sender per day, and deduplicated per expense and change. The partner answers Accepter (the change is applied through `write()`) or Refuser.
8. **Devices follow membership (D8).** The store holds `household` (id, status, partner) from `couple_state`, fetched at boot and on each sync. When the household id changes (join, leave, the partner left or deleted their account), the device rebuilds its mirror: it clears the tables and cursors, **keeps the outbox**, and pulls everything again. It also re-stamps pending writes: `household_id` = the new household for Besoins expenses and incomes and for bills, null otherwise. New writes are stamped from the store the same way.
9. **Screens (D9).** Following §4.7's "no other screen changes":
   - Moi gets the "Partager à deux" row and the `#/me/couple` screen with its sheets (ported).
   - In couple mode, ledger rows (Récent, pot ledger, Historique) show a small initials badge for the author.
   - Historique gets Tout / Moi pills (Moi = rows I logged).
   - The Budget Besoins card gets a "Commun" tag.
   - **Out of scope:** push for partner requests, Moitié-moitié, households of more than two, "X a noté …" activity notifications, Realtime.
10. **Test accounts (D10).** The E2E needs a second test user on `stouchi-test`. The user creates it and adds `TEST_PARTNER_EMAIL` / `TEST_PARTNER_PASSWORD` to `.env`. The two test users are paired by the E2E and unpaired at the end of it.

## Session split

Run it as **three sessions**:

- **Session A** covers Tasks 1–3: the migration, the figures and the client data layer.
- **Session B** covers Tasks 4–6: the screens.
- **Session C** covers Tasks 7–11: the server, Aam Salah, the notifications, the backfill and the E2E.

Run `npm run check` before every commit and `npm run e2e` at the end of Session C. Commit messages are in French: `Refonte : …`. Session A is money, data and RLS work: an Opus reviewer checks it before Session B starts.

## Things only the user can do

1. Approve decisions D1–D10.
2. Approve the Task 1 migration on `stouchi-test` only. Production waits for Phase 7.
3. Approve the `notify-run` redeploy to `stouchi-test` (Task 7). **Approved by the user on 2026-09-25**: Session C redeploys without asking again. This covers `stouchi-test` only, never production.
4. Create the partner test account and its `.env` entries (D10) before Session C.
5. Pair two real phones on `stouchi-test` and try invite, join, a shared expense, a partner request and leave.

## Global Constraints

- **Money:** integer millimes only (`src/shared/money.ts`). The partner's Besoins amount is `Mil`, computed in SQL with integer maths that matches `splitSalary` exactly.
- **Dates:** Africa/Tunis. Every "ce mois" is the viewer's pay period (`payPeriod`).
- **UI text:** French, in `src/shared/i18n/fr.json`; the i18n test must still pass. Partner-request notifications store no text: the app renders them from the action and `fr.json`.
- **Writes:** go through `write()` and the outbox. The exceptions are the `couple_*` RPCs, which need a connection and say so ("Connecte-toi pour …").
- **Grants:** `anon` gets nothing new. `household_invites` has no table grants. Each new function is executable by `authenticated` only, is `security definer` with `search_path = ''`, and refuses a null `auth.uid()`. `scripts/check-supabase.ts` expects the new table, columns, functions and grants.
- **No service key** in the app or on Vercel.
- **Legacy app untouched:** no change to the legacy functions, `budget_data` or `household_shared_data`; the legacy tests (`test/`) still pass.
- **Accessibility (§5.6):** the Tout / Moi pills expose `aria-pressed`, and the author badge has a text alternative ("Noté par Amira"). The code input has a label and announces its error.

## Review Focus

1. **A write that crosses a membership change.** An expense logged offline before a join or a leave and flushed after it lands with the right `household_id`. It is never rejected by RLS, and a private Envies row never becomes shared. (Task 3)
2. **A shared expense moved to Envies.** The shared row is soft-deleted, and a private copy with a new id appears. The partner's device drops the shared row on its next pull and never sees the copy. A direct update that clears `household_id` is refused by the database. (Tasks 1 and 3)
3. **The partner's private data never reaches me.** As partner B: A's Envies expenses and incomes, debts, reminders, profile row, notifications and archived goals are invisible, and `couple_state` returns A's Besoins amount, never A's salary or split. (Task 1)
4. **Bad and racing codes.** Every refused code stays refused: expired, used, my own, cancelled, a third person joining, and a joiner already in a couple. Two joins at once still give two members. Too many wrong tries are rate-limited. A code typed in lower case, with spaces or without `STC-`, works. (Task 1)
5. **Leaving or deleting keeps each partner's money.** After a leave, each partner's goal balance = the sum of their own moves, and each bill and expense is back with its author. After one partner deletes their account, the survivor's goal, moves and bills remain, and the survivor's device shows solo figures after its next sync. (Tasks 1 and 3)

---

## Session A — data, figures, client data layer

### Task 1: Migration — couple mode

**Files:**

- Create: `supabase/migrations/20260929_phase6_couple.sql`
- Modify: `src/shared/schemas.ts`: `Goal` and `Income` get `household_id: uuid.nullable()`; `CoupleState` (zod) describes the RPC's answer; `NotificationAction` gets `partner_request`
- Modify: `scripts/check-supabase.ts` / `scripts/supabase-check/` (the new table, columns, functions and grants)
- Test: `tests/db/couple.test.ts` (new, PGlite, same harness as `rls.test.ts`), `tests/unit/schemas.test.ts`

**Behaviour:** D1 and D4–D7 in SQL:

- **Columns:** `goals.household_id` and `incomes.household_id` (FK `on delete set null`). There are two checks, `expenses_shared_needs_only` and `incomes_shared_needs_only`, both `not valid`. The trigger `keep_household_id` on expenses, incomes, bills and goals refuses a changed `household_id` unless the couple RPCs set a transaction-local flag.
- **Policies:** goals are readable and editable when `visible_to_me`. `savings_moves` can be read when the goal is visible, and inserted by a member (`user_id = auth.uid()`) into a visible goal. Update and delete stay own-only. The incomes policies mirror the expenses ones.
- **`couple_state(p_on date)`** returns `{ household_id, status: 'solo'|'pending'|'on', invite: { code, expires_at } | null, partner: { user_id, first_name, needs_mil } | null }`. `needs_mil` is the partner's plan in force at `p_on`, mirroring `planFor` + `splitSalary`.
- **`couple_invite()`** returns `{ code, expires_at }`. **`couple_cancel()`**, **`couple_join(p_code text)`** and **`couple_leave()`** follow D4–D6. Errors are raised as fixed codes: `CODE_INVALID`, `CODE_EXPIRED`, `ALREADY_PAIRED`, `HOUSEHOLD_FULL`, `TOO_MANY_TRIES`, `OWN_CODE`.
- **`couple_request(p_expense uuid, p_change jsonb)`** checks that the caller and the expense's author share the household and that the expense is shared. It checks the change's shape (`kind` `edit`/`delete`; edit fields among `amount_mil`, `category`, `pot`, `label`, `spent_on`), then inserts the partner's notification (`trigger 'partner_request'`, empty title and body, dedupe key `partner:<expense>:<kind>:<Tunis date>`). It is capped at 10 per sender per day.
- **`delete_my_account()`** runs the leave first when the caller is in a household (D6).
- **Also:** report whether `households` / `household_members` are forced on `stouchi-test` (Phase 0 left it open). Do not change it.

**Tests (db):** Review Focus 3, 4 and 5, and:

- join tags this period's Besoins rows and bills, but not older ones or Envies;
- the household goal holds both partners' moves after a join;
- a partner can insert a move into the shared goal but can't update or delete the other's move;
- the trigger refuses clearing `household_id` directly;
- `couple_request` refuses an Envies or a private expense, a non-member, the 11th request of the day and a malformed change;
- `anon` can execute nothing new;
- `couple_state.needs_mil` equals `splitSalary(planFor(...)).needs` for three profiles, one with a pending plan.

**Tests (unit):** the new schema fields and `CoupleState`; `partner_request` parses and a malformed one fails.

- [ ] Write failing db and schema tests → implement → `npx vitest run tests/db` and `npm run check` green
- [ ] Apply to `stouchi-test` only after approval (Supabase MCP `apply_migration`, project `sfradlloqjmphjmlvaaw`), then run `npm run check:supabase` (pass `SUPABASE_URL` / `SUPABASE_ANON_KEY` in the environment, as in Phase 5)
- [ ] Commit `Refonte : migration phase 6 — mode couple`

### Task 2: Household figures

**Files:**

- Modify: `src/shared/facts.ts`, `src/shared/goal.ts` (moves already come per goal; check that a partner's moves count), `src/shared/payday.ts` (`activeGoal` accepts the household goal)
- Test: `tests/unit/facts.test.ts`, `tests/unit/goal.test.ts`, `tests/unit/payday.test.ts`

**Interfaces (produced):**

- `FactsInput.couple?: { me: string; partnerNeeds: Mil } | null`. With `null` or no value, the figures are unchanged (every current test must pass untouched).
- In couple mode: `pots.needs.budget` = my Besoins + `partnerNeeds`. Besoins spent, reserved and moved count every row passed in. Envies counts only rows with `user_id === me` (a defensive filter: RLS already hides the partner's Envies).
- `Facts.couple: boolean`, so screens can show the "Commun" tag without reading the store.

**Tests:** solo figures identical to before; couple Besoins adds both budgets and both partners' spending; the partner's Envies rows passed by mistake are ignored; a shared bill is reserved once, not twice; a partner's deposit from Besoins lowers shared Besoins; different paydays (5 and 25) give each partner their own period's figures; the goal's saved counts both partners' moves.

- [ ] TDD → check green → commit `Refonte : couple — chiffres du foyer`

### Task 3: Client data layer — state, stamping, rebuild

**Files:**

- Create: `src/data/couple.ts`, which wraps the RPCs and maps the error codes to `fr.json` keys
- Modify: `src/data/store.ts` (`household` signal; `factsInput` passes `couple`), `src/data/sync.ts` (fetch `couple_state` each sync; rebuild on a change), `src/data/outbox.ts` (re-stamp pending writes), `src/data/write.ts` or the repos (stamp new writes), `src/features/add/AddSheet.tsx`, `src/features/chat/execute.ts`, `src/features/me/BillSheet.tsx`, `src/features/onboarding/draft.ts`, `src/data/repos.ts` (drop the hard-coded `household_id: null`: the stamp decides)
- Test: `tests/unit/data/couple.test.ts`, additions to `tests/unit/data/sync.test.ts` / `outbox.test.ts`, `tests/unit/data/expenses.test.ts`

**Interfaces (produced):**

- `stampHousehold(table, row, householdId | null): row`. Besoins expenses and incomes and bills get the id; everything else gets null.
- `coupleApi`: `state(onDate)`, `invite()`, `cancel()`, `join(code)`, `leave()`, `request(expenseId, change)`. Each throws `CoupleError` with a key such as `couple.err.expired`.
- `moveToWants(expense)`: soft-deletes the shared row and writes a private copy with a new id (D7). The edit sheet and chat execute call it when a shared expense's pot changes to Envies.
- `rebuildMirror(db, store)`: clears the tables, cursors and signals, keeps the outbox, then pulls everything again. It reuses `useUser`'s clearing code; extract it, don't copy it.

**Behaviour:** D8. `couple_state` is fetched at boot, when a sync starts, and after every couple RPC; offline, the last known state stays in `meta`. A changed household id triggers one `rebuildMirror` and one re-stamp, and repeating it is harmless.

**Tests:** Review Focus 1 and 2 (client side); the stamp for each table and pot; the re-stamp covers join and leave; rebuild keeps the outbox and runs once per change; an RPC error maps to its key; offline, `state` answers from `meta`.

- [ ] TDD → check green → commit `Refonte : couple — état, tampons et reconstruction`
- [x] **Session A review:** an Opus reviewer checks Tasks 1–3 (money, RLS, migration). Fix Critical and Important findings with a test, then write the "Session A outcome" section here

### Session A outcome

- **Commits:** `bc4f10c` migration, `d4e5e9c` figures, `25562de` client data layer, then the review fixes. `npm run check` 1059/1059; `tests/db` 123/123.
- **Review (Opus, f7bb508..25562de):** Review Focus 1–5 hold (RLS, triggers and join/leave are sound; nothing of the partner's private data leaks). Fixed, each with a test that failed first:
  - C1: a partner's payday move on the shared goal no longer blocks my deposit (`dueDeposits` counts only my own). Session C's `notify-run` gets this through `dueDeposits`.
  - I1 + I2: the server owns `goals.household_id`. A `before insert` trigger (`goal_household`) makes a paired user's new active goal the household's; the client never sends the column. The old `rls.test` goal cases now use an outsider, since Alice and Bob are a couple.
  - M1 (raised to Important): `pushOnce` (chat) checks the household before pushing.
  - M2 (raised to Important): `couple_state` is asked for my period start (D2), not today.
- **Deferred to the ledger:** a pending savings move across a join or leave is not repointed; cancel/join race; `couple_request` dedupe per day and kind; figures jump for one sync round after a join or leave; a bill-paid expense moved to Envies can be paid twice.
- **For Session B:** `coupleApi` (in `src/data/couple.ts`) is ready for the screens. Every `couple.err.*` key is in `fr.json`; check the copy against the prototype. `expenses.update` returns the row now showing (a new id after a move to Envies).
- **On `stouchi-test` (2026-09-25):** `20260929_phase6_couple.sql` and `20260930_legacy_join_limit.sql` are applied (as `phase6_couple` and `legacy_join_limit`). `npm run check:supabase` passes: 14 tables, and 14/14 couple checks.
- **Legacy join limit (`f618dcf`):** `join_household` now returns `{error: CODE}` rather than raising, so a wrong code's attempt is kept; `app.js` shows it as before. On production, this migration and the `master` deploy of `app.js` must ship together, after approval.

---

## Session B — screens

### Task 4: Partager à deux screen and sheets

**Files:**

- Create: `src/features/me/CoupleScreen.tsx`, `src/features/me/InviteSheet.tsx`, `src/features/me/JoinSheet.tsx`, `src/features/me/UnshareSheet.tsx`
- Modify: `src/app/router.ts` (`#/me/couple`), `src/features/me/MeScreen.tsx` (the row and the dispatch), `src/features/me/me.css` (port `.duo`, `.ctitle`, `.benefit`, `.sharecols`, `.pendcard`, `.code`, `.codein`), `src/shared/i18n/fr.json` (`couple.*`)
- Test: `tests/unit/me/CoupleScreen.test.tsx`, `tests/unit/me/JoinSheet.test.tsx`, `tests/unit/app/router.test.ts`

**Behaviour:** port `renderCouple` with its three states:

- **Off:** the benefits, Partagé / Reste à toi, "Inviter mon partenaire" and "J'ai reçu un code".
- **Pending:** the code, "expire dans N h", Renvoyer and Annuler.
- **On:** the duo, "Vous gérez le foyer à deux", the fixed hint (D3), Arrêter le partage and "Aam Salah ne modifie jamais les dépenses de X".

**Sheets:**

- **Invite:** the code, Copier (clipboard) and Partager (`navigator.share`, else copy with the prototype's toast), then "C'est envoyé".
- **Join:** input formatted as `STC-XXXXXX`; Rejoindre is disabled until complete; each error code shows inline.
- **Unshare:** confirm, then leave.

**Moi row:** "Partager à deux" with Désactivé / En attente / Activé. Offline, the actions are disabled with "Connecte-toi pour …".

**Tests:** each state renders from a `household` fixture; the join input normalises the typed text; each error code shows its message; cancel and leave call the API and update the row; the router round-trips `couple`.

- [x] TDD → compare with the prototype (`#set-couple`, `-pending`, `-on`) at 390 px → commit `Refonte : Moi — partager à deux`

### Task 5: Author badge and Historique filter

**Files:**

- Create: `src/design/components/AuthorBadge.tsx` (initials in a small disc, over the row avatar's corner)
- Modify: `src/design/components/LedgerRow.tsx`, `src/features/history/HistoryScreen.tsx` (the Tout / Moi pills, next to the category filter), `src/shared/search.ts` if the filter belongs there
- Test: `tests/unit/design/AuthorBadge.test.tsx`, `tests/unit/history/` (extend)

**Behaviour:** D9. The badge shows only in couple mode and only on shared rows: mine show my initials, the partner's show theirs. The Tout / Moi pills show only in couple mode. Moi keeps the rows with `user_id === me`, and the search, month chart and totals follow the filter. In solo mode, nothing changes: no badge, no pills.

**Tests:** no badge or pills in solo mode; badge initials and label per author; Moi filters the ledger, the search results and the month totals.

- [x] TDD → commit `Refonte : couple — auteur et filtre Tout / Moi`

### Task 6: Budget and detail sheet in couple mode

**Files:**

- Modify: `src/features/budget/BudgetScreen.tsx` (the "Commun" tag on the Besoins card), `src/features/add/ExpenseDetailSheet.tsx` (a pot change on a shared expense goes through `moveToWants`; the author line "Noté par X"), `src/features/goal/GoalScreen.tsx` (deposit rows show the author badge)
- Test: extend `tests/unit/budget/`, `tests/unit/add/` and `tests/unit/goal/GoalScreen.test.tsx`

**Behaviour:** the figures come from Task 2 unchanged. Only these labels are added. Editing a partner's shared expense by hand is allowed (D7).

**Tests:** the tag shows only in couple mode; changing a shared expense's pot to Envies calls `moveToWants`; the author line.

- [x] TDD → compare Budget with the prototype → commit `Refonte : couple — budget et détail`

### Session B outcome

- **Commits:** `c47bee5` Moi — partager à deux, `3323ba4` auteur et filtre Tout / Moi, `0306b87` budget et détail, then the review fix. `npm run check` 1123/1123.
- **Compared with the prototype at 390 px (iPhone 13):** the couple screen in its three states and Budget in couple mode, with `couple_state` faked. They match, apart from the planned differences: no Moitié-moitié (D3), and the discs use `initials()` as the Moi card does.
- **Rulings (in the ledger):**
  - "Inviter" creates the code on the server before the sheet opens; Renvoyer shows the same code again.
  - A pending invite whose code expired offers "Nouveau code".
  - The Tout / Moi pills sit under the search field, because the filter also drives the search, the chart and the totals.
  - The detail sheet relies on `expenses.update` routing a move to Envies through `moveToWants`, and shows `couple.err.not_author`.
- **Review (self, per CLAUDE.md for screens):** fixed: Moi memoised `coupleActions()`, so if Moi opened before the device's data, the couple buttons stayed disabled (test "picks up the couple actions once the device has opened its data", which failed first).
- **For Session C:**
  - `AuthorBadge` and `authorOf` (`src/shared/couple.ts`) are ready for the partner-request notifications.
  - `couple.author` ("Noté par {name}") is in `fr.json`.
  - The E2E can reach the screens at `#/me/couple`.
  - E2E before Session C: `npm run e2e` passed 78 of 79. `design.spec` "buttons inside the sheet and the toast" failed once on Pixel 7 in the full run and passed 10 times in a row on its own. It looks like a timing flake: the buttons are measured while the sheet is still animating. Task 11 should wait for the sheet to settle before measuring.

---

## Session C — server, Aam Salah, notifications, backfill, E2E

### Task 7: `notify-run` on household data

**Files:**

- Modify: `src/server/notify/load.ts` (for a member, also load the household's shared expenses, incomes, bills, goal and its moves, plus the partner's profile to compute `partnerNeeds` with `planFor`), `src/shared/notify/rules.ts` (pass `couple` to `computeFacts`)
- Test: `tests/unit/notify/*.test.ts` (extend)

**Behaviour:** the Besoins warning uses the household figure. A shared bill's reminder goes to both partners (deduplicated per user, as today). Each partner's payday deposit goes to the household goal with their own `user_id`. A solo user's run is unchanged.

**Tests:** a couple fixture gets a household-based warning; the payday deposit targets the shared goal; a solo fixture's output is unchanged.

- [x] TDD → `npm run build:notify` → redeploy `notify-run` to `stouchi-test` after approval; a manual run answers 200 → commit `Refonte : couple — notify-run sur le foyer`

### Task 8: Aam Salah in couple mode

**Files:**

- Modify: `src/server/aam/load.ts` (the household rows, as in Task 7, read with the caller's JWT; the partner's first name and `needs_mil` come from `couple_state`), `src/shared/carnet.ts` (`utilisateur.mode: 'solo' | 'couple'`, `partenaire`, `qui` on each expense), `lib/aam-salah/instructions.js` (the §9.2 line, only when `mode = couple`), `lib/aam-salah/validate.js` (an edit or delete whose `ref` is a partner's expense becomes `partner_request`), `src/features/chat/` (the `partner_request` card: "Envoyer la demande à X ?" Oui / Non; Oui calls `coupleApi.request`; offline says so), `lib/aam-salah/eval-fixture.js` (two couple cases)
- Test: `tests/unit/carnet.test.ts`, `tests/unit/chat/execute.test.ts`, the legacy validator tests under `test/`, the eval

**Behaviour:** Aam Salah spec §4 and §9.2; D7. `qui` is "moi" or the partner's first name. The carnet never holds the partner's private rows (RLS hides them; `buildCarnet` also filters by `user_id` as a second barrier). The added instruction line is a prompt change, so the eval gate must pass before commit.

**Tests:** a solo carnet is byte-identical to before; the couple carnet has `mode`, `partenaire` and `qui`; the validator converts a partner edit or delete and keeps my own; the card calls the RPC once; a double tap sends nothing twice.

- [x] TDD → `npm run eval -- --min-rate 0.9167` passes (30 cases) → commit `Refonte : Aam Salah — mode couple`

### Task 9: Partner requests in Notifications

**Files:**

- Modify: `src/features/notifications/` (render `partner_request` from `fr.json`: "Amira propose de supprimer « Carrefour · 45 TND »" or "… de changer … en …", with Accepter / Refuser)
- Test: `tests/unit/notifications/*.test.tsx` (extend)

**Behaviour:** Accepter re-reads the expense from the mirror. If it still exists and the change passes zod, it applies the change through `write()` (a delete is a soft delete, with the usual undo toast), then marks the notification read. If the expense is gone, it says "Cette dépense n'existe plus" and only marks it read. Refuser marks it read. Nothing reaches the sender (D7).

**Tests:** accept applies an edit or a delete; a malformed change is refused; a gone expense; refuse only marks read.

- [x] TDD → commit `Refonte : couple — demandes du partenaire`

### Task 10: Backfill for Phase 7

**Files:**

- Modify: `scripts/backfill/convert.ts` / `rows.ts` (a household's goal gets `household_id`; a legacy shared expense in Envies gets `household_id: null`, with one aggregate issue `shared_wants_private` per household), `scripts/backfill/invariants.ts` if the goal invariant needs it
- Test: `tests/unit/backfill/convert.test.ts`

**Behaviour:** the backfilled rows satisfy D1's checks, so Phase 7 can `validate` both constraints after the apply. Monthly totals per source are unchanged, so verification still passes.

**Tests:** a household goal carries the household id; a shared Envies expense becomes private with the issue; verification passes on the existing fixtures.

- [x] TDD → `npm run backfill` dry run on `.backfill/` shows no new failure (never `--apply`) → commit `Refonte : backfill — foyer sur le nouveau modèle`

### Session C progress (2026-09-25, Tasks 7–10)

- **Commits:** `be7b9ba` notify-run on the household, `533b37a` Aam Salah in couple mode, `745c702` partner requests, `1353884` backfill. `npm run check` 1160/1160.
- **Eval:** `gemini:gemini-3.5-flash-lite` scored 28/30 with 0 API errors, which passes the Phase 3 gate definition.
  - Misses: #25, a solo case, where the solo prompt and carnet are byte-identical to before; and #30, where the reply didn't name Amira.
  - `gemini-3.8-flash` and `mistral` couldn't be judged: they returned quota and overload errors (429/503).
- **Left before Task 11:**
  1. **Redeploy `notify-run` to `stouchi-test`** (approved), then check that a manual run answers 200. The bundle is built with `npm run build:notify`. Waiting for the Supabase connector.
  2. **Backfill dry run** (`npm run backfill`, never `--apply`). It needs the production service key, which isn't in `.env`, and it reads real accounts, so it's the user's call. Otherwise it waits for Phase 7.
  3. **Partner test account (D10):** `TEST_PARTNER_EMAIL` / `TEST_PARTNER_PASSWORD` in `.env`, needed by Task 11.
- **Rulings:** listed in the ledger (`.superpowers/sdd/2026-09-25-stouchi-phase-6-couple-mode/progress.md`).
  - Validator tests sit in `tests/unit/chat/validate-couple.test.ts`, because `test/*.js` hold an uncommitted Prettier reformat.
  - Partner requests aren't in the shared `TRIGGERS` table.
  - The quiet-week nudge counts only my own logs.

### Task 11: E2E and handover

**Files:**

- Create: `tests/e2e/couple.spec.ts` (two browser contexts: the test user and the partner)
- Modify: `tests/e2e/helpers.ts` (`unpair` in `afterAll`, and first in `beforeAll` too, so a failed run can't leave the users paired), this plan (outcome section), `CLAUDE.md` status line

**Scenarios (iPhone 13 and Pixel 7):**

- A invites → B joins with the code typed in lower case → both show "Activé".
- B logs a Besoins expense → A's Budget shared Besoins moves and shows B's badge.
- B logs an Envies expense → A never sees it.
- Historique Moi hides B's rows on A.
- A asks Aam Salah to delete B's expense → a request card → B accepts in Notifications → the expense is gone on both.
- A stops sharing → both return to solo figures, and each keeps their own expenses.
- A wrong code shows its error.

- [x] `npm run check` and `npm run e2e` green → compare the couple screens with the prototype at 390 px → update this plan and `CLAUDE.md` → commit `Refonte : phase 6 — E2E et bilan`
- [x] **Final review:** an Opus reviewer checks the whole phase; fix findings with a test; list the deferred minors here

### Phase 6 outcome

- **Task 11:**
  - `tests/e2e/couple.spec.ts` (`0b514e2`, fixed after its first run in `205d836`): 6 tests covering the 7 scenarios. The helpers `unpair`, `partnerClient`, `signIn` and `HAS_PARTNER` are in `tests/e2e/helpers.ts`.
  - **Partner test account (D10):** `e2e-partner@stouchi.test` on `stouchi-test`, created confirmed. `TEST_PARTNER_*` are in `.env`.
  - **`npm run e2e`:** 91/91 on iPhone 13 and Pixel 7 (2026-09-26), and the couple spec passed 12/12 twice. M6 and M7 did not flake.
  - **`notify-run`:** redeployed to `stouchi-test` as v6 (`verify_jwt` still off). A manual run answered 200 with 0 errors.
- **Final review (Opus, `d7cfa98..0b514e2`):** with fixes, 0 Critical. Both Important findings were fixed in `77271d4`, each with a test that failed first; `npm run check` 1167/1167.
  - **I1:** a partner with no first name was not recognised as the partner, so Aam Salah could change their expense directly.
  - **I2:** the partner's request now shows every changed field.
- **Deferred minors** (the user decides):
  - **M1 Historique mismatch:** "Tout" compares household Besoins spending with my own budget, and its Épargne card counts the partner's deposits.
  - **M2 `verse_ce_mois`:** Aam Salah's "versé ce mois" includes the partner's deposits; D2 says my own.
  - **M3 Stale requests:** Accepter doesn't check that a request is still current after a leave.
  - **M4 Category and pot:** Accepter doesn't derive the pot from the category for a request made straight through the RPC.
  - **M5 Offline requests:** a request that fails offline leaves a dead card, so the user has to ask again.
  - **M6 E2E test 2:** it reads Besoins before A's first post-join pull.
  - **M7 E2E test 3:** it can pass before A has synced.
  - **M8 Moi stat:** "N dépenses" counts the partner's shared rows.
  - **M9 Pending inviter:** they must cancel before joining someone else's code.
  - **M10 For the user, before Phase 7:** a legacy household's shared Envies all go private to the anchor. The other partner loses that history, and the anchor's current-period Envies absorb it.
- **Also deferred:** M11, the `notify-run` bundle grew from 78 kB to 824 kB. `notify/load.ts` imports `floorFor` from `aam/load.ts`, which now pulls in zod. Moving `floorFor` to its own small module would fix it.
- **Left to do (the user):**
  1. Pair two real phones on `stouchi-test` (see "Things only the user can do").
  2. Decide on M10 before Phase 7.
  3. The backfill dry run, at Phase 7 at the latest.

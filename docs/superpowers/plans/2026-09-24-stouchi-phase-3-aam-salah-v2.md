# Stouchi Rebuild — Phase 3: Aam Salah v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is **lean by design**: it gives files, behaviour, interfaces and test cases, not code. Port the chat markup and styles from `prototype/index.html` (`#chat`, `.receipt`, `confirmCard`, `localBrain`); do not redesign.

**Goal:** In the new app, + offers "Parler à Aam Salah". The server builds the carnet from the signed-in user's rows, asks the model and validates its actions. The app runs direct actions at once, with an Annuler chip, and runs confirm actions only after Oui. When the model or the network is down, a local parser still logs expenses.

**Architecture:** The server never writes user data. `/api/aam` authenticates the caller, loads their rows **with their JWT** (RLS), builds the carnet with the same `src/shared` maths the screens use, and calls the existing, eval-proven `lib/aam-salah` pipeline (`handleAam`: instructions, provider chain, `validateActions`). It maps the carnet's short ids back to real ids, logs one `ai_events` row, and returns `{reply, actions, chips, lang}`. The client runs every action through the local-first repos (IndexedDB + outbox), so chat writes behave exactly like keypad writes, offline included.

**Tech Stack:** Phase 0–2 stack. No new runtime dependency. Vercel Node function in `api/aam.ts`; in dev, a Vite middleware mounts the same handler.

**Spec:** `docs/superpowers/specs/2026-09-23-aam-salah-assistant-design.md` (§2 flow, §4 carnet, §5 actions, §7 safety, §8 eval) and the redesign spec §4.2, §7, §8.3 (AI rows), §8.5, §8.6. The prototype wins on looks; the specs win on behaviour.

---

## Session split

Run it as **two sessions**. Session A covers Tasks 1–5: data, carnet, server and eval. Session B covers Tasks 6–10: the client and E2E. Run `npm run check` before every commit and `npm run e2e` at the end of Session B. Commit messages are in French: `Refonte : …`.

## Things only the user can do

1. **Approve the migration in Task 1** (the `incomes` table, plus `deleted_at` on `debts` and `reminders`). It goes to `stouchi-test` only; production waits for Phase 7 with the rest of the schema.
2. **Keys:** `GEMINI_API_KEY` in `.env` for the dev server and the eval, and in the Vercel preview environment together with `SUPABASE_URL` / `SUPABASE_ANON_KEY` for the function.
3. **Run the eval gate** at the end of Task 5 (`npm run eval -- --models gemini:gemini-3.5-flash-lite --min-rate 0.9167`). It spends API quota.

## Global Constraints

- Money is integer millimes. The model speaks TND, so conversion happens **only** at two boundaries: carnet out (`mil / 1000`, exact) and actions in (`milFromTnd`, rejecting anything that isn't a whole number of millimes).
- Dates are Africa/Tunis (`todayTunis`), and every figure uses the pay period.
- The model never sees a real id or a household id, and the server never trusts a carnet sent by the client.
- Every UI string goes in `fr.json`. The model's reply text is the only text that doesn't, and it is rendered as text: no `dangerouslySetInnerHTML`, and `latinOnly` is already applied on the server.
- `src/shared/categories.ts` stays aligned with `CAT_POT` in `lib/aam-salah/validate.js` (an existing test checks this).
- Chat code is a lazy chunk, and first-load JS stays ≤ 150 kB gzipped.
- The §5.6 accessibility rules apply: a live region for replies, focus trap in the sheet, and card buttons ≥ 44 px with labels.
- Legacy `api/chat.js`, `lib/chat-context.js` and `test/` stay working. `npm run check` runs the legacy tests.

## Decisions this plan makes (the specs leave them open)

- **Endpoint `/api/aam`**, not `/api/chat`. The legacy app keeps `/api/chat` until Phase 7, which removes it. Update redesign spec §8.1 to match.
- **Server code lives in `src/server/aam/`** (typechecked, linted, tested). `api/aam.ts` is a thin adapter. The CommonJS `lib/aam-salah/*.js` stays JavaScript, because the eval and the legacy tests use it; it gets a `lib/aam-salah/index.d.ts`. Add `api` to `tsconfig.json` `include`.
- **Short ids** are the kind letter (`e` expense, `b` bill, `d` debt, `r` reminder) plus the **shortest unique hex prefix of the uuid, at least 4 characters**. They stay stable across turns with no server state. The response returns each id-bearing action with `ref` (the real uuid) next to the short `id`.
- **Before each send**, the client flushes the outbox, waiting at most 2 s, so the carnet sees what was just logged. If writes are still pending after that, the turn goes to the local parser (see Review Focus 1).
- **Money moving into or out of a pot:**
  - `savings_moves.from_pot` means the pot the money **leaves** (deposit) or **arrives in** (withdraw).
  - A deposit from the "payday" or "income" path has `from_pot` null.
  - `facts.ts` counts in-period moves in the pots: a deposit lowers that pot's `left`, and a withdrawal raises it.
- **`add_income`:** `to: epargne` becomes a `savings_moves` deposit with `from_pot` null. `to: besoins|envies` becomes a row in the new `incomes` table, which raises that pot's `left` for the period it falls in.
- **Undo** reverts the **last chat action** if it happened less than 10 minutes ago:
  - Expense actions and `pay_bill`: soft delete, or restore the previous values.
  - `add_debt` / `set_reminder`: `deleted_at`.
  - `settle_debt`: clear `settled_at`.
  - `add_bill`: `active = false`.
  - `update_goal`: previous target.
  - Pot income: `deleted_at`.
  - **Savings moves are not undoable in Phase 3.** The table is hard-delete only, and that needs an outbox delete mode, which Phase 5 adds. For them `derniere_action` is omitted, so the model can't undo them.
- **Rate limit:** 30 turns per 10 minutes, counted from the caller's own `ai_events` rows. Beyond that the endpoint returns 429 with a French line. The request body is capped at 32 kB.
- **Chat history** lives in IndexedDB (`chat` store, keyed by user, last 50 turns). It is cleared on sign-out and never synced. After a reload, a confirmation card that was never answered shows as expired, without Oui / Non.
- **`a_signaler`** holds at most one of these, first unseen wins: a pot at ≥ 80 % (not over), a category that grew versus the previous period, or a savings opportunity (last 5 days, `left ≥ 3 × perDay`). Each has a key `<rule>:<period_start>[:<pot|cat>]`. The response returns `nudgeKey`, and the client adds it to `nudgeSeen` (kept with the history).
- **Offline parser:** expenses only (amount + category words, French and Latin-script derja). Everything else gets one line saying Aam Salah is offline.
- **Out of scope:** couple mode (Phase 6: the carnet is always `"mode": "solo"`), notifications (Phase 4), and screens for reminders, goals and settings. `open` falls back to the existing placeholder routes. Historique keeps its Phase 1 template line.

## Review Focus

1. **Stale carnet after a quick write.** "50 courses", then "annule" within 2 seconds, possibly offline: the undo must target that expense, and never an older one. The send waits for the flush; if writes are still pending, the local parser answers. (Tests in Task 8.)
2. **Model amounts at the boundary:** `12.5`, `"12,5"`, `0.0004`, `-5`, `1e9`, `NaN` and `50001`. Only whole-millime amounts in `(0, 50 000]` are executed. Carnet amounts render exactly: 12 500 mil becomes `12.5`, never `12.499…`. (Tests in Tasks 3 and 6.)
3. **Oui on a stale or repeated card.** The row was edited or deleted on another device, or Oui is tapped twice. The write happens at most once, and if the row changed the card says so instead of overwriting. (Tests in Task 6.)
4. **Forged or cross-kind ids:** a bill id in `delete_expense`, an id that isn't in the carnet, a raw uuid, or a colliding 4-character prefix. Each is dropped on the server, and a reply that claimed the action becomes the safe fallback. (Tests in Tasks 3 and 4.)
5. **Account switch.** A second user signs in on the same device: they never see the first user's chat history, `nudgeSeen` or undo record. (Tests in Task 8.)

---

# Session A — data, carnet, server, eval

### Task 1: Migration — `incomes`, soft delete on debts and reminders — *careful review*

**Files:** create `supabase/migrations/20260925_phase3_incomes_soft_delete.sql`. Modify `src/shared/schemas.ts`, `scripts/supabase-check/tables.ts`, `tests/db/rls.test.ts`.

**Behaviour:**
- New table `incomes` (`id`, `user_id` default `auth.uid()`, `amount_mil` > 0 ≤ `MAX_MIL`, `pot` `needs|wants`, `label` ≤ 60, `received_on` date, `created_at`, `updated_at`, `deleted_at`). It gets the same treatment as the Phase 0 tables: RLS enabled and forced, per-operation policies on `user_id = auth.uid()`, `updated_at` trigger, zero grants to `anon`, `authenticated` limited to `select, insert, update`, and TRUNCATE/REFERENCES/TRIGGER revoked.
- Add `deleted_at timestamptz` to `debts` and `reminders`. The existing update policies already cover it.
- Add `IncomeRow` / `IncomeInsert` to zod, and `deleted_at` to `DebtRow` and `ReminderRow`.
- Apply the migration to `stouchi-test` only.

**Tests:**
- [ ] RLS: a user reads and writes only their own incomes, `anon` gets nothing, and delete is refused.
- [ ] `check:supabase` lists `incomes` as forced, with the expected grants.
- [ ] The schemas reject amount 0, amounts over `MAX_MIL`, and an unknown pot.

- [ ] Commit: `Refonte : migration phase 3 — revenus, suppression douce des dettes et rappels`

### Task 2: Facts and local mirror — incomes, pot moves, reminders — *careful review*

**Files:** modify `src/shared/facts.ts`, `src/data/localdb.ts` (DB version 2: add `reminders`, `incomes`), `src/data/remote.ts` and `src/data/sync.ts` (pull and push both tables), `src/data/app.ts`. Test: `tests/unit/facts.test.ts`, `tests/unit/data/sync.test.ts`.

**Interfaces (produces):** `FactsInput` gains `savingsMoves: SavingsMove[]` and `incomes: Income[]`. `PotFacts` gains `moved: Mil`: incomes plus withdrawals in, minus deposits out, in the period. Then `left = budget + moved − reserved − spent`.

**Behaviour:** Only in-period, non-deleted rows count. Payday moves and deposits with `from_pot` null never touch a pot. Debts with `deleted_at` leave `upcoming`. The IndexedDB upgrade from v1 keeps every existing row and the outbox.

**Tests:**
- [ ] A 100 TND deposit from Envies lowers Envies `left` by 100 000 mil. A 200 TND withdrawal to Besoins raises Besoins `left`.
- [ ] A 150 TND income to Envies raises Envies `left`. A deleted income, or one from the previous period, changes nothing.
- [ ] Payday moves leave both pots unchanged, and `perDay` follows the new `left`.
- [ ] A deleted debt is not upcoming.
- [ ] Opening a v1 database with a pending outbox entry upgrades it with the entry intact, and sync pulls reminders and incomes.

- [ ] Commit: `Refonte : faits — revenus et mouvements d'épargne dans les pots, rappels en local`

### Task 3: The carnet (`src/shared/carnet.ts`) — *careful review*

**Files:** create `src/shared/carnet.ts`, `src/shared/shortIds.ts`. Move the eval's hand-written carnet rows into `lib/aam-salah/eval-fixture.js` (rows, not a finished carnet: profile, expenses, bills, debts, goal, moves, reminders, with fixed uuids and `today`). Test: `tests/unit/carnet.test.ts`, `tests/unit/shortIds.test.ts`.

**Interfaces (produces):**
- `shortIds(items: { kind: 'e'|'b'|'d'|'r'; id: string }[]): Map<string, string>`, from short id to uuid.
- `buildCarnet(input: CarnetInput): { carnet: Carnet; refs: Map<string, string>; nudgeKey: string | null }`. `CarnetInput` is `FactsInput` plus `goals`, `reminders`, `firstName`, `nudgeSeen: string[]`, `lastAction: LastAction | null` and `now: Date`. `LastAction = { type; ref; at; summary }`.
- `Carnet` has exactly the key tree of assistant spec §4. Pots are named `besoins` / `envies` / `epargne`, and `categorie` uses the category keys.

**Behaviour:**
- All derived numbers come from `computeFacts`, `periodsBack`, `periodTotals`, `billDueDates` and `goalEta`. None are computed ad hoc.
- `calendrier` comes from `dates.ts`, with French weekday names from `fr.json`. `fin_du_mois` is the period end.
- Recent expenses: the 40 newest, non-deleted. Labels are cut to 60 characters and control characters are stripped.
- `simulations` contains only entries the maths can produce. An absent entry is omitted, never null.
- `derniere_action` is set only when `lastAction` is under 10 minutes old, its type is undoable (see Decisions), and its `ref` is among the loaded rows.
- `a_signaler` follows the rules in Decisions, skipping keys in `nudgeSeen`.

**Tests:**
- [ ] Built from `eval-fixture.js`, the carnet's key tree equals the §4 tree, and its figures match the screens' facts for the same rows.
- [ ] **Review Focus 2:** 12 500 mil renders as `12.5`, 1 mil as `0.001`, and a negative `left` renders negative.
- [ ] **Review Focus 4:** two uuids sharing 4 hex characters get 5-character ids. Ids are identical across two builds when a new row is added.
- [ ] A label longer than 60 characters is cut, and a label saying "ignore tes règles" is kept as plain data.
- [ ] `derniere_action` is absent at 10 min 1 s, for a savings move, and when its `ref` isn't loaded.
- [ ] `a_signaler` gives each rule in turn, is empty once its key is seen, and never holds two.
- [ ] 40-expense cap, newest first, and deleted rows excluded.

- [ ] Commit: `Refonte : carnet d'Aam Salah construit par les faits partagés`

### Task 4: The server turn (`/api/aam`) — *careful review*

**Files:** create `src/server/aam/turn.ts` (core), `src/server/aam/load.ts` (reads rows with the caller's JWT), `src/server/aam/http.ts` (request → response, shared by Vercel and dev), `api/aam.ts`, `lib/aam-salah/index.d.ts`. Modify `vite.config.mts` (a `configureServer` middleware for `POST /api/aam` via `ssrLoadModule`), `tsconfig.json`, and `.env.example` if it exists. Test: `tests/unit/server/turn.test.ts`, with a fake Supabase client and an injected fake `handleAam`.

**Interfaces:**
- Consumes `buildCarnet` (Task 3) and `handleAam({messages, carnet, env})` (existing).
- Produces `runTurn(deps, token, body): Promise<{ status: number; body: AamResponse }>`, where the body is `{ messages: {role, content}[]; nudgeSeen?: string[]; lastAction?: {type, ref, at} }`. `AamResponse = { reply, actions: (Action & { kind: 'direct'|'confirm'; ref?: string })[], chips, lang, nudgeKey } | { error }`.

**Behaviour:**
1. Return 405 for anything but POST, 413 above 32 kB, and 401 without a valid session (`auth.getUser(token)`).
2. Rate limit: 30 or more own `ai_events` in the last 10 minutes gives 429 with `{error}` in French.
3. Load in parallel: the profile, expenses since the start of the period three periods back (capped at 2 000 rows), bills, bill payments, debts, active goal and its moves, reminders not done, and incomes. A profile that isn't onboarded gives 409.
4. Build the carnet, then call `handleAam`. Every kept action with a short id gets `ref`; an id missing from `refs` drops the action, and the reply falls back to the safe line.
5. Insert one `ai_events` row: model, latency, `outcome` (`ok`, `validation_drop` when anything was dropped, `error` / `fallback` from the pipeline), and `action_types`. Never message text. A failed insert is logged and never blocks the reply.
6. The service key is never read. The function uses the anon key plus the caller's `Authorization` header.

**Tests:**
- [ ] 405, 413, 401, 409, and 429 at the 30th turn.
- [ ] The carnet passed to `handleAam` comes from the loaded rows, and a `carnet` field in the body is ignored.
- [ ] **Review Focus 4:** a kept action with an unknown short id is dropped and the reply becomes the fallback.
- [ ] `ai_events` rows carry no message text, respect `^[a-z_]{2,30}$` and hold at most 10 types. An insert failure still returns 200.
- [ ] A pipeline 503 gives 503 `{error}` and an `ai_events` row with `outcome: 'error'`.

- [ ] Manual smoke: `npm run dev`, then POST `/api/aam` with a test-user token.
- [ ] Commit: `Refonte : /api/aam — carnet côté serveur, limite de débit, journal ai_events`

### Task 5: Eval on the real carnet

**Files:** modify `scripts/eval-aam-salah.js` (build the carnet from `eval-fixture.js` via `buildCarnet`), `package.json` (`eval` runs through `tsx`), and `.github/workflows/eval.yml` (paths add `src/shared/carnet.ts`, `src/shared/shortIds.ts`, `src/server/aam/**`).

**Behaviour:** The 28 cases stay, and their expected ids are updated to the fixture's short ids. Dates, remaining amounts and `a_signaler` now come from the maths, so update only the expectations that change for that reason, and note each one in the commit body. The gate flags (`--min-rate`, zero cases) behave as before.

**Tests:**
- [ ] `test/aam-salah.test.js` and the gate-flag tests still pass.
- [ ] **User:** run the gate (see "Things only the user can do", item 3). The result must be ≥ 0.9167. Record the score in the assistant spec §9.

- [ ] Commit: `Refonte : banc d'essai sur le carnet réel`

---

# Session B — the client

### Task 6: Action executor (`src/features/chat/execute.ts`) — *careful review*

**Files:** create `src/features/chat/execute.ts`, and `src/data/repos.ts` for small repos over `writeRow`: debts, bills, bill payments, reminders, incomes, goals and savings moves. Follow `expenses.ts` exactly: zod parse, idempotent create, and `updated_at`. Test: `tests/unit/chat/execute.test.ts` with `fake-indexeddb`.

**Interfaces (produces):**
- `execute(action: ServerAction, ctx): Promise<{ ok: true; summary: string; undo: UndoRecord | null } | { ok: false; reason: 'stale' | 'invalid' }>`.
- `undoLast(record: UndoRecord, ctx): Promise<string | null>`.
- `summary` is the French `[app]` text from `fr.json`.

**Behaviour, per action:**
- `add_expense`: `source 'chat'`, new uuid, pot mapped from `besoins|envies` to `needs|wants`.
- `edit_expense` / `delete_expense`: work by `ref`; the undo record keeps the previous values.
- `pay_bill`: a `source 'bill'` expense plus a `bill_payments` row for the current period.
- `add_bill`: `starts_on` today.
- `savings_deposit` / `withdraw`: a move on the active goal, with `from_pot` as in Decisions.
- `add_income`: a move or an `incomes` row.
- `add_debt` / `settle_debt`, `set_reminder` (the `date` + `time` are Tunis local time, stored as `timestamptz`), and `update_goal`.
- When a card is shown, it records the target row's `updated_at`. At Oui, the row must still be on the device, not deleted, and have that same `updated_at`; otherwise the result is `stale`. Comparing the row with itself avoids depending on the device clock.

**Tests:**
- [ ] Each action type writes the expected row and outbox entry.
- [ ] **Review Focus 2:** amounts `12.5`, `0.0004`, `-5`, `NaN` and `50001` → only `12.5` executes (12 500 mil).
- [ ] **Review Focus 3:** Oui twice gives one write. A row edited after the card gives `stale` and no write. A deleted row gives `stale`.
- [ ] `pay_bill` then undo: the expense is soft-deleted and the bill is reserved again (facts).
- [ ] Undo of `edit_expense` restores every previous field. Undo after 10 minutes returns null.
- [ ] A deposit with no active goal gives `invalid`, and nothing is written.

- [ ] Commit: `Refonte : exécution des actions d'Aam Salah sur les dépôts locaux`

### Task 7: Offline parser (`src/shared/localParser.ts`)

**Files:** create `src/shared/localParser.ts`, porting the expense part of the prototype's `localBrain` / `norm` / `amountIn` (lines ~1752–1900). Test: `tests/unit/localParser.test.ts`.

**Interfaces (produces):** `parseLocal(text: string, today: ISODate): { action: AddExpense } | { ask: 'amount' | 'what'; amount?: Mil } | { unknown: true }`.

**Behaviour:** It finds an amount and category words. It handles hier / avant-hier, derja written in Latin letters (`5allast 30 9ahwa`), and English (`coffee`), and labels are always in French. An amount with no category word asks what it was for (`ask: 'what'`), and a category with no amount asks for the amount. It never produces any action but `add_expense`.

**Tests:**
- [ ] "50 courses hier" → courses · needs · yesterday.
- [ ] "5allast 30 9ahwa" → cafe · wants.
- [ ] "12,5 taxi" → 12 500 mil.
- [ ] "50" → `ask: 'what'` with 50 000 mil kept, and "courses" → `ask: 'amount'`.
- [ ] "bonjour" → `unknown`.
- [ ] Amounts over 50 000, or 0 → `unknown`.

- [ ] Commit: `Refonte : analyseur hors ligne des dépenses`

### Task 8: Chat state (`src/features/chat/chat.ts`, `history.ts`) — *careful review*

**Files:** create `src/features/chat/chat.ts` (signals: turns, busy, offline mode), `src/features/chat/history.ts` (IndexedDB `chat` store: last 50 turns, `nudgeSeen`, the undo record, keyed by user id; cleared by `signOut`), and `src/features/chat/api.ts` (fetch `/api/aam` with the session token, 16 s timeout). Modify `src/data/app.ts` (`signOut` clears chat). Test: `tests/unit/chat/chat.test.ts`.

**Interfaces (produces):** `send(text)`, `answerCard(cardId, yes: boolean)`, `tapChip(text)`, `undoChip()`, and the signal `turns: Turn[]`. A `Turn` is `{ role: 'user'|'assistant'|'app'; text; actions?; cards?; at }`. `[app]` turns are sent to the server as `role: 'user'` with the `[app] ` prefix.

**Behaviour:**
- **Send:**
  1. Append the user turn.
  2. Flush the outbox, waiting at most 2 s.
  3. If writes are still pending or the device is offline, use the local parser path.
  4. Otherwise POST the last 12 turns, `nudgeSeen` and `lastAction`.
- **On a reply:** run the direct actions (Annuler chip for the undoable ones), render the confirm actions as cards (no chips then), and store `nudgeKey`.
- **On an error or timeout:** use the local parser, plus one `fr.json` line saying Aam Salah is offline.
- **Oui / Non:** append `[app] Confirmé : …` or `[app] Refusé : …`. A stale card gives `[app] Pas fait : la ligne a changé.`
- **Model `undo`:** runs `undoLast` and appends `[app] Annulé : …` or `[app] Rien à annuler.`

**Tests:**
- [ ] **Review Focus 1:** add, then send within 2 s: the request waits for the flush. With the flush failing, the local parser answers and no request is sent.
- [ ] **Review Focus 5:** user A's history, `nudgeSeen` and undo record are invisible after user B signs in, and are gone after sign-out.
- [ ] History is capped at 50 and survives a reload. An unanswered card comes back expired.
- [ ] A reply with confirm actions has no chips. A 429 shows its French line and does not fall back to the parser.
- [ ] Model `undo` with no record gives "Rien à annuler".

- [ ] Commit: `Refonte : état du chat — envoi, cartes, annulation, historique local`

### Task 9: Chat UI — + chooser, sheet, receipts, confirm cards

**Files:** create in `src/features/chat/`: `AddChooser.tsx` (the speed-dial bubble: Parler à Aam Salah / Saisie manuelle), `ChatSheet.tsx`, `Bubble.tsx`, `ReceiptCard.tsx`, `ConfirmCard.tsx` (one component, variant per action type, as in the prototype's `confirmCard`), `Chips.tsx`, `chat.css` and `index.ts` (lazy entry). Modify `src/app/App.tsx` (+ opens `AddChooser`; chat loaded with `import()`), and `src/shared/i18n/fr.json`. Test: `tests/unit/chat/ui.test.tsx`.

**Behaviour:**
- Port the prototype's markup, styles and motion: bubble pop, typing dots, receipts, the diff card "12 → 21 TND", the struck-through receipt for delete, "Envies → Épargne", and the income card with the Épargne / Ce mois switch (the switch re-sends the choice as `add_income` with the other `to`).
- Suggestions show while the thread is empty.
- An `open` action renders a "Voir …" button that navigates.
- Replies go through a polite live region. The sheet traps focus and returns it to +.
- Reduced motion turns off every animation.
- Budget figures roll after a chat write, as they do after a keypad write.

**Tests:**
- [ ] + shows two labelled choices, and "Saisie manuelle" opens the existing keypad.
- [ ] Each confirm variant renders with Oui / Non, and Oui calls `answerCard(id, true)` once.
- [ ] The receipt shows the category icon, pot name and amount.
- [ ] A user's text containing `<b>` renders literally.
- [ ] The live region announces the reply. Focus returns to + on close.
- [ ] The empty thread shows suggestions, and the expired card has no buttons.

- [ ] Commit: `Refonte : chat d'Aam Salah — bulle +, fil, reçus, cartes Oui / Non`

### Task 10: Phase 3 E2E and hand-over

**Files:** create `tests/e2e/chat.spec.ts`, which stubs `/api/aam` with `page.route` (canned replies; the preview server has no function). Modify `docs/superpowers/specs/2026-09-23-stouchi-redesign-design.md` (§8.1 endpoint `/api/aam`; §7 `incomes`, `deleted_at` on debts and reminders, meaning of `from_pot`), the assistant spec (§4 short-id format, §5 undo scope), and `CLAUDE.md` (Status).

**Tests** (both devices, axe with the sheet open):
- [ ] "50 courses hier" → receipt → Budget Reste drops by 50. Annuler → Reste is back.
- [ ] Edit card → Oui → the row in Historique shows the new amount. Delete card → Non → the row is still there.
- [ ] Offline (`context.setOffline(true)`): "30 café" → offline line + receipt. Back online, the row syncs.
- [ ] A 503 stub → the local parser answers, and no error screen appears.
- [ ] Reload → the thread is restored.

- [ ] Run `npm run check`, `npm run e2e` and `npm run build`: the chat must be a separate chunk and first-load JS ≤ 150 kB gzipped.
- [ ] Manual: `npm run dev` with a real key, one expense, one edit card and one question, against `stouchi-test`.
- [ ] Update `CLAUDE.md` **Status**: Phase 3 done; next is the Phase 4 plan.
- [ ] Commit: `Refonte : E2E phase 3 — chat, cartes, hors ligne`

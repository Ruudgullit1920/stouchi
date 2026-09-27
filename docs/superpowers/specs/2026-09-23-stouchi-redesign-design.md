# Stouchi redesign — product, design and technical spec

Status: approved 2026-09-23 (all four §11 decisions as proposed) · Phase 0 plan: docs/superpowers/plans/2026-09-23-stouchi-phase-0-foundations.md
Companion documents:
- `2026-09-23-aam-salah-assistant-design.md` — the assistant (instructions, carnet, actions, evals).
- Clickable prototype: `.superpowers/brainstorm/1864-1790114550/content/prototype-v2.html`
  (open with `#app` to skip onboarding; `#intro-1`, `#login`, `#setup-1…5`, `#reveal`, `#history`,
  `#notif`, `#pot-need`… jump to a screen). The prototype is the visual reference for this spec: where
  the two disagree, the prototype wins on looks, this document wins on behaviour and data.

---

## 1. Why

Users found the current app overwhelming: twelve places to go, two competing ways to add an expense,
features grouped by how they were built rather than by what people want, a look that reads as
"AI-generated", and an assistant whose 200-line prompt made it defensive and robotic.

## 2. Goals, non-goals, success criteria

**The one job.** Open the app → know what you can still spend. Every screen either answers that,
explains it, or helps change it.

**The model.** On payday the salary splits itself: **Besoins 50 % · Envies 30 % · Épargne 20 %**.
Bills are reserved inside Besoins. "Reste à dépenser" = what is left in Besoins + Envies.

**Goals**
1. A first-time user is set up in under 2 minutes (5 questions).
2. Logging an expense takes under 5 seconds, by keypad or by telling Aam Salah.
3. Any past expense can be found in under 10 seconds (search across all months).
4. Solo first; couple sharing is an optional layer that never changes the core screens.
5. The app keeps working with a bad connection, and never loses an expense.

**Non-goals (this release)**
Bank connections, real payments, multi-currency, investment advice, the shopping list (removed; its
data stays exportable), the guided tour, web version beyond the mobile PWA layout.

**Success criteria** (measured 30 days after launch)

| Metric | Target |
|---|---|
| Onboarding completion (started → reveal) | ≥ 80 % |
| Median time to log an expense | ≤ 5 s |
| Weekly active users logging ≥ 3 expenses / week | ≥ 60 % |
| Aam Salah eval pass rate (24 cases) | ≥ 22 / 24 on every release |
| Chat reply p95 latency | ≤ 4 s |
| Crash-free sessions | ≥ 99.5 % |
| Expenses lost (written offline, never synced) | 0 |

## 3. Information architecture

```
Intro (3) → Login → Setup (5 questions) → Reveal
                                            │
┌───────────────────────────────────────────▼───────────────────────────────┐
│ Budget        Historique        [ + ]         Objectif        Moi          │  ← floating tab bar
└────────────────────────────────────────────────────────────────────────────┘
  │ bell → Notifications (push screen)      + → bubble: Parler à Aam Salah (chat sheet)
  │ pot card → Pot ledger (push screen)            Saisie manuelle (keypad sheet)
  │ À venir / Récent → Historique
```

| Place | Answers | Contents |
|---|---|---|
| **Budget** (home) | What can I spend? | "Reste à dépenser" + per day, 4-colour split bar, three pot cards (Besoins, Envies, Épargne), À venir (bills + debts), Récent; bell and avatar in the header |
| **Pot ledger** | Where did this pot go? | Month switcher, category pills, summary card with segmented bar and legend, "il te reste … · …/jour", flat list grouped by day |
| **Historique** | What happened, and when? | Search across all months, 12-month bar chart used as month picker, pots mini-cards, Aam Salah's one line, categories (tap to filter), ledger list |
| **Objectif** | When do I reach my goal? | Goal card (saved / target, %, date), "et si +50/+100/+200", deposits list, Verser |
| **Moi** | Settings | Profile, salary, split (50/30/20 editable), fixed bills, payday, sharing, export, sign out |
| **Notifications** | What should I know? | Aam Salah's alerts, reminders, advice, recaps; filter pills; one-tap actions |
| **+ bubble** | Log something | Two choices: chat with Aam Salah, or manual keypad |

**Removed from today's app:** shopping list, guided tour, notifications drawer (replaced by the
Notifications screen), week strip, "Bientôt à deux", trust pills, loading ("crunch") screen, separate
Envelopes tab, Ensemble/Me toggle, "Refaire l'onboarding".

**The budget period is the pay period, not the calendar month.** Payday on the 25th means the period
runs 25 → 24. Every "ce mois", every per-day figure, every month in Historique follows the pay period
(labelled by the month it mostly covers). Payday "fin du mois" means the last day of each month.

## 4. Flows

### 4.1 First run
1. **Intro**: three slides (split, three-second logging, goal), swipe or arrow, "Passer" to skip.
2. **Login**: e-mail + password or Google. Inline validation (red underline, shake, one-line reason).
   "Créer un compte" uses the same screen. Google pre-fills the first name.
3. **Setup**, one question per screen, progress bar, back allowed, each asked by Aam Salah:
   1. Prénom.
   2. Salaire net mensuel — live 50/30/20 preview.
   3. Jour de paie — 1er, 5, 10, 15, 20, 25, 28, fin du mois.
   4. Factures fixes — toggle cards with editable monthly amount; live "réservé dans Besoins" meter,
      amber above 80 %, explanation above 100 %. Can be skipped ("Je n'ai pas de factures fixes").
   5. Objectif — six goal types, target (pre-filled per type; Sécurité = 3 × salary), already saved,
      live target date.
4. **Reveal**: salary coin, three pots drop in with counting amounts, confetti, "Ouvrir mon budget".

Setup answers are saved after every step (resume where you left if the app closes). Nothing else is
asked; everything else lives in Moi.

### 4.2 Logging an expense
- **Manual**: + → Saisie manuelle → keypad, Besoins/Envies switch showing what is left in each,
  category icons for that pot, date (default today), optional note → Enregistrer → toast; the
  numbers on Budget roll to their new value.
- **Chat**: + → Parler à Aam Salah → type or tap a suggestion → receipt card in the thread, Annuler
  chip. Edits, deletions, savings moves and bills go through an Oui / Non card (see the Aam Salah spec).
- Either way the expense is written locally first and synced after (§8.4).

### 4.3 Finding an expense
Historique → search field. Matches shop name, category, pot or exact amount, across the last 12 pay
periods; results grouped by month with count and total, matched text highlighted. Quick suggestions on
focus. Tapping a result opens it for edit / delete.

### 4.4 Editing and deleting
Tap any row (ledger, Historique, Récent) → detail sheet: amount, category, date, note; Supprimer with
confirmation. Undo toast for 6 seconds after a delete.

### 4.5 Notifications
Bell dot when unread. The screen groups by Aujourd'hui / Cette semaine / Plus tôt. Tapping marks read;
buttons act in one tap (Voir Envies, Marquer payée, Voir l'objectif, Rappelle-moi, C'est réglé). Rules
and caps are in the Aam Salah spec §6: at most one per day except bills, payday, user reminders and
the Sunday recap; nothing 21:00–08:00, except a reminder the user set for a time in those hours (they
chose it). Web push (PWA) is opt-in, asked after the first week, never during onboarding: a card on the
Notifications screen ("Plus tard" hides it 30 days on the device) and an on/off switch in its footer.
Sign-out unsubscribes the device and deletes its subscription before the session ends.

### 4.6 Payday
At 08:00 Africa/Tunis on payday the new period opens: pots reset to the split of the current salary,
the savings deposit is recorded against the goal, bills for the period are reserved, one
notification ("Salaire reçu, c'est réparti"). If the user changes salary or split mid-period, the
change applies from the next payday unless they choose "appliquer maintenant".

### 4.7 Couple mode (optional)
Moi → Partager à deux → invite code. Each expense gets a small avatar of who logged it; Historique
gets a Tout / Moi filter; the home number becomes the household's. Aam Salah never edits or deletes
the partner's expenses — he proposes and the partner is notified. No other screen changes.

## 5. Design system

### 5.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F3F4F7` | App background |
| `--card` | `#FFFFFF` | Cards, sheets, ledger screens |
| `--ink` / `--ink2` / `--mut` | `#0E0F12` / `#3A3D44` / `#666B74` | Text, strong to muted |
| `--line` | `#ECEDF1` | Hairlines, empty bar tracks |
| `*-ink` | `--acc-ink #C2391B`, `--need-ink #2B5FD9`, `--want-ink #6D3FD6`, `--save-ink #0B7A52` | coloured text (≥ 4.5 : 1 on white) |
| `--acc` / `--acc-soft` | `#FF5A36` / `#FFE9E3` | The only accent: +, primary buttons, unread, highlights |
| `--need` / soft | `#3E7BFA` / `#E7EFFF` | Besoins |
| `--want` / soft | `#8B5CF6` / `#F0EAFF` | Envies |
| `--save` / soft | `#12B076` / `#E2F6EE` | Épargne, money in |
| `--warn` | `#F5A524` | 80 % thresholds |
| Radii | 24 / 18 / 12 px, pills 999 | Cards / tiles / small |
| Spacing | 8-pt grid, **one 16 px side gutter** everywhere (24 px on onboarding) |

Category colours inside a pot are **tints of the pot colour** (100, 70, 48, 30, 18 %), so Besoins
always reads blue and Envies purple.

### 5.2 Type
Plus Jakarta Sans 400–800. Numbers: 800 weight, tight tracking (−0.045 em), tabular figures, unit
("TND") set smaller and raised. Labels: 11 px, uppercase, 0.12 em tracking. Amounts are formatted with
`Intl.NumberFormat('fr-TN')` and **non-breaking** thousands separators.

### 5.3 Icons and logos
Lucide icons for the interface chrome, 1.5–2 px stroke. Categories, pots, bills and the onboarding
scenes use **3D icons**: Microsoft Fluent Emoji 3D (MIT), bundled as 160 px WebP in `src/assets/i3d`
(`src/design/i3d.tsx` maps each Lucide name to its 3D icon; a bill picks its icon from its label). They
sit on a neutral grey disc in rows. Merchant logos (STEG, Ooredoo,
Carrefour, Monoprix, Shell, Zara, Netflix…) sit at ~50–58 % inside a grey disc, no border. Logos are a
**curated, bundled set** of the most common Tunisian merchants, matched by name; everything else shows
the category icon. Logos are trademarks: ship only the curated set, and replace it with a licensed
logo service before adding more.

### 5.4 Components
Pot card · summary card with chunky segmented bar · ledger row (44 px round avatar, title, subtitle,
right-aligned amount) · day header (big date, weekday pill, `MM.YYYY`, hairline) · month bar picker ·
filter pills · search field with quick chips · bottom tab bar with raised + · speed-dial bubble · bottom
sheet (keypad, chat, detail) · confirmation card (Oui / Non) · toast · notification item with actions ·
onboarding v2 (`prototype/onboarding-v2.html`): three animated intro scenes and the login on a frosted
sheet, segmented progress, Google first then rounded e-mail fields; setup: amount input, day grid, bill
toggle card, goal card, meter.

### 5.5 Motion
| Pattern | Spec |
|---|---|
| Press | scale 0.95, 140 ms |
| Screen enter | children fade-up 16 px, 45 ms stagger, 550 ms `cubic-bezier(.2,.8,.2,1)` |
| Bars | grow from 0, 700–900 ms |
| Numbers | roll to new value, 500–750 ms ease-out cubic |
| Sheets / push screens | 320–340 ms slide |
| Feedback | bell ring on unread, nav icon pop, chat bubble pop, confetti once at reveal |
| Haptics | `navigator.vibrate` 5–12 ms on key actions (Android) |

**Everything above is disabled under `prefers-reduced-motion`.** Motion never delays input: every
animated element is interactive immediately.

### 5.6 Accessibility (WCAG 2.1 AA)
Text contrast ≥ 4.5 : 1 (3 : 1 for ≥ 18 px bold) — check white-on-pot-colour cards; touch targets
≥ 44 × 44 px (where the prototype draws a smaller button — 40 px icon buttons, 36 px pills and avatar —
a transparent `::after` extends the target); every icon button has a label; tabs, pills and toggles expose `aria-selected` /
`aria-pressed` / `aria-checked`; sheets and push screens trap focus and return it on close; live
regions for chat replies and toasts; the month bar picker is keyboard-operable; no information by
colour alone (pot names always shown next to colours). White text never sits on `--acc` (3.0 : 1): the
prototype's orange CTAs use `--acc-cta` `#D43F1C` (4.6 : 1), disabled `--acc-cta-off` `#FFC3B5`.

## 6. Content and voice
French, "tu", short sentences, no jargon, no guilt. Aam Salah speaks in the chat, the notifications,
the Historique one-liner and onboarding bubbles — nowhere else. Interface labels are neutral
("Enregistrer", "Tout voir"). All strings live in one French resource file.

## 7. Data model

Replaces today's single JSON document per user (`budget_data.data`) and per household
(`household_shared_data.data`) with normalised tables. Reasons: the assistant edits and deletes single
expenses by id; search spans a year; partners write concurrently; the JSON merge functions have had to
be rewritten for every new key.

**Money is stored as integer millimes** (1 TND = 1 000 millimes) — never floats. Dates are `date`
(local, Africa/Tunis); instants are `timestamptz`.

| Table | Key columns |
|---|---|
| `profiles` | `user_id` PK, `first_name`, `salary_mil`, `payday` (1–28 or 0 = last day), `split_needs/wants/savings` (sum 100), `onboarded_at` |
| `households`, `household_members` | kept from today |
| `expenses` | `id` uuid (client-generated), `user_id`, `household_id` null, `amount_mil` > 0, `category`, `pot` (`needs`/`wants`), `label` ≤ 60, `spent_on` date, `source` (`manual`/`chat`/`bill`), `bill_id` null, `created_at`, `updated_at`, `deleted_at` |
| `bills` | `id`, `user_id`, `household_id` null, `label`, `amount_mil`, `frequency` (`monthly`/`bimonthly`/`quarterly`/`yearly`), `day`, `starts_on` (anchors non-monthly bills), `active` |
| `bill_payments` | `bill_id`, `period_start` date, `expense_id` — unique (`bill_id`, `period_start`) |
| `debts` | `id`, `user_id`, `direction` (`i_owe`/`owed_to_me`), `person`, `amount_mil`, `due_on` null, `note`, `settled_at` null, `deleted_at` (Phase 3: undo of a chat `add_debt`) |
| `goals` | `id`, `user_id`, `name`, `icon`, `target_mil`, `created_at`, `archived_at` |
| `savings_moves` | `id`, `user_id`, `goal_id`, `amount_mil` (signed), `kind` (`payday`/`deposit`/`withdraw`), `from_pot` null, `occurred_on` — `from_pot` is the pot the money **leaves** (deposit) or **arrives in** (withdraw); null for payday and for an income put straight into savings, which never touch Besoins or Envies |
| `incomes` (Phase 3) | `id`, `user_id`, `amount_mil` > 0, `pot` (`needs`/`wants`), `label` ≤ 60, `received_on` date, `created_at`, `updated_at`, `deleted_at` — extra money kept in a pot for its period (raises that pot's `left`); an income to Épargne is a `savings_moves` deposit instead |
| `reminders` | `id`, `user_id`, `text`, `remind_at`, `done_at`, `deleted_at` (Phase 3) |
| `notifications` | `id`, `user_id`, `trigger`, `dedupe_key` unique per user, `title`, `body`, `action` jsonb, `created_at`, `read_at` |
| `push_subscriptions` | `user_id`, `endpoint`, keys, `created_at` |
| `ai_events` | `user_id`, `model`, `latency_ms`, `outcome` (`ok`/`invalid_json`/`validation_drop`/`fallback`/`error`), `action_types`, `created_at` — **no message text** |

Rules: RLS enabled and **forced** on every table; policies per operation (as `budget_data` does
today); household rows readable and writable by members only; soft delete (`deleted_at`) with a
90-day purge job; `updated_at` maintained by trigger.

`updated_at` on every mutable table; hard delete only for `savings_moves` and `bill_payments`
(undo) and `push_subscriptions` (unsubscribe); `households`/`household_members` are forced only
when their owner bypasses RLS (see migration 20260923).

Further decisions from Phase 0 review: `goals.archived_at` closes a goal (soft delete);
`bills.starts_on` defaults to the Africa/Tunis date. `anon` has zero grants on every new table;
`authenticated` gets, table by table, only the operations that table's policies actually use (e.g.
no `delete` on `expenses`, `debts`, `goals`, `reminders` or `bills` — none of them has a delete
policy — and only column-scoped `update (read_at)` on `notifications`), and
`TRUNCATE`/`REFERENCES`/`TRIGGER` are revoked from both roles on every new table. FORCE row level
security does not constrain Supabase's `postgres` owner — it has BYPASSRLS, so forcing is
defence-in-depth and a flag `scripts/check-supabase.ts` can verify, not a barrier against that
role; the real protection is the policies together with these grants. `ai_events.model` is checked
against `^[a-z0-9._:/-]{1,80}$` (a model id, never free text) and `action_types` holds at most 10
entries matching `^[a-z_]{2,30}$`; the database enforces "no message text". `notifications` has no
`updated_at`, because `read_at` only moves from null to a date. `expenses.category` is a format
check in the database and the full enum in zod, so new categories need no migration.

Derived figures (remaining, per day, trends, simulations) are **never stored**: one shared module
computes them for the screens and for the assistant's carnet (today's `budget-facts.js`, rewritten
in TypeScript).

Chat history stays on the device (IndexedDB, last 50 turns), not in the database.

## 8. Technical requirements

### 8.1 Architecture

```
PWA (Vite + TypeScript + Preact)      Cloudflare Pages Function (TS)        Supabase
 ├ screens, design system              ├ /api/aam          (assistant)       ├ Auth (e-mail, Google)
 ├ state: signals + query cache        └ shared: facts, schemas, validators  ├ Postgres + RLS
 ├ outbox (IndexedDB) for writes  ───────────────────────────────────────►   ├ Edge Function notify-run
 ├ service worker (push; offline later)                                      │  (pg_cron + pg_net, 15 min)
 └ shared: facts, schemas ◄────────────── same package, imported by both     └ Realtime (couple sync)
```

**Notifications (Phase 4).** The cron is the Supabase Edge Function `notify-run`, scheduled by
`pg_cron` + `pg_net` every 15 minutes (Vercel's free plan runs a cron only once a day, and the service
key stays out of Vercel). Its logic lives in `src/server/notify/` and `src/shared/notify/`, bundled by
`npm run build:notify`. There is no `/api/push/subscribe`: RLS already lets a user insert and delete
their own `push_subscriptions` rows, so the app writes them with the user's JWT. The app reads
`notifications` through the local mirror (last 60 days) and marks them read through the outbox as a
`read_at`-only update.

```
```

**Stack decision (proposed).** Today's single 5 400-line `app.js` cannot be safely rebuilt screen by
screen. Proposed: **Vite + TypeScript (strict) + Preact** (React API, ~4 kB) with Preact Signals for
state, plain CSS with the §5 tokens as custom properties, `lucide-preact`, and `zod` for every schema
shared between client, server and assistant. Hosting moved from Vercel to Cloudflare Pages at launch (Phase 7, 2026-09-27).

### 8.2 Code organisation
```
src/
  app/            routing, shell, tab bar, sheets
  features/       budget/ pot/ history/ goal/ me/ notifications/ onboarding/ chat/ add/
  design/         tokens.css, components/ (Button, Pill, Sheet, LedgerRow, SegmentedBar…)
  data/           supabase client, repositories per table, outbox, sync
  shared/         facts.ts (budget maths), money.ts (millimes), dates.ts (pay period, Africa/Tunis),
                  schemas.ts (zod), i18n/fr.json
api/              aam.ts (the notification cron is supabase/functions/notify-run, §8.1)
lib/aam-salah/    instructions.ts, carnet.ts, validate-actions.ts, providers.ts
supabase/migrations/
tests/            unit/ e2e/ eval/
```
One component per file, files under ~300 lines, no module reaching into another feature's internals.

### 8.3 Reliability — the user never sees the app break
| Situation | Behaviour |
|---|---|
| Offline or slow network | Writes go to the IndexedDB outbox and show immediately (optimistic); an offline badge appears; sync runs on reconnect with exponential backoff |
| Duplicate submits / retries | Client-generated UUIDs make every write idempotent (upsert on `id`) |
| Two devices / partners edit the same row | Last write wins per row on `updated_at`; Realtime pushes the change to the other device |
| Save fails permanently (validation) | Row marked, toast with "Réessayer / Supprimer"; nothing silently dropped |
| AI provider slow or down | 12 s timeout → fallback provider → local French parser (today's `localReply`) for logging expenses; the chat says so in one line |
| AI returns invalid JSON or invalid actions | Dropped server-side; a safe "redis-moi le montant" reply; logged to `ai_events` |
| Session expires | Silent refresh; if impossible, keep unsynced writes and ask to log in again — never lose them |
| New version deployed | Service worker shows "Nouvelle version — Recharger"; never reloads under the user |
| Every screen | Has loading (skeleton), empty and error states designed — no blank screens, no spinners over 300 ms without a skeleton |

### 8.4 Performance budgets (mid-range Android, 4G)
First load LCP ≤ 2.5 s; repeat load ≤ 1 s (service-worker cache); JS ≤ 150 kB gzipped on first load
(chat and onboarding code-split); interaction response ≤ 100 ms; 60 fps on scroll and sheet
animations (animate `transform` and `opacity` only); chat p95 ≤ 4 s.

### 8.5 Security and privacy
- RLS forced on every table; server functions use the **caller's JWT**, never the service key, except
  the notification cron, which is scoped per user in code and audited. That cron is the `notify-run`
  Edge Function: the service key is Supabase's own built-in secret there and never reaches Cloudflare, Vercel or
  `.env`; the cron secret lives only in Supabase Vault.
- Secrets only in environment variables (Cloudflare Pages / `.env`, gitignored); rotation documented;
  API keys never reach the browser.
- Content-Security-Policy, HSTS, `X-Content-Type-Options`, `Referrer-Policy` headers in `src/public/_headers` (Cloudflare Pages).
- Every user-supplied string is escaped (Preact escapes by default; no `dangerouslySetInnerHTML`).
- `/api/aam` rate-limited per user (30 turns / 10 min, counted from `ai_events`) and size-capped
  (32 kB); assistant output validated before use (Aam Salah spec §5, §7). The legacy app keeps
  `/api/chat` until Phase 7, which removes it.
- `ai_events` stores no message text; provider data-retention settings reviewed before launch.
- Dependencies: lockfile committed, Dependabot, `npm audit` in CI.
- Export and account deletion available in Moi (data belongs to the user).

### 8.6 Quality gates
| Layer | Tooling | Gate |
|---|---|---|
| Types and lint | TypeScript strict, ESLint, Prettier | CI fails on any error |
| Unit | Vitest | Money, dates/pay periods, facts, validators, action parsing — ≥ 90 % line coverage on `shared/` |
| Components | Vitest + Testing Library | Key components render their loading/empty/error states |
| End-to-end | Playwright, iPhone 13 and Pixel 7 viewports | Onboarding, log (manual + chat), edit, delete + undo, search, month switch, offline log then sync |
| Accessibility | axe in Playwright | No serious or critical violations |
| Visual | Playwright screenshots | Diff review on design-system changes |
| Assistant | `scripts/eval-aam-salah` (24 cases) | ≥ 22 / 24 (rate 0.9167; 26 / 28 with today's 28 cases) before any prompt or model change ships; nightly run |

The eval gate fails loudly on a malformed `--min-rate` (including the `--min-rate=` form) or when
0 cases run.

GitHub's `schedule` trigger and Dependabot both only run from the repository's DEFAULT branch
(`main` in the `stouchi` repo). `.github/workflows/eval.yml` runs nightly from it, on every push
to `main` that touches `lib/aam-salah/**` or the eval script, and by hand; it can always be run
locally: `npm run eval -- --min-rate 0.9167`.

Every pull request: CI green + Cloudflare Pages preview + checklist (states, a11y, reduced motion, strings in
`fr.json`). `main` is always deployable; production is the `production` branch, updated by pushing a tested
`main` to it (Phase 7 D11).

### 8.7 Observability
Error tracking with release tags in the browser and in `/api/aam` (PostHog since Phase 7 D10;
nothing the user typed is sent); structured JSON logs in functions (no PII); a
small dashboard on `ai_events` (latency, fallback rate, validation drops) and sync failures. Alert when
chat error rate > 5 % over 15 minutes or sync failures spike.

### 8.8 Assistant
Everything is specified in the Aam Salah spec. Model decision: see its §9.

## 9. Migration and rollout
1. **Backups**: export every `budget_data` and `household_shared_data` row before anything runs.
2. **Schema**: new tables alongside the old ones.
3. **Backfill**: idempotent script converting each JSON document into rows (amounts → millimes,
   dates → `date`, ids preserved); verification report comparing monthly totals old vs new per user.

   **Backfill rules (decided in Phase 0)**
   - Today's app budgets by calendar month, so payday becomes 1.
   - The old envelope is kept as the pot, so monthly totals match.
   - Ids are uuidv5 of `<source>:<kind>:<legacy id>`, so the backfill is idempotent.
   - A household's shared goal becomes ONE goal, owned by the household's anchor member: the
     earliest-joined onboarded member, ties broken by `user_id`. Members' mirrored goal settings
     are ignored.
   - Old "épargne" expenses become deposits into that goal. The opening deposit is
     `saved − Σ épargne deposits`, so the balance equals the old `saved`; if it would be negative,
     an issue is raised.
   - A non-anchor member's own épargne stays an expense in their name.
   - The author of a shared expense is unknowable (legacy `who` is device-relative), so it is
     attributed to the anchor, with one aggregate issue per household.
   - Tombstones are skipped.
   - Everything not converted is reported as an issue.
   - Verification fails on any per-source/month/pot mismatch, or on any failed invariant: every
     bill and debt accounted for, one profile per onboarded account, goal balance = legacy
     `saved`, and each move owned by its goal's owner. `appDiffs` lists where the new numbers
     differ from what `budget-facts.js` showed.
   - The CLI defaults to a dry run; `--apply` writes only when verification passes.
4. **Dual period**: the new app reads and writes the new tables; the old app stays reachable read-only
   for two weeks.
5. **Cut-over**: old tables archived, not dropped, for 90 days.

## 10. Build phases (detailed in the implementation plan)
0. Foundations — tooling, CI, design tokens and components, schema + RLS, backfill script, eval in CI.
1. Core budget — Budget, pot ledger, manual add, edit/delete, Historique (browse + search), offline outbox.
2. First run — intro, auth, setup, reveal, payday period logic.
3. Aam Salah v2 — server-side instructions and carnet, actions + confirmation cards, fallbacks, eval gate.
4. Notifications — rules engine (cron), in-app screen, web push opt-in.
5. Objectif and Moi — goal, deposits, settings, export, delete account.
6. Couple mode on the new model.
7. Hardening — performance, accessibility, E2E coverage, migration dry run, launch.

## 11. Decisions to confirm in review
1. **Stack**: Vite + TypeScript + Preact (proposed) versus keeping vanilla JS.
2. **Data**: normalised tables with a one-time migration (proposed) versus keeping JSON documents.
3. **Pay period** instead of calendar month for all figures (proposed).
4. **Web push** opt-in after the first week (proposed).

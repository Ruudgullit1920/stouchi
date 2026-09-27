# Currency choice — design

Status: design approved in chat 2026-09-27 · Ships **after** the 1 November launch (not part of Session C).
Parent spec: `2026-09-23-stouchi-redesign-design.md` (§4 onboarding, §7 data model, §5 money display).

## 1. Why

Stouchi is used outside Tunisia too: the owner lives in Tunisia and wants dinars, his brother lives in
France and wants euros. Today "TND" is hard-coded everywhere.

## 2. Behaviour (what the user sees)

- **Display only, never conversion.** The currency is a label plus a number of decimals. Changing it
  keeps every stored amount: 100 TND becomes 100 € after switching to EUR. The app says so.
- **Onboarding:** a new step **"Ta devise"** between the first name and the salary (the salary is typed
  in that currency). Nine rows, radio style: symbol, French name, code. Pre-selected from the device
  time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`, table in `currencies.ts`: Africa/Tunis →
  TND, Europe/Paris → EUR, Europe/London → GBP, America/Toronto → CAD, …); unknown zone → TND. Not the
  browser language: many Tunisian phones run `fr-FR`.
- **Settings (Moi):** a "Devise" row showing the current code, opening a sheet with the same list and the
  notice "Tes montants ne sont pas convertis." In a couple, the notice adds that the change applies to
  both partners. Needs a connection (like the couple actions); offline the row explains why it is
  disabled.
- **Couples: one currency per household.** `couple_join` sets the joiner's currency to the host's; when
  they differed, the join confirmation says "Ta devise passe à {code}". A change in Settings updates both
  partners.

### 2.1 The picker (onboarding step and Settings sheet share one component)

The priority is that it is obvious and quick: one glance, one tap.

- **Round flags.** Each row starts with a 32 px circular flag (EUR shows the EU flag). The flags are
  the nine SVGs from the MIT-licensed `circle-flags` set, copied into `src/assets/flags/` with the
  licence. They are imported as asset URLs, so they stay out of the first-load JS, and the service
  worker precaches them like the 3D icons. Emoji flags are not used: Windows shows letters instead.
- **Row:** flag · French name ("Euro") · a muted line with the symbol and the code ("€ · EUR"). Each
  row is at least 56 px tall with the whole row tappable (spec §5.6 targets). The selected row gets the
  accent border, a light tint and a check mark, with the existing motion tokens (reduced motion
  respected).
- **Suggested first.** The currency guessed from the time zone sits at the top with a small
  "Suggérée" tag, already selected, so most people just press "Continuer". The other eight follow
  in table order (§3).
- **Live preview** under the list: "Exemple : 1 250,50 €", updating with the selection, so people see
  what they are choosing.
- **Accessibility:** a real `radiogroup` (arrow keys, `aria-checked`); the flag is decorative
  (`alt=""`) because the name is always written.
- Strings in `fr.json`: step title "Ta devise", subtitle "Tous tes montants s'afficheront dans cette
  devise.", the Settings notice, the "Suggérée" tag, the example line.

## 3. Currencies

Source of truth: `src/shared/currencies.ts` (code → French name, suffix, decimals, time zones).

| Code | Suffix shown | Decimals | Also parsed from input |
|---|---|---|---|
| TND | TND | 3 | dt, dinar(s) |
| EUR | € | 2 | eur, euro(s) |
| USD | $ | 2 | usd, dollar(s) |
| GBP | £ | 2 | gbp, livre(s) |
| CAD | $ CA | 2 | cad |
| CHF | CHF | 2 | franc(s) |
| MAD | DH | 2 | mad, dirham(s) |
| DZD | DA | 2 | dzd, dinar(s) |
| LYD | LYD | 3 | ld, dinar(s) |

All use the French number format already in use: `1 200,50 €`, suffix after a no-break space. Adding a
currency is one entry in this table plus the SQL check list (§4).

## 4. Data

- **Storage unit unchanged.** Amounts stay integers in thousandths of the unit (`Mil`), whatever the
  currency. For 2-decimal currencies the input refuses a third decimal, so the last digit stays 0. No
  data migration; splits, periods, the 1 000 000 cap and all existing money logic are untouched.
  An old amount with a third decimal (12,345 TND) shown in a 2-decimal currency is rounded half-up for
  display only (12,35 €); totals are summed on `Mil` and rounded once. The stored value changes only if
  the person edits it.
- **Migration** (additive): `profiles.currency text not null default 'TND'` with a check on the nine
  codes. Existing users and the backfill stay TND with no action.
- **RPC `set_currency(p_code text)`**, `security definer`, `search_path` pinned, granted to
  `authenticated` only: validates the code, updates the caller's profile and, when the caller is in a
  household, their partner's. Touches no one else.
- **`couple_join`**: copies the host's `currency` to the joiner inside the same transaction.
- The local mirror carries `currency` like the other profile fields.

## 5. Code

- `src/shared/money.ts`: `formatTnd` → `formatMoney(mil, { unit, sign, currency })`; `parseTnd` →
  `parseMoney(input, currency)` (strips that currency's suffixes, rejects more decimals than allowed).
  `milFromTnd` keeps its name (legacy import only). Components read the currency from the profile
  signal; server code and tests pass it explicitly.
- `src/shared/i18n/fr.json`: every literal "TND" becomes `{unit}`; `t()` fills `unit` from the current
  currency unless the caller passes one. `export.col.amount` becomes "Montant ({code})".
- `keypad.ts` / `AmountInput.tsx`: decimal limit follows the currency.
- **Notifications** (`notify-run`): reads `profiles.currency`, formats with it, passes `unit` to the
  templates.
- **Aam Salah:** the turn context states the currency and its decimals; examples in
  `lib/aam-salah/instructions.js` use the unit from context; `turn.ts` requires amounts to fit the
  currency's decimals. The eval stays TND.
- `localParser.ts` / `ledger.ts` / `carnet.ts` / `exportCsv.ts`: follow the renames and `{unit}`.

## 6. Tests

- **Unit:** format and parse for each of the nine currencies (decimals, suffixes, negatives, `sign`);
  time zone → currency guess; `t()` fills `{unit}`; `fr.json` has no literal "TND" left; parsing refuses
  `12,345 €` and accepts `12,345 TND`.
- **DB (PGlite):** the check rejects an unknown code; `set_currency` updates self and partner, nobody
  else, and refuses anonymous callers; `couple_join` copies the host's currency.
- **Picker:** unit test for the suggested-first order and the keyboard radiogroup; E2E screenshots of
  the step on iPhone 13 and Pixel 7; the nine flags load (no 404 / HTML fallback).
- **E2E:** onboarding with EUR → reveal and home show €; Settings change TND → EUR keeps the same
  figures with the new suffix.
- `npm run check`, `npm run build && npm run check:size` (first load ≤ 150 kB gzip).

## 7. Out of scope

Conversion, exchange rates, several currencies at once, currencies beyond the nine, locale-specific
number formats (e.g. `$1,200.50`).

## 8. Follow-ups in the parent spec

On implementation, update the redesign spec: §4 (onboarding steps), §7 (`profiles.currency`,
`set_currency`) and the money wording that says TND only.

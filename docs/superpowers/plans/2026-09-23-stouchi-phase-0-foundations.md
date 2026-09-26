# Stouchi Rebuild — Phase 0: Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the rebuild's foundations: a strict TypeScript toolchain with every §8.6 quality gate wired into CI, the shared money / pay-period / category / schema modules, the normalised Supabase schema with forced RLS, the design-system components, and a verified, idempotent backfill. The live app is not touched.

**Architecture:** The new app is a Vite + Preact + TypeScript project rooted at `src/`, on a `rebuild` branch. The live vanilla app (root `index.html`, `app.js`, `api/chat.js`) stays exactly as it is on `master` and in production until Phase 7. The new tables are added next to the old JSON tables in one additive migration. That migration is tested locally in PGlite (Postgres running in-process, no Docker), with Supabase's `auth.uid()`, roles and extensions stubbed. The backfill is a pure converter plus a verifier, wrapped in a thin CLI that defaults to a dry run.

**Tech Stack:**
- Node 24.
- Frontend: TypeScript 6.0 (strict), Vite 8, Preact 10.29, zod 4, lucide-preact, Plus Jakarta Sans (self-hosted via @fontsource).
- Tests: Vitest 5 with @testing-library/preact and jsdom; Playwright 1.63 with @axe-core/playwright; PGlite 0.5 for the database.
- Tooling: ESLint 9 with typescript-eslint and jsx-a11y; Prettier 3; tsx to run scripts; supabase-js 2; GitHub Actions for CI.

**Spec:**
- `docs/superpowers/specs/2026-09-23-stouchi-redesign-design.md` covers product, design and technical requirements (§5 design system, §7 data model, §8 technical, §9 migration, §10 phases).
- `docs/superpowers/specs/2026-09-23-aam-salah-assistant-design.md` covers the assistant. Only its eval gate is used here.

---

## Where this plan sits

Spec §10 has eight phases. Each phase gets its own plan, written when the previous phase ships, so that each plan is based on code that actually exists.

| Phase | Plan | Delivers | Gates it adds |
|---|---|---|---|
| **0 Foundations** | **this file** | Toolchain, CI, shared modules, schema + RLS, design components, backfill, eval in CI | Types/lint, unit ≥ 90 % on `shared/`, component states, axe on the component gallery, eval |
| 1 Core budget | next | Budget, pot ledger, manual add, edit/delete + undo, Historique (browse + search), offline outbox, `facts.ts` | E2E: log manual, edit, delete + undo, search, month switch, offline log → sync |
| 2 First run | later | Intro, auth, setup (5 questions), reveal, payday logic | E2E: onboarding |
| 3 Aam Salah v2 | later | `api/chat.ts`, server-built carnet, action cards, `ai_events` | E2E: log by chat; chat p95 ≤ 4 s |
| 4 Notifications | later | Rules cron, Notifications screen, web push opt-in | — |
| 5 Objectif & Moi | later | Goal, deposits, settings, export, account deletion | — |
| 6 Couple mode | later | Sharing on the new model | RLS tests for couple writes |
| 7 Hardening & launch | later | Performance budgets, full E2E, real backfill, cut-over | Every §8.6 gate green; production deploy |

## Things only the user can do (asked for at the step that needs them)

1. **Rotate the Gemini key** that was pasted in chat, then save the new one as the GitHub secret `GEMINI_API_KEY` (Task 10).
2. **Create a dedicated test account** in the app and put its credentials in `.env` as `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` (Task 9).
3. **Approve applying the additive migration to the production Supabase project** (Task 9). It only creates new tables and functions and changes nothing the live app reads.
4. *Optional:* put `SUPABASE_SERVICE_ROLE_KEY` in `.env` to run the backfill **dry run** against real data (Task 8). The backfill is never applied in Phase 0.

## Global Constraints

- Money is **integer millimes** (1 TND = 1 000 millimes), never floats. The cap is 1 000 000 TND = `1 000 000 000` millimes, the same cap as today's app (`MAX_AMOUNT`).
- Dates are `YYYY-MM-DD` strings local to **Africa/Tunis**; instants are `timestamptz` / ISO strings with an offset.
- The budget period is the **pay period**. Payday is **1–28, or 0 = the last day of the month**. The period is labelled by the month it mostly covers.
- The default split is **Besoins 50 % · Envies 30 % · Épargne 20 %**, and a split always adds up to 100.
- Amounts are formatted with `Intl.NumberFormat('fr-TN')` and **non-breaking** thousands separators.
- **All UI strings live in `src/shared/i18n/fr.json`.** French, "tu", no emoji in the interface chrome, **Lucide icons only**.
- Design tokens are spec §5.1, with the contrast fixes listed under Spec deviations. Plus Jakarta Sans 400–800. There is one 16 px side gutter.
- Accessibility is WCAG 2.1 AA:
  - text contrast ≥ 4.5 : 1;
  - touch targets ≥ 44 × 44 px;
  - icon buttons are labelled;
  - `aria-pressed` on toggles;
  - sheets trap focus and return it on close;
  - live regions for toasts;
  - **everything animated is off under `prefers-reduced-motion`**;
  - only `transform` and `opacity` are animated.
- **RLS is enabled AND forced on every table**, with one policy per operation. `user_id` never changes after insert.
- Secrets live only in `.env` (gitignored) or GitHub/Vercel secrets. API keys never reach the browser. The **service role key** is used only by the one-off backfill CLI, locally, and never on Vercel.
- One component per file, and files stay under ~300 lines.
- TypeScript is `strict`. Coverage is **≥ 90 % lines on `src/shared/`**.
- **Toolchain pins:**
  - `typescript@6.0.3`, because typescript-eslint 8.70 requires TS `<6.1`;
  - `eslint@9`, because eslint-plugin-jsx-a11y 6.10 supports ESLint only up to 9.
- **The live app is not touched.**
  - All work happens on branch `rebuild`, and nothing is merged to `master` in Phase 0.
  - Production is not deployed.
  - Legacy files are excluded from lint and format.
- Commit messages are in French, matching the repo's history, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test UUIDs must be valid RFC 4122 values (for example `00000000-0000-4000-8000-000000000001`). zod 4's `z.uuid()` rejects `11111111-1111-1111-…`.

## Spec deviations (decided in this plan; Task 11 writes them back into the spec)

1. **`--mut` changes from `#8A8F98` to `#666B74`.** `#8A8F98` is 3.3 : 1 on white, which fails §5.6's 4.5 : 1. `#666B74` is 5.4 : 1 on white and 4.9 : 1 on `--bg`. Text-safe "ink" variants are also added: `--acc-ink #C2391B`, `--need-ink #2B5FD9`, `--want-ink #6D3FD6` and `--save-ink #0B7A52`. White text sits on `--ink` only, never on `--acc`: white on `#FF5A36` is 3.0 : 1.
2. **`bills.starts_on date` is added.** Without it, bimonthly, quarterly and yearly bills have no anchor month.
3. **`updated_at` is added to `goals`, `debts`, `reminders`, `bills` and `profiles`.** §8.3's last-write-wins sync needs it on every mutable table.
4. **Hard deletes are allowed only where undo needs them:**
   - `savings_moves` (undo a deposit);
   - `bill_payments` (undo "Marquer payée");
   - `push_subscriptions` (unsubscribe).

   Everything else is soft-deleted (`expenses.deleted_at`) or closed through a state column (`active`, `settled_at`, `done_at`, `read_at`).
5. **The backfill uses the service role key**, as a one-off admin script. This is an exception to §8.5, like the notification cron.
6. **Category keys follow the assistant's validator** (`abonnement`), not the prototype's `abo`. A test keeps the app and the assistant in agreement.
7. **The eval now has 28 cases.** The gate is expressed as a rate of 22 / 24 = **0.9167**, which means 26 / 28 today.
8. **A pay period split evenly between two months** (payday 16 in a 30-day month) is labelled with the **later** month.
9. **The font is self-hosted** (`@fontsource-variable/plus-jakarta-sans`) instead of loaded from Google Fonts. This works offline in the PWA and keeps the CSP to `'self'`.
10. **`households` and `household_members` get `force row level security` only when their owner bypasses RLS** (Supabase's `postgres` does). Otherwise the security-definer membership check would recurse and break today's couple sharing. The migration raises a warning instead of breaking production.

## Review Focus

These are the inputs a real user will hit that the spec implies but no feature test would naturally exercise. Each one has its tests in the task that owns the code.

1. **Amounts typed the Tunisian way.**
   - `"1.200"` means 1 dinar 200 millimes; `"12,5"`, `"1 200"` and `"45 dt"` are also accepted.
   - Ambiguous input (`"1,2,3"`, `"12 5"`, 4 decimals) is refused, never guessed.
   - Tests: Task 1.
2. **Pay-period edges.**
   - Payday 0 in February and in a leap year; payday 28 across February.
   - The payday itself opens the new period.
   - 23:30 UTC is already tomorrow in Tunis.
   - Tests: Task 2.
3. **Messy legacy documents.**
   - `null` or array `data`, string amounts, negative or zero amounts, impossible dates, duplicate ids, garbage entries in arrays.
   - Shared expenses are mirrored in both partners' rows.
   - Each case is converted or reported, never crashes, and is never double-counted.
   - Tests: Task 7.
4. **Re-running the backfill.**
   - The same rows come out with the same ids, and two users' `"e1"` never collide.
   - A verification mismatch blocks every write.
   - Tests: Tasks 7 and 8.
5. **A partner or stranger writing where they shouldn't.**
   - Moving a row into a household they're not in.
   - Rewriting `user_id`.
   - Paying someone else's bill, or depositing into someone else's goal.
   - Editing a notification's text.
   - Tests: Task 4.

---

## File structure

```
package.json                      scripts + pinned devDependencies (modify)
tsconfig.json                     strict TS for src/, tests/, scripts/**/*.ts, configs
eslint.config.mjs                 TS + jsx-a11y; ignores all legacy .js
.prettierrc.json
vite.config.mts                   root = src/, build → dist/
vitest.config.mts                 unit + db tests, coverage gate on src/shared
playwright.config.ts              iPhone 13 (WebKit) + Pixel 7 (Chromium)
vercel.json                       (modify) Vite build + security headers — previews of this branch only
.gitignore                        (modify) dist, coverage, playwright output, .backfill
.env.example                      (modify) TEST_USER_*, SUPABASE_SERVICE_ROLE_KEY
.github/workflows/ci.yml          every gate on push/PR
.github/workflows/eval.yml        Aam Salah eval: nightly + on assistant changes
.github/dependabot.yml

src/index.html                    the new app's page (root index.html stays the live app)
src/main.tsx                      mounts <App/>, imports font + tokens
src/app/App.tsx                   Phase 0: renders the Gallery
src/shared/money.ts               millimes: parse, convert, format, split
src/shared/dates.ts               Tunis today, ISO date maths, pay periods
src/shared/categories.ts          category keys → pot + icon; labels via i18n
src/shared/schemas.ts             zod row + insert schemas for §7 tables
src/shared/i18n/fr.json           every UI string
src/shared/i18n/t.ts              t(key, vars)
src/design/tokens.css             spec §5.1 tokens (+ contrast fixes)
src/design/base.css               reset, type, focus ring, reduced motion
src/design/components/components.css
src/design/components/{Button,Pill,Amount,LedgerRow,SegmentedBar,Sheet,Toast,Skeleton,EmptyState,ErrorState}.tsx
src/design/Gallery.tsx            every component in every state (E2E + axe target)
src/design/gallery.css

supabase/migrations/20260923_redesign_schema.sql   §7 tables, triggers, RLS, rls_report()

scripts/supabase-check/tables.ts  SPEC_TABLES (shared by db tests and the check)
scripts/supabase-check/verdict.ts pure pass/fail logic
scripts/check-supabase.ts         CLI: reachable + RLS forced + round trip per table
scripts/backfill/uuid5.ts         deterministic ids
scripts/backfill/legacy.ts        today's categories, envelopes, amounts, dates
scripts/backfill/convert.ts       pure: legacy docs → §7 rows + issues
scripts/backfill/verify.ts        pure: per-month/pot totals old vs new
scripts/backfill/run.ts           backup → convert → verify → (apply) with injected I/O
scripts/backfill/cli.ts           Supabase source/sink, --apply flag
scripts/eval-aam-salah.js         (modify) --min-rate exit code

tests/unit/{money,dates,i18n,categories,schemas}.test.ts
tests/unit/design/{states,controls,overlays}.test.tsx
tests/unit/backfill/{fixtures.ts,convert.test.ts,run.test.ts}
tests/unit/supabase-verdict.test.ts
tests/db/harness.ts               PGlite + Supabase stubs + migrations + seed users
tests/db/rls.test.ts
tests/e2e/design.spec.ts
```

---

### Task 1: Branch, baseline, toolchain and `money.ts`

**Files:**
- Create: `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json`, `vitest.config.mts`, `src/shared/money.ts`, `tests/unit/money.test.ts`
- Modify: `package.json` (scripts, dependencies), `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces, in `src/shared/money.ts`:
  - `type Mil = number`; `MIL_PER_TND = 1000`; `MAX_MIL = 1_000_000_000`
  - `parseTnd(input: string): Mil | null`
  - `milFromTnd(x: number): Mil | null`
  - `formatTnd(mil: Mil, opts?: { unit?: boolean; sign?: boolean }): string`
  - `interface Split { needs: number; wants: number; savings: number }`; `DEFAULT_SPLIT: Split`
  - `isValidSplit(s: Split): boolean`
  - `splitSalary(salary: Mil, split: Split): { needs: Mil; wants: Mil; savings: Mil }`
- Also produces the npm scripts `check`, `test`, `test:coverage`, `test:legacy`, `typecheck`, `lint`, `format`, `format:check`.

- [ ] **Step 1: Create the branch and clear the two empty stray entries at the repo root**

Earlier mistyped shell commands left an empty file named `'` and an empty directory named `-p`. They were checked on 2026-09-23 and both are empty. Check again, and delete them only if they're still empty:

```bash
git switch -c rebuild
wc -c -- "'" && ls -A -- "-p"      # expect: 0 bytes, and no entries in -p
rm -- "'" && rmdir -- "-p"
```

If either one now has content, stop and ask the user.

- [ ] **Step 2: Commit the existing uncommitted work as the baseline**

The working tree holds the reviewed hardening of the live app, `lib/aam-salah/`, the prototype, the specs and the tests. None of it is on any branch yet.

```bash
git add -A
git diff --cached --name-only | grep -E '^\.env$' && echo "STOP: .env is staged" || echo ".env not staged"
git diff --cached --name-only | grep -E '(^|/)\.(eval|superpowers|claude-flow)/' && echo "STOP: ignored dirs staged" || echo ok
git commit -m "Base de la refonte : assistant Aam Salah côté serveur, prototype, durcissement du proxy" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `.env not staged`, `ok`, and one commit on `rebuild`.

- [ ] **Step 3: Install pinned dependencies**

```bash
npm install preact@10.29.8 zod@4.6.5 lucide-preact@1.47.0 @supabase/supabase-js@2.117.1 @fontsource-variable/plus-jakarta-sans@5.3.0
npm install -D typescript@6.0.3 vite@8.3.0 @preact/preset-vite@2.10.6 @babel/core@7 vitest@5.0.1 @vitest/coverage-v8@5.0.1 jsdom@30.1.1 @testing-library/preact@3.2.4 @playwright/test@1.63.0 @axe-core/playwright@4.13.0 eslint@9 @eslint/js@9 typescript-eslint@8.70.1 eslint-plugin-jsx-a11y@6.10.2 prettier@3.9.9 @electric-sql/pglite@0.5.8 tsx@4.23.15 @types/node@24
```

Expected: this creates `package-lock.json`, which is committed as spec §8.5 requires. `npm` may print peer warnings for `@babel/core`, and those can be ignored.

- [ ] **Step 4: Replace the `scripts` block in `package.json`**

Keep `name`, `private`, `version` and `main`. Do **not** add `"type": "module"`, because the live app's `.js` files are CommonJS.

```json
  "scripts": {
    "start": "node server.js",
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc",
    "lint": "eslint .",
    "format": "prettier --write --no-error-on-unmatched-pattern \"src/**/*.{ts,tsx,css,json,html}\" \"tests/**/*.{ts,tsx}\" \"scripts/**/*.ts\" \"*.mts\" playwright.config.ts tsconfig.json",
    "format:check": "prettier --check --no-error-on-unmatched-pattern \"src/**/*.{ts,tsx,css,json,html}\" \"tests/**/*.{ts,tsx}\" \"scripts/**/*.ts\" \"*.mts\" playwright.config.ts tsconfig.json",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:legacy": "node --test \"test/**/*.test.js\"",
    "e2e": "playwright test",
    "check": "npm run format:check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:legacy",
    "backfill": "tsx scripts/backfill/cli.ts",
    "check:supabase": "tsx scripts/check-supabase.ts",
    "eval": "node scripts/eval-aam-salah.js"
  },
```

- [ ] **Step 5: Write the tool configs**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node", "vite/client"]
  },
  "include": ["src", "tests", "scripts/**/*.ts", "*.mts", "playwright.config.ts"]
}
```

`eslint.config.mjs`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/* Scope: the rebuild's TypeScript only. Today's app (app.js, server.js, api/,
   lib/, scripts/*.js, test/) stays as it is until cut-over (spec §9). */
export default tseslint.config(
  {
    ignores: [
      'dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**',
      'prototype/**', '.superpowers/**', '**/*.js', '**/*.mjs', '**/*.cjs',
    ],
  },
  {
    files: ['**/*.{ts,tsx,mts}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  { files: ['src/**/*.tsx'], ...jsxA11y.flatConfigs.recommended },
);
```

`.prettierrc.json`:

```json
{ "singleQuote": true, "printWidth": 110 }
```

`vitest.config.mts`:

```ts
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  /* JSX → Preact; no HMR runtime inside tests */
  plugins: [preact({ prefreshEnabled: false, devToolsEnabled: false })],
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/db/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90 },
    },
  },
});
```

Append to `.gitignore`:

```
dist/
coverage/
playwright-report/
test-results/
# backfill backups and reports hold real users' data
.backfill/
```

- [ ] **Step 6: Write the failing test `tests/unit/money.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SPLIT,
  MAX_MIL,
  formatTnd,
  isValidSplit,
  milFromTnd,
  parseTnd,
  splitSalary,
} from '../../src/shared/money';

describe('parseTnd', () => {
  it.each([
    ['12', 12_000],
    ['12,5', 12_500],
    ['12.5', 12_500],
    ['1.200', 1_200], // Tunisian price tags: 1 dinar 200 millimes
    ['12,500', 12_500],
    ['1 200', 1_200_000],
    ['1 200,75', 1_200_750],
    ['1 200', 1_200_000],
    ['0', 0],
    [' 45 dt', 45_000],
    ['45 TND', 45_000],
    ['7 dinars', 7_000],
  ])('%j → %i millimes', (input, mil) => {
    expect(parseTnd(input)).toBe(mil);
  });

  it.each(['', 'abc', '-5', '1,2,3', '12.3456', '1 20', '12 5', '1e3', '١٢'])('%j is refused', (input) => {
    expect(parseTnd(input)).toBeNull();
  });

  it('refuses amounts above the cap', () => {
    expect(parseTnd('1 000 000')).toBe(MAX_MIL);
    expect(parseTnd('1 000 001')).toBeNull();
  });
});

describe('milFromTnd', () => {
  it('rounds float dinars to whole millimes', () => {
    expect(milFromTnd(12.345)).toBe(12_345);
    expect(milFromTnd(0.1 + 0.2)).toBe(300);
    expect(milFromTnd(-5)).toBe(-5_000);
  });

  it('refuses NaN, Infinity and amounts above the cap', () => {
    expect(milFromTnd(Number.NaN)).toBeNull();
    expect(milFromTnd(Number.POSITIVE_INFINITY)).toBeNull();
    expect(milFromTnd(1_000_001)).toBeNull();
  });
});

describe('formatTnd', () => {
  it('groups thousands with a non-breaking space and keeps the unit attached', () => {
    const s = formatTnd(1_200_000);
    expect(s).toMatch(/^1[  ]200 TND$/);
    expect(s).not.toContain(' ');
  });

  it('shows millimes only when there are some', () => {
    expect(formatTnd(12_500, { unit: false })).toBe('12,5');
    expect(formatTnd(12_000, { unit: false })).toBe('12');
    expect(formatTnd(1, { unit: false })).toBe('0,001');
  });

  it('uses a real minus sign, and a plus only when asked', () => {
    expect(formatTnd(-8_000, { unit: false })).toBe('−8');
    expect(formatTnd(200_000, { unit: false, sign: true })).toBe('+200');
    expect(formatTnd(0, { unit: false, sign: true })).toBe('0');
  });
});

describe('splitSalary', () => {
  it('splits 50/30/20 and never loses a millime', () => {
    expect(splitSalary(2_500_000, DEFAULT_SPLIT)).toEqual({ needs: 1_250_000, wants: 750_000, savings: 500_000 });
    const odd = splitSalary(1_001, DEFAULT_SPLIT);
    expect(odd.needs + odd.wants + odd.savings).toBe(1_001);
    expect(odd).toEqual({ needs: 501, wants: 300, savings: 200 });
  });

  it('handles a zero salary and a 100/0/0 split', () => {
    expect(splitSalary(0, DEFAULT_SPLIT)).toEqual({ needs: 0, wants: 0, savings: 0 });
    expect(splitSalary(999, { needs: 100, wants: 0, savings: 0 })).toEqual({ needs: 999, wants: 0, savings: 0 });
  });

  it('accepts only whole percentages that add up to 100', () => {
    expect(isValidSplit(DEFAULT_SPLIT)).toBe(true);
    expect(isValidSplit({ needs: 50, wants: 30, savings: 30 })).toBe(false);
    expect(isValidSplit({ needs: 50.5, wants: 29.5, savings: 20 })).toBe(false);
    expect(isValidSplit({ needs: -10, wants: 90, savings: 20 })).toBe(false);
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run tests/unit/money.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/shared/money"`.

- [ ] **Step 8: Implement `src/shared/money.ts`**

```ts
/* Money is integer millimes: 1 TND = 1 000 millimes. Never floats (spec §7). */

export type Mil = number;
export const MIL_PER_TND = 1000;
/** 1 000 000 TND — the same cap as today's app. */
export const MAX_MIL = 1_000_000_000;

const GROUP = '[ \\u00a0\\u202f]';
/* "1 200" (groups of three) or "1200", then optional "," or "." and 1–3 decimals.
   Both separators are decimal: Tunisian prices read "1.200 DT" = 1 dinar 200. */
const AMOUNT = new RegExp(`^(\\d{1,3}(?:${GROUP}\\d{3})+|\\d+)(?:[.,](\\d{1,3}))?$`);

/** What a person types → millimes, or null when it can't be read without guessing. */
export function parseTnd(input: string): Mil | null {
  const s = input.trim().replace(/\s*(?:tnd|dt|dinars?)$/i, '');
  const m = AMOUNT.exec(s);
  if (!m) return null;
  const whole = Number(m[1].replace(/[   ]/g, ''));
  const mil = whole * MIL_PER_TND + Number((m[2] ?? '').padEnd(3, '0'));
  return mil > MAX_MIL ? null : mil;
}

/** A dinar amount stored as a float (today's documents) → millimes. */
export function milFromTnd(x: number): Mil | null {
  if (!Number.isFinite(x)) return null;
  const mil = Math.round(x * MIL_PER_TND);
  return Math.abs(mil) > MAX_MIL ? null : mil;
}

const NUMBER = new Intl.NumberFormat('fr-TN', { maximumFractionDigits: 3 });

/** "1 200 TND" with non-breaking spaces; "−8" for negatives; "+200" when `sign`. */
export function formatTnd(mil: Mil, { unit = true, sign = false }: { unit?: boolean; sign?: boolean } = {}): string {
  const prefix = mil < 0 ? '−' : sign && mil > 0 ? '+' : '';
  return prefix + NUMBER.format(Math.abs(mil) / MIL_PER_TND) + (unit ? ' TND' : '');
}

export interface Split {
  needs: number;
  wants: number;
  savings: number;
}
export const DEFAULT_SPLIT: Split = { needs: 50, wants: 30, savings: 20 };

export function isValidSplit(s: Split): boolean {
  const parts = [s.needs, s.wants, s.savings];
  return parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 100) && s.needs + s.wants + s.savings === 100;
}

/** Salary → three pots that add up to the salary exactly (largest remainder; ties go to needs). */
export function splitSalary(salary: Mil, split: Split): { needs: Mil; wants: Mil; savings: Mil } {
  const exact = [split.needs, split.wants, split.savings].map((p) => (salary * p) / 100);
  const parts = exact.map((x) => Math.floor(x));
  let left = salary - parts.reduce((a, b) => a + b, 0);
  const order = [0, 1, 2].sort((a, b) => exact[b] - parts[b] - (exact[a] - parts[a]) || a - b);
  for (const i of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return { needs: parts[0], wants: parts[1], savings: parts[2] };
}
```

- [ ] **Step 9: Run every gate**

Run: `npm run format && npm run check`
Expected:
- Prettier rewrites nothing in the check;
- `tsc` prints nothing;
- ESLint prints nothing;
- Vitest shows all money tests passing and `money.ts` at ≥ 90 % lines;
- `test:legacy` shows 17 passing.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json eslint.config.mjs .prettierrc.json vitest.config.mts .gitignore src/shared/money.ts tests/unit/money.test.ts
git commit -m "Refonte : outillage strict (TS, ESLint, Prettier, Vitest) et monnaie en millimes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pay periods and Tunis dates (`dates.ts`)

**Files:**
- Create: `src/shared/dates.ts`, `tests/unit/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, in `src/shared/dates.ts`:
  - `type ISODate = string`; `type Payday = number`
  - `interface PayPeriod { start: ISODate; end: ISODate; label: string /* YYYY-MM */ }`
  - `todayTunis(now?: Date): ISODate`
  - `isValidISODate(s: string): boolean`
  - `addDays(d: ISODate, n: number): ISODate`
  - `daysBetween(a: ISODate, b: ISODate): number`
  - `daysInMonth(year: number, month: number /* 1–12 */): number`
  - `payPeriod(date: ISODate, payday: Payday): PayPeriod`, which throws `RangeError` on bad input
  - `periodsBack(today: ISODate, payday: Payday, n: number): PayPeriod[]`, newest first
  - `daysLeft(today: ISODate, p: PayPeriod): number`, counting today
  - `nextPayday(today: ISODate, payday: Payday): ISODate`
  - `isInPeriod(d: ISODate, p: PayPeriod): boolean`

- [ ] **Step 1: Write the failing test `tests/unit/dates.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  daysLeft,
  isInPeriod,
  isValidISODate,
  nextPayday,
  payPeriod,
  periodsBack,
  todayTunis,
} from '../../src/shared/dates';

describe('todayTunis', () => {
  it('is the date in Tunis (UTC+1), not in UTC', () => {
    expect(todayTunis(new Date('2026-09-22T23:30:00Z'))).toBe('2026-09-23');
    expect(todayTunis(new Date('2026-09-22T22:59:59Z'))).toBe('2026-09-22');
  });
});

describe('ISO date maths', () => {
  it('knows real dates', () => {
    expect(isValidISODate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-9-1', '', '2026-02-30']) expect(isValidISODate(bad)).toBe(false);
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(29);
  });
});

describe('payPeriod', () => {
  it('payday 1 is the calendar month', () => {
    expect(payPeriod('2026-09-23', 1)).toEqual({ start: '2026-09-01', end: '2026-09-30', label: '2026-09' });
  });

  it('payday 25 runs 25 → 24; the payday itself opens the new period', () => {
    expect(payPeriod('2026-09-23', 25)).toEqual({ start: '2026-08-25', end: '2026-09-24', label: '2026-09' });
    expect(payPeriod('2026-09-25', 25)).toEqual({ start: '2026-09-25', end: '2026-10-24', label: '2026-10' });
  });

  it('payday 0 is the last day of each month, February and leap years included', () => {
    expect(payPeriod('2026-03-15', 0)).toEqual({ start: '2026-02-28', end: '2026-03-30', label: '2026-03' });
    expect(payPeriod('2028-02-29', 0)).toEqual({ start: '2028-02-29', end: '2028-03-30', label: '2028-03' });
    expect(payPeriod('2026-12-31', 0)).toEqual({ start: '2026-12-31', end: '2027-01-30', label: '2027-01' });
  });

  it('payday 28 across February', () => {
    expect(payPeriod('2026-03-01', 28)).toEqual({ start: '2026-02-28', end: '2026-03-27', label: '2026-03' });
  });

  it('is named after the month holding most of its days; an even split names the later month', () => {
    expect(payPeriod('2026-10-20', 15)).toEqual({ start: '2026-10-15', end: '2026-11-14', label: '2026-10' });
    expect(payPeriod('2026-09-20', 16)).toEqual({ start: '2026-09-16', end: '2026-10-15', label: '2026-10' });
  });

  it('refuses impossible dates and paydays', () => {
    expect(() => payPeriod('2026-02-30', 1)).toThrow(RangeError);
    expect(() => payPeriod('2026-09-01', 29)).toThrow(RangeError);
    expect(() => payPeriod('2026-09-01', 1.5)).toThrow(RangeError);
  });
});

describe('around a period', () => {
  it('lists the last n periods, newest first, back to back', () => {
    const list = periodsBack('2026-09-23', 25, 12);
    expect(list).toHaveLength(12);
    expect(list[0]).toEqual(payPeriod('2026-09-23', 25));
    for (let i = 1; i < list.length; i++) expect(addDays(list[i].end, 1)).toBe(list[i - 1].start);
    expect(list[11].start).toBe('2025-09-25');
  });

  it('counts days left including today, and finds the next payday', () => {
    const p = payPeriod('2026-09-23', 25);
    expect(daysLeft('2026-09-23', p)).toBe(2);
    expect(daysLeft(p.end, p)).toBe(1);
    expect(nextPayday('2026-09-23', 25)).toBe('2026-09-25');
    expect(nextPayday('2026-09-25', 25)).toBe('2026-10-25');
    expect(nextPayday('2026-02-10', 0)).toBe('2026-02-28');
    expect(isInPeriod('2026-09-24', p)).toBe(true);
    expect(isInPeriod('2026-09-25', p)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/dates.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/shared/dates"`.

- [ ] **Step 3: Implement `src/shared/dates.ts`**

```ts
/* Dates are 'YYYY-MM-DD' strings in Africa/Tunis (spec §7); they compare as strings.
 * The budget period is the pay period (spec §3): payday 1–28, or 0 = last day. */

export type ISODate = string;
export type Payday = number;
export interface PayPeriod {
  start: ISODate;
  end: ISODate;
  /** YYYY-MM of the month holding most of the period's days */
  label: string;
}

const TUNIS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Tunis',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayTunis(now: Date = new Date()): ISODate {
  const p = Object.fromEntries(TUNIS.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toUtc = (d: ISODate) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
const fromUtc = (d: Date): ISODate => d.toISOString().slice(0, 10);

export function isValidISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fromUtc(x);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The payday falling in (year, month); month may be 0 or 13 when stepping. */
function paydayIn(year: number, month: number, payday: Payday): ISODate {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  return `${y}-${pad(m)}-${pad(payday === 0 ? daysInMonth(y, m) : payday)}`;
}

function check(date: ISODate, payday: Payday): void {
  if (!isValidISODate(date)) throw new RangeError(`not a date: ${date}`);
  if (!Number.isInteger(payday) || payday < 0 || payday > 28) throw new RangeError(`payday must be 0–28: ${payday}`);
}

export function payPeriod(date: ISODate, payday: Payday): PayPeriod {
  check(date, payday);
  const [y, m] = date.split('-').map(Number);
  const here = paydayIn(y, m, payday);
  const start = date >= here ? here : paydayIn(y, m - 1, payday);
  const [sy, sm] = start.split('-').map(Number);
  const end = addDays(paydayIn(sy, sm + 1, payday), -1);
  const inFirstMonth = daysBetween(start, `${start.slice(0, 7)}-${pad(daysInMonth(sy, sm))}`) + 1;
  const total = daysBetween(start, end) + 1;
  return { start, end, label: inFirstMonth > total - inFirstMonth ? start.slice(0, 7) : end.slice(0, 7) };
}

export function periodsBack(today: ISODate, payday: Payday, n: number): PayPeriod[] {
  const out: PayPeriod[] = [];
  let p = payPeriod(today, payday);
  for (let i = 0; i < n; i++) {
    out.push(p);
    p = payPeriod(addDays(p.start, -1), payday);
  }
  return out;
}

export const daysLeft = (today: ISODate, p: PayPeriod): number => daysBetween(today, p.end) + 1;
export const nextPayday = (today: ISODate, payday: Payday): ISODate => addDays(payPeriod(today, payday).end, 1);
export const isInPeriod = (d: ISODate, p: PayPeriod): boolean => d >= p.start && d <= p.end;
```

- [ ] **Step 4: Run every gate**

Run: `npm run format && npm run check`
Expected: everything passes, and `dates.ts` is at ≥ 90 % lines.

- [ ] **Step 5: Commit**

```bash
git add src/shared/dates.ts tests/unit/dates.test.ts
git commit -m "Refonte : période de paie et dates de Tunis" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Strings, categories and table schemas

**Files:**
- Create: `src/shared/i18n/fr.json`, `src/shared/i18n/t.ts`, `src/shared/categories.ts`, `src/shared/schemas.ts`, `tests/unit/i18n.test.ts`, `tests/unit/categories.test.ts`, `tests/unit/schemas.test.ts`

**Interfaces:**
- Consumes: `MAX_MIL` and `isValidSplit` from Task 1.
- Produces:
  - `t.ts`:
    - `type StringKey = keyof typeof fr`
    - `t(key: StringKey, vars?: Record<string, string | number>): string`
  - `categories.ts`:
    - `type Pot = 'needs' | 'wants'`
    - `CATEGORY_KEYS` (19 keys, readonly tuple); `type CategoryKey`
    - `CATEGORIES: Record<CategoryKey, { icon: string; pot: Pot }>`
    - `potOf(k)`, `isCategory(k: string): k is CategoryKey`, `categoryLabel(k): string`, `categoriesIn(pot): CategoryKey[]`
  - `schemas.ts`:
    - zod row schemas `ProfileRow`, `ExpenseRow`, `BillRow`, `DebtRow`, `GoalRow`, `SavingsMoveRow`, `ReminderRow`
    - insert schemas `ProfileInsert`, `ExpenseInsert`, `BillInsert`, `DebtInsert`, `GoalInsert`, `SavingsMoveInsert`, `ReminderInsert`
    - types `Profile`, `NewProfile`, `Expense`, `NewExpense`, `Bill`, `NewBill`, `Debt`, `NewDebt`, `Goal`, `NewGoal`, `SavingsMove`, `NewSavingsMove`, `Reminder`, `NewReminder`

- [ ] **Step 1: Write `src/shared/i18n/fr.json`**

This file holds data rather than behaviour, so it comes first.

```json
{
  "app.name": "Stouchi",
  "unit.tnd": "TND",
  "pot.needs": "Besoins",
  "pot.wants": "Envies",
  "pot.savings": "Épargne",
  "category.courses": "Courses",
  "category.loyer": "Loyer",
  "category.factures": "Factures",
  "category.transport": "Transport",
  "category.essence": "Essence",
  "category.sante": "Santé",
  "category.maison": "Maison",
  "category.ecole": "École",
  "category.credit": "Crédit",
  "category.resto": "Resto",
  "category.cafe": "Café",
  "category.shopping": "Shopping",
  "category.vetements": "Vêtements",
  "category.sortie": "Sortie",
  "category.voyage": "Voyage",
  "category.abonnement": "Abonnement",
  "category.cadeau": "Cadeau",
  "category.beaute": "Beauté",
  "category.autre": "Autre",
  "goal.type.epargne": "Épargne",
  "goal.type.voyage": "Voyage",
  "goal.type.maison": "Maison",
  "goal.type.voiture": "Voiture",
  "goal.type.mariage": "Mariage",
  "goal.type.etudes": "Études",
  "goal.type.securite": "Sécurité",
  "bill.default": "Facture",
  "debt.someone": "Quelqu’un",
  "period.daysLeft": "{n} jours restants",
  "action.close": "Fermer",
  "action.retry": "Réessayer",
  "action.undo": "Annuler",
  "state.loading": "Chargement…",
  "state.error.title": "Ça n’a pas marché",
  "state.error.body": "Vérifie ta connexion et réessaie.",
  "gallery.title": "Composants",
  "gallery.pots": "Pots",
  "gallery.remaining": "Reste à dépenser",
  "gallery.ledger": "Lignes",
  "gallery.pills": "Filtres",
  "gallery.all": "Tout",
  "gallery.buttons": "Boutons",
  "gallery.primary": "Enregistrer",
  "gallery.openSheet": "Ouvrir la feuille",
  "gallery.showToast": "Afficher un toast",
  "gallery.toast": "Dépense supprimée.",
  "gallery.sheetTitle": "Détail de la dépense",
  "gallery.sheetBody": "Montant, catégorie, date et note s’affichent ici.",
  "gallery.states": "États",
  "gallery.empty.title": "Rien ce mois-ci",
  "gallery.empty.body": "Tes dépenses apparaîtront ici."
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { t } from '../../src/shared/i18n/t';

describe('t', () => {
  it('returns the French string', () => {
    expect(t('pot.needs')).toBe('Besoins');
  });

  it('fills {placeholders} and leaves unknown ones visible', () => {
    expect(t('period.daysLeft', { n: 3 })).toBe('3 jours restants');
    expect(t('period.daysLeft', {})).toBe('{n} jours restants');
  });
});
```

`tests/unit/categories.test.ts`:

```ts
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CATEGORY_KEYS, categoriesIn, categoryLabel, isCategory, potOf } from '../../src/shared/categories';

/* The assistant's server validator forces the pot from the category; if the two
   lists drift, a chat expense lands in a different pot than a manual one. */
const { CAT_POT } = createRequire(import.meta.url)('../../lib/aam-salah/validate.js') as {
  CAT_POT: Record<string, 'besoins' | 'envies'>;
};

describe('categories', () => {
  it('the assistant and the app agree on every category and its pot', () => {
    expect(Object.keys(CAT_POT).sort()).toEqual([...CATEGORY_KEYS].sort());
    for (const k of CATEGORY_KEYS) expect(CAT_POT[k]).toBe(potOf(k) === 'needs' ? 'besoins' : 'envies');
  });

  it('every category has a French label', () => {
    for (const k of CATEGORY_KEYS) {
      expect(categoryLabel(k)).toEqual(expect.any(String));
      expect(categoryLabel(k)).not.toBe('');
    }
    expect(categoryLabel('cafe')).toBe('Café');
  });

  it('splits into 9 needs and 10 wants; unknown keys are refused', () => {
    expect(categoriesIn('needs')).toHaveLength(9);
    expect(categoriesIn('wants')).toHaveLength(10);
    expect(isCategory('abonnement')).toBe(true);
    expect(isCategory('abo')).toBe(false);
  });
});
```

`tests/unit/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BillRow,
  DebtRow,
  ExpenseInsert,
  ExpenseRow,
  GoalRow,
  ProfileRow,
  ReminderRow,
  SavingsMoveInsert,
  SavingsMoveRow,
} from '../../src/shared/schemas';

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
/* exactly what PostgREST returns for a timestamptz */
const AT = '2026-09-23T10:00:00.123456+00:00';

const expense = {
  id: U2, user_id: U1, household_id: null, amount_mil: 12_000, category: 'cafe', pot: 'wants',
  label: 'Café', spent_on: '2026-09-22', source: 'chat', bill_id: null,
  created_at: AT, updated_at: AT, deleted_at: null,
};
const profile = {
  user_id: U1, first_name: 'Sofiene', salary_mil: 2_500_000, payday: 25,
  split_needs: 50, split_wants: 30, split_savings: 20, onboarded_at: AT, created_at: AT, updated_at: AT,
};
const move = { id: U2, user_id: U1, goal_id: U1, amount_mil: 100_000, kind: 'deposit', from_pot: 'wants', occurred_on: '2026-09-22', created_at: AT };

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe('row schemas accept what the database returns', () => {
  it.each([
    ['expense', ExpenseRow, expense],
    ['profile', ProfileRow, profile],
    ['move', SavingsMoveRow, move],
    ['bill', BillRow, { id: U2, user_id: U1, household_id: null, label: 'STEG', amount_mil: 95_000, frequency: 'quarterly', day: 12, starts_on: '2026-08-01', active: true, created_at: AT, updated_at: AT }],
    ['debt', DebtRow, { id: U2, user_id: U1, direction: 'owed_to_me', person: 'Karim', amount_mil: 50_000, due_on: null, note: '', settled_at: null, created_at: AT, updated_at: AT }],
    ['goal', GoalRow, { id: U2, user_id: U1, name: 'Voyage', icon: 'plane', target_mil: 20_000_000, created_at: AT, updated_at: AT }],
    ['reminder', ReminderRow, { id: U2, user_id: U1, text: 'Payer la STEG', remind_at: AT, done_at: null, created_at: AT, updated_at: AT }],
  ])('%s', (_name, schema, value) => {
    expect(ok(schema, value)).toBe(true);
  });
});

describe('the same limits as the database', () => {
  it.each([
    ['amount 0', { amount_mil: 0 }],
    ['amount above the cap', { amount_mil: 1_000_000_001 }],
    ['millimes as a float', { amount_mil: 12.5 }],
    ['label of 61 characters', { label: 'x'.repeat(61) }],
    ['unknown category', { category: 'abo' }],
    ['impossible date', { spent_on: '2026-02-30' }],
    ['not a uuid', { id: '11111111-1111-1111-1111-111111111111' }],
  ])('refuses an expense with %s', (_why, patch) => {
    expect(ok(ExpenseRow, { ...expense, ...patch })).toBe(false);
  });

  it('a label of exactly 60 characters is fine', () => {
    expect(ok(ExpenseRow, { ...expense, label: 'x'.repeat(60) })).toBe(true);
  });

  it('a split must add up to 100 and payday must be 0–28', () => {
    expect(ok(ProfileRow, { ...profile, split_savings: 30 })).toBe(false);
    expect(ok(ProfileRow, { ...profile, payday: 29 })).toBe(false);
    expect(ok(ProfileRow, { ...profile, payday: 0 })).toBe(true);
  });

  it('withdrawals are negative, deposits positive, never zero', () => {
    expect(ok(SavingsMoveRow, { ...move, kind: 'withdraw', amount_mil: 100_000 })).toBe(false);
    expect(ok(SavingsMoveRow, { ...move, kind: 'withdraw', amount_mil: -100_000 })).toBe(true);
    expect(ok(SavingsMoveRow, { ...move, amount_mil: -1 })).toBe(false);
    expect(ok(SavingsMoveRow, { ...move, amount_mil: 0 })).toBe(false);
    /* the insert schema keeps the sign rule (created_at is simply stripped) */
    expect(ok(SavingsMoveInsert, { ...move, kind: 'withdraw', amount_mil: 5 })).toBe(false);
  });

  it('insert schemas leave server-owned columns out', () => {
    const parsed = ExpenseInsert.parse(expense);
    expect(parsed).not.toHaveProperty('created_at');
    expect(parsed).not.toHaveProperty('deleted_at');
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run tests/unit/i18n.test.ts tests/unit/categories.test.ts tests/unit/schemas.test.ts`
Expected: FAIL, because `t`, `categories` and `schemas` can't be resolved.

- [ ] **Step 4: Implement `src/shared/i18n/t.ts`**

```ts
import fr from './fr.json';

export type StringKey = keyof typeof fr;

/** The French string for `key`, with {name} placeholders filled from `vars`. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const text: string = fr[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
```

- [ ] **Step 5: Implement `src/shared/categories.ts`**

```ts
/* Categories and the pot each one draws from. Same keys and pots as the
   assistant's validator (lib/aam-salah/validate.js) — a test keeps them equal. */
import { t, type StringKey } from './i18n/t';

export type Pot = 'needs' | 'wants';

export const CATEGORY_KEYS = [
  'courses', 'loyer', 'factures', 'transport', 'essence', 'sante', 'maison', 'ecole', 'credit',
  'resto', 'cafe', 'shopping', 'vetements', 'sortie', 'voyage', 'abonnement', 'cadeau', 'beaute', 'autre',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** icon = Lucide icon name */
export const CATEGORIES: Record<CategoryKey, { icon: string; pot: Pot }> = {
  courses: { icon: 'shopping-cart', pot: 'needs' },
  loyer: { icon: 'key-round', pot: 'needs' },
  factures: { icon: 'zap', pot: 'needs' },
  transport: { icon: 'bus', pot: 'needs' },
  essence: { icon: 'fuel', pot: 'needs' },
  sante: { icon: 'heart-pulse', pot: 'needs' },
  maison: { icon: 'wrench', pot: 'needs' },
  ecole: { icon: 'graduation-cap', pot: 'needs' },
  credit: { icon: 'landmark', pot: 'needs' },
  resto: { icon: 'utensils', pot: 'wants' },
  cafe: { icon: 'coffee', pot: 'wants' },
  shopping: { icon: 'shopping-bag', pot: 'wants' },
  vetements: { icon: 'shirt', pot: 'wants' },
  sortie: { icon: 'ticket', pot: 'wants' },
  voyage: { icon: 'plane', pot: 'wants' },
  abonnement: { icon: 'tv', pot: 'wants' },
  cadeau: { icon: 'gift', pot: 'wants' },
  beaute: { icon: 'scissors', pot: 'wants' },
  autre: { icon: 'circle-ellipsis', pot: 'wants' },
};

export const potOf = (k: CategoryKey): Pot => CATEGORIES[k].pot;
export const isCategory = (k: string): k is CategoryKey => (CATEGORY_KEYS as readonly string[]).includes(k);
export const categoryLabel = (k: CategoryKey): string => t(`category.${k}` as StringKey);
export const categoriesIn = (pot: Pot): CategoryKey[] => CATEGORY_KEYS.filter((k) => CATEGORIES[k].pot === pot);
```

- [ ] **Step 6: Implement `src/shared/schemas.ts`**

```ts
/* zod schemas for the spec §7 tables — one source of truth for the client, the
 * server and the backfill. Limits mirror the SQL checks in
 * supabase/migrations/20260923_redesign_schema.sql; the db tests pin both.
 *
 * Refinements sit on top of plain objects: zod 4 refuses .omit() on a refined object. */
import { z } from 'zod';
import { CATEGORY_KEYS } from './categories';
import { MAX_MIL, isValidSplit } from './money';

const uuid = z.uuid();
const mil = z.int().min(0).max(MAX_MIL);
const positiveMil = z.int().min(1).max(MAX_MIL);
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const pot = z.enum(['needs', 'wants']);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);

/* ── profiles ── */
const ProfileBase = z.object({
  user_id: uuid,
  first_name: text(0, 40),
  salary_mil: mil,
  payday: z.int().min(0).max(28),
  split_needs: z.int().min(0).max(100),
  split_wants: z.int().min(0).max(100),
  split_savings: z.int().min(0).max(100),
  onboarded_at: instant.nullable(),
  created_at: instant,
  updated_at: instant,
});
const splitAddsUp = (p: { split_needs: number; split_wants: number; split_savings: number }) =>
  isValidSplit({ needs: p.split_needs, wants: p.split_wants, savings: p.split_savings });
const SPLIT_ERROR = { message: 'the split must add up to 100', path: ['split_savings'] };
export const ProfileRow = ProfileBase.refine(splitAddsUp, SPLIT_ERROR);
export const ProfileInsert = ProfileBase.omit({ created_at: true, updated_at: true }).refine(splitAddsUp, SPLIT_ERROR);

/* ── expenses ── */
export const ExpenseRow = z.object({
  id: uuid,
  user_id: uuid,
  household_id: uuid.nullable(),
  amount_mil: positiveMil,
  category: z.enum(CATEGORY_KEYS),
  pot,
  label: text(0, 60),
  spent_on: date,
  source: z.enum(['manual', 'chat', 'bill']),
  bill_id: uuid.nullable(),
  created_at: instant,
  updated_at: instant,
  deleted_at: instant.nullable(),
});
export const ExpenseInsert = ExpenseRow.omit({ created_at: true, updated_at: true, deleted_at: true });

/* ── bills ── */
export const BillRow = z.object({
  id: uuid,
  user_id: uuid,
  household_id: uuid.nullable(),
  label: text(1, 60),
  amount_mil: positiveMil,
  frequency: z.enum(['monthly', 'bimonthly', 'quarterly', 'yearly']),
  day: z.int().min(1).max(31),
  starts_on: date,
  active: z.boolean(),
  created_at: instant,
  updated_at: instant,
});
export const BillInsert = BillRow.omit({ created_at: true, updated_at: true });

/* ── debts ── */
export const DebtRow = z.object({
  id: uuid,
  user_id: uuid,
  direction: z.enum(['i_owe', 'owed_to_me']),
  person: text(1, 40),
  amount_mil: positiveMil,
  due_on: date.nullable(),
  note: text(0, 120),
  settled_at: instant.nullable(),
  created_at: instant,
  updated_at: instant,
});
export const DebtInsert = DebtRow.omit({ created_at: true, updated_at: true });

/* ── goals ── */
export const GoalRow = z.object({
  id: uuid,
  user_id: uuid,
  name: text(1, 40),
  icon: z.string().regex(/^[a-z0-9-]{1,30}$/),
  target_mil: positiveMil,
  created_at: instant,
  updated_at: instant,
});
export const GoalInsert = GoalRow.omit({ created_at: true, updated_at: true });

/* ── savings moves (signed) ── */
const MoveBase = z.object({
  id: uuid,
  user_id: uuid,
  goal_id: uuid,
  amount_mil: z
    .int()
    .min(-MAX_MIL)
    .max(MAX_MIL)
    .refine((n) => n !== 0, 'amount cannot be 0'),
  kind: z.enum(['payday', 'deposit', 'withdraw']),
  from_pot: pot.nullable(),
  occurred_on: date,
  created_at: instant,
});
const signMatchesKind = (m: { kind: string; amount_mil: number }) => (m.kind === 'withdraw') === m.amount_mil < 0;
const SIGN_ERROR = { message: 'withdrawals are negative; payday and deposits positive', path: ['amount_mil'] };
export const SavingsMoveRow = MoveBase.refine(signMatchesKind, SIGN_ERROR);
export const SavingsMoveInsert = MoveBase.omit({ created_at: true }).refine(signMatchesKind, SIGN_ERROR);

/* ── reminders ── */
export const ReminderRow = z.object({
  id: uuid,
  user_id: uuid,
  text: text(1, 120),
  remind_at: instant,
  done_at: instant.nullable(),
  created_at: instant,
  updated_at: instant,
});
export const ReminderInsert = ReminderRow.omit({ created_at: true, updated_at: true });

export type Profile = z.infer<typeof ProfileRow>;
export type NewProfile = z.infer<typeof ProfileInsert>;
export type Expense = z.infer<typeof ExpenseRow>;
export type NewExpense = z.infer<typeof ExpenseInsert>;
export type Bill = z.infer<typeof BillRow>;
export type NewBill = z.infer<typeof BillInsert>;
export type Debt = z.infer<typeof DebtRow>;
export type NewDebt = z.infer<typeof DebtInsert>;
export type Goal = z.infer<typeof GoalRow>;
export type NewGoal = z.infer<typeof GoalInsert>;
export type SavingsMove = z.infer<typeof SavingsMoveRow>;
export type NewSavingsMove = z.infer<typeof SavingsMoveInsert>;
export type Reminder = z.infer<typeof ReminderRow>;
export type NewReminder = z.infer<typeof ReminderInsert>;
```

- [ ] **Step 7: Run every gate**

Run: `npm run format && npm run check`
Expected: everything passes, and each `src/shared/*.ts` file is at ≥ 90 % lines.

- [ ] **Step 8: Commit**

```bash
git add src/shared tests/unit/i18n.test.ts tests/unit/categories.test.ts tests/unit/schemas.test.ts
git commit -m "Refonte : textes français, catégories alignées sur l'assistant, schémas des tables" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Database schema, forced RLS, and the PGlite test harness

**Files:**
- Create: `supabase/migrations/20260923_redesign_schema.sql`, `scripts/supabase-check/tables.ts`, `tests/db/harness.ts`, `tests/db/rls.test.ts`

**Interfaces:**
- Consumes: the existing `supabase/migrations/20260809_household_sharing.sql`, which provides `households`, `household_members` and `public.is_household_member(uuid)`.
- Produces:
  - **SQL:**
    - the tables `profiles`, `bills`, `expenses`, `bill_payments`, `debts`, `goals`, `savings_moves`, `reminders`, `notifications`, `push_subscriptions`, `ai_events`;
    - the functions `public.touch_updated_at()`, `public.keep_user_id()` and `public.visible_to_me(row_owner uuid, row_household uuid)`;
    - `public.rls_report() returns table (table_name text, rls_enabled boolean, rls_forced boolean)`, executable by `authenticated`.
  - **`scripts/supabase-check/tables.ts`:** `SPEC_TABLES` (13 names, dependency order) and `type SpecTable`.
  - **`tests/db/harness.ts`:**
    - `freshDb(): Promise<PGlite>`
    - `asUser<T>(db, user: string | null, sql: string, params?: unknown[]): Promise<T[]>`
    - the seed ids `ALICE`, `BOB`, `CAROL`, `HH` (Alice + Bob) and `HH2` (Carol).

- [ ] **Step 1: Write `scripts/supabase-check/tables.ts`**

```ts
/* Spec §7 tables, in dependency order. households and household_members are
   kept from today's schema; the rest are created by 20260923_redesign_schema.sql. */
export const SPEC_TABLES = [
  'profiles', 'households', 'household_members', 'goals', 'bills', 'expenses', 'bill_payments',
  'debts', 'savings_moves', 'reminders', 'notifications', 'push_subscriptions', 'ai_events',
] as const;
export type SpecTable = (typeof SPEC_TABLES)[number];
```

- [ ] **Step 2: Write the harness `tests/db/harness.ts`**

```ts
/* Postgres in-process (PGlite) with just enough of Supabase to run our
 * migrations and exercise RLS as real roles: the auth schema and auth.uid(),
 * the anon / authenticated roles with Supabase's default grants, the
 * extensions.gen_random_bytes the invite codes use, and the realtime
 * publication. Tables are owned by the superuser, which (like Supabase's
 * postgres) bypasses RLS — so setup runs as owner and every test query runs
 * as `authenticated` or `anon`. */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const ALICE = '00000000-0000-4000-8000-000000000001';
export const BOB = '00000000-0000-4000-8000-000000000002';
export const CAROL = '00000000-0000-4000-8000-000000000003';
/** Alice + Bob */
export const HH = '00000000-0000-4000-8000-0000000000a1';
/** Carol alone */
export const HH2 = '00000000-0000-4000-8000-0000000000a2';

const SUPABASE_STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$;
  grant usage on schema public, auth to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create schema if not exists extensions;
  create or replace function extensions.gen_random_bytes(n int) returns bytea language sql volatile as $$
    select substring(decode(md5(random()::text) || md5(random()::text), 'hex') from 1 for n)
  $$;
  create publication supabase_realtime;
`;

const MIGRATIONS = ['20260809_household_sharing.sql', '20260923_redesign_schema.sql'];

export async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  for (const file of MIGRATIONS) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.exec(`
    insert into auth.users (id) values ('${ALICE}'), ('${BOB}'), ('${CAROL}');
    insert into public.households (id, invite_code) values ('${HH}', 'AAAAAA'), ('${HH2}', 'BBBBBB');
    insert into public.household_members (household_id, user_id)
      values ('${HH}', '${ALICE}'), ('${HH}', '${BOB}'), ('${HH2}', '${CAROL}');
  `);
  return db;
}

/** Run one statement as a signed-in user (or as anon when `user` is null). */
export async function asUser<T = Record<string, unknown>>(
  db: PGlite,
  user: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}
```

- [ ] **Step 3: Write the failing RLS tests `tests/db/rls.test.ts`**

```ts
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { SPEC_TABLES } from '../../scripts/supabase-check/tables';
import { ALICE, BOB, CAROL, HH, HH2, asUser, freshDb } from './harness';

let db: PGlite;
beforeAll(async () => {
  db = await freshDb();
});

type Row = Record<string, unknown>;
async function insert(user: string | null, table: string, row: Row): Promise<Row> {
  const cols = Object.keys(row);
  const sql = `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`;
  return (await asUser<Row>(db, user, sql, Object.values(row)))[0];
}
const select = (user: string | null, sql: string, params: unknown[] = []) => asUser<Row>(db, user, sql, params);
const asOwner = async (sql: string, params: unknown[] = []) => (await db.query<Row>(sql, params)).rows;
const expense = (patch: Row = {}): Row => ({
  amount_mil: 12_000, category: 'cafe', pot: 'wants', label: 'Café', spent_on: '2026-09-22', ...patch,
});
const RLS = { code: '42501' };
const CHECK = { code: '23514' };

describe('RLS is on everywhere', () => {
  it('every spec §7 table has RLS enabled and forced', async () => {
    const report = await asOwner('select * from public.rls_report()');
    for (const table of SPEC_TABLES) {
      expect(report.find((r) => r.table_name === table), table).toMatchObject({ rls_enabled: true, rls_forced: true });
    }
  });

  it('anon sees and writes nothing', async () => {
    await insert(ALICE, 'expenses', expense());
    expect(await select(null, 'select * from public.expenses')).toEqual([]);
    await expect(insert(null, 'profiles', { user_id: ALICE })).rejects.toMatchObject(RLS);
  });
});

describe('expenses', () => {
  it('the owner can create, read, edit and soft-delete', async () => {
    const e = await insert(ALICE, 'expenses', expense({ label: 'Carrefour' }));
    expect(e.user_id).toBe(ALICE);
    await select(ALICE, `update public.expenses set label = 'Monoprix' where id = $1`, [e.id]);
    await select(ALICE, 'update public.expenses set deleted_at = now() where id = $1', [e.id]);
    const [row] = await select(ALICE, 'select label, deleted_at from public.expenses where id = $1', [e.id]);
    expect(row.label).toBe('Monoprix');
    expect(row.deleted_at).not.toBeNull();
  });

  it('a personal expense is invisible to everyone else, partner included', async () => {
    const e = await insert(ALICE, 'expenses', expense());
    for (const other of [BOB, CAROL]) {
      expect(await select(other, 'select id from public.expenses where id = $1', [e.id])).toEqual([]);
    }
  });

  it('household members share household expenses; outsiders do not', async () => {
    const e = await insert(ALICE, 'expenses', expense({ household_id: HH, label: 'Courses' }));
    expect(await select(BOB, 'select id from public.expenses where id = $1', [e.id])).toHaveLength(1);
    await select(BOB, `update public.expenses set label = 'Courses Aziza' where id = $1`, [e.id]);
    expect((await asOwner('select label from public.expenses where id = $1', [e.id]))[0].label).toBe('Courses Aziza');
    expect(await select(CAROL, 'select id from public.expenses where id = $1', [e.id])).toEqual([]);
  });

  it('nobody writes into a household they are not in', async () => {
    await expect(insert(CAROL, 'expenses', expense({ household_id: HH }))).rejects.toMatchObject(RLS);
    const mine = await insert(ALICE, 'expenses', expense());
    await expect(
      select(ALICE, 'update public.expenses set household_id = $2 where id = $1', [mine.id, HH2]),
    ).rejects.toMatchObject(RLS);
  });

  it('nobody creates a row in someone else’s name, or rewrites user_id later', async () => {
    await expect(insert(BOB, 'expenses', expense({ user_id: ALICE }))).rejects.toMatchObject(RLS);
    const shared = await insert(ALICE, 'expenses', expense({ household_id: HH }));
    await expect(
      select(BOB, 'update public.expenses set user_id = $2 where id = $1', [shared.id, BOB]),
    ).rejects.toMatchObject(RLS);
  });

  it('rows are never hard-deleted by a user', async () => {
    const e = await insert(ALICE, 'expenses', expense());
    expect(await select(ALICE, 'delete from public.expenses where id = $1 returning id', [e.id])).toEqual([]);
    expect(await asOwner('select id from public.expenses where id = $1', [e.id])).toHaveLength(1);
  });

  it('updated_at follows every edit', async () => {
    const e = await insert(ALICE, 'expenses', expense({ updated_at: '2020-01-01T00:00:00Z' }));
    await select(ALICE, `update public.expenses set label = 'x' where id = $1`, [e.id]);
    const [row] = await asOwner('select updated_at from public.expenses where id = $1', [e.id]);
    expect(new Date(row.updated_at as string).getFullYear()).toBeGreaterThan(2020);
  });

  it('enforces the same limits as the zod schemas', async () => {
    await expect(insert(ALICE, 'expenses', expense({ label: 'x'.repeat(60) }))).resolves.toBeDefined();
    await expect(insert(ALICE, 'expenses', expense({ label: 'x'.repeat(61) }))).rejects.toMatchObject(CHECK);
    await expect(insert(ALICE, 'expenses', expense({ amount_mil: 0 }))).rejects.toMatchObject(CHECK);
    await expect(insert(ALICE, 'expenses', expense({ amount_mil: 1_000_000_001 }))).rejects.toMatchObject(CHECK);
    await expect(insert(ALICE, 'expenses', expense({ pot: 'savings' }))).rejects.toMatchObject(CHECK);
  });
});

describe('profiles', () => {
  it('only the owner reads it; the split adds up to 100; payday is 0–28', async () => {
    await insert(ALICE, 'profiles', { first_name: 'Sofiene', salary_mil: 2_500_000, payday: 25 });
    expect(await select(BOB, 'select * from public.profiles where user_id = $1', [ALICE])).toEqual([]);
    await expect(insert(BOB, 'profiles', { split_needs: 50, split_wants: 30, split_savings: 30 })).rejects.toMatchObject(CHECK);
    await expect(insert(BOB, 'profiles', { payday: 29 })).rejects.toMatchObject(CHECK);
  });
});

describe('own-only tables', () => {
  const rows: Record<string, Row> = {
    debts: { direction: 'i_owe', person: 'Sami', amount_mil: 30_000 },
    goals: { name: 'Voyage', icon: 'plane', target_mil: 1_000_000 },
    reminders: { text: 'Payer la STEG', remind_at: '2026-09-25T08:00:00Z' },
    ai_events: { model: 'gemini:flash-lite', latency_ms: 1200, outcome: 'ok', action_types: ['add_expense'] },
  };
  it.each(Object.entries(rows))('%s: only the owner sees a row, and nobody writes one for someone else', async (table, row) => {
    await insert(ALICE, table, row);
    expect(await select(ALICE, `select * from public.${table}`)).not.toEqual([]);
    expect(await select(BOB, `select * from public.${table} where user_id = $1`, [ALICE])).toEqual([]);
    await expect(insert(BOB, table, { ...row, user_id: ALICE })).rejects.toMatchObject(RLS);
  });
});

describe('bills and payments', () => {
  it('a partner can mark a household bill paid and undo it; an outsider cannot', async () => {
    const bill = await insert(ALICE, 'bills', { household_id: HH, label: 'STEG', amount_mil: 95_000, frequency: 'quarterly', day: 12 });
    const pay = { bill_id: bill.id, period_start: '2026-09-01' };
    await insert(BOB, 'bill_payments', pay);
    await expect(insert(BOB, 'bill_payments', pay)).rejects.toMatchObject({ code: '23505' });
    await expect(insert(CAROL, 'bill_payments', { ...pay, period_start: '2026-10-01' })).rejects.toMatchObject(RLS);
    expect(await select(BOB, 'delete from public.bill_payments where bill_id = $1 returning bill_id', [bill.id])).toHaveLength(1);
  });
});

describe('savings', () => {
  it('moves go to your own goals only; the sign follows the kind; undo deletes', async () => {
    const goal = await insert(ALICE, 'goals', { name: 'Voyage', icon: 'plane', target_mil: 20_000_000 });
    const move = { goal_id: goal.id, amount_mil: 100_000, kind: 'deposit', occurred_on: '2026-09-22' };
    await expect(insert(BOB, 'savings_moves', move)).rejects.toMatchObject(RLS);
    await expect(insert(ALICE, 'savings_moves', { ...move, kind: 'withdraw' })).rejects.toMatchObject(CHECK);
    const m = await insert(ALICE, 'savings_moves', move);
    expect(await select(ALICE, 'delete from public.savings_moves where id = $1 returning id', [m.id])).toHaveLength(1);
  });
});

describe('notifications', () => {
  it('the owner reads and marks read; nobody edits the text or writes one', async () => {
    const [n] = await asOwner(
      `insert into public.notifications (user_id, trigger, dedupe_key, title, body) values ($1, 'bill_due', 'steg-2026-09', 'STEG', 'Demain') returning id`,
      [ALICE],
    );
    expect(await select(BOB, 'select id from public.notifications where id = $1', [n.id])).toEqual([]);
    expect(await select(ALICE, 'update public.notifications set read_at = now() where id = $1 returning id', [n.id])).toHaveLength(1);
    await expect(select(ALICE, `update public.notifications set title = 'x' where id = $1`, [n.id])).rejects.toMatchObject(RLS);
    await expect(insert(ALICE, 'notifications', { trigger: 'x', dedupe_key: 'y', title: 't', body: 'b' })).rejects.toMatchObject(RLS);
  });
});

describe('push subscriptions', () => {
  it('the owner subscribes and unsubscribes', async () => {
    await insert(ALICE, 'push_subscriptions', { endpoint: 'https://push.example/1', p256dh: 'k', auth: 'a' });
    expect(await select(BOB, 'select * from public.push_subscriptions')).toEqual([]);
    expect(
      await select(ALICE, `delete from public.push_subscriptions where endpoint = 'https://push.example/1' returning endpoint`),
    ).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run them and watch them fail**

Run: `npx vitest run tests/db/rls.test.ts`
Expected: FAIL, `ENOENT … 20260923_redesign_schema.sql`.

If the failure is instead a statement in `20260809_household_sharing.sql` that PGlite can't run, add the smallest stub for that one construct to `SUPABASE_STUB`, following the ones already there, and re-run. Do not edit the existing migration.

- [ ] **Step 5: Write `supabase/migrations/20260923_redesign_schema.sql`**

```sql
/* Stouchi redesign — normalised data model (spec §7).
 *
 * ADDITIVE ONLY. The new tables live alongside budget_data and
 * household_shared_data; nothing here reads, changes or drops those, so the
 * current app keeps running untouched until cut-over (spec §9).
 *
 * Conventions
 *   - Money: bigint millimes (1 TND = 1 000); 0 < amount ≤ 1 000 000 TND.
 *   - Dates: `date`, local to Africa/Tunis. Instants: `timestamptz`.
 *   - RLS enabled AND forced on every table, one policy per operation. A
 *     missing policy is a decision; it is stated next to each table.
 *   - user_id defaults to auth.uid() and never changes (keep_user_id).
 *   - updated_at is set by trigger: sync is last-write-wins on it (§8.3).
 *   - Limits match src/shared/schemas.ts; tests/db/rls.test.ts pins both.
 */

/* ── helpers ─────────────────────────────────────────────── */

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

/* `with check` only sees the new row, so without this a household member could
   hand a shared row to someone else by rewriting user_id. */
create or replace function public.keep_user_id()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot change' using errcode = '42501';
  end if;
  return new;
end $$;

/* The caller's own row, or a row of the caller's household. */
create or replace function public.visible_to_me(row_owner uuid, row_household uuid)
returns boolean language sql stable set search_path = public as $$
  select row_owner = auth.uid()
      or (row_household is not null and public.is_household_member(row_household))
$$;

/* ── tables ──────────────────────────────────────────────── */

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  first_name text not null default '' check (char_length(first_name) <= 40),
  salary_mil bigint not null default 0 check (salary_mil between 0 and 1000000000),
  payday smallint not null default 1 check (payday between 0 and 28),
  split_needs smallint not null default 50 check (split_needs between 0 and 100),
  split_wants smallint not null default 30 check (split_wants between 0 and 100),
  split_savings smallint not null default 20 check (split_savings between 0 and 100),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_split_is_100 check (split_needs + split_wants + split_savings = 100)
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  label text not null check (char_length(label) between 1 and 60),
  amount_mil bigint not null check (amount_mil > 0 and amount_mil <= 1000000000),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'bimonthly', 'quarterly', 'yearly')),
  day smallint not null default 1 check (day between 1 and 31),
  /* first period the bill is due in: anchors bimonthly/quarterly/yearly bills */
  starts_on date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),  -- normally client-generated: idempotent upserts (§8.3)
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  amount_mil bigint not null check (amount_mil > 0 and amount_mil <= 1000000000),
  category text not null check (category ~ '^[a-z_]{2,20}$'),
  pot text not null check (pot in ('needs', 'wants')),
  label text not null default '' check (char_length(label) <= 60),
  spent_on date not null,
  source text not null default 'manual' check (source in ('manual', 'chat', 'bill')),
  bill_id uuid references public.bills(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists expenses_user_spent on public.expenses (user_id, spent_on desc) where deleted_at is null;
create index if not exists expenses_household_spent on public.expenses (household_id, spent_on desc)
  where household_id is not null and deleted_at is null;

create table if not exists public.bill_payments (
  bill_id uuid not null references public.bills(id) on delete cascade,
  period_start date not null,
  expense_id uuid references public.expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (bill_id, period_start)
);

create table if not exists public.debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  direction text not null check (direction in ('i_owe', 'owed_to_me')),
  person text not null check (char_length(person) between 1 and 40),
  amount_mil bigint not null check (amount_mil > 0 and amount_mil <= 1000000000),
  due_on date,
  note text not null default '' check (char_length(note) <= 120),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists debts_open on public.debts (user_id) where settled_at is null;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  icon text not null check (icon ~ '^[a-z0-9-]{1,30}$'),
  target_mil bigint not null check (target_mil > 0 and target_mil <= 1000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.savings_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  amount_mil bigint not null check (amount_mil <> 0 and abs(amount_mil) <= 1000000000),
  kind text not null check (kind in ('payday', 'deposit', 'withdraw')),
  from_pot text check (from_pot in ('needs', 'wants')),
  occurred_on date not null,
  created_at timestamptz not null default now(),
  constraint savings_moves_sign check ((kind = 'withdraw') = (amount_mil < 0))
);
create index if not exists savings_moves_goal on public.savings_moves (goal_id, occurred_on desc);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 120),
  remind_at timestamptz not null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reminders_due on public.reminders (user_id, remind_at) where done_at is null;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trigger text not null check (trigger ~ '^[a-z_]{2,40}$'),
  dedupe_key text not null check (char_length(dedupe_key) <= 120),
  title text not null check (char_length(title) <= 80),
  body text not null check (char_length(body) <= 300),
  action jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_dedupe unique (user_id, dedupe_key)
);
create index if not exists notifications_recent on public.notifications (user_id, created_at desc);

create table if not exists public.push_subscriptions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint)
);

/* Assistant telemetry. NO message text, by design (spec §8.5). */
create table if not exists public.ai_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  model text not null check (char_length(model) <= 80),
  latency_ms integer not null check (latency_ms >= 0),
  outcome text not null check (outcome in ('ok', 'invalid_json', 'validation_drop', 'fallback', 'error')),
  action_types text[] not null default '{}',
  created_at timestamptz not null default now()
);

/* ── triggers, RLS on ────────────────────────────────────── */

do $$
declare t text;
begin
  foreach t in array array['profiles', 'bills', 'expenses', 'debts', 'goals', 'reminders'] loop
    execute format('create or replace trigger %1$s_touch before update on public.%1$I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
  foreach t in array array['profiles', 'bills', 'expenses', 'debts', 'goals', 'savings_moves',
                           'reminders', 'notifications', 'push_subscriptions', 'ai_events'] loop
    execute format('create or replace trigger %1$s_keep_user before update on public.%1$I
                    for each row execute function public.keep_user_id()', t);
  end loop;
  foreach t in array array['profiles', 'bills', 'expenses', 'bill_payments', 'debts', 'goals', 'savings_moves',
                           'reminders', 'notifications', 'push_subscriptions', 'ai_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

/* households / household_members come from 20260809 with RLS enabled but not
   forced. Their membership test (is_household_member) is security definer and
   reads household_members as the table owner. Forcing RLS on an owner that
   cannot bypass it would send that read through the policy that calls the same
   function — infinite recursion, and couple sharing breaks in production. So
   force only when the owner bypasses RLS anyway (Supabase's postgres does);
   otherwise say so and leave it for Phase 6. */
do $$
declare t text; can_bypass boolean;
begin
  foreach t in array array['households', 'household_members'] loop
    select r.rolsuper or r.rolbypassrls into can_bypass
      from pg_class c join pg_roles r on r.oid = c.relowner
     where c.oid = format('public.%I', t)::regclass;
    if can_bypass then
      execute format('alter table public.%I force row level security', t);
    else
      raise warning '% left unforced: its owner cannot bypass RLS (see comment)', t;
    end if;
  end loop;
end $$;

/* ── policies ────────────────────────────────────────────── */

/* profiles — no delete: account deletion is a server job (Phase 5). */
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "profiles: create own" on public.profiles;
create policy "profiles: create own" on public.profiles for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "profiles: edit own" on public.profiles;
create policy "profiles: edit own" on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/* expenses — no delete: soft delete (deleted_at); a 90-day purge job removes rows. */
drop policy if exists "expenses: read own or household" on public.expenses;
create policy "expenses: read own or household" on public.expenses for select to authenticated
  using (public.visible_to_me(user_id, household_id));
drop policy if exists "expenses: create own" on public.expenses;
create policy "expenses: create own" on public.expenses for insert to authenticated
  with check (user_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));
drop policy if exists "expenses: edit own or household" on public.expenses;
create policy "expenses: edit own or household" on public.expenses for update to authenticated
  using (public.visible_to_me(user_id, household_id))
  with check (public.visible_to_me(user_id, household_id)
              and (household_id is null or public.is_household_member(household_id)));

/* bills — no delete: `active = false` retires a bill and keeps its history. */
drop policy if exists "bills: read own or household" on public.bills;
create policy "bills: read own or household" on public.bills for select to authenticated
  using (public.visible_to_me(user_id, household_id));
drop policy if exists "bills: create own" on public.bills;
create policy "bills: create own" on public.bills for insert to authenticated
  with check (user_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));
drop policy if exists "bills: edit own or household" on public.bills;
create policy "bills: edit own or household" on public.bills for update to authenticated
  using (public.visible_to_me(user_id, household_id))
  with check (public.visible_to_me(user_id, household_id)
              and (household_id is null or public.is_household_member(household_id)));

/* bill_payments — visible and writable through the bill (bills' RLS applies inside
   the subquery). Delete = undo "Marquer payée". No update: recorded or undone. */
drop policy if exists "bill_payments: read" on public.bill_payments;
create policy "bill_payments: read" on public.bill_payments for select to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_payments.bill_id));
drop policy if exists "bill_payments: record" on public.bill_payments;
create policy "bill_payments: record" on public.bill_payments for insert to authenticated
  with check (exists (select 1 from public.bills b where b.id = bill_payments.bill_id)
              and (bill_payments.expense_id is null
                   or exists (select 1 from public.expenses e where e.id = bill_payments.expense_id)));
drop policy if exists "bill_payments: undo" on public.bill_payments;
create policy "bill_payments: undo" on public.bill_payments for delete to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_payments.bill_id));

/* debts, goals, reminders — own rows only; no delete (settled_at / done_at close them). */
drop policy if exists "debts: read own" on public.debts;
create policy "debts: read own" on public.debts for select to authenticated using (user_id = auth.uid());
drop policy if exists "debts: create own" on public.debts;
create policy "debts: create own" on public.debts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "debts: edit own" on public.debts;
create policy "debts: edit own" on public.debts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "goals: read own" on public.goals;
create policy "goals: read own" on public.goals for select to authenticated using (user_id = auth.uid());
drop policy if exists "goals: create own" on public.goals;
create policy "goals: create own" on public.goals for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "goals: edit own" on public.goals;
create policy "goals: edit own" on public.goals for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "reminders: read own" on public.reminders;
create policy "reminders: read own" on public.reminders for select to authenticated using (user_id = auth.uid());
drop policy if exists "reminders: create own" on public.reminders;
create policy "reminders: create own" on public.reminders for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "reminders: edit own" on public.reminders;
create policy "reminders: edit own" on public.reminders for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/* savings_moves — into your own goals only; delete = undo; no update. */
drop policy if exists "savings_moves: read own" on public.savings_moves;
create policy "savings_moves: read own" on public.savings_moves for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "savings_moves: create own" on public.savings_moves;
create policy "savings_moves: create own" on public.savings_moves for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.goals g where g.id = savings_moves.goal_id and g.user_id = auth.uid()));
drop policy if exists "savings_moves: undo own" on public.savings_moves;
create policy "savings_moves: undo own" on public.savings_moves for delete to authenticated
  using (user_id = auth.uid());

/* notifications — written by the notification cron (service role) only. Users
   read theirs and set read_at; the column grant below stops them editing text. */
drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own" on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "notifications: mark read" on public.notifications;
create policy "notifications: mark read" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

/* push_subscriptions — subscribe / unsubscribe; no update. */
drop policy if exists "push: read own" on public.push_subscriptions;
create policy "push: read own" on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists "push: subscribe" on public.push_subscriptions;
create policy "push: subscribe" on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "push: unsubscribe" on public.push_subscriptions;
create policy "push: unsubscribe" on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

/* ai_events — written by /api/chat with the caller's JWT; append-only. */
drop policy if exists "ai_events: read own" on public.ai_events;
create policy "ai_events: read own" on public.ai_events for select to authenticated using (user_id = auth.uid());
drop policy if exists "ai_events: log own" on public.ai_events;
create policy "ai_events: log own" on public.ai_events for insert to authenticated with check (user_id = auth.uid());

/* ── ship check ──────────────────────────────────────────── */

/* Lets scripts/check-supabase.ts confirm RLS is on and forced, signed in as a
   normal user. Exposes table names and two flags, nothing else. */
create or replace function public.rls_report()
returns table (table_name text, rls_enabled boolean, rls_forced boolean)
language sql stable set search_path = public as $$
  select c.relname::text, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by 1
$$;
revoke all on function public.rls_report() from public, anon;
grant execute on function public.rls_report() to authenticated;
```

- [ ] **Step 6: Run the RLS tests**

Run: `npx vitest run tests/db/rls.test.ts`
Expected: PASS, every test. If one fails, the SQL is wrong, not the test. Fix the policy or constraint that the failure names.

- [ ] **Step 7: Run every gate**

Run: `npm run format && npm run check`
Expected: everything passes.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260923_redesign_schema.sql scripts/supabase-check/tables.ts tests/db
git commit -m "Refonte : tables normalisées, RLS forcée partout, testées sous de vrais rôles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Design tokens and components, with their states tested

**Files:**
- Create: `src/design/tokens.css`, `src/design/base.css`, `src/design/components/components.css`
- Create: `src/design/components/Button.tsx`, `Pill.tsx`, `Amount.tsx`, `LedgerRow.tsx`, `SegmentedBar.tsx`, `Sheet.tsx`, `Toast.tsx`, `Skeleton.tsx`, `EmptyState.tsx`, `ErrorState.tsx`
- Test: `tests/unit/design/states.test.tsx`, `tests/unit/design/controls.test.tsx`, `tests/unit/design/overlays.test.tsx`

**Interfaces:**
- Consumes: `formatTnd` and `Mil` from Task 1; `t` from Task 3.
- Produces these components (each is the only export of its file, plus the listed types):
  - `Button({ children, onClick?, variant?: 'primary' | 'secondary', type?: 'button' | 'submit', disabled? })`
  - `Pill({ label, pressed, onToggle })`
  - `Amount({ mil, sign?, class? })`
  - `LedgerRow({ icon, tint, title, subtitle?, mil, sign?, onClick? })`
  - `SegmentedBar({ segments: Segment[], total? })`, with `interface Segment { label: string; mil: Mil; color: string }`
  - `Sheet({ open, title, onClose, children })`
  - `Toast({ toast: ToastData | null, onDismiss, duration? = 6000 })`, with `interface ToastData { id: number; message: string; actionLabel?: string; onAction?: () => void }`
  - `Skeleton({ lines? = 3 })`
  - `EmptyState({ title, body?, action? })`
  - `ErrorState({ onRetry, body? })`

- [ ] **Step 1: Write the failing component tests**

`tests/unit/design/states.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState } from '../../../src/design/components/EmptyState';
import { ErrorState } from '../../../src/design/components/ErrorState';
import { Skeleton } from '../../../src/design/components/Skeleton';

afterEach(cleanup);

describe('loading, empty and error states', () => {
  it('loading: a busy status with a spoken label, and the requested lines', () => {
    const { container } = render(<Skeleton lines={4} />);
    const status = screen.getByRole('status', { name: 'Chargement…' });
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('.skeleton__line')).toHaveLength(4);
  });

  it('empty: title, body and an optional action', () => {
    render(<EmptyState title="Rien ce mois-ci" body="Tes dépenses apparaîtront ici." action={<button type="button">Ajouter</button>} />);
    expect(screen.getByText('Rien ce mois-ci')).toBeTruthy();
    expect(screen.getByText('Tes dépenses apparaîtront ici.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeTruthy();
  });

  it('error: announced as an alert, with a working retry', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Ça n’a pas marché');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
```

`tests/unit/design/controls.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { ShoppingCart } from 'lucide-preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Amount } from '../../../src/design/components/Amount';
import { Button } from '../../../src/design/components/Button';
import { LedgerRow } from '../../../src/design/components/LedgerRow';
import { Pill } from '../../../src/design/components/Pill';
import { SegmentedBar } from '../../../src/design/components/SegmentedBar';

afterEach(cleanup);
const NB = ' ';

describe('Button', () => {
  it('clicks, and does nothing when disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Enregistrer</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    rerender(<Button onClick={onClick} disabled>Enregistrer</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});

describe('Pill', () => {
  it('exposes its state with aria-pressed', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Pill label="Envies" pressed={false} onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'Envies' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<Pill label="Envies" pressed onToggle={onToggle} />);
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Amount', () => {
  it('formats millimes with a non-breaking unit and a real minus', () => {
    const { container, rerender } = render(<Amount mil={1_200_000} />);
    expect(container.textContent).toMatch(/^1[  ]200 TND$/);
    rerender(<Amount mil={-32_500} />);
    expect(container.textContent).toBe(`−32,5${NB}TND`);
  });
});

describe('LedgerRow', () => {
  it('is one button named by its title, subtitle and amount', () => {
    const onClick = vi.fn();
    render(<LedgerRow icon={ShoppingCart} tint="var(--need)" title="Carrefour" subtitle="Courses" mil={-32_500} onClick={onClick} />);
    const row = screen.getByRole('button', { name: /Carrefour.*Courses.*32,5/ });
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('SegmentedBar', () => {
  const pots = [
    { label: 'Besoins', mil: 1_250_000, color: 'var(--need)' },
    { label: 'Envies', mil: 750_000, color: 'var(--want)' },
    { label: 'Épargne', mil: 500_000, color: 'var(--save)' },
  ];

  it('says in words what the colours show', () => {
    render(<SegmentedBar segments={pots} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(`Besoins 50${NB}%, Envies 30${NB}%, Épargne 20${NB}%`);
  });

  it('an empty bar has no NaN widths', () => {
    const { container } = render(<SegmentedBar segments={pots.map((p) => ({ ...p, mil: 0 }))} />);
    expect(container.querySelectorAll('.segbar__seg')).toHaveLength(0);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(`Besoins 0${NB}%, Envies 0${NB}%, Épargne 0${NB}%`);
  });
});
```

`tests/unit/design/overlays.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from '../../../src/design/components/Sheet';
import { Toast } from '../../../src/design/components/Toast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Ouvrir</button>
      <Sheet open={open} title="Détail" onClose={() => setOpen(false)}>
        <button type="button">Premier</button>
        <button type="button">Dernier</button>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('moves focus in, traps Tab both ways, closes on Escape and gives focus back', () => {
    render(<SheetHarness />);
    const opener = screen.getByRole('button', { name: 'Ouvrir' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Détail' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const close = screen.getAllByRole('button', { name: 'Fermer' }).find((b) => dialog.contains(b));
    expect(document.activeElement).toBe(close);

    const last = screen.getByRole('button', { name: 'Dernier' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close as HTMLElement, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('renders nothing while closed', () => {
    render(<Sheet open={false} title="Détail" onClose={() => undefined}>x</Sheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Toast', () => {
  it('keeps a polite live region mounted, even when empty', () => {
    render(<Toast toast={null} onDismiss={() => undefined} />);
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('shows the message, dismisses itself after 6 s, and the action undoes then dismisses', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const onAction = vi.fn();
    render(<Toast toast={{ id: 1, message: 'Dépense supprimée.', actionLabel: 'Annuler', onAction }} onDismiss={onDismiss} />);
    expect(screen.getByRole('status').textContent).toContain('Dépense supprimée.');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(6000);
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/design`
Expected: FAIL, because the component modules can't be resolved.

- [ ] **Step 3: Write the tokens and the base CSS**

`src/design/tokens.css`:

```css
/* Spec §5.1 tokens. Two changes for §5.6 contrast (≥ 4.5 : 1), see the plan's
   "Spec deviations": --mut is darker, and *-ink variants exist for coloured text.
   White text only ever sits on --ink, never on --acc (3.0 : 1). */
:root {
  --bg: #f3f4f7;
  --card: #ffffff;
  --ink: #0e0f12;
  --ink2: #3a3d44;
  --mut: #666b74;
  --line: #ecedf1;
  --acc: #ff5a36;
  --acc-soft: #ffe9e3;
  --acc-ink: #c2391b;
  --need: #3e7bfa;
  --need-soft: #e7efff;
  --need-ink: #2b5fd9;
  --want: #8b5cf6;
  --want-soft: #f0eaff;
  --want-ink: #6d3fd6;
  --save: #12b076;
  --save-soft: #e2f6ee;
  --save-ink: #0b7a52;
  --warn: #f5a524;

  --r-card: 24px;
  --r-tile: 18px;
  --r-small: 12px;
  --r-pill: 999px;
  --gutter: 16px;
  --gutter-onb: 24px;

  --font: 'Plus Jakarta Sans Variable', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --t-press: 140ms;
  --t-sheet: 330ms;
}
```

`src/design/base.css`:

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}
html {
  -webkit-text-size-adjust: 100%;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.4;
}
button {
  font: inherit;
  color: inherit;
  border: 0;
  background: none;
  padding: 0;
  cursor: pointer;
}
:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}
/* Spec §5.2: numbers 800, tight, tabular; labels 11 px caps */
.num {
  font-weight: 800;
  letter-spacing: -0.045em;
  font-variant-numeric: tabular-nums;
}
.label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mut);
}
/* Spec §5.5: everything animated is off under reduced motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 4: Write the components**

`src/design/components/Button.tsx`:

```tsx
import type { ComponentChildren } from 'preact';

type Props = {
  children: ComponentChildren;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  type?: 'button' | 'submit';
  disabled?: boolean;
};

export function Button({ children, onClick, variant = 'primary', type = 'button', disabled = false }: Props) {
  return (
    <button type={type} class={`btn btn--${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
```

`src/design/components/Pill.tsx`:

```tsx
type Props = { label: string; pressed: boolean; onToggle: () => void };

/** Filter pill: a toggle button, its state exposed with aria-pressed (spec §5.6). */
export function Pill({ label, pressed, onToggle }: Props) {
  return (
    <button type="button" class="pill" aria-pressed={pressed} onClick={onToggle}>
      {label}
    </button>
  );
}
```

`src/design/components/Amount.tsx`:

```tsx
import { t } from '../../shared/i18n/t';
import { formatTnd, type Mil } from '../../shared/money';

type Props = { mil: Mil; sign?: boolean; class?: string };

/** A number and its unit (spec §5.2): tabular figures, unit smaller and raised. */
export function Amount({ mil, sign = false, class: extra = '' }: Props) {
  return (
    <span class={`amount num ${extra}`.trim()}>
      {formatTnd(mil, { unit: false, sign })}
      <span class="amount__unit">
        {' '}
        {t('unit.tnd')}
      </span>
    </span>
  );
}
```

`src/design/components/LedgerRow.tsx`:

```tsx
import type { ComponentType } from 'preact';
import type { Mil } from '../../shared/money';
import { Amount } from './Amount';

type Props = {
  icon: ComponentType<{ size?: number | string }>;
  /** avatar background, a pot colour token such as var(--need) */
  tint: string;
  title: string;
  subtitle?: string;
  mil: Mil;
  sign?: boolean;
  onClick?: () => void;
};

/** Spec §5.4 ledger row: 44 px round avatar, title, subtitle, right-aligned amount. */
export function LedgerRow({ icon: Icon, tint, title, subtitle, mil, sign = false, onClick }: Props) {
  return (
    <button type="button" class="ledger-row" onClick={onClick}>
      <span class="ledger-row__avatar" style={{ background: tint }} aria-hidden="true">
        <Icon size={20} />
      </span>
      <span class="ledger-row__text">
        <span class="ledger-row__title">{title}</span>
        {subtitle && <span class="ledger-row__sub">{subtitle}</span>}
      </span>
      <Amount mil={mil} sign={sign} class="ledger-row__amount" />
    </button>
  );
}
```

`src/design/components/SegmentedBar.tsx`:

```tsx
import type { Mil } from '../../shared/money';

export interface Segment {
  label: string;
  mil: Mil;
  color: string;
}

/** Chunky segmented bar. The colours are never the only carrier: aria-label says it in words. */
export function SegmentedBar({ segments, total }: { segments: Segment[]; total?: Mil }) {
  const sum = total ?? segments.reduce((s, x) => s + x.mil, 0);
  const share = (m: Mil) => (sum > 0 ? m / sum : 0);
  const label = segments.map((s) => `${s.label} ${Math.round(share(s.mil) * 100)} %`).join(', ');
  return (
    <div class="segbar" role="img" aria-label={label}>
      {segments
        .filter((s) => s.mil > 0)
        .map((s) => (
          <span key={s.label} class="segbar__seg" style={{ width: `${share(s.mil) * 100}%`, background: s.color }} />
        ))}
    </div>
  );
}
```

`src/design/components/Sheet.tsx`:

```tsx
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import { t } from '../../shared/i18n/t';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = { open: boolean; title: string; onClose: () => void; children: ComponentChildren };

/** Bottom sheet (spec §5.4): traps focus while open, Escape closes, focus returns to the opener. */
export function Sheet({ open, title, onClose, children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  /* A new onClose each render must not re-run the effect: that would bounce focus to the first item. */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
    (items()[0] ?? el).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = items();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) {
        e.preventDefault();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div class="sheet-layer">
      <button type="button" class="sheet-backdrop" tabIndex={-1} aria-label={t('action.close')} onClick={onClose} />
      <div ref={panel} class="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div class="sheet__head">
          <h2 id={titleId} class="sheet__title">
            {title}
          </h2>
          <button type="button" class="icon-btn" aria-label={t('action.close')} onClick={onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

`src/design/components/Toast.tsx`:

```tsx
import { useEffect } from 'preact/hooks';

export interface ToastData {
  /** a new id restarts the timer, even for the same message */
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

type Props = { toast: ToastData | null; onDismiss: () => void; duration?: number };

/** The live region stays mounted so screen readers announce each new toast (spec §5.6). */
export function Toast({ toast, onDismiss, duration = 6000 }: Props) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [toast, duration, onDismiss]);

  return (
    <div class="toast-region" role="status" aria-live="polite">
      {toast && (
        <div class="toast">
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              type="button"
              class="toast__action"
              onClick={() => {
                toast.onAction?.();
                onDismiss();
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

`src/design/components/Skeleton.tsx`:

```tsx
import { t } from '../../shared/i18n/t';

/** Loading state (spec §8.3): shown instead of a spinner. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div class="skeleton" role="status" aria-busy="true" aria-label={t('state.loading')}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} class="skeleton__line" />
      ))}
    </div>
  );
}
```

`src/design/components/EmptyState.tsx`:

```tsx
import type { ComponentChildren } from 'preact';

type Props = { title: string; body?: string; action?: ComponentChildren };

export function EmptyState({ title, body, action }: Props) {
  return (
    <div class="state">
      <p class="state__title">{title}</p>
      {body && <p class="state__body">{body}</p>}
      {action}
    </div>
  );
}
```

`src/design/components/ErrorState.tsx`:

```tsx
import { t } from '../../shared/i18n/t';
import { Button } from './Button';

type Props = { onRetry: () => void; body?: string };

export function ErrorState({ onRetry, body }: Props) {
  return (
    <div class="state" role="alert">
      <p class="state__title">{t('state.error.title')}</p>
      <p class="state__body">{body ?? t('state.error.body')}</p>
      <Button onClick={onRetry}>{t('action.retry')}</Button>
    </div>
  );
}
```

`src/design/components/components.css`:

```css
/* Design-system components (spec §5.4). Touch targets ≥ 44 px; only transform
   and opacity are animated (spec §8.4); reduced motion is handled in base.css. */

/* Button */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 48px;
  min-width: 44px;
  padding: 0 20px;
  border-radius: 14px;
  font-weight: 700;
  font-size: 15px;
  transition: transform var(--t-press) var(--ease);
}
.btn:active {
  transform: scale(0.95);
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn--primary {
  background: var(--ink);
  color: #fff;
}
.btn--secondary {
  background: var(--card);
  color: var(--ink);
  box-shadow: inset 0 0 0 1.5px var(--line);
}

/* Pill */
.pill {
  min-height: 44px;
  min-width: 44px;
  padding: 0 16px;
  border-radius: var(--r-pill);
  background: var(--card);
  color: var(--ink2);
  font-weight: 600;
  font-size: 14px;
  box-shadow: inset 0 0 0 1.5px var(--line);
  transition: transform var(--t-press) var(--ease);
}
.pill:active {
  transform: scale(0.95);
}
.pill[aria-pressed='true'] {
  background: var(--ink);
  color: #fff;
  box-shadow: none;
}

/* Amount */
.amount {
  white-space: nowrap;
}
.amount__unit {
  font-size: 0.55em;
  font-weight: 700;
  letter-spacing: 0;
  vertical-align: 0.6em;
}

/* Ledger row */
.ledger-row {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 10px 0;
  text-align: left;
  transition: transform var(--t-press) var(--ease);
}
.ledger-row:active {
  transform: scale(0.98);
}
.ledger-row__avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
}
.ledger-row__text {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.ledger-row__title {
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ledger-row__sub {
  font-size: 13px;
  color: var(--mut);
}
.ledger-row__amount {
  font-size: 16px;
}

/* Segmented bar */
.segbar {
  display: flex;
  gap: 4px;
  height: 14px;
  border-radius: var(--r-pill);
  background: var(--line);
  overflow: hidden;
}
.segbar__seg {
  height: 100%;
  border-radius: var(--r-pill);
  transform-origin: left;
  animation: grow 800ms var(--ease) both;
}
@keyframes grow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

/* Sheet */
.sheet-layer {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
}
.sheet-backdrop {
  position: absolute;
  inset: 0;
  background: rgb(14 15 18 / 0.4);
  animation: fade 240ms ease-out both;
}
.sheet {
  position: relative;
  width: 100%;
  max-height: 90dvh;
  overflow: auto;
  background: var(--card);
  border-radius: var(--r-card) var(--r-card) 0 0;
  padding: 8px var(--gutter) calc(24px + env(safe-area-inset-bottom));
  animation: slide-up var(--t-sheet) var(--ease) both;
}
.sheet:focus {
  outline: none;
}
.sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
}
.sheet__title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}
.icon-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--bg);
}
@keyframes slide-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
@keyframes fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Toast */
.toast-region {
  position: fixed;
  left: var(--gutter);
  right: var(--gutter);
  bottom: calc(24px + env(safe-area-inset-bottom));
  z-index: 60;
  display: flex;
  justify-content: center;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 4px 4px 4px 16px;
  border-radius: 16px;
  background: var(--ink);
  color: #fff;
  font-weight: 600;
  animation: slide-up 320ms var(--ease) both;
}
.toast__action {
  min-height: 44px;
  min-width: 44px;
  padding: 0 14px;
  border-radius: 12px;
  color: #fff;
  font-weight: 800;
  text-decoration: underline;
}

/* Loading, empty, error */
.skeleton {
  display: grid;
  gap: 10px;
}
.skeleton__line {
  height: 16px;
  border-radius: 8px;
  background: var(--line);
  animation: pulse 1.2s ease-in-out infinite alternate;
}
.skeleton__line:nth-child(3n) {
  width: 60%;
}
@keyframes pulse {
  from {
    opacity: 0.5;
  }
  to {
    opacity: 1;
  }
}
.state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 24px var(--gutter);
  text-align: center;
}
.state__title {
  margin: 0;
  font-weight: 800;
  font-size: 16px;
}
.state__body {
  margin: 0;
  color: var(--mut);
  font-size: 14px;
}
```

- [ ] **Step 5: Run the component tests**

Run: `npx vitest run tests/unit/design`
Expected: PASS, every test.

- [ ] **Step 6: Run every gate**

Run: `npm run format && npm run check`
Expected: everything passes, and jsx-a11y reports nothing.

- [ ] **Step 7: Commit**

```bash
git add src/design tests/unit/design
git commit -m "Refonte : jetons de design et composants, états chargement/vide/erreur testés" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: App shell, component gallery, and E2E + axe on iPhone 13 and Pixel 7

**Files:**
- Create: `vite.config.mts`, `playwright.config.ts`, `src/index.html`, `src/main.tsx`, `src/app/App.tsx`, `src/design/Gallery.tsx`, `src/design/gallery.css`, `tests/e2e/design.spec.ts`

**Interfaces:**
- Consumes: every component from Task 5, and `t`.
- Produces:
  - `npm run build` builds `dist/`; `npm run preview` serves it on :4173.
  - `npm run e2e` runs Playwright on the projects `iphone-13` (WebKit) and `pixel-7` (Chromium).
  - `App()` renders `Gallery()`. Phase 1 replaces this with the router.

- [ ] **Step 1: Write the build and E2E configs**

`vite.config.mts`:

```ts
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

/* The rebuild has its own index.html in src/, so the live app's root
   index.html is never picked up by Vite. */
export default defineConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  plugins: [preact()],
  build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
  preview: { port: 4173 },
});
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

/* Spec §8.6: iPhone 13 and Pixel 7 viewports. iPhone runs WebKit, Pixel runs Chromium. */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'iphone-13', use: { ...devices['iPhone 13'] } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
  ],
});
```

- [ ] **Step 2: Write the failing E2E `tests/e2e/design.spec.ts`**

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function blockingViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Composants' })).toBeVisible();
});

test('no serious or critical accessibility violations', async ({ page }) => {
  expect(await blockingViolations(page)).toEqual([]);
});

test('no serious or critical violations with the sheet open and a toast showing', async ({ page }) => {
  await page.getByRole('button', { name: 'Afficher un toast' }).click();
  await page.getByRole('button', { name: 'Ouvrir la feuille' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);
});

test('every visible button is at least 44 × 44 px', async ({ page }) => {
  const small = await page.locator('button:visible').evaluateAll((els) =>
    els
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { name: e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '', w: r.width, h: r.height };
      })
      .filter((b) => b.w < 44 || b.h < 44),
  );
  expect(small).toEqual([]);
});

test('the sheet takes focus, closes on Escape and gives focus back', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Ouvrir la feuille' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Détail de la dépense' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('a toast is announced and offers Annuler', async ({ page }) => {
  await page.getByRole('button', { name: 'Afficher un toast' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Dépense supprimée.' });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Annuler' })).toBeVisible();
});

test('pills expose their state', async ({ page }) => {
  const envies = page.getByRole('button', { name: 'Envies', exact: true });
  await expect(envies).toHaveAttribute('aria-pressed', 'false');
  await envies.click();
  await expect(envies).toHaveAttribute('aria-pressed', 'true');
});

test('reduced motion turns animations off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const name = await page.locator('.segbar__seg').first().evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe('none');
});
```

- [ ] **Step 3: Install the browsers and watch the E2E fail**

```bash
npx playwright install chromium webkit
npm run e2e
```

Expected: FAIL. `vite build` can't find `src/index.html`, so the web server never starts.

- [ ] **Step 4: Write the page, the entry point, the shell and the gallery**

`src/index.html`:

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#F3F4F7" />
    <title>Stouchi</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:

```tsx
import { render } from 'preact';
import '@fontsource-variable/plus-jakarta-sans/index.css';
import './design/tokens.css';
import './design/base.css';
import './design/components/components.css';
import { App } from './app/App';

const root = document.getElementById('app');
if (root) render(<App />, root);
```

`src/app/App.tsx`:

```tsx
import { Gallery } from '../design/Gallery';

/* Phase 0: the design-system gallery is the whole app.
   Phase 1 replaces this with the router, tab bar and screens. */
export function App() {
  return <Gallery />;
}
```

`src/design/Gallery.tsx`:

```tsx
import { useCallback, useState } from 'preact/hooks';
import { Coffee, PiggyBank, ShoppingCart, Zap } from 'lucide-preact';
import { t, type StringKey } from '../shared/i18n/t';
import { Amount } from './components/Amount';
import { Button } from './components/Button';
import { EmptyState } from './components/EmptyState';
import { ErrorState } from './components/ErrorState';
import { LedgerRow } from './components/LedgerRow';
import { Pill } from './components/Pill';
import { SegmentedBar } from './components/SegmentedBar';
import { Sheet } from './components/Sheet';
import { Skeleton } from './components/Skeleton';
import { Toast, type ToastData } from './components/Toast';
import './gallery.css';

type Filter = 'all' | 'needs' | 'wants';
const FILTERS: Record<Filter, StringKey> = { all: 'gallery.all', needs: 'pot.needs', wants: 'pot.wants' };

/* Every design-system component in every state, on one page: the E2E and axe
   run against it, and it is the visual reference while screens are rebuilt. */
export function Gallery() {
  const [filter, setFilter] = useState<Filter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const dismissToast = useCallback(() => setToast(null), []);
  const pots = [
    { label: t('pot.needs'), mil: 1_250_000, color: 'var(--need)' },
    { label: t('pot.wants'), mil: 750_000, color: 'var(--want)' },
    { label: t('pot.savings'), mil: 500_000, color: 'var(--save)' },
  ];

  return (
    <main class="gallery">
      <h1>{t('gallery.title')}</h1>

      <section aria-labelledby="g-pots">
        <h2 id="g-pots" class="label">
          {t('gallery.pots')}
        </h2>
        <p class="gallery__big">
          <Amount mil={640_000} />
        </p>
        <p class="gallery__caption">{t('gallery.remaining')}</p>
        <SegmentedBar segments={pots} />
        <ul class="legend">
          {pots.map((p) => (
            <li key={p.label}>
              <span class="legend__dot" style={{ background: p.color }} />
              {p.label}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="g-ledger">
        <h2 id="g-ledger" class="label">
          {t('gallery.ledger')}
        </h2>
        <LedgerRow icon={ShoppingCart} tint="var(--need)" title="Carrefour" subtitle={t('category.courses')} mil={-32_500} />
        <LedgerRow icon={Coffee} tint="var(--want)" title={t('category.cafe')} subtitle={t('pot.wants')} mil={-12_000} />
        <LedgerRow icon={Zap} tint="var(--need)" title="STEG" subtitle={t('category.factures')} mil={-95_000} />
        <LedgerRow icon={PiggyBank} tint="var(--save)" title={t('pot.savings')} mil={200_000} sign />
      </section>

      <section aria-labelledby="g-pills">
        <h2 id="g-pills" class="label">
          {t('gallery.pills')}
        </h2>
        <div class="pills">
          {(Object.keys(FILTERS) as Filter[]).map((k) => (
            <Pill key={k} label={t(FILTERS[k])} pressed={filter === k} onToggle={() => setFilter(k)} />
          ))}
        </div>
      </section>

      <section aria-labelledby="g-buttons">
        <h2 id="g-buttons" class="label">
          {t('gallery.buttons')}
        </h2>
        <div class="buttons">
          <Button onClick={() => setSheetOpen(true)}>{t('gallery.openSheet')}</Button>
          <Button
            variant="secondary"
            onClick={() =>
              setToast({ id: Date.now(), message: t('gallery.toast'), actionLabel: t('action.undo'), onAction: () => undefined })
            }
          >
            {t('gallery.showToast')}
          </Button>
        </div>
      </section>

      <section aria-labelledby="g-states">
        <h2 id="g-states" class="label">
          {t('gallery.states')}
        </h2>
        <Skeleton />
        <EmptyState title={t('gallery.empty.title')} body={t('gallery.empty.body')} />
        <ErrorState onRetry={() => undefined} />
      </section>

      <Sheet open={sheetOpen} title={t('gallery.sheetTitle')} onClose={closeSheet}>
        <p>{t('gallery.sheetBody')}</p>
        <Button onClick={closeSheet}>{t('gallery.primary')}</Button>
      </Sheet>
      <Toast toast={toast} onDismiss={dismissToast} />
    </main>
  );
}
```

`src/design/gallery.css`:

```css
.gallery {
  max-width: 480px;
  margin: 0 auto;
  padding: 24px var(--gutter) 120px;
  display: grid;
  gap: 20px;
}
.gallery h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.gallery section {
  display: grid;
  gap: 12px;
  background: var(--card);
  border-radius: var(--r-card);
  padding: 16px;
}
.gallery h2 {
  margin: 0;
}
.gallery__big {
  margin: 0;
  font-size: 44px;
}
.gallery__caption {
  margin: 0;
  color: var(--mut);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  font-weight: 600;
}
.legend__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
}
.pills,
.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
```

- [ ] **Step 5: Run the E2E on both devices**

Run: `npm run e2e`
Expected: 14 passed (7 tests × 2 projects). If axe reports a `color-contrast` violation, fix the token or the class it names. Never exclude the rule.

- [ ] **Step 6: Run every gate and the build**

Run: `npm run format && npm run check && npm run build`
Expected: everything passes, and `dist/index.html` exists.

- [ ] **Step 7: Commit**

```bash
git add vite.config.mts playwright.config.ts src/index.html src/main.tsx src/app src/design/Gallery.tsx src/design/gallery.css tests/e2e
git commit -m "Refonte : coquille Vite, galerie des composants, E2E + axe sur iPhone 13 et Pixel 7" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Backfill converter and verifier (pure)

**Files:**
- Create: `scripts/backfill/uuid5.ts`, `scripts/backfill/legacy.ts`, `scripts/backfill/convert.ts`, `scripts/backfill/verify.ts`, `tests/unit/backfill/fixtures.ts`, `tests/unit/backfill/convert.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `parseTnd`, `milFromTnd`, `DEFAULT_SPLIT`, `Mil`
  - Task 2: `isValidISODate`, `todayTunis`
  - Task 3: `isCategory`, `categoryLabel`, `CategoryKey`, `Pot`, `t`, `StringKey`, the `New*` types and the `*Insert` schemas
- Produces:
  - `uuid5.ts`: `uuidv5(name: string, namespace: string): string`
  - `legacy.ts`:
    - `legacyCategory(raw: unknown): CategoryKey | 'epargne'`
    - `legacyPot(e: Record<string, unknown>): Pot`
    - `legacyAmount(raw: unknown): Mil | null`
    - `legacyDate(e: Record<string, unknown>): ISODate | null`
  - `convert.ts`:
    - `interface LegacyRow { user_id: string; created_at: string; data: unknown }`
    - `interface LegacyHousehold { household_id: string; data: unknown; members: { user_id: string; joined_at: string }[] }`
    - `type IssueKind`; `interface Issue { source; kind; ref; detail; mil?; month?; pot? }`
    - `interface Converted { profiles; goals; bills; expenses; savings_moves; debts; issues; origin: Record<string, string> }`
    - `convertAll(rows: LegacyRow[], households: LegacyHousehold[], now: Date): Converted`
    - helpers `isRec`, `records`, `str`, `refOf` and `indexHouseholds(households)`, which returns `{ householdOf: Map<string, string>; owned: Map<string, Set<string>> }`
  - `verify.ts`:
    - `interface Mismatch { source; month; pot; oldMil; newMil; skippedMil }`
    - `verify(rows, households, out: Converted): { ok: boolean; mismatches: Mismatch[] }`

- [ ] **Step 1: Write the fixtures `tests/unit/backfill/fixtures.ts`**

These shapes come from today's `app.js`. `settings` holds `n1`, `s1`, `s2`, `rb`, `rp`, `goal`, `saved`, `goalType` and `goalNote`. An expense is `{id, amount, category, envelope, who, date, label, updatedAt}`. A bill is `{id, key, label, amount, freq, day, anchor, scope}`. A debt uses either the new `{type, person, label, date, settled}` or the old `{kind, who, note, dueDate}`.

```ts
import type { LegacyHousehold, LegacyRow } from '../../../scripts/backfill/convert';

export const ALICE = '00000000-0000-4000-8000-000000000001';
export const BOB = '00000000-0000-4000-8000-000000000002';
export const CAROL = '00000000-0000-4000-8000-000000000003';
export const DAVE = '00000000-0000-4000-8000-000000000004';
export const EVE = '00000000-0000-4000-8000-000000000005';
export const HH = '00000000-0000-4000-8000-0000000000a1';
export const EMPTY_HH = '00000000-0000-4000-8000-0000000000a2';
export const NOW = new Date('2026-09-23T09:00:00Z');

const monoprix = { id: 'hx', amount: 40, category: 'courses', envelope: 'besoins', date: '2026-09-04', label: 'Monoprix' };

export const ROWS: LegacyRow[] = [
  {
    user_id: ALICE,
    created_at: '2026-08-01T10:00:00Z',
    data: {
      settings: { n1: 'Sofiene', s1: 2500, s2: 1800, rb: 50, rp: 30, goal: 20000, saved: 4800, goalType: 'voyage', goalNote: '' },
      expenses: [
        { id: 'e1', amount: 32.5, category: 'courses', envelope: 'besoins', date: '2026-09-02', label: 'Carrefour' },
        { id: 'e2', amount: 12, category: 'café', envelope: 'perso', date: '2026-09-03', label: '' },
        { id: 'e3', amount: '1 200,5', category: 'loyer', envelope: 'besoins', date: '2026-09-01', label: 'Loyer' },
        { id: 'e4', amount: -5, category: 'courses', envelope: 'besoins', date: '2026-09-02' },
        { id: 'e5', amount: 10, category: 'courses', envelope: 'besoins', date: '2026-13-01' },
        { id: 'e2', amount: 12, category: 'café', envelope: 'perso', date: '2026-09-03', label: '' },
        { id: 'e6', amount: 100, category: 'épargne', envelope: 'besoins', date: '2026-09-05', label: 'Mis de côté' },
        { id: 'e7', amount: 20, category: 'autre', envelope: 'besoins', date: '2026-08-30', label: 'Divers' },
        monoprix,
        null,
        'garbage',
      ],
      bills: [
        { id: 'b1', key: 'steg', label: 'STEG', amount: 95, freq: 'quarterly', day: 12, anchor: '2026-08', scope: 'moi' },
        { id: 'b2', key: 'autre', label: 'Vide', amount: 0, freq: 'monthly', day: 1 },
      ],
      debts: [
        { id: 'd1', type: 'due', person: 'Karim', label: 'resto', amount: 50, date: '2026-10-01', who: 'Maison', settled: false },
        { id: 'd2', kind: 'donner', who: 'Sami', note: 'essence', amount: 30, dueDate: '', settled: true },
      ],
    },
  },
  {
    user_id: BOB,
    created_at: 'not a date',
    data: { settings: { n1: 'Zeineb', s1: 1800 }, expenses: [monoprix], debts: 'oops' },
  },
  { user_id: CAROL, created_at: '2026-09-01T10:00:00Z', data: {} },
  { user_id: DAVE, created_at: '2026-09-01T10:00:00Z', data: null },
  { user_id: EVE, created_at: '2026-09-01T10:00:00Z', data: [1, 2] },
];

export const HOUSEHOLDS: LegacyHousehold[] = [
  {
    household_id: HH,
    members: [
      { user_id: BOB, joined_at: '2026-08-05T00:00:00Z' },
      { user_id: ALICE, joined_at: '2026-08-01T00:00:00Z' },
    ],
    data: { expenses: [{ ...monoprix, uid: BOB }], bills: [] },
  },
  { household_id: EMPTY_HH, members: [], data: { expenses: [{ id: 'z', amount: 5, date: '2026-09-01' }] } },
];
```

- [ ] **Step 2: Write the failing test `tests/unit/backfill/convert.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { convertAll } from '../../../scripts/backfill/convert';
import { legacyAmount, legacyCategory, legacyPot } from '../../../scripts/backfill/legacy';
import { uuidv5 } from '../../../scripts/backfill/uuid5';
import { verify } from '../../../scripts/backfill/verify';
import {
  BillInsert,
  DebtInsert,
  ExpenseInsert,
  GoalInsert,
  ProfileInsert,
  SavingsMoveInsert,
} from '../../../src/shared/schemas';
import { ALICE, BOB, CAROL, DAVE, EMPTY_HH, EVE, HH, HOUSEHOLDS, NOW, ROWS } from './fixtures';

const out = convertAll(ROWS, HOUSEHOLDS, NOW);
const problems = (schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } }, rows: unknown[]) =>
  rows.flatMap((r) => schema.safeParse(r).error?.issues ?? []);

describe('uuidv5', () => {
  it('matches the RFC 4122 test vector', () => {
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
});

describe('legacy readers', () => {
  it('map today’s accented categories and envelopes', () => {
    expect(legacyCategory('Café')).toBe('cafe');
    expect(legacyCategory('électricité')).toBe('factures');
    expect(legacyCategory('resto')).toBe('resto');
    expect(legacyCategory('épargne')).toBe('epargne');
    expect(legacyCategory('???')).toBe('autre');
    expect(legacyPot({ envelope: 'perso' })).toBe('wants');
    expect(legacyPot({ envelope: 'besoins', category: 'café' })).toBe('needs');
    expect(legacyPot({ category: 'shopping' })).toBe('wants');
    expect(legacyPot({ category: 'autre' })).toBe('needs');
  });

  it('read numbers, French strings, and refuse the rest', () => {
    expect(legacyAmount(12.345)).toBe(12_345);
    expect(legacyAmount('12,5')).toBe(12_500);
    expect(legacyAmount({})).toBeNull();
    expect(legacyAmount(undefined)).toBeNull();
  });
});

describe('convertAll', () => {
  it('every row fits its table', () => {
    expect(problems(ProfileInsert, out.profiles)).toEqual([]);
    expect(problems(ExpenseInsert, out.expenses)).toEqual([]);
    expect(problems(BillInsert, out.bills)).toEqual([]);
    expect(problems(DebtInsert, out.debts)).toEqual([]);
    expect(problems(GoalInsert, out.goals)).toEqual([]);
    expect(problems(SavingsMoveInsert, out.savings_moves)).toEqual([]);
  });

  it('one profile per onboarded account; the old split is kept, else 50/30/20; payday 1', () => {
    expect(out.profiles.map((p) => p.user_id)).toEqual([ALICE, BOB]);
    expect(out.profiles[0]).toMatchObject({
      first_name: 'Sofiene', salary_mil: 2_500_000, payday: 1,
      split_needs: 50, split_wants: 30, split_savings: 20, onboarded_at: '2026-08-01T10:00:00.000Z',
    });
    expect(out.profiles[1]).toMatchObject({ split_needs: 50, split_wants: 30, split_savings: 20, onboarded_at: NOW.toISOString() });
  });

  it('expenses: millimes, new category keys, the old envelope kept as the pot', () => {
    const alice = out.expenses.filter((e) => e.user_id === ALICE);
    expect(alice.map((e) => [e.label, e.amount_mil, e.category, e.pot, e.spent_on])).toEqual([
      ['Carrefour', 32_500, 'courses', 'needs', '2026-09-02'],
      ['Café', 12_000, 'cafe', 'wants', '2026-09-03'],
      ['Loyer', 1_200_500, 'loyer', 'needs', '2026-09-01'],
      ['Divers', 20_000, 'autre', 'needs', '2026-08-30'],
    ]);
  });

  it('bad rows are reported, never converted, never fatal', () => {
    const kinds = out.issues.map((i) => [i.kind, i.ref]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ['bad_amount', 'e4'], ['bad_date', 'e5'], ['duplicate_id', 'e2'], ['bad_bill', 'bill:b2'],
        ['partner_salary_dropped', ALICE], ['not_onboarded', CAROL], ['not_onboarded', DAVE],
        ['not_onboarded', EVE], ['empty_household', EMPTY_HH],
      ]),
    );
  });

  it('a shared expense appears once, in the household, owned by its author', () => {
    const monoprix = out.expenses.filter((e) => e.label === 'Monoprix');
    expect(monoprix).toHaveLength(1);
    expect(monoprix[0]).toMatchObject({ household_id: HH, user_id: BOB, amount_mil: 40_000 });
  });

  it('savings: the saved balance opens the goal; an old "épargne" expense becomes a deposit from its pot', () => {
    expect(out.goals.find((g) => g.user_id === ALICE)).toMatchObject({ name: 'Voyage', icon: 'plane', target_mil: 20_000_000 });
    expect(out.savings_moves.filter((m) => m.user_id === ALICE).map((m) => [m.amount_mil, m.kind, m.from_pot, m.occurred_on])).toEqual([
      [4_800_000, 'deposit', null, '2026-09-23'],
      [100_000, 'deposit', 'needs', '2026-09-05'],
    ]);
  });

  it('bills and both debt schemas', () => {
    expect(out.bills).toEqual([
      expect.objectContaining({ label: 'STEG', amount_mil: 95_000, frequency: 'quarterly', day: 12, starts_on: '2026-08-01', household_id: null }),
    ]);
    expect(out.debts.map((d) => [d.direction, d.person, d.amount_mil, d.due_on, d.note, d.settled_at])).toEqual([
      ['owed_to_me', 'Karim', 50_000, '2026-10-01', 'resto', null],
      ['i_owe', 'Sami', 30_000, null, 'essence', NOW.toISOString()],
    ]);
  });

  it('re-running gives the same rows and ids; two users’ "e1" get two ids', () => {
    expect(convertAll(ROWS, HOUSEHOLDS, NOW)).toEqual(out);
    const e1 = { id: 'e1', amount: 1, category: 'courses', date: '2026-09-01' };
    const two = convertAll(
      [
        { user_id: ALICE, created_at: '', data: { settings: {}, expenses: [e1] } },
        { user_id: BOB, created_at: '', data: { settings: {}, expenses: [e1] } },
      ],
      [],
      NOW,
    );
    expect(new Set(two.expenses.map((e) => e.id)).size).toBe(2);
  });
});

describe('verify', () => {
  it('balances: old totals = new rows + reported skips, per source, month and pot', () => {
    expect(verify(ROWS, HOUSEHOLDS, out)).toEqual({ ok: true, mismatches: [] });
  });

  it('catches a lost row', () => {
    const lost = { ...out, expenses: out.expenses.filter((e) => e.label !== 'Carrefour') };
    expect(verify(ROWS, HOUSEHOLDS, lost).mismatches).toEqual([
      { source: `user:${ALICE}`, month: '2026-09', pot: 'needs', oldMil: 1_333_000, newMil: 1_300_500, skippedMil: 0 },
    ]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/unit/backfill/convert.test.ts`
Expected: FAIL, because `scripts/backfill/convert` can't be resolved.

- [ ] **Step 4: Implement `scripts/backfill/uuid5.ts`**

```ts
import { createHash } from 'node:crypto';

/** RFC 4122 version-5 UUID: the same name and namespace always give the same id. */
export function uuidv5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new Error(`namespace is not a UUID: ${namespace}`);
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

- [ ] **Step 5: Implement `scripts/backfill/legacy.ts`**

```ts
/* How today's app (app.js) stored things, read the way it read them. */
import { isCategory, type CategoryKey, type Pot } from '../../src/shared/categories';
import { isValidISODate, type ISODate } from '../../src/shared/dates';
import { milFromTnd, parseTnd, type Mil } from '../../src/shared/money';

/* app.js CATS keys carry accents; the new keys don't. 'épargne' was an expense
   category; it becomes a savings move. */
const LEGACY_CATEGORY: Record<string, CategoryKey | 'epargne'> = {
  courses: 'courses', maison: 'maison', 'déco': 'maison', 'électricité': 'factures', eau: 'factures',
  internet: 'factures', 'téléphone': 'factures', loyer: 'loyer', transport: 'transport', essence: 'essence',
  'santé': 'sante', pharmacie: 'sante', restaurant: 'resto', 'café': 'cafe', shopping: 'shopping',
  'vêtements': 'vetements', cadeau: 'cadeau', sortie: 'sortie', voyage: 'voyage', abonnement: 'abonnement',
  'épargne': 'epargne', autre: 'autre',
};
/* app.js PERSO: these went to the 30 % envelope; everything else to "besoins". */
const LEGACY_PERSO = ['restaurant', 'café', 'shopping', 'vêtements', 'cadeau', 'sortie', 'voyage', 'abonnement'];

const key = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().trim() : '');

export function legacyCategory(raw: unknown): CategoryKey | 'epargne' {
  const k = key(raw);
  return LEGACY_CATEGORY[k] ?? (isCategory(k) ? k : 'autre');
}

/** The envelope as today's app counted it (envelopeFor), so monthly totals match. */
export function legacyPot(e: Record<string, unknown>): Pot {
  if (e.envelope === 'perso') return 'wants';
  if (e.envelope === 'besoins') return 'needs';
  return LEGACY_PERSO.includes(key(e.category)) ? 'wants' : 'needs';
}

export function legacyAmount(raw: unknown): Mil | null {
  if (typeof raw === 'number') return milFromTnd(raw);
  if (typeof raw === 'string') return parseTnd(raw);
  return null;
}

export function legacyDate(e: Record<string, unknown>): ISODate | null {
  const d = typeof e.date === 'string' ? e.date : '';
  if (isValidISODate(d)) return d;
  const u = typeof e.updatedAt === 'string' ? e.updatedAt.slice(0, 10) : '';
  return isValidISODate(u) ? u : null;
}
```

- [ ] **Step 6: Implement `scripts/backfill/convert.ts`**

```ts
/* Today's JSON documents (budget_data, household_shared_data) → rows of the
 * spec §7 tables. Pure: no I/O, and the clock comes in as `now`, so a re-run on
 * the same input yields the same rows with the same ids (spec §9.3). Anything
 * that can't be converted is reported as an issue, never dropped silently. */
import { categoryLabel, type Pot } from '../../src/shared/categories';
import { isValidISODate, todayTunis } from '../../src/shared/dates';
import { t, type StringKey } from '../../src/shared/i18n/t';
import { DEFAULT_SPLIT, type Mil } from '../../src/shared/money';
import type { NewBill, NewDebt, NewExpense, NewGoal, NewProfile, NewSavingsMove } from '../../src/shared/schemas';
import { legacyAmount, legacyCategory, legacyDate, legacyPot } from './legacy';
import { uuidv5 } from './uuid5';

export interface LegacyRow {
  user_id: string;
  created_at: string;
  data: unknown;
}
export interface LegacyHousehold {
  household_id: string;
  data: unknown;
  members: { user_id: string; joined_at: string }[];
}
export type IssueKind =
  | 'not_onboarded' | 'empty_household' | 'duplicate_id' | 'bad_amount' | 'bad_date'
  | 'savings_without_goal' | 'bad_bill' | 'bad_debt' | 'goal_target_missing' | 'partner_salary_dropped';
export interface Issue {
  /** 'user:<id>' or 'hh:<id>' */
  source: string;
  kind: IssueKind;
  ref: string;
  detail: string;
  /** set when the skipped amount is known: verify() adds it back */
  mil?: Mil;
  month?: string;
  pot?: Pot;
}
export interface Converted {
  profiles: NewProfile[];
  goals: NewGoal[];
  bills: NewBill[];
  expenses: NewExpense[];
  savings_moves: NewSavingsMove[];
  debts: NewDebt[];
  issues: Issue[];
  /** row id → source document, for verify() */
  origin: Record<string, string>;
}

/* ids = uuidv5('<source>:<kind>:<legacy id>'): stable across runs, distinct across users. */
const NS = '5b0e3b6c-8f0a-4d6e-9c61-2f1d7a4b9e30';
const idFor = (...parts: string[]) => uuidv5(parts.join(':'), NS);

type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
export const records = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
export const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
export const refOf = (r: Rec, i: number): string => str(r.id) || `#${i}`;
const detail = (v: unknown): string => JSON.stringify(v) ?? 'undefined';

/** Which household each user is in, and the legacy expense/bill ids each household document owns. */
export function indexHouseholds(households: LegacyHousehold[]) {
  const householdOf = new Map<string, string>();
  const owned = new Map<string, Set<string>>();
  for (const hh of households) {
    hh.members.forEach((m) => householdOf.set(m.user_id, hh.household_id));
    const doc: Rec = isRec(hh.data) ? hh.data : {};
    const ids = new Set<string>();
    records(doc.expenses).forEach((e, i) => ids.add(refOf(e, i)));
    records(doc.bills).forEach((b, i) => ids.add(`bill:${refOf(b, i)}`));
    owned.set(hh.household_id, ids);
  }
  return { householdOf, owned };
}

interface Ctx {
  out: Converted;
  source: string;
  userId: string;
  householdId: string | null;
  goalId: string | null;
  today: string;
  nowIso: string;
}

function skip(ctx: Ctx, kind: IssueKind, ref: string, info: Partial<Pick<Issue, 'detail' | 'mil' | 'month' | 'pot'>> = {}) {
  ctx.out.issues.push({ source: ctx.source, kind, ref, detail: '', ...info });
}

function convertExpense(ctx: Ctx, e: Rec, ref: string, seen: Set<string>): void {
  const pot = legacyPot(e);
  const mil = legacyAmount(e.amount);
  const spent = legacyDate(e);
  const where = { pot, ...(mil !== null && mil > 0 ? { mil } : {}), ...(spent ? { month: spent.slice(0, 7) } : {}) };
  if (seen.has(ref)) return skip(ctx, 'duplicate_id', ref, where);
  seen.add(ref);
  if (mil === null || mil <= 0) return skip(ctx, 'bad_amount', ref, { ...where, detail: detail(e.amount) });
  if (!spent) return skip(ctx, 'bad_date', ref, { ...where, detail: detail(e.date) });

  const category = legacyCategory(e.category);
  if (category === 'epargne') {
    if (!ctx.goalId) return skip(ctx, 'savings_without_goal', ref, where);
    const move: NewSavingsMove = {
      id: idFor(ctx.source, 'move', ref), user_id: ctx.userId, goal_id: ctx.goalId,
      amount_mil: mil, kind: 'deposit', from_pot: pot, occurred_on: spent,
    };
    ctx.out.savings_moves.push(move);
    ctx.out.origin[move.id] = ctx.source;
    return;
  }
  const row: NewExpense = {
    id: idFor(ctx.source, 'expense', ref), user_id: ctx.userId, household_id: ctx.householdId,
    amount_mil: mil, category, pot, label: (str(e.label) || categoryLabel(category)).slice(0, 60),
    spent_on: spent, source: 'manual', bill_id: null,
  };
  ctx.out.expenses.push(row);
  ctx.out.origin[row.id] = ctx.source;
}

const clampDay = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1;
};

function convertBill(ctx: Ctx, b: Rec, ref: string): void {
  const mil = legacyAmount(b.amount);
  if (mil === null || mil <= 0) return skip(ctx, 'bad_bill', `bill:${ref}`, { detail: detail(b.amount) });
  const anchor = str(b.anchor);
  ctx.out.bills.push({
    id: idFor(ctx.source, 'bill', ref), user_id: ctx.userId, household_id: ctx.householdId,
    label: (str(b.label) || t('bill.default')).slice(0, 60), amount_mil: mil,
    frequency: b.freq === 'quarterly' ? 'quarterly' : 'monthly', day: clampDay(b.day),
    starts_on: /^\d{4}-(0[1-9]|1[0-2])$/.test(anchor) ? `${anchor}-01` : `${ctx.today.slice(0, 7)}-01`,
    active: true,
  });
}

/* settings.charges: the pre-bills format, consumed by app.js on load; unmigrated rows may still carry it. */
function legacyCharges(settings: Rec): { rec: Rec; ref: string }[] {
  const raw = Array.isArray(settings.charges) ? (settings.charges as unknown[]) : [];
  return raw.map((c, i) => ({
    rec: isRec(c) ? { ...c, freq: 'monthly' } : { label: str(c), amount: 0 },
    ref: isRec(c) && str(c.id) ? str(c.id) : `c${i}`,
  }));
}

function convertDebt(ctx: Ctx, d: Rec, ref: string): void {
  const mil = legacyAmount(d.amount);
  if (mil === null || mil <= 0) return skip(ctx, 'bad_debt', ref, { detail: detail(d.amount) });
  const oldSchema = !d.type; // migrateDebt() in app.js: {kind, who, note, dueDate}
  const due = str(oldSchema ? d.dueDate : d.date);
  ctx.out.debts.push({
    id: idFor(ctx.source, 'debt', ref), user_id: ctx.userId,
    direction: d.type === 'due' || d.kind === 'recevoir' ? 'owed_to_me' : 'i_owe',
    person: (str(oldSchema ? d.who : d.person) || t('debt.someone')).slice(0, 40),
    amount_mil: mil, due_on: isValidISODate(due) ? due : null,
    note: str(oldSchema ? d.note : d.label).slice(0, 120),
    settled_at: d.settled === true ? ctx.nowIso : null,
  });
}

function convertProfile(row: LegacyRow, s: Rec, nowIso: string): NewProfile {
  const rb = Number(s.rb);
  const rp = Number(s.rp);
  const kept = Number.isInteger(rb) && Number.isInteger(rp) && rb >= 0 && rp >= 0 && rb + rp <= 100;
  const created = new Date(row.created_at);
  return {
    user_id: row.user_id,
    first_name: str(s.n1).slice(0, 40),
    salary_mil: Math.max(0, legacyAmount(s.s1) ?? 0),
    payday: 1, // today's app budgets by calendar month; payday 1 keeps every figure identical
    split_needs: kept ? rb : DEFAULT_SPLIT.needs,
    split_wants: kept ? rp : DEFAULT_SPLIT.wants,
    split_savings: kept ? 100 - rb - rp : DEFAULT_SPLIT.savings,
    onboarded_at: Number.isNaN(created.getTime()) ? nowIso : created.toISOString(),
  };
}

const GOAL_TYPES: Record<string, { name: StringKey; icon: string }> = {
  epargne: { name: 'goal.type.epargne', icon: 'piggy-bank' },
  voyage: { name: 'goal.type.voyage', icon: 'plane' },
  maison: { name: 'goal.type.maison', icon: 'house' },
  voiture: { name: 'goal.type.voiture', icon: 'car' },
  mariage: { name: 'goal.type.mariage', icon: 'heart' },
  etudes: { name: 'goal.type.etudes', icon: 'graduation-cap' },
  securite: { name: 'goal.type.securite', icon: 'shield' },
};

function convertGoal(ctx: Ctx, s: Rec): string | null {
  const target = Math.max(0, legacyAmount(s.goal) ?? 0);
  const saved = Math.max(0, legacyAmount(s.saved) ?? 0);
  if (target === 0 && saved === 0) return null;
  const type = GOAL_TYPES[str(s.goalType)] ?? GOAL_TYPES.epargne;
  const goal: NewGoal = {
    id: idFor(ctx.source, 'goal'), user_id: ctx.userId,
    name: (str(s.goalNote) || t(type.name)).slice(0, 40), icon: type.icon, target_mil: Math.max(target, saved),
  };
  if (target === 0) skip(ctx, 'goal_target_missing', goal.id, { detail: 'target set to the amount already saved' });
  ctx.out.goals.push(goal);
  if (saved > 0) {
    const opening: NewSavingsMove = {
      id: idFor(ctx.source, 'opening'), user_id: ctx.userId, goal_id: goal.id,
      amount_mil: saved, kind: 'deposit', from_pot: null, occurred_on: ctx.today,
    };
    ctx.out.savings_moves.push(opening);
    ctx.out.origin[opening.id] = ctx.source;
  }
  return goal.id;
}

export function convertAll(rows: LegacyRow[], households: LegacyHousehold[], now: Date): Converted {
  const out: Converted = { profiles: [], goals: [], bills: [], expenses: [], savings_moves: [], debts: [], issues: [], origin: {} };
  const today = todayTunis(now);
  const nowIso = now.toISOString();
  const { householdOf, owned } = indexHouseholds(households);

  /* Household documents first: they own the shared expenses and bills that
     each member's row also mirrors. */
  for (const hh of households) {
    const source = `hh:${hh.household_id}`;
    const members = [...hh.members].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
    const first = members[0];
    if (!first) {
      out.issues.push({ source, kind: 'empty_household', ref: hh.household_id, detail: '' });
      continue;
    }
    const doc: Rec = isRec(hh.data) ? hh.data : {};
    const ctx: Ctx = { out, source, userId: first.user_id, householdId: hh.household_id, goalId: null, today, nowIso };
    const seen = new Set<string>();
    records(doc.expenses).forEach((e, i) => {
      const author = members.find((m) => m.user_id === str(e.uid));
      convertExpense({ ...ctx, userId: author ? author.user_id : first.user_id }, e, refOf(e, i), seen);
    });
    records(doc.bills).forEach((b, i) => convertBill(ctx, b, refOf(b, i)));
  }

  for (const row of rows) {
    const source = `user:${row.user_id}`;
    const doc: Rec = isRec(row.data) ? row.data : {};
    const s = doc.settings;
    if (!isRec(s)) {
      out.issues.push({ source, kind: 'not_onboarded', ref: row.user_id, detail: '' });
      continue;
    }
    const ctx: Ctx = { out, source, userId: row.user_id, householdId: null, goalId: null, today, nowIso };
    out.profiles.push(convertProfile(row, s, nowIso));
    if (Number(s.s2) > 0) {
      out.issues.push({ source, kind: 'partner_salary_dropped', ref: row.user_id, detail: 'one salary per account now' });
    }
    ctx.goalId = convertGoal(ctx, s);

    const hid = householdOf.get(row.user_id);
    const mirrored = (hid && owned.get(hid)) || new Set<string>();
    const seen = new Set<string>();
    records(doc.expenses).forEach((e, i) => {
      const ref = refOf(e, i);
      if (!mirrored.has(ref)) convertExpense(ctx, e, ref, seen);
    });
    const billRefs = new Set<string>();
    records(doc.bills).forEach((b, i) => {
      const ref = refOf(b, i);
      billRefs.add(ref);
      if (!mirrored.has(`bill:${ref}`)) convertBill(ctx, b, ref);
    });
    legacyCharges(s).forEach(({ rec, ref }) => {
      if (!billRefs.has(ref) && !mirrored.has(`bill:${ref}`)) convertBill(ctx, rec, ref);
    });
    records(doc.debts).forEach((d, i) => convertDebt(ctx, d, refOf(d, i)));
  }
  return out;
}
```

- [ ] **Step 7: Implement `scripts/backfill/verify.ts`**

```ts
/* Spec §9.3 verification: for every source document, month and pot, what today's
 * app counted must equal what the new rows count plus what was reported as
 * skipped. Anything else means a row was lost, duplicated or mis-filed. */
import type { Pot } from '../../src/shared/categories';
import { indexHouseholds, isRec, records, refOf, type Converted, type LegacyHousehold, type LegacyRow } from './convert';
import { legacyAmount, legacyDate, legacyPot } from './legacy';

export interface Mismatch {
  source: string;
  month: string;
  pot: Pot;
  oldMil: number;
  newMil: number;
  skippedMil: number;
}

type Totals = Map<string, number>;
const keyOf = (source: string, month: string, pot: Pot) => `${source}|${month}|${pot}`;
const add = (m: Totals, key: string, mil: number) => m.set(key, (m.get(key) ?? 0) + mil);

/** Every entry today's app would have counted: a readable positive amount on a real date. */
function legacyTotals(rows: LegacyRow[], households: LegacyHousehold[]): Totals {
  const totals: Totals = new Map();
  const { householdOf, owned } = indexHouseholds(households);
  const addDoc = (source: string, data: unknown, skipRefs: Set<string>) => {
    const doc = isRec(data) ? data : {};
    records(doc.expenses).forEach((e, i) => {
      if (skipRefs.has(refOf(e, i))) return;
      const mil = legacyAmount(e.amount);
      const date = legacyDate(e);
      if (mil !== null && mil > 0 && date) add(totals, keyOf(source, date.slice(0, 7), legacyPot(e)), mil);
    });
  };
  households.filter((h) => h.members.length > 0).forEach((h) => addDoc(`hh:${h.household_id}`, h.data, new Set()));
  for (const r of rows) {
    if (!isRec(r.data) || !isRec(r.data.settings)) continue; // never onboarded: no budget was ever shown
    const hid = householdOf.get(r.user_id);
    addDoc(`user:${r.user_id}`, r.data, (hid && owned.get(hid)) || new Set());
  }
  return totals;
}

export function verify(rows: LegacyRow[], households: LegacyHousehold[], out: Converted): { ok: boolean; mismatches: Mismatch[] } {
  const old = legacyTotals(rows, households);
  const now: Totals = new Map();
  const skipped: Totals = new Map();
  out.expenses.forEach((e) => add(now, keyOf(out.origin[e.id] ?? '?', e.spent_on.slice(0, 7), e.pot), e.amount_mil));
  out.savings_moves.forEach((m) => {
    if (m.from_pot) add(now, keyOf(out.origin[m.id] ?? '?', m.occurred_on.slice(0, 7), m.from_pot), m.amount_mil);
  });
  out.issues.forEach((i) => {
    if (i.mil && i.month && i.pot) add(skipped, keyOf(i.source, i.month, i.pot), i.mil);
  });

  const mismatches: Mismatch[] = [];
  for (const k of new Set([...old.keys(), ...now.keys(), ...skipped.keys()])) {
    const [source, month, pot] = k.split('|') as [string, string, Pot];
    const oldMil = old.get(k) ?? 0;
    const newMil = now.get(k) ?? 0;
    const skippedMil = skipped.get(k) ?? 0;
    if (oldMil !== newMil + skippedMil) mismatches.push({ source, month, pot, oldMil, newMil, skippedMil });
  }
  return { ok: mismatches.length === 0, mismatches };
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run tests/unit/backfill/convert.test.ts`
Expected: PASS, every test.

- [ ] **Step 9: Run every gate**

Run: `npm run format && npm run check`
Expected: everything passes.

- [ ] **Step 10: Commit**

```bash
git add scripts/backfill/uuid5.ts scripts/backfill/legacy.ts scripts/backfill/convert.ts scripts/backfill/verify.ts tests/unit/backfill/fixtures.ts tests/unit/backfill/convert.test.ts
git commit -m "Refonte : conversion des documents JSON en lignes, vérifiée mois par mois" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Backfill runner and CLI (backup, dry run by default)

**Files:**
- Create: `scripts/backfill/run.ts`, `scripts/backfill/cli.ts`, `tests/unit/backfill/run.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `convertAll`, `verify`, `Converted`, `LegacyRow` and `LegacyHousehold` from Task 7.
- Produces, in `run.ts`:
  - `type TableName = 'profiles' | 'goals' | 'bills' | 'expenses' | 'savings_moves' | 'debts'`
  - `WRITE_ORDER: { table: TableName; onConflict: string }[]`
  - `interface Source { legacyRows(): Promise<LegacyRow[]>; households(): Promise<LegacyHousehold[]> }`
  - `interface Sink { upsert(table: TableName, rows: object[], onConflict: string): Promise<void> }`
  - `runBackfill(o: { source; sink; outDir; apply; now; convert? }): Promise<{ backupFile; reportFile; converted; report }>`
- Also produces the CLI `npm run backfill [-- --apply]`.

- [ ] **Step 1: Write the failing test `tests/unit/backfill/run.test.ts`**

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertAll, type LegacyHousehold, type LegacyRow } from '../../../scripts/backfill/convert';
import { runBackfill, type Sink, type Source, type TableName } from '../../../scripts/backfill/run';
import { ALICE, HOUSEHOLDS, NOW, ROWS } from './fixtures';

function fakes(rows: LegacyRow[] = ROWS, households: LegacyHousehold[] = HOUSEHOLDS) {
  const writes: { table: TableName; n: number; onConflict: string }[] = [];
  const source: Source = { legacyRows: () => Promise.resolve(rows), households: () => Promise.resolve(households) };
  const sink: Sink = {
    upsert: (table, list, onConflict) => {
      writes.push({ table, n: list.length, onConflict });
      return Promise.resolve();
    },
  };
  return { source, sink, writes, outDir: mkdtempSync(join(tmpdir(), 'backfill-')) };
}

describe('runBackfill', () => {
  it('dry run: backs everything up and reports, writes nothing', async () => {
    const f = fakes();
    const r = await runBackfill({ ...f, apply: false, now: NOW });
    expect(f.writes).toEqual([]);
    expect(JSON.parse(readFileSync(r.backupFile, 'utf8'))).toEqual({ rows: ROWS, households: HOUSEHOLDS });
    const report = JSON.parse(readFileSync(r.reportFile, 'utf8')) as { report: { ok: boolean }; counts: Record<string, number> };
    expect(report.report.ok).toBe(true);
    expect(report.counts.expenses).toBe(5);
  });

  it('apply: writes in dependency order, profiles keyed on user_id, the rest on id', async () => {
    const f = fakes();
    await runBackfill({ ...f, apply: true, now: NOW });
    expect(f.writes.map((w) => [w.table, w.onConflict])).toEqual([
      ['profiles', 'user_id'], ['goals', 'id'], ['bills', 'id'], ['expenses', 'id'], ['savings_moves', 'id'], ['debts', 'id'],
    ]);
  });

  it('writes large tables in chunks of 500', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ id: `e${i}`, amount: 1, category: 'courses', date: '2026-09-01' }));
    const f = fakes([{ user_id: ALICE, created_at: '2026-09-01T00:00:00Z', data: { settings: {}, expenses: many } }], []);
    await runBackfill({ ...f, apply: true, now: NOW });
    expect(f.writes.filter((w) => w.table === 'expenses').map((w) => w.n)).toEqual([500, 500, 200]);
  });

  it('refuses to write anything when verification fails', async () => {
    const f = fakes();
    const lossy: typeof convertAll = (...args) => {
      const out = convertAll(...args);
      return { ...out, expenses: out.expenses.slice(1) };
    };
    await expect(runBackfill({ ...f, apply: true, now: NOW, convert: lossy })).rejects.toThrow(/verification failed/);
    expect(f.writes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/backfill/run.test.ts`
Expected: FAIL, because `scripts/backfill/run` can't be resolved.

- [ ] **Step 3: Implement `scripts/backfill/run.ts`**

```ts
/* Spec §9 steps 1 and 3: back up every legacy row, convert, verify, and only
 * then — and only with --apply — upsert. I/O is injected so the flow is tested
 * without a database. Upserts on stable ids make a re-run a no-op. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertAll, type Converted, type LegacyHousehold, type LegacyRow } from './convert';
import { verify } from './verify';

export type TableName = 'profiles' | 'goals' | 'bills' | 'expenses' | 'savings_moves' | 'debts';
/** Parents before children: goals before savings_moves, bills before expenses. */
export const WRITE_ORDER: { table: TableName; onConflict: string }[] = [
  { table: 'profiles', onConflict: 'user_id' },
  { table: 'goals', onConflict: 'id' },
  { table: 'bills', onConflict: 'id' },
  { table: 'expenses', onConflict: 'id' },
  { table: 'savings_moves', onConflict: 'id' },
  { table: 'debts', onConflict: 'id' },
];
const CHUNK = 500;

export interface Source {
  legacyRows(): Promise<LegacyRow[]>;
  households(): Promise<LegacyHousehold[]>;
}
export interface Sink {
  upsert(table: TableName, rows: object[], onConflict: string): Promise<void>;
}
export interface RunOptions {
  source: Source;
  sink: Sink;
  outDir: string;
  apply: boolean;
  now: Date;
  /** test seam */
  convert?: typeof convertAll;
}

export async function runBackfill(o: RunOptions) {
  const rows = await o.source.legacyRows();
  const households = await o.source.households();
  mkdirSync(o.outDir, { recursive: true });
  const stamp = o.now.toISOString().replace(/[:.]/g, '-');
  const backupFile = join(o.outDir, `backup-${stamp}.json`);
  writeFileSync(backupFile, JSON.stringify({ rows, households }));

  const converted: Converted = (o.convert ?? convertAll)(rows, households, o.now);
  const report = verify(rows, households, converted);
  const counts = Object.fromEntries(WRITE_ORDER.map(({ table }) => [table, converted[table].length]));
  const reportFile = join(o.outDir, `report-${stamp}.json`);
  writeFileSync(reportFile, JSON.stringify({ counts, issues: converted.issues, report }, null, 1));

  if (o.apply) {
    if (!report.ok) {
      throw new Error(`verification failed (${report.mismatches.length} mismatches); nothing written — see ${reportFile}`);
    }
    for (const { table, onConflict } of WRITE_ORDER) {
      const list = converted[table];
      for (let i = 0; i < list.length; i += CHUNK) await o.sink.upsert(table, list.slice(i, i + CHUNK), onConflict);
    }
  }
  return { backupFile, reportFile, converted, report };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/backfill/run.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the CLI `scripts/backfill/cli.ts`**

```ts
/* One-off backfill (spec §9). Dry run by default:
 *
 *   npm run backfill              backup + report in .backfill/, writes nothing
 *   npm run backfill -- --apply   same, then upserts — only if verification passes
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env: it reads every
 * account, so RLS must be bypassed. Local admin use only — this key never goes
 * to Vercel. .backfill/ holds real users' data and is gitignored. Only counts
 * are printed, never personal data. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runBackfill, type Sink, type Source } from './run';

type Rec = Record<string, unknown>;

/* Untyped client: results come back as `any`; narrowing them to `unknown` here keeps typed lint honest. */
async function must(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<unknown> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function readAll(sb: SupabaseClient, table: string, columns: string): Promise<Rec[]> {
  const out: Rec[] = [];
  for (let from = 0; ; from += 1000) {
    const page = ((await must(sb.from(table).select(columns).range(from, from + 999), table)) ?? []) as Rec[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function main() {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no .env: rely on the environment */
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (no fallback on purpose).');
  const apply = process.argv.includes('--apply');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Project ${new URL(url).host} · ${apply ? 'APPLY' : 'dry run'}`);

  const source: Source = {
    async legacyRows() {
      return (await readAll(sb, 'budget_data', 'user_id, created_at, data')).map((r) => ({
        user_id: String(r.user_id), created_at: String(r.created_at), data: r.data,
      }));
    },
    async households() {
      const docs = await readAll(sb, 'household_shared_data', 'household_id, data');
      const members = await readAll(sb, 'household_members', 'household_id, user_id, joined_at');
      return docs.map((d) => ({
        household_id: String(d.household_id),
        data: d.data,
        members: members
          .filter((m) => m.household_id === d.household_id)
          .map((m) => ({ user_id: String(m.user_id), joined_at: String(m.joined_at) })),
      }));
    },
  };
  const sink: Sink = {
    async upsert(table, rows, onConflict) {
      await must(sb.from(table).upsert(rows, { onConflict }), table);
    },
  };

  const r = await runBackfill({ source, sink, outDir: '.backfill', apply, now: new Date() });
  const c = r.converted;
  console.log(`Rows: ${c.profiles.length} profiles, ${c.expenses.length} expenses, ${c.bills.length} bills, ` +
    `${c.debts.length} debts, ${c.goals.length} goals, ${c.savings_moves.length} savings moves`);
  const byKind = c.issues.reduce<Record<string, number>>((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {});
  console.log('Issues:', byKind);
  console.log(r.report.ok ? 'Verification: OK' : `Verification: ${r.report.mismatches.length} mismatches`);
  console.log(`Backup ${r.backupFile}\nReport ${r.reportFile}`);
  if (!r.report.ok) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Document the new variables in `.env.example`**

Append:

```
# ── Refonte ─────────────────────────────────────────────────
# Backfill (npm run backfill) : lit TOUS les comptes, donc contourne RLS.
# Usage local uniquement — ne jamais la mettre sur Vercel.
SUPABASE_SERVICE_ROLE_KEY=
# Contrôle de la base (npm run check:supabase) : un compte dédié aux tests.
TEST_USER_EMAIL=
TEST_USER_PASSWORD=
```

- [ ] **Step 7: Run every gate, then the CLI without credentials**

```bash
npm run format && npm run check
npm run backfill
```

Expected: the gates pass. The backfill prints `Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (no fallback on purpose).` and exits 1.

*Optional, only if the user has put `SUPABASE_SERVICE_ROLE_KEY` in `.env`:* run `npm run backfill` for a real **dry run**, and report the counts, issues and verification result. **Never pass `--apply` in Phase 0.**

- [ ] **Step 8: Commit**

```bash
git add scripts/backfill/run.ts scripts/backfill/cli.ts tests/unit/backfill/run.test.ts .env.example
git commit -m "Refonte : reprise des données — sauvegarde, vérification, essai à blanc par défaut" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Supabase ship check, then apply the migration to production (with approval)

**Files:**
- Create: `scripts/supabase-check/verdict.ts`, `scripts/check-supabase.ts`, `tests/unit/supabase-verdict.test.ts`

**Interfaces:**
- Consumes: `SPEC_TABLES` and `SpecTable` (Task 4); `rls_report()` (Task 4 SQL); `todayTunis` (Task 2).
- Produces:
  - `verdict.ts`:
    - `interface RlsRow { table_name; rls_enabled; rls_forced }`
    - `type RoundTrip = 'ok' | 'read-only by design' | 'not run' | \`failed: ${string}\``
    - `interface TableResult { table; reachable; rlsForced; roundTrip }`
    - `rlsForced(report, table): boolean`, `passed(r): boolean`, `formatResults(results): string`
  - The CLI `npm run check:supabase`, which exits 1 if any table fails.

- [ ] **Step 1: Write the failing test `tests/unit/supabase-verdict.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { formatResults, passed, rlsForced, type RlsRow, type TableResult } from '../../scripts/supabase-check/verdict';

const report: RlsRow[] = [
  { table_name: 'profiles', rls_enabled: true, rls_forced: true },
  { table_name: 'households', rls_enabled: true, rls_forced: false },
];
const good: TableResult = { table: 'profiles', reachable: true, rlsForced: true, roundTrip: 'ok' };

describe('supabase verdict', () => {
  it('RLS counts only when enabled and forced, and the table is listed', () => {
    expect(rlsForced(report, 'profiles')).toBe(true);
    expect(rlsForced(report, 'households')).toBe(false);
    expect(rlsForced(report, 'goals')).toBe(false);
  });

  it('a table passes only when reachable, forced and its round trip worked (or is read-only by design)', () => {
    expect(passed(good)).toBe(true);
    expect(passed({ ...good, roundTrip: 'read-only by design' })).toBe(true);
    expect(passed({ ...good, roundTrip: 'failed: insert: permission denied' })).toBe(false);
    expect(passed({ ...good, roundTrip: 'not run' })).toBe(false);
    expect(passed({ ...good, reachable: false })).toBe(false);
    expect(passed({ ...good, rlsForced: false })).toBe(false);
  });

  it('prints one line per table, failures marked', () => {
    const text = formatResults([good, { ...good, table: 'goals', rlsForced: false }]);
    expect(text.split('\n')).toHaveLength(2);
    expect(text.split('\n')[1]).toMatch(/^✗ goals/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/supabase-verdict.test.ts`
Expected: FAIL, because `scripts/supabase-check/verdict` can't be resolved.

- [ ] **Step 3: Implement `scripts/supabase-check/verdict.ts`**

```ts
import type { SpecTable } from './tables';

export interface RlsRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
}
export type RoundTrip = 'ok' | 'read-only by design' | 'not run' | `failed: ${string}`;
export interface TableResult {
  table: SpecTable;
  reachable: boolean;
  rlsForced: boolean;
  roundTrip: RoundTrip;
}

export const rlsForced = (report: RlsRow[], table: SpecTable): boolean =>
  report.some((r) => r.table_name === table && r.rls_enabled && r.rls_forced);

export const passed = (r: TableResult): boolean =>
  r.reachable && r.rlsForced && (r.roundTrip === 'ok' || r.roundTrip === 'read-only by design');

export function formatResults(results: TableResult[]): string {
  const mark = (b: boolean) => (b ? '✓' : '✗');
  return results
    .map((r) => `${mark(passed(r))} ${r.table.padEnd(19)} reachable ${mark(r.reachable)}  RLS forced ${mark(r.rlsForced)}  round trip: ${r.roundTrip}`)
    .join('\n');
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/supabase-verdict.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the CLI `scripts/check-supabase.ts`**

```ts
/* Database ship check (spec §7): for every table — reachable, RLS enabled and
 * forced, and a real read/write round trip as a signed-in user.
 *
 *   npm run check:supabase
 *
 * Runs as a dedicated TEST account with the anon key, never the service key:
 * the point is to see exactly what a user can and cannot do. Goals, bills,
 * debts, reminders and ai_events have no delete policy by design, so each run
 * leaves a few "QA" rows in that account — use an account that exists only
 * for this. */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { todayTunis } from '../src/shared/dates';
import { SPEC_TABLES, type SpecTable } from './supabase-check/tables';
import { formatResults, passed, rlsForced, type RlsRow, type RoundTrip, type TableResult } from './supabase-check/verdict';

type Row = Record<string, unknown>;
type Ctx = { sb: SupabaseClient; me: string; today: string; ids: Record<string, string> };

async function must(p: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<unknown> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

/** insert → update → read back → optional clean-up (soft delete or state column) */
async function crud(c: Ctx, table: SpecTable, row: Row & { id: string }, change: Row, cleanup?: Row): Promise<RoundTrip> {
  await must(c.sb.from(table).insert(row), 'insert');
  await must(c.sb.from(table).update(change).eq('id', row.id), 'update');
  const got = (await must(c.sb.from(table).select('*').eq('id', row.id).single(), 'read')) as Row;
  if (cleanup) await must(c.sb.from(table).update(cleanup).eq('id', row.id), 'clean-up');
  const [k, v] = Object.entries(change)[0];
  return got[k] === v ? 'ok' : `failed: ${k} not read back`;
}

/** insert → read → delete → confirm gone */
async function insertReadDelete(c: Ctx, table: SpecTable, row: Row, [col, val]: [string, string]): Promise<RoundTrip> {
  await must(c.sb.from(table).insert(row), 'insert');
  const got = (await must(c.sb.from(table).select('*').eq(col, val), 'read')) as unknown[];
  await must(c.sb.from(table).delete().eq(col, val), 'delete');
  const gone = (await must(c.sb.from(table).select('*').eq(col, val), 'read after delete')) as unknown[];
  return got.length === 1 && gone.length === 0 ? 'ok' : 'failed: insert/delete not reflected';
}

/* Household rows are written only through the security-definer RPCs (create/join). */
const readOnly = (table: SpecTable) => async (c: Ctx): Promise<RoundTrip> => {
  await must(c.sb.from(table).select('*').limit(1), 'read');
  return 'read-only by design';
};

const ROUND_TRIPS: Record<SpecTable, (c: Ctx) => Promise<RoundTrip>> = {
  profiles: async ({ sb, me }) => {
    await must(sb.from('profiles').upsert({ user_id: me, first_name: 'QA' }, { onConflict: 'user_id' }), 'upsert');
    await must(sb.from('profiles').update({ first_name: 'QA 2' }).eq('user_id', me), 'update');
    const row = (await must(sb.from('profiles').select('first_name').eq('user_id', me).single(), 'read')) as Row;
    return row.first_name === 'QA 2' ? 'ok' : 'failed: first_name not read back';
  },
  households: readOnly('households'),
  household_members: readOnly('household_members'),
  goals: (c) => {
    c.ids.goal = randomUUID();
    return crud(c, 'goals', { id: c.ids.goal, name: 'QA', icon: 'piggy-bank', target_mil: 1000 }, { name: 'QA 2' });
  },
  bills: (c) => {
    c.ids.bill = randomUUID();
    return crud(c, 'bills', { id: c.ids.bill, label: 'QA', amount_mil: 1000, frequency: 'monthly', day: 1 }, { label: 'QA 2' }, { active: false });
  },
  expenses: (c) =>
    crud(c, 'expenses', { id: randomUUID(), amount_mil: 1000, category: 'autre', pot: 'wants', label: 'QA', spent_on: c.today },
      { label: 'QA 2' }, { deleted_at: new Date().toISOString() }),
  bill_payments: (c) => insertReadDelete(c, 'bill_payments', { bill_id: c.ids.bill, period_start: c.today }, ['bill_id', c.ids.bill]),
  debts: (c) =>
    crud(c, 'debts', { id: randomUUID(), direction: 'i_owe', person: 'QA', amount_mil: 1000 }, { note: 'QA 2' },
      { settled_at: new Date().toISOString() }),
  savings_moves: (c) => {
    const id = randomUUID();
    return insertReadDelete(c, 'savings_moves', { id, goal_id: c.ids.goal, amount_mil: 1000, kind: 'deposit', occurred_on: c.today }, ['id', id]);
  },
  reminders: (c) =>
    crud(c, 'reminders', { id: randomUUID(), text: 'QA', remind_at: new Date().toISOString() }, { text: 'QA 2' },
      { done_at: new Date().toISOString() }),
  notifications: async ({ sb, me }) => {
    await must(sb.from('notifications').select('id').limit(1), 'read');
    const { error } = await sb.from('notifications').insert({ user_id: me, trigger: 'qa', dedupe_key: randomUUID(), title: 'QA', body: 'QA' });
    return error ? 'read-only by design' : 'failed: a user could create a notification';
  },
  push_subscriptions: (c) => {
    const endpoint = `https://qa.invalid/${randomUUID()}`;
    return insertReadDelete(c, 'push_subscriptions', { endpoint, p256dh: 'qa', auth: 'qa' }, ['endpoint', endpoint]);
  },
  ai_events: async ({ sb }) => {
    const model = `qa-${randomUUID().slice(0, 8)}`;
    await must(sb.from('ai_events').insert({ model, latency_ms: 1, outcome: 'ok' }), 'insert');
    const got = (await must(sb.from('ai_events').select('model').eq('model', model), 'read')) as unknown[];
    return got.length === 1 ? 'ok' : 'failed: not read back';
  },
};

async function main() {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no .env: rely on the environment */
  }
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, TEST_USER_EMAIL: email, TEST_USER_PASSWORD: password } = process.env;
  if (!url || !anon || !email || !password) {
    throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY, TEST_USER_EMAIL and TEST_USER_PASSWORD in .env');
  }
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data: auth, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !auth.user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`);
  console.log(`Project ${new URL(url).host} · signed in as the test account\n`);

  const report = (await must(sb.rpc('rls_report'), 'rls_report — is 20260923_redesign_schema.sql applied?')) as RlsRow[];
  const ctx: Ctx = { sb, me: auth.user.id, today: todayTunis(), ids: {} };
  const results: TableResult[] = [];
  for (const table of SPEC_TABLES) {
    const reachable = !(await sb.from(table).select('*', { head: true, count: 'exact' })).error;
    let roundTrip: RoundTrip = 'not run';
    if (reachable) {
      try {
        roundTrip = await ROUND_TRIPS[table](ctx);
      } catch (e) {
        roundTrip = `failed: ${e instanceof Error ? e.message : 'unknown error'}`;
      }
    }
    results.push({ table, reachable, rlsForced: rlsForced(report, table), roundTrip });
  }
  console.log(formatResults(results));
  const bad = results.filter((r) => !passed(r));
  if (bad.length) {
    console.error(`\n${bad.length} table(s) failed: ${bad.map((r) => r.table).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} tables pass.`);
  }
  await sb.auth.signOut();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Run every gate**

Run: `npm run format && npm run check`
Expected: everything passes.

- [ ] **Step 7: Commit the check**

```bash
git add scripts/supabase-check/verdict.ts scripts/check-supabase.ts tests/unit/supabase-verdict.test.ts
git commit -m "Refonte : contrôle de la base — joignable, RLS forcée, aller-retour par table" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: ⚠️ PRODUCTION: ask the user, then apply the migration**

Ask the user for explicit approval first, and say:
- the migration is **additive**: new tables, new functions (`touch_updated_at`, `keep_user_id`, `visible_to_me`, `rls_report`), and conditionally `force row level security` on `households` / `household_members`;
- nothing the live app reads or writes changes;
- the file is `supabase/migrations/20260923_redesign_schema.sql`;
- there's no Supabase CLI or `psql` on this machine, so the user applies it: Supabase dashboard → SQL Editor → paste the file → Run.

Expected in the editor: `Success. No rows returned`. A `WARNING … left unforced` line means Supabase's `postgres` can't bypass RLS. In that case the check will show `households` / `household_members` as not forced, and that is reported to the user as a known item for Phase 6, not fixed here.

- [ ] **Step 9: Run the ship check against production**

The user first creates a dedicated test account in the live app and fills `.env`:
- `SUPABASE_URL` = `https://gfbakmwllhuhfdydbcfa.supabase.co`;
- `SUPABASE_ANON_KEY` = the anon key from the dashboard;
- `TEST_USER_EMAIL` and `TEST_USER_PASSWORD`.

Run: `npm run check:supabase`
Expected: 13 lines, each starting with `✓`, then `All 13 tables pass.`
- `households`, `household_members` and `notifications` show `read-only by design`.
- If any line starts with `✗`, stop and report that table, its column (reachable / RLS forced / round trip) and the message.

---

### Task 10: Eval gate and CI

**Files:**
- Modify: `scripts/eval-aam-salah.js:36` (arguments) and the end of the main async function (exit code)
- Create: `.github/workflows/ci.yml`, `.github/workflows/eval.yml`, `.github/dependabot.yml`

**Interfaces:**
- Consumes: every npm script from Tasks 1–9, and `scripts/eval-aam-salah.js` with its existing `arg(name, dflt)` helper and `report` array of `{ summary: { provider, model, pass, total } }`.
- Produces:
  - `node scripts/eval-aam-salah.js --min-rate <0–1>`, which exits 1 if any model scores below the rate;
  - the CI workflows.

- [ ] **Step 1: Add the `--min-rate` flag**

In `scripts/eval-aam-salah.js`, directly after the line `const RUNS = Number(arg('runs', 1));`, add:

```js
/* CI gate (spec §8.6): exit 1 when a model scores below this share of cases.
   22/24 → 0.9167 (26/28 with today's 28 cases). */
const MIN_RATE = arg('min-rate', '') === '' ? null : Number(arg('min-rate'));
```

At the end of the main `(async () => { … })()` body, directly after `console.log('\nDétail : ' + path.relative(root, file));`, add:

```js
  if (MIN_RATE !== null) {
    const low = report.filter((r) => r.summary.total > 0 && r.summary.pass / r.summary.total < MIN_RATE);
    low.forEach((r) => console.error(`✗ ${r.summary.provider}:${r.summary.model} ${r.summary.pass}/${r.summary.total} < ${MIN_RATE}`));
    if (low.length) process.exitCode = 1;
  }
```

- [ ] **Step 2: Check that the gate fails and passes as it should**

This makes 2 API calls on the local `.env` key.

```bash
node scripts/eval-aam-salah.js --only 25 --models gemini:gemini-3.5-flash-lite --min-rate 1.01; echo "exit $?"
node scripts/eval-aam-salah.js --only 25 --models gemini:gemini-3.5-flash-lite --min-rate 0; echo "exit $?"
```

Expected: the first prints `✗ gemini:gemini-3.5-flash-lite 1/1 < 1.01` and `exit 1`; the second prints `exit 0`.

- [ ] **Step 3: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [master, rebuild]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - name: Types, lint, format, unit + db + component tests (coverage ≥ 90 % on src/shared), legacy tests
        run: npm run check
      - run: npm run build
      - name: Runtime dependencies have no high or critical advisories
        run: npm audit --omit=dev --audit-level=high

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium webkit
      - name: E2E + axe on iPhone 13 and Pixel 7
        run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }
```

- [ ] **Step 4: Write `.github/workflows/eval.yml`**

```yaml
name: Aam Salah eval
on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:
  push:
    paths: ['lib/aam-salah/**', 'scripts/eval-aam-salah.js']

jobs:
  eval:
    runs-on: ubuntu-latest
    env:
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - name: Key present
        run: test -n "$GEMINI_API_KEY" || { echo "::error::The GEMINI_API_KEY secret is not set"; exit 1; }
      - name: ≥ 22/24 (rate 0.9167) on the production model
        run: node scripts/eval-aam-salah.js --models gemini:gemini-3.5-flash-lite --min-rate 0.9167
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: eval-report, path: .eval/ }
```

- [ ] **Step 5: Write `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
```

- [ ] **Step 6: Commit**

```bash
git add scripts/eval-aam-salah.js .github
git commit -m "Refonte : CI (tous les contrôles), éval d'Aam Salah chaque nuit, Dependabot" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: ⚠️ Push the branch and watch CI (ask the user first)**

Pushing creates a **new branch** `rebuild` on the existing `origin`. `master` and production don't change.

```bash
git push -u origin rebuild
gh run watch --exit-status
```

Expected: `CI` succeeds in both jobs, `check` and `e2e`. If a job fails, read `gh run view --log-failed`, fix the cause locally, and push again.

- [ ] **Step 8: ⚠️ Set the eval secret (the user does this after rotating the key)**

Once the user has rotated the Gemini key that was exposed in chat, they run:

```bash
gh secret set GEMINI_API_KEY
gh workflow run "Aam Salah eval" --ref rebuild && gh run watch --exit-status
```

Expected: the eval passes at ≥ 0.9167.

---

### Task 11: Preview deploy with security headers, spec write-back, and Phase 0 exit QA

**Files:**
- Modify: `vercel.json` (this branch only), `docs/superpowers/specs/2026-09-23-stouchi-redesign-design.md` (status line, §5.1, §7, §10), `README.md` (a short "Refonte" section)

**Interfaces:**
- Consumes: everything above.
- Produces: a Vercel **preview** URL for `rebuild`, and the Phase 0 QA report.

- [ ] **Step 1: Replace `vercel.json` on this branch**

`master` keeps the live config. This file only affects deployments built from `rebuild`, until the Phase 7 cut-over.

```json
{
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Content-Security-Policy",
          "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
      ]
    }
  ]
}
```

`style-src 'unsafe-inline'` is needed because components set `style` attributes (bar widths, tints). Scripts stay strictly `'self'`.

- [ ] **Step 2: ⚠️ Deploy a preview (never `--prod`)**

```bash
npx vercel whoami || npx vercel login
npx vercel deploy
```

Expected: a `https://…vercel.app` preview URL. Then check the headers:

```bash
curl -sI <preview-url> | grep -iE "content-security-policy|strict-transport|x-content-type|referrer-policy"
```

Expected: all four headers are present. If the preview returns 401 (Vercel Deployment Protection), check the headers from the browser devtools while signed in instead.

- [ ] **Step 3: Write the Phase 0 decisions back into the spec**

In `docs/superpowers/specs/2026-09-23-stouchi-redesign-design.md`:
- Change the status line to: `Status: approved 2026-09-23 (all four §11 decisions as proposed) · Phase 0 plan: docs/superpowers/plans/2026-09-23-stouchi-phase-0-foundations.md`.
- In §5.1, change the `--mut` row value to `#666B74` (was `#8A8F98`: 3.3 : 1 on white fails §5.6). Add a row `*-ink` | `--acc-ink #C2391B`, `--need-ink #2B5FD9`, `--want-ink #6D3FD6`, `--save-ink #0B7A52` | coloured text (≥ 4.5 : 1 on white).
- In §7, `bills` row: add `starts_on` (anchors non-monthly bills). In the rules paragraph, add:
  > `updated_at` on every mutable table; hard delete only for `savings_moves` and `bill_payments` (undo) and `push_subscriptions` (unsubscribe); `households`/`household_members` are forced only when their owner bypasses RLS (see migration 20260923).
- In §8.6, Assistant row: change `≥ 22 / 24` to `≥ 22 / 24 (rate 0.9167; 26 / 28 with today's 28 cases)`.

- [ ] **Step 4: Add a short "Refonte" section to `README.md`**

Append:

```markdown
## Refonte (branche `rebuild`)

La nouvelle application vit dans `src/` (Vite + Preact + TypeScript) ; l'application actuelle
(racine, `app.js`) reste en production jusqu'à la bascule. Spécification :
`docs/superpowers/specs/2026-09-23-stouchi-redesign-design.md`.

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement (galerie des composants en phase 0) |
| `npm run check` | format, types, lint, tests (couverture ≥ 90 % sur `src/shared`), tests de l'app actuelle |
| `npm run e2e` | Playwright + axe sur iPhone 13 et Pixel 7 |
| `npm run eval -- --min-rate 0.9167` | éval d'Aam Salah |
| `npm run backfill` | reprise des données, essai à blanc (`-- --apply` pour écrire) |
| `npm run check:supabase` | chaque table : joignable, RLS forcée, aller-retour |
```

- [ ] **Step 5: Run the Phase 0 exit QA and report each gate**

```bash
npm run format:check; echo "format $?"
npm run typecheck;    echo "types $?"
npm run lint;         echo "lint $?"
npm run test:coverage; echo "unit+db+components $?"
npm run test:legacy;  echo "legacy $?"
npm run build;        echo "build $?"
npm run e2e;          echo "e2e+axe $?"
node scripts/eval-aam-salah.js --models gemini:gemini-3.5-flash-lite --min-rate 0.9167; echo "eval $?"
npm run check:supabase; echo "supabase $?"
```

Report one line per gate with PASS/FAIL and the evidence: the coverage % on `src/shared`, the E2E count, the eval score, and the Supabase table count. Also include the CI run URL from Task 10 and the preview URL from Step 2.

State plainly which §8.6 gates are **not yet applicable** and which phase brings them:
- the feature E2E flows (onboarding, logging, edit/delete + undo, search, month switch, offline → sync) come in Phases 1–3;
- the visual screenshot diffs come in Phase 7.

- [ ] **Step 6: Commit and push**

```bash
git add vercel.json docs/superpowers/specs/2026-09-23-stouchi-redesign-design.md README.md
git commit -m "Refonte : en-têtes de sécurité pour les aperçus, décisions de la phase 0 reportées dans la spec" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
gh run watch --exit-status
```

Expected: CI is green on `rebuild`. **Do not merge to `master` and do not deploy to production.** That is Phase 7.

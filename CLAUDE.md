# Stouchi

A household budget PWA, written in French. Amounts are in Tunisian dinars (TND). Two people work on this repo (the owner and his brother).

## Stack
- Vite + Preact + TypeScript app in `src/`. Supabase (Postgres + RLS) for data and auth.
- **Hosting: Cloudflare Pages**, project `stouchi-app` (`wrangler.jsonc`, output `dist/`). Headers and CSP are in `src/public/_headers`. `/api/aam` runs as a Pages Function (`functions/api/aam.ts`). Production is the `production` branch, previews are every other branch. `npm run preview:pages` serves `dist/` locally as Pages does, and the E2E suite runs on it.
- Analytics and AI observability: PostHog (`posthog-js`, loaded on demand in `src/main.tsx`; `lib/ai-observability.js`).
- Error tracking: PostHog too (`src/app/monitoring.ts`, `src/server/monitoring.ts`). Everything sent goes through `src/shared/scrub.ts`: nothing the user typed leaves the device.
- Push notifications: the Supabase Edge Function `supabase/functions/notify-run` (built by `npm run build:notify`).

## Where things are
- **Spec, the source of truth for behaviour and data:** `docs/superpowers/specs/2026-09-23-stouchi-redesign-design.md`. Phases are listed in §10.
- **Assistant spec:** `docs/superpowers/specs/2026-09-23-aam-salah-assistant-design.md`.
- **Plans:** `docs/superpowers/plans/`. The launch plan is `2026-09-26-stouchi-phase-7-launch.md`.
- **Tests:** `tests/unit`, `tests/db` (RLS tests under PGlite, cut-over SQL in `cutover.test.ts`) and `tests/e2e` (Playwright, iPhone 13 + Pixel 7).
- **Scripts:** `scripts/backfill` (legacy → new tables), `scripts/check-size.ts`, `scripts/check-supabase.ts`.
- **Cut-over SQL** (run by hand, never as migrations): `supabase/cutover/`.
- **The legacy app** (live in production today) is **not** in this repo. It lives in the `budget-maison` repo (`../budget-maison`): `master` is production on Vercel, and the frozen `legacy` branch (read-only banner) exists only locally there and isn't pushed. Launch-day steps 2–3 run in that repo. `budget-maison/.backfill/` holds real user data backups.

## Status
- Phases 0–6 are done. Phase 7 (launch): Sessions A (hardening) and B (cut-over prep and a rehearsal on `stouchi-test`) are done. See their outcomes in the launch plan.
- The Session A+B work was merged here from `budget-maison` in PR #9 (2026-09-27).
- **Launch: Sunday 1 November 2026, morning, on Cloudflare Pages** (decided 2026-09-27).
- **Next:** Session B′ code is done (see "Session B′ outcome" in the launch plan). The owner creates the Cloudflare Pages project and disconnects the Vercel `stouchi` project and the `stouchi` Worker; then the preview checks and the rehearsal (Task 17), then Session C (launch day).
- Still for the owner before launch:
  - the backfill dry run on production;
  - the Auth settings on production;
  - the GitHub secrets (`GEMINI_API_KEY` and the ones `db-backup.yml` needs);
  - the plan's "before Session C" list.

## Open decisions
- Settled on 2026-09-27: D9 (address `https://stouchi-app.pages.dev`), D10 (PostHog for errors), D11 (production branch `production`). The WebKit input flake and the sync-loop finding are fixed (launch plan, "Session B′ outcome").

## Commands
- `npm run dev`: Vite dev server, http://localhost:5173.
- `npm run check`: the full gate (format, typecheck, lint, unit + DB tests with coverage). Run it before every commit.
- `npm run check:size`, after `npm run build`: first-load JS must stay ≤ 150 kB gzip (spec §8.4). CI runs it.
- `npm run e2e`: the Playwright tests (against `stouchi-test`).
- `npm run eval`: the Aam Salah eval. It needs `GEMINI_API_KEY` in `.env`.
- `npm run backfill`: dry run only. `-- --apply` writes (see "Safety").

## Domain rules
- **Money:** integer millimes (1 TND = 1000). Never use floats. Helpers are in `src/shared/money.ts`.
- **Dates:** Africa/Tunis. Figures use pay periods, not calendar months (`src/shared/dates.ts`).
- **Categories:** `src/shared/categories.ts` must stay aligned with `CAT_POT` in `lib/aam-salah/validate.js`.
- **UI text:** French only, in `src/shared/i18n/fr.json`. No hard-coded strings in components.
- **Tool versions:** TypeScript is pinned to 6.0.x (typescript-eslint needs < 6.1), and ESLint stays on 9 for jsx-a11y.

## Backends
- **Dev and E2E:** the Supabase test project `stouchi-test` (`sfradlloqjmphjmlvaaw`). `.env` points `VITE_SUPABASE_*`, `SUPABASE_*` and `TEST_USER_*` / `TEST_PARTNER_*` at it.
- **Production:** Supabase project `gfbakmwllhuhfdydbcfa`.

## Safety (always ask before these)
- No production deploy (Cloudflare or Vercel), no migration or SQL on production Supabase, and no push to `main` without explicit approval.
- Never run `npm run backfill -- --apply` without explicit approval.
- **Secrets:**
  - Never commit `.env` or print its values.
  - `SUPABASE_SERVICE_ROLE_KEY` is for local backfill only and never goes to Cloudflare, Vercel or GitHub.
  - `.backfill/` holds real user data and stays gitignored.

## Working together
- Pull before you start. Work on a branch and merge through a pull request, so the two of you never overwrite each other.
- One Claude session per folder or worktree (`claude --worktree`), so sessions don't switch each other's branch.
- Commit only when asked. Commit messages are in French, in the style of the existing history.
- **Line endings:** Git's index stores LF. If Prettier flags files right after a checkout, restore them with `git -c core.autocrlf=false checkout -- <files>`.

## Working style (keep token use low)
- One phase or task per session. Hand over through the plan and spec files, not the chat history.
- Plans list files, behaviour and tests. No full code in plans.
- Give careful review to money, data, RLS and migration work. For screens, rely on tests, E2E and a comparison against the prototype screenshots.

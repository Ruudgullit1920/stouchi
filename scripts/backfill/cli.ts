/* One-off backfill (spec §9). Dry run by default:
 *
 *   npm run backfill              backup + report in .backfill/, writes nothing
 *   npm run backfill -- --apply   same, then upserts — only if verification passes
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env: it reads every
 * account, so RLS must be bypassed. Local admin use only — this key never goes
 * to Cloudflare. .backfill/ holds real users' data and is gitignored. Only counts
 * are printed, never personal data. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { str } from './convert';
import { runBackfill, type Sink, type Source } from './run';

type Rec = Record<string, unknown>;

/* Untyped client: results come back as `any`; narrowing them to `unknown` here keeps typed lint honest. */
async function must(
  p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<unknown> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

/** `.range()` pages need a stable order first — Postgres makes no ordering
 *  promise across pages without one, so an unordered `.range()` can repeat or
 *  skip rows between calls when the table is written concurrently. */
async function readAll(
  sb: SupabaseClient,
  table: string,
  columns: string,
  orderBy: string[],
): Promise<Rec[]> {
  const out: Rec[] = [];
  for (let from = 0; ; from += 1000) {
    let query = sb.from(table).select(columns);
    for (const col of orderBy) query = query.order(col);
    const page = ((await must(query.range(from, from + 999), table)) ?? []) as Rec[];
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
  if (!url || !key)
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (no fallback on purpose).');
  const apply = process.argv.includes('--apply');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Project ${new URL(url).host} · ${apply ? 'APPLY' : 'dry run'}`);

  const source: Source = {
    async legacyRows() {
      return (await readAll(sb, 'budget_data', 'user_id, created_at, data', ['user_id'])).map((r) => ({
        user_id: String(r.user_id),
        created_at: String(r.created_at),
        data: r.data,
      }));
    },
    async households() {
      const docs = await readAll(sb, 'household_shared_data', 'household_id, data', ['household_id']);
      const members = await readAll(
        sb,
        'household_members',
        'household_id, user_id, joined_at, display_name',
        ['household_id', 'user_id'],
      );
      return docs.map((d) => ({
        household_id: String(d.household_id),
        data: d.data,
        members: members
          .filter((m) => m.household_id === d.household_id)
          .map((m) => ({
            user_id: String(m.user_id),
            joined_at: String(m.joined_at),
            display_name: str(m.display_name),
          })),
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
  console.log(
    `Rows: ${c.profiles.length} profiles, ${c.expenses.length} expenses, ${c.bills.length} bills, ` +
      `${c.debts.length} debts, ${c.goals.length} goals, ${c.savings_moves.length} savings moves`,
  );
  const byKind = c.issues.reduce<Record<string, number>>(
    (m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }),
    {},
  );
  console.log('Issues:', byKind);
  console.log(r.report.ok ? 'Verification: OK' : `Verification: ${r.report.mismatches.length} mismatches`);
  console.log(`Backup ${r.backupFile}\nReport ${r.reportFile}`);
  if (!r.report.ok) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});

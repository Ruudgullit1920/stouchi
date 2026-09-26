/* The saved queries the user runs in Supabase's SQL editor (spec §8.7, §2):
 * they must run on the real schema and count what they say. */
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALICE, BOB, freshDb } from './harness';

let db: PGlite;
type Row = Record<string, unknown>;
const run = async (file: string): Promise<Row[]> =>
  (await db.exec(readFileSync(`supabase/queries/${file}`, 'utf8'))).at(-1)?.rows ?? [];

beforeAll(async () => {
  db = await freshDb();
  const ev = (user: string, ms: number, outcome: string, ago: string) =>
    db.query(
      `insert into public.ai_events (user_id, model, latency_ms, outcome, created_at)
       values ($1, 'gemini:flash', $2, $3, now() - $4::interval)`,
      [user, ms, outcome, ago],
    );
  await ev(ALICE, 1000, 'ok', '1 hour');
  await ev(ALICE, 3000, 'ok', '2 hours');
  await ev(BOB, 5000, 'fallback', '3 hours');
  await ev(BOB, 900, 'error', '4 hours');
  await ev(BOB, 800, 'ok', '9 days'); // outside the 7 days
});

describe('ai_dashboard.sql', () => {
  it('sums the last 7 days: turns, rates and latency', async () => {
    const [row] = await run('ai_dashboard.sql');
    expect(row).toMatchObject({ turns: 4, fallback_rate: 0.25, error_rate: 0.25, validation_drop_rate: 0 });
    expect(Number(row.p95_latency_ms)).toBeGreaterThanOrEqual(4000);
  });
});

describe('launch_metrics.sql', () => {
  it('runs on the schema and names every §2 metric, measured or not', async () => {
    const rows = await run('launch_metrics.sql');
    const names = rows.map((r) => r.metric);
    expect(names).toEqual([
      'onboarding_completion',
      'weekly_active_loggers',
      'chat_p95_latency_ms',
      'median_time_to_log',
      'crash_free_sessions',
      'expenses_lost',
    ]);
  });
});

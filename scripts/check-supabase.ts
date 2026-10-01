/* Database ship check (spec §7): for every table — reachable, RLS enabled and
 * forced, and a real read/write round trip as a signed-in user.
 *
 *   npm run check:supabase
 *
 * Runs as a dedicated TEST account with the anon key, never the service key:
 * the point is to see exactly what a user can and cannot do. Goals, bills,
 * debts, reminders, incomes and ai_events have no delete policy by design, so each run
 * leaves a few "QA" rows in that account — use an account that exists only
 * for this. */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { todayTunis } from '../src/shared/dates';
import { CoupleState } from '../src/shared/schemas';
import { SPEC_TABLES, type SpecTable } from './supabase-check/tables';
import {
  formatResults,
  passed,
  rlsForced,
  type RlsRow,
  type RoundTrip,
  type TableResult,
} from './supabase-check/verdict';

type Row = Record<string, unknown>;
type Ctx = { sb: SupabaseClient; me: string; today: string; ids: Record<string, string> };

async function must(
  p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<unknown> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

/** insert → update → read back → optional clean-up (soft delete or state column) */
async function crud(
  c: Ctx,
  table: SpecTable,
  row: Row & { id: string },
  change: Row,
  cleanup?: Row,
): Promise<RoundTrip> {
  await must(c.sb.from(table).insert(row), 'insert');
  await must(c.sb.from(table).update(change).eq('id', row.id), 'update');
  const got = (await must(c.sb.from(table).select('*').eq('id', row.id).single(), 'read')) as Row;
  if (cleanup) await must(c.sb.from(table).update(cleanup).eq('id', row.id), 'clean-up');
  const [k, v] = Object.entries(change)[0];
  return got[k] === v ? 'ok' : `failed: ${k} not read back`;
}

/** insert → read → delete → confirm gone */
async function insertReadDelete(
  c: Ctx,
  table: SpecTable,
  row: Row,
  [col, val]: [string, string],
): Promise<RoundTrip> {
  await must(c.sb.from(table).insert(row), 'insert');
  const got = (await must(c.sb.from(table).select('*').eq(col, val), 'read')) as unknown[];
  await must(c.sb.from(table).delete().eq(col, val), 'delete');
  const gone = (await must(c.sb.from(table).select('*').eq(col, val), 'read after delete')) as unknown[];
  return got.length === 1 && gone.length === 0 ? 'ok' : 'failed: insert/delete not reflected';
}

/* Household rows are written only through the security-definer RPCs (create/join). */
const readOnly =
  (table: SpecTable) =>
  async (c: Ctx): Promise<RoundTrip> => {
    await must(c.sb.from(table).select('*').limit(1), 'read');
    return 'read-only by design';
  };

const ROUND_TRIPS: Record<SpecTable, (c: Ctx) => Promise<RoundTrip>> = {
  profiles: async ({ sb, me }) => {
    await must(
      sb.from('profiles').upsert({ user_id: me, first_name: 'QA' }, { onConflict: 'user_id' }),
      'upsert',
    );
    await must(sb.from('profiles').update({ first_name: 'QA 2' }).eq('user_id', me), 'update');
    const row = (await must(
      sb.from('profiles').select('first_name').eq('user_id', me).single(),
      'read',
    )) as Row;
    return row.first_name === 'QA 2' ? 'ok' : 'failed: first_name not read back';
  },
  households: readOnly('households'),
  household_members: readOnly('household_members'),
  goals: (c) => {
    c.ids.goal = randomUUID();
    return crud(
      c,
      'goals',
      { id: c.ids.goal, name: 'QA', icon: 'piggy-bank', target_mil: 1000 },
      { name: 'QA 2' },
    );
  },
  bills: (c) => {
    c.ids.bill = randomUUID();
    return crud(
      c,
      'bills',
      { id: c.ids.bill, label: 'QA', amount_mil: 1000, frequency: 'monthly', day: 1 },
      { label: 'QA 2' },
      { active: false },
    );
  },
  expenses: (c) =>
    crud(
      c,
      'expenses',
      { id: randomUUID(), amount_mil: 1000, category: 'autre', pot: 'wants', label: 'QA', spent_on: c.today },
      { label: 'QA 2' },
      { deleted_at: new Date().toISOString() },
    ),
  bill_payments: (c) =>
    insertReadDelete(c, 'bill_payments', { bill_id: c.ids.bill, period_start: c.today }, [
      'bill_id',
      c.ids.bill,
    ]),
  debts: (c) =>
    crud(
      c,
      'debts',
      { id: randomUUID(), direction: 'i_owe', person: 'QA', amount_mil: 1000 },
      { note: 'QA 2' },
      { settled_at: new Date().toISOString() },
    ),
  savings_moves: (c) => {
    const id = randomUUID();
    return insertReadDelete(
      c,
      'savings_moves',
      { id, goal_id: c.ids.goal, amount_mil: 1000, kind: 'deposit', occurred_on: c.today },
      ['id', id],
    );
  },
  reminders: (c) =>
    crud(
      c,
      'reminders',
      { id: randomUUID(), text: 'QA', remind_at: new Date().toISOString() },
      { text: 'QA 2' },
      { done_at: new Date().toISOString() },
    ),
  notifications: async ({ sb, me }) => {
    await must(sb.from('notifications').select('id').limit(1), 'read');
    const { error } = await sb
      .from('notifications')
      .insert({ user_id: me, trigger: 'qa', dedupe_key: randomUUID(), title: 'QA', body: 'QA' });
    return error ? 'read-only by design' : 'failed: a user could create a notification';
  },
  push_subscriptions: (c) => {
    /* a known push host (20261001's check); the row is deleted right after */
    const endpoint = `https://fcm.googleapis.com/fcm/send/qa-check-${randomUUID()}`;
    return insertReadDelete(c, 'push_subscriptions', { endpoint, p256dh: 'qa', auth: 'qa' }, [
      'endpoint',
      endpoint,
    ]);
  },
  incomes: (c) =>
    crud(
      c,
      'incomes',
      { id: randomUUID(), amount_mil: 1000, pot: 'wants', label: 'QA', received_on: c.today },
      { label: 'QA 2' },
      { deleted_at: new Date().toISOString() },
    ),
  ai_events: async ({ sb }) => {
    const model = `qa-${randomUUID().slice(0, 8)}`;
    await must(sb.from('ai_events').insert({ model, latency_ms: 1, outcome: 'ok' }), 'insert');
    const got = (await must(sb.from('ai_events').select('model').eq('model', model), 'read')) as unknown[];
    return got.length === 1 ? 'ok' : 'failed: not read back';
  },
};

/* Phase 6: only calls with no side effects. The helpers that write
   (couple_tag, couple_leave_for) are never called, even to see them refused,
   so a stray grant can't dissolve the test account's household. */
async function checkCouple(sb: SupabaseClient, signedOut: SupabaseClient, c: Ctx): Promise<string[]> {
  const line = (ok: boolean, what: string) => `${ok ? '✓' : '✗'} ${what}`;
  const out: string[] = [];
  out.push(
    line(
      !!(await sb.from('household_invites').select('code').limit(1)).error,
      'household_invites is unreadable',
    ),
  );
  for (const table of ['goals', 'incomes'] as const) {
    const { error } = await sb.from(table).select('household_id').limit(1);
    out.push(line(!error, `${table}.household_id exists`));
  }
  const state = await sb.rpc('couple_state', { p_on: c.today });
  out.push(
    line(!state.error && CoupleState.safeParse(state.data).success, 'couple_state answers the test account'),
  );
  const rpcs: [string, Record<string, unknown>][] = [
    ['couple_state', { p_on: c.today }],
    ['couple_invite', {}],
    ['couple_cancel', {}],
    ['couple_join', { p_code: 'STC-AAAAAA' }],
    ['couple_leave', {}],
    ['couple_request', { p_expense: randomUUID(), p_change: { kind: 'delete' } }],
  ];
  for (const [fn, args] of rpcs) {
    out.push(line(!!(await signedOut.rpc(fn, args)).error, `${fn} refuses a caller with no session`));
  }
  const helpers: [string, Record<string, unknown>][] = [
    ['couple_period_start', { d: c.today, payday: 1 }],
    ['couple_needs_mil', { who: c.me, p_on: c.today }],
    ['couple_state_for', { me: c.me, p_on: c.today }],
    ['couple_change_ok', { c: { kind: 'delete' } }],
  ];
  for (const [fn, args] of helpers) {
    out.push(line(!!(await sb.rpc(fn, args)).error, `${fn} is not callable by a signed-in user`));
  }
  return out;
}

async function main() {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* no .env: rely on the environment */
  }
  const {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anon,
    TEST_USER_EMAIL: email,
    TEST_USER_PASSWORD: password,
  } = process.env;
  if (!url || !anon || !email || !password) {
    throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY, TEST_USER_EMAIL and TEST_USER_PASSWORD in .env');
  }
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data: auth, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !auth.user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`);
  console.log(`Project ${new URL(url).host} · signed in as the test account\n`);

  const report = (await must(
    sb.rpc('rls_report'),
    'rls_report — is 20260923_redesign_schema.sql applied?',
  )) as RlsRow[];
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
  /* Phase 5: account deletion must refuse a caller with no session. Never call
     it as the test account — it would delete it. */
  const signedOut = createClient(url, anon, { auth: { persistSession: false } });
  const anonDelete = await signedOut.rpc('delete_my_account');
  if (anonDelete.error) console.log('\ndelete_my_account: refused without a session');
  else {
    console.error('\ndelete_my_account: a caller with no session was NOT refused');
    process.exitCode = 1;
  }
  const couple = await checkCouple(sb, signedOut, ctx);
  console.log(`\nCouple mode (phase 6):\n${couple.map((c) => `  ${c}`).join('\n')}`);
  if (couple.some((c) => c.startsWith('✗'))) process.exitCode = 1;
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

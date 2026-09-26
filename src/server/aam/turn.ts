/* One Aam Salah turn on the server (plan Task 4). The server never writes
 * user data: it authenticates the caller, loads their rows with their JWT,
 * builds the carnet with the screens' maths, runs the eval-proven pipeline
 * (handleAam) and maps short ids back to real ids. The app runs the actions.
 *
 * Only an ai_events row is written — model, latency, outcome, action types,
 * never message text — and a failed insert never blocks the reply. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AamAction, AamResult, handleAam as HandleAam } from '../../../lib/aam-salah/index.js';
import { buildCarnet, type LastAction } from '../../shared/carnet';
import { todayTunis } from '../../shared/dates';
import { t, type StringKey } from '../../shared/i18n/t';
import { loadRows } from './load';

export interface TurnDeps {
  /** a Supabase client that sends the caller's JWT (anon key, never the service key) */
  client: (token: string) => SupabaseClient;
  handleAam: typeof HandleAam;
  env: Record<string, string | undefined>;
  now: () => Date;
  warn: (...args: unknown[]) => void;
  /** the pipeline's SAFE reply, shown instead of one that claims a dropped action happened */
  safe: { fr: string; en: string };
}

export type TurnAction = AamAction & { ref?: string };
export type AamResponse =
  | { reply: string; actions: TurnAction[]; chips: string[]; lang: 'fr' | 'en'; nudgeKey: string | null }
  | { error: string };
export interface TurnResult {
  status: number;
  body: AamResponse;
}

const RATE_TURNS = 30;
const RATE_WINDOW_MS = 10 * 60_000;
const NUDGES_KEPT = 50;
/* the short id's kind letter each id-bearing action must name */
const ID_KIND: Record<string, string> = {
  edit_expense: 'e',
  delete_expense: 'e',
  partner_request: 'e',
  pay_bill: 'b',
  settle_debt: 'd',
};
const ACTION_TYPE = /^[a-z_]{2,30}$/;

/** A TND amount the app can store: a whole number of millimes (12.5 yes, 0.0004 no). */
const wholeMillimes = (x: unknown) =>
  typeof x !== 'number' || (Number.isFinite(x) && Math.abs(x * 1000 - Math.round(x * 1000)) < 1e-6);
/* amount (add_*, savings_*, add_debt), changes.amount (edit_expense), target (update_goal) */
const amountsOk = (a: AamAction) =>
  wholeMillimes(a.amount) &&
  wholeMillimes(a.target) &&
  wholeMillimes((a.changes as { amount?: unknown } | undefined)?.amount);

const fail = (status: number, key: StringKey): TurnResult => ({ status, body: { error: t(key) } });

function lastActionFrom(v: unknown): LastAction | null {
  if (!v || typeof v !== 'object') return null;
  const { type, ref, at } = v as Record<string, unknown>;
  const ok = (s: unknown, max: number): s is string =>
    typeof s === 'string' && s.length > 0 && s.length <= max;
  /* no summary: the carnet describes the row itself, client text never reaches the model */
  return ok(type, 30) && ok(ref, 40) && ok(at, 40) && !Number.isNaN(Date.parse(at))
    ? { type, ref, at }
    : null;
}

const nudgesFrom = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((s): s is string => typeof s === 'string' && s.length <= 80).slice(-NUDGES_KEPT)
    : [];

export async function runTurn(deps: TurnDeps, token: string, body: unknown): Promise<TurnResult> {
  if (!token) return fail(401, 'aam.error.auth');
  const sb = deps.client(token);
  const { data: auth, error: authError } = await sb.auth.getUser(token);
  if (authError || !auth.user) return fail(401, 'aam.error.auth');
  const userId = auth.user.id;

  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!Array.isArray(input.messages)) return fail(400, 'aam.error.badRequest');

  const now = deps.now();
  const since = new Date(now.getTime() - RATE_WINDOW_MS).toISOString();
  const { count, error: countError } = await sb
    .from('ai_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);
  if (countError) deps.warn('[aam] rate count failed', countError.message);
  if ((count ?? 0) >= RATE_TURNS) return fail(429, 'aam.error.rate');

  let rows;
  try {
    rows = await loadRows(sb, userId, todayTunis(now));
  } catch (e) {
    deps.warn('[aam] load failed', e instanceof Error ? e.message : e);
    return fail(503, 'aam.error.down');
  }
  const { profile, partner, ...rest } = rows;
  if (!profile?.onboarded_at) return fail(409, 'aam.error.notReady');

  const { carnet, refs, nudgeKey } = buildCarnet({
    ...rest,
    profile,
    couple: partner ? { me: userId, partnerNeeds: partner.needs_mil } : null,
    partner,
    firstName: profile.first_name,
    nudgeSeen: nudgesFrom(input.nudgeSeen),
    lastAction: lastActionFrom(input.lastAction),
    now,
  });

  const t0 = Date.now();
  const res: AamResult = await deps.handleAam({
    messages: input.messages,
    carnet,
    env: deps.env,
    posthogDistinctId: userId,
  });
  const log = async (model: string, outcome: string, types: string[]) => {
    const row = {
      model,
      latency_ms: Date.now() - t0,
      outcome,
      action_types: [...new Set(types)].filter((x) => ACTION_TYPE.test(x)).slice(0, 10),
    };
    try {
      const { error } = await sb.from('ai_events').insert(row);
      if (error) deps.warn('[aam] ai_events insert failed', error.message);
    } catch (e) {
      deps.warn('[aam] ai_events insert failed', e instanceof Error ? e.message : e);
    }
  };

  if (res.status !== 200 || !('reply' in res.body)) {
    await log('none', 'error', []);
    const status = res.status === 200 ? 503 : res.status;
    return fail(status, status < 500 ? 'aam.error.badRequest' : 'aam.error.down');
  }

  const { reply, chips, lang, model, dropped } = res.body;
  const actions: TurnAction[] = [];
  let ours = 0;
  for (const a of res.body.actions) {
    if (!amountsOk(a)) {
      ours++;
      continue;
    }
    if (a.id === undefined) {
      actions.push(a);
      continue;
    }
    const ref = refs.get(a.id);
    const kind = ID_KIND[a.type];
    if (!ref || (kind && a.id[0] !== kind)) ours++;
    else actions.push({ ...a, ref });
  }
  /* Anything dropped, here or in the pipeline: nothing runs and the reply is the
     safe line, so it can never claim — or deny — what the app actually does. */
  const anyDropped = dropped > 0 || ours > 0;
  await log(model, anyDropped ? 'validation_drop' : 'ok', anyDropped ? [] : actions.map((a) => a.type));
  return {
    status: 200,
    body: anyDropped
      ? { reply: deps.safe[lang], actions: [], chips: [], lang, nudgeKey }
      : { reply, actions, chips, lang, nudgeKey },
  };
}

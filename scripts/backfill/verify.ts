/* Spec §9.3 verification: for every source document, month and pot, what today's
 * app counted must equal what the new rows count plus what was reported as
 * skipped. Anything else means a row was lost, duplicated or mis-filed.
 *
 * Two more checks past that per-bucket gate:
 *  - invariants: structural facts that must hold regardless of amounts (every
 *    bill/debt landed somewhere, one profile per account, every goal balances);
 *  - appDiffs: non-failing. Recomputes totals the way today's app itself did
 *    (budget-facts.js's naive `Number(e.amount) || 0`, no date/amount
 *    validation) and lists every bucket where that disagrees with the new
 *    rows — mostly the bugs being fixed, e.g. a French-formatted amount the
 *    app silently counted as 0. */
import type { Pot } from '../../src/shared/categories';
import {
  checkAllConverted,
  checkGoalBalances,
  checkMoveOwnership,
  checkOneProfilePerAccount,
  type Invariant,
} from './invariants';
import { isSharedExpense, legacyAmount, legacyDate, legacyPot } from './legacy';
import {
  indexHouseholds,
  isRec,
  rawEntries,
  type Converted,
  type LegacyHousehold,
  type LegacyRow,
  type Rec,
} from './shared';

export type { Invariant } from './invariants';
export interface Mismatch {
  source: string;
  month: string;
  pot: Pot;
  oldMil: number;
  newMil: number;
  skippedMil: number;
}
export interface AppDiff {
  source: string;
  month: string;
  pot: Pot;
  appMil: number;
  newMil: number;
}
export interface VerifyResult {
  ok: boolean;
  mismatches: Mismatch[];
  skippedMil: number;
  invariants: Invariant[];
  appDiffs: AppDiff[];
}

type Totals = Map<string, number>;
const keyOf = (source: string, month: string, pot: Pot) => `${source}|${month}|${pot}`;
const splitKey = (k: string): [string, string, Pot] => k.split('|') as [string, string, Pot];
const add = (m: Totals, key: string, mil: number) => m.set(key, (m.get(key) ?? 0) + mil);

/** Every non-tombstone document, its source tag, and the legacy ids its own
 *  household already owns (so a member's stale mirror is excluded, same as convertAll). */
function* documents(
  rows: LegacyRow[],
  households: LegacyHousehold[],
): Generator<{ source: string; doc: Rec; skipRefs: Set<string> }> {
  const { householdOf, owned } = indexHouseholds(households);
  for (const h of households) {
    if (h.members.length === 0) continue;
    yield { source: `hh:${h.household_id}`, doc: isRec(h.data) ? h.data : {}, skipRefs: new Set() };
  }
  for (const r of rows) {
    if (!isRec(r.data) || !isRec(r.data.settings)) continue; // never onboarded: no budget was ever shown
    const hid = householdOf.get(r.user_id);
    yield {
      source: `user:${r.user_id}`,
      doc: r.data,
      skipRefs: (hid && owned.get(hid)) || new Set(),
    };
  }
}

/** Every entry today's app would have counted: a readable positive amount on a real date. */
function legacyTotals(rows: LegacyRow[], households: LegacyHousehold[]): Totals {
  const totals: Totals = new Map();
  for (const { source, doc, skipRefs } of documents(rows, households)) {
    const { recs, refs } = rawEntries(doc.expenses);
    recs.forEach((e, i) => {
      /* B1: skipRefs only excludes a genuine mirror — an id match on an entry
         that isn't itself shared (isSharedExpense) must still be counted
         against its own account, same as convert.ts and invariants.ts. */
      if (e.deleted === true || (skipRefs.has(refs[i]) && isSharedExpense(e))) return;
      const mil = legacyAmount(e.amount);
      const date = legacyDate(e);
      if (mil !== null && mil > 0 && date) add(totals, keyOf(source, date.slice(0, 7), legacyPot(e)), mil);
    });
  }
  return totals;
}

/* app.js's own `String(e.date || mk)`, minus the base-to-string risk: a legacy
 * date is always a string in practice, but `e.date` is `unknown` here, and
 * @typescript-eslint/no-base-to-string refuses to stringify that blind. */
const dateStr = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** Today's app's own arithmetic (budget-facts.js): no parsing, no validation —
 *  just `Number(e.amount) || 0`, bucketed by envelope, sliced month. */
function appTotals(rows: LegacyRow[], households: LegacyHousehold[]): Totals {
  const totals: Totals = new Map();
  for (const { source, doc, skipRefs } of documents(rows, households)) {
    const { recs, refs } = rawEntries(doc.expenses);
    recs.forEach((e, i) => {
      if (e.deleted === true || (skipRefs.has(refs[i]) && isSharedExpense(e))) return;
      const pot: Pot | null = e.envelope === 'besoins' ? 'needs' : e.envelope === 'perso' ? 'wants' : null;
      if (!pot) return;
      const month = dateStr(e.date).slice(0, 7);
      add(totals, keyOf(source, month, pot), Math.round((Number(e.amount) || 0) * 1000));
    });
  }
  return totals;
}

export function verify(rows: LegacyRow[], households: LegacyHousehold[], out: Converted): VerifyResult {
  const old = legacyTotals(rows, households);
  const now: Totals = new Map();
  const skipped: Totals = new Map();
  out.expenses.forEach((e) =>
    add(now, keyOf(out.origin[e.id] ?? '?', e.spent_on.slice(0, 7), e.pot), e.amount_mil),
  );
  out.savings_moves.forEach((m) => {
    if (m.from_pot)
      add(now, keyOf(out.origin[m.id] ?? '?', m.occurred_on.slice(0, 7), m.from_pot), m.amount_mil);
  });
  out.issues.forEach((i) => {
    // rowKept: the amount is already sitting in a real output row (e.g.
    // epargne_kept_as_expense) — adding it back here would double-count it.
    if (i.mil && i.month && i.pot && !i.rowKept) add(skipped, keyOf(i.source, i.month, i.pot), i.mil);
  });

  const mismatches: Mismatch[] = [];
  for (const k of new Set([...old.keys(), ...now.keys(), ...skipped.keys()])) {
    const [source, month, pot] = splitKey(k);
    const oldMil = old.get(k) ?? 0;
    const newMil = now.get(k) ?? 0;
    const skippedMil = skipped.get(k) ?? 0;
    if (oldMil !== newMil + skippedMil) mismatches.push({ source, month, pot, oldMil, newMil, skippedMil });
  }

  const invariants = [
    checkAllConverted(rows, households, out),
    checkOneProfilePerAccount(rows, out),
    checkGoalBalances(rows, households, out),
    checkMoveOwnership(out),
  ];

  const app = appTotals(rows, households);
  const appDiffs: AppDiff[] = [];
  for (const k of new Set([...app.keys(), ...now.keys()])) {
    const [source, month, pot] = splitKey(k);
    const appMil = app.get(k) ?? 0;
    const newMil = now.get(k) ?? 0;
    if (appMil !== newMil) appDiffs.push({ source, month, pot, appMil, newMil });
  }

  return {
    ok: mismatches.length === 0 && invariants.every((i) => i.pass),
    mismatches,
    skippedMil: [...skipped.values()].reduce((a, b) => a + b, 0),
    invariants,
    appDiffs,
  };
}

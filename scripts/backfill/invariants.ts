/* verify()'s structural checks: facts that must hold regardless of amounts —
 * every bill/debt landed somewhere, one profile per account, every goal
 * balances to its legacy "saved", every savings move is owned by its goal's
 * owner. Split out of verify.ts, which was otherwise pushing 340 lines. */
import { isSharedBill, legacyAmount, legacyCharges } from './legacy';
import { fieldV, householdGoalCounts } from './savings';
import {
  idFor,
  indexHouseholds,
  isRec,
  pickAnchor,
  rawEntries,
  type Converted,
  type LegacyHousehold,
  type LegacyRow,
  type Rec,
} from './shared';

export interface Invariant {
  name: string;
  pass: boolean;
  detail: string;
}

/** Every non-tombstone bill and debt entry is either a row or an explained issue. */
export function checkAllConverted(
  rows: LegacyRow[],
  households: LegacyHousehold[],
  out: Converted,
): Invariant {
  const billIds = new Set(out.bills.map((b) => b.id));
  const debtIds = new Set(out.debts.map((d) => d.id));
  const hasIssue = (source: string, ref: string) =>
    out.issues.some((i) => i.source === source && i.ref === ref);
  const missing: string[] = [];
  const check = (source: string, ref: string, id: string, tag: string, ids: Set<string>) => {
    if (ids.has(id) || hasIssue(source, tag)) return;
    missing.push(`${source}/${tag}`);
  };
  const { owned, householdOf } = indexHouseholds(households);
  const householdOwned = (hid: string | undefined) => (hid && owned.get(hid)) || new Set<string>();

  for (const h of households) {
    if (h.members.length === 0) continue;
    const source = `hh:${h.household_id}`;
    const doc: Rec = isRec(h.data) ? h.data : {};
    const { recs, refs } = rawEntries(doc.bills);
    recs.forEach((b, i) => {
      if (b.deleted === true) return;
      check(source, refs[i], idFor(source, 'bill', refs[i]), `bill:${refs[i]}`, billIds);
    });
  }
  for (const r of rows) {
    if (!isRec(r.data) || !isRec(r.data.settings)) continue;
    const source = `user:${r.user_id}`;
    const mirrored = householdOwned(householdOf.get(r.user_id));
    const bills = rawEntries(r.data.bills);
    const billRefs = new Set(bills.refs);
    bills.recs.forEach((b, i) => {
      /* B1: only a genuinely shared entry is excused by the id match — see
         convert.ts and legacy.ts's isSharedExpense/isSharedBill. */
      if (b.deleted === true || (mirrored.has(`bill:${bills.refs[i]}`) && isSharedBill(b))) return;
      check(source, bills.refs[i], idFor(source, 'bill', bills.refs[i]), `bill:${bills.refs[i]}`, billIds);
    });
    /* R6: settings.charges (the pre-bills format) converts through the same
       path as a real bill — a real bill with the same ref silently wins, same
       as convertAll — so it must be covered by this invariant too. */
    legacyCharges(r.data.settings).forEach(({ rec, ref }) => {
      if (billRefs.has(ref) || (mirrored.has(`bill:${ref}`) && isSharedBill(rec))) return;
      check(source, ref, idFor(source, 'bill', ref), `bill:${ref}`, billIds);
    });
    const debts = rawEntries(r.data.debts);
    debts.recs.forEach((d, i) => {
      if (d.deleted === true) return;
      check(source, debts.refs[i], idFor(source, 'debt', debts.refs[i]), `debt:${debts.refs[i]}`, debtIds);
    });
  }
  return {
    name: 'every bill and debt is converted or explained',
    pass: missing.length === 0,
    detail: missing.length === 0 ? 'ok' : `unaccounted for: ${missing.join(', ')}`,
  };
}

export function checkOneProfilePerAccount(rows: LegacyRow[], out: Converted): Invariant {
  const onboarded = new Set(
    rows.filter((r) => isRec(r.data) && isRec(r.data.settings)).map((r) => r.user_id),
  );
  const profileIds = out.profiles.map((p) => p.user_id);
  const pass =
    profileIds.length === onboarded.size &&
    new Set(profileIds).size === profileIds.length &&
    profileIds.every((id) => onboarded.has(id));
  return {
    name: 'one profile per onboarded account',
    pass,
    detail: pass ? 'ok' : `expected ${onboarded.size} profiles, got ${profileIds.length}`,
  };
}

/** What each goal source's "saved" balance legally is, read straight from the
 *  legacy documents — never from the converter's own output. Fix round 2, R5:
 *  invariant 3 must be able to catch the converter getting this arithmetic
 *  wrong, so it can't reuse the converter's own copy of it. */
function expectedSavedBySource(rows: LegacyRow[], households: LegacyHousehold[]): Map<string, number> {
  const expected = new Map<string, number>();
  const onboarded = new Set(
    rows.filter((r) => isRec(r.data) && isRec(r.data.settings)).map((r) => r.user_id),
  );
  const { householdOf } = indexHouseholds(households);
  for (const h of households) {
    if (h.members.length === 0) continue;
    const { anchor, isOnboarded } = pickAnchor(h.members, onboarded);
    if (!anchor) continue;
    const doc: Rec = isRec(h.data) ? h.data : {};
    const g = doc.goal;
    let saved = 0;
    if (householdGoalCounts(g)) {
      saved = Math.max(0, legacyAmount(fieldV(g, 'saved')) ?? 0);
    } else if (isOnboarded) {
      const anchorRow = rows.find((r) => r.user_id === anchor.user_id);
      const s =
        anchorRow && isRec(anchorRow.data) && isRec(anchorRow.data.settings) ? anchorRow.data.settings : null;
      saved = s ? Math.max(0, legacyAmount(s.saved) ?? 0) : 0;
    }
    expected.set(`hh:${h.household_id}`, saved);
  }
  for (const r of rows) {
    if (!isRec(r.data) || !isRec(r.data.settings) || householdOf.has(r.user_id)) continue;
    expected.set(`user:${r.user_id}`, Math.max(0, legacyAmount(r.data.settings.saved) ?? 0));
  }
  return expected;
}

export function checkGoalBalances(
  rows: LegacyRow[],
  households: LegacyHousehold[],
  out: Converted,
): Invariant {
  const expected = expectedSavedBySource(rows, households);
  const goalSource = new Map(out.goals.map((g) => [g.id, out.origin[g.id] ?? '?']));
  const actual = new Map<string, number>();
  out.savings_moves.forEach((m) => {
    const source = goalSource.get(m.goal_id);
    if (source) actual.set(source, (actual.get(source) ?? 0) + m.amount_mil);
  });
  /* The exact excess a savings_exceed_saved issue admits to, per source — not
     just "some issue exists" (fix round 3, R3): an extra move on an already-
     excused goal must still be caught. */
  const excess = new Map<string, number>();
  out.issues.forEach((i) => {
    if (i.kind === 'savings_exceed_saved' && i.mil) excess.set(i.source, (excess.get(i.source) ?? 0) + i.mil);
  });
  const hasGoal = new Set(goalSource.values());
  // fix round 3: a goal source with no legacy counterpart (e.g. a spurious
  // goal on a household member, who can never have one of their own) must
  // still be checked — iterating only `expected`'s keys let it through.
  const sources = new Set([...expected.keys(), ...hasGoal]);

  const bad: string[] = [];
  for (const source of sources) {
    const exp = expected.get(source) ?? 0;
    const act = actual.get(source) ?? 0;
    if (act === exp) continue;
    if (act > exp) {
      if (act - exp === (excess.get(source) ?? 0)) continue;
      bad.push(`${source}: ${act} > expected ${exp}, excess doesn't match its savings_exceed_saved issue`);
      continue;
    }
    if (exp > 0 && !hasGoal.has(source)) {
      bad.push(`${source}: expected ${exp} but no goal exists`);
      continue;
    }
    bad.push(`${source}: ${act} ≠ expected ${exp}`);
  }
  return {
    name: 'every goal balances to its legacy saved amount',
    pass: bad.length === 0,
    detail: bad.length === 0 ? 'ok' : bad.join('; '),
  };
}

/** RLS only lets a goal's owner write a savings move against it — so a move
 *  whose user_id doesn't match its goal's owner (or names a goal that isn't
 *  in the output at all) could never actually be inserted. */
export function checkMoveOwnership(out: Converted): Invariant {
  const goalOwner = new Map(out.goals.map((g) => [g.id, g.user_id]));
  const bad: string[] = [];
  out.savings_moves.forEach((m) => {
    const owner = goalOwner.get(m.goal_id);
    if (owner === undefined) {
      bad.push(`${m.id}: references unknown goal ${m.goal_id}`);
    } else if (owner !== m.user_id) {
      bad.push(`${m.id}: user_id ${m.user_id} ≠ goal owner ${owner}`);
    }
  });
  return {
    name: "every savings move's user_id matches its goal's owner",
    pass: bad.length === 0,
    detail: bad.length === 0 ? 'ok' : bad.join('; '),
  };
}

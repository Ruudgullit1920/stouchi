/* Today's JSON documents (budget_data, household_shared_data) → rows of the
 * spec §7 tables. Pure: no I/O, and the clock comes in as `now`, so a re-run on
 * the same input yields the same rows with the same ids (spec §9.3). Anything
 * that can't be converted is reported as an issue, never dropped silently.
 *
 * Types and small readers (isRec, records, refOf, indexHouseholds, …) live in
 * ./shared; per-entry row building lives in ./rows; goal/savings-move
 * construction lives in ./savings. All are re-exported here so `./convert`
 * stays the one import path the brief and the tests use. */
import { todayTunis } from '../../src/shared/dates';
import { isSharedBill, isSharedExpense, legacyCharges, notOnboardedDetail } from './legacy';
import { convertBill, convertDebt, convertExpense, convertProfile, eachRecord } from './rows';
import { buildHouseholdGoal, buildPersonalGoal, finalizeOpenings, type GoalMeta } from './savings';
import {
  indexHouseholds,
  isRec,
  pickAnchor,
  type Ctx,
  type Converted,
  type LegacyHousehold,
  type LegacyRow,
  type Rec,
} from './shared';

export type { Converted, Ctx, Issue, IssueKind, LegacyHousehold, LegacyRow, Rec, RawEntries } from './shared';
export {
  codeTrim,
  detail,
  idFor,
  indexHouseholds,
  isRec,
  rawEntries,
  records,
  refOf,
  skip,
  str,
} from './shared';

export function convertAll(rows: LegacyRow[], households: LegacyHousehold[], now: Date): Converted {
  const out: Converted = {
    profiles: [],
    goals: [],
    bills: [],
    expenses: [],
    savings_moves: [],
    debts: [],
    issues: [],
    origin: {},
  };
  const today = todayTunis(now);
  const nowIso = now.toISOString();
  const { householdOf, owned } = indexHouseholds(households);
  const rowsByUser = new Map(rows.map((r) => [r.user_id, r] as const));
  const onboardedUsers = new Set(
    rows.filter((r) => isRec(r.data) && isRec(r.data.settings)).map((r) => r.user_id),
  );
  /* goal id → who owns it, which document created it, and the legacy saved
     balance it must reconcile to (for the opening deposit, computed once
     every épargne deposit has been counted). */
  const goalMeta: GoalMeta = new Map();
  const goalEpargne = new Map<string, number>();
  const hhGoalId = new Map<string, string | null>();
  const hhAnchor = new Map<string, string>();

  /* Household documents first: they own the shared expenses, bills and goal
     that each member's row also mirrors. */
  for (const hh of households) {
    const source = `hh:${hh.household_id}`;
    const { anchor, isOnboarded } = pickAnchor(hh.members, onboardedUsers);
    if (!anchor) {
      out.issues.push({ source, kind: 'empty_household', ref: hh.household_id, detail: '' });
      continue;
    }
    if (!isOnboarded) {
      out.issues.push({ source, kind: 'anchor_not_onboarded', ref: hh.household_id, detail: anchor.user_id });
    }
    const doc: Rec = isRec(hh.data) ? hh.data : {};
    const anchorId = anchor.user_id;
    const anchorRow = rowsByUser.get(anchorId);
    const anchorDoc: Rec = anchorRow && isRec(anchorRow.data) ? anchorRow.data : {};
    const anchorSettings: Rec | null = isRec(anchorDoc.settings) ? anchorDoc.settings : null;
    const goalId = buildHouseholdGoal(
      { source, out, today, nowIso, householdId: hh.household_id },
      doc,
      anchorId,
      anchorSettings,
      goalMeta,
    );
    hhGoalId.set(hh.household_id, goalId);
    hhAnchor.set(hh.household_id, anchorId);

    const ctx: Ctx = {
      out,
      source,
      userId: anchorId,
      householdId: hh.household_id,
      goalId,
      goalOwnerId: goalId ? anchorId : null,
      isNonAnchorMember: false,
      today,
      nowIso,
    };
    const seenExpenses = new Set<string>();
    const seenBills = new Set<string>();
    /* R1: legacy `who` is a device-relative storage key, not a display name —
       the true author of a shared expense can't be recovered. Everything the
       household document owns is attributed to the anchor, once, in aggregate. */
    let sharedExpenses = 0;
    let sharedBills = 0;
    eachRecord(ctx, 'expenses', doc.expenses, (e, ref) => {
      if (e.deleted === true) return;
      sharedExpenses++;
      convertExpense(ctx, e, ref, seenExpenses, goalEpargne);
    });
    eachRecord(ctx, 'bills', doc.bills, (b, ref) => {
      if (b.deleted === true) return;
      sharedBills++;
      convertBill(ctx, b, ref, seenBills);
    });
    if (sharedExpenses + sharedBills > 0) {
      out.issues.push({
        source,
        kind: 'author_unknown',
        ref: hh.household_id,
        detail: `${sharedExpenses} shared expenses, ${sharedBills} shared bills attributed to ${anchorId}`,
      });
    }
    if (ctx.sharedWants) {
      out.issues.push({
        source,
        kind: 'shared_wants_private',
        ref: hh.household_id,
        detail: String(ctx.sharedWants),
      });
    }
  }

  for (const row of rows) {
    const source = `user:${row.user_id}`;
    const doc: Rec = isRec(row.data) ? row.data : {};
    const s = doc.settings;
    if (!isRec(s)) {
      out.issues.push({ source, kind: 'not_onboarded', ref: row.user_id, detail: notOnboardedDetail(doc) });
      continue;
    }
    out.profiles.push(convertProfile(row, s, nowIso));
    if (Number(s.s2) > 0) {
      out.issues.push({
        source,
        kind: 'partner_salary_dropped',
        ref: row.user_id,
        detail: 'one salary per account now',
      });
    }

    const hid = householdOf.get(row.user_id);
    let goalId: string | null;
    let goalOwnerId: string | null;
    let isNonAnchorMember = false;
    if (hid) {
      /* settings.goal/saved/goalType/goalNote here are applyShared() mirrors of
         the household's own fields — never a second, personal goal. */
      out.issues.push({ source, kind: 'shared_goal', ref: row.user_id, detail: '' });
      goalId = hhGoalId.get(hid) ?? null;
      const anchorId = hhAnchor.get(hid) ?? null;
      goalOwnerId = goalId ? anchorId : null;
      isNonAnchorMember = anchorId !== row.user_id;
    } else {
      goalId = buildPersonalGoal({ source, out, today, nowIso }, s, row.user_id, goalMeta);
      goalOwnerId = goalId ? row.user_id : null;
    }
    const ctx: Ctx = {
      out,
      source,
      userId: row.user_id,
      householdId: null,
      goalId,
      goalOwnerId,
      isNonAnchorMember,
      today,
      nowIso,
    };

    const mirrored = (hid && owned.get(hid)) || new Set<string>();
    /* B1: an id match with the household's own entry only means THIS entry is
       that mirror when it is itself shared — app.js's per-account id counters
       ('c'+i / 'b'+i) can put a personal entry under the same id a shared one
       took on another account. Converting it anyway is safe (counted, not
       lost); silently treating it as "already covered" would drop it. */
    const seenExpenses = new Set<string>();
    eachRecord(ctx, 'expenses', doc.expenses, (e, ref) => {
      if (!mirrored.has(ref) || !isSharedExpense(e)) convertExpense(ctx, e, ref, seenExpenses, goalEpargne);
    });
    const billRefs = new Set<string>();
    const seenBills = new Set<string>();
    eachRecord(ctx, 'bills', doc.bills, (b, ref) => {
      billRefs.add(ref);
      if (!mirrored.has(`bill:${ref}`) || !isSharedBill(b)) convertBill(ctx, b, ref, seenBills);
    });
    legacyCharges(s).forEach(({ rec, ref }) => {
      if (!billRefs.has(ref) && (!mirrored.has(`bill:${ref}`) || !isSharedBill(rec)))
        convertBill(ctx, rec, ref, seenBills);
    });
    const seenDebts = new Set<string>();
    eachRecord(ctx, 'debts', doc.debts, (d, ref) => convertDebt(ctx, d, ref, seenDebts));
  }

  finalizeOpenings(out, goalMeta, goalEpargne, today);
  return out;
}

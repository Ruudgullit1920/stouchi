/* Types and primitives shared by convert.ts, savings.ts and verify.ts: the
 * legacy document shapes, the issue/output shapes, and the handful of small
 * readers (isRec, records, refOf, …) that every pass over a legacy document
 * needs. Split out so convert.ts and savings.ts don't import from each other
 * (they both build on this instead) and so verify.ts isn't reaching into
 * convert.ts for bookkeeping that isn't really conversion. */
import type { Pot } from '../../src/shared/categories';
import type { Mil } from '../../src/shared/money';
import type {
  NewBill,
  NewDebt,
  NewExpense,
  NewGoal,
  NewProfile,
  NewSavingsMove,
} from '../../src/shared/schemas';
import { STOUCHI_NS, uuidv5 } from '../../src/shared/uuid5';

export interface LegacyRow {
  user_id: string;
  created_at: string;
  data: unknown;
}
export interface LegacyHousehold {
  household_id: string;
  data: unknown;
  members: { user_id: string; joined_at: string; display_name: string }[];
}
export type IssueKind =
  | 'not_onboarded'
  | 'empty_household'
  | 'duplicate_id'
  | 'bad_amount'
  | 'bad_date'
  | 'savings_without_goal'
  | 'bad_bill'
  | 'bad_debt'
  | 'goal_target_missing'
  | 'partner_salary_dropped'
  | 'shared_goal'
  | 'savings_exceed_saved'
  | 'author_unknown'
  | 'shared_wants_private'
  | 'anchor_not_onboarded'
  | 'epargne_kept_as_expense'
  | 'bad_entry'
  | 'bad_collection';
export interface Issue {
  /** 'user:<id>' or 'hh:<id>' */
  source: string;
  kind: IssueKind;
  ref: string;
  detail: string;
  /** set when the skipped amount is known: verify() adds it back — UNLESS
   *  rowKept is set (fix round 3): the amount is already sitting in a real
   *  output row (epargne_kept_as_expense), so adding it back a second time
   *  as "skipped" would double-count it. */
  mil?: Mil;
  month?: string;
  pot?: Pot;
  /** the amount above didn't disappear — it's in an output row already */
  rowKept?: true;
}
export interface Converted {
  profiles: NewProfile[];
  goals: NewGoal[];
  bills: NewBill[];
  expenses: NewExpense[];
  savings_moves: NewSavingsMove[];
  debts: NewDebt[];
  issues: Issue[];
  /** row id → source document, for verify() (goals included: verify() maps a
   *  goal to its legacy source through this, then re-derives "saved" itself —
   *  spec §9.3 fix round 2, invariant 3 must not trust the converter's own math) */
  origin: Record<string, string>;
}

export interface Ctx {
  out: Converted;
  source: string;
  userId: string;
  householdId: string | null;
  /** the goal a savings-move on this document lands on (household goal for a
   *  member; the user's own goal otherwise) */
  goalId: string | null;
  /** who a savings-move must be attributed to — the goal's owner, per RLS */
  goalOwnerId: string | null;
  /** a household member who isn't the anchor: their own "épargne" expenses stay
   *  expenses (fix round 2, R4) — a deposit would need to move money into a
   *  goal they don't own */
  isNonAnchorMember: boolean;
  today: string;
  nowIso: string;
  /** shared Envies made private on this document (plan D1: only Besoins are shared) */
  sharedWants?: number;
}

/** The household's anchor: the earliest-joined member who is onboarded (has a
 *  budget_data row with a settings record), ties broken by the smaller
 *  user_id so the result never depends on array order. Every household row
 *  (goal, shared expenses, shared bills) is attributed to them — legacy `who`
 *  is a device-relative storage key, not a display name, so the true author
 *  of a shared expense can't be recovered (fix round 2, R1/R2). Falls back to
 *  the earliest-joined member (same tie-break) when nobody is onboarded. */
export function pickAnchor(
  members: { user_id: string; joined_at: string }[],
  onboarded: ReadonlySet<string>,
): { anchor: { user_id: string; joined_at: string } | null; isOnboarded: boolean } {
  if (members.length === 0) return { anchor: null, isOnboarded: false };
  /* joined_at is an ISO instant, not a sortable-as-text key: two different
   * offsets can name the same moment, and a fractional second sorts wrong
   * against a whole one under plain string comparison. Date.parse compares
   * the actual instants; a tie (equal instant, or either side unparseable)
   * falls back to the smaller user_id so the result stays deterministic. */
  const sorted = [...members].sort((a, b) => {
    const ta = Date.parse(a.joined_at);
    const tb = Date.parse(b.joined_at);
    if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return ta - tb;
    return a.user_id.localeCompare(b.user_id);
  });
  const found = sorted.find((m) => onboarded.has(m.user_id));
  return found ? { anchor: found, isOnboarded: true } : { anchor: sorted[0], isOnboarded: false };
}

/* ids = uuidv5('<source>:<kind>:<legacy id>'): stable across runs, distinct across users. */
export const idFor = (...parts: string[]): string => uuidv5(parts.join(':'), STOUCHI_NS);

export type Rec = Record<string, unknown>;
export const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
export const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
export const refOf = (r: Rec, i: number): string => str(r.id) || `#${i}`;
export const detail = (v: unknown): string => JSON.stringify(v) ?? 'undefined';
/** Cuts by code point, so an emoji or other surrogate pair is never split. */
export const codeTrim = (s: string, n: number): string => Array.from(s).slice(0, n).join('');

/** A legacy array, split into its usable records and their raw positions — the #i
 *  fallback in refOf must count the RAW array index, not the position after
 *  filtering, so this is computed once and reused everywhere a ref is needed. */
export interface RawEntries {
  recs: Rec[];
  refs: string[];
  badCount: number;
  isArray: boolean;
}
export function rawEntries(v: unknown): RawEntries {
  if (!Array.isArray(v)) return { recs: [], refs: [], badCount: 0, isArray: false };
  const recs: Rec[] = [];
  const refs: string[] = [];
  let badCount = 0;
  v.forEach((item: unknown, i) => {
    if (isRec(item)) {
      recs.push(item);
      refs.push(refOf(item, i));
    } else {
      badCount++;
    }
  });
  return { recs, refs, badCount, isArray: true };
}
/** The plain, silent list of usable records — for bookkeeping passes (indexing,
 *  totals) that don't report issues and don't need per-item refs. */
export const records = (v: unknown): Rec[] => rawEntries(v).recs;

/** Which household each user is in, and the legacy expense/bill ids each household document owns. */
export function indexHouseholds(households: LegacyHousehold[]) {
  const householdOf = new Map<string, string>();
  const owned = new Map<string, Set<string>>();
  for (const hh of households) {
    hh.members.forEach((m) => householdOf.set(m.user_id, hh.household_id));
    const doc: Rec = isRec(hh.data) ? hh.data : {};
    const ids = new Set<string>();
    rawEntries(doc.expenses).refs.forEach((ref) => ids.add(ref));
    rawEntries(doc.bills).refs.forEach((ref) => ids.add(`bill:${ref}`));
    owned.set(hh.household_id, ids);
  }
  return { householdOf, owned };
}

export function skip(
  ctx: Ctx,
  kind: IssueKind,
  ref: string,
  info: Partial<Pick<Issue, 'detail' | 'mil' | 'month' | 'pot' | 'rowKept'>> = {},
): void {
  ctx.out.issues.push({ source: ctx.source, kind, ref, detail: '', ...info });
}

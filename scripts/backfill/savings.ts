/* Goal and savings-move construction, split out of convert.ts (spec §9.3 fix
 * round 1): a household's goal is shared by every member — their own
 * settings.goal/saved/goalType/goalNote are applyShared() mirrors of it, never
 * a second goal — so it is built once, owned by the earliest-joined member,
 * and every "épargne" deposit anywhere in the household lands on it. The
 * opening deposit (saved − Σ épargne) can only be computed once every such
 * deposit has been seen, so it happens in one last pass over every goal
 * (finalizeOpenings), after both the household and the per-user passes. */
import type { Pot } from '../../src/shared/categories';
import type { ISODate } from '../../src/shared/dates';
import { t, type StringKey } from '../../src/shared/i18n/t';
import type { Mil } from '../../src/shared/money';
import type { NewGoal, NewSavingsMove } from '../../src/shared/schemas';
import { legacyAmount } from './legacy';
import { codeTrim, idFor, isRec, str, type Converted, type Ctx, type Rec } from './shared';

export interface GoalCtx {
  source: string;
  out: Converted;
  today: string;
  nowIso: string;
  /** a household's goal is the household's (plan D1, Phase 6) */
  householdId?: string | null;
}
/** goal id → who owns it, which document created it, and the legacy "saved"
 *  balance it must reconcile to (kept here, not on Converted: fix round 2, R5
 *  wants verify()'s invariant 3 independent of the converter's own math, so
 *  nothing on the public output exposes this — only finalizeOpenings reads it). */
export type GoalMeta = Map<string, { ownerId: string; source: string; savedMil: number }>;

const GOAL_TYPES: Record<string, { name: StringKey; icon: string }> = {
  epargne: { name: 'goal.type.epargne', icon: 'piggy-bank' },
  voyage: { name: 'goal.type.voyage', icon: 'plane' },
  maison: { name: 'goal.type.maison', icon: 'house' },
  voiture: { name: 'goal.type.voiture', icon: 'car' },
  mariage: { name: 'goal.type.mariage', icon: 'heart' },
  etudes: { name: 'goal.type.etudes', icon: 'graduation-cap' },
  securite: { name: 'goal.type.securite', icon: 'shield' },
};
const goalTypeOf = (raw: unknown): { name: StringKey; icon: string } => {
  const k = str(raw);
  return Object.hasOwn(GOAL_TYPES, k) ? GOAL_TYPES[k] : GOAL_TYPES.epargne;
};

/** Builds the goal row itself; returns null when there is nothing to build
 *  (no target and nothing saved). The opening deposit is not created here —
 *  see finalizeOpenings. */
function makeGoal(
  gctx: GoalCtx,
  ownerId: string,
  target: number,
  saved: number,
  goalTypeRaw: unknown,
  goalNoteRaw: unknown,
  goalMeta: GoalMeta,
): string | null {
  if (target === 0 && saved === 0) return null;
  const type = goalTypeOf(goalTypeRaw);
  const goal: NewGoal = {
    id: idFor(gctx.source, 'goal'),
    user_id: ownerId,
    household_id: gctx.householdId ?? null,
    name: codeTrim(str(goalNoteRaw) || t(type.name), 40),
    icon: type.icon,
    target_mil: Math.max(target, saved),
  };
  if (target === 0) {
    gctx.out.issues.push({
      source: gctx.source,
      kind: 'goal_target_missing',
      ref: goal.id,
      detail: 'target set to the amount already saved',
    });
  }
  gctx.out.goals.push(goal);
  gctx.out.origin[goal.id] = gctx.source;
  goalMeta.set(goal.id, { ownerId, source: gctx.source, savedMil: saved });
  return goal.id;
}

export const fieldV = (g: Rec, k: string): unknown => {
  const f = g[k];
  return isRec(f) ? f.v : undefined;
};
const isPosFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Fix round 2, R3: an empty `goal: {}` used to read as "the household has a
 *  goal shape", which dropped the anchor's own saved amount on the floor —
 *  it only counts when it actually carries a positive target or saved. */
export function householdGoalCounts(g: unknown): g is Rec {
  return isRec(g) && (isPosFiniteNumber(fieldV(g, 'goal')) || isPosFiniteNumber(fieldV(g, 'saved')));
}

/** One goal per household: from the household document's own `goal` fields
 *  when they actually carry a value (R3), else from the anchor's own settings. */
export function buildHouseholdGoal(
  gctx: GoalCtx,
  doc: Rec,
  ownerId: string,
  ownerSettings: Rec | null,
  goalMeta: GoalMeta,
): string | null {
  const g = doc.goal;
  let target: number;
  let saved: number;
  let goalType: unknown;
  let goalNote: unknown;
  if (householdGoalCounts(g)) {
    target = Math.max(0, legacyAmount(fieldV(g, 'goal')) ?? 0);
    saved = Math.max(0, legacyAmount(fieldV(g, 'saved')) ?? 0);
    goalType = fieldV(g, 'goalType');
    goalNote = fieldV(g, 'goalNote');
  } else if (ownerSettings) {
    target = Math.max(0, legacyAmount(ownerSettings.goal) ?? 0);
    saved = Math.max(0, legacyAmount(ownerSettings.saved) ?? 0);
    goalType = ownerSettings.goalType;
    goalNote = ownerSettings.goalNote;
  } else {
    target = 0;
    saved = 0;
  }
  return makeGoal(gctx, ownerId, target, saved, goalType, goalNote, goalMeta);
}

/** A standalone account's own goal — only ever reached for a user who isn't a
 *  household member (members are skipped by the caller: convertAll pushes a
 *  'shared_goal' issue and points them at the household goal instead). */
export function buildPersonalGoal(gctx: GoalCtx, s: Rec, ownerId: string, goalMeta: GoalMeta): string | null {
  const target = Math.max(0, legacyAmount(s.goal) ?? 0);
  const saved = Math.max(0, legacyAmount(s.saved) ?? 0);
  return makeGoal(gctx, ownerId, target, saved, s.goalType, s.goalNote, goalMeta);
}

/** An "épargne" expense becomes a deposit on ctx.goalId. Its mover is the
 *  goal's owner (ctx.goalOwnerId), not necessarily the expense's own author —
 *  RLS only lets a goal's owner write a move against it. */
export function recordEpargneDeposit(
  ctx: Ctx,
  ref: string,
  mil: Mil,
  pot: Pot,
  spent: ISODate,
  goalEpargne: Map<string, number>,
): void {
  const goalId = ctx.goalId;
  const ownerId = ctx.goalOwnerId;
  if (!goalId || !ownerId) return; // the caller already checked; guards the types
  const move: NewSavingsMove = {
    id: idFor(ctx.source, 'move', ref),
    user_id: ownerId,
    goal_id: goalId,
    amount_mil: mil,
    kind: 'deposit',
    from_pot: pot,
    occurred_on: spent,
  };
  ctx.out.savings_moves.push(move);
  ctx.out.origin[move.id] = ctx.source;
  goalEpargne.set(goalId, (goalEpargne.get(goalId) ?? 0) + mil);
}

/** The opening deposit = the legacy "saved" balance minus every épargne
 *  deposit already converted onto that goal — computed last, once every
 *  household and every row has been processed, so the total is complete. A
 *  shortfall (deposits exceeding "saved") gets no opening row and an issue
 *  instead: the balance can't reconcile silently. */
export function finalizeOpenings(
  out: Converted,
  goalMeta: GoalMeta,
  goalEpargne: Map<string, number>,
  today: string,
): void {
  for (const [goalId, meta] of goalMeta) {
    const epargneMil = goalEpargne.get(goalId) ?? 0;
    const opening = meta.savedMil - epargneMil;
    if (opening > 0) {
      const move: NewSavingsMove = {
        id: idFor(meta.source, 'opening'),
        user_id: meta.ownerId,
        goal_id: goalId,
        amount_mil: opening,
        kind: 'deposit',
        from_pot: null,
        occurred_on: today,
      };
      out.savings_moves.push(move);
      out.origin[move.id] = meta.source;
    } else if (opening < 0) {
      out.issues.push({
        source: meta.source,
        kind: 'savings_exceed_saved',
        ref: goalId,
        detail: `épargne deposits already total more than the saved balance (${epargneMil} > ${meta.savedMil} millimes)`,
        mil: -opening,
      });
    }
  }
}

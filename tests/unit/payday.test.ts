import { describe, expect, it } from 'vitest';
import { activeGoal, dueDeposits, goalEta, paydayId, paydayOpensAt } from '../../src/shared/payday';
import type { Profile, SavingsMove } from '../../src/shared/schemas';
import { STOUCHI_NS, uuidv5 } from '../../src/shared/uuid5';
import { goal, move, profile, USER, uuidN } from './fixtures';

const at = (local: string) => new Date(`${local}+01:00`);
const G = goal();
const due = (p: Partial<Profile>, now: string, moves: SavingsMove[] = [], g: typeof G | null = G) =>
  dueDeposits({ profile: profile(p), goal: g, moves, now: at(now) });
const starts = (p: Partial<Profile>, now: string, moves: SavingsMove[] = []) =>
  due(p, now, moves).map((m) => m.occurred_on);
const asMoves = (ms: ReturnType<typeof due>): SavingsMove[] =>
  ms.map((m) => ({ ...m, created_at: '2026-12-15T09:00:00+01:00' }));

describe('uuidv5 (browser-safe)', () => {
  it('matches the RFC 4122 test vector', () => {
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
  it('matches node:crypto on UTF-8 and multi-block names', () => {
    expect(uuidv5('Aam Salah — é ✓', STOUCHI_NS)).toBe('cf7a4997-62b5-5111-be5a-8ddf5dab9586');
    expect(uuidv5('x'.repeat(200), STOUCHI_NS)).toBe('a5c3a234-5f10-5a11-81c2-062d9b43e7a3');
  });
  it('rejects a namespace that is not a UUID', () => {
    expect(() => uuidv5('a', 'nope')).toThrow();
  });
});

describe('paydayOpensAt', () => {
  it('is 08:00 Africa/Tunis on the period start', () => {
    expect(paydayOpensAt({ start: '2026-10-01', end: '2026-10-31', label: '2026-10' })).toBe(
      '2026-10-01T07:00:00.000Z',
    );
  });
});

describe('dueDeposits', () => {
  const onboarded = { onboarded_at: '2026-09-01T10:00:00+01:00' };

  it('writes nothing at 07:59 on payday and one move at 08:00', () => {
    expect(due(onboarded, '2026-10-01T07:59:59')).toEqual([]);
    expect(due(onboarded, '2026-10-01T08:00:00')).toEqual([
      {
        id: 'd95fc0d7-476c-556b-b917-7f7f36ac474d',
        user_id: USER,
        goal_id: G.id,
        amount_mil: 400_000,
        kind: 'payday',
        from_pot: null,
        occurred_on: '2026-10-01',
      },
    ]);
  });

  it('a partner’s payday deposit on the shared goal never covers mine (review C1)', () => {
    const theirs = move({
      user_id: uuidN(777),
      goal_id: G.id,
      kind: 'payday',
      from_pot: null,
      occurred_on: '2026-10-01',
    });
    expect(starts(onboarded, '2026-10-01T09:00:00', [theirs])).toEqual(['2026-10-01']);
  });

  it('uses uuidv5 of payday:<user>:<period start> as the id', () => {
    expect(paydayId(USER, '2026-10-01')).toBe(uuidv5(`payday:${USER}:2026-10-01`, STOUCHI_NS));
    expect(paydayId(USER, '2026-10-01')).toBe('d95fc0d7-476c-556b-b917-7f7f36ac474d');
  });

  it('handles payday 0 in a non-leap February (28th)', () => {
    const p = { payday: 0, onboarded_at: '2027-01-10T10:00:00+01:00' };
    expect(starts(p, '2027-02-28T07:59:00')).toEqual(['2027-01-31']);
    expect(starts(p, '2027-02-28T08:00:00')).toEqual(['2027-01-31', '2027-02-28']);
  });

  it('handles payday 0 in a leap February (29th)', () => {
    const p = { payday: 0, onboarded_at: '2028-01-10T10:00:00+01:00' };
    expect(starts(p, '2028-02-28T09:00:00')).toEqual(['2028-01-31']);
    expect(starts(p, '2028-02-29T08:00:00')).toEqual(['2028-01-31', '2028-02-29']);
  });

  it('handles payday 28', () => {
    expect(starts({ payday: 28, ...onboarded }, '2026-10-28T08:00:00')).toEqual(['2026-09-28', '2026-10-28']);
  });

  it('gives one move per missed payday, and nothing when run again', () => {
    const first = due(onboarded, '2026-12-15T09:00:00');
    expect(first.map((m) => m.occurred_on)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01']);
    expect(new Set(first.map((m) => m.id)).size).toBe(3);
    expect(due(onboarded, '2026-12-15T09:00:00', asMoves(first))).toEqual([]);
  });

  it('only fills the periods that have no move yet', () => {
    const [oct] = asMoves(due(onboarded, '2026-10-01T09:00:00'));
    expect(starts(onboarded, '2026-11-01T09:00:00', [oct])).toEqual(['2026-11-01']);
  });

  it('does not pay a period twice after the payday changes', () => {
    const before = { payday: 25, onboarded_at: '2026-07-10T10:00:00+01:00' };
    const paid = asMoves(due(before, '2026-09-26T09:00:00'));
    expect(paid.map((m) => m.occurred_on)).toEqual(['2026-07-25', '2026-08-25', '2026-09-25']);
    expect(starts({ ...before, payday: 1 }, '2026-10-03T09:00:00', paid)).toEqual(['2026-10-01']);
  });

  it('gives nothing without an active goal', () => {
    expect(due(onboarded, '2026-12-15T09:00:00', [], null)).toEqual([]);
    const archived = goal({ archived_at: '2026-09-10T10:00:00+01:00' });
    expect(due(onboarded, '2026-12-15T09:00:00', [], archived)).toEqual([]);
  });

  it('gives nothing before onboarding, nor for the period onboarding happened in', () => {
    expect(due({ onboarded_at: null }, '2026-12-15T09:00:00')).toEqual([]);
    const mid = { onboarded_at: '2026-09-15T10:00:00+01:00' };
    expect(due(mid, '2026-09-30T23:00:00')).toEqual([]);
    expect(starts(mid, '2026-10-01T08:00:00')).toEqual(['2026-10-01']);
    const onPayday = { onboarded_at: '2026-10-01T07:00:00+01:00' };
    expect(due(onPayday, '2026-10-01T09:00:00')).toEqual([]);
  });

  it("deposits the pending plan's savings share from its period on", () => {
    const next = {
      next_salary_mil: 3_000_000,
      next_split_needs: 50,
      next_split_wants: 30,
      next_split_savings: 20,
      next_from: '2026-11-01',
    };
    expect(due({ ...onboarded, ...next }, '2026-11-02T09:00:00').map((m) => m.amount_mil)).toEqual([
      400_000, 600_000,
    ]);
  });

  it('gives nothing when the savings share is 0', () => {
    expect(
      due({ ...onboarded, split_needs: 60, split_wants: 40, split_savings: 0 }, '2026-12-15T09:00:00'),
    ).toEqual([]);
  });

  it('returns at most the 12 latest periods, oldest first', () => {
    const got = starts({ onboarded_at: '2024-01-01T10:00:00+01:00' }, '2026-10-01T09:00:00');
    expect(got).toHaveLength(12);
    expect(got[0]).toBe('2025-11-01');
    expect(got[11]).toBe('2026-10-01');
  });
});

describe('activeGoal', () => {
  it('picks the newest goal not archived', () => {
    const old = goal({ created_at: '2026-08-01T10:00:00+01:00' });
    const recent = goal({ created_at: '2026-09-01T10:00:00+01:00' });
    const archived = goal({
      created_at: '2026-09-20T10:00:00+01:00',
      archived_at: '2026-09-21T10:00:00+01:00',
    });
    expect(activeGoal([old, archived, recent])?.id).toBe(recent.id);
    expect(activeGoal([archived])).toBeUndefined();
  });
  it('treats a goal not yet back from the server (no created_at) as the newest', () => {
    const old = goal({ created_at: '2026-08-01T10:00:00+01:00' });
    const local = { ...goal(), created_at: undefined } as unknown as ReturnType<typeof goal>;
    expect(activeGoal([old, local])?.id).toBe(local.id);
    expect(activeGoal([local, old])?.id).toBe(local.id);
  });
  it('prefers the household goal over a newer goal of my own (Phase 6)', () => {
    const shared = goal({ household_id: uuidN(778), created_at: '2026-08-01T10:00:00+01:00' });
    const mine = goal({ created_at: '2026-09-01T10:00:00+01:00' });
    expect(activeGoal([mine, shared])?.id).toBe(shared.id);
    expect(activeGoal([mine, { ...shared, archived_at: '2026-09-02T10:00:00+01:00' }])?.id).toBe(mine.id);
    const cached = { ...goal({ created_at: '2026-07-01T10:00:00+01:00' }), household_id: undefined };
    expect(activeGoal([mine, cached as unknown as typeof mine])?.id).toBe(mine.id);
  });
});

describe('goalEta', () => {
  it('is today when the goal is already reached', () => {
    expect(goalEta(1_000_000, 1_000_000, 100_000, '2026-09-24')).toBe('2026-09-24');
    expect(goalEta(1_000_000, 1_200_000, 0, '2026-09-24')).toBe('2026-09-24');
  });
  it('is null when nothing goes in each month', () => {
    expect(goalEta(1_000_000, 0, 0, '2026-09-24')).toBeNull();
  });
  it('counts whole months, rounding up', () => {
    expect(goalEta(1_000_000, 400_000, 200_000, '2026-09-24')).toBe('2026-12-24');
    expect(goalEta(1_000_000, 0, 300_000, '2026-09-24')).toBe('2027-01-24');
  });
  it('clamps to the end of a shorter month', () => {
    expect(goalEta(200_000, 0, 200_000, '2026-01-31')).toBe('2026-02-28');
  });
});

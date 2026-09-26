import { describe, expect, it } from 'vitest';
import { SPLIT_PRESETS, moveHandle, splitText, splitTip } from '../../src/shared/split';

const S = (needs: number, wants: number) => ({ needs, wants, savings: 100 - needs - wants });

describe('moveHandle', () => {
  it('moves the first handle: Besoins grow, Envies shrink, Épargne stays', () => {
    expect(moveHandle(S(50, 30), 1, 60)).toEqual(S(60, 20));
  });

  it('moves the second handle: Envies grow, Épargne shrinks, Besoins stay', () => {
    expect(moveHandle(S(50, 30), 2, 90)).toEqual(S(50, 40));
  });

  it('snaps to steps of 5', () => {
    expect(moveHandle(S(50, 30), 1, 57)).toEqual(S(55, 25));
    expect(moveHandle(S(50, 30), 2, 81)).toEqual(S(50, 30));
  });

  it('keeps every pot at 5 % or more, so a handle never passes the other', () => {
    expect(moveHandle(S(50, 30), 1, 0)).toEqual(S(5, 75));
    expect(moveHandle(S(50, 30), 1, 100)).toEqual(S(75, 5));
    expect(moveHandle(S(50, 30), 2, 40)).toEqual(S(50, 5));
    expect(moveHandle(S(50, 30), 2, 100)).toEqual(S(50, 45));
  });

  it('always adds up to 100', () => {
    for (const v of [-20, 0, 13, 50, 88, 120])
      for (const h of [1, 2] as const) {
        const s = moveHandle(S(40, 35), h, v);
        expect(s.needs + s.wants + s.savings).toBe(100);
      }
  });
});

describe('splitText', () => {
  it('prints the three parts', () => expect(splitText(S(60, 25))).toBe('60 / 25 / 15'));
});

describe('SPLIT_PRESETS', () => {
  it('are the three plan presets, each adding up to 100, the classic one recommended', () => {
    expect(SPLIT_PRESETS.map((p) => [p.split.needs, p.split.wants, p.split.savings])).toEqual([
      [50, 30, 20],
      [60, 20, 20],
      [70, 20, 10],
    ]);
    expect(SPLIT_PRESETS.filter((p) => p.recommended).map((p) => p.key)).toEqual(['classic']);
  });
});

describe('splitTip', () => {
  const base = {
    salary: 2_000_000,
    bills: 300_000,
    today: '2026-09-20',
    current: S(50, 30),
    goal: { target: 6_000_000, saved: 0 },
  };

  it('warns first when the bills are more than the Besoins', () => {
    expect(splitTip({ ...base, split: S(10, 60) })).toEqual({ kind: 'over', bills: 300_000, needs: 200_000 });
  });

  it('warns when less than 250 TND is left in Besoins after the bills', () => {
    expect(splitTip({ ...base, split: S(25, 55) })).toEqual({ kind: 'tight', left: 200_000 });
  });

  it('warns under 10 % savings, with the goal date', () => {
    expect(splitTip({ ...base, split: S(60, 35) })).toEqual({
      kind: 'low',
      monthly: 100_000,
      eta: '2031-09-20',
    });
  });

  it('says how many months sooner or later the goal comes', () => {
    expect(splitTip({ ...base, split: S(50, 20) })).toEqual({
      kind: 'goal',
      monthly: 600_000,
      eta: '2027-07-20',
      diff: 5,
    });
    expect(splitTip({ ...base, split: S(60, 25) })).toMatchObject({ kind: 'goal', diff: -5 });
  });

  it('without a goal, says what Besoins leave after the bills', () => {
    expect(splitTip({ ...base, goal: null, split: S(50, 30) })).toEqual({ kind: 'left', left: 700_000 });
  });
});

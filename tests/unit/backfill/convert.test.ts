import { describe, expect, it } from 'vitest';
import { convertAll } from '../../../scripts/backfill/convert';
import {
  isSharedBill,
  isSharedExpense,
  legacyAmount,
  legacyCategory,
  legacyPot,
} from '../../../scripts/backfill/legacy';
import { uuidv5 } from '../../../src/shared/uuid5';
import { verify } from '../../../scripts/backfill/verify';
import {
  BillInsert,
  DebtInsert,
  ExpenseInsert,
  GoalInsert,
  ProfileInsert,
  SavingsMoveInsert,
} from '../../../src/shared/schemas';
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  EMOJI_LABEL_KEPT,
  EMPTY_HH,
  EVE,
  FRANK,
  GEORGE,
  HH,
  HOUSEHOLDS,
  NOW,
  ROWS,
} from './fixtures';

const out = convertAll(ROWS, HOUSEHOLDS, NOW);
const problems = (
  schema: { safeParse: (v: unknown) => { error?: { issues: unknown[] } } },
  rows: unknown[],
) => rows.flatMap((r) => schema.safeParse(r).error?.issues ?? []);

describe('uuidv5', () => {
  it('matches the RFC 4122 test vector', () => {
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });
});

describe('legacy readers', () => {
  it('map today’s accented categories and envelopes', () => {
    expect(legacyCategory('Café')).toBe('cafe');
    expect(legacyCategory('électricité')).toBe('factures');
    expect(legacyCategory('resto')).toBe('resto');
    expect(legacyCategory('épargne')).toBe('epargne');
    expect(legacyCategory('???')).toBe('autre');
    expect(legacyCategory('toString')).toBe('autre'); // Object.hasOwn, not a prototype hit
    expect(legacyPot({ envelope: 'perso' })).toBe('wants');
    expect(legacyPot({ envelope: 'besoins', category: 'café' })).toBe('needs');
    expect(legacyPot({ category: 'shopping' })).toBe('wants');
    expect(legacyPot({ category: 'autre' })).toBe('needs');
  });

  it('isSharedExpense / isSharedBill mirror app.js exactly (app.js:453, app.js:1140-1141)', () => {
    expect(isSharedExpense({ envelope: 'besoins' })).toBe(true);
    expect(isSharedExpense({ envelope: 'besoins', personal: true })).toBe(false);
    expect(isSharedExpense({ envelope: 'perso' })).toBe(false);
    expect(isSharedExpense({ category: 'shopping' })).toBe(false); // legacy pot rule: perso category
    expect(isSharedExpense({ category: 'courses' })).toBe(true); // legacy pot rule: needs category
    expect(isSharedBill({ scope: 'foyer' })).toBe(true);
    expect(isSharedBill({ scope: 'moi' })).toBe(false);
    expect(isSharedBill({})).toBe(false);
  });

  it('read numbers, French strings, and refuse the rest', () => {
    expect(legacyAmount(12.345)).toBe(12_345);
    expect(legacyAmount('12,5')).toBe(12_500);
    expect(legacyAmount({})).toBeNull();
    expect(legacyAmount(undefined)).toBeNull();
  });
});

describe('convertAll', () => {
  it('every row fits its table', () => {
    expect(problems(ProfileInsert, out.profiles)).toEqual([]);
    expect(problems(ExpenseInsert, out.expenses)).toEqual([]);
    expect(problems(BillInsert, out.bills)).toEqual([]);
    expect(problems(DebtInsert, out.debts)).toEqual([]);
    expect(problems(GoalInsert, out.goals)).toEqual([]);
    expect(problems(SavingsMoveInsert, out.savings_moves)).toEqual([]);
  });

  it('one profile per onboarded account; the old split is kept, else 50/30/20; payday 1', () => {
    expect(out.profiles.map((p) => p.user_id)).toEqual([ALICE, BOB, FRANK, GEORGE]);
    expect(out.profiles[0]).toMatchObject({
      first_name: 'Sofiene',
      salary_mil: 2_500_000,
      payday: 1,
      split_needs: 50,
      split_wants: 30,
      split_savings: 20,
      /* the run, not the legacy sign-up: the opening deposit already holds what was
         saved before it, so no payday before the backfill may be owed */
      onboarded_at: NOW.toISOString(),
    });
    expect(out.profiles[1]).toMatchObject({
      split_needs: 50,
      split_wants: 30,
      split_savings: 20,
      onboarded_at: NOW.toISOString(),
    });
    expect(out.profiles[2]).toMatchObject({
      first_name: 'Frank',
      salary_mil: 1_000_000,
      split_needs: 50,
      split_wants: 30,
      split_savings: 20,
    });
  });

  it('expenses: millimes, new category keys, the old envelope kept as the pot, an emoji-safe label cut', () => {
    const alice = out.expenses.filter((e) => e.user_id === ALICE && e.household_id === null);
    expect(alice.map((e) => [e.label, e.amount_mil, e.category, e.pot, e.spent_on])).toEqual([
      ['Carrefour', 32_500, 'courses', 'needs', '2026-09-02'],
      ['Café', 12_000, 'cafe', 'wants', '2026-09-03'],
      ['Loyer', 1_200_500, 'loyer', 'needs', '2026-09-01'],
      [EMOJI_LABEL_KEPT, 20_000, 'autre', 'needs', '2026-08-30'],
    ]);
    // 60 code points, and the trailing emoji survived whole — a naive UTF-16 slice(0, 60) would have split it.
    expect(Array.from(alice[3].label)).toHaveLength(60);
    expect(alice[3].label.endsWith('🎉')).toBe(true);
  });

  it('the full issue list, with mil/month/pot on the duplicate and skipped cases', () => {
    const frankGoal = out.goals.find((g) => g.user_id === FRANK)!;
    expect(out.issues.map((i) => [i.kind, i.ref])).toEqual([
      ['bad_amount', 'hy'],
      ['author_unknown', HH],
      ['empty_household', EMPTY_HH],
      ['partner_salary_dropped', ALICE],
      ['shared_goal', ALICE],
      ['bad_amount', 'e4'],
      ['bad_date', 'e5'],
      ['duplicate_id', 'e2'],
      ['bad_entry', 'expenses'],
      ['bad_bill', 'bill:b2'],
      ['duplicate_id', 'bill:b1'],
      ['duplicate_id', 'debt:d1'],
      ['shared_goal', BOB],
      ['bad_collection', 'debts'],
      ['not_onboarded', CAROL],
      ['not_onboarded', DAVE],
      ['not_onboarded', EVE],
      ['shared_goal', GEORGE],
      ['savings_exceed_saved', frankGoal.id],
    ]);
    expect(out.issues.find((i) => i.kind === 'duplicate_id' && i.ref === 'e2')).toMatchObject({
      mil: 12_000,
      month: '2026-09',
      pot: 'wants',
    });
    expect(out.issues.find((i) => i.kind === 'bad_date' && i.ref === 'e5')).toMatchObject({
      mil: 10_000,
      pot: 'needs',
    });
    expect(out.issues.find((i) => i.kind === 'bad_entry')).toMatchObject({
      source: `user:${ALICE}`,
      detail: '2', // null + 'garbage'
    });
    expect(out.issues.find((i) => i.kind === 'bad_collection')).toMatchObject({
      source: `user:${BOB}`,
      ref: 'debts',
      detail: 'debts',
    });
    expect(out.issues.find((i) => i.ref === CAROL)).toMatchObject({
      kind: 'not_onboarded',
      detail: '3 expenses (142.5 TND), 1 bill, 0 debts',
    });
    expect(out.issues.find((i) => i.ref === DAVE)).toMatchObject({
      detail: '0 expenses (0 TND), 0 bills, 0 debts',
    });
  });

  it('author_unknown: legacy "who" can\'t identify anyone, so everything the household owns is attributed to the anchor, once', () => {
    // ALICE joined HH first (2026-08-01, before BOB's 2026-08-05) and is onboarded: she's the anchor.
    const monoprix = out.expenses.filter((e) => e.label === 'Monoprix');
    expect(monoprix).toHaveLength(1);
    expect(monoprix[0]).toMatchObject({ household_id: HH, user_id: ALICE, amount_mil: 40_000 });
    // 'hy' (bad amount) and 'hs1' (épargne, becomes a move) don't produce expense rows either,
    // but both still count toward the aggregate: monoprix + hs1 + hy = 3 shared expenses, 0 bills.
    const issues = out.issues.filter((i) => i.kind === 'author_unknown');
    expect(issues).toHaveLength(1); // exactly one per household
    expect(issues[0]).toMatchObject({
      source: `hh:${HH}`,
      ref: HH,
      detail: `3 shared expenses, 0 shared bills attributed to ${ALICE}`,
    });
  });

  it('tombstones: no row, no issue — and a stale mirror is excluded, not re-converted', () => {
    expect(out.expenses.some((e) => e.label === 'Stale')).toBe(false);
    expect(out.issues.some((i) => i.ref === 'ht1')).toBe(false);
  });

  it('the household goal is created once, owned by the anchor; no member gets a personal goal', () => {
    const aliceGoals = out.goals.filter((g) => g.user_id === ALICE);
    expect(aliceGoals).toHaveLength(1);
    expect(aliceGoals[0]).toMatchObject({ name: 'Voyage', icon: 'plane', target_mil: 20_000_000 });
    expect(out.goals.some((g) => g.user_id === BOB)).toBe(false);
    expect(out.issues.filter((i) => i.kind === 'shared_goal').map((i) => i.ref)).toEqual([
      ALICE,
      BOB,
      GEORGE,
    ]);
  });

  it("R3: an empty household goal object ({}) doesn't count — it falls back to the anchor's own settings", () => {
    const goal = out.goals.find((g) => g.user_id === GEORGE)!;
    expect(goal).toMatchObject({ name: 'Maison', icon: 'house', target_mil: 500_000 });
    const moves = out.savings_moves.filter((m) => m.goal_id === goal.id);
    expect(moves).toEqual([
      expect.objectContaining({ amount_mil: 300_000, from_pot: null, user_id: GEORGE }),
    ]);
  });

  it('savings: a shared and a personal "épargne" deposit both land on the household goal, then an opening deposit reconciles it to "saved"', () => {
    const goal = out.goals.find((g) => g.user_id === ALICE)!;
    const moves = out.savings_moves
      .filter((m) => m.goal_id === goal.id)
      .map((m) => [m.amount_mil, m.kind, m.from_pot, m.occurred_on, m.user_id]);
    // 200 (shared, hs1) + 100 (personal, e6) + 5 000 (opening) = 5 300 = saved
    expect(moves).toEqual([
      [200_000, 'deposit', 'needs', '2026-09-10', ALICE],
      [100_000, 'deposit', 'needs', '2026-09-05', ALICE],
      [5_000_000, 'deposit', null, '2026-09-23', ALICE],
    ]);
    expect(moves.reduce((sum, [mil]) => sum + (mil as number), 0)).toBe(5_300_000);
  });

  it('savings_exceed_saved when épargne deposits already total more than the legacy saved balance', () => {
    const goal = out.goals.find((g) => g.user_id === FRANK)!;
    expect(goal).toMatchObject({ name: 'Épargne', icon: 'piggy-bank', target_mil: 1_000_000 }); // goalType 'toString' fell back
    const moves = out.savings_moves.filter((m) => m.goal_id === goal.id);
    expect(moves).toHaveLength(1); // no opening row: it would be negative
    expect(moves[0]).toMatchObject({ amount_mil: 200_000, from_pot: 'needs' });
    expect(out.issues.find((i) => i.kind === 'savings_exceed_saved')).toMatchObject({
      source: `user:${FRANK}`,
      ref: goal.id,
      mil: 150_000,
    });
  });

  it('R4: a non-anchor household member\'s own "épargne" expense stays an expense, not a deposit', () => {
    const owner = '00000000-0000-4000-8000-000000000301';
    const member = '00000000-0000-4000-8000-000000000302';
    const hh = '00000000-0000-4000-8000-0000000000a5';
    const rows = [
      { user_id: owner, created_at: '2026-08-01T00:00:00Z', data: { settings: { n1: 'Owner', s1: 1000 } } },
      {
        user_id: member,
        created_at: '2026-08-02T00:00:00Z',
        data: {
          settings: { n1: 'Member', s1: 900 },
          expenses: [
            {
              id: 'me1',
              amount: 50,
              category: 'épargne',
              envelope: 'besoins',
              date: '2026-09-07',
              label: 'Mise de côté',
            },
          ],
        },
      },
    ];
    const households = [
      {
        household_id: hh,
        members: [
          { user_id: owner, joined_at: '2026-08-01T00:00:00Z', display_name: 'Owner' },
          { user_id: member, joined_at: '2026-08-02T00:00:00Z', display_name: 'Member' },
        ],
        data: { expenses: [], bills: [] },
      },
    ];
    const r = convertAll(rows, households, NOW);
    // Owner (earliest-joined, onboarded) is the anchor; Member is not, so their
    // own "épargne" expense can't move into a goal Member doesn't own.
    const kept = r.expenses.find((e) => e.user_id === member)!;
    expect(kept).toMatchObject({
      category: 'autre',
      pot: 'needs',
      amount_mil: 50_000,
      label: 'Mise de côté',
      household_id: null,
    });
    expect(r.savings_moves.some((m) => m.user_id === member)).toBe(false);
    expect(r.issues.find((i) => i.kind === 'epargne_kept_as_expense')).toMatchObject({
      source: `user:${member}`,
      ref: 'me1',
      mil: 50_000,
      month: '2026-09',
      pot: 'needs',
      rowKept: true,
    });
    // fix round 3: the kept row and the issue's mil both stood for the same
    // 50 TND — verify() must not add it back a second time as "skipped".
    // (round 2's version never called verify() here at all, which is exactly
    // how the double-count went unnoticed.)
    expect(verify(rows, households, r).ok).toBe(true);
  });

  it('B1: a personal entry with a colliding id converts as its own row, not as a stale mirror', () => {
    const a = '00000000-0000-4000-8000-000000000501';
    const b = '00000000-0000-4000-8000-000000000502';
    const hh = '00000000-0000-4000-8000-0000000000a8';
    // A shares this rent bill (scope 'foyer'); it lives in the household doc
    // and is mirrored back into A's own doc under the same id.
    const rentBill = {
      id: 'c0',
      key: 'loyer',
      label: 'Loyer',
      amount: 500,
      freq: 'monthly',
      day: 1,
      anchor: '2026-09',
      scope: 'foyer',
    };
    const sharedGroceries = {
      id: 'e0',
      amount: 40,
      category: 'courses',
      envelope: 'besoins',
      date: '2026-09-05',
      label: 'Courses partagées',
    };
    const rows = [
      {
        user_id: a,
        created_at: '2026-08-01T00:00:00Z',
        data: { settings: { n1: 'A', s1: 1000 }, bills: [rentBill], expenses: [sharedGroceries] },
      },
      {
        user_id: b,
        created_at: '2026-08-02T00:00:00Z',
        data: {
          settings: { n1: 'B', s1: 900 },
          // B's OWN personal entries, coincidentally under the SAME local ids
          // app.js's per-account 'c'+i / 'b'+i counters gave A's shared ones —
          // must convert as B's own rows, not be excluded as stale mirrors.
          bills: [
            {
              id: 'c0',
              key: 'internet',
              label: 'Internet de B',
              amount: 20,
              freq: 'monthly',
              day: 5,
              scope: 'moi',
            },
          ],
          expenses: [
            {
              id: 'e0',
              amount: 15,
              category: 'shopping',
              envelope: 'besoins',
              personal: true,
              date: '2026-09-06',
              label: 'Cadeau perso',
            },
          ],
        },
      },
    ];
    const households = [
      {
        household_id: hh,
        members: [
          { user_id: a, joined_at: '2026-08-01T00:00:00Z', display_name: 'A' },
          { user_id: b, joined_at: '2026-08-02T00:00:00Z', display_name: 'B' },
        ],
        data: { expenses: [sharedGroceries], bills: [rentBill] },
      },
    ];
    const r = convertAll(rows, households, NOW);

    const householdBill = r.bills.find((bl) => bl.household_id === hh)!;
    expect(householdBill).toMatchObject({ user_id: a, label: 'Loyer', amount_mil: 500_000 });
    const personalBill = r.bills.find((bl) => bl.user_id === b)!;
    expect(personalBill).toMatchObject({ household_id: null, label: 'Internet de B', amount_mil: 20_000 });
    expect(personalBill.id).not.toBe(householdBill.id);

    const householdExpense = r.expenses.find((e) => e.household_id === hh)!;
    expect(householdExpense).toMatchObject({ user_id: a, label: 'Courses partagées', amount_mil: 40_000 });
    const personalExpense = r.expenses.find((e) => e.user_id === b)!;
    expect(personalExpense).toMatchObject({ household_id: null, label: 'Cadeau perso', amount_mil: 15_000 });
    expect(personalExpense.id).not.toBe(householdExpense.id);

    // A's own mirror copies (genuinely shared, same id) stay excluded — no
    // separate personal row of A's own beyond the household row above (A is
    // the anchor, so `householdBill`/`householdExpense` themselves carry
    // user_id === a with household_id === hh).
    expect(r.bills.filter((bl) => bl.user_id === a && bl.household_id === null)).toHaveLength(0);
    expect(r.expenses.filter((e) => e.user_id === a && e.household_id === null)).toHaveLength(0);

    expect(verify(rows, households, r).ok).toBe(true);
  });

  it('R2: the anchor tie-break (smaller user_id) is deterministic regardless of member order', () => {
    const a = '00000000-0000-4000-8000-000000000201';
    const b = '00000000-0000-4000-8000-000000000202';
    const hh = '00000000-0000-4000-8000-0000000000a6';
    const withMembers = (members: { user_id: string; joined_at: string; display_name: string }[]) =>
      convertAll(
        [],
        [
          {
            household_id: hh,
            members,
            data: {
              expenses: [
                { id: 'x1', amount: 10, category: 'courses', envelope: 'besoins', date: '2026-09-01' },
              ],
              bills: [],
            },
          },
        ],
        NOW,
      );
    // same joined_at for both: only the user_id tie-break can decide the anchor
    const memberA = { user_id: a, joined_at: '2026-09-01T00:00:00Z', display_name: 'A' };
    const memberB = { user_id: b, joined_at: '2026-09-01T00:00:00Z', display_name: 'B' };
    const forward = withMembers([memberA, memberB]);
    const shuffled = withMembers([memberB, memberA]);
    expect(forward).toEqual(shuffled);
    expect(forward.expenses[0]).toMatchObject({ user_id: a }); // 'a' < 'b'
    expect(forward.issues).toEqual([
      { source: `hh:${hh}`, kind: 'anchor_not_onboarded', ref: hh, detail: a },
      {
        source: `hh:${hh}`,
        kind: 'author_unknown',
        ref: hh,
        detail: `1 shared expenses, 0 shared bills attributed to ${a}`,
      },
    ]);
  });

  it('R2 (fix round 3): pickAnchor compares joined_at as an instant (Date.parse), not as text', () => {
    // '…10:00:00.5+00:00'.localeCompare('…10:00:00+00:00') is -1 — locale-aware
    // collation de-weights the '.', so plain string order gets this backwards
    // and would have picked the chronologically LATER member as the anchor.
    const earlier = '00000000-0000-4000-8000-000000000401'; // no fraction: 500ms earlier
    const later = '00000000-0000-4000-8000-000000000402'; // '.5': 500ms later
    const hh = '00000000-0000-4000-8000-0000000000a7';
    const r = convertAll(
      [
        { user_id: earlier, created_at: '2026-08-01T00:00:00Z', data: { settings: { n1: 'E', s1: 1 } } },
        { user_id: later, created_at: '2026-08-01T00:00:00Z', data: { settings: { n1: 'L', s1: 1 } } },
      ],
      [
        {
          household_id: hh,
          members: [
            { user_id: later, joined_at: '2026-08-01T10:00:00.5+00:00', display_name: 'L' },
            { user_id: earlier, joined_at: '2026-08-01T10:00:00+00:00', display_name: 'E' },
          ],
          data: {
            goal: { goal: { v: 100 }, saved: { v: 50 } },
            expenses: [],
            bills: [],
          },
        },
      ],
      NOW,
    );
    // both members are onboarded, so pickAnchor's own ordering decides who owns
    // the household goal — it must be 'earlier', the chronologically first one.
    expect(r.goals).toHaveLength(1);
    expect(r.goals[0]).toMatchObject({ user_id: earlier });
  });

  it('duplicate ids for bills and debts are reported and only the first is kept', () => {
    expect(out.bills.filter((b) => b.label === 'STEG')).toHaveLength(1);
    expect(out.debts.filter((d) => d.person === 'Karim')).toHaveLength(1);
  });

  it('the legacy bill-label fallback (CHARGE_META) is used when a bill has no label of its own', () => {
    expect(out.bills.find((b) => b.user_id === BOB)).toMatchObject({
      label: 'Internet & téléphone',
      amount_mil: 20_000,
    });
  });

  it('settings.charges (the pre-bills format) is still converted for an unmigrated row', () => {
    expect(out.bills.find((b) => b.label === 'Assurance')).toMatchObject({
      amount_mil: 25_000,
      frequency: 'monthly',
    });
  });

  it('both debt schemas, and a settled debt keeps settledDate when valid, else falls back to now', () => {
    expect(
      out.debts.map((d) => [d.direction, d.person, d.amount_mil, d.due_on, d.note, d.settled_at]),
    ).toEqual([
      ['owed_to_me', 'Karim', 50_000, '2026-10-01', 'resto', null],
      ['i_owe', 'Sami', 30_000, null, 'essence', NOW.toISOString()],
      [
        'owed_to_me',
        'Amine',
        80_000,
        '2026-11-01',
        'prêt',
        new Date('2026-09-10T12:00:00+01:00').toISOString(),
      ],
    ]);
  });

  it('re-running gives the same rows and ids; two users’ "e1" get two ids', () => {
    expect(convertAll(ROWS, HOUSEHOLDS, NOW)).toEqual(out);
    const e1 = { id: 'e1', amount: 1, category: 'courses', date: '2026-09-01' };
    const two = convertAll(
      [
        { user_id: ALICE, created_at: '', data: { settings: {}, expenses: [e1] } },
        { user_id: BOB, created_at: '', data: { settings: {}, expenses: [e1] } },
      ],
      [],
      NOW,
    );
    expect(new Set(two.expenses.map((e) => e.id)).size).toBe(2);
  });
});

describe('verify', () => {
  it('balances: old totals = new rows + reported skips, per source, month and pot; every invariant holds', () => {
    const v = verify(ROWS, HOUSEHOLDS, out);
    expect(v.ok).toBe(true);
    expect(v.mismatches).toEqual([]);
    expect(v.invariants.every((i) => i.pass)).toBe(true);
    expect(v.skippedMil).toBe(12_000); // the duplicate 'e2' (12 TND), the only skip with a known mil+month+pot
  });

  it('catches a lost row', () => {
    const lost = { ...out, expenses: out.expenses.filter((e) => e.label !== 'Carrefour') };
    expect(verify(ROWS, HOUSEHOLDS, lost).mismatches).toEqual([
      {
        source: `user:${ALICE}`,
        month: '2026-09',
        pot: 'needs',
        oldMil: 1_333_000,
        newMil: 1_300_500,
        skippedMil: 0,
      },
    ]);
  });

  it('invariants fail when bills are wiped from the output', () => {
    const wiped = { ...out, bills: [] };
    const v = verify(ROWS, HOUSEHOLDS, wiped);
    expect(v.ok).toBe(false);
    const invariant = v.invariants.find((i) => i.name.includes('bill'))!;
    expect(invariant.pass).toBe(false);
    expect(invariant.detail).not.toBe('ok');
  });

  it('R5: invariant 3 fails when the household goal and its moves are removed from the output', () => {
    const aliceGoal = out.goals.find((g) => g.user_id === ALICE)!;
    const noGoal = {
      ...out,
      goals: out.goals.filter((g) => g.id !== aliceGoal.id),
      savings_moves: out.savings_moves.filter((m) => m.goal_id !== aliceGoal.id),
    };
    const v = verify(ROWS, HOUSEHOLDS, noGoal);
    expect(v.ok).toBe(false);
    const invariant = v.invariants.find((i) => i.name.includes('balance'))!;
    expect(invariant.pass).toBe(false);
    expect(invariant.detail).toContain('no goal exists');
  });

  it('R5: invariant 3 fails when the opening deposit has the wrong amount', () => {
    const aliceGoal = out.goals.find((g) => g.user_id === ALICE)!;
    const opening = out.savings_moves.find((m) => m.goal_id === aliceGoal.id && m.from_pot === null)!;
    const wrongAmount = {
      ...out,
      savings_moves: out.savings_moves.map((m) =>
        m.id === opening.id ? { ...m, amount_mil: m.amount_mil + 1 } : m,
      ),
    };
    const v = verify(ROWS, HOUSEHOLDS, wrongAmount);
    expect(v.ok).toBe(false);
    const invariant = v.invariants.find((i) => i.name.includes('balance'))!;
    expect(invariant.pass).toBe(false);
    expect(invariant.detail).toContain("doesn't match");
  });

  it('R5 (fix round 3): a spurious goal on a household member — who can never own one — fails invariant 3', () => {
    const aliceGoal = out.goals.find((g) => g.user_id === ALICE)!;
    const opening = out.savings_moves.find((m) => m.goal_id === aliceGoal.id && m.from_pot === null)!;
    const spuriousGoal = { ...aliceGoal, id: 'fake-goal', user_id: BOB };
    const spuriousMove = {
      ...opening,
      id: 'fake-move',
      goal_id: 'fake-goal',
      user_id: BOB,
      amount_mil: 999_000,
    };
    const spurious = {
      ...out,
      goals: [...out.goals, spuriousGoal],
      savings_moves: [...out.savings_moves, spuriousMove],
      origin: { ...out.origin, 'fake-goal': `user:${BOB}`, 'fake-move': `user:${BOB}` },
    };
    const v = verify(ROWS, HOUSEHOLDS, spurious);
    expect(v.ok).toBe(false);
    const invariant = v.invariants.find((i) => i.name.includes('balance'))!;
    expect(invariant.pass).toBe(false);
    expect(invariant.detail).toContain(`user:${BOB}`);
  });

  it('R3 tightening (fix round 3): an extra move on an already-excused goal still fails invariant 3', () => {
    const frankGoal = out.goals.find((g) => g.user_id === FRANK)!;
    const extra = {
      ...out,
      savings_moves: [
        ...out.savings_moves,
        {
          id: 'extra-move',
          user_id: FRANK,
          goal_id: frankGoal.id,
          amount_mil: 5_000_000,
          kind: 'deposit' as const,
          from_pot: null,
          occurred_on: '2026-09-23',
        },
      ],
      origin: { ...out.origin, 'extra-move': `user:${FRANK}` },
    };
    const v = verify(ROWS, HOUSEHOLDS, extra);
    expect(v.ok).toBe(false);
    const invariant = v.invariants.find((i) => i.name.includes('balance'))!;
    expect(invariant.pass).toBe(false);
  });

  it('invariant 4 (fix round 3): a savings move whose user_id no longer matches its goal owner fails', () => {
    const aliceGoal = out.goals.find((g) => g.user_id === ALICE)!;
    const move = out.savings_moves.find((m) => m.goal_id === aliceGoal.id)!;
    const tampered = {
      ...out,
      savings_moves: out.savings_moves.map((m) => (m.id === move.id ? { ...m, user_id: BOB } : m)),
    };
    const v = verify(ROWS, HOUSEHOLDS, tampered);
    expect(v.ok).toBe(false);
    const invariant = v.invariants.find((i) => i.name.includes("goal's owner"))!;
    expect(invariant.pass).toBe(false);
    expect(invariant.detail).toContain(move.id);
  });

  it("R5: invariant 3 passes for HH2, where the goal was built from the anchor's settings (R3 fallback)", () => {
    const v = verify(ROWS, HOUSEHOLDS, out);
    expect(v.invariants.find((i) => i.name.includes('balance'))!.pass).toBe(true);
    expect(v.invariants.find((i) => i.name.includes('balance'))!.detail).toBe('ok');
  });

  it('appDiffs lists the string-amount case the app itself silently counted as 0', () => {
    const diff = verify(ROWS, HOUSEHOLDS, out).appDiffs.find(
      (d) => d.source === `user:${ALICE}` && d.month === '2026-09' && d.pot === 'needs',
    );
    // app: 32.5 (e1) + 0 ('1 200,5', unparsed) + -5 (e4, uncapped) + 100 (e6, épargne still counted) = 127.5 TND
    expect(diff).toMatchObject({ appMil: 127_500, newMil: 1_333_000 });
  });
});

describe('Phase 6: the household on the new model (plan Task 10)', () => {
  it('the household goal carries the household id; a personal goal has none', () => {
    expect(out.goals.find((g) => g.user_id === ALICE)?.household_id).toBe(HH);
    /* FRANK has no household: his own goal stays his */
    expect(out.goals.find((g) => g.user_id === FRANK)?.household_id).toBeNull();
  });

  it('a shared Envies expense becomes private (plan D1), with one issue per household', () => {
    const owner = '00000000-0000-4000-8000-000000000401';
    const member = '00000000-0000-4000-8000-000000000402';
    const hh = '00000000-0000-4000-8000-0000000000a6';
    const rows = [
      { user_id: owner, created_at: '2026-08-01T00:00:00Z', data: { settings: { n1: 'Owner', s1: 1000 } } },
      { user_id: member, created_at: '2026-08-02T00:00:00Z', data: { settings: { n1: 'Member', s1: 900 } } },
    ];
    const shared = (id: string, category: string, envelope: string, amount: number) => ({
      id,
      amount,
      category,
      envelope,
      date: '2026-09-05',
      label: id,
    });
    const households = [
      {
        household_id: hh,
        members: [
          { user_id: owner, joined_at: '2026-08-01T00:00:00Z', display_name: 'Owner' },
          { user_id: member, joined_at: '2026-08-02T00:00:00Z', display_name: 'Member' },
        ],
        data: {
          expenses: [
            shared('w1', 'restaurant', 'envies', 30),
            shared('w2', 'restaurant', 'envies', 20),
            shared('n1', 'courses', 'besoins', 40),
          ],
          bills: [],
        },
      },
    ];
    const r = convertAll(rows, households, NOW);
    const byLabel = (l: string) => r.expenses.find((e) => e.label === l)!;
    expect(byLabel('w1')).toMatchObject({ pot: 'wants', household_id: null, user_id: owner });
    expect(byLabel('w2')).toMatchObject({ pot: 'wants', household_id: null });
    expect(byLabel('n1')).toMatchObject({ pot: 'needs', household_id: hh });
    /* D1's check holds for every row: only Besoins are shared */
    expect(r.expenses.every((e) => e.household_id === null || e.pot === 'needs')).toBe(true);
    expect(r.issues.filter((i) => i.kind === 'shared_wants_private')).toEqual([
      { source: `hh:${hh}`, kind: 'shared_wants_private', ref: hh, detail: '2' },
    ]);
    expect(verify(rows, households, r).ok).toBe(true);
  });
});

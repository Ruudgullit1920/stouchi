import type { LegacyHousehold, LegacyRow } from '../../../scripts/backfill/convert';

export const ALICE = '00000000-0000-4000-8000-000000000001';
export const BOB = '00000000-0000-4000-8000-000000000002';
export const CAROL = '00000000-0000-4000-8000-000000000003';
export const DAVE = '00000000-0000-4000-8000-000000000004';
export const EVE = '00000000-0000-4000-8000-000000000005';
export const FRANK = '00000000-0000-4000-8000-000000000006';
export const GEORGE = '00000000-0000-4000-8000-000000000007';
export const HH = '00000000-0000-4000-8000-0000000000a1';
export const EMPTY_HH = '00000000-0000-4000-8000-0000000000a2';
export const HH2 = '00000000-0000-4000-8000-0000000000a3';
export const NOW = new Date('2026-09-23T09:00:00Z');

/* Truncated by a 60-code-point cut: 59 'a's then a whole 🎉 (a surrogate pair).
   A naive .slice(0, 60) (UTF-16 code units) would land inside the pair and
   corrupt it; Array.from(...).slice(0, 60) keeps it intact and drops the 'b's. */
const emojiLabel = 'a'.repeat(59) + '🎉' + 'b'.repeat(10);
export const EMOJI_LABEL_KEPT = 'a'.repeat(59) + '🎉';

/* `who` is a device-relative storage key ('Sofiene'/'Zeineb' meant "whichever
   account wrote this"), never a display name — app.js:1814. It can't identify
   an author any more, so it's kept here only as an honest legacy shape; the
   converter never reads it (fix round 2, R1). */
const monoprix = {
  id: 'hx',
  amount: 40,
  category: 'courses',
  envelope: 'besoins',
  date: '2026-09-04',
  label: 'Monoprix',
  who: 'Zeineb',
};

export const ROWS: LegacyRow[] = [
  {
    user_id: ALICE,
    created_at: '2026-08-01T10:00:00Z',
    data: {
      /* goal/saved/goalType/goalNote here are applyShared() mirrors of HH's own
         goal (below) — the converter must ignore them, not build a second goal. */
      settings: {
        n1: 'Sofiene',
        s1: 2500,
        s2: 1800,
        rb: 50,
        rp: 30,
        goal: 20000,
        saved: 4800,
        goalType: 'voyage',
        goalNote: '',
        /* settings.charges: the pre-bills format; still converted for an
           unmigrated row (no matching entry in `bills`). */
        charges: [{ id: 'c1', label: 'Assurance', amount: 25 }],
      },
      expenses: [
        {
          id: 'e1',
          amount: 32.5,
          category: 'courses',
          envelope: 'besoins',
          date: '2026-09-02',
          label: 'Carrefour',
        },
        { id: 'e2', amount: 12, category: 'café', envelope: 'perso', date: '2026-09-03', label: '' },
        {
          id: 'e3',
          amount: '1 200,5',
          category: 'loyer',
          envelope: 'besoins',
          date: '2026-09-01',
          label: 'Loyer',
        },
        { id: 'e4', amount: -5, category: 'courses', envelope: 'besoins', date: '2026-09-02' },
        { id: 'e5', amount: 10, category: 'courses', envelope: 'besoins', date: '2026-13-01' },
        { id: 'e2', amount: 12, category: 'café', envelope: 'perso', date: '2026-09-03', label: '' },
        {
          id: 'e6',
          amount: 100,
          category: 'épargne',
          envelope: 'besoins',
          date: '2026-09-05',
          label: 'Mis de côté',
        },
        {
          id: 'e7',
          amount: 20,
          category: 'autre',
          envelope: 'besoins',
          date: '2026-08-30',
          label: emojiLabel,
        },
        monoprix,
        /* a stale mirror of a household tombstone (ht1, below): still owned by
           the household, so this copy must be excluded, not re-converted */
        {
          id: 'ht1',
          amount: 999,
          category: 'courses',
          envelope: 'besoins',
          date: '2026-09-01',
          label: 'Stale',
        },
        null,
        'garbage',
      ],
      bills: [
        {
          id: 'b1',
          key: 'steg',
          label: 'STEG',
          amount: 95,
          freq: 'quarterly',
          day: 12,
          anchor: '2026-08',
          scope: 'moi',
        },
        { id: 'b2', key: 'autre', label: 'Vide', amount: 0, freq: 'monthly', day: 1 },
        /* duplicate of b1's id */
        { id: 'b1', key: 'steg', label: 'STEG dup', amount: 50, freq: 'monthly', day: 5 },
      ],
      debts: [
        {
          id: 'd1',
          type: 'due',
          person: 'Karim',
          label: 'resto',
          amount: 50,
          date: '2026-10-01',
          who: 'Maison',
          settled: false,
        },
        { id: 'd2', kind: 'donner', who: 'Sami', note: 'essence', amount: 30, dueDate: '', settled: true },
        {
          id: 'd3',
          type: 'due',
          person: 'Amine',
          label: 'prêt',
          amount: 80,
          date: '2026-11-01',
          settled: true,
          settledDate: '2026-09-10',
        },
        /* duplicate of d1's id */
        {
          id: 'd1',
          type: 'due',
          person: 'Karim2',
          label: 'dup',
          amount: 999,
          date: '2026-10-02',
          settled: false,
        },
      ],
    },
  },
  {
    user_id: BOB,
    created_at: 'not a date',
    data: {
      settings: { n1: 'Zeineb', s1: 1800 },
      expenses: [monoprix],
      /* no label: falls back to the legacy key's own label (CHARGE_META) */
      bills: [{ id: 'bx', key: 'internet', amount: 20, freq: 'monthly', day: 5 }],
      debts: 'oops',
    },
  },
  {
    user_id: CAROL,
    created_at: '2026-09-01T10:00:00Z',
    data: {
      /* never onboarded (no settings): still had local data on the device */
      expenses: [
        { id: 'c1', amount: 50, category: 'courses', envelope: 'besoins', date: '2026-09-01' },
        { id: 'c2', amount: 42.5, category: 'courses', envelope: 'besoins', date: '2026-09-02' },
        { id: 'c3', amount: 50, category: 'courses', envelope: 'besoins', date: '2026-09-03' },
      ],
      bills: [{ id: 'cb1', key: 'steg', amount: 30 }],
      debts: [],
    },
  },
  { user_id: DAVE, created_at: '2026-09-01T10:00:00Z', data: null },
  { user_id: EVE, created_at: '2026-09-01T10:00:00Z', data: [1, 2] },
  {
    user_id: FRANK,
    created_at: '2026-09-01T10:00:00Z',
    data: {
      /* goalType 'toString' must not resolve to Object.prototype.toString */
      settings: { n1: 'Frank', s1: 1000, goal: 1000, saved: 50, goalType: 'toString' },
      expenses: [
        {
          id: 'f1',
          amount: 200,
          category: 'épargne',
          envelope: 'besoins',
          date: '2026-09-08',
          label: 'Épargne',
        },
      ],
    },
  },
  {
    user_id: GEORGE,
    created_at: '2026-09-01T10:00:00Z',
    /* HH2's own goal is present but empty (R3): the household goal must come
       from George's own settings instead, not read as "target 0, saved 0". */
    data: { settings: { n1: 'George', s1: 800, goal: 500, saved: 300, goalType: 'maison', goalNote: '' } },
  },
];

export const HOUSEHOLDS: LegacyHousehold[] = [
  {
    household_id: HH,
    members: [
      { user_id: BOB, joined_at: '2026-08-05T00:00:00Z', display_name: 'Zeineb' },
      { user_id: ALICE, joined_at: '2026-08-01T00:00:00Z', display_name: 'Sofiene' },
    ],
    data: {
      /* the shared goal: the source of truth over both members' settings mirrors */
      goal: {
        goal: { v: 20000, t: '2026-08-10T00:00:00Z' },
        saved: { v: 5300, t: '2026-09-10T00:00:00Z' },
        goalType: { v: 'voyage', t: '2026-08-10T00:00:00Z' },
        goalNote: { v: '', t: '2026-08-10T00:00:00Z' },
      },
      expenses: [
        monoprix,
        /* a shared "épargne" entry: becomes a deposit on the household goal */
        {
          id: 'hs1',
          amount: 200,
          category: 'épargne',
          envelope: 'besoins',
          date: '2026-09-10',
          who: 'Sofiene',
        },
        /* a tombstone: no row, no issue — but its id still counts as owned */
        { id: 'ht1', deleted: true },
        /* attributed to the anchor (ALICE) like every shared entry; a bad
           amount so the fixture's converted-expense count doesn't move */
        {
          id: 'hy',
          amount: -1,
          category: 'transport',
          envelope: 'besoins',
          date: '2026-09-06',
          who: 'Colocataire',
        },
      ],
      bills: [],
    },
  },
  { household_id: EMPTY_HH, members: [], data: { expenses: [{ id: 'z', amount: 5, date: '2026-09-01' }] } },
  {
    household_id: HH2,
    members: [{ user_id: GEORGE, joined_at: '2026-09-01T00:00:00Z', display_name: 'George' }],
    /* R3: an empty goal object must not read as "the household has a goal" —
       it has to fall back to the anchor's own settings.goal/saved. */
    data: { goal: {}, expenses: [], bills: [] },
  },
];

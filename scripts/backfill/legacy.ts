/* How today's app (app.js) stored things, read the way it read them. */
import { isCategory, type CategoryKey, type Pot } from '../../src/shared/categories';
import { isValidISODate, todayTunis, type ISODate } from '../../src/shared/dates';
import { milFromTnd, parseTnd, type Mil } from '../../src/shared/money';
import { isRec, records, str, type Rec } from './shared';

/* app.js CATS keys carry accents; the new keys don't. 'épargne' was an expense
   category; it becomes a savings move. */
const LEGACY_CATEGORY: Record<string, CategoryKey | 'epargne'> = {
  courses: 'courses',
  maison: 'maison',
  déco: 'maison',
  électricité: 'factures',
  eau: 'factures',
  internet: 'factures',
  téléphone: 'factures',
  loyer: 'loyer',
  transport: 'transport',
  essence: 'essence',
  santé: 'sante',
  pharmacie: 'sante',
  restaurant: 'resto',
  café: 'cafe',
  shopping: 'shopping',
  vêtements: 'vetements',
  cadeau: 'cadeau',
  sortie: 'sortie',
  voyage: 'voyage',
  abonnement: 'abonnement',
  épargne: 'epargne',
  autre: 'autre',
};
/* app.js PERSO: these went to the 30 % envelope; everything else to "besoins". */
const LEGACY_PERSO = [
  'restaurant',
  'café',
  'shopping',
  'vêtements',
  'cadeau',
  'sortie',
  'voyage',
  'abonnement',
];

/* app.js CHARGE_META labels: the fallback when a bill has no label of its own. */
const LEGACY_BILL_LABEL: Record<string, string> = {
  loyer: 'Loyer ou crédit logement',
  steg: 'STEG / SONEDE',
  internet: 'Internet & téléphone',
  transport: 'Transport / essence',
  credit: 'Crédit bancaire',
  ecole: 'École / crèche',
  autre: 'Autre charge',
};

const key = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().trim() : '');

/* Object.hasOwn guards every prototype-key lookup below: a legacy string like
   'toString' or 'constructor' must fall through to the default, never resolve
   to a method inherited from Object.prototype. */
export function legacyCategory(raw: unknown): CategoryKey | 'epargne' {
  const k = key(raw);
  if (Object.hasOwn(LEGACY_CATEGORY, k)) return LEGACY_CATEGORY[k];
  return isCategory(k) ? k : 'autre';
}

/** The label for a legacy bill key (app.js CHARGE_META), or null when there is none. */
export function legacyBillLabel(raw: unknown): string | null {
  const k = key(raw);
  return Object.hasOwn(LEGACY_BILL_LABEL, k) ? LEGACY_BILL_LABEL[k] : null;
}

/** The envelope as today's app counted it (envelopeFor), so monthly totals match. */
export function legacyPot(e: Record<string, unknown>): Pot {
  if (e.envelope === 'perso') return 'wants';
  if (e.envelope === 'besoins') return 'needs';
  return LEGACY_PERSO.includes(key(e.category)) ? 'wants' : 'needs';
}

/** app.js's isSharedExpense: `isBesoins(e) && !e.personal` (app.js:453), where
 *  isBesoins is `envelope === 'besoins'` — except legacyPot already folds in
 *  the fallback for a missing envelope (the legacy pot rule, by category), so
 *  this reads as "legacyPot lands on needs, and it isn't marked personal".
 *
 *  This is the single predicate for "is this entry, on its OWN account, a
 *  genuinely shared row" — used everywhere an id match with the household's
 *  own mirror is checked (convert.ts, invariants.ts, verify.ts). An id match
 *  alone is not enough: app.js generates ids locally per account ('c'+i /
 *  'b'+i, migrateCharges/normalizeBill), so a personal entry on one account
 *  can coincidentally collide with a shared entry's id from another account.
 *  Treating that collision as "already covered by the household" would drop
 *  the personal row; converting it again under its own account is safe
 *  (counted, not lost — the SKIP list explicitly allows this direction). */
export function isSharedExpense(e: Rec): boolean {
  return legacyPot(e) === 'needs' && !e.personal;
}

/** app.js's isSharedBill: `billScope(b) === 'foyer'` (app.js:1140-1141). */
export function isSharedBill(b: Rec): boolean {
  return b.scope === 'foyer';
}

export function legacyAmount(raw: unknown): Mil | null {
  if (typeof raw === 'number') return milFromTnd(raw);
  if (typeof raw === 'string') return parseTnd(raw);
  return null;
}

/** `date`, else the Tunis calendar day of `updatedAt` — never a raw UTC slice. */
export function legacyDate(e: Record<string, unknown>): ISODate | null {
  const d = typeof e.date === 'string' ? e.date : '';
  if (isValidISODate(d)) return d;
  if (typeof e.updatedAt !== 'string') return null;
  const updated = new Date(e.updatedAt);
  return Number.isNaN(updated.getTime()) ? null : todayTunis(updated);
}

/** migrateDebt() in app.js: a settled debt keeps the day it was settled. */
export function legacySettledAt(d: Record<string, unknown>, nowIso: string): string | null {
  if (d.settled !== true) return null;
  const settledDate = typeof d.settledDate === 'string' ? d.settledDate : '';
  if (isValidISODate(settledDate)) {
    const dt = new Date(`${settledDate}T12:00:00+01:00`);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  return nowIso;
}

const clampDay = (v: unknown): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.min(31, Math.max(1, n)) : 1;
};

export { clampDay };

/** settings.charges: the pre-bills format, consumed by app.js on load; unmigrated
 *  rows may still carry it. */
export function legacyCharges(settings: Rec): { rec: Rec; ref: string }[] {
  const raw = Array.isArray(settings.charges) ? (settings.charges as unknown[]) : [];
  return raw.map((c, i) => ({
    rec: isRec(c) ? { ...c, freq: 'monthly' } : { label: str(c), amount: 0 },
    ref: isRec(c) && str(c.id) ? str(c.id) : `c${i}`,
  }));
}

const pluralize = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What a never-onboarded account's document is losing, for the issue's detail.
 *  Tombstones don't count — they were already gone — and the sum reads amounts
 *  the same way the real conversion does (legacyAmount), not a blind Number(). */
export function notOnboardedDetail(doc: Rec): string {
  const live = (v: unknown) => records(v).filter((r) => r.deleted !== true);
  const expenses = live(doc.expenses);
  const bills = live(doc.bills);
  const debts = live(doc.debts);
  const totalMil = expenses.reduce((sum, e) => sum + (legacyAmount(e.amount) ?? 0), 0);
  const amount = totalMil / 1000;
  return `${pluralize(expenses.length, 'expense')} (${amount} TND), ${pluralize(bills.length, 'bill')}, ${pluralize(debts.length, 'debt')}`;
}

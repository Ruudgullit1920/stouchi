/* The offline Aam Salah (plan Task 7): when the model or the network is down,
 * expenses can still be logged. Ported from the prototype's localBrain
 * (norm, KW, amountIn, dateIn), expenses only. It asks instead of guessing,
 * and labels are always the French category name. */
import { categoryLabel, potOf, type CategoryKey } from './categories';
import { addDays, type ISODate } from './dates';
import { MIL_PER_TND, parseMoney, type Mil } from './money';

/** The add_expense action, as /api/aam would send it (amount in TND). */
export interface AddExpense {
  type: 'add_expense';
  kind: 'direct';
  amount: number;
  category: CategoryKey;
  pot: 'besoins' | 'envies';
  label: string;
  date: ISODate;
}

export type LocalParse =
  { action: AddExpense } | { ask: 'amount' | 'what'; amount?: Mil } | { unknown: true };

/** one expense's cap, as on the server */
const MAX: Mil = 50_000 * MIL_PER_TND;

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'");

/* French, Latin-script derja and a little English; first match wins. */
const KW: [RegExp, CategoryKey][] = [
  [
    /courses|carrefour|monoprix|magasin general|aziza|marche|\bpain\b|khobz|\blait\b|legumes?|fruits?|viande|poulet|epicerie|superette|groceries/,
    'courses',
  ],
  [/loyer|\bkra\b|kira|\brent\b/, 'loyer'],
  [/steg|sonede|facture|internet|ooredoo|orange|telecom|forfait|recharge/, 'factures'],
  [/taxi|\bbus\b|louage|metro|transport|train|uber|bolt|parking/, 'transport'],
  [/essence|carburant|shell|agil|station|mazout|\bfuel\b/, 'essence'],
  [/pharma|medecin|docteur|dentiste|sante|medicament|analyse|clinique/, 'sante'],
  [/plombier|reparation|electromenager|meuble|bricolage/, 'maison'],
  [/ecole|creche|cours particuliers|fournitures|scolarite/, 'ecole'],
  [
    /resto|restaurant|pizza|burger|\bdej\b|dejeuner|diner|lablebi|mlawi|chapati|sandwich|kafteji|plan b|lunch|dinner/,
    'resto',
  ],
  [/cafe|9ahwa|kahwa|qahwa|coffee|\bthe\b|capucin|express/, 'cafe'],
  [/zara|vetement|chaussure|habit|\bpull\b|jean|robe/, 'vetements'],
  [/shopping|achat|amazon|jumia|decathlon/, 'shopping'],
  [/cine|sortie|concert|\bbar\b|match|soiree|plage/, 'sortie'],
  [/voyage|hotel|billet|avion|hammamet|djerba|sousse/, 'voyage'],
  [/netflix|spotify|abonnement|youtube premium|salle de sport|\bgym\b/, 'abonnement'],
  [/cadeau|anniversaire|mariage|3ars|gift/, 'cadeau'],
  [/coiffeur|hammam|esthetique|parfum|maquillage|beaute/, 'beaute'],
];

const catOf = (t: string): CategoryKey | null => KW.find(([re]) => re.test(t))?.[1] ?? null;

/** "le 3" / "le 1er": that day of this month when it has passed, else today. */
const DAY_OF_MONTH = /\ble (\d{1,2})(?:er)?\b/;

function dateIn(t: string, today: ISODate): ISODate {
  if (/avant[- ]hier/.test(t)) return addDays(today, -2);
  if (/\bhier\b|yesterday|lbera7/.test(t)) return addDays(today, -1);
  const m = DAY_OF_MONTH.exec(t);
  if (m) {
    const d = Number(m[1]);
    if (d >= 1 && d <= Number(today.slice(8, 10))) return `${today.slice(0, 8)}${String(d).padStart(2, '0')}`;
  }
  return today;
}

/** The first amount in the text, in millimes ("12,5", "35.200", "2k"); the "le 3" of a date is not one. */
function amountIn(t: string): Mil | null {
  const m = /(?:^|[^\w.,])(\d+(?:[.,]\d{1,3})?)(?![\d.,]*\d)\s*(k\b|mille)?/.exec(
    t.replace(DAY_OF_MONTH, ' '),
  );
  if (!m) return null;
  const mil = parseMoney(m[1]);
  return mil === null ? null : mil * (m[2] ? 1000 : 1);
}

/* Not a new expense: a correction, a delete or undo, a debt, money coming in or
   going to savings, a question. Offline these wait for Aam Salah; logging them
   would count an expense twice or invent one. */
const NOT_AN_EXPENSE =
  /c'etait|en fait|corrige|modifie|trompe|supprime|efface|enleve|annule|undo|me doit|je dois|rembourse|rendu|recu|prime|bonus|salaire|de cote|epargne|objectif|\?/;

/** "annule", "oups", "efface ça" on its own: undo the last action. The device
 * knows exactly which row that is, so it needs no model ("annule le café de
 * lundi" names another row: that one waits for Aam Salah). */
export const isUndo = (text: string): boolean =>
  /^(non,? )?(annuler?|undo|oups|efface ca)[\s!.]*$/.test(norm(text).trim());

export function parseLocal(text: string, today: ISODate): LocalParse {
  const t = norm(text).trim();
  if (NOT_AN_EXPENSE.test(t)) return { unknown: true };
  /* derja numbers-as-letters ("5allast", "9ahwa") start with a digit glued to letters: not amounts */
  const amount = amountIn(t.replace(/\b\d+[a-z]\w*/g, ' '));
  const category = catOf(t);
  if (amount !== null && (amount <= 0 || amount > MAX)) return { unknown: true };
  if (amount === null) return category ? { ask: 'amount' } : { unknown: true };
  if (!category) return { ask: 'what', amount };
  const pot = potOf(category) === 'needs' ? 'besoins' : 'envies';
  return {
    action: {
      type: 'add_expense',
      kind: 'direct',
      amount: amount / MIL_PER_TND,
      category,
      pot,
      label: categoryLabel(category),
      date: dateIn(t, today),
    },
  };
}

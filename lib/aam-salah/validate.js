/* The model's actions are untrusted input. validateActions() keeps only what
 * passes the spec's §5 table and drops (never repairs) the rest, using the
 * carnet the model was given: it cannot touch an id that isn't in it. */
'use strict';

const CAT_POT = {
  loyer: 'besoins', courses: 'besoins', factures: 'besoins', transport: 'besoins', essence: 'besoins',
  sante: 'besoins', maison: 'besoins', ecole: 'besoins', credit: 'besoins',
  resto: 'envies', cafe: 'envies', shopping: 'envies', vetements: 'envies', sortie: 'envies', voyage: 'envies',
  abonnement: 'envies', cadeau: 'envies', beaute: 'envies', autre: 'envies'
};
const DIRECT = new Set(['add_expense', 'add_debt', 'set_reminder', 'open', 'undo']);
const CONFIRM = new Set(['edit_expense', 'delete_expense', 'savings_deposit', 'savings_withdraw', 'add_income',
  'add_bill', 'pay_bill', 'settle_debt', 'update_goal', 'partner_request']);
const SCREENS = new Set(['budget', 'historique', 'objectif', 'pot:besoins', 'pot:envies', 'pot:epargne', 'notifications', 'reglages']);
const FREQ = new Set(['monthly', 'bimonthly', 'quarterly', 'yearly']);
const MAX_AMOUNT = 50000;
const DAY = 864e5;

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const daysFrom = (today, s) => Math.round((Date.parse(s + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY);
const amountOk = (n) => typeof n === 'number' && isFinite(n) && n > 0 && n <= MAX_AMOUNT;
const text = (s, max) => typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null;

/* What the carnet exposes, indexed once. */
function index(carnet) {
  const c = carnet || {};
  const list = (x) => (Array.isArray(x) ? x : []);
  const pots = c.pots || {};
  return {
    today: (String(c.aujourdhui || '').match(/^\d{4}-\d{2}-\d{2}/) || [new Date().toISOString().slice(0, 10)])[0],
    expenses: new Map(list(c.depenses_recentes).map((e) => [e.id, e])),
    bills: new Set(list(c.factures_fixes).map((b) => b.id)),
    dueBills: new Set(list(c.a_venir).filter((x) => x.type === 'facture').map((x) => x.id)),
    debts: new Set(list(c.a_venir).filter((x) => /doit|dette/.test(String(x.type))).map((x) => x.id)),
    left: { besoins: Number(pots.besoins && pots.besoins.reste) || 0, envies: Number(pots.envies && pots.envies.reste) || 0 },
    saved: Number(pots.epargne && pots.epargne.total) || 0,
    last: c.derniere_action || null,
    couple: Boolean(c.utilisateur && c.utilisateur.mode === 'couple')
  };
}

/* Couple mode (plan D7): an expense that isn't marked "moi" is the partner's
   (whatever their name, even an empty one); it is never edited or deleted
   here, the change becomes a request to them. */
const partners = (ix, id) => {
  const e = ix.couple && ix.expenses.get(id);
  return Boolean(e && e.qui !== 'moi');
};

/* Returns the cleaned action, or a string saying why it was dropped. */
function check(a, ix) {
  if (!a || typeof a !== 'object') return 'not an object';
  switch (a.type) {
    case 'add_expense': {
      if (!amountOk(a.amount)) return 'amount';
      if (!CAT_POT[a.category]) return 'category';
      const pot = CAT_POT[a.category];
      const date = isDate(a.date) ? a.date : ix.today;
      const d = daysFrom(ix.today, date);
      if (d > 0 || d < -60) return 'date out of range';
      return { type: a.type, amount: a.amount, category: a.category, pot, label: text(a.label, 60) || a.category, date };
    }
    case 'edit_expense': {
      if (!ix.expenses.has(a.id)) return 'unknown id';
      const ch = a.changes && typeof a.changes === 'object' ? a.changes : null;
      if (!ch) return 'no changes';
      const out = {};
      if ('amount' in ch) { if (!amountOk(ch.amount)) return 'amount'; out.amount = ch.amount; }
      if ('category' in ch) { if (!CAT_POT[ch.category]) return 'category'; out.category = ch.category; out.pot = CAT_POT[ch.category]; }
      if ('label' in ch) { const l = text(ch.label, 60); if (!l) return 'label'; out.label = l; }
      if ('date' in ch) { if (!isDate(ch.date) || daysFrom(ix.today, ch.date) > 0 || daysFrom(ix.today, ch.date) < -60) return 'date'; out.date = ch.date; }
      if (!Object.keys(out).length) return 'no allowed change';
      if (partners(ix, a.id)) return { type: 'partner_request', id: a.id, change: { kind: 'edit', changes: out } };
      return { type: a.type, id: a.id, changes: out };
    }
    case 'delete_expense':
      if (!ix.expenses.has(a.id)) return 'unknown id';
      if (partners(ix, a.id)) return { type: 'partner_request', id: a.id, change: { kind: 'delete' } };
      return { type: a.type, id: a.id };
    case 'savings_deposit': {
      if (!amountOk(a.amount)) return 'amount';
      const from = a.from === 'besoins' ? 'besoins' : 'envies';
      if (a.amount > ix.left[from]) return 'more than what is left in ' + from;
      return { type: a.type, amount: a.amount, from };
    }
    case 'savings_withdraw': {
      if (!amountOk(a.amount)) return 'amount';
      if (a.amount > ix.saved) return 'more than savings';
      return { type: a.type, amount: a.amount, to: a.to === 'besoins' ? 'besoins' : 'envies', reason: text(a.reason, 80) || '' };
    }
    case 'add_income': {
      if (!amountOk(a.amount)) return 'amount';
      const to = ['epargne', 'envies', 'besoins'].includes(a.to) ? a.to : 'epargne';
      return { type: a.type, amount: a.amount, to, label: text(a.label, 40) || 'Revenu en plus' };
    }
    case 'add_bill': {
      if (!amountOk(a.amount)) return 'amount';
      if (!FREQ.has(a.frequency)) return 'frequency';
      if (!Number.isInteger(a.day) || a.day < 1 || a.day > 31) return 'day';
      const label = text(a.label, 40); if (!label) return 'label';
      return { type: a.type, label, amount: a.amount, frequency: a.frequency, day: a.day };
    }
    case 'pay_bill':
      return ix.dueBills.has(a.id) || ix.bills.has(a.id) ? { type: a.type, id: a.id } : 'unknown bill';
    case 'add_debt': {
      if (!amountOk(a.amount)) return 'amount';
      if (a.direction !== 'i_owe' && a.direction !== 'owed_to_me') return 'direction';
      const person = text(a.person, 40); if (!person) return 'person';
      if (a.due != null && (!isDate(a.due) || daysFrom(ix.today, a.due) < 0)) return 'due';
      return { type: a.type, direction: a.direction, person, amount: a.amount, due: a.due || null, note: text(a.note, 80) || '' };
    }
    case 'settle_debt':
      return ix.debts.has(a.id) ? { type: a.type, id: a.id } : 'unknown debt';
    case 'set_reminder': {
      const t = text(a.text, 120); if (!t) return 'text';
      if (!isDate(a.date)) return 'date';
      const d = daysFrom(ix.today, a.date); if (d < 0 || d > 365) return 'date out of range';
      const time = typeof a.time === 'string' && /^\d{2}:\d{2}$/.test(a.time) ? a.time : '09:00';
      return { type: a.type, text: t, date: a.date, time };
    }
    case 'update_goal': {
      const out = { type: a.type };
      if (a.target != null) {
        /* goals (a house) can be far above one expense's cap */
        if (typeof a.target !== 'number' || !isFinite(a.target) || a.target <= 0 || a.target > 5e6) return 'target';
        if (a.target <= ix.saved) return 'target below savings';
        out.target = a.target;
      }
      if (a.name != null) { const n = text(a.name, 40); if (!n) return 'name'; out.name = n; }
      return out.target || out.name ? out : 'nothing to change';
    }
    case 'open':
      return SCREENS.has(a.screen) ? { type: a.type, screen: a.screen } : 'screen';
    case 'undo':
      return ix.last ? { type: 'undo' } : 'nothing to undo';
    default:
      return 'unknown type';
  }
}

function validateActions(actions, carnet) {
  const ix = index(carnet);
  const kept = [], dropped = [];
  (Array.isArray(actions) ? actions : []).slice(0, 3).forEach((a) => {
    const r = check(a, ix);
    if (typeof r === 'string') dropped.push({ action: a, why: r });
    else kept.push(Object.assign(r, { kind: DIRECT.has(r.type) ? 'direct' : 'confirm' }));
  });
  return { kept, dropped };
}

module.exports = { validateActions, CAT_POT, DIRECT, CONFIRM, SCREENS };

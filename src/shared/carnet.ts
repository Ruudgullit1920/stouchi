/* Aam Salah's carnet (assistant spec §4): every figure the model may say,
 * already computed by the same maths as the screens, so the bubble can never
 * contradict the screen. The server builds it from the caller's rows; the
 * client's copy is never trusted.
 *
 * Money leaves as TND only here (mil / 1000, exact: 12 500 → 12.5). Rows are
 * named by short ids (shortIds.ts); `refs` maps them back to uuids. Labels are
 * data: control characters stripped, cut to 60. An entry the maths can't
 * produce is left out, never null.
 *
 * Couple mode (spec §4, plan D1): the partner's first name, and "qui" on each
 * expense. Only my rows and the partner's shared ones are ever used: RLS is the
 * first barrier, this filter the second. */
import { categoryLabel, type CategoryKey, type Pot } from './categories';
import {
  addDays,
  daysBetween,
  isInPeriod,
  nextPayday,
  periodsBack,
  todayTunis,
  type ISODate,
  type PayPeriod,
} from './dates';
import { computeFacts, type Facts, type FactsInput, type PotFacts } from './facts';
import { monthName } from './format';
import { t, type StringKey } from './i18n/t';
import { periodTotals, potBreakdown } from './ledger';
import { MIL_PER_TND, type Mil } from './money';
import { isSavingsOpportunity, spendPace } from './nudges';
import { activeGoal, goalEta } from './payday';
import type { Bill, Debt, Expense, Goal, Income, Reminder } from './schemas';
import { shortIds, type ShortKind } from './shortIds';

/** The last action Aam Salah ran for this user, as the client remembers it. */
export interface LastAction {
  type: string;
  /** the uuid of the row it wrote */
  ref: string;
  /** ISO instant */
  at: string;
  /** trusted text only (the eval); /api/aam leaves it out and the row describes itself */
  summary?: string;
}

export type CarnetInput = Omit<FactsInput, 'today'> & {
  goals: Goal[];
  reminders: Reminder[];
  firstName: string;
  nudgeSeen: string[];
  lastAction: LastAction | null;
  now: Date;
  /** couple mode: the partner, from couple_state (with `couple` for the figures) */
  partner?: { user_id: string; first_name: string } | null;
};

type Tnd = number;
type PotName = 'besoins' | 'envies';
interface PotLine {
  budget: Tnd;
  depense: Tnd;
  reste: Tnd;
  /** incomes and withdrawals in, minus deposits out — only when not 0 */
  mouvements?: Tnd;
  etat: string;
}
type AVenir =
  | { id: string; type: 'facture'; label: string; montant: Tnd; echeance: ISODate; dans: string }
  | {
      id: string;
      type: 'on_me_doit' | 'dette';
      personne: string;
      montant: Tnd;
      echeance?: ISODate;
      dans?: string;
      depuis?: string;
    };

export interface Carnet {
  aujourdhui: string;
  calendrier: {
    hier: string;
    avant_hier: string;
    '7_derniers_jours': string[];
    '7_prochains_jours': string[];
    fin_du_mois: ISODate;
    prochaine_paie: ISODate;
  };
  utilisateur: { prenom: string; mode: 'solo' } | { prenom: string; mode: 'couple'; partenaire: string };
  plan: { salaire: Tnd; jour_de_paie: string; repartition: string; jours_restants: number };
  reste_a_depenser: { total: Tnd; par_jour: Tnd };
  pots: {
    /* the unpaid bills of the period, already taken out of reste (as on the screen) */
    besoins: PotLine & { factures_a_venir_deja_deduites: Tnd };
    envies: PotLine;
    epargne: {
      verse_ce_mois: Tnd;
      objectif?: string;
      total?: Tnd;
      cible?: Tnd;
      progression?: string;
      date_estimee?: string;
    };
  };
  a_venir: AVenir[];
  factures_fixes: { id: string; label: string; montant: Tnd; frequence: string; jour: number }[];
  depenses_recentes: {
    id: string;
    date: ISODate;
    label: string;
    categorie: CategoryKey;
    pot: PotName;
    montant: Tnd;
    /** couple mode: "moi", or the partner's first name */
    qui?: string;
  }[];
  par_categorie_ce_mois: { categorie: CategoryKey; montant: Tnd }[];
  tendances: {
    vs_mois_dernier_a_meme_date?: string;
    plus_gros_poste_hors_loyer?: string;
    mois_precedents: { mois: string; total: Tnd }[];
    categorie_en_hausse?: string;
  };
  simulations: Record<string, string>;
  rappels: { id: string; texte: string; date: ISODate }[];
  a_signaler?: string;
  derniere_action?: { type: string; id?: string; resume: string };
}

const RECENT = 40;
const REMINDERS = 10;
const UNDO_MS = 10 * 60_000;
/** the phone stamps the last action: allow its clock to run a little ahead of the server's */
const CLOCK_SKEW_MS = 2 * 60_000;
/** a category "grows" only from this much (50 TND), so a 3 TND café isn't news */
const RISING_FROM: Mil = 50_000;
/* What each undoable action wrote, so its row can be checked (plan: Decisions).
   Savings moves are hard-delete only: not undoable in Phase 3. */
const UNDOABLE: Record<
  string,
  keyof Pick<CarnetInput, 'expenses' | 'bills' | 'debts' | 'reminders' | 'goals' | 'incomes'>
> = {
  add_expense: 'expenses',
  edit_expense: 'expenses',
  delete_expense: 'expenses',
  pay_bill: 'expenses',
  add_debt: 'debts',
  settle_debt: 'debts',
  set_reminder: 'reminders',
  add_bill: 'bills',
  update_goal: 'goals',
  add_income: 'incomes',
};

const tnd = (mil: Mil): Tnd => mil / MIL_PER_TND;
const clean = (s: string, max = 60) =>
  s
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const POT_NAME: Record<Pot, PotName> = { needs: 'besoins', wants: 'envies' };
const WEEKDAYS = t('carnet.weekdays').split(',');
const weekday = (d: ISODate) => WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];
const days = (n: number) =>
  n === 0 ? t('carnet.today') : n === 1 ? t('carnet.day') : t('carnet.days', { n });
const dueIn = (due: ISODate, today: ISODate) => {
  const d = daysBetween(today, due);
  return d >= 0 ? days(d) : t('carnet.late', { days: days(-d) });
};
const month = (label: string) => monthName(label).toLowerCase();
const monthYear = (d: ISODate) => `${month(d.slice(0, 7))} ${d.slice(0, 4)}`;
const monthIndex = (d: ISODate) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7));
const pct = (ratio: number) => Math.round(ratio * 100);
const dayOf = (instant: string) => todayTunis(new Date(instant));

function potLine(p: PotFacts): PotLine {
  const state: StringKey =
    p.left < 0 ? 'carnet.state.over' : p.warn ? 'carnet.state.warn' : 'carnet.state.ok';
  return {
    budget: tnd(p.budget),
    depense: tnd(p.spent),
    reste: tnd(p.left),
    ...(p.moved !== 0 && { mouvements: tnd(p.moved) }),
    etat: t(state, { pct: pct(p.ratio) }),
  };
}

type Row = Expense | Bill | Debt | Reminder | Goal | Income;
/** What the last action's row is, in a few words — built from the row, never from client text. */
function describe(table: (typeof UNDOABLE)[string], row: Row): string {
  const money = (mil: Mil) => `${tnd(mil)} TND`;
  switch (table) {
    case 'expenses': {
      const e = row as Expense;
      return `${e.label || categoryLabel(e.category)}, ${money(e.amount_mil)}, ${e.spent_on}`;
    }
    case 'debts':
      return `${(row as Debt).person}, ${money((row as Debt).amount_mil)}`;
    case 'reminders':
      return `${(row as Reminder).text}, ${dayOf((row as Reminder).remind_at)}`;
    case 'goals':
      return `${(row as Goal).name}, ${money((row as Goal).target_mil)}`;
    default: {
      const b = row as Bill | Income;
      return `${b.label}, ${money(b.amount_mil)}`;
    }
  }
}

/** Spending per category between two dates, both pots, biggest first. */
function byCategory(expenses: Expense[], start: ISODate, end: ISODate): Map<CategoryKey, Mil> {
  const range: PayPeriod = { start, end, label: start.slice(0, 7) };
  const out = new Map<CategoryKey, Mil>();
  for (const pot of ['needs', 'wants'] as const)
    for (const c of potBreakdown(expenses, pot, range).categories)
      out.set(c.key, (out.get(c.key) ?? 0) + c.total);
  return new Map([...out].sort(([ka, a], [kb, b]) => b - a || ka.localeCompare(kb)));
}
const total = (m: Map<CategoryKey, Mil>) => [...m.values()].reduce((s, v) => s + v, 0);

export function buildCarnet(given: CarnetInput): {
  carnet: Carnet;
  refs: Map<string, string>;
  nudgeKey: string | null;
} {
  const partner = given.couple && given.partner ? given.partner : null;
  const input = scoped(given, partner);
  const { profile, now } = input;
  /* a partner who never set a name is still named: their rows must never read as mine */
  const partnerName = partner ? clean(partner.first_name, 40).trim() || 'Partenaire' : '';
  const today = todayTunis(now);
  const facts: Facts = computeFacts({ ...input, today });
  const { period, daysLeft } = facts;
  const [, prev, ...older] = periodsBack(today, profile.payday, 4);

  /* ── rows the model can name, and their short ids ── */
  const live = input.expenses.filter((e) => e.deleted_at === null);
  const recent = [...live]
    .sort((a, b) => b.spent_on.localeCompare(a.spent_on) || b.created_at.localeCompare(a.created_at))
    .slice(0, RECENT);
  const bills = input.bills
    .filter((b) => b.active)
    .sort((a, b) => a.day - b.day || a.label.localeCompare(b.label));
  const debts = input.debts
    .filter((d) => d.settled_at === null && d.deleted_at === null)
    .sort(
      (a, b) =>
        (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.created_at.localeCompare(b.created_at),
    );
  const reminders = input.reminders
    .filter((r) => r.done_at === null && r.deleted_at === null)
    .sort((a, b) => a.remind_at.localeCompare(b.remind_at))
    .slice(0, REMINDERS);
  const tagged = (kind: ShortKind, rows: { id: string }[]) => rows.map((r) => ({ kind, id: r.id }));
  const refs = shortIds([
    ...tagged('e', recent),
    ...tagged('b', bills),
    ...tagged('d', debts),
    ...tagged('r', reminders),
  ]);
  const short = new Map([...refs].map(([s, id]) => [id, s]));
  const sid = (id: string) => short.get(id) as string;

  /* ── savings ── */
  const goal = activeGoal(input.goals);
  const monthly = facts.pots.savings.budget;
  const savedThisPeriod = input.savingsMoves
    .filter((m) => isInPeriod(m.occurred_on, period))
    .reduce((s, m) => s + m.amount_mil, 0);
  const saved = goal
    ? input.savingsMoves.filter((m) => m.goal_id === goal.id).reduce((s, m) => s + m.amount_mil, 0)
    : 0;
  const eta = goal ? goalEta(goal.target_mil, saved, monthly, today) : null;

  /* ── trends: this period so far against the last one at the same date ── */
  const sameDay = addDays(prev.start, daysBetween(period.start, today));
  const prevEnd = sameDay < prev.end ? sameDay : prev.end;
  const thisPeriod = byCategory(live, period.start, period.end);
  const soFar = byCategory(live, period.start, today);
  const before = byCategory(live, prev.start, prevEnd);
  const rising = [...soFar]
    .map(([cat, mil]) => ({ cat, mil, was: before.get(cat) ?? 0 }))
    .filter((c) => c.mil >= RISING_FROM && c.mil > c.was)
    .sort((a, b) => b.mil - b.was - (a.mil - a.was) || b.mil - a.mil)
    .map((c) => ({
      cat: c.cat,
      text: t('carnet.rising', { cat: categoryLabel(c.cat), now: tnd(c.mil), before: tnd(c.was) }),
    }));
  const biggest = [...thisPeriod].find(([cat]) => cat !== 'loyer');

  /* ── simulations: the pace is this period's average day of variable spending, in 5 TND steps ── */
  const pace = spendPace(live, period, today);
  const endDay = Number(period.end.slice(8));
  const simulations: Record<string, string> = {};
  if (pace > 0) {
    const rest = facts.left - pace * MIL_PER_TND * daysLeft;
    simulations[`si_${pace}_par_jour_jusqu_au_${endDay}`] =
      rest >= 0
        ? t('carnet.sim.left', { amount: tnd(rest), day: endDay })
        : t('carnet.sim.short', { amount: tnd(-rest), day: endDay });
  }
  if (goal && eta && saved < goal.target_mil) {
    for (const extra of [50, 100]) {
      const sooner = goalEta(goal.target_mil, saved, monthly + extra * MIL_PER_TND, today) as ISODate;
      const gain = monthIndex(eta) - monthIndex(sooner);
      if (gain > 0)
        simulations[`epargne_plus_${extra}_par_mois`] = t('carnet.sim.goal', {
          when: monthYear(sooner),
          n: gain,
        });
    }
  }
  const canDeposit =
    Math.floor(Math.min(facts.pots.wants.left, facts.left - pace * MIL_PER_TND * daysLeft) / 10_000) * 10;
  if (goal && pace > 0 && canDeposit >= 10)
    simulations.versement_possible_maintenant = t('carnet.sim.deposit', { amount: canDeposit, pace });

  /* ── a_signaler: at most one, the first whose key hasn't been shown ── */
  const nudges: { key: string; text: string }[] = [];
  for (const pot of ['needs', 'wants'] as const) {
    const p = facts.pots[pot];
    if (p.warn && p.left >= 0)
      nudges.push({
        key: `pot80:${period.start}:${pot}`,
        text: t('carnet.nudge.pot', { pot: t(`pot.${pot}`), pct: pct(p.ratio), days: days(daysLeft) }),
      });
  }
  for (const r of rising)
    nudges.push({
      key: `hausse:${period.start}:${r.cat}`,
      text: t('carnet.nudge.rising', { rising: r.text }),
    });
  if (isSavingsOpportunity({ left: facts.left, daysLeft, pace, hasGoal: Boolean(goal) }))
    nudges.push({
      key: `epargne:${period.start}`,
      text: t('carnet.nudge.save', { left: tnd(facts.left), days: days(daysLeft) }),
    });
  const nudge = nudges.find((n) => !input.nudgeSeen.includes(n.key)) ?? null;

  /* ── the last action, while it can still be undone ── */
  const last = input.lastAction;
  const lastRows = last && UNDOABLE[last.type] ? (input[UNDOABLE[last.type]] as { id: string }[]) : [];
  const lastRow = last ? lastRows.find((r) => r.id === last.ref) : undefined;
  const age = last ? now.getTime() - Date.parse(last.at) : NaN;
  const undoable = last && lastRow && age >= -CLOCK_SKEW_MS && age < UNDO_MS ? last : null;

  const carnet: Carnet = {
    aujourdhui: `${today} (${weekday(today)})`,
    calendrier: {
      hier: `${addDays(today, -1)} (${weekday(addDays(today, -1))})`,
      avant_hier: `${addDays(today, -2)} (${weekday(addDays(today, -2))})`,
      '7_derniers_jours': [1, 2, 3, 4, 5, 6, 7]
        .map((n) => addDays(today, -n))
        .map((d) => `${d} ${weekday(d)}`),
      '7_prochains_jours': [1, 2, 3, 4, 5, 6, 7]
        .map((n) => addDays(today, n))
        .map((d) => `${d} ${weekday(d)}`),
      fin_du_mois: period.end,
      prochaine_paie: nextPayday(today, profile.payday),
    },
    utilisateur: partner
      ? { prenom: clean(input.firstName, 40), mode: 'couple', partenaire: partnerName }
      : { prenom: clean(input.firstName, 40), mode: 'solo' },
    plan: {
      salaire: tnd(facts.salary),
      jour_de_paie:
        profile.payday === 0
          ? t('carnet.payday.last')
          : profile.payday === 1
            ? t('carnet.payday.first')
            : t('carnet.payday.day', { n: profile.payday }),
      repartition: `${facts.split.needs}/${facts.split.wants}/${facts.split.savings}`,
      jours_restants: daysLeft,
    },
    reste_a_depenser: { total: tnd(facts.left), par_jour: tnd(facts.perDay) },
    pots: {
      besoins: {
        ...potLine(facts.pots.needs),
        factures_a_venir_deja_deduites: tnd(facts.pots.needs.reserved),
      },
      envies: potLine(facts.pots.wants),
      epargne: {
        verse_ce_mois: tnd(savedThisPeriod),
        ...(goal && {
          objectif: clean(goal.name, 40),
          total: tnd(saved),
          cible: tnd(goal.target_mil),
          progression: `${Math.floor((saved / goal.target_mil) * 100)} %`,
          ...(eta ? { date_estimee: monthYear(eta) } : {}),
        }),
      },
    },
    a_venir: [
      ...facts.upcoming.flatMap((u) =>
        u.kind === 'bill'
          ? [
              {
                id: sid(u.id),
                type: 'facture' as const,
                label: clean(u.label),
                montant: tnd(u.amount_mil),
                echeance: u.due_on,
                dans: dueIn(u.due_on, today),
              },
            ]
          : [],
      ),
      ...debts.map((d) => ({
        id: sid(d.id),
        type: d.direction === 'owed_to_me' ? ('on_me_doit' as const) : ('dette' as const),
        personne: clean(d.person, 40),
        montant: tnd(d.amount_mil),
        ...(d.due_on
          ? { echeance: d.due_on, dans: dueIn(d.due_on, today) }
          : { depuis: days(daysBetween(dayOf(d.created_at), today)) }),
      })),
    ],
    factures_fixes: bills.map((b) => ({
      id: sid(b.id),
      label: clean(b.label),
      montant: tnd(b.amount_mil),
      frequence: b.frequency,
      jour: b.day,
    })),
    depenses_recentes: recent.map((e) => ({
      id: sid(e.id),
      date: e.spent_on,
      label: clean(e.label),
      categorie: e.category,
      pot: POT_NAME[e.pot],
      montant: tnd(e.amount_mil),
      ...(partner && { qui: e.user_id === profile.user_id ? 'moi' : partnerName }),
    })),
    par_categorie_ce_mois: [...thisPeriod].map(([categorie, mil]) => ({ categorie, montant: tnd(mil) })),
    tendances: {
      ...(total(before) > 0 && {
        vs_mois_dernier_a_meme_date: (() => {
          const change = pct((total(soFar) - total(before)) / total(before));
          return `${change > 0 ? '+' : ''}${change} %`;
        })(),
      }),
      ...(biggest && {
        plus_gros_poste_hors_loyer: t('carnet.biggest', { cat: biggest[0], amount: tnd(biggest[1]) }),
      }),
      mois_precedents: periodTotals(input.expenses, [prev, ...older]).map((p) => ({
        mois: month(p.period.label),
        total: tnd(p.needs + p.wants),
      })),
      ...(rising.length > 0 && { categorie_en_hausse: rising[0].text }),
    },
    simulations,
    rappels: reminders.map((r) => ({ id: sid(r.id), texte: clean(r.text, 120), date: dayOf(r.remind_at) })),
    ...(nudge && { a_signaler: nudge.text }),
    ...(undoable && {
      derniere_action: {
        type: undoable.type,
        ...(short.has(undoable.ref) && { id: short.get(undoable.ref) }),
        resume: clean(undoable.summary ?? describe(UNDOABLE[undoable.type], lastRow as Row), 80),
      },
    }),
  };
  return { carnet, refs, nudgeKey: nudge?.key ?? null };
}

/** Only my rows, and in couple mode the partner's shared ones (plan D1): a
 * partner's private row that reached the input anyway never reaches the model. */
function scoped(input: CarnetInput, partner: { user_id: string } | null): CarnetInput {
  const me = input.profile.user_id;
  const shared = (r: { user_id: string; household_id: string | null }) =>
    r.user_id === me || (partner !== null && r.user_id === partner.user_id && r.household_id !== null);
  const goals = input.goals.filter(shared);
  const homeGoals = new Set(goals.filter((g) => g.household_id !== null).map((g) => g.id));
  return {
    ...input,
    expenses: input.expenses.filter(shared),
    bills: input.bills.filter(shared),
    incomes: input.incomes.filter(shared),
    goals,
    savingsMoves: input.savingsMoves.filter(
      (m) => m.user_id === me || (partner !== null && homeGoals.has(m.goal_id)),
    ),
    debts: input.debts.filter((d) => d.user_id === me),
    reminders: input.reminders.filter((r) => r.user_id === me),
  };
}

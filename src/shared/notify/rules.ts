/* The notification rules engine (assistant spec §6): given one user's rows and
 * the time, which notifications are due now. Pure — the notify-run function
 * loads the rows, writes the rows this returns, and sends the pushes.
 *
 * - Every figure comes from the shared maths (facts, bills, payday, nudges).
 * - Quiet hours 21:00–08:00 Tunis hold everything but the user's own reminders;
 *   dedupe keys are per period or per week, so held items go out at 08:00.
 * - At most one capped notification per Tunis day, the highest priority first.
 * - `facts` holds already-formatted strings: the writer and the templates copy
 *   them, never compute. */
import { billDueDates } from '../bills';
import { categoryLabel, type CategoryKey } from '../categories';
import {
  addDays,
  daysBetween,
  isoWeek,
  payPeriod,
  periodsBack,
  todayTunis,
  type ISODate,
  type PayPeriod,
} from '../dates';
import { computeFacts, type Facts, type FactsInput } from '../facts';
import { shortDate } from '../format';
import { t } from '../i18n/t';
import { formatMoney, type Mil } from '../money';
import { isSavingsOpportunity, spendPace } from '../nudges';
import { activeGoal, dueDeposits, paydayId, paydayOpensAt, tunisInstant } from '../payday';
import type { Expense, Goal, NewSavingsMove, NotificationActionT, Reminder } from '../schemas';
import { TRIGGERS, isTrigger, type Trigger } from './triggers';

export interface UserSnapshot extends Omit<FactsInput, 'today'> {
  goals: Goal[];
  reminders: Reminder[];
}

export interface Candidate {
  trigger: Trigger;
  dedupeKey: string;
  facts: Record<string, string>;
  action: NotificationActionT | null;
  /** payday only: the goal deposit to write first (same id as the device's) */
  paydayDeposit?: NewSavingsMove;
}

/** A notification already written, as the cap and the dedupe see it. */
export interface Sent {
  trigger: string;
  dedupeKey: string;
}

const DAY_MS = 86_400_000;
const QUIET_FROM = 21;
const QUIET_UNTIL = 8;
const OWED_AFTER_DAYS = 10;
const QUIET_WEEK_DAYS = 3;
const REMINDER_WINDOW_MS = DAY_MS;
const BILL_AHEAD_DAYS = 3;
const SPIKE_FROM: Mil = 50_000;
/** this period ≥ 1.3 × the median, in integers: 10 × now ≥ 13 × median */
const SPIKE_NUM = 13;
const SPIKE_DEN = 10;
const RECAP_HOUR = 19;

const n = (mil: Mil) => formatMoney(mil, { unit: false });
const CLOCK = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Africa/Tunis',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const daysSince = (iso: string, now: Date) => Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
const isSunday = (d: ISODate) => new Date(`${d}T12:00:00Z`).getUTCDay() === 0;

interface Ctx {
  s: UserSnapshot;
  now: Date;
  today: ISODate;
  facts: Facts;
  live: Expense[];
}

export function evaluate(s: UserSnapshot, now: Date, sentToday: Sent[], sentKeys: Set<string>): Candidate[] {
  if (!s.profile.onboarded_at) return [];
  const today = todayTunis(now);
  const ctx: Ctx = {
    s,
    now,
    today,
    facts: computeFacts({ ...s, today }),
    live: s.expenses.filter((e) => e.deleted_at === null),
  };
  const quiet = now < tunisInstant(today, QUIET_UNTIL) || now >= tunisInstant(today, QUIET_FROM);
  const due = [
    ...payday(ctx),
    ...billsDue(ctx),
    ...reminders(ctx),
    ...pots(ctx),
    ...owed(ctx),
    ...spike(ctx),
    ...savings(ctx),
    ...recap(ctx),
    ...quietWeek(ctx),
  ].filter((c) => !sentKeys.has(c.dedupeKey) && (!quiet || c.trigger === 'user_reminder'));

  const capUsed = sentToday.some((x) => isTrigger(x.trigger) && TRIGGERS[x.trigger].capped);
  const capped = due
    .filter((c) => TRIGGERS[c.trigger].capped)
    .sort((a, b) => TRIGGERS[a.trigger].priority - TRIGGERS[b.trigger].priority);
  return [...due.filter((c) => !TRIGGERS[c.trigger].capped), ...(capUsed ? [] : capped.slice(0, 1))];
}

const PAYDAY_CATCH_UP_DAYS = 2;

function payday({ s, now, today, facts }: Ctx): Candidate[] {
  const { period, pots } = facts;
  const onboardedOn = todayTunis(new Date(s.profile.onboarded_at as string));
  /* on payday from 08:00; if every run failed that day (an outage), within the
     next two days — the dedupe key is per period, so it is written once */
  const late = daysBetween(period.start, today);
  if (late > PAYDAY_CATCH_UP_DAYS || now < new Date(paydayOpensAt(period)) || onboardedOn >= period.start)
    return [];
  const goal = activeGoal(s.goals);
  const id = paydayId(s.profile.user_id, period.start);
  const deposit = dueDeposits({ profile: s.profile, goal, moves: s.savingsMoves, now }).find(
    (m) => m.id === id,
  );
  return [
    {
      trigger: 'payday',
      dedupeKey: `payday:${period.start}`,
      facts: {
        salaire: n(facts.salary),
        besoins: n(pots.needs.budget),
        envies: n(pots.wants.budget),
        epargne: n(pots.savings.budget),
        ...(goal && { objectif: goal.name }),
      },
      action: null,
      ...(deposit && { paydayDeposit: deposit }),
    },
  ];
}

function billsDue({ s, today, facts, live }: Ctx): Candidate[] {
  const liveIds = new Set(live.map((e) => e.id));
  const next = payPeriod(addDays(facts.period.end, 1), s.profile.payday);
  const out: Candidate[] = [];
  for (const bill of s.bills.filter((b) => b.active)) {
    for (const period of [facts.period, next]) {
      const paid = s.billPayments.some(
        (p) =>
          p.bill_id === bill.id &&
          p.period_start === period.start &&
          p.expense_id !== null &&
          liveIds.has(p.expense_id),
      );
      if (paid) continue;
      for (const dueOn of billDueDates(bill, period)) {
        const ahead = dueOn === today ? 0 : dueOn === addDays(today, BILL_AHEAD_DAYS) ? BILL_AHEAD_DAYS : -1;
        if (ahead < 0) continue;
        out.push({
          trigger: 'bill_due',
          dedupeKey: `bill:${bill.id}:${dueOn}:d${ahead}`,
          facts: {
            facture: bill.label,
            montant: n(bill.amount_mil),
            date: shortDate(dueOn),
            jours: String(ahead),
          },
          /* the pay path records this period's payment: offer it only for this period's due dates */
          action: period === facts.period ? { kind: 'pay_bill', ref: bill.id } : null,
        });
      }
    }
  }
  return out;
}

function reminders({ s, now }: Ctx): Candidate[] {
  return s.reminders
    .filter((r) => r.done_at === null && r.deleted_at === null)
    .filter((r) => {
      const at = Date.parse(r.remind_at);
      return at <= now.getTime() && at > now.getTime() - REMINDER_WINDOW_MS;
    })
    .map((r) => ({
      trigger: 'user_reminder',
      dedupeKey: `reminder:${r.id}`,
      facts: { texte: r.text, heure: CLOCK.format(new Date(r.remind_at)) },
      action: null,
    }));
}

function pots({ facts }: Ctx): Candidate[] {
  const out: Candidate[] = [];
  for (const pot of ['needs', 'wants'] as const) {
    const p = facts.pots[pot];
    const common = { action: { kind: 'open_pot', ref: pot } as const, jours: String(facts.daysLeft) };
    if (p.left < 0)
      out.push({
        trigger: 'pot_over',
        dedupeKey: `potover:${facts.period.start}:${pot}`,
        facts: { pot: t(`pot.${pot}`), depasse: n(-p.left), jours: common.jours },
        action: common.action,
      });
    else if (p.warn)
      out.push({
        trigger: 'pot_near',
        dedupeKey: `pot80:${facts.period.start}:${pot}`,
        facts: {
          pot: t(`pot.${pot}`),
          pourcent: String(Math.round(p.ratio * 100)),
          reste: n(p.left),
          jours: common.jours,
        },
        action: common.action,
      });
  }
  return out;
}

function owed({ s, now, today }: Ctx): Candidate[] {
  return s.debts
    .filter((d) => d.direction === 'owed_to_me' && d.settled_at === null && d.deleted_at === null)
    .filter((d) => now.getTime() - Date.parse(d.created_at) > OWED_AFTER_DAYS * DAY_MS)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((d) => ({
      trigger: 'owed_to_me',
      dedupeKey: `owed:${d.id}:${isoWeek(today)}`,
      facts: { personne: d.person, montant: n(d.amount_mil), jours: String(daysSince(d.created_at, now)) },
      action: { kind: 'remind_debt', ref: d.id },
    }));
}

function byCategory(expenses: Expense[], period: PayPeriod): Map<CategoryKey, Mil> {
  const out = new Map<CategoryKey, Mil>();
  for (const e of expenses)
    if (e.spent_on >= period.start && e.spent_on <= period.end)
      out.set(e.category, (out.get(e.category) ?? 0) + e.amount_mil);
  return out;
}

function spike({ s, today, live }: Ctx): Candidate[] {
  const [current, ...before] = periodsBack(today, s.profile.payday, 4);
  const now = byCategory(live, current);
  const past = before.map((p) => byCategory(live, p));
  const spikes = [...now]
    .map(([cat, mil]) => {
      const [, median] = past.map((m) => m.get(cat) ?? 0).sort((a, b) => a - b);
      return { cat, mil, median };
    })
    .filter((c) => c.mil >= SPIKE_FROM && c.median > 0 && c.mil * SPIKE_DEN >= c.median * SPIKE_NUM)
    .sort((a, b) => b.mil - b.median - (a.mil - a.median));
  if (!spikes.length) return [];
  const { cat, mil, median } = spikes[0];
  return [
    {
      trigger: 'category_spike',
      dedupeKey: `spike:${isoWeek(today)}`,
      facts: { categorie: categoryLabel(cat), montant: n(mil), habituel: n(median) },
      action: { kind: 'open_category', ref: cat },
    },
  ];
}

function savings({ s, today, facts }: Ctx): Candidate[] {
  const pace = spendPace(s.expenses, facts.period, today);
  const hasGoal = Boolean(activeGoal(s.goals));
  if (!isSavingsOpportunity({ left: facts.left, daysLeft: facts.daysLeft, pace, hasGoal })) return [];
  return [
    {
      trigger: 'savings_opportunity',
      dedupeKey: `savings:${facts.period.start}`,
      facts: { reste: n(facts.left), jours: String(facts.daysLeft) },
      action: { kind: 'open_goal' },
    },
  ];
}

function recap({ now, today, live }: Ctx): Candidate[] {
  if (!isSunday(today) || now < tunisInstant(today, RECAP_HOUR)) return [];
  const week = live.filter((e) => e.spent_on >= addDays(today, -6) && e.spent_on <= today);
  if (!week.length) return [];
  const byCat = new Map<CategoryKey, Mil>();
  for (const e of week) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount_mil);
  const top = [...byCat]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cat]) => categoryLabel(cat));
  return [
    {
      trigger: 'weekly_recap',
      dedupeKey: `recap:${isoWeek(today)}`,
      facts: {
        total: n(week.reduce((sum, e) => sum + e.amount_mil, 0)),
        top: top.join(` ${t('notify.and')} `),
      },
      action: { kind: 'open_history' },
    },
  ];
}

function quietWeek({ s, now, today, live }: Ctx): Candidate[] {
  const onboarded = s.profile.onboarded_at as string;
  /* the nudge is about my own logging: a partner's shared rows don't count */
  const newest = live
    .filter((e) => e.user_id === s.profile.user_id)
    .reduce<string | null>((m, e) => (m === null || e.created_at > m ? e.created_at : m), null);
  const since = newest ?? onboarded;
  const limit = QUIET_WEEK_DAYS * DAY_MS;
  if (now.getTime() - Date.parse(onboarded) <= limit || now.getTime() - Date.parse(since) <= limit) return [];
  return [
    {
      trigger: 'quiet_week',
      dedupeKey: `quiet:${isoWeek(today)}`,
      facts: { jours: String(daysSince(since, now)) },
      action: { kind: 'log_expense' },
    },
  ];
}

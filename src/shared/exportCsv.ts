/* The export (plan D3): one CSV Excel opens as is. UTF-8 with a BOM, `;`
 * between cells, CRLF lines, amounts as `12,500`. Expenses, incomes and
 * savings moves are one row each, in date order; the bills and debts follow
 * as their own sections. Text cells can never start a formula. */
import { categoryLabel } from './categories';
import { payPeriod, periodsBack, todayTunis, type ISODate, type Payday } from './dates';
import { t, type StringKey } from './i18n/t';
import { MIL_PER_TND, type Mil } from './money';
import type { Bill, Debt, Expense, Goal, Income, SavingsMove } from './schemas';

export interface ExportInput {
  expenses: Expense[];
  incomes: Income[];
  savingsMoves: SavingsMove[];
  bills: Bill[];
  debts: Debt[];
  goals: Goal[];
}
/** `from` null = since the first row */
export interface ExportRange {
  from: ISODate | null;
  to: ISODate;
}
export type ExportChoice = 'month' | 'year' | 'all';
export const EXPORT_CHOICES: ExportChoice[] = ['month', 'year', 'all'];

const BOM = '﻿';
const SEP = ';';
const EOL = '\r\n';

/** 12 500 millimes → "12,500"; negative amounts keep their sign. */
export function csvMoney(mil: Mil): string {
  const abs = Math.abs(mil);
  const tnd = Math.trunc(abs / MIL_PER_TND);
  const rest = String(abs % MIL_PER_TND).padStart(3, '0');
  return `${mil < 0 ? '-' : ''}${tnd},${rest}`;
}

/** A text cell: a formula start gets a leading `'`, then `;`, `"` or a line
 * break puts the cell in quotes (Review Focus 4). */
export function csvCell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const line = (cells: string[]) => cells.join(SEP);
const inRange = (d: ISODate, r: ExportRange) => (r.from === null || d >= r.from) && d <= r.to;
const potName = (pot: 'needs' | 'wants' | 'savings') => t(`pot.${pot}`);

interface Dated {
  date: ISODate;
  cells: string[];
}

function datedRows(input: ExportInput, range: ExportRange): Dated[] {
  const goalName = new Map(input.goals.map((g) => [g.id, g.name]));
  const rows: Dated[] = [];
  for (const e of input.expenses) {
    if (e.deleted_at !== null || !inRange(e.spent_on, range)) continue;
    const cells = [t('export.type.expense'), potName(e.pot), categoryLabel(e.category), e.label];
    rows.push({ date: e.spent_on, cells: [...cells.map(csvCell), csvMoney(-e.amount_mil)] });
  }
  for (const i of input.incomes) {
    if (i.deleted_at !== null || !inRange(i.received_on, range)) continue;
    const cells = [t('export.type.income'), potName(i.pot), '', i.label];
    rows.push({ date: i.received_on, cells: [...cells.map(csvCell), csvMoney(i.amount_mil)] });
  }
  for (const m of input.savingsMoves) {
    if (!inRange(m.occurred_on, range)) continue;
    const cells = [t(`export.type.${m.kind}`), potName('savings'), goalName.get(m.goal_id) ?? '', ''];
    rows.push({ date: m.occurred_on, cells: [...cells.map(csvCell), csvMoney(m.amount_mil)] });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function toCsv(input: ExportInput, range: ExportRange): string {
  const out = [
    line(
      ['date', 'type', 'pot', 'category', 'label', 'amount'].map((c) => t(`export.col.${c}` as StringKey)),
    ),
    ...datedRows(input, range).map((r) => line([r.date, ...r.cells])),
  ];

  const bills = input.bills.filter((b) => b.active);
  if (bills.length) {
    out.push('', csvCell(t('export.bills')));
    out.push(line(['label', 'amount', 'frequency', 'day'].map((c) => t(`export.col.${c}` as StringKey))));
    for (const b of bills)
      out.push(
        line([csvCell(b.label), csvMoney(b.amount_mil), t(`me.bill.freq.${b.frequency}`), String(b.day)]),
      );
  }

  const debts = input.debts.filter((d) => d.deleted_at === null);
  if (debts.length) {
    out.push('', csvCell(t('export.debts')));
    out.push(
      line(
        ['person', 'direction', 'amount', 'due', 'note', 'settled'].map((c) =>
          t(`export.col.${c}` as StringKey),
        ),
      ),
    );
    for (const d of debts)
      out.push(
        line([
          csvCell(d.person),
          t(`export.debt.${d.direction}`),
          csvMoney(d.amount_mil),
          d.due_on ?? '',
          csvCell(d.note),
          d.settled_at ? todayTunis(new Date(d.settled_at)) : '',
        ]),
      );
  }
  return BOM + out.join(EOL) + EOL;
}

/** What the period chip announces: the dated rows and what was spent. */
export function exportSummary(input: ExportInput, range: ExportRange): { lines: number; spentMil: Mil } {
  const spentMil = input.expenses
    .filter((e) => e.deleted_at === null && inRange(e.spent_on, range))
    .reduce((sum, e) => sum + e.amount_mil, 0);
  return { lines: datedRows(input, range).length, spentMil };
}

/** Ce mois = the pay period; 12 derniers mois = it and the 11 before; Tout = no start. */
export function exportRange(choice: ExportChoice, today: ISODate, payday: Payday): ExportRange {
  const to = payPeriod(today, payday).end;
  if (choice === 'all') return { from: null, to };
  const periods = periodsBack(today, payday, choice === 'month' ? 1 : 12);
  return { from: periods[periods.length - 1].start, to };
}

/** stouchi-<from>-<to>.csv; with no start, from the oldest row exported. */
export function exportFileName(range: ExportRange, input: ExportInput): string {
  const dates = [
    ...input.expenses.map((e) => e.spent_on),
    ...input.incomes.map((i) => i.received_on),
    ...input.savingsMoves.map((m) => m.occurred_on),
  ].sort();
  const from = range.from ?? dates[0] ?? range.to;
  return `stouchi-${from}-${range.to}.csv`;
}

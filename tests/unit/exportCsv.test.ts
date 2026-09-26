import { describe, expect, it } from 'vitest';
import {
  csvCell,
  csvMoney,
  exportFileName,
  exportRange,
  exportSummary,
  toCsv,
  type ExportInput,
} from '../../src/shared/exportCsv';
import { bill, debt, expense, goal, income, move } from './fixtures';

const HEADER = 'Date;Type;Pot;Catégorie;Libellé;Montant (TND)';
const empty = (): ExportInput => ({
  expenses: [],
  incomes: [],
  savingsMoves: [],
  bills: [],
  debts: [],
  goals: [],
});
const ALL = { from: null, to: '2026-09-30' };
const lines = (csv: string) => csv.replace(/^﻿/, '').split('\r\n');

describe('csvMoney', () => {
  it('writes millimes as TND with a comma and three decimals', () => {
    expect(csvMoney(12_500)).toBe('12,500');
    expect(csvMoney(5)).toBe('0,005');
    expect(csvMoney(1_234_000)).toBe('1234,000');
    expect(csvMoney(-100_000)).toBe('-100,000');
    expect(csvMoney(0)).toBe('0,000');
  });
});

describe('csvCell (Review Focus 4)', () => {
  it('leaves plain text alone', () => {
    expect(csvCell('Carrefour')).toBe('Carrefour');
  });
  it('quotes a separator, a quote or a newline', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('le "bon"')).toBe('"le ""bon"""');
    expect(csvCell('deux\nlignes')).toBe('"deux\nlignes"');
    expect(csvCell('cr\rlf')).toBe('"cr\rlf"');
  });
  it('neutralises a formula start', () => {
    for (const c of ['=', '+', '-', '@', '\t']) expect(csvCell(`${c}1+1`)).toBe(`'${c}1+1`);
    expect(csvCell('=HYPERLINK("x";"y")')).toBe(`"'=HYPERLINK(""x"";""y"")"`);
  });
});

describe('toCsv', () => {
  it('starts with a BOM and the header, even when empty', () => {
    const csv = toCsv(empty(), ALL);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines(csv)[0]).toBe(HEADER);
    expect(lines(csv)[1]).toBe('');
  });

  it('writes expenses out, incomes in and moves as signed, in date order', () => {
    const g = goal({ name: 'Voiture' });
    const csv = toCsv(
      {
        ...empty(),
        goals: [g],
        expenses: [expense({ spent_on: '2026-09-12', amount_mil: 12_500, label: 'Carrefour' })],
        incomes: [income({ received_on: '2026-09-03', amount_mil: 150_000, label: 'Prime', pot: 'wants' })],
        savingsMoves: [
          move({ goal_id: g.id, occurred_on: '2026-09-05', kind: 'withdraw', amount_mil: -30_000 }),
          move({ goal_id: g.id, occurred_on: '2026-09-01', kind: 'payday', amount_mil: 200_000 }),
        ],
      },
      ALL,
    );
    expect(lines(csv).slice(1, 5)).toEqual([
      '2026-09-01;Épargne du mois;Épargne;Voiture;;200,000',
      '2026-09-03;Revenu;Envies;;Prime;150,000',
      '2026-09-05;Retrait;Épargne;Voiture;;-30,000',
      '2026-09-12;Dépense;Besoins;Courses;Carrefour;-12,500',
    ]);
  });

  it('keeps only the range, by Tunis date, edges included', () => {
    const csv = toCsv(
      {
        ...empty(),
        expenses: [
          expense({ spent_on: '2026-08-31', label: 'avant' }),
          expense({ spent_on: '2026-09-01', label: 'premier' }),
          expense({ spent_on: '2026-09-30', label: 'dernier' }),
          expense({ spent_on: '2026-10-01', label: 'après' }),
        ],
      },
      { from: '2026-09-01', to: '2026-09-30' },
    );
    expect(csv).toContain('premier');
    expect(csv).toContain('dernier');
    expect(csv).not.toContain('avant');
    expect(csv).not.toContain('après');
  });

  it('leaves deleted rows out', () => {
    const csv = toCsv(
      {
        ...empty(),
        expenses: [expense({ label: 'effacée', deleted_at: '2026-09-11T10:00:00+01:00' })],
        incomes: [income({ label: 'effacé', deleted_at: '2026-09-11T10:00:00+01:00' })],
        debts: [debt({ person: 'Effacé', deleted_at: '2026-09-11T10:00:00+01:00' })],
        bills: [bill({ label: 'Arrêtée', active: false })],
      },
      ALL,
    );
    expect(csv).not.toMatch(/effac|Effac|Arrêtée/);
  });

  it('neutralises a hostile label in a row', () => {
    const csv = toCsv({ ...empty(), expenses: [expense({ label: '=cmd|"/c calc";x' })] }, ALL);
    expect(lines(csv)[1]).toBe(`2026-09-10;Dépense;Besoins;Courses;"'=cmd|""/c calc"";x";-10,000`);
  });

  it('adds the bills and debts as their own sections', () => {
    const csv = toCsv(
      {
        ...empty(),
        bills: [bill({ label: 'STEG', amount_mil: 80_000, frequency: 'bimonthly', day: 15 })],
        debts: [
          debt({ person: 'Karim', amount_mil: 50_000, due_on: '2026-09-20', note: 'resto' }),
          debt({
            person: 'Sami',
            direction: 'owed_to_me',
            due_on: null,
            settled_at: '2026-09-02T23:30:00Z',
          }),
        ],
      },
      ALL,
    );
    const l = lines(csv);
    const at = l.indexOf('Factures fixes');
    expect(l.slice(at, at + 3)).toEqual([
      'Factures fixes',
      'Libellé;Montant (TND);Fréquence;Jour',
      'STEG;80,000;Tous les 2 mois;15',
    ]);
    const d = l.indexOf('Dettes');
    expect(l.slice(d, d + 4)).toEqual([
      'Dettes',
      'Personne;Sens;Montant (TND);Échéance;Note;Réglée le',
      'Karim;Je dois;50,000;2026-09-20;resto;',
      'Sami;On me doit;50,000;;;2026-09-03',
    ]);
  });
});

describe('exportSummary', () => {
  it('counts the dated rows in range and sums what was spent', () => {
    const input = {
      ...empty(),
      expenses: [
        expense({ amount_mil: 12_500 }),
        expense({ amount_mil: 7_500 }),
        expense({ amount_mil: 1, spent_on: '2026-01-01' }),
        expense({ amount_mil: 1, deleted_at: '2026-09-11T10:00:00+01:00' }),
      ],
      incomes: [income()],
      savingsMoves: [move()],
    };
    expect(exportSummary(input, { from: '2026-09-01', to: '2026-09-30' })).toEqual({
      lines: 4,
      spentMil: 20_000,
    });
  });
});

describe('exportRange', () => {
  it('Ce mois is the pay period', () => {
    expect(exportRange('month', '2026-09-10', 25)).toEqual({ from: '2026-08-25', to: '2026-09-24' });
  });
  it('12 derniers mois goes back eleven periods more', () => {
    expect(exportRange('year', '2026-09-10', 1)).toEqual({ from: '2025-10-01', to: '2026-09-30' });
  });
  it('Tout has no start', () => {
    expect(exportRange('all', '2026-09-10', 1)).toEqual({ from: null, to: '2026-09-30' });
  });
});

describe('exportFileName', () => {
  it('names the file by its dates', () => {
    expect(exportFileName({ from: '2026-09-01', to: '2026-09-30' }, empty())).toBe(
      'stouchi-2026-09-01-2026-09-30.csv',
    );
  });
  it('with no start, uses the oldest row', () => {
    const input = { ...empty(), expenses: [expense({ spent_on: '2025-03-04' })], incomes: [income()] };
    expect(exportFileName(ALL, input)).toBe('stouchi-2025-03-04-2026-09-30.csv');
    expect(exportFileName(ALL, empty())).toBe('stouchi-2026-09-30-2026-09-30.csv');
  });
});

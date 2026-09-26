import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { convertAll, type LegacyHousehold, type LegacyRow } from '../../../scripts/backfill/convert';
import { runBackfill, type Sink, type Source, type TableName } from '../../../scripts/backfill/run';
import { ALICE, HOUSEHOLDS, NOW, ROWS } from './fixtures';

function fakes(rows: LegacyRow[] = ROWS, households: LegacyHousehold[] = HOUSEHOLDS) {
  const writes: { table: TableName; n: number; onConflict: string }[] = [];
  const source: Source = {
    legacyRows: () => Promise.resolve(rows),
    households: () => Promise.resolve(households),
  };
  const sink: Sink = {
    upsert: (table, list, onConflict) => {
      writes.push({ table, n: list.length, onConflict });
      return Promise.resolve();
    },
  };
  return { source, sink, writes, outDir: mkdtempSync(join(tmpdir(), 'backfill-')) };
}

describe('runBackfill', () => {
  it('dry run: backs everything up and reports, writes nothing', async () => {
    const f = fakes();
    const r = await runBackfill({ ...f, apply: false, now: NOW });
    expect(f.writes).toEqual([]);
    expect(JSON.parse(readFileSync(r.backupFile, 'utf8'))).toEqual({ rows: ROWS, households: HOUSEHOLDS });
    const report = JSON.parse(readFileSync(r.reportFile, 'utf8')) as {
      report: { ok: boolean };
      counts: Record<string, number>;
    };
    expect(report.report.ok).toBe(true);
    expect(report.counts.expenses).toBe(5);
  });

  it('apply: writes in dependency order, profiles keyed on user_id, the rest on id', async () => {
    const f = fakes();
    await runBackfill({ ...f, apply: true, now: NOW });
    expect(f.writes.map((w) => [w.table, w.onConflict])).toEqual([
      ['profiles', 'user_id'],
      ['goals', 'id'],
      ['bills', 'id'],
      ['expenses', 'id'],
      ['savings_moves', 'id'],
      ['debts', 'id'],
    ]);
  });

  it('writes large tables in chunks of 500', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      id: `e${i}`,
      amount: 1,
      category: 'courses',
      date: '2026-09-01',
    }));
    const f = fakes(
      [{ user_id: ALICE, created_at: '2026-09-01T00:00:00Z', data: { settings: {}, expenses: many } }],
      [],
    );
    await runBackfill({ ...f, apply: true, now: NOW });
    expect(f.writes.filter((w) => w.table === 'expenses').map((w) => w.n)).toEqual([500, 500, 200]);
  });

  it('refuses to write anything when verification fails', async () => {
    const f = fakes();
    const lossy: typeof convertAll = (...args) => {
      const out = convertAll(...args);
      return { ...out, expenses: out.expenses.slice(1) };
    };
    await expect(runBackfill({ ...f, apply: true, now: NOW, convert: lossy })).rejects.toThrow(
      /verification failed/,
    );
    expect(f.writes).toEqual([]);
  });
});

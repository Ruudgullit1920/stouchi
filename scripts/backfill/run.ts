/* Spec §9 steps 1 and 3: back up every legacy row, convert, verify, and only
 * then — and only with --apply — upsert. I/O is injected so the flow is tested
 * without a database. Upserts on stable ids make a re-run a no-op. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertAll, type Converted, type LegacyHousehold, type LegacyRow } from './convert';
import { verify } from './verify';

export type TableName = 'profiles' | 'goals' | 'bills' | 'expenses' | 'savings_moves' | 'debts';
/** Parents before children: goals before savings_moves, bills before expenses. */
export const WRITE_ORDER: { table: TableName; onConflict: string }[] = [
  { table: 'profiles', onConflict: 'user_id' },
  { table: 'goals', onConflict: 'id' },
  { table: 'bills', onConflict: 'id' },
  { table: 'expenses', onConflict: 'id' },
  { table: 'savings_moves', onConflict: 'id' },
  { table: 'debts', onConflict: 'id' },
];
const CHUNK = 500;

export interface Source {
  legacyRows(): Promise<LegacyRow[]>;
  households(): Promise<LegacyHousehold[]>;
}
export interface Sink {
  upsert(table: TableName, rows: object[], onConflict: string): Promise<void>;
}
export interface RunOptions {
  source: Source;
  sink: Sink;
  outDir: string;
  apply: boolean;
  now: Date;
  /** test seam */
  convert?: typeof convertAll;
}

export async function runBackfill(o: RunOptions) {
  const rows = await o.source.legacyRows();
  const households = await o.source.households();
  mkdirSync(o.outDir, { recursive: true });
  const stamp = o.now.toISOString().replace(/[:.]/g, '-');
  const backupFile = join(o.outDir, `backup-${stamp}.json`);
  writeFileSync(backupFile, JSON.stringify({ rows, households }));

  const converted: Converted = (o.convert ?? convertAll)(rows, households, o.now);
  const report = verify(rows, households, converted);
  const counts = Object.fromEntries(WRITE_ORDER.map(({ table }) => [table, converted[table].length]));
  const reportFile = join(o.outDir, `report-${stamp}.json`);
  writeFileSync(reportFile, JSON.stringify({ counts, issues: converted.issues, report }, null, 1));

  if (o.apply) {
    if (!report.ok) {
      throw new Error(
        `verification failed (${report.mismatches.length} mismatches); nothing written — see ${reportFile}`,
      );
    }
    for (const { table, onConflict } of WRITE_ORDER) {
      const list = converted[table];
      for (let i = 0; i < list.length; i += CHUNK)
        await o.sink.upsert(table, list.slice(i, i + CHUNK), onConflict);
    }
  }
  return { backupFile, reportFile, converted, report };
}

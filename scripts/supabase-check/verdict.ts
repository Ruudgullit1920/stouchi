import type { SpecTable } from './tables';

export interface RlsRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
}
export type RoundTrip = 'ok' | 'read-only by design' | 'not run' | `failed: ${string}`;
export interface TableResult {
  table: SpecTable;
  reachable: boolean;
  rlsForced: boolean;
  roundTrip: RoundTrip;
}

export const rlsForced = (report: RlsRow[], table: SpecTable): boolean =>
  report.some((r) => r.table_name === table && r.rls_enabled && r.rls_forced);

export const passed = (r: TableResult): boolean =>
  r.reachable && r.rlsForced && (r.roundTrip === 'ok' || r.roundTrip === 'read-only by design');

export function formatResults(results: TableResult[]): string {
  const mark = (b: boolean) => (b ? '✓' : '✗');
  return results
    .map(
      (r) =>
        `${mark(passed(r))} ${r.table.padEnd(19)} reachable ${mark(r.reachable)}  RLS forced ${mark(r.rlsForced)}  round trip: ${r.roundTrip}`,
    )
    .join('\n');
}

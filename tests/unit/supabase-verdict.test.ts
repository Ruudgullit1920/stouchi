import { describe, expect, it } from 'vitest';
import {
  formatResults,
  passed,
  rlsForced,
  type RlsRow,
  type TableResult,
} from '../../scripts/supabase-check/verdict';

const report: RlsRow[] = [
  { table_name: 'profiles', rls_enabled: true, rls_forced: true },
  { table_name: 'households', rls_enabled: true, rls_forced: false },
];
const good: TableResult = { table: 'profiles', reachable: true, rlsForced: true, roundTrip: 'ok' };

describe('supabase verdict', () => {
  it('RLS counts only when enabled and forced, and the table is listed', () => {
    expect(rlsForced(report, 'profiles')).toBe(true);
    expect(rlsForced(report, 'households')).toBe(false);
    expect(rlsForced(report, 'goals')).toBe(false);
  });

  it('a table passes only when reachable, forced and its round trip worked (or is read-only by design)', () => {
    expect(passed(good)).toBe(true);
    expect(passed({ ...good, roundTrip: 'read-only by design' })).toBe(true);
    expect(passed({ ...good, roundTrip: 'failed: insert: permission denied' })).toBe(false);
    expect(passed({ ...good, roundTrip: 'not run' })).toBe(false);
    expect(passed({ ...good, reachable: false })).toBe(false);
    expect(passed({ ...good, rlsForced: false })).toBe(false);
  });

  it('prints one line per table, failures marked', () => {
    const text = formatResults([good, { ...good, table: 'goals', rlsForced: false }]);
    expect(text.split('\n')).toHaveLength(2);
    expect(text.split('\n')[1]).toMatch(/^✗ goals/);
  });
});

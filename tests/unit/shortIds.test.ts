import { describe, expect, it } from 'vitest';
import { shortIds } from '../../src/shared/shortIds';

const u = (hex8: string) => `${hex8}-0000-4000-8000-000000000000`;

describe('shortIds', () => {
  it('is the kind letter plus the first 4 hex characters when that is unique', () => {
    const ids = shortIds([
      { kind: 'e', id: u('0021aaaa') },
      { kind: 'e', id: u('0022bbbb') },
      { kind: 'b', id: u('a2000000') },
    ]);
    expect([...ids]).toEqual([
      ['e0021', u('0021aaaa')],
      ['e0022', u('0022bbbb')],
      ['ba200', u('a2000000')],
    ]);
  });

  it('two uuids sharing 4 hex characters get 5-character ids; the others stay at 4', () => {
    const ids = shortIds([
      { kind: 'e', id: u('abcd1000') },
      { kind: 'e', id: u('abcd2000') },
      { kind: 'e', id: u('0001ffff') },
    ]);
    expect([...ids.keys()]).toEqual(['eabcd1', 'eabcd2', 'e0001']);
  });

  it('only rows of the same kind compete: a bill and an expense may share a prefix', () => {
    const ids = shortIds([
      { kind: 'e', id: u('abcd1000') },
      { kind: 'b', id: u('abcd2000') },
    ]);
    expect([...ids.keys()]).toEqual(['eabcd', 'babcd']);
  });

  it('dashes are skipped: a prefix longer than 8 runs into the next group', () => {
    const ids = shortIds([
      { kind: 'd', id: '12345678-9abc-4000-8000-000000000000' },
      { kind: 'd', id: '12345678-9abd-4000-8000-000000000000' },
    ]);
    expect([...ids.keys()]).toEqual(['d123456789abc', 'd123456789abd']);
  });

  it('ids are identical across two builds when a new row is added', () => {
    const rows = [
      { kind: 'e' as const, id: u('0021aaaa') },
      { kind: 'r' as const, id: u('c1000000') },
    ];
    const before = shortIds(rows);
    const after = shortIds([...rows, { kind: 'e', id: u('0099cccc') }]);
    for (const [short, id] of before) expect(after.get(short)).toBe(id);
  });

  it('upper-case uuids give the same ids', () => {
    expect([...shortIds([{ kind: 'e', id: u('ABCD1000') }]).keys()]).toEqual(['eabcd']);
  });
});

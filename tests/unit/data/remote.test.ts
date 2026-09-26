import { describe, expect, it } from 'vitest';
import { afterRow, classify } from '../../../src/data/remote';

describe('classify', () => {
  it('sorts Supabase failures into retry, refuse and re-login', () => {
    expect(classify({ code: '' }, 0)).toBe('network');
    expect(classify({ code: '' }, 503)).toBe('server');
    expect(classify({ code: 'PGRST301' }, 401)).toBe('auth');
    expect(classify({ code: '' }, 401)).toBe('auth');
    expect(classify({ code: '23514' }, 400)).toBe('invalid');
    expect(classify({ code: '22P02' }, 400)).toBe('invalid');
    expect(classify({ code: '42501' }, 403)).toBe('invalid');
    expect(classify({ code: 'PGRST204' }, 400)).toBe('invalid');
  });
});

describe('afterRow', () => {
  it('pages on (cursor column, key) so rows sharing a timestamp are neither skipped nor repeated', () => {
    expect(afterRow('updated_at', 'id', { updated_at: '2026-09-10T10:00:00.5+00:00', id: 'a1' })).toBe(
      'updated_at.gt."2026-09-10T10:00:00.5+00:00",and(updated_at.eq."2026-09-10T10:00:00.5+00:00",id.gt."a1")',
    );
  });
});

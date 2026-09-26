/* The first-load JS gate (spec §8.4, Phase 7 Task 2): only what index.html
 * loads before anything is clicked — the entry and its static imports, never
 * the lazy chunks (chat, onboarding, Notifications). */
import { describe, expect, it } from 'vitest';
import { firstLoadFiles, MAX_BYTES, overBudget } from '../../../scripts/check-size';

const manifest = {
  'index.html': {
    file: 'assets/index-a.js',
    isEntry: true,
    imports: ['_supabase-b.js'],
    css: ['assets/index.css'],
  },
  '_supabase-b.js': { file: 'assets/supabase-b.js', imports: ['_shared-c.js'] },
  '_shared-c.js': { file: 'assets/shared-c.js' },
  'src/features/chat/ChatSheet.tsx': {
    file: 'assets/chat-d.js',
    isDynamicEntry: true,
    imports: ['_shared-c.js'],
  },
  '_lazy-only-e.js': { file: 'assets/lazy-only-e.js' },
};

describe('firstLoadFiles', () => {
  it("walks the entry's static imports once each, and nothing lazy", () => {
    expect(firstLoadFiles(manifest).sort()).toEqual([
      'assets/index-a.js',
      'assets/shared-c.js',
      'assets/supabase-b.js',
    ]);
  });

  it('fails loudly with no entry', () => {
    expect(() => firstLoadFiles({ '_x.js': { file: 'assets/x.js' } })).toThrow(/entry/);
  });
});

describe('overBudget', () => {
  it('passes at exactly 150 kB and fails one byte over', () => {
    expect(MAX_BYTES).toBe(150_000);
    expect(overBudget(150_000)).toBe(false);
    expect(overBudget(150_001)).toBe(true);
  });
});

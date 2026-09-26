import { describe, expect, it } from 'vitest';
import { gate, markIntroSeen, readIntroSeen, type GateInput } from '../../../src/app/gate';
import { profile } from '../fixtures';

const base: GateInput = {
  signedIn: false,
  sessionLost: false,
  profile: null,
  loading: false,
  introSeen: false,
  route: 'budget',
};
const g = (over: Partial<GateInput>) => gate({ ...base, ...over });

describe('gate', () => {
  it('sends a signed-out first visit to the intro, then to login', () => {
    expect(g({})).toBe('intro');
    expect(g({ introSeen: true })).toBe('login');
    expect(g({ route: 'login' })).toBe('login');
    expect(g({ introSeen: true, route: 'intro' })).toBe('intro');
  });

  it('waits for the first load before deciding a signed-in user has no profile', () => {
    expect(g({ signedIn: true, loading: true })).toBe('loading');
    expect(g({ signedIn: true })).toBe('setup');
  });

  it('keeps a user who has not finished setup in setup', () => {
    const fresh = profile({ onboarded_at: null, salary_mil: 0 });
    expect(g({ signedIn: true, profile: fresh })).toBe('setup');
    expect(g({ signedIn: true, profile: fresh, route: 'reveal' })).toBe('setup');
    expect(g({ signedIn: true, profile: fresh, route: 'budget' })).toBe('setup');
  });

  it('shows the reveal at the end of setup, and keeps it once onboarded_at is set', () => {
    const answered = profile({ onboarded_at: null });
    expect(g({ signedIn: true, profile: answered, route: 'reveal' })).toBe('reveal');
    expect(g({ signedIn: true, profile: profile(), route: 'reveal' })).toBe('reveal');
  });

  it('opens the app for an onboarded user, whatever first-run place is asked', () => {
    for (const route of ['budget', 'login', 'intro', 'setup'] as const)
      expect(g({ signedIn: true, profile: profile(), route })).toBe('app');
  });
});

describe('gate — session lost', () => {
  it('keeps the app open, and shows login only when asked', () => {
    const on = { signedIn: true, sessionLost: true, profile: profile() };
    expect(g(on)).toBe('app');
    expect(g({ ...on, route: 'login' })).toBe('login');
  });
});

describe('introSeen', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };
  it('is remembered', () => {
    const s = memory();
    expect(readIntroSeen(s)).toBe(false);
    markIntroSeen(s);
    expect(readIntroSeen(s)).toBe(true);
  });
  it('treats blocked storage as not seen, without throwing', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readIntroSeen(blocked)).toBe(false);
    expect(() => markIntroSeen(blocked)).not.toThrow();
  });
});

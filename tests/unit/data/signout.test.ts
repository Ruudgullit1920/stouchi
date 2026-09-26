// @vitest-environment jsdom
/* Review Focus 5: sign-out ends push on this device before the session ends. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { USER } from '../fixtures';

const steps: string[] = [];

vi.mock('../../../src/data/supabase', () => {
  const chain = {
    delete: () => chain,
    eq: () => chain,
    then: (resolve: (v: { error: null }) => void) => {
      steps.push('delete row');
      resolve({ error: null });
    },
  };
  const client = {
    from: () => chain,
    auth: {
      signOut: () => {
        steps.push('end session');
        return Promise.resolve({ error: null });
      },
    },
  };
  return { supabase: () => client };
});

afterEach(() => vi.unstubAllGlobals());

describe('signOut', () => {
  it('unsubscribes and deletes the row, then ends the session', async () => {
    const sub = {
      endpoint: 'https://push.example/device-1',
      unsubscribe: () => {
        steps.push('unsubscribe');
        return Promise.resolve(true);
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: () =>
          Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(sub) } }),
      },
    });
    const { signOut, store } = await import('../../../src/data/app');
    store.userId.value = USER;
    await signOut();
    expect(steps).toEqual(['unsubscribe', 'delete row', 'end session']);
  });
});

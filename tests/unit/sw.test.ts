/* public/sw.js in a small harness: fake self, clients and registration. */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Listener = (e: unknown) => void;

function loadWorker(windows: { focus: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }[]) {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(),
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim: vi.fn(() => Promise.resolve()),
      matchAll: vi.fn(() => Promise.resolve(windows)),
      openWindow: vi.fn((url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      }),
    },
  };
  runInNewContext(readFileSync('src/public/sw.js', 'utf8'), { self });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  return { listeners, shown, opened, fire };
}

const pushEvent = (payload: unknown) => ({ data: { json: () => payload } });

describe('sw.js', () => {
  it('has no fetch handler (caching waits for Phase 7)', () => {
    expect(loadWorker([]).listeners.has('fetch')).toBe(false);
  });

  it('push shows the title and body with tag = id, then tells open pages', async () => {
    const win = { focus: vi.fn(), postMessage: vi.fn() };
    const w = loadWorker([win]);
    await w.fire('push', pushEvent({ id: 'n1', title: 'Envies à 85 %', body: 'Il te reste 40 TND.' }));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe('Envies à 85 %');
    expect(w.shown[0].options).toMatchObject({ body: 'Il te reste 40 TND.', tag: 'n1', data: { id: 'n1' } });
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'notify', id: 'n1' });
  });

  it('a push with a broken payload still shows something (iOS requires it)', async () => {
    const w = loadWorker([]);
    await w.fire('push', {
      data: {
        json: () => {
          throw new Error('bad');
        },
      },
    });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].title).toBe('Stouchi');
  });

  it('a click focuses an open page and hands it the id', async () => {
    const win = { focus: vi.fn(() => Promise.resolve()), postMessage: vi.fn() };
    const w = loadWorker([win]);
    const close = vi.fn();
    await w.fire('notificationclick', { notification: { data: { id: 'n1' }, close } });
    expect(close).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'open', id: 'n1' });
    expect(w.opened).toEqual([]);
  });

  it('with no page open, a click opens the Notifications screen on that row', async () => {
    const w = loadWorker([]);
    await w.fire('notificationclick', { notification: { data: { id: 'n1' }, close: vi.fn() } });
    expect(w.opened).toEqual(['/#/notifications/n1']);
  });
});

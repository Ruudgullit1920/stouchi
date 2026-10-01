/* public/sw.js in a small harness: fake self, clients, registration, caches
 * and network. The worker runs as the build writes it (scripts/sw-inject). */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { injectSw } from '../../scripts/sw-inject';

type Listener = (e: unknown) => void;
/* vary: the response carries a Vary header (Vite preview sends Vary: Origin),
   so a lookup matches it only with ignoreVary */
type Res = {
  ok: boolean;
  body: string;
  vary?: boolean;
  redirected?: boolean;
  headers: { get: (name: string) => string | null };
  clone: () => Res;
  blob: () => Promise<string>;
};
const ORIGIN = 'https://stouchi.test';
/* a body that starts with <html is the app's page (text/html), anything else a file */
const typeOf = (body: string) => (body.startsWith('<html') ? 'text/html; charset=utf-8' : 'image/webp');
const headersOf = (body: string) => ({
  get: (name: string) => (name.toLowerCase() === 'content-type' ? typeOf(body) : null),
});
const res = (body: string, ok = true, vary = false, redirected = false): Res => ({
  ok,
  body,
  vary,
  redirected,
  headers: headersOf(body),
  clone: () => res(body, ok, vary, redirected),
  blob: () => Promise.resolve(body),
});
/* the worker rebuilds a redirected response with `new Response(blob, init)` */
class FakeResponse {
  ok: boolean;
  redirected = false;
  headers: Res['headers'];
  constructor(
    public body: string,
    init: { status?: number; headers?: Res['headers'] } = {},
  ) {
    this.ok = (init.status ?? 200) < 400;
    this.headers = init.headers ?? headersOf(body);
  }
}
/* a url whose network answer went through a redirect (Pages: /index.html → /) */
const REDIRECTED = '__redirected__:';
const HANG = '__hang__';
const abs = (u: string | { url: string }) => new URL(typeof u === 'string' ? u : u.url, ORIGIN).href;

function loadWorker(
  windows: { focus: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> }[] = [],
  opts: { version?: string; precache?: string[]; caches?: Record<string, Record<string, Res>> } = {},
) {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  /* the network: a url → body, or offline when absent */
  const net = new Map<string, string>();
  /* the browser's HTTP cache: what a plain fetch gets, until cache: 'reload' */
  const httpCache = new Map<string, string>();
  const fetch = vi.fn((req: string | { url: string }, init?: { cache?: string }) => {
    const stale = init?.cache === 'reload' ? undefined : httpCache.get(abs(req));
    if (stale !== undefined) return Promise.resolve(res(stale));
    const body = net.get(abs(req));
    /* HANG: a connection that is up but never answers (weak Wi-Fi) */
    if (body === HANG) return new Promise<Res>(() => {});
    if (body?.startsWith(REDIRECTED))
      return Promise.resolve(res(body.slice(REDIRECTED.length), true, false, true));
    return body === undefined ? Promise.reject(new TypeError('offline')) : Promise.resolve(res(body));
  });
  const store = new Map<string, Map<string, Res>>(
    Object.entries(opts.caches ?? {}).map(([name, rows]) => [
      name,
      new Map(Object.entries(rows).map(([u, r]) => [abs(u), r])),
    ]),
  );
  const cacheApi = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const rows = store.get(name)!;
    return {
      addAll: async (urls: string[]) => {
        for (const u of urls) rows.set(abs(u), await fetch(u));
      },
      match: (req: string | { url: string }, options?: { ignoreVary?: boolean }) => {
        const hit = rows.get(abs(req));
        return Promise.resolve(hit && (!hit.vary || options?.ignoreVary) ? hit : undefined);
      },
      put: (req: string | { url: string }, r: Res) => {
        rows.set(abs(req), r);
        return Promise.resolve();
      },
    };
  };
  const caches = {
    open: (name: string) => Promise.resolve(cacheApi(name)),
    keys: () => Promise.resolve([...store.keys()]),
    delete: (name: string) => Promise.resolve(store.delete(name)),
    match: (req: string | { url: string }, options?: { ignoreVary?: boolean }) => {
      for (const rows of store.values()) {
        const hit = rows.get(abs(req));
        if (hit && (!hit.vary || options?.ignoreVary)) return Promise.resolve(hit);
      }
      return Promise.resolve(undefined);
    },
  };
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(),
    location: { origin: ORIGIN },
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
  const source = injectSw(
    readFileSync('src/public/sw.js', 'utf8'),
    opts.version ?? 'v1',
    opts.precache ?? [],
  );
  runInNewContext(source, { self, caches, fetch, URL, setTimeout, Response: FakeResponse });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  /** a fetch event: what the worker answers, or 'network' when it lets it through */
  const request = async (url: string, init: { mode?: string; method?: string } = {}) => {
    let answer: Promise<Res> | undefined;
    listeners.get('fetch')?.({
      request: { url: abs(url), mode: init.mode ?? 'cors', method: init.method ?? 'GET' },
      respondWith: (p: Promise<Res>) => (answer = p),
    });
    return answer ? await answer : 'network';
  };
  return { listeners, shown, opened, fire, request, net, httpCache, store, self, fetch };
}

const pushEvent = (payload: unknown) => ({ data: { json: () => payload } });

describe('sw.js — push', () => {
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

describe('sw.js — offline shell and updates (spec §8.3)', () => {
  const SHELL = ['/', '/assets/index-a.js'];

  it("install precaches this build's shell and waits: no skipWaiting", async () => {
    const w = loadWorker([], { version: 'v2', precache: SHELL });
    w.net.set(abs('/'), '<html>v2');
    w.net.set(abs('/assets/index-a.js'), 'js v2');
    await w.fire('install', {});
    expect([...w.store.get('stouchi-v2')!.keys()]).toEqual(SHELL.map(abs));
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });

  it('a shell the host answered through a redirect is stored as a plain response (Cloudflare Pages)', async () => {
    const w = loadWorker([], { version: 'v2', precache: SHELL });
    w.net.set(abs('/'), `${REDIRECTED}<html>v2`);
    w.net.set(abs('/assets/index-a.js'), 'js v2');
    await w.fire('install', {});
    const shell = w.store.get('stouchi-v2')!.get(abs('/')) as unknown as FakeResponse;
    expect(shell).toBeInstanceOf(FakeResponse);
    expect(shell).toMatchObject({ body: '<html>v2', redirected: false });
  });

  it('a failed precache fails the install, so a half-cached version never takes over', async () => {
    const w = loadWorker([], { version: 'v2', precache: SHELL });
    w.net.set(abs('/'), '<html>v2');
    await expect(w.fire('install', {})).rejects.toThrow();
  });

  it('activate keeps this version and the one before (an old window may still lazy-load from it), drops older ones', async () => {
    const w = loadWorker([], {
      version: 'v2',
      caches: { 'stouchi-v0': {}, 'stouchi-v1': {}, 'stouchi-v2': {}, other: {} },
    });
    await w.fire('activate', {});
    expect([...w.store.keys()].sort()).toEqual(['other', 'stouchi-v1', 'stouchi-v2']);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it('only the "Recharger" message makes a waiting worker take over', async () => {
    const w = loadWorker();
    await w.fire('message', { data: { type: 'other' } });
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    await w.fire('message', { data: { type: 'SKIP_WAITING' } });
    expect(w.self.skipWaiting).toHaveBeenCalledOnce();
  });

  it('a page load goes to the network first', async () => {
    const w = loadWorker([], { caches: { 'stouchi-v1': { '/': res('<html>old') } } });
    w.net.set(abs('/budget'), '<html>new');
    expect((await w.request('/budget', { mode: 'navigate' })) as Res).toMatchObject({ body: '<html>new' });
  });

  it('offline, a page load gets the cached shell', async () => {
    const w = loadWorker([], { caches: { 'stouchi-v1': { '/': res('<html>cached') } } });
    expect((await w.request('/', { mode: 'navigate' })) as Res).toMatchObject({ body: '<html>cached' });
  });

  it('offline, the shell of the running version wins over the one kept from before', async () => {
    const w = loadWorker([], {
      version: 'v2',
      caches: {
        'stouchi-v1': { '/': res('<html>v1') },
        'stouchi-v2': { '/': res('<html>v2') },
      },
    });
    expect((await w.request('/', { mode: 'navigate' })) as Res).toMatchObject({ body: '<html>v2' });
  });

  it('a page load that hangs falls back to the cached shell after 3 s (review m2)', async () => {
    vi.useFakeTimers();
    try {
      const w = loadWorker([], { caches: { 'stouchi-v1': { '/': res('<html>cached') } } });
      w.net.set(abs('/'), HANG);
      const answer = w.request('/', { mode: 'navigate' });
      await vi.advanceTimersByTimeAsync(3000);
      expect((await answer) as Res).toMatchObject({ body: '<html>cached' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('with no cached shell yet (first visit), a slow page load is waited for', async () => {
    vi.useFakeTimers();
    try {
      const w = loadWorker([]);
      w.net.set(abs('/'), '<html>net');
      const answer = w.request('/', { mode: 'navigate' });
      await vi.advanceTimersByTimeAsync(5000);
      expect((await answer) as Res).toMatchObject({ body: '<html>net' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a built asset comes from the cache, without the network', async () => {
    const w = loadWorker([], { caches: { 'stouchi-v1': { '/assets/index-a.js': res('js cached') } } });
    expect((await w.request('/assets/index-a.js')) as Res).toMatchObject({ body: 'js cached' });
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it('a cached asset stored with a Vary header still serves offline', async () => {
    const w = loadWorker([], {
      caches: { 'stouchi-v1': { '/assets/index-a.js': res('js cached', true, true) } },
    });
    expect((await w.request('/assets/index-a.js')) as Res).toMatchObject({ body: 'js cached' });
  });

  it('the offline shell is found even when stored with a Vary header', async () => {
    const w = loadWorker([], {
      caches: { 'stouchi-v1': { '/': res('<html>cached', true, true) } },
    });
    expect((await w.request('/', { mode: 'navigate' })) as Res).toMatchObject({ body: '<html>cached' });
  });

  it('an asset not cached yet is fetched once, then kept', async () => {
    const w = loadWorker([], { version: 'v1' });
    w.net.set(abs('/assets/chat-b.js'), 'chat');
    expect((await w.request('/assets/chat-b.js')) as Res).toMatchObject({ body: 'chat' });
    expect(w.store.get('stouchi-v1')?.has(abs('/assets/chat-b.js'))).toBe(true);
  });

  /* Cloudflare Pages answers a missing file with the app's page (200, text/html)
     and the year-long immutable header of /assets/*: mid-deploy, an icon asked
     of an edge that did not have it yet got the page, and kept it. */
  it("an asset answered with the app's page is fetched again past the HTTP cache, and only the file is kept", async () => {
    const w = loadWorker([], { version: 'v1' });
    w.httpCache.set(abs('/assets/fuel-a.webp'), '<html>app');
    w.net.set(abs('/assets/fuel-a.webp'), 'webp');
    expect((await w.request('/assets/fuel-a.webp')) as Res).toMatchObject({ body: 'webp' });
    expect(w.store.get('stouchi-v1')!.get(abs('/assets/fuel-a.webp'))).toMatchObject({ body: 'webp' });
  });

  it("the app's page is never kept as an asset", async () => {
    const w = loadWorker([], { version: 'v1' });
    w.net.set(abs('/assets/gone-a.webp'), '<html>app');
    expect((await w.request('/assets/gone-a.webp')) as Res).toMatchObject({ body: '<html>app' });
    expect(w.store.get('stouchi-v1')?.has(abs('/assets/gone-a.webp'))).toBeFalsy();
  });

  it('a page already cached as an asset (by an older version) is replaced by the file', async () => {
    const w = loadWorker([], {
      version: 'v2',
      caches: { 'stouchi-v1': { '/assets/fuel-a.webp': res('<html>app') }, 'stouchi-v2': {} },
    });
    w.net.set(abs('/assets/fuel-a.webp'), 'webp');
    expect((await w.request('/assets/fuel-a.webp')) as Res).toMatchObject({ body: 'webp' });
    w.fetch.mockClear();
    expect((await w.request('/assets/fuel-a.webp')) as Res).toMatchObject({ body: 'webp' });
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it("an asset answered with the app's page fails the install", async () => {
    const w = loadWorker([], { version: 'v2', precache: SHELL });
    w.net.set(abs('/'), '<html>v2');
    w.net.set(abs('/assets/index-a.js'), '<html>v2');
    await expect(w.fire('install', {})).rejects.toThrow();
  });

  it('never touches Supabase, the API or a write', async () => {
    const w = loadWorker();
    expect(await w.request('https://abcdefgh.supabase.co/rest/v1/expenses')).toBe('network');
    expect(await w.request('/api/aam', { method: 'POST' })).toBe('network');
    expect(await w.request('/api/aam')).toBe('network');
  });
});

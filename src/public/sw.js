/* Stouchi's service worker: web push (Phase 4), and the offline shell with
 * "Nouvelle version — Recharger" (Phase 7, spec §8.3). Registered by main.tsx in
 * production builds. The build fills the two marked lines (scripts/sw-inject). */

const VERSION = 'dev'; // __VERSION__
const PRECACHE = []; // __PRECACHE__
const CACHE = `stouchi-${VERSION}`;
/* the app shell's key: '/', which hosts serve as is (Cloudflare Pages
   redirects /index.html to /) */
const SHELL = '/';

/* A new version installs, then WAITS: the page offers "Recharger", and only that
   tap (SKIP_WAITING) lets it take over, so nothing reloads under the user. */
self.addEventListener('install', (event) => event.waitUntil(precache()));

/* Every file or none: a failed fetch fails the install, so a half-cached
   version never takes over. A response that came through a redirect is stored
   as a plain copy, because the browser refuses a redirected response as the
   answer to a page load. */
async function precache() {
  const cache = await caches.open(CACHE);
  const responses = await Promise.all(
    PRECACHE.map(async (path) => {
      const response = await fetch(path, { cache: 'reload' });
      if (!response.ok) throw new Error(`precache ${path}: ${response.status}`);
      if (path !== SHELL && isPage(response)) throw new Error(`precache ${path}: the app's page`);
      return [path, response.redirected ? await plain(response) : response];
    }),
  );
  for (const [path, response] of responses) await cache.put(path, response);
}

async function plain(response) {
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      /* keep the version before too: a window still on it may lazy-load a chunk
         that is gone from the server (caches.keys() lists oldest first) */
      const older = (await caches.keys()).filter((key) => key.startsWith('stouchi-') && key !== CACHE);
      for (const key of older.slice(0, -1)) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* Only this site's pages and built assets. Supabase, /api/* and writes always
   go to the network: data has its own offline path (the outbox, IndexedDB). */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(page(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) event.respondWith(fromCache(request));
});

/* Network first, but a connection that is up and never answers (weak Wi-Fi)
   gets the cached shell after 3 s instead of a white screen. A first visit,
   with nothing cached yet, waits for the network. */
async function page(request) {
  const network = fetch(request);
  /* this version's shell first: caches.match would find the older one first */
  const cached = (await (await caches.open(CACHE)).match(SHELL, MATCH)) || (await caches.match(SHELL, MATCH));
  if (!cached) return network;
  const slow = new Promise((resolve) => setTimeout(() => resolve(cached), 3000));
  return Promise.race([network.catch(() => cached), slow]);
}

/* Built assets are content-hashed: a cached copy is always the right one, so a
   Vary header (Vary: Origin from some servers) must not turn it into a miss.
   Cloudflare Pages answers a file it does not have (yet, mid-deploy) with the
   app's page, 200 and the year-long immutable header of /assets/*: that page is
   never an asset. Such a copy, in a cache or the HTTP cache, is fetched again. */
const MATCH = { ignoreVary: true };
const isPage = (response) => (response.headers.get('content-type') || '').startsWith('text/html');
async function fromCache(request) {
  /* this version's cache first: an older one may hold a page kept before this fix */
  const hit = (await (await caches.open(CACHE)).match(request, MATCH)) || (await caches.match(request, MATCH));
  if (hit && !isPage(hit)) return hit;
  let response = await fetch(request);
  if (isPage(response)) response = await fetch(request, { cache: 'reload' });
  if (response.ok && !isPage(response)) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

/* The payload is notify-run's payloadFor: { id, title, body }. Every push must
   show a notification (userVisibleOnly), so a broken one still shows the name. */
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = (event.data && event.data.json()) || {};
  } catch {
    msg = {};
  }
  const id = typeof msg.id === 'string' ? msg.id : undefined;
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(msg.title || 'Stouchi', {
        body: msg.body || '',
        tag: id,
        data: { id },
      });
      for (const client of await windows()) client.postMessage({ type: 'notify', id });
    })(),
  );
});

/* Focus an open page and hand it the id (it opens Notifications and marks the
   row read); with none open, open the screen on that row. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.id;
  event.waitUntil(
    (async () => {
      const [client] = await windows();
      if (client) {
        await client.focus();
        client.postMessage({ type: 'open', id });
        return;
      }
      await self.clients.openWindow(id ? `/#/notifications/${id}` : '/#/notifications');
    })(),
  );
});

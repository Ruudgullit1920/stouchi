/* Stouchi's service worker: web push (Phase 4), and the offline shell with
 * "Nouvelle version — Recharger" (Phase 7, spec §8.3). Registered by main.tsx in
 * production builds. The build fills the two marked lines (scripts/sw-inject). */

const VERSION = 'dev'; // __VERSION__
const PRECACHE = []; // __PRECACHE__
const CACHE = `stouchi-${VERSION}`;

/* A new version installs, then WAITS: the page offers "Recharger", and only that
   tap (SKIP_WAITING) lets it take over, so nothing reloads under the user. */
self.addEventListener('install', (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('stouchi-') && key !== CACHE) await caches.delete(key);
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
    event.respondWith(fetch(request).catch(() => caches.match('/index.html', MATCH)));
    return;
  }
  if (url.pathname.startsWith('/assets/')) event.respondWith(fromCache(request));
});

/* Built assets are content-hashed: a cached copy is always the right one, so a
   Vary header (Vary: Origin from some servers) must not turn it into a miss. */
const MATCH = { ignoreVary: true };
async function fromCache(request) {
  const hit = await caches.match(request, MATCH);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
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

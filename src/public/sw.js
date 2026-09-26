/* Stouchi's service worker (Phase 4): web push only. It has no fetch handler;
 * offline caching comes in Phase 7. Registered by main.tsx in production builds. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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

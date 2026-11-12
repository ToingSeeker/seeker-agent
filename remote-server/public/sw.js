// Service worker for SEEKER Remote: shows push notifications and opens the app
// on the right screen when one is tapped. It does not cache anything.
//
// A push arrives already decrypted by the browser — it was encrypted on the Mac
// for this device only, so neither the relay nor the push service can read it.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data.json();
  } catch {}
  // A notification must be shown for every push, or the browser withdraws the permission.
  event.waitUntil(
    self.registration.showNotification(data.title || 'SEEKER', {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        client.postMessage({ open: url });
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});

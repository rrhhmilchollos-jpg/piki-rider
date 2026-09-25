const CACHE = 'piki-riders-v4-google-maps';
const APP_SHELL = ['/', '/manifest.json', '/piki-icon-192.png', '/piki-icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Google Maps y la API siempre deben ir a red: contienen tiles, GPS y estados actuales.
  if (url.hostname === 'maps.googleapis.com' || url.hostname.endsWith('.googleapis.com') || url.hostname === 'api.pikidelivery.com') return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok && url.origin === self.location.origin) {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request)),
  );
});

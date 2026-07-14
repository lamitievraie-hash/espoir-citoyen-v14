// V15.2 FIX - NE CACHE PLUS INDEX.HTML
const CACHE_NAME = 'espoir-fix-login-v15-2';

self.addEventListener('install', event => {
  self.skipWaiting();
  console.log('SW V15.2 installé - cache nettoyé');
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        console.log('Suppression cache:', key);
        return caches.delete(key);
      }));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // IMPORTANT: Laisse toujours passer index.html et API sans cache
  if (event.request.url.includes('index.html') || event.request.url.includes('/api/') || event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/')));
    return;
  }
  
  // Pour le reste: network first
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

self.addEventListener('sync', event => {
  if (event.tag === 'sync-donnees') {
    event.waitUntil(console.log('Sync'));
  }
});

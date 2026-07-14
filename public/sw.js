const CACHE_NAME = 'espoir-citoyen-v15-1';
const urlsToCache = [
  '/',
  '/logo.png',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch : Cache First pour statique, Network First pour API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Pour les API : Network First + cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // On clone et met en cache
          const resClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          return response;
        })
        .catch(() => caches.match(event.request)) // Si offline, on sert le cache
    );
    return;
  }

  // Pour le reste : Cache First
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

// Background Sync : quand le réseau revient
self.addEventListener('sync', event => {
  if (event.tag === 'sync-donnees') {
    event.waitUntil(syncDonnees());
  }
});

async function syncDonnees() {
  // On récupère les données en attente dans IndexedDB et on les envoie
  console.log('Synchronisation en cours...');
}

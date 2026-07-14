const CACHE_NAME = 'espoir-citoyen-v15-0';
const urlsToCache = [
  '/',
  '/logo.png',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// Installation : on met en cache les fichiers de base
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache ouvert');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Activation : on nettoie les vieux caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Fetch : mode hors ligne
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      // Cache hit - on retourne la réponse
      if (response) {
        return response;
      }
      // Sinon on fait la requête réseau
      return fetch(event.request);
    })
  );
});

const CACHE_NAME = 'singlestep-kids-v4';

// Use specific versions to avoid compatibility issues
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js',
  'https://img.icons8.com/color/96/cleaner.png'
];

const LOCAL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

const ASSETS = [...CDN_ASSETS, ...LOCAL_ASSETS];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting(); // Force activation
});

// Network First strategy for local files (always get fresh content if available)
// Cache First for CDN assets (libraries rarely change)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isLocal = url.origin === location.origin;

  if (isLocal) {
    // Network First for local files
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          // Check if we received a valid response
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          // Clone the response
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // If network fails, try cache
          return caches.match(e.request);
        })
    );
  } else {
    // Cache First for CDN
    e.respondWith(
      caches.match(e.request).then((response) => {
        return response || fetch(e.request).then((response) => {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
                cache.put(e.request, responseToCache);
            });
            return response;
        });
      })
    );
  }
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim(); // Take control immediately
});
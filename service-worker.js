const CACHE_VERSION = '20260713-airing-sync3';
const SHELL_CACHE = `neoanimez-shell-${CACHE_VERSION}`;
const DATA_CACHE = `neoanimez-data-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './logo.png',
  './preview.png',
  './robots.txt',
  './sitemap.xml'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('neoanimez-') && key !== SHELL_CACHE && key !== DATA_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

function isSameOrigin(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isCatalogRequest(request) {
  if (!isSameOrigin(request)) return false;
  const url = new URL(request.url);
  return url.pathname.endsWith('/anime-index.json') ||
    url.pathname.endsWith('/anime-lista.json') ||
    url.pathname.endsWith('/anime-character-index.json') ||
    url.pathname.endsWith('/anime-upcoming.json') ||
    url.pathname.endsWith('/anime-schedule.json') ||
    url.pathname.endsWith('/anime-news.json') ||
    url.pathname.includes('/anime-details/') ||
    url.pathname.includes('/character-index/') ||
    url.pathname.includes('/character-details/');
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response?.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  if (request.cache === 'reload') return networkFirst(request, cacheName);

  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const refresh = fetch(request)
    .then(response => {
      if (response?.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || refresh;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response?.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    return cached || Promise.reject(error);
  }
}

async function navigationFallback(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    if (response?.ok) await cache.put('./index.html', response.clone());
    return response;
  } catch {
    const cached = await caches.match('./index.html');
    return cached || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationFallback(request));
    return;
  }

  if (isCatalogRequest(request)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  if (isSameOrigin(request)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

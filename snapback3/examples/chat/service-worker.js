/* Build replaces these two values from the exact emitted asset bytes. */
const VERSION = __SHELL_VERSION__;
const ASSETS = __SHELL_ASSETS__;
const PREFIX = `commonroom-shell:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const PATHS = new Set(ASSETS.map(asset => asset.url));

// @ref LLP 2000#writes-and-user-work — the application owns its offline shell;
// API responses and account data remain exclusively under SDK custody.
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(ASSETS.map(asset => new Request(asset.url, {
        cache: 'reload', integrity: asset.integrity,
      })));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  // No skipWaiting, claim, or forced reload: the old shell keeps serving until
  // its tabs have closed. Only activation may remove this app's older cache.
  event.waitUntil(caches.keys().then(names => Promise.all(names
    .filter(name => name.startsWith(PREFIX) && name !== CACHE)
    .map(name => caches.delete(name)))));
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const path = url.pathname === '/' && request.mode === 'navigate' ? '/index.html' : url.pathname;
  // This explicit allowlist never intercepts /api, authentication, mutations,
  // operation receipts or live streams, and never creates a runtime cache.
  if (!PATHS.has(path) || (url.search && request.mode !== 'navigate')) return;
  event.respondWith(caches.open(CACHE).then(async cache =>
    (await cache.match(path)) ?? fetch(request)));
});

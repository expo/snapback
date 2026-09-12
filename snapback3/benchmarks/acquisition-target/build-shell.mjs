import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.argv[2] ?? process.cwd();
const dist = join(root, 'dist');
const html = await readFile(join(dist, 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map(match => match[1])
  .filter(value => value.startsWith('/'));
const cache = ['/', '/index.html', ...new Set(assets)];
const content = createHash('sha256');
for (const path of cache) {
  content.update(path).update('\0');
  content.update(await readFile(join(dist, path === '/' ? 'index.html' : decodeURIComponent(path.slice(1))))).update('\0');
}
const cacheName = `snapback3-acquisition-target-${content.digest('hex').slice(0, 24)}`;
const source = `const CACHE = ${JSON.stringify(cacheName)};
const SHELL = ${JSON.stringify(cache)};
const SHELL_PATHS = new Set(SHELL);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const navigation = event.request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html');
  if (!navigation && !SHELL_PATHS.has(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(response => response || (navigation ? caches.match('/index.html') : undefined))));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'snapback3-acquisition-shell-version') {
    event.source?.postMessage({ type: 'snapback3-acquisition-shell-version', cacheName: CACHE });
  }
});
`;
await writeFile(join(dist, 'sw.js'), source);

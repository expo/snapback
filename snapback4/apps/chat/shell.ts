import { createHash } from "node:crypto";
import type { Plugin } from "vite";

// @ref LLP 3000.011.003.000#3 — one Vite output, build-known immutable assets and a generic entry only.
export function offlineShell(): Plugin {
  let base = "/";
  return {
    name: "chat-offline-shell",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      base = config.base;
      if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw Error("The chat shell needs an absolute app base such as / or /chat/.");
    },
    generateBundle: {
      order: "post",
      handler(_, bundle) {
        const files = Object.keys(bundle).filter(name => name === "index.html" || /^assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$/.test(name)).sort();
        if (!files.includes("index.html")) throw Error("The chat shell supports one index.html entry.");
        const hash = createHash("sha256");
        for (const name of files) {
          const item = bundle[name]!;
          hash.update(name).update(item.type === "chunk" ? item.code : item.source);
        }
        const prefix = `snapback4-chat-shell:${encodeURIComponent(base)}:`;
        const cache = prefix + hash.digest("hex").slice(0, 24);
        const paths = files.map(name => base + name);
        this.emitFile({ type: "asset", fileName: "shell.js", source: `
const CACHE = ${JSON.stringify(cache)};
const PREFIX = ${JSON.stringify(prefix)};
const PATHS = ${JSON.stringify(paths)};
const BASE = ${JSON.stringify(base)};
const ENTRY = BASE + "index.html";
const url = path => new URL(path, self.location.origin).href;
self.addEventListener("install", event => event.waitUntil((async () => {
  const existed = await caches.has(CACHE);
  const cache = await caches.open(CACHE);
  try {
    // Never put a credentialed or redirected response into the shell cache.
    for (const path of PATHS) {
      const response = await fetch(new Request(url(path), { credentials: "omit", cache: "reload", redirect: "error" }));
      if (!response.ok || response.type !== "basic") throw Error("Shell asset unavailable: " + path);
      await cache.put(url(path), response);
    }
  } catch (error) { if (!existed) await caches.delete(CACHE); throw error; }
})()));
// No skipWaiting/clients.claim: the old build owns its tabs until they close.
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
})()));
self.addEventListener("fetch", event => {
  const request = event.request, address = new URL(request.url);
  if (request.method !== "GET" || address.origin !== self.location.origin || request.headers.has("authorization")) return;
  const navigation = request.mode === "navigate" && (address.pathname === BASE || address.pathname === ENTRY);
  const asset = request.mode !== "navigate" && !address.search && PATHS.includes(address.pathname) && address.pathname !== ENTRY;
  if (!navigation && !asset) return;
  event.respondWith((async () => {
    const response = await (await caches.open(CACHE)).match(url(navigation ? ENTRY : address.pathname));
    return response || fetch(request);
  })());
});
` });
      },
    },
  };
}

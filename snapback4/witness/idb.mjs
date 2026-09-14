#!/usr/bin/env node
// The Chromium witness (LLP 2000.000 §11.5): what the simulator cannot
// reach — IndexedDB. A real page on the local-first client against a real
// `snapback4 dev`: the wasm device syncs and keeps its partition in
// IndexedDB behind each call, reads run on it, a queued write survives a
// reload, and the rows kept are what the server sent. Prints one JSON line.
import { launch } from "./lib.mjs";

const witness = await launch({ extraSource: `table secrets:
  photo: image <=100000 once
  read <- allow
  insert <- allow
  sync public
mutation attach(photo: image <=100000):
  return insert secrets { photo }
`, seed: [
  { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
  { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
  { table: "memberships", row: { id: "m2", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 2 } },
  ...Array.from({ length: 300 }, (_, n) => ({ table: "messages", row: { id: `seed${String(n).padStart(4, "0")}`, conversationId: "c1", authorId: n % 2 ? "dev:alice" : "dev:bob", body: `seed ${n}`, at: 1_700_000_000_000 + n, editedAt: null, photo: null } })),
] });
const { page, api } = witness;
const out = { chromium: witness.chromium, pageErrors: [] };
// Nothing the client does may surface as an unhandled error in the page:
// a refused prediction is `failed` on the card, not a pageerror.
page.on("pageerror", (error) => out.pageErrors.push(String(error.message ?? error)));
try {
  // First session: sync into IndexedDB, read locally, send while offline (a
  // blocked fetch), then leave the page with the write queued.
  const first = await page.evaluate(async (api) => {
    const t0 = performance.now();
    // The client's fetch is looked up per call, so the page can cut the link.
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1, fetch: (...args) => window.fetch(...args) });
    const synced = performance.now() - t0;
    const thread = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
    const inbox = await client.query({ kind: "query", name: "inbox" }, {});
    // A refused prediction (a stranger's send) is `failed`, typed, with no page error.
    const stranger = await window.createLocalClient({ url: api, persona: "mallory", waitSeconds: 1, fetch: (...args) => window.fetch(...args) });
    const refused = await stranger.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "not a member" });
    await stranger.close();
    // Go offline: every fetch fails from here.
    const realFetch = window.fetch;
    window.fetch = () => Promise.reject(new TypeError("offline"));
    const write = await client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "queued while offline" });
    const local = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
    window.fetch = realFetch;
    await client.close();
    return { syncMs: +synced.toFixed(1), threadRows: thread.data.length, threadComplete: thread.complete, next: !!thread.next, count: inbox.data[0].count, write: write.state, pendingLocally: local.data[0].pending === true, localFresh: local.fresh, refused: refused.state === "failed" ? refused.why?.code : refused.state };
  }, api);
  Object.assign(out, { first });
  // View both kinds online; only the ordinary image enters device storage.
  const media = await page.evaluate(async api => {
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1, assets: { keep: "viewed", maxBytes: 1024 } });
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="), c => c.charCodeAt(0));
    const uploaded = await client.upload(bytes), secret = await client.upload(bytes);
    const photo = await client.mutate({ kind: "mutation", name: "sendPhoto" }, { conversationId: "c1", photo: { id: uploaded.asset.id }, body: "cached image" });
    const once = await client.mutate({ kind: "mutation", name: "media.attach" }, { photo: { id: secret.asset.id } });
    if (photo.state !== "sent" || once.state !== "sent") throw new Error(JSON.stringify({ photo, once }));
    for (const id of [uploaded.asset.id, secret.asset.id]) {
      const read = await client.asset(id);
      if (!("url" in read)) throw new Error(JSON.stringify(read));
      read.revoke();
    }
    await client.close();
    return { ordinary: uploaded.asset.id, once: secret.asset.id, bytes: bytes.length };
  }, api);
  // New JS lifetime: deny every fetch before opening. The backend and wasm
  // must come from IndexedDB, and the viewed ordinary image must render.
  await witness.reload();
  out.offline = await page.evaluate(async ({ api, media }) => {
    let wasmFetches = 0, fetches = 0;
    const original = window.fetch;
    window.fetch = input => { fetches++; if (String(input).includes(".wasm")) wasmFetches++; return Promise.reject(new TypeError("offline reload")); };
    const t0 = performance.now();
    let client;
    try {
      client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1, assets: { keep: "viewed", maxBytes: 1024 } });
      const read = await client.asset(media.ordinary);
      if (!("url" in read)) throw new Error(JSON.stringify(read));
      const img = document.createElement("img"); img.src = read.url; document.body.append(img);
      await img.decode();
      const once = await client.asset(media.once);
      const result = { openMs: +(performance.now() - t0).toFixed(1), wasmFetches, fetches, width: img.naturalWidth, height: img.naturalHeight, bytes: read.bytes, once: once.denied?.code, link: client.link() };
      read.revoke(); img.remove();
      return result;
    } finally { if (client) await client.close(); window.fetch = original; }
  }, { api, media });
  // Second session: a fresh page on the same origin opens the same
  // IndexedDB; the partition is already there and the queued write lands.
  await witness.reload();
  const second = await page.evaluate(async (api) => {
    const rows = await new Promise((resolve, reject) => {
      const open = indexedDB.open(`snapback4-${encodeURIComponent(`${api}:dev:bob`)}`, 1);
      open.onsuccess = () => { const tx = open.result.transaction("changes"); const req = tx.objectStore("changes").count(IDBKeyRange.bound(["r", ""], ["r", "\uffff"])); req.onsuccess = () => { resolve(req.result); open.result.close(); }; req.onerror = () => reject(req.error); };
      open.onerror = () => reject(open.error);
    });
    const t0 = performance.now();
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1 });
    const reopened = performance.now() - t0;
    let thread;
    for (let i = 0; i < 100; i++) {
      thread = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
      if (thread.data.some(row => row.body === "queued while offline" && !row.pending)) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await client.close();
    return { rowsInIdbBeforeOpen: rows, reopenMs: +reopened.toFixed(1), landed: thread.data.some(row => row.body === "queued while offline" && !row.pending) };
  }, api);
  Object.assign(out, { second });
  // Real transaction aborts: neither rejected admission nor failed orphan
  // adoption may change the recovered replica or strand its Web Lock.
  out.durability = await page.evaluate(async api => {
    const persist = window.indexedDbPersistence();
    const backend = await fetch(`${api}/schema`, { headers: { "x-snapback-persona": "bob" } }).then(r => r.json());
    const opener = window.webDevice();
    const name = "witness-abort";
    let abort = null, freed = 0;
    const put = IDBObjectStore.prototype.put, free = window.WebDevice.prototype.free;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const request = put.call(this, value, ...args);
      if (abort?.(this.transaction.db.name, value)) { abort = null; this.transaction.abort(); }
      return request;
    };
    window.WebDevice.prototype.free = function () { freed++; return free.call(this); };
    const unlocked = async store => !(await navigator.locks.query()).held.some(lock => lock.name === store);
    const attempt = async run => { try { await run(); return false; } catch { return true; } };
    const queued = async core => (await core.call({ op: "queued" })).ok.map(entry => entry.id);
    let core;
    try {
      core = await opener.open(name, backend);
      const entry = id => ({ id, seq: 1, op: "send", args: { conversationId: "c1", body: id } });
      await core.call({ op: "enqueue", entry: entry("acknowledged") });
      abort = store => store === name;
      const admissionRejected = await attempt(() => core.call({ op: "enqueue", entry: { ...entry("aborted"), seq: 2 } }));
      const liveQueued = await queued(core);
      await core.close(); core = await opener.open(name);
      const reopenedQueued = await queued(core);
      await core.close(); core = null;
      const failedOpenName = "witness-failed-open", freeBefore = freed;
      abort = store => store === failedOpenName;
      const initialRejected = await attempt(() => opener.open(failedOpenName, backend));
      const initialFreed = freed - freeBefore, initialUnlocked = await unlocked(failedOpenName);
      const base = "witness-adoption", orphan = `${base}:tab-orphan`;
      core = await opener.open(orphan, backend);
      await core.call({ op: "enqueue", entry: entry("orphan-write") });
      await core.close(); core = null;
      abort = (store, value) => store === base && value.s === "o";
      const adoptionRejected = await attempt(() => opener.open(base, backend));
      const orphanKept = (await persist.others(orphan)).includes(orphan);
      const adoptionUnlocked = await unlocked(base) && await unlocked(orphan);
      core = await opener.open(base, backend);
      const adopted = await queued(core);
      const orphanRemoved = !(await persist.others(orphan)).includes(orphan);
      return { admissionRejected, liveQueued, reopenedQueued, initialRejected, initialFreed, initialUnlocked, adoptionRejected, orphanKept, adoptionUnlocked, adopted, orphanRemoved };
    } finally {
      await core?.close();
      IDBObjectStore.prototype.put = put; window.WebDevice.prototype.free = free;
    }
  }, api);
  // Each install runs in a new realm; the module-level ready promise must
  // not turn a failed-runtime test into a no-op. The app shell stays served.
  out.runtimePending = await page.evaluate(async api => {
    const fetchBefore = window.fetch;
    window.fetch = () => Promise.reject(new TypeError("offline before runtime install"));
    let client;
    try {
      client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1 });
      return (await client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "queued through runtime failures" })).state;
    } finally { await client?.close(); window.fetch = fetchBefore; }
  }, api);
  out.runtime = [];
  for (const failure of ["invalid-download", "incompatible-download", "aborted-install"]) {
    await witness.reload();
    out.runtime.push(await page.evaluate(async ({ api, failure }) => {
      const persist = window.indexedDbPersistence();
      const before = await persist.load("snapback4-wasm");
      const pointer = before.find(c => c.s === "url");
      const kept = before.find(c => c.s === "sha256" && c.k === pointer.v);
      const bytes = Uint8Array.from(kept.v.match(/../g), value => parseInt(value, 16));
      const url = new URL(`/${failure}.wasm`, location.href).href;
      const fetchBefore = window.fetch, putBefore = IDBObjectStore.prototype.put;
      let fetched = 0, rejected = false;
      window.fetch = input => {
        if (String(input) === url) {
          fetched++;
          const body = failure === "invalid-download" ? new Uint8Array([1, 2, 3]) : failure === "incompatible-download" ? new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]) : bytes;
          return Promise.resolve(new Response(body));
        }
        return fetchBefore(input);
      };
      if (failure === "aborted-install") IDBObjectStore.prototype.put = function (value, ...args) {
        const request = putBefore.call(this, value, ...args);
        if (this.transaction.db.name === "snapback4-wasm") this.transaction.abort();
        return request;
      };
      try { await window.webDevice({ wasm: url }).open("runtime-install", {}); }
      catch { rejected = true; }
      finally { window.fetch = fetchBefore; IDBObjectStore.prototype.put = putBefore; }
      const after = await persist.load("snapback4-wasm");
      return { failure, fetched, rejected, cacheUnchanged: JSON.stringify(before) === JSON.stringify(after) };
    }, { api, failure }));
    await witness.reload();
    const recovered = await page.evaluate(async api => {
      const fetchBefore = window.fetch;
      window.fetch = () => Promise.reject(new TypeError("offline after interrupted install"));
      let client;
      try {
        client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1 });
        const read = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
        return read.data?.some(row => row.body === "queued through runtime failures" && row.pending === true) && read.data.some(row => row.body === "queued while offline" && !row.pending) && client.link() === "offline";
      } finally { await client?.close(); window.fetch = fetchBefore; }
    }, api);
    out.runtime.at(-1).offlineRecovered = recovered;
  }
  // A failed cache save leaves wasm-bindgen initialized. A retry must not
  // install different bytes using that earlier module's successful init.
  await witness.reload();
  out.runtimeRetry = await page.evaluate(async api => {
    const persist = window.indexedDbPersistence();
    const before = await persist.load("snapback4-wasm");
    const pointer = before.find(c => c.s === "url");
    const bytes = Uint8Array.from(before.find(c => c.s === "sha256" && c.k === pointer.v).v.match(/../g), value => parseInt(value, 16));
    const originalModule = await WebAssembly.compile(bytes);
    const imported = WebAssembly.Module.imports(originalModule).find(item => item.kind === "function");
    const needle = new TextEncoder().encode(imported.name), incompatible = bytes.slice();
    const offset = incompatible.findIndex((_, at) => needle.every((byte, n) => incompatible[at + n] === byte));
    if (offset < 0) throw new Error("could not locate Wasm import");
    incompatible[offset] ^= 1; // same length, valid UTF-8, now an unavailable import
    const incompatibleModule = await WebAssembly.compile(incompatible);
    const sameExports = JSON.stringify(WebAssembly.Module.exports(originalModule)) === JSON.stringify(WebAssembly.Module.exports(incompatibleModule));
    const changedImport = WebAssembly.Module.imports(incompatibleModule).some(item => item.name !== imported.name && item.name === String.fromCharCode(needle[0] ^ 1) + imported.name.slice(1));
    const firstUrl = new URL("/retry-first.wasm", location.href).href;
    const secondUrl = new URL("/retry-incompatible.wasm", location.href).href;
    const backend = await fetch(`${api}/schema`, { headers: { "x-snapback-persona": "bob" } }).then(r => r.json());
    const realFetch = window.fetch;
    let firstError, secondError, core;
    window.fetch = input => String(input) === firstUrl ? Promise.resolve(new Response(bytes)) : String(input) === secondUrl ? Promise.resolve(new Response(incompatible)) : realFetch(input);
    try {
      try { await window.webDevice({ wasm: firstUrl, persist: { ...persist, async save(name, changes) { if (name === "snapback4-wasm") throw new Error("injected runtime cache save failure"); await persist.save(name, changes); } } }).open("runtime-retry", backend); }
      catch (error) { firstError = String(error); }
      try { core = await window.webDevice({ wasm: secondUrl }).open("runtime-retry", backend); }
      catch (error) { secondError = String(error); }
      await core?.close(); core = undefined;
      const cacheUnchanged = JSON.stringify(before) === JSON.stringify(await persist.load("snapback4-wasm"));
      // Retrying the original content should remain usable without a reload.
      core = await window.webDevice({ wasm: firstUrl }).open("runtime-retry", backend);
      const sameContentRecovered = !!(await core.call({ op: "state" })).ok;
      return { sameExports, changedImport, firstError, secondError, cacheUnchanged, sameContentRecovered };
    } finally { await core?.close(); window.fetch = realFetch; }
  }, api);
  await witness.reload();
  Object.assign(out.runtimeRetry, await page.evaluate(async () => {
    const realFetch = window.fetch;
    let core, offlineFetches = 0, offlineSameContentRecovered = false;
    window.fetch = () => { offlineFetches++; return Promise.reject(new TypeError("offline after runtime retry")); };
    try {
      core = await window.webDevice({ wasm: new URL("/retry-first.wasm", location.href) }).open("runtime-retry");
      offlineSameContentRecovered = !!(await core.call({ op: "state" })).ok;
    } catch { /* reported below */ }
    finally { await core?.close(); window.fetch = realFetch; }
    return { offlineFetches, offlineSameContentRecovered };
  }));
  out.ok = first.threadRows === 50 && first.threadComplete && first.next && first.count === 300 && first.write === "pending" && first.pendingLocally && !first.localFresh && first.refused === "NOT_MEMBER" && second.rowsInIdbBeforeOpen > 300 && second.landed && out.offline.wasmFetches === 0 && out.offline.width === 1 && out.offline.height === 1 && out.offline.bytes === 68 && out.offline.once === "E_OFFLINE" && out.offline.link === "offline" && out.pageErrors.length === 0;
  const d = out.durability;
  out.ok &&= d.admissionRejected && d.liveQueued.join() === "acknowledged" && d.reopenedQueued.join() === "acknowledged" && d.initialRejected && d.initialFreed === 1 && d.initialUnlocked && d.adoptionRejected && d.orphanKept && d.adoptionUnlocked && d.adopted.join() === "orphan-write" && d.orphanRemoved && out.runtimePending === "pending" && out.runtime.every(r => r.fetched === 1 && r.rejected && r.cacheUnchanged && r.offlineRecovered);
  const retry = out.runtimeRetry;
  out.ok &&= !!(retry.sameExports && retry.changedImport && retry.firstError?.includes("injected runtime cache save failure") && retry.secondError?.includes("reload") && retry.cacheUnchanged && retry.sameContentRecovered && retry.offlineSameContentRecovered && retry.offlineFetches === 0);
} finally {
  await witness.close();
}
console.log(JSON.stringify({ witness: "chromium-indexeddb", ...out }));
process.exit(out.ok ? 0 : 1);

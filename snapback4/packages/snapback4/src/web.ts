// The device on the web: the same device, as wasm, over memory (the
// interpreter's store boundary is synchronous and IndexedDB is not), with
// the host persisting each call's changes behind it. A cold start with no
// network opens on what it kept. One tab is one device: a tab that finds
// the store held opens its own, and the writes an orphaned tab left queued
// are adopted by the next device that opens the store.

import type { BackendJson } from "./backend.ts";
import type { DeviceCore, DeviceOpener } from "./local.ts";
import init, { WebDevice } from "./wasm/snapback4_device.js";

/** One change the device reported: the store (`r` rows, `m` metadata, `o`
 * outbox, `b` confirmed images, `s` staged snapshot), the key, the value;
 * null removes. */
export interface Change {
  s: string;
  k: string;
  v: string | null;
}

/** Where a host keeps what the device changed, by store name. */
export interface Persistence {
  load(name: string): Promise<Change[]>;
  read?(name: string, store: string, key: string): Promise<string | null>;
  /** One batch, all or nothing, in order. */
  save(name: string, changes: Change[]): Promise<void>;
  /** The stores held whose names begin with `prefix`. */
  others?(prefix: string): Promise<string[]>;
  remove?(name: string): Promise<void>;
}

type WasmSource = URL | string | Response | BufferSource | WebAssembly.Module;

export interface WebDeviceOptions {
  /** The wasm: a URL, a Response, bytes or a compiled module. By default
   * `snapback4_device_bg.wasm` beside this module, which bundlers copy. */
  readonly wasm?: WasmSource | Promise<WasmSource>;
  /** IndexedDB by default; `memoryPersistence()` for tests. */
  readonly persist?: Persistence;
}

let ready: Promise<unknown> | null = null;

/** The opener `createLocalClient` takes on the web. */
export function webDevice(options: WebDeviceOptions = {}): DeviceOpener {
  const persist = options.persist ?? indexedDbPersistence();
  return {
    async open(name, backend) {
      ready ??= cachedWasm(options.wasm ?? new URL("./wasm/snapback4_device_bg.wasm", import.meta.url), persist)
        .catch((error) => { ready = null; throw error; });
      await ready;
      const store = await claim(name);
      let device: WebDevice | undefined;
      let chain: Promise<unknown> = Promise.resolve();
      let closing: Promise<void> | undefined;
      const discard = (): void => {
        const previous = device;
        device = undefined;
        previous?.free();
      };
      const settle = async (): Promise<void> => {
        const changes = JSON.parse(device!.drain()) as Change[];
        if (changes.length) await persist.save(store.name, changes);
      };
      const restore = async (backend?: BackendJson | null): Promise<void> => {
        device = new WebDevice(backend ? JSON.stringify(backend) : null, JSON.stringify(await persist.load(store.name)));
        await settle();
      };
      try {
        await restore(backend);
        await adoptOrphans(device!, name, store.name, persist, settle);
      } catch (error) {
        try { discard(); } finally { await store.release(); }
        throw new Error(refusalText(error));
      }
      const core: DeviceCore = {
        media: {
          async read(id) { return persist.read ? persist.read(`snapback4-media:${store.name}`, "a", id) : (await persist.load(`snapback4-media:${store.name}`)).find((c) => c.k === id)?.v ?? null; },
          async write(id, hex) { await persist.save(`snapback4-media:${store.name}`, [{ s: "a", k: id, v: hex }]); },
          async remove(id) { await persist.save(`snapback4-media:${store.name}`, [{ s: "a", k: id, v: null }]); },
        },
        call(request) {
          if (closing) return Promise.reject(new Error("the device is closed"));
          const answer = chain.then(async () => {
            try {
              // @ref LLP 3000.008.004#3 — publish only after persistence;
              // a failed call discards its uncommitted memory. Reopen lazily
              // on the kept backend, with no store copy on successful calls.
              if (!device) await restore();
              const reply = JSON.parse(device!.call(JSON.stringify(request))) as Record<string, unknown>;
              await settle();
              return reply;
            } catch (error) {
              discard();
              throw error;
            }
          });
          chain = answer.catch(() => undefined);
          return answer;
        },
        close() {
          return closing ??= chain.then(async () => {
            try { discard(); } finally { await store.release(); }
          });
        },
      };
      return core;
    },
  };
}

// @ref LLP 3000.007#8 — a cold offline open owns its wasm bytes, keyed by SHA-256
async function cachedWasm(source: WasmSource | Promise<WasmSource>, persist: Persistence): Promise<unknown> {
  const resolved = await source;
  if (resolved instanceof WebAssembly.Module) return initializeWasm(resolved);
  const isUrl = typeof resolved === "string" || resolved instanceof URL;
  const url = isUrl ? String(resolved) : null;
  const name = "snapback4-wasm";
  const saved = url ? await persist.load(name) : [];
  const pointer = saved.find((c) => c.s === "url" && c.k === url)?.v;
  const hex = pointer && saved.find((c) => c.s === "sha256" && c.k === pointer)?.v;
  const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex) {
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
    if (await digest(bytes) === pointer) {
      try { return await initializeWasm(bytes); } catch {
        // A cache from an interrupted/older installer may be unusable even
        // when its content hash matches. An online fetch can repair it.
      }
    }
  }
  const fetched = isUrl ? await fetch(resolved as string | URL) : resolved;
  if (fetched instanceof Response && !fetched.ok) throw new Error(`wasm: HTTP ${fetched.status}`);
  const bytes = fetched instanceof Response ? new Uint8Array(await fetched.arrayBuffer())
    : ArrayBuffer.isView(fetched) ? new Uint8Array(fetched.buffer, fetched.byteOffset, fetched.byteLength) : new Uint8Array(fetched as ArrayBuffer);
  const hash = await digest(bytes);
  // Initialization must succeed before these bytes become the offline entry.
  // The content and URL pointer are then installed in one atomic host save.
  const initialized = await initializeWasm(bytes);
  await persist.save(name, [
    { s: "sha256", k: hash, v: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") },
    ...(url ? [{ s: "url", k: url, v: hash }] : []),
  ]);
  return initialized;
}

async function initializeWasm(source: BufferSource | WebAssembly.Module): Promise<unknown> {
  // Compile independently of wasm-bindgen's realm-wide initialized shortcut:
  // a previous cache-save failure must not let a retry install invalid bytes.
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  const exports = new Map(WebAssembly.Module.exports(module).map(e => [e.name, e.kind]));
  if (exports.get("memory") !== "memory" || ["webdevice_new", "webdevice_call", "webdevice_drain", "__wbg_webdevice_free"].some(name => exports.get(name) !== "function")) {
    throw new Error("wasm: the module does not export the Snapback device runtime; use the wasm shipped with this package");
  }
  return init({ module_or_path: module });
}

function refusalText(error: unknown): string {
  const text = String((error as Error)?.message ?? error);
  try {
    const parsed = JSON.parse(text) as { denied?: { code?: string; message?: string } };
    if (parsed.denied) return `${parsed.denied.code}: ${parsed.denied.message}`;
  } catch {
    // not a refusal
  }
  return text;
}

// ----- one device per tab -----

interface Claim {
  name: string;
  release(): Promise<void>;
}

function lockManager(): LockManager | undefined {
  return (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
}

/** Hold the store's lock for this tab; when another tab holds it, take a
 * tab-scoped store instead. Without the Web Locks API the name is shared. */
async function claim(name: string): Promise<Claim> {
  const locks = lockManager();
  if (!locks) return { name, async release() {} };
  const held = await hold(locks, name);
  if (held) return { name, release: held };
  const own = `${name}:tab-${Math.random().toString(36).slice(2, 10)}`;
  const release = await hold(locks, own);
  return { name: own, release: release ?? (async () => {}) };
}

/** Hold a lock until released; null when another holder has it. */
function hold(locks: LockManager, name: string): Promise<(() => Promise<void>) | null> {
  return new Promise((resolve, reject) => {
    let release!: () => void;
    const done = new Promise<void>((r) => (release = r));
    const requested = locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolve(null);
        return;
      }
      resolve(async () => {
        release();
        await requested;
      });
      await done;
    });
    void requested.catch(reject);
  });
}

/** Writes an orphaned tab left queued are queued here, in their order,
 * and the orphan's store goes; its rows are the stream's to bring back. */
async function adoptOrphans(device: WebDevice, name: string, own: string, persist: Persistence, settle: () => Promise<void>): Promise<void> {
  const locks = lockManager();
  if (!locks || !persist.others || !persist.remove) return;
  for (const orphan of await persist.others(`${name}:tab-`)) {
    if (orphan === own) continue;
    const held = await hold(locks, orphan);
    if (!held) continue;
    try {
      const latest = new Map<string, string | null>();
      for (const change of await persist.load(orphan)) if (change.s === "o") latest.set(change.k, change.v);
      const entries = [...latest.values()].filter((v): v is string => v !== null).map((v) => JSON.parse(v) as { seq: number });
      entries.sort((a, b) => a.seq - b.seq);
      for (const entry of entries) {
        const next = JSON.parse(device.call(JSON.stringify({ op: "next_submission" }))) as { ok?: number };
        device.call(JSON.stringify({ op: "enqueue", entry: { ...entry, seq: next.ok ?? entry.seq } }));
      }
      await settle();
      await persist.remove(orphan);
    } finally {
      await held();
    }
  }
}

// ----- persistence -----

/** IndexedDB: one database per store, one object store of changes keyed by
 * store and key, written in one transaction per call. */
export function indexedDbPersistence(): Persistence {
  const open = (name: string): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("changes", { keyPath: ["s", "k"] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return {
    async read(name, store, key) {
      const db = await open(name);
      try {
        const tx = db.transaction("changes", "readonly");
        const request = tx.objectStore("changes").get([store, key]);
        await done(tx);
        return (request.result as Change | undefined)?.v ?? null;
      } finally { db.close(); }
    },
    async load(name) {
      const db = await open(name);
      try {
        const tx = db.transaction("changes", "readonly");
        const request = tx.objectStore("changes").getAll();
        await done(tx);
        return (request.result as Change[]).map((c) => ({ s: c.s, k: c.k, v: c.v }));
      } finally {
        db.close();
      }
    },
    async save(name, changes) {
      const db = await open(name);
      try {
        const tx = db.transaction("changes", "readwrite");
        const store = tx.objectStore("changes");
        for (const change of changes) {
          if (change.v === null) store.delete([change.s, change.k]);
          else store.put(change);
        }
        await done(tx);
      } finally {
        db.close();
      }
    },
    async others(prefix) {
      const list = (indexedDB as { databases?: () => Promise<{ name?: string }[]> }).databases;
      if (!list) return [];
      return (await list.call(indexedDB)).map((d) => d.name ?? "").filter((n) => n.startsWith(prefix));
    },
    async remove(name) {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve();
      });
    },
  };
}

/** Memory: what a test keeps between opens. */
export function memoryPersistence(): Persistence & { readonly stores: Map<string, Map<string, Change>> } {
  const stores = new Map<string, Map<string, Change>>();
  return {
    stores,
    async read(name, store, key) { return stores.get(name)?.get(`${store} ${key}`)?.v ?? null; },
    async load(name) {
      return [...(stores.get(name)?.values() ?? [])];
    },
    async save(name, changes) {
      let held = stores.get(name);
      if (!held) stores.set(name, (held = new Map()));
      for (const change of changes) {
        const key = `${change.s} ${change.k}`;
        if (change.v === null) held.delete(key);
        else held.set(key, change);
      }
    },
    async others(prefix) {
      return [...stores.keys()].filter((n) => n.startsWith(prefix));
    },
    async remove(name) {
      stores.delete(name);
    },
  };
}

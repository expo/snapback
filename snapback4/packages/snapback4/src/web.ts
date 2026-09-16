// The device on the web: the same device, as wasm, over memory (the
// interpreter's store boundary is synchronous and IndexedDB is not), with
// the host persisting each call's changes behind it. A cold start with no
// network opens on what it kept. One tab is one device: a tab that finds
// the store held opens its own, and the writes an orphaned tab left queued
// are adopted by the next device that opens the store.

import type { BackendJson } from "./backend.ts";
import type { DeviceCore, DeviceOpener } from "./local.ts";
import type { PendingSend } from "./local-exit.ts";
import { AdmissionJournal, journalStores, writeRefusal } from "./web-journal.ts";
import init, { WebDevice } from "./wasm/snapback4_device.js";

/** One change the device reported: the store (`r` rows, `m` metadata, `o`
 * outbox, `b` confirmed images, `s` staged snapshot), the key, the value;
 * null removes. The web host also persists `j` admission-transfer markers,
 * which it keeps outside the wasm device. */
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
let runtime: { identity: string | WebAssembly.Module; initialized: unknown } | undefined;

/** The opener `createLocalClient` takes on the web. */
export function webDevice(options: WebDeviceOptions = {}): DeviceOpener {
  const persist = options.persist ?? indexedDbPersistence();
  return {
    async open(name, backend) {
      ready ??= cachedWasm(options.wasm ?? new URL("./wasm/snapback4_device_bg.wasm", import.meta.url), persist)
        .catch((error) => { ready = null; throw error; });
      await ready;
      const store = await claim(name);
      const journal = new AdmissionJournal(store.name, store.exclusive);
      const admissions = new Set<string>();
      let device: WebDevice | undefined;
      let chain: Promise<unknown> = Promise.resolve();
      let closing: Promise<void> | undefined;
      // Committed outbox entries, mirrored from persisted changes, so a page
      // being hidden can send what IndexedDB already holds.
      const committed = new Map<string, { seq: number; id: string; op: string; args: unknown; new_ids: string[]; sent_seq?: number | null }>();
      const committedListeners = new Set<() => void>();
      const remember = (changes: Change[]) => {
        journal.remember(changes);
        for (const change of changes) if (change.s === "o") {
          if (change.v === null) committed.delete(change.k);
          else committed.set(change.k, JSON.parse(change.v));
        }
      };
      const discard = (): void => {
        const previous = device;
        device = undefined;
        previous?.free();
      };
      const settle = async (extra: Change[] = []): Promise<void> => {
        const changes = [...JSON.parse(device!.drain()) as Change[], ...journal.cleanup(committed), ...extra];
        if (changes.length) {
          await persist.save(store.name, changes);
          remember(changes);
          journal.cleanup(committed);
          // An unawaited mutate may finish admission after pagehide. Recheck
          // the suspended page only once its outbox transaction has committed.
          if (changes.some(change => change.s === "o")) for (const notify of committedListeners) notify();
        }
      };
      const restore = async (backend?: BackendJson | null): Promise<void> => {
        const saved = await persist.load(store.name);
        device = new WebDevice(backend ? JSON.stringify(backend) : null, JSON.stringify(saved.filter(c => c.s !== "j")));
        journal.load(saved);
        committed.clear();
        remember(saved);
        await settle();
        await journal.recover(device, settle, admissions);
      };
      try {
        await restore(backend);
        await adoptOrphans(device!, name, store.name, persist, settle);
      } catch (error) {
        try { discard(); } finally { await store.release(); }
        throw new Error(refusalText(error));
      }
      const suspendListeners = new Set<() => void>();
      const core: DeviceCore = {
        onSuspend(flush) {
          if (typeof window === "undefined" || typeof document === "undefined") return () => {};
          const page = window, doc = document;
          let suspended = false;
          const beginSend = () => {
            if (closing || !device) return false;
            // Invalidate any sync already in flight, including a bfcache page's
            // snapshot. The synchronous VM call precedes the oldest write's send;
            // its metadata is persisted in order behind any current IDB save.
            const started = JSON.parse(device.call(JSON.stringify({ op: "begin_send" })));
            if (started.denied) return false;
            // A failed save discards the device like a failed call; the next call reopens it.
            chain = chain.then(async () => { if (device) await settle(); }).catch(() => discard());
            return true;
          };
          const dispatch = () => {
            if (!suspended || closing || !device) return;
            const entries: PendingSend[] = [...committed.values()].filter(e => e.sent_seq == null).sort((a, b) => a.seq - b.seq)
              .map(e => ({ id: e.id, op: e.op, args: e.args, newIds: e.new_ids }));
            if (entries.length) flush(entries, beginSend);
          };
          const suspend = () => { suspended = true; dispatch(); };
          const resume = () => { suspended = false; };
          const hidden = () => { if (doc.visibilityState === "hidden") suspend(); else resume(); };
          const stop = () => {
            page.removeEventListener("pagehide", suspend);
            page.removeEventListener("pageshow", resume);
            doc.removeEventListener("visibilitychange", hidden);
            committedListeners.delete(dispatch);
            suspendListeners.delete(stop);
          };
          page.addEventListener("pagehide", suspend);
          page.addEventListener("pageshow", resume);
          doc.addEventListener("visibilitychange", hidden);
          committedListeners.add(dispatch);
          suspendListeners.add(stop);
          return stop;
        },
        media: {
          async read(id) { return persist.read ? persist.read(`snapback4-media:${store.name}`, "a", id) : (await persist.load(`snapback4-media:${store.name}`)).find((c) => c.k === id)?.v ?? null; },
          async write(id, hex) { await persist.save(`snapback4-media:${store.name}`, [{ s: "a", k: id, v: hex }]); },
          async remove(id) { await persist.save(`snapback4-media:${store.name}`, [{ s: "a", k: id, v: null }]); },
        },
        call(request) {
          if (closing) return Promise.reject(new Error("the device is closed"));
          const admission = request.op === "admit" ? journal.capture(request) : undefined;
          if (admission) { request = { ...request, entry: admission.entry }; admissions.add(admission.entry.id); }
          const answer = chain.then(async () => {
            try {
              // @ref LLP 3000.008.004#3 — publish only after persistence;
              // a failed call discards its uncommitted memory. Reopen lazily
              // on the kept backend, with no store copy on successful calls.
              if (!device) await restore();
              if (request.op === "admit") await journal.recover(device!, settle, admissions);
              const reply = request.op === "admit" ? journal.admit(device!, request.entry) : JSON.parse(device!.call(JSON.stringify(request))) as Record<string, unknown>;
              if (!reply.denied && (request.op === "observe_store" || request.op === "apply")) journal.fence(device!);
              try {
                await settle(!admission ? [] : !reply.denied ? [journal.transfer(admission, false)] : writeRefusal(reply) ? journal.refused(admission) : []);
              } catch (error) {
                if (!admission || !writeRefusal(reply)) throw error;
                // The refusal is known even when both cancellation stores fail.
                // Discard any uncommitted memory; the docs call recovery indeterminate.
                discard();
                return reply;
              }
              if (!reply.denied && ["adopt", "observe_store", "apply"].includes(String(request.op))) await journal.recover(device!, settle, admissions);
              if (!reply.denied && (request.op === "observe_store" || request.op === "apply")) await adoptOrphans(device!, name, store.name, persist, settle);
              return reply;
            } catch (error) {
              discard();
              throw error;
            } finally { if (admission) admissions.delete(admission.entry.id); }
          });
          chain = answer.catch(() => undefined);
          return answer;
        },
        close() {
          for (const stop of suspendListeners) stop();
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
  if (resolved instanceof WebAssembly.Module) return initializeWasm(resolved, resolved);
  const isUrl = typeof resolved === "string" || resolved instanceof URL;
  const url = isUrl ? String(resolved) : null;
  const name = "snapback4-wasm";
  const saved = url ? await persist.load(name) : [];
  const pointer = saved.find((c) => c.s === "url" && c.k === url)?.v;
  const hex = pointer && saved.find((c) => c.s === "sha256" && c.k === pointer)?.v;
  const digest = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex) {
    const bytes = Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
    if (pointer && await digest(bytes) === pointer) {
      try { return await initializeWasm(bytes, pointer); } catch {
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
  const initialized = await initializeWasm(bytes, hash);
  await persist.save(name, [
    { s: "sha256", k: hash, v: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") },
    ...(url ? [{ s: "url", k: url, v: hash }] : []),
  ]);
  return initialized;
}

async function initializeWasm(source: BufferSource | WebAssembly.Module, identity: string | WebAssembly.Module): Promise<unknown> {
  // wasm-bindgen retains the initialized instance even if the later cache
  // save fails. Its shortcut cannot validate another module's linking: only
  // the exact initialized content may retry installation in this realm.
  if (runtime) {
    if (runtime.identity !== identity) throw new Error("wasm: a different runtime is already initialized; reload before installing different runtime bytes");
    return runtime.initialized;
  }
  const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
  const exports = new Map(WebAssembly.Module.exports(module).map(e => [e.name, e.kind]));
  if (exports.get("memory") !== "memory" || ["webdevice_new", "webdevice_call", "webdevice_drain", "__wbg_webdevice_free"].some(name => exports.get(name) !== "function")) {
    throw new Error("wasm: the module does not export the Snapback device runtime; use the wasm shipped with this package");
  }
  const initialized = await init({ module_or_path: module });
  runtime = { identity, initialized };
  return initialized;
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
  exclusive: boolean;
  release(): Promise<void>;
}

function lockManager(): LockManager | undefined {
  return (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
}

/** Hold the store's lock for this tab; when another tab holds it, take a
 * tab-scoped store instead. Without the Web Locks API the name is shared. */
async function claim(name: string): Promise<Claim> {
  const locks = lockManager();
  if (!locks) return { name, exclusive: false, async release() {} };
  const held = await hold(locks, name);
  if (held) return { name, exclusive: true, release: held };
  const own = `${name}:tab-${Math.random().toString(36).slice(2, 10)}`;
  const release = await hold(locks, own);
  return { name: own, exclusive: !!release, release: release ?? (async () => {}) };
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
async function adoptOrphans(device: WebDevice, name: string, own: string, persist: Persistence, settle: (extra?: Change[]) => Promise<void>): Promise<void> {
  const locks = lockManager();
  if (!locks || !persist.others || !persist.remove) return;
  for (const orphan of new Set([...await persist.others(`${name}:tab-`), ...journalStores(`${name}:tab-`)])) {
    if (orphan === own) continue;
    // A tab that just closed can still hold its lock for a moment. Its records
    // and receipts are only reachable once it lets go, and nothing else would
    // retry until the next apply, so wait briefly for a busy orphan.
    let held = await hold(locks, orphan);
    for (let wait = 0; !held && wait < 10; wait++) {
      await new Promise(resume => setTimeout(resume, 20));
      held = await hold(locks, orphan);
    }
    if (!held) continue;
    let destinationDirty = false;
    try {
      // @ref LLP 3000.007#18.2 — orphan receipts retain their source store until ownership can be resolved.
      let saved = await persist.load(orphan);
      const state = JSON.parse(device.call(JSON.stringify({ op: "sync_state" }))).ok;
      const destination = state?.store_id;
      if (journalStores(`${name}:tab-`).includes(orphan)) {
        // An evicted/unidentified store cannot establish the journal's owner.
        // Leave it intact for a later matching open; never guess from the key.
        if (!saved.some(c => c.s === "m" && c.k === "device:store_id" && c.v) || !saved.some(c => c.s === "m" && c.k === "device:backend" && c.v)) continue;
        const sourceJournal = new AdmissionJournal(orphan, true);
        sourceJournal.load(saved);
        const sourceDevice = new WebDevice(null, JSON.stringify(saved.filter(c => c.s !== "j")));
        try {
          const sourceState = JSON.parse(sourceDevice.call(JSON.stringify({ op: "sync_state" }))).ok;
          if (sourceState?.backend_required && !sourceState.restore_refusal && sourceState.store_id === destination && !state.backend_required && !state.restore_refusal) {
            // The destination has already authenticated and installed this store's backend.
            const backend = JSON.parse(device.call(JSON.stringify({ op: "backend" }))).ok;
            const adopted = JSON.parse(sourceDevice.call(JSON.stringify({ op: "adopt", backend, store_id: destination, send_revision: sourceState.send_revision })));
            if (adopted.denied) throw new Error(refusalText(JSON.stringify(adopted)));
            await persist.save(orphan, JSON.parse(sourceDevice.drain()));
          }
          await sourceJournal.recover(sourceDevice, async (extra = []) => {
            const changes = [...JSON.parse(sourceDevice.drain()) as Change[], ...extra];
            await persist.save(orphan, changes);
            sourceJournal.remember(changes);
            sourceJournal.cleanup(new Map());
          });
        } finally { sourceDevice.free(); }
        saved = await persist.load(orphan);
      }
      let source: string | null | undefined;
      for (const change of saved) if (change.s === "m" && change.k === "device:store_id") source = change.v;
      const latest = new Map<string, string | null>();
      for (const change of saved) if (change.s === "o") latest.set(change.k, change.v);
      const entries = [...latest.values()].filter((v): v is string => v !== null).map(v => JSON.parse(v) as { id: string; seq: number; sent_seq?: number | null; observed_seq?: number | null });
      entries.sort((a, b) => a.seq - b.seq);
      const existing = new Set((JSON.parse(device.call(JSON.stringify({ op: "queued" }))).ok as { id: string }[]).map(e => e.id));
      const transfers = new Map(saved.filter(c => c.s === "j" && c.v !== null).map(c => [c.k, JSON.parse(c.v!) as { recovered: boolean; storeId: string }]));
      const removed: Change[] = [];
      let unresolved = false;
      for (const entry of entries) {
        const transfer = transfers.get(entry.id);
        if (transfer?.recovered && !destination) { unresolved = true; continue; }
        if (transfer?.recovered && transfer.storeId !== destination) { removed.push({ s: "o", k: entry.id, v: null }); continue; }
        const known = entry.sent_seq != null || entry.observed_seq != null;
        if (known && (!source || !destination)) { unresolved = true; continue; }
        if ((!known || source === destination) && !existing.has(entry.id)) {
          destinationDirty = true;
          const next = JSON.parse(device.call(JSON.stringify({ op: "next_submission" }))) as { ok?: number };
          const reply = JSON.parse(device.call(JSON.stringify({ op: "enqueue", entry: { ...entry, seq: next.ok ?? entry.seq, predictable: false, predicted: [] } })));
          if (reply.denied) throw new Error(refusalText(JSON.stringify(reply)));
          existing.add(entry.id);
        }
        removed.push({ s: "o", k: entry.id, v: null });
      }
      // A reloaded secondary tab gets a new store name. Its value-free terminal
      // receipts must follow the outbox before the orphan store is removed.
      for (const change of saved) if (change.s === "m" && change.k === "client:write-history" && change.v) {
        destinationDirty = true;
        const copied = JSON.parse(device.call(JSON.stringify({ op: "keep_write", value: change.v })));
        if (copied.denied) throw new Error(refusalText(JSON.stringify(copied)));
      }
      await settle(saved.filter(c => c.s === "j" && !entries.some(e => e.id === c.k && !removed.some(r => r.k === e.id))));
      destinationDirty = false;
      if (unresolved || journalStores(`${name}:tab-`).includes(orphan)) await persist.save(orphan, removed);
      else await persist.remove(orphan);
    } catch (error) {
      // A broken orphan stays intact and must not prevent opening healthy stores.
      // A destination commit failure still requires the caller to discard its VM.
      if (destinationDirty) throw error;
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
        const tx = db.transaction("changes", "readwrite", { durability: "strict" });
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

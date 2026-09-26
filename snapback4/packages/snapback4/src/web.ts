import { indexedDbStore } from "./web-idb.ts";
import { admissionHost, admissionRefusal, browserAdmission } from "./admission.ts";
import { admissionAuthorityHost, admissionAuthorityRefusal, type AdmissionAuthorityContext } from "./admission-authority.ts";
// The device on the web: the same device, as wasm, over memory (the
// interpreter's store boundary is synchronous and IndexedDB is not), with
// the host persisting each call's changes behind it. A cold start with no
// network opens on what it kept. One tab is one device: a tab that finds
// the store held opens its own, and the writes an orphaned tab left queued
// are adopted by the next device that opens the store.

import type { Write } from "./contract.ts";
import { WRITE_HISTORY_LIMIT } from "./writes.ts";
import type { DeviceCore, DeviceOpener, DeviceOpening } from "./local.ts";
import type { PendingSend } from "./local-exit.ts";
import type { Queued } from "./local-types.ts";
import { successSequence } from "./local-receipts.ts";
import { AdmissionError, AdmissionJournal, bindingRefusal, journalStoreBinding, journalStores, writeRefusal } from "./web-journal.ts";
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
  /** Acquire one exclusive device-store name. When `alternate` is true, an
   * alternate must be named `${name}:tab-*` and the provider must implement
   * `others` and `remove` so a later owner can adopt it. With `alternate`
   * false, return the exact requested name or null rather than waiting. */
  claim(name: string, alternate: boolean): Promise<PersistenceClaim | null>;
  load(name: string): Promise<Change[]>;
  /** Test existence without creating a missing store. */
  has?(name: string): Promise<boolean>;
  read?(name: string, store: string, key: string): Promise<string | null>;
  /** One batch, all or nothing, in order. */
  save(name: string, changes: Change[]): Promise<void>;
  /** The stores held whose names begin with `prefix`. */
  others?(prefix: string): Promise<string[]>;
  remove?(name: string): Promise<void>;
}

export interface PersistenceClaim {
  readonly name: string;
  release(): Promise<void>;
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
const ephemeral = new WeakSet<Persistence>();

/** The opener `createLocalClient` takes on the web. */
export function webDevice(options: WebDeviceOptions = {}): DeviceOpener {
  const persist = options.persist ?? indexedDbPersistence();
  if (typeof persist.claim !== "function") throw new Error("webDevice: custom persistence must provide an exclusive claim(name, alternate) ownership contract");
  return {
    async open(name, backend) {
      ready ??= cachedWasm(options.wasm ?? new URL("./wasm/snapback4_device_bg.wasm", import.meta.url), persist)
        .catch((error) => { ready = null; throw error; });
      await ready;
      const store = await claimStore(persist, name, true);
      if (!store) throw new Error("webDevice: persistence could not claim an exclusive device store");
      const journal = new AdmissionJournal(store.name, true);
      const admissions = new Set<string>();
      const prepared = new WeakMap<Record<string, unknown>, ReturnType<AdmissionJournal["capture"]>>();
      const capture = (request: Record<string, unknown>) => {
        if (browserAdmission() && ephemeral.has(persist)) return admissionRefusal(
          "memoryPersistence() cannot keep admitted writes across page restarts", "client.mutate",
          "use webDevice() with its default IndexedDB persistence on the web");
        try { prepared.set(request, journal.capture(request)); }
        catch (error) { if (error instanceof AdmissionError) return error.why; throw error; }
        return undefined;
      };
      let device: WebDevice | undefined;
      let needsRecovery = true;
      // A lock can release during opening; recovery must wait for restore/adoption.
      let opened!: () => void;
      let chain: Promise<unknown> = new Promise<void>(resolve => { opened = resolve; });
      let closing: Promise<void> | undefined;
      let orphanRetry: ReturnType<typeof setTimeout> | undefined;
      let retryCount = 0;
      const waiting = new Map<string, AbortController>();
      const outboxListeners = new Set<(issuedFloor?: number) => void>();
      const recoverInBackground = () => {
        chain = chain.then(() => run(async () => {
          if (closing) return;
          try { if (!device) await restore(); await recoverOpening(); await recoverOrphans(); }
          catch { discard(); retryOrphans(); }
        }));
      };
      // Persistence failures get three backed-off attempts. Structurally
      // unresolved journals wait for the next open/identity/sync signal.
      const retryOrphans = () => {
        if (closing || orphanRetry || retryCount === 3) return;
        orphanRetry = setTimeout(() => {
          orphanRetry = undefined;
          recoverInBackground();
        }, 1000 * 2 ** retryCount++);
        (orphanRetry as { unref?: () => void }).unref?.();
      };
      // @ref LLP 3000.007#20.4 — wait for ownership without polling or holding up foreground calls.
      const waitForLock = (name: string) => {
        // This known claim implementation uses these Web Locks. Other providers
        // retry on open/sync; an unrelated free lock is not a release signal.
        if (persist.claim !== claimWithWebLocks) return;
        const locks = lockManager();
        if (!locks || closing || waiting.has(name)) return;
        const controller = new AbortController();
        waiting.set(name, controller);
        // The request is only a release signal. Recovery runs after it releases
        // the lock, on the device chain, and rechecks the stores still present.
        void locks.request(name, { signal: controller.signal }, () => {}).then(() => {
          waiting.delete(name);
          if (!controller.signal.aborted && !closing) recoverInBackground();
        }, () => { waiting.delete(name); });
      };
      const stopRecovery = () => {
        clearTimeout(orphanRetry);
        for (const controller of waiting.values()) controller.abort();
        waiting.clear();
      };
      const recoverOrphans = async () => {
        const retry = await adoptOrphans(device!, name, store.name, persist, settle, waitForLock, journal.authority);
        if (retry) retryOrphans();
      };
      // Committed outbox entries, mirrored from persisted changes, so a page
      // being hidden can send what IndexedDB already holds.
      const committed = new Map<string, Queued>();
      const committedListeners = new Set<() => void>();
      let working = false;
      let publishPending = false;
      const publishCommitted = () => {
        // Transport may acquire the session lock. Run it only after admission
        // (including its strict IDB commit) has released that lock.
        if (working) { publishPending = true; return; }
        publishPending = false;
        for (const notify of committedListeners) notify();
      };
      const run = async <T>(work: () => Promise<T>): Promise<T> => {
        working = true;
        try { return await work(); }
        finally { working = false; if (publishPending) publishCommitted(); }
      };
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
      const settle = async (extra: Change[] = [], committedReply?: () => void): Promise<void> => {
        const changes = [...JSON.parse(device!.drain()) as Change[], ...journal.cleanup(committed), ...extra];
        let issuedFloor: number | undefined;
        for (const change of changes) if (change.s === "o" && change.v !== null) {
          const now = (JSON.parse(change.v) as { now?: number }).now;
          if (Number.isSafeInteger(now) && now! >= 0) issuedFloor = Math.max(issuedFloor ?? 0, now!);
        }
        if (changes.length) await persist.save(store.name, changes);
        // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — the durable result reaches invalidation before any fallible host bookkeeping or recovery.
        committedReply?.();
        // Every outbox commit, including deferred journal replay, reaches the
        // live clock before the serialized chain can stamp another admission.
        if (issuedFloor !== undefined) for (const notify of outboxListeners) notify(issuedFloor);
        if (changes.length) {
          remember(changes);
          journal.cleanup(committed);
          // An unawaited mutate may finish admission after pagehide. Recheck
          // the suspended page only once its outbox transaction has committed.
          if (changes.some(change => change.s === "o")) publishCommitted();
        }
      };
      const restore = async (backend?: DeviceOpening | null): Promise<void> => {
        const saved = await persist.load(store.name);
        device = new WebDevice(backend ? JSON.stringify(backend) : null, JSON.stringify(saved.filter(c => c.s !== "j")));
        journal.load(saved);
        committed.clear();
        remember(saved);
        journal.fence(device);
        await settle();
        needsRecovery = true;
      };
      const recoverOpening = async (): Promise<void> => {
        if (!needsRecovery) return;
        // Commit orphan admission floors before recovering this tab's journal.
        await recoverOrphans();
        await journal.recover(device!, settle, admissions);
        needsRecovery = false;
      };
      try {
        await restore(backend);
      } catch (error) {
        closing = Promise.resolve();
        stopRecovery();
        try { discard(); } finally { await store.release(); }
        throw new Error(refusalText(error));
      } finally { opened(); }
      const suspendListeners = new Set<() => void>();
      const core: DeviceCore = {
        onOutbox(listener) { outboxListeners.add(listener); return () => { outboxListeners.delete(listener); }; },
        onSuspend(flush) {
          if (typeof window === "undefined" || typeof document === "undefined") return () => {};
          const page = window, doc = document;
          let suspended = doc.visibilityState === "hidden";
          const beginSend = (id: string) => {
            if (closing || !device || !committed.has(id) || journal.binding(device, id) !== "allow") return false;
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
            const entries: PendingSend[] = [...committed.values()].filter(e => successSequence(e) == null).sort((a, b) => a.seq - b.seq)
              .map(e => ({ id: e.id, op: e.op, args: e.args, newIds: e.new_ids, store_id: e.receipt_store?.id ?? journal.boundStore(e.id) ?? undefined }));
            if (entries.length) flush(entries, () => beginSend(entries[0]!.id));
          };
          const suspend = () => { suspended = true; publishCommitted(); };
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
          if (suspended) publishCommitted();
          return stop;
        },
        media: {
          async read(id) { return persist.read ? persist.read(`snapback4-media:${store.name}`, "a", id) : (await persist.load(`snapback4-media:${store.name}`)).find((c) => c.k === id)?.v ?? null; },
          async write(id, hex) { await persist.save(`snapback4-media:${store.name}`, [{ s: "a", k: id, v: hex }]); },
          async remove(id) { await persist.save(`snapback4-media:${store.name}`, [{ s: "a", k: id, v: null }]); },
        },
        call(request, committedReply) {
          if (closing) return Promise.reject(new Error("the device is closed"));
          if (request.op === "admit" && !prepared.has(request)) {
            const denied = capture(request);
            if (denied) return Promise.resolve({ denied });
          }
          const admission = prepared.get(request);
          prepared.delete(request);
          if (admission) { request = { ...request, entry: admission.entry }; admissions.add(admission.entry.id); }
          const answer = chain.then(() => run(async () => {
            try {
              // @ref LLP 3000.008.004#3 — publish only after persistence;
              // a failed call discards its uncommitted memory. Reopen lazily
              // on the kept backend, with no store copy on successful calls.
              if (!device) await restore();
              await recoverOpening();
              if (request.op === "admit") await journal.recover(device!, settle, admissions);
              const execute = async (): Promise<Record<string, unknown>> => {
                if (request.op === "settle_exit") {
                  const write = request.write as Extract<Write, { state: "failed" }>;
                  const invoke = (input: Record<string, unknown>) => JSON.parse(device!.call(JSON.stringify(input)));
                  // The exclusive claim and device chain cover this entire
                  // read/check/write transaction. Drain once: the strict IDB
                  // commit holds the receipt, outbox removal and journal cleanup.
                  const history = terminalReceipts(invoke({ op: "meta", key: "write-history" }).ok);
                  const entry = invoke({ op: "queued" }).ok.find((entry: { id: string }) => entry.id === write.id);
                  if (history.some(known => known.id === write.id) || !entry || entry.sent_seq != null || entry.observed_seq != null) return { ok: false };
                  const kept = invoke({ op: "keep_write", value: JSON.stringify({ state: "failed", id: write.id, why: {
                    code: write.why.code, family: write.why.family,
                    message: `write refused: ${write.why.code}; whether it executed is unknown; do not retry automatically`,
                  } }) });
                  if (kept.denied) return kept;
                  const retired = invoke({ op: "settle", id: write.id });
                  if (retired.denied) throw new Error(retired.denied.message);
                  const reply = { ok: true };
                  await settle([], () => committedReply?.(reply));
                  return reply;
                }
                if (request.op === "begin_send" && typeof request.id === "string") {
                  const entry = committed.get(request.id), seq = entry?.sent_seq ?? entry?.observed_seq;
                  // An acknowledgement may commit while receipt preflight waits.
                  // Return that custody from the serialized final send check.
                  if (seq != null) {
                    const qualified = successSequence(entry) === seq;
                    if (!qualified) {
                      // Legacy custody still needs a same-id POST. Invalidate
                      // any in-flight sync before allowing that replay.
                      const started = JSON.parse(device!.call(JSON.stringify({ op: "begin_send" })));
                      if (started.denied) return started;
                      await settle();
                    }
                    return { ok: { receipt: { state: "sent", id: request.id, seq, replayed: true }, qualified } };
                  }
                  const binding = journal.binding(device!, request.id);
                  if (!committed.has(request.id) || binding !== "allow") {
                    journal.fence(device!);
                    await settle();
                    return { denied: bindingRefusal(binding === "defer" ? "defer" : "retire") };
                  }
                }
                const reply = request.op === "admit" ? journal.admit(device!, request.entry, admission?.storeId) : JSON.parse(device!.call(JSON.stringify(request))) as Record<string, unknown>;
                if (request.op === "queued" && Array.isArray(reply.ok)) {
                  reply.ok = reply.ok.map(entry => ({ ...entry, store_id: entry.receipt_store?.id ?? journal.boundStore(entry.id) }));
                }
                const observesStore = request.op === "observe_store" || request.op === "apply";
                if (!reply.denied && (observesStore || request.op === "adopt")) journal.fence(device!);
                try {
                  await settle(!admission ? [] : !reply.denied ? [journal.transfer(admission, false)] : writeRefusal(reply) ? journal.refused(admission) : [], () => committedReply?.(reply));
                } catch (error) {
                  if (!admission || !writeRefusal(reply)) throw error;
                  // The refusal is known even when both cancellation stores fail.
                  // Discard any uncommitted memory; the docs call recovery indeterminate.
                  discard();
                  return reply;
                }
                return reply;
              };
              const reply = admission ? await journal.authorize(admission, execute, async () => {
                const denied = { denied: admissionAuthorityRefusal() };
                await settle(journal.refused(admission), () => committedReply?.(denied));
                return denied;
              }) : await execute();
              const observesStore = request.op === "observe_store" || request.op === "apply";
              if (!reply.denied && (request.op === "adopt" || observesStore)) {
                await recoverOrphans();
                await journal.recover(device!, settle, admissions);
              }
              if (request.op === "meta" && request.key === "write-history" && !reply.denied) {
                // Read through on every lookup: a sibling may have recovered a
                // receipt after this client opened. Never copy it into this VM.
                // Settlement reads this device's receipts first; only a
                // caller's lookup (`lookup: true`) takes a shared correction.
                const shared = await receiptHistory(persist, name), local = terminalReceipts(reply.ok as string | null);
                reply.ok = JSON.stringify(request.lookup === true ? lookupReceipts(shared, local) : localFirst(shared, local));
              }
              return reply;
            } catch (error) {
              discard();
              throw error;
            } finally { if (admission) admissions.delete(admission.entry.id); }
          }));
          chain = answer.catch(() => undefined);
          return answer;
        },
        close() {
          stopRecovery();
          outboxListeners.clear();
          for (const stop of suspendListeners) stop();
          return closing ??= chain.then(async () => {
            try { discard(); } finally { await store.release(); }
          });
        },
      };
      admissionHost(core, capture);
      admissionAuthorityHost(core, context => {
        // Local-client construction attaches app ownership before its first
        // device call. Recover here, without waiting for any network sync.
        journal.authority = context;
        chain = chain.then(() => run(recoverOpening)).catch(error => { discard(); throw error; });
      });
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

function lockManager(): LockManager | undefined {
  return (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;
}

/** Hold the store's lock for this tab; when another tab holds it, take a
 * tab-scoped store instead. Durable IndexedDB refuses when Web Locks cannot
 * establish exclusive ownership. */
async function claimWithWebLocks(name: string, alternate: boolean): Promise<PersistenceClaim | null> {
  const locks = lockManager();
  if (!locks) throw new Error("webDevice: durable IndexedDB requires the Web Locks API for exclusive store ownership");
  const held = await hold(locks, name);
  if (held) return { name, release: held };
  if (!alternate) return null;
  const own = `${name}:tab-${Math.random().toString(36).slice(2, 10)}`;
  const release = await hold(locks, own);
  if (!release) throw new Error("webDevice: could not claim an exclusive tab-scoped device store");
  return { name: own, release };
}

async function claimStore(persist: Persistence, name: string, alternate: boolean): Promise<PersistenceClaim | null> {
  const claim = await persist.claim(name, alternate);
  if (!claim) return null;
  let problem: string | undefined;
  if (typeof claim.name !== "string" || typeof claim.release !== "function") {
    problem = "persistence returned an invalid exclusive claim";
  } else if (!alternate && claim.name !== name) {
    problem = `a non-alternate claim for ${name} must return that exact name`;
  } else if (claim.name !== name && (!claim.name.startsWith(`${name}:tab-`) || claim.name.length === `${name}:tab-`.length)) {
    problem = `an alternate claim for ${name} must use the ${name}:tab-* namespace`;
  } else if (claim.name !== name && (typeof persist.others !== "function" || typeof persist.remove !== "function")) {
    problem = "a persistence provider returning an alternate must implement others(prefix) and remove(name) for orphan adoption";
  }
  if (!problem) return claim;
  if (typeof claim.release === "function") await claim.release();
  throw new Error(`webDevice: ${problem}`);
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
async function adoptOrphans(device: WebDevice, name: string, own: string, persist: Persistence, settle: (extra?: Change[]) => Promise<void>, waitForLock: (name: string) => void, authority?: AdmissionAuthorityContext): Promise<boolean> {
  if (!persist.others || !persist.remove) return false;
  let retry = false;
  const orphanPrefix = `${name}:tab-`;
  const stores = new Set(await persist.others(orphanPrefix));
  for (const orphan of new Set([...stores, ...journalStores(orphanPrefix)])) {
    if (!orphan.startsWith(orphanPrefix)) continue;
    if (orphan === own) continue;
    // The validated provider claim owns the store; IndexedDB takes its Web Lock.
    // A queued background request signals release; no timer polls live tabs.
    const held = await claimStore(persist, orphan, false);
    if (!held) { waitForLock(orphan); continue; }
    let destinationDirty = false;
    try {
      // @ref LLP 3000.007#18.2 — orphan receipts retain their source store until ownership can be resolved.
      // A journal can outlive its database. Loading a missing IDB store would
      // create it, without recovering the identity needed to admit its journal.
      if (!stores.has(orphan) && !await persist.has?.(orphan)) continue;
      let saved = await persist.load(orphan);
      const state = JSON.parse(device.call(JSON.stringify({ op: "sync_state", capture: false }))).ok;
      const destination = state?.store_id;
      if (journalStores(`${name}:tab-`).includes(orphan)) {
        // An evicted/unidentified store cannot establish the journal's owner.
        // Leave it intact for a later matching open; never guess from the key.
        if (!saved.some(c => c.s === "m" && c.k === "device:store_id" && c.v) || !saved.some(c => c.s === "m" && c.k === "device:backend" && c.v)) continue;
        const sourceJournal = new AdmissionJournal(orphan, true);
        sourceJournal.authority = authority;
        sourceJournal.load(saved);
        const sourceDevice = new WebDevice(null, JSON.stringify(saved.filter(c => c.s !== "j")));
        try {
          const sourceState = JSON.parse(sourceDevice.call(JSON.stringify({ op: "sync_state", capture: false }))).ok;
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
      // @ref LLP 3000.007#20.4 — terminal recovery has shared custody; only an outbox transfers exclusive ownership.
      // Commit the shared receipt window BEFORE any source can be removed.
      // A busy receipt writer leaves this whole source intact for the retry.
      const history = saved.find(c => c.s === "m" && c.k === "client:write-history")?.v;
      if (history && !await shareReceipts(persist, name, history)) { waitForLock(`${name}:receipts`); continue; }
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
        const binding = journalStoreBinding(transfer?.storeId, destination);
        if (binding === "defer") { unresolved = true; continue; }
        if (binding === "retire") { removed.push({ s: "o", k: entry.id, v: null }); continue; }
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
      await settle(saved.filter(c => c.s === "j" && !entries.some(e => e.id === c.k && !removed.some(r => r.k === e.id))));
      destinationDirty = false;
      if (unresolved || journalStores(`${name}:tab-`).includes(orphan)) { if (removed.length) await persist.save(orphan, removed); }
      else await persist.remove(orphan);
    } catch (error) {
      // A broken orphan stays intact and must not prevent opening healthy stores.
      // A destination commit failure still requires the caller to discard its VM.
      if (destinationDirty) throw error;
      retry = true;
    } finally {
      await held.release();
    }
  }
  return retry;
}

type TerminalReceipt = Exclude<Write, { state: "pending" }>;

function terminalReceipts(text: string | null | undefined): TerminalReceipt[] {
  if (!text) return [];
  // Only value-free terminal records cross tab boundaries, never outbox data.
  return (JSON.parse(text) as Write[]).flatMap(write => write.state === "sent"
    ? [{ state: "sent", id: write.id, seq: write.seq, replayed: true } as TerminalReceipt]
    : write.state === "failed" ? [{ state: "failed", id: write.id, why: { code: write.why.code, family: write.why.family, message: `write refused: ${write.why.code}` } } as TerminalReceipt] : []);
}

async function receiptHistory(persist: Persistence, name: string): Promise<TerminalReceipt[]> {
  const shared = `${name}:receipts`;
  // Adoption requires enumeration too. Recheck existence on each lookup so a
  // sibling's later adoption is visible, but a read never creates the window.
  const exists = persist.has ? await persist.has(shared) : (await persist.others?.(shared))?.includes(shared);
  if (!exists) return [];
  const text = persist.read ? await persist.read(shared, "m", "client:write-history")
    : (await persist.load(shared)).find(c => c.s === "m" && c.k === "client:write-history")?.v;
  return terminalReceipts(text);
}

const unknownOutcome = (write: TerminalReceipt) => write.state === "failed" && write.why.code === "E_STORE_REPLACED";

const localFirst = (shared: TerminalReceipt[], local: TerminalReceipt[]) => [...new Map([...shared, ...local].map(write => [write.id, write])).values()];

// @ref LLP 3000.013#6 — a caller's lookup applies adoption's correction rule.
// A shared, verified outcome resolves this client's own unknown replacement
// refusal; every other local outcome wins over shared history.
function lookupReceipts(shared: TerminalReceipt[], local: TerminalReceipt[]): TerminalReceipt[] {
  const merged = new Map(shared.map(write => [write.id, write]));
  for (const write of local) {
    const prior = merged.get(write.id);
    if (prior && unknownOutcome(write) && !unknownOutcome(prior)) continue;
    merged.set(write.id, write);
  }
  return [...merged.values()];
}

async function shareReceipts(persist: Persistence, name: string, text: string): Promise<boolean> {
  const held = await claimStore(persist, `${name}:receipts`, false);
  if (!held) return false;
  try {
    const kept = await receiptHistory(persist, name);
    const positions = new Map(kept.map((write, index) => [write.id, index]));
    for (const write of terminalReceipts(text)) {
      const index = positions.get(write.id);
      if (index === undefined) { positions.set(write.id, kept.length); kept.push(write); }
      // @ref LLP 3000.013#6 — a verified outcome resolves replacement's unknown
      // execution. The source device already validated the correction before
      // persisting it; adoption must keep it before deleting that source.
      else {
        const prior = kept[index]!;
        if (unknownOutcome(prior)) kept[index] = write;
      }
    }
    // Corrections retain their position; authored outcomes remain immutable.
    await persist.save(`${name}:receipts`, [{ s: "m", k: "client:write-history", v: JSON.stringify(kept.slice(-WRITE_HISTORY_LIMIT)) }]);
    return true;
  } finally { await held.release(); }
}

// ----- persistence -----

/** IndexedDB keeps each device call atomic and strictly durable. */
export function indexedDbPersistence(): Persistence { return indexedDbStore(claimWithWebLocks); }

/** Memory: what a test keeps between opens. */
export function memoryPersistence(): Persistence & { readonly stores: Map<string, Map<string, Change>> } {
  const stores = new Map<string, Map<string, Change>>();
  const held = new Set<string>();
  let alternate = 0;
  const provider: Persistence & { readonly stores: Map<string, Map<string, Change>> } = {
    stores,
    async has(name) { return stores.has(name); },
    async claim(name, allowAlternate) {
      let own = name;
      if (held.has(own) && !allowAlternate) return null;
      while (held.has(own)) own = `${name}:tab-memory-${++alternate}`;
      held.add(own);
      let released = false;
      return { name: own, async release() { if (!released) { released = true; held.delete(own); } } };
    },
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
  ephemeral.add(provider);
  return provider;
}

// @ref LLP 3000.002#browser-startup-loading — separate initial page code from device opening without changing local execution.
import type { DeviceOpener } from "./local-device.ts";
import type { WasmSource } from "./web-wasm.ts";
import { indexedDbStore } from "./web-idb.ts";
import { claimWithWebLocks } from "./web-ownership.ts";
export { indexedDbPersistence, memoryPersistence } from "./web-persistence.ts";

/** One change the device reported: the store (`r` rows, `m` metadata, `o`
 * outbox, `b` confirmed images, `s` staged snapshot), the key, the value;
 * null removes. The web host also persists `j` admission/exit acknowledgements,
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
  /** Optional supplementary collection: test current at the transaction's
   * commit point; false writes nothing. A missing method under-reports. */
  saveIfCurrent?(name: string, changes: Change[], current: () => boolean): Promise<boolean>;
  /** The stores held whose names begin with `prefix`. */
  others?(prefix: string): Promise<string[]>;
  remove?(name: string): Promise<void>;
}

export interface PersistenceClaim {
  readonly name: string;
  release(): Promise<void>;
}

export interface WebDeviceOptions {
  /** Run the browser VM and default IndexedDB persistence in a dedicated
   * Worker. Custom persistence remains available on the ordinary host. */
  readonly worker?: boolean;
  /** The wasm: a URL, a Response, bytes or a compiled module. By default
   * `snapback4_device_bg.wasm` beside this module, which bundlers copy. */
  readonly wasm?: WasmSource | Promise<WasmSource>;
  /** IndexedDB by default; `memoryPersistence()` for tests. */
  readonly persist?: Persistence;
}

/** Construct the opener without loading the interpreter or its host. The
 * existing engine preflight/open lifecycle owns their first use. */
export function webDevice(options: WebDeviceOptions = {}): DeviceOpener {
  const worker = !!options.worker;
  if (worker && options.persist) throw new Error("webDevice: worker:true uses default IndexedDB; use webDevice({ persist }) for an injected persistence provider");
  const persist = options.persist ?? indexedDbStore(claimWithWebLocks, true);
  if (!worker && typeof persist.claim !== "function") throw new Error("webDevice: custom persistence must provide an exclusive claim(name, alternate) ownership contract");
  let opening: Promise<DeviceOpener> | undefined;
  const runtime = () => opening ??= import("./web-runtime.ts")
    .then(({ openWebDevice }) => openWebDevice(options, persist, worker))
    .catch(error => { opening = undefined; throw error; });
  return {
    // @ref LLP 3000.002.000#5.2 — only proven absence permits reads before device recovery.
    async custody(name) {
      // An injected provider has no portable read of its live claims. Refuse
      // to infer empty custody from a missing optional method or engine.
      if (options.persist) return "unknown";
      try {
        if (!globalThis.indexedDB?.databases || !globalThis.navigator?.locks?.query || !globalThis.localStorage) return "unknown";
        const matches = (candidate: string) => candidate === name || candidate.startsWith(`${name}:tab-`);
        const locks = await navigator.locks.query();
        if ([...(locks.held ?? []), ...(locks.pending ?? [])].some(lock => lock.name && (matches(lock.name)
          || lock.name.startsWith("snapback4-worker:") && matches(decodeURIComponent(lock.name.slice("snapback4-worker:".length)))))) return "present";
        // Any device database counts, including legacy layouts, ownership,
        // outbox and acknowledgement records. Never open/upgrade it here.
        if ((await indexedDB.databases()).some(db => db.name && matches(db.name))) return "present";
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith("snapback4-admission:")) continue;
          if (matches(decodeURIComponent(key.slice("snapback4-admission:".length).split(":")[0]!))) return "present";
        }
        return "none";
      } catch { return "unknown"; }
    },
    async engineInfo() { return (await runtime()).engineInfo!(); },
    async open(name, backend) { return (await runtime()).open(name, backend); },
  };
}

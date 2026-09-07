import { imageState } from '../../../evaluator/src/row-image.js';
import { preparedProjection, jsonState } from "./range-store.js";
import type { ChangedRecords } from "./swap-journal.js";
import {
  OfflineStoreFailure,
  PersistentRangeStore,
  type PersistedRangeState,
  type PrincipalPartition,
  type RangeStoreBackend,
  type RangeStoreFactory,
} from "./range-store.js";
import type { ByteDelta } from "./byte-cache.js";
import { ProjectionCache, unprojectState, type StateEntry as Entry } from "./projection.js";

// @ref LLP 1012#4-the-range-store — the carrier holds exactly what `coverage()`
// reads back: rows, answers (their receipts inside), the outbox, and the meta
// record. The version-1 `ranges`/`absences`/`verdicts` projections were written
// and never read; version 3 deletes them so nothing on the device looks
// authoritative without being the source.
const STORE_NAMES = ["rows", "answers", "outbox", "meta"] as const;
const LEGACY_STORES = ["ranges", "absences", "verdicts"] as const;
/** Byte payloads are keyed by `byteKey` and changed by delta, never cleared with the state stores. */
const BYTES_STORE = "bytes";
const ALL_STORES = [...STORE_NAMES, BYTES_STORE];
const DATABASE_VERSION = 3;

interface WebLockLike { readonly name?: string }
interface WebLocksLike {
  request<T>(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: WebLockLike | null) => Promise<T> | T,
  ): Promise<T>;
}

export interface IndexedDbRangeStoreOptions {
  indexedDB?: IDBFactory;
  locks?: WebLocksLike;
  databasePrefix?: string;
  /**
   * Witness barrier: awaited with the next state before its readwrite
   * transaction opens, so a harness can kill the profile between two swaps
   * and prove the carrier lands whole swaps or nothing (LLP 1012 §10).
   */
  beforeReplace?: (state: PersistedRangeState) => void | Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      for (const store of ALL_STORES) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: "key" });
      }
      for (const store of LEGACY_STORES) {
        if (request.result.objectStoreNames.contains(store)) request.result.deleteObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open was blocked"));
  });
}

function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed"));
    request.onblocked = () => reject(new Error("IndexedDB delete was blocked"));
  });
}

class IndexedDbBackend implements RangeStoreBackend {
  readonly [preparedProjection] = true as const;
  readonly carrier = "IndexedDB";
  private database?: IDBDatabase;
  private databaseName?: string;
  private releaseLock?: () => void;
  private lockedPartition?: PrincipalPartition;
  private lockRequest?: Promise<unknown>;
  /** Withdraws a still-queued waiting request when the carrier closes. */
  private pendingAbort?: AbortController;
  private readonly projection = new ProjectionCache();

  constructor(
    private readonly factory: IDBFactory,
    private readonly locks: WebLocksLike,
    private readonly prefix: string,
    private readonly beforeReplace?: IndexedDbRangeStoreOptions["beforeReplace"],
  ) {}

  // @ref LLP 1018#3-move-one-one-coherent-reactive-client — a second tab
  // waits for the partition's writer lock instead of refusing; it inherits the
  // partition, and the queue the writer left, when that tab closes.
  async acquire(partition: PrincipalPartition, signal?: AbortSignal): Promise<void> {
    if (this.lockedPartition === partition) return;
    await this.releaseHeldLock();
    await this.acquireLock(partition, signal ? { signal } : {});
  }

  /** A lock won by `acquire` that no open uses goes back; a request another wait has queued is not touched. */
  async giveBack(partition: PrincipalPartition): Promise<void> {
    if (this.lockedPartition !== partition || this.database) return;
    const request = this.lockRequest;
    this.releaseLock?.();
    this.releaseLock = undefined;
    this.lockedPartition = undefined;
    this.lockRequest = undefined;
    if (request) await request.catch(() => undefined);
  }

  async open(partition: PrincipalPartition): Promise<PersistedRangeState | undefined> {
    this.closeDatabase();
    const databaseName = `${this.prefix}${partition}`;
    if (this.lockedPartition !== partition) {
      await this.releaseHeldLock();
      await this.acquireLock(partition, { ifAvailable: true });
    }
    try {
      const database = await openDatabase(this.factory, databaseName);
      this.database = database;
      this.databaseName = databaseName;
      const transaction = database.transaction(STORE_NAMES as unknown as string[], "readonly");
      // Queue every request before awaiting: IndexedDB may auto-commit at the next task.
      const rowsRequest = transaction.objectStore("rows").getAll() as IDBRequest<Entry[]>;
      const answersRequest = transaction.objectStore("answers").getAll() as IDBRequest<Entry[]>;
      const outboxRequest = transaction.objectStore("outbox").getAll() as IDBRequest<Entry[]>;
      const metaRequest = transaction.objectStore("meta").getAll() as IDBRequest<Entry[]>;
      const [rows, answers, outbox, meta] = await Promise.all([
        requestResult(rowsRequest), requestResult(answersRequest), requestResult(outboxRequest), requestResult(metaRequest),
        transactionDone(transaction),
      ]);
      const projected = { rows, answers, outbox, meta };
      this.projection.reset(projected);
      return unprojectState(projected);
    } catch (error) {
      await this.close();
      if (error instanceof OfflineStoreFailure) throw error;
      throw new OfflineStoreFailure(
        "E_OFFLINE_CARRIER",
        `IndexedDB carrier could not open ${databaseName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // @ref LLP 1012#4-the-range-store — one readwrite transaction spans the state
  // stores and the byte payloads, so a row and its bytes leave together or not at all.
  async replace(state: PersistedRangeState, bytes: ByteDelta, previous?: PersistedRangeState, changed?: ChangedRecords): Promise<void> {
    const database = this.database;
    if (!database) throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "IndexedDB carrier is not open");
    // All cloning/projection work is complete before the readwrite transaction opens.
    const { delta, committed } = this.projection.prepare(state, previous, changed);
    await this.beforeReplace?.(jsonState(imageState(state)));
    const transaction = database.transaction(ALL_STORES, "readwrite");
    try {
      for (const name of STORE_NAMES) {
        const store = transaction.objectStore(name);
        for (const key of delta[name].remove) store.delete(key);
        for (const value of delta[name].put) store.put(value);
      }
      if (bytes.remove.length > 0 || bytes.put.length > 0) {
        const store = transaction.objectStore(BYTES_STORE);
        for (const key of bytes.remove) store.delete(key);
        for (const item of bytes.put) store.put({ key: item.key, value: item.bytes });
      }
    } catch (error) {
      transaction.abort();
      throw error;
    }
    await transactionDone(transaction);
    committed();
  }

  async readBytes(key: string): Promise<Uint8Array | undefined> {
    const database = this.database;
    if (!database) return undefined;
    const transaction = database.transaction([BYTES_STORE], "readonly");
    const request = transaction.objectStore(BYTES_STORE).get(key) as IDBRequest<Entry | undefined>;
    const [entry] = await Promise.all([requestResult(request), transactionDone(transaction)]);
    const value = entry?.value;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return undefined;
  }

  async wipe(partition: PrincipalPartition): Promise<void> {
    const databaseName = `${this.prefix}${partition}`;
    if (this.databaseName === databaseName) await this.close();
    await deleteDatabase(this.factory, databaseName);
  }

  async close(): Promise<void> {
    this.closeDatabase();
    await this.releaseHeldLock();
  }

  private closeDatabase(): void {
    this.database?.close();
    this.database = undefined;
    this.databaseName = undefined;
    this.projection.reset();
  }

  /** Resolves once the lock manager has seen the release, so the next request (ours or another tab's) cannot race it. */
  private async releaseHeldLock(): Promise<void> {
    this.pendingAbort?.abort();
    this.pendingAbort = undefined;
    const request = this.lockRequest;
    this.releaseLock?.();
    this.releaseLock = undefined;
    this.lockedPartition = undefined;
    this.lockRequest = undefined;
    if (request) await request.catch(() => undefined);
  }

  /** `ifAvailable` refuses a held lock at once; a `signal` request waits until the holder releases it or the signal withdraws it. */
  private async acquireLock(partition: PrincipalPartition, options: { ifAvailable?: boolean; signal?: AbortSignal }): Promise<void> {
    let acquiredResolve!: () => void;
    let acquiredReject!: (error: unknown) => void;
    let releaseResolve!: () => void;
    const acquired = new Promise<void>((resolve, reject) => {
      acquiredResolve = resolve;
      acquiredReject = reject;
    });
    const released = new Promise<void>((resolve) => { releaseResolve = resolve; });
    // A waiting request is cancellable by the caller's signal and by this carrier closing.
    const pending = options.ifAvailable ? undefined : new AbortController();
    if (pending) {
      if (options.signal?.aborted) pending.abort();
      options.signal?.addEventListener("abort", () => pending.abort(), { once: true });
      this.pendingAbort = pending;
    }
    const request = this.locks.request(`snapback2:${partition}`, pending ? { signal: pending.signal } : { ifAvailable: true }, async (lock) => {
      if (!lock) {
        acquiredReject(new OfflineStoreFailure(
          "E_OFFLINE_LOCK",
          "this account is open in another tab",
        ));
        return;
      }
      if (pending?.signal.aborted) {
        // Granted and withdrawn in the same instant: hold nothing, and let the waiter see the withdrawal.
        const error = new Error("lock request aborted"); error.name = "AbortError";
        acquiredReject(error);
        return;
      }
      this.releaseLock = releaseResolve;
      this.lockedPartition = partition;
      acquiredResolve();
      await released;
    });
    void request.catch(acquiredReject);
    try { await acquired; }
    finally { if (this.pendingAbort === pending) this.pendingAbort = undefined; }
    this.lockRequest = request;
  }
}

/** The sole web carrier exported by `snapback2/react`. */
export function indexedDbRangeStore(options: IndexedDbRangeStoreOptions = {}): RangeStoreFactory {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const locks = options.locks ?? (typeof navigator === "undefined" ? undefined : navigator.locks);
  if (!factory || !locks || typeof locks.request !== "function") {
    const unavailable = (() => new PersistentRangeStore({
      carrier: "IndexedDB",
      open: async () => { throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "IndexedDB and Web Locks are required"); },
      replace: async () => { throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "IndexedDB is unavailable"); },
      wipe: async () => undefined,
      close: () => undefined,
    })) as RangeStoreFactory;
    Object.defineProperty(unavailable, "carrier", { value: "IndexedDB" });
    return unavailable;
  }
  const prefix = options.databasePrefix ?? "snapback2:";
  const create = (() => new PersistentRangeStore(new IndexedDbBackend(factory, locks, prefix, options.beforeReplace))) as RangeStoreFactory;
  Object.defineProperty(create, "carrier", { value: "IndexedDB" });
  return create;
}

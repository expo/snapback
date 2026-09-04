import {
  OfflineStoreFailure,
  PersistentRangeStore,
  type PersistedRangeState,
  type PrincipalPartition,
  type RangeStoreBackend,
  type RangeStoreFactory,
} from "./range-store.js";
import type { ByteDelta } from "./byte-cache.js";

const STORE_NAMES = ["rows", "answers", "ranges", "absences", "verdicts", "outbox", "meta"] as const;
/** Byte payloads are keyed by `byteKey` and changed by delta, never cleared with the state stores. */
const BYTES_STORE = "bytes";
const ALL_STORES = [...STORE_NAMES, BYTES_STORE];
const DATABASE_VERSION = 2;
type StoreName = typeof STORE_NAMES[number];
type Entry = { key: string; value: unknown };

interface WebLockLike { readonly name?: string }
interface WebLocksLike {
  request<T>(
    name: string,
    options: { ifAvailable: true },
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

function entries(record: Record<string, unknown>): Entry[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function record(values: Entry[]): Record<string, any> {
  return Object.fromEntries(values.map(({ key, value }) => [key, value]));
}

function projections(state: PersistedRangeState): Record<StoreName, Entry[]> {
  const ranges: Entry[] = [];
  const absences: Entry[] = [];
  const verdicts: Entry[] = [];
  for (const [answerKey, answer] of Object.entries(state.answers)) {
    for (const [index, value] of (answer.receipt?.ranges ?? []).entries()) {
      ranges.push({ key: `${answerKey}\u0000${index}`, value });
    }
    for (const [index, value] of (answer.receipt?.absences ?? []).entries()) {
      absences.push({ key: `${answerKey}\u0000${index}`, value });
    }
    for (const [index, value] of (answer.receipt?.verdicts ?? []).entries()) {
      verdicts.push({ key: `${answerKey}\u0000${index}`, value });
    }
  }
  return {
    rows: entries(state.rows),
    answers: entries(state.answers),
    ranges,
    absences,
    verdicts,
    outbox: entries(state.outbox),
    meta: [{
      key: "state",
      value: {
        version: state.version,
        sealed: state.sealed,
        clock: state.clock,
        watermarks: state.watermarks,
        grants: state.grants,
        ...(state.currentGrant === undefined ? {} : { currentGrant: state.currentGrant }),
        overlay: state.overlay,
        bounds: state.bounds,
        programs: state.programs,
        ...(state.facts === undefined ? {} : { facts: state.facts }),
        negative: state.negative,
        rowSeq: state.rowSeq,
        assets: state.assets,
        viewed: state.viewed,
      },
    }],
  };
}

class IndexedDbBackend implements RangeStoreBackend {
  readonly carrier = "IndexedDB";
  private database?: IDBDatabase;
  private databaseName?: string;
  private releaseLock?: () => void;

  constructor(
    private readonly factory: IDBFactory,
    private readonly locks: WebLocksLike,
    private readonly prefix: string,
    private readonly beforeReplace?: IndexedDbRangeStoreOptions["beforeReplace"],
  ) {}

  async open(partition: PrincipalPartition): Promise<PersistedRangeState | undefined> {
    await this.close();
    const databaseName = `${this.prefix}${partition}`;
    await this.acquireLock(partition);
    try {
      const database = await openDatabase(this.factory, databaseName);
      this.database = database;
      this.databaseName = databaseName;
      const transaction = database.transaction(STORE_NAMES as unknown as string[], "readonly");
      // Queue every request before awaiting: IndexedDB may auto-commit at the next task.
      const rowsRequest = transaction.objectStore("rows").getAll() as IDBRequest<Entry[]>;
      const answersRequest = transaction.objectStore("answers").getAll() as IDBRequest<Entry[]>;
      const outboxRequest = transaction.objectStore("outbox").getAll() as IDBRequest<Entry[]>;
      const metaRequest = transaction.objectStore("meta").get("state") as IDBRequest<Entry | undefined>;
      const [rows, answers, outbox, meta] = await Promise.all([
        requestResult(rowsRequest), requestResult(answersRequest), requestResult(outboxRequest), requestResult(metaRequest),
        transactionDone(transaction),
      ]);
      if (!meta && rows.length === 0 && answers.length === 0 && outbox.length === 0) return undefined;
      const value = meta?.value as Partial<PersistedRangeState> | undefined;
      return {
        version: 1,
        sealed: value?.sealed === true,
        clock: typeof value?.clock === "number" ? value.clock : 0,
        rows: record(rows),
        answers: record(answers),
        watermarks: value?.watermarks ?? {},
        outbox: record(outbox),
        grants: value?.grants ?? {},
        ...(typeof value?.currentGrant === "string" ? { currentGrant: value.currentGrant } : {}),
        overlay: value?.overlay ?? {},
        bounds: value?.bounds ?? {},
        programs: value?.programs ?? {},
        ...(value?.facts === undefined ? {} : { facts: value.facts }),
        negative: value?.negative ?? {},
        rowSeq: value?.rowSeq ?? {},
        assets: value?.assets ?? {},
        viewed: value?.viewed ?? {},
      };
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
  async replace(state: PersistedRangeState, bytes: ByteDelta): Promise<void> {
    const database = this.database;
    if (!database) throw new OfflineStoreFailure("E_OFFLINE_CARRIER", "IndexedDB carrier is not open");
    // All cloning/projection work is complete before the readwrite transaction opens.
    const projected = projections(state);
    await this.beforeReplace?.(state);
    const transaction = database.transaction(ALL_STORES, "readwrite");
    try {
      for (const name of STORE_NAMES) {
        const store = transaction.objectStore(name);
        store.clear();
        for (const value of projected[name]) store.put(value);
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
    this.database?.close();
    this.database = undefined;
    this.databaseName = undefined;
    this.releaseLock?.();
    this.releaseLock = undefined;
  }

  private async acquireLock(partition: PrincipalPartition): Promise<void> {
    let acquiredResolve!: () => void;
    let acquiredReject!: (error: unknown) => void;
    let releaseResolve!: () => void;
    const acquired = new Promise<void>((resolve, reject) => {
      acquiredResolve = resolve;
      acquiredReject = reject;
    });
    const released = new Promise<void>((resolve) => { releaseResolve = resolve; });
    const request = this.locks.request(`snapback2:${partition}`, { ifAvailable: true }, async (lock) => {
      if (!lock) {
        acquiredReject(new OfflineStoreFailure(
          "E_OFFLINE_LOCK",
          "this account is open in another tab",
        ));
        return;
      }
      this.releaseLock = releaseResolve;
      acquiredResolve();
      await released;
    });
    void request.catch(acquiredReject);
    await acquired;
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

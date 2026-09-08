// In-memory IndexedDB + Web Locks stand-ins shared by the offline suites.
// Models what the carrier and the durable inbox actually depend on: versioned
// upgrades, per-transaction snapshots of the transaction's own scope, the
// scheduling rule that serializes overlapping readwrite scopes across
// connections, `add` versus `put`, auto-increment keys assigned in commit
// order, connections that really close, `versionchange` and `blocked` on an
// upgrade or a deletion while another connection is open, an injectable put
// failure (per store, any store, or asynchronous abort), and inspection
// helpers (LLP 1018.004 §6).

export type Key = string | number;
export type Entry = { key?: Key; value: unknown };
type StoreData = Map<Key, Entry>;
type Stores = Map<string, StoreData>;

interface DatabaseRecord {
  name: string;
  version: number;
  stores: Stores;
  autoIncrement: Set<string>;
  counters: Map<string, number>;
  connections: Set<FakeDatabase>;
  /** Unfinished transactions in creation order; the scheduler starts them as their scopes free up. */
  transactions: FakeTransaction[];
}

function fakeError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** IndexedDB key order for the two key types the carrier uses: numbers before strings. */
function compareKeys(left: Key, right: Key): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "number") return -1;
  if (typeof right === "number") return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export class FakeRequest<T> {
  result!: T;
  error: Error | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;

  succeed(value: T): void {
    this.result = value;
    queueMicrotask(() => this.onsuccess?.());
  }

  fail(error: Error): void {
    this.error = error;
    queueMicrotask(() => this.onerror?.());
  }
}

export class FakeObjectStore {
  private readonly transaction: FakeTransaction;
  private readonly name: string;

  constructor(transaction: FakeTransaction, name: string) {
    this.transaction = transaction;
    this.name = name;
  }

  clear(): void {
    this.transaction.factory.writes.push({ store: this.name, action: "clear" });
    this.transaction.run(() => this.transaction.store(this.name).clear());
  }

  private write(entry: Entry, action: "put" | "add"): FakeRequest<Key> {
    const factory = this.transaction.factory;
    if (this.transaction.mode !== "readwrite") throw fakeError("ReadOnlyError", `${action} in a readonly transaction`);
    factory.writes.push({ store: this.name, action, key: entry.key });
    if (factory.failNextPutIn === this.name) {
      factory.failNextPutIn = undefined;
      throw new Error(`injected put failure in ${this.name}`);
    }
    if (factory.failNextPut) {
      factory.failNextPut = false;
      throw new Error("injected put failure");
    }
    const request = new FakeRequest<Key>();
    if (factory.abortNextPut) {
      factory.abortNextPut = false;
      this.transaction.abortWith(new Error("injected asynchronous put failure"));
      return request;
    }
    this.transaction.run(() => {
      const store = this.transaction.store(this.name);
      const copy = structuredClone(entry) as Entry;
      if (copy.key === undefined) {
        const key = this.transaction.nextKey(this.name);
        if (key === undefined) {
          const error = fakeError("DataError", `no key for ${this.name}`);
          request.fail(error); this.transaction.abortWith(error); return;
        }
        copy.key = key;
      }
      if (action === "add" && store.has(copy.key)) {
        const error = fakeError("ConstraintError", `key ${String(copy.key)} already exists in ${this.name}`);
        request.fail(error); this.transaction.abortWith(error); return;
      }
      store.set(copy.key, copy);
      request.succeed(copy.key);
    });
    return request;
  }

  put(entry: Entry): FakeRequest<Key> { return this.write(entry, "put"); }
  add(entry: Entry): FakeRequest<Key> { return this.write(entry, "add"); }

  delete(key: Key): FakeRequest<undefined> {
    if (this.transaction.mode !== "readwrite") throw fakeError("ReadOnlyError", "delete in a readonly transaction");
    this.transaction.factory.writes.push({ store: this.name, action: "delete", key });
    const request = new FakeRequest<undefined>();
    this.transaction.run(() => { this.transaction.store(this.name).delete(key); request.succeed(undefined); });
    return request;
  }

  getAll(): FakeRequest<Entry[]> {
    const request = new FakeRequest<Entry[]>();
    this.transaction.run(() => request.succeed([...this.transaction.store(this.name).values()]
      .sort((left, right) => compareKeys(left.key!, right.key!)).map((entry) => structuredClone(entry))));
    return request;
  }

  get(key: Key): FakeRequest<Entry | undefined> {
    const request = new FakeRequest<Entry | undefined>();
    this.transaction.run(() => {
      const entry = this.transaction.store(this.name).get(key);
      request.succeed(entry === undefined ? undefined : structuredClone(entry));
    });
    return request;
  }

  count(): FakeRequest<number> {
    const request = new FakeRequest<number>();
    this.transaction.run(() => request.succeed(this.transaction.store(this.name).size));
    return request;
  }
}

export class FakeTransaction {
  readonly factory: FakeIndexedDb;
  readonly mode: "readonly" | "readwrite";
  readonly scope: ReadonlySet<string>;
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;
  private readonly record: DatabaseRecord;
  /** The transaction's own snapshot of exactly its scope; a readwrite one writes those stores back on completion. */
  private readonly local: Stores = new Map();
  private readonly queued: Array<() => void> = [];
  private started = false;
  private finished = false;
  private aborted = false;

  constructor(factory: FakeIndexedDb, record: DatabaseRecord, names: readonly string[], mode: "readonly" | "readwrite") {
    this.factory = factory;
    this.record = record;
    this.mode = mode;
    this.scope = new Set(names);
    record.transactions.push(this);
    factory.schedule(record);
  }

  /** IndexedDB scheduling: a transaction starts once no earlier unfinished transaction overlaps its scope, unless both are readonly. */
  canStart(): boolean {
    if (this.started || this.finished) return false;
    for (const other of this.record.transactions) {
      if (other === this) return true;
      if (other.finished) continue;
      if (this.mode === "readonly" && other.mode === "readonly") continue;
      for (const name of this.scope) if (other.scope.has(name)) return false;
    }
    return true;
  }

  start(): void {
    this.started = true;
    for (const name of this.scope) {
      const values = this.record.stores.get(name) ?? new Map<Key, Entry>();
      this.local.set(name, new Map([...values].map(([key, value]) => [key, structuredClone(value)])));
    }
    for (const op of this.queued.splice(0)) if (!this.aborted) op();
    setTimeout(() => this.finish(), 0);
  }

  /** Runs now when started, else once the scheduler starts this transaction (requests are queued, as the browser does). */
  run(op: () => void): void {
    if (this.aborted) return;
    if (this.started) op(); else this.queued.push(op);
  }

  nextKey(name: string): Key | undefined {
    if (!this.record.autoIncrement.has(name)) return undefined;
    const key = this.record.counters.get(name) ?? 1;
    this.record.counters.set(name, key + 1);
    return key;
  }

  store(name: string): StoreData {
    if (!this.scope.has(name)) throw fakeError("NotFoundError", `object store ${name} is not in this transaction's scope`);
    return this.local.get(name)!;
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.scope.has(name)) throw fakeError("NotFoundError", `object store ${name} is not in this transaction's scope`);
    return new FakeObjectStore(this, name);
  }

  abort(): void {
    if (this.aborted) return;
    this.abortWith(fakeError("AbortError", "transaction aborted"));
  }

  abortWith(error: Error): void {
    if (this.aborted || this.finished) return;
    this.aborted = true;
    this.finished = true;
    this.error = error;
    this.release();
    queueMicrotask(() => this.onabort?.());
  }

  private finish(): void {
    if (this.aborted || this.finished) return;
    if (this.mode === "readwrite") for (const [name, values] of this.local) this.record.stores.set(name, values);
    this.finished = true;
    this.release();
    this.oncomplete?.();
  }

  private release(): void {
    const at = this.record.transactions.indexOf(this);
    if (at >= 0) this.record.transactions.splice(at, 1);
    this.factory.schedule(this.record);
    // A deletion or upgrade waiting only on in-flight transactions proceeds once they end.
    this.factory.settle(this.record);
  }
}

export class FakeDatabase {
  readonly objectStoreNames: { contains(name: string): boolean };
  readonly factory: FakeIndexedDb;
  readonly name: string;
  onversionchange: (() => void) | null = null;
  private readonly record: DatabaseRecord;
  private closed = false;

  constructor(factory: FakeIndexedDb, record: DatabaseRecord) {
    this.factory = factory;
    this.record = record;
    this.name = record.name;
    this.objectStoreNames = { contains: (name: string) => record.stores.has(name) };
  }

  get version(): number { return this.record.version; }
  get stores(): Stores { return this.record.stores; }

  createObjectStore(name: string, options: { keyPath?: string; autoIncrement?: boolean } = {}): void {
    this.record.stores.set(name, new Map());
    if (options.autoIncrement) { this.record.autoIncrement.add(name); this.record.counters.set(name, 1); }
  }

  deleteObjectStore(name: string): void {
    this.record.stores.delete(name);
    this.record.autoIncrement.delete(name);
    this.record.counters.delete(name);
  }

  transaction(names: string | readonly string[], mode: "readonly" | "readwrite" = "readonly"): FakeTransaction {
    if (this.closed) throw fakeError("InvalidStateError", "the database connection is closing");
    const scope = typeof names === "string" ? [names] : [...names];
    for (const name of scope) {
      if (!this.record.stores.has(name)) throw fakeError("NotFoundError", `no object store ${name}`);
    }
    return new FakeTransaction(this.factory, this.record, scope, mode);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.record.connections.delete(this);
    this.factory.settle(this.record);
  }
}

export class FakeIndexedDb {
  readonly writes: Array<{ store: string; action: "put" | "add" | "delete" | "clear"; key?: Key }> = [];
  /** The next `put` into this object store throws, aborting its transaction. */
  failNextPutIn?: string;
  /** The next `put` into any object store throws synchronously. */
  failNextPut = false;
  /** The next `put` aborts its transaction asynchronously instead of throwing. */
  abortNextPut = false;
  /** Every `versionchange` and `blocked` the fake dispatched, for lifecycle assertions. */
  readonly events: Array<{ database: string; event: "versionchange" | "blocked"; reason: "upgrade" | "delete" }> = [];
  private readonly databases = new Map<string, DatabaseRecord>();
  /** Upgrades and deletions waiting for every other connection to close. */
  private readonly waiting = new Map<string, Array<() => boolean>>();

  private record(name: string): DatabaseRecord {
    let record = this.databases.get(name);
    if (!record) {
      record = { name, version: 0, stores: new Map(), autoIncrement: new Set(), counters: new Map(), connections: new Set(), transactions: [] };
      this.databases.set(name, record);
    }
    return record;
  }

  schedule(record: DatabaseRecord): void {
    for (const transaction of [...record.transactions]) if (transaction.canStart()) transaction.start();
  }

  /** A connection closed or a transaction ended: a blocked upgrade or deletion may proceed. */
  settle(record: DatabaseRecord): void {
    const waiters = this.waiting.get(record.name);
    if (!waiters) return;
    for (const waiter of [...waiters]) if (waiter()) waiters.splice(waiters.indexOf(waiter), 1);
    if (waiters.length === 0) this.waiting.delete(record.name);
  }

  /**
   * An upgrade or a deletion fires `versionchange` on every other connection;
   * one that does not close blocks the request, and it proceeds when they all close.
   */
  private whenUnblocked(record: DatabaseRecord, reason: "upgrade" | "delete", except: FakeDatabase | undefined,
    onblocked: () => void, proceed: () => void): void {
    for (const connection of [...record.connections]) {
      if (connection === except) continue;
      this.events.push({ database: record.name, event: "versionchange", reason });
      connection.onversionchange?.();
    }
    const clear = () => [...record.connections].every((connection) => connection === except) && record.transactions.length === 0;
    if (clear()) { proceed(); return; }
    this.events.push({ database: record.name, event: "blocked", reason });
    onblocked();
    const waiters = this.waiting.get(record.name) ?? [];
    waiters.push(() => { if (!clear()) return false; proceed(); return true; });
    this.waiting.set(record.name, waiters);
  }

  open(name: string, version = 1): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      const record = this.record(name);
      if (version < record.version) {
        request.fail(fakeError("VersionError", `requested version ${version} is below ${record.version}`));
        return;
      }
      const connect = () => {
        const database = new FakeDatabase(this, record);
        record.connections.add(database);
        return database;
      };
      if (version === record.version) { request.succeed(connect()); return; }
      this.whenUnblocked(record, "upgrade", undefined, () => request.onblocked?.(), () => {
        record.version = version;
        const database = connect();
        request.result = database;
        request.onupgradeneeded?.();
        queueMicrotask(() => request.onsuccess?.());
      });
    });
    return request;
  }

  deleteDatabase(name: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    const record = this.databases.get(name);
    if (!record) { request.succeed(undefined); return request; }
    queueMicrotask(() => this.whenUnblocked(record, "delete", undefined, () => request.onblocked?.(), () => {
      if (this.databases.get(name) === record) this.databases.delete(name);
      request.succeed(undefined);
    }));
    return request;
  }

  /** Every database name that exists, as `indexedDB.databases()` reports. */
  async databaseNames(): Promise<string[]> { return [...this.databases.keys()].sort(); }

  /** A database as O2a's version-1 carrier left it: the seven state stores and nothing else. */
  seedVersion1(name: string, stores: readonly string[]): void {
    const record = this.record(name);
    record.stores = new Map(stores.map((store) => [store, new Map()]));
    record.version = 1;
  }

  /** A database as a version-2 carrier left it: the given stores at version 2. */
  seedVersion2(name: string, stores: readonly string[]): void {
    const record = this.record(name);
    record.stores = new Map(stores.map((store) => [store, new Map()]));
    record.version = 2;
  }

  has(name: string): boolean { return this.databases.has(name); }

  hasStore(name: string, store: string): boolean { return this.databases.get(name)?.stores.has(store) ?? false; }

  /** The object stores a database holds, sorted. */
  storeNames(name: string): string[] { return [...(this.databases.get(name)?.stores.keys() ?? [])].sort(); }

  keys(name: string, store: string): Key[] {
    return [...(this.databases.get(name)?.stores.get(store)?.keys() ?? [])].sort(compareKeys);
  }

  /** Open connections to a database; lifecycle tests assert they close on `versionchange`. */
  connections(name: string): number { return this.databases.get(name)?.connections.size ?? 0; }

  version(name: string): number { return this.databases.get(name)?.version ?? 0; }
}

/** The Web Locks contract: `ifAvailable` answers `null` at once; a waiting request queues until the holder releases, or its `signal` withdraws it. */
export class FakeLocks {
  private readonly held = new Map<string, Array<{ run: () => void; cancel: () => void }>>();

  waiting(name: string): number { return this.held.get(name)?.length ?? 0; }

  request<T>(name: string, options: { ifAvailable?: boolean; signal?: AbortSignal }, callback: (lock: { name: string } | null) => T | Promise<T>): Promise<T> {
    // The callback starts synchronously, as the browser's does, so a holder's
    // release reaches the next requester without extra ticks.
    const run = (): Promise<T> => {
      let outcome: Promise<T>;
      try { outcome = Promise.resolve(callback({ name })); } catch (error) { outcome = Promise.reject(error); }
      return outcome.finally(() => {
        const next = this.held.get(name)?.shift();
        if (next) next.run(); else this.held.delete(name);
      });
    };
    if (!this.held.has(name)) {
      this.held.set(name, []);
      return run();
    }
    if (options.ifAvailable) return Promise.resolve(callback(null));
    return new Promise<T>((resolve, reject) => {
      const abort = () => { const error = new Error("lock request aborted"); error.name = "AbortError"; return error; };
      if (options.signal?.aborted) { reject(abort()); return; }
      const waiter = {
        run: () => { options.signal?.removeEventListener("abort", onAbort); run().then(resolve, reject); },
        cancel: () => {
          const queue = this.held.get(name);
          if (queue) this.held.set(name, queue.filter((item) => item !== waiter));
          reject(abort());
        },
      };
      const onAbort = () => waiter.cancel();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.held.get(name)!.push(waiter);
    });
  }
}

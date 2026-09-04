// In-memory IndexedDB + Web Locks stand-ins shared by the offline suites:
// versioned upgrades, per-transaction snapshots, an injectable put failure
// (per store, any store, or asynchronous abort), and inspection helpers.

export type Entry = { key: string; value: unknown };
type Stores = Map<string, Map<string, Entry>>;

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
}

export class FakeObjectStore {
  private readonly transaction: FakeTransaction;
  private readonly name: string;

  constructor(transaction: FakeTransaction, name: string) {
    this.transaction = transaction;
    this.name = name;
  }

  clear(): void { this.transaction.store(this.name).clear(); }

  put(entry: Entry): void {
    const factory = this.transaction.factory;
    if (factory.failNextPutIn === this.name) {
      factory.failNextPutIn = undefined;
      throw new Error(`injected put failure in ${this.name}`);
    }
    if (factory.failNextPut) {
      factory.failNextPut = false;
      throw new Error("injected put failure");
    }
    if (factory.abortNextPut) {
      factory.abortNextPut = false;
      this.transaction.abortWith(new Error("injected asynchronous put failure"));
      return;
    }
    this.transaction.store(this.name).set(entry.key, structuredClone(entry));
  }

  delete(key: string): void { this.transaction.store(this.name).delete(key); }

  getAll(): FakeRequest<Entry[]> {
    const request = new FakeRequest<Entry[]>();
    request.succeed([...this.transaction.store(this.name).values()].map((entry) => structuredClone(entry)));
    return request;
  }

  get(key: string): FakeRequest<Entry | undefined> {
    const request = new FakeRequest<Entry | undefined>();
    const entry = this.transaction.store(this.name).get(key);
    request.succeed(entry === undefined ? undefined : structuredClone(entry));
    return request;
  }
}

export class FakeTransaction {
  readonly factory: FakeIndexedDb;
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;
  private readonly database: Stores;
  private readonly mode: "readonly" | "readwrite";
  private readonly local: Stores = new Map();
  private aborted = false;

  constructor(factory: FakeIndexedDb, database: Stores, mode: "readonly" | "readwrite") {
    this.factory = factory;
    this.database = database;
    this.mode = mode;
    // Each transaction works on its own snapshot; a readwrite one replaces the
    // database wholesale on completion and leaves nothing behind on abort.
    for (const [name, values] of database) {
      this.local.set(name, new Map([...values].map(([key, value]) => [key, structuredClone(value)])));
    }
    setTimeout(() => this.finish(), 0);
  }

  store(name: string): Map<string, Entry> {
    const values = this.local.get(name);
    if (!values) throw new Error(`no object store ${name}`);
    return values;
  }

  objectStore(name: string): FakeObjectStore { return new FakeObjectStore(this, name); }

  abort(): void {
    if (this.aborted) return;
    this.abortWith(new Error("transaction aborted"));
  }

  abortWith(error: Error): void {
    this.aborted = true;
    this.error = error;
    queueMicrotask(() => this.onabort?.());
  }

  private finish(): void {
    if (this.aborted) return;
    if (this.mode === "readwrite") {
      this.database.clear();
      for (const [name, values] of this.local) this.database.set(name, values);
    }
    this.oncomplete?.();
  }
}

export class FakeDatabase {
  readonly objectStoreNames: { contains(name: string): boolean };
  readonly factory: FakeIndexedDb;
  readonly stores: Stores;

  constructor(factory: FakeIndexedDb, stores: Stores) {
    this.factory = factory;
    this.stores = stores;
    this.objectStoreNames = { contains: (name: string) => stores.has(name) };
  }

  createObjectStore(name: string): void { this.stores.set(name, new Map()); }

  transaction(_names: string[], mode: "readonly" | "readwrite"): FakeTransaction {
    return new FakeTransaction(this.factory, this.stores, mode);
  }

  close(): void {}
}

export class FakeIndexedDb {
  /** The next `put` into this object store throws, aborting its transaction. */
  failNextPutIn?: string;
  /** The next `put` into any object store throws synchronously. */
  failNextPut = false;
  /** The next `put` aborts its transaction asynchronously instead of throwing. */
  abortNextPut = false;
  private readonly databases = new Map<string, Stores>();
  private readonly versions = new Map<string, number>();

  open(name: string, version = 1): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      const stores = this.databases.get(name) ?? new Map<string, Map<string, Entry>>();
      this.databases.set(name, stores);
      request.result = new FakeDatabase(this, stores);
      // A fresh database is version 0; a bump past the stored version upgrades it.
      if ((this.versions.get(name) ?? 0) < version) {
        this.versions.set(name, version);
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    });
    return request;
  }

  deleteDatabase(name: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    this.databases.delete(name);
    this.versions.delete(name);
    request.succeed(undefined);
    return request;
  }

  /** A database as O2a's version-1 carrier left it: the seven state stores and nothing else. */
  seedVersion1(name: string, stores: readonly string[]): void {
    this.databases.set(name, new Map(stores.map((store) => [store, new Map()])));
    this.versions.set(name, 1);
  }

  has(name: string): boolean { return this.databases.has(name); }

  hasStore(name: string, store: string): boolean { return this.databases.get(name)?.has(store) ?? false; }

  keys(name: string, store: string): string[] {
    return [...(this.databases.get(name)?.get(store)?.keys() ?? [])].sort();
  }
}

export class FakeLocks {
  private readonly held = new Set<string>();

  request<T>(name: string, _options: { ifAvailable: true }, callback: (lock: { name: string } | null) => T): Promise<T> {
    if (this.held.has(name)) return Promise.resolve(callback(null));
    this.held.add(name);
    return Promise.resolve(callback({ name })).finally(() => this.held.delete(name));
  }
}

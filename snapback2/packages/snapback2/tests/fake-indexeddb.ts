/** In-memory IndexedDB and Web Locks stand-ins shared by the offline suites. */
type Entry = { key: string; value: unknown };

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
    if (this.transaction.factory.failNextPut) {
      this.transaction.factory.failNextPut = false;
      throw new Error("injected put failure");
    }
    if (this.transaction.factory.abortNextPut) {
      this.transaction.factory.abortNextPut = false;
      this.transaction.abortWith(new Error("injected asynchronous put failure"));
      return;
    }
    this.transaction.store(this.name).set(entry.key, structuredClone(entry));
  }
  getAll(): FakeRequest<Entry[]> {
    const request = new FakeRequest<Entry[]>();
    request.succeed([...this.transaction.store(this.name).values()].map((entry) => structuredClone(entry)));
    return request;
  }
  get(key: string): FakeRequest<Entry | undefined> {
    const request = new FakeRequest<Entry | undefined>();
    const value = this.transaction.store(this.name).get(key);
    request.succeed(value === undefined ? undefined : structuredClone(value));
    return request;
  }
}

export class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: Error | null = null;
  private aborted = false;
  private readonly local = new Map<string, Map<string, Entry>>();
  readonly factory: FakeIndexedDb;
  private readonly database: Map<string, Map<string, Entry>>;
  private readonly mode: "readonly" | "readwrite";

  constructor(
    factory: FakeIndexedDb,
    database: Map<string, Map<string, Entry>>,
    mode: "readonly" | "readwrite",
  ) {
    this.factory = factory;
    this.database = database;
    this.mode = mode;
    for (const [name, values] of database) {
      this.local.set(name, new Map([...values].map(([key, value]) => [key, structuredClone(value)])));
    }
    setTimeout(() => this.finish(), 0);
  }

  objectStore(name: string): FakeObjectStore { return new FakeObjectStore(this, name); }
  store(name: string): Map<string, Entry> {
    const value = this.local.get(name);
    if (!value) throw new Error(`missing fake object store ${name}`);
    return value;
  }
  abort(): void {
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
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
  readonly objectStoreNames;
  readonly factory: FakeIndexedDb;
  readonly stores: Map<string, Map<string, Entry>>;
  constructor(factory: FakeIndexedDb, stores: Map<string, Map<string, Entry>>) {
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
  failNextPut = false;
  abortNextPut = false;
  private readonly databases = new Map<string, Map<string, Map<string, Entry>>>();
  open(name: string): FakeRequest<FakeDatabase> {
    const request = new FakeRequest<FakeDatabase>();
    queueMicrotask(() => {
      const fresh = !this.databases.has(name);
      const stores = this.databases.get(name) ?? new Map();
      this.databases.set(name, stores);
      request.result = new FakeDatabase(this, stores);
      if (fresh) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
  deleteDatabase(name: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    this.databases.delete(name);
    request.succeed(undefined);
    return request;
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


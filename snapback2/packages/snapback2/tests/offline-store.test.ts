import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SnapbackRefusal, api, browserTokenStore, createClient } from "../dist/client.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";

type Entry = { key: string; value: unknown };

class FakeRequest<T> {
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

class FakeObjectStore {
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

class FakeTransaction {
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
  private finish(): void {
    if (this.aborted) return;
    if (this.mode === "readwrite") {
      this.database.clear();
      for (const [name, values] of this.local) this.database.set(name, values);
    }
    this.oncomplete?.();
  }
}

class FakeDatabase {
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

class FakeIndexedDb {
  failNextPut = false;
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

class FakeLocks {
  private readonly held = new Set<string>();
  request<T>(name: string, _options: { ifAvailable: true }, callback: (lock: { name: string } | null) => T): Promise<T> {
    if (this.held.has(name)) return Promise.resolve(callback(null));
    this.held.add(name);
    return Promise.resolve(callback({ name })).finally(() => this.held.delete(name));
  }
}

const emptyReceipt = () => ({ ranges: [], absences: [], verdicts: [] });
const row = (table: string, id: string, body = id) => ({ table, id, row: { id, body } });
const ref = (table: string, id: string) => ({ $row: [table, id] });

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "snapback2-offline-"));
}

function indexedFactory(database = new FakeIndexedDb(), locks = new FakeLocks()) {
  return { database, locks, factory: indexedDbRangeStore({ indexedDB: database as any, locks: locks as any }) };
}

async function exerciseSharedRows(factory: ReturnType<typeof fileRangeStore>): Promise<void> {
  const store = factory();
  await store.open("dev:alice");
  const shared = row("messages", "m1", "hello");
  await store.commit({ deliveries: [{
    op: "one", args: {}, state: "complete", data: ref("messages", "m1"), next: null,
    seq: 1, rows: [shared], receipt: emptyReceipt(),
  }, {
    op: "two", args: {}, state: "complete", data: { message: ref("messages", "m1") }, next: null,
    seq: 1, rows: [shared], receipt: emptyReceipt(),
  }] });
  assert.equal((await store.coverage()).rows.length, 1);
  assert.deepEqual((await store.answer("one", {}))?.data, { id: "m1", body: "hello" });
  assert.deepEqual((await store.answer("two", {}))?.data, { message: { id: "m1", body: "hello" } });
  await store.close?.();
}

test("RangeStore stores rows once and shares them across answers on both carriers", async () => {
  const root = await tempRoot();
  try {
    await exerciseSharedRows(fileRangeStore(root));
    const { factory } = indexedFactory();
    await exerciseSharedRows(factory as ReturnType<typeof fileRangeStore>);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("file and IndexedDB swaps are atomic when persistence fails", async () => {
  const root = await tempRoot();
  let failRename = false;
  const file = fileRangeStore(root, { beforeRename: () => {
    if (failRename) throw new Error("kill before rename");
  } });
  const store = file();
  await store.open("dev:alice");
  await store.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [1], next: null, seq: 1 }] });
  failRename = true;
  await assert.rejects(store.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [2], next: null, seq: 2 }] }));
  await store.close?.();
  const reopened = fileRangeStore(root)();
  await reopened.open("dev:alice");
  assert.deepEqual((await reopened.answer("list", {}))?.data, [1]);

  const { database, factory } = indexedFactory();
  const indexed = factory();
  await indexed.open("dev:bob");
  await indexed.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [1], next: null, seq: 1 }] });
  database.failNextPut = true;
  await assert.rejects(indexed.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [2], next: null, seq: 2 }] }));
  assert.deepEqual((await indexed.answer("list", {}))?.data, [1]);
  await indexed.close?.();
  await rm(root, { recursive: true, force: true });
});

test("a process killed between file write and rename leaves the previous snapshot", async () => {
  const root = await tempRoot();
  const seeded = fileRangeStore(root)();
  await seeded.open("dev:alice");
  await seeded.commit({ deliveries: [{
    op: "list", args: {}, state: "complete", data: [1], next: null, seq: 1,
  }] });
  await seeded.close?.();

  const moduleUrl = new URL("../dist/test.mjs", import.meta.url).href;
  const script = `
    const { fileRangeStore } = await import(${JSON.stringify(moduleUrl)});
    const store = fileRangeStore(${JSON.stringify(root)}, {
      beforeRename: async () => {
        process.stdout.write("barrier\\n");
        await new Promise(() => {});
      },
    })();
    await store.open("dev:alice");
    await store.commit({ deliveries: [{
      op: "list", args: {}, state: "complete", data: [2], next: null, seq: 2,
    }] });
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`carrier child exited before barrier: ${code}`)));
    child.stdout.once("data", () => resolve());
  });
  assert.equal(child.kill("SIGKILL"), true);
  await once(child, "exit");

  const reopened = fileRangeStore(root)();
  await reopened.open("dev:alice");
  assert.deepEqual((await reopened.answer("list", {}))?.data, [1]);
  await reopened.close?.();
  await rm(root, { recursive: true, force: true });
});

async function exerciseEvictions(store: any): Promise<void> {
  await store.open("dev:alice");
  const heldRange = {
    site: "thread.range", table: "messages", index: "byConvTime", prefix: ["c1"], bounds: {},
    rowIds: ["m1", "m2"], stop: "Exhausted", absence: false,
  };
  await store.commit({ deliveries: [{
    op: "thread", args: { c: null }, state: "complete",
    data: [ref("messages", "m1"), ref("messages", "m2")], next: null, seq: 1,
    rows: [row("messages", "m1"), row("messages", "m2")],
    receipt: { ranges: [heldRange], absences: [], verdicts: [] },
  }] });
  await store.commit({ deliveries: [{
    op: "fresh", args: {}, state: "complete", data: ref("messages", "m2"), next: null, seq: 2,
    rows: [row("messages", "m2")],
    receipt: { ranges: [{ ...heldRange, rowIds: ["m2"] }], absences: [], verdicts: [] },
  }] });
  assert.deepEqual((await store.coverage()).rows.map((item) => item.id), ["m2"], "uniform-range hole evicts");

  const limitedRange = {
    site: "thread.limit", table: "messages", index: "byConvTime", prefix: ["c2"], bounds: {},
    rowIds: ["m7", "m8", "m9"], stop: "Limit", absence: false,
    rowKeys: { m7: [7], m8: [8], m9: [9] },
  };
  await store.commit({ deliveries: [{
    op: "limited", args: {}, state: "capped",
    data: [ref("messages", "m7"), ref("messages", "m8"), ref("messages", "m9")], next: "c9", seq: 2,
    rows: [row("messages", "m7"), row("messages", "m8"), row("messages", "m9")],
    receipt: { ranges: [limitedRange], absences: [], verdicts: [] },
  }] });
  await store.commit({ deliveries: [{
    op: "limited-fresh", args: {}, state: "capped", data: [ref("messages", "m7"), ref("messages", "m9")],
    next: "c10", seq: 3, rows: [row("messages", "m7"), row("messages", "m9")],
    receipt: { ranges: [{ ...limitedRange, rowIds: ["m7", "m9"] }], absences: [], verdicts: [] },
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "m8"), false, "limited extent hole evicts");

  await store.commit({ deliveries: [{
    op: "body", args: {}, state: "complete", data: ref("messages", "m3"), next: null, seq: 3,
    rows: [row("messages", "m3")], receipt: emptyReceipt(),
  }] });
  await store.commit({ deliveries: [{
    op: "absence", args: {}, state: "complete", data: null, next: null, seq: 4,
    receipt: { ranges: [], absences: [["messages", "byId", ["m3"]]], verdicts: [] },
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "m3"), false, "point absence evicts");

  await store.commit({ deliveries: [{
    op: "body4", args: {}, state: "complete", data: ref("messages", "m4"), next: null, seq: 5,
    rows: [row("messages", "m4")], receipt: emptyReceipt(),
  }], tombstones: [{ table: "messages", id: "m4" }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "m4"), false, "tombstone evicts");

  await store.commit({ deliveries: [{
    op: "hidden-default", args: {}, state: "complete", data: { message: ref("messages", "m5") }, next: null,
    seq: 6, rows: [row("messages", "m5")], receipt: emptyReceipt(),
  }] });
  await store.commit({ deliveries: [{
    op: "hidden-default", args: {}, state: "complete", data: { message: null }, next: null,
    seq: 7, receipt: emptyReceipt(),
  }] });
  assert.equal((await store.coverage()).rows.some((item) => item.id === "m5"), false, "default hidden evicts");

  await store.commit({ deliveries: [{
    op: "history", args: {}, state: "complete", data: { message: ref("messages", "m6") }, next: null,
    seq: 8, rows: [row("messages", "m6", "history")], receipt: emptyReceipt(),
  }] });
  await store.commit({ retention: { messages: "delivered-history" }, deliveries: [{
    op: "history", args: {}, state: "complete", data: { message: null }, next: null,
    seq: 9, receipt: emptyReceipt(),
  }] });
  const history = await store.answer<any>("history", {});
  assert.equal(history?.retained, true);
  assert.deepEqual(history?.data, { message: { id: "m6", body: "history" } });
  await store.close?.();
}

test("both carriers apply the four swap rules with until-revoked and delivered-history", async () => {
  const root = await tempRoot();
  try {
    await exerciseEvictions(fileRangeStore(root)());
    await exerciseEvictions(indexedFactory().factory());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("seal hides a partition, reopening the same principal unseals it, and wipe deletes it", async () => {
  for (const make of [fileRangeStore(await tempRoot()), indexedFactory().factory]) {
    const store = make();
    await store.open("dev:alice");
    await store.commit({ deliveries: [{ op: "list", args: {}, state: "complete", data: [1], next: null, seq: 1 }] });
    await store.seal();
    assert.equal(await store.answer("list", {}), undefined);
    await store.open("dev:alice");
    assert.deepEqual((await store.answer("list", {}))?.data, [1]);
    await store.wipe("dev:alice");
    await store.open("dev:alice");
    assert.equal(await store.answer("list", {}), undefined);
    await store.close?.();
  }
});

test("carrier open failures and a second web lock holder refuse loudly", async () => {
  const badFactory: any = () => ({
    open: async () => { throw new Error("disk unavailable"); }, seal: async () => undefined,
    wipe: async () => undefined, answer: async () => undefined, commit: async () => undefined,
    coverage: async () => ({ rows: [], ranges: [], absences: [], verdicts: [], watermarks: [] }),
    outbox: { all: async () => [], get: async () => undefined, put: async () => undefined, remove: async () => undefined },
  });
  Object.defineProperty(badFactory, "carrier", { value: "broken-test" });
  const bad = createClient({ url: "http://offline.test", as: "alice", offline: { store: badFactory } });
  await assert.rejects(bad.ready, (error: unknown) => error instanceof SnapbackRefusal
    && error.code === "E_OFFLINE_CARRIER" && error.envelope.rewrite?.includes("broken-test") === true);

  const shared = indexedFactory();
  const first = createClient({ url: "http://offline.test", as: "alice", offline: { store: shared.factory } });
  await first.ready;
  const second = createClient({ url: "http://offline.test", as: "alice", offline: { store: shared.factory } });
  await assert.rejects(second.ready, (error: unknown) => error instanceof SnapbackRefusal
    && error.code === "E_OFFLINE_LOCK" && error.envelope.rewrite === "this account is open in another tab");
  first.close();
  second.close();
});

test("offline option shape and fenceDays bounds are TypeErrors", () => {
  const rootFactory = fileRangeStore("/tmp/snapback2-option-shape-test");
  for (const fenceDays of [0, 31, 1.5, "7", null]) {
    assert.throws(
      () => createClient({ url: "http://options.test", as: "alice", offline: { store: rootFactory, fenceDays } } as any),
      TypeError,
    );
  }
  assert.throws(
    () => createClient({ url: "http://options.test", as: "alice", offline: { store: {} } } as any),
    TypeError,
  );
});

test("browser token custody reopens the same principal partition on a cold offline start", async () => {
  const root = await tempRoot();
  const values = new Map<string, string>();
  const tokenStore = browserTokenStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  }, "auth");
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/auth/login")) {
      return new Response(JSON.stringify({ token: "token-1", viewer: "principal-1" }), { status: 200 });
    }
    assert.equal(JSON.parse(String(init?.body)).receipt, 1);
    return new Response(JSON.stringify({ state: "complete", data: ["held"], seq: 1, next: null }), { status: 200 });
  };
  const first = createClient({ url: "http://bearer.test", tokenStore, offline: { store: fileRangeStore(root) }, fetch });
  await first.auth.login({ email: "a@example.com", password: "password" });
  await first.query(api.messages.thread, { c: null });
  first.close();
  const cold = createClient({ url: "http://bearer.test", tokenStore, offline: { store: fileRangeStore(root) }, fetch });
  await cold.ready;
  await cold.offline();
  const held = await cold.query<any, any>(api.messages.thread as any, { c: null });
  assert.deepEqual("data" in held ? held.data : undefined, ["held"]);
  cold.close();
  await rm(root, { recursive: true, force: true });
});

test("held and unheld offline reads expose since and fenceDays never blocks reading", async () => {
  const root = await tempRoot();
  let now = 1_000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const client = createClient({
      url: "http://query.test", as: "alice", offline: { store: fileRangeStore(root), fenceDays: 1 },
      fetch: async (_input, init) => {
        assert.equal(JSON.parse(String(init?.body)).receipt, 1);
        return new Response(JSON.stringify({ state: "complete", data: [{ id: "m1" }], seq: 1, next: null }), { status: 200 });
      },
    });
    await client.ready;
    const online = await client.query(api.messages.thread, { c: null });
    assert.equal(online.state, "complete");
    now += 40 * 24 * 60 * 60 * 1_000;
    await client.offline();
    const held = await client.query<any, any>(api.messages.thread as any, { c: null });
    assert.equal(held.state, "complete");
    assert.equal("connection" in held && held.connection, "offline");
    assert.deepEqual("stale" in held && held.stale, { since: 1_000 });
    const unheld = await client.query<any, any>(api.messages.other as any, {});
    assert.deepEqual(unheld, { state: "hydrating", live: false, connection: "offline" });
    client.close();
  } finally {
    Date.now = realNow;
    await rm(root, { recursive: true, force: true });
  }
});

test("the client tombstone hook evicts the named body in the same delivery swap", async () => {
  const root = await tempRoot();
  let call = 0;
  const client = createClient({
    url: "http://tombstone.test", as: "alice",
    offline: {
      store: fileRangeStore(root),
      onTombstone: (item) => item.table === "deliveries"
        && (item.row.kind === "removed" || item.row.kind === "expired")
        && typeof item.row.messageId === "string"
        ? [{ table: "messages", id: item.row.messageId }] : [],
    },
    fetch: async () => {
      call += 1;
      const delivered = envelope(ref(call === 1 ? "messages" : "deliveries", call === 1 ? "m1" : "d1"), `v${call}`);
      delivered.rows = call === 1
        ? [row("messages", "m1", "secret")]
        : [{ table: "deliveries", id: "d1", row: { id: "d1", kind: "removed", messageId: "m1" } }];
      return new Response(JSON.stringify(delivered), { status: 200 });
    },
  });
  await client.ready;
  await client.query(api.messages.body as any, {});
  await client.query(api.deliveries.inbox as any, {});
  await client.offline();
  const body = await client.query<any, any>(api.messages.body as any, {});
  assert.equal(body.state, "partial");
  assert.deepEqual("data" in body ? body.data : undefined, null);
  assert.equal("validator" in body, false);
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("the provisional delivery decoder rejects malformed custody facts", async () => {
  const root = await tempRoot();
  const malformed: any = envelope([]);
  delete malformed.planHash;
  const client = createClient({
    url: "http://envelope.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async () => new Response(JSON.stringify(malformed), { status: 200 }),
  });
  await assert.rejects(client.query(api.messages.thread, {}), (error: unknown) =>
    error instanceof SnapbackRefusal && error.code === "E_WIRE_SHAPE" && error.message.includes("planHash"));
  client.close();
  await rm(root, { recursive: true, force: true });
});

function sse(value?: unknown, hang = false): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      if (value !== undefined) controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      if (!hang) controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("drain true follows five pages, persists the watermark, and follows a new tail page", async () => {
  const root = await tempRoot();
  const cursors: Array<string | null> = [];
  let subscriptions = 0;
  const nextByCursor = new Map<any, string | null>([[null, "c1"], ["c1", "c2"], ["c2", "c3"], ["c3", "c4"], ["c4", null], ["c5", null]]);
  const client = createClient({
    url: "http://drain.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("/api/query")) {
        const args = JSON.parse(String(init?.body)).args;
        cursors.push(args.c);
        const next = nextByCursor.get(args.c);
        return new Response(JSON.stringify({ state: next === null ? "complete" : "capped", data: [args.c], seq: cursors.length, next }), { status: 200 });
      }
      subscriptions += 1;
      return subscriptions === 1
        ? sse({ state: "capped", data: ["tail"], seq: 10, next: "c5" })
        : sse(undefined, true);
    },
  });
  await client.ready;
  const seen: any[] = [];
  const drain = client.subscribe(api.deliveries.inbox as any, { c: null }, (value) => seen.push(value), { drain: true });
  const caught = await drain.until((value) => value.state === "complete" && value.caughtUp === true && value.watermark === "c5", 2_000);
  assert.equal(caught.state, "complete");
  assert.deepEqual(cursors, [null, "c1", "c2", "c3", "c4", "c5"]);
  drain.close();
  client.close();
  const inspect = fileRangeStore(root)();
  await inspect.open("dev:alice");
  assert.equal((await inspect.coverage()).watermarks[0]?.watermark, "c5");
  const heldDrain = await inspect.answer("deliveries.inbox", { c: null });
  assert.equal(heldDrain?.caughtUp, true);
  assert.equal(heldDrain?.watermark, "c5");
  await inspect.close?.();
  await rm(root, { recursive: true, force: true });
});

function envelope(data: unknown, validator = "validator-1") {
  return {
    protocol: 1, generation: "generation-1", schemaHash: "schema-1", planHash: "plan-1",
    authority: { principal: "dev:alice", authEpoch: 7 }, state: "complete", data, next: null, seq: 3,
    rows: [], receipt: emptyReceipt(), validator,
  };
}

async function seededResumeStore(root: string): Promise<void> {
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.commit({
    deliveries: [{
      op: "deliveries.inbox", args: { c: null }, state: "complete", data: [], next: null, seq: 3,
      validator: "validator-1", receipt: emptyReceipt(),
    }],
    watermark: {
      op: "deliveries.inbox", args: { c: null }, watermark: "cursor-9", validator: "validator-1",
      generation: "generation-1", schemaHash: "schema-1", authEpoch: 7, updatedAt: 10,
    },
  });
  await store.close?.();
}

test("cold resume sends the bounded shape before subscribe and a 404 falls back with validator", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  const order: string[] = [];
  let request: any;
  const client = createClient({
    url: "http://resume.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/resume")) {
        order.push("resume");
        request = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ code: "E_ROUTE", family: "op", message: "not found", guide: "op/reference" }), { status: 404 });
      }
      order.push("subscribe");
      assert.equal(new URL(url).searchParams.get("validator"), "validator-1");
      return sse(undefined, true);
    },
  });
  await client.ready;
  const sub = client.subscribe(api.deliveries.inbox as any, { c: null }, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order.slice(0, 2), ["resume", "subscribe"]);
  assert.deepEqual(request, {
    protocol: 1, generation: "generation-1", schemaHash: "schema-1", authEpoch: 7,
    log: { op: "deliveries.inbox", args: { c: null }, watermark: "cursor-9", validator: "validator-1" },
    mounted: [],
  });
  sub.close();
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("E_OFFLINE_RESET drops coverage but preserves the durable outbox slot", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.outbox.put({ intent: "i1", ids: [], op: "send", args: {}, state: "queued", createdAt: 1, updatedAt: 1 });
  await store.close?.();
  const client = createClient({
    url: "http://reset.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async () => new Response(JSON.stringify({
      code: "E_OFFLINE_RESET", family: "offline", message: "generation moved", rewrite: "cold drain", guide: "offline",
    }), { status: 409 }),
  });
  await client.ready;
  await client.offline();
  assert.equal((await client.query(api.deliveries.inbox as any, { c: null })).state, "hydrating");
  client.close();
  const inspect = fileRangeStore(root)();
  await inspect.open("dev:alice");
  assert.equal((await inspect.outbox.all())[0]?.intent, "i1");
  await inspect.close?.();
  await rm(root, { recursive: true, force: true });
});

test("E_OFFLINE_RESET cold-drains a mounted drain from the null cursor", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  let resumes = 0;
  const queryCursors: Array<string | null> = [];
  let sawResetDrain!: () => void;
  const resetDrain = new Promise<void>((resolve) => { sawResetDrain = resolve; });
  const client = createClient({
    url: "http://reset-drain.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/resume")) {
        resumes += 1;
        if (resumes === 1) return new Response(JSON.stringify({
          seq: 3, generation: "generation-1", schemaHash: "schema-1",
          authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
        }), { status: 200 });
        return new Response(JSON.stringify({
          code: "E_OFFLINE_RESET", family: "offline", message: "generation moved",
          rewrite: "cold drain", guide: "offline",
        }), { status: 409 });
      }
      if (url.includes("/api/query")) {
        const args = JSON.parse(String(init?.body)).args;
        queryCursors.push(args.c);
        if (queryCursors.length === 2) sawResetDrain();
        return new Response(JSON.stringify({ state: "complete", data: [], next: null, seq: 4 }), { status: 200 });
      }
      return sse(undefined, true);
    },
  });
  await client.ready;
  const drain = client.subscribe(api.deliveries.inbox as any, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => value.state === "complete" && value.caughtUp === true);
  await client.offline();
  await client.online();
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      resetDrain,
      new Promise<never>((_resolve, reject) => {
        resetTimer = setTimeout(() => reject(new Error("reset drain did not start")), 1_000);
      }),
    ]);
  } finally {
    if (resetTimer) clearTimeout(resetTimer);
  }
  assert.deepEqual(queryCursors, [null, null]);
  drain.close();
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("E_OFFLINE_RESUME drops the oldest unmounted answer and retries once", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  const store = fileRangeStore(root)();
  await store.open("dev:alice");
  await store.commit({ deliveries: [{ op: "old", args: {}, state: "complete", data: ["old"], next: null, seq: 1 }] });
  await store.close?.();
  let resumes = 0;
  const client = createClient({
    url: "http://resume-cap.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async () => {
      resumes += 1;
      if (resumes === 1) return new Response(JSON.stringify({
        code: "E_OFFLINE_RESUME", family: "offline", message: "too many", rewrite: "drop one", guide: "offline",
      }), { status: 413 });
      return new Response(JSON.stringify({
        seq: 3, generation: "generation-1", schemaHash: "schema-1",
        authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
      }), { status: 200 });
    },
  });
  await client.ready;
  assert.equal(resumes, 2);
  await client.offline();
  assert.equal((await client.query(api.old.value as any, {})).state, "hydrating");
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("resume applies its mounted swap before online resolves", async () => {
  const root = await tempRoot();
  await seededResumeStore(root);
  let resumes = 0;
  const client = createClient({
    url: "http://resume-swap.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input) => {
      if (String(input).endsWith("/api/resume")) {
        resumes += 1;
        if (resumes === 1) return new Response(JSON.stringify({
          seq: 3, generation: "generation-1", schemaHash: "schema-1",
          authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true }, mounted: [],
        }), { status: 200 });
        return new Response(JSON.stringify({
          seq: 4, generation: "generation-1", schemaHash: "schema-1",
          authority: { principal: "dev:alice", authEpoch: 7 }, log: { unchanged: true },
          mounted: [envelope(["fresh"], "validator-2")],
        }), { status: 200 });
      }
      return sse(undefined, true);
    },
  });
  await client.ready;
  const sub = client.subscribe(api.deliveries.inbox as any, { c: null }, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await client.offline();
  await client.online();
  await client.offline();
  const held = await client.query<any, any>(api.deliveries.inbox as any, { c: null });
  assert.deepEqual("data" in held ? held.data : undefined, ["fresh"]);
  sub.close();
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("clients without offline storage preserve query and subscribe request bytes", async () => {
  let body = "";
  let subscribeUrl = "";
  const client = createClient({
    url: "http://bytes.test", as: "alice",
    fetch: async (_input, init) => {
      if (!init?.body) {
        subscribeUrl = String(_input);
        return sse(undefined, true);
      }
      body = String(init?.body);
      return new Response(JSON.stringify({ state: "complete", data: [], seq: 1, next: null }), { status: 200 });
    },
  });
  await client.query(api.messages.thread, { c: null });
  assert.equal(body, JSON.stringify({ op: "messages.thread", args: { c: null } }));
  const sub = client.subscribe(api.messages.thread, { c: "space here" }, () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    subscribeUrl,
    `http://bytes.test/api/subscribe?op=messages.thread&args=${encodeURIComponent(JSON.stringify({ c: "space here" }))}`,
  );
  sub.close();
  client.close();
});

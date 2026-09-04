import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { api, createClient } from "../dist/client.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

const hex = (n: number) => String(n).repeat(64);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const defer = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
const pause = () => new Promise((done) => setTimeout(done, 5));
async function eventually(check: () => Promise<boolean> | boolean) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await pause(); }
  assert.fail("condition did not settle");
}

async function fixture(carrier: "file" | "IndexedDB" = "file", bearer = false) {
  const root = await mkdtemp(join(tmpdir(), "s2-reset-"));
  const factory = carrier === "file" ? fileRangeStore(root)
    : indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
  let store: any;
  const state = { generation: hex(1), schemaHash: hex(4), epoch: 1, principal: bearer ? "alice" : "dev:alice" };
  const resumes: any[] = [], queries: any[] = [], streams: Array<{ headers: Headers; url: URL; controller: ReadableStreamDefaultController<Uint8Array> }> = [];
  let resetCount = 0;
  const hooks: {
    resume?: () => Promise<Response | undefined>;
    query?: (request: any) => Promise<Response | undefined>;
    program?: () => Promise<void>;
  } = {};
  const envelope = (request: any) => ({
    protocol: 1, generation: state.generation, schemaHash: state.schemaHash, planHash: hex(5),
    authority: { principal: state.principal, authEpoch: state.epoch }, state: "complete",
    data: { generation: state.generation, epoch: state.epoch, row: { $row: { table: "messages", id: "one" } } },
    next: null, seq: 7, rows: [{ table: "messages", id: "one", row: { id: "one", body: "same row" } }],
    receipt: { ranges: [], absences: [], verdicts: [] }, validator: hex(6),
  });
  const fetch = async (input: any, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname === "/api/auth/me") return json({ viewer: state.principal, kind: "user" });
    if (url.pathname === "/api/auth/login") {
      state.principal = "bob";
      return json({ viewer: "bob", token: "bob-token" });
    }
    if (url.pathname === "/api/auth/logout") return json({ ok: true });
    if (url.pathname === "/api/manifest") return json({ generation: "schema", programGeneration: state.generation, ops: {}, channels: {}, auth: {} });
    if (url.pathname === "/api/program") {
      await hooks.program?.();
      if (url.searchParams.get("generation") !== state.generation) return json({ code: "E_OP_UNKNOWN", family: "op", message: "not active", guide: "op/manifest" }, 404);
      return json({ generation: state.generation, schemaHash: state.schemaHash, schema: { tables: {} }, programs: {} });
    }
    if (url.pathname === "/api/query") {
      const request = JSON.parse(String(init?.body));
      queries.push({ ...request, principal: state.principal });
      return await hooks.query?.(request) ?? json(envelope(request));
    }
    if (url.pathname === "/api/resume") {
      const body = JSON.parse(String(init?.body));
      resumes.push(body);
      const override = await hooks.resume?.();
      if (override) return override;
      if (body.generation !== state.generation || body.schemaHash !== state.schemaHash) {
        resetCount++;
        return json({ code: "E_OFFLINE_RESET", family: "offline", message: "successor", guide: "offline", generation: state.generation, schemaHash: state.schemaHash }, 409);
      }
      return json({ generation: state.generation, schemaHash: state.schemaHash, authority: { principal: state.principal, authEpoch: state.epoch }, seq: 7,
        log: { unchanged: true }, mounted: body.mounted.map(() => ({ unchanged: true })) });
    }
    if (url.pathname === "/api/subscribe") return new Response(new ReadableStream<Uint8Array>({
      start(controller) { streams.push({ headers: new Headers(init?.headers), url, controller }); },
    }), { headers: { "content-type": "text/event-stream" } });
    throw new Error(`unexpected ${url.pathname}`);
  };
  const client = createClient({ url: "http://reset.test", ...(bearer ? { token: "alice-token" } : { as: "alice" }), fetch,
    offline: { store: () => (store = factory()) } });
  await client.ready;
  await client.query(api.messages.first, {});
  return { client, store, state, hooks, resumes, queries, streams, envelope,
    resets: () => resetCount,
    async rebuilt(op = "messages.second", generation = state.generation) {
      await eventually(async () => (await store.coverage()).facts?.generation === generation && (await store.answer(op, {}))?.data?.generation === generation);
    },
    async close() { hooks.resume = undefined; await client.close(); await pause(); await rm(root, { recursive: true, force: true }); },
  };
}

for (const carrier of ["file", "IndexedDB"] as const) {
  test(`${carrier}: query-only successor rebuilds overlapping rows at unchanged seq without a watermark`, async () => {
    const f = await fixture(carrier);
    try {
      f.state.generation = hex(2);
      const live: any = await f.client.query(api.messages.second, {});
      assert.equal(live.data.generation, hex(2));
      await f.rebuilt();
      assert.equal(f.resets(), 1);
      assert.deepEqual(f.resumes[0], { protocol: 1, generation: hex(1), schemaHash: hex(4), authEpoch: 1, mounted: [] });
      assert.equal((await f.store.coverage()).rows[0].row.body, "same row");
      // Sequence and negative-evidence guards still hold within the new coverage.
      await f.store.commit({ deliveries: [{ op: "older", args: {}, state: "complete", seq: 6, data: null, rows: [{ table: "messages", id: "one", row: { id: "one", body: "old" } }] }] });
      assert.equal((await f.store.coverage()).rows[0].row.body, "same row");
      await f.client.offline();
      assert.equal((await f.client.query(api.messages.second, {})).state, "complete");
    } finally { await f.close(); }
  });
}

test("concurrent G2 and G3 deliveries coalesce into one reset with only G3 answers held", async () => {
  const f = await fixture();
  const gate = defer();
  try {
    f.hooks.resume = async () => { await gate.promise; return undefined; };
    f.state.generation = hex(2);
    await f.client.query(api.messages.second, {}); // Must finish while reset is blocked.
    await eventually(() => f.resumes.length === 1);
    f.state.generation = hex(3);
    f.state.schemaHash = hex(8);
    f.state.epoch = 9;
    await f.client.query(api.messages.third, {});
    gate.resolve();
    await f.rebuilt();
    await f.rebuilt("messages.third");
    assert.equal(f.resets(), 1);
    assert.equal(f.resumes.length, 1);
    assert.deepEqual((await f.store.coverage()).facts, { generation: hex(3), schemaHash: hex(8), authEpoch: 9 });
    assert.equal((await f.store.answer("messages.second", {})).data.epoch, 9);
    assert.equal(await f.store.answer("messages.first", {}), undefined);
    assert.equal(f.queries.filter(q => q.op === "messages.second").length, 2, "the buffered G2 answer was re-issued under G3");
  } finally { gate.resolve(); await f.close(); }
});

test("a predecessor response completing after reset is re-issued without reinstalling facts or resetting again", async () => {
  const f = await fixture();
  const gate = defer();
  try {
    const old = f.envelope({});
    let first = true;
    f.hooks.query = async (q) => {
      if (q.op === "messages.late" && first) { first = false; await gate.promise; return json(old); }
    };
    const late = f.client.query(api.messages.late, {});
    await eventually(() => f.queries.some(q => q.op === "messages.late"));
    f.state.generation = hex(3);
    await f.client.query(api.messages.second, {});
    await f.rebuilt();
    gate.resolve();
    await late;
    await f.rebuilt("messages.late");
    assert.equal(f.resets(), 1);
    assert.equal((await f.store.coverage()).superseded, undefined);
  } finally { gate.resolve(); await f.close(); }
});

for (const kind of ["transport", "refusal"] as const) {
  test(`${kind} reset failure preserves the live read and snapshot refusal; the next query retries`, async () => {
    const f = await fixture();
    const gate = defer();
    try {
      f.hooks.resume = async () => {
        await gate.promise;
        if (kind === "transport") throw new TypeError("transport cut");
        return json({ code: "E_RESET_TEST", family: "offline", message: "resume refused", guide: "offline" }, 422);
      };
      f.state.generation = hex(2);
      const live: any = await f.client.query(api.messages.second, {});
      assert.equal(live.data.generation, hex(2), "live read did not await the blocked reset");
      await eventually(() => f.resumes.length === 1);
      const online = f.client.online();
      await pause();
      const concurrent: any = await f.client.query(api.messages.third, {});
      assert.equal(concurrent.data.generation, hex(2), "even online() joining the reset cannot block a live query");
      gate.resolve();
      await assert.rejects(online);
      assert.equal(f.client.snapshot.lastRefusal?.code, kind === "transport" ? "E_NETWORK" : "E_RESET_TEST");
      assert.ok((await f.store.coverage()).superseded);
      f.hooks.resume = undefined;
      await f.client.query(api.messages.second, {});
      await f.rebuilt();
      assert.equal(f.resumes.length, 2, "the next query actually retried the reset");
      assert.equal(f.client.snapshot.lastRefusal, undefined);
    } finally { gate.resolve(); await f.close(); }
  });
}

test("principal replacement clears pending reads and an in-flight reset cannot cross partitions", async () => {
  const f = await fixture("file", true);
  const gate = defer();
  try {
    f.hooks.resume = async () => { await gate.promise; return undefined; };
    f.state.generation = hex(2);
    await f.client.query(api.messages.second, {});
    await eventually(() => f.resumes.length === 1);
    await f.client.auth.login({ email: "bob", password: "password" });
    gate.resolve();
    await pause();
    f.hooks.resume = undefined;
    await f.client.query(api.messages.bob, {});
    await f.client.online();
    assert.equal(await f.store.answer("messages.second", {}), undefined);
    assert.equal(await f.store.answer("messages.first", {}), undefined);
    assert.ok(await f.store.answer("messages.bob", {}));
    assert.equal(f.queries.filter(q => q.principal === "bob" && q.op === "messages.second").length, 0);
  } finally { gate.resolve(); await f.close(); }
});

test("a mounted subscription cold-opens after supersession without Last-Event-ID or an old validator", async () => {
  const f = await fixture();
  let sub: any;
  try {
    await f.store.commit({ watermark: { op: "messages.log", args: { c: null }, watermark: "old-tail", validator: hex(6), updatedAt: 1 } });
    sub = f.client.subscribe(api.messages.first, {}, () => undefined);
    await eventually(() => f.streams.length === 1);
    const emit = (stream: any, id: string) => stream.controller.enqueue(new TextEncoder().encode(`id: ${id}\ndata: ${JSON.stringify(f.envelope({}))}\n\n`));
    emit(f.streams[0], "g1:7");
    await sub.until((e: any) => e.data?.generation === hex(1), 1000);
    f.state.generation = hex(2);
    emit(f.streams[0], "g2:7");
    await eventually(() => f.streams.length === 2);
    assert.equal(f.streams[1].headers.get("Last-Event-ID"), null);
    assert.equal(f.streams[1].url.searchParams.get("validator"), null);
    assert.deepEqual(f.resumes[0].mounted, []);
    assert.equal(f.resumes[0].log, undefined, "the old drained log validator cannot cross the superseded fence");
    emit(f.streams[1], "g2:7");
    await f.rebuilt("messages.first");
    assert.equal(f.resets(), 1);
  } finally { sub?.close(); await f.close(); }
});

test("tracked Snapback 2 source contains no literal NUL bytes", async () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const paths = execFileSync("git", ["ls-files", "-z", "--", "snapback2"], { cwd: root }).toString().split("\u0000")
    .filter(path => /\.(?:ts|tsx|js|jsx|mjs|cjs|rs|q|sh|py|json)$/.test(path));
  const bad: string[] = [];
  for (const path of paths) if ((await readFile(join(root, path))).includes(0)) bad.push(path);
  assert.deepEqual(bad, [], "literal NULs hide source diffs as binary patches");
});

for (const page of ["initial", "subsequent"]) {
  test(`a reset during the ${page} drain page cancels old cursors and leaves one tail`, async () => {
    const f = await fixture();
    const held = defer();
    let sub: any;
    try {
      let requests = 0;
      f.hooks.query = async (request) => {
        if (request.op !== "messages.log") return;
        requests++;
        if (page === "subsequent" && requests === 1) return json({ ...f.envelope(request), next: "old-cursor" });
        if (requests === (page === "initial" ? 1 : 2)) {
          const old = { ...f.envelope(request), next: "obsolete-cursor" };
          await held.promise;
          return json(old);
        }
        return json(f.envelope(request));
      };
      sub = f.client.subscribe(api.messages.log, { c: null }, () => undefined, { drain: true });
      await eventually(() => requests === (page === "initial" ? 1 : 2));
      f.state.generation = hex(2);
      await f.client.query(api.messages.second, {});
      await f.rebuilt();
      await eventually(() => f.streams.length === 1);
      held.resolve();
      await eventually(() => f.queries.filter(q => q.op === "messages.log").length >= 3);
      await pause();
      assert.equal(f.streams.length, 1, "only the surviving drain opened a tail");
      assert.equal(f.queries.filter(q => q.args.c === "obsolete-cursor").length, 0, "the canceled page cannot advance its cursor");
      const marks = (await f.store.coverage()).watermarks;
      assert.equal(marks.length, 1);
      assert.equal(marks[0].watermark, null, "the successor cold-drained from the root");
      assert.equal(f.resets(), 1);
    } finally { held.resolve(); sub?.close(); await f.close(); }
  });
}

test("failed program reload keeps the durable reset marker and online retries the reset", async () => {
  const f = await fixture();
  try {
    f.state.generation = hex(2);
    f.hooks.program = async () => { throw new TypeError("program transport cut"); };
    await f.client.query(api.messages.second, {});
    await eventually(() => f.client.snapshot.lastRefusal?.code === "E_NETWORK");
    assert.ok((await f.store.coverage()).superseded);
    f.hooks.program = undefined;
    await f.client.online();
    await f.rebuilt();
    assert.equal(f.resets(), 2, "the failed reload was retried, not merely remembered");
  } finally { await f.close(); }
});

test("a terminal reset refusal seals custody while the completed live read stays successful", async () => {
  const f = await fixture("file", true);
  const gate = defer();
  try {
    f.hooks.resume = async () => {
      await gate.promise;
      return json({ code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth" }, 401);
    };
    f.state.generation = hex(2);
    const live: any = await f.client.query(api.messages.second, {});
    assert.equal(live.data.generation, hex(2));
    gate.resolve();
    await eventually(() => f.client.snapshot.lastRefusal?.code === "E_AUTH_SESSION");
    await assert.rejects(f.store.outbox.grant(), /sealed/);
    assert.equal(await f.client.outbox.ready(), false);
  } finally { gate.resolve(); await f.close(); }
});

test("a second successor between manifest and program coalesces into the same reset", async () => {
  const f = await fixture();
  try {
    f.state.generation = hex(2);
    let loads = 0;
    f.hooks.program = async () => { if (++loads === 1) f.state.generation = hex(3); };
    await f.client.query(api.messages.second, {});
    await f.rebuilt("messages.second", hex(3));
    assert.equal(f.resets(), 1);
    assert.equal(loads, 2);
  } finally { await f.close(); }
});

test("a held-answer probe completing after supersession cannot send its old validator", async () => {
  const f = await fixture();
  const held = defer(), reset = defer();
  try {
    let probing = false;
    const original = f.store.answer.bind(f.store);
    f.store.answer = async (op: string, args: unknown) => {
      const value = await original(op, args);
      if (op === "messages.first" && !probing) { probing = true; await held.promise; }
      return value;
    };
    const late = f.client.query(api.messages.first, {});
    await eventually(() => probing);
    f.state.generation = hex(2);
    f.hooks.resume = async () => { await reset.promise; return undefined; };
    await f.client.query(api.messages.second, {});
    held.resolve();
    await late;
    assert.equal(f.queries.filter(q => q.op === "messages.first").at(-1)?.validator, undefined);
    reset.resolve();
    await f.rebuilt();
  } finally { held.resolve(); reset.resolve(); await f.close(); }
});

import { subscribe } from "../src/internal.js";
import { fixtureClient as createClient } from "./live-fixture.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { api } from "../dist/client.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { canonicalProgramJson } from "../dist/sqlite-test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { certifiedDrainPage, certifiedDrainProgram, certifiedSuccessorPage, certifiedSuccessorProgram } from "./offline-metadata-fixture.ts";

const hex = (n: number) => String(n).repeat(64);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const defer = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
const pause = () => new Promise((done) => setTimeout(done, 5));
const digest = (value: unknown) => createHash("sha256").update(canonicalProgramJson(value)).digest("hex");
const certified = certifiedDrainProgram();
const certifiedSource = Object.values(certified.programs)[0] as any;
const operationNames = ["messages.first", "messages.second", "messages.third", "messages.late", "messages.bob", "messages.log"] as const;
const aliasPrograms = (source: any, names: readonly string[], drain = false) => Object.fromEntries(names.map((name) => {
  const ir = { ...source.ir, name };
  const planHash = digest(ir);
  return [name, { ...source, ir, planHash,
    certificate: { ...source.certificate, program: name, plan_hash: planHash },
    ...(drain ? { drain: source.drain } : {}) }];
}));
const programs = aliasPrograms(certifiedSource, operationNames, true);
const overlap = certifiedDrainPage(1);
const overlapRow = overlap.rows[0];
const successor = certifiedSuccessorProgram();
const successorPrograms = aliasPrograms(successor.program, ["messages.second", "messages.third"]);
const successorPage = certifiedSuccessorPage();
const expandedPage = (page: any) => page.data.map((ref: any) =>
  page.rows.find((row: any) => row.table === ref.$row.table && row.id === ref.$row.id)?.row);
async function eventually(check: () => Promise<boolean> | boolean) {
  for (let n = 0; n < 200; n++) { if (await check()) return; await pause(); }
  assert.fail("condition did not settle");
}

async function fixture(carrier: "file" | "IndexedDB" = "file", bearer = false) {
  const root = await mkdtemp(join(tmpdir(), "s2-reset-"));
  const factory = carrier === "file" ? fileRangeStore(root)
    : indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
  let store: any;
  const state = { generation: hex(1), schemaHash: certified.schemaHash, epoch: 1, seq: 7, principal: bearer ? "alice" : "dev:alice" };
  const resumes: any[] = [], queries: any[] = [], streams: Array<{ headers: Headers; url: URL; controller: ReadableStreamDefaultController<Uint8Array> }> = [];
  let resetCount = 0;
  const hooks: {
    resume?: () => Promise<Response | undefined>;
    query?: (request: any) => Promise<Response | undefined>;
    program?: (init?: RequestInit) => Promise<void>;
    mutation?: (request: any) => Promise<Response | undefined>;
    login?: () => Promise<Response>;
  } = {};
  const packet = () => state.schemaHash === successor.schemaHash
    ? { schema: successor.schema, programs: successorPrograms, page: successorPage }
    : { schema: certified.schema, programs, page: overlap };
  const envelope = (request: any = {}) => ({
    ...packet().page,
    protocol: 1, generation: state.generation, schemaHash: state.schemaHash,
    planHash: (packet().programs[request.op] ?? Object.values(packet().programs)[0] as any).planHash,
    authority: { principal: state.principal, authEpoch: state.epoch }, state: "complete",
    next: null, seq: state.seq, validator: hex(6),
  });
  const fetch = async (input: any, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname === "/api/auth/me") return json({ viewer: state.principal, kind: "user" });
    if (url.pathname === "/api/auth/login") {
      state.principal = "bob";
      return await hooks.login?.() ?? json({ viewer: "bob", kind: "user", token: "bob-token" });
    }
    if (url.pathname === "/api/auth/logout") return json({ ok: true });
    if (url.pathname === "/api/manifest") return json({ generation: "schema", programGeneration: state.generation,
      ops: Object.fromEntries(Object.entries(packet().programs).map(([name, entry]: [string, any]) => [name,
        { kind: "query", planHash: entry.planHash, args: entry.ir.args, ...(entry.drain ? { drain: entry.drain } : {}) }])),
      channels: {}, auth: {} });
    if (url.pathname === "/api/program") {
      await hooks.program?.(init);
      if (url.searchParams.get("generation") !== state.generation) return json({ code: "E_OP_UNKNOWN", family: "op", message: "not active", guide: "op/manifest" }, 404);
      const current = packet();
      return json({ generation: state.generation, schemaHash: state.schemaHash, schema: current.schema, programs: current.programs });
    }
    if (url.pathname === "/api/query") {
      const request = JSON.parse(String(init?.body));
      queries.push({ ...request, principal: state.principal, generation: state.generation, schemaHash: state.schemaHash });
      return await hooks.query?.(request) ?? json(envelope(request));
    }
    if (url.pathname === "/api/mutation") {
      const request = JSON.parse(String(init?.body));
      return await hooks.mutation?.(request) ?? json({ state: "committed", seq: state.seq, data: null, intent: request.replay.intent });
    }
    if (url.pathname === "/api/resume") {
      const body = JSON.parse(String(init?.body));
      resumes.push(body);
      const override = await hooks.resume?.();
      if (override) return override;
      if (body.authEpoch !== state.epoch) return json({ code: "E_AUTH_SESSION", family: "auth", message: "epoch expired", guide: "auth" }, 401);
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
  const create = (startOffline = false) => createClient({ url: "http://reset.test", ...(bearer ? { token: "alice-token" } : { persona: "alice" }), fetch,
    startOffline, offlinePrincipal: bearer ? "alice" : undefined,
    offline: { store: () => (store = factory()) } } as any);
  let client = create();
  await client.ready;
  await client.query(api.messages.first, {});
  return { get client() { return client; }, get store() { return store; }, state, hooks, resumes, queries, streams, envelope,
    async reopen(startOffline = false, beforeReady?: (reopened: typeof client) => void) {
      client = create(startOffline); beforeReady?.(client); await client.ready; return client;
    },
    resets: () => resetCount,
    async rebuilt(op = "messages.second", generation = state.generation) {
      await eventually(async () => {
        const coverage = await store.coverage(), answer = await store.answer(op, {});
        return coverage.facts?.generation === generation && coverage.facts.schemaHash === state.schemaHash
          && !coverage.superseded && answer?.state === "complete"
          && JSON.stringify(answer.data) === JSON.stringify(expandedPage(packet().page))
          && queries.some(query => query.op === op && query.generation === generation && query.schemaHash === state.schemaHash);
      });
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
      assert.equal(live.state, "complete");
      assert.equal(f.queries.at(-1).generation, hex(2), "the successful live response was requested from G2");
      await f.rebuilt();
      assert.equal(f.resets(), 1);
      assert.deepEqual(f.resumes[0], { protocol: 1, generation: hex(1), schemaHash: certified.schemaHash, authEpoch: 1, mounted: [], remaining: 0 });
      assert.equal((await f.store.coverage()).rows.find((row: any) => row.id === overlapRow.id)?.row.at, overlapRow.row.at);
      // Sequence and negative-evidence guards still hold within the new coverage.
      await f.store.commit({ deliveries: [{ op: "older", args: {}, state: "complete", seq: 6, data: null,
        rows: [{ ...overlapRow, row: { ...overlapRow.row, at: -1 } }] }] });
      assert.equal((await f.store.coverage()).rows.find((row: any) => row.id === overlapRow.id)?.row.at, overlapRow.row.at);
      await f.client.offline();
      assert.equal((await f.client.query(api.messages.second, {})).state, "capped");
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
    f.state.schemaHash = successor.schemaHash;
    await f.client.query(api.messages.third, {});
    gate.resolve();
    await f.rebuilt();
    await f.rebuilt("messages.third");
    assert.equal(f.resets(), 1);
    assert.equal(f.resumes.length, 1);
    assert.deepEqual((await f.store.coverage()).facts, { generation: hex(3), schemaHash: successor.schemaHash, authEpoch: 1 });
    assert.deepEqual((await f.store.answer("messages.second", {})).data, expandedPage(successorPage),
      "the G2 operation was rebuilt with G3's distinct-schema result");
    assert.deepEqual((await f.store.answer("messages.third", {})).data, expandedPage(successorPage));
    assert.equal(await f.store.answer("messages.first", {}), undefined);
    assert.equal(f.queries.filter(q => q.op === "messages.second").length, 2, "the buffered G2 answer was re-issued under G3");
  } finally { gate.resolve(); await f.close(); }
});

test("a delayed G2 response cannot replace the G3 supersession marker", async () => {
  const f = await fixture();
  const oldResponse = defer(), reset = defer();
  try {
    let held = true;
    f.hooks.resume = async () => { await reset.promise; return undefined; };
    f.state.generation = hex(2);
    f.hooks.query = async q => {
      if (held && q.op === "messages.second") {
        held = false;
        const g2 = f.envelope(q);
        await oldResponse.promise;
        return json(g2);
      }
    };
    const g2 = f.client.query(api.messages.second, {});
    await eventually(() => f.queries.some(q => q.op === "messages.second" && q.generation === hex(2)));
    f.state.generation = hex(3);
    await f.client.query(api.messages.third, {});
    await eventually(async () => (await f.store.coverage()).superseded?.generation === hex(3));
    oldResponse.resolve();
    await g2;
    assert.equal((await f.store.coverage()).superseded?.generation, hex(3));
    reset.resolve();
    await f.rebuilt("messages.third", hex(3));
  } finally { oldResponse.resolve(); reset.resolve(); await f.close(); }
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
      assert.equal(live.state, "complete", "live read did not await the blocked reset");
      assert.equal(f.queries.at(-1).generation, hex(2), "the live read came from the successor while reset stayed blocked");
      await eventually(() => f.resumes.length === 1);
      const online = f.client.online();
      await pause();
      const concurrent: any = await f.client.query(api.messages.third, {});
      assert.equal(concurrent.seq, 7, "even online() joining the reset cannot block a live query");
      gate.resolve();
      await assert.rejects(online);
      assert.equal(f.client.snapshot.lastRefusal?.code, kind === "transport" ? "E_TRANSPORT" : "E_RESET_TEST");
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
    sub = subscribe(f.client, api.messages.first, {}, () => undefined);
    await eventually(() => f.streams.length === 1);
    const send = (stream: any, id: string, seq = f.state.seq) =>
      stream.controller.enqueue(new TextEncoder().encode(`id: ${id}\ndata: ${JSON.stringify({ ...f.envelope({}), seq })}\n\n`));
    send(f.streams[0], "g1:8", 8);
    await sub.until((e: any) => e.seq === 8, 1000);
    assert.equal((await f.store.coverage()).facts.generation, hex(1));
    f.state.generation = hex(2);
    send(f.streams[0], "g2:7");
    await eventually(() => f.streams.length === 2);
    assert.equal(f.streams[1].headers.get("Last-Event-ID"), null);
    assert.equal(f.streams[1].url.searchParams.get("validator"), null);
    assert.deepEqual(f.resumes[0].mounted, []);
    assert.equal(f.resumes[0].log, undefined, "the old drained log validator cannot cross the superseded fence");
    send(f.streams[1], "g2:7");
    await f.rebuilt("messages.first");
    assert.equal(f.resets(), 1);
  } finally { sub?.close(); await f.close(); }
});

test("tracked Snapback 2 source contains no literal NUL bytes", async () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "snapback2"], { cwd: root }).toString().split("\u0000")
    .filter(path => /\.(?:ts|tsx|js|jsx|mjs|cjs|rs|q|sh|py|json)$/.test(path));
  const bad: string[] = [];
  for (const path of paths) {
    // A worktree rename has an unstaged deleted path until the orchestrator lands it.
    const bytes = await readFile(join(root, path)).catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (bytes?.includes(0)) bad.push(path);
  }
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
      sub = subscribe(f.client, api.messages.log, { c: null }, () => undefined, { drain: true });
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
    await eventually(() => f.client.snapshot.lastRefusal?.code === "E_TRANSPORT");
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
    assert.equal(live.seq, 7);
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

for (const carrier of ["file", "IndexedDB"] as const) {
  test(`${carrier}: reset drops G1 hidden evidence at N so a successor can disclose at the same N, while viewed custody survives`, async () => {
    const f = await fixture(carrier);
    try {
      f.state.seq = 8;
      f.hooks.query = async () => {
        const envelope = f.envelope({});
        return json({ ...envelope, rows: [], data: [], receipt: { ...envelope.receipt,
          ranges: envelope.receipt.ranges.map(({ haloId: _haloId, ...range }: any) =>
            ({ ...range, rowIds: [], stop: "Exhausted" })) } });
      };
      await f.client.query(api.messages.first, {});
      assert.equal((await f.store.coverage()).rows.length, 0);
      assert.deepEqual((await f.store.coverage()).evicted, overlap.rows.map(({ table, id }: any) => ({ table, id })));
      await f.store.commit({ viewed: [{ table: overlapRow.table, id: "viewed" }] });
      f.hooks.query = undefined;
      f.state.generation = hex(2);
      await f.client.query(api.messages.second, {});
      await f.rebuilt();
      assert.deepEqual((await f.store.answer("messages.second", {})).data, expandedPage(overlap));
      assert.deepEqual((await f.store.coverage()).viewed, [{ table: overlapRow.table, id: "viewed" }]);
      // The negative guard still applies inside G2, even to a late equal-seq row.
      await f.store.commit({ tombstones: [{ table: overlapRow.table, id: overlapRow.id, seq: 9 }] });
      await assert.rejects(
        f.store.commit({ deliveries: [{ op: "late", args: {}, ...f.envelope({}), seq: 9 }] }),
        /conflicting durable fact/,
      );
      const coverage = await f.store.coverage();
      assert.equal(coverage.rows.some((row: any) => row.id === overlapRow.id), false);
      assert.ok(coverage.evicted.some((row: any) => row.id === overlapRow.id));
      const answer = await f.store.answer("messages.second", {});
      assert.equal(answer.state, "partial");
      assert.equal(answer.data[0], null, "the equal-seq row remains hidden while unrelated certified rows survive");
    } finally { await f.close(); }
  });
}

test("a successor after program load and before the fresh query commits converges within the same flight", async () => {
  const f = await fixture();
  try {
    f.state.generation = hex(2);
    let reads = 0;
    f.hooks.query = async q => {
      if (q.op === "messages.second" && ++reads === 2) f.state.generation = hex(3);
    };
    const live: any = await f.client.query(api.messages.second, {});
    assert.equal(live.seq, 7);
    await f.rebuilt("messages.second", hex(3));
    assert.equal(reads, 3);
    assert.equal(f.resets(), 2);
    assert.equal(f.client.snapshot.lastRefusal, undefined);
  } finally { await f.close(); }
});

test("a mounted cold reopen discovering G3 during the fresh G2 query feeds the active reset flight", async () => {
  const f = await fixture();
  const gate = defer();
  let sub: any;
  try {
    sub = subscribe(f.client, api.messages.first, {}, () => undefined);
    await eventually(() => f.streams.length === 1);
    let reads = 0;
    f.hooks.query = async q => {
      if (q.op === "messages.second" && ++reads === 2) {
        const g2 = f.envelope(q);
        await gate.promise;
        return json(g2);
      }
    };
    f.state.generation = hex(2);
    await f.client.query(api.messages.second, {});
    await eventually(() => reads === 2 && f.streams.length === 2);
    const flight = (f.client as any).resumeFlight;
    f.state.generation = hex(3);
    f.streams[1].controller.enqueue(new TextEncoder().encode(`id: g3\ndata: ${JSON.stringify(f.envelope({}))}\n\n`));
    await eventually(async () => (await f.store.coverage()).superseded?.generation === hex(3));
    assert.equal((f.client as any).resumeFlight, flight);
    gate.resolve();
    await flight;
    await f.rebuilt("messages.second", hex(3));
    await f.rebuilt("messages.first", hex(3));
    assert.equal(f.resets(), 2);
    assert.equal(f.client.snapshot.lastRefusal, undefined);
  } finally { gate.resolve(); sub?.close(); await f.close(); }
});

test("three fresh-query rotations record a durable refusal instead of reporting convergence", async () => {
  const f = await fixture();
  try {
    f.state.generation = hex(2);
    let reads = 0;
    f.hooks.query = async () => { if (++reads > 1) f.state.generation = hex(reads + 1); };
    await f.client.query(api.messages.second, {});
    await eventually(() => f.client.snapshot.lastRefusal?.code === "E_OFFLINE_RESET");
    assert.equal(reads, 4, "one live read and three bounded rebuild reads");
    assert.ok((await f.store.coverage()).superseded);
    f.hooks.query = undefined;
    await f.client.online();
    await f.rebuilt();
  } finally { await f.close(); }
});

for (const carrier of ["file", "IndexedDB"] as const) {
  test(`${carrier}: cold-start convergence exhaustion resolves ready and online retries on the same client`, async () => {
    const f = await fixture(carrier);
    let sub: any;
    try {
      await f.client.close();
      f.state.generation = hex(2);
      let reads = 0;
      f.hooks.query = async () => { f.state.generation = hex(3 + reads++); };
      const client = await f.reopen(false, client => {
        sub = subscribe(client, api.messages.first, {}, () => undefined);
      });
      assert.equal(reads, 3, "the subscription mounted before ready participates in all three rebuild attempts");
      assert.equal(client.snapshot.lastRefusal?.code, "E_OFFLINE_RESET");
      assert.equal(client.snapshot.lastRefusal?.rewrite, "retry online() after the program stops rotating");
      assert.equal((await f.store.coverage()).superseded.generation, hex(5));
      assert.equal(await f.store.answer("messages.first", {}), undefined);
      await client.offline();
      assert.equal((await client.query(api.messages.first, {})).state, "hydrating");
      f.hooks.query = undefined;
      await client.online();
      await f.rebuilt("messages.first", hex(5));
      assert.equal(f.client, client, "recovery did not replace the client");
      assert.equal((await client.query(api.messages.first, {})).state, "complete");
      assert.equal(client.snapshot.lastRefusal, undefined);
      await client.offline();
      assert.equal((await client.query(api.messages.first, {})).state, "capped");
    } finally { sub?.close(); await f.close(); }
  });

  test(`${carrier}: cancelled reset program adoption and settlement racing login with a grant cannot deadlock the ledger`, { timeout: 5000 }, async () => {
    const f = await fixture(carrier, true);
    const carrierGate = defer(), dismissStarted = defer(), adoptionQueued = defer(), openQueued = defer();
    try {
      const runtime = (f.client as any).offlineRuntime;
      const id = "s2id-00000000000000000000000000000001-0000000000000001";
      const grant = { id, from: id, count: 10, mintedAt: Date.now(), expiresAt: Date.now() + 100000, used: 0 };
      await runtime.outbox.adopt(grant);
      await runtime.outbox.recordBounds({ "messages.send": 0 });
      const entry = await runtime.outbox.enqueue({ op: "messages.send", args: {}, issuedSeq: 7 });
      await runtime.commitMany([], undefined, { put: [runtime.outbox.settle(entry, "rejected", { state: "rejected" })] });
      const commit = f.store.commit.bind(f.store);
      const cancelledWrites: any[] = [];
      f.store.commit = async (swap: any) => {
        if (swap.outbox?.remove?.includes(entry.intent)) { dismissStarted.resolve(); await carrierGate.promise; }
        if (swap.programs) cancelledWrites.push(runtime.principal);
        return commit(swap);
      };
      const program = runtime.program.bind(runtime);
      runtime.program = (value: unknown, signal?: AbortSignal) => {
        const run = program(value, signal);
        if (signal) adoptionQueued.resolve();
        return run;
      };
      const open = runtime.open.bind(runtime);
      runtime.open = (principal: string) => {
        const run = open(principal);
        if (principal === "bob") openQueued.resolve();
        return run;
      };
      f.hooks.login = async () => json({ viewer: "bob", kind: "user", token: "bob-token", grant: { ...grant, id: "bob-grant" } });
      const dismiss = f.client.outbox.dismiss(entry.intent);
      await dismissStarted.promise;
      f.state.generation = hex(2);
      await f.client.query(api.messages.second, {});
      await adoptionQueued.promise;
      const controller = (f.client as any).resumeController as AbortController;
      const cancelled = assert.rejects((f.client as any).resumeFlight);
      const settlement = runtime.commitMany([], undefined, { put: [runtime.outbox.settle(entry, "rejected")] },
        runtime.coverageRevision, () => !controller.signal.aborted);
      const login = f.client.auth.login({ email: "bob", password: "password" });
      await openQueued.promise;
      assert.equal(controller.signal.aborted, true);
      carrierGate.resolve();
      await Promise.all([dismiss, cancelled, settlement, login]);
      assert.equal(runtime.principal, "bob");
      assert.equal((await f.store.outbox.grant()).id, "bob-grant");
      assert.deepEqual(await f.store.outbox.all(), []);
      assert.deepEqual(cancelledWrites, ["bob"], "only the authenticated successor persists a program");
      await f.client.close();
    } finally { carrierGate.resolve(); await f.close(); }
  });
}

test("abort keeps the resume flight slot until that run settles", async () => {
  const f = await fixture();
  const gate = defer();
  try {
    f.hooks.resume = async () => { await gate.promise; return undefined; };
    f.state.generation = hex(2);
    await f.client.query(api.messages.second, {});
    await eventually(() => !!(f.client as any).resumeFlight);
    const flight = (f.client as any).resumeFlight as Promise<void>;
    const rejected = assert.rejects(flight);
    (f.client as any).abortSync();
    assert.equal((f.client as any).resumeFlight, flight);
    assert.equal((f.client as any).resumeController.signal.aborted, true);
    gate.resolve();
    await rejected;
    await eventually(() => (f.client as any).resumeFlight === undefined);
  } finally { gate.resolve(); await f.close(); }
});

test("an abort after durable program persistence re-reads the adopted generation", async () => {
  const f = await fixture();
  const persisted = defer(), release = defer();
  try {
    const runtime = (f.client as any).offlineRuntime;
    const replacement = { generation: hex(2), schemaHash: certified.schemaHash, schema: certified.schema, programs };
    const commit = f.store.commit.bind(f.store);
    f.store.commit = async (swap: any) => {
      await commit(swap);
      if (swap.programs?.[hex(2)]) {
        persisted.resolve();
        await release.promise;
      }
    };
    const controller = new AbortController();
    const adoption = runtime.program(replacement, controller.signal);
    await persisted.promise;
    controller.abort();
    release.resolve();
    await assert.rejects(adoption, (error: any) => error?.name === "AbortError");
    assert.equal(runtime.programGeneration, hex(2));
    assert.deepEqual(Object.keys(await f.store.outbox.programs()), [hex(2)]);
  } finally { release.resolve(); await f.close(); }
});

for (const carrier of ["file", "IndexedDB"] as const) {
  test(`${carrier}: an obsolete settlement tail stays queued and cannot supersede G3; retry settles atomically with G3 rows`, async () => {
    const f = await fixture(carrier);
    const tail = defer(), retry = defer();
    let successorDrain: { close(): void } | undefined;
    try {
      const runtime = (f.client as any).offlineRuntime;
      f.state.generation = hex(2);
      await f.client.query(api.messages.second, {});
      await f.rebuilt();
      await f.store.commit({ watermark: { op: "messages.log", args: {}, watermark: null, updatedAt: 1 } });
      const id = "s2id-00000000000000000000000000000001-0000000000000001";
      await runtime.outbox.adopt({ id, from: id, count: 10, mintedAt: Date.now(), expiresAt: Date.now() + 100000, used: 0 });
      await runtime.outbox.recordBounds({ "messages.send": 0 });
      const entry = await runtime.outbox.enqueue({ op: "messages.send", args: {}, issuedSeq: 7 });
      const replays: any[] = [], swaps: any[] = [];
      f.hooks.mutation = async request => { replays.push(request); if (replays.length === 2) await retry.promise; };
      let fetching = false;
      f.hooks.query = async q => {
        if (q.op === "messages.log" && !fetching) {
          fetching = true;
          const old = f.envelope(q);
          await tail.promise;
          return json(old);
        }
      };
      const original = f.store.commit.bind(f.store);
      f.store.commit = async (swap: any) => { swaps.push(structuredClone(swap)); return original(swap); };
      const drain = f.client.outbox.drain();
      await eventually(() => fetching);
      f.state.generation = hex(3);
      await f.client.query(api.messages.third, {});
      await eventually(async () => (await f.store.coverage()).facts?.generation === hex(3));
      successorDrain = subscribe(f.client, api.messages.log, {}, () => undefined, { drain: true });
      await (successorDrain as any).until((value: any) => value.caughtUp === true, 2_000);
      assert.equal((await f.store.coverage()).watermarks[0]?.generation, hex(3),
        "the successor's real drain page restored settlement-tail custody");
      tail.resolve();
      await drain;
      await eventually(() => replays.length === 2);
      assert.equal((await f.store.outbox.get(entry.intent)).state, "queued");
      assert.equal((await f.store.coverage()).facts.generation, hex(3));
      assert.notEqual((await f.store.coverage()).superseded?.generation, hex(2));
      retry.resolve();
      await f.rebuilt("messages.third", hex(3));
      await eventually(async () => (await f.store.outbox.get(entry.intent)).state === "committed");
      assert.deepEqual(replays[1], replays[0]);
      const settlements = swaps.filter(s => s.outbox?.put?.some((e: any) => e.state === "committed"));
      assert.equal(settlements.length, 1);
      assert.equal(settlements[0].facts.generation, hex(3));
      assert.equal((await f.store.answer("messages.log", {})).seq, 7);
    } finally { tail.resolve(); retry.resolve(); successorDrain?.close(); await f.close(); }
  });
}

for (const action of ["login", "logout", "close"] as const) {
  for (const stage of ["program reload", "fresh query"] as const) {
    test(`${action} aborts a reset during ${stage} and late work never crosses custody`, async () => {
      const f = await fixture("file", true);
      const gate = defer();
      try {
        let blocked = false;
        if (stage === "program reload") f.hooks.program = async () => {
          if (!blocked) { blocked = true; await gate.promise; }
        };
        else {
          let reads = 0;
          f.hooks.query = async q => {
            if (q.op === "messages.second" && ++reads === 2) {
              const old = f.envelope(q); blocked = true; await gate.promise; return json(old);
            }
          };
        }
        f.state.generation = hex(2);
        await f.client.query(api.messages.second, {});
        await eventually(() => blocked);
        const controller = (f.client as any).resumeController as AbortController;
        const flight = (f.client as any).resumeFlight as Promise<void>;
        const rejected = assert.rejects(flight);
        if (action === "login") await f.client.auth.login({ email: "bob", password: "password" });
        else if (action === "logout") await f.client.auth.logout();
        else await f.client.close();
        assert.equal(controller.signal.aborted, true);
        let writes = 0;
        const original = f.store.commit.bind(f.store);
        f.store.commit = async (swap: any) => { writes++; return original(swap); };
        gate.resolve();
        await rejected;
        assert.equal(writes, 0, "the aborted flight performed a carrier write after custody changed");
        assert.equal(f.queries.filter(q => q.op === "messages.second" && q.principal === "bob").length, 0);
        if (action === "login") {
          await f.client.query(api.messages.bob, {});
          assert.equal((await f.store.coverage()).facts.generation, hex(2));
          assert.equal(await f.store.answer("messages.second", {}), undefined);
        }
      } finally { gate.resolve(); await f.close(); }
    });
  }
}

for (const carrier of ["file", "IndexedDB"] as const) {
  test(`${carrier}: cold reopen mid-rebuild preserves the pending marker and reruns mounted coverage before clearing it`, async () => {
    const f = await fixture(carrier);
    const gate = defer();
    let sub: any;
    try {
      let reads = 0;
      f.hooks.query = async () => { if (++reads === 2) await gate.promise; };
      f.state.generation = hex(2);
      await f.client.query(api.messages.second, {});
      await eventually(() => reads === 2);
      const coverage = await f.store.coverage();
      assert.equal(coverage.facts.generation, hex(2));
      assert.equal(coverage.superseded.generation, hex(2));
      await f.client.close();
      await f.reopen(true);
      assert.ok((await f.store.coverage()).superseded);
      assert.equal((await f.client.query(api.messages.second, {})).state, "hydrating");
      f.hooks.query = undefined;
      gate.resolve();
      sub = subscribe(f.client, api.messages.second, {}, () => undefined);
      await f.client.online();
      await f.rebuilt();
      assert.equal(f.resumes.at(-1).generation, hex(2), "the cold pending marker rebuilds even after a 200 resume");
    } finally { gate.resolve(); sub?.close(); await f.close(); }
  });

  test(`${carrier}: a failed program custody swap preserves the predecessor and refuses the reset until retry`, async () => {
    const f = await fixture(carrier);
    try {
      const original = f.store.commit.bind(f.store);
      let failed = false;
      f.store.commit = async (swap: any) => {
        if (!failed && swap.programs?.[hex(2)]) { failed = true; throw new Error("program custody write failed"); }
        return original(swap);
      };
      f.state.generation = hex(2);
      await f.client.query(api.messages.second, {});
      await eventually(() => f.client.snapshot.lastRefusal?.message.includes("program custody write failed") === true);
      assert.equal((await f.store.coverage()).facts.generation, hex(1));
      assert.ok((await f.store.outbox.programs())[hex(1)]);
      assert.ok(await f.store.answer("messages.first", {}), "coverage was not destroyed before custody persisted");
      assert.ok((await f.store.coverage()).superseded);
      await f.client.online();
      await f.rebuilt();
      await f.client.close();
      await f.reopen(true);
      assert.ok((await f.store.outbox.programs())[hex(2)]);
      assert.equal((await f.client.query(api.messages.second, {})).state, "capped");
    } finally { await f.close(); }
  });
}

test("first facts after reset must match the epoch authenticated by the predecessor and reset probe", async () => {
  const f = await fixture("file", true);
  try {
    f.state.generation = hex(2);
    let reads = 0;
    f.hooks.query = async q => {
      if (++reads === 2) return json({ ...f.envelope(q), authority: { principal: "alice", authEpoch: 9 } });
    };
    await f.client.query(api.messages.second, {});
    await eventually(() => f.client.snapshot.lastRefusal?.code === "E_OFFLINE_AUTHORITY");
    assert.equal((await f.store.coverage()).facts.authEpoch, 1);
    assert.ok((await f.store.coverage()).superseded);
    assert.equal(await f.store.answer("messages.second", {}), undefined);
    f.hooks.query = undefined;
    await f.client.online();
    await f.rebuilt();
  } finally { await f.close(); }
});

test("an actual owner epoch transition refuses resume before generation and seals the old session", async () => {
  const f = await fixture("file", true);
  try {
    f.state.generation = hex(2);
    f.state.epoch = 9;
    await f.store.commit({ watermark: { op: "messages.log", args: {}, watermark: null, updatedAt: 1 } });
    await assert.rejects(f.client.online(), (e: any) => e.code === "E_AUTH_SESSION");
    assert.equal(f.resets(), 0);
    assert.equal(await f.client.outbox.ready(), false);
    assert.equal(f.client.snapshot.principal, undefined);
    await assert.rejects(f.store.outbox.grant(), /sealed/);
  } finally { await f.close(); }
});

function emit(stream: { controller: ReadableStreamDefaultController<Uint8Array> }, value: unknown, id = "frame") {
  stream.controller.enqueue(new TextEncoder().encode(`id: ${id}\ndata: ${JSON.stringify(value)}\n\n`));
}

test("reset clears a terminal subscription latch and cold-opens it again", async () => {
  const f = await fixture();
  let sub: any;
  try {
    sub = subscribe(f.client, api.messages.first, {}, () => undefined);
    await eventually(() => f.streams.length === 1);
    emit(f.streams[0], { ...f.envelope({}), seq: 8 }, "before-refusal");
    await sub.until((e: any) => e.seq === 8, 1000);
    const refused = sub.until((e: any) => e.seq === 9, 1000);
    emit(f.streams[0], { state: "refused", code: "E_TERMINAL_TEST", family: "query", message: "stopped", guide: "queries" });
    await assert.rejects(refused, (e: any) => e.code === "E_TERMINAL_TEST");
    const latched: any = await sub.until(() => true);
    assert.equal(latched.state, "refused");
    assert.equal(latched.code, "E_TERMINAL_TEST", "the shared query retains a non-auth refusal for explicit inspection");
    sub.reset();
    await eventually(() => f.streams.length === 2);
    assert.equal(f.streams[1].headers.get("Last-Event-ID"), null);
    emit(f.streams[1], { ...f.envelope({}), seq: 9 }, "new-id");
    assert.equal((await sub.until((e: any) => e.seq === 9, 1000)).state, "complete");
  } finally { sub?.close(); await f.close(); }
});

test("a frame decoding across reopen cannot commit or restore the predecessor event id", async () => {
  const f = await fixture();
  const gate = defer();
  let sub: any;
  try {
    const runtime = (f.client as any).offlineRuntime;
    const accept = runtime.accept.bind(runtime);
    let decoding = false;
    runtime.accept = async (op: string, args: unknown, raw: any) => {
      if (raw.validator === hex(8)) { decoding = true; await gate.promise; }
      return accept(op, args, raw);
    };
    sub = subscribe(f.client, api.messages.first, {}, () => undefined);
    await eventually(() => f.streams.length === 1);
    emit(f.streams[0], { ...f.envelope({}), seq: 8, validator: hex(8) }, "predecessor-id");
    await eventually(() => decoding);
    f.state.generation = hex(2);
    await f.client.query(api.messages.second, {});
    await f.rebuilt();
    gate.resolve();
    await eventually(() => f.streams.length === 2);
    assert.equal((await f.store.answer("messages.first", {})).seq, 7, "the late seq-8 frame did not enter G2 coverage");
    assert.equal((await f.store.coverage()).superseded, undefined);
    assert.equal(f.streams[1].headers.get("Last-Event-ID"), null);
    sub.reconnect();
    await eventually(() => f.streams.length === 3);
    assert.equal(f.streams[2].headers.get("Last-Event-ID"), null, "the subsequent reconnect carries no predecessor id either");
    assert.equal(f.resets(), 1, "dropping an old frame does not schedule a reset");
  } finally { gate.resolve(); sub?.close(); await f.close(); }
});

test("a terminal session frame already decoding across reset still retires the bearer and seals custody", async () => {
  const f = await fixture("file", true);
  const gate = defer();
  let sub: any;
  try {
    const runtime = (f.client as any).offlineRuntime;
    const accept = runtime.accept.bind(runtime);
    let decoding = false;
    runtime.accept = async (op: string, args: unknown, raw: any) => {
      if (raw.code === "E_AUTH_SESSION") { decoding = true; await gate.promise; }
      return accept(op, args, raw);
    };
    sub = subscribe(f.client, api.messages.first, {}, () => undefined);
    await eventually(() => f.streams.length === 1);
    emit(f.streams[0], { state: "refused", code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth" });
    await eventually(() => decoding);
    sub.reset();
    await f.client.offline(); // No subsequent transport can rediscover the evidence.
    gate.resolve();
    await eventually(() => f.client.snapshot.lastRefusal?.code === "E_AUTH_SESSION");
    assert.equal((f.client as any).currentToken, undefined);
    assert.equal(await f.client.outbox.ready(), false);
    await assert.rejects(f.store.outbox.grant(), /sealed/);
    assert.equal(f.streams.length, 1);
  } finally { gate.resolve(); sub?.close(); await f.close(); }
});

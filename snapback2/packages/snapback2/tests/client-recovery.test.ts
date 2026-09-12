import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { api, createClient, readiness } from "../dist/client.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { DAY, engineId, fakeOwner, seededStore } from "./fake-owner.ts";
import { recoverOutbox, createOutboxApi } from "../dist/sqlite-test.mjs";

const args = (body: string) => ({ conversationId: engineId(10), body });
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(condition: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 400; i++) { if (await condition()) return; await pause(); }
  assert.fail("recovery did not converge");
}
async function fixture(options: { facts?: boolean; allocation?: number; bearer?: boolean; fetch?: (owner: ReturnType<typeof fakeOwner>) => typeof fetch } = {}) {
  const root = await mkdtemp(join(tmpdir(), "s2-recovery-"));
  const store = fileRangeStore(root), owner = fakeOwner({ meEpoch: 7, writeAllocation: options.allocation });
  if (options.facts) await seededStore(store);
  const resumes: any[] = [];
  let carrier: any;
  const transport = options.fetch?.(owner) ?? owner.fetch;
  const client: any = createClient({ url: "http://recovery.test", ...(options.bearer ? { token: "token-alice" } : { persona: "alice" }), offline: { store: () => (carrier = store()) },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/resume") resumes.push(JSON.parse(String(init?.body)));
      return transport(input, init);
    } });
  await client.ready;
  return { client, owner, resumes, carrier,
    close: async () => { await client.close(); await rm(root, { recursive: true, force: true }); } };
}

for (const facts of [false, true]) test(`${facts ? "covered" : "write-only"}: 75 352-ID writes cross three renewals without manual Sync`, async () => {
  const f = await fixture({ facts, allocation: 352 });
  try {
    for (let i = 0; i < 75; i++) assert.equal((await f.client.mutation(api.messages.send, args(`${i}`))).state, "committed");
    assert.equal(f.owner.grantsMinted(), 4);
    assert.equal(f.owner.executions.length, 75);
    const ids = f.owner.executions.flatMap(entry => entry.ids);
    assert.equal(new Set(ids).size, ids.length, "no pinned ID is reused across grants");
    assert.deepEqual(f.resumes.map(request => request.remaining), [0, 96, 96, 96]);
    assert.ok(f.resumes.slice(1).every(request => request.demand === "messages.send"));
    if (!facts) {
      assert.equal(f.owner.requests.some(path => path.startsWith("/api/query")), false);
      assert.equal((await f.carrier.metadata()).facts, undefined, "capacity never manufactures coverage");
      assert.equal(f.client.offlineRuntime.seq, 0, "write-only capacity never advances a resume watermark");
    } else {
      const minted = f.owner.grantsMinted(); await f.client.online(); await f.client.online();
      assert.equal(f.owner.grantsMinted(), minted, "healthy resumes report remaining IDs and mint nothing");
    }
  } finally { await f.close(); }
});

test("server demand names the selected operation even when its deficit is above the low watermark", async () => {
  const f = await fixture({ allocation: 1702 });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await f.client.mutation(api.messages.send, args(`${i}`))).state, "committed");
    assert.equal(f.owner.grantsMinted(), 2);
    assert.equal(f.resumes[1].remaining, 1384);
    assert.equal(f.resumes[1].demand, "messages.send");
    assert.equal(f.resumes[1].generation, f.client.offlineRuntime.programGeneration);
  } finally { await f.close(); }
});

test("concurrent pristine admissions coalesce acquisition and reserve distinct slices", async () => {
  const f = await fixture({ allocation: 352 });
  try {
    const result = await Promise.all(Array.from({ length: 12 }, (_, i) => f.client.mutation(api.messages.send, args(`${i}`))));
    assert.ok(result.every(value => value.state === "committed"));
    assert.equal(f.owner.grantsMinted(), 1);
    assert.equal(new Set(f.owner.executions.map(entry => entry.intent)).size, 12);
  } finally { await f.close(); }
});

for (const joined of [false, true]) test(`foreground admission ${joined ? "joining general recovery" : "starting capacity recovery"} does not wait for older replay`, async () => {
  const resumeSent = gate(), resumeRelease = gate(), replaySent = gate(), replayRelease = gate(), demanded = gate();
  let hold = false, original: any, write: Promise<any> | undefined, sync: Promise<any> | undefined;
  const requests: any[] = [];
  const f = await fixture({ facts: true, fetch: owner => async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (hold && path === "/api/resume") { resumeSent.resolve(); await resumeRelease.promise; }
    if (path === "/api/mutation") {
      const body = JSON.parse(String(init?.body)); requests.push(body);
      if (hold && body.replay?.intent === original.intent) { replaySent.resolve(); await replayRelease.promise; }
    }
    return owner.fetch(input, init);
  } });
  try {
    f.owner.state.failAfterCommit = 1;
    assert.equal((await f.client.mutation(api.messages.send, args("older"))).state, "queued");
    original = (await f.client.outbox.entries())[0];
    const ledger = f.client.offlineRuntime.outbox, old = await ledger.grant();
    await ledger.adopt({ ...old, id: engineId(9000), from: engineId(9000), used: old.count });
    hold = true;
    if (joined) {
      sync = f.client.performResume(await f.client.operationAuthority(false)); await resumeSent.promise;
      const resume = f.client.performResume.bind(f.client);
      f.client.performResume = (authority: any, demand?: string) => {
        if (demand === "messages.send") demanded.resolve();
        return resume(authority, demand);
      };
    }
    write = f.client.mutation(api.messages.send, args("foreground"));
    if (joined) await demanded.promise; else await resumeSent.promise;
    sync = f.client.online();
    let completed = false; void sync!.then(() => { completed = true; }, () => { completed = true; });
    resumeRelease.resolve(); await replaySent.promise;
    assert.equal((await ledger.status("messages.send")).ready, true);
    await until(async () => (await ledger.queued()).some((entry: any) => entry.args.body === "foreground"));
    assert.equal(completed, false, "online still waits for the ordinary recovery verdict");
    assert.ok(f.client.resumeFlight, "admission does not cancel or clear the recovery owner");
    const queued = await ledger.queued();
    assert.deepEqual(queued.map((entry: any) => entry.args.body), ["older", "foreground"]);
    assert.deepEqual(queued[0].ids, original.ids);
    assert.equal(queued[0].grant, original.grant);
    assert.deepEqual(requests[1], requests[0], "the older retry preserves its exact wire envelope");
    assert.equal(requests.length, 2, "the foreground cannot send past held older replay");
    replayRelease.resolve();
    assert.equal((await write).state, "committed"); await sync;
    assert.deepEqual(f.owner.executions.map(entry => (entry.args as any).body), ["older", "foreground"]);
  } finally {
    resumeRelease.resolve(); replayRelease.resolve();
    await Promise.allSettled([write, sync].filter(Boolean)); await f.close();
  }
});

for (const boundary of ["offline", "close", "login", "reset", "read-error"] as const) test(`foreground readiness ${boundary} cannot release a stale admission waiter`, async () => {
  const replaySent = gate(), replayRelease = gate(), readyRead = gate(), readyRelease = gate();
  let hold = false, original: any, write: Promise<any> | undefined;
  const f = await fixture({ facts: true, bearer: boundary === "login", fetch: owner => async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (hold && path === "/api/mutation" && JSON.parse(String(init?.body)).replay?.intent === original.intent) {
      replaySent.resolve(); await replayRelease.promise;
    }
    if (path === "/api/auth/login") return Response.json({ viewer: "dev:bob", token: "token-bob", kind: "user", authEpoch: 8 });
    return owner.fetch(input, init);
  } });
  try {
    f.owner.state.failAfterCommit = 1;
    assert.equal((await f.client.mutation(api.messages.send, args("older"))).state, "queued");
    original = (await f.client.outbox.entries())[0];
    const runtime = f.client.offlineRuntime, ledger = runtime.outbox, old = await ledger.grant();
    await ledger.adopt({ ...old, id: engineId(9000), from: engineId(9000), used: old.count });
    const status = ledger.status.bind(ledger), subscribe = ledger.subscribe.bind(ledger);
    let watched = 0, readsHeld = true;
    ledger.subscribe = (callback: () => void) => { watched++; const stop = subscribe(callback); return () => { watched--; stop(); }; };
    ledger.status = async (op?: string) => {
      const value = await status(op);
      if (readsHeld && op === "messages.send" && value.ready) {
        readyRead.resolve(); await readyRelease.promise;
        if (boundary === "read-error") throw new Error("transient readiness read failure");
      }
      return value;
    };
    hold = true;
    write = f.client.mutation(api.messages.send, args("foreground"));
    await readyRead.promise; await replaySent.promise;
    if (boundary === "reset") await runtime.resetCoverage(7);
    else if (boundary === "login") await f.client.auth.login({ email: "bob@example.com", password: "test" });
    else if (boundary !== "read-error") await f.client[boundary]();
    readyRelease.resolve(); await flush();
    if (boundary === "reset" || boundary === "read-error") {
      assert.equal((await ledger.queued()).some((entry: any) => entry.args.body === "foreground"), false,
        "neither an incomplete reset nor a failed advisory read releases admission");
      readsHeld = false; replayRelease.resolve();
      assert.equal((await write).state, "committed");
      assert.equal(runtime.resetNeeded, false);
    } else {
      const result = await write;
      assert.equal(result.state, "rejected"); assert.equal(result.intent, undefined);
      assert.equal(f.owner.executions.length, 1, "late readiness never creates a foreground owner request");
    }
    await flush();
    assert.equal(watched, 0, "the temporary readiness listener and terminal slot retire");
  } finally {
    readyRelease.resolve(); replayRelease.resolve();
    await Promise.allSettled([write].filter(Boolean)); await f.close();
  }
});

test("foreground readiness does not reserve capacity consumed before enqueue", async () => {
  const replaySent = gate(), replayRelease = gate(), consumed = gate();
  let hold = false, original: any, write: Promise<any> | undefined;
  const f = await fixture({ facts: true, fetch: owner => async (input, init) => {
    if (hold && new URL(String(input)).pathname === "/api/mutation"
      && JSON.parse(String(init?.body)).replay?.intent === original.intent) { replaySent.resolve(); await replayRelease.promise; }
    return owner.fetch(input, init);
  } });
  try {
    f.owner.state.failAfterCommit = 1;
    assert.equal((await f.client.mutation(api.messages.send, args("older"))).state, "queued");
    original = (await f.client.outbox.entries())[0];
    const ledger = f.client.offlineRuntime.outbox, old = await ledger.grant();
    await ledger.adopt({ ...old, id: engineId(9000), from: engineId(9000), used: old.count });
    const enqueue = ledger.enqueue.bind(ledger);
    let consume = true, exhausted: string | undefined;
    ledger.enqueue = async (input: any, ...rest: any[]) => {
      if (input.args.body === "foreground" && consume) {
        consume = false;
        const grant = await ledger.grant(); exhausted = grant.id;
        await ledger.write(() => f.carrier.commit({ grants: { current: grant.id, put: [{ ...grant, used: grant.count }] } }));
        try { return await enqueue(input, ...rest); } finally { consumed.resolve(); }
      }
      return enqueue(input, ...rest);
    };
    hold = true; write = f.client.mutation(api.messages.send, args("foreground"));
    await replaySent.promise; await consumed.promise;
    assert.deepEqual((await ledger.queued()).map((entry: any) => entry.intent), [original.intent]);
    replayRelease.resolve();
    const result = await write;
    assert.equal(result.state, "rejected"); assert.equal(result.code, "E_OFFLINE_ID_BLOCK");
    assert.equal(result.intent, undefined, "the finite same-demand attempt preserves a pristine refusal");
    await until(() => !f.client.resumeFlight);
    assert.equal((await f.client.mutation(api.messages.send, args("foreground"))).state, "committed");
    const entry = (await ledger.entries()).find((entry: any) => entry.args.body === "foreground");
    assert.notEqual(entry.grant, exhausted, "the pristine retry reserves a new grant, never exhausted IDs");
    assert.deepEqual(f.owner.executions.map(entry => (entry.args as any).body), ["older", "foreground"]);
  } finally { replayRelease.resolve(); await Promise.allSettled([write].filter(Boolean)); await f.close(); }
});

test("pure snapshots do no I/O; first selected subscription heals disabled sending, including an idle expired grant", async () => {
  const f = await fixture({ facts: true });
  let detach: (() => void) | undefined;
  try {
    const old = await f.carrier.outbox.grant();
    const expired = { ...old, id: engineId(9000), from: engineId(9000), used: 0, expiresAt: Date.now() - 1, mintedAt: Date.now() - 31 * DAY };
    await f.client.offlineRuntime.outbox.adopt(expired);
    const view = f.client.outbox.observe(api.messages.send), before = f.owner.requests.length;
    for (let i = 0; i < 20; i++) { view.getSnapshot(); await f.client.outbox.ready(api.messages.send); }
    assert.equal(f.owner.requests.length, before);
    detach = view.subscribe(() => undefined);
    await until(() => view.getSnapshot().status.ready);
    assert.equal(f.resumes.at(-1).remaining, 0, "expired capacity is unusable even when used is zero");
    assert.equal(f.owner.grantsMinted(), 2);
  } finally { detach?.(); await f.close(); }
});

test("oldest blocked follower inbox demand acquires capacity without any mounted hooks or query facts", async () => {
  const store = indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
  const owner = fakeOwner({ meEpoch: 7, writeAllocation: 352 });
  const open = () => createClient({ url: "http://recovery-tabs.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  const writer = open(); await writer.ready;
  const follower = open(); await follower.ready;
  try {
    assert.equal((await follower.outbox.status()).reason, "forwarding");
    assert.equal((await follower.mutation(api.messages.send, args("oldest"))).state, "queued");
    await until(() => owner.executions.length === 1);
    assert.equal(owner.grantsMinted(), 1);
    assert.equal((owner.executions[0].args as any).body, "oldest");
  } finally { await follower.close(); await writer.close(); }
});

for (const boundary of ["offline", "close", "login"] as const) test(`${boundary} cancels pending acquisition and ignores its late grant before custody`, async () => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const sent = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture({ bearer: boundary === "login", fetch: owner => async (input, init) => {
    if (new URL(String(input)).pathname === "/api/resume") { entered(); await held; }
    if (new URL(String(input)).pathname === "/api/auth/login") return Response.json({ viewer: "dev:bob", token: "token-bob", kind: "user", authEpoch: 8 });
    return owner.fetch(input, init);
  } });
  try {
    const write = f.client.mutation(api.messages.send, args("not durable yet"));
    void write.catch(() => undefined);
    await sent;
    if (boundary === "login") {
      await f.client.auth.login({ email: "bob@example.com", password: "test" });
      assert.equal(f.client.offlineRuntime.principal, "dev:bob");
    } else await f.client[boundary]();
    const result = await write;
    assert.equal(result.state, "rejected");
    assert.equal(result.intent, undefined, "the cancelled call never acquired durable custody");
    release(); await pause(); await pause();
    assert.equal(f.owner.executions.length, 0);
    if (boundary !== "close") assert.equal((await f.carrier.outbox.grants()).length, 0);
  } finally { release(); await f.close(); }
});

test("a fetch that ignores abort is deadline bounded; pure reads do not restart the failed episode", async t => {
  let entered!: () => void;
  const sent = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture({ fetch: owner => async (input, init) => {
    if (new URL(String(input)).pathname === "/api/resume") { entered(); return new Promise<Response>(() => undefined); }
    return owner.fetch(input, init);
  } });
  let detach: (() => void) | undefined;
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const view = f.client.outbox.observe(api.messages.send); detach = view.subscribe(() => undefined);
    await sent;
    assert.equal(readiness(await f.client.outbox.status(api.messages.send), "connected", 0).action, "wait");
    t.mock.timers.tick(10_000);
    for (let i = 0; i < 30; i++) await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.client.resumeFlight, undefined);
    assert.equal(f.client.snapshot.lastRefusal.code, "E_TRANSPORT");
    for (let i = 0; i < 10; i++) { view.getSnapshot(); await f.client.outbox.ready(api.messages.send); }
    assert.equal(f.resumes.length, 1);
    assert.equal(readiness(await f.client.outbox.status(api.messages.send), "connected", 0).action, "connect");
  } finally { t.mock.timers.reset(); detach?.(); await f.close(); }
});

test("self-minted but already expired replacement is one failed automatic episode, not a mint loop", async () => {
  let expired = true;
  const f = await fixture({ fetch: owner => async (input, init) => {
    const response = await owner.fetch(input, init);
    if (new URL(String(input)).pathname !== "/api/resume") return response;
    const body = await response.json(); if (expired) body.grant.expiresAt = Date.now() - 1;
    return Response.json(body);
  } });
  const view = f.client.outbox.observe(api.messages.send), detach = view.subscribe(() => undefined);
  try {
    await until(() => view.getSnapshot().status.reason === "grant-expired" && !view.getSnapshot().status.recovering);
    for (let i = 0; i < 40; i++) { view.getSnapshot(); await pause(); }
    assert.equal(f.resumes.length, 1);
    assert.equal(f.owner.grantsMinted(), 1);
    assert.equal(readiness(view.getSnapshot().status, "connected", 0).action, "connect");
    expired = false; await f.client.online(); await until(() => view.getSnapshot().status.ready);
    assert.equal(f.resumes.length, 2, "explicit Sync opens one new demand opportunity even with no query facts");
  } finally { detach(); await f.close(); }
});

for (const disconnect of [false, true]) test(`an expensive selected observer ${disconnect ? "detached while joining stops before followup" : "gets its own bounded demand after joining a healthy no-demand resume"}`, async () => {
  let hold = false, release!: () => void, entered!: () => void;
  const sent = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture({ facts: true, allocation: 1702, fetch: owner => async (input, init) => {
    if (hold && new URL(String(input)).pathname === "/api/resume") { hold = false; entered(); await held; }
    return owner.fetch(input, init);
  } });
  let detach: (() => void) | undefined;
  try {
    const current = await f.carrier.outbox.grant();
    await f.client.offlineRuntime.outbox.adopt({ ...current, id: engineId(9000), from: engineId(9000), used: 6808 });
    hold = true; const sync = f.client.online(); await sent;
    let joined = false;
    const resume = f.client.performResume.bind(f.client);
    f.client.performResume = (authority: any, demand?: string) => { joined ||= demand === "messages.send"; return resume(authority, demand); };
    const view = f.client.outbox.observe(api.messages.send); detach = view.subscribe(() => undefined);
    await until(() => joined);
    if (disconnect) detach();
    release(); await sync;
    if (disconnect) {
      for (let i = 0; i < 10; i++) await pause();
      assert.equal(f.resumes.length, 2, "a detached observer cannot start its demand-specific followup");
      return;
    }
    await until(() => view.getSnapshot().status.ready);
    assert.equal(f.resumes.length, 3, "startup, healthy resume, then one selected-demand followup");
    assert.equal(f.resumes[1].demand, undefined);
    assert.equal(f.resumes[2].demand, "messages.send");
    assert.equal(f.resumes[2].remaining, 1384);
  } finally { release(); detach?.(); await f.close(); }
});

test("detaching the last observer during asynchronous preflight starts no capacity request", async () => {
  const f = await fixture();
  let detach: (() => void) | undefined, release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), sent = new Promise<void>(resolve => { entered = resolve; });
  try {
    const status = f.client.offlineRuntime.outbox.status.bind(f.client.offlineRuntime.outbox);
    let reads = 0;
    f.client.offlineRuntime.outbox.status = async (op?: string) => {
      const value = await status(op);
      if (op === "messages.send" && ++reads === 2) { entered(); await held; }
      return value;
    };
    detach = f.client.outbox.observe(api.messages.send).subscribe(() => undefined);
    await sent; detach(); release();
    for (let i = 0; i < 10; i++) await pause();
    assert.equal(f.resumes.length, 0);
  } finally { release(); detach?.(); await f.close(); }
});

test("a follower becoming durable during a local capacity wait is admitted first", async () => {
  const store = indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
  const owner = fakeOwner({ meEpoch: 7 });
  let release!: () => void, entered!: () => void;
  const sent = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const writer = createClient({ url: "http://recovery-fifo.test", persona: "alice", offline: { store }, fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/api/resume") { entered(); await held; }
    return owner.fetch(input, init);
  } });
  await writer.ready;
  const local = writer.mutation(api.messages.send, args("local")); await sent;
  const follower = createClient({ url: "http://recovery-fifo.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  try {
    await follower.ready;
    assert.equal((await follower.mutation(api.messages.send, args("follower"))).state, "queued");
    release(); assert.equal((await local).state, "committed");
    assert.deepEqual(owner.executions.map(entry => (entry.args as any).body), ["follower", "local"]);
  } finally { release(); await follower.close(); await writer.close(); }
});

test("capacity-only generation refusal cannot create reset facts, renew trust, or loop", async () => {
  const f = await fixture({ fetch: owner => async (input, init) => new URL(String(input)).pathname === "/api/resume"
    ? Response.json({ code: "E_OFFLINE_RESET", family: "offline", message: "generation changed", guide: "offline" }, { status: 409 })
    : owner.fetch(input, init) });
  const view = f.client.outbox.observe(api.messages.send), detach = view.subscribe(() => undefined);
  try {
    await until(() => f.resumes.length === 1 && !f.client.resumeFlight);
    assert.equal((await f.carrier.metadata()).facts, undefined);
    assert.equal(f.client.offlineRuntime.resetNeeded, false);
    assert.equal((await f.carrier.outbox.grants()).length, 0);
    assert.equal(f.client.snapshot.lastRefusal.code, "E_OFFLINE_RESET");
    for (let i = 0; i < 10; i++) await pause();
    assert.equal(f.resumes.length, 1);
  } finally { detach(); await f.close(); }
});

test("program replacement during acquisition refuses the original call before durable admission", async () => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), sent = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture({ fetch: owner => async (input, init) => {
    if (new URL(String(input)).pathname === "/api/resume") { entered(); await held; }
    return owner.fetch(input, init);
  } });
  try {
    const call = f.client.mutation(api.messages.send, args("old program")); await sent;
    const response = await f.owner.fetch("http://recovery.test/api/program"), program = await response.json();
    await f.client.offlineRuntime.program({ ...program, generation: "e".repeat(64) });
    release(); const result = await call;
    assert.equal(result.state, "rejected"); assert.equal(result.code, "E_GENERATION_CHANGED");
    assert.equal((await f.client.outbox.entries()).length, 0);
    assert.equal(f.owner.executions.length, 0);
  } finally { release(); await f.close(); }
});

for (const automatic of [false, true]) test(`${automatic ? "selected capacity recovery alone" : "manual Sync joining capacity-only recovery"} still drains the original queued envelope`, async () => {
  let hold = false, release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), sent = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture({ fetch: owner => async (input, init) => {
    if (hold && new URL(String(input)).pathname === "/api/resume") { hold = false; entered(); await held; }
    return owner.fetch(input, init);
  } });
  let detach: (() => void) | undefined;
  try {
    f.owner.state.failAfterCommit = 1;
    const queued = await f.client.mutation(api.messages.send, args("lost acknowledgement"));
    assert.equal(queued.state, "queued");
    const original = (await f.client.outbox.entries())[0], old = await f.carrier.outbox.grant();
    await f.client.offlineRuntime.outbox.adopt({ ...old, id: engineId(9000), from: engineId(9000), used: old.count });
    hold = true;
    if (automatic) {
      detach = f.client.outbox.observe(api.messages.send).subscribe(() => undefined);
      await sent; release();
      await until(async () => (await f.client.outbox.entries())[0].state === "committed");
    } else {
      const capacity = f.client.performResume(await f.client.operationAuthority(), "messages.send"); await sent;
      const sync = f.client.online(); release(); await capacity; await sync;
    }
    const settled = (await f.client.outbox.entries())[0];
    assert.equal(settled.state, "committed"); assert.equal(settled.intent, original.intent);
    assert.equal(settled.grant, original.grant); assert.deepEqual(settled.ids, original.ids);
    assert.equal(f.owner.executions.length, 1);
  } finally { release(); detach?.(); await f.close(); }
});

test("an obsolete queued grant-adoption callback cannot consume a newer session grant", async () => {
  const f = await fixture();
  try {
    const runtime = f.client.offlineRuntime, now = Date.now();
    let release!: () => void;
    runtime.tail = new Promise<void>(resolve => { release = resolve; });
    const grant = (id: number) => ({ id: engineId(id), from: engineId(id), count: 8192, mintedAt: now, expiresAt: now + 30 * DAY });
    runtime.noteGrant({ grant: grant(9000) }, "dev:alice");
    const obsolete = runtime.adoptPendingGrant(() => { throw new Error("obsolete authority"); });
    runtime.noteGrant({ grant: grant(19000) }, "dev:alice");
    release(); await obsolete; await runtime.adoptPendingGrant();
    assert.equal((await f.carrier.outbox.grant()).id, engineId(19000));
  } finally { await f.close(); }
});

test("same-principal open advances lifecycle and rolls back a deferred obsolete grant", async () => {
  const f = await fixture();
  try {
    const runtime = f.client.offlineRuntime;
    const before = runtime.outbox.generation;
    const originalGrant = await runtime.outbox.grant();
    const persisted = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const commit = runtime.store.commit.bind(runtime.store);
    const replacement = { id: engineId(9000), from: engineId(9000), count: 8192,
      used: 0, mintedAt: Date.now(), expiresAt: Date.now() + 30 * DAY };
    runtime.store.commit = async (swap: any) => {
      await commit(swap);
      if (swap.grants?.current === replacement.id) {
        persisted.resolve();
        await release.promise;
      }
    };
    runtime.noteGrant({ grant: replacement }, "dev:alice");
    const generation = runtime.outbox.generation;
    const adoption = runtime.adoptPendingGrant(() => {
      if (runtime.outbox.generation !== generation) throw new Error("obsolete lifecycle");
    });
    await persisted.promise;
    const reopened = runtime.open("dev:alice", true);
    assert.equal(runtime.outbox.generation, before + 1);
    release.resolve();
    await assert.rejects(adoption, /obsolete lifecycle/);
    await reopened;
    assert.equal((await runtime.outbox.grant())?.id, originalGrant?.id);
    assert.equal((await runtime.store.outbox.grants()).some((grant: any) => grant.id === replacement.id), false);
  } finally { await f.close(); }
});

test("reads recovering real transport never reissue a rejected mutation as a new intent", async () => {
  let mutations = 0, failRead = true;
  const f = await fixture({ fetch: owner => async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/mutation") {
      mutations += 1;
      return Response.json({ state: "rejected", code: "NOT_MEMBER", family: "input", message: "not a member", guide: "offline" });
    }
    if (path === "/api/query" && failRead) { failRead = false; return Response.json({}, { status: 503 }); }
    return owner.fetch(input, init);
  } });
  try {
    assert.equal((await f.client.mutation(api.messages.send, args("refused"))).state, "rejected");
    await f.client.query(api.messages.inbox, { c: null });
    await pause(); await pause();
    assert.equal(mutations, 1);
    assert.equal((await f.client.outbox.entries()).filter((entry: any) => entry.state === "queued").length, 0);
  } finally { await f.close(); }
});

function gate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(done => setImmediate(done)); };

test("recovery callers have independent deadlines while their shared work can finish", async t => {
  const resumed = gate(), scope = new AbortController();
  let settled = 0;
  const host = { ready: async () => {}, identity: () => "alice:1", scope: () => scope.signal,
    online: async () => resumed.promise,
    settled: async () => { settled++; return { stopped: false as const, remaining: 0 }; } };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const first = recoverOutbox(host); await flush();
    t.mock.timers.tick(5_000);
    const second = recoverOutbox(host); await flush();
    t.mock.timers.tick(5_000); await flush();
    assert.equal((await first).refusal.code, "E_TRANSPORT");
    resumed.resolve();
    assert.deepEqual(await second, { settlement: { stopped: false, remaining: 0 } });
    assert.equal(settled, 1, "expired caller does not start settlement after its shared resume finishes");
    assert.deepEqual(await recoverOutbox(host), { settlement: { stopped: false, remaining: 0 } }, "a later call owns a fresh wait");
  } finally { t.mock.timers.reset(); resumed.resolve(); }
});

test("recovery cannot clear an offline cut made while startup was still pending", async () => {
  const startup = gate(), scope = new AbortController();
  let online = 0;
  const recovery = recoverOutbox({ ready: () => startup.promise, identity: () => "alice:1", scope: () => scope.signal,
    online: async () => { online++; }, settled: async () => ({ stopped: false, remaining: 0 }) });
  scope.abort();
  const result = await recovery;
  assert.equal(result.refusal.code, "E_OFFLINE_LIFECYCLE");
  assert.equal(result.settlement, undefined, "a lifecycle refusal has no invented remaining count");
  startup.resolve(); await flush();
  assert.equal(online, 0);
});

test("A to B to A invalidates a recovery waiter even when the account string returns", async () => {
  const resumed = gate(), scope = new AbortController();
  let generation = 1, settlementReads = 0;
  const result = recoverOutbox({ ready: async () => {}, identity: () => `alice:${generation}`, scope: () => scope.signal,
    online: async () => resumed.promise, settled: async () => { settlementReads++; return { stopped: false, remaining: 0 }; } });
  await flush(); generation += 2; scope.abort();
  assert.equal((await result).refusal.code, "E_AUTH_SUPERSEDED");
  resumed.resolve(); await flush();
  assert.equal(settlementReads, 0);
});

for (const following of [false, true]) test(`recovery fences a late ${following ? "follower refresh" : "drain"} before reading a new partition`, async () => {
  const pending = gate(), scope = new AbortController();
  let reads = 0;
  const runtime: any = { principal: "dev:alice", following, drainTail: pending.promise,
    drainVerdict: Promise.resolve({ stopped: false, remaining: 0 }),
    itemEntries: async () => { reads++; return []; }, inboxPending: 0,
    outbox: { status: async () => { reads++; return { remaining: 0 }; } } };
  const api = createOutboxApi(runtime, async () => ({ stopped: false, remaining: 0 }), async () => {}, () => false,
    { refresh: () => pending.promise }, () => "alice:1", undefined, undefined,
    { scope: () => scope.signal, online: async () => {}, connection: () => "connected", subscribe: () => () => {} });
  const recovering = api.recover(); await flush(); scope.abort();
  assert.equal((await recovering).refusal.code, "E_OFFLINE_LIFECYCLE");
  runtime.principal = "dev:bob";
  pending.resolve(); await flush();
  assert.equal(reads, 0, "an expired outer Promise cannot leave unguarded settlement work behind");
});

for (const boundary of ["offline", "close", "login"] as const) test(`public recover promptly refuses ${boundary} while resume ignores abort`, async () => {
  const held = gate(), sent = gate();
  let hold = false;
  const f = await fixture({ facts: true, bearer: boundary === "login", fetch: owner => async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/resume" && hold) { sent.resolve(); await held.promise; }
    if (path === "/api/auth/login") return Response.json({ viewer: "dev:bob", token: "token-bob", kind: "user", authEpoch: 8 });
    return owner.fetch(input, init);
  } });
  try {
    hold = true;
    const recovering = f.client.outbox.recover();
    await sent.promise;
    if (boundary === "login") await f.client.auth.login({ email: "bob@example.com", password: "test" });
    else await f.client[boundary]();
    const result = await recovering;
    assert.equal(result.refusal.code, boundary === "login" ? "E_AUTH_SUPERSEDED" : "E_OFFLINE_LIFECYCLE");
    assert.equal(result.settlement, undefined);
    held.resolve(); await flush();
    if (boundary === "offline") assert.equal(f.client.snapshot.connection, "offline");
    assert.equal(f.owner.executions.length, 0);
  } finally { held.resolve(); await f.close(); }
});

test("public recovery drains saved work and repeated recovery has truthful zero settlement", async () => {
  const f = await fixture({ facts: true });
  try {
    await f.client.offline();
    const saved = await f.client.mutation(api.messages.send, args("recover me"));
    assert.equal(saved.state, "queued");
    assert.deepEqual(await f.client.outbox.recover(), { settlement: { stopped: false, remaining: 0 } });
    assert.deepEqual(await f.client.outbox.recover(), { settlement: { stopped: false, remaining: 0 } });
    assert.equal(f.owner.executions.length, 1);
  } finally { await f.close(); }
});

test("recovery retains structured deadline refusals on native signals without reason", async t => {
  const NativeController = globalThis.AbortController;
  class WithoutReason extends NativeController {
    constructor() { super(); Object.defineProperty(this.signal, "reason", { get: () => undefined }); }
  }
  globalThis.AbortController = WithoutReason;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const scope = new AbortController();
    const result = recoverOutbox({ ready: () => new Promise(() => {}), identity: () => "alice:1", scope: () => scope.signal,
      online: async () => {}, settled: async () => ({ stopped: false, remaining: 0 }) });
    t.mock.timers.tick(10_000);
    const value = await result;
    assert.equal(value.refusal.code, "E_TRANSPORT");
    assert.equal(value.refusal.site, "client.outbox.recover");
    assert.equal(value.settlement, undefined);
  } finally { globalThis.AbortController = NativeController; t.mock.timers.reset(); }
});

test("follower recovery keeps the writer offline and the work lookup follows its inbox alias", async () => {
  const store = indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
  await seededStore(store);
  const owner = fakeOwner();
  const open = () => createClient({ url: "http://recover-follower.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  const writer = open(); await writer.ready; await writer.offline();
  const follower = open(); await follower.ready;
  const view = follower.outbox.observe(api.messages.send), detach = view.subscribe(() => {});
  try {
    await until(() => view.getSnapshot().status.reason === "forwarding");
    const saved = await follower.mutation(api.messages.send, args("stay on this device"));
    assert.equal(saved.state, "queued");
    assert.match(saved.intent, /^inbox:/);
    await until(() => view.getWork(saved.intent) !== undefined);
    const result = await follower.outbox.recover();
    assert.equal(result.refusal, undefined);
    assert.ok(result.settlement.remaining > 0);
    assert.equal(result.settlement.stopped, "pending");
    assert.equal(writer.snapshot.connection, "offline");
    assert.equal(owner.executions.length, 0);
    await until(() => view.getWork(saved.intent)?.entry.intent !== saved.intent);
    const admitted = view.getWork(saved.intent);
    assert.equal(admitted.entry.inbox, Number(saved.intent.slice("inbox:".length)));
    assert.strictEqual(view.getWork(admitted.entry.intent), admitted);
    await writer.online();
    await until(() => owner.executions.length === 1);
    await until(() => view.getWork(saved.intent)?.entry.state !== "queued");
    const final = view.getWork(saved.intent);
    assert.ok(final === undefined || (final.entry.state === "committed" && final.dismissible));
  } finally { detach(); await follower.close(); await writer.close(); }
});

test("concurrent public recovery joins one held resume instead of starting another after it", async () => {
  const held = gate(), sent = gate();
  let hold = false, requests = 0;
  const f = await fixture({ facts: true, fetch: owner => async (input, init) => {
    if (new URL(String(input)).pathname === "/api/resume" && hold) { requests++; sent.resolve(); await held.promise; }
    return owner.fetch(input, init);
  } });
  try {
    hold = true;
    const first = f.client.outbox.recover(); await sent.promise;
    const second = f.client.outbox.recover(), third = f.client.outbox.recover();
    await flush();
    assert.equal(requests, 1);
    held.resolve();
    const results = await Promise.all([first, second, third]);
    assert.deepEqual(results, Array.from({ length: 3 }, () => ({ settlement: { stopped: false, remaining: 0 } })));
    assert.equal(requests, 1, "later callers join the active owner before awaiting its completion");
  } finally { held.resolve(); await f.close(); }
});

test("an offline follower keeps its durable work visible through writer takeover", async () => {
  const store = indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
  await seededStore(store);
  const owner = fakeOwner();
  const open = (): any => createClient({ url: "http://recover-takeover.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  const writer = open(); await writer.ready; await writer.offline();
  const follower = open(); await follower.ready; await follower.offline();
  const view = follower.outbox.observe(api.messages.send), detach = view.subscribe(() => {});
  const entered = gate();
  let during: any;
  const takeover = follower.takeover.bind(follower);
  follower.takeover = () => {
    const run = takeover();
    // Inspect the public resource while the real lock-transfer callback is suspended.
    during = view.getSnapshot(); entered.resolve();
    return run;
  };
  try {
    const saved = await follower.mutation(api.messages.send, args("survive the sending tab"));
    assert.equal(saved.state, "queued");
    await until(() => view.getWork(saved.intent) !== undefined);
    await writer.close(); await entered.promise;
    assert.ok(during.entries.some((entry: any) => entry.intent === saved.intent || `inbox:${entry.inbox}` === saved.intent));
    assert.ok(during.work.length > 0);
    assert.equal(follower.snapshot.connection, "offline");
    assert.equal(owner.executions.length, 0);
  } finally { detach(); await follower.close(); await writer.close(); }
});

// @ref LLP 1012#7-writes-offline — appending an online intent does not wait
// for older transport; its own terminal result does not wait for newer work.
test("online admission stays FIFO and resolves its own result while newer replay waits", async () => {
  const older = Promise.withResolvers<void>(), later = Promise.withResolvers<void>();
  const laterStarted = Promise.withResolvers<void>();
  let firstOlder = true;
  const f = await fixture({ facts: true, fetch: owner => async (input, init) => {
    if (new URL(String(input)).pathname === "/api/mutation") {
      const body = JSON.parse(String(init?.body)).args?.body;
      if (body === "older") {
        if (firstOlder) { firstOlder = false; throw new TypeError("lost connection before admission"); }
        await older.promise;
      }
      if (body === "later") { laterStarted.resolve(); await later.promise; }
    }
    return owner.fetch(input, init);
  } });
  const pending: Promise<unknown>[] = [];
  try {
    assert.equal((await f.client.mutation(api.messages.send, args("older"))).state, "queued");
    const own = f.client.mutation(api.messages.send, args("foreground")); pending.push(own);
    await until(async () => (await f.client.outbox.entries()).some((entry: any) => entry.args.body === "foreground"));
    assert.equal(f.owner.executions.length, 0, "foreground is durable without overtaking older transport");
    const following = f.client.mutation(api.messages.send, args("later")); pending.push(following);
    await until(async () => (await f.client.outbox.entries()).some((entry: any) => entry.args.body === "later"));
    older.resolve();
    let observed: any;
    void own.then((result: any) => { observed = result; });
    await until(() => observed !== undefined);
    assert.equal(observed.state, "committed", "own terminal does not wait for later replay");
    await laterStarted.promise;
    assert.deepEqual(f.owner.executions.map(entry => (entry.args as any).body), ["older", "foreground"]);
    assert.equal((await f.client.outbox.entries()).find((entry: any) => entry.args.body === "later").state, "queued");
    later.resolve();
    assert.equal((await following).state, "committed");
    assert.deepEqual(f.owner.executions.map(entry => (entry.args as any).body), ["older", "foreground", "later"]);
  } finally { older.resolve(); later.resolve(); await Promise.allSettled(pending); await f.close(); }
});

// @ref LLP 1012#7-writes-offline — the owner's commit is not a local
// settlement when a coverage change causes the queued atomic swap to skip.
test("an online result stays queued when coverage supersedes its settlement swap", async () => {
  const f = await fixture({ facts: true });
  const runtime = f.client.offlineRuntime;
  const commit = runtime.commitMany.bind(runtime);
  let skipped = false;
  runtime.commitMany = async (...values: any[]) => {
    if (!skipped && values[2]?.put?.some((entry: any) => entry.state === "committed")) {
      skipped = true; runtime.coverageRevision++;
    }
    return commit(...values);
  };
  try {
    const result = await f.client.mutation(api.messages.send, args("superseded settlement"));
    assert.equal(skipped, true);
    assert.equal(f.owner.executions.length, 1, "the owner executed before the local coverage changed");
    assert.equal((await f.client.outbox.entries())[0].state, "queued", "the real commitMany guard skipped its durable swap");
    assert.equal(result.state, "queued", "the terminal waiter cannot invent local settlement");
    runtime.commitMany = commit;
    await f.client.outbox.drain();
    assert.equal((await f.client.outbox.entries())[0].state, "committed");
    assert.equal(f.owner.executions.length, 1, "same admitted intent replays without re-execution");
  } finally { runtime.commitMany = commit; await f.close(); }
});

for (const family of ["input", "schema"]) test(`an older ${family} refusal keeps a new admitted send queued`, async () => {
  const f = await fixture({ facts: true, fetch: owner => async (input, init) => {
    if (new URL(String(input)).pathname === "/api/mutation" && JSON.parse(String(init?.body)).args?.body === "older") {
      return new Response(JSON.stringify({ code: family === "input" ? "E_INPUT" : "E_SCHEMA", family,
        message: "older intent refused", guide: "offline" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    return owner.fetch(input, init);
  } });
  try {
    assert.equal((await f.client.mutation(api.messages.send, args("older"))).state, "rejected");
    const own = await f.client.mutation(api.messages.send, args("newer"));
    assert.equal(own.state, "queued");
    const entries = await f.client.outbox.entries();
    assert.deepEqual(entries.map((entry: any) => entry.args.body), ["older", "newer"]);
    assert.equal(entries[1].refusal, undefined, "older refusal is not attributed to the newer send");
    assert.equal(f.owner.executions.length, 0);
  } finally { await f.close(); }
});

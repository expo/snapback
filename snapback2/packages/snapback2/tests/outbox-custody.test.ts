import { assertRefused } from "./live-fixture.ts";
import { isRefusalError } from "../dist/client-observed-test.mjs";
import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import React, { StrictMode, useState } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api, createClient } from "../dist/client.mjs";
import { RefusalError } from "../dist/client-observed-test.mjs";
import { SnapbackProvider, indexedDbRangeStore, useSnapbackClient } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { sqliteFactory } from "./sqlite-fixture.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { DAY, engineId, fakeOwner, seededStore } from "./fake-owner.ts";

// @ref LLP 1012#7-writes-offline — custody of the outbox after the round-1
// reviews: grant slices are consumed in one critical section, a committed
// settlement never lands without its rows, the settlement tail and the resume
// log share one deterministic chooser, `settled()` surfaces the refusal that
// stopped a replay, the prediction overlay leaves with every terminal
// settlement, the write bound is durable, the provider constructs one client,
// and `online()` never strands a queue.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "snapback2-custody-"));
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const post = (body: string) => ({ conversationId: "conversation-1", body });
const caughtUp = (value: any) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true;

interface Carrier {
  name: string;
  /** A fresh factory over the same durable partition; every call shares the carrier. */
  factory(): ReturnType<typeof fileRangeStore>;
  /** Carrier writes so far (state renames on the file carrier, readwrite transactions on IndexedDB/SQLite). */
  writes(): number;
  /** Every committed custody image, for atomic terminal-transition checks. */
  images(): any[];
  cleanup(): Promise<void>;
}

function terminalWasAtomic(carrier: Carrier, intent: string, state: "rejected" | "expired"): boolean {
  let predictionSeen = false;
  for (const image of carrier.images()) {
    const overlay = image.overlay?.[intent];
    if (overlay !== undefined) predictionSeen = true;
    if (!predictionSeen) continue;
    const entry = image.outbox?.[intent];
    if (entry?.state === "queued" && overlay === undefined) return false;
    if (entry?.state === state) return overlay === undefined;
  }
  return false;
}

/** All three carriers, each counting its swaps, over a fresh partition. */
async function carriers(): Promise<Carrier[]> {
  const root = await tempRoot();
  const sqliteRoot = await tempRoot();
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  let sqliteWrites = 0;
  let fileWrites = 0;
  let indexedWrites = 0;
  const fileImages: any[] = [], indexedImages: any[] = [], sqliteImages: any[] = [];
  return [
    {
      name: "file",
      factory: () => fileRangeStore(root, { beforeRename: async (temporary) => {
        fileWrites += 1; fileImages.push(JSON.parse(await readFile(temporary, "utf8")));
      } }),
      writes: () => fileWrites,
      images: () => fileImages,
      cleanup: () => rm(root, { recursive: true, force: true }),
    },
    {
      name: "IndexedDB",
      factory: () => indexedDbRangeStore({ indexedDB: database as any, locks: locks as any, beforeReplace: (state) => {
        indexedWrites += 1; indexedImages.push(structuredClone(state));
      } }),
      writes: () => indexedWrites,
      images: () => indexedImages,
      cleanup: async () => undefined,
    },
    {
      name: "SQLite",
      factory: () => sqliteFactory(join(sqliteRoot, "custody.db"), { beforeCommit: (state) => {
        sqliteWrites += 1; sqliteImages.push(structuredClone(state));
      } }),
      writes: () => sqliteWrites,
      images: () => sqliteImages,
      cleanup: () => rm(sqliteRoot, { recursive: true, force: true }),
    },
  ];
}

/** Wraps a factory so the test can reach the store instance the client opened. */
function capturing(factory: ReturnType<typeof fileRangeStore>) {
  let instance: ReturnType<ReturnType<typeof fileRangeStore>> | undefined;
  let constructed = 0;
  const wrapped = Object.assign(() => {
    constructed += 1;
    instance = factory();
    return instance;
  }, { carrier: factory.carrier });
  return { factory: wrapped as ReturnType<typeof fileRangeStore>, store: () => instance!, constructed: () => constructed };
}

test("two overlapping enqueues consume distinct grant slices: both entries exist and used advances by the sum", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner();
    await seededStore(carrier.factory());
    const held = capturing(carrier.factory());
    const client = createClient({ url: "http://atomic-grant.test", persona: "alice", fetch: owner.fetch, offline: { store: held.factory } });
    await client.ready;
    await client.offline();
    // No await between the two: both read the grant before either swap lands unless enqueue is a critical section.
    const [first, second] = await Promise.all([
      client.mutation(api.messages.send as any, post("one")),
      client.mutation(api.messages.send as any, post("two")),
    ]);
    assert.equal(first.state, "queued");
    assert.equal(second.state, "queued");
    assert.notEqual(first.state === "queued" && first.intent, second.state === "queued" && second.intent, `${carrier.name}: distinct intents`);
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => [entry.offset, entry.count, entry.ids[0]]), [
      [0, 52, engineId(100)],
      [52, 52, engineId(152)],
    ], `${carrier.name}: both entries exist with distinct offsets`);
    assert.equal((await held.store().outbox.grant())?.used, 104, `${carrier.name}: used advanced by the sum`);
    await client.close();
    await tick();
    await carrier.cleanup();
  }
});

test("a committed reply whose tail fetch fails leaves the intent queued with no rows; the retry is the same bytes and lands rows and entry in one swap", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner();
    await seededStore(carrier.factory());
    const held = capturing(carrier.factory());
    let cutTail = false;
    const bodies: string[] = [];
    const client = createClient({
      url: "http://tail-fetch.test", persona: "alice", offline: { store: held.factory },
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/mutation") bodies.push(String(init?.body));
        // The tail request fails on the transport, not the carrier: the owner has already committed.
        if (path === "/api/query" && cutTail) {
          cutTail = false;
          throw new TypeError("fetch failed");
        }
        return owner.fetch(input, init);
      },
    });
    await client.ready;
    await client.offline();
    const queued = await client.mutation(api.messages.send as any, post("tail"));
    assert.equal(queued.state, "queued");
    const pinned = queued.state === "queued" ? queued.ids[0]! : "";
    cutTail = true;
    await client.online();
    await client.outbox.settled();
    assert.equal(owner.executions.length, 1, `${carrier.name}: the owner committed before the tail fetch failed`);
    assert.equal((await client.outbox.entries())[0]?.state, "queued", `${carrier.name}: no rows, no settlement`);
    assert.equal((await held.store().coverage()).rows.length, 0, `${carrier.name}: none of the tail rows were written`);
    const before = carrier.writes();
    await client.outbox.drain();
    assert.equal(bodies.length, 2);
    assert.equal(bodies[1], bodies[0], `${carrier.name}: the retry is the same envelope bytes`);
    assert.equal(owner.executions.length, 1, `${carrier.name}: the retry was answered from the ledger`);
    assert.equal(carrier.writes(), before + 1, `${carrier.name}: rows and the settlement were one carrier write`);
    assert.equal((await client.outbox.entries())[0]?.state, "committed");
    assert.deepEqual((await held.store().coverage()).rows.map((row) => row.id), [`delivery-${pinned}`, pinned],
      `${carrier.name}: the real prediction's delivery and message rows land with settlement`);
    await client.close();
    await tick();
    await carrier.cleanup();
  }
});

test("the settlement tail and the resume log both name the first-mounted drained query, never the newest page", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner({ seed: true });
    const queries: any[] = [];
    const resumes: any[] = [];
    const client = createClient({
      url: "http://tail-chooser.test", persona: "alice", offline: { store: carrier.factory() },
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/query") queries.push(JSON.parse(String(init?.body)));
        if (path === "/api/resume") resumes.push(JSON.parse(String(init?.body)));
        return owner.fetch(input, init);
      },
    });
    await client.ready;
    const inbox = subscribe(client, api.messages.inbox as any, { c: null }, () => undefined, { drain: true });
    await inbox.until(caughtUp, 2_000);
    await tick();
    assert.equal(owner.grantsMinted(), 1, `${carrier.name}: the first drain earned the grant`);
    // Mounted second and marked later: its watermark is the newest by updatedAt.
    const thread = subscribe(client, (api as any).messages.inboxAlternate, { c: null }, () => undefined, { drain: true });
    await thread.until(caughtUp, 2_000);
    await client.offline();
    const queued = await client.mutation(api.messages.send as any, post("chosen tail"));
    assert.equal(queued.state, "queued");
    queries.length = 0;
    resumes.length = 0;
    await client.online();
    await client.outbox.settled();
    assert.equal((await client.outbox.entries())[0]?.state, "committed", carrier.name);
    assert.equal(resumes.length, 1);
    assert.deepEqual({ op: resumes[0].log?.op, args: resumes[0].log?.args }, { op: "messages.inbox", args: { c: null } },
      `${carrier.name}: the resume log is the first-mounted drain`);
    assert.equal(queries.length, 1, `${carrier.name}: one settlement tail request`);
    assert.deepEqual({ op: queries[0].op, args: queries[0].args }, { op: "messages.inbox", args: { c: null } },
      `${carrier.name}: the settlement tail is the first-mounted drain`);
    await client.offline();
    await client.online();
    assert.equal(resumes.length, 2);
    assert.equal(resumes[1].log?.op, "messages.inbox", `${carrier.name}: the next resume names the same log`);
    thread.close();
    inbox.close();
    // Across restart() and a cold start the chooser reads the durable order, never the newest page.
    const cold = await client.restart();
    await cold.ready;
    await tick(50);
    assert.equal(resumes.length, 3, `${carrier.name}: the cold start resumed`);
    assert.deepEqual({ op: resumes[2].log?.op, args: resumes[2].log?.args }, { op: "messages.inbox", args: { c: null } },
      `${carrier.name}: the restarted client's resume names the first-mounted drain`);
    await cold.close();
    await tick();
    await carrier.cleanup();
  }
});

test("settled() rejects with the non-retryable refusal that stopped the replay and leaves the intent queued; a retryable transport failure still resolves", async () => {
  const root = await tempRoot();
  let refuse = true;
  let dead = false;
  // Every 5xx is retryable E_TRANSPORT to this client (client.ts json()); the
  // non-retryable, non-offline refusal is a coded 4xx of another family.
  const owner = fakeOwner({
    dead: () => dead,
    refuse: () => refuse
      ? { status: 422, envelope: { code: "E_PROGRAM_GENERATION", family: "program", message: "the program moved under this intent", rewrite: "reload the program", guide: "program" } }
      : undefined,
  });
  await seededStore(fileRangeStore(root));
  const client = createClient({ url: "http://settled.test", persona: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await client.ready;
  await client.offline();
  await client.mutation(api.messages.send as any, post("refused"));
  const refused = (error: unknown) => isRefusalError(error) && error.code === "E_PROGRAM_GENERATION" && !error.retryable;
  await assert.rejects(() => client.online(), refused, "the resume's drain surfaces the refusal");
  await assert.rejects(() => client.outbox.settled(), refused, "settled() rejects with the refusal, not with intents still queued");
  assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["queued"], "the refused intent stays queued");
  assert.equal(owner.executions.length, 0, "the owner refused instead of executing");
  refuse = false;
  dead = true;
  await client.outbox.drain();
  await client.outbox.settled();
  assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["queued"], "a retryable stop resolves settled() with the intent queued");
  dead = false;
  await client.outbox.drain();
  await client.outbox.settled();
  assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["committed"]);
  client.close();
  await tick();
  await rm(root, { recursive: true, force: true });
});

test("the prediction overlay is dropped in the same swap as a rejected or server-expired settlement", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner({
      reject: (_intent, body) => body.args.body === "rejected",
      refuse: (_intent, body) => body.args.body === "server expired"
        ? { status: 409, envelope: {
          code: "E_OFFLINE_INTENT_EXPIRED", family: "offline",
          message: "the replay grant is older than thirty days",
          rewrite: "resume for a fresh grant and send again", guide: "offline",
        } }
        : undefined,
    });
    await seededStore(carrier.factory());
    const held = capturing(carrier.factory());
    const client = createClient({ url: "http://overlay.test", persona: "alice", fetch: owner.fetch, offline: { store: held.factory, fenceDays: 1 } });
    await client.ready;
    await client.offline();
    const rejected = await client.mutation(api.messages.send as any, post("rejected"));
    assert.equal(rejected.state, "queued");
    const rejectedIntent = rejected.state === "queued" ? rejected.intent : "";
    const predicted = (intent: string) => ({ [intent]: [{ table: "messages", id: `${intent}:row`, row: { id: `${intent}:row`, body: "predicted" } }] });
    await held.store().commit({ overlay: { put: predicted(rejectedIntent) } });
    assert.deepEqual(Object.keys(await held.store().outbox.overlay()), [rejectedIntent], `${carrier.name}: the overlay is held while queued`);
    await client.online();
    await client.outbox.settled();
    assert.equal((await client.outbox.entries())[0]?.state, "rejected", carrier.name);
    assert.deepEqual(await held.store().outbox.overlay(), {}, `${carrier.name}: the overlay left with the rejection`);
    assert.equal(terminalWasAtomic(carrier, rejectedIntent, "rejected"), true,
      `${carrier.name}: rejection and overlay removal share one durable image`);

    await client.offline();
    const expiring = await client.mutation(api.messages.send as any, post("server expired"));
    assert.equal(expiring.state, "queued");
    const expiringIntent = expiring.state === "queued" ? expiring.intent : "";
    await held.store().commit({ overlay: { put: predicted(expiringIntent) } });
    assert.deepEqual(Object.keys(await held.store().outbox.overlay()), [expiringIntent]);
    const requests = owner.requests.filter((path) => path === "/api/mutation").length;
    await client.online();
    await client.outbox.settled();
    assert.equal(owner.requests.filter((path) => path === "/api/mutation").length, requests + 1,
      `${carrier.name}: the owner saw the intent it expired`);
    assert.equal((await client.outbox.entries())[1]?.state, "expired", carrier.name);
    assert.deepEqual(await held.store().outbox.overlay(), {}, `${carrier.name}: the overlay left with the server expiry`);
    assert.equal(terminalWasAtomic(carrier, expiringIntent, "expired"), true,
      `${carrier.name}: expiry and overlay removal share one durable image`);
    await client.close();
    await tick();
    await carrier.cleanup();
  }
});

test("a cold start with the owner cut prices its slice from the persisted write bound; without one the enqueue refuses E_OFFLINE_ID_BLOCK", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner();
    await seededStore(carrier.factory());
    const warm = createClient({ url: "http://bound.test", persona: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await warm.ready;
    assert.equal(owner.grantsMinted(), 1, `${carrier.name}: the warm start earned a grant and recorded /api/program`);
    await warm.close();
    await tick();
    let dead = true;
    const held = capturing(carrier.factory());
    const cold = createClient({
      url: "http://bound.test", persona: "alice", offline: { store: held.factory },
      fetch: async (input, init) => {
        if (dead) throw new TypeError("fetch failed");
        return owner.fetch(input, init);
      },
    });
    await cold.ready;
    assert.deepEqual(await held.store().outbox.bounds(), {
      "messages.inbox": 0, "messages.inboxAlternate": 0, "messages.thread": 0,
      "messages.send": 51, "messages.edit": 50,
    }, `${carrier.name}: every certified operation bound is durable`);
    const queued = await cold.mutation(api.messages.send as any, post("cold"));
    assert.equal(queued.state, "queued", `${carrier.name}: the cut network enqueued`);
    assert.equal(queued.state === "queued" && queued.ids.length, 52, `${carrier.name}: 1 + maxNewIds exactly, never the engine's 1,024`);
    assert.equal((await cold.outbox.entries())[0]?.count, 52);
    assert.equal((await held.store().outbox.grant())?.used, 52, carrier.name);
    await cold.close();
    await tick();
    dead = false;
    await carrier.cleanup();
  }
  // No bound recorded: a partition holding a grant but never having reached /api/program.
  for (const carrier of await carriers()) {
    const grant = { id: engineId(500), from: engineId(500), count: 8_192, mintedAt: Date.now(), expiresAt: Date.now() + 30 * DAY, used: 0 };
    const seed = carrier.factory()();
    await seed.open("dev:alice");
    await seed.commit({ grants: { put: [grant], current: grant.id } });
    await seed.close?.();
    await tick();
    const cold = createClient({
      url: "http://no-bound.test", persona: "alice", offline: { store: carrier.factory() },
      fetch: async () => { throw new TypeError("fetch failed"); },
    });
    await cold.ready;
  await assertRefused(
    () => cold.mutation(api.messages.send as any, post("unpriced")),
    (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_OFFLINE_ID_BLOCK"
      && error.family === "offline" && /bound .* unknown/.test(error.message),
      `${carrier.name}: no bound is a loud refusal, not a guessed slice`,
    );
    assert.deepEqual(await cold.outbox.entries(), [], `${carrier.name}: nothing was enqueued`);
    await cold.close();
    await tick();
    await carrier.cleanup();
  }
});

test("SnapbackProvider constructs exactly one client across StrictMode's double mount and a parent re-render with an inline offline object", async () => {
  const owner = fakeOwner({ seed: true });
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const held = capturing(indexedDbRangeStore({ indexedDB: database as any, locks: locks as any }));
  let client: any;
  let rerender: (value: number) => void = () => undefined;
  function Harness() {
    client = useSnapbackClient();
    return null;
  }
  function Parent() {
    const [pass, setPass] = useState(0);
    rerender = setPass;
    // A new `offline` object with new inline closures every render: identity compares the store and the
    // numbers; the callbacks are read through a ref, never compared, so they cannot construct a client.
    return React.createElement(
      SnapbackProvider,
      {
        url: "http://one-client.test", persona: "alice", fetch: owner.fetch,
        offline: { store: held.factory, fenceDays: 3 },
      },
      React.createElement(Harness, { key: pass }),
    );
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(StrictMode, null, React.createElement(Parent)));
  });
  await act(async () => { await client.ready; await tick(); });
  assert.equal(held.constructed(), 1, "one client (one store instance) across StrictMode's double render and simulated remount");
  const first = client;
  assert.notEqual(client.snapshot.lastRefusal?.code, "E_OFFLINE_LOCK");
  await act(async () => { rerender(1); });
  await act(async () => { rerender(2); await tick(); });
  assert.equal(held.constructed(), 1, "a parent re-render with an inline offline object and inline callbacks constructs no new client");
  assert.equal(client, first, "the same client instance serves the re-rendered tree");
  const answer = await client.query(api.messages.inbox as any, { c: null });
  assert.equal(answer.state, "complete", "the surviving client is open and serving");
  await act(async () => { renderer!.unmount(); });
  await tick();
  assert.equal(client.snapshot.connection, "offline", "a real unmount closes the client");
  assert.equal(held.constructed(), 1);
});

test("online() replays a queue held under a login grant when no resume can be built: zero deliveries, no facts, no /api/resume", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  const client = createClient({
    url: "http://login-grant.test", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      // Reads answer plainly (no envelope), so the partition never learns resume facts.
      if (new URL(String(input)).pathname === "/api/query") {
        return new Response(JSON.stringify({ state: "complete", data: [], next: null, seq: 4 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return owner.fetch(input, init);
    },
  });
  await client.ready;
  await client.auth.login({ email: "alice@example.com", password: "pw" });
  assert.equal(owner.grantsMinted(), 1, "the login minted the grant");
  await client.query(api.messages.inbox as any, { c: null });
  await client.offline();
  const first = await client.mutation(api.messages.send as any, post("first after login"));
  const second = await client.mutation(api.messages.send as any, post("second after login"));
  assert.equal(first.state, "queued");
  assert.equal(second.state, "queued");
  await client.online();
  await client.outbox.settled();
  assert.equal(owner.requests.filter((path) => path === "/api/resume").length, 0, "no facts, so no resume request could be built");
  assert.deepEqual(owner.executions.map((item) => (item.args as any).body), ["first after login", "second after login"], "the queue was replayed FIFO under the login grant");
  assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["committed", "committed"]);
  assert.equal(client.snapshot.connection, "connected");
  client.close();
  await tick();
  await rm(root, { recursive: true, force: true });
});

// LLP 1020 A2: an acknowledgment loss must never reuse an earlier refusal as authority to dismiss.
test("replay clears a recorded refusal durably before sending; in-flight and unknown outcomes cannot be dismissed", async () => {
  for (const carrier of await carriers()) {
    let removed = true;
    const owner = fakeOwner({ failAfterCommit: 1, refuse: () => removed ? { status: 400, envelope: {
      code: "E_INPUT", family: "input", message: "enum case removed", guide: "input/runtime",
    } } : undefined });
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let pause = false;
    await seededStore(carrier.factory());
    const open = () => createClient({ url: "http://retry-refusal.test", persona: "alice", offline: { store: carrier.factory() },
      fetch: async (input, init) => {
        if (new URL(String(input)).pathname === "/api/mutation" && pause) {
          pause = false; entered.resolve(); await release.promise;
        }
        return owner.fetch(input, init);
      } });
    let client = open();
    let retry: Promise<unknown> | undefined;
    try {
      await client.ready; await client.offline();
      await client.mutation(api.messages.send, post("case returns"));
      await assert.rejects(client.online(), { code: "E_INPUT" });
      const head = (await client.outbox.entries())[0]!;
      assert.equal(head.refusal?.code, "E_INPUT");
      removed = false; pause = true;
      retry = client.outbox.drain();
      void retry.catch(() => undefined);
      await entered.promise;
      assert.equal(await client.outbox.dismiss(head.intent), undefined, `${carrier.name}: in-flight dismissal must refuse`);
      assert.equal((await client.outbox.entries())[0]?.refusal, undefined, "the prior refusal is cleared before the owner sees a byte");
      release.resolve();
      assert.deepEqual(await retry, { stopped: "transport", remaining: 1 });
      assert.equal(owner.executions.length, 1, "the replay committed with its acknowledgment lost");
      await client.close();
      const stored = carrier.factory()(); await stored.open("dev:alice");
      assert.equal((await stored.outbox.get(head.intent))?.refusal, undefined, "uncertainty survives cold reopen");
      await stored.close();
      client = open(); await client.ready;
      assert.equal(await client.outbox.dismiss(head.intent), undefined, "unknown outcome cannot discard custody");
      assert.equal((await client.outbox.status()).blocked, undefined);
      await client.online();
      assert.deepEqual(await client.outbox.settled(), { stopped: false, remaining: 0 });
      assert.equal(owner.executions.length, 1, "the next resume settles the same intent exactly once");
    } finally { release.resolve(); await retry?.catch(() => undefined); await client.close(); await carrier.cleanup(); }
  }
});

test("cancelling replay during its trust read preserves the last unspent refusal and dismissal bytes", async () => {
  for (const carrier of await carriers()) {
    const refusal = { code:"E_INPUT",family:"input",message:"enum case removed",guide:"input/runtime" };
    const owner = fakeOwner({refuse:()=>({status:400,envelope:refusal})});
    await seededStore(carrier.factory());
    const client = createClient({url:"http://cancel-before-replay.test",persona:"alice",fetch:owner.fetch,offline:{store:carrier.factory()}});
    const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
    let retry:Promise<unknown>|undefined;
    try {
      await client.ready;await client.offline();
      await client.mutation(api.messages.send,post("still dismissible"));
      await assert.rejects(client.online(),{code:"E_INPUT"});
      const runtime=(client as any).offlineRuntime,head=(await client.outbox.entries())[0]!;
      const canReplay=runtime.outbox.canReplay.bind(runtime.outbox);
      runtime.outbox.canReplay=async(entry:any)=>{const trusted=await canReplay(entry);entered.resolve();await release.promise;return trusted;};
      const requests=owner.requests.filter(path=>path==="/api/mutation").length;
      retry=client.outbox.drain();void retry.catch(()=>undefined);await entered.promise;
      await client.offline();release.resolve();await assert.rejects(retry);
      assert.equal(owner.requests.filter(path=>path==="/api/mutation").length,requests,"cancelled before request custody");
      assert.deepEqual((await client.outbox.entries())[0]?.refusal,refusal,`${carrier.name}: an unsent cancelled retry does not erase refusal evidence`);
      assert.deepEqual(await client.outbox.dismiss(head.intent),{intent:head.intent,op:head.op,args:head.args,refusal});
    } finally {release.resolve();await retry?.catch(()=>undefined);await client.close();await carrier.cleanup();}
  }
});

// @ref LLP 1023.002#a--a-small-reproduction-matrix-on-current-source — a
// configured durable caller must not fall through plain transport before auth.
test("fresh unbound bearer restoration cannot bypass durable admission after a transport cut", async () => {
  const root = await tempRoot(), factory = fileRangeStore(root);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const requests: string[] = [];
  const owner = fakeOwner();
  const client = createClient({ url: "http://restoration-custody.test", token: "fresh-bearer",
    offline: { store: factory }, fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      if (path === "/api/auth/me") { entered.resolve(); await release.promise; throw new TypeError("restoration network cut"); }
      return owner.fetch(input, init);
    } });
  let returned = false;
  const mutation = client.mutation(api.messages.send as any, post("must have custody")).then(result => { returned = true; return result; });
  try {
    await entered.promise;
    assert.equal(returned, false, "a fresh mutation waits while initial bearer restoration is pending");
    assert.equal((client as any).offlineRuntime.principal, undefined);
    release.resolve();
    const result = await mutation;
    assert.equal(result.state, "rejected");
    assert.equal(requests.includes("/api/mutation"), false, "failed restoration cannot turn a configured durable client into a plain client");
  } finally { release.resolve(); await client.close(); await rm(root, { recursive: true, force: true }); }
});

for (const format of ["HTTP 401", "typed HTTP 200"] as const) for (const stage of ["replay", "tail"] as const) {
  test(`${format} FIFO ${stage} expiry seals both admitted intents until sign-in resumes them in order`, async context => {
    const root = await tempRoot(), factory = fileRangeStore(root), owner = fakeOwner();
    context.after(() => rm(root, { recursive: true, force: true }));
    let token: string | null = "token-a";
    const store = { load: () => token, save: (value: string | null) => { token = value; },
      loadPrincipalBinding: () => token ? ({ token, principal: "dev:alice" }) : null, savePrincipal: () => undefined };
    await seededStore(factory);
    let mode: "transport" | "expiry" | "recovery" = "transport";
    const replays: string[] = [];
    const terminal = (intent?: string) => format === "HTTP 401" ? Response.json({ code: "E_AUTH_SESSION", family: "auth", message: "expired" }, { status: 401 })
      : Response.json({ state: stage === "replay" ? "rejected" : "refused", code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth/session", ...(intent ? { intent } : {}) });
    const client = createClient({ url: "http://auth.test", tokenStore: store, offline: { store: factory },
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/mutation") {
          replays.push(String(init?.body));
          if (mode === "transport") return new Response("cut", { status: 503 });
          if (mode === "expiry" && stage === "replay") return terminal(JSON.parse(String(init?.body)).replay.intent);
        }
        if (mode === "expiry" && stage === "tail" && path === "/api/query") return terminal();
        return owner.fetch(input, init);
      } });
    try {
      await client.ready; await client.auth.me(); await client.outbox.settled();
      const older = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: "older durable intent" });
      assert.equal(older.state, "queued");
      const queued = await client.outbox.entries();
      assert.equal(queued.length, 1); assert.equal(queued[0].state, "queued");
      mode = "expiry";
      const interrupted = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: "new admitted intent" });
      await assertRefused(Promise.resolve(interrupted),
        (error: any) => error.code === "E_AUTH_SESSION", "FIFO session death is not an older intent's ordinary refusal");
      assert.ok(interrupted.intent, "a refused wait preserves this call's admitted identity for work lookup; never submit a fresh duplicate");
      assert.notEqual(interrupted.intent, queued[0].intent, "the refusal names this admitted call, not the FIFO head that expired");
      await assert.rejects(client.outbox.settled(), (error: any) => error.code === "E_AUTH_SESSION");
      assert.equal(client.snapshot.lastRefusal?.code, "E_AUTH_SESSION");
      assert.equal(client.snapshot.auth.state, "anonymous"); assert.equal(store.load(), null);
      assert.equal((await client.outbox.status()).reason, "sealed");
      assert.equal(replays.length, 2); assert.equal(replays[1], replays[0]);
      mode = "recovery";
      await client.auth.login({ email: "alice@example.com", password: "password" }); await client.online();
      assert.deepEqual(await client.outbox.settled(), { stopped: false, remaining: 0 });
      assert.equal(replays[2], replays[0], "recovery must retry the exact older envelope");
      assert.deepEqual(owner.executions.map(entry => (entry.args as any).body), ["older durable intent", "new admitted intent"],
        "expiry refuses the call but cannot discard admitted bytes; fresh sign-in resumes FIFO");
      assert.equal(owner.messages.size, 2, "a tail failure after commit still executes each admitted intent only once");
      assert.equal(store.load(), "token-alice");
      const original = (await client.outbox.entries()).find(entry => entry.intent === interrupted.intent);
      assert.equal(original?.state, "committed", "recovery finds the original identity without submitting fresh bytes");
      const observed = client.outbox.observe(api.messages.send);
      const visible = Promise.withResolvers<void>();
      const unsubscribe = observed.subscribe(() => { if (observed.getWork(interrupted.intent!)?.entry.state === "committed") visible.resolve(); });
      try { await visible.promise; assert.equal(observed.getWork(interrupted.intent!)?.entry.intent, original?.intent); }
      finally { unsubscribe(); }
    } finally { await client.close(); }
  });
}

test("sealing immediately after carrier commit cannot hide the admitted call's identity", async context => {
  const root = await tempRoot(); context.after(() => rm(root, { recursive: true, force: true }));
  const factory = fileRangeStore(root); await seededStore(factory);
  let committedIntent: string | undefined;
  const wrapped = Object.assign(() => {
    const store = factory(), commit = store.commit.bind(store);
    store.commit = async swap => {
      await commit(swap);
      const entry = swap.outbox?.put?.find(entry => (entry.args as any)?.body === "seal after commit");
      if (entry) { committedIntent = entry.intent; await store.seal(); }
    };
    return store;
  }, { carrier: factory.carrier });
  const client = createClient({ url: "http://commit-seal.test", persona: "alice", fetch: fakeOwner().fetch, offline: { store: wrapped } });
  try {
    await client.ready; await client.offline();
    const result = await client.mutation(api.messages.send as any, post("seal after commit"));
    assert.ok(committedIntent, "the carrier transaction completed before sealing");
    assert.equal(result.intent, committedIntent, "successful admission needs no second readable carrier transaction");
  } finally { await client.close(); }
});

test("an intentional non-durable bearer client keeps its plain mutation path", async () => {
  const owner = fakeOwner(), bodies: any[] = [];
  const client = createClient({ url: "http://plain-custody.test", token: "fresh-bearer", fetch: async (input, init) => {
    if (String(input).endsWith("/api/mutation")) bodies.push(JSON.parse(String(init?.body)));
    return owner.fetch(input, init);
  } });
  try {
    const result = await client.mutation(api.messages.send as any, post("intentional plain path"));
    assert.equal(result.state, "committed"); assert.equal(bodies.length, 1); assert.equal(bodies[0].replay, undefined);
  } finally { await client.close(); }
});

test("a seal while an admitted mutation waits reports the carrier lifecycle with its original intent", async context => {
  const root = await tempRoot(); context.after(() => rm(root, { recursive: true, force: true }));
  const factory = fileRangeStore(root); await seededStore(factory);
  const held = capturing(factory), owner = fakeOwner();
  let intent: string | undefined;
  const client = createClient({ url: "http://sealed-wait.test", persona: "alice", offline: { store: held.factory }, fetch: async (input, init) => {
    if (String(input).endsWith("/api/mutation")) {
      intent = JSON.parse(String(init?.body)).replay.intent;
      await held.store().seal();
      return new Response("transport cut after independent expiry", { status: 503 });
    }
    return owner.fetch(input, init);
  } });
  try {
    await client.ready;
    const result = await client.mutation(api.messages.send as any, post("sealed wait"));
    assert.equal(result.state, "rejected"); assert.equal(result.intent, intent);
    assert.equal((result as any).code, "E_OFFLINE_LIFECYCLE");
  } finally { await client.close(); }
});

for (const failure of ["token clear", "typed seal", "raw seal", "unexpected cleanup"] as const) {
  test(`terminal ${failure} failure preserves durable admission and same-account recovery`, async context => {
    const root = await tempRoot(); context.after(() => rm(root, { recursive: true, force: true }));
    const factory = fileRangeStore(root), owner = fakeOwner(); await seededStore(factory);
    let token: string | null = "token-a", failCleanup = false, admitted: string | undefined;
    const typed = { code: "E_OFFLINE_STATE", family: "offline", message: "injected seal failure", guide: "offline",
      site: "test.seal", rewrite: "restore the carrier before recovery" };
    const wrapped = Object.assign(() => {
      const store = factory(), commit = store.commit.bind(store), seal = store.seal.bind(store);
      store.commit = async swap => {
        await commit(swap);
        const entry = swap.outbox?.put?.find(entry => (entry.args as any)?.body === "keep this intent");
        if (entry) admitted = entry.intent;
      };
      store.seal = async () => {
        if (failCleanup && failure === "typed seal") throw new RefusalError(typed);
        if (failCleanup && failure === "raw seal") throw new Error("carrier persistence unavailable");
        return seal();
      };
      return store;
    }, { carrier: factory.carrier });
    const tokenStore = {
      load: () => token,
      save: (value: string | null) => {
        if (failCleanup && failure === "token clear" && value === null) throw new Error("token persistence unavailable");
        token = value;
      },
      loadPrincipalBinding: () => token ? ({ token, principal: "dev:alice" }) : null,
      savePrincipal: () => undefined,
    };
    const client = createClient({ url: "http://cleanup-custody.test", tokenStore, offline: { store: wrapped }, fetch: owner.fetch });
    const host = client as any, drain = host.drainNow.bind(host), terminal = host.terminalRefusal.bind(host);
    try {
      await client.ready; await client.auth.me(); await client.outbox.settled();
      // Deliver expiry at the drain boundary after the real carrier commit.
      // Cleanup and subsequent recovery use the production client and store.
      host.drainNow = async () => {
        assert.ok(admitted, "the expiry signal follows durable admission");
        failCleanup = true;
        throw new RefusalError({ code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth/session" });
      };
      if (failure === "unexpected cleanup") host.terminalRefusal = async (...args: any[]) => {
        await terminal(...args); throw new Error("unexpected cleanup exception");
      };
      const result = await client.mutation(api.messages.send as any, post("keep this intent"));
      assert.equal(result.state, "rejected");
      assert.equal(result.intent, admitted, "a failed cleanup refuses the wait without losing admitted identity");
      const refusal = result as any;
      assert.equal(refusal.code, failure === "token clear" ? "E_AUTH_TOKEN_STORE"
        : failure === "unexpected cleanup" ? "E_CLIENT" : "E_OFFLINE_STATE");
      if (failure === "typed seal") for (const [key, value] of Object.entries(typed)) assert.equal(refusal[key], value);
      if (failure === "unexpected cleanup") assert.equal(refusal.message, "unexpected cleanup exception");
      assert.equal(owner.executions.length, 0, "expiry prevented dispatch of the admitted write");
      assert.equal(client.snapshot.token, undefined);
      failCleanup = false; host.drainNow = drain; host.terminalRefusal = terminal;
      await client.auth.login({ email: "alice@example.com", password: "password" }); await client.online();
      await client.outbox.settled();
      const original = (await client.outbox.entries()).find(entry => entry.intent === result.intent);
      assert.equal(original?.state, "committed", "same-account recovery settles the original durable entry");
      await client.online(); await client.outbox.settled();
      assert.deepEqual(owner.executions.map(entry => (entry.args as any).body), ["keep this intent"]);
      assert.equal(owner.messages.size, 1, "recovery never submits a replacement intent or duplicates its effect");
    } finally {
      failCleanup = false; host.drainNow = drain; host.terminalRefusal = terminal;
      await client.close();
    }
  });
}

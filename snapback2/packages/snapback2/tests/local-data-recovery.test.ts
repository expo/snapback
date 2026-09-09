import { assertRefused } from "./live-fixture.ts";
import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { api, createClient } from "../dist/client.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { sqliteFactory } from "./sqlite-fixture.ts";
import { fakeOwner, seededStore } from "./fake-owner.ts";
import { RealOwnerHarness } from "./owner-harness.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const caughtUp = (event: any) => event.caughtUp === true;

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("local operation waited on network startup")), 1_000); })]); }
  finally { clearTimeout(timer); }
}

test("transport stops and successful retries report their remaining queue and preserve exactly-once writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-recovery-"));
  const owner = fakeOwner({ failAfterCommit: 1 });
  await seededStore(fileRangeStore(root));
  const client = createClient({ url: "http://recovery.test", persona: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  try {
    await client.ready;
    const result = await client.mutation(api.messages.send as any, { conversationId: "conversation-1", body: "retry once" });
    assert.equal(result.state, "queued");
    assert.deepEqual(await client.outbox.settled(), { stopped: "transport", remaining: 1 });
    assert.deepEqual(await client.outbox.drain(), { stopped: false, remaining: 0 });
    assert.deepEqual(await client.outbox.settled(), { stopped: false, remaining: 0 });
    assert.equal(owner.executions.length, 1);
    await client.offline();
    await client.mutation(api.messages.send as any, { conversationId: "conversation-1", body: "explicit offline" });
    assert.deepEqual(await client.outbox.settled(), { stopped: "offline", remaining: 1 }, "settled never reports an undrained queue as complete");
    assert.deepEqual(await client.outbox.drain(), { stopped: "offline", remaining: 1 });
    assert.equal(owner.executions.length, 1, "explicit offline does not reconnect implicitly");
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});

test("grant expiry and exhausted IDs expose actionable admission without consuming an intent", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-admission-"));
  const owner = fakeOwner();
  const factory = fileRangeStore(root);
  await seededStore(factory);
  let store: ReturnType<typeof factory>;
  const client = createClient({ url: "http://admission.test", persona: "alice", fetch: owner.fetch, offline: { store: () => (store = factory()) } });
  try {
    await client.ready;
    await client.offline();
    const grant = (await store!.outbox.grant())!;
    await store!.commit({ grants: { put: [{ ...grant, expiresAt: Date.now() - 1 }] } });
    const status = await client.outbox.status(api.messages.send as any);
    assert.equal(status.reason, "grant-expired");
    assert.equal(status.action, "connect");
    assert.equal(await client.outbox.ready(api.messages.send as any), false);
    await assertRefused(client.mutation(api.messages.send as any, { conversationId: "conversation-1", body: "expired" }), (error: any) => error.code === "E_OFFLINE_ID_BLOCK" && /expired/.test(error.message));
    assert.equal((await client.outbox.entries()).length, 0);
    assert.equal((await store!.outbox.grant())!.used, grant.used);
    await store!.commit({ grants: { put: [{ ...grant, used: grant.count - 1 }] } });
    assert.equal((await client.outbox.status(api.messages.send as any)).reason, "ids-exhausted");
    assert.equal((await client.outbox.status(api.missing.write as any)).reason, "program-missing");
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});

test("retained reads, readiness and offline escape do not wait on stalled authenticated startup; sealed custody stays hidden", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-startup-"));
  const factory = fileRangeStore(root);
  await seededStore(factory);
  const started = Promise.withResolvers<void>();
  let store: ReturnType<typeof factory>;
  const tokenStore = { load: async () => "held-token", save: async () => {}, loadPrincipalBinding: async () => ({ token: "held-token", principal: "dev:alice" }), loadPrincipal: async () => "dev:alice", savePrincipal: async () => {} };
  const client = createClient({ url: "http://startup.test", tokenStore,
    offline: { store: () => (store = factory()) },
    fetch: async (_input, init) => {
      started.resolve();
      return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("startup cancelled")), { once: true }));
    },
  });
  try {
    await started.promise;
    const answer = await bounded(client.query(api.messages.inbox as any, { c: null }));
    assert.equal(answer.state, "complete");
    await bounded(client.offline());
    await bounded(client.ready);
    assert.equal((await bounded(client.outbox.status())).ready, false, "held answers need no replay grant");
    await store!.seal();
    const sealed = await bounded(client.query(api.messages.inbox as any, { c: null }));
    assert.equal(sealed.state, "hydrating");
    assert.equal("data" in sealed, false);
    assert.equal((await client.outbox.status()).reason, "sealed");
    await assert.rejects(client.outbox.settled(), (error: any) => error.code === "E_OFFLINE_LIFECYCLE");
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});

test("repeated drain cursors refuse instead of looping or replacing the server watermark", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-cursor-loop-"));
  const owner = fakeOwner({ cursorArg: "nextPage" });
  const factory = fileRangeStore(root);
  await seededStore(factory);
  let requests = 0;
  let store: ReturnType<typeof factory>;
  const client = createClient({ url: "http://cursor-loop.test", persona: "alice", offline: { store: () => (store = factory()) },
    fetch: async (input, init) => {
      const response = await owner.fetch(input, init);
      if (new URL(String(input)).pathname !== "/api/query") return response;
      requests += 1;
      const body = await response.json();
      return json({ ...body, state: "capped", next: "same-cursor" });
    },
  });
  let subscription: any;
  try {
    await client.ready;
    const before = (await store!.coverage()).watermarks;
    subscription = subscribe(client, api.messages.inbox as any, { nextPage: null }, () => {}, { drain: true });
    const event = await subscription.until((value: any) => value.state === "refused", 2_000);
    assert.equal(event.code, "E_OFFLINE_RESUME");
    assert.match(event.message, /cursor/);
    assert.equal(requests, 2);
    assert.deepEqual((await store!.coverage()).watermarks, before);
  } finally { subscription?.close(); await client.close(); await rm(root, { recursive: true, force: true }); }
});

function recoveryOwner() {
  return RealOwnerHarness.create({ prepare: async ownerRoot => {
    await writeFile(join(ownerRoot, "snapback/recovery.q"), "query page(nextPage: cursor ?):\n  return profiles[] after nextPage first 1 by byId\n\nmutation echo(value: text <=100):\n  return value\n");
  } });
}

test("real sessions change epochs across re-login, seal and cold auth", async () => {
  const owner = await recoveryOwner();
  assert.ok(owner.root, "this regression requires its own owner");
  const root = await mkdtemp(join(tmpdir(), "s2-real-recovery-"));
  let client: ReturnType<typeof createClient> | undefined;
  const clients: Array<ReturnType<typeof createClient>> = [];
  const releaseQuery = Promise.withResolvers<void>();
  const terminalResponses: any[] = [];
  try {
    let failWrites = true;
    let holdQuery = false;
    const queryStarted = Promise.withResolvers<void>();
    const transport: typeof fetch = async (input, init) => {
      if (failWrites && new URL(String(input)).pathname === "/api/mutation") throw new TypeError("write transport cut");
      const response = await fetch(input, init);
      if (new URL(String(input)).pathname === "/api/mutation") terminalResponses.push(await response.clone().json());
      if (holdQuery && new URL(String(input)).pathname === "/api/query") {
        holdQuery = false;
        queryStarted.resolve();
        await releaseQuery.promise;
      }
      return response;
    };
    const account = { email: "recovery@example.test", password: "regression-password-12345" };
    const factory = fileRangeStore(join(root, "auth"));
    client = createClient({ url: owner.url, fetch: transport, offline: { store: factory } }); clients.push(client);
    const first = await client.auth.signup(account);
    assert.equal((await client.outbox.status(api.recovery.echo as any)).ready, true,
      "signup supplies the first replay grant without a drain or extra login");
    await client.query(api.integration.capped as any, {});
    const queued = await client.mutation(api.recovery.echo as any, { value: "kept across sessions" });
    assert.equal(queued.state, "queued");
    holdQuery = true;
    const obsolete = client.query(api.integration.capped as any, {}).catch((error) => error);
    await queryStarted.promise;
    const second = await client.auth.login(account).catch((error) => { throw new Error("second login failed", { cause: error }); });
    releaseQuery.resolve();
    assert.equal((await obsolete).code, "E_AUTH_SUPERSEDED", "old-epoch in-flight answers cannot enter the reauthenticated partition");
    assert.notEqual(second.authEpoch, first.authEpoch);
    assert.equal((await client.query(api.integration.capped as any, {})).state, "capped");
    assert.equal((await client.outbox.entries())[0]?.intent, queued.state === "queued" ? queued.intent : "");
    await client.online();
    // Invalidate this real session at the owner, then observe the terminal seal.
    await fetch(`${owner.url}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${second.token}` } });
    await assert.rejects(client.auth.me(), (error: any) => error.code === "E_AUTH_SESSION");
    assert.equal((await client.outbox.status()).reason, "sealed");
    await assert.rejects(client.outbox.settled(), (error: any) => error.code === "E_OFFLINE_LIFECYCLE");
    const third = await client.auth.login(account).catch((error) => { throw new Error("third login failed", { cause: error }); });
    assert.notEqual(third.authEpoch, second.authEpoch);
    await client.query(api.integration.capped as any, {});
    assert.equal((await client.outbox.entries())[0]?.state, "queued");
    await client.close();
    const fresh = createClient({ url: owner.url }); clients.push(fresh);
    const fourth = await fresh.auth.login(account).catch((error) => { throw new Error("fourth login failed", { cause: error }); });
    await fresh.close();
    client = createClient({ url: owner.url, fetch: transport, tokenStore: {
      load: async () => fourth.token, loadPrincipalBinding: async () => ({ token: fourth.token, principal: fourth.viewer }), loadPrincipal: async () => fourth.viewer, save: async () => {}, savePrincipal: async () => {},
    }, offline: { store: factory } }); clients.push(client);
    await client.ready;
    assert.equal((await client.query(api.integration.capped as any, {})).state, "capped");
    assert.equal((await client.outbox.entries())[0]?.state, "queued");
    failWrites = false;
    await client.online();
    assert.deepEqual(await client.outbox.settled(), { stopped: false, remaining: 0 });
    assert.deepEqual(terminalResponses.map(({ state, data, effects }) => ({ state, data, effects })),
      [{ state: "committed", data: "kept across sessions", effects: [] }]);
    assert.deepEqual(await client.outbox.entries(), [], "the successful no-op compacts after preserving replay custody across sessions");
    await client.close();

  } finally { releaseQuery.resolve(); await Promise.allSettled(clients.map(entry => entry.close())); await owner.close(); if (owner.owned) delete process.env.SNAPBACK_URL; await rm(root, { recursive: true, force: true }); }
});

test("custom cursor custody drains offline on every carrier", async () => {
  const owner = await recoveryOwner();
  const root = await mkdtemp(join(tmpdir(), "s2-cursor-recovery-"));
  const clients: Array<ReturnType<typeof createClient>> = [];
  try {
    const db = new FakeIndexedDb(), locks = new FakeLocks();
    const factories = [fileRangeStore(join(root, "cursor")), sqliteFactory(join(root, "cursor.db")), indexedDbRangeStore({ indexedDB: db as any, locks: locks as any })];
    for (const store of factories) {
      const warm = createClient({ url: owner.url, persona: "alice", offline: { store } }); clients.push(warm);
      await warm.ready;
      const expected: string[] = [];
      const drain = subscribe(warm, api.recovery.page as any, { nextPage: null }, (event: any) => { if (event.data) expected.push(...event.data.map((row: any) => row.id)); }, { drain: true });
      await drain.until(caughtUp, 2_000);
      drain.close(); await warm.close();
      const inspect = store();
      await inspect.open("dev:alice");
      const saved = (await inspect.coverage()).watermarks;
      await inspect.close?.();
      const cold = createClient({ url: owner.url, persona: "alice", startOffline: true, offline: { store } }); clients.push(cold);
      await cold.ready;
      const actual: string[] = [];
      const restored = subscribe(cold, api.recovery.page as any, { nextPage: null }, (event: any) => { if (event.data) actual.push(...event.data.map((row: any) => row.id)); }, { drain: true });
      const end = await restored.until(caughtUp, 2_000);
      assert.deepEqual([...new Set(actual)], [...new Set(expected)], "cold and warm drains cover the same row identities");
      assert.equal(end.watermark, saved.find((entry) => entry.op === "recovery.page")?.watermark, "offline cursor chain uses the persisted server watermark");
      restored.close(); await cold.close();
      await inspect.open("dev:alice");
      assert.deepEqual((await inspect.coverage()).watermarks, saved, "offline draining does not rewrite server watermarks");
      await inspect.close?.();
    }
  } finally { await Promise.allSettled(clients.map((entry) => entry.close())); await owner.close(); if (owner.owned) delete process.env.SNAPBACK_URL; await rm(root, { recursive: true, force: true }); }
});

test("replacing an explicit bearer clears the old principal before persistence, so stalled cold auth cannot reveal its history", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-token-binding-"));
  const factory = fileRangeStore(root);
  await seededStore(factory);
  let token: string | null = "alice-token";
  let principal: string | null = "dev:alice";
  let binding: { token: string; principal: string } | null = { token: "alice-token", principal };
  const writes: Array<[string, string | null]> = [];
  const tokenStore = {
    load: async () => token, loadPrincipal: async () => principal, loadPrincipalBinding: async () => binding,
    save: async (value: string | null) => { writes.push(["token", value]); token = value; },
    savePrincipal: async (value: string | null, boundToken?: string) => { writes.push(["principal", value]); principal = value; binding = value === null ? null : { token: boundToken!, principal: value }; },
  };
  let started = Promise.withResolvers<void>();
  const stalled: typeof fetch = async (_input, init) => {
    started.resolve();
    return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  };
  let client = createClient({ url: "http://token-binding.test", token: "bob-token", tokenStore, fetch: stalled, offline: { store: factory } });
  try {
    await started.promise;
    assert.deepEqual(writes, [["principal", null], ["token", "bob-token"]]);
    await client.close();
    started = Promise.withResolvers<void>();
    client = createClient({ url: "http://token-binding.test", tokenStore, fetch: stalled, offline: { store: factory } });
    await started.promise;
    let delivered = false;
    const read = client.query(api.messages.inbox as any, { c: null }).then((result) => { delivered = true; return result; });
    await tick();
    assert.equal(delivered, false, "a new bearer has no local principal until the owner confirms it");
    await bounded(client.offline());
    const result = await bounded(read);
    assert.equal(result.state, "hydrating");
    assert.equal("data" in result, false);
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});

test("readiness still observes grant expiry after the earlier fence timer fired", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "s2-expiry-observer-"));
  const factory = fileRangeStore(root);
  await seededStore(factory);
  let store: ReturnType<typeof factory>;
  const client = createClient({ url: "http://expiry-observer.test", persona: "alice", fetch: fakeOwner().fetch, offline: { fenceDays: 1, store: () => (store = factory()) } });
  let unsubscribe = () => {};
  try {
    await client.ready;
    await client.offline();
    const now = Date.now();
    context.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
    const grant = (await store!.outbox.grant())!;
    await store!.commit({ grants: { put: [{ ...grant, mintedAt: now - 86_400_000 + 10, expiresAt: now + 100 }] } });
    const observed: Array<{ ready: boolean; fence: string }> = [];
    unsubscribe = client.outbox.subscribe(() => { void client.outbox.status().then((status) => observed.push(status)); });
    const flush = async () => { for (let turn = 0; turn < 40; turn++) await Promise.resolve(); };
    await flush();
    assert.equal(observed.at(-1)?.ready, true);
    context.mock.timers.tick(11);
    await flush();
    assert.equal(observed.at(-1)?.fence, "past");
    assert.equal(observed.at(-1)?.ready, true);
    context.mock.timers.tick(89);
    await flush();
    assert.equal(observed.at(-1)?.ready, false, "expiry remains scheduled after the fence has already passed");
  } finally { unsubscribe(); context.mock.timers.reset(); await client.close(); await rm(root, { recursive: true, force: true }); }
});

test("authenticated startup restores a cleared token binding across restart and a later cold offline open", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-confirmed-binding-"));
  const factory = fileRangeStore(root);
  await seededStore(factory);
  let token: string | null = "alice-token";
  let principal: string | null = "dev:alice";
  let binding: { token: string; principal: string } | null = null;
  const tokenStore = {
    load: async () => token, loadPrincipal: async () => principal, loadPrincipalBinding: async () => binding,
    save: async (value: string | null) => { token = value; },
    savePrincipal: async (value: string | null, boundToken?: string) => { principal = value; binding = value === null ? null : { token: boundToken!, principal: value }; },
  };
  let client = createClient({ url: "http://confirmed-binding.test", token: "alice-token", tokenStore, fetch: fakeOwner().fetch, offline: { store: factory } });
  try {
    await client.ready;
    assert.equal(principal, "dev:alice", "authenticated me restores the binding cleared before the token write");
    await client.offline();
    client = await client.restart();
    assert.equal(principal, "dev:alice", "offline restart preserves the matching authenticated token binding");
    assert.equal((await client.query(api.messages.inbox as any, { c: null })).state, "complete");
    await client.close();
    client = createClient({ url: "http://confirmed-binding.test", tokenStore, startOffline: true, fetch: async () => { throw new Error("no network expected"); }, offline: { store: factory } });
    await client.ready;
    assert.equal((await client.query(api.messages.inbox as any, { c: null })).state, "complete");
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});

test("a token-store write crossing hydration discards the mixed principal snapshot before early reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-mixed-binding-"));
  const factory = fileRangeStore(root);
  await seededStore(factory);
  let token: string | null = "alice-token";
  let principal: string | null = "dev:alice";
  let binding: { token: string; principal: string } | null = { token: "alice-token", principal };
  const principalRead = Promise.withResolvers<void>();
  const releasePrincipal = Promise.withResolvers<void>();
  const ownerStarted = Promise.withResolvers<void>();
  const tokenStore = {
    load: async () => { principalRead.resolve(); await releasePrincipal.promise; return token; },
    loadPrincipal: async () => principal,
    loadPrincipalBinding: async () => binding,
    save: async (value: string | null) => { token = value; },
    savePrincipal: async (value: string | null, boundToken?: string) => { principal = value; binding = value === null ? null : { token: boundToken!, principal: value }; },
  };
  const client = createClient({ url: "http://mixed-binding.test", tokenStore, offline: { store: factory },
    fetch: async (_input, init) => { ownerStarted.resolve(); return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); },
  });
  try {
    await principalRead.promise;
    await tokenStore.savePrincipal(null);
    await tokenStore.save("bob-token");
    // Another instance's older authenticated me completes after the new bearer.
    await tokenStore.savePrincipal("dev:alice", "alice-token");
    releasePrincipal.resolve();
    await ownerStarted.promise;
    let delivered = false;
    const read = client.query(api.messages.inbox as any, { c: null }).then((result) => { delivered = true; return result; });
    await tick();
    assert.equal(delivered, false, "the old principal must not be paired with the replacement token");
    await bounded(client.offline());
    const result = await bounded(read);
    assert.equal(result.state, "hydrating");
    assert.equal("data" in result, false);
  } finally { releasePrincipal.resolve(); await client.close(); await rm(root, { recursive: true, force: true }); }
});

test("settled waits for cold local custody before reporting an offline queue", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-cold-settled-"));
  const factory = fileRangeStore(root);
  await seededStore(factory);
  let client = createClient({ url: "http://cold-settled.test", persona: "alice", fetch: fakeOwner().fetch, offline: { store: factory } });
  try {
    await client.ready;
    await client.offline();
    await client.mutation(api.messages.send as any, { conversationId: "conversation-1", body: "cold queued" });
    await client.close();
    const openStarted = Promise.withResolvers<void>(), releaseOpen = Promise.withResolvers<void>();
    client = createClient({ url: "http://cold-settled.test", persona: "alice", startOffline: true, offline: { store: () => {
      const store = factory(), open = store.open.bind(store);
      store.open = async (partition) => { openStarted.resolve(); await releaseOpen.promise; await open(partition); };
      return store;
    } } });
    let settled = false;
    const pending = client.outbox.settled().then((result) => { settled = true; return result; });
    await openStarted.promise;
    await tick();
    assert.equal(settled, false);
    releaseOpen.resolve();
    assert.deepEqual(await pending, { stopped: "offline", remaining: 1 });
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});

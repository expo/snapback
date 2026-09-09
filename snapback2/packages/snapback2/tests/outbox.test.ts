import { assertRefused } from "./live-fixture.ts";
import { isRefusalError } from "../dist/client-observed-test.mjs";
import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import React, { StrictMode } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api, createClient } from "../dist/client.mjs";
import { RefusalError } from "../dist/client-observed-test.mjs";
import { SnapbackProvider, indexedDbRangeStore, useMutation, useOutbox, useSnapbackClient } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { sqliteFactory } from "./sqlite-fixture.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { DAY, engineId, fakeOwner, seededStore, generation, schemaHash } from "./fake-owner.ts";
import { OutboxLedger } from "../dist/client-observed-test.mjs";
import { RowImage, preparedDeliveryRows } from "../dist/image-runtime.mjs";

// @ref LLP 1012#7-writes-offline — the outbox contract, proven against a
// replay-aware owner double on all three carriers.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "snapback2-outbox-"));
}

function indexedFactory() {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  return () => indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
}

async function carriers(): Promise<Array<{ name: string; factory: () => ReturnType<typeof fileRangeStore>; cleanup(): Promise<void> }>> {
  const root = await tempRoot();
  const indexed = indexedFactory();
  const sqlRoot = await tempRoot();
  return [
    { name: "file", factory: () => fileRangeStore(root), cleanup: () => rm(root, { recursive: true, force: true }) },
    { name: "IndexedDB", factory: indexed, cleanup: async () => undefined },
    { name: "SQLite", factory: () => sqliteFactory(join(sqlRoot, "state.db")), cleanup: () => rm(sqlRoot, { recursive: true, force: true }) },
  ];
}

const post = (body: string) => ({ conversationId: "conversation-1", body });

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — the
// writer's fixed receipt table is independent of ordinary outbox retention;
// its clock floor and wipe incarnation fence recovery.
test("a resume whose grant persistence crosses a seal cannot restore trust; the next login waits for its own resume on both carriers", async () => {
  for (const carrier of await carriers()) {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    const owner = fakeOwner();
    const meStarted = Promise.withResolvers<void>();
    const expired = Promise.withResolvers<Response>();
    const persistenceStarted = Promise.withResolvers<void>();
    const releasePersistence = Promise.withResolvers<void>();
    const subscribed = Promise.withResolvers<void>();
    const sealStarted = Promise.withResolvers<void>();
    let pauseGrant = false;
    let holdMe = false;
    let mutations = 0;
    let unsubscribe = () => {};
    let pending: Promise<unknown>[] = [];
    let client: ReturnType<typeof createClient> | undefined;
    try {
      await seededStore(carrier.factory());
      const factory = carrier.factory();
      client = createClient({ url: "http://obsolete-resume.test", token: "alice-token",
        offline: { fenceDays: 1, store: () => {
          const store = factory();
          const commit = store.commit.bind(store);
          store.commit = async (swap) => {
            if (pauseGrant && swap.grants) {
              pauseGrant = false;
              persistenceStarted.resolve();
              await releasePersistence.promise;
            }
            await commit(swap);
          };
          return store;
        } },
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === "/api/mutation") mutations += 1;
          if (path === "/api/auth/me" && holdMe) {
            holdMe = false;
            meStarted.resolve();
            return expired.promise;
          }
          return owner.fetch(input, init);
        },
      });
      await client.ready;
      now += 3 * DAY;
      await client.mutation(api.messages.send as any, post("kept across seal"));
      assert.equal(mutations, 0);
      holdMe = true;
      const me = assert.rejects(client.auth.me(), (error: any) => error.code === "E_AUTH_SESSION");
      pending = [me];
      await meStarted.promise;
      pauseGrant = true;
      // Attach the handler now: the obsolete operation may refuse when sealed.
      const obsolete = client.online().catch((error) => error);
      pending.push(obsolete);
      await persistenceStarted.promise;
      let notifications = 0;
      unsubscribe = client.outbox.subscribe(() => {
        if (++notifications === 1) subscribed.resolve();
        else sealStarted.resolve();
      });
      await subscribed.promise;
      expired.resolve(jsonResponse({ code: "E_AUTH_SESSION", family: "auth", message: "session expired", guide: "auth/session" }, 401));
      // resetTrust notifies synchronously before the serialized seal waits for
      // grant persistence. No timer decides which side of the race was tested.
      await sealStarted.promise;
      unsubscribe();
      releasePersistence.resolve();
      await Promise.all(pending);
      assert.equal(mutations, 0, `${carrier.name}: obsolete resume sent nothing`);

      await client.auth.login({ email: "alice@example.com", password: "pw" });
      assert.equal(await client.outbox.fence(), "past", `${carrier.name}: no pre-seal anchor survived`);
      assert.equal((await client.outbox.drain()).stopped, "fence");
      assert.equal(mutations, 0, `${carrier.name}: login did not release the old queue`);
      assert.equal((await client.outbox.entries())[0]?.state, "queued");
      await client.online();
      assert.equal(mutations, 1);
      assert.equal((await client.outbox.entries())[0]?.state, "committed");
    } finally {
      unsubscribe();
      expired.resolve(jsonResponse({ viewer: "dev:alice", kind: "user" }));
      releasePersistence.resolve();
      await Promise.allSettled(pending);
      await client?.close();
      Date.now = originalNow;
      await carrier.cleanup();
    }
  }
});

test("no-facts recovery chooses the mounted drain ahead of another mounted candidate, then the recorded log, native cursor metadata, or optional query on both carriers", async () => {
  for (const carrier of await carriers()) {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
      for (const choice of ["mounted", "recorded", "cursor", "optional"] as const) {
        const owner = fakeOwner();
        const queries: string[] = [];
        const manifestOps = {
          "account.mine": { kind: "query", args: {}, planHash: "f".repeat(64) },
          ...(choice === "optional" ? {} : {
            "feed.global": { kind: "query", cursor: "c", args: { c: { Optional: "Cursor" } }, planHash: "f".repeat(64) },
            "messages.inbox": { kind: "query", cursor: "c", args: { c: { Optional: "Cursor" } }, planHash: "f".repeat(64) },
          }),
        };
        const fetch: typeof globalThis.fetch = async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === "/api/query") queries.push(JSON.parse(String(init?.body)).op);
          const response = await owner.fetch(input, init);
          if (path !== "/api/manifest") return response;
          return jsonResponse({ ...await response.json(), ops: manifestOps });
        };
        let client = createClient({ url: "http://seed-choice.test", fetch, offline: { store: carrier.factory(), fenceDays: 1 } });
        const subscriptions: Array<{ close(): void }> = [];
        try {
          await client.ready;
          await client.auth.login({ email: "alice@example.com", password: "pw" });
          await client.offline();
          await client.mutation(api.messages.send as any, post(choice));
          await client.close();
          now += 3 * DAY;
          if (choice === "recorded") {
            const store = carrier.factory()();
            await store.open("dev:alice");
            // The log choice survived, but it has no generation/auth facts yet.
            await store.commit({ watermark: { op: "messages.inbox", args: { c: null }, watermark: null, updatedAt: now } });
            await store.close?.();
          }
          client = createClient({ url: "http://seed-choice.test", fetch, token: "alice-token", offline: { store: carrier.factory(), fenceDays: 1 } });
          if (choice === "mounted") {
            subscriptions.push(subscribe(client, api.feed.global as any, { c: null }, () => {}));
            subscriptions.push(subscribe(client, api.messages.inbox as any, { c: null }, () => {}, { drain: true }));
          }
          await client.ready;
          const expected = choice === "optional" ? "account.mine" : choice === "cursor" ? "feed.global" : "messages.inbox";
          assert.equal(queries[0], expected, `${carrier.name}: ${choice}`);
          assert.equal((await client.outbox.entries())[0]?.state, "committed");
          if (choice === "mounted") await (subscriptions[1] as any).until((value: any) => value.caughtUp === true, 2_000);
        } finally {
          for (const subscription of subscriptions) subscription.close();
          await client.close();
          const store = carrier.factory()();
          await store.wipe("dev:alice");
          await store.close?.();
        }
      }
    } finally {
      Date.now = originalNow;
      await carrier.cleanup();
    }
  }
});

test("cold no-facts recovery exposes E_OFFLINE_RESUME in lastRefusal and online rejects while keeping the queue on both carriers", async () => {
  for (const carrier of await carriers()) {
    const originalNow = Date.now;
    const owner = fakeOwner();
    let client = createClient({ url: "http://cold-refusal.test", fetch: owner.fetch, offline: { store: carrier.factory(), fenceDays: 1 } });
    try {
      await client.ready;
      await client.auth.login({ email: "alice@example.com", password: "pw" });
      await client.offline();
      await client.mutation(api.messages.send as any, post("survives cold refusal"));
      await client.close();
      Date.now = () => originalNow() + 3 * DAY;
      client = createClient({ url: "http://cold-refusal.test", fetch: owner.fetch, token: "alice-token", offline: { store: carrier.factory(), fenceDays: 1 } });
      await client.ready;
      assert.equal(client.snapshot.lastRefusal?.code, "E_OFFLINE_RESUME", `${carrier.name}: cold refusal is visible`);
      assert.equal(client.snapshot.lastRefusal?.site, "client.online.resume");
      await assert.rejects(client.online(), (error: any) => error.code === "E_OFFLINE_RESUME");
      assert.equal(client.snapshot.lastRefusal?.code, "E_OFFLINE_RESUME");
      assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["queued"]);
      assert.equal(owner.executions.length, 0);
      // ready remains usable: an explicit receipt lets the same cold client recover.
      await client.query(api.messages.inbox as any, { c: null });
      await client.online();
      assert.equal(client.snapshot.lastRefusal, undefined);
      assert.equal((await client.outbox.entries())[0]?.state, "committed");
    } finally {
      await client.close();
      Date.now = originalNow;
      await carrier.cleanup();
    }
  }
});

test("live transport and a fresh login grant cannot release old intents; a grantless resume opens the fence and restart closes it on both carriers", async () => {
  for (const carrier of await carriers()) {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    const owner = fakeOwner();
    let failResume = true;
    let mutations = 0;
    let client: ReturnType<typeof createClient> | undefined;
    try {
      client = createClient({ url: "http://trust.test", offline: { store: carrier.factory(), fenceDays: 1 },
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === "/api/mutation") mutations += 1;
          if (path === "/api/resume" && failResume) return jsonResponse({ message: "resume unavailable" }, 503);
          const response = await owner.fetch(input, init);
          if (path !== "/api/resume") return response;
          const { grant: _grant, ...resumed } = await response.json();
          return jsonResponse(resumed);
        },
      });
      await client.ready;
      await client.auth.login({ email: "alice@example.com", password: "pw" });
      await client.query(api.messages.inbox as any, { c: null });
      await client.offline();
      await client.mutation(api.messages.send as any, post("old grant"));
      now += 3 * DAY;
      await client.mutation(api.messages.send as any, post("past fence"));
      assert.equal(await client.outbox.ready(), true, "fence age does not gate custody");
      await assert.rejects(client.online(), (error: any) => error.code === "E_TRANSPORT" || error.retryable);
      // online() restored transport before its failed resume. Mutations would
      // reach this spy if the fence guard were removed.
      assert.equal((await client.outbox.drain()).stopped, "fence");
      assert.equal((await client.outbox.settled()).stopped, "fence");
      assert.equal(mutations, 0, `${carrier.name}: live transport cannot bypass the failed resume`);
      await client.auth.login({ email: "alice@example.com", password: "pw" });
      assert.equal(await client.outbox.ready(), true);
      assert.equal(await client.outbox.fence(), "past", "a fresh consumption grant does not renew old intents");
      await client.outbox.drain();
      assert.equal(mutations, 0, `${carrier.name}: fresh login is not a resume`);
      assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["queued", "queued"]);
      failResume = false;
      await client.online();
      assert.deepEqual(await client.outbox.settled(), { stopped: false, remaining: 0 });
      assert.deepEqual(owner.executions.map((entry) => (entry.args as any).body), ["old grant", "past fence"]);
      assert.equal(await client.outbox.fence(), "inside");

      // Make the consumption grant old too, resume without replacing it, then
      // queue under the renewed trust and restart while cut.
      now += 3 * DAY;
      await client.offline();
      await client.mutation(api.messages.send as any, post("renew again"));
      await client.online();
      await client.offline();
      await client.mutation(api.messages.send as any, post("after grantless resume"));
      assert.equal((await client.outbox.entries()).at(-1)?.predicted, true, "resume itself restored prediction");
      failResume = true;
      client = await client.restart();
      await assert.rejects(client.online());
      const before = mutations;
      assert.equal((await client.outbox.drain()).stopped, "fence");
      assert.equal(mutations, before, `${carrier.name}: restart discarded the old runtime's trust`);
      await client.mutation(api.messages.send as any, post("after restart"));
      assert.equal((await client.outbox.entries()).at(-1)?.predicted, false);
      failResume = false;
      await client.online();
      assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["committed", "committed", "committed", "committed", "committed"]);
    } finally {
      await client?.close();
      Date.now = originalNow;
      await carrier.cleanup();
    }
  }
});

test("partition change, seal, and wipe never inherit a successful resume for drain or prediction on both carriers", async () => {
  for (const carrier of await carriers()) {
    const originalNow = Date.now;
    const now = originalNow();
    Date.now = () => now;
    const alice = fakeOwner();
    const bob = fakeOwner({ grantMintedAt: () => now - 3 * DAY });
    let principal = "dev:alice";
    let expireSession = false;
    let mutations = 0;
    let resumes = 0;
    let client: ReturnType<typeof createClient> | undefined;
    try {
      // Bob's partition survived a previous process, with an old grant and a
      // queued intent. Opening Alice must not open Bob's replay fence.
      const store = carrier.factory()();
      await store.open("dev:bob");
      const id = engineId(1);
      await store.commit({
        grants: { current: id, put: [{ id, from: id, count: 8192, used: 52, mintedAt: now - 3 * DAY, expiresAt: now + 27 * DAY }] },
        bounds: { "messages.send": 51 },
        outbox: { put: [{ intent: `${id}:0`, grant: id, offset: 0, count: 52, ids: [id],
          op: "messages.send", args: post("Bob's old queue"), state: "queued", issuedSeq: 0,
          createdAt: now - 3 * DAY, updatedAt: now - 3 * DAY, trace: { points: [], verdicts: [] } }] },
      });
      await store.close?.();
      await seededStore(carrier.factory());
      client = createClient({ url: "http://partition-trust.test", token: "alice-token", offline: { store: carrier.factory(), fenceDays: 1 },
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === "/api/auth/login") principal = JSON.parse(String(init?.body)).email.startsWith("bob") ? "dev:bob" : "dev:alice";
          if (path === "/api/auth/logout") return jsonResponse({ ok: true });
          if (path === "/api/auth/me" && expireSession) return jsonResponse({
            code: "E_AUTH_SESSION", family: "auth", message: "session expired", guide: "auth/session",
          }, 401);
          if (path === "/api/mutation") mutations += 1;
          if (path === "/api/resume") resumes += 1;
          const response = await (principal === "dev:alice" ? alice : bob).fetch(input, init);
          const value = await response.json();
          if (value.viewer) value.viewer = principal;
          if (value.authority) value.authority.principal = principal;
          if (path === "/api/resume" && principal === "dev:bob") delete value.grant;
          return jsonResponse(value, response.status);
        },
      });
      await client.ready;
      assert.equal(resumes, 1, "Alice successfully resumed");
      await client.auth.login({ email: "bob@example.com", password: "pw" });
      await client.query(api.messages.inbox as any, { c: null });
      await client.mutation(api.messages.send as any, post("Bob before resume"));
      assert.equal((await client.outbox.entries()).at(-1)?.predicted, false);
      assert.equal((await client.outbox.drain()).stopped, "fence");
      assert.equal(mutations, 0, `${carrier.name}: Alice's resume authorized no Bob writes`);
      assert.equal(resumes, 1);
      await client.online();
      assert.deepEqual(bob.executions.map((entry) => (entry.args as any).body), ["Bob's old queue", "Bob before resume"]);
      assert.equal(await client.outbox.fence(), "inside");

      for (const boundary of ["seal", "wipe"]) {
        if (boundary === "seal") {
          expireSession = true;
          await assert.rejects(client.auth.me(), (error: any) => error.code === "E_AUTH_SESSION");
          expireSession = false;
        } else await client.auth.logout();
        await client.auth.login({ email: "bob@example.com", password: "pw" });
        await client.query(api.messages.inbox as any, { c: null });
        const before = mutations;
        await client.mutation(api.messages.send as any, post(`after ${boundary}`));
        assert.equal((await client.outbox.entries()).at(-1)?.predicted, false, `${carrier.name}: ${boundary} cleared prediction trust`);
        assert.equal((await client.outbox.drain()).stopped, "fence");
        assert.equal(mutations, before, `${carrier.name}: ${boundary} cleared replay trust`);
        await client.online();
        assert.equal((await client.outbox.entries()).at(-1)?.state, "committed");
      }
    } finally {
      await client?.close();
      Date.now = originalNow;
      await carrier.cleanup();
    }
  }
});

test("login then offline before any delivery resumes a three-day queue, including after reset, on both carriers", async () => {
  for (const carrier of await carriers()) {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    const owner = fakeOwner();
    let reset = false;
    const requests: string[] = [];
    let client: ReturnType<typeof createClient> | undefined;
    try {
      client = createClient({ url: "http://empty-resume.test", offline: { store: carrier.factory(), fenceDays: 1 },
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          requests.push(path);
          if (path === "/api/resume" && reset) {
            reset = false;
            return jsonResponse({ code: "E_OFFLINE_RESET", family: "offline", message: "reset coverage", generation, schemaHash, guide: "offline" }, 409);
          }
          const response = await owner.fetch(input, init);
          if (path !== "/api/manifest") return response;
          const manifest = await response.json();
          manifest.ops = { "messages.inbox": { kind: "query", cursor: "c", args: { c: { Optional: "Cursor" } }, planHash: "f".repeat(64) } };
          return jsonResponse(manifest);
        },
      });
      await client.ready;
      await client.auth.login({ email: "alice@example.com", password: "pw" });
      assert.equal(requests.includes("/api/query"), false, "login had no deliveries");
      await client.offline();
      await client.mutation(api.messages.send as any, post("before any delivery"));
      now += 3 * DAY;
      const start = requests.length;
      await client.online();
      assert.deepEqual(requests.slice(start), ["/api/query", "/api/resume", "/api/mutation"], `${carrier.name}: real facts, then resume, then replay`);
      assert.equal((await client.outbox.entries())[0]?.state, "committed");
      await client.offline();
      await client.mutation(api.messages.send as any, post("before reset"));
      now += 3 * DAY;
      reset = true;
      const resetStart = requests.length;
      await client.online();
      const recovery = requests.slice(resetStart);
      assert.equal(recovery.filter((path) => path === "/api/resume").length, 2, "reset completes a second resume");
      // Merged with lane T2 (LLP 1012 tail): a rebuild keeps the authenticated
      // facts, so the second resume needs no seed query; any query that does run
      // follows the refused resume rather than preceding it.
      const query = recovery.indexOf("/api/query");
      assert.ok(query === -1 || query > recovery.indexOf("/api/resume"));
      assert.ok(recovery.lastIndexOf("/api/resume") < recovery.indexOf("/api/mutation"));
      assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["committed", "committed"]);
    } finally {
      await client?.close();
      Date.now = originalNow;
      await carrier.cleanup();
    }
  }
});

test("online refuses E_OFFLINE_RESUME and retains a past-fence queue when no query can supply resume facts", async () => {
  for (const carrier of await carriers()) {
    const originalNow = Date.now;
    const owner = fakeOwner();
    const client = createClient({ url: "http://unbuildable-resume.test", fetch: owner.fetch, offline: { store: carrier.factory(), fenceDays: 1 } });
    try {
      await client.ready;
      await client.auth.login({ email: "alice@example.com", password: "pw" });
      await client.offline();
      await client.mutation(api.messages.send as any, post("kept"));
      Date.now = () => originalNow() + 3 * DAY;
      await assert.rejects(client.online(), (error: any) => error.code === "E_OFFLINE_RESUME"
        && error.envelope.family === "offline" && error.envelope.site === "client.online.resume"
        && error.envelope.guide === "offline" && /queued writes are kept/.test(error.envelope.rewrite));
      assert.equal(client.snapshot.lastRefusal?.code, "E_OFFLINE_RESUME");
      assert.equal(owner.executions.length, 0);
      assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["queued"]);
    } finally {
      await client.close();
      Date.now = originalNow;
      await carrier.cleanup();
    }
  }
});

test("missing grant trust waits for resume and the client clock never expires an intent on both carriers", async () => {
  for (const carrier of await carriers()) {
    const originalNow = Date.now;
    const mintedAt = originalNow();
    const owner = fakeOwner({ grantMintedAt: () => mintedAt });
    await seededStore(carrier.factory());
    const factory = carrier.factory();
    let store: ReturnType<typeof factory>;
    const client = createClient({ url: "http://missing-trust.test", fetch: owner.fetch, persona: "alice",
      offline: { store: () => (store = factory()), fenceDays: 1 },
    });
    try {
      await client.ready;
      await client.offline();
      await client.mutation(api.messages.send as any, post("owner judges age"));
      Date.now = () => mintedAt + 40 * DAY;
      const [entry] = await client.outbox.entries();
      await store!.commit({ grants: { current: null, remove: [entry!.grant] } });
      assert.equal((await client.outbox.drain()).stopped, "fence", "missing trust is not permission to send");
      assert.equal((await client.outbox.entries())[0]?.state, "queued");
      await client.online();
      assert.equal((await client.outbox.entries())[0]?.state, "committed", "server acceptance wins even forty days ahead on the client clock");
      assert.equal(owner.executions.length, 1);
    } finally {
      await client.close();
      Date.now = originalNow;
      await carrier.cleanup();
    }
  }
});

test("useOutbox exposes fence inside and past while ready stays true, then updates after grantless resume", async () => {
  const root = await tempRoot();
  const originalNow = Date.now;
  const owner = fakeOwner();
  await seededStore(fileRangeStore(root));
  let client: any;
  let outbox: any;
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  function Harness() { client = useSnapbackClient(); outbox = useOutbox(); return null; }
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(SnapbackProvider, {
        url: "http://fence-hook.test", persona: "alice", offline: { store: fileRangeStore(root), fenceDays: 1 },
        fetch: async (input, init) => {
          const response = await owner.fetch(input, init);
          if (new URL(String(input)).pathname !== "/api/resume" || owner.grantsMinted() === 1) return response;
          const { grant: _grant, ...value } = await response.json();
          return jsonResponse(value);
        },
      }, React.createElement(Harness)));
    });
    await act(async () => { await client.ready; await client.offline(); });
    assert.equal(outbox.can.send, true);
    assert.equal(outbox.detail.status.fence, "inside");
    Date.now = () => originalNow() + 3 * DAY;
    await act(async () => { await client.mutation(api.messages.send as any, post("past")); });
    assert.equal(outbox.can.send, true, "fence does not disable accepting a write");
    assert.equal(outbox.detail.status.fence, "past");
    assert.equal(outbox.entries[0].reason, "fence");
    assert.equal(outbox.entries[0].predicted, false);
    await act(async () => { await client.online(); });
    assert.equal(outbox.can.send, true);
    assert.equal(outbox.detail.status.fence, "inside");
    assert.equal(outbox.entries[0].state, "committed");
  } finally {
    await act(async () => { renderer?.unmount(); await client?.close(); });
    Date.now = originalNow;
    await rm(root, { recursive: true, force: true });
  }
});

test("enqueue consumes a grant slice of 1 + maxNewIds and refuses E_OFFLINE_ID_BLOCK when the grant is spent", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner({ grantCount: 110 });
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://outbox.test", persona: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await client.ready;
    assert.equal(owner.grantsMinted(), 1, `${carrier.name}: cold start resumed and earned a grant`);
    assert.equal(await client.outbox.ready(), true, `${carrier.name}: the grant itself is ready`);
    assert.equal(await client.outbox.ready(api.messages.send as any), true, `${carrier.name}: the post slice fits initially`);
    await client.offline();
    const first = await client.mutation(api.messages.send as any, post("one"));
    assert.equal(first.state, "queued");
    const second = await client.mutation(api.messages.send as any, post("two"));
    assert.equal(second.state, "queued");
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => [entry.intent, entry.offset, entry.count, entry.state]), [
      [`${engineId(100)}:0`, 0, 52, "queued"],
      [`${engineId(100)}:52`, 52, 52, "queued"],
    ], carrier.name);
    assert.equal(entries[0]!.ids.length, 52);
    assert.equal(entries[0]!.ids[0], engineId(100), "the first pinned id is the grant's from");
    assert.equal(entries[1]!.ids[0], engineId(152));
    assert.deepEqual(entries[0]!.trace, { points: [], verdicts: [] }, "the twin's seam is left empty");
    assert.equal(first.state === "queued" && first.ids[0], engineId(100));
    assert.equal(await client.outbox.ready(), true, `${carrier.name}: a spent-down grant remains present`);
    assert.equal(await client.outbox.ready(api.messages.send as any), false, `${carrier.name}: the remaining six ids cannot hold this op's slice`);
    await assertRefused(
      () => client.mutation(api.messages.send as any, post("three")),
      (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_OFFLINE_ID_BLOCK"
        && error.family === "offline" && typeof error.rewrite === "string",
      `${carrier.name}: 110 - 104 = 6 ids left cannot hold 52`,
    );
    assert.equal((await client.outbox.entries()).length, 2, "a refused enqueue writes nothing");
    client.close();
    await carrier.cleanup();
  }
});

test("a fresh partition without a grant refuses offline writes loudly and earns one on the drained log", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  const client = createClient({ url: "http://grantless.test", persona: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await client.ready;
  assert.equal(owner.grantsMinted(), 0, "nothing held, nothing to resume");
  await client.offline();
  await assertRefused(
    () => client.mutation(api.messages.send as any, post("no grant")),
    (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_OFFLINE_ID_BLOCK",
  );
  await client.online();
  const drain = subscribe(client, api.messages.inbox as any, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => value.state === "complete" && value.caughtUp === true, 2_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(owner.grantsMinted(), 1, "the drain reaching its watermark asked for a grant");
  await client.offline();
  const queued = await client.mutation(api.messages.send as any, post("now queued"));
  assert.equal(queued.state, "queued");
  drain.close();
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("a grant arriving without an outbox entry change flips useOutbox().ready", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  let client: any;
  let outbox: any;
  const observed: Array<[boolean, number]> = [];
  function Harness() {
    client = useSnapbackClient();
    outbox = useOutbox();
    observed.push([outbox.can.send, outbox.entries.length]);
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://grant-notify.test", persona: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } },
      React.createElement(Harness),
    ));
  });
  await act(async () => { await client.ready; await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.deepEqual([outbox.can.send, outbox.entries.length], [false, 0], "no grant means not ready");
  let drain: any;
  await act(async () => {
    drain = subscribe(client, api.messages.inbox as any, { c: null }, () => undefined, { drain: true });
    await drain.until((value: any) => value.state === "complete" && value.caughtUp === true, 2_000);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.deepEqual([outbox.can.send, outbox.entries.length], [true, 0], "the grant notification changed readiness without adding an entry");
  assert.ok(observed.some(([ready, entries]) => ready && entries === 0), "React never observed the grant-only readiness change");
  drain.close();
  await act(async () => { renderer!.unmount(); });
  await client.close();
  await rm(root, { recursive: true, force: true });
});

test("the drain replays FIFO after resume, one envelope per request, and both settle committed in order", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner();
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://fifo.test", persona: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await client.ready;
    await client.offline();
    await client.mutation(api.messages.send as any, post("one"));
    await client.mutation(api.messages.send as any, post("two"));
    await client.online();
    await client.outbox.settled();
    assert.deepEqual(owner.executions.map((item) => (item.args as any).body), ["one", "two"], carrier.name);
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["committed", "committed"]);
    assert.equal((entries[0]!.response as any).data.id, entries[0]!.ids[0], "the server minted the pinned id");
    assert.equal((entries[1]!.response as any).intent, entries[1]!.intent);
    assert.equal(owner.grantsMinted(), 2, "resume minted a fresh grant; queued intents replayed under their own");
    client.close();
    await carrier.cleanup();
  }
});

test("a 503 after a commit leaves the intent queued, stops the drain, and the retry is the same envelope exactly once", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner({ failAfterCommit: 1 });
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://exactly-once.test", persona: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await client.ready;
    await client.offline();
    await client.mutation(api.messages.send as any, post("one"));
    await client.mutation(api.messages.send as any, post("two"));
    await client.online();
    await client.outbox.settled();
    let entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["queued", "queued"], `${carrier.name}: the 503 stopped the drain`);
    assert.equal(owner.executions.length, 1, "the owner committed the first intent before answering 503");
    await client.outbox.drain();
    entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["committed", "committed"]);
    assert.equal(owner.executions.length, 2, "the retry was answered from the ledger, not executed again");
    assert.equal((entries[0]!.response as any).data.id, entries[0]!.ids[0]);
    client.close();
    await carrier.cleanup();
  }
});

test("a rejection and a trace conflict settle only their own intent and the drain continues", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner({
      reject: (_intent, body) => body.args.body === "rejected",
      conflict: (_intent, body) => body.op === "messages.edit",
    });
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://settle.test", persona: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await client.ready;
    await client.offline();
    await client.mutation(api.messages.send as any, post("rejected"));
    await client.mutation(api.messages.edit as any, { messageId: "message-1", body: "mine", baseBody: "theirs" });
    await client.mutation(api.messages.send as any, post("after"));
    await client.online();
    await client.outbox.settled();
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["rejected", "rejected", "committed"], carrier.name);
    assert.equal((entries[0]!.response as any).code, "NOT_MEMBER");
    assert.deepEqual(
      { reason: (entries[1]!.response as any).reason, code: (entries[1]!.response as any).code, site: (entries[1]!.response as any).site },
      { reason: "conflict", code: "E_OFFLINE_CONFLICT", site: "messages.edit.messages[messageId]" },
    );
    await client.outbox.dismiss(entries[0]!.intent);
    await client.outbox.dismiss(entries[2]!.intent);
    assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["rejected"], "dismiss drops settled entries");
    client.close();
    await carrier.cleanup();
  }
});

test("a three-day-old queue under fenceDays 1 waits for resume without prediction, then replays FIFO and commits on both carriers", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner();
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://fence.test", persona: "alice", fetch: owner.fetch, offline: { store: carrier.factory(), fenceDays: 1 } });
    const originalNow = Date.now;
    try {
      await client.ready;
      await client.offline();
      await client.mutation(api.messages.send as any, post("three days old"));
      assert.equal((await client.outbox.entries())[0]?.predicted, true, `${carrier.name}: prediction starts inside the fence`);
      Date.now = () => originalNow() + 3 * DAY;
      const pastFence = await client.mutation(api.messages.send as any, post("typed past the fence"));
      assert.equal(pastFence.state, "queued", `${carrier.name}: the fence never refuses custody`);
      const queued = await client.outbox.entries();
      assert.equal(queued[1]?.predicted, false, `${carrier.name}: prediction is off past the fence`);
      assert.equal(queued[1]?.reason, "fence");
      const mutations = owner.requests.filter((path) => path === "/api/mutation").length;
      await client.outbox.drain();
      assert.equal(owner.requests.filter((path) => path === "/api/mutation").length, mutations,
        `${carrier.name}: drain sends nothing before a successful resume`);
      assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["queued", "queued"]);
      await client.online();
      await client.outbox.settled();
      assert.deepEqual(owner.executions.map((item) => (item.args as any).body), ["three days old", "typed past the fence"],
        `${carrier.name}: the successful resume released every intent in FIFO order`);
      assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["committed", "committed"]);
    } finally {
      Date.now = originalNow;
      client.close();
      await carrier.cleanup();
    }
  }
});

test("only the owner's E_OFFLINE_INTENT_EXPIRED refusal expires an intent and the drain continues on both carriers", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner({
      refuse: (_intent, body) => body.args.body === "server expired"
        ? { status: 409, envelope: {
          code: "E_OFFLINE_INTENT_EXPIRED", family: "offline",
          message: "the replay grant is older than thirty days",
          rewrite: "resume for a fresh grant and send again", guide: "offline",
        } }
        : undefined,
    });
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://server-expiry.test", persona: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await client.ready;
    await client.offline();
    await client.mutation(api.messages.send as any, post("server expired"));
    await client.mutation(api.messages.send as any, post("after expiry"));
    const before = owner.requests.filter((path) => path === "/api/mutation").length;
    await client.online();
    await client.outbox.settled();
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["expired", "committed"], carrier.name);
    assert.equal((entries[0]?.response as any)?.code, "E_OFFLINE_INTENT_EXPIRED", `${carrier.name}: expiry came from the owner envelope`);
    assert.equal(owner.requests.filter((path) => path === "/api/mutation").length - before, 2,
      `${carrier.name}: both intents reached the owner`);
    assert.deepEqual(owner.executions.map((item) => (item.args as any).body), ["after expiry"],
      `${carrier.name}: refusal settled only its intent and drain continued`);
    await client.outbox.dismiss(entries[0]!.intent);
    assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["committed"], `${carrier.name}: expired remains dismissible`);
    client.close();
    await carrier.cleanup();
  }
});

test("a committed settlement lands in the same swap as the log tail rows, or not at all", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  await seededStore(fileRangeStore(root));
  let failSettlement = false;
  let writes = 0;
  const store = fileRangeStore(root, {
    beforeRename: async (temporary) => {
      writes += 1;
      const pending = JSON.parse(await readFile(temporary, "utf8"));
      if (failSettlement && Object.values(pending.outbox).some((entry: any) => entry.state === "committed")) {
        failSettlement = false;
        throw new Error("disk full");
      }
    },
  });
  const client = createClient({ url: "http://atomic.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  await client.ready;
  await client.offline();
  const queued = await client.mutation(api.messages.send as any, post("atomic"));
  assert.equal(queued.state, "queued");
  const pinned = queued.state === "queued" ? queued.ids[0]! : "";
  // Target the settlement, after the resume event and grant adoption writes.
  failSettlement = true;
  await assert.rejects(() => client.online(), (error: unknown) => isRefusalError(error) && error.code === "E_OFFLINE_STATE");
  assert.equal(owner.executions.length, 1, "the owner committed before the local swap failed");
  const inspect = fileRangeStore(root)();
  await inspect.open("dev:alice");
  assert.equal((await inspect.outbox.all())[0]?.state, "queued", "a failed swap left the intent queued");
  assert.equal((await inspect.coverage()).rows.length, 0, "and wrote none of the tail rows");
  await inspect.close?.();
  const before = writes;
  await client.outbox.drain();
  assert.equal(writes, before + 1, "settlement and rows were one carrier write");
  const after = fileRangeStore(root)();
  await after.open("dev:alice");
  assert.equal((await after.outbox.all())[0]?.state, "committed");
  assert.deepEqual((await after.coverage()).rows.map((row) => [row.table, row.id]), [
    ["deliveries", `delivery-${pinned}`], ["messages", pinned],
  ], "the tail page holds the committed message and its derived delivery row");
  const tail = await after.answer("messages.inbox", { c: "cursor-9" });
  assert.equal((tail?.data as any[])[0]?.message?.id, pinned);
  await after.close?.();
  assert.equal(owner.executions.length, 1, "the replay after the failed swap was deduplicated");
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("a conditional settlement tail gets one full revalidation without weakening atomicity or custody", async () => {
  for (const mode of ["conditional", "full", "transport", "unchanged", "abort"] as const) {
    const root = await tempRoot();
    const owner = fakeOwner();
    const base = fileRangeStore(root);
    const settlementSwaps: any[] = [];
    const queuedImages: any[] = [];
    let prooflessAnswers = 0;
    let heldFallback: any;
    let inspectAnswer: ((op: string, args: unknown) => Promise<any>) | undefined;
    const factory = () => {
      const store = base();
      const answer = store.answer.bind(store);
      inspectAnswer = answer;
      store.answer = async (op, args) => {
        const held = await answer(op, args);
        const candidate = held ?? heldFallback;
        if (candidate && op === "messages.inbox" && (args as any).c === "cursor-9") {
          prooflessAnswers += 1;
          return { ...candidate, needsFactProofs: true as const };
        }
        return held;
      };
      const commit = store.commit.bind(store);
      store.commit = async (swap) => {
        if (swap.outbox?.put?.some(entry => entry.state === "committed")) settlementSwaps.push(structuredClone(swap));
        await commit(swap);
        for (const entry of swap.outbox?.put ?? []) {
          if (entry.state === "queued") queuedImages.push(structuredClone(await store.outbox.get(entry.intent)));
        }
      };
      return store;
    };
    await seededStore(factory);
    const queries: any[] = [];
    const fullStarted = Promise.withResolvers<void>();
    const releaseFull = Promise.withResolvers<void>();
    let conditionalValidator: string | undefined;
    let armed = false;
    const client = createClient({ url: `http://tail-${mode}.test`, persona: "alice", offline: { store: factory }, fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path !== "/api/query") return owner.fetch(input, init);
      const body = JSON.parse(String(init?.body));
      if (body.op !== "messages.inbox" || body.args?.c !== "cursor-9") return owner.fetch(input, init);
      queries.push(body);
      if (!armed) return owner.fetch(input, init);
      if (body.validator) {
        conditionalValidator = body.validator;
        if (mode === "full") return owner.fetch(input, init);
        return jsonResponse({ state: "unchanged", seq: 6, validator: body.validator });
      }
      if (mode === "transport") throw new TypeError("full tail is cut");
      if (mode === "unchanged") return jsonResponse({ state: "unchanged", seq: 6, validator: conditionalValidator });
      const response = await owner.fetch(input, init);
      if (mode === "abort") { fullStarted.resolve(); await releaseFull.promise; }
      return response;
    } });
    try {
      await client.ready;
      await client.query(api.messages.inbox as any, { c: "cursor-9" });
      heldFallback = await inspectAnswer!("messages.inbox", { c: "cursor-9" });
      assert(heldFallback?.validator, `${mode}: fixture holds a conditional tail validator`);
      queries.length = 0;
      prooflessAnswers = 0;
      conditionalValidator = undefined;
      armed = true;
      let before: string;
      if (mode === "transport") {
        await client.offline();
        await client.online();
        queries.length = 0;
        prooflessAnswers = 0;
        conditionalValidator = undefined;
        const result = await client.mutation(api.messages.send as any, post(mode));
        assert.equal(result.state, "queued", "transport: an online mutation keeps its durable queued result");
        before = JSON.stringify(queuedImages.at(-1));
      } else {
        await client.offline();
        await client.mutation(api.messages.send as any, post(mode));
        before = JSON.stringify((await client.outbox.entries())[0]);
      }
      if (mode === "transport") {
        // submitMutation already ran the failed drain.
      } else if (mode === "abort") {
        const online = client.online();
        await fullStarted.promise;
        await client.offline();
        await assert.rejects(online, (error: any) => error.name === "AbortError");
      } else if (mode === "unchanged") {
        await assert.rejects(client.online(), (error: any) => error.code === "E_OFFLINE_DELIVERY");
      } else {
        await client.online();
      }
      const entry = (await client.outbox.entries())[0]!;
      if (mode === "conditional" || mode === "full") {
        assert.equal(entry.state, "committed", `${mode}: replay settled`);
        assert.equal(settlementSwaps.length, 1, `${mode}: one swap carried the terminal image`);
        assert.equal(settlementSwaps[0].deliveries.length, 1, `${mode}: the same swap carried the tail`);
      } else {
        assert.equal(JSON.stringify(entry), before, `${mode}: the queued replay image stayed byte-identical`);
        assert.equal(settlementSwaps.length, 0, `${mode}: no terminal image landed without its tail`);
      }
      assert(prooflessAnswers > 0, `${mode}: the conditional fixture removed immutable fact proofs`);
      assert.equal(queries.length, mode === "full" ? 1 : 2, `${mode}: at most one unconditional retry`);
      assert.equal(queries[0].validator, conditionalValidator);
      if (queries.length === 2) assert.equal("validator" in queries[1], false, `${mode}: the retry requested a full envelope`);
    } finally {
      releaseFull.resolve();
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("online writes carry the replay envelope under custody; a transport failure enqueues; a queued outbox keeps FIFO", async () => {
  const root = await tempRoot();
  let dead = false;
  const owner = fakeOwner({ dead: () => dead });
  await seededStore(fileRangeStore(root));
  const client = createClient({ url: "http://bytes.test", persona: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await client.ready;
  const bodies: string[] = [];
  const spying = createClient({
    url: "http://bytes.test", persona: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/mutation") bodies.push(String(init?.body));
      return owner.fetch(input, init);
    },
  });
  await spying.ready;
  // @ref LLP 1012#7-writes-offline — with a grant and a bound every write is
  // a durable intent replayed under the envelope, online too: the ledger makes
  // the online path exactly-once. Settlement keeps its durable terminal.
  const online = await spying.mutation(api.messages.send as any, post("plain"));
  assert.equal(online.state, "committed");
  const sent = JSON.parse(bodies[0]!);
  assert.equal(sent.replay?.intent, online.state === "committed" ? online.intent : undefined, "an online write under custody carries the replay envelope");
  assert.deepEqual(sent.replay.trace, { points: [], verdicts: [] });
  assert.deepEqual(owner.executions.map((item) => (item.args as any).body), ["plain"]);
  assert.deepEqual((await spying.outbox.entries()).map(entry => entry.state), ["committed"],
    "returning committed does not prove that a query displays the target");
  spying.close();
  dead = true;
  const queued = await client.mutation(api.messages.send as any, post("after failure"));
  assert.equal(queued.state, "queued", "a network failure enqueues instead of throwing");
  dead = false;
  const behind = await client.mutation(api.messages.send as any, post("behind"));
  assert.equal(behind.state, "committed", "the queued intent drained first, then the new write settled in its own call");
  // Every write under custody entered the ledger, in order.
  assert.deepEqual(owner.executions.map((item) => (item.args as any).body), ["plain", "after failure", "behind"]);
  assert.deepEqual((await client.outbox.entries()).map((entry) => [entry.state, (entry.args as any).body]),
    [["committed", "after failure"], ["committed", "behind"]]);
  client.close();
  await rm(root, { recursive: true, force: true });
});

// @ref LLP 1018.003.000#4-observation-and-retention —
// explicit dismissal may race the issuing call; its response still comes from
// the bounded terminal waiter. Readers themselves never initiate dismissal.
test("an online write settles in its own call even when an explicit dismissal races its terminal response", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  await seededStore(fileRangeStore(root));
  const client = createClient({ url: "http://retire.test", persona: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await client.ready;
  const retired: string[] = [];
  const unsubscribe = client.outbox.subscribe((entries) => {
    for (const entry of entries) {
      if (entry.state !== "committed" || retired.includes(entry.intent)) continue;
      retired.push(entry.intent);
      void client.outbox.dismiss(entry.intent);
    }
  });
  const result = await client.mutation(api.messages.send as any, post("racing the hook"));
  assert.equal(result.state, "committed", "the settling call answers committed, not queued, after the subscriber retired its entry");
  assert.equal(owner.executions.length, 1, "exactly one execution");
  assert.ok(retired.length >= 1, "the subscriber retired the committed entry");
  assert.deepEqual(await client.outbox.entries(), []);
  unsubscribe();
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("an online terminal survives zero, one, and four readers, missing target delivery, and a cold reopen", async () => {
  for (const count of [0, 1, 4]) {
    const root = await tempRoot();
    const owner = fakeOwner();
    const factory = fileRangeStore(root);
    await seededStore(factory);
    let opened: ReturnType<typeof factory>;
    const client = createClient({ url: "http://retained-terminal.test", persona: "alice", offline: { store: () => (opened = factory()) },
      fetch: async (input, init) => {
        const response = await owner.fetch(input, init);
        if (new URL(String(input)).pathname !== "/api/query") return response;
        const value = await response.json() as Record<string, unknown>;
        return jsonResponse({ ...value, data: [], rows: [], receipt: { ranges: [], absences: [], verdicts: [] } });
      } });
    const stops: Array<() => void> = [];
    try {
      await client.ready;
      for (let i = 0; i < count; i++) stops.push(client.outbox.subscribe(() => {}));
      const result = await client.mutation(api.messages.send as any, post(`readers:${count}`));
      assert.equal(result.state, "committed");
      const [terminal] = await client.outbox.entries();
      assert.equal(terminal?.state, "committed");
      assert.equal((await opened!.coverage()).rows.length, 0, "the settlement tail has not delivered the message");
      stops.forEach(stop => stop());
      client.close();
      await opened!.close?.();
      const cold = factory();
      await cold.open("dev:alice");
      assert.equal((await cold.outbox.get(terminal!.intent))?.state, "committed", `${count} readers cannot erase terminal recovery`);
      await cold.close?.();
    } finally {
      stops.forEach(stop => stop());
      client.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});

// @ref LLP 1012#7-writes-offline — with a partition open there is no plain-bytes
// path: no grant or no bound refuses before any request, so a 503 after a commit
// can never double-send; only a client with no store sends today's bytes.
test("a store with an open partition never sends plain bytes: no grant or no bound refuses E_OFFLINE_ID_BLOCK with no request; a client with no store sends today's bytes", async () => {
  const owner = fakeOwner();
  const bodies: string[] = [];
  const spy = async (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(input)).pathname === "/api/mutation") bodies.push(String(init?.body));
    return owner.fetch(input, init);
  };
  // No grant: a fresh partition that neither logged in nor drained a query.
  const grantlessRoot = await tempRoot();
  const grantless = createClient({ url: "http://custody.test", persona: "alice", fetch: spy, offline: { store: fileRangeStore(grantlessRoot) } });
  await grantless.ready;
  assert.equal(owner.grantsMinted(), 0);
  await assertRefused(
    () => grantless.mutation(api.messages.send as any, post("no grant")),
    (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_OFFLINE_ID_BLOCK"
      && error.family === "offline" && /grant/.test(error.message) && typeof error.rewrite === "string",
  );
  assert.deepEqual(bodies, [], "no grant: no request left the device");
  grantless.close();
  await rm(grantlessRoot, { recursive: true, force: true });
  // No bound: a partition with a grant whose /api/program answered 404, so the write cannot be priced.
  const unboundRoot = await tempRoot();
  await seededStore(fileRangeStore(unboundRoot));
  const unbound = createClient({
    url: "http://custody.test", persona: "alice", offline: { store: fileRangeStore(unboundRoot) },
    fetch: async (input, init) => new URL(String(input)).pathname === "/api/program"
      ? new Response(JSON.stringify({ code: "E_OP_UNKNOWN", family: "op", message: "not active", guide: "op/manifest" }), { status: 404, headers: { "content-type": "application/json" } })
      : spy(input, init),
  });
  await unbound.ready;
  assert.equal(owner.grantsMinted(), 1, "the resume minted a grant");
  assert.equal(await unbound.outbox.ready(), true, "grant-only readiness does not promise a write bound");
  assert.equal(await unbound.outbox.ready(api.messages.send as any), false, "the op form refuses readiness until its bound is recorded");
  await assertRefused(
    () => unbound.mutation(api.messages.send as any, post("no bound")),
    (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_OFFLINE_ID_BLOCK" && /bound/.test(error.message),
  );
  assert.deepEqual(bodies, [], "no bound: no request left the device");
  assert.deepEqual(await unbound.outbox.entries(), [], "a refused write is not an intent");
  unbound.close();
  await rm(unboundRoot, { recursive: true, force: true });
  // No store: today's bytes, byte-identical.
  const plain = createClient({ url: "http://custody.test", persona: "alice", fetch: spy });
  assert.equal((await plain.mutation(api.messages.send as any, post("no store"))).state, "committed");
  assert.deepEqual(bodies, [JSON.stringify({ op: "messages.send", args: post("no store") })], "no store, no envelope");
  plain.close();
});

test("useMutation resolves last queued offline, and useOutbox lists the outbox at cold start", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  await seededStore(fileRangeStore(root));
  let posting: any;
  let editing: any;
  let outbox: any;
  let client: any;
  function Harness() {
    posting = useMutation(api.messages.send as any);
    editing = useMutation(api.messages.edit as any);
    outbox = useOutbox();
    client = useSnapbackClient();
    return null;
  }
  const offline = { store: fileRangeStore(root) };
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://hooks.test", persona: "alice", fetch: owner.fetch, offline },
      React.createElement(Harness),
    ));
  });
  await act(async () => { await client.ready; await client.offline(); });
  let result: any;
  await act(async () => { result = await posting.run(post("from the hook")); });
  assert.equal(result.state, "queued");
  await act(async () => { await editing.run({ messageId: "message-1", body: "b", baseBody: "a" }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.equal(posting.last.state, "queued");
  assert.equal(posting.last.intent, result.intent);
  assert.equal(posting.inFlight, false);
  assert.deepEqual(outbox.entries.map((entry: any) => [entry.op, entry.state]), [["messages.send", "queued"], ["messages.edit", "queued"]]);
  await act(async () => { renderer!.unmount(); });

  // Cold start on the same partition with the network dead: the outbox is on screen before any request.
  let dead = true;
  const deadOwner = fakeOwner({ dead: () => dead });
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://hooks-cold.test", persona: "alice", fetch: deadOwner.fetch, offline },
      React.createElement(Harness),
    ));
  });
  await act(async () => { await client.ready; await client.outbox.entries(); });
  assert.deepEqual(outbox.entries.map((entry: any) => entry.state), ["queued", "queued"], "durable across a cold start");
  assert.equal(outbox.entries.filter(entry => entry.op === "messages.send").length, 1);
  await act(async () => { renderer!.unmount(); });
  dead = false;
  await rm(root, { recursive: true, force: true });
});

test("useOutbox survives restart(): the queue is intact and settles through the restarted client", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  await seededStore(fileRangeStore(root));
  const client = createClient({ url: "http://restart.test", persona: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await client.ready;
  await client.offline();
  await client.mutation(api.messages.send as any, post("before restart"));
  const cold = await client.restart();
  assert.equal(cold.snapshot.connection, "offline", "a restart of a cut device boots cut");
  const seen: any[][] = [];
  const unsubscribe = cold.outbox.subscribe((entries) => seen.push(entries));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(seen.at(-1)?.map((entry: any) => entry.state), ["queued"]);
  assert.equal(owner.executions.length, 0, "nothing was sent while cut");
  await cold.online();
  await cold.outbox.settled();
  assert.deepEqual(seen.at(-1)?.map((entry: any) => entry.state), ["committed"], "subscribers saw the settlement");
  unsubscribe();
  cold.close();
  await rm(root, { recursive: true, force: true });
});

test("SnapbackProvider under StrictMode creates one lock-holding client and survives the simulated unmount", async () => {
  const owner = fakeOwner({ seed: true });
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const offline = { store: indexedDbRangeStore({ indexedDB: database as any, locks: locks as any }) };
  let client: any;
  let outbox: any;
  function Harness() {
    client = useSnapbackClient();
    outbox = useOutbox();
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      StrictMode,
      null,
      React.createElement(
        SnapbackProvider,
        { url: "http://strict.test", persona: "alice", fetch: owner.fetch, offline },
        React.createElement(Harness),
      ),
    ));
  });
  await act(async () => { await client.ready; await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.notEqual(client.snapshot.lastRefusal?.code, "E_OFFLINE_LOCK", "the discarded StrictMode client must not hold the principal's lock");
  const held = await client.query(api.messages.inbox as any, { c: null });
  assert.equal(held.state, "complete", "the surviving client is open after StrictMode's simulated unmount");
  assert.deepEqual(outbox.entries, []);
  await act(async () => { renderer!.unmount(); });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(client.snapshot.connection, "offline", "a real unmount closes the client one tick later");
});

test("a cold start with the owner unreachable serves the held log and the outbox before any metadata arrives", async () => {
  const root = await tempRoot();
  const owner = fakeOwner({ seed: true });
  await seededStore(fileRangeStore(root));
  const warm = createClient({ url: "http://cold.test", persona: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await warm.ready;
  const drain = subscribe(warm, api.messages.inbox as any, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => value.state === "complete" && value.caughtUp === true, 2_000);
  drain.close();
  await warm.offline();
  const queued = await warm.mutation(api.messages.send as any, post("cold"));
  assert.equal(queued.state, "queued");
  warm.close();
  let dead = true;
  const cold = createClient({ url: "http://cold.test", persona: "alice", fetch: async (input, init) => {
    if (dead) throw new TypeError("fetch failed");
    return owner.fetch(input, init);
  }, offline: { store: fileRangeStore(root) } });
  await cold.ready;
  const held = await cold.query<any, any>(api.messages.inbox as any, { c: null });
  assert.equal(held.state, "complete");
  assert.equal("connection" in held && held.connection, "offline");
  assert.ok(Array.isArray(held.data) && held.data.some((row: any) => row.message?.body === "Welcome"), "the drained log answers from the store");
  assert.deepEqual((await cold.outbox.entries()).map((entry) => entry.state), ["queued"]);
  const tail = subscribe(cold, api.messages.inbox as any, { c: null }, () => undefined, { drain: true });
  const caught = await tail.until((value) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true, 3_000);
  assert.equal("connection" in caught && caught.connection, "offline", "the drain reaches its held watermark without the owner");
  tail.close();
  dead = false;
  await cold.online();
  await cold.outbox.settled();
  assert.deepEqual((await cold.outbox.entries()).map((entry) => entry.state), ["committed"], "the reach replays the queue");
  cold.close();
  await rm(root, { recursive: true, force: true });
});


// @ref LLP 1018.003.001#4-automatic-compaction-of-successful-history —
// the transaction, not a hook, discharges every address before removing success.
test("successful history compacts atomically only after the entire effect set on every carrier", async () => {
  const identity = { planHash: "a".repeat(64), schemaHash };
  const table = { columns: { id: "Id", body: { Text: { max: 50 } } },
    indexes: { byId: { components: [{ Column: "id" }], unique: true } }, rules: {}, constraints: [] };
  const schema = { tables: { messages: table, counts: table } };
  const refs = [{ table: "messages", id: "m" }, { table: "counts", id: "aggregate" }];
  const entry = (intent: string, rows = refs, state = "committed", seq = 10): any => ({
    intent, grant: "g", offset: 0, count: 1, ids: [], op: "edit", args: { body: "new" }, issuedSeq: seq - 1,
    createdAt: 1, updatedAt: 2, state, targets: { ...identity, generation, complete: true, unresolved: [], rows: [] },
    response: { state, seq, data: null, program: { ...identity }, effects: rows },
  });
  const delivery = (seq: number, rows: typeof refs): any => {
    const prepared = rows.map(r => ({ ...r, row: RowImage.prepare(schema, r.table, { Row: { id: { Id: r.id }, body: { String: "new" } } }) }));
    return { op: "view", args: {}, seq, state: "complete", next: null,
      rows: prepared.map(r => ({ ...r, row: RowImage.wire(r.row) })), [preparedDeliveryRows]: prepared,
      data: rows.map(r => ({ $row: r })), receipt: { ranges: [], absences: [], verdicts: [] } };
  };
  for (const carrier of await carriers()) {
    const factory = carrier.factory(); let store = factory();
    try {
      await store.open("dev:alice");
      await store.commit({ facts: { generation, schemaHash, authEpoch: 7 }, programs: { [generation]: { generation, schemaHash, schema, programs: { edit: { kind: "mutation", planHash: identity.planHash, ir: {}, certificate: {} } } } }, outbox: { put: [entry("success")] } });
      await store.commit({ deliveries: [delivery(11, [refs[0]!])] });
      assert.equal((await store.outbox.get("success"))?.effects?.length, 1, carrier.name);
      await store.close?.(); store = factory(); await store.open("dev:alice");
      assert.equal((await store.outbox.get("success"))?.effects?.length, 1, "partial discharge survives reopen");
      await store.commit({ deliveries: [delivery(12, [refs[1]!])] });
      assert.equal(await store.outbox.get("success"), undefined, "maintained sibling authority completes the atomic set");
      assert.equal(await store.outbox.compactedThrough?.(), 10);
      await store.commit({ deliveries: [{ ...delivery(13, [refs[0]!]), validator: "a".repeat(64), readTime: 0, clockPlanHash: "c".repeat(64) }],
        outbox: { put: [entry("unchanged", [refs[0]!], "committed", 14)] } });
      assert(await store.outbox.get("unchanged"), "an older identical image cannot discharge a later write");
      await store.close?.(); store = factory(); await store.open("dev:alice");
      await store.commit({ refreshes: [{ op: "view", args: {}, seq: 14, validator: "a".repeat(64) }] });
      assert.equal(await store.outbox.get("unchanged"), undefined, "unchanged refresh proves the exact held image through commit");
      const removed = entry("recreated", [{ ...refs[0]!, removed: true } as any], "committed", 15);
      await store.commit({ outbox: { put: [removed] } });
      assert(await store.outbox.get("recreated"), "the pre-removal positive image is insufficient");
      await store.commit({ deliveries: [delivery(16, [refs[0]!])] });
      assert.equal(await store.outbox.get("recreated"), undefined, "a newer authoritative recreation supersedes the removal");
      await store.commit({ outbox: { put: [entry("rejected", [], "rejected"), entry("expired", [], "expired"), entry("queued", [], "queued"), entry("empty", [])] } });
      assert.equal(await store.outbox.get("empty"), undefined, "actual empty write set needs no query observer");
      assert.deepEqual((await store.outbox.all()).map(e => e.intent).sort(), ["expired", "queued", "rejected"]);
      const hidden = entry("fanout", [{ table: "deliveries", id: "unseen" }]);
      await store.commit({ outbox: { put: [hidden] } });
      assert(await store.outbox.get("fanout"), "one displayed row is not proof of another observable effect");
      const replacement = entry("replacement", []); replacement.response.program.planHash = "f".repeat(64);
      await store.commit({ outbox: { put: [replacement] } });
      assert(await store.outbox.get("replacement"), "success under another program retains custody");
      for (let n = 20; n < 120; n++) {
        await store.commit({ outbox: { put: [entry(`online-${n}`, [refs[0]!], "committed", n)] }, deliveries: [delivery(n, [refs[0]!])] });
      }
      assert.equal((await store.outbox.all()).length, 5, "100 delivered successes leave no per-success markers");
      await store.close?.(); store = factory(); await store.open("dev:alice");
      assert.equal(await store.outbox.compactedThrough?.(), 119, "one durable watermark survives reopening");
      assert.equal((await store.outbox.all()).length, 5, "reopen cannot resurrect compacted drafts");
    } finally { await store.close?.(); await carrier.cleanup(); }
  }
});


test("compaction crash rollback preserves entries, aliases, and freshness on all carriers", async () => {
  for (const carrier of ["file", "IndexedDB", "SQLite"] as const) {
    const root = await tempRoot(); let crash = false;
    const before = () => { if (crash) { crash = false; throw new Error("compaction crash"); } };
    const database = new FakeIndexedDb(), locks = new FakeLocks();
    const factory = carrier === "file" ? fileRangeStore(root, { beforeRename: before }) : carrier === "SQLite"
      ? sqliteFactory(join(root, "state.db"), { beforeCommit: before })
      : indexedDbRangeStore({ indexedDB: database as never, locks: locks as never, beforeReplace: before });
    let store = factory(); let follower: Awaited<ReturnType<NonNullable<typeof store.inbox>>> | undefined;
    const program = { planHash: "a".repeat(64), schemaHash }, effects = [{ table: "messages", id: "m", removed: true as const }];
    const success: any = { intent: "remove", inbox: 1, grant: "g", offset: 0, count: 1, ids: [], op: "remove", args: {},
      issuedSeq: 9, createdAt: 1, updatedAt: 2, state: "committed", response: { state: "committed", seq: 10, data: null, program, effects } };
    const alias: any = { key: 1, kind: "mutation", scope: "test", principal: "dev:alice", followerId: "f", op: "remove", args: {},
      state: "queued", admitted: "remove", ids: [], createdAt: 1, updatedAt: 2 };
    try {
      await store.open("dev:alice");
      await store.commit({ facts: { generation, schemaHash, authEpoch: 7 }, programs: { [generation]: { generation, schemaHash, schema: { tables: {} },
        programs: { remove: { kind: "mutation", planHash: program.planHash, ir: {}, certificate: {} } } } },
        outbox: { put: [success] }, ...(carrier === "IndexedDB" ? { inbox: { put: [alias] } } : {}) });
      // A capped empty page and an unrelated high sequence do not witness removal.
      await store.commit({ deliveries: [{ op: "page", args: {}, state: "capped", data: [], next: "more", seq: 20,
        rows: [], receipt: { ranges: [], absences: [], verdicts: [] } }] });
      assert(await store.outbox.get("remove"));
      crash = true;
      await assert.rejects(store.commit({ tombstones: [{ table: "messages", id: "m", seq: 21 }] }), /compaction crash/);
      assert(await store.outbox.get("remove"), "in-memory journal rolls back failed deletion");
      assert.equal(await store.outbox.compactedThrough?.(), 0);
      await store.close?.(); store = factory(); await store.open("dev:alice");
      assert(await store.outbox.get("remove"), "pre-transaction entry survives crash/reopen");
      if (carrier === "IndexedDB") {
        follower = await store.inbox!("dev:alice");
        assert.equal((await follower.read()).rows.length, 1, "alias survives the same failed transaction");
      }
      await store.commit({ tombstones: [{ table: "messages", id: "m", seq: 21 }] });
      assert.equal(await store.outbox.get("remove"), undefined);
      if (follower) {
        const snapshot = await follower.read();
        assert.equal(snapshot.rows.length, 0); assert.deepEqual(snapshot.ledger, {});
        assert.equal(snapshot.compactedThrough, 10, "follower sees alias removal and watermark in one transaction");
      }
      assert.equal(await store.outbox.compactedThrough?.(), 10);
    } finally { follower?.close(); await store.close?.(); await rm(root, { recursive: true, force: true }); }
  }
});

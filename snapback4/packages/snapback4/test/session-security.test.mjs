import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultSessionStore,
  forgetSession,
  keepSession,
  localStorageSessionStore,
  memorySessionStore,
  restoreSession,
} from "../dist/auth.js";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { listEffects, mintSession, revokeSessions, runWorker } from "../dist/worker.js";

const session = (token, expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000) => ({ principal: "user:alice", kind: "user", token, expiresAt });
const auth = (init) => new Headers(init?.headers).get("authorization");
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const until = async (predicate, message) => {
  const deadline = Date.now() + 2_000;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(predicate(), message);
};

test("the default session store stays in memory and browser persistence is explicit", async () => {
  const calls = [];
  const values = new Map();
  const storage = {
    getItem(key) { calls.push(["get", key]); return values.get(key) ?? null; },
    setItem(key, value) { calls.push(["set", key, value]); values.set(key, value); },
    removeItem(key) { calls.push(["delete", key]); values.delete(key); },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  const url = `https://memory-${Date.now()}.invalid`;
  try {
    await keepSession(url, session("memory-token"), defaultSessionStore);
    assert.equal((await restoreSession(url, defaultSessionStore)).token, "memory-token");
    await forgetSession(url, defaultSessionStore);
    assert.deepEqual(calls, [], "the secure default never consults page-readable localStorage");

    const persistent = localStorageSessionStore(storage);
    await keepSession(url, session("persistent-token"), persistent);
    assert.equal((await restoreSession(url, persistent)).token, "persistent-token");
    await forgetSession(url, persistent);
    assert.deepEqual(calls.map(([op]) => op), ["set", "get", "delete"]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("the local client rotates near expiry and keeps every protected request on the current bearer", async () => {
  const base = "https://sessions.invalid";
  const backend = {
    generation: 1,
    schema: { tables: { remote: { columns: {}, indexes: {}, sync: null } } },
    programs: [{ name: "remote", kind: "Query", runs: "server", args: {}, body: [{ table: "remote" }] }],
    native: { digest: "native-one", jobs: [], reads: [] },
  };
  const requests = [];
  let refreshes = 0;
  let native = null;
  let changes = 0;
  let answerOldPoll;
  const held = new Set();
  const doFetch = async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ path: url.pathname, authorization: auth(init) });
    if (url.pathname === "/auth/refresh") {
      refreshes += 1;
      return Response.json({ session: session(`rotated-${refreshes}`, Date.now() + 7 * 24 * 60 * 60 * 1000) });
    }
    if (url.pathname === "/auth/logout-all") return Response.json({ ok: true, revoked: 3 });
    if (url.pathname === "/schema") return Response.json(backend);
    if (url.pathname === "/native.wasm") return new Response(new Uint8Array([0, 1, 2]));
    if (url.pathname === "/sync") return Response.json({ snapshot: false, events: [], watermark: 0, more: false, generation: 1, acknowledged: [] });
    if (url.pathname === "/q/remote") return Response.json({ data: "server", complete: true, seq: 0, tables: ["remote"], viewer: "user:alice" });
    if (url.pathname === "/changes") {
      changes += 1;
      if (changes === 1) return new Promise((resolve) => { answerOldPoll = () => resolve(Response.json({ denied: { code: "E_AUTH", family: "auth", message: "old token" } }, { status: 401 })); });
      return new Promise((resolve, reject) => {
        const stop = () => { held.delete(stop); reject(new DOMException("aborted", "AbortError")); };
        held.add(stop);
        init.signal?.addEventListener("abort", stop, { once: true });
      });
    }
    throw new Error(`unexpected request ${url.pathname}`);
  };
  const core = {
    async call(request) {
      switch (request.op) {
        case "sync_state": return { ok: { acquired: false, backend_required: false, store_id: null, watermark: 0, generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: [] } };
        case "state": return { ok: { watermark: 0, generation: 1, native } };
        case "backend": return { ok: backend };
        case "next_submission": return { ok: 1 };
        case "meta": return { ok: 0 };
        case "set_meta": return { ok: true };
        case "install_native": native = request.digest; return { ok: true };
        case "apply": return { ok: { touched: [] } };
        case "queued": return { ok: [] };
        case "query": return { ok: { loading: true, unknown: true, tables: ["remote"] } };
        default: return { ok: true };
      }
    },
    async close() {},
  };
  const store = memorySessionStore();
  const client = await createLocalClient({
    url: base,
    session: session("old-token", Date.now() + 1_000),
    sessionStore: store,
    device: { open: async () => core },
    fetch: doFetch,
    waitSeconds: 1,
  });
  assert.equal(client.session().token, "rotated-1", "a provided near-expiry session rotates before schema discovery");
  assert.equal((await restoreSession(base, store)).token, "rotated-1");
  await until(() => changes === 1, "the authenticated changes follower started");

  const observed = [];
  client.onSession((value) => observed.push(value?.token ?? null));
  const rotated = await client.refreshSession();
  assert.equal(rotated.ok, true);
  assert.equal(client.session().token, "rotated-2");
  assert.equal((await restoreSession(base, store)).token, "rotated-2");
  assert.deepEqual(observed, ["rotated-2"]);

  answerOldPoll();
  await until(() => changes >= 2, "the follower recovered with the replacement bearer");
  assert.equal(client.session().token, "rotated-2", "a delayed refusal for the invalidated token cannot end the replacement session");
  assert.equal((await client.query({ name: "remote" }, {})).data, "server");

  const revoked = await client.logoutAll();
  assert.deepEqual(revoked, { ok: true, revoked: 3 });
  assert.equal(client.session(), null);
  assert.equal(client.link(), "signed-out");
  assert.equal(await restoreSession(base, store), null);
  assert.deepEqual(observed, ["rotated-2", null]);

  const byPath = (path) => requests.filter((request) => request.path === path).map((request) => request.authorization);
  assert.deepEqual(byPath("/auth/refresh"), ["Bearer old-token", "Bearer rotated-1"]);
  for (const path of ["/schema", "/native.wasm"]) assert.deepEqual(byPath(path), ["Bearer rotated-1"]);
  assert.ok(byPath("/sync").includes("Bearer rotated-1"));
  assert.ok(byPath("/sync").includes("Bearer rotated-2"));
  assert.deepEqual(byPath("/changes").slice(0, 2), ["Bearer rotated-1", "Bearer rotated-2"]);
  assert.deepEqual(byPath("/q/remote"), ["Bearer rotated-2"]);
  assert.deepEqual(byPath("/auth/logout-all"), ["Bearer rotated-2"]);
  for (const stop of held) stop();
});

test("a stale-token mutation refusal remains durable and retries after rotation", async () => {
  const base = "https://rotating-write.invalid";
  const backend = {
    generation: 1,
    schema: { tables: {} },
    programs: [{ name: "send", kind: "Mutation", args: {}, body: [] }],
  };
  const queued = [];
  const oldReply = deferred();
  const newReply = deferred();
  const mutationBearers = [];
  let settlements = 0;
  let admittedId;
  const doFetch = async (input, init = {}) => {
    const path = new URL(input).pathname;
    if (path === "/schema") return Response.json(backend);
    if (path === "/sync") return Response.json({ snapshot: false, events: [], watermark: 0, more: false, generation: 1, acknowledged: [], store_id: "kept-store" });
    if (path === "/changes") return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    if (path === "/auth/refresh") {
      assert.equal(auth(init), "Bearer token-zero");
      return Response.json({ session: session("token-one") });
    }
    if (path === "/m/send") {
      assert.equal(JSON.parse(init.body).store_id, "kept-store");
      mutationBearers.push(auth(init));
      if (mutationBearers.length === 1) {
        await oldReply.promise;
        return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "rotated token" } }, { status: 401 });
      }
      await newReply.promise;
      return Response.json({ state: "sent", id: queued[0].id, seq: 9, result: { saved: true } });
    }
    throw new Error(`unexpected request ${path}`);
  };
  const core = {
    async call(request) {
      switch (request.op) {
        case "sync_state": return { ok: { acquired: false, backend_required: false, store_id: "kept-store", watermark: 0, generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: queued.map((entry) => entry.id) } };
        case "state": return { ok: { watermark: 0, generation: 1, native: null } };
        case "backend": return { ok: backend };
        case "next_submission": return { ok: 1 };
        case "meta": return { ok: 0 };
        case "set_meta": return { ok: true };
        case "apply": return { ok: { touched: [] } };
        case "admit": admittedId = request.entry.id; queued.push(request.entry); return { ok: request.entry };
        case "queued": return { ok: queued };
        case "query": return { ok: { loading: true, unknown: true, tables: ["remote"] } };
        case "begin_send": return { ok: { send_revision: 1 } };
        case "settle": settlements += 1; queued.splice(0, 1); return { ok: null };
        default: return { ok: true };
      }
    },
    async close() {},
  };
  const client = await createLocalClient({
    url: base,
    session: session("token-zero"),
    device: { open: async () => core },
    fetch: doFetch,
    waitSeconds: 1,
  });
  try {
    const terminal = [];
    client.onWrite((write) => terminal.push(write));
    const writing = client.mutate({ name: "send" }, { body: "once" });
    await until(() => mutationBearers.length === 1, "the old-bearer mutation did not enter the transport");
    const refreshing = client.refreshSession();
    await until(() => client.session()?.token === "token-one", "the replacement session did not become active");
    oldReply.resolve();
    assert.equal((await refreshing).ok, true);
    await until(() => mutationBearers.length === 2, "the stale refusal permanently dropped the durable write");
    assert.deepEqual(mutationBearers, ["Bearer token-zero", "Bearer token-one"]);
    assert.equal(queued.length, 1, "an obsolete refusal must not remove the outbox entry");
    assert.equal(settlements, 0, "an obsolete refusal must not settle the outbox entry");
    assert.deepEqual(terminal, [], "an obsolete refusal is not a terminal write outcome");
    newReply.resolve();
    assert.deepEqual(await writing, { state: "sent", id: admittedId, seq: 9, result: { saved: true } });
    assert.equal(queued.length, 0);
    assert.equal(settlements, 1);
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].state, "sent");
  } finally {
    await client.close();
  }
});

test("an online-only watch retries a stale-token refusal after rotation", async () => {
  const base = "https://rotating-watch.invalid";
  const backend = {
    generation: 1,
    schema: { tables: { remote: { columns: {}, indexes: {}, sync: null } } },
    programs: [{ name: "remote", kind: "Query", runs: "server", args: {}, body: [{ table: "remote" }] }],
  };
  const oldReply = deferred();
  const queryBearers = [];
  const doFetch = async (input, init = {}) => {
    const path = new URL(input).pathname;
    if (path === "/schema") return Response.json(backend);
    if (path === "/sync") return Response.json({ snapshot: false, events: [], watermark: 0, more: false, generation: 1, acknowledged: [] });
    if (path === "/changes") return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    if (path === "/auth/refresh") return Response.json({ session: session("token-one") });
    if (path === "/q/remote") {
      queryBearers.push(auth(init));
      if (queryBearers.length === 1) {
        await oldReply.promise;
        return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "rotated token" } }, { status: 401 });
      }
      return Response.json({ data: "current", complete: true, seq: 0, tables: ["remote"], viewer: "user:alice" });
    }
    throw new Error(`unexpected request ${path}`);
  };
  const core = {
    async call(request) {
      switch (request.op) {
        case "sync_state": return { ok: { acquired: false, backend_required: false, store_id: null, watermark: 0, generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: [] } };
        case "state": return { ok: { watermark: 0, generation: 1, native: null } };
        case "backend": return { ok: backend };
        case "next_submission": return { ok: 1 };
        case "meta": return { ok: 0 };
        case "set_meta": return { ok: true };
        case "apply": return { ok: { touched: [] } };
        case "queued": return { ok: [] };
        case "query": return { ok: { loading: true, unknown: true, tables: ["remote"] } };
        default: return { ok: true };
      }
    },
    async close() {},
  };
  const client = await createLocalClient({
    url: base,
    session: session("token-zero"),
    device: { open: async () => core },
    fetch: doFetch,
    waitSeconds: 1,
  });
  try {
    const snapshots = [];
    const watch = client.observe({ name: "remote" }, {});
    const unsubscribe = watch.subscribe(() => snapshots.push(watch.getSnapshot()));
    await until(() => queryBearers.length === 1, "the old-bearer watch did not enter the transport");
    assert.equal((await client.refreshSession()).ok, true);
    assert.equal(client.session()?.token, "token-one");
    oldReply.resolve();
    await until(() => watch.getSnapshot().data === "current", "the watch remained denied after credential rotation");
    assert.equal(queryBearers[0], "Bearer token-zero");
    assert.ok(queryBearers.length >= 2);
    assert.ok(queryBearers.slice(1).every((bearer) => bearer === "Bearer token-one"));
    assert.equal(snapshots.some((snapshot) => snapshot.denied?.code === "E_AUTH"), false, "an obsolete refusal must not become the live snapshot");
    unsubscribe();
    watch.close();
  } finally {
    await client.close();
  }
});

test("a current-token sign-out cannot reclassify a stale write refusal", async () => {
  const base = "https://concurrent-signout.invalid";
  const backend = {
    generation: 1,
    schema: { tables: { remote: { columns: {}, indexes: {}, sync: null } } },
    programs: [
      { name: "send", kind: "Mutation", args: {}, body: [] },
      { name: "remote", kind: "Query", runs: "server", args: {}, body: [{ table: "remote" }] },
    ],
  };
  const queued = [];
  const oldReply = deferred();
  let oldMutationEntered = false;
  let settlements = 0;
  const doFetch = async (input, init = {}) => {
    const path = new URL(input).pathname;
    if (path === "/schema") return Response.json(backend);
    if (path === "/sync") return Response.json({ snapshot: false, events: [], watermark: 0, more: false, generation: 1, acknowledged: [], store_id: "kept-store" });
    if (path === "/changes") return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
    if (path === "/auth/refresh") {
      assert.equal(auth(init), "Bearer token-zero");
      return Response.json({ session: session("token-one") });
    }
    if (path === "/m/send") {
      assert.equal(JSON.parse(init.body).store_id, "kept-store");
      assert.equal(auth(init), "Bearer token-zero");
      oldMutationEntered = true;
      await oldReply.promise;
      return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "rotated token" } }, { status: 401 });
    }
    if (path === "/q/remote") {
      assert.equal(auth(init), "Bearer token-one");
      return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "current token revoked" } }, { status: 401 });
    }
    throw new Error(`unexpected request ${path}`);
  };
  const core = {
    async call(request) {
      switch (request.op) {
        case "sync_state": return { ok: { acquired: false, backend_required: false, store_id: "kept-store", watermark: 0, generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: queued.map((entry) => entry.id) } };
        case "state": return { ok: { watermark: 0, generation: 1, native: null } };
        case "backend": return { ok: backend };
        case "next_submission": return { ok: 1 };
        case "meta": return { ok: 0 };
        case "set_meta": return { ok: true };
        case "apply": return { ok: { touched: [] } };
        case "admit": queued.push(request.entry); return { ok: request.entry };
        case "queued": return { ok: queued };
        case "query": return { ok: { loading: true, unknown: true, tables: ["remote"] } };
        case "begin_send": return { ok: { send_revision: 1 } };
        case "settle": settlements += 1; queued.splice(0, 1); return { ok: null };
        default: return { ok: true };
      }
    },
    async close() {},
  };
  const client = await createLocalClient({
    url: base,
    session: session("token-zero"),
    device: { open: async () => core },
    fetch: doFetch,
    waitSeconds: 1,
  });
  let closed = false;
  try {
    const terminal = [];
    client.onWrite((write) => terminal.push(write));
    const writing = client.mutate({ name: "send" }, { body: "once" });
    await until(() => oldMutationEntered, "the old-bearer mutation did not enter the transport");
    const refreshing = client.refreshSession();
    await until(() => client.session()?.token === "token-one", "the replacement session did not become active");
    const refused = await client.query({ name: "remote" }, {});
    assert.equal(refused.denied?.code, "E_AUTH", "the current bearer refusal remains authoritative");
    assert.equal(client.session(), null);
    assert.equal(client.link(), "signed-out");
    oldReply.resolve();
    await refreshing;
    await client.close();
    closed = true;
    assert.equal(settlements, 0, "the stale response must not settle the durable outbox entry");
    assert.equal(queued.length, 1, "the stale write remains durable after concurrent sign-out");
    assert.deepEqual(terminal, []);
    assert.equal((await writing).state, "pending");
  } finally {
    oldReply.resolve();
    if (!closed) await client.close();
  }
});

test("an authenticated change-feed refusal signs the online client out", async () => {
  let changes = 0;
  const client = createClient({
    url: "https://online.invalid",
    session: session("online-token"),
    waitSeconds: 1,
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      assert.equal(auth(init), "Bearer online-token");
      if (path === "/q/read") return Response.json({ data: 1, complete: true, seq: 0, tables: ["items"], viewer: "user:alice" });
      if (path === "/changes") {
        changes += 1;
        return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "session ended" } }, { status: 401 });
      }
      throw new Error(`unexpected request ${path}`);
    },
  });
  const observed = client.observe({ name: "read" }, {});
  await until(() => changes === 1 && client.link() === "signed-out", "the protected change feed ended the client session");
  assert.equal(client.viewer(), null);
  assert.equal(observed.getSnapshot().denied?.code, "E_AUTH");
  await client.close();
});

test("worker, effect inspection, and service-session calls always carry the service bearer", async () => {
  const token = "service-secret";
  const requests = [];
  const stop = new AbortController();
  const doFetch = async (input, init = {}) => {
    const path = new URL(input).pathname;
    requests.push({ path, authorization: auth(init) });
    if (path === "/effects/claim") {
      stop.abort();
      return Response.json({ effects: [] });
    }
    if (path === "/effects") return Response.json({ effects: [] });
    if (path === "/auth/session") return Response.json({ session: { principal: "member:42", kind: "member", token: "member-token", expiresAt: Date.now() + 60_000 } });
    if (path === "/auth/revoke") return Response.json({ revoked: 2 });
    throw new Error(`unexpected request ${path}`);
  };
  await listEffects(baseFor("effects"), token, "queued", doFetch);
  await mintSession(baseFor("effects"), token, "member:42", "member", undefined, doFetch);
  await revokeSessions(baseFor("effects"), token, "member:42", doFetch);
  await runWorker({ url: baseFor("effects"), token, effects: { notify: () => null }, signal: stop.signal, fetch: doFetch }).done;
  assert.deepEqual(requests.map(({ path }) => path), ["/effects", "/auth/session", "/auth/revoke", "/effects/claim"]);
  assert.ok(requests.every(({ authorization }) => authorization === `Bearer ${token}`));
});

function baseFor(name) {
  return `https://${name}.invalid`;
}

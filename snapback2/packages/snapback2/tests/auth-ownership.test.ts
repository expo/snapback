import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  SnapbackRefusal,
  api,
  browserTokenStore,
  createClient,
  type AuthTokenStore,
} from "../dist/client.mjs";
import { SnapbackProvider, useAuth, useQuery, type UseAuthResult } from "../dist/react.mjs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: unknown): void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function refusal(code: string, message = code): Record<string, string> {
  return { code, family: "auth", message, guide: "auth/session" };
}

function hangingSse(value?: unknown, onCancel?: () => void): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      if (value !== undefined) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      }
    },
    cancel() {
      onCancel?.();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function pathOf(input: string | URL | Request): string {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
}

function bearer(init?: RequestInit): string | null {
  return new Headers(init?.headers).get("Authorization");
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${message}`);
    await flush();
  }
}

function isCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof SnapbackRefusal && error.code === code;
}

test("browser token custody is explicit and no storage is selected by default", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let implicitReads = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      implicitReads += 1;
      throw new Error("implicit localStorage access");
    },
  });
  try {
    const value = createClient({
      url: "http://auth.test",
      fetch: async () => json({ state: "complete", data: [], seq: 1 }),
    });
    await value.ready;
    assert.equal(implicitReads, 0);
    assert.equal(value.snapshot.token, undefined);
    assert.equal(value.snapshot.authGeneration, 1);
    value.close();
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }

  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const store = browserTokenStore(storage, "auth-key");
  await store.save("token-a");
  assert.equal(await store.load(), "token-a");
  await store.save(null);
  assert.equal(await store.load(), null);
});

test("ready blocks every data transport until explicit token restore settles", async () => {
  const restored = deferred<string | null>();
  const requests: Array<{ path: string; bearer: string | null }> = [];
  const value = createClient({
    url: "http://auth.test",
    tokenStore: { load: () => restored.promise, save: () => undefined },
    fetch: async (input, init) => {
      const path = pathOf(input);
      requests.push({ path, bearer: bearer(init) });
      if (path === "/api/query") return json({ state: "complete", data: ["query"], seq: 1 });
      if (path === "/api/mutation") return json({ state: "committed", data: "mutation", seq: 2 });
      if (path === "/api/auth/me") return json({ viewer: "principal-a", kind: "account" });
      if (path.endsWith("/publish")) return json({ ok: true });
      if (path === "/api/subscribe") {
        return hangingSse({ state: "complete", data: ["live"], seq: 3 });
      }
      if (path.endsWith("/subscribe")) {
        return hangingSse({ from: "principal-a", payload: { typing: true }, at: 4 });
      }
      throw new Error(`unexpected path ${path}`);
    },
  });

  const query = value.query(api.messages.thread, {});
  const mutation = value.mutation(api.messages.send, {});
  const querySubscription = value.subscribe(api.messages.thread, {}, () => undefined);
  const queryDelivery = querySubscription.until((event) => event.state === "complete");
  const channel = value.channel(api.typing, {});
  const publish = channel.publish({ typing: true });
  const channelSubscription = channel.subscribe(() => undefined);
  const channelDelivery = channelSubscription.until((event) => "payload" in event);
  const me = value.auth.me();

  await flush();
  await flush();
  assert.deepEqual(requests, []);

  restored.resolve("restored-token");
  await value.ready;
  await Promise.all([query, mutation, queryDelivery, publish, channelDelivery, me]);
  assert.equal(requests.length, 6);
  assert.ok(requests.every((request) => request.bearer === "Bearer restored-token"), requests);
  querySubscription.close();
  channelSubscription.close();
  value.close();
});

test("a relaunched client restores the explicitly stored bearer", async () => {
  let stored: string | null = null;
  const store: AuthTokenStore = {
    load: () => stored,
    save: (token) => { stored = token; },
  };
  const first = createClient({
    url: "http://auth.test",
    tokenStore: store,
    fetch: async (input) => {
      assert.equal(pathOf(input), "/api/auth/guest");
      return json({ token: "restart-token", viewer: "principal-a" });
    },
  });
  await first.auth.guest();
  assert.equal(stored, "restart-token");
  first.close();

  let restoredBearer: string | null = null;
  const second = createClient({
    url: "http://auth.test",
    tokenStore: store,
    fetch: async (_input, init) => {
      restoredBearer = bearer(init);
      return json({ state: "complete", data: ["restored"], seq: 1 });
    },
  });
  const result = await second.query(api.messages.thread, {});
  assert.equal(result.state, "complete");
  assert.equal(restoredBearer, "Bearer restart-token");
  assert.equal(second.snapshot.token, "restart-token");
  second.close();
});

test("principal replacement fences streams, suppresses delayed old reads, and waits for persistence", async () => {
  const oldResponse = deferred<Response>();
  const savedNew = deferred<void>();
  const requests: Array<{ path: string; bearer: string | null }> = [];
  let cancellations = 0;
  let queryCount = 0;
  const value = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => "old-token",
      save: (token) => token === "new-token" ? savedNew.promise : undefined,
    },
    fetch: async (input, init) => {
      const path = pathOf(input);
      requests.push({ path, bearer: bearer(init) });
      if (path === "/api/subscribe" || path.endsWith("/subscribe")) {
        return hangingSse(undefined, () => { cancellations += 1; });
      }
      if (path === "/api/query") {
        queryCount += 1;
        return queryCount === 1
          ? oldResponse.promise
          : json({ state: "complete", data: ["new"], seq: 2 });
      }
      if (path === "/api/auth/login") {
        return json({ token: "new-token", viewer: "principal-new" });
      }
      throw new Error(`unexpected path ${path}`);
    },
  });
  await value.ready;
  const oldGeneration = value.snapshot.authGeneration;
  const querySubscription = value.subscribe(api.messages.thread, {}, () => undefined);
  const channelSubscription = value.channel(api.typing, {}).subscribe(() => undefined);
  await waitFor(() => requests.filter((request) => request.path.endsWith("/subscribe")).length === 2, "old streams");
  const oldQuery = value.query(api.messages.thread, {});
  await waitFor(() => queryCount === 1, "old query");

  const login = value.auth.login({ email: "new@example.com", password: "password" });
  const queuedQuery = value.query(api.messages.thread, {});
  await waitFor(() => requests.some((request) => request.path === "/api/auth/login"), "login request");
  await waitFor(() => cancellations === 2, "old stream cancellation");
  await flush();
  assert.equal(queryCount, 1, "queued query must stay behind the auth transition");
  assert.equal(value.snapshot.token, "old-token");
  assert.equal(value.snapshot.authGeneration, oldGeneration);

  savedNew.resolve();
  const session = await login;
  assert.equal(session.token, "new-token");
  assert.equal(value.snapshot.token, "new-token");
  assert.equal(value.snapshot.authGeneration, oldGeneration + 1);
  assert.equal((await queuedQuery).state, "complete");
  oldResponse.resolve(json({ state: "complete", data: ["old"], seq: 1 }));
  await assert.rejects(oldQuery, isCode("E_AUTH_SUPERSEDED"));

  const queryBearers = requests
    .filter((request) => request.path === "/api/query")
    .map((request) => request.bearer);
  assert.deepEqual(queryBearers, ["Bearer old-token", "Bearer new-token"]);
  querySubscription.close();
  channelSubscription.close();
  value.close();
});

test("auth transitions serialize and already-dispatched writes settle before replacement", async () => {
  const mutationResponse = deferred<Response>();
  const loginResponse = deferred<Response>();
  const firstSave = deferred<void>();
  const paths: string[] = [];
  const bearers: Array<string | null> = [];
  const value = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => "old-token",
      save: (token) => token === "token-a" ? firstSave.promise : undefined,
    },
    fetch: async (input, init) => {
      const path = pathOf(input);
      paths.push(path);
      bearers.push(bearer(init));
      if (path === "/api/mutation") return mutationResponse.promise;
      if (path === "/api/auth/login") return loginResponse.promise;
      if (path === "/api/auth/guest") return json({ token: "token-b", viewer: "principal-b" });
      throw new Error(`unexpected path ${path}`);
    },
  });
  await value.ready;
  const mutation = value.mutation(api.messages.send, {});
  await waitFor(() => paths.includes("/api/mutation"), "mutation dispatch");
  const login = value.auth.login({ email: "a@example.com", password: "password" });
  const guest = value.auth.guest();
  await flush();
  assert.deepEqual(paths, ["/api/mutation"]);

  mutationResponse.resolve(json({ state: "committed", data: { id: "message-1" }, seq: 1 }));
  await assert.rejects(mutation, isCode("E_AUTH_SUPERSEDED"));
  await waitFor(() => paths.includes("/api/auth/login"), "login after write settlement");
  assert.equal(paths.includes("/api/auth/guest"), false);
  loginResponse.resolve(json({ token: "token-a", viewer: "principal-a" }));
  await flush();
  assert.equal(paths.includes("/api/auth/guest"), false, "persistence is part of login settlement");
  firstSave.resolve();
  await login;
  await guest;
  assert.deepEqual(paths, ["/api/mutation", "/api/auth/login", "/api/auth/guest"]);
  assert.deepEqual(bearers, ["Bearer old-token", "Bearer old-token", "Bearer token-a"]);
  assert.equal(value.snapshot.token, "token-b");
  value.close();
});

test("logout and terminal session expiry clear custody and stop old-bearer reconnect", async () => {
  let stored: string | null = "logout-token";
  const clear = deferred<void>();
  let cancelled = 0;
  const logoutClient = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => stored,
      save: async (token) => {
        if (token === null) await clear.promise;
        stored = token;
      },
    },
    fetch: async (input) => pathOf(input) === "/api/auth/logout"
      ? json({ ok: true })
      : hangingSse(undefined, () => { cancelled += 1; }),
  });
  await logoutClient.ready;
  const generation = logoutClient.snapshot.authGeneration;
  logoutClient.subscribe(api.messages.thread, {}, () => undefined);
  await flush();
  const logout = logoutClient.auth.logout();
  await waitFor(() => cancelled === 1, "logout stream cancellation");
  await flush();
  assert.equal(logoutClient.snapshot.token, "logout-token");
  clear.resolve();
  assert.equal((await logout).ok, true);
  assert.equal(stored, null);
  assert.equal(logoutClient.snapshot.token, undefined);
  assert.equal(logoutClient.snapshot.authGeneration, generation + 1);
  logoutClient.close();

  stored = "expired-token";
  const expiryClear = deferred<void>();
  const delivered = deferred<unknown>();
  let opens = 0;
  const expiredClient = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => stored,
      save: async (token) => {
        if (token === null) await expiryClear.promise;
        stored = token;
      },
    },
    fetch: async (_input, init) => {
      opens += 1;
      assert.equal(bearer(init), "Bearer expired-token");
      return hangingSse({ state: "refused", ...refusal("E_AUTH_SESSION", "expired") });
    },
  });
  await expiredClient.ready;
  const subscription = expiredClient.subscribe(api.messages.thread, {}, (event) => delivered.resolve(event));
  const terminal = subscription.until(() => true);
  await waitFor(() => opens === 1, "expired stream open");
  await flush();
  assert.equal(expiredClient.snapshot.token, "expired-token");
  expiryClear.resolve();
  assert.deepEqual(await delivered.promise, {
    state: "refused",
    live: false,
    ...refusal("E_AUTH_SESSION", "expired"),
  });
  await assert.rejects(terminal, isCode("E_AUTH_SESSION"));
  assert.equal(stored, null);
  assert.equal(expiredClient.snapshot.token, undefined);
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  assert.equal(opens, 1, "terminal expiry must not reconnect the old bearer");
  subscription.close();
  expiredClient.close();
});

test("terminal expiry remains terminal when persisted custody cannot be cleared", async () => {
  const delivered = deferred<unknown>();
  let opens = 0;
  const value = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => "expired-token",
      save: (token) => {
        if (token === null) throw new Error("storage unavailable");
      },
    },
    fetch: async () => {
      opens += 1;
      return hangingSse({ state: "refused", ...refusal("E_AUTH_SESSION", "expired") });
    },
  });
  await value.ready;
  const subscription = value.subscribe(api.messages.thread, {}, (event) => delivered.resolve(event));
  const terminal = subscription.until(() => true);
  assert.deepEqual(await delivered.promise, {
    state: "refused",
    code: "E_AUTH_TOKEN_STORE",
    family: "auth",
    message: "token store clear failed: storage unavailable",
    guide: "auth/session",
    live: false,
  });
  await assert.rejects(terminal, isCode("E_AUTH_TOKEN_STORE"));
  assert.equal(value.snapshot.token, undefined, "memory custody is cleared even when persistence rejects");
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  assert.equal(opens, 1);
  subscription.close();
  value.close();
});

test("React query identity moves to a hydrating auth-generation partition", async () => {
  const nextQuery = deferred<Response>();
  const views: Array<{ auth: string; token?: string; query: string; data?: unknown }> = [];
  let auth!: UseAuthResult;
  let newQueryStarted = false;
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = pathOf(input);
    if (path === "/api/manifest") {
      return json({ generation: "g1", ops: {}, channels: {}, auth: {} });
    }
    if (path === "/api/auth/me") {
      const viewer = bearer(init) === "Bearer new-token" ? "principal-new" : "principal-old";
      return json({ viewer, kind: "account" });
    }
    if (path === "/api/auth/login") {
      return json({ token: "new-token", viewer: "principal-new" });
    }
    if (path === "/api/query") {
      if (bearer(init) === "Bearer new-token") {
        newQueryStarted = true;
        return nextQuery.promise;
      }
      return json({ state: "complete", data: "old-private", seq: 1 });
    }
    throw new Error(`unexpected path ${path}`);
  };

  function Probe(): React.ReactElement {
    auth = useAuth();
    const query = useQuery(api.private.current, {}, { live: false });
    views.push({
      auth: auth.state,
      ...(auth.token === undefined ? {} : { token: auth.token }),
      query: query.state,
      ...(query.state === "complete" ? { data: query.data } : {}),
    });
    return React.createElement("output", null, `${auth.state}:${query.state}`);
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://auth.test", token: "old-token", fetch },
      React.createElement(Probe),
    ));
    await flush();
    await flush();
  });
  await waitFor(
    () => views.some((view) => view.query === "complete" && view.data === "old-private"),
    "old React query",
  );

  await act(async () => {
    await auth.login({ email: "new@example.com", password: "password" });
    await flush();
  });
  assert.equal(newQueryStarted, true);
  const successorViews = views.filter((view) => view.token === "new-token");
  assert.ok(successorViews.length > 0);
  assert.equal(successorViews[0]?.query, "hydrating");
  assert.equal(successorViews.some((view) => view.data === "old-private"), false);

  nextQuery.resolve(json({ state: "complete", data: "new-private", seq: 2 }));
  await act(async () => {
    await flush();
    await flush();
  });
  assert.equal(views.at(-1)?.data, "new-private");
  await act(async () => { renderer.unmount(); });
});

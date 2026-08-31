// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test —
// custody transitions serialize persistence, transports, delayed responses,
// and React cache identity around one explicit authority owner.
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

interface DelayedJsonResponse {
  response: Response;
  started: Promise<void>;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

function delayedJson(status = 200): DelayedJsonResponse {
  const body = deferred<unknown>();
  const started = deferred<void>();
  return {
    response: {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        started.resolve();
        return body.promise;
      },
    } as Response,
    started: started.promise,
    resolve: body.resolve,
    reject: body.reject,
  };
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
  const otherBackend = browserTokenStore(storage, "other-backend-auth-key");
  await store.save("token-a");
  assert.equal(await store.load(), "token-a");
  assert.equal(await otherBackend.load(), null);
  await store.save(null);
  assert.equal(await store.load(), null);
  assert.throws(
    () => browserTokenStore(storage, undefined as unknown as string),
    /non-empty key/,
  );
});

test("dev personas cannot be combined with bearer custody", () => {
  assert.throws(
    () => createClient({ url: "http://auth.test", as: "alice", token: "token-a" } as any),
    /cannot combine dev persona/,
  );
  assert.throws(
    () => createClient({
      url: "http://auth.test",
      as: "alice",
      tokenStore: { load: () => "token-a", save: () => undefined },
    } as any),
    /cannot combine dev persona/,
  );
});

test("SnapbackProvider rejects a runtime persona and bearer combination", async () => {
  await assert.rejects(
    async () => {
      await act(async () => {
        TestRenderer.create(React.createElement(
          SnapbackProvider,
          { url: "http://auth.test", as: "alice", token: "token-a" } as any,
          React.createElement("output"),
        ));
        await flush();
      });
    },
    /cannot combine dev persona/,
  );
});

test("an invalid explicit bearer cannot poison persistent custody", async () => {
  let stored: string | null = null;
  let saves = 0;
  const tokenStore = {
    load: () => stored,
    save: (token: string | null) => {
      saves += 1;
      stored = token;
    },
  };
  const invalid = createClient({
    url: "http://auth.test",
    token: "",
    tokenStore,
    fetch: async () => json({}),
  } as any);
  await assert.rejects(invalid.ready, isCode("E_AUTH_TOKEN_STORE"));
  assert.equal(saves, 0);
  assert.equal(stored, null);
  invalid.close();

  const relaunched = createClient({
    url: "http://auth.test",
    tokenStore,
    fetch: async () => json({}),
  });
  await relaunched.ready;
  assert.equal(relaunched.snapshot.token, undefined);
  relaunched.close();
});

test("dev persona clients refuse bearer-session transitions without sending a request", async () => {
  let requests = 0;
  const value = createClient({
    url: "http://auth.test",
    as: "alice",
    fetch: async () => {
      requests += 1;
      return json({});
    },
  });
  await value.ready;
  const generation = value.snapshot.authGeneration;
  await assert.rejects(() => value.auth.signup({ email: "a@example.com", password: "password" }), isCode("E_AUTH_PERSONA_TRANSITION"));
  await assert.rejects(() => value.auth.login({ email: "a@example.com", password: "password" }), isCode("E_AUTH_PERSONA_TRANSITION"));
  await assert.rejects(() => value.auth.guest(), isCode("E_AUTH_PERSONA_TRANSITION"));
  await assert.rejects(() => value.auth.logout(), isCode("E_AUTH_PERSONA_TRANSITION"));
  assert.equal(requests, 0);
  assert.equal(value.snapshot.token, undefined);
  assert.equal(value.snapshot.authGeneration, generation);
  assert.equal(value.snapshot.lastRefusal?.code, "E_AUTH_PERSONA_TRANSITION");
  value.close();
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

test("delayed malformed response bodies cannot overwrite newer auth custody", async () => {
  const cases = [
    { name: "malformed 2xx", status: 200, settle: (gate: DelayedJsonResponse) => gate.reject(new SyntaxError("bad json")) },
    { name: "malformed terminal 2xx", status: 200, settle: (gate: DelayedJsonResponse) => gate.resolve({ state: "rejected", code: "E_AUTH_SESSION" }) },
    { name: "malformed 4xx", status: 401, settle: (gate: DelayedJsonResponse) => gate.reject(new SyntaxError("bad json")) },
    { name: "non-envelope 4xx", status: 401, settle: (gate: DelayedJsonResponse) => gate.resolve({ nope: true }) },
  ];
  for (const transition of ["login", "logout"] as const) {
    for (const scenario of cases) {
      const gate = delayedJson(scenario.status);
      const value = createClient({
        url: "http://auth.test",
        token: "old-token",
        fetch: async (input) => {
          const requestPath = pathOf(input);
          if (requestPath === "/api/query") return gate.response;
          if (requestPath === "/api/auth/login") {
            return json({ token: "new-token", viewer: "principal-new" });
          }
          if (requestPath === "/api/auth/logout") return json({ ok: true });
          throw new Error(`unexpected path ${requestPath}`);
        },
      });
      await value.ready;
      const query = value.query(api.messages.thread, {});
      await gate.started;
      if (transition === "login") {
        await value.auth.login({ email: "new@example.com", password: "password" });
      } else {
        await value.auth.logout();
      }
      scenario.settle(gate);
      await assert.rejects(query, isCode("E_AUTH_SUPERSEDED"), `${transition}: ${scenario.name}`);
      assert.equal(value.snapshot.token, transition === "login" ? "new-token" : undefined, scenario.name);
      assert.equal(value.snapshot.connection, "connected", scenario.name);
      assert.equal(value.snapshot.lastRefusal, undefined, scenario.name);
      value.close();
    }
  }
});

test("delayed malformed response bodies cannot mutate a closed client", async () => {
  const cases = [
    { name: "malformed 2xx", status: 200, settle: (gate: DelayedJsonResponse) => gate.reject(new SyntaxError("bad json")) },
    { name: "malformed terminal 2xx", status: 200, settle: (gate: DelayedJsonResponse) => gate.resolve({ state: "refused", code: "E_AUTH_SESSION" }) },
    { name: "malformed 4xx", status: 401, settle: (gate: DelayedJsonResponse) => gate.reject(new SyntaxError("bad json")) },
    { name: "non-envelope 4xx", status: 401, settle: (gate: DelayedJsonResponse) => gate.resolve({ nope: true }) },
  ];
  for (const scenario of cases) {
    const gate = delayedJson(scenario.status);
    const value = createClient({
      url: "http://auth.test",
      fetch: async () => gate.response,
    });
    await value.ready;
    const query = value.query(api.messages.thread, {});
    await gate.started;
    value.close();
    scenario.settle(gate);
    await assert.rejects(query, isCode("E_AUTH_SUPERSEDED"), scenario.name);
    assert.equal(value.snapshot.connection, "offline", scenario.name);
    assert.equal(value.snapshot.lastRefusal, undefined, scenario.name);
  }
});

test("delayed subscription opens cannot mutate a closed client", async () => {
  const response = deferred<Response>();
  let started = false;
  const value = createClient({
    url: "http://auth.test",
    fetch: async () => {
      started = true;
      return response.promise;
    },
  });
  await value.ready;
  const subscription = value.subscribe(api.messages.thread, {}, () => undefined);
  await waitFor(() => started, "subscription open");
  value.close();
  response.resolve(hangingSse());
  await flush();
  await flush();
  assert.equal(value.snapshot.connection, "offline");
  assert.equal(value.snapshot.lastRefusal, undefined);
  subscription.close();
});

test("delayed subscription opens cannot mutate an individually closed subscription", async () => {
  const response = deferred<Response>();
  let started = false;
  const value = createClient({
    url: "http://auth.test",
    fetch: async () => {
      started = true;
      return response.promise;
    },
  });
  await value.ready;
  const subscription = value.subscribe(api.messages.thread, {}, () => undefined);
  await waitFor(() => started, "subscription open");
  subscription.close();
  response.resolve(hangingSse());
  await flush();
  await flush();
  assert.equal(value.snapshot.connection, "reconnecting");
  assert.equal(value.snapshot.lastRefusal, undefined);
  value.close();
});

test("delayed malformed subscription refusals cannot pollute a newer bearer", async () => {
  const response = delayedJson(401);
  const value = createClient({
    url: "http://auth.test",
    token: "old-token",
    fetch: async (input) => {
      const requestPath = pathOf(input);
      if (requestPath.endsWith("/subscribe")) return response.response;
      if (requestPath === "/api/auth/login") {
        return json({ token: "new-token", viewer: "principal-new" });
      }
      throw new Error(`unexpected path ${requestPath}`);
    },
  });
  await value.ready;
  const subscription = value.subscribe(api.messages.thread, {}, () => undefined);
  await response.started;
  await value.auth.login({ email: "new@example.com", password: "password" });
  response.resolve({ code: "E_AUTH_SESSION" });
  await flush();
  await flush();
  assert.equal(value.snapshot.token, "new-token");
  assert.equal(value.snapshot.connection, "connected");
  assert.equal(value.snapshot.lastRefusal, undefined);
  subscription.close();
  value.close();
});

test("a delayed valid subscription expiry clears custody after a failed replacement", async () => {
  const response = delayedJson(401);
  let stored: string | null = "expired-token";
  const value = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => stored,
      save: (token) => { stored = token; },
    },
    fetch: async (input) => {
      const requestPath = pathOf(input);
      if (requestPath.endsWith("/subscribe")) return response.response;
      if (requestPath === "/api/auth/login") return json(refusal("E_AUTH_INVALID"), 401);
      throw new Error(`unexpected path ${requestPath}`);
    },
  });
  await value.ready;
  const subscription = value.subscribe(api.messages.thread, {}, () => undefined);
  await response.started;
  await assert.rejects(
    value.auth.login({ email: "new@example.com", password: "wrong-password" }),
    isCode("E_AUTH_INVALID"),
  );
  response.resolve({ state: "refused", ...refusal("E_AUTH_SESSION") });
  await waitFor(() => stored === null, "expired subscription custody clear");
  assert.equal(value.snapshot.token, undefined);
  subscription.close();
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

test("a delayed terminal write clears the old bearer before a failed replacement", async () => {
  const mutationResponse = deferred<Response>();
  let stored: string | null = "expired-token";
  const requests: Array<{ path: string; bearer: string | null }> = [];
  const value = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => stored,
      save: (token) => { stored = token; },
    },
    fetch: async (input, init) => {
      const path = pathOf(input);
      requests.push({ path, bearer: bearer(init) });
      if (path === "/api/mutation") return mutationResponse.promise;
      if (path === "/api/auth/login") return json(refusal("E_AUTH_INVALID"), 401);
      throw new Error(`unexpected path ${path}`);
    },
  });
  await value.ready;
  const mutation = value.mutation(api.messages.send, {});
  await waitFor(() => requests.length === 1, "old mutation dispatch");
  const login = value.auth.login({ email: "a@example.com", password: "wrong-password" });
  await flush();
  assert.equal(requests.some((request) => request.path === "/api/auth/login"), false);

  mutationResponse.resolve(json({ state: "rejected", ...refusal("E_AUTH_SESSION") }));
  await assert.rejects(mutation, isCode("E_AUTH_SUPERSEDED"));
  await assert.rejects(login, isCode("E_AUTH_INVALID"));
  assert.deepEqual(requests, [
    { path: "/api/mutation", bearer: "Bearer expired-token" },
    { path: "/api/auth/login", bearer: null },
  ]);
  assert.equal(stored, null);
  assert.equal(value.snapshot.token, undefined);
  value.close();
});

test("a delayed terminal read cannot clear a successfully replaced bearer", async () => {
  const oldResponse = deferred<Response>();
  let stored: string | null = "expired-token";
  let queryStarted = false;
  const value = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => stored,
      save: (token) => { stored = token; },
    },
    fetch: async (input) => {
      const path = pathOf(input);
      if (path === "/api/query") {
        queryStarted = true;
        return oldResponse.promise;
      }
      if (path === "/api/auth/login") {
        return json({ token: "replacement-token", viewer: "principal-new" });
      }
      throw new Error(`unexpected path ${path}`);
    },
  });
  await value.ready;
  const query = value.query(api.messages.thread, {});
  await waitFor(() => queryStarted, "old query dispatch");
  await value.auth.login({ email: "a@example.com", password: "password" });
  oldResponse.resolve(json(refusal("E_AUTH_SESSION"), 401));
  await assert.rejects(query, isCode("E_AUTH_SUPERSEDED"));
  assert.equal(stored, "replacement-token");
  assert.equal(value.snapshot.token, "replacement-token");
  value.close();
});

test("a transition during slow terminal cleanup suppresses typed mutation and channel receipts", async () => {
  for (const surface of ["mutation", "channel"] as const) {
    const clear = deferred<void>();
    const clearStarted = deferred<void>();
    let stored: string | null = "expired-token";
    let loginStarted = false;
    const value = createClient({
      url: "http://auth.test",
      tokenStore: {
        load: () => stored,
        save: async (token) => {
          if (token === null) {
            clearStarted.resolve();
            await clear.promise;
          }
          stored = token;
        },
      },
      fetch: async (input) => {
        const path = pathOf(input);
        if (path === "/api/mutation") {
          return json({ state: "rejected", ...refusal("E_AUTH_SESSION") });
        }
        if (path.endsWith("/publish")) {
          return json({ state: "refused", ...refusal("E_AUTH_SESSION") });
        }
        if (path === "/api/auth/login") {
          loginStarted = true;
          return json({ token: "replacement-token", viewer: "principal-new" });
        }
        throw new Error(`unexpected path ${path}`);
      },
    });
    await value.ready;
    const old = surface === "mutation"
      ? value.mutation(api.messages.send, {})
      : value.channel(api.typing, {}).publish({ typing: true });
    await clearStarted.promise;
    const login = value.auth.login({ email: "a@example.com", password: "password" });
    await flush();
    assert.equal(loginStarted, false, `${surface}: login must wait for the old write`);
    clear.resolve();
    await assert.rejects(old, isCode("E_AUTH_SUPERSEDED"));
    await login;
    assert.equal(stored, "replacement-token", surface);
    assert.equal(value.snapshot.token, "replacement-token", surface);
    value.close();
  }
});

test("close during token persistence never resurrects the client", async () => {
  const loginSave = deferred<void>();
  const loginSaveStarted = deferred<void>();
  let loginStored: string | null = "old-token";
  const loginClient = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => loginStored,
      save: async (token) => {
        loginStored = token;
        if (token === "new-token") {
          loginSaveStarted.resolve();
          await loginSave.promise;
        }
      },
    },
    fetch: async () => json({ token: "new-token", viewer: "principal-new" }),
  });
  await loginClient.ready;
  const login = loginClient.auth.login({ email: "a@example.com", password: "password" });
  await loginSaveStarted.promise;
  loginClient.close();
  loginSave.resolve();
  await assert.rejects(login, isCode("E_CLIENT_CLOSED"));
  assert.equal(loginClient.snapshot.connection, "offline");
  assert.equal(loginClient.snapshot.token, "old-token");
  assert.equal(loginStored, "new-token", "a future client may restore the completed durable login");

  const logoutClear = deferred<void>();
  const logoutClearStarted = deferred<void>();
  let logoutStored: string | null = "logout-token";
  const logoutClient = createClient({
    url: "http://auth.test",
    tokenStore: {
      load: () => logoutStored,
      save: async (token) => {
        logoutStored = token;
        if (token === null) {
          logoutClearStarted.resolve();
          await logoutClear.promise;
        }
      },
    },
    fetch: async () => json({ ok: true }),
  });
  await logoutClient.ready;
  const logout = logoutClient.auth.logout();
  await logoutClearStarted.promise;
  logoutClient.close();
  logoutClear.resolve();
  await assert.rejects(logout, isCode("E_CLIENT_CLOSED"));
  assert.equal(logoutClient.snapshot.connection, "offline");
  assert.equal(logoutClient.snapshot.token, undefined);
  assert.equal(logoutStored, null);
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

test("token-store clear failures stay visible on every request-based terminal path", async () => {
  const exercise = async (
    response: Response,
    run: (value: ReturnType<typeof createClient>) => Promise<unknown>,
  ): Promise<void> => {
    const value = createClient({
      url: "http://auth.test",
      tokenStore: {
        load: () => "expired-token",
        save: (token) => {
          if (token === null) throw new Error("storage unavailable");
        },
      },
      fetch: async () => response,
    });
    await value.ready;
    const generation = value.snapshot.authGeneration;
    await assert.rejects(() => run(value), isCode("E_AUTH_TOKEN_STORE"));
    assert.equal(value.snapshot.token, undefined);
    assert.equal(value.snapshot.authGeneration, generation + 1);
    assert.equal(value.snapshot.lastRefusal?.code, "E_AUTH_TOKEN_STORE");
    value.close();
  };

  await exercise(json(refusal("E_AUTH_SESSION"), 401), (value) =>
    value.query(api.messages.thread, {}));
  await exercise(json({ state: "rejected", ...refusal("E_AUTH_SESSION") }), (value) =>
    value.mutation(api.messages.send, {}));
  await exercise(json({ state: "refused", ...refusal("E_AUTH_SESSION") }), (value) =>
    value.channel(api.typing, {}).publish({ typing: true }));
  await exercise(json({ ok: true }), (value) => value.auth.logout());
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
  assert.equal(value.snapshot.lastRefusal?.code, "E_AUTH_TOKEN_STORE");
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

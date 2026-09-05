import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createClient, type SnapbackClient } from "../dist/client.mjs";
import { SnapbackProvider, useAuth, type UseAuthResult } from "../dist/react.mjs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const json = (value: unknown, status = 200) => Response.json(value, { status });
const me = (viewer = "alice") => json({ viewer, kind: "user", authEpoch: 1 });
const refusal = (code: string, status = 401) => json({ code, family: "auth", message: code, guide: "auth/session" }, status);
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function custody() {
  let token: string | null = "token-a";
  let binding: { token: string; principal: string } | null = { token, principal: "alice" };
  return { load: () => token, save: (value: string | null) => { token = value; },
    loadPrincipalBinding: () => binding,
    savePrincipal: (principal: string | null, bearer?: string) => { binding = principal && bearer ? { token: bearer, principal } : null; } };
}
async function restored(client: SnapbackClient) {
  await client.ready;
  await flush();
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test —
// hooks share the client machine, including recovery with no live query mounted.
test("parent and later child auth hooks agree across a restoration cut and reconnect", async () => {
  let cut = true, requests = 0;
  const store = custody();
  const client = createClient({ url: "http://auth.test", tokenStore: store, fetch: async input => {
    if (String(input).endsWith("/api/auth/me")) { requests++; if (cut) throw new TypeError("cut"); return me(); }
    return json({ generation: "g", programGeneration: "p", ops: {}, channels: {}, auth: {} });
  } });
  const views: UseAuthResult[] = [];
  function Probe({ index }: { index: number }) { views[index] = useAuth(); return null; }
  const render = (child: boolean) => React.createElement(SnapbackProvider, { client },
    React.createElement(Probe, { index: 0 }), child && React.createElement(Probe, { index: 1 }));
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { renderer = TestRenderer.create(render(false)); await restored(client); });
    assert.equal(views[0].state, "hydrating");
    assert.equal(views[0].restoringViewer, "alice");
    assert.equal(views[0].viewer, undefined);
    assert.equal(store.load(), "token-a");
    const initial = requests;
    assert.ok(initial <= 2, "only the independent manifest reconnect may trigger another attempt");
    await act(async () => { renderer.update(render(true)); await flush(); });
    assert.deepEqual(views[0], views[1]);
    assert.equal(requests, initial, "mounting another hook does not create another me request");
    await act(async () => { cut = false; await client.offline(); await client.online(); await flush(); });
    assert.equal(views[0].state, "authenticated");
    assert.equal(views[0].viewer, "alice");
    assert.equal(views[0].restoringViewer, undefined);
    assert.deepEqual(views[0], views[1]);
    assert.equal(requests, initial + 1);
  } finally { if (renderer) await act(async () => renderer.unmount()); await client.close(); }
});

test("headless restoration retries at 1, 2, 4, 8, 16, 30, 30 seconds and close clears its timer", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  let requests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async () => {
    requests++; throw new TypeError("cut");
  } });
  try {
    await restored(client);
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      assert.equal(client.snapshot.auth.state, "hydrating");
      assert.equal(client.snapshot.auth.retryAt, Date.now() + delay);
      const before = requests;
      context.mock.timers.tick(delay - 1); await flush();
      assert.equal(requests, before);
      context.mock.timers.tick(1); await flush();
      assert.equal(requests, before + 1);
    }
    await client.close();
    const before = requests;
    assert.equal(client.snapshot.auth.retryAt, undefined);
    context.mock.timers.tick(120_000); await flush();
    assert.equal(requests, before);
  } finally { await client.close(); context.mock.timers.reset(); }
});

test("restoration coalesces simultaneous me callers and a reconnect while pending", async () => {
  const response = deferred<Response>();
  let requests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async input => {
    if (String(input).endsWith("/api/auth/me")) { requests++; return response.promise; }
    return json({ generation: "g", programGeneration: "p", ops: {}, channels: {}, auth: {} });
  } });
  try {
    await restored(client);
    const one = client.auth.me(), two = client.auth.me();
    await client.manifest(); await flush();
    assert.equal(requests, 1);
    response.resolve(me());
    assert.deepEqual(await one, await two);
    assert.equal(client.snapshot.auth.viewer, "alice");
  } finally { response.resolve(me()); await client.close(); }
});

test("only missing or expired authentication becomes anonymous and clears token custody", async () => {
  for (const code of ["E_AUTH", "E_AUTH_REQUIRED", "E_AUTH_SESSION"]) {
    const store = custody();
    const client = createClient({ url: "http://auth.test", tokenStore: store, fetch: async () => refusal(code) });
    try {
      await restored(client);
      assert.equal(client.snapshot.auth.state, "anonymous", code);
      assert.equal(client.snapshot.auth.viewer, undefined);
      assert.equal(client.snapshot.auth.restoringViewer, undefined);
      assert.equal(client.snapshot.token, undefined);
      assert.equal(store.load(), null);
      await assert.rejects(client.auth.me(), (error: any) => error.code === code);
    } finally { await client.close(); }
  }
});

test("coded refusals stay visible and retry once per reconnect without a self-cycle", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let requests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async () => { requests++; return refusal("E_AUTH_DISABLED", 403); } });
  try {
    await restored(client);
    assert.equal(client.snapshot.auth.state, "refused");
    assert.equal(client.snapshot.auth.refusal?.code, "E_AUTH_DISABLED");
    assert.equal(client.snapshot.auth.retryAt, undefined);
    context.mock.timers.tick(120_000); await flush();
    assert.equal(requests, 1);
    await client.offline(); await client.online(); await flush();
    assert.equal(requests, 2);
    assert.equal(client.snapshot.auth.state, "refused");
    context.mock.timers.tick(120_000); await flush();
    assert.equal(requests, 2);
  } finally { await client.close(); context.mock.timers.reset(); }
});

test("storage and protocol failures are refused without restoration timers", async () => {
  for (const failure of ["load", "binding", "clear", "protocol"] as const) {
    const store = custody();
    if (failure === "load") store.load = () => { throw new Error("storage unavailable"); };
    if (failure === "binding") store.savePrincipal = () => { throw new Error("storage unavailable"); };
    if (failure === "clear") store.save = () => { throw new Error("storage unavailable"); };
    const client = createClient({ url: "http://auth.test", tokenStore: store,
      fetch: async () => failure === "protocol" ? json({ viewer: "alice" }) : failure === "clear" ? refusal("E_AUTH_SESSION") : me() });
    try {
      if (failure === "load") await assert.rejects(client.ready, (error: any) => error.code === "E_AUTH_TOKEN_STORE");
      else await restored(client);
      assert.equal(client.snapshot.auth.state, "refused", failure);
      assert.equal(client.snapshot.auth.refusal?.code, failure === "protocol" ? "E_WIRE_SHAPE" : "E_AUTH_TOKEN_STORE");
      assert.equal(client.snapshot.auth.retryAt, undefined);
      assert.equal(client.snapshot.auth.viewer, undefined);
    } finally { await client.close(); }
  }
});

test("logout, account replacement and close ignore a pending predecessor me response", async () => {
  for (const action of ["logout", "login", "close"] as const) {
    const response = deferred<Response>();
    let signal: AbortSignal | null | undefined;
    const store = custody();
    const client = createClient({ url: "http://auth.test", tokenStore: store, fetch: async (input, init) => {
      if (String(input).endsWith("/api/auth/me")) { signal = init?.signal; return response.promise; }
      if (String(input).endsWith("/login")) return json({ token: "token-b", viewer: "bob", authEpoch: 2 });
      return json({ ok: true });
    } });
    try {
      await restored(client);
      const pending = client.auth.me();
      const rejected = assert.rejects(pending, (error: any) => error.code === "E_AUTH_SUPERSEDED");
      await flush();
      if (action === "close") await client.close();
      else if (action === "login") await client.auth.login({ email: "bob@example.com", password: "password" });
      else await client.auth.logout();
      assert.equal(signal?.aborted, true);
      await rejected;
      const snapshot = client.snapshot;
      response.resolve(me()); await flush();
      assert.deepEqual(client.snapshot, snapshot, action);
      if (action === "login") {
        assert.equal(client.snapshot.auth.viewer, "bob");
        assert.deepEqual(store.loadPrincipalBinding(), { token: "token-b", principal: "bob" });
      } else if (action === "logout") assert.equal(client.snapshot.auth.state, "anonymous");
      if (action !== "close") assert.equal(client.snapshot.auth.restoringViewer, undefined);
    } finally { response.resolve(me()); await client.close(); }
  }
});

test("a mismatched stored binding never renders another token's restoring viewer", async () => {
  const store = custody();
  store.save("token-b");
  const client = createClient({ url: "http://auth.test", tokenStore: store, fetch: async () => { throw new TypeError("cut"); } });
  try {
    await restored(client);
    assert.equal(client.snapshot.auth.state, "hydrating");
    assert.equal(client.snapshot.auth.restoringViewer, undefined);
    assert.equal(client.snapshot.auth.viewer, undefined);
  } finally { await client.close(); }
});

test("a restoration retry never dispatches a query on a retained viewer's strength", async () => {
  const paths: string[] = [];
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async input => {
    paths.push(new URL(String(input)).pathname);
    throw new TypeError("cut");
  } });
  try {
    await restored(client);
    await client.offline(); await client.online(); await flush();
    assert.deepEqual(paths, ["/api/auth/me", "/api/auth/me"]);
    assert.equal(client.snapshot.auth.viewer, undefined);
  } finally { await client.close(); }
});

test("HTTP 503 restoration retries, and authority replacement cancels the old backoff", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  for (const action of ["logout", "login"] as const) {
    let requests = 0;
    const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async input => {
      if (String(input).endsWith("/api/auth/me")) { requests++; return json({ unavailable: true }, 503); }
      return String(input).endsWith("/login") ? json({ token: "token-b", viewer: "bob" }) : json({ ok: true });
    } });
    try {
      await restored(client);
      assert.equal(client.snapshot.auth.state, "hydrating");
      assert.equal(client.snapshot.auth.retryAt, Date.now() + 1_000);
      if (action === "login") await client.auth.login({ email: "bob@example.com", password: "password" });
      else await client.auth.logout();
      context.mock.timers.tick(120_000); await flush();
      assert.equal(requests, 1);
      assert.equal(client.snapshot.auth.retryAt, undefined);
      assert.equal(client.snapshot.auth.viewer, action === "login" ? "bob" : undefined);
      assert.equal(client.snapshot.auth.restoringViewer, undefined);
    } finally { await client.close(); }
  }
  context.mock.timers.reset();
});

test("late terminal me evidence clears only custody that still holds that bearer", async () => {
  for (const replacement of ["failed", "succeeded"] as const) {
    const response = deferred<Response>();
    const store = custody();
    const client = createClient({ url: "http://auth.test", tokenStore: store, fetch: async input => {
      if (String(input).endsWith("/api/auth/me")) return response.promise;
      return replacement === "failed" ? refusal("E_AUTH_INVALID") : json({ token: "token-b", viewer: "bob" });
    } });
    try {
      await restored(client);
      const login = client.auth.login({ email: "bob@example.com", password: "password" });
      if (replacement === "failed") await assert.rejects(login, (error: any) => error.code === "E_AUTH_INVALID");
      else await login;
      response.resolve(refusal("E_AUTH_SESSION")); await flush();
      assert.equal(store.load(), replacement === "failed" ? null : "token-b");
      assert.equal(client.snapshot.auth.state, replacement === "failed" ? "anonymous" : "authenticated");
      assert.equal(client.snapshot.auth.viewer, replacement === "failed" ? undefined : "bob");
    } finally { response.resolve(refusal("E_AUTH_SESSION")); await client.close(); }
  }
});

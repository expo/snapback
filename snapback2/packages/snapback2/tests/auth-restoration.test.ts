import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api, createClient, type SnapbackClient } from "../dist/client.mjs";
import { SnapbackProvider, useAuth, useQuery, type UseAuthResult } from "../dist/react.mjs";

import { DAY, fakeOwner, seededStore } from "./fake-owner.ts";
import { nodeSqliteDriver, sqliteRangeStore } from "../dist/sqlite-test.mjs";

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
function custody(principal = "alice") {
  let token: string | null = "token-a";
  let binding: { token: string; principal: string } | null = { token, principal };
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
test("parent and later child auth hooks agree across a restoration cut and reconnect", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
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
    await restored(client);
    assert.equal(requests, 1);
    await act(async () => { renderer = TestRenderer.create(render(false)); await flush(); });
    assert.equal(views[0].state, "hydrating");
    assert.equal(views[0].restoringViewer, "alice");
    assert.equal(views[0].viewer, undefined);
    assert.equal(store.load(), "token-a");
    const initial = requests;
    assert.equal(initial, 2, "the independent manifest reconnect triggers exactly one attempt");
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
    await flush();
    await client.offline(); await client.online(); await flush();
    assert.equal(requests, 1, "both callers and offline/online share the pending request");
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
      if (String(input).endsWith("/login")) return json({ token: "token-b", viewer: "bob", kind: "user", authEpoch: 2 });
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

test("mounted queries during restoration use held coverage and only me retries carry the bearer", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  for (const bound of [true, false]) {
    const paths: string[] = [], headers: string[] = [], answers: any[] = [];
    const store = custody();
    if (!bound) store.loadPrincipalBinding = () => null;
    const client = createClient({ url: "http://auth.test", tokenStore: store, offline: { store: offlineStore(context) },
      fetch: async (input, init) => {
        paths.push(new URL(String(input)).pathname);
        headers.push(new Headers(init?.headers).get("Authorization")!);
        throw new TypeError("cut");
      } });
    let sub: ReturnType<SnapbackClient["subscribe"]> | undefined;
    try {
      await restored(client);
      sub = client.subscribe(api.current, {}, answer => answers.push(answer));
      answers.push(await client.query(api.current, {})); await flush();
      assert.equal(client.snapshot.auth.restoringViewer, bound ? "alice" : undefined);
      assert.equal(client.snapshot.auth.viewer, undefined);
      assert.ok(answers.length >= 2);
      assert.ok(answers.every(answer => answer.state === "hydrating" && answer.connection === "offline"));
      context.mock.timers.tick(1_000); await flush();
      assert.deepEqual(paths, ["/api/auth/me", "/api/auth/me"]);
      assert.deepEqual(headers, ["Bearer token-a", "Bearer token-a"]);
    } finally { sub?.close(); await client.close(); }
  }
});

test("HTTP 503 restoration retries, and authority replacement cancels the old backoff", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  for (const action of ["logout", "login"] as const) {
    let requests = 0;
    const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async input => {
      if (String(input).endsWith("/api/auth/me")) { requests++; return json({ unavailable: true }, 503); }
      return String(input).endsWith("/login") ? json({ token: "token-b", viewer: "bob", kind: "user" }) : json({ ok: true });
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
  for (const stage of ["fetch", "body"] as const) for (const replacement of ["failed", "succeeded"] as const) {
    const response = deferred<Response>();
    const started = deferred<void>(), release = deferred<void>();
    const store = custody();
    const client = createClient({ url: "http://auth.test", tokenStore: store, fetch: async input => {
      if (String(input).endsWith("/api/auth/me")) {
        if (stage === "fetch") return response.promise;
        const terminal = refusal("E_AUTH_SESSION"), parse = terminal.json.bind(terminal);
        terminal.json = async () => { started.resolve(); await release.promise; return parse(); };
        return terminal;
      }
      return replacement === "failed" ? refusal("E_AUTH_INVALID") : json({ token: "token-b", viewer: "bob", kind: "user" });
    } });
    try {
      await restored(client);
      if (stage === "body") await started.promise;
      const login = client.auth.login({ email: "bob@example.com", password: "password" });
      if (replacement === "failed") await assert.rejects(login, (error: any) => error.code === "E_AUTH_INVALID");
      else await login;
      response.resolve(refusal("E_AUTH_SESSION")); release.resolve(); await flush();
      assert.equal(store.load(), replacement === "failed" ? null : "token-b");
      assert.equal(client.snapshot.auth.state, replacement === "failed" ? "anonymous" : "authenticated");
      assert.equal(client.snapshot.auth.viewer, replacement === "failed" ? undefined : "bob");
    } finally { response.resolve(refusal("E_AUTH_SESSION")); release.resolve(); await client.close(); }
  }
});

for (const state of ["authenticated", "backoff", "pending"] as const) {
  for (const action of ["login", "signup", "guest"] as const) {
    test(`failed ${action} preserves ${state} bearer custody and restoration`, async context => {
      context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
      const response = deferred<Response>();
      let requests = 0;
      const store = custody();
      const client = createClient({ url: "http://auth.test", tokenStore: store, fetch: async input => {
        if (!String(input).endsWith("/api/auth/me")) return refusal("E_AUTH_INVALID");
        requests++;
        if (state === "authenticated") return me();
        if (state === "pending" && requests === 1) return response.promise;
        throw new TypeError("cut");
      } });
      try {
        await restored(client);
        await assert.rejects(action === "guest" ? client.auth.guest()
          : client.auth[action]({ email: "alice@example.com", password: "wrong" }), (error: any) => error.code === "E_AUTH_INVALID");
        assert.equal(store.load(), "token-a");
        assert.equal(client.snapshot.token, "token-a");
        assert.deepEqual(store.loadPrincipalBinding(), { token: "token-a", principal: "alice" });
        assert.equal(client.snapshot.auth.state, state === "authenticated" ? "authenticated" : "hydrating");
        assert.equal(client.snapshot.auth.refusal, undefined);
        if (state === "authenticated") assert.equal(client.snapshot.auth.viewer, "alice");
        else {
          assert.equal(client.snapshot.auth.restoringViewer, "alice");
          assert.ok(client.snapshot.auth.retryAt! > Date.now());
          context.mock.timers.tick(client.snapshot.auth.retryAt! - Date.now()); await flush();
          assert.equal(requests, 2, "failed transition must leave a live restoration timer");
        }
      } finally { response.resolve(me()); await client.close(); }
    });
  }
}

function offlineStore(context: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "s2-auth-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return sqliteRangeStore(() => nodeSqliteDriver(join(root, "store.db")));
}

test("startup metadata failure rejects ready without replacing confirmed auth", async context => {
  const store = custody();
  const client = createClient({ url: "http://auth.test", tokenStore: store, offline: { store: offlineStore(context) },
    fetch: async input => String(input).endsWith("/api/auth/me") ? me() : json({ malformed: true }) });
  try {
    await assert.rejects(client.ready, (error: any) => error.code === "E_WIRE_SHAPE");
    assert.equal(client.snapshot.auth.state, "authenticated");
    assert.equal(client.snapshot.auth.viewer, "alice");
    assert.equal(client.snapshot.auth.kind, "user");
    assert.equal(client.snapshot.auth.retryAt, undefined);
    assert.equal(client.snapshot.token, "token-a");
    assert.equal(store.load(), "token-a");
  } finally { await client.close(); }
});

test("refused restoration recovers its display viewer from bearer custody", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const response = deferred<Response>();
  let requests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async () => {
    if (++requests === 1) return refusal("E_INPUT", 403);
    return response.promise;
  } });
  try {
    await restored(client);
    assert.equal(client.snapshot.auth.state, "refused");
    await client.offline(); await client.online(); await flush();
    assert.equal(client.snapshot.auth.state, "hydrating");
    assert.equal(client.snapshot.auth.restoringViewer, "alice");
    await client.offline(); await client.online(); await flush();
    assert.equal(client.snapshot.auth.restoringViewer, "alice");
    assert.equal(requests, 2);
    response.resolve(me()); await flush();
    assert.equal(client.snapshot.auth.viewer, "alice");
  } finally { response.resolve(me()); await client.close(); }
});

test("restart of an offline device drops both retry clocks and waits for reconnect", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  let requests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async () => {
    requests++; throw new TypeError("cut");
  } });
  let restarted: SnapbackClient | undefined;
  try {
    await restored(client);
    assert.equal(client.snapshot.auth.retryAt, 2_000);
    await client.offline();
    restarted = await client.restart(); await flush();
    for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 120_000]) {
      context.mock.timers.tick(delay); await flush();
      assert.equal(requests, 1);
      assert.equal(client.snapshot.auth.retryAt, undefined);
      assert.equal(restarted.snapshot.auth.retryAt, undefined);
    }
    assert.equal(restarted.snapshot.auth.restoringViewer, "alice");
    await restarted.online(); await flush();
    assert.equal(requests, 2);
  } finally { await client.close(); await restarted?.close(); }
});

test("two persona hooks share the lazy me flight", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const response = deferred<Response>();
  let requests = 0;
  const client = createClient({ url: "http://auth.test", as: "alice", fetch: async (input, init) => {
    assert.equal(new Headers(init?.headers).get("X-Snapback-As"), "alice");
    assert.equal(new Headers(init?.headers).get("Authorization"), null);
    if (String(input).endsWith("/api/auth/me")) { requests++; return response.promise; }
    return json({ generation: "g", programGeneration: "p", ops: {}, channels: {}, auth: {} });
  } });
  const views: UseAuthResult[] = [];
  function Probe({ index }: { index: number }) { views[index] = useAuth(); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client },
      React.createElement(Probe, { index: 0 }), React.createElement(Probe, { index: 1 }))); await restored(client); });
    assert.equal(requests, 1);
    assert.deepEqual(views[0], views[1]);
    await act(async () => { response.resolve(json({ viewer: "dev:alice", kind: "persona" })); await flush(); });
    assert.equal(views[0].viewer, "dev:alice");
    assert.equal(views[0].restoringViewer, undefined);
    assert.deepEqual(views[0], views[1]);
    assert.equal(requests, 1);
  } finally { response.resolve(me()); if (renderer) await act(async () => renderer.unmount()); await client.close(); }
});

test("load/save-only custody restores without an unbound viewer and recovers on reconnect", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let token: string | null = "token-a", cut = true, requests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: { load: () => token, save: value => { token = value; } },
    fetch: async () => { requests++; if (cut) throw new TypeError("cut"); return me(); } });
  try {
    await restored(client);
    assert.equal(client.snapshot.auth.state, "hydrating");
    assert.equal(client.snapshot.auth.restoringViewer, undefined);
    assert.equal(token, "token-a");
    cut = false; await client.offline(); await client.online(); await flush();
    assert.equal(client.snapshot.auth.viewer, "alice");
    assert.equal(requests, 2);
  } finally { await client.close(); }
});

test("explicit me cancels the old backoff deadline and schedules its own retry", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  let requests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async () => { requests++; throw new TypeError("cut"); } });
  try {
    await restored(client);
    context.mock.timers.tick(500);
    await assert.rejects(client.auth.me(), (error: any) => error.code === "E_NETWORK");
    assert.equal(requests, 2);
    assert.equal(client.snapshot.auth.retryAt, 3_500);
    context.mock.timers.tick(500); await flush();
    assert.equal(requests, 2);
    context.mock.timers.tick(1_500); await flush();
    assert.equal(requests, 3);
  } finally { await client.close(); }
});

test("non-auth coded restoration refusal retains custody and retries once per reconnect", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let requests = 0;
  const store = custody();
  const client = createClient({ url: "http://auth.test", tokenStore: store, fetch: async () => {
    requests++; return json({ code: "E_INPUT", family: "input", message: "bad input", guide: "input/runtime" }, 403);
  } });
  try {
    await restored(client);
    for (let cycle = 1; cycle <= 3; cycle++) {
      assert.equal(client.snapshot.auth.state, "refused");
      assert.equal(client.snapshot.auth.refusal?.code, "E_INPUT");
      assert.equal(store.load(), "token-a");
      assert.equal(client.snapshot.auth.retryAt, undefined);
      context.mock.timers.tick(120_000); await flush();
      assert.equal(requests, cycle);
      await client.offline(); await client.online(); await flush();
      assert.equal(requests, cycle + 1);
    }
  } finally { await client.close(); }
});

for (const failure of ["network", "503"]) {
  test(`Provider manifest reconnect after ${failure} retries me once without self-cycling`, async context => {
    context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
    const manifest = deferred<Response>();
    let requests = 0;
    const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async input => {
      if (String(input).endsWith("/api/manifest")) return manifest.promise;
      requests++;
      if (failure === "network") throw new TypeError("cut");
      return json({}, 503);
    } });
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      await restored(client);
      assert.equal(requests, 1);
      await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client })); await flush(); });
      assert.equal(requests, 1);
      await act(async () => { manifest.resolve(json({ generation: "g", programGeneration: "p", ops: {}, channels: {}, auth: {} })); await flush(); });
      assert.equal(requests, 2);
      assert.equal(client.snapshot.connection, "reconnecting");
      assert.equal(client.snapshot.auth.retryAt, 3_000);
      await act(async () => { context.mock.timers.tick(0); await flush(); });
      assert.equal(requests, 2);
    } finally { if (renderer) await act(async () => renderer.unmount()); await client.close(); }
  });
}

for (const action of ["close", "logout"]) {
  test(`${action} one millisecond before the retry deadline starts no fetch`, async context => {
    context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
    let requests = 0;
    const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async input => {
      if (String(input).endsWith("/logout")) return json({ ok: true });
      requests++; throw new TypeError("cut");
    } });
    try {
      await restored(client);
      context.mock.timers.tick(999); await flush();
      if (action === "close") await client.close(); else await client.auth.logout();
      context.mock.timers.tick(1); await flush();
      assert.equal(requests, 1);
      assert.equal(client.snapshot.auth.retryAt, undefined);
    } finally { await client.close(); }
  });
}

test("hooks recheck lazy me after an asynchronous token load and offline startup confirmation", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const token = deferred<string>();
  const store = custody();
  let requests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: { ...store, load: () => token.promise },
    offline: { store: offlineStore(context) }, fetch: async input => {
      if (String(input).endsWith("/api/auth/me")) { requests++; return me(); }
      throw new TypeError("metadata cut");
    } });
  const states: string[] = [];
  const unsubscribe = client.subscribeStatus(snapshot => states.push(snapshot.auth.state));
  function Probe() { useAuth(); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client }, React.createElement(Probe))); await flush(); });
    assert.equal(requests, 0);
    await act(async () => { token.resolve("token-a"); await restored(client); });
    assert.equal(requests, 1);
    assert.equal(client.snapshot.auth.state, "authenticated");
    assert.ok(states.slice(states.indexOf("authenticated")).every(state => state === "authenticated"));
  } finally { token.resolve("token-a"); unsubscribe(); if (renderer) await act(async () => renderer.unmount()); await client.close(); }
});

test("session success publishes token, kind and authEpoch together to hooks", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async input => {
    if (String(input).endsWith("/api/auth/me")) return me();
    if (String(input).includes("/api/auth/")) return json({ token: "token-b", viewer: "bob", kind: "guest", authEpoch: 42 });
    return json({ generation: "g", programGeneration: "p", ops: {}, channels: {}, auth: {} });
  } });
  let view: UseAuthResult;
  const snapshots: any[] = [];
  const unsubscribe = client.subscribeStatus(snapshot => snapshots.push(snapshot));
  function Probe() { view = useAuth(); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await restored(client);
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client }, React.createElement(Probe))); await flush(); });
    await act(async () => { await client.auth.login({ email: "bob@example.com", password: "password" }); });
    assert.equal(view!.kind, "guest", "the wire supplies kind; it is not guessed from the route");
    assert.equal(view!.authEpoch, 42);
    assert.equal(view!.viewer, "bob");
    assert.equal(view!.token, "token-b");
    for (const snapshot of snapshots.filter(snapshot => snapshot.token === "token-b")) {
      assert.equal(snapshot.auth.viewer, "bob");
      assert.equal(snapshot.auth.kind, "guest");
      assert.ok(snapshot.authGeneration > snapshots[0].authGeneration);
    }
  } finally { unsubscribe(); if (renderer) await act(async () => renderer.unmount()); await client.close(); }
});


test("startup resume failure rejects ready without replacing confirmed auth", async context => {
  const factory = offlineStore(context);
  await seededStore(factory);
  const owner = fakeOwner();
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: factory },
    fetch: async (input, init) => {
      if (String(input).endsWith("/api/auth/me")) return json({ viewer: "dev:alice", kind: "user", authEpoch: 7 });
      if (String(input).endsWith("/api/resume")) return json({ malformed: true });
      return owner.fetch(input, init);
    } });
  try {
    await assert.rejects(client.ready, (error: any) => error.code === "E_WIRE_SHAPE");
    assert.equal(client.snapshot.auth.state, "authenticated");
    assert.equal(client.snapshot.auth.viewer, "dev:alice");
    assert.equal(client.snapshot.auth.authEpoch, 7);
    assert.equal(client.snapshot.token, "token-a");
    assert.equal(client.snapshot.auth.retryAt, undefined);
  } finally { await client.close(); }
});

test("a session response without kind is refused before replacing custody", async () => {
  const store = custody();
  const client = createClient({ url: "http://auth.test", tokenStore: store,
    fetch: async input => String(input).endsWith("/api/auth/me") ? me() : json({ token: "token-b", viewer: "bob" }) });
  try {
    await restored(client);
    await assert.rejects(client.auth.login({ email: "bob@example.com", password: "password" }), (error: any) => error.code === "E_WIRE_SHAPE");
    assert.equal(store.load(), "token-a");
    assert.equal(client.snapshot.auth.viewer, "alice");
    assert.equal(client.snapshot.auth.kind, "user");
  } finally { await client.close(); }
});


for (const timing of ["before hydrate", "pending me"] as const) {
  test(`failed login during offline startup ${timing} resumes retained bearer restoration`, async context => {
    context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
    const started = deferred<void>(), response = deferred<Response>();
    let requests = 0;
    const client = createClient({ url: "http://auth.test", tokenStore: custody(), offline: { store: offlineStore(context) },
      fetch: async input => {
        if (String(input).endsWith("/login")) return refusal("E_AUTH_INVALID");
        requests++; started.resolve(); return response.promise;
      } });
    try {
      if (timing === "pending me") await started.promise;
      await assert.rejects(client.auth.login({ email: "alice@example.com", password: "wrong" }), (error: any) => error.code === "E_AUTH_INVALID");
      assert.equal(client.snapshot.auth.state, "hydrating");
      assert.equal(client.snapshot.auth.restoringViewer, "alice");
      assert.equal(client.snapshot.token, "token-a");
      const before = requests;
      context.mock.timers.tick(1_000); await flush();
      assert.equal(requests, before + 1);
    } finally { response.resolve(me()); await client.close(); }
  });
}

test("an offline query hook leaves hydration when the stored bearer is confirmed", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const owner = fakeOwner({ seed: true });
  let cut = true;
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: offlineStore(context) },
    fetch: async (input, init) => {
      if (String(input).endsWith("/api/auth/me") && cut) throw new TypeError("cut");
      return owner.fetch(input, init);
    } });
  let view: any;
  function Probe() { view = useQuery(api.deliveries.inbox, { c: null }, { live: false }); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await restored(client);
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client }, React.createElement(Probe))); await flush(); });
    assert.equal(view.state, "hydrating");
    assert.equal(owner.requests.includes("/api/query"), false);
    await act(async () => { cut = false; await client.auth.me(); await flush(); });
    assert.equal(view.state, "complete");
    assert.equal(view.data.length, 2);
    assert.equal(owner.requests.filter(path => path === "/api/query").length, 1);
  } finally { if (renderer) await act(async () => renderer.unmount()); await client.close(); }
});

test("a terminal write wakes a read waiting on restoration without dispatching it", async () => {
  const response = deferred<Response>();
  const paths: string[] = [];
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async input => {
    const path = new URL(String(input)).pathname; paths.push(path);
    return path === "/api/auth/me" ? response.promise : refusal("E_AUTH_SESSION");
  } });
  try {
    await restored(client);
    const read = client.query(api.current, {});
    const rejected = assert.rejects(read, (error: any) => error.code === "E_AUTH_SUPERSEDED");
    await flush();
    await assert.rejects(client.mutation(api.write, {}), (error: any) => error.code === "E_AUTH_SESSION");
    await rejected;
    assert.deepEqual(paths, ["/api/auth/me", "/api/mutation"]);
    assert.equal(client.snapshot.auth.state, "anonymous");
  } finally { response.resolve(me()); await client.close(); }
});


test("online restart cancels the predecessor clock and starts only the new client's restoration", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  let requests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: custody(), fetch: async () => {
    requests++; throw new TypeError("cut");
  } });
  let successor: SnapbackClient | undefined;
  try {
    await restored(client);
    successor = await client.restart(); await flush();
    assert.equal(requests, 2, "the new client eagerly restores its stored bearer");
    assert.equal(client.snapshot.auth.retryAt, undefined);
    assert.equal(successor.snapshot.auth.retryAt, 2_000);
    context.mock.timers.tick(1_000); await flush();
    assert.equal(requests, 3, "only the successor's timer is alive");
    await successor.close();
    context.mock.timers.tick(120_000); await flush();
    assert.equal(requests, 3);
    assert.equal(successor.snapshot.auth.retryAt, undefined);
  } finally { await client.close(); await successor?.close(); }
});


test("logout custody-clear failure cannot keep an authenticated view after clearing memory", async () => {
  const store = custody();
  store.save = token => { if (token === null) throw new Error("store unavailable"); };
  const client = createClient({ url: "http://auth.test", tokenStore: store,
    fetch: async input => String(input).endsWith("/api/auth/me") ? me() : json({ ok: true }) });
  try {
    await restored(client);
    await assert.rejects(client.auth.logout(), (error: any) => error.code === "E_AUTH_TOKEN_STORE");
    assert.equal(client.snapshot.token, undefined);
    assert.equal(client.snapshot.auth.state, "refused");
    assert.equal(client.snapshot.auth.refusal?.code, "E_AUTH_TOKEN_STORE");
    assert.equal(client.snapshot.auth.viewer, undefined);
    assert.equal(client.snapshot.auth.retryAt, undefined);
  } finally { await client.close(); }
});

for (const outcome of ["failed", "successful"] as const) for (const timing of ["before hydrate", "pending me"] as const) {
  test(`${outcome} startup login ${timing} restores metadata and resumes the durable outbox`, async context => {
    const factory = offlineStore(context), owner = fakeOwner();
    await seededStore(factory);
    const seed = createClient({ url: "http://auth.test", as: "alice", offline: { store: factory }, fetch: owner.fetch });
    await seed.ready;
    await seed.offline();
    const queued = await seed.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "before restart" });
    assert.equal(queued.state, "queued");
    await seed.close();
    context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    const started = deferred<void>(), oldResponse = deferred<Response>();
    const paths: string[] = [];
    let holdMe = timing === "pending me";
    const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: factory },
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname; paths.push(path);
        if (path === "/api/auth/login" && outcome === "failed") return refusal("E_AUTH_INVALID");
        if (path === "/api/auth/me" && holdMe) { holdMe = false; started.resolve(); return oldResponse.promise; }
        return owner.fetch(input, init);
      } });
    try {
      if (timing === "pending me") await started.promise;
      const login = client.auth.login({ email: "alice@example.com", password: outcome === "failed" ? "wrong" : "password" });
      if (outcome === "failed") await assert.rejects(login, (error: any) => error.code === "E_AUTH_INVALID");
      else await login;
      context.mock.timers.tick(1_000);
      for (let i = 0; i < 20 && owner.executions.length === 0; i++) await flush();
      assert.equal(client.snapshot.auth.state, "authenticated");
      assert.equal(paths.filter(path => path === "/api/manifest").length, 1);
      assert.equal(paths.filter(path => path === "/api/resume").length, 1);
      assert.equal(owner.executions.length, 1, "restoration replays the held intent without online() or a mounted query");
      assert.equal((owner.executions[0].args as any).body, "before restart");
    } finally { oldResponse.resolve(me("dev:alice")); await client.close(); }
  });
}

for (const action of ["login", "signup", "guest"] as const) {
  test(`startup ${action} keeps installed custody successful when offline metadata fails`, async context => {
    const metadata = deferred<Response>(), started = deferred<void>();
    const client = createClient({ url: "http://auth.test", offline: { store: offlineStore(context) },
      fetch: async input => {
        if (new URL(String(input)).pathname === "/api/manifest") { started.resolve(); return metadata.promise; }
        return json({ token: "token-b", viewer: "bob", kind: "user", authEpoch: 8 });
      } });
    let result: any;
    const session = (action === "guest" ? client.auth.guest() : client.auth[action]({ email: "bob@example.com", password: "password" }))
      .then(value => { result = value; });
    // Attach the rejection observer before injecting a malformed response.
    void session.catch(() => undefined);
    try {
      await started.promise; await flush();
      assert.equal(client.snapshot.auth.state, "authenticated");
      assert.equal(client.snapshot.token, "token-b");
      metadata.resolve(json({ malformed: true }));
      await session;
      assert.equal(result?.token, "token-b", "a metadata failure cannot reject an installed session");
      for (let i = 0; i < 10 && !client.snapshot.lastRefusal; i++) await flush();
      assert.equal(client.snapshot.auth.state, "authenticated");
      assert.equal(client.snapshot.auth.viewer, "bob");
      assert.equal(client.snapshot.token, "token-b");
      assert.equal(client.snapshot.lastRefusal?.code, "E_WIRE_SHAPE");
    } finally { metadata.resolve(json({ malformed: true })); await session.catch(() => undefined); await client.close(); }
  });
}

for (const outcome of ["failed", "successful"] as const) test(`held queries during a ${outcome} startup login wait for its authority`, async context => {
  const factory = offlineStore(context);
  await seededPrivateStore(factory);
  const loginResponse = deferred<Response>(), started = deferred<void>();
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: factory },
    fetch: async (input, init) => {
      if (String(input).endsWith("/login")) { started.resolve(); return loginResponse.promise; }
      if (new URL(String(input)).pathname === "/api/query") {
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token-b");
        return json({ state: "complete", data: ["bob's answer"], next: null, seq: 4 });
      }
      throw new TypeError("cut");
    } });
  const attempt = client.auth.login({ email: "bob@example.com", password: "password" });
  const login = outcome === "failed" ? assert.rejects(attempt, (error: any) => error.code === "E_AUTH_INVALID") : attempt;
  let settled = false;
  let read: Promise<unknown> | undefined;
  try {
    await started.promise;
    read = client.query(api.deliveries.inbox, { c: null }).then(value => { settled = true; return value; });
    await flush(); await flush();
    assert.equal(settled, false, "the predecessor's held answer cannot bypass an active login");
    loginResponse.resolve(outcome === "failed" ? refusal("E_AUTH_INVALID")
      : json({ token: "token-b", viewer: "bob", kind: "user", authEpoch: 8 }));
    await login;
    const held: any = await read;
    assert.equal(held.state, "complete");
    assert.deepEqual(held.data, outcome === "failed" ? [{ body: "Alice's private held message" }] : ["bob's answer"]);
  } finally { loginResponse.resolve(refusal("E_AUTH_INVALID")); await login; await read?.catch(() => undefined); await client.close(); }
});

for (const failure of ["expired", "closed"] as const) test(`metadata cannot report session success after custody is ${failure}`, async context => {
  const started = deferred<void>(), metadata = deferred<Response>();
  const client = createClient({ url: "http://auth.test", offline: { store: offlineStore(context) },
    fetch: async input => {
      if (String(input).endsWith("/api/manifest")) { started.resolve(); return metadata.promise; }
      return json({ token: "token-b", viewer: "bob", kind: "user", authEpoch: 8 });
    } });
  const login = assert.rejects(client.auth.login({ email: "bob@example.com", password: "password" }),
    (error: any) => error.code === (failure === "expired" ? "E_AUTH_SESSION" : "E_CLIENT_CLOSED"));
  try {
    await started.promise;
    if (failure === "closed") await client.close();
    metadata.resolve(failure === "expired" ? refusal("E_AUTH_SESSION") : json({ malformed: true }));
    await login;
    if (failure === "expired") {
      assert.equal(client.snapshot.auth.state, "anonymous");
      assert.equal(client.snapshot.token, undefined);
    }
  } finally { metadata.resolve(refusal("E_AUTH_SESSION")); await login; await client.close(); }
});

async function queuedStartup(context: TestContext, bodies = ["held before startup"]) {
  const factory = offlineStore(context), owner = fakeOwner();
  await seededStore(factory);
  const seed = createClient({ url: "http://auth.test", as: "alice", offline: { store: factory }, fetch: owner.fetch });
  try {
    await seed.ready; await seed.offline();
    for (const body of bodies) await seed.mutation(api.deliveries.post, { conversationId: "conversation-1", body });
  } finally { await seed.close(); }
  return { factory, owner };
}

async function seededPrivateStore(factory: ReturnType<typeof offlineStore>) {
  await seededStore(factory);
  const store = factory();
  await store.open("dev:alice");
  try {
    await store.commit({ deliveries: [{ op: "deliveries.inbox", args: { c: null }, state: "complete",
      data: [{ body: "Alice's private held message" }], next: null, seq: 4, validator: "2".repeat(64),
      receipt: { ranges: [], absences: [], verdicts: [] } }] });
  } finally { await store.close?.(); }
}

test("startup session retries one failed metadata fetch through the pending recovery flight", async context => {
  const { factory, owner } = await queuedStartup(context);
  let manifests = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: factory },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/manifest" && ++manifests === 1) throw new TypeError("one metadata cut");
      return owner.fetch(input, init);
    } });
  try {
    await client.auth.login({ email: "alice@example.com", password: "password" });
    for (let i = 0; i < 20 && owner.executions.length === 0; i++) await flush();
    assert.equal(manifests, 2);
    assert.equal(owner.executions.length, 1);
    assert.equal(client.snapshot.auth.state, "authenticated");
  } finally { await client.close(); }
});

for (const outcome of ["failed", "successful"] as const) test(`live held reads wait for a ${outcome} startup login`, async context => {
  const factory = offlineStore(context);
  await seededPrivateStore(factory);
  const started = deferred<void>(), loginResponse = deferred<Response>();
  const events: any[] = [];
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: factory },
    fetch: async input => {
      if (String(input).endsWith("/login")) { started.resolve(); return loginResponse.promise; }
      throw new TypeError("cut");
    } });
  const attempt = client.auth.login({ email: "bob@example.com", password: "password" });
  const login = outcome === "failed" ? assert.rejects(attempt, (error: any) => error.code === "E_AUTH_INVALID") : attempt;
  let subscription: ReturnType<SnapbackClient["subscribe"]> | undefined;
  try {
    await started.promise;
    subscription = client.subscribe(api.deliveries.inbox, { c: null }, event => events.push(event));
    await flush(); await flush();
    assert.equal(events.some(event => event.data?.length), false, "live reads cannot flash predecessor rows during login");
    loginResponse.resolve(outcome === "failed" ? refusal("E_AUTH_INVALID")
      : json({ token: "token-b", viewer: "bob", kind: "user", authEpoch: 8 }));
    await login; await flush(); await flush();
    const data = events.flatMap(event => event.data ?? []);
    assert.deepEqual(data, outcome === "failed" ? [{ body: "Alice's private held message" }] : []);
  } finally { loginResponse.resolve(refusal("E_AUTH_INVALID")); await login; subscription?.close(); await client.close(); }
});

test("startup recovery waits for a queued successor login before choosing its bearer", async context => {
  const { factory, owner } = await queuedStartup(context);
  const bobStarted = deferred<void>(), bobResponse = deferred<Response>();
  let resumes = 0;
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: factory },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/login" && JSON.parse(String(init?.body)).email.startsWith("bob")) {
        bobStarted.resolve(); return bobResponse.promise;
      }
      if (path === "/api/resume") resumes++;
      return owner.fetch(input, init);
    } });
  const alice = client.auth.login({ email: "alice@example.com", password: "password" });
  const bob = client.auth.login({ email: "bob@example.com", password: "password" });
  try {
    await alice; await bobStarted.promise;
    for (let i = 0; i < 10; i++) await flush();
    assert.equal(resumes, 0, "Alice's recovery cannot dispatch after Bob's transition was queued");
    assert.equal(owner.executions.length, 0);
    bobResponse.resolve(json({ token: "token-b", viewer: "bob", kind: "user", authEpoch: 8 }));
    await bob; await flush();
    assert.equal(client.snapshot.auth.viewer, "bob");
    assert.equal(owner.executions.length, 0, "replacement wipes Alice's queue without replaying it");
  } finally { bobResponse.resolve(json({ token: "token-b", viewer: "bob", kind: "user", authEpoch: 8 })); await Promise.allSettled([alice, bob]); await client.close(); }
});

test("failed login during authenticated deferred resume restarts pending startup recovery", async context => {
  const { factory, owner } = await queuedStartup(context);
  const resumeStarted = deferred<void>(), oldResponse = deferred<Response>();
  let resumes = 0, saved: Response | undefined;
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: factory },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/login" && JSON.parse(String(init?.body)).password === "wrong") return refusal("E_AUTH_INVALID");
      const response = await owner.fetch(input, init);
      if (path === "/api/resume" && ++resumes === 1) {
        saved = response; resumeStarted.resolve(); return oldResponse.promise;
      }
      return response;
    } });
  try {
    await client.auth.login({ email: "alice@example.com", password: "password" });
    await resumeStarted.promise;
    assert.equal(client.snapshot.auth.state, "authenticated");
    await assert.rejects(client.auth.login({ email: "alice@example.com", password: "wrong" }), (error: any) => error.code === "E_AUTH_INVALID");
    for (let i = 0; i < 20 && owner.executions.length === 0; i++) await flush();
    assert.equal(resumes, 2, "a failed transition reschedules the startup work it aborted");
    assert.equal(owner.executions.length, 1);
    oldResponse.resolve(saved!); await flush(); await flush();
    assert.equal(owner.executions.length, 1, "the obsolete resume cannot replay twice");
  } finally { oldResponse.resolve(saved ?? json({})); await client.close(); }
});

for (const stage of ["manifest", "resume"] as const) for (const outcome of ["failed", "successful"] as const) {
  test(`${outcome} login cuts pending initial ${stage} without poisoning ready`, async context => {
    const { factory, owner } = await queuedStartup(context);
    const started = deferred<void>(), oldResponse = deferred<Response>();
    let held = false, saved: Response | undefined;
    let completion: Promise<unknown> | undefined;
    const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: factory },
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/auth/login" && outcome === "failed") return refusal("E_AUTH_INVALID");
        const response = await owner.fetch(input, init);
        if (path === `/api/${stage}` && !held) {
          held = true; saved = response; started.resolve(); return oldResponse.promise;
        }
        return response;
      } });
    try {
      await started.promise;
      assert.equal(client.snapshot.auth.state, "authenticated");
      const login = client.auth.login({ email: "alice@example.com", password: "password" });
      let settled = false;
      completion = (outcome === "failed" ? assert.rejects(login, (error: any) => error.code === "E_AUTH_INVALID") : login)
        .finally(() => { settled = true; });
      void completion.catch(() => undefined);
      for (let i = 0; i < 20 && !settled; i++) await flush();
      assert.equal(settled, true, "startup yields to the transition without waiting for the old response");
      await completion;
      await client.ready;
      for (let i = 0; i < 20 && owner.executions.length === 0; i++) await flush();
      assert.equal(owner.executions.length, 1, "recovery does not wait for the aborted transport to cooperate");
      oldResponse.resolve(saved!); await flush(); await flush();
      assert.equal(owner.executions.length, 1);
      assert.equal(client.snapshot.auth.state, "authenticated");
    } finally { oldResponse.resolve(saved ?? json({})); await completion?.catch(() => undefined); await client.close(); }
  });
}

test("completed startup recovery leaves ordinary past-fence relogin waiting for explicit resume", async context => {
  const { factory, owner } = await queuedStartup(context);
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"),
    offline: { store: factory, fenceDays: 1 }, fetch: owner.fetch });
  try {
    await client.auth.login({ email: "alice@example.com", password: "password" });
    for (let i = 0; i < 20 && owner.executions.length === 0; i++) await flush();
    assert.equal(owner.executions.length, 1);
    await client.outbox.settled();
    context.mock.timers.tick(2 * DAY);
    await client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "past the fence" });
    const resumes = owner.requests.filter(path => path === "/api/resume").length;
    await client.auth.login({ email: "alice@example.com", password: "password" });
    assert.equal(owner.requests.filter(path => path === "/api/resume").length, resumes);
    assert.equal((await client.outbox.drain()).stopped, "fence");
    assert.equal(owner.executions.length, 1, "the new grant alone never releases the old queue");
    await client.online();
    assert.equal(owner.executions.length, 2);
  } finally { await client.close(); }
});

for (const state of ["hydrating", "confirmed"] as const) test(`${state} held reads reject a transition that begins during carrier I/O`, async context => {
  const factory = offlineStore(context);
  await seededPrivateStore(factory);
  const readStarted = deferred<void>(), releaseRead = deferred<void>();
  const metadataStarted = deferred<void>(), metadata = deferred<Response>();
  let holdRead = true, holdMetadata = true;
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: () => {
    const store = factory(), answer = store.answer.bind(store);
    store.answer = async (op, args) => {
      const value = await answer(op, args);
      if (holdRead) { holdRead = false; readStarted.resolve(); await releaseRead.promise; }
      return value;
    };
    return store;
  } }, fetch: async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/auth/login") return refusal("E_AUTH_INVALID");
    if (path === "/api/auth/me" && state === "confirmed") return json({ viewer: "dev:alice", kind: "user", authEpoch: 7 });
    if (path === "/api/manifest" && holdMetadata) { holdMetadata = false; metadataStarted.resolve(); return metadata.promise; }
    throw new TypeError("cut");
  } });
  let read: Promise<void> | undefined;
  try {
    if (state === "hydrating") await restored(client); else await metadataStarted.promise;
    read = assert.rejects(client.query(api.deliveries.inbox, { c: null }), (error: any) => error.code === "E_AUTH_SUPERSEDED");
    await readStarted.promise;
    await assert.rejects(client.auth.login({ email: "alice@example.com", password: "wrong" }), (error: any) => error.code === "E_AUTH_INVALID");
    releaseRead.resolve();
    await read;
  } finally { releaseRead.resolve(); metadata.resolve(json({})); await read?.catch(() => undefined); await client.close(); }
});

for (const interruption of ["offline", "failed-login"] as const) test(`${interruption} wakes recovery waiters before an obsolete transport responds`, async context => {
  const { factory, owner } = await queuedStartup(context);
  const oldStarted = deferred<void>(), oldResponse = deferred<Response>(), newResponse = deferred<Response>();
  let resumes = 0, oldSaved: Response | undefined, newSaved: Response | undefined;
  let waiterDone = false, reconnectDone = false;
  const pending: Promise<unknown>[] = [];
  const client = createClient({ url: "http://auth.test", tokenStore: custody("dev:alice"), offline: { store: factory },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/login" && JSON.parse(String(init?.body)).password === "wrong") return refusal("E_AUTH_INVALID");
      const response = await owner.fetch(input, init);
      if (path === "/api/resume") {
        resumes++;
        if (resumes === 1) { oldSaved = response; oldStarted.resolve(); return oldResponse.promise; }
        if (resumes === 2) { newSaved = response; return newResponse.promise; }
      }
      return response;
    } });
  try {
    await client.auth.login({ email: "alice@example.com", password: "password" });
    await oldStarted.promise;
    if (interruption === "failed-login") {
      const waiter = client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "waiting through cancellation" })
        .then(value => { waiterDone = true; return value; });
      void waiter.catch(() => undefined); pending.push(waiter);
      await flush();
      assert.equal(waiterDone, false, "the existing caller waits on the original recovery barrier");
      await assert.rejects(client.auth.login({ email: "alice@example.com", password: "wrong" }), (error: any) => error.code === "E_AUTH_INVALID");
    } else {
      await client.offline();
      const reconnect = client.online().then(() => { reconnectDone = true; });
      void reconnect.catch(() => undefined); pending.push(reconnect);
    }
    for (let i = 0; i < 20 && !newSaved; i++) await flush();
    assert.equal(resumes, 2, "replacement recovery starts without the cancelled response");
    await flush(); await flush();
    assert.equal(waiterDone, false, "a woken caller joins the replacement barrier before dispatching");
    assert.equal(reconnectDone, false);
    assert.equal(owner.executions.length, 0);
    newResponse.resolve(newSaved!);
    for (let i = 0; i < 30 && !(interruption === "offline" ? reconnectDone : waiterDone); i++) await flush();
    assert.equal(interruption === "offline" ? reconnectDone : waiterDone, true, "even existing waiters finish while the old transport stays pending");
    await Promise.all(pending);
    await client.outbox.settled();
    assert.deepEqual(owner.executions.map(entry => (entry.args as any).body), interruption === "offline"
      ? ["held before startup"] : ["held before startup", "waiting through cancellation"]);
    const snapshot = client.snapshot, entries = await client.outbox.entries();
    oldResponse.resolve(interruption === "offline" ? refusal("E_AUTH_SESSION") : oldSaved!);
    await flush(); await flush();
    assert.deepEqual(client.snapshot, snapshot, "a late cancelled response cannot alter auth, connection, or lastRefusal");
    assert.deepEqual(await client.outbox.entries(), entries, "a late cancelled response cannot replay or alter settled intents");
  } finally {
    oldResponse.resolve(oldSaved ?? json({})); newResponse.resolve(newSaved ?? json({}));
    await Promise.allSettled(pending); await client.close();
  }
});

for (const stage of ["replay-fetch", "replay-body", "tail-fetch"] as const) {
  for (const interruption of ["offline", "failed-login"] as const) {
    test(`${interruption} releases the drain before cancelled ${stage} returns`, async context => {
      const bodies = ["first held intent", "second held intent"];
      const { factory, owner } = await queuedStartup(context, bodies);
      const started = deferred<void>(), release = deferred<void>();
      const replays: string[] = [];
      let held = false, resumed = false, done = false;
      let oldSignal: AbortSignal | null | undefined;
      let completion: Promise<unknown> | undefined;
      const store = custody("dev:alice");
      const client = createClient({ url: "http://auth.test", tokenStore: store, offline: { store: factory },
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === "/api/auth/login" && JSON.parse(String(init?.body)).password === "wrong") return refusal("E_AUTH_INVALID");
          if (path === "/api/resume") resumed = true;
          if (path === "/api/mutation") replays.push(String(init?.body));
          const response = await owner.fetch(input, init);
          const target = stage === "tail-fetch" ? path === "/api/query" && replays.length > 0 : path === "/api/mutation";
          if (resumed && target && !held) {
            held = true; oldSignal = init?.signal;
            if (stage === "replay-body") {
              const parse = response.json.bind(response);
              response.json = async () => { started.resolve(); await release.promise; return parse(); };
            } else { started.resolve(); await release.promise; }
          }
          return response;
        } });
      try {
        await client.auth.login({ email: "alice@example.com", password: "password" });
        await started.promise;
        assert.equal(owner.executions.length, 1, "the first intent committed before its response was withheld");
        assert.equal((await client.outbox.entries()).filter(entry => entry.state === "queued").length, 2);
        if (interruption === "offline") {
          await client.offline();
          completion = client.online().then(() => { done = true; });
        } else {
          completion = client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "waiting behind recovery" })
            .then(value => { done = true; return value; });
          void completion.catch(() => undefined);
          await flush();
          assert.equal(done, false);
          await assert.rejects(client.auth.login({ email: "alice@example.com", password: "wrong" }), (error: any) => error.code === "E_AUTH_INVALID");
        }
        void completion.catch(() => undefined);
        assert.equal(oldSignal?.aborted, true);
        for (let i = 0; i < 30 && !done; i++) await flush();
        assert.equal(done, true, "replacement recovery and its waiter must finish with the old replay still withheld");
        await completion;
        assert.deepEqual(await client.outbox.settled(), { stopped: false, remaining: 0 });
        assert.equal(replays[1], replays[0], "replacement retries the exact committed envelope before advancing FIFO");
        assert.deepEqual(owner.executions.map(entry => (entry.args as any).body), interruption === "offline"
          ? bodies : [...bodies, "waiting behind recovery"]);
        assert.equal(owner.messages.size, interruption === "offline" ? 2 : 3, "each intent executes exactly once");
        const snapshot = client.snapshot, entries = await client.outbox.entries(), requests = replays.length;
        release.resolve(); await flush(); await flush();
        assert.deepEqual(client.snapshot, snapshot, "late cancelled replay cannot change auth or sync status");
        assert.deepEqual(await client.outbox.entries(), entries, "late cancelled replay cannot settle an intent again");
        assert.equal(replays.length, requests, "the obsolete drain cannot advance after its late response");
        assert.equal(store.load(), snapshot.token);
      } finally { release.resolve(); await completion?.catch(() => undefined); await client.close(); }
    });
  }
}

for (const body of ["terminal-refusal", "invalid-refusal-json", "invalid-success-json"] as const) {
  test(`cancelled resume ignores delayed ${body} after replacement recovery`, async context => {
    const { factory, owner } = await queuedStartup(context);
    const started = deferred<void>(), release = deferred<void>();
    const store = custody("dev:alice");
    let held = false, parsed = false, done = false;
    let oldSignal: AbortSignal | null | undefined;
    let reconnect: Promise<void> | undefined;
    const client = createClient({ url: "http://auth.test", tokenStore: store, offline: { store: factory },
      fetch: async (input, init) => {
        if (new URL(String(input)).pathname === "/api/resume" && !held) {
          held = true; oldSignal = init?.signal;
          const response = body === "terminal-refusal" ? refusal("E_AUTH_SESSION")
            : new Response("invalid JSON", { status: body === "invalid-refusal-json" ? 401 : 200 });
          const parse = response.json.bind(response);
          response.json = async () => {
            started.resolve(); await release.promise;
            try { return await parse(); } finally { parsed = true; }
          };
          return response;
        }
        return owner.fetch(input, init);
      } });
    try {
      await client.auth.login({ email: "alice@example.com", password: "password" });
      await started.promise;
      await client.offline();
      reconnect = client.online().then(() => { done = true; });
      void reconnect.catch(() => undefined);
      for (let i = 0; i < 30 && !done; i++) await flush();
      assert.equal(done, true, "replacement recovery completes before the old body is released");
      await reconnect;
      await client.outbox.settled();
      assert.equal(oldSignal?.aborted, true);
      assert.equal(parsed, false);
      assert.equal(client.snapshot.auth.state, "authenticated");
      assert.equal(owner.executions.length, 1);
      const snapshot = client.snapshot, entries = await client.outbox.entries(), status = await client.outbox.status();
      const token = store.load(), binding = store.loadPrincipalBinding();
      release.resolve();
      for (let i = 0; i < 30 && !parsed; i++) await flush();
      assert.equal(parsed, true);
      await flush(); await flush();
      assert.equal(store.load(), token, "cancelled resume cannot clear recovered bearer custody");
      assert.deepEqual(store.loadPrincipalBinding(), binding);
      assert.deepEqual(client.snapshot, snapshot, "late parsing cannot alter auth, connection, or lastRefusal");
      assert.deepEqual(await client.outbox.status(), status, "cancelled resume cannot seal the recovered partition");
      assert.deepEqual(await client.outbox.entries(), entries);
      assert.equal(owner.executions.length, 1);
    } finally { release.resolve(); await reconnect?.catch(() => undefined); await client.close(); }
  });
}

for (const stage of ["replay-fetch", "replay-body", "tail-fetch"] as const) {
  for (const interruption of ["offline", "failed-login", "close", "expiry"] as const) {
    test(`${interruption} releases a mutation-owned drain during ignored ${stage} abort`, async context => {
      const factory = offlineStore(context), owner = fakeOwner(), store = custody("dev:alice");
      await seededStore(factory);
      const started = deferred<void>(), release = deferred<void>();
      const replays: string[] = [];
      let armed = false, held = false, mutationDone = false, transitionDone = false;
      let oldSignal: AbortSignal | null | undefined;
      let mutation: Promise<unknown> | undefined, transition: Promise<unknown> | undefined;
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/auth/login" && interruption === "failed-login") return refusal("E_AUTH_INVALID");
        if (path === "/api/upload") return refusal("E_AUTH_SESSION");
        if (path === "/api/mutation") replays.push(String(init?.body));
        const response = await owner.fetch(input, init);
        const target = stage === "tail-fetch" ? path === "/api/query" && replays.length > 0 : path === "/api/mutation";
        if (armed && target && !held) {
          held = true; oldSignal = init?.signal;
          if (stage === "replay-body") {
            const parse = response.json.bind(response);
            response.json = async () => { started.resolve(); await release.promise; return parse(); };
          } else { started.resolve(); await release.promise; }
        }
        return response;
      };
      const options = { url: "http://auth.test", tokenStore: store, offline: { store: factory }, fetch };
      const client = createClient(options);
      let successor: SnapbackClient | undefined;
      try {
        await client.ready; await client.auth.me(); await client.outbox.settled();
        armed = true;
        mutation = client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "direct online send" })
          .then(value => { mutationDone = true; return value; }, error => { mutationDone = true; return error; });
        await started.promise;
        assert.equal(owner.executions.length, 1, "the request committed before its response or tail was withheld");
        assert.equal((await client.outbox.entries()).filter(entry => entry.state === "queued").length, 1);
        transition = (interruption === "failed-login"
          ? assert.rejects(client.auth.login({ email: "alice@example.com", password: "wrong" }), (error: any) => error.code === "E_AUTH_INVALID")
          : interruption === "expiry" ? assert.rejects(client.upload(new File(["a"], "photo.png")), (error: any) => error.code === "E_AUTH_SESSION")
          : interruption === "close" ? client.close() : client.offline()).then(() => { transitionDone = true; });
        void transition.catch(() => undefined);
        for (let i = 0; i < 30 && !(mutationDone && transitionDone); i++) await flush();
        assert.equal(oldSignal?.aborted, true, "every mutation drain carries the cancellation signal");
        assert.equal(mutationDone, true, "the tracked write must release without the obsolete transport cooperating");
        assert.equal(transitionDone, true, "auth transition must not remain behind the tracked write");
        await transition; await mutation;
        if (interruption === "expiry") {
          assert.equal(store.load(), null); assert.equal(client.snapshot.auth.state, "anonymous");
          await assert.rejects(client.outbox.settled(), (error: any) => error.name === "AbortError");
          await client.auth.login({ email: "alice@example.com", password: "password" });
        }
        let active = client;
        if (interruption === "close") { successor = createClient(options); active = successor; await successor.ready; }
        else await client.online();
        assert.deepEqual(await active.outbox.settled(), { stopped: false, remaining: 0 });
        assert.equal(replays[1], replays[0], "recovery retries the same envelope after the uncertain commit");
        assert.equal(owner.executions.length, 1, "the committed intent executes exactly once");
        const snapshot = active.snapshot, entries = await active.outbox.entries(), requests = replays.length;
        release.resolve(); await flush(); await flush();
        assert.deepEqual(active.snapshot, snapshot);
        assert.deepEqual(await active.outbox.entries(), entries);
        assert.equal(replays.length, requests, "the obsolete drain cannot advance or settle again");
      } finally {
        release.resolve(); await Promise.allSettled([mutation, transition]);
        await client.close(); await successor?.close();
      }
    });
  }
}

for (const automatic of [false, true]) for (const stage of ["fetch", "body"] as const) {
  for (const replacement of ["failed", "successful"] as const) {
    test(`${automatic ? "automatic" : "direct"} upload retains terminal ${stage} evidence during ${replacement} login`, async context => {
      const factory = offlineStore(context), owner = fakeOwner(), store = custody("dev:alice");
      await seededStore(factory);
      const started = deferred<void>(), release = deferred<void>();
      const saves: Array<string | null> = [], save = store.save;
      store.save = value => { saves.push(value); save(value); };
      const client = createClient({ url: "http://auth.test", tokenStore: store, offline: { store: factory },
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (path === "/api/upload") {
            const response = refusal("E_AUTH_SESSION");
            if (stage === "body") {
              const parse = response.json.bind(response);
              response.json = async () => { started.resolve(); await release.promise; return parse(); };
            } else { started.resolve(); await release.promise; }
            return response;
          }
          if (path === "/api/auth/login" && replacement === "failed") return refusal("E_AUTH_INVALID");
          const response = await owner.fetch(input, init);
          if (path === "/api/manifest") {
            const value = await response.json();
            value.ops["deliveries.post"] = { kind: "mutation", planHash: "f".repeat(64), args: { photo: { Image: { max: 16 } } } };
            return json(value);
          }
          return response;
        } });
      let upload: Promise<any> | undefined, login: Promise<any> | undefined;
      try {
        await client.ready; await client.auth.me(); await client.outbox.settled();
        const source = new File(["a"], "photo.png");
        upload = (automatic ? client.mutation(api.deliveries.post, { photo: source }) : client.upload(source))
          .then(value => value, error => error);
        await started.promise;
        login = client.auth.login({ email: "alice@example.com", password: "password" }).then(value => value, error => error);
        release.resolve();
        assert.equal((await upload).code, "E_AUTH_SUPERSEDED");
        await login;
        assert.ok(saves.includes(null), "terminal evidence must clear captured custody before the transition completes");
        if (replacement === "failed") {
          assert.equal(store.load(), null); assert.equal(client.snapshot.auth.state, "anonymous");
          assert.equal((await client.outbox.status()).reason, "sealed", "expired offline custody stays sealed");
        } else {
          assert.equal(store.load(), "token-alice"); assert.equal(client.snapshot.auth.state, "authenticated");
          assert.equal(saves.at(-1), "token-alice", "predecessor evidence cannot clear installed successor custody");
        }
      } finally { release.resolve(); await Promise.allSettled([upload, login]); await client.close(); }
    });
  }
}

for (const format of ["HTTP 401", "typed HTTP 200"] as const) for (const stage of ["replay", "tail"] as const) {
  test(`${format} terminal ${stage} cancels sibling drains while preserving its own refusal`, async context => {
    const factory = offlineStore(context), owner = fakeOwner(), store = custody("dev:alice");
    await seededStore(factory);
    const started = deferred<void>(), release = deferred<void>();
    let armed = false, mutations = 0, originSignal: AbortSignal | null | undefined;
    const client = createClient({ url: "http://auth.test", tokenStore: store, offline: { store: factory },
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/mutation") mutations++;
        if (armed && (stage === "replay" ? path === "/api/mutation" : path === "/api/query" && mutations > 0)) {
          originSignal = init?.signal; started.resolve(); await release.promise;
          return format === "HTTP 401" ? refusal("E_AUTH_SESSION")
            : json({ state: stage === "replay" ? "rejected" : "refused", code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth/session" });
        }
        return owner.fetch(input, init);
      } });
    let mutation: Promise<any> | undefined, sibling: Promise<any> | undefined;
    try {
      await client.ready; await client.auth.me(); await client.outbox.settled(); armed = true;
      mutation = client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "terminal" }).catch(error => error);
      await started.promise;
      sibling = client.outbox.drain().catch(error => error);
      await flush(); release.resolve();
      assert.equal((await mutation).code, "E_AUTH_SESSION", "originating terminal evidence must not become AbortError");
      assert.equal(originSignal?.aborted, false);
      assert.equal((await sibling).name, "AbortError", "the queued sibling drain must be released by expiry");
      assert.equal(store.load(), null); assert.equal(client.snapshot.lastRefusal?.code, "E_AUTH_SESSION");
      assert.equal((await client.outbox.status()).reason, "sealed");
    } finally { release.resolve(); await Promise.allSettled([mutation, sibling]); await client.close(); }
  });
}

for (const format of ["HTTP 401", "typed HTTP 200"] as const) for (const stage of ["replay", "tail"] as const) {
  test(`${format} FIFO ${stage} expiry reaches the new mutation before enqueue and keeps only the older intent`, async context => {
    const factory = offlineStore(context), owner = fakeOwner(), store = custody("dev:alice");
    await seededStore(factory);
    let mode: "transport" | "expiry" | "recovery" = "transport";
    const replays: string[] = [];
    const terminal = (intent?: string) => format === "HTTP 401" ? refusal("E_AUTH_SESSION")
      : json({ state: stage === "replay" ? "rejected" : "refused", code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth/session", ...(intent ? { intent } : {}) });
    const client = createClient({ url: "http://auth.test", tokenStore: store, offline: { store: factory },
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/mutation") {
          replays.push(String(init?.body));
          if (mode === "transport") return new Response("cut", { status: 503 });
          if (mode === "expiry" && stage === "replay") return terminal(JSON.parse(String(init?.body)).intent);
        }
        if (mode === "expiry" && stage === "tail" && path === "/api/query") return terminal();
        return owner.fetch(input, init);
      } });
    try {
      await client.ready; await client.auth.me(); await client.outbox.settled();
      const older = await client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "older durable intent" });
      assert.equal(older.state, "queued");
      const queued = await client.outbox.entries();
      assert.equal(queued.length, 1); assert.equal(queued[0].state, "queued");
      mode = "expiry";
      await assert.rejects(client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "new unaccepted intent" }),
        (error: any) => error.code === "E_AUTH_SESSION", "FIFO session death is not an older intent's ordinary refusal");
      await assert.rejects(client.outbox.settled(), (error: any) => error.code === "E_AUTH_SESSION");
      assert.equal(client.snapshot.lastRefusal?.code, "E_AUTH_SESSION");
      assert.equal(client.snapshot.auth.state, "anonymous"); assert.equal(store.load(), null);
      assert.equal((await client.outbox.status()).reason, "sealed");
      assert.equal(replays.length, 2); assert.equal(replays[1], replays[0]);
      mode = "recovery";
      await client.auth.login({ email: "alice@example.com", password: "password" }); await client.online();
      assert.deepEqual(await client.outbox.settled(), { stopped: false, remaining: 0 });
      assert.equal(replays[2], replays[0], "recovery must retry the exact older envelope");
      assert.deepEqual(owner.executions.map(entry => (entry.args as any).body), ["older durable intent"],
        "the refused new call must never have entered durable custody or reached the owner");
      assert.equal(owner.messages.size, 1, "a tail failure after commit still executes the older intent only once");
      assert.equal(store.load(), "token-alice");
    } finally { await client.close(); }
  });
}


test("typed HTTP 200 resume expiry seals queued custody and retries the exact envelope after login", async context => {
  const factory = offlineStore(context), owner = fakeOwner(), store = custody("dev:alice");
  await seededStore(factory);
  let expire = false;
  const replays: string[] = [];
  const client = createClient({ url: "http://auth.test", tokenStore: store, offline: { store: factory },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (expire && path === "/api/resume") return json({ state: "refused", code: "E_AUTH_SESSION",
        family: "auth", message: "expired at resume", guide: "auth/session" });
      if (path === "/api/mutation") replays.push(String(init?.body));
      return owner.fetch(input, init);
    } });
  try {
    await client.ready; await client.auth.me(); await client.outbox.settled(); await client.offline();
    assert.equal((await client.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "resume survivor" })).state, "queued");
    const before = await client.outbox.entries();
    expire = true;
    await assert.rejects(client.online(), (error: any) => error.code === "E_AUTH_SESSION");
    assert.equal(client.snapshot.auth.state, "anonymous"); assert.equal(store.load(), null);
    assert.equal(client.snapshot.lastRefusal?.code, "E_AUTH_SESSION");
    assert.equal((await client.outbox.status()).reason, "sealed"); assert.equal(replays.length, 0);
    expire = false;
    await client.auth.login({ email: "alice@example.com", password: "password" }); await client.online();
    assert.deepEqual(await client.outbox.settled(), { stopped: false, remaining: 0 });
    assert.equal(replays.length, 1);
    const replay = JSON.parse(replays[0]);
    for (const key of ["intent", "op", "args", "grant", "ids", "trace", "issuedSeq"] as const) {
      assert.deepEqual(replay[key], before[0][key], `resume preserves ${key}`);
    }
    assert.deepEqual(owner.executions.map(entry => (entry.args as any).body), ["resume survivor"]);
  } finally { await client.close(); }
});

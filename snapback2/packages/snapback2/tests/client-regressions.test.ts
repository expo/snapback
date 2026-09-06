import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { SnapbackRefusal, api, createClient } from "../dist/client.mjs";
import { SnapbackProvider, useAuth, useMutation } from "../dist/react.mjs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function fetchJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const refusal = (code: string, message: string) => ({
  code,
  family: "auth",
  message,
  guide: "auth/session",
});

// RN 0.81 loads this constructor from whatwg-fetch; expo/fetch returns its own
// streaming response. Use the actual dependency, retaining Node's Response only
// for the fetch fixture so its body models Expo's separate FetchResponse.body.
function nativeLive(context: import("node:test").TestContext) {
  const require = createRequire(import.meta.url);
  const nativeRequire = createRequire(require.resolve("react-native/package.json"));
  const { Response: NativeResponse } = nativeRequire("whatwg-fetch");
  const StreamingResponse = globalThis.Response;
  const probeBody = new ReadableStream();
  const probe = new NativeResponse(probeBody);
  assert.equal(probe.ok, true);
  assert.equal("body" in probe, false);
  assert.equal(probe._bodyInit, probeBody);
  assert.equal(probe._bodyText, "[object ReadableStream]");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Response")!;
  Object.defineProperty(globalThis, "Response", { ...descriptor, value: NativeResponse });
  context.after(() => Object.defineProperty(globalThis, "Response", descriptor));

  const session = "a".repeat(64);
  const controls: Array<{ add?: Array<{ id: string; path: string }>; remove?: string[]; close?: boolean }> = [];
  const requests: Array<{ path: string; authorization: string | null }> = [];
  let output!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = 0;
  let signal: AbortSignal | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { output = controller; },
    cancel() { cancelled++; },
  });
  const send = (frame: unknown) => output.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));
  const json = (value: unknown) => new StreamingResponse(JSON.stringify(value));
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, authorization: new Headers(init?.headers).get("Authorization") });
    if (path === "/api/auth/me") return json({ viewer: "principal-a", kind: "account" });
    if (path === "/api/live") {
      signal = init?.signal ?? undefined;
      assert.equal(init?.body, "{}");
      send({ session });
      return new StreamingResponse(body);
    }
    assert.equal(path, "/api/live/control");
    const command = JSON.parse(String(init?.body));
    assert.equal(command.session, session);
    controls.push(command);
    return json({ ok: true });
  };
  return {
    fetch, send, controls, requests, body,
    get cancelled() { return cancelled; },
    get signal() { return signal; },
    child(fragment: string) {
      const entry = controls.flatMap(command => command.add ?? []).find(entry => entry.path.includes(fragment));
      assert.ok(entry, `missing logical subscription ${fragment}`);
      return entry.id;
    },
  };
}

async function waitForNative(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), "native transport condition timed out");
}

test("native Response preserves shared query/channel delivery and independent terminal refusals", async context => {
  const wire = nativeLive(context);
  const value = createClient({ url: "http://native.test", as: "alice", fetch: wire.fetch });
  const queries: unknown[] = [], channels: unknown[] = [];
  const query = value.subscribe(api.messages.thread, {}, event => queries.push(event));
  const channel = value.channel(api.typing, {}).subscribe(event => channels.push(event));
  try {
    await waitForNative(() => wire.controls.flatMap(command => command.add ?? []).length === 2);
    const queryId = wire.child("/api/subscribe?"), channelId = wire.child("/api/channel/");
    const row = { state: "complete", data: [{ body: "native history" }], seq: 1, next: null };
    const typing = { from: "principal-b", payload: { typing: true }, at: 10 };
    wire.send({ id: channelId, seq: null, data: typing, terminal: false });
    wire.send({ id: queryId, seq: 1, data: row, terminal: false });
    await waitForNative(() => queries.length > 0 || value.snapshot.lastRefusal !== undefined);
    assert.equal(value.snapshot.lastRefusal, undefined);
    await query.until(event => event.state === "complete", 1_000);
    await channel.until(event => "payload" in event, 1_000);
    assert.deepEqual(queries, [{ ...row, live: true }]);
    assert.deepEqual(channels, [typing]);

    const denied = { state: "refused", code: "E_RULE", family: "rule", guide: "rule/runtime", message: "membership removed" };
    wire.send({ id: queryId, seq: null, data: denied, terminal: true });
    await assert.rejects(query.until(() => false, 1_000), error => error instanceof SnapbackRefusal && error.code === "E_RULE");
    wire.send({ id: queryId, seq: 2, data: { ...row, seq: 2 }, terminal: false });
    wire.send({ id: channelId, seq: null, data: { ...typing, at: 11 }, terminal: false });
    await channel.until(event => "at" in event && event.at === 11, 1_000);
    assert.deepEqual(queries, [{ ...row, live: true }, { ...denied, live: false }]);
    assert.deepEqual(channels, [typing, { ...typing, at: 11 }]);
    wire.send({ id: channelId, seq: null, data: denied, terminal: true });
    await assert.rejects(channel.until(() => false, 1_000), error => error instanceof SnapbackRefusal && error.code === "E_RULE");
    assert.deepEqual(channels.at(-1), denied);
    await waitForNative(() => [queryId, channelId].every(id => wire.controls.some(command => command.remove?.includes(id))));
    assert.equal(wire.requests.filter(request => request.path === "/api/live").length, 1);
    assert.equal(wire.signal?.aborted, false);
  } finally { await value.close(); }
  await waitForNative(() => wire.cancelled === 1 && !wire.body.locked);
  assert.equal(wire.signal?.aborted, true);
  assert.ok(wire.controls.some(command => command.close));
});

test("native Response cancellation keeps peers live and preserves removed-child session evidence", async context => {
  const wire = nativeLive(context);
  let stored: string | null = "native-bearer";
  const value = createClient({ url: "http://native.test", fetch: wire.fetch,
    tokenStore: { load: () => stored, save: token => { stored = token; } } });
  const queries: unknown[] = [], channels: unknown[] = [];
  try {
    await value.ready;
    const query = value.subscribe(api.messages.thread, {}, event => queries.push(event));
    const channel = value.channel(api.typing, {}).subscribe(event => channels.push(event));
    await waitForNative(() => wire.controls.flatMap(command => command.add ?? []).length === 2);
    const queryId = wire.child("/api/subscribe?"), channelId = wire.child("/api/channel/");
    const row = { state: "complete", data: [], seq: 1, next: null };
    wire.send({ id: queryId, seq: 1, data: row, terminal: false });
    await waitForNative(() => queries.length > 0 || value.snapshot.lastRefusal !== undefined);
    assert.equal(value.snapshot.lastRefusal, undefined);
    await query.until(event => event.state === "complete", 1_000);
    const pending = query.until(() => false, 1_000);
    query.close();
    await assert.rejects(pending, { name: "AbortError" });
    await waitForNative(() => wire.controls.some(command => command.remove?.includes(queryId)));
    wire.send({ id: queryId, seq: 2, data: { ...row, seq: 2 }, terminal: false });
    const typing = { from: "principal-b", payload: { typing: true }, at: 20 };
    wire.send({ id: channelId, seq: null, data: typing, terminal: false });
    await channel.until(event => "at" in event && event.at === 20, 1_000);
    assert.deepEqual(queries, [{ ...row, live: true }]);
    assert.deepEqual(channels, [typing]);
    assert.equal(wire.signal?.aborted, false);
    // A removed child's bytes may already be in flight. Ordinary data is
    // suppressed, but terminal evidence still retires that exact bearer.
    wire.send({ id: queryId, seq: null, data: { state: "refused", ...refusal("E_AUTH_SESSION", "expired") }, terminal: true });
    await waitForNative(() => stored === null && value.snapshot.token === undefined);
    assert.deepEqual(queries, [{ ...row, live: true }]);
    assert.equal(wire.requests.filter(request => request.path === "/api/live").length, 1);
  } finally { await value.close(); }
  await waitForNative(() => wire.cancelled === 1 && !wire.body.locked);
  assert.ok(wire.controls.some(command => command.close));
  assert.ok(wire.requests.every(request => request.authorization === "Bearer native-bearer"));
});

test("status listener exceptions cannot leak registration or break peers", async () => {
  let generation = 0;
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({
      generation: `g${++generation}`,
      programGeneration: `pg${generation}`,
      ops: {},
      channels: {},
      auth: {},
    }),
  });
  let initialThrows = 0;
  assert.throws(
    () => value.subscribeStatus(() => {
      initialThrows += 1;
      throw new Error("initial observer failure");
    }),
    /initial observer failure/,
  );
  await value.manifest();
  assert.equal(initialThrows, 1, "an initial-throw listener remained registered");

  let armed = false;
  let throwingDeliveries = 0;
  let peerDeliveries = 0;
  const stopThrowing = value.subscribeStatus(() => {
    throwingDeliveries += 1;
    if (armed) throw new Error("later observer failure");
  });
  const stopPeer = value.subscribeStatus(() => { peerDeliveries += 1; });
  armed = true;
  await value.manifest();
  assert.ok(throwingDeliveries > 1);
  assert.ok(peerDeliveries > 1, "a throwing listener suppressed a later peer");
  stopThrowing();
  stopPeer();
  value.close();
});

test("useMutation treats malformed successful bodies as ambiguous transport", async () => {
  let current: any;
  let attempts = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: "test", programGeneration: "program", ops: {}, channels: {}, auth: {} });
    }
    attempts += 1;
    if (attempts === 1) {
      return fetchJson({ state: "committed", seq: 1, data: { id: "message-1" } });
    }
    if (attempts === 2) {
      return new Response('{"state":"committed"', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return fetchJson({ state: "committed", data: { id: "message-3" } });
  };
  function Harness() {
    current = useMutation(api.messages.send);
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://wire.test", fetch },
      React.createElement(Harness),
    ));
  });
  await act(async () => { await current.run({}); });
  const committed = current.last;
  for (const expectedAttempt of [2, 3]) {
    let ambiguous: unknown;
    await act(async () => {
      await assert.rejects(
        () => current.run({}),
        (error: unknown) => {
          ambiguous = error;
          return error instanceof SnapbackRefusal
            && error.code === "E_WIRE_SHAPE"
            && error.retryable === true;
        },
      );
    });
    assert.equal(attempts, expectedAttempt, "mutation response decoding retried the write");
    assert.strictEqual(current.last, committed);
    assert.strictEqual(current.transport, ambiguous);
  }
  await act(async () => { renderer!.unmount(); });
});

test("useAuth ignores stale me responses after logout and client replacement", async () => {
  let auth: any;
  let releaseLogoutMe: ((response: Response) => void) | undefined;
  let logoutMeCalls = 0;
  const logoutFetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: "old", programGeneration: "old-program", ops: {}, channels: {}, auth: {} });
    }
    if (path === "/api/auth/logout") return fetchJson({ ok: true });
    if (path === "/api/auth/me") {
      logoutMeCalls += 1;
      if (logoutMeCalls === 1) {
        return await new Promise<Response>((resolve) => { releaseLogoutMe = resolve; });
      }
      return fetchJson(refusal("E_AUTH_REQUIRED", "signed out"), 401);
    }
    throw new Error(`unexpected route ${path}`);
  };
  function Harness() {
    auth = useAuth();
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://old.test", token: "old-token", fetch: logoutFetch },
      React.createElement(Harness),
    ));
    await Promise.resolve();
  });
  assert.ok(releaseLogoutMe, "initial auth/me was not in flight");
  await act(async () => { await auth.logout(); });
  assert.equal(auth.state, "anonymous");
  await act(async () => {
    releaseLogoutMe!(fetchJson({ viewer: "old-viewer", kind: "user" }));
    await Promise.resolve();
  });
  assert.equal(auth.state, "anonymous");
  assert.notEqual(auth.viewer, "old-viewer");
  await act(async () => { renderer!.unmount(); });

  let releaseOldClient: ((response: Response) => void) | undefined;
  const oldFetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: "old", programGeneration: "old-program", ops: {}, channels: {}, auth: {} });
    }
    return await new Promise<Response>((resolve) => { releaseOldClient = resolve; });
  };
  const newFetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: "new", programGeneration: "new-program", ops: {}, channels: {}, auth: {} });
    }
    if (path === "/api/auth/me") return fetchJson({ viewer: "new-viewer", kind: "user" });
    throw new Error(`unexpected route ${path}`);
  };
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://old-client.test", fetch: oldFetch },
      React.createElement(Harness),
    ));
    await Promise.resolve();
  });
  assert.ok(releaseOldClient, "old client auth/me was not in flight");
  await act(async () => {
    renderer!.update(React.createElement(
      SnapbackProvider,
      { url: "http://new-client.test", fetch: newFetch },
      React.createElement(Harness),
    ));
    await Promise.resolve();
  });
  assert.equal(auth.viewer, "new-viewer");
  await act(async () => {
    releaseOldClient!(fetchJson({ viewer: "old-client-viewer", kind: "user" }));
    await Promise.resolve();
  });
  assert.equal(auth.viewer, "new-viewer");
  await act(async () => { renderer!.unmount(); });
});

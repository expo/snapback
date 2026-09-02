import assert from "node:assert/strict";
import { test } from "node:test";
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

test("status listener exceptions cannot leak registration or break peers", async () => {
  let generation = 0;
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({
      generation: `g${++generation}`,
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
      return fetchJson({ generation: "test", ops: {}, channels: {}, auth: {} });
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
      return fetchJson({ generation: "old", ops: {}, channels: {}, auth: {} });
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
      return fetchJson({ generation: "old", ops: {}, channels: {}, auth: {} });
    }
    return await new Promise<Response>((resolve) => { releaseOldClient = resolve; });
  };
  const newFetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: "new", ops: {}, channels: {}, auth: {} });
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

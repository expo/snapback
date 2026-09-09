import { assertRefused } from "./live-fixture.ts";
import { isRefusalError } from "../dist/client-observed-test.mjs";
import { subscribe } from "../src/internal.js";
import { createClient as realClient } from "../dist/client.mjs";
import { fixtureClient as createClient, multiplexFetch, channelFrame } from "./live-fixture.ts";
import assert from "node:assert/strict";
import { MockOwner } from "./mock-owner.ts";
import { test, before, after } from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api,
  stableSerialize,
  type SnapbackClient } from "../dist/client.mjs";
import { RefusalError } from "../dist/client-observed-test.mjs";
import {
  SnapbackProvider,
  initialQueryState,
  reduceQueryState,
  useMutation,
  useQuery,
} from "../dist/react.mjs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const refusal = (code: string, message: string) => ({
  code,
  family: code.startsWith("E_AUTH") ? "auth" : "op",
  message,
  guide: code.startsWith("E_AUTH") ? "auth/session" : "op/reference",
});

function fetchJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchSse(...values: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const [index, value] of values.entries()) {
        controller.enqueue(encoder.encode(`id: ${index + 1}\ndata: ${JSON.stringify(value)}\n\n`));
      }
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function hangingSse(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function heartbeatSse(): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"state":"complete","data":[],"seq":1,"next":null}\n\n'));
      let heartbeats = 0;
      timer = setInterval(() => {
        heartbeats += 1;
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
        if (heartbeats === 4) {
          clearInterval(timer);
          timer = undefined;
          controller.enqueue(encoder.encode('data: {"state":"complete","data":[],"seq":2,"next":null}\n\n'));
        }
      }, 10);
    },
    cancel() {
      if (timer !== undefined) clearInterval(timer);
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function isWireShape(error: any, missing: string): boolean {
  const refusal = isRefusalError(error) ? error.envelope : error;
  return refusal?.code === "E_WIRE_SHAPE" && refusal.family === "op" && refusal.message.includes(missing);

}

const externalUrl = process.env.SNAPBACK_URL;
const owner = new MockOwner();
let url = externalUrl ?? "";
const clients = new Set<SnapbackClient>();

function client(options: Record<string, unknown> = {}): SnapbackClient {
  const value = createClient({ url, ...options });
  clients.add(value);
  return value;
}

before(async () => {
  if (!externalUrl) {
    await owner.start();
    url = owner.url;
  }
});

after(async () => {
  for (const value of clients) value.close();
  if (!externalUrl) await owner.stop();
});
test("default fetch preserves the browser receiver for JSON and SSE", async (context) => {
  const paths: string[] = [];
  const source = async function (this: unknown, input: string | URL | Request) {
    assert.equal(this, globalThis, "browser fetch requires its global receiver");
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path === "/api/auth/me") return fetchJson({ viewer: "alice", kind: "auth" });
    if (path === "/api/query") return fetchJson({ state: "complete", data: [], seq: 1, next: null });
    if (path === "/api/subscribe") return hangingSse('data: {"state":"complete","data":[],"seq":1,"next":null}\n\n');
    throw new Error(`unexpected route ${path}`);
  };
  const fixture = multiplexFetch(source.bind(globalThis));
  context.mock.method(globalThis, "fetch", function (this: unknown, ...args: Parameters<typeof fetch>) {
    assert.equal(this, globalThis, "physical browser fetch requires its global receiver");
    return fixture(...args);
  });
  const value = realClient({ url: "http://browser.test", token: "fixture" });
  context.after(() => value.close());
  assert.equal((await value.auth.me()).viewer, "alice");
  assert.equal((await value.query(api.messages.thread, {})).state, "complete");
  const sub = subscribe(value, api.messages.thread, {}, () => undefined);
  context.after(() => sub.close());
  await sub.until(delivery => delivery.state === "complete", 500);
  assert.deepEqual(paths, ["/api/auth/me", "/api/query", "/api/subscribe"]);
});
test("api proxy produces inert qualified operation references", async () => {
  assert.equal(api.messages.thread.op, "messages.thread");
  assert.equal(api.channels.typing.op, "channels.typing");
  assert.equal(api.channels.op.op, "channels.op");
  assert.equal(api.channels.then, undefined);
  assert.equal(api.channels.toJSON.op, "channels.toJSON");
  assert.deepEqual(JSON.parse(JSON.stringify(api.messages.thread)), { op: "messages.thread" });
  assert.deepEqual(await Promise.all([api.messages.thread]), [api.messages.thread]);
});
test("api proxy preserves operations named like proxy metadata", async () => {
  const seen: string[] = [];
  const value = createClient({
    url: "http://wire.test",
    fetch: async (_input, init) => {
      seen.push(JSON.parse(String(init?.body)).op);
      return fetchJson({ state: "complete", seq: seen.length, data: true, next: null });
    },
  });
  for (const ref of [api.messages.op, api.messages.toJSON, api.op.list, api.toJSON.list]) {
    assert.equal((await value.query(ref, {})).state, "complete");
  }
  assert.deepEqual(seen, ["messages.op", "messages.toJSON", "op.list", "toJSON.list"]);
  value.close();
});
test("guest, signup, login, logout, me, token memory, and persistence", async () => {
  const persisted: Array<string | null> = [];
  const guestClient = client({
    tokenStore: {
      load: () => null,
      save: (token: string | null) => { persisted.push(token); },
    },
  });
  const guest = await guestClient.auth.guest();
  assert.ok(guest.token.length > 0);
  assert.equal((await guestClient.auth.me()).kind, "guest");
  assert.equal(guestClient.snapshot.token, guest.token);
  assert.equal((await guestClient.auth.logout()).ok, true);
  assert.equal(guestClient.snapshot.token, undefined);
  assert.deepEqual(persisted, [guest.token, null]);
  await assert.rejects(() => guestClient.auth.me(), (error: unknown) =>
    isRefusalError(error) && error.envelope.code === "E_AUTH_REQUIRED");

  const signupClient = client();
  const email = `lane-d-${Date.now()}@example.com`;
  const signup = await signupClient.auth.signup({ email, password: "correct horse" });
  assert.equal((await signupClient.auth.me()).viewer, signup.viewer);
  const loginClient = client();
  const login = await loginClient.auth.login({ email, password: "correct horse" });
  assert.equal(login.viewer, signup.viewer);
});
test("query returns every typed read state and refuses 4xx/network as envelopes", async () => {
  const value = client(externalUrl ? { persona: "alice" } : {});
  if (!externalUrl) await value.auth.guest();
  const manifest = await value.manifest();
  assert.ok(manifest.generation.length > 0);
  assert.ok(manifest.ops["messages.thread"]?.kind.toLowerCase() === "query");
  if (externalUrl) {
    const result = await value.query(api.messages.thread, { conversationId: "conversation-1" });
    assert.ok(["complete", "capped", "partial", "denied"].includes(result.state));
  } else {
    for (const state of ["complete", "capped", "partial", "denied"] as const) {
      const result = await value.query(api.states[state], {});
      assert.equal(result.state, state);
    }
  }
  await assertRefused(() => value.query(api.states.missing, {}), (error: unknown) =>
    (error.state === "rejected" || error.state === "refused") && error.code === "E_OP_UNKNOWN");
  const offline = createClient({
    url,
    fetch: async () => { throw new Error("offline on purpose"); },
  });
  await assertRefused(() => offline.query(api.states.complete, {}), (error: unknown) =>
    (error.state === "rejected" || error.state === "refused") && error.code === "E_TRANSPORT");
  offline.close();
});
test("an empty capped page is the terminal drain state", async () => {
  let requests = 0;
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => {
      requests += 1;
      return fetchJson({ state: "capped", data: [], seq: 1, next: null });
    },
  });
  const result = await value.query(api.states.capped, {});
  assert.deepEqual(result, { state: "capped", data: [], seq: 1, next: null });
  assert.equal(requests, 1);
  value.close();
});
test("an exact-full non-uniform drain requests one terminal empty capped page then stops", async () => {
  const pages = [
    [{ id: "one" }, { id: "two" }],
    [{ id: "three" }, { id: "four" }],
    [],
  ];
  const cursors: Array<string | null> = [];
  const value = createClient({
    url: "http://wire.test",
    fetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      cursors.push(request.args.c);
      const data = pages[cursors.length - 1];
      assert.ok(data, "drain issued a request after the terminal empty page");
      const next = data.length === 0 ? null : `page-${cursors.length}`;
      return fetchJson({ state: "capped", data, seq: 1, next });
    },
  });

  const drained: Array<{ id: string }> = [];
  let cursor: string | null = null;
  for (;;) {
    const page = await value.query(api.states.capped, { c: cursor, take: 2 });
    assert.equal(page.state, "capped");
    if (page.data.length === 0) break;
    drained.push(...page.data);
    cursor = page.next;
  }

  assert.deepEqual(drained.map((row) => row.id), ["one", "two", "three", "four"]);
  assert.deepEqual(cursors, [null, "page-1", "page-2"]);
  value.close();
});
test("every HTTP wire state validates its state-specific required fields", async () => {
  const queryCases = [
    [{ state: "complete", seq: 1 }, "data"],
    [{ state: "capped", seq: 1 }, "data"],
    [{ state: "complete", data: [], seq: 1 }, "next"],
    [{ state: "capped", data: [], seq: 1 }, "next"],
    [{ state: "complete", data: [], seq: 1, next: 1 }, "next"],
    [{ state: "capped", data: [], seq: 1, next: false }, "next"],
    [{ state: "partial", seq: 1 }, "reason"],
    [{ state: "denied", seq: 1 }, "rule"],
    [{ state: "partial", seq: 1, reason: "coverage", next: null }, "next"],
    [{ state: "denied", seq: 1, rule: "members", next: null }, "next"],
  ] as const;
  for (const [wire, missing] of queryCases) {
    const value = createClient({ url: "http://wire.test", fetch: async () => fetchJson(wire) });
    await assertRefused(() => value.query(api.states.complete, {}), (error: unknown) => isWireShape(error, missing));
    value.close();
  }
  for (const forbidden of ["site", "take", "reason"] as const) {
    const wire = { state: "capped", data: [], seq: 1, next: null, [forbidden]: forbidden === "take" ? 20 : "hidden" };
    const value = createClient({ url: "http://wire.test", fetch: async () => fetchJson(wire) });
    await assertRefused(() => value.query(api.states.complete, {}), (error: unknown) => isWireShape(error, forbidden));
    value.close();
  }

  const opaque = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({ state: "capped", data: [], seq: 1, next: "opaque-token" }),
  });
  assert.deepEqual(await opaque.query(api.states.complete, {}), {
    state: "capped",
    data: [],
    seq: 1,
    next: "opaque-token",
  });
  opaque.close();

  const mutationCases = [
    [{ state: "committed", seq: 1 }, "data"],
    [{ state: "committed", seq: 1, data: true, next: null }, "next"],
    [{ state: "rejected", family: "op", message: "no" }, "code"],
    [{ state: "rejected", code: "E_NO", message: "no" }, "family"],
  ] as const;
  for (const [wire, missing] of mutationCases) {
    const value = createClient({ url: "http://wire.test", fetch: async () => fetchJson(wire) });
    await assertRefused(() => value.mutation(api.messages.send, {}), (error: unknown) => isWireShape(error, missing));
    value.close();
  }

  const malformed4xx = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({ family: "op", message: "missing code" }, 400),
  });
  await assertRefused(
    () => malformed4xx.query(api.states.complete, {}),
    (error: unknown) => isWireShape(error, "code"),
  );
  malformed4xx.close();

  const missingFamily = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({ code: "E_NO", message: "missing family", guide: "op/no" }, 400),
  });
  await assertRefused(
    () => missingFamily.query(api.states.complete, {}),
    (error: unknown) => isWireShape(error, "family"),
  );
  missingFamily.close();

  const missingGuide = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({ code: "E_NO", family: "op", message: "missing guide" }, 400),
  });
  await assertRefused(
    () => missingGuide.query(api.states.complete, {}),
    (value: any) => value.code === "E_NO" && value.guide === undefined,
  );
  missingGuide.close();

  const authCases: Array<[(value: SnapbackClient) => Promise<unknown>, unknown, string]> = [
    [(value) => value.auth.guest(), { token: "token" }, "viewer"],
    [(value) => value.auth.logout(), {}, "ok"],
    [(value) => value.auth.me(), { viewer: "viewer" }, "kind"],
  ];
  for (const [run, wire, missing] of authCases) {
    const value = createClient({ url: "http://wire.test", fetch: async () => fetchJson(wire) });
    await assert.rejects(() => run(value), (error: unknown) => isWireShape(error, missing));
    value.close();
  }

  const manifest = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson({ generation: "test", programGeneration: "program", ops: {}, auth: {} }),
  });
  await assert.rejects(() => manifest.manifest(), (error: unknown) => isWireShape(error, "channels"));
  manifest.close();

  const publishing = createClient({
    url: "http://wire.test",
    fetch: async input => new URL(String(input)).pathname.endsWith("/subscribe")
      ? hangingSse(`data: ${JSON.stringify(channelFrame())}\n\n`)
      : fetchJson({ state: "refused" }),
  });
  await assertRefused(
    () => publishing.channel(api.typing, {}).set({ typing: true }),
    (error: unknown) => isWireShape(error, "code"),
  );
  publishing.close();
});

test("a no-op snapshot patch preserves object identity and does not notify", async () => {
  const value = client();
  await value.manifest();
  const snapshot = value.snapshot;
  let notifications = 0;
  const unsubscribe = value.subscribeStatus(() => { notifications += 1; });
  await value.manifest();
  assert.strictEqual(value.snapshot, snapshot);
  assert.equal(notifications, 1, "subscribeStatus should only make its initial delivery");
  unsubscribe();
});

test("bodyless GETs omit Content-Type", async () => {
  const seen = new Map<string, string | null>();
  const value = createClient({
    url: "http://wire.test",
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      seen.set(path, new Headers(init?.headers).get("Content-Type"));
      if (path === "/api/auth/me") return fetchJson({ viewer: "alice", kind: "user" });
      if (path === "/api/manifest") {
        return fetchJson({ generation: "test", programGeneration: "program", ops: {}, channels: {}, auth: {} });
      }
      if (path === "/api/subscribe") {
        return fetchSse({ state: "complete", data: [], seq: 1, next: null });
      }
      throw new Error(`unexpected route ${path}`);
    },
  });
  await value.auth.me();
  await value.manifest();
  const sub = subscribe(value, api.messages.thread, {}, () => undefined);
  await sub.until((delivery) => delivery.state === "complete", 500);
  assert.equal(seen.get("/api/auth/me"), null);
  assert.equal(seen.get("/api/manifest"), null);
  assert.equal(seen.get("/api/subscribe"), null);
  sub.close();
  value.close();
});

test("a successful subscription delivery clears lastRefusal", async () => {
  const value = createClient({
    url: "http://wire.test",
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/query") return fetchJson(refusal("E_OP_UNKNOWN", "unknown"), 404);
      if (path === "/api/subscribe") return fetchSse({ state: "complete", data: [], seq: 1, next: null });
      throw new Error(`unexpected route ${path}`);
    },
  });
  await assertRefused(() => value.query(api.states.missing, {}), (error: unknown) =>
    (error.state === "rejected" || error.state === "refused") && error.code === "E_OP_UNKNOWN");
  assert.equal(value.snapshot.lastRefusal?.code, "E_OP_UNKNOWN");
  const sub = subscribe(value, api.messages.thread, {}, () => undefined);
  await sub.until((delivery) => delivery.state === "complete", 500);
  assert.equal(value.snapshot.lastRefusal, undefined);
  sub.close();
  value.close();
});

test("malformed subscription and channel frames deliver E_WIRE_SHAPE", async (context) => {
  const queryCases = [
    [{ state: "complete", seq: 1 }, "data"],
    [{ state: "capped", seq: 1 }, "data"],
    [{ state: "complete", data: [], seq: 1 }, "next"],
    [{ state: "capped", data: [], seq: 1 }, "next"],
    [{ state: "complete", data: [], seq: 1, next: 1 }, "next"],
    [{ state: "capped", data: [], seq: 1, next: false }, "next"],
    [{ state: "partial", seq: 2 }, "reason"],
    [{ state: "denied", seq: 3 }, "rule"],
    [{ state: "partial", seq: 2, reason: "coverage", next: null }, "next"],
    [{ state: "denied", seq: 3, rule: "members", next: null }, "next"],
    [{ state: "stale", seq: 4, since: 1 }, "state"],
  ] as const;
  for (const [wire, missing] of queryCases) {
    let queryDelivery: any;
    const queryClient = createClient({
      url: "http://wire.test",
      fetch: async () => fetchSse(wire),
    });
    const querySub = subscribe(queryClient, api.messages.thread, {}, (delivery) => { queryDelivery = delivery; });
    context.after(() => { querySub.close(); queryClient.close(); });
    await assert.rejects(() => querySub.until(() => false, 500), (error: unknown) => isWireShape(error, missing));
    assert.equal(queryDelivery.code, "E_WIRE_SHAPE");
    assert.equal(queryDelivery.family, "op");
    assert.match(queryDelivery.message ?? "", new RegExp(missing));
    querySub.close();
    queryClient.close();
  }

  let channelDelivery: any;
  const channelClient = createClient({
    url: "http://wire.test",
    fetch: async () => fetchSse({ state: "snapshot", key: "alice", lease: "private" }),
  });
  const channelSub = channelClient.channel(api.typing, {}).subscribe((event) => { channelDelivery = event; });
  context.after(() => { channelSub.close(); channelClient.close(); });
  await assert.rejects(
    () => channelSub.until(() => false, 500),
    (error: unknown) => isWireShape(error, "snapshot"),
  );
  assert.equal(channelDelivery.status, "unavailable");
  assert.equal(channelDelivery.reason, "refused");
  assert.deepEqual(channelDelivery.entries, []);
  assert.equal(channelDelivery.refusal.code, "E_WIRE_SHAPE");
  channelSub.close();
  channelClient.close();
});

test("a refused frame without code becomes terminal E_WIRE_SHAPE", async () => {
  let opens = 0;
  let delivered: any;
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => {
      opens += 1;
      return fetchSse({ state: "refused", family: "auth", message: "missing code" });
    },
  });
  const sub = subscribe(value, api.messages.thread, {}, (delivery) => { delivered = delivery; });
  await assert.rejects(() => sub.until(() => false, 500), (error: unknown) => isWireShape(error, "code"));
  assert.equal(delivered.code, "E_WIRE_SHAPE");
  assert.equal(delivered.family, "op");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(opens, 1, "a protocol refusal frame must close instead of reconnecting");
  sub.close();
  value.close();
});

test("a valid refusal frame preserves code and family and is terminal", async () => {
  let opens = 0;
  let delivered: any;
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => {
      opens += 1;
      return fetchSse({
        state: "refused",
        code: "E_AUTH_REQUIRED",
        family: "auth",
        message: "login required",
        guide: "auth/session",
      });
    },
  });
  const sub = subscribe(value, api.messages.thread, {}, (delivery) => { delivered = delivery; });
  await assert.rejects(sub.until((item) => item.state === "refused", 500),
    (error: unknown) => isRefusalError(error) && error.code === "E_AUTH_REQUIRED" && error.envelope.family === "auth");
  assert.equal(delivered.code, "E_AUTH_REQUIRED");
  assert.equal(delivered.family, "auth");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(opens, 1);
  sub.close();
  value.close();
});

test("an in-band channel refusal records the complete lastRefusal", async () => {
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => fetchSse({
      state: "refused",
      code: "E_RULE_CHANNEL_SUBSCRIBE",
      family: "rule",
      message: "membership was revoked",
      guide: "rule/channels",
    }),
  });
  const sub = value.channel(api.typing, {}).subscribe(() => undefined);
  await assert.rejects(
    () => sub.until(() => false, 500),
    (error: unknown) => isRefusalError(error)
      && error.code === "E_RULE_CHANNEL_SUBSCRIBE",
  );
  assert.deepEqual(value.snapshot.lastRefusal, {
    code: "E_RULE_CHANNEL_SUBSCRIBE",
    family: "rule",
    message: "membership was revoked",
    guide: "rule/channels",
  });
  sub.close();
  value.close();
});

test("mutation returns committed and rejected without throwing rejected", async () => {
  const value = client(externalUrl ? { persona: "alice" } : {});
  if (!externalUrl) await value.auth.guest();
  const committed = await value.mutation(api.messages.send, {
    conversationId: externalUrl ? "conversation-1" : "general",
    body: `first-${Date.now()}`,
  });
  assert.equal(committed.state, "committed");
  const rejected = externalUrl
    ? await value.mutation(api.messages.send, {
        conversationId: "conversation-missing",
        body: "reject",
      })
    : await value.mutation(api.messages.reject, { body: "reject" });
  assert.equal(rejected.state, "rejected");
  if (rejected.state === "rejected") assert.equal(rejected.code, externalUrl ? "NOT_MEMBER" : "RECIPIENT_UNKNOWN");
});

test("subscription observes another client's mutation and until resolves", async () => {
  const reader = client(externalUrl ? { persona: "alice" } : {});
  const writer = client(externalUrl ? { persona: "bob" } : {});
  if (!externalUrl) await Promise.all([reader.auth.guest(), writer.auth.guest()]);
  const conversationId = externalUrl ? "conversation-1" : "general";
  const seen: string[] = [];
  const sub = subscribe(reader, api.messages.thread, { conversationId }, (delivery) => seen.push(delivery.state));
  const initial = await sub.until((delivery) => delivery.state === "complete" && delivery.live, 2_000);
  assert.equal(initial.state, "complete");
  assert.equal(initial.live, true);
  const initialSeq = initial.state === "complete" ? initial.seq : -1;
  const body = `from-writer-${Date.now()}`;
  const committed = await writer.mutation(api.messages.send, {
    conversationId,
    body,
  });
  assert.equal(committed.state, "committed");
  const updated = await sub.until((delivery) =>
    delivery.state === "complete" && delivery.live && delivery.seq > initialSeq
      && delivery.data.some((row: any) => (externalUrl ? row.message?.body : row.body) === body), 2_000);
  assert.equal(updated.state, "complete");
  assert.ok(seen.filter((state) => state === "complete").length >= 2);
  sub.close();
});

test("live queries expose capped and denied receipt states with live true", async (context) => {
  if (externalUrl && process.env.SNAPBACK2_REAL_OWNER_MODE !== "self-started") {
    return context.skip("live capped/denied fixtures are added by the self-started real-owner harness");
  }
  for (const [state, expected] of [
    ["capped", {}],
    ["denied", { rule: externalUrl ? "MEMBERSHIP_REQUIRED" : "members only" }],
  ] as const) {
    const value = client(externalUrl ? { persona: state === "denied" ? "charlie" : "alice" } : {});
    const ref = externalUrl ? api.integration[state] : api.states[state];
    const args = externalUrl && state === "denied" ? { conversationId: "conversation-1" } : {};
    const sub = subscribe(value, ref, args, () => undefined);
    const delivery = await sub.until((item) => item.state === state, 2_000);
    assert.equal(delivery.state, state);
    assert.equal(delivery.live, true);
    if (delivery.state === "capped") {
      assert.deepEqual(Object.keys(delivery).sort(), ["data", "live", "next", "seq", "state"]);
      assert.equal(delivery.next, null);
    } else if (delivery.state === "denied") {
      assert.equal(delivery.rule, expected.rule);
    }
    sub.close();
  }
});

test("5xx and non-envelope subscribe failures are stale transport and reconnect", async () => {
  for (const first of [
    fetchJson(refusal("E_OWNER_BUSY", "temporarily unavailable"), 503),
    fetchJson({ message: "not a refusal envelope" }, 400),
  ]) {
    let opens = 0;
    const deliveries: any[] = [];
    const connections: string[] = [];
    const value = createClient({
      url: "http://wire.test",
      fetch: async () => {
        opens += 1;
        if (opens === 1) return first;
        return fetchSse({ state: "complete", data: [{ id: "one" }], seq: 8, next: null });
      },
    });
    const unsubscribe = value.subscribeStatus((snapshot) => connections.push(snapshot.connection));
    const sub = subscribe(value, api.messages.thread, {}, (delivery) => deliveries.push(delivery));
    const recovered = await sub.until((delivery) => delivery.state === "complete", 1_000);
    assert.equal(recovered.state, "complete");
    assert.equal(recovered.live, true);
    assert.equal(opens, 2);
    assert.deepEqual(deliveries.map((delivery) => delivery.state), ["complete"]);
    assert.ok(connections.includes("reconnecting"));
    unsubscribe();
    sub.close();
    value.close();
  }
});

test("an idle stream becomes stale and reconnects after twice the heartbeat window", async (context) => {
  let opens = 0;
  const events: any[] = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) =>
    realSetTimeout(handler, timeout === 30_000 ? 30 : timeout, ...args)) as typeof globalThis.setTimeout;
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => {
      opens += 1;
      return hangingSse(`data: ${JSON.stringify({ state: "complete", data: [], seq: opens, next: null })}\n\n`);
    },
  });
  const sub = subscribe(value, api.messages.thread, {}, (event) => events.push(event));
  context.after(() => {
    globalThis.setTimeout = realSetTimeout;
    sub.close();
    value.close();
  });
  const stale = await sub.until((event) => event.state === "stale", 500);
  assert.equal(stale.state, "stale");
  assert.equal(stale.live, false);
  const recovered = await sub.until((event) => event.state === "complete" && event.seq === 2, 500);
  assert.equal(recovered.live, true);
  assert.equal(opens, 2);
  assert.deepEqual(events.slice(0, 3).map((event) => event.state), ["complete", "stale", "complete"]);
  globalThis.setTimeout = realSetTimeout;
  sub.close();
  value.close();
});

test("heartbeat comments reset the stream idle deadline", async (context) => {
  let opens = 0;
  const events: any[] = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) =>
    realSetTimeout(handler, timeout === 30_000 ? 30 : timeout, ...args)) as typeof globalThis.setTimeout;
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => {
      opens += 1;
      return heartbeatSse();
    },
  });
  const sub = subscribe(value, api.messages.thread, {}, (event) => events.push(event));
  context.after(() => {
    globalThis.setTimeout = realSetTimeout;
    sub.close();
    value.close();
  });
  const second = await sub.until((event) => event.state === "complete" && event.seq === 2, 500);
  assert.equal(second.live, true);
  assert.equal(opens, 1);
  assert.equal(events.some((event) => event.state === "stale"), false);
  globalThis.setTimeout = realSetTimeout;
  sub.close();
  value.close();
});

test("subscription reconnect reports stale, resumes with Last-Event-ID, then reports a live receipt", async (context) => {
  if (externalUrl) return context.skip("owner process control is supplied in the second integration round");
  const value = client();
  await value.auth.guest();
  const sub = subscribe(value, api.messages.thread, { conversationId: "general" }, () => undefined);
  const initial = await sub.until((delivery) => delivery.state === "complete" && delivery.live, 2_000);
  assert.equal(initial.state, "complete");
  const initialSeq = initial.state === "complete" ? initial.seq : -1;
  const stale = sub.until((delivery) => delivery.state === "stale", 2_000);
  await owner.stop();
  assert.equal((await stale).state, "stale");
  await owner.start();
  const resumed = await sub.until((delivery) => delivery.state === "complete" && delivery.live, 4_000);
  assert.equal(resumed.state, "complete");
  assert.equal(resumed.live, true);
  assert.ok(owner.lastEventIds.includes(String(initialSeq)));
  sub.close();
});

test("subscription loss preserves data and seq from the same receipt", async (context) => {
  const rows = [{ id: "message-1" }];
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => fetchSse({ state: "complete", seq: 3, data: rows, next: null }),
  });
  const deliveries: any[] = [];
  const sub = subscribe(value, api.messages.thread, {}, (delivery) => deliveries.push(delivery));
  context.after(() => { sub.close(); value.close(); });
  const stale = await sub.until((delivery) => delivery.state === "stale", 500);
  assert.equal(stale.seq, 3);
  assert.strictEqual(stale.data, deliveries[0]?.data);
  assert.equal(stale.live, false);
  assert.equal(typeof stale.since, "number");
  assert.equal(deliveries[0]?.seq, 3);
  assert.equal(deliveries[0]?.live, true);
  sub.close();
  value.close();
});

// @ref LLP 1001.000#observable-client-surface — channel observations expose latest entries without the private lease.
test("channel set and subscribe carry typed ephemeral snapshots", async () => {
  const reader = client(externalUrl ? { persona: "alice" } : {});
  const writer = client(externalUrl ? { persona: "bob" } : {});
  if (!externalUrl) await Promise.all([reader.auth.guest(), writer.auth.guest()]);
  const args = { conversationId: externalUrl ? "conversation-1" : "general" };
  const receiving = reader.channel<typeof args, { typing: boolean }>(api.typing, args);
  const publishing = writer.channel<typeof args, { typing: boolean }>(api.channels.typing, args);
  const sub = receiving.subscribe(() => undefined);
  const initial = await sub.until(snapshot => snapshot.status === "ready", 2_000);
  assert.deepEqual(initial.entries, []);
  const next = sub.until(snapshot => snapshot.entries.some(entry => entry.value.typing), 2_000);
  assert.deepEqual(await publishing.set({ typing: true }), { ok: true });
  const snapshot = await next;
  assert.equal(snapshot.entries.length, 1);
  assert.deepEqual(snapshot.entries[0].value, { typing: true });
  assert.ok(snapshot.entries[0].from.length > 0);
  assert.equal("lease" in snapshot, false);
  sub.close();
  receiving.close();
  publishing.close();
});

test("terminal channel refusals reach callbacks and reject until immediately", async () => {
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson(refusal("E_AUTH_REQUIRED", "a session is required"), 401),
  });
  let delivered: any;
  const sub = value.channel(api.typing, { conversationId: "general" }).subscribe((event) => { delivered = event; });
  const started = Date.now();
  await assert.rejects(
    () => sub.until(() => false, 2_000),
    (error: unknown) => isRefusalError(error) && error.code === "E_AUTH_REQUIRED",
  );
  assert.ok(Date.now() - started < 500, "until waited for its timeout instead of rejecting the refusal");
  assert.equal(delivered.status, "unavailable");
  assert.equal(delivered.reason, "refused");
  assert.deepEqual(delivered.entries, []);
  assert.equal(delivered.refusal.code, "E_AUTH_REQUIRED");
  assert.equal(delivered.refusal.family, "auth");
  sub.close();
  value.close();
});

test("terminal query refusals on subscribe open reach callbacks and reject until immediately", async () => {
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => fetchJson(refusal("E_AUTH_REQUIRED", "a session is required"), 401),
  });
  let delivered: any;
  const sub = subscribe(value, api.messages.thread, {}, (event) => { delivered = event; });
  const started = Date.now();
  await assert.rejects(
    () => sub.until(() => false, 2_000),
    (error: unknown) => isRefusalError(error) && error.code === "E_AUTH_REQUIRED",
  );
  assert.ok(Date.now() - started < 500, "until waited for its timeout instead of rejecting the refusal");
  assert.equal(delivered.state, "refused");
  assert.equal(delivered.code, "E_AUTH_REQUIRED");
  sub.close();
  value.close();
});

test("lastRefusal clears only after state-specific validation succeeds", async () => {
  let request = 0;
  const value = createClient({
    url: "http://wire.test",
    fetch: async () => {
      request += 1;
      return request === 1
        ? fetchJson(refusal("E_OP_UNKNOWN", "unknown"), 404)
        : fetchJson({ state: "complete", seq: 1 });
    },
  });
  await assertRefused(() => value.query(api.missing, {}), (error: unknown) =>
    (error.state === "rejected" || error.state === "refused") && error.code === "E_OP_UNKNOWN");
  await assertRefused(() => value.query(api.messages.thread, {}), (error: unknown) =>
    isWireShape(error, "data"));
  assert.equal(value.snapshot.lastRefusal?.code, "E_OP_UNKNOWN");
  value.close();
});

test("query retries HTTP and network transport failures while mutation retries neither", async () => {
  for (const [response, expectedCode] of [
    [() => fetchJson({ message: "busy" }, 503), "E_TRANSPORT"],
    [() => new Response("not a refusal envelope", { status: 400 }), "E_TRANSPORT"],
    [() => { throw new Error("offline"); }, "E_TRANSPORT"],
  ] as const) {
    let queryAttempts = 0;
    const querying = createClient({
      url: "http://wire.test",
      fetch: async () => {
        queryAttempts += 1;
        return response();
      },
    });
    await assertRefused(
      () => querying.query(api.messages.thread, {}),
      (error: unknown) => (error.state === "rejected" || error.state === "refused")
        && error.code === expectedCode
        && error.retryable,
    );
    assert.equal(queryAttempts, 3);
    assert.equal(querying.snapshot.connection, "reconnecting");
    querying.close();
  }

  for (const [response, expectedCode] of [
    [() => fetchJson(refusal("E_OWNER_BUSY", "busy"), 503), "E_TRANSPORT"],
    [() => { throw new Error("offline"); }, "E_TRANSPORT"],
  ] as const) {
    let mutationAttempts = 0;
    const mutating = createClient({
      url: "http://wire.test",
      fetch: async () => {
        mutationAttempts += 1;
        return response();
      },
    });
    await assertRefused(
      () => mutating.mutation(api.messages.send, {}),
      (error: unknown) => (error.state === "rejected" || error.state === "refused")
        && error.code === expectedCode
        && error.retryable,
    );
    assert.equal(mutationAttempts, 1);
    assert.equal(mutating.snapshot.connection, "reconnecting");
    mutating.close();
  }
});

test("query and mutation return every 4xx refusal while subscriptions deliver refused", async () => {
  const serve = new MockOwner("serve");
  await serve.start();
  const value = createClient({ url: serve.url, persona: "alice" });
  await assertRefused(
    () => value.query(api.messages.thread, { conversationId: "general" }),
    (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_AUTH_PERSONA_NOT_DEV",
  );
  await assertRefused(
    () => value.mutation(api.messages.send, { conversationId: "general", body: "hello" }),
    (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_AUTH_PERSONA_NOT_DEV",
  );
  let delivered: any;
  const sub = subscribe(value, api.messages.thread, { conversationId: "general" }, (delivery) => { delivered = delivery; });
  await assert.rejects(
    () => sub.until(() => false, 500),
    (error: unknown) => isRefusalError(error) && error.code === "E_AUTH_PERSONA_NOT_DEV",
  );
  assert.equal(delivered.code, "E_AUTH_PERSONA_NOT_DEV");
  assert.equal(delivered.family, "auth");
  sub.close();
  value.close();
  await serve.stop();
});

test("React query reducer preserves every discriminant field and only reuses a deep-equal whole view", () => {
  const hydrating = initialQueryState<Array<{ id: string }>>();
  assert.deepEqual(hydrating, { state: "hydrating", live: false });
  const data = [{ id: "one" }];
  const live = reduceQueryState(hydrating, { state: "complete", live: true, data, seq: 1, next: null });
  const equivalent = reduceQueryState(live, { state: "complete", live: true, data: [{ id: "one" }], seq: 1, next: null });
  assert.strictEqual(equivalent, live);
  assert.strictEqual(equivalent.data, data);
  assert.equal(equivalent.state, "complete");
  assert.equal(equivalent.live, true);

  assert.equal(live.source, "server");
  const stale = reduceQueryState(live, { state: "stale", live: false, since: 99, data, seq: 1 });
  assert.strictEqual(stale.data, data);
  assert.equal(stale.since, 99);
  assert.equal(stale.live, false);
  // @ref LLP 1018.003#2-derive-never-add — a stale event keeps the last receipt's verdict and never scrubs delivered data.
  assert.equal(stale.state === "stale" && stale.verdict, "complete");
  assert.equal(stale.state === "stale" && stale.source, "server");
  const staleWithoutData = reduceQueryState(live, { state: "stale", live: false, since: 100 });
  assert.strictEqual(staleWithoutData.data, data, "a stale event without data keeps the delivered data");
  assert.equal(staleWithoutData.seq, 1, "and its sequence");
  const twin = reduceQueryState(hydrating, { state: "complete", live: false, connection: "offline", stale: { since: 5 }, data, seq: 1, next: null } as any);
  assert.equal(twin.source, "twin", "an offline answer records the twin as its evaluator");
  const nothingHeld = reduceQueryState(hydrating, { state: "hydrating", live: false, connection: "offline" } as any);
  assert.deepEqual(nothingHeld, { state: "hydrating", live: false, offline: true });
  // A stale event that names another sequence carries data the last receipt does not describe: no verdict survives.
  const otherSeq = reduceQueryState(live, { state: "stale", live: false, since: 101, data: [{ id: "two" }], seq: 9 });
  assert.equal(otherSeq.state === "stale" && otherSeq.verdict, undefined, "a different seq drops the receipt");
  assert.deepEqual(otherSeq.data, [{ id: "two" }]);
  assert.equal(otherSeq.seq, 9);
  // A kept denial keeps no data, whatever the stale event carried.
  const deniedFirst = reduceQueryState(hydrating, { state: "denied", live: true, seq: 4, rule: "members only" });
  const staleDenied = reduceQueryState(deniedFirst, { state: "stale", live: false, since: 102, data, seq: 4 });
  assert.equal(staleDenied.state === "stale" && staleDenied.verdict, "denied");
  assert.equal("data" in staleDenied ? staleDenied.data : undefined, undefined, "a denial scrubs data through a stale event");

  const partial = reduceQueryState(stale, { state: "partial", live: true, seq: 2, reason: "coverage" });
  assert.deepEqual(partial, { state: "partial", live: true, source: "server", seq: 2, reason: "coverage" });
  const denied = reduceQueryState(stale, { state: "denied", live: true, seq: 2, rule: "members only" });
  assert.deepEqual(denied, { state: "denied", live: true, source: "server", seq: 2, rule: "members only" }, "a denial scrubs data");
  const refused = reduceQueryState(stale, {
    state: "refused",
    live: false,
    code: "E_AUTH",
    family: "auth",
    message: "no",
    guide: "auth/session",
  });
  assert.deepEqual(refused, {
    state: "refused",
    live: false,
    refusal: { code: "E_AUTH", family: "auth", message: "no", guide: "auth/session" },
  });

  const capped = reduceQueryState(stale, {
    state: "capped", live: true, data, seq: 2, next: "next-page",
  });
  const cappedEquivalent = reduceQueryState(capped, {
    state: "capped", live: true, data: [{ id: "one" }], seq: 2, next: "next-page",
  });
  assert.strictEqual(cappedEquivalent, capped);
  const differentSeq = reduceQueryState(capped, {
    state: "capped", live: true, data, seq: 3, next: "next-page",
  });
  assert.notStrictEqual(differentSeq, capped);
  assert.equal(differentSeq.seq, 3);

  assert.deepEqual(reduceQueryState(stale, { state: "complete", data, seq: 2, next: null }), {
    state: "complete", live: false, source: "server", data, seq: 2, next: null,
  });
  assert.equal(stableSerialize({ b: 2, a: [1] }), stableSerialize({ a: [1], b: 2 }));
});

test("useMutation exposes inFlight for exactly the request interval", async () => {
  let release: ((response: Response) => void) | undefined;
  let current: any;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: "test", programGeneration: "program", ops: {}, channels: {}, auth: {} });
    }
    return await new Promise<Response>((resolve) => { release = resolve; });
  };
  function Harness() {
    current = useMutation(api.messages.send);
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://wire.test", fetch: multiplexFetch(fetch) },
      React.createElement(Harness),
    ));
  });
  assert.equal(current.inFlight, false);
  assert.equal(current.last, undefined);
  let running!: Promise<unknown>;
  await act(async () => {
    running = current.run({ conversationId: "general", body: "hello" });
    await Promise.resolve();
  });
  assert.equal(current.inFlight, true);
  assert.equal(current.last, undefined);
  await act(async () => {
    release!(fetchJson({ state: "committed", seq: 1, data: { id: "message-1" } }));
    await running;
  });
  assert.equal(current.inFlight, false);
  assert.equal(current.last.state, "committed");
  await act(async () => { renderer!.unmount(); });
});

test("useMutation publishes a transport rejection in last", async () => {
  let current: any;
  let mutationAttempts = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: "test", programGeneration: "program", ops: {}, channels: {}, auth: {} });
    }
    mutationAttempts += 1;
    if (mutationAttempts === 1) {
      return fetchJson({ state: "committed", seq: 1, data: { id: "message-1" } });
    }
    if (mutationAttempts === 2) return fetchJson({ message: "upstream failed" }, 503);
    return fetchJson({
      state: "rejected",
      code: "RECIPIENT_UNKNOWN",
      family: "input",
      message: "recipient does not exist",
      guide: "input/runtime",
    });
  };
  function Harness() {
    current = useMutation(api.messages.send);
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://wire.test", fetch: multiplexFetch(fetch) },
      React.createElement(Harness),
    ));
  });
  await act(async () => { await current.run({}); });
  const committed = current.last;
  assert.equal(committed.state, "committed");

  let transport: unknown;
  await act(async () => {
    await assertRefused(
      () => current.run({}),
      (error: any) => {
        transport = error;
        return (error.state === "rejected" || error.state === "refused")
          && error.code === "E_TRANSPORT"
          && error.retryable === true;
      },
    );
  });
  assert.equal(mutationAttempts, 2);
  assert.strictEqual(current.last, transport);
  assert.equal(current.last.family, "transport");

  await act(async () => { await current.run({}); });
  assert.equal(current.last.state, "rejected");
  assert.equal(current.last.code, "RECIPIENT_UNKNOWN");
  assert.equal(current.last.retryable, undefined);
  await act(async () => { renderer!.unmount(); });
});

test("useQuery renders hydrating immediately when its identity changes", async () => {
  const renders: Array<{ op: string; state: string }> = [];
  const fetch = async (input: string | URL | Request) => {
    const parsed = new URL(String(input));
    if (parsed.pathname === "/api/manifest") {
      return fetchJson({ generation: "test", programGeneration: "program", ops: {}, channels: {}, auth: {} });
    }
    if (parsed.pathname === "/api/subscribe") {
      const op = parsed.searchParams.get("op") ?? "missing";
      return hangingSse(`data: ${JSON.stringify({ state: "complete", data: [op], seq: 1, next: null })}\n\n`);
    }
    throw new Error(`unexpected route ${parsed.pathname}`);
  };
  function Harness({ operation }: { operation: any }) {
    const view = useQuery(operation, { identity: operation.op });
    renders.push({ op: operation.op, state: view.status });
    return null;
  }
  const element = (operation: any) => React.createElement(
    SnapbackProvider,
    { url: "http://wire.test", fetch: multiplexFetch(fetch) },
    React.createElement(Harness, { operation }),
  );
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element(api.messages.first));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(renders.filter((render) => render.op === "messages.first").at(-1)?.state, "ready");
  await act(async () => {
    renderer!.update(element(api.messages.second));
  });
  const secondIdentityRenders = renders.filter((render) => render.op === "messages.second");
  assert.equal(secondIdentityRenders[0]?.state, "loading", "the old receipt leaked under the new identity");
  await act(async () => { renderer!.unmount(); });
});

test("non-live useQuery keeps hydrating across a network failure, reports connection, and retries", async () => {
  let queryAttempts = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") {
      return fetchJson({ generation: "test", programGeneration: "program", ops: {}, channels: {}, auth: {} });
    }
    if (path === "/api/query") {
      queryAttempts += 1;
      if (queryAttempts === 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("offline once");
      }
      return fetchJson({ state: "complete", seq: 7, data: [{ id: "message-1" }], next: null });
    }
    throw new Error(`unexpected route ${path}`);
  };
  const views: any[] = [];
  function Harness() {
    const view = useQuery(api.messages.thread, { conversationId: "general" }, { live: false });
    views.push(view);
    return null;
  }
  const client = createClient({ url: "http://wire.test", fetch });
  await client.ready;
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { client },
      React.createElement(Harness),
    ));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
  assert.equal(queryAttempts, 2);
  assert.ok(views.some((view) => view.status === "loading" && view.freshness.connection === "reconnecting"));
  const final = views.at(-1);
  assert.equal(final.receipt?.state, "complete");
  assert.equal(final.status, "ready");
  assert.equal(final.freshness.connection, "connected");
  assert.ok(!views.some((view) => view.status === "unavailable" && view.refusal?.code === "E_TRANSPORT"));
  await act(async () => { renderer!.unmount(); });
  await client.close();
});

test("separately bundled client and React entry points share generated API references", async () => {
  const bundledClient: any = await import("../dist/client.mjs");
  const bundledReact: any = await import("../dist/react.mjs");
  let operation: string | undefined;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return fetchJson({ generation: "test", programGeneration: "program", ops: {}, channels: {}, auth: {} });
    operation = JSON.parse(String(init?.body)).op;
    return fetchJson({ state: "complete", seq: 1, data: [], next: null });
  };
  function Harness() {
    bundledReact.useQuery(bundledClient.api.messages.thread, {}, { live: false });
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      bundledReact.SnapbackProvider,
      { url: "http://wire.test", fetch: multiplexFetch(fetch) },
      React.createElement(Harness),
    ));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  assert.equal(operation, "messages.thread");
  await act(async () => { renderer!.unmount(); });
});

test("React transport refusals have the same plain shape as headless mutations", async () => {
  const bundledClient: any = await import("../dist/client.mjs");
  const bundledReact: any = await import("../dist/react.mjs");
  let hook: any;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return fetchJson({ generation: "test", programGeneration: "program", ops: {}, channels: {}, auth: {} });
    return fetchJson({ message: "upstream failed" }, 503);
  };
  function Harness() {
    hook = bundledReact.useMutation(bundledClient.api.messages.send);
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      bundledReact.SnapbackProvider,
      { url: "http://wire.test", fetch: multiplexFetch(fetch) },
      React.createElement(Harness),
    ));
  });
  await act(async () => {
    await assertRefused(
      () => hook.run({}),
      (error: any) => error.state === "rejected" && error.family === "transport" && error.retryable === true,
    );
  });
  await act(async () => { renderer!.unmount(); });
});

test("isRefusalError recognizes the name-plus-symbol brand across realms", async () => {
  const bundledClient: any = await import("../dist/client-observed-test.mjs");
  assert.equal(typeof bundledClient.isRefusalError, "function");
  const local = new bundledClient.RefusalError(refusal("E_OP_UNKNOWN", "unknown"));
  const brand = Object.getOwnPropertySymbols(local)
    .find((symbol) => (local as Record<symbol, unknown>)[symbol] === true);
  assert.ok(brand, "RefusalError did not carry its symbol brand");
  const { runInNewContext } = await import("node:vm");
  const crossRealm = runInNewContext(
    "({ name: 'RefusalError', [brand]: true })",
    { brand },
  );
  assert.equal(bundledClient.isRefusalError(crossRealm), true);
  assert.equal(bundledClient.isRefusalError({ name: "RefusalError" }), false);
  assert.equal(bundledClient.isRefusalError({ [brand]: true }), false);
});


test("plain online query and subscription preserve h1-prefixed noncursor text without metadata", async context => {
  const seen: any[] = [];
  const value = createClient({ url: "http://wire.test", fetch: async (input, init) => {
    const url = new URL(String(input));
    seen.push(url.pathname === "/api/subscribe" ? JSON.parse(url.searchParams.get("args")!) : JSON.parse(String(init?.body)).args);
    return url.pathname === "/api/subscribe"
      ? hangingSse('data: {"state":"complete","data":[],"seq":1,"next":null}\n\n')
      : fetchJson({ state: "complete", data: [], seq: 1, next: null });
  } });
  context.after(() => value.close());
  const args = { term: "h1.a valid search term", c: "h1.a normal text argument" };
  await value.query(api.messages.thread, args);
  const sub = subscribe(value, api.messages.thread, args, () => {}); context.after(() => sub.close());
  await sub.until(delivery => delivery.state === "complete", 500);
  assert.deepEqual(seen, [args, args]);
});

test("plain mutations bind the observed program generation and preserve generation rejection without retry", async () => {
  let mutations = 0;
  const value = createClient({ url: "http://generation.test", fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/api/manifest") return fetchJson({
      generation: "a".repeat(64), programGeneration: "b".repeat(64), ops: {}, channels: {}, auth: {},
    });
    mutations++;
    assert.equal(JSON.parse(String(init?.body)).expectedGeneration, "b".repeat(64));
    return fetchJson({ state: "rejected", reason: "generation_changed", code: "E_GENERATION_CHANGED", family: "successor",
      message: "the mutation's expected generation is no longer active", guide: "successor/runtime" });
  } });
  await value.manifest();
  const result = await value.mutation(api.messages.send, {});
  assert.equal(result.state, "rejected");
  assert.equal(result.reason, "generation_changed");
  assert.equal(mutations, 1);
  value.close();
});

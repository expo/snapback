// @ref LLP 1001.000#observable-client-surface — observable state, cleanup and private lease fencing through the public client.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api } from "../dist/client.mjs";
import { SnapbackProvider, useChannel } from "../dist/react.mjs";
import { channelFrame, fixtureClient } from "./live-fixture.ts";
import { parseSse } from "../src/sse-parser.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const pause = (ms = 5) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function eventually(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) { assert.ok(Date.now() < deadline, "condition did not become true"); await pause(); }
}
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(yes => { resolve = yes; });
  return { promise, resolve };
}
function wire(initial = true) {
  const opens: { key: string; lease: string; closed: boolean; lastEventId: string | null; send(value: unknown): void; end(): void }[] = [];
  const writes: { kind: string; body: any }[] = [];
  let respond = async (_kind: string): Promise<Response> => json({ ok: true });
  const client = fixtureClient({ url: "http://channels.test", as: "alice", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json({ generation: "test", programGeneration: "test", channels: {}, ops: {}, auth: {} });
    if (path.endsWith("/subscribe")) {
      const index = opens.length + 1;
      let output!: ReadableStreamDefaultController<Uint8Array>;
      const entry = { key: `key-${index}`, lease: `lease-${index}`, closed: false,
        lastEventId: new Headers(init?.headers).get("Last-Event-ID"),
        send: (value: unknown) => output.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)),
        end: () => output.close(),
      };
      const response = new Response(new ReadableStream({
        start(controller) { output = controller; },
        cancel() { entry.closed = true; },
      }));
      init?.signal?.addEventListener("abort", () => { entry.closed = true; }, { once: true });
      opens.push(entry);
      if (initial) entry.send(channelFrame([], entry.key, entry.lease));
      return response;
    }
    if (path.endsWith("/set") || path.endsWith("/clear")) {
      const kind = path.split("/").at(-1)!;
      writes.push({ kind, body: JSON.parse(String(init?.body)) });
      return respond(kind);
    }
    throw new Error(`unexpected request ${path}`);
  } });
  return { client, opens, writes, response: (fn: typeof respond) => { respond = fn; } };
}
const entry = (key: string, typing = true) => ({ key, from: "alice", value: { typing }, expiresAt: Date.now() + 4_000 });

test("cold clear is inert; snapshots are immutable and keep the lease private", async context => {
  const owner = wire(); context.after(() => owner.client.close());
  const args = { conversationId: "one" };
  const room = owner.client.channel(api.typing, args);
  const empty = room.getSnapshot();
  assert.deepEqual(await room.clear(), { ok: true });
  assert.equal(room.getSnapshot(), empty);
  assert.equal(owner.opens.length, 0);
  assert.equal(owner.writes.length, 0);
  args.conversationId = "mutated-after-creation";
  const observer = room.subscribe(() => {});
  const ready = await observer.until(value => value.status === "ready");
  assert.equal(Object.hasOwn(ready, "lease"), false);
  assert.deepEqual(ready.entries, []);
  const connection = owner.opens[0]!;
  connection.send(channelFrame([entry("remote")], connection.key, connection.lease));
  const populated = await observer.until(value => value.entries.length === 1);
  assert.ok(Object.isFrozen(populated) && Object.isFrozen(populated.entries) && Object.isFrozen(populated.entries[0]!.value));
  assert.throws(() => { (populated.entries[0]!.value as any).typing = false; }, TypeError);
  assert.deepEqual(await room.set({ typing: true }), { ok: true });
  assert.deepEqual(owner.writes[0]!.body.args, { conversationId: "one" });
  observer.close();
  assert.equal(connection.closed, false, "headless ownership lasts until explicit close");
  room.close();
  await eventually(() => connection.closed);
  assert.equal(room.getSnapshot().reason, "closed");
  assert.deepEqual(room.getSnapshot().entries, []);
  await assert.rejects(room.set({ typing: true }), { code: "E_CHANNEL_CLOSED" });
});

test("clear cancels a set waiting for the first snapshot without sending it later", async context => {
  const owner = wire(false); context.after(() => owner.client.close());
  const room = owner.client.channel(api.typing, {});
  const pending = room.set({ typing: true });
  const rejected = assert.rejects(pending, { code: "E_CHANNEL_LEASE" });
  await eventually(() => owner.opens.length === 1);
  await room.clear(); await rejected;
  const connection = owner.opens[0]!;
  connection.send(channelFrame([], connection.key, connection.lease));
  const observer = room.subscribe(() => {});
  await observer.until(value => value.status === "ready");
  assert.equal(owner.writes.length, 0);
  await room.set({ typing: false });
  assert.equal(owner.writes.length, 1);
  assert.deepEqual(owner.writes[0]!.body.value, { typing: false });
  observer.close(); room.close();
});

test("concurrent commands allocate versions in invocation order without predicting snapshots", async context => {
  const owner = wire(); context.after(() => owner.client.close());
  const room = owner.client.channel(api.typing, {}), observer = room.subscribe(() => {});
  await observer.until(value => value.status === "ready");
  const response = deferred<Response>();
  owner.response(async kind => kind === "set" ? response.promise : json({ ok: true }));
  const value = { typing: true };
  const setting = room.set(value);
  value.typing = false;
  const clearing = room.clear();
  await eventually(() => owner.writes.length === 2);
  assert.deepEqual(owner.writes.map(command => [command.kind, command.body.version]), [["set", 1], ["clear", 2]]);
  assert.deepEqual(owner.writes[0]!.body.value, { typing: true });
  await clearing;
  assert.deepEqual(room.getSnapshot().entries, []);
  response.resolve(json({ ok: true }));
  await setting;
  observer.close(); room.close();
});

test("reconnect erases state, replaces the lease and never replays an ambiguous set", async context => {
  const owner = wire(); context.after(() => owner.client.close());
  const room = owner.client.channel(api.typing, {}), observer = room.subscribe(() => {});
  await observer.until(value => value.status === "ready");
  const first = owner.opens[0]!;
  first.send(channelFrame([entry(first.key)], first.key, first.lease));
  await observer.until(value => value.entries.length === 1);
  const response = deferred<Response>();
  owner.response(async () => response.promise);
  const setting = room.set({ typing: false });
  const rejected = assert.rejects(setting, { code: "E_CHANNEL_LEASE" });
  await eventually(() => owner.writes.length === 1);
  first.end();
  await observer.until(value => value.status === "unavailable");
  assert.deepEqual(room.getSnapshot().entries, []);
  assert.equal(room.getSnapshot().key, undefined);
  await assert.rejects(room.set({ typing: true }), { code: "E_CHANNEL_LEASE" });
  const reconnected = await observer.until(value => value.status === "ready" && value.key !== first.key);
  assert.equal(owner.opens.length, 2);
  assert.ok(owner.opens.every(connection => connection.lastEventId === null));
  assert.deepEqual(reconnected.entries, []);
  response.resolve(json({ ok: true })); await rejected;
  assert.equal(owner.writes.length, 1, "no automatic republish on the fresh lease");
  observer.close(); room.close();
});

test("successor reset reconnects while ordinary refusal is terminal", async context => {
  const owner = wire(); context.after(() => owner.client.close());
  const room = owner.client.channel(api.typing, {}), observer = room.subscribe(() => {});
  const first = await observer.until(value => value.status === "ready");
  owner.opens[0]!.send({ state: "refused", code: "E_CHANNEL_RESET", family: "op", message: "new declaration", guide: "live-query" });
  await observer.until(value => value.status === "ready" && value.key !== first.key);
  const rejected = assert.rejects(observer.until(() => false), { code: "E_RULE_CHANNEL_SUBSCRIBE" });
  owner.opens[1]!.send({ state: "refused", code: "E_RULE_CHANNEL_SUBSCRIBE", family: "rule", message: "membership removed", guide: "live-query" });
  await rejected;
  assert.equal(room.getSnapshot().reason, "refused");
  assert.equal(room.getSnapshot().refusal?.code, "E_RULE_CHANNEL_SUBSCRIBE");
  assert.deepEqual(room.getSnapshot().entries, []);
  assert.equal(room.getSnapshot().key, undefined);
  await assert.rejects(room.set({ typing: true }), { code: "E_RULE_CHANNEL_SUBSCRIBE" });
  observer.close(); room.close();
});

test("a slow multiplexed channel consumer receives the newest full snapshot and terminal refusal", async () => {
  const { build } = createRequire(import.meta.url)("esbuild");
  const bundled = await build({ entryPoints: [new URL("../src/live.ts", import.meta.url).pathname],
    bundle: true, write: false, format: "esm", platform: "neutral" });
  const { SharedSse } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`);
  let output!: ReadableStreamDefaultController<Uint8Array>;
  let child: string | undefined;
  const encode = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
  const transport = new SharedSse("http://slow.test", async (input: string, init: RequestInit) => {
    if (input.endsWith("/control")) {
      child ??= JSON.parse(String(init.body)).add?.[0]?.id;
      return json({ ok: true });
    }
    return new Response(new ReadableStream({ start(controller) {
      output = controller; output.enqueue(encode({ session: "a".repeat(64) }));
    } }));
  });
  const abort = new AbortController();
  try {
    const response = await transport.open("/api/channel/typing/subscribe?args={}", undefined, abort.signal, new Headers(), async () => {});
    await eventually(() => child !== undefined);
    const send = (data: unknown, terminal = false) => output.enqueue(encode({ id: child, seq: null, data, terminal }));
    for (let n = 1; n <= 100; n++) send(channelFrame([{ ...entry("remote"), value: { n } }]));
    await pause(20); // The logical body remains deliberately unread during the burst.
    const reader = parseSse(response, abort.signal, () => {});
    const next = async () => {
      const chunk = await reader.next();
      assert.equal(chunk.done, false);
      return JSON.parse(chunk.value!.data);
    };
    const snapshots = [await next()];
    while (snapshots.at(-1).entries[0].value.n !== 100) {
      assert.ok(snapshots.length < 3, "slow consumer must keep a bounded number of replacement frames");
      snapshots.push(await next());
    }
    assert.equal(snapshots.at(-1).entries[0].value.n, 100);
    const refused = { state: "refused", code: "E_RULE_CHANNEL_SUBSCRIBE", family: "rule", message: "removed", guide: "live-query" };
    send(refused, true); send(channelFrame([]));
    assert.deepEqual(await next(), refused);
    assert.equal((await reader.next()).done, true);
  } finally { abort.abort(); transport.close(); }
});

test("React Strict Mode keeps the active handle and closes replaced/unmounted scopes", async context => {
  const owner = wire(); context.after(() => owner.client.close());
  let latest: ReturnType<typeof useChannel> | undefined;
  function Typing({ scope }: { scope: string }) {
    latest = useChannel(api.typing, { conversationId: scope });
    return React.createElement("output", null, latest.status);
  }
  const tree = (scope: string) => React.createElement(React.StrictMode, null,
    React.createElement(SnapbackProvider, { client: owner.client }, React.createElement(Typing, { scope })));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(tree("one")); await pause(20); });
  await act(async () => { await eventually(() => latest?.status === "ready"); });
  const first = owner.opens.at(-1)!;
  assert.equal(first.closed, false);
  await act(async () => { await latest!.set({ typing: true }); });
  await act(async () => { renderer.update(tree("two")); await pause(20); });
  await act(async () => { await eventually(() => latest?.status === "ready" && latest.key !== first.key); });
  assert.equal(first.closed, true);
  const second = owner.opens.at(-1)!;
  assert.equal(second.closed, false);
  await act(async () => { renderer.unmount(); await pause(20); });
  await eventually(() => owner.opens.every(connection => connection.closed));
});

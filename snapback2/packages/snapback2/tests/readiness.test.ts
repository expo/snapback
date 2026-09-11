import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api, createClient, readiness } from "../dist/client.mjs";
import { indexedDbRangeStore, SnapbackProvider, useMutation, useOutbox, useSnapbackClient } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { DAY, engineId, fakeOwner, seededStore } from "./fake-owner.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const pause = () => new Promise(done => setTimeout(done, 10));
const grant = (now = Date.now()) => ({ id: engineId(700), from: engineId(700), count: 100, used: 0, mintedAt: now, expiresAt: now + 30 * DAY });

for (const observers of [0, 1, 4]) {
  test(`${observers} observers: active replay waits; a real reconnect resumes the same stopped queue`, async () => {
    const root = await mkdtemp(join(tmpdir(), "s2-ready-drain-"));
    const store = fileRangeStore(root), owner = fakeOwner({ failAfterCommit: 1 });
    await seededStore(store);
    let release!: () => void, entered!: () => void, attempts = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    const sent = new Promise<void>(resolve => { entered = resolve; });
    const client = createClient({ url: "http://ready-drain.test", persona: "alice", offline: { store },
      fetch: async (input, init) => {
        if (new URL(String(input)).pathname === "/api/mutation") { attempts += 1; entered(); await held; }
        return owner.fetch(input, init);
      } });
    const views = Array.from({ length: observers }, () => client.outbox.observe(api.messages.send));
    const detach = views.map(view => view.subscribe(() => undefined));
    try {
      await client.ready; await client.offline();
      await client.mutation(api.messages.send, { conversationId: engineId(10), body: "one" });
      await client.mutation(api.messages.send, { conversationId: engineId(10), body: "two" });
      const delivery = client.online();
      await sent; await pause();
      const active = await client.outbox.status(api.messages.send);
      assert.equal(active.draining, true);
      assert.equal(readiness(active, client.snapshot.connection, 1).action, "wait");
      for (const view of views) assert.equal(view.getSnapshot().status.draining, true);
      assert.equal(attempts, 1, "observations never start replay");
      release(); await delivery;
      assert.equal((await client.outbox.settled()).stopped, "transport");
      await client.query(api.messages.inbox, { c: null });
      assert.equal(client.snapshot.connection, "connected");
      for (let count = 0; count < 100 && (await client.outbox.entries()).some(entry => entry.state === "queued"); count++) await pause();
      assert.equal((await client.outbox.settled()).remaining, 0);
      assert.deepEqual(owner.executions.map(item => (item.args as any).body), ["one", "two"], "lost acknowledgement keeps the original envelope and FIFO stop ordering");
    } finally {
      release(); detach.forEach(close => close()); await client.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("follower readiness keeps its inbox contract while detail.writer observes replay without writer-side hooks", async () => {
  const store = indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
  await seededStore(store);
  const owner = fakeOwner({ failAfterCommit: 1 });
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const sent = new Promise<void>(resolve => { entered = resolve; });
  const writer = createClient({ url: "http://ready-writer.test", persona: "alice", offline: { store },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/mutation") { entered(); await held; }
      return owner.fetch(input, init);
    } });
  await writer.ready;
  const follower = createClient({ url: "http://ready-writer.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  const view = follower.outbox.observe(api.messages.send), close = view.subscribe(() => undefined);
  let mutation: any, outbox: any, renderer: TestRenderer.ReactTestRenderer | undefined, delivery: Promise<void>;
  function Harness() { mutation = useMutation(api.messages.send); outbox = useOutbox(); return null; }
  const until = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 300; attempt++) { if (condition()) return; await pause(); }
    assert.fail("follower did not receive writer activity");
  };
  try {
    await follower.ready; await until(() => view.getSnapshot().status.reason === "forwarding");
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client: follower, children: React.createElement(Harness) }));
      await writer.offline();
      await writer.mutation(api.messages.send, { conversationId: engineId(10), body: "shared activity" });
      delivery = writer.online();
      await sent; await until(() => view.getSnapshot().writer?.draining === true);
    });
    assert.equal(outbox.detail.writer.draining, true);
    assert.equal(outbox.detail.writer.draining, true);
    assert.equal(outbox.detail.status.reason, "forwarding");
    assert.equal(outbox.detail.status.draining, undefined, "writer activity is separate from this tab's admission readiness");
    assert.equal(mutation.can.send, true); assert.equal(mutation.can.action, "wait");
    assert.match(mutation.can.reason.message, /Waiting for the sending tab/);
    await act(async () => {
      release(); await delivery;
      await until(() => view.getSnapshot().writer?.draining === undefined);
    });
    assert.equal((await writer.outbox.settled()).stopped, "transport");
    assert.equal(outbox.detail.writer.draining, undefined, "a stop publishes even when no durable entry changes");
    assert.equal(outbox.detail.status.reason, "forwarding");
    assert.equal(mutation.can.action, "wait");
    await act(async () => { await writer.outbox.drain(); });
    assert.equal(owner.executions.length, 1);
  } finally {
    release(); close(); await act(async () => { renderer?.unmount(); });
    await follower.close(); await writer.close();
  }
});

for (const carrier of ["file", "IndexedDB"]) {
  test(`${carrier}: ready() and ready(op) return false on sealed custody`, async () => {
    const root = await mkdtemp(join(tmpdir(), "s2-ready-"));
    const factory = carrier === "file" ? fileRangeStore(root)
      : indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
    await seededStore(factory);
    let store: any;
    const client = createClient({ url: "http://ready.test", persona: "alice", fetch: fakeOwner().fetch, offline: { store: () => (store = factory()) } });
    try {
      await client.ready;
      assert.equal(await client.outbox.ready(api.messages.send), true);
      await store.seal();
      assert.equal(await client.outbox.ready(), false);
      assert.equal(await client.outbox.ready(api.messages.send), false);
    } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
  });
}

async function mounted(seeded = false) {
  const root = await mkdtemp(join(tmpdir(), "s2-ready-react-"));
  const store = fileRangeStore(root);
  if (seeded) await seededStore(store);
  const owner = fakeOwner();
  let client: any, mutation: any, outbox: any, renderer: TestRenderer.ReactTestRenderer;
  const rendered: Array<{ op: string; ready: boolean }> = [];
  function Harness({ op }: { op: string }) {
    client = useSnapbackClient();
    mutation = useMutation((api as any).messages[op]);
    outbox = useOutbox();
    rendered.push({ op, ready: mutation.can.send });
    return null;
  }
  const view = (op: string) => React.createElement(SnapbackProvider,
    { url: "http://react-ready.test", persona: "alice", fetch: owner.fetch, offline: { store } }, React.createElement(Harness, { op }));
  await act(async () => { renderer = TestRenderer.create(view("send")); });
  await act(async () => { await client.ready; await pause(); });
  return { get client() { return client; }, get mutation() { return mutation; }, get outbox() { return outbox; }, rendered,
    async change(op: string) { await act(async () => { renderer.update(view(op)); }); },
    async close() { await act(async () => { renderer.unmount(); }); await client.close(); await rm(root, { recursive: true, force: true }); },
  };
}

test("bound adoption alone updates useMutation.ready without an entries change", async () => {
  const f = await mounted();
  try {
    const ledger = f.client.offlineRuntime.outbox;
    await act(async () => { await ledger.recordBounds({}); await ledger.adopt(grant()); await pause(); });
    assert.equal(f.outbox.can.send, true);
    assert.equal(f.mutation.can.send, false);
    await act(async () => { await ledger.recordBounds({ "messages.send": 51 }); await pause(); });
    assert.equal(f.mutation.can.send, true);
    assert.deepEqual(f.outbox.entries, []);
    await act(async () => { await ledger.recordBounds({ "messages.send": 100 }); await pause(); });
    assert.equal(f.mutation.can.send, false, "a larger bound no longer fits the same grant");
  } finally { await f.close(); }
});

test("operation change mid-probe hides old readiness and ignores superseded completions", async () => {
  const f = await mounted();
  try {
    await f.client.offline(); // Isolate projection probes from the recovery owner's own admission checks.
    const ledger = f.client.offlineRuntime.outbox;
    await act(async () => { await ledger.adopt(grant()); await pause(); });
    assert.equal(f.mutation.can.send, true);
    const probes: Array<(ready: boolean) => void> = [];
    const original = ledger.status.bind(ledger);
    ledger.status = (op: unknown) => op === undefined ? original() : new Promise<boolean>(resolve => probes.push(resolve))
      .then(ready => ({ ready, reason: ready ? "ready" : "program-missing", action: ready ? "none" : "load-program", remaining: 0, fence: "inside" }));
    await act(async () => { ledger.notify(); await pause(); });
    assert.equal(probes.length, 1);
    f.rendered.length = 0;
    await f.change("unbound");
    await act(async () => { await pause(); });
    assert.equal(probes.length, 2);
    assert.ok(f.rendered.filter(x => x.op === "unbound").every(x => !x.ready), "no frame exposes the old operation's true value");
    await act(async () => { probes[1](false); await Promise.resolve(); probes[0](true); await Promise.resolve(); });
    assert.equal(f.mutation.can.send, false);
    await act(async () => { ledger.notify(); await pause(); ledger.notify(); await pause(); });
    assert.equal(probes.length, 4);
    await act(async () => { probes[3](false); await Promise.resolve(); probes[2](true); await Promise.resolve(); });
    assert.equal(f.mutation.can.send, false);
  } finally { await f.close(); }
});

for (const boundary of ["fence", "expiresAt"]) {
  test(`time alone notifies mounted hooks at the ${boundary} boundary: the fence turns past, expiry invalidates ready`, async (t) => {
    const f = await mounted();
    try {
      const now = Date.now();
      t.mock.timers.enable({ apis: ["Date", "setTimeout"], now });
      const held = grant(boundary === "fence" ? now - 7 * DAY + 10 : now);
      if (boundary === "expiresAt") held.expiresAt = now + 11;
      await act(async () => { await f.client.offlineRuntime.outbox.adopt(held); });
      assert.equal(f.outbox.can.send, true);
      assert.equal(f.outbox.detail.status.fence, "inside");
      assert.equal(f.mutation.can.send, true);
      await act(async () => { t.mock.timers.tick(11); });
      if (boundary === "fence") {
        // Merged with lane F (LLP 1012 revision (i)): the fence bounds trust —
        // prediction and replay — never custody, so ready stays true past it and
        // the hook's `fence` reports the crossing; only expiry unreadies a write.
        assert.equal(await f.client.outbox.ready(), true);
        assert.equal(await f.client.outbox.fence(), "past");
        assert.equal(f.outbox.can.send, true);
        assert.equal(f.outbox.detail.status.fence, "past");
        assert.equal(f.mutation.can.send, true);
      } else {
        assert.equal(await f.client.outbox.ready(), false);
        assert.equal(f.outbox.can.send, false);
        assert.equal(f.mutation.can.send, false);
      }
      assert.deepEqual(f.outbox.entries, []);
    } finally { t.mock.timers.reset(); await f.close(); }
  });
}

test("mutation work follows the durable entry while last keeps the admission result", async () => {
  const f = await mounted(true);
  const view = f.client.outbox.observe(api.messages.send), detach = view.subscribe(() => {});
  try {
    await act(async () => { await f.client.offline(); });
    let admitted: any;
    await act(async () => {
      admitted = await f.mutation.run({ conversationId: engineId(10), body: "kept until recovery" });
      await pause();
    });
    assert.equal(admitted.state, "queued", JSON.stringify(admitted));
    assert.strictEqual(f.mutation.last, admitted);
    assert.equal(f.mutation.work.entry.intent, admitted.intent);
    assert.equal(f.mutation.work.dismissible, false);
    assert.strictEqual(f.mutation.work, view.getWork(admitted.intent), "hooks and headless slots share one work index");
    assert.strictEqual(f.outbox.work, view.getSnapshot().work);
    assert.equal(Object.isFrozen(f.mutation.work), true);
    assert.equal(Object.isFrozen(f.mutation.work.entry), true);
    assert.strictEqual(f.mutation.can, view.getSnapshot().can);
    await act(async () => { assert.deepEqual(await f.outbox.recover(), { settlement: { stopped: false, remaining: 0 } }); await pause(); });
    assert.strictEqual(f.mutation.last, admitted, "recovery does not rewrite the immediate call result");
    assert.ok(f.mutation.work === undefined || f.mutation.work.entry.state === "committed");
    if (f.mutation.work) await act(async () => { await f.outbox.dismiss(admitted.intent); await pause(); });
    assert.equal(f.mutation.work, undefined, "dismissal/compaction removes the derived work item");
    await f.change("edit");
    assert.equal(f.mutation.last, undefined);
    assert.equal(f.mutation.work, undefined);
  } finally { detach(); await f.close(); }
});

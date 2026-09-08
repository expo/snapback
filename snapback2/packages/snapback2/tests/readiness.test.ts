import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api, createClient } from "../dist/client.mjs";
import { indexedDbRangeStore, SnapbackProvider, useMutation, useOutbox, useSnapbackClient } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { DAY, engineId, fakeOwner, seededStore } from "./fake-owner.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const pause = () => new Promise(done => setTimeout(done, 10));
const grant = (now = Date.now()) => ({ id: engineId(700), from: engineId(700), count: 100, used: 0, mintedAt: now, expiresAt: now + 30 * DAY });

for (const carrier of ["file", "IndexedDB"]) {
  test(`${carrier}: ready() and ready(op) return false on sealed custody`, async () => {
    const root = await mkdtemp(join(tmpdir(), "s2-ready-"));
    const factory = carrier === "file" ? fileRangeStore(root)
      : indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
    await seededStore(factory);
    let store: any;
    const client = createClient({ url: "http://ready.test", as: "alice", fetch: fakeOwner().fetch, offline: { store: () => (store = factory()) } });
    try {
      await client.ready;
      assert.equal(await client.outbox.ready(api.deliveries.post), true);
      await store.seal();
      assert.equal(await client.outbox.ready(), false);
      assert.equal(await client.outbox.ready(api.deliveries.post), false);
    } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
  });
}

async function mounted() {
  const root = await mkdtemp(join(tmpdir(), "s2-ready-react-"));
  const store = fileRangeStore(root);
  const owner = fakeOwner();
  let client: any, mutation: any, outbox: any, renderer: TestRenderer.ReactTestRenderer;
  const rendered: Array<{ op: string; ready: boolean }> = [];
  function Harness({ op }: { op: string }) {
    client = useSnapbackClient();
    mutation = useMutation((api as any).deliveries[op]);
    outbox = useOutbox();
    rendered.push({ op, ready: mutation.can.send });
    return null;
  }
  const view = (op: string) => React.createElement(SnapbackProvider,
    { url: "http://react-ready.test", as: "alice", fetch: owner.fetch, offline: { store } }, React.createElement(Harness, { op }));
  await act(async () => { renderer = TestRenderer.create(view("post")); });
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
    await act(async () => { await ledger.recordBounds({ "deliveries.post": 51 }); await pause(); });
    assert.equal(f.mutation.can.send, true);
    assert.deepEqual(f.outbox.entries, []);
    await act(async () => { await ledger.recordBounds({ "deliveries.post": 100 }); await pause(); });
    assert.equal(f.mutation.can.send, false, "a larger bound no longer fits the same grant");
  } finally { await f.close(); }
});

test("operation change mid-probe hides old readiness and ignores superseded completions", async () => {
  const f = await mounted();
  try {
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

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { emptyItemInputs, withItemInputs } from "../dist/image-runtime.mjs";
import { OfflineRuntime, offlineView } from "../dist/sqlite-test.mjs";
import { fileRangeStore } from "../dist/test.mjs";

const tempRoot = () => mkdtemp(join(tmpdir(), "snapback2-owner-custody-"));

test("an exact cached scalar survives an uncovered cold rerun but not a newer local prediction", () => {
  const held = {
    op: "caps.countFor", args: { principal: "dev:zero" }, state: "complete" as const,
    data: 0, next: null, seq: 7, deliveredAt: 100,
  };
  const cold = offlineView(held, { state: "partial", reason: "missing-authority", site: "count", seq: 7 });
  assert.equal(cold.state, "complete");
  assert.equal(cold.data, 0);
  assert.deepEqual(cold.stale, { since: 100 });
  const predicted = offlineView(held, {
    state: "partial", reason: "missing-authority", site: "count", seq: 8, predicted: ["intent"], data: 1,
  });
  assert.equal(predicted.state, "partial");
  assert.equal(predicted.data, 1, "new local work is not hidden behind an older cached scalar");
});

test("an exact receipt-backed owner page keeps its whole continuation across an uncovered projection", () => {
  const held = {
    op: "social.feed", args: { c: null }, state: "capped" as const,
    data: [{ id: "post-1", likes: 0, liked: false }], next: "server-page-2", seq: 7, deliveredAt: 100,
    receipt: { ranges: [], absences: [], verdicts: [] },
  };
  const ownerRerun = (value: any, through = 7, overlay = false) => withItemInputs(value,
    { ...emptyItemInputs, ...(overlay ? { entries: [{ predicted: true } as any] } : {}), selection: { through } });
  const view = offlineView(held, ownerRerun({
    state: "partial", reason: "computed-key", site: "social.feed.likes", seq: 7,
    data: [{ id: "post-1", likes: 0, liked: false }],
  }));
  assert.equal(view.state, "capped");
  assert.deepEqual(view.data, held.data);
  assert.equal(view.next, "server-page-2", "the owner answer keeps its own certified boundary");

  const completeRerun = offlineView(held, ownerRerun({
    state: "complete", seq: 7, next: null,
    data: [{ id: "post-1", likes: 0, liked: false }],
  }));
  assert.equal(completeRerun.state, "capped");
  assert.equal(completeRerun.next, "server-page-2",
    "the same owner selection cannot erase its opaque continuation");

  const newerComplete = offlineView(held, ownerRerun({
    state: "complete", seq: 8, next: null,
    data: [{ id: "post-new", likes: 1, liked: true }],
  }, 8));
  assert.equal(newerComplete.state, "complete");
  assert.deepEqual(newerComplete.data, [{ id: "post-new", likes: 1, liked: true }],
    "a newer exact local result is not concealed by the older owner page");
  assert.equal(newerComplete.next, null);

  const queuedRemoval = offlineView(held, ownerRerun({
    state: "partial", reason: "computed-key", site: "social.feed.likes", seq: 7,
    data: [], predicted: [],
  }, 7, true));
  assert.equal(queuedRemoval.state, "partial");
  assert.deepEqual(queuedRemoval.data, [], "a queued removal with no surviving predicted row stays visible");
  assert.equal(queuedRemoval.next, undefined);

  const predicted = offlineView(held, {
    state: "partial", reason: "computed-key", site: "social.feed.likes", seq: 8,
    data: [{ id: "post-new", likes: 0, liked: false }, ...held.data],
    predicted: [{ table: "posts", id: "post-new", intent: "intent" }],
  });
  assert.equal(predicted.state, "partial");
  assert.equal(predicted.data[0].id, "post-new", "newer local work is not hidden behind the owner page");
  assert.equal(predicted.next, undefined, "a partial prediction never inherits the owner cursor");

  const invalidated = offlineView({ ...held, state: "partial" as const, reason: "evicted", next: undefined }, {
    state: "partial", reason: "evicted", site: "social.feed.page", seq: 8,
    data: [{ id: "post-remaining", likes: 0, liked: false }],
  });
  assert.equal(invalidated.state, "partial");
  assert.equal(invalidated.data[0].id, "post-remaining",
    "invalidated custody does not conceal a newer revocation behind the old answer");
  assert.equal(invalidated.next, undefined);
});

test("a pending session grant never crosses principals after a failed partition open", async () => {
  const root = await tempRoot();
  const backing = fileRangeStore(root);
  let refuseBob = true;
  const failedAdoptionStarted = Promise.withResolvers<void>();
  const releaseFailedAdoption = Promise.withResolvers<void>();
  let failGrant = "grant-a-old";
  const runtime = new OfflineRuntime({ store: () => {
    const store = backing();
    const open = store.open.bind(store);
    const commit = store.commit.bind(store);
    store.open = async (principal: string) => {
      if (principal === "dev:bob" && refuseBob) { refuseBob = false; throw new Error("bob carrier unavailable"); }
      await open(principal);
    };
    store.commit = async (swap: any) => {
      if (swap.grants?.put?.[0]?.id === failGrant) {
        failGrant = "";
        failedAdoptionStarted.resolve();
        await releaseFailedAdoption.promise;
        throw new Error("grant persistence failed");
      }
      await commit(swap);
    };
    return store;
  } });
  const response = (suffix: string) => ({ grant: {
    id: `grant-${suffix}`,
    from: `s2id-0000000000000000000000000000000${suffix}-0000000000000001`,
    count: 16, mintedAt: Date.now(), expiresAt: Date.now() + 60_000,
  } });
  try {
    await runtime.open("dev:alice", true);
    runtime.noteGrant({ ...response("a"), grant: { ...response("a").grant, id: "grant-a-old" } }, "dev:alice");
    const failedAdoption = runtime.adoptPendingGrant();
    await failedAdoptionStarted.promise;
    runtime.noteGrant({ ...response("a"), grant: { ...response("a").grant, id: "grant-a" } }, "dev:alice");
    releaseFailedAdoption.resolve();
    await assert.rejects(failedAdoption, /grant persistence failed/);
    await runtime.adoptPendingGrant();
    assert.equal((await runtime.outbox.grant())?.id, "grant-a");

    runtime.noteGrant(response("b"), "dev:bob");
    await assert.rejects(runtime.open("dev:bob", true), /bob carrier unavailable/);
    assert.equal(runtime.principal, undefined, "the failed account switch leaves no partition named");
    await runtime.open("dev:alice", true);
    assert.equal(await runtime.outbox.grant(), undefined,
      "restoring the previous account discards, rather than adopts, Bob's pending grant");

    runtime.noteGrant(response("b"), "dev:bob");
    await runtime.open("dev:bob", true);
    assert.equal((await runtime.outbox.grant())?.id, "grant-b",
      "retrying the same principal keeps its pending grant recoverable");

    runtime.noteGrant(response("c"), "dev:carol");
    await runtime.wipe();
    await runtime.open("dev:carol", true);
    assert.equal(await runtime.outbox.grant(), undefined, "wipe clears obsolete pending grant custody");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { api,
  createClient,
  initialQueryState,
  reduceQueryState } from "../dist/client.mjs";
import { RefusalError } from "../dist/client-observed-test.mjs";
import { configureRealOwner, RealOwnerHarness } from "./owner-harness.ts";

const owner = await configureRealOwner();
after(async () => owner.close());

// @ref LLP 1006#2a1-one-use-image-delivery-clique-f3-2026-09-05 — the carrier
// retains schema custody, but the twin never republishes once media offline.
test("a live view-once descriptor survives its durable refresh, while a cold offline reopen still hides it", async () => {
  const { readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const directory = await mkdtemp(join(tmpdir(), "snapback-once-cold-"));
  const sender = createClient({ url: owner.url, persona: "alice" });
  let client: any;
  let cold: any;
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const photo = await sender.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const posted: any = await sender.mutation(api.messages.sendOncePhoto, { conversationId: "conversation-1", photo });
    assert.equal(posted.state, "committed");

    const localRefresh = Promise.withResolvers<any>();
    client = createClient({
      url: owner.url,
      persona: "alice",
      offline: { store: fileRangeStore(directory) },
      offlineReadObserver: (_ref: unknown, _args: unknown, result: any) => {
        if (result?.data?.some?.((row: any) => row?.message?.id === posted.data.id)) localRefresh.resolve(result);
      },
    } as any);
    const observed = client.observe(api.messages.thread, { conversationId: "conversation-1", c: null });
    const live = Promise.withResolvers<any>();
    const stop = observed.subscribe(() => {
      const snapshot = observed.getSnapshot();
      if (snapshot.freshness.live && snapshot.data?.some?.((row: any) => row?.message?.id === posted.data.id)) live.resolve(snapshot);
    });
    await Promise.race([live.promise, new Promise((_, reject) => setTimeout(() => reject(new Error("live once-photo snapshot timed out")), 5_000))]);
    const local: any = await Promise.race([localRefresh.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("durable once-photo refresh timed out")), 5_000))]);
    assert.equal(local.data.find((row: any) => row?.message?.id === posted.data.id)?.message.oncePhoto, null,
      "the twin keeps the schema-once value unavailable for an offline publication");
    const durableLive = observed.getSnapshot();
    assert.equal(durableLive.freshness.live, true);
    assert.equal(durableLive.receipt?.source, "server");
    assert.equal(durableLive.data.find((row: any) => row?.message?.id === posted.data.id)?.message.oncePhoto.id, photo.id,
      "persisting the frame cannot replace its live server descriptor with the twin's offline null");
    stop();

    await client.offline();
    cold = await client.restart();
    client = undefined;
    const held: any = await cold.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(held.live, false);
    assert.equal(held.state, "complete");
    assert.equal(held.data.find((row: any) => row?.message?.id === posted.data.id)?.message.oncePhoto, null,
      "the cold carrier retained the once descriptor and applied its offline refusal");
    assert.equal(await cold.assetCache.viewOnce(photo.id), true, "the cold byte policy derives once from durable schema custody");
    const coldObserved = cold.observe(api.messages.thread, { conversationId: "conversation-1", c: null });
    const published = Promise.withResolvers<any>();
    const reconnected = Promise.withResolvers<any>();
    const coldStates: any[] = [];
    const stopCold = coldObserved.subscribe(() => {
      const snapshot = coldObserved.getSnapshot();
      coldStates.push(snapshot);
      if (snapshot.receipt) published.resolve(snapshot);
      if (snapshot.freshness.live
        && snapshot.data?.find?.((row: any) => row?.message?.id === posted.data.id)?.message.oncePhoto?.id === photo.id) {
        reconnected.resolve(snapshot);
      }
    });
    const coldSnapshot = await Promise.race([published.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("cold once-photo snapshot timed out")), 5_000))]);
    assert.equal(coldSnapshot.receipt.source, "twin");
    assert.equal(coldSnapshot.freshness.live, false);
    assert.equal(coldSnapshot.data.find((row: any) => row?.message?.id === posted.data.id)?.message.oncePhoto, null);
    await cold.online();
    const coldLive: any = await Promise.race([reconnected.promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`cold once-photo reconnect timed out: ${JSON.stringify(coldStates)}`)), 5_000))]);
    assert.equal(coldLive.receipt.source, "server");
    assert.equal(coldLive.freshness.live, true);
    stopCold();
  } finally {
    await client?.close();
    await cold?.close();
    await sender.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("chat once photo uses one message and upload, each member gets one server delivery, and web stores no bytes", async () => {
  const { readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const directory = await mkdtemp(join(tmpdir(), "snapback-once-owner-"));
  const sender = createClient({ url: owner.url, persona: "alice" });
  const alice = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(join(directory, "alice")) } });
  const bob = createClient({ url: owner.url, persona: "bob", offline: { store: fileRangeStore(join(directory, "bob")) } });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const photo = await sender.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const posted = await sender.mutation(api.messages.sendOncePhoto, { conversationId: "conversation-1", photo });
    assert.equal(posted.state, "committed");
    const ordinary = await sender.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const normal = await sender.mutation(api.messages.sendPhoto, { conversationId: "conversation-1", photo: ordinary });
    assert.equal(normal.state, "committed");
    // @ref LLP 1018.005#4-the-recipe — a photo send fans out through `proc deliver` like a message: one delivery per recipient, no harness workaround.
    const manifest: any = await alice.manifest();
    assert.equal(manifest.tables.messages.columns.oncePhoto.Optional.Image.once, true);
    for (const client of [alice, bob]) {
      const thread: any = await client.query(api.messages.thread, { conversationId: "conversation-1", c: null });
      assert.ok(thread.data.some((row: any) => row?.message?.oncePhoto?.id === photo.id));
      assert.equal(thread.data.filter((row: any) => row?.message?.id === normal.data.id).length, 1,
        "sendPhoto delivers exactly one message event per recipient");
      const ordinaryUrl = (await client.assetUrl(ordinary))!;
      await client.assetBlob(ordinaryUrl);
      assert.equal(await client.assetCache!.viewOnce(photo.id), true);
      // Even unviewed once media disappears offline, including after a cold store open.
      await client.offline();
      const local: any = await client.query(api.messages.thread, { conversationId: "conversation-1", c: null });
      assert.ok(local.data.some((row: any) => row?.message?.id === posted.data.id && row.message.oncePhoto === null));
      assert.ok(local.data.some((row: any) => row?.message?.photo?.id === ordinary.id));
      assert.ok((await client.assetBlob(ordinaryUrl)).size > 0, "ordinary photo in the same page renders from held bytes");
      await client.online();
      const url = (await client.assetUrl(photo))!;
      const viewing = {};
      assert.ok((await client.assetBlob(url, { viewing })).size > 0);
      assert.deepEqual((await client.assetCache!.status()).entries.map((entry: any) => entry.assetId), [ordinary.id]);
      const coverage = await (client as any).offlineRuntime.store.coverage();
      assert.ok(coverage.absences.some((absence: any) => JSON.stringify(absence) === JSON.stringify(["messages", "byId", [posted.data.id]])));
      assert.ok(!coverage.rows.some((row: any) => row.table === "messages" && row.id === posted.data.id));
      const direct = await fetch(url, { headers: { "X-Snapback-As": client.snapshot.persona! } });
      assert.equal(direct.status, 410); assert.equal((await direct.json()).code, "E_ASSET_VIEWED");
      await assert.rejects(client.assetBlob(url, { viewing: {} }), (error: any) => error.code === "E_ASSET_VIEWED");
    }
  } finally { await sender.close(); await alice.close(); await bob.close(); await rm(directory, { recursive: true, force: true }); }
});

test("offline sendOncePhoto prediction under the message alias has null media and makes no asset fetch", async () => {
  const { readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const { engineId } = await import("./fake-owner.ts");
  const directory = await mkdtemp(join(tmpdir(), "snapback-once-predict-"));
  let assetFetches = 0;
  const client: any = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(directory) }, fetch: (input, init) => {
    if (new URL(String(input)).pathname.startsWith("/api/asset/")) assetFetches++;
    return fetch(input, init);
  } });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const photo = await client.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const args = { conversationId: "conversation-1", photo };
    await client.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    await client.offline();
    const runtime = client.offlineRuntime;
    const ids = Array.from({ length: 120 }, (_, i) => engineId(50_000 + i));
    const prediction = await runtime.twin.predict("messages.sendOncePhoto", args, ids);
    assert.equal(prediction.predicted, true, JSON.stringify(prediction));
    const message = prediction.overlay.find((row: any) => row.table === "messages");
    assert.ok(message);
    // Raw typed writes belong to the replay overlay; only evaluated media is scrubbed.
    assert.equal(message.row.oncePhoto.id, photo.id);
    const entry = { intent: "once-prediction:0", grant: "once-prediction", offset: 0, count: ids.length, ids,
      op: "messages.sendOncePhoto", args, issuedSeq: 0, createdAt: 1, updatedAt: 1, state: "queued", predicted: true, trace: prediction.trace };
    await runtime.store.commit({ outbox: { put: [entry] }, overlay: { put: { [entry.intent]: prediction.overlay } } });
    const local = await runtime.twin.evaluate("messages.thread", { conversationId: "conversation-1", c: null });
    assert.ok(local?.data?.some((row: any) => row?.message?.id === message.id && row.message.oncePhoto === null), JSON.stringify(local));
    const rendered = await client.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.ok(rendered.data?.some((row: any) => row?.message?.id === message.id && row.message.oncePhoto === null), JSON.stringify(rendered));
    assert.equal(assetFetches, 0);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Expo witness seed leaves Alice's schema-once image unconsumed and keeps its clip ordinary", async () => {
  const previous = process.env.SNAPBACK_URL;
  delete process.env.SNAPBACK_URL;
  let fixture: RealOwnerHarness | undefined;
  try {
    // Start once with the full template; closing and recreating the fixture spent the test's budget.
    fixture = await RealOwnerHarness.create({ fullChat: true });
    const url = fixture.url;
    const { seedWitness } = await import("../../../scripts/witness-expo/owner.mjs");
    const seed = await seedWitness(url);
    assert.equal(seed.forbidden.length, 1);
    const get = (id: string, as = "alice") => fetch(`${url}/api/asset/${id}`, { headers: { "X-Snapback-As": as } });
    const first = await get(seed.assets[1].id);
    assert.equal(first.status, 200); await first.arrayBuffer();
    assert.equal((await get(seed.assets[1].id)).status, 410);
    assert.equal((await get(seed.assets[1].id, "bob")).status, 410, "host signature consumed only Bob's use");
    for (let i = 0; i < 2; i++) {
      const clip = await get(seed.assets[2].id); assert.equal(clip.status, 200); await clip.arrayBuffer();
    }
  } finally {
    await fixture?.close();
    if (previous === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previous;
  }
});

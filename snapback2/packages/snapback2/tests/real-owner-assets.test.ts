import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  SnapbackRefusal,
  api,
  createClient,
  initialQueryState,
  reduceQueryState,
} from "../dist/client.mjs";
import { configureRealOwner, RealOwnerHarness } from "./owner-harness.ts";

const owner = await configureRealOwner();
after(async () => owner.close());

test("real owner private asset bytes and conditional responses forbid HTTP cache storage", async () => {
  const { readFile } = await import("node:fs/promises");
  const client = createClient({ url: owner.url, as: "alice" });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const photo = await client.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const posted = await client.mutation(api.messages.sendPhoto, { conversationId: "conversation-1", photo });
    assert.equal(posted.state, "committed");
    const url = (await client.assetUrl(photo))!;
    const preflight = await fetch(url, { method: "OPTIONS", headers: {
      Origin: "http://client.example", "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "cache-control,x-snapback-as",
    } });
    assert.equal(preflight.status, 204);
    assert.ok(preflight.headers.get("Access-Control-Allow-Headers")?.toLowerCase().split(/,\s*/).includes("cache-control"));
    const headers = await client.assetHeaders();
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
    const bytes = await response.arrayBuffer(); assert.ok(bytes.byteLength > 0);
    const partial = await fetch(url, { headers: { ...headers, Range: "bytes=0-9" } });
    assert.equal(partial.status, 206); assert.equal(partial.headers.get("Cache-Control"), "no-store"); await partial.arrayBuffer();
    const conditional = await fetch(url, { headers: { ...headers, "If-None-Match": response.headers.get("ETag")! } });
    assert.equal(conditional.status, 304); assert.equal(conditional.headers.get("Cache-Control"), "no-store");
  } finally { await client.close(); }
});

test("twenty-four refused File mutations recover their staging quota immediately", async () => {
  const { readFile } = await import("node:fs/promises");
  const client = createClient({ url: owner.url, as: "upload-refusals" });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    for (let index = 0; index < 24; index++) {
      const result = await client.mutation(api.messages.sendPhoto, {
        conversationId: "conversation-1", photo: new File([png], "photo.png", { type: "image/png" }),
      });
      assert.equal(result.state, "rejected", `attempt ${index} returns the mutation refusal, not a quota failure`);
      const listing = await client.listUploads();
      assert.deepEqual(listing.usage, { bytes: 0, objects: 0 });
      assert.deepEqual(listing.uploads, []);
    }
  } finally { await client.close(); }
});

test("cyclic mutation arguments release uploaded bytes without sending a mutation", async () => {
  const { readFile } = await import("node:fs/promises");
  let mutations = 0;
  let uploads = 0;
  const client = createClient({ url: owner.url, as: "upload-serialization", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/mutation") mutations++;
    if (path === "/api/upload") uploads++;
    return fetch(input, init);
  } });
  const metadata: any = {};
  metadata.self = metadata;
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    for (let index = 0; index < 24; index++) {
      await assert.rejects(client.mutation(api.messages.sendPhoto, {
        conversationId: "conversation-1", photo: new File([png], "photo.png"), metadata,
      } as any), TypeError);
      const listing = await client.listUploads();
      assert.deepEqual(listing.usage, { bytes: 0, objects: 0 });
      assert.deepEqual(listing.uploads, []);
    }
    assert.equal(uploads, 24);
    assert.equal(mutations, 0);
  } finally { await client.close(); }
});

test("failed outbox admission or prediction leaves no upload, intent, or mutation request", async () => {
  const { readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const directory = await mkdtemp(join(tmpdir(), "snapback-upload-admission-"));
  let mutations = 0;
  const client = createClient({ url: owner.url, as: "alice", offline: { store: fileRangeStore(directory) },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/mutation") mutations++;
      return fetch(input, init);
    },
  });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const initial = (await client.listUploads()).usage;
    for (let index = 0; index < 24; index++) {
      await assert.rejects(client.mutation(api.messages.sendPhoto, {
        conversationId: "conversation-1", photo: new File([png], "photo.png"),
      }), (error: any) => error.code === "E_OFFLINE_ID_BLOCK");
      assert.deepEqual((await client.listUploads()).usage, initial);
      assert.deepEqual(await client.outbox.entries(), []);
    }
    const drain = client.subscribe(api.integration.inbox, { c: null }, () => {}, { drain: true });
    await drain.until((event: any) => event.live === true, 3_000);
    drain.close();
    (client as any).offlineRuntime.predict = async () => { throw new Error("prediction failed before custody"); };
    await assert.rejects(client.mutation(api.messages.sendPhoto, {
      conversationId: "conversation-1", photo: new File([png], "photo.png"),
    }), /prediction failed before custody/);
    assert.deepEqual((await client.listUploads()).usage, initial);
    assert.deepEqual(await client.outbox.entries(), []);
    assert.equal(mutations, 0);
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test("an outbox persistence failure after commit retains media for replay", async () => {
  const { readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const directory = await mkdtemp(join(tmpdir(), "snapback-upload-durable-"));
  const client = createClient({ url: owner.url, as: "alice", offline: { store: fileRangeStore(directory) } });
  try {
    const drain = client.subscribe(api.integration.inbox, { c: null }, () => {}, { drain: true });
    await drain.until((event: any) => event.live === true, 3_000);
    drain.close();
    const runtime = (client as any).offlineRuntime;
    const commit = runtime.store.commit.bind(runtime.store);
    runtime.store.commit = async (change: any) => {
      await commit(change);
      if (change.outbox?.put?.length) throw new Error("storage acknowledgement lost after commit");
    };
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    await assert.rejects(client.mutation(api.messages.sendPhoto, {
      conversationId: "conversation-1", photo: new File([png], "photo.png"),
    }), /storage acknowledgement lost/);
    const entries = await client.outbox.entries();
    assert.equal(entries.length, 1);
    const id = (entries[0].args as any).photo.id;
    assert.ok((await client.listUploads()).uploads.some((upload) => upload.id === id));
    runtime.store.commit = commit;
    await client.outbox.drain();
    assert.ok(!(await client.listUploads()).uploads.some((upload) => upload.id === id));
    await assert.rejects(client.discardUpload(id), (error: any) => error.code === "E_ASSET_IN_USE");
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a lost committed media response retains the claimed asset and explicit discard refuses it", async () => {
  const { readFile } = await import("node:fs/promises");
  let photo: any;
  let discards = 0;
  const client = createClient({ url: owner.url, as: "alice", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/uploads/discard") discards++;
    const response = await fetch(input, init);
    if (path === "/api/upload") photo = await response.clone().json();
    if (path === "/api/mutation") {
      assert.equal((await response.json()).state, "committed");
      throw new Error("connection lost after commit");
    }
    return response;
  } });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    await assert.rejects(client.mutation(api.messages.sendPhoto, {
      conversationId: "conversation-1", photo: new File([png], "photo.png"),
    }), (error: any) => error.code === "E_NETWORK");
    assert.equal(discards, 0, "an ambiguous response never triggers cleanup");
    assert.ok(!(await client.listUploads()).uploads.some((upload) => upload.id === photo.id));
    await assert.rejects(client.discardUpload(photo.id), (error: any) => error.code === "E_ASSET_IN_USE");
    const response = await fetch(`${owner.url}/api/asset/${photo.id}`, { headers: { "X-Snapback-As": "alice" } });
    assert.equal(response.status, 200);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  } finally { await client.close(); }
});

test("queued media retains its uploaded bytes until the outbox commits", async () => {
  const { readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const directory = await mkdtemp(join(tmpdir(), "snapback-upload-queued-"));
  let cut = false;
  let photo: any;
  let discards = 0;
  const client = createClient({ url: owner.url, as: "alice", offline: { store: fileRangeStore(directory) },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/uploads/discard") discards++;
      if (path === "/api/mutation" && cut) throw new Error("offline before mutation");
      const response = await fetch(input, init);
      if (path === "/api/upload") { photo = await response.clone().json(); cut = true; }
      return response;
    },
  });
  try {
    const drain = client.subscribe(api.integration.inbox, { c: null }, () => {}, { drain: true });
    await drain.until((event: any) => event.live === true, 3_000);
    drain.close();
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const result = await client.mutation(api.messages.sendPhoto, {
      conversationId: "conversation-1", photo: new File([png], "photo.png"),
    });
    assert.equal(result.state, "queued");
    assert.equal(discards, 0);
    assert.ok((await client.listUploads()).uploads.some((upload) => upload.id === photo.id));
    cut = false;
    await client.outbox.drain();
    assert.equal((await client.outbox.entries()).filter((entry) => entry.state === "queued").length, 0);
    assert.ok(!(await client.listUploads()).uploads.some((upload) => upload.id === photo.id));
    await assert.rejects(client.discardUpload(photo.id), (error: any) => error.code === "E_ASSET_IN_USE");
  } finally { await client.close(); await rm(directory, { recursive: true, force: true }); }
});

test("chat once photo uses one message and upload, each member gets one server delivery, and web stores no bytes", async () => {
  const { readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const directory = await mkdtemp(join(tmpdir(), "snapback-once-owner-"));
  const sender = createClient({ url: owner.url, as: "alice" });
  const alice = createClient({ url: owner.url, as: "alice", offline: { store: fileRangeStore(join(directory, "alice")) } });
  const bob = createClient({ url: owner.url, as: "bob", offline: { store: fileRangeStore(join(directory, "bob")) } });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const photo = await sender.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const posted = await sender.mutation(api.messages.sendOncePhoto, { conversationId: "conversation-1", photo });
    assert.equal(posted.state, "committed");
    const ordinary = await sender.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const normal = await sender.mutation(api.messages.sendPhoto, { conversationId: "conversation-1", photo: ordinary });
    assert.equal(normal.state, "committed");
    assert.equal((await sender.mutation(api.integration.logMessage, { messageId: normal.data.id })).state, "committed");
    const manifest: any = await alice.manifest();
    assert.equal(manifest.tables.messages.columns.oncePhoto.Optional.Image.once, true);
    for (const client of [alice, bob]) {
      const thread: any = await client.query(api.deliveries.thread, { conversationId: "conversation-1", c: null });
      assert.ok(thread.data.some((row: any) => row?.message?.oncePhoto?.id === photo.id));
      const ordinaryUrl = (await client.assetUrl(ordinary))!;
      await client.assetBlob(ordinaryUrl);
      assert.equal(await client.assetCache!.viewOnce(photo.id), true);
      // Even unviewed once media disappears offline, including after a cold store open.
      await client.offline();
      const local: any = await client.query(api.deliveries.thread, { conversationId: "conversation-1", c: null });
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
  const client: any = createClient({ url: owner.url, as: "alice", offline: { store: fileRangeStore(directory) }, fetch: (input, init) => {
    if (new URL(String(input)).pathname.startsWith("/api/asset/")) assetFetches++;
    return fetch(input, init);
  } });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const photo = await client.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const args = { conversationId: "conversation-1", photo };
    await client.query(api.deliveries.thread, { conversationId: "conversation-1", c: null });
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
    const local = await runtime.twin.evaluate("deliveries.thread", { conversationId: "conversation-1", c: null });
    assert.ok(local?.data?.some((row: any) => row?.message?.id === message.id && row.message.oncePhoto === null), JSON.stringify(local));
    const rendered = await client.query(api.deliveries.thread, { conversationId: "conversation-1", c: null });
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


import { assertRefused } from "./live-fixture.ts";
import { subscribe } from "../src/internal.js";
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

test("failed outbox admission or prediction leaves no upload, intent, or mutation request", async () => {
  const { readFile, mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const directory = await mkdtemp(join(tmpdir(), "snapback-upload-admission-"));
  let mutations = 0;
  const client = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(directory) },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/mutation") mutations++;
      return fetch(input, init);
    },
  });
  try {
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const initial = (await client.listUploads()).usage;
    for (let index = 0; index < 24; index++) {
      await assertRefused(client.mutation(api.messages.sendPhoto, {
        conversationId: "conversation-1", photo: new File([png], "photo.png"),
      }), (error: any) => error.code === "E_OFFLINE_ID_BLOCK");
      assert.deepEqual((await client.listUploads()).usage, initial);
      assert.deepEqual(await client.outbox.entries(), []);
    }
    const drain = subscribe(client, api.integration.inbox, { c: null }, () => {}, { drain: true });
    await drain.until((event: any) => event.live === true, 3_000);
    drain.close();
    (client as any).offlineRuntime.predict = async () => { throw new Error("prediction failed before custody"); };
    await assertRefused(client.mutation(api.messages.sendPhoto, {
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
  const client = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(directory) } });
  try {
    const drain = subscribe(client, api.integration.inbox, { c: null }, () => {}, { drain: true });
    await drain.until((event: any) => event.live === true, 3_000);
    drain.close();
    const runtime = (client as any).offlineRuntime;
    const commit = runtime.store.commit.bind(runtime.store);
    runtime.store.commit = async (change: any) => {
      await commit(change);
      if (change.outbox?.put?.length) throw new Error("storage acknowledgement lost after commit");
    };
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    await assertRefused(client.mutation(api.messages.sendPhoto, {
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
  const client = createClient({ url: owner.url, persona: "alice", fetch: async (input, init) => {
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
    await assertRefused(client.mutation(api.messages.sendPhoto, {
      conversationId: "conversation-1", photo: new File([png], "photo.png"),
    }), (error: any) => error.code === "E_TRANSPORT");
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
  const client = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(directory) },
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
    const drain = subscribe(client, api.integration.inbox, { c: null }, () => {}, { drain: true });
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

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

// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a conditional
// refresh advances seq; a nonempty resume log still returns the full envelope.
test("reconnect after a conditional refresh replays a queued send for joined and plain inboxes", async (context) => {
  if (!owner.owned) return context.skip("requires the self-started inbox reduction");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  for (const name of ["inbox", "inboxHeld", "inboxPlain"]) await context.test(name, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "snapback-reconnect-"));
    const op = `integration.${name}`;
    const query = api.integration[name];
    const args = { c: null };
    const reads: any[] = [];
    const resumes: any[] = [];
    const client = createClient({ url: owner.url, as: "alice", offline: { store: fileRangeStore(directory) },
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        const path = new URL(String(input)).pathname;
        if (path === "/api/resume") resumes.push(await response.clone().json());
        if (path === "/api/query" && JSON.parse(String(init?.body)).op === op) reads.push(await response.clone().json());
        return response;
      },
    });
    const other = createClient({ url: owner.url, as: "alice" });
    let drain: any;
    try {
      await client.ready;
      drain = client.subscribe(query, args, () => {}, { drain: true });
      await drain.until((event: any) => event.live === true, 3_000);
      drain.close();
      // The grant is now warm. Remounting a drained, nonempty first page
      // records null as its current tail; the next resume re-delivers it.
      drain = client.subscribe(query, args, () => {}, { drain: true });
      await drain.until((event: any) => event.live === true, 3_000);
      const first = reads.find((read) => read.protocol === 1);
      assert.ok(first?.data.length > 0);
      await other.mutation(api.posts.createPost, { body: `unrelated-${name}` });
      await client.query(query, args);
      const refreshed = reads.at(-1);
      assert.equal(refreshed.state, "unchanged");
      assert.ok(refreshed.seq > first.seq);
      assert.equal(refreshed.validator, first.validator);
      await client.offline();
      const body = `reconnect-${name}-${crypto.randomUUID()}`;
      const queued = await client.mutation(api.messages.send, { conversationId: "conversation-1", recipientId: "profile-bob", body });
      assert.equal(queued.state, "queued");
      let recoveryError: unknown;
      try { await client.online(); } catch (error) { recoveryError = error; }
      const { watermark, ...full } = resumes.at(-1).log;
      assert.equal(typeof watermark, "string");
      assert.equal(full.seq, refreshed.seq, "resume uses the refreshed seq without another data commit");
      const fields = Object.keys(first).filter((field) => JSON.stringify(first[field]) !== JSON.stringify(full[field]));
      assert.deepEqual(fields, ["seq"], "data, pool, receipt, validator and next are byte-identical");
      assert.deepEqual({ ...full, seq: first.seq }, first);
      t.diagnostic(`${op}: full seq ${first.seq} -> unchanged/full seq ${full.seq}; differing fields: ${fields.join(", ")}`);
      assert.equal(recoveryError, undefined, "equivalent re-delivery must release outbox replay");
      assert.equal((await client.outbox.entries()).find((entry: any) => entry.intent === queued.intent)?.state, "committed");
      const thread: any = await other.query(api.messages.thread, { conversationId: "conversation-1", c: null });
      assert.equal(thread.data.filter((row: any) => row.body === body).length, 1);
      const held = await (client as any).offlineRuntime.store.answer(op, args);
      assert.ok(held.data.length >= first.data.length, "the resume tail cannot replace the base page");
    } finally {
      drain?.close(); await client.close(); await other.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("real scalar-projected log pages retire predictions using engine-minted cursor links after cold reopen", async (context) => {
  if (!owner.owned) return context.skip("requires the self-started projected log fixture");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const root = await mkdtemp(join(tmpdir(), "snapback-object-retirement-"));
  const op = "integration.inboxProjected";
  const args = { after: null, label: null };
  const writer = createClient({ url: owner.url, as: "alice" });
  let store = fileRangeStore(root)();
  const query = async (after: string | null) => {
    const response = await fetch(`${owner.url}/api/query`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" },
      body: JSON.stringify({ op, args: { ...args, after }, receipt: true }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.state === "complete" || result.state === "capped", JSON.stringify(result));
    return result;
  };
  try {
    for (let index = 0; index < 3; index++) {
      const result = await writer.mutation(api.deliveries.post, { conversationId: "conversation-1", body: `object-page-${index}` });
      assert.equal(result.state, "committed");
    }
    const first = await query(null);
    assert.equal(typeof first.next, "string", "the owner mints the opaque cursor");
    assert.equal(JSON.stringify(first.data).includes("$row"), false, "projection has scalar fields, not row references");
    assert.ok(first.receipt.ranges.some((range: any) => range.rowIds.length > 0));
    const intent = "projected-retirement:0";
    const id = "predicted-message";
    const committed = { intent, grant: "projected-retirement", offset: 0, count: 1, ids: [id], op: "deliveries.post",
      args: {}, issuedSeq: 0, state: "committed", predicted: true, response: { state: "committed", seq: first.seq }, createdAt: 1, updatedAt: 1 };
    await store.open("dev:alice");
    await store.commit({ watermark: { op, args, cursorArg: "after", watermark: first.next, updatedAt: 1 },
      outbox: { put: [committed] }, overlay: { put: { [intent]: [{ table: "messages", id, row: { id, body: "predicted" } }] } } });
    const second = await query(first.next);
    assert.equal(typeof second.next, "string");
    await store.commit({ deliveries: [{ ...second, op, args: { ...args, after: first.next }, cursorArg: "after" }] });
    assert.ok((await store.outbox.overlay())[intent], "the commit position's page alone is not beyond its snapshot");
    await store.close(); store = fileRangeStore(root)(); await store.open("dev:alice");
    const third = await query(second.next);
    await store.commit({ deliveries: [{ ...third, op, args: { ...args, after: second.next }, cursorArg: "after" }] });
    assert.equal((await store.outbox.overlay())[intent], undefined, "fresh projected tail beyond the proven link retires prediction");
    assert.equal((await store.outbox.get(intent))?.predicted, undefined);
    assert.equal((await store.outbox.get(intent))?.state, "committed");
    assert.ok((await store.coverage()).rows.some((row: any) => row.table === "deliveries"));
  } finally { await store.close(); await writer.close(); await rm(root, { recursive: true, force: true }); }
});

test("settlement uses the persisted cursor name when live metadata disagrees, with real owner argument validation", async (context) => {
  if (!owner.owned) return context.skip("requires the self-started projected log fixture");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const root = await mkdtemp(join(tmpdir(), "snapback-recorded-cursor-"));
  const op = "integration.inboxProjected";
  const args = { after: null, label: null };
  const first = createClient({ url: owner.url, as: "alice", offline: { store: fileRangeStore(root) } });
  let cold: any;
  let drain: any;
  try {
    await first.ready;
    drain = first.subscribe(api.integration.inboxProjected, args, () => {}, { drain: true });
    await drain.until((event: any) => event.live === true, 3_000);
    drain.close(); await first.close();
    let restore: (() => void) | undefined;
    const tails: any[] = [];
    cold = createClient({ url: owner.url, as: "alice", offline: { store: fileRangeStore(root) }, fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/query" && restore) {
        tails.push(JSON.parse(String(init?.body)).args);
        restore(); restore = undefined;
      }
      const response = await fetch(input, init);
      if (path === "/api/mutation" && (await response.clone().json()).state === "committed") {
        // Perturb only the metadata fallback during settlement. The real
        // program still accepts after and refuses c; no fake owner blesses
        // arguments from another generation.
        const runtime = cold.offlineRuntime;
        const original = runtime.cursorArg.bind(runtime);
        runtime.cursorArg = (name: string) => name === op ? "c" : original(name);
        restore = () => { runtime.cursorArg = original; };
      }
      return response;
    } });
    await cold.ready;
    const held = (await cold.offlineRuntime.store.coverage()).watermarks.find((mark: any) => mark.op === op);
    assert.equal(held.cursorArg, "after");
    assert.equal(typeof held.watermark, "string");
    const invalid = await fetch(`${owner.url}/api/query`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" },
      body: JSON.stringify({ op, args: { ...args, c: held.watermark }, receipt: true }) });
    assert.equal(invalid.status, 400, "the owner refuses an extra argument instead of accepting both spellings");
    const committed = await cold.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "recorded cursor proof" });
    assert.equal(committed.state, "committed");
    assert.deepEqual(tails, [{ ...args, after: held.watermark }]);
    assert.equal((await cold.outbox.entries()).length, 0);
    restore?.();
  } finally { drain?.close(); await first.close(); await cold?.close(); await rm(root, { recursive: true, force: true }); }
});

test("the real owner refuses an object wrapper as a resume log instead of promising a tail", async (context) => {
  if (!owner.owned) return context.skip("requires the self-started projected log fixture");
  const op = "integration.inboxObject";
  const args = { after: null, label: null };
  const request = async (path: string, body: unknown) => {
    const response = await fetch(`${owner.url}${path}`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const page = await request("/api/query", { op, args, receipt: true });
  assert.equal(page.status, 200);
  assert.ok(page.body.data.entries.length > 0);
  assert.equal(page.body.next, null);
  const programResponse = await fetch(`${owner.url}/api/program?generation=${page.body.generation}`,
    { headers: { "X-Snapback-As": "alice" } });
  assert.equal(programResponse.status, 200);
  const program = await programResponse.json();
  assert.equal(program.programs[op].certificate.result_pages, undefined, "outer wrapper has no certified result page");
  const resume = await request("/api/resume", { protocol: 1, generation: page.body.generation,
    schemaHash: page.body.schemaHash, authEpoch: page.body.authority.authEpoch,
    log: { op, args, watermark: null }, mounted: [] });
  assert.equal(resume.status, 413);
  assert.equal(resume.body.code, "E_OFFLINE_RESUME");
  assert.match(resume.body.message, /returns no page/);
});

test("sixty live queries and a channel share one connection through add, remove and reconnect", async (context) => {
  if (!owner.owned) return context.skip("the multi-query probe uses the self-started chat fixture");
  let streams = 0;
  let controls = 0;
  let session: string | undefined;
  const client = createClient({ url: owner.url, as: "alice", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/live") { assert.equal(init?.body, "{}"); streams++; }
    if (path === "/api/live/control") { controls++; session = JSON.parse(String(init?.body)).session; }
    return fetch(input, init);
  } });
  const subscriptions: any[] = [];
  try {
    for (let i = 0; i < 60; i++) subscriptions.push(client.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, () => {}));
    await Promise.all(subscriptions.map(sub => sub.until((event: any) => event.live === true, 5_000)));
    assert.equal(streams, 1);
    const channel = client.channel(api.typing, { conversationId: "conversation-1" }).subscribe(() => {});
    subscriptions.push(channel);
    // A query registered in the same control batch witnesses channel admission.
    const witness = client.subscribe(api.messages.summary, { conversationId: "conversation-1" }, () => {});
    subscriptions.push(witness);
    await witness.until((event: any) => event.live === true, 2_000);
    await client.channel(api.typing, { conversationId: "conversation-1" }).publish({ typing: true });
    await channel.until((event: any) => event.payload?.typing === true, 2_000);
    const refused = client.subscribe(api.missing.operation, {}, () => {});
    subscriptions.push(refused);
    await assert.rejects(refused.until(() => false, 2_000), (error: any) => error.code === "E_OP_UNKNOWN");
    const removed = subscriptions.splice(0, 30);
    for (const sub of removed) sub.close();
    const message = `multiplex-${Date.now()}`;
    await client.mutation(api.messages.send, { conversationId: "conversation-1", recipientId: "profile-bob", body: message });
    await Promise.all(subscriptions.slice(0, 30).map(sub => sub.until((event: any) => event.data?.some((row: any) => row.body === message), 3_000)));
    assert.equal(streams, 1, "changing the subscription set does not restart the connection");
    const denied = await fetch(`${owner.url}/api/live/control`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snapback-As": "bob" }, body: JSON.stringify({ session, close: true }) });
    assert.equal(denied.status, 400, "another principal cannot control this stream");
    await fetch(`${owner.url}/api/live/control`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" }, body: JSON.stringify({ session, close: true }) });
    await subscriptions[0].until((event: any) => event.state === "stale", 2_000);
    await subscriptions[0].until((event: any) => event.live === true, 3_000);
    assert.equal(streams, 2);
    assert.ok(controls < 15, "subscriptions are batched, not one control connection per query");
  } finally { for (const sub of subscriptions) sub.close(); await client.close(); }
});

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
    const drain = client.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, () => {}, { drain: true });
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
    const drain = client.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, () => {}, { drain: true });
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
    const drain = client.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, () => {}, { drain: true });
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

test("the package suite is pointed at a checked real owner", async (context) => {
  assert.equal(process.env.SNAPBACK_URL, owner.url);
  assert.equal(process.env.SNAPBACK2_REAL_OWNER_MODE, owner.owned ? "self-started" : "external");
  const response = await fetch(owner.url);
  assert.equal(response.ok, true);
  const status = await response.json();
  assert.equal(status.ok, true);
  assert.equal(status.mode, "dev");
  const manifestResponse = await fetch(`${owner.url}/api/manifest`);
  assert.equal(manifestResponse.ok, true);
  const manifest = await manifestResponse.json();
  // `tables` carries each table's retain word per generation (LLP 1012 §5, lane O1b).
  assert.deepEqual(Object.keys(manifest).sort(), ["auth", "channels", "generation", "ops", "programGeneration", "tables"]);
  const preflight = await fetch(`${owner.url}/api/query`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://client.example",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
  const allowedMethods = new Set(
    (preflight.headers.get("Access-Control-Allow-Methods") ?? "")
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean),
  );
  assert.deepEqual(allowedMethods, new Set(["GET", "POST", "OPTIONS"]));
  context.diagnostic(`real-owner mode=${process.env.SNAPBACK2_REAL_OWNER_MODE} url=${owner.url}`);
});

test("a real rejected mutation carries the complete refusal envelope", async (context) => {
  if (!owner.owned) return context.skip("the chat fixture and non-member persona belong to the self-started harness");
  const response = await fetch(`${owner.url}/api/mutation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Snapback-As": "charlie",
    },
    body: JSON.stringify({
      op: "messages.send",
      args: {
        conversationId: "conversation-1",
        recipientId: "profile-alice",
        body: "not a member",
      },
    }),
  });
  assert.equal(response.status, 200);
  const rejected = await response.json();
  assert.deepEqual(
    {
      state: rejected.state,
      code: rejected.code,
      family: rejected.family,
      message: rejected.message,
      guide: rejected.guide,
    },
    {
      state: "rejected",
      code: "NOT_MEMBER",
      family: "input",
      message: "E_REQUIRE:NOT_MEMBER: program requirement failed",
      guide: "input/runtime",
    },
  );
});

test("real owner stop and restart yields stale then a full first re-delivery", async (context) => {
  if (!owner.owned) return context.skip("external SNAPBACK_URL does not grant process control");
  const value = createClient({ url: owner.url, as: "alice" });
  const deliveries: any[] = [];
  const sub = value.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, (delivery) => deliveries.push(delivery));
  const initial = await sub.until((delivery) => delivery.state === "complete", 2_000);
  assert.equal(initial.live, true);
  const stalePromise = sub.until((delivery) => delivery.state === "stale", 3_000);
  await owner.stop();
  const stale = await stalePromise;
  assert.equal(stale.live, false);
  assert.equal(stale.seq, initial.seq);
  assert.strictEqual(stale.data, initial.data);
  assert.equal(value.snapshot.connection, "reconnecting");
  await owner.start(false);
  const resumed = await sub.until((delivery) => delivery.state === "complete" && delivery.live, 4_000);
  assert.equal(resumed.seq, initial.seq);
  assert.deepEqual(resumed.data, initial.data);
  assert.equal(value.snapshot.connection, "connected");
  assert.deepEqual(deliveries.slice(0, 3).map((delivery) => delivery.state), ["complete", "stale", "complete"]);
  context.diagnostic("owner performs a full query re-delivery after reconnect; Last-Event-ID is not a delta-resume contract");
  sub.close();
  value.close();
});

test("React-free hook driver reduces eight real-owner transitions including live capped and denied", async (context) => {
  if (!owner.owned) return context.skip("the enhanced temporary chat fixture belongs to the self-started harness");
  let view: any = initialQueryState<any[]>();
  const transitions = [view.state];
  const drive = (delivery: any) => {
    view = reduceQueryState(view, delivery);
    transitions.push(view.state);
  };
  const reader = createClient({ url: owner.url, as: "alice" });
  const writer = createClient({ url: owner.url, as: "bob" });
  const live = reader.subscribe(api.messages.thread, { conversationId: "conversation-1", c: null }, drive);
  const first = await live.until((delivery) => delivery.state === "complete", 2_000);
  const committed = await writer.mutation(api.messages.send, {
    conversationId: "conversation-1",
    recipientId: "profile-alice",
    body: `hook-driver-${Date.now()}`,
  });
  assert.equal(committed.state, "committed");
  const updated = await live.until((delivery) => delivery.state === "complete" && delivery.seq > first.seq, 2_000);
  const stalePromise = live.until((delivery) => delivery.state === "stale", 3_000);
  await owner.stop();
  await stalePromise;
  await owner.start(false);
  await live.until((delivery) => delivery.state === "complete" && delivery.live && delivery.seq === updated.seq, 4_000);
  live.close();

  const capped = reader.subscribe(api.integration.capped, {}, drive);
  const cappedDelivery = await capped.until((delivery) => delivery.state === "capped", 2_000);
  assert.equal(cappedDelivery.live, true);
  // LLP 1011: capped deliveries carry the forward cursor like complete ones.
  assert.deepEqual(Object.keys(cappedDelivery).sort(), ["data", "live", "next", "seq", "state"]);
  capped.close();

  const outsider = createClient({ url: owner.url, as: "charlie" });
  const denied = outsider.subscribe(api.integration.denied, { conversationId: "conversation-1" }, drive);
  const deniedDelivery = await denied.until((delivery) => delivery.state === "denied", 2_000);
  assert.equal(deniedDelivery.live, true);
  assert.equal(deniedDelivery.rule, "MEMBERSHIP_REQUIRED");
  denied.close();

  let refusal: any;
  const refused = reader.subscribe(api.integration.missing, {}, (delivery) => {
    refusal = delivery;
    drive(delivery);
  });
  await assert.rejects(
    () => refused.until(() => false, 2_000),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_OP_UNKNOWN",
  );
  assert.equal(refusal.state, "refused");
  assert.deepEqual(transitions, ["hydrating", "complete", "complete", "stale", "complete", "capped", "denied", "refused"]);
  context.diagnostic(`hook-driver transitions=${transitions.join(" -> ")}`);
  refused.close();
  reader.close();
  writer.close();
  outsider.close();
});

test("real channel membership revocation ends the subscriber with a refusal", async (context) => {
  if (!owner.owned) return context.skip("the enhanced temporary chat fixture belongs to the self-started harness");
  const alice = createClient({ url: owner.url, as: "alice" });
  const bob = createClient({ url: owner.url, as: "bob" });
  const channel = bob.channel(api.typing, { conversationId: "conversation-1" });
  const events: any[] = [];
  const sub = channel.subscribe((event) => events.push(event));
  // A delivery on the same live connection witnesses channel registration;
  // a fixed sleep can publish before the control batch reaches a busy owner.
  const witness = bob.subscribe(api.messages.summary, { conversationId: "conversation-1" }, () => {});
  await witness.until((event: any) => event.live === true, 2_000);
  witness.close();
  const typing = sub.until((event: any) => event.payload?.typing === true, 2_000);
  assert.deepEqual(
    await alice.channel(api.typing, { conversationId: "conversation-1" }).publish({ typing: true }),
    { ok: true },
  );
  assert.deepEqual((await typing as any).payload, { typing: true });
  const terminal = sub.until(() => false, 2_000).then(
    () => undefined,
    (error: unknown) => error,
  );
  const removed = await bob.mutation(api.groups.memberLeave, {
    conversationId: "conversation-1",
    membershipId: "membership-2",
  });
  assert.equal(removed.state, "committed");
  const terminalError = await terminal;
  assert.ok(terminalError instanceof SnapbackRefusal);
  assert.equal(terminalError.code, "E_RULE_CHANNEL_SUBSCRIBE");
  assert.equal(events.at(-1)?.state, "refused");
  assert.equal(events.at(-1)?.family, "rule");
  assert.equal(events.at(-1)?.guide, "rule/channels");
  sub.close();
  alice.close();
  bob.close();
});

test("a real stored session restores after a cut with identical snapshot views and no mounted query", async () => {
  let token: string | null = null;
  let binding: { token: string; principal: string } | null = null;
  const tokenStore = { load: () => token, save: (value: string | null) => { token = value; },
    loadPrincipalBinding: () => binding,
    savePrincipal: (principal: string | null, bearer?: string) => { binding = principal && bearer ? { token: bearer, principal } : null; } };
  const first = createClient({ url: owner.url, tokenStore });
  const session = await first.auth.guest();
  assert.equal(session.kind, "guest");
  assert.equal(first.snapshot.auth.kind, "guest");
  await first.close();
  let cut = true;
  const cold = createClient({ url: owner.url, tokenStore, fetch: async (input, init) => {
    if (cut && String(input).endsWith("/api/auth/me")) throw new TypeError("restoration transport cut");
    return fetch(input, init);
  } });
  const left: any[] = [], right: any[] = [];
  const stopLeft = cold.subscribeStatus(snapshot => left.push(snapshot.auth));
  const stopRight = cold.subscribeStatus(snapshot => right.push(snapshot.auth));
  const waitForAuth = (predicate: (auth: typeof cold.snapshot.auth) => boolean) => new Promise<void>(resolve => {
    const stop = cold.subscribeStatus(snapshot => { if (predicate(snapshot.auth)) { queueMicrotask(() => stop()); resolve(); } });
  });
  try {
    await waitForAuth(auth => auth.retryAt !== undefined);
    assert.equal(cold.snapshot.auth.state, "hydrating");
    assert.equal(cold.snapshot.auth.restoringViewer, session.viewer);
    assert.equal(cold.snapshot.auth.viewer, undefined);
    assert.equal(token, session.token);
    const recovered = waitForAuth(auth => auth.state === "authenticated");
    cut = false;
    await cold.offline(); await cold.online(); await recovered;
    assert.equal(cold.snapshot.auth.viewer, session.viewer);
    assert.equal(cold.snapshot.auth.restoringViewer, undefined);
    assert.deepEqual(left, right);
    const revoker = createClient({ url: owner.url, token: session.token });
    try { await revoker.auth.logout(); } finally { await revoker.close(); }
    await assert.rejects(cold.auth.me(), (error: any) => error.code === "E_AUTH_SESSION");
    assert.equal(cold.snapshot.auth.state, "anonymous");
    assert.equal(token, null);
  } finally { stopLeft(); stopRight(); await cold.close(); }
});

test("serve mode refuses a persona-bound real client", async (context) => {
  if (!owner.owned) return context.skip("external SNAPBACK_URL does not grant mode control");
  await owner.stop();
  await owner.start(true);
  const value = createClient({ url: owner.url, as: "alice" });
  await assert.rejects(
    () => value.query(api.integration.capped, {}),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_AUTH_PERSONA_NOT_DEV",
  );
  let delivered: any;
  const sub = value.subscribe(api.integration.capped, {}, (event) => { delivered = event; });
  await assert.rejects(
    () => sub.until(() => false, 2_000),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_AUTH_PERSONA_NOT_DEV",
  );
  assert.equal(delivered.state, "refused");
  sub.close();
  value.close();
});


// @ref LLP 1018#6-move-four-evolution-of-the-whole-application —
// evolve populated data while real client intents remain in durable custody.
test("durable client intents survive a schema successor and a lost acknowledgement survives operation removal", async (t) => {
  if (!owner.owned) return t.skip("requires an isolated self-started successor owner");
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const previousUrl = process.env.SNAPBACK_URL;
  delete process.env.SNAPBACK_URL;
  let local: RealOwnerHarness | undefined;
  const directory = await mkdtemp(join(tmpdir(), "snapback-successor-client-"));
  const clients: ReturnType<typeof createClient>[] = [];
  const subscriptions: { close(): void }[] = [];
  const requests: { body: string; response: any }[] = [];
  const resets: any[] = [];
  let loseAcknowledgement = false;
  const observe: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const path = new URL(String(input)).pathname;
    if (path === "/api/resume") resets.push(await response.clone().json());
    if (path === "/api/mutation") {
      const body = await response.clone().json();
      requests.push({ body: String(init?.body), response: body });
      if (loseAcknowledgement && body.state === "committed") {
        loseAcknowledgement = false;
        // The real owner committed. Only its delivery to this client is lost.
        throw new TypeError("simulated connection loss after durable commit");
      }
    }
    return response;
  };
  try {
    local = await RealOwnerHarness.create({ withDeliveries: true });
    const makeClient = () => {
      const client = createClient({ url: local!.url, as: "alice", fetch: observe,
        offline: { store: fileRangeStore(directory) } });
      clients.push(client);
      return client;
    };
    const warm = async (client: ReturnType<typeof createClient>) => {
      await client.ready;
      const sub = client.subscribe(api.deliveries.inbox, { c: null }, () => {}, { drain: true });
      subscriptions.push(sub);
      await sub.until(event => event.live === true, 5_000);
      assert.equal((await client.outbox.status(api.deliveries.post)).ready, true);
      return sub;
    };
    const first = makeClient();
    const drain = await warm(first);
    const before: any = await first.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(before.state, "complete");
    assert.equal(before.next, null);
    const baselineCount: any = await first.query(api.messages.summary, { conversationId: "conversation-1" });
    await first.offline();
    const queued = [];
    for (const body of ["successor first", "successor second"]) {
      const result = await first.mutation(api.deliveries.post, { conversationId: "conversation-1", body });
      assert.equal(result.state, "queued");
      queued.push(result);
    }
    const admitted = await first.outbox.entries();
    assert.equal(admitted.length, 2);
    assert.equal(admitted[0].predicted, true);
    assert.equal(admitted[1].predicted, true);
    assert.equal(requests.length, 0, "offline admission sends nothing");
    drain.close();
    await first.close();
    await local.stop();
    const schemaPath = join(local.root!, "snapback/schema.q");
    const schema = await readFile(schemaPath, "utf8");
    assert.ok(schema.includes("table messages:\n"));
    await writeFile(schemaPath, schema.replace("table messages:\n", "table messages:\n  category: text <=40 ?\n"));
    await local.start(false);

    const reopened = makeClient();
    await reopened.ready;
    await reopened.online();
    assert.deepEqual(await reopened.outbox.drain(), { stopped: false, remaining: 0 });
    assert.ok(resets.some(result => result.code === "E_OFFLINE_RESET"), "the real owner requires successor recovery");
    assert.deepEqual(requests.map(request => JSON.parse(request.body)), admitted.map(entry => ({
      op: entry.op, args: entry.args, replay: { grant: entry.grant, offset: entry.offset,
        count: entry.count, intent: entry.intent, trace: entry.trace ?? { points: [], verdicts: [] } },
    })), "FIFO replay preserves every admitted envelope field after close, schema reset, and reopen");
    const terminals = await reopened.outbox.entries();
    for (const entry of admitted) {
      const terminal = terminals.find(result => result.intent === entry.intent)!;
      assert.equal(terminal.state, "rejected");
      assert.equal((terminal.response as any).code, "E_OFFLINE_CONFLICT");
      assert.match((terminal.response as any).site, /^rule:/);
    }
    // Rule verdicts bind the complete schema. Even this optional addition
    // invalidates predecessor verdicts; new-generation intent admission is
    // an explicit user retry, never a rewrite of an existing envelope.
    const conflicted: any = await reopened.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(conflicted.data.length, before.data.length, "the conflicted sends wrote no messages");
    for (const body of ["successor first", "successor second"]) {
      const result = await reopened.mutation(api.deliveries.post, { conversationId: "conversation-1", body });
      assert.equal(result.state, "committed");
      assert.ok(!admitted.some(entry => entry.intent === JSON.parse(requests.at(-1)!.body).replay.intent));
    }
    const after: any = await reopened.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(after.state, "complete");
    assert.equal(after.next, null);
    for (const row of before.data) {
      const actual = after.data.find((value: any) => value.id === row.id);
      assert.ok(actual, `preserved message ${row.id}`);
      assert.equal(actual.category, null);
      const { category, ...originalFields } = actual;
      assert.deepEqual(originalFields, row);
    }
    for (const body of ["successor first", "successor second"]) assert.equal(after.data.filter((row: any) => row.body === body).length, 1);
    const afterCount: any = await reopened.query(api.messages.summary, { conversationId: "conversation-1" });
    assert.equal(afterCount.data.messageCount.value, baselineCount.data.messageCount.value + 2);
    t.diagnostic(`schema reset preserved ${before.data.length} original messages; two predicted intents settled E_OFFLINE_CONFLICT, and two explicit new intents advanced the first room count by two`);

    // A committed-but-unacknowledged intent must still settle if its operation
    // disappears before a cold client retries. New calls cannot use that op.
    const reopenedDrain = await warm(reopened);
    loseAcknowledgement = true;
    const uncertain = await reopened.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "ack lost before removal" });
    assert.equal(uncertain.state, "queued");
    const originalRequest = requests.at(-1)!;
    assert.equal(originalRequest.response.state, "committed");
    reopenedDrain.close();
    await reopened.close();
    await local.stop();
    const operationPath = join(local.root!, "snapback/deliveries.q");
    const operations = await readFile(operationPath, "utf8");
    assert.ok(operations.includes("mutation post("));
    await writeFile(operationPath, operations.replace("mutation post(", "mutation postAfterEvolution("));
    await local.start(false);
    const retry = makeClient();
    await retry.ready;
    await retry.online();
    assert.deepEqual(await retry.outbox.drain(), { stopped: false, remaining: 0 });
    const retried = requests.filter(request => JSON.parse(request.body).replay.intent === uncertain.intent);
    assert.equal(retried.length, 2, "one original attempt and one cold retry");
    assert.equal(retried[1].body, originalRequest.body, "exact request bytes survive operation removal");
    assert.deepEqual(retried[1].response, originalRequest.response, "the owner returns its stored terminal");
    assert.equal((await retry.outbox.entries()).find(entry => entry.intent === uncertain.intent)?.state, "committed");
    const final: any = await retry.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(final.state, "complete");
    assert.equal(final.data.filter((row: any) => row.body === "ack lost before removal").length, 1);
    const rejected = await fetch(`${local.url}/api/mutation`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" },
      body: JSON.stringify({ op: "deliveries.post", args: { conversationId: "conversation-1", body: "new forbidden call" } }) });
    assert.equal((await rejected.json()).code, "E_OP_UNKNOWN");
    t.diagnostic("lost acknowledgement retried byte-identically after operation removal; stored terminal settled with one message; new call refused E_OP_UNKNOWN");
  } finally {
    for (const sub of subscriptions) sub.close();
    for (const client of clients) await client.close();
    await local?.close();
    await rm(directory, { recursive: true, force: true });
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL;
    else process.env.SNAPBACK_URL = previousUrl;
  }
});
// @ref LLP 1018#4-move-two-efficient-execution-and-certification-that-agree — maintained cap
// rows must be acquired through ordinary reads; unheld counts are not zero.
test("public count reads enable multi-principal offline cap prediction without inventing missing counts", async (t) => {
  if (!owner.owned) return t.skip("requires an isolated self-started count owner");
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const previousUrl = process.env.SNAPBACK_URL;
  delete process.env.SNAPBACK_URL;
  const directory = await mkdtemp(join(tmpdir(), "snapback-public-counts-"));
  const fixture = join(directory, "source");
  let local: RealOwnerHarness | undefined;
  const clients: ReturnType<typeof createClient>[] = [];
  try {
    await mkdir(fixture);
    await writeFile(join(fixture, "schema.q"), `use identity

table capEntries:
  principal: principal
  author: principal
  by byPrincipal: principal, id
  cap 3 by principal
  read <- allow
  insert <- .author = viewer
  update <- deny
  delete <- deny

maintain principalCounts = count capEntries by principal:
  read <- allow
`);
    await writeFile(join(fixture, "caps.q"), `query countFor(principal: principal):
  return #principalCounts[principal]

query entriesFor(principal: principal):
  return capEntries[principal] first 50 by byPrincipal

mutation allocate(principals: [principal] <=49):
  for principal in principals:
    insert capEntries { principal, author: viewer }
  return null
`);
    const sizes = { heldA: 1, heldB: 1, unheldA: 1, unheldB: 1, rollbackA: 1, full: 3 };
    const rows = Object.entries(sizes).flatMap(([principal, size]) => Array.from({ length: size }, (_, index) => ({
      id: `${principal}-${index}`, principal: `dev:${principal}`, author: "dev:alice",
    })));
    await writeFile(join(fixture, "seed.ts"), `import { seed } from 'snapback2';\nexport default seed(${JSON.stringify({ personas: ["alice"], rows: { capEntries: rows } })});\n`);
    local = await RealOwnerHarness.create({ fixture });
    const observer = createClient({ url: local.url, as: "alice" });
    clients.push(observer);
    const count = async (client: ReturnType<typeof createClient>, principal: string) => {
      const result: any = await client.query(api.caps.countFor, { principal: `dev:${principal}` });
      assert.equal(result.state, "complete", JSON.stringify(result));
      return result.data;
    };
    const scenarios = [
      { name: "held", principals: ["heldA", "heldB"], hold: ["heldA", "heldB"], predicted: true, final: [2, 2] },
      { name: "unheld", principals: ["unheldA", "unheldB"], hold: ["unheldA"], predicted: false, final: [2, 2] },
      // The public zero query currently leaves this conservative: its receipt
      // carries no count row or absence for the cap fast path to trust.
      { name: "zero", principals: ["zero"], hold: ["zero"], predicted: false, final: [1] },
      { name: "overflow", principals: ["rollbackA", "full"], hold: ["rollbackA", "full"], predicted: false, final: [1, 3] },
    ];
    for (const scenario of scenarios) {
      const reads: any[] = [];
      let mutations = 0;
      const client = createClient({ url: local.url, offline: { store: fileRangeStore(join(directory, scenario.name)) },
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const path = new URL(String(input)).pathname;
          if (path === "/api/query") reads.push(await response.clone().json());
          if (path === "/api/mutation") mutations++;
          return response;
        } });
      clients.push(client);
      await client.ready;
      await client.auth.guest();
      const before = await Promise.all(scenario.hold.map(principal => count(client, principal)));
      await client.online();
      const readiness = await client.outbox.status(api.caps.allocate);
      assert.equal(readiness.ready, true, JSON.stringify(readiness));
      assert.ok(reads.every(read => (read.rows ?? []).every((row: any) => row.table !== "capEntries")), "count queries did not preload source rows");
      if (scenario.name === "zero") {
        assert.deepEqual(before, [0], "the owner proved zero through the public count query");
        t.diagnostic(`zero public query receipt: ${JSON.stringify(reads)}`);
      }
      await client.offline();
      const queued = await client.mutation(api.caps.allocate, { principals: scenario.principals.map(principal => `dev:${principal}`) });
      assert.equal(queued.state, "queued");
      assert.equal(mutations, 0, "offline allocation sends no mutation bytes");
      const [entry] = await client.outbox.entries();
      assert.equal(entry.predicted === true, scenario.predicted, `${scenario.name}: ${JSON.stringify(entry)}`);
      if (!scenario.predicted) assert.deepEqual(entry.trace, { points: [], verdicts: [] });
      if (scenario.predicted) {
        for (let index = 0; index < scenario.principals.length; index++) {
          assert.equal(await count(client, scenario.principals[index]), scenario.final[index], "held count advances in the offline overlay");
        }
      }
      await client.online();
      assert.deepEqual(await client.outbox.drain(), { stopped: false, remaining: 0 });
      const [settled] = await client.outbox.entries();
      assert.equal(settled.state, scenario.name === "overflow" ? "rejected" : "committed");
      if (scenario.name === "overflow") assert.equal((settled.response as any).code, "E_CONSTRAINT");
      const actual = await Promise.all(scenario.principals.map(principal => count(observer, principal)));
      assert.deepEqual(actual, scenario.final, "owner counts prove complete commit or atomic rollback");
      t.diagnostic(`${scenario.name}: ${JSON.stringify({ before, predicted: entry.predicted === true, trace: entry.trace, state: settled.state, final: actual })}`);
      await client.close();
    }
  } finally {
    for (const client of clients) await client.close();
    await local?.close();
    await rm(directory, { recursive: true, force: true });
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL;
    else process.env.SNAPBACK_URL = previousUrl;
  }
});

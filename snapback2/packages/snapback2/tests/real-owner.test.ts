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

test("a real indexed observation stays authoritative across persistent local refreshes", async (context) => {
  if (!owner.owned) return context.skip("requires the self-started indexed chat fixture");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const directory = await mkdtemp(join(tmpdir(), "snapback-indexed-observation-"));
  const client = createClient({ url: owner.url, as: "alice", offline: { store: fileRangeStore(directory) } });
  const rawEvents: Array<Record<string, unknown>> = [];
  const snapshots: Array<Record<string, unknown>> = [];
  const args = { term: "WEL", c: null };
  let raw: any;
  let stop: (() => void) | undefined;
  try {
    await client.ready;
    const observed = client.observe(api.messages.search, args);
    stop = observed.subscribe(() => {
      const value: any = observed.getSnapshot();
      snapshots.push({ state: value.receipt?.outcome ?? value.status, live: value.freshness.live, seq: value.receipt?.seq,
        rows: Array.isArray(value.data) ? value.data.map((row: any) => row.body) : undefined });
    });
    raw = client.subscribe(api.messages.search, args, (value: any) => {
      rawEvents.push({ state: value.state, live: value.live, seq: value.seq,
        rows: Array.isArray(value.data) ? value.data.map((row: any) => row.body) : undefined });
    });
    await raw.until((value: any) => value.live === true
      && (value.state === "complete" || value.state === "capped")
      && value.data?.some((row: any) => row.body === "Welcome"), 3_000);

    // A second committed answer advances the persistent input revision. Its
    // reevaluation must not downgrade an unchanged search value to held.
    await client.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const current: any = observed.getSnapshot();
    assert.ok(current.receipt?.outcome === "complete" || current.receipt?.outcome === "capped", JSON.stringify(current));
    assert.equal(current.freshness.live, true);
    assert.ok(current.data.some((row: any) => row.body === "Welcome"));
    const authoritative = rawEvents.findIndex((value) => value.live === true
      && (value.state === "complete" || value.state === "capped"));
    assert.ok(authoritative >= 0, `missing authoritative delivery: ${JSON.stringify(rawEvents)}`);
    assert.equal(rawEvents.slice(authoritative + 1).some((value) => value.state === "held"), false,
      `an unchanged local refresh followed the authoritative delivery: ${JSON.stringify(rawEvents)}`);
  } catch (error) {
    context.diagnostic(`indexed observation connection=${client.snapshot.connection}; raw=${JSON.stringify(rawEvents)}; snapshots=${JSON.stringify(snapshots)}`);
    throw error;
  } finally {
    raw?.close(); stop?.(); await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("cold global search includes a queued Unicode row after an unrelated persisted marker", async (context) => {
  if (!owner.owned) return context.skip("requires the self-started indexed chat fixture");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { sqliteFactory } = await import("./sqlite-fixture.ts");
  const directory = await mkdtemp(join(tmpdir(), "snapback-indexed-prediction-"));
  const factory = sqliteFactory(join(directory, "state.db"));
  let warm: any, cold: any, drain: any;
  try {
    warm = createClient({ url: owner.url, as: "alice", offline: { store: factory } });
    await warm.ready;
    drain = warm.subscribe(api.deliveries.inbox, { c: null }, () => {}, { drain: true });
    await drain.until((event: any) => event.live === true && event.caughtUp === true, 5_000);
    await warm.offline();
    const queued = await warm.mutation(api.deliveries.post, {
      conversationId: "conversation-2", body: "Café offline predicted",
    });
    assert.equal(queued.state, "queued");
    assert.equal((await warm.mutation(api.deliveries.post, {
      conversationId: "conversation-2", body: "offline second",
    })).state, "queued");
    const before: any = await warm.query(api.messages.search, { term: "CAFE\u0301", c: null });
    assert.ok(before.data.some((row: any) => row.id === queued.ids[0]), JSON.stringify(before));
    const entries = await warm.outbox.entries();
    await warm.offlineRuntime.store.commit({
      deliveries: [{ op: "deliveries.thread", args: { conversationId: "witness-marker", c: null }, seq: 1,
        state: "complete", next: null, data: { $row: { table: "messages", id: "witness-marker" } },
        rows: [{ table: "messages", id: "witness-marker", row: { id: "witness-marker", conversationId: "witness-marker",
          authorId: "witness", body: "pre", photo: { id: "s2id-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee-0000000000000001", width: 1, height: 1 }, at: 1 } }],
        receipt: { ranges: [], absences: [], verdicts: [] } }],
      outbox: { put: [{ ...entries[0], intent: "__witness", state: "committed", predicted: false }] },
    });
    const after: any = await warm.query(api.messages.search, { term: "CAFE\u0301", c: null });
    assert.ok(after.data.some((row: any) => row.id === queued.ids[0]), JSON.stringify(after));
    drain.close(); await warm.close(); warm = undefined;
    cold = createClient({ url: owner.url, as: "alice", startOffline: true, offline: { store: factory } });
    await cold.ready;
    const reopened: any = await cold.query(api.messages.search, { term: "CAFE\u0301", c: null });
    assert.equal(reopened.state, "held");
    assert.ok(reopened.data.some((row: any) => row.id === queued.ids[0]), JSON.stringify(reopened));
  } finally {
    drain?.close(); await warm?.close(); await cold?.close();
    await rm(directory, { recursive: true, force: true });
  }
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
  assert.match(resume.body.message, /integration\.inboxObject.*cursor-binding/);
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
  const deliveries = new Map<string, unknown>();
  const remember = (name: string) => (event: any) => deliveries.set(name, {
    state: event?.state, live: event?.live, seq: event?.seq,
    rows: Array.isArray(event?.data) ? event.data.length : undefined,
    typing: event?.payload?.typing,
  });
  let phase = "opening sixty queries";
  try {
    for (let i = 0; i < 60; i++) subscriptions.push(client.subscribe(
      api.messages.thread, { conversationId: "conversation-1", c: null }, remember(`thread-${i}`),
    ));
    await Promise.all(subscriptions.map(sub => sub.until((event: any) => event.live === true, 5_000)));
    assert.equal(streams, 1);
    phase = "admitting channel with summary query";
    const channel = client.channel(api.typing, { conversationId: "conversation-1" }).subscribe(remember("channel"));
    subscriptions.push(channel);
    // A query registered in the same control batch witnesses channel admission.
    const witness = client.subscribe(api.messages.summary, { conversationId: "conversation-1" }, remember("summary"));
    subscriptions.push(witness);
    await witness.until((event: any) => event.live === true, 2_000);
    phase = "receiving channel publish";
    await client.channel(api.typing, { conversationId: "conversation-1" }).publish({ typing: true });
    await channel.until((event: any) => event.payload?.typing === true, 2_000);
    phase = "receiving unknown-operation refusal";
    const refused = client.subscribe(api.missing.operation, {}, remember("missing"));
    subscriptions.push(refused);
    await assert.rejects(refused.until(() => false, 2_000), (error: any) => error.code === "E_OP_UNKNOWN");
    const removed = subscriptions.splice(0, 30);
    for (const sub of removed) sub.close();
    phase = "receiving post-mutation query updates";
    const message = `multiplex-${Date.now()}`;
    await client.mutation(api.messages.send, { conversationId: "conversation-1", recipientId: "profile-bob", body: message });
    await Promise.all(subscriptions.slice(0, 30).map(sub => sub.until((event: any) => event.data?.some((row: any) => row.body === message), 3_000)));
    assert.equal(streams, 1, "changing the subscription set does not restart the connection");
    const denied = await fetch(`${owner.url}/api/live/control`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snapback-As": "bob" }, body: JSON.stringify({ session, close: true }) });
    assert.equal(denied.status, 400, "another principal cannot control this stream");
    await fetch(`${owner.url}/api/live/control`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" }, body: JSON.stringify({ session, close: true }) });
    phase = "receiving stale after owner-forced close";
    await subscriptions[0].until((event: any) => event.state === "stale", 2_000);
    phase = "receiving live delivery after reconnect";
    await subscriptions[0].until((event: any) => event.live === true, 3_000);
    assert.equal(streams, 2);
    assert.ok(controls < 15, "subscriptions are batched, not one control connection per query");
  } catch (error) {
    context.diagnostic(`multiplex failure phase=${phase}; streams=${streams}; controls=${controls}; deliveries=${JSON.stringify(Object.fromEntries(deliveries))}`);
    throw error;
  } finally { for (const sub of subscriptions) sub.close(); await client.close(); }
});

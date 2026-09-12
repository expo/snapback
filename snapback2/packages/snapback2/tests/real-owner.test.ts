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
    const client = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(directory) },
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        const path = new URL(String(input)).pathname;
        if (path === "/api/resume") resumes.push(await response.clone().json());
        if (path === "/api/query" && JSON.parse(String(init?.body)).op === op) {
          const raw = await response.clone().json();
          reads.push(...(raw.pages?.map((frame: any) => frame.envelope) ?? [raw]));
        }
        return response;
      },
    });
    const other = createClient({ url: owner.url, persona: "alice" });
    let drain: any;
    try {
      await client.ready;
      drain = subscribe(client, query, args, () => {}, { drain: true });
      await drain.until((event: any) => event.live === true, 3_000);
      drain.close();
      // The grant is now warm. Remounting a drained, nonempty first page
      // records null as its current tail; the next resume re-delivers it.
      drain = subscribe(client, query, args, () => {}, { drain: true });
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
      const queued = await client.mutation(api.messages.send, { conversationId: "conversation-1", body });
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
      assert.equal(thread.data.filter((row: any) => row.message?.body === body).length, 1);
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
  const client = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(directory) } });
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
      snapshots.push({ state: value.receipt?.state ?? value.status, live: value.freshness.live, seq: value.receipt?.seq,
        rows: Array.isArray(value.data) ? value.data.map((row: any) => row.body) : undefined });
    });
    raw = subscribe(client, api.messages.search, args, (value: any) => {
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
    assert.ok(current.receipt?.state === "complete" || current.receipt?.state === "capped", JSON.stringify(current));
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
    warm = createClient({ url: owner.url, persona: "alice", offline: { store: factory } });
    await warm.ready;
    drain = subscribe(warm, api.messages.inbox, { c: null }, () => {}, { drain: true });
    await drain.until((event: any) => event.live === true && event.caughtUp === true, 5_000);
    await warm.offline();
    const queued = await warm.mutation(api.messages.send, {
      conversationId: "conversation-2", body: "Café offline predicted",
    });
    assert.equal(queued.state, "queued");
    assert.equal((await warm.mutation(api.messages.send, {
      conversationId: "conversation-2", body: "offline second",
    })).state, "queued");
    const before: any = await warm.query(api.messages.search, { term: "CAFE\u0301", c: null });
    assert.ok(before.data.some((row: any) => row.id === queued.ids[0]), JSON.stringify(before));
    const entries = await warm.outbox.entries();
    await warm.offlineRuntime.store.commit({
      deliveries: [{ op: "messages.thread", args: { conversationId: "witness-marker", c: null }, seq: 1,
        state: "complete", next: null, data: { $row: { table: "messages", id: "witness-marker" } },
        rows: [{ table: "messages", id: "witness-marker", row: { id: "witness-marker", conversationId: "witness-marker",
          authorId: "witness", body: "pre", photo: { id: "s2id-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee-0000000000000001", width: 1, height: 1 }, at: 1 } }],
        receipt: { ranges: [], absences: [], verdicts: [] } }],
      outbox: { put: [{ ...entries[0], intent: "__witness", state: "committed", predicted: false }] },
    });
    const after: any = await warm.query(api.messages.search, { term: "CAFE\u0301", c: null });
    assert.ok(after.data.some((row: any) => row.id === queued.ids[0]), JSON.stringify(after));
    drain.close(); await warm.close(); warm = undefined;
    cold = createClient({ url: owner.url, persona: "alice", startOffline: true, offline: { store: factory } });
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
  const writer = createClient({ url: owner.url, persona: "alice" });
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
      const result = await writer.mutation(api.messages.send, { conversationId: "conversation-1", body: `object-page-${index}` });
      assert.equal(result.state, "committed");
    }
    const first = await query(null);
    assert.equal(typeof first.next, "string", "the owner mints the opaque cursor");
    assert.equal(JSON.stringify(first.data).includes("$row"), false, "projection has scalar fields, not row references");
    assert.ok(first.receipt.ranges.some((range: any) => range.rowIds.length > 0));
    const intent = "projected-retirement:0";
    const id = "predicted-message";
    const committed = { intent, grant: "projected-retirement", offset: 0, count: 1, ids: [id], op: "messages.send",
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
  const first = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(root) } });
  let cold: any;
  let drain: any;
  try {
    await first.ready;
    drain = subscribe(first, api.integration.inboxProjected, args, () => {}, { drain: true });
    await drain.until((event: any) => event.live === true, 3_000);
    drain.close(); await first.close();
    let restore: (() => void) | undefined;
    const tails: any[] = [];
    cold = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(root) }, fetch: async (input, init) => {
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
    const committed = await cold.mutation(api.messages.send, { conversationId: "conversation-1", body: "recorded cursor proof" });
    assert.equal(committed.state, "committed");
    assert.deepEqual(tails, [{ ...args, after: held.watermark }]);
    const history = await cold.outbox.entries();
    assert.equal(history.length, 1, "online settlement retains its terminal history");
    assert.equal(history[0].state, "committed");
    assert.deepEqual(history[0].response, committed);
    await cold.outbox.dismiss(history[0].intent);
    assert.equal((await cold.outbox.entries()).length, 0);
    restore?.();
  } finally { drain?.close(); await first.close(); await cold?.close(); await rm(root, { recursive: true, force: true }); }
});

test("the real owner pages an object wrapper but refuses it as a resume log", async (context) => {
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
  assert.equal(typeof page.body.next, "string");
  const programResponse = await fetch(`${owner.url}/api/program?generation=${page.body.generation}`,
    { headers: { "X-Snapback-As": "alice" } });
  assert.equal(programResponse.status, 200);
  const program = await programResponse.json();
  assert.equal(Object.keys(program.programs[op].certificate.result_pages).length, 1,
    "the wrapper certifies a page without certifying an append-log tail");
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
  const client = createClient({ url: owner.url, persona: "alice", fetch: async (input, init) => {
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
    typing: event?.entries?.some((entry: any) => entry.value.typing),
    channelStatus: event?.status,
  });
  let phase = "opening sixty queries";
  try {
    for (let i = 0; i < 60; i++) subscriptions.push(subscribe(client, 
      api.messages.thread, { conversationId: "conversation-1", c: null }, remember(`thread-${i}`),
    ));
    await Promise.all(subscriptions.map(sub => sub.until((event: any) => event.live === true, 5_000)));
    assert.equal(streams, 1);
    phase = "admitting channel with summary query";
    const room = client.channel(api.typing, { conversationId: "conversation-1" });
    const channel = room.subscribe(remember("channel"));
    subscriptions.push(channel);
    // A query registered in the same control batch exercises mixed child admission.
    const witness = subscribe(client, api.messages.conversationView, { conversationId: "conversation-1" }, remember("summary"));
    subscriptions.push(witness);
    await witness.until((event: any) => event.live === true, 2_000);
    await channel.until(snapshot => snapshot.status === "ready", 2_000);
    phase = "receiving channel state";
    await room.set({ typing: true });
    await channel.until(snapshot => snapshot.entries.some((entry: any) => entry.value.typing), 2_000);
    phase = "receiving unknown-operation refusal";
    const refused = subscribe(client, api.missing.operation, {}, remember("missing"));
    subscriptions.push(refused);
    await assert.rejects(refused.until(() => false, 2_000), (error: any) => error.code === "E_OP_UNKNOWN");
    const removed = subscriptions.splice(0, 30);
    for (const sub of removed) sub.close();
    phase = "receiving post-mutation query updates";
    const message = `multiplex-${Date.now()}`;
    await client.mutation(api.messages.send, { conversationId: "conversation-1", body: message });
    await Promise.all(subscriptions.slice(0, 30).map(sub => sub.until((event: any) => event.data?.some((row: any) => row.message?.body === message), 3_000)));
    assert.equal(streams, 1, "changing the subscription set does not restart the connection");
    const denied = await fetch(`${owner.url}/api/live/control`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snapback-As": "bob" }, body: JSON.stringify({ session, close: true }) });
    assert.equal(denied.status, 400, "another principal cannot control this stream");
    const oldKey = room.getSnapshot().key;
    const invalidated = channel.until(snapshot => snapshot.status === "unavailable", 2_000);
    await fetch(`${owner.url}/api/live/control`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" }, body: JSON.stringify({ session, close: true }) });
    assert.deepEqual((await invalidated).entries, []);
    phase = "receiving stale after owner-forced close";
    await subscriptions[0].until((event: any) => event.state === "stale", 2_000);
    phase = "receiving live delivery after reconnect";
    await subscriptions[0].until((event: any) => event.live === true, 3_000);
    const reconnected = await channel.until(snapshot => snapshot.status === "ready", 3_000);
    assert.notEqual(reconnected.key, oldKey);
    assert.deepEqual(reconnected.entries, [], "a reconnected handle must not republish its old value");
    assert.equal(streams, 2);
    assert.ok(controls < 15, "subscriptions are batched, not one control connection per query");
  } catch (error) {
    context.diagnostic(`multiplex failure phase=${phase}; streams=${streams}; controls=${controls}; deliveries=${JSON.stringify(Object.fromEntries(deliveries))}`);
    throw error;
  } finally { for (const sub of subscriptions) sub.close(); await client.close(); }
});

// @ref LLP 1011#b1-opaque-cursors — one returned cursor-bearing page can sit
// beside an aggregate and a fixed preview without losing its continuation.
test("the shipped composite pages online and after a cold offline reopen", async (context) => {
  if (!owner.owned) return context.skip("requires the self-started chat fixture");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const directory = await mkdtemp(join(tmpdir(), "snapback-composite-pages-"));
  const factory = fileRangeStore(directory);
  const writer = createClient({ url: owner.url, persona: "alice" });
  let warm: any, cold: any;
  try {
    // Cross the production page bound; a two-row toy cannot establish that the
    // shipped query exposes every row on a second nonempty page.
    for (let i = 0; i < 51; i++) {
      const result = await writer.mutation(api.messages.send, {
        conversationId: "conversation-1", body: `composite-page-${i}`,
      });
      assert.equal(result.state, "committed");
    }
    warm = createClient({ url: owner.url, persona: "alice", offline: { store: factory } });
    await warm.ready;
    const args = { conversationId: "conversation-1", c: null };
    const first = await warm.query(api.messages.conversationView, args);
    assert.equal(first.data.messages.length, 50);
    assert.equal(typeof first.next, "string");
    const olderArgs = { ...args, c: first.next };
    const second = await warm.query(api.messages.conversationView, olderArgs);
    assert.ok(second.data.messages.length > 0 && second.data.messages.length < 50);
    const firstIds = new Set(first.data.messages.map((row: any) => row.message.id));
    assert.equal(second.data.messages.some((row: any) => firstIds.has(row.message.id)), false);
    assert.equal(first.data.count, second.data.count);
    assert.deepEqual(first.data.preview, second.data.preview, "the fixed preview stays at the live head");
    assert.equal(first.seq, second.seq, "no write occurred between the two atomic snapshots");
    if (second.next) {
      const end = await warm.query(api.messages.conversationView, { ...args, c: second.next });
      assert.deepEqual(end.data.messages, []);
      assert.equal(end.next, null, "an auxiliary capped preview cannot repeat the last message page");
    }
    await warm.close(); warm = undefined;
    cold = createClient({ url: owner.url, persona: "alice", startOffline: true, offline: { store: factory } });
    await cold.ready;
    const reopenedFirst = await cold.query(api.messages.conversationView, args);
    const reopenedSecond = await cold.query(api.messages.conversationView, olderArgs);
    assert.deepEqual(reopenedFirst.data, first.data, "cold evaluation reconstructs the coherent first page");
    assert.deepEqual(reopenedSecond.data, second.data, "the saved continuation selects the same older page offline");
    assert.equal(reopenedFirst.next, first.next);
    assert.equal(reopenedSecond.next, second.next);
  } finally {
    await warm?.close(); await cold?.close(); await writer.close();
    await rm(directory, { recursive: true, force: true });
  }
});


// @ref LLP 1023.001#acceptance — the grouped consumer traverses the whole
// membership population; it never treats an empty match slice as exhaustion.
test("hub guide reaches final membership slice, rich history, and exact scheduled digest", { timeout: 120000 }, async (t) => {
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const { defineItems } = await import("../dist/client.mjs");
  const fixture = resolve(import.meta.dirname, "../../compiler/fixtures/quarry-fanout-guide/snapback");
  let setupData: any;
  const batchSize = (table: string) => table === "messages" ? 1 : 20;
  const fieldType = (table: string, name: string) => ({
    id: "id", principal: "principal", creatorId: "principal", authorId: "principal",
    author: "principal", actor: "principal", follower: "principal", followed: "principal",
    sender: "principal", recipient: "principal", target: "principal",
    conversationId: "conversations", messageId: "messages", membershipId: "memberships", quoteId: "messages ?",
    at: "time", sentAt: "time", expiresAt: "time ?", joinedAt: "time", messageCount: "int",
    period: table === "follows" || table === "messages" ? "time ?" : "time", digestEligible: "bool ?",
    displayName: "text <=50", handle: "text <=20", bio: "text <=200", location: "text <=50",
    title: "text <=120", kind: "enum('group', 'dm')", role: "enum('admin', 'member')",
    body: table === "posts" ? "text <=500" : "text <=2000", emoji: "text <=40",
  }[name]);
  const hub = await RealOwnerHarness.create({ forceOwned: true, fixture, prepare: async root => {

const key = (n: number) => String(n).padStart(4, "0");
const people = ["u0001", "author", ...Array.from({ length: 500 }, (_, n) => "follow"+key(n))];
const profiles = people.map((p, n) => ({ id: "profile-"+p, principal: "dev:"+p,
  displayName: p, handle: "handle_"+key(n), bio: "A full author", location: "Here" }));
const data = {
  personas: people,
  rows: {
    profiles,
    digestTargets: [{ id: "0000-digest-target", target: "dev:u0001" }],
    conversations: Array.from({ length: 1000 }, (_, n) => ({
      id: "chat-"+key(n), title: "Chat "+key(n), kind: n < 100 ? "group" : "dm",
      creatorId: "dev:u0001", messageCount: n === 999 ? 125 : 0,
    })),
    memberships: [
      { id: "peer-seat", conversationId: "chat-0999", principal: "dev:author", role: "member", joinedAt: 0 },
      { id: "peer-seat-2", conversationId: "chat-0998", principal: "dev:author", role: "member", joinedAt: 0 },
    ],
    messages: Array.from({ length: 125 }, (_, n) => ({ id: "message-"+key(n),
      conversationId: "chat-0999", authorId: "dev:author", body: "needle "+key(n),
      quoteId: n === 0 ? null : "message-0000", at: Math.floor(n / 3), period: n === 0 ? 1 : null, expiresAt: null,
    })).concat(Array.from({ length: 999 }, (_, n) => ({ id: "digest-message-"+key(n),
      conversationId: "chat-"+key(n), authorId: "dev:author", body: "digest "+key(n),
      quoteId: null, at: 1, period: 1, expiresAt: n >= 1 && n <= 900 ? 2 : null,
    }))),
    periodUnread: Array.from({ length: 1000 }, (_, n) => ({
      id: "period-unread-"+key(n), messageId: n === 999 ? "message-0000" : "digest-message-"+key(n),
      sender: "dev:author", recipient: "dev:u0001", conversationId: "chat-"+key(n),
      membershipId: "chat-"+key(n), period: 1, sentAt: n === 999 ? 0 : 1,
      expiresAt: n >= 1 && n <= 900 ? 2 : null,
    })),
    reactions: [...Array.from({ length: 125 }, (_, n) => ({ id: "reaction-"+key(n),
      messageId: "message-"+key(n), actor: "dev:u0001", emoji: "👍" })),
      ...["author", ...Array.from({ length: 48 }, (_, n) => "follow"+key(n))].map((name, n) => ({
        id: "tail-reaction-"+key(n), messageId: "message-0124", actor: "dev:"+name, emoji: "👍",
      }))],
    follows: Array.from({ length: 500 }, (_, n) => ({ id: "follow-"+key(n),
      follower: "dev:u0001", followed: "dev:follow"+key(n), period: null, digestEligible: false })).concat([
        { id: "new-follower", follower: "dev:author", followed: "dev:u0001", period: 1, digestEligible: true },
      ]),
    posts: [...Array.from({ length: 500 }, (_, n) => ({ id: "post-"+key(n),
      author: "dev:follow"+key(n), body: "post "+key(n), period: 1, at: Math.floor(n / 3) })),
      { id: "own-post", author: "dev:u0001", body: "my post", period: 1, at: 500 }],
  },
};

    setupData = data;
    const setup = Object.entries(data.rows).map(([table, rows]) => {
      const keys = Object.keys(rows[0]);
      const parameters = Array.from({ length: batchSize(table) }, (_, i) => keys.map(name =>
        "v" + i + "_" + name + ": " + fieldType(table, name))).flat();
      return "mutation " + table + "(n: int, " + parameters.join(", ") + "):\n" +
        Array.from({ length: batchSize(table) }, (_, i) => "  if n > " + i + ":\n    insert " + table + " { " +
          keys.map(name => name + ": v" + i + "_" + name).join(", ") + " }" +
          (table === "conversations" ? "\n    insert memberships { conversationId: v" + i +
            "_id, id: v" + i + "_id, principal: v" + i + "_creatorId, role: 'admin', joinedAt: now }" : "")
        ).join("\n") + "\n";
    }).join("\n");
    await writeFile(join(root, "snapback/fixtureSetup.q"), setup + `
query digestState(target: principal, source: principal, period: time):
  return {
    emitted: digests[target, period] by byTargetPeriod,
    logged: digestLogs[target, period] by byTargetPeriod,
    run: digestRuns[target, period] by byTargetPeriod,
    sourceCount: periodPosts[source, period],
    periodRevision: digestPeriodVersions[period],
    recipientRevision: digestRecipientVersions[target],
    recipientPeriodRevision: digestRecipientPeriodVersions[target, period],
  }

query postPair(postId: posts):
  return { post: posts[postId], head: postHeads[postId] by byPost }
`);
    await writeFile(join(root, "snapback/seed.ts"),
      'import { seed } from "snapback2";\nexport default seed(' + JSON.stringify({ personas: people, rows: {} }) + ');\n');
  } });
  const directory = await mkdtemp(join(tmpdir(), "snapback-hub-guide-"));
  let offline = false;
  const options = { url: hub.url, persona: "u0001", offline: { store: fileRangeStore(directory) },
    fetch: async (input: any, init?: RequestInit) => {
      assert.equal(offline, false, "held read attempted transport");
      return fetch(input, init);
    } };
  let client: any = createClient(options);
  const author: any = createClient({ url: hub.url, persona: "author" });
  let pages: any, stop: (() => void) | undefined;
  const waitFor = async (check: () => boolean, label: string) => {
    const deadline = Date.now() + 10000;
    while (!check()) {
      assert.ok(Date.now() < deadline, label);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  try {
    const control = async (path: string, body?: any, identity = "system") => {
      const info = JSON.parse(await readFile(join(hub.root!, ".snapback/owner.json"), "utf8"));
      const response = await fetch(hub.url + path, { method: body ? "POST" : "GET",
        headers: { "content-type": "application/json", "X-Snapback-Control": info.secret },
        ...(body ? { body: JSON.stringify({ ...body, as: identity }) } : {}) });
      const value: any = await response.json();
      assert.ok(response.ok, JSON.stringify(value).slice(0, 1000));
      return value;
    };
    // Setup is deliberately ahead of the owner's clock. Application writes
    // enter this bucket only after the clock does, and the period schedule is
    // the sole producer of queueDigestPeriod's exact boundaries.
    const targetPeriod = Math.ceil((Date.now() + 300000) / 60000) * 60000;
    let clockOffset = 0;
    for (const rows of Object.values(setupData.rows) as any[][]) for (const row of rows) {
      if (row.period === 1) row.period = targetPeriod;
      if (row.expiresAt === 2) row.expiresAt = targetPeriod + 65000;
    }
    const setupPlan = (Object.entries(setupData.rows) as Array<[string, any[]]>).flatMap(([table, rows]) =>
      table === "messages" ? [
        [table, rows.slice(0, 120)],
        ["memberships", Array.from({ length: 48 }, (_, n) => ({ id: "peer-"+String(n).padStart(4, "0"),
          conversationId: "chat-0999", principal: "dev:follow"+String(n).padStart(4, "0"), role: "member", joinedAt: 0 }))],
        [table, rows.slice(120)],
      ] : [[table, rows]]) as Array<[string, any[]]>;
    for (const [table, rows] of setupPlan) {
      for (let start = 0; start < rows.length; start += batchSize(table)) {
        const args: Record<string, unknown> = { n: Math.min(batchSize(table), rows.length-start) };
        for (let i = 0; i < batchSize(table); i++) for (const [name, value] of Object.entries(rows[start+i] ?? rows[0])) {
          args["v" + i + "_" + name] = value;
        }
        const result = await control("/control/execute", { op: "fixtureSetup." + table, args });
        assert.equal(result.state, "committed", table + ": " + JSON.stringify(result).slice(0, 2000));
      }
    }
    await Promise.all([client.ready, author.ready]);
    const published = await client.mutation(api.feeds.publishPost, { body: "author CRUD" });
    assert.equal(published.state, "committed");
    const postId = published.data.id;
    const postPair = async () => {
      const result = await author.query(api.fixtureSetup.postPair, { postId });
      assert.equal(result.state, "complete");
      return result.data;
    };
    const originalPair = await postPair();
    assert.equal(originalPair.post.body, "author CRUD");
    assert.equal(originalPair.head.post, postId);
    assert.equal(originalPair.head.author, originalPair.post.author);
    assert.equal(originalPair.head.at, originalPair.post.at);
    for (const [operation, args] of [
      [api.feeds.editPost, { postId, body: "foreign edit" }],
      [api.feeds.removePost, { postId }],
    ] as const) {
      const refused = await author.mutation(operation, args);
      assert.equal(refused.state, "rejected", "another principal cannot change the author's post");
      assert.deepEqual(await postPair(), originalPair, "a refused write leaves the post/head pair intact");
    }
    const editedPost = await client.mutation(api.feeds.editPost, { postId, body: "author edited" });
    assert.equal(editedPost.state, "committed", "the author can edit the rich post");
    const editedPair = await postPair();
    assert.equal(editedPair.post.body, "author edited");
    assert.deepEqual(editedPair.head, originalPair.head, "editing preserves the original compact head");
    assert.equal((await client.mutation(api.feeds.removePost, { postId })).state, "committed");
    assert.deepEqual(await postPair(), { post: null, head: null }, "removal deletes both the post and its head");
    const feed = async () => {
      const first = await client.query(api.feeds.followingFeed, { c: null });
      assert.equal(first.state, "capped");
      assert.equal(first.data[0].post.id, "own-post");
      assert.equal(first.data[1].post.id, "post-0499", "the last discovered author participates");
      const second = await client.query(api.feeds.followingFeed, { c: first.next });
      const ids = [...first.data, ...second.data].map(row => row.post.id);
      assert.deepEqual(ids, ["own-post", ...Array.from({ length: 39 }, (_, n) =>
        "post-"+String(499-n).padStart(4, "0"))]);
      for (const row of [...first.data, ...second.data]) {
        assert.equal(row.author.displayName, row.post.author.slice(4));
        assert.ok("images" in row.post && "clip" in row.post, "full post content remains in the shape");
      }
    };
    await feed();
    const guide = await readFile(resolve(import.meta.dirname, "../guide/fanout.md"), "utf8");
    const consumer = /```js\n(async function\* groupedSearch[\s\S]*?)\n```/.exec(guide)![1];
    const groupedSearch = new Function("api", "return (" + consumer + ")")(api);
    const search = async () => {
      let slices = 0;
      const chats = [], snapshots = [];
      for await (const result of groupedSearch(client, "needle")) {
        assert.ok(result.state === "complete" || result.state === "capped", JSON.stringify(result));
        snapshots.push(result);
        for (const group of result.data) {
          if (group.matches.length) chats.push(group.conversation.id);
        }
        slices++;
      }
      assert.equal(slices, 101, "nested capped preview permits one empty terminal membership page");
      assert.deepEqual(chats, ["chat-0999"]);
      assert.ok(snapshots.slice(0, 99).every(page => page.data.every((group: any) => group.matches.length === 0)));
      assert.equal(new Set(snapshots.flatMap(page => page.data.map((group: any) => group.membershipId))).size, 1000);
      return snapshots;
    };
    const memberships = await search();
    const allMessages = async () => {
      let messageCursor: string | null = null;
      const ids: string[] = [];
      do {
        const result = await client.query(api.messages.searchChat, { conversationId: "chat-0999", term: "needle", messageCursor });
        assert.ok(result.state === "complete" || result.state === "capped");
        ids.push(...result.data.map((row: any) => row.id));
        messageCursor = result.next;
      } while (messageCursor !== null);
      assert.deepEqual(ids, Array.from({ length: 125 }, (_, n) => "message-"+String(124-n).padStart(4, "0")));
      assert.equal(new Set(ids).size, ids.length);
    };
    await allMessages();
    const wrongCursor = await client.query(api.messages.searchChat, {
      conversationId: "chat-0999", term: "needle", messageCursor: memberships[0].next,
    });
    assert.equal(wrongCursor.state, "refused");
    assert.equal(wrongCursor.code, "E_INPUT", "membership and message continuations cannot be interchanged");
    const binding = defineItems(api.messages.richThread, { table: "messages", select: (row: any) => row.message });
    pages = client.observePages(api.messages.richThread, { conversationId: "chat-0999" }, { items: binding });
    stop = pages.subscribe(() => {});
    await waitFor(() => pages.getSnapshot().items.length === 5, "rich head");
    for (let n = 1; n < 25; n++) {
      pages.getSnapshot().loadMore();
      await waitFor(() => pages.getSnapshot().items.length === Math.min(125, (n+1)*5), "rich continuation");
    }
    const full = pages.getSnapshot();
    assert.equal(full.items.length, 125);
    assert.equal(new Set(full.items.map((item: any) => item.data.id)).size, 125);
    assert.equal("receipt" in full, false, "independent pages have no aggregate receipt");
    for (const snapshot of full.pages) for (const row of snapshot.data) {
      assert.equal(row.author.bio, "A full author");
      assert.equal(row.reactions.length, row.message.id === "message-0124" ? 50 : 1);
      assert.equal(row.receipts.length, row.message.id >= "message-0120" ? 50 : 2);
      if (row.message.id !== "message-0000") assert.equal(row.quote.body, "needle 0000");
    }
    stop(); stop = undefined; pages = undefined;
    await client.outbox.drain();
    await client.offline(); offline = true;
    await search(); await allMessages(); await feed();
    client = await client.restart();
    await search(); await allMessages(); await feed();
    t.diagnostic("1000 memberships (100 groups+900 DMs), 99 empty slices, final-slice match, 125 tied-time messages; warm/cold held reads");
    offline = false; await client.online();
    const changed = await author.mutation(api.messages.edit, { messageId: "message-0124", body: "different" });
    assert.equal(changed.state, "committed");
    const live = client.observe(api.messages.searchChat, { conversationId: "chat-0999", term: "needle" });
    const stopLive = live.subscribe(() => {});
    await waitFor(() => live.getSnapshot().data?.[0]?.id === "message-0123", "edited search invalidation");
    stopLive();
    pages = client.observePages(api.messages.richThread, { conversationId: "chat-0999" }, { items: binding });
    stop = pages.subscribe(() => {});
    await waitFor(() => pages.getSnapshot().items.length === 5, "live rich head");
    for (let n = 1; n < 3; n++) {
      pages.getSnapshot().loadMore();
      await waitFor(() => pages.getSnapshot().items.length === (n+1)*5, "live rich continuation");
    }
    const inserted = await author.mutation(api.messages.send, { conversationId: "chat-0999", body: "new needle" });
    assert.equal(inserted.state, "committed");
    await waitFor(() => pages.getSnapshot().items[0]?.data?.id === inserted.data.id, "insert rebuilds rich page boundaries");
    assert.equal((await author.mutation(api.messages.remove, { messageId: "message-0120" })).state, "committed");
    assert.equal((await author.mutation(api.messages.edit, { messageId: "message-0121", body: "edited boundary" })).state, "committed");
    await waitFor(() => {
      const items = pages.getSnapshot().items;
      return !items.some((item: any) => item.data?.id === "message-0120") &&
        items.some((item: any) => item.data?.id === "message-0121" && item.data.body === "edited boundary");
    }, "edit/removal cross the rich boundary");
    const rebuilt = pages.getSnapshot().items.map((item: any) => item.data.id);
    assert.equal(new Set(rebuilt).size, rebuilt.length);
    assert.deepEqual(rebuilt, [inserted.data.id, ...Array.from({ length: rebuilt.length }, (_, n) =>
      124-n).filter(n => n !== 120).map(n => "message-"+String(n).padStart(4, "0"))].slice(0, rebuilt.length));
    stop(); stop = undefined; pages = undefined;

    // Replacing an existing follow is an eligibility-incarnation change. Do it
    // before entering the measured period so it cannot create a target-period
    // new-follower contribution for follow0499.
    assert.equal((await client.mutation(api.feeds.setFollowing, { followed: "dev:follow0499", following: false })).state, "committed");
    assert.equal((await client.mutation(api.feeds.setFollowing, { followed: "dev:follow0499", following: true })).state, "committed");
    const intoTarget = Math.max(0, targetPeriod + 1000 - (Date.now() + clockOffset));
    await control("/control/clock", { advanceMs: intoTarget }); clockOffset += intoTarget;

    // One current unread survives in chat0998. Its earlier direct/source row
    // and an earlier real send are excluded by the read mark; a later real
    // send remains. A third real send is removed by its author before close.
    assert.equal((await author.mutation(api.messages.send, { conversationId: "chat-0998", body: "read before mark" })).state, "committed");
    assert.equal((await client.mutation(api.messages.markRead, { conversationId: "chat-0998" })).state, "committed");
    assert.equal((await author.mutation(api.messages.send, { conversationId: "chat-0998", body: "unread after mark" })).state, "committed");
    const removeMe = await author.mutation(api.messages.send, { conversationId: "chat-0998", body: "remove before digest" });
    assert.equal(removeMe.state, "committed");
    assert.equal((await author.mutation(api.messages.remove, { messageId: removeMe.data.id })).state, "committed");
    assert.equal((await client.mutation(api.messages.leave, { conversationId: "chat-0999" })).state, "committed");
    const denied = await client.query(api.messages.searchChat, { conversationId: "chat-0999", term: "needle" });
    assert.equal(denied.state, "denied");
    assert.match(denied.rule, /MEMBERSHIP_REQUIRED/);
    const finalSlice = await client.query(api.messages.searchGroups, { term: "needle", membershipCursor: memberships[98].next });
    assert.equal(finalSlice.data.length, 9);
    assert.ok(finalSlice.data.every((group: any) => group.matches.length === 0));
    await client.offline(); offline = true;
    const revoked = await client.query(api.messages.searchGroups, { term: "needle", membershipCursor: memberships[98].next });
    assert.ok(revoked.state === "partial" || revoked.data.every((group: any) => group.conversation?.id !== "chat-0999"));
    await Promise.all([client.close(), author.close()]);

    // Crossing the exact boundary is the only job kick. The expiry deadline
    // is advanced only after this attempt has accumulated rows, so the
    // owner's 64-timer turns overlap it and cannot act as a completeness
    // barrier.
    const acrossBoundary = Math.max(0, targetPeriod + 60001 - (Date.now() + clockOffset));
    await control("/control/clock", { advanceMs: acrossBoundary }); clockOffset += acrossBoundary;
    const digestArgs = { target: "dev:u0001", source: "dev:follow0499", period: targetPeriod };
    const runningDeadline = Date.now() + 15000;
    let targetJob: any = null;
    let observedJobs: any[] = [];
    const scalar = (value: any) => value?.Int ?? value?.Id ?? value;
    while (targetJob === null || targetJob.chunks < 2 || targetJob.state === "queued") {
      const jobs = await control("/control/jobs");
      observedJobs = jobs.jobs;
      targetJob = jobs.jobs.find((row: any) => row.name === "digest.digestUser" &&
        scalar(row.args.target) === "dev:u0001" && scalar(row.args.period) === targetPeriod && scalar(row.args.attempt) === 0) ?? null;
      assert.ok(Date.now() < runningDeadline, "target digest reaches an accumulated chunk: " +
        JSON.stringify(observedJobs.map((row: any) => ({ name: row.name, args: row.args, state: row.state, chunks: row.chunks })).slice(0, 12)));
    }
    const partial = await control("/control/execute", { op: "fixtureSetup.digestState", args: digestArgs });
    assert.equal(partial.data.emitted, null, "late changes happen before final emission");
    assert.ok(partial.data.run.newPostsInFollowing > 0, "the first attempt has cached followed-post contributions");

    const expireAdvance = Math.max(0, targetPeriod + 65001 - (Date.now() + clockOffset));
    await control("/control/clock", { advanceMs: expireAdvance }); clockOffset += expireAdvance;

    const unreadDeadline = Date.now() + 15000;
    do {
      const jobs = await control("/control/jobs");
      targetJob = jobs.jobs.find((row: any) => row.name === "digest.digestUser" &&
        scalar(row.args.target) === "dev:u0001" && scalar(row.args.period) === targetPeriod && scalar(row.args.attempt) === 0) ?? targetJob;
      if (targetJob.chunks >= 11) break;
      assert.ok(Date.now() < unreadDeadline, "target digest reaches the first unread chunk");
    } while (true);
    const lateLeave = await control("/control/execute", { op: "messages.leave", args: { conversationId: "chat-0000" } }, "u0001");
    assert.equal(lateLeave.state, "committed", "a real-viewer membership revocation follows unread accumulation");

    // Same-target traffic in the next period uses a distinct revision key and
    // cannot postpone this closed period. The source deletion is an ordinary
    // author operation and must invalidate the partial old-period attempt.
    for (let n = 0; n < 5; n++) {
      const later = await control("/control/execute", { op: "messages.send",
        args: { conversationId: "chat-0998", body: "later period " + n } }, "author");
      assert.equal(later.state, "committed");
    }
    const removed = await control("/control/execute", { op: "feeds.removePost", args: { postId: "post-0499" } }, "follow0499");
    assert.equal(removed.state, "committed", JSON.stringify(removed));
    const resetDeadline = Date.now() + 15000;
    let invalidated: any;
    do {
      invalidated = await control("/control/execute", { op: "fixtureSetup.digestState", args: digestArgs });
      if (invalidated.data.emitted === null && invalidated.data.run.attempt >= 1) break;
      assert.ok(Date.now() < resetDeadline, "the stale attempt records a fresh retry before restart");
    } while (true);
    await hub.stop(); await hub.start(false);
    // The development clock offset is session-local. Restore a time after the
    // persisted expiry and retry deadlines before the owner can enqueue the
    // pending attempt.
    const restoreClock = Math.max(0, targetPeriod + 80000 - Date.now());
    await control("/control/clock", { advanceMs: restoreClock }); clockOffset = restoreClock;

    const doneDeadline = Date.now() + 20000;
    let exact: any;
    do {
      exact = await control("/control/execute", { op: "fixtureSetup.digestState", args: digestArgs });
      if (exact.data.emitted !== null) break;
      assert.ok(Date.now() < doneDeadline, "fresh exact digest attempt completes after restart");
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (true);
    assert.deepEqual(exact.data.emitted, {
      id: exact.data.emitted.id,
      target: "dev:u0001", period: targetPeriod, newFollowers: 1,
      newPostsInFollowing: 499, unreadMessages: 98, unreadChats: 98,
    });
    assert.deepEqual(exact.data.logged, {
      id: exact.data.logged.id,
      target: "dev:u0001", period: targetPeriod, periodEnd: targetPeriod + 60000,
      newFollowers: 1, newPostsInFollowing: 499, unreadMessages: 98, unreadChats: 98,
    });
    assert.equal(exact.data.sourceCount, 0);
    assert.equal(exact.data.run.status, "done");
    assert.ok(exact.data.run.attempt >= 1, "a post deletion or overlapping expiry turn forces a fresh attempt");

    const jobs = await control("/control/jobs");
    const targetJobs = jobs.jobs.filter((row: any) => row.name === "digest.digestUser" &&
      scalar(row.args.target) === "dev:u0001" && scalar(row.args.period) === targetPeriod);
    let emits = 0;
    for (const row of targetJobs) {
      const detail = await control("/control/job/" + row.id);
      emits += detail.commits.reduce((sum: number, commit: any) => sum + (commit.emits ?? 0), 0);
    }
    assert.equal(emits, 1, "retry and restart have one logical effect emission");
    const zero = await control("/control/execute", { op: "fixtureSetup.digestState",
      args: { target: "dev:follow0499", source: "dev:u0001", period: targetPeriod } });
    assert.equal(zero.data.run.status, "done");
    assert.equal(zero.data.emitted, null, "zero activity settles without a digest or effect");

    await hub.stop(); await hub.start(false);
    const replay = await control("/control/execute", { op: "fixtureSetup.digestState", args: digestArgs });
    assert.deepEqual(replay.data.emitted, exact.data.emitted, "restart cannot duplicate the target/period receipt");
    const outbox = await control("/control/outbox?limit=200");
    assert.equal(outbox.rows.filter((row: any) => row.effect === "push.digest").length, 1);
    t.diagnostic("scheduled digest: 500 follows + 1000 memberships, 900 expiries over 64-timer turns, late real-author deletion, same-target later-period traffic, restart retry, one logged effect");
  } finally {
    stop?.(); await Promise.all([client.close(), author.close()]);
    await hub.close(); await rm(directory, { recursive: true, force: true });
  }
});

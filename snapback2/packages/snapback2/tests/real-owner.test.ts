import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  SnapbackRefusal,
  api,
  createClient,
  initialQueryState,
  reduceQueryState,
} from "../dist/client.mjs";
import { configureRealOwner } from "./owner-harness.ts";

const owner = await configureRealOwner();
after(async () => owner.close());

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
  await new Promise((resolve) => setTimeout(resolve, 50));
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

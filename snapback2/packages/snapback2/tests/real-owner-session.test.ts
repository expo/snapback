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
  assert.deepEqual(stale.data, initial.data);
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
  context.after(async () => { await alice.close(); await bob.close(); });
  const channel = bob.channel(api.typing, { conversationId: "conversation-1" });
  const snapshots: any[] = [];
  const sub = channel.subscribe(snapshot => snapshots.push(snapshot));
  await sub.until(snapshot => snapshot.status === "ready", 2_000);
  const typing = sub.until(snapshot => snapshot.entries.some((entry: any) => entry.value.typing), 2_000);
  assert.deepEqual(
    await alice.channel(api.typing, { conversationId: "conversation-1" }).set({ typing: true }),
    { ok: true },
  );
  assert.deepEqual((await typing).entries[0].value, { typing: true });
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
  assert.equal(snapshots.at(-1)?.status, "unavailable");
  assert.equal(snapshots.at(-1)?.reason, "refused");
  assert.deepEqual(snapshots.at(-1)?.entries, []);
  assert.equal(snapshots.at(-1)?.key, undefined);
  assert.equal(snapshots.at(-1)?.refusal.family, "rule");
  assert.equal(snapshots.at(-1)?.refusal.guide, "live-query");
  sub.close();
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

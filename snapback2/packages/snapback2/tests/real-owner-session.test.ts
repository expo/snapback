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

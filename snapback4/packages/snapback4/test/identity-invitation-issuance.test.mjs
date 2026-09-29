import { readyRead } from "../dist/read-presence.js";
// Protocol doubles for the authored optional B1d.3 invitation-handler source.
// These are not engine, crash-process, authentication or provider qualification.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("./fixtures/identity-recipe/invitation-issuance/", import.meta.url);
const { invitationIssuanceHandler } = await import(new URL("issue-invitation.ts", fixture));
const { RESEND_EMAIL_ENDPOINT, ResendUnresolved, sendResendEmail } = await import(new URL("resend.ts", fixture));
const { ParkStep } = await import("snapback4/server");
const { Retry } = await import("snapback4/worker");

const sha256 = value => createHash("sha256").update(value, "utf8").digest("hex");
const fresh = (data, extra = {}) => (readyRead({ data, complete: true, cut: null, fresh: true, ...extra }));
const denied = { denied: { code: "ORGANIZATION_ADMIN_REQUIRED", family: "rule", message: "admin required" } };
const operations = {
  adminOrganizationSummary: { kind: "query", name: "organizations.adminOrganizationSummary" },
  invitationDeliveryState: { kind: "query", name: "organizations.invitationDeliveryState" },
  organizationRecordInvitation: { kind: "mutation", name: "organizations.organizationRecordInvitation" },
};
const args = { organization: "01ORG000000000000000000000", recipientEmail: "person@example.test" };
const baseConfig = () => ({
  acceptanceBase: "https://app.example/invitations/accept",
  from: "Invitations <invitations@example.com>",
  subject: "Your organization invitation",
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const byteStream = (chunks, cancel) => new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    controller.close();
  },
  cancel,
});
const readerResponse = (chunks, { status = 200, headers = {}, cancel, onRead } = {}) => {
  const values = chunks.map(chunk => typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  let index = 0;
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), body: { getReader: () => ({
    async read() { onRead?.(index); return index < values.length ? { done: false, value: values[index++] } : { done: true, value: undefined }; },
    async cancel() { return cancel?.(); },
    releaseLock() {},
  }), cancel: async () => cancel?.() } };
};

class Protocol {
  constructor() {
    this.events = [];
    this.steps = new Map();
    this.config = baseConfig();
    this.apiKey = "resend-key-a";
    this.principal = "member:admin";
    this.now = 1_000_000;
    this.row = null;
    this.mutations = [];
    this.providerRequests = [];
    this.providerAccepted = new Map();
    this.providerBehavior = "accepted";
    this.adminRead = undefined;
    this.deliveryRead = undefined;
    this.deliveryReads = 0;
    this.pendingOnce = false;
    this.pendingReturned = false;
    this.loseDoneBeforeCommit = new Map();
    this.loseDoneAfterCommit = new Map();
    this.lostResults = new Map();
    this.abort = new AbortController();
  }

  handler() {
    return invitationIssuanceHandler(operations, this.config, { fetch: this.fetch.bind(this) });
  }

  context() {
    const protocol = this;
    return {
      principal: this.principal,
      invocation: { id: "action-invitation-1", attempt: 1, deadline: this.now + 600_000, cancelled: false, signal: this.abort.signal },
      secrets: { MAIL_API_KEY: this.apiKey },
      query: (op, input) => protocol.query(op, input),
      mutate: (op, input, options) => protocol.mutate(op, input, options),
      step: (name, input, run, options) => protocol.step(name, input, run, options),
      writeIdFor(label) { return ({
        "invite.entity/v1": "01INVITE000000000000000000",
        "invite.record.write/v1": "01WRITE0000000000000000000",
      })[label] ?? `id:${label}`; },
    };
  }

  async run() {
    return this.handler()(args, this.context());
  }

  async query(op, input) {
    this.events.push({ kind: "query", name: op.name, input: structuredClone(input) });
    if (op.name === operations.adminOrganizationSummary.name) {
      return this.adminRead ?? fresh({ seatLimit: 5, memberCount: 1, reservationCount: 0 });
    }
    assert.equal(op.name, operations.invitationDeliveryState.name);
    this.deliveryReads++;
    if (typeof this.deliveryRead === "function") return this.deliveryRead(this.deliveryReads);
    return this.deliveryRead ?? fresh({ ...this.row, serverNow: this.now });
  }

  async mutate(op, input, options) {
    assert.equal(op.name, operations.organizationRecordInvitation.name);
    const call = { input: structuredClone(input), options: structuredClone(options) };
    this.mutations.push(call);
    this.events.push({ kind: "mutate", ...call });
    if (!this.row) this.row = {
      id: input.id,
      organization: input.organization,
      recipientEmail: input.recipientEmail,
      issuer: this.principal,
      issuedAt: this.now,
      expiresAt: this.now + 604_800_000,
      status: "pending",
    };
    if (this.pendingOnce && !this.pendingReturned) {
      this.pendingReturned = true;
      return { state: "pending", id: options.id };
    }
    return this.mutations.length === 1
      ? { state: "sent", id: options.id, seq: 1, result: { deliberately: "unused" } }
      : { state: "sent", id: options.id, seq: 1, replayed: true };
  }

  async step(name, input, run, options) {
    const encoded = JSON.stringify(input);
    const prior = this.steps.get(name);
    if (prior) assert.equal(encoded, prior.input, `${name} input changed`);
    if (prior?.state === "done") {
      this.events.push({ kind: "step-replay", name });
      return structuredClone(prior.result);
    }
    const step = prior ?? { state: "started", input: encoded, key: `step:${name}:stable` };
    this.steps.set(name, step);
    const historical = Boolean(prior);
    this.events.push({ kind: historical ? "step-reconcile" : "step-run", name, key: step.key });
    const result = await (historical ? options?.reconcile?.(step.key) : run(step.key));
    const before = this.loseDoneBeforeCommit.get(name) ?? 0;
    if (before > 0) {
      this.loseDoneBeforeCommit.set(name, before - 1);
      this.lostResults.set(name, structuredClone(result));
      throw new Retry(`lost ${name} completion before durable commit`);
    }
    step.state = "done";
    step.result = structuredClone(result);
    this.events.push({ kind: "step-done", name });
    const after = this.loseDoneAfterCommit.get(name) ?? 0;
    if (after > 0) {
      this.loseDoneAfterCommit.set(name, after - 1);
      throw new Retry(`lost ${name} completion acknowledgement`);
    }
    return structuredClone(result);
  }

  async fetch(url, init) {
    const headers = new Headers(init.headers);
    const request = { url: String(url), key: headers.get("idempotency-key"), body: String(init.body), redirect: init.redirect };
    this.providerRequests.push(request);
    this.events.push({ kind: "provider-post", key: request.key });
    if (this.providerBehavior === "before-accept-once" && this.providerRequests.length === 1) throw new TypeError("transport failed before accept");
    if (this.providerBehavior === "400") return new Response("provider refusal detail", { status: 400 });
    const existing = this.providerAccepted.get(request.key);
    if (existing && existing.body !== request.body) return new Response("changed", { status: 409 });
    if (!existing) this.providerAccepted.set(request.key, { body: request.body, id: "email-accepted-1" });
    if (this.providerBehavior === "after-accept-once" && this.providerRequests.length === 1) throw new TypeError("reply lost after accept");
    if (this.providerBehavior === "503") return new Response("provider detail must stay private", { status: 503 });
    if (this.providerBehavior === "409") return new Response("provider conflict detail", { status: 409 });
    if (this.providerBehavior === "unreadable") return new Response("{", { status: 200 });
    return Response.json({ id: this.providerAccepted.get(request.key).id });
  }
}

test("prepare precedes writes, generates exactly 32 bytes, and only the hash crosses the managed write", async () => {
  const p = new Protocol();
  const result = await p.run();
  assert.deepEqual(result, { invitation: "01INVITE000000000000000000", delivery: "accepted", providerMessageId: "email-accepted-1" });
  const prepared = p.steps.get("invite.prepare/v1").result;
  assert.equal(Buffer.from(prepared.rawToken, "base64url").byteLength, 32);
  assert.equal(prepared.tokenHash, sha256(prepared.rawToken));
  assert.match(prepared.configSha256, /^[0-9a-f]{64}$/);
  assert.match(prepared.credentialNamespaceFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(p.events.findIndex(event => event.name === operations.adminOrganizationSummary.name)
    < p.events.findIndex(event => event.kind === "mutate"), true);
  assert.equal(p.mutations.length, 1);
  assert.equal(p.mutations[0].input.tokenHash, prepared.tokenHash);
  assert.equal(p.mutations[0].options.id, "01WRITE0000000000000000000");
  assert.doesNotMatch(JSON.stringify(p.mutations), new RegExp(prepared.rawToken));
  assert.equal(p.providerRequests[0].url, RESEND_EMAIL_ENDPOINT);
  assert.equal(p.providerRequests[0].redirect, "error");
  assert.equal(p.providerRequests[0].key, "step:invite.mail/v1:stable");
  assert.match(p.providerRequests[0].body, new RegExp(prepared.rawToken));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(prepared.rawToken));
  assert.doesNotMatch(JSON.stringify(p.steps.get("invite.mail/v1").result), new RegExp(prepared.rawToken));
});

test("prepare completion cuts gate all downstream work, and record completes before the provider POST", async t => {
  await t.test("lost before prepare completion commit", async () => {
    const p = new Protocol();
    p.loseDoneBeforeCommit.set("invite.prepare/v1", 1);
    await assert.rejects(p.run(), Retry);
    assert.equal(p.mutations.length, 0);
    assert.equal(p.providerRequests.length, 0);
    const abandoned = p.lostResults.get("invite.prepare/v1").rawToken;
    await p.run();
    const committed = p.steps.get("invite.prepare/v1").result.rawToken;
    assert.notEqual(abandoned, committed);
    assert.equal(p.mutations[0].input.tokenHash, sha256(committed));
  });
  await t.test("lost after prepare completion commit", async () => {
    const p = new Protocol();
    p.loseDoneAfterCommit.set("invite.prepare/v1", 1);
    await assert.rejects(p.run(), Retry);
    const committed = p.steps.get("invite.prepare/v1").result.rawToken;
    assert.equal(p.mutations.length, 0);
    assert.equal(p.providerRequests.length, 0);
    await p.run();
    assert.equal(p.steps.get("invite.prepare/v1").result.rawToken, committed);
    assert.equal(p.mutations[0].input.tokenHash, sha256(committed));
    assert.ok(p.events.findIndex(event => event.kind === "step-done" && event.name === "invite.prepare/v1")
      < p.events.findIndex(event => event.kind === "mutate"));
    assert.ok(p.events.findIndex(event => event.kind === "step-done" && event.name === "invite.record/v1")
      < p.events.findIndex(event => event.kind === "provider-post"));
  });
});

test("ordinary point reads deny loading, incomplete, stale, cut, continued, denied and missing results", async t => {
  const cases = [
    ["loading", { loading: true }],
    ["denied", denied],
    ["incomplete", { ...fresh({}), complete: false }],
    ["stale", { ...fresh({}), fresh: false, since: 1 }],
    ["cut", { ...fresh({}), cut: "meter" }],
    ["continued", { ...fresh({}), next: "cursor" }],
    ["missing", fresh(null)],
  ];
  for (const [name, read] of cases) await t.test(name, async () => {
    const p = new Protocol();
    p.adminRead = read;
    await assert.rejects(p.run(), Retry);
    assert.equal(p.mutations.length, 0);
    assert.equal(p.providerRequests.length, 0);
  });
});

test("completed prepare replays its token; uncertain record repeats one write and exact-ID query without a mutation result", async () => {
  const p = new Protocol();
  p.pendingOnce = true;
  await assert.rejects(p.run(), Retry);
  const token = p.steps.get("invite.prepare/v1").result.rawToken;
  assert.equal(p.providerRequests.length, 0);
  const result = await p.run();
  assert.equal(result.delivery, "accepted");
  assert.equal(p.steps.get("invite.prepare/v1").result.rawToken, token);
  assert.equal(p.mutations.length, 2);
  assert.deepEqual(p.mutations[0], p.mutations[1]);
  assert.equal(p.deliveryReads >= 2, true);
  assert.equal(p.events.some(event => event.kind === "step-reconcile" && event.name === "invite.record/v1"), true);
});

test("before-accept and accept-then-lost-reply faults reconcile with the same provider key and immutable body", async t => {
  for (const behavior of ["before-accept-once", "after-accept-once"]) await t.test(behavior, async () => {
    const p = new Protocol();
    p.providerBehavior = behavior;
    await assert.rejects(p.run(), Retry);
    const result = await p.run();
    assert.equal(result.delivery, "accepted");
    assert.equal(p.providerRequests.length, 2);
    assert.equal(p.providerRequests[0].key, p.providerRequests[1].key);
    assert.equal(p.providerRequests[0].body, p.providerRequests[1].body);
    assert.equal(p.providerAccepted.size, 1);
  });
});

test("historical unknown parks inside mail reconciliation on role, state, time, config or credential fences", async t => {
  const cases = {
    "admin query denial": p => { p.deliveryRead = denied; },
    revoked: p => { p.row.status = "revoked"; },
    accepted: p => { p.row.status = "accepted"; },
    expired: p => { p.now = p.row.expiresAt; },
    horizon: p => { p.now = p.row.issuedAt + 600_001; },
    "changed sender": p => { p.config.from = "Changed <changed@example.com>"; },
    "changed API key": p => { p.apiKey = "resend-key-b"; },
    "newly invalid URL": p => { p.config.acceptanceBase = "http://invalid.example/accept"; },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async () => {
    const p = new Protocol();
    p.providerBehavior = "after-accept-once";
    await assert.rejects(p.run(), Retry);
    assert.equal(p.providerAccepted.size, 1);
    const requests = p.providerRequests.length;
    change(p);
    await assert.rejects(p.run(), ParkStep);
    assert.equal(p.providerRequests.length, requests, "a fenced reconciliation made another POST");
    assert.equal(p.events.some(event => event.kind === "step-reconcile" && event.name === "invite.mail/v1"), true);
  });
});

test("a fresh definitive inactive guard is not-sent, but completed mail replays through provider/config outages", async () => {
  const inactive = new Protocol();
  inactive.deliveryRead = count => count === 1
    ? fresh({ ...inactive.row, id: "01INVITE000000000000000000", organization: args.organization,
      recipientEmail: args.recipientEmail, issuer: inactive.principal, issuedAt: inactive.now,
      expiresAt: inactive.now + 604_800_000, status: "pending", serverNow: inactive.now })
    : fresh({ ...inactive.row, id: "01INVITE000000000000000000", organization: args.organization,
      recipientEmail: args.recipientEmail, issuer: inactive.principal, issuedAt: inactive.now,
      expiresAt: inactive.now + 604_800_000, status: "revoked", serverNow: inactive.now });
  assert.deepEqual(await inactive.run(), { invitation: "01INVITE000000000000000000", delivery: "not-sent", providerMessageId: null });
  assert.equal(inactive.providerRequests.length, 0);

  const completed = new Protocol();
  const first = await completed.run();
  const reads = completed.events.filter(event => event.kind === "query").length;
  const writes = completed.mutations.length;
  const posts = completed.providerRequests.length;
  completed.config.acceptanceBase = "not a URL";
  completed.apiKey = "";
  completed.adminRead = denied;
  completed.deliveryRead = denied;
  completed.fetch = () => assert.fail("completed mail must not call provider");
  assert.deepEqual(await completed.run(), first);
  assert.equal(completed.events.filter(event => event.kind === "query").length, reads);
  assert.equal(completed.mutations.length, writes);
  assert.equal(completed.providerRequests.length, posts);
});

test("a lost acknowledgement after mail completion replays with no current read, write or POST", async () => {
  const p = new Protocol();
  p.loseDoneAfterCommit.set("invite.mail/v1", 1);
  await assert.rejects(p.run(), Retry);
  assert.equal(p.steps.get("invite.mail/v1").state, "done");
  const reads = p.events.filter(event => event.kind === "query").length;
  const writes = p.mutations.length;
  const posts = p.providerRequests.length;
  const result = await p.run();
  assert.deepEqual(result, { invitation: "01INVITE000000000000000000", delivery: "accepted", providerMessageId: "email-accepted-1" });
  assert.equal(p.events.filter(event => event.kind === "query").length, reads);
  assert.equal(p.mutations.length, writes);
  assert.equal(p.providerRequests.length, posts);
});

test("provider uncertainty, 409 and historical 4xx never become false done; errors redact bodies and tokens", async t => {
  for (const behavior of ["503", "unreadable"]) await t.test(behavior, async () => {
    const p = new Protocol();
    p.providerBehavior = behavior;
    const error = await p.run().then(() => assert.fail("unexpected completion"), value => value);
    assert.ok(error instanceof Retry);
    assert.doesNotMatch(error.message, /provider detail|person@example|token/i);
    assert.notEqual(p.steps.get("invite.mail/v1").state, "done");
  });
  const conflict = new Protocol();
  conflict.providerBehavior = "409";
  await assert.rejects(conflict.run(), ParkStep);
  assert.notEqual(conflict.steps.get("invite.mail/v1").state, "done");

  const historical4xx = new Protocol();
  historical4xx.providerBehavior = "before-accept-once";
  await assert.rejects(historical4xx.run(), Retry);
  historical4xx.providerBehavior = "400";
  await assert.rejects(historical4xx.run(), ParkStep);
  assert.notEqual(historical4xx.steps.get("invite.mail/v1").state, "done");

  const first400 = new Protocol();
  first400.providerBehavior = "400";
  assert.equal((await first400.run()).delivery, "not-sent");
  assert.equal(first400.providerAccepted.size, 0);

  let redirect;
  const redirectError = await sendResendEmail({ apiKey: "key", idempotencyKey: "redirect", body: "{}",
    signal: AbortSignal.timeout(1000), fetch: async (_url, init) => {
      redirect = init.redirect;
      throw new TypeError("redirect refused with private provider detail");
    } }).then(() => assert.fail("unexpected redirect completion"), error => error);
  assert.equal(redirect, "error");
  assert.ok(redirectError instanceof Retry);
  assert.doesNotMatch(redirectError.message, /redirect|provider detail/);

  await assert.rejects(sendResendEmail({ apiKey: "key", idempotencyKey: "same", body: "changed",
    signal: AbortSignal.timeout(1000), fetch: async () => new Response("conflict", { status: 409 }) }), ResendUnresolved);
});

test("successful provider JSON is byte-bounded before accumulation and remains uncertain on body faults", async t => {
  await t.test("exact 64 KiB boundary", async () => {
    const prefix = JSON.stringify({ id: "boundary-accepted" });
    const json = prefix + " ".repeat(64 * 1024 - Buffer.byteLength(prefix));
    assert.equal(Buffer.byteLength(json), 64 * 1024);
    const result = await sendResendEmail({ apiKey: "key", idempotencyKey: "boundary", body: "{}",
      signal: AbortSignal.timeout(1000), fetch: async () => readerResponse([
        Buffer.from(json.slice(0, 32000)), Buffer.from(json.slice(32000)),
      ]) });
    assert.equal(result.kind, "accepted");
    assert.equal(result.providerMessageId, "boundary-accepted");
  });
  for (const [name, headers] of [["absent content length", {}], ["lying content length", { "content-length": "12" }]]) {
    await t.test(name, async () => {
      const valid = new TextEncoder().encode(JSON.stringify({ id: "would-accept-without-cap", extra: "é".repeat(33_000) }));
      assert.ok(JSON.stringify({ id: "would-accept-without-cap", extra: "é".repeat(33_000) }).length < 64 * 1024);
      assert.ok(valid.byteLength > 64 * 1024);
      let cancelled = 0, reads = 0, observedLength;
      const error = await sendResendEmail({ apiKey: "key", idempotencyKey: name, body: "{}",
        signal: AbortSignal.timeout(1000), fetch: async () => {
          const response = readerResponse([valid.subarray(0, 65_000), valid.subarray(65_000), new Uint8Array(0)],
            { headers, cancel: () => { cancelled++; }, onRead: () => { reads++; } });
          observedLength = response.headers.get("content-length");
          return response;
        }
      }).then(() => assert.fail("overflow became accepted"), value => value);
      assert.ok(error instanceof Retry);
      assert.doesNotMatch(error.message, /would-accept|extra|content-length/);
      assert.equal(reads, 2, "the reader continued after the crossing chunk");
      assert.equal(cancelled, 1);
      assert.equal(observedLength, name === "lying content length" ? "12" : null);
    });
  }
  await t.test("read and parse details are sanitized", async () => {
    const bodies = [
      new ReadableStream({ start(controller) { controller.error(new Error("private read detail")); } }),
      byteStream(["{private parse detail"]),
    ];
    for (const body of bodies) {
      const error = await sendResendEmail({ apiKey: "key", idempotencyKey: "bad-body", body: "{}",
        signal: AbortSignal.timeout(1000), fetch: async () => new Response(body, { status: 200 })
      }).then(() => assert.fail("bad body became accepted"), value => value);
      assert.ok(error instanceof Retry);
      assert.doesNotMatch(error.message, /private|read|parse/);
    }
  });
});

test("non-success bodies are cancelled without awaiting hostile cancellation", { timeout: 2000 }, async () => {
  let conflictCancelled = 0;
  await assert.rejects(sendResendEmail({ apiKey: "key", idempotencyKey: "conflict", body: "{}",
    signal: AbortSignal.timeout(1000), fetch: async () => new Response(byteStream(["conflict"], () => { conflictCancelled++; }), { status: 409 })
  }), ResendUnresolved);
  assert.equal(conflictCancelled, 1);

  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  try {
    const rejected = await sendResendEmail({ apiKey: "key", idempotencyKey: "rejected-cancel", body: "{}",
      signal: AbortSignal.timeout(1000), fetch: async () => new Response(byteStream(["no"], () => Promise.reject(new Error("cancel detail"))), { status: 400 }) });
    assert.equal(rejected.kind, "rejected");
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally { process.removeListener("unhandledRejection", onUnhandled); }

  const never = sendResendEmail({ apiKey: "key", idempotencyKey: "never-cancel", body: "{}",
    signal: AbortSignal.timeout(1000), fetch: async () => new Response(byteStream(["no"], () => new Promise(() => {})), { status: 400 }) });
  const bounded = await Promise.race([never, new Promise(resolve => setImmediate(() => resolve("cancel was awaited")))]);
  assert.notEqual(bounded, "cancel was awaited");
  assert.equal(bounded.kind, "rejected");
});

test("HTTP and response consumption settle on abort after the ignoring transport has entered", { timeout: 2000 }, async () => {
  const fetchAbort = new AbortController();
  const fetchEntered = deferred(), fetchLate = deferred();
  const fetchPending = sendResendEmail({ apiKey: "key", idempotencyKey: "key", body: "{}", signal: fetchAbort.signal,
    fetch: async () => { fetchEntered.resolve(true); return fetchLate.promise; } });
  assert.equal(await fetchEntered.promise, true);
  const fetchReason = new Error("fetch lifetime ended");
  fetchAbort.abort(fetchReason);
  await assert.rejects(fetchPending, error => error === fetchReason);
  fetchLate.resolve(Response.json({ id: "must-not-settle-late" }));
  await Promise.resolve();

  const bodyAbort = new AbortController();
  const bodyEntered = deferred(), bodyLate = deferred();
  let bodyCancelled = 0;
  const bodyPending = sendResendEmail({ apiKey: "key", idempotencyKey: "key", body: "{}", signal: bodyAbort.signal,
    fetch: async () => ({ status: 200, ok: true, body: { getReader: () => ({
      read: async () => { bodyEntered.resolve(true); return bodyLate.promise; },
      cancel: async () => { bodyCancelled++; },
      releaseLock() {},
    }) } }) });
  assert.equal(await bodyEntered.promise, true);
  const bodyReason = new Error("body lifetime ended");
  bodyAbort.abort(bodyReason);
  await assert.rejects(bodyPending, error => error === bodyReason);
  bodyLate.resolve({ done: false, value: new TextEncoder().encode('{"id":"must-not-settle-late"}') });
  await Promise.resolve();
  assert.equal(bodyCancelled, 1);
});

test("optional staging keeps the baseline registry untouched and uses the exact generated module layout", () => {
  const at = path => readFileSync(new URL(path, fixture), "utf8");
  const actions = at("actions.q");
  const stagedServer = at("server.ts");
  const baselineSchema = readFileSync(`${packageRoot}test/fixtures/identity-recipe/snapback/schema.q`, "utf8");
  const baselineServer = readFileSync(`${packageRoot}test/fixtures/identity-recipe/snapback/server.ts`, "utf8");
  const emitter = readFileSync(`${packageRoot}../../crates/snapback4-lang/src/emit.rs`, "utf8");
  assert.match(actions, /^action issueInvitation\(/m);
  assert.doesNotMatch(baselineSchema, /action issueInvitation/);
  assert.doesNotMatch(baselineServer, /issueInvitation|MAIL_API_KEY/);
  for (const name of ["adminOrganizationSummary", "invitationDeliveryState", "organizationRecordInvitation"]) {
    assert.match(stagedServer, new RegExp(`api\\.organizations\\.${name}`));
  }
  assert.match(stagedServer, /issueInvitation,/);
  assert.match(emitter, /if module != "schema"/);
  assert.ok(emitter.includes('out.push_str(&format!("  {}: {{\\n", property(module)))'));
});

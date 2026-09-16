import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";
import { startServices } from "../../../../../benchmarks/tools/team-workspace/services.mjs";
import { starterActions } from "../../../../../benchmarks/tools/team-workspace/starter.mjs";
import { resolveRefs } from "../../../../../benchmarks/tools/team-workspace/actions.mjs";
import { KEY, entry, fixture, until } from "./routes.mjs";

// Increment-A route evidence from the real conformance provider and canonical
// W5 event sequence (two-event backlog). Not the 200-event scale probe, a full
// Workroom adapter, seat-limit/past-due authorization, or complete W5 evidence.
export async function workroomRoutes(t) {
  const p = fixture(t, `
table organizations:
  name: text <=80
  plan: text <=40
  seatLimit: int
  renewalAt: int ?
  revision: int
  public 'bounded billing witness'
  insert <- viewer = 'service:route-test-driver'
  update <- viewer = 'service:billing'
table billingChanges:
  organizationId: organizations
  revision: int
  plan: text <=40
  seatLimit: int
  renewalAt: int ?
  by byOrganization: organizationId, id
  public 'bounded billing audit witness'
  insert <- viewer = 'service:billing'
mutation createOrganization(name: text <=80):
  return insert organizations { name, plan: 'free', seatLimit: 5, renewalAt: null, revision: 0 }
mutation applyBilling(organizationId: organizations, revision: int, plan: text <=40, seatLimit: int, renewalAt: int ?):
  current = organizations[organizationId] ! else ORGANIZATION_MISSING
  require revision > current.revision else STALE_REVISION
  update organizations[current.id] { revision, plan, seatLimit, renewalAt }
  insert billingChanges { organizationId, revision, plan, seatLimit, renewalAt }
  return { applied: true }
query billingState(organizationId: organizations):
  return organizations[organizationId] ! else ORGANIZATION_MISSING
query billingAudit(organizationId: organizations):
  return billingChanges[organizationId] first 50 by byOrganization
route billing: post "/billing/webhook" as service:billing secrets [HOOK_KEY] retry 3 backoff 1s wait 2s
`, entry(`{billing:{
    async verify(req, ctx) {
      const raw = await req.rawBody();
      const expected = "v1=" + createHmac("sha256", ctx.secrets.HOOK_KEY).update(raw).digest("hex");
      const supplied = req.headers.get("x-workroom-signature") ?? "";
      const ok = supplied.length === expected.length && timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
      record("verified", {ok, event:req.headers.get("x-workroom-event-id"), hex:Buffer.from(raw).toString("hex")});
      return ok;
    },
    async handle(req, ctx) {
      const event = JSON.parse(Buffer.from(await req.rawBody()).toString("utf8")) as {
        id:string, organizationId:string, revision:number, plan:string, seatLimit:number, renewalAt:number|null
      };
      record("handled", {event:event.id, revision:event.revision, id:ctx.invocation.id});
      const {organizationId, revision, plan, seatLimit, renewalAt} = event;
      const result = await ctx.mutate(api.applyBilling, {organizationId, revision, plan, seatLimit, renewalAt}, {id:ctx.writeIdFor("apply-billing")});
      if (result.state === "failed" && result.why.code === "STALE_REVISION") throw new GiveUp("superseded billing revision");
      if (result.state !== "sent") throw new Retry("billing mutation did not settle");
      return new Response(null, {status:204});
    },
  }}`));
  let host = await p.start();
  const port = host.port;
  const created = await host.post("/m/createOrganization", {args:{name:"Acme Workroom"}});
  assert.equal(created.state, "sent", JSON.stringify(created));
  const aliases = new Map([["acme", created.result.id]]);
  let receiverOnline = true, faults = [], dropped = 0, refused = 0;
  // Transport-only faults, never database shortcuts: drop is AFTER the actual
  // backend completed its response; the retry must recover its durable work.
  const proxy = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const fault = faults.shift();
    if (fault === "503-once") { refused++; response.writeHead(503); response.end(); return; }
    try {
      const upstream = await fetch(host.url + request.url, {method:"POST", headers:request.headers,
        body:Buffer.concat(chunks), signal:AbortSignal.timeout(5000)});
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (fault === "commit-then-drop-once") { dropped++; response.destroy(); return; }
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers)); response.end(bytes);
    } catch { if (!response.destroyed) { response.writeHead(503); response.end(); } }
  });
  await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); });
  const admin = "workroom-route-fixture-admin-only", serviceToken = "workroom-route-fixture-service-only";
  const configuration = {directory:join(p.directory, "provider"), adminToken:admin, serviceToken, signingSecret:KEY,
    webhookUrl:`http://127.0.0.1:${proxy.address().port}/billing/webhook`, autoRetry:false, retryMs:10, timeoutMs:6000};
  let services = await startServices(configuration), closed = false;
  t.after(async () => { if (!closed) await services.close(); });
  async function providerCall(path, input, key) {
    const response = await fetch(services.url + path, {method:input === undefined ? "GET" : "POST",
      headers:{authorization:`Bearer ${admin}`, "content-type":"application/json", ...(key ? {"idempotency-key":key} : {})},
      ...(input === undefined ? {} : {body:JSON.stringify(input)}), signal:AbortSignal.timeout(15_000)});
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
  }
  const tick = () => providerCall("/payment/tick", {});
  const status = () => providerCall("/payment/status");
  async function application() {
    const args = {organizationId:aliases.get("acme")};
    const state = await host.post("/q/billingState", {args}), audit = await host.post("/q/billingAudit", {args});
    assert.ok(state.data, JSON.stringify(state)); assert.ok(Array.isArray(audit.data), JSON.stringify(audit));
    assert.equal(audit.complete, true, "the audit digest must cover the complete bounded result");
    return {state:state.data, audit:audit.data};
  }
  async function snapshot() {
    const {state, audit} = await application();
    return JSON.stringify({plan:state.plan, seatLimit:state.seatLimit, renewalAt:state.renewalAt, revision:state.revision,
      auditDigest:createHash("sha256").update(JSON.stringify(audit.toSorted((a, b) => a.id.localeCompare(b.id)))).digest("hex")});
  }
  async function acknowledged(ids) {
    return until(async () => {
      const result = await tick();
      return ids.every(id => result.deliveries.some(delivery => delivery.id === id && delivery.ack)) && result;
    }, "canonical payment deliveries have durable acknowledgements", host.log, 15_000);
  }
  let invalidBaseline, backlogIds = [], backlogEvents = [], finalSnapshot;
  const actions = [...starterActions({conformance:true})].filter(action => action.milestone === "W5");
  for (const action of actions) {
    // These application features are explicitly outside the increment-A slice.
    if (["project.set", "invitation.create"].includes(action.op)) continue;
    if (action.op === "payment.event") {
      const input = resolveRefs(action.input, aliases), {organization, ...fields} = input;
      const event = await providerCall("/payment/events", {organizationId:organization, ...fields}, action.key);
      aliases.set(action.entity, event.event.id);
    } else if (action.op === "payment.deliver") {
      const input = resolveRefs(action.input, aliases), before = p.snapshot();
      const batch = await providerCall("/payment/deliveries", {eventIds:input.events, signature:input.signature, retry:input.retry}, action.key);
      if (action.entity) aliases.set(action.entity, batch.batchId);
      if (input.signature !== "valid") {
        const inspected = await tick();
        for (const id of batch.deliveryIds) {
          const attempt = inspected.attempts.find(value => value.deliveryId === id);
          assert.ok(attempt); assert.equal(attempt.status, 403); assert.equal(attempt.error, null); assert.equal(attempt.ack, false);
        }
        assert.equal(p.snapshot(), before, "bad signature changed durable data or work before the next delivery");
        assert.equal(await snapshot(), invalidBaseline, "compare billing and complete audit immediately after each rejection");
      } else if (receiverOnline) await acknowledged(batch.deliveryIds);
      else { backlogIds = batch.deliveryIds; backlogEvents = input.events; }
    } else if (action.op === "harness.control") {
      const {target, command} = action.input;
      if (target === "receiver" && command === "stop") { await host.stop(); receiverOnline = false; }
      else if (target === "provider") {
        const before = await status(); await services.close(); closed = true;
        services = await startServices(configuration); closed = false;
        assert.deepEqual((await status()).deliveries, before.deliveries, "unacknowledged provider journal survives restart");
      } else if (command === "start") {
        host = await p.start({port}); receiverOnline = true; faults = [...action.input.responseFaults];
      } else if (command === "restart-preserving-data") {
        finalSnapshot = await snapshot(); await host.stop(); host = await p.start({port}); assert.equal(await snapshot(), finalSnapshot);
      } else assert.fail(`unexpected canonical control: ${JSON.stringify(action)}`);
    } else if (action.op === "background.checkpoint") {
      if (action.input.kind === "provider-unacknowledged") {
        const inspected = await tick();
        for (const id of backlogIds) {
          const delivery = inspected.deliveries.find(value => value.id === id);
          assert.ok(delivery.attempts >= 1); assert.equal(delivery.ack, false);
        }
      } else {
        if (action.input.requireAllAcknowledged) await acknowledged(backlogIds);
        const inspected = await status(), expectedId = aliases.get(action.input.event.ref);
        const event = inspected.events.find(value => value.event.id === expectedId).event;
        assert.equal((await application()).state.revision, event.revision);
      }
    } else if (action.op === "assert") {
      const check = action.input.check;
      if (check === "billing-snapshot") invalidBaseline = await snapshot();
      else if (check === "rejected-webhook-no-change") assert.equal(await snapshot(), invalidBaseline);
      else if (check === "latest-plan-once") {
        const {state, audit} = await application(); assert.equal(state.plan, "pro"); assert.equal(state.seatLimit, 10); assert.equal(audit.length, 1);
      } else if (check === "past-due-readable") assert.equal((await application()).state.plan, "past_due");
      else if (check === "backlog-restart-durable-ack") {
        const {state, audit} = await application(); assert.equal(state.plan, "pro"); assert.equal(state.seatLimit, 20); assert.equal(state.revision, 6);
        assert.deepEqual(audit.map(value => value.revision).sort((a, b) => a - b), [2, 3, 4, 5, 6]);
        const inspected = await status(); assert.ok(backlogIds.every(id => inspected.deliveries.some(value => value.id === id && value.ack)));
        for (const event of backlogEvents) assert.equal(p.records("handled").filter(value => value.event === event).length, 1);
        assert.equal(await snapshot(), finalSnapshot); assert.equal(refused, 1); assert.equal(dropped, 1);
      } else assert.fail(`unexpected canonical assertion: ${check}`);
    } else assert.fail(`unexpected canonical operation: ${action.op}`);
  }
  assert.equal(p.records("handled").length, 6, "each distinct canonical event runs once despite delivery retries");
  const inspected = await status();
  for (const verification of p.records("verified")) {
    const event = inspected.events.find(value => value.event.id === verification.event);
    assert.equal(verification.hex, Buffer.from(event.bodyBase64, "base64").toString("hex"));
  }
  assert.equal(host.leakedSecret(), false);
  await services.close(); closed = true;
}

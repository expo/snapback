import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api, createClient } from "../dist/client.mjs";
import { emptyItemInputs, withItemInputs } from "../dist/image-runtime.mjs";
import { isRefusalError } from "../dist/client-observed-test.mjs";
import { initialQueryState, reduceQueryState } from "../dist/react-core.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { fakeOwner, seededStore } from "./fake-owner.ts";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const unsupported = { code: "E_OFFLINE_RESUME", family: "offline", guide: "offline", which: "log",
  reason: "unsupported-log", op: "messages.inbox", shape: "descending", site: "/api/resume.log",
  message: "backward log", rewrite: "use after c first 50; keep queued writes" };

test("an incomplete-startup drain never inherits a cached owner continuation", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-startup-drain-"));
  const client: any = createClient({ url: "http://startup-drain.test", persona: "alice",
    fetch: fakeOwner({ seed: true }).fetch,offline: { store: fileRangeStore(root) } });
  try {
    await client.ready;
    const runtime = client.offlineRuntime;
    client.startupComplete = false;
    runtime.drainCursor = () => undefined;
    runtime.answer = async () => ({ op: "messages.inbox",args: { c: null },state: "capped",data: ["owner"],
      next: "owner-page-2",seq: 7,receipt: { ranges: [],absences: [],verdicts: [] } });
    runtime.evaluate = async () => withItemInputs({ state: "partial",reason: "computed-key",site: "project",seq: 7,data: ["local"] },
      { ...emptyItemInputs,selection: { through: 7 } });
    const result = await client.queryInternal(api.messages.inbox,{ c: null },true);
    assert.equal(result.state,"partial");
    assert.equal(result.next,undefined,"a startup drain owns its tail instead of the cached page boundary");
  } finally { await client.close(); await rm(root,{ recursive: true,force: true }); }
});

test("unsupported drain reaches callback and matching waiter; current and later success waiters reject, ordinary query remains valid", async () => {
  let queries = 0;
  const client = createClient({ url: "http://drain-admission.test", persona: "alice", fetch: async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return json({ generation: "g", programGeneration: "p", channels: {}, auth: {},
      ops: { "messages.inbox": { kind: "query", args: { c: { Optional: "Cursor" } }, planHash: "p", drain: { reason: "descending" } } } });
    if (path === "/api/query") { queries++; return json({ state: "capped", data: ["newest"], next: "opaque", seq: 3 }); }
    throw Error(`unexpected ${path}`);
  } });
  const events: any[] = [];
  try {
    await client.ready;
    const sub = subscribe(client, api.messages.inbox as any, { c: null }, event => events.push(event), { drain: true });
    const waiting = assert.rejects(sub.until(event => event.caughtUp === true, 500), (error: any) => error.code === unsupported.code);
    const refused = await sub.until(event => event.state === "refused", 500);
    assert.equal(refused.state, "refused");
    assert.equal((refused as any).shape, "descending");
    await waiting;
    await assert.rejects(sub.until(event => event.caughtUp === true, 500), isRefusalError);
    assert.equal(queries, 0, "refusal precedes pages and a watermark");
    assert.equal(events.length, 1);
    assert.equal((await client.query(api.messages.inbox as any, { c: null })).state, "capped");
    sub.close();
  } finally { await client.close(); }
});

test("legacy backward resume stays refused across offline reopen; coverage, queue, grant and IDs survive; explicit write replay is separate", async () => {
  // Retain the physical test store, including any failure, for inspection.
  const root = await mkdtemp(join(tmpdir(), "s2-drain-admission-"));
  const factory = fileRangeStore(root);
  await seededStore(factory);
  const owner = fakeOwner({ seed: true });
  const requests: any[] = [];
  let refuseResume = false;
  let physical: ReturnType<typeof factory>;
  const options = { url: "http://legacy-drain.test", persona: "alice", offline: { store: () => (physical = factory()) },
    fetch: async (input: any, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/resume") { requests.push(JSON.parse(String(init?.body))); return refuseResume ? json(unsupported, 413) : owner.fetch(input, init); }
      const response = await owner.fetch(input, init);
      if (path === "/api/program") {
        const value = await response.json(); value.programs["messages.inbox"].drain = { reason: "descending" };
        return json(value);
      }
      return response;
    } };
  let client = createClient(options);
  try {
    await client.ready;
    refuseResume = true;
    await client.offline();
    const queued = await client.mutation(api.messages.send as any, { conversationId: "conversation-1", body: "keep me" });
    assert.equal(queued.state, "queued");
    const coverage = await physical!.coverage();
    const entries = await client.outbox.entries();
    const grant = await physical!.outbox.grant();
    const events: any[] = [];
    const sub = subscribe(client, api.messages.inbox as any, { c: null }, event => events.push(event), { drain: true });
    await sub.until(event => event.state === "refused", 500);
    for (let i = 0; i < 2; i++) {
      const count = requests.length;
      await assert.rejects(client.online(), (error: any) => error.envelope.reason === "unsupported-log");
      assert.equal(requests.length, count + 1, "no retry drops the log");
      assert.ok(requests.at(-1).log);
      assert.deepEqual(await physical!.coverage(), coverage);
      assert.deepEqual(await client.outbox.entries(), entries);
      assert.deepEqual(await physical!.outbox.grant(), grant);
    }
    assert.equal(events.at(-1).state, "refused");
    assert.equal(client.snapshot.lastRefusal?.reason, "unsupported-log");
    assert.equal((await client.query(api.messages.inbox as any, { c: null })).state, "complete", "ordinary reads remain legal");
    assert.equal(client.snapshot.lastRefusal?.reason, "unsupported-log", "an ordinary query cannot clear failed synchronization");
    assert.deepEqual(await client.outbox.drain(), { stopped: false, remaining: 0 });
    const committed = await client.outbox.entries();
    assert.equal(committed[0].state, "committed");
    assert.deepEqual(committed[0].ids, entries[0].ids);
    assert.equal(committed[0].intent, entries[0].intent);
    assert.equal(client.snapshot.lastRefusal?.reason, "unsupported-log");
    await assert.rejects(client.online(), isRefusalError);
    sub.close();
    await client.close();
    client = createClient(options);
    await client.ready;
    await client.offline();
    assert.deepEqual((await client.outbox.entries()).map(e => [e.intent, e.ids, e.state]), committed.map(e => [e.intent, e.ids, e.state]));
    const reopened = subscribe(client, api.messages.inbox as any, { c: null }, () => {}, { drain: true });
    assert.equal((await reopened.until(event => event.state === "refused", 500)).state, "refused");
    await assert.rejects(client.online(), isRefusalError);
    reopened.close();
    assert.equal(owner.executions.length, 1);
  } finally { await client.close(); }
});

test("React refusal reduction preserves structured log diagnostics", () => {
  const view = reduceQueryState(initialQueryState(), { state: "refused", live: false, ...unsupported });
  assert.equal(view.state, "refused");
  if (view.state === "refused") for (const field of ["code", "family", "message", "reason", "site", "rewrite", "guide"] as const) {
    assert.equal(view.refusal[field], unsupported[field]);
  }
});

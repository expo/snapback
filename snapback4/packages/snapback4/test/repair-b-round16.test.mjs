// II1: the identical invariant runs against the saved base client/device too.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as tick } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { AdmissionJournal } from "../dist/web-journal.js";

const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const original = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const marker = { kind: "query", name: "marker" };
const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
async function until(check) {
  for (let i = 0; i < 1000; i++) { if (check()) return; await tick(5); }
  assert.fail("watch did not reach the expected state");
}

for (const viaMetadata of [false, true]) for (const fault of ["healthy", "others", "remember", "recover"]) test(`II1: ${viaMetadata ? "metadata" : "data"} replacement with ${fault} post-save recovery`, async t => {
  const failRecovery = fault !== "healthy";
  const persist = memoryPersistence(), save = persist.save, others = persist.others;
  let store = "A", offline = false, core, client, storeName, savedReplacement = false, atFailure;
  const notices = [], acquisition = [], requests = [], clients = [];
  let watch;
  const fail = () => {
    atFailure = { snapshot: structuredClone(watch.getSnapshot()), acquired: client.acquired,
      notices: structuredClone(notices), acquisition: [...acquisition] };
    throw new Error(`II1 injected ${fault} after replacement save`);
  };
  if (["remember", "recover"].includes(fault)) {
    const method = AdmissionJournal.prototype[fault];
    t.mock.method(AdmissionJournal.prototype, fault, function (...args) {
      if (savedReplacement && !atFailure) fail();
      return method.apply(this, args);
    });
  }
  persist.save = async (name, changes) => {
    await save(name, changes);
    if (changes.some(c => c.s === "m" && c.k === "device:store_id" && c.v === "B")) savedReplacement = true;
  };
  persist.others = async prefix => {
    if (fault === "others" && savedReplacement && !atFailure) fail();
    return others(prefix);
  };
  const opener = webDevice({ wasm, persist });
  const fetcher = async (input, init = {}) => {
    if (offline) throw new TypeError("offline");
    const path = new URL(input).pathname;
    if (path === "/schema") return Response.json({ ...original, programs: [...original.programs,
      { name: "marker", kind: "Query", args: {}, body: [{ Return: { Literal: { String: store } } }] }] });
    if (path === "/sync") {
      const request = JSON.parse(init.body); requests.push(request);
      if (request.metadata) return Response.json({ metadata: true, store_id: store, generation: 1, watermark: 10 });
      if (viaMetadata && store === "B" && request.store_id !== "B" && request.from > 0) return Response.json({ denied: {
        code: "E_BOUND", family: "bound", message: "the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values"
      } });
      return Response.json({ snapshot: request.from === 0 && !request.stream, store_id: store,
        generation: 1, events: [], watermark: 10, more: false });
    }
    if (path === "/changes") return new Promise(resolve => {
      const abort = () => resolve(Response.json({ seq: 10, store_id: store }));
      if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
    });
    if (path === "/probe") return Response.json({ ok: true });
    if (path === "/q/marker") return Response.json({ data: store, complete: true, tables: [] });
    assert.fail(`unexpected transport request: ${path}`);
  };
  async function open() {
    client = await createLocalClient({ url: `http://${failRecovery ? "fault" : "control"}.ii1.test`, persona: "alice", fetch: fetcher,
      device: { async open(name, backend) { storeName = name; return core = await opener.open(name, backend); } } });
    clients.push(client);
  }
  t.after(async () => { for (const c of clients) await c.close(); });
  await open();
  watch = client.observe(marker, {});
  watch.subscribe(() => notices.push(structuredClone(watch.getSnapshot())));
  client.onAcquired(value => acquisition.push(value));
  await until(() => watch.getSnapshot().fresh);
  assert.equal(watch.getSnapshot().data, "A");
  assert.equal(client.acquired, true);
  notices.length = 0; acquisition.length = 0;
  store = "B";
  if (failRecovery) await assert.rejects(client.sync(), /II1 injected/);
  else await client.sync();
  const saved = await persist.load(storeName);
  assert.equal(saved.find(c => c.s === "m" && c.k === "device:store_id")?.v, "B");
  assert.equal(savedReplacement, true);
  const state = ok(await core.call({ op: "sync_state", capture: false }));
  assert.equal(state.store_id, "B");
  if (failRecovery) {
    assert.ok(atFailure, "the injected fault actually ran after persistence");
    assert.equal(state.watermark, 0);
    assert.equal(state.acquired, false);
    assert.equal(state.backend_required, true);
  }
  // Complete retry and reopen controls even on a regressing client, then assert
  // the captured pre-retry invariant so the failure cannot mask those controls.
  const failedSnapshot = structuredClone(watch.getSnapshot()), failedAcquired = client.acquired;
  const failedNotices = structuredClone(notices), failedAcquisition = [...acquisition];
  const retryAt = requests.length;
  await client.sync();
  if (failRecovery) {
    assert.equal(requests[retryAt].store_id, "B");
    assert.equal(requests[retryAt].from, 0);
    assert.equal(requests[retryAt].after, null);
  }
  await until(() => watch.getSnapshot().data === "B" && watch.getSnapshot().fresh);
  assert.equal(client.acquired, true);
  await client.close(); offline = true; await open();
  assert.equal((await client.query(marker, {})).data, "B", "offline reopen keeps B");
  assert.equal(client.acquired, true);
  t.diagnostic(JSON.stringify({ fault: failRecovery, state: { store_id: state.store_id, watermark: state.watermark, acquired: state.acquired, backend_required: state.backend_required }, atFailure, failedSnapshot, failedAcquired,
    retry: "B fresh and acquired", reopen: "B acquired offline" }));
  if (failRecovery) {
    assert.notEqual(atFailure.snapshot.data, "A", "replacement must fence A before host recovery can throw");
    assert.equal(atFailure.acquired, false);
    // Internal state is fenced at the save; application delivery follows the
    // host's unwind, before sync rejects, and cannot reenter journal bookkeeping.
    assert.deepEqual(failedNotices[0], { loading: true });
    assert.deepEqual(failedAcquisition, [false]);
    assert.notEqual(failedSnapshot.data, "A");
    assert.equal(failedAcquired, false);
  }
});

test("durable reply hook excludes failed saves and runs once for successful calls", async t => {
  const persist = memoryPersistence(), save = persist.save;
  const core = await webDevice({ wasm, persist }).open("commit-hook", original);
  t.after(() => core.close());
  let failSave = true, calls = 0;
  persist.save = async (...args) => {
    if (failSave) { failSave = false; throw new Error("save aborted before commit"); }
    return save(...args);
  };
  const request = { op: "set_meta", key: "hook", value: "durable" };
  const committed = reply => { ok(reply); calls++; };
  await assert.rejects(core.call(request, committed), /save aborted before commit/);
  assert.equal(calls, 0);
  assert.equal(ok(await core.call({ op: "meta", key: "hook" })), null);
  ok(await core.call(request, committed));
  assert.equal(calls, 1);
  assert.equal(ok(await core.call({ op: "meta", key: "hook" }, committed)), "durable");
  assert.equal(calls, 2, "a reply without a new save is still observable exactly once");
});

// @ref LLP 3000#explicit-sync-after-call — explicit callers share a newer round.
import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as turn } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { syncControl, parkedChanges } from "./helpers/sync-control.mjs";

// A custom handle isolates scheduling from storage; history/asset tests exercise
// the same public method with real wasm and process devices and server commits.
async function fixture(t) {
  const backend = { generation: 1, schema: { tables: {} }, programs: [] };
  let watermark = 0, head = 0, fail, applying, changes;
  const poll = Promise.withResolvers();
  const core = {
    async call({ op, key, page }) {
      if (op === "sync_state") return { ok: { acquired: true, backend_required: false, store_id: null, watermark, generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, receipt_outcomes: true, outbox_status: true, adoption_capture: {}, pending_ids: [] } };
      if (op === "state") return { ok: { watermark, generation: 1, native: null } };
      if (op === "backend") return { ok: backend };
      if (op === "meta") return { ok: null };
      if (op === "queued") return { ok: [] };
      if (op === "apply") { await applying?.(); watermark = page.watermark; return { ok: { touched: [] } }; }
      return { ok: true };
    },
    async close() {},
  };
  const control = syncControl(t, async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/schema") return Response.json(backend);
    if (path === "/sync") {
      const failure = await fail?.();
      if (failure) return failure;
      return Response.json({ snapshot: false, events: [], watermark: head, more: false, generation: 1, acknowledged: {} });
    }
    if (path === "/changes") {
      if (changes) return parkedChanges(init.signal);
      changes = Promise.withResolvers(); poll.resolve();
      const abort = () => changes.reject(init.signal.reason);
      init.signal.addEventListener("abort", abort, { once: true });
      try { return await changes.promise; }
      finally { init.signal.removeEventListener("abort", abort); }
    }
    throw Error(`unexpected route ${path}`);
  });
  const client = await createLocalClient({ url: "https://sync.invalid", persona: "alice", device: { open: async () => core }, fetch: control.fetch });
  t.after(() => client.close());
  await poll.promise;
  return { client, control, commit() { head++; }, get watermark() { return watermark; },
    wake() { changes.resolve(Response.json({ seq: head, tables: [] })); },
    fail(fn) { fail = fn; }, apply(fn) { applying = fn; } };
}

test("ten explicit calls during one round share exactly one follow-up", { timeout: 5000 }, async t => {
  const f = await fixture(t), before = f.control.attempts;
  const old = f.control.hold(), first = f.client.sync(); await old.ready;
  f.commit();
  const next = f.control.hold();
  let settled = 0;
  const burst = Array.from({ length: 10 }, () => f.client.sync().then(() => { settled++; }));
  old.release(); await first; await turn();
  assert.equal(settled, 0, "no explicit caller resolves with the older response");
  await next.ready;
  assert.equal(f.control.attempts - before, 2);
  next.release(); await Promise.all(burst); await turn();
  assert.equal(f.watermark, 1);
  assert.equal(f.control.attempts - before, 2, "the burst costs only one extra round");
});

test("a call during the follow-up waits for its own newer round", { timeout: 5000 }, async t => {
  const f = await fixture(t), before = f.control.attempts;
  const old = f.control.hold(), first = f.client.sync(); await old.ready;
  const next = f.control.hold(), second = f.client.sync(); old.release(); await first;
  await turn(); assert.equal(f.control.attempts - before, 2);
  await next.ready; f.commit();
  const third = f.client.sync(); next.release(); await Promise.all([second, third]);
  assert.equal(f.watermark, 1);
  assert.equal(f.control.attempts - before, 3);
});

test("a wake-driven round is not doubled", { timeout: 5000 }, async t => {
  const f = await fixture(t), before = f.control.attempts;
  f.commit(); const wake = f.control.hold(); f.wake(); await wake.ready;
  wake.release(); await turn(); await turn();
  assert.equal(f.watermark, 1);
  assert.equal(f.control.attempts - before, 1);
});

test("explicit sync during a held wake-driven round observes the newer head", { timeout: 5000 }, async t => {
  const f = await fixture(t), before = f.control.attempts;
  f.commit(); const old = f.control.hold(); f.wake(); await old.ready;
  f.commit();
  const next = f.control.hold();
  let settled = false;
  const explicit = f.client.sync();
  void explicit.then(() => { settled = true; }, () => { settled = true; });
  old.release(); await turn();
  assert.equal(f.control.attempts - before, 2, "the background round requires an explicit follow-up");
  assert.equal(settled, false, "the older background response cannot complete this call");
  await next.ready;
  assert.equal(f.watermark, 1, "only the older head has been applied while the follow-up is held");
  next.release();
  assert.equal(await explicit, undefined);
  assert.equal(f.watermark, 2, "sync observes the commit made after the background response was rendered");
  assert.equal(f.client.link(), "online");
  assert.equal(f.control.attempts - before, 2);
});

test("a wake during an explicit round coalesces without an extra round", { timeout: 5000 }, async t => {
  const f = await fixture(t), before = f.control.attempts;
  f.commit(); const old = f.control.hold(), first = f.client.sync(); await old.ready;
  f.wake(); await turn(); old.release(); await first; await turn();
  assert.equal(f.control.attempts - before, 1);
});

for (const failure of ["offline fetch", "device rejection"]) test(`explicit sync waits for the follow-up's ${failure}`, { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  const f = await fixture(t), before = f.control.attempts;
  const old = f.control.hold(), first = f.client.sync(); await old.ready;
  let settled = false;
  const explicit = f.client.sync();
  void explicit.then(() => { settled = true; }, () => { settled = true; });
  if (failure === "offline fetch") f.fail(async () => { entered.resolve(); await release.promise; throw Error("offline"); });
  old.release(); await first;
  if (failure === "device rejection") f.apply(async () => { entered.resolve(); await release.promise; throw Error("device unavailable"); });
  await turn();
  assert.equal(settled, false, "the old successful response cannot complete this call");
  await entered.promise;
  assert.equal(f.control.attempts - before, 2);
  release.resolve();
  if (failure === "offline fetch") {
    assert.equal(await explicit, undefined);
    assert.equal(f.client.link(), "offline");
  } else await assert.rejects(explicit, /device unavailable/);
});

for (const failure of ["network error", "HTTP 500"]) test(`an older round returning false after ${failure} cannot skip the explicit follow-up`, { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  const f = await fixture(t), before = f.control.attempts;
  f.fail(async () => {
    f.fail(undefined);
    entered.resolve(); await release.promise;
    if (failure === "network error") throw Error("old round offline");
    return new Response(null, { status: 500 });
  });
  const first = f.client.sync(); await entered.promise;
  f.commit();
  const next = f.control.hold();
  let settled = false;
  const explicit = f.client.sync();
  void explicit.then(() => { settled = true; }, () => { settled = true; });
  release.resolve();
  assert.equal(await first, undefined, "the older transport failure fulfills instead of rejecting");
  await turn();
  assert.equal(f.control.attempts - before, 2, "the older false result still requires a follow-up attempt");
  assert.equal(settled, false, "explicit sync waits for the follow-up's result");
  await next.ready;
  assert.equal(f.watermark, 0, "the failed round applied no page");
  assert.equal(f.client.link(), "offline");
  next.release();
  assert.equal(await explicit, undefined);
  assert.equal(f.watermark, 1, "the follow-up applies the new server head");
  assert.equal(f.client.link(), "online", "the follow-up's success owns the link state");
  assert.equal(f.control.attempts - before, 2);
});

test("a failed older round cannot skip the explicit follow-up attempt", { timeout: 5000 }, async t => {
  const f = await fixture(t), before = f.control.attempts;
  const old = f.control.hold(), first = f.client.sync(); await old.ready;
  const failure = assert.rejects(first, /old device failure/);
  f.apply(() => { f.apply(undefined); throw Error("old device failure"); });
  const explicit = f.client.sync(); old.release();
  await failure; await explicit;
  assert.equal(f.control.attempts - before, 2);
});

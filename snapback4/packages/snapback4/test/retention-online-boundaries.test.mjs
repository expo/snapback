// @ref LLP 3000.029#2 — discovery/store invalidate; link loss alone revalidates.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { answerObservation } from "../dist/read-observation.js";
import { episodeDeadline } from "../dist/read-episode.js";

const q = { kind: "query", name: "read" };
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
async function until(check) {
  for (let n = 0; n < 500; n++) { if (check()) return; await delay(2); }
  assert.fail("online boundary did not settle");
}

for (const keep of [undefined, true]) test(`schema discovery withdraws an overlapping invalidation: keep=${keep}`, async t => {
  let wall = 1000, reads = 0, polls = 0, discovering = false;
  t.mock.method(Date, "now", () => wall);
  const invalidate = Promise.withResolvers(), advertise = Promise.withResolvers();
  const client = createClient({ url: "http://discovery.test", persona: "alice", fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/schema") { discovering = true; return parked(init.signal); }
    if (path === "/changes") {
      const poll = ++polls;
      if (poll > 2) return parked(init.signal);
      await (poll === 1 ? invalidate : advertise).promise;
      return Response.json({ seq: 2, generation: 1, tables: ["private"] },
        poll === 2 ? { headers: { "x-snapback-ephemeral": "1" } } : undefined);
    }
    assert.equal(path, "/q/read");
    if (++reads > 1) return parked(init.signal);
    return Response.json({ data: ["private A"], complete: true, seq: 1, tables: ["private"], nextExpiry: 10_000 });
  } });
  t.after(async () => { invalidate.resolve(); advertise.resolve(); await client.close(); });
  const watch = client.observe(q, {}, keep === undefined ? undefined : { keep });
  await until(() => watch.getSnapshot().data);
  const owner = answerObservation(watch.getSnapshot());
  invalidate.resolve();
  await until(() => watch.getSnapshot().loading && reads > 1);
  assert.equal(episodeDeadline(watch.getSnapshot()), undefined);
  wall = 1500; advertise.resolve();
  await until(() => discovering);
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "discovery withdraws instead of copying away the episode");
  assert.equal(owner.deadlines?.server ?? null, null, "the withdrawn row has no deadline left armed");
  assert.equal(owner.expiryTimer, null);
  wall = 3000; owner.reload(); owner.reload();
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "discovery never renews or removes a cap while keeping A");
});

for (const keep of [undefined, false, true]) for (const invalidated of [false, true]) {
  test(`online link loss respects a live ${invalidated ? "invalidated" : "settled"} answer, keep=${keep}`, async t => {
    t.mock.method(Date, "now", () => 1000); // The episode cannot expire and mask a broken offline withdrawal.
    const invalidate = Promise.withResolvers(), loss = Promise.withResolvers();
    let polls = 0, reads = 0;
    const client = createClient({ url: "http://link-loss.test", persona: "alice", fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/changes") {
        if (++polls === 1 && invalidated) {
          await invalidate.promise;
          return Response.json({ seq: 2, generation: 1, tables: ["private"] });
        }
        await loss.promise; throw Error("link lost");
      }
      if (path === "/probe") return parked(init.signal);
      assert.equal(path, "/q/read");
      if (++reads > 1) return parked(init.signal);
      return Response.json({ data: ["private A"], complete: true, seq: 1, tables: ["private"] });
    } });
    t.after(async () => { invalidate.resolve(); loss.resolve(); await client.close(); });
    const options = keep === undefined ? undefined : { keep }, watch = client.observe(q, {}, options), seen = [];
    watch.subscribe(() => seen.push(watch.getSnapshot()));
    await until(() => watch.getSnapshot().data);
    if (invalidated) {
      invalidate.resolve(); await until(() => reads > 1 && polls > 1);
      assert.deepEqual(watch.getSnapshot(), { loading: true });
    }
    seen.length = 0; loss.resolve();
    await until(() => client.link() === "offline");
    const loading = watch.getSnapshot();
    if (invalidated || keep === false) assert.deepEqual(loading, { loading: true });
    else { assert.deepEqual(loading.data, ["private A"]); assert.equal(loading.revalidating, true); assert.equal(loading.fresh, false); }
    assert.equal(watch.getSnapshot(), loading);
    if (!invalidated) assert.ok(seen.length > 0, "offline transition notifies");
  });
}

// A withheld revalidation may report different inputs, but it cannot replace
// the disclosure dependencies of the still-displayed answer.
test("unavailable presence sampling retains the original authorization dependencies", async t => {
  const changed = Promise.withResolvers();
  let reads = 0, polls = 0;
  const client = createClient({ url: "http://retained-inputs.test", persona: "alice", fetch: async (input, init) => {
    if (new URL(input).pathname === "/changes") {
      if (++polls > 1) return parked(init.signal);
      await changed.promise;
      return Response.json({ seq: 2, generation: 1, tables: ["members"] });
    }
    if (new URL(input).pathname === "/probe") return parked(init.signal);
    reads++;
    return Response.json(reads === 1
      ? { data: "private answer", complete: true, seq: 1, tables: ["members"], refresh: 250 }
      : { loading: true, seq: 2, tables: ["other"], refresh: 250 });
  } });
  const watch = client.observe(q, {});
  t.after(async () => { changed.resolve(); await client.close(); });
  await until(() => reads >= 2 && watch.getSnapshot().revalidating);
  assert.equal(watch.getSnapshot().data, "private answer");
  changed.resolve();
  await until(() => watch.getSnapshot().loading);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
});

for (const keep of [undefined, false, true]) test(`a direct transport refusal is not authority invalidation, keep=${keep}`, async t => {
  let reads = 0;
  const client = createClient({ url: "http://direct-offline.test", persona: "alice", fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/changes" || path === "/probe") return parked(init.signal);
    assert.equal(path, "/q/read");
    if (++reads > 1) throw Error("network unavailable");
    return Response.json({ data: ["still authorized"], complete: true, seq: 1, tables: ["private"] });
  } });
  t.after(() => client.close());
  const watch = client.observe(q, {}, { keep });
  await until(() => watch.getSnapshot().data);
  assert.equal((await client.query(q, {})).denied.code, "E_OFFLINE");
  const read = watch.getSnapshot();
  if (keep === false) assert.deepEqual(read, { loading: true });
  else { assert.deepEqual(read.data, ["still authorized"]); assert.equal(read.revalidating, true); assert.equal(read.fresh, false); }
});

for (const outcome of [{ denied: { code: "NOT_MEMBER", family: "rule", message: "removed" } }, { data: null }, { data: [] }]) {
  test(`a direct authoritative ${"denied" in outcome ? "refusal" : JSON.stringify(outcome.data)} withdraws its mounted peer`, async t => {
    let reads = 0;
    const client = createClient({ url: "http://direct-evidence.test", persona: "alice", fetch: async (input, init) => {
      if (new URL(input).pathname === "/changes") return parked(init.signal);
      return Response.json({ ...(++reads === 1 ? { data: ["private"] } : outcome), complete: true, seq: reads, tables: ["private"] });
    } });
    t.after(() => client.close());
    const watch = client.observe(q, {});
    await until(() => watch.getSnapshot().data);
    await client.query(q, {});
    const read = watch.getSnapshot();
    if ("denied" in outcome) assert.equal(read.denied.code, "NOT_MEMBER");
    else assert.deepEqual(read.data, outcome.data);
    assert.equal(read.revalidating, undefined);
  });
}

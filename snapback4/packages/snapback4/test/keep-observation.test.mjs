import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { ReadObservation } from "../dist/read-observation.js";
import { LocalReads } from "../dist/local-reads.js";
import { KeptAnswers } from "../dist/kept-answers.js";
import { guardClient } from "../dist/app-client.js";
import { createClient } from "../dist/client.js";
const ready = data => ({ data, complete: true, cut: null, fresh: true, next: null });
const why = { code: "HIDDEN", family: "rule", message: "no longer visible" };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) { for (let i = 0; i < 600; i++) { if (check()) return; await delay(5); } assert.fail("read did not settle"); }
const q = { kind: "query", name: "secret" };

for (const op of ["apply", "admit", "settle", "clear_rows", "settle_exit", "adopt", "observe_store"]) {
  test(`local keep: ${op} fences in-flight answers and ${["apply", "admit", "settle"].includes(op) ? "keeps" : "drops"} active and idle data`, async () => {
    const reads = new LocalReads(), held = deferred();
    const keep = Object.assign(new ReadObservation(true), { expiryTimer: null, presenceRefresh: null });
    const plain = Object.assign(new ReadObservation(), { expiryTimer: null, presenceRefresh: null });
    keep.publish(ready("before")); plain.publish(ready("before"));
    reads.keptAnswers.put("viewer/store/idle", ready("idle"));
    const work = keep.fetch(() => held.promise, () => {});
    if (["adopt", "observe_store"].includes(op)) reads.clear([keep, plain]);
    else reads.committed([keep, plain], op);
    const retained = ["apply", "admit", "settle"].includes(op);
    assert.equal("data" in keep.snapshot, retained);
    if (retained) { assert.equal(keep.snapshot.fresh, false); assert.ok(Number.isFinite(keep.snapshot.since)); }
    assert.equal(!!reads.keptAnswers.take("viewer/store/idle"), retained);
    assert.deepEqual(plain.snapshot, { loading: true });
    held.resolve({ read: ready("obsolete") }); await work;
    assert.notEqual(keep.snapshot.data, "obsolete", "old evaluation cannot republish across any commit or reset");
    keep.publish({ denied: why });
    assert.deepEqual(keep.snapshot, { denied: why }, "a refusal replaces a kept answer");
    reads.keptAnswers.clear();
  });
}

test("keep carries the original since across loading, then accepts null, empty data and refusal", async () => {
  const watch = new ReadObservation(true), values = [];
  watch.publish({ ...ready(["old"]), fresh: false, since: Date.now() - 60_000 });
  const since = watch.snapshot.since;
  for (const read of [{ loading: true }, { loading: true }, ready(null), ready([]), { denied: why }]) {
    await watch.fetch(async () => ({ read }), () => values.push(watch.snapshot));
    if ("loading" in read) { assert.equal(watch.snapshot.since, since); assert.deepEqual(watch.snapshot.data, ["old"]); }
    else assert.deepEqual(watch.snapshot, read);
  }
  assert.ok(values.every(read => !("loading" in read)));
  watch.reset({ loading: true }); assert.deepEqual(watch.snapshot, { loading: true });
});

test("idle answers are actually released by the 30-second timer", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const memory = new KeptAnswers();
  memory.put("key", ready("old"));
  t.mock.timers.tick(30_000);
  // Moving wall time back proves the timer removed the entry, not just take's deadline check.
  t.mock.timers.setTime(1000);
  assert.equal(memory.take("key"), undefined);
});

async function online(t) {
  const polls = [], releases = [];
  let seq = 10, generation = 1, store = "A", holding = false, answer = "private", reads = 0;
  const session = { token: "old", principal: "alice", expiresAt: Date.now() + 90 * 86400000 };
  let nextPrincipal = "alice";
  const client = createClient({ url: "http://keep.test", session, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    const head = { seq, generation, store_id: store, tables: ["secrets"] };
    if (path === "/schema") return Response.json({ generation, schema: { tables: {} }, programs: [] });
    if (path === "/changes") {
      const next = deferred(); polls.push(next);
      init.signal.addEventListener("abort", () => next.resolve(head), { once: true });
      return Response.json(await next.promise);
    }
    if (path === "/probe") return Response.json({ ok: true, ...head });
    if (path === "/auth/refresh") return Response.json({ ok: true, session: { ...session, token: "new", principal: nextPrincipal } });
    if (path === "/auth/logout") return Response.json({ ok: true });
    if (path.startsWith("/m/")) return Response.json({ state: "sent", id: JSON.parse(init.body).id, seq: ++seq, store_id: store });
    if (path.startsWith("/q/")) {
      reads++;
      const result = answer === "denied" ? { denied: why, ...head } : { ...ready(answer), ...head };
      if (holding) { const release = deferred(); releases.push(release); await release.promise; }
      return Response.json(result);
    }
    throw Error(path);
  } });
  t.after(async () => { for (const release of releases) release.resolve(); await client.close(); });
  const live = client.observe(q, {}, { keep: true }); live.subscribe(() => {});
  const idle = client.observe(q, { idle: true }, { keep: true });
  await until(() => live.getSnapshot().data === "private" && idle.getSnapshot().data === "private" && polls.length);
  // Establish the poll's generation before testing a later adoption.
  polls.shift().resolve({ seq, generation, store_id: store, tables: [] });
  await until(() => polls.length);
  idle.close();
  return { client, live, polls, releases, reads: () => reads,
    hold: value => { holding = value; }, answer: value => { answer = value; },
    principal: value => { nextPrincipal = value; },
    async change(patch = {}) {
      const head = { seq: ++seq, generation, store_id: store, tables: ["secrets"], ...patch };
      generation = head.generation; store = head.store_id;
      await until(() => polls.length);
      polls.shift().resolve(head);
    },
  };
}

for (const trigger of ["mutation", "notification"]) for (const outcome of ["next", "denied"]) test(`online keep: ${trigger} waits without loading, then publishes ${outcome}`, async t => {
  const f = await online(t), values = [];
  f.live.subscribe(() => values.push(f.live.getSnapshot()));
  f.hold(true); f.answer(outcome);
  const before = f.reads();
  if (trigger === "mutation") await f.client.mutate({ kind: "mutation", name: "edit" }, {});
  else await f.change();
  await until(() => f.reads() > before);
  assert.equal(f.live.getSnapshot().data, "private", "revoked/changed answer stays until the replacement read lands");
  assert.equal(f.live.getSnapshot().fresh, false);
  assert.ok(Number.isFinite(f.live.getSnapshot().since));
  // An ordinary notification must not evict idle opt-in answers either.
  const remount = f.client.observe(q, { idle: true }, { keep: true });
  assert.equal(remount.getSnapshot().data, "private"); remount.close();
  f.hold(false); for (const release of f.releases) release.resolve();
  await until(() => outcome === "denied" ? f.live.getSnapshot().denied?.code === why.code : f.live.getSnapshot().data === "next");
  assert.ok(values.every(read => !("loading" in read)), JSON.stringify(values));
});

for (const reset of ["adoption", "replacement", "regression", "credentials", "viewer", "sign-out", "close"]) test(`online keep: ${reset} clears active and idle answers`, async t => {
  const f = await online(t);
  f.hold(true);
  let ending;
  if (reset === "adoption") await f.change({ generation: 2 });
  if (reset === "replacement") await f.change({ store_id: "B" });
  if (reset === "regression") await f.change({ seq: 1 });
  if (reset === "credentials" || reset === "viewer") {
    if (reset === "viewer") f.principal("bob");
    ending = f.client.refreshSession();
  }
  if (reset === "sign-out") ending = f.client.signOut();
  if (reset === "close") ending = f.client.close();
  await until(() => !("data" in f.live.getSnapshot()));
  const remount = f.client.observe(q, { idle: true }, { keep: true });
  assert.ok(!("data" in remount.getSnapshot()), "the reset also retired idle memory");
  f.hold(false); for (const release of f.releases) release.resolve();
  if (ending) await ending;
  if (["replacement", "regression", "viewer", "sign-out", "close"].includes(reset)) assert.ok(!("data" in f.live.getSnapshot()), "late replies cannot restore a revoked lifetime");
});

test("online keep: an in-flight answer read before a newer commit never replaces the kept answer", async t => {
  const f = await online(t), values = [];
  f.live.subscribe(() => values.push(f.live.getSnapshot()));
  f.answer("obsolete"); f.hold(true);
  await f.client.mutate({ kind: "mutation", name: "edit" }, {});
  await until(() => f.releases.length > 0);
  f.answer("current");
  await f.client.mutate({ kind: "mutation", name: "edit" }, {});
  assert.equal(f.live.getSnapshot().data, "private");
  f.hold(false); for (const release of f.releases) release.resolve();
  await until(() => f.live.getSnapshot().data === "current");
  assert.ok(values.every(read => read.data !== "obsolete" && !("loading" in read)), JSON.stringify(values));
});


test("the app client forwards keep while its lifetime fence still withdraws data", async t => {
  const f = await online(t);
  const facade = guardClient(f.client, async () => true, () => true, () => why);
  const watch = facade.client.observe(q, {}, { keep: true });
  await until(() => watch.getSnapshot().data === "private");
  f.hold(true); f.answer("next");
  await f.client.mutate({ kind: "mutation", name: "edit" }, {});
  await until(() => f.releases.length > 0 && watch.getSnapshot().fresh === false);
  assert.equal(watch.getSnapshot().data, "private");
  const notify = facade.fence(); notify();
  assert.deepEqual(watch.getSnapshot(), { denied: why });
  f.hold(false); for (const release of f.releases) release.resolve();
  await delay(10);
  assert.deepEqual(watch.getSnapshot(), { denied: why });
});

test("online keep preserves the existing expiry withdrawal before a held refetch", async t => {
  const held = deferred(); let reads = 0;
  const client = createClient({ url: "http://keep-expiry.test", persona: "alice", fetch: async (input, init) => {
    if (new URL(input).pathname === "/changes") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
    if (new URL(input).pathname === "/schema") return Response.json({ schema: { tables: {} }, programs: [] });
    if (++reads === 1) return Response.json({ ...ready("expires"), nextExpiry: Date.now() + 100 });
    await held.promise; return Response.json(ready(null));
  } });
  t.after(async () => { held.resolve(); await client.close(); });
  const watch = client.observe(q, {}, { keep: true });
  await until(() => watch.getSnapshot().data === "expires");
  await until(() => reads === 2);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  held.resolve(); await until(() => watch.getSnapshot().data === null);
});

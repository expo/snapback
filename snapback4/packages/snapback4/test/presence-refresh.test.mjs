// LLP 3000.018 §3: an answer of a query that may read presence asks its client
// to re-run it. The online client refreshes in the background after the
// interval its server named, and publishes only an answer nothing replaced
// meanwhile; an answer that reads no presence, or a closed watch, never re-runs.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { PRESENCE_REFRESH_FLOOR_MS, presenceRefresh } from "../dist/presence-refresh.js";
import { ReadObservation } from "../dist/read-observation.js";

const query = { kind: "query", name: "presenceOf" };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const blocked = signal => new Promise((_, reject) => { if (signal.aborted) reject(Error("closed")); else signal.addEventListener("abort", () => reject(Error("closed")), { once: true }); });
async function until(check, why, ms = 3000) { const start = Date.now(); while (Date.now() - start < ms) { if (check()) return; await delay(10); } assert.fail(why); }

function transport(answers, changes = signal => blocked(signal)) {
  const reads = [];
  const client = createClient({ url: "http://presence.test", persona: "alice", fetch: async (url, init) => {
    if (url.includes("/changes")) return changes(init.signal);
    if (!url.includes("/q/")) return Response.json({ ok: true });
    reads.push(Date.now());
    const answer = await answers(reads.length);
    return answer instanceof Response ? answer : Response.json(answer);
  } });
  return { client, reads };
}
const data = (value, refresh = 300, seq = 1) => ({ data: value, complete: true, seq, tables: [], ...(refresh ? { refresh } : {}) });

test("a presence answer re-runs in the background after its server's interval, never showing loading", async t => {
  const { client, reads } = transport(n => data({ online: n > 1 }));
  const mark = client.observe(query, { p: "dev:bob" });
  t.after(async () => { mark.close(); await client.close(); });
  await until(() => mark.getSnapshot().data?.online === false, "the first answer arrived");
  const seen = [];
  const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
  await until(() => mark.getSnapshot().data?.online === true, "the refresh turned the mark");
  stop();
  assert.ok(reads[1] - reads[0] >= 280, `re-ran after ${reads[1] - reads[0]} ms, before the interval`);
  assert.ok(seen.length > 0 && seen.every(read => "data" in read), `the refresh published something other than an answer: ${JSON.stringify(seen)}`);
});

test("unguarded background refresh reports a newly accepted delivery coordinate with changes held", async t => {
  const reports = [];
  let queries = 0;
  const client = createClient({ url: "http://presence-delivery.test", persona: "alice", fetch: async (url, init) => {
    if (url.includes("/changes")) return blocked(init.signal);
    if (url.includes("/m/delivered")) {
      reports.push(JSON.parse(init.body));
      return Response.json({ state: "sent", head: 1, seq: 1, store_id: "S" });
    }
    if (url.includes("/q/")) {
      const first = ++queries === 1;
      return Response.json({ ...data(first ? [] : [{ text: "new row" }], first ? 250 : 0), store_id: "S",
        delivery: first ? [] : [{ table: "messages", mutation: "delivered", args: ["conversation", "from", "through"],
          fingerprint: "fixture:messages", rows: [["c", 47]] }] });
    }
    return Response.json({ ok: true });
  } });
  const watch = client.observe(query, {});
  t.after(async () => { watch.close(); await client.close(); });
  await until(() => watch.getSnapshot().data?.length === 0, "initial answer is empty");
  assert.deepEqual(reports, []);
  await until(() => watch.getSnapshot().data?.length === 1, "background answer is accepted");
  await until(() => reports.length === 1, "accepted background coordinate is reported");
  assert.equal(queries, 2);
  assert.deepEqual(reports.map(report => report.args), [{ conversation: "c", from: 47, through: 47 }]);
});

test("an answer that reads no presence does not re-run, a successful one without refresh stops it, and a closed watch stops", async t => {
  const plain = transport(() => data(1, 0));
  const quiet = plain.client.observe(query, {});
  await until(() => quiet.getSnapshot().data === 1, "the plain answer arrived");
  await delay(600);
  assert.equal(plain.reads.length, 1, "no refresh without presence");
  quiet.close(); await plain.client.close();
  const ends = transport(n => data(n, n === 1 ? 300 : 0));
  const once = ends.client.observe(query, { p: "dev:bob" });
  await until(() => ends.reads.length >= 2, "the first refresh ran");
  await delay(800);
  assert.equal(ends.reads.length, 2, "a successful answer without refresh ends the refresh");
  once.close(); await ends.client.close();
  const live = transport(() => data(1, 1));
  const mark = live.client.observe(query, { p: "dev:bob" });
  await until(() => live.reads.length >= 2, "the refresh ran");
  assert.ok(live.reads[1] - live.reads[0] >= PRESENCE_REFRESH_FLOOR_MS - 20, "the client floors the interval");
  mark.close();
  const after = live.reads.length;
  await delay(PRESENCE_REFRESH_FLOOR_MS * 3);
  assert.ok(live.reads.length <= after + 1, `a closed watch kept refreshing: ${live.reads.length - after} more`);
  await live.client.close();
});

test("a refresh that fails keeps the interval, and a refused presence query keeps refreshing", async t => {
  const refused = { denied: { code: "NOT_HERE", family: "rule", message: "not here" }, refresh: 300 };
  const { client } = transport(n => n === 1 ? refused : n === 2 ? new Response("unavailable", { status: 503 }) : n === 3 ? refused : data({ online: true }));
  const mark = client.observe(query, { p: "dev:bob" });
  t.after(async () => { mark.close(); await client.close(); });
  await until(() => mark.getSnapshot().denied?.code === "NOT_HERE", "the first answer is the refusal");
  await until(() => mark.getSnapshot().data?.online === true, "a refused, then failed, then refused query kept refreshing until it answered", 6000);
});

test("an invalidation during a background refresh withdraws at once, and the late refresh is discarded", async t => {
  const held = deferred(), invalidate = deferred();
  let polls = 0;
  const { client } = transport(async n => {
    if (n === 1) return data("v1");
    // Both later answers are current for the invalidation at seq 2: only the fence can discard v2.
    if (n === 2) { await held.promise; return data("v2", 300, 2); }
    return data("v3", 300, 2);
  }, async signal => (++polls === 1 ? (await invalidate.promise, Response.json({ seq: 2, tables: [], generation: 0 })) : blocked(signal)));
  const mark = client.observe(query, { p: "dev:bob" }, { keep: false });
  t.after(async () => { held.resolve(); mark.close(); await client.close(); });
  await until(() => mark.getSnapshot().data === "v1", "the first answer arrived");
  const seen = [];
  const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
  await delay(400); // the background refresh is now held
  invalidate.resolve();
  await until(() => mark.getSnapshot().data === "v3", "the invalidation re-ran the watch");
  held.resolve();
  await delay(100);
  stop();
  assert.equal(mark.getSnapshot().data, "v3", "the late background answer did not replace a newer one");
  assert.ok(seen.some(read => "loading" in read), "the invalidation withdrew the answer at once, as before");
  assert.ok(!seen.some(read => read.data === "v2"), `the late background answer was published: ${JSON.stringify(seen)}`);
});

test("an interval a timer cannot hold is clamped, not wrapped to an immediate refresh", async () => {
  let fired = 0;
  const timer = presenceRefresh(null, 2 ** 31, () => fired++);
  await delay(100);
  clearTimeout(timer);
  assert.equal(fired, 0);
});

test("a background reply that a newer read overtook leaves the newer interval alone", async t => {
  const held = deferred(), invalidate = deferred();
  let polls = 0;
  const { client, reads } = transport(async n => {
    if (n === 1) return data("v1");
    if (n === 2) { await held.promise; return data("v2", 0, 2); } // overtaken, and says no refresh
    return data(`v${n}`, 250, 2);
  }, async signal => (++polls === 1 ? (await invalidate.promise, Response.json({ seq: 2, tables: [], generation: 0 })) : blocked(signal)));
  const mark = client.observe(query, { p: "dev:bob" });
  t.after(async () => { held.resolve(); mark.close(); await client.close(); });
  await until(() => mark.getSnapshot().data === "v1", "the first answer arrived");
  await delay(400); // the background refresh is held
  invalidate.resolve();
  await until(() => mark.getSnapshot().data === "v3", "the invalidation re-ran the watch");
  held.resolve();
  const settled = reads.length;
  await until(() => reads.length >= settled + 1, "the newer interval still refreshes after the overtaken reply lands", 2000);
  assert.notEqual(mark.getSnapshot().data, "v2");
});

test("an unavailable revalidation and a background failure keep the answer and the link", async t => {
  const loading = transport(n => n === 1 ? data("v1") : { loading: true, seq: 1, tables: [], refresh: 300 });
  const a = loading.client.observe(query, { p: "dev:bob" });
  t.after(async () => { a.close(); await loading.client.close(); });
  await until(() => a.getSnapshot().data === "v1", "the first answer arrived");
  await until(() => a.getSnapshot().revalidating === true, "the unavailable replacement retains its original answer");
  assert.equal(a.getSnapshot().data, "v1");
  a.close(); await loading.client.close();
  const failing = transport(n => n === 1 ? data("v1") : n === 2 ? new Response("unavailable", { status: 503 }) : data("v3"));
  const b = failing.client.observe(query, { p: "dev:bob" });
  t.after(async () => { b.close(); await failing.client.close(); });
  await until(() => b.getSnapshot().data === "v1", "the first answer arrived");
  const seen = [];
  const stop = b.subscribe(() => seen.push(b.getSnapshot()));
  await until(() => failing.reads.length >= 2, "the background refresh failed");
  await delay(50);
  assert.equal(b.getSnapshot().data, "v1", "a failed background refresh keeps the answer on screen");
  assert.equal(failing.client.link(), "online", "a failed background refresh says nothing about the link");
  await until(() => b.getSnapshot().data === "v3", "the refresh retried at its interval");
  stop();
  assert.ok(seen.every(read => "data" in read), `the failure published something other than an answer: ${JSON.stringify(seen)}`);
});

test("a background reply older than a commit the client observed is not published", async t => {
  const held = deferred(), observed = deferred();
  let polls = 0;
  // The watch reads table t; the commit at seq 2 touches only table u, so nothing re-runs the watch.
  const read = (value, seq) => ({ data: value, complete: true, seq, tables: ["t"], refresh: 300 });
  const { client, reads } = transport(async n => {
    if (n === 1) return read("v1", 1);
    if (n === 2) { await held.promise; await observed.promise; await delay(100); return read("v2", 1); } // after the client took seq 2
    return read(`v${n}`, 2);
  }, async signal => (++polls === 1 ? (await held.promise, observed.resolve(), Response.json({ seq: 2, tables: ["u"], generation: 0 })) : blocked(signal)));
  const mark = client.observe(query, { p: "dev:bob" });
  t.after(async () => { held.resolve(); mark.close(); await client.close(); });
  await until(() => mark.getSnapshot().data === "v1", "the first answer arrived");
  const seen = [];
  const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
  await until(() => reads.length >= 2, "the background refresh started");
  held.resolve();
  await until(() => mark.getSnapshot().data === "v3", "the next refresh answered at the observed commit");
  stop();
  assert.ok(!seen.some(read => read.data === "v2"), `a reply older than the observed commit was published: ${JSON.stringify(seen)}`);
});

test("a read that settles after the credentials end arms no refresh timer", async t => {
  // Hold a completed foreground read before its caller resumes, end the credentials
  // meanwhile, then release it and watch the timers it arms.
  const original = ReadObservation.prototype.fetch;
  const barrier = deferred(), reached = deferred();
  let holding = false;
  ReadObservation.prototype.fetch = async function (...args) {
    const result = await original.apply(this, args);
    if (holding) { holding = false; reached.resolve(); await barrier.promise; }
    return result;
  };
  const armed = [];
  const setTimer = globalThis.setTimeout;
  globalThis.setTimeout = (callback, ms, ...rest) => { armed.push(ms); return setTimer(callback, ms, ...rest); };
  t.after(() => { ReadObservation.prototype.fetch = original; globalThis.setTimeout = setTimer; barrier.resolve(); });
  const invalidate = deferred(), deny = deferred();
  let polls = 0;
  const { client } = transport(n => data(`v${n}`, 300, n), async signal => {
    polls++;
    if (polls === 1) { await invalidate.promise; return Response.json({ seq: 2, tables: [], generation: 0 }); }
    if (polls === 2) { await deny.promise; return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "session ended" } }); }
    return blocked(signal);
  });
  const mark = client.observe(query, { p: "dev:bob" });
  t.after(async () => { mark.close(); await client.close(); });
  await until(() => mark.getSnapshot().data === "v1", "the first answer arrived");
  holding = true;
  invalidate.resolve(); // a commit re-reads the watch in the foreground
  await reached.promise;
  deny.resolve();
  await until(() => client.link() === "signed-out", "the credentials ended");
  armed.length = 0;
  barrier.resolve();
  await delay(50);
  assert.ok(!armed.includes(300), `a presence timer was armed after the credentials ended: ${JSON.stringify(armed)}`);
});

// LLP 3000.017 §3: an answer of a query that may read presence asks its client
// to re-run it. The online client refreshes in the background after the
// interval its server named, and publishes only an answer nothing replaced
// meanwhile; an answer that reads no presence, or a closed watch, never re-runs.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { PRESENCE_REFRESH_FLOOR_MS, presenceRefresh } from "../dist/presence-refresh.js";

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
  const mark = client.observe(query, { p: "dev:bob" });
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

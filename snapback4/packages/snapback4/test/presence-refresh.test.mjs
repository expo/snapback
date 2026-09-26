// LLP 3000.017 §3: an answer that read presence asks its client to re-run it.
// The online client re-runs after the interval its server named, keeping the
// answer meanwhile; an answer that read no presence, or a closed watch, never
// re-runs.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { PRESENCE_REFRESH_FLOOR_MS } from "../dist/presence-refresh.js";

const query = { kind: "query", name: "presenceOf" };
const blocked = signal => new Promise((_, reject) => { if (signal.aborted) reject(Error("closed")); else signal.addEventListener("abort", () => reject(Error("closed")), { once: true }); });
async function until(check, why, ms = 3000) { const start = Date.now(); while (Date.now() - start < ms) { if (check()) return; await delay(10); } assert.fail(why); }

function transport(answers) {
  const reads = [];
  const client = createClient({ url: "http://presence.test", persona: "alice", fetch: async (url, init) => {
    if (url.includes("/changes")) return blocked(init.signal);
    if (!url.includes("/q/")) return Response.json({ ok: true });
    reads.push(Date.now());
    const answer = answers(reads.length);
    return answer instanceof Response ? answer : Response.json(answer);
  } });
  return { client, reads };
}

test("an answer that read presence re-runs after its server's interval, keeping the answer", async t => {
  const { client, reads } = transport(n => ({ data: { online: n > 1 }, complete: true, seq: 1, tables: [], refresh: 300 }));
  const mark = client.observe(query, { p: "dev:bob" });
  t.after(async () => { mark.close(); await client.close(); });
  await until(() => mark.getSnapshot().data?.online === false, "the first answer arrived");
  const seen = [];
  const stop = mark.subscribe(() => seen.push(mark.getSnapshot()));
  await until(() => mark.getSnapshot().data?.online === true, "the refresh turned the mark");
  stop();
  assert.ok(reads[1] - reads[0] >= 280, `re-ran after ${reads[1] - reads[0]} ms, before the interval`);
  assert.ok(seen.every(read => "data" in read), `the refresh published loading: ${JSON.stringify(seen)}`);
  assert.ok(seen.some(read => read.fresh === false), "the kept answer is marked not fresh while it refreshes");
});

test("an answer that read no presence does not re-run, and a closed watch stops", async t => {
  const plain = transport(() => ({ data: 1, complete: true, seq: 1, tables: [] }));
  const quiet = plain.client.observe(query, {});
  await until(() => quiet.getSnapshot().data === 1, "the plain answer arrived");
  await delay(600);
  assert.equal(plain.reads.length, 1, "no refresh without presence");
  quiet.close(); await plain.client.close();
  const live = transport(() => ({ data: 1, complete: true, seq: 1, tables: [], refresh: 1 }));
  const mark = live.client.observe(query, { p: "dev:bob" });
  await until(() => live.reads.length >= 2, "the refresh ran");
  assert.ok(live.reads[1] - live.reads[0] >= PRESENCE_REFRESH_FLOOR_MS - 20, "the client floors the interval");
  mark.close();
  const after = live.reads.length;
  await delay(PRESENCE_REFRESH_FLOOR_MS * 3);
  assert.ok(live.reads.length <= after + 1, `a closed watch kept refreshing: ${live.reads.length - after} more`);
  await live.client.close();
});

test("a refresh that fails keeps the interval, so it retries", async t => {
  const { client, reads } = transport(n => n === 2 ? new Response("unavailable", { status: 503 }) : n === 3 ? { denied: { code: "BUSY", family: "rule", message: "busy" } } : { data: { online: n > 3 }, complete: true, seq: 1, tables: [], refresh: 300 });
  const mark = client.observe(query, { p: "dev:bob" });
  t.after(async () => { mark.close(); await client.close(); });
  await until(() => mark.getSnapshot().data?.online === true, "a failed and a refused refresh were retried", 5000);
  assert.ok(reads.length >= 4, `reads: ${reads.length}`);
});

// LLP 3000.017 §3.2, §3.5: the client side of following presence, against a
// controlled transport. A moved token is not followed again while its watch
// re-runs, and an answer the server would not follow re-runs on a timer.
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "../dist/client.js";
import { FOLLOW_LIMIT, PRESENCE_RETRY_MS, followTokens, movedWatches } from "../dist/presence-follow.js";

const query = { kind: "query", name: "presenceOf" };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const blocked = signal => new Promise((_, reject) => { if (signal.aborted) reject(Error("closed")); else signal.addEventListener("abort", () => reject(Error("closed")), { once: true }); });
const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(check, why) { for (let n = 0; n < 5000; n++) { if (check()) return; await turn(); } assert.fail(why); }
const followOf = url => new URL(url).searchParams.get("follow")?.split(",") ?? [];
const answer = (online, presence) => Response.json({ data: { online }, complete: true, seq: 1, tables: [], presence });

test("a moved token is not followed again while its watch re-runs", async t => {
  const reads = [], polls = [];
  const rerun = deferred();
  const client = createClient({ url: "http://presence.test", persona: "alice", fetch: async (url, init) => {
    if (url.includes("/changes")) {
      const follow = followOf(url);
      polls.push(follow);
      // A flood is the failure under test; stop feeding one so it fails, not hangs.
      if (polls.length > 50) return blocked(init.signal);
      // As the server does for a token whose answer moved: answer at once.
      if (follow.includes("t1")) return Response.json({ seq: 1, tables: [], generation: 0, presence: ["t1"] });
      return blocked(init.signal);
    }
    if (!url.includes("/q/")) return Response.json({ ok: true });
    reads.push(url);
    if (reads.length === 1) return answer(false, "t1");
    await rerun.promise;
    return answer(true, "t2");
  } });
  const mark = client.observe(query, { p: "dev:bob" });
  t.after(async () => { mark.close(); rerun.resolve(); await client.close(); });
  await until(() => reads.length === 2, "the report re-ran the watch");
  const reported = polls.findIndex(follow => follow.includes("t1"));
  await new Promise(resolve => setTimeout(resolve, 200));
  const held = polls.slice(reported + 1);
  assert.ok(held.length <= 2, `the client polled ${held.length} times while the re-run was held`);
  assert.ok(held.every(follow => !follow.includes("t1")), `the moved token was followed again: ${JSON.stringify(held)}`);
  rerun.resolve();
  await until(() => polls.at(-1)?.includes("t2"), "the re-run's token is followed");
  await until(() => mark.getSnapshot().data?.online === true, "the re-run's answer is published");
});

test("an answer the server would not follow re-runs on a timer, and is never followed", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const polls = [];
  let reads = 0;
  const client = createClient({ url: "http://presence.test", persona: "alice", fetch: async (url, init) => {
    if (url.includes("/changes")) { polls.push(followOf(url)); return blocked(init.signal); }
    if (!url.includes("/q/")) return Response.json({ ok: true });
    reads++;
    return answer(false, reads === 1 ? "" : "t9");
  } });
  const mark = client.observe(query, { p: "dev:bob" });
  t.after(async () => { mark.close(); await client.close(); });
  await until(() => reads === 1 && mark.getSnapshot().data, "the first answer arrived");
  for (let n = 0; n < 50; n++) await turn();
  assert.ok(polls.every(follow => follow.length === 0), `an empty token was followed: ${JSON.stringify(polls)}`);
  t.mock.timers.tick(PRESENCE_RETRY_MS - 1);
  for (let n = 0; n < 50; n++) await turn();
  assert.equal(reads, 1, "no re-run before the retry is due");
  t.mock.timers.tick(1);
  await until(() => reads >= 2, "the retry re-ran the watch");
  // The mocked clock also ran the idle poll's silence watchdog out: step it
  // through the client's reconnect until a poll follows the retry's token.
  for (let n = 0; n < 20 && !polls.at(-1)?.includes("t9"); n++) {
    t.mock.timers.tick(1_000);
    for (let k = 0; k < 50; k++) await turn();
  }
  assert.ok(polls.at(-1)?.includes("t9"), `the retry's token is followed: ${JSON.stringify(polls.slice(-3))}`);
});

test("the follow list holds each watch's token once, up to the limit, less the moved", () => {
  const a = { presence: new Set(["t1"]) }, b = { presence: new Set(["t2"]) }, c = { presence: new Set() }, d = { presence: new Set(["t1"]) };
  assert.deepEqual(followTokens([a, b, c, d]), ["t1", "t2"]);
  assert.deepEqual(movedWatches([a, b, c, d], ["t1", "unknown"]), [a, d]);
  assert.deepEqual([a.presence.size, d.presence.size, b.presence.size], [0, 0, 1]);
  assert.deepEqual(followTokens([a, b, c, d]), ["t2"]);
  const many = Array.from({ length: FOLLOW_LIMIT + 5 }, (_, n) => ({ presence: new Set([`t${n}`]) }));
  assert.equal(followTokens(many).length, FOLLOW_LIMIT);
});

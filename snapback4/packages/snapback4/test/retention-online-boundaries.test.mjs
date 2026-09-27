// @ref LLP 3000.023#3.4 — discovery, store boundaries and link loss end every retained answer.
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
  await until(() => watch.getSnapshot().revalidating && reads > 1);
  assert.equal(episodeDeadline(watch.getSnapshot()), keep === true ? undefined : 2000);
  wall = 1500; advertise.resolve();
  await until(() => discovering);
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "discovery withdraws instead of copying away the episode");
  assert.equal(owner.deadlines?.server ?? null, null, "the withdrawn row has no deadline left armed");
  assert.equal(owner.expiryTimer, null);
  wall = 3000; owner.reload(); owner.reload();
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "discovery never renews or removes a cap while keeping A");
});

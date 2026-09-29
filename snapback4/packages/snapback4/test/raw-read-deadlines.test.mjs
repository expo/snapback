import { readyRead } from "../dist/read-existence.js";
// @ref LLP 3000.023#3.4 — row deadlines stay exact, including without timer delivery.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ReadObservation, answerObservation } from "../dist/read-observation.js";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { processDevice } from "../dist/native.js";
import { episodeDeadline } from "../dist/read-episode.js";
import { server, binary, until } from "./helpers/app-server.mjs";
import { armReadExpiry, correctReadExpiries } from "../dist/read-expiry.js";
import { ServerClock } from "../dist/clock.js";
import { bindWatchPeek, observeWatch, observationKey, peekObservation } from "../dist/observe-watch.js";

const q = { kind: "query", name: "read" };
function fixture(t, keep) {
  let wall = 1000, notifications = 0;
  t.mock.method(Date, "now", () => wall);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const clock = new ServerClock(() => wall), watches = new Map(), raw = { observe() {} };
  const options = keep === undefined ? undefined : { keep }, key = observationKey(q, {}, options);
  bindWatchPeek(raw, watches, () => null);
  const handle = observeWatch(watches, key, () => Object.assign(new ReadObservation(keep), {
    key, subscribers: new Set(), presenceRefresh: null,
  }), () => {}, () => {}, () => null, false);
  const owner = watches.get(key);
  const arm = (watch, deadlines) => armReadExpiry(watch, deadlines, clock, () => watches.get(key) === watch, () => {
    correctReadExpiries(watches.values(), clock, watch => {
      const deliver = watch.expire();
      return () => { deliver(); for (const listener of watch.subscribers) listener(); };
    }, arm, () => {});
  });
  handle.subscribe(() => notifications++);
  owner.publish(readyRead({ data: "private", complete: true, fresh: true, next: null, cut: null }));
  t.after(() => { handle.close(); for (const watch of watches.values()) watch.lingering?.close(); });
  return { handle, owner, watches, peek: () => peekObservation(raw, q, {}, options),
    notifications: () => notifications, wall: n => { wall = n; },
    arm: d => arm(owner, { device: null, server: null, localWakeup: false, ...d }) };
}

test("closing a raw local handle stops its episode timer but keeps the deadline", t => {
  const f = fixture(t);
  f.owner.reload(true); f.handle.close();
  assert.equal(f.watches.size, 0);
  assert.equal(f.peek(), undefined, "closed observations cannot be remounted from the map");
  f.wall(1999); assert.equal(f.handle.getSnapshot().data, "private");
  f.wall(2000); t.mock.timers.tick(1000);
  assert.equal(f.owner.snapshot.data, "private", "close stopped the episode timer");
  const loading = f.handle.getSnapshot();
  assert.deepEqual(loading, { loading: true });
  f.wall(1000); assert.equal(f.handle.getSnapshot(), loading, "expiry remains latched across rollback");
});

// Exercise the production subscription callback, without manually reloading its owner.
for (const tier of ["wasm", "process"]) for (const continuing of [false, true]) {
  test(`${tier}: resubscribing a raw local handle ${continuing ? "rearms its original" : "starts a bounded"} episode`, async t => {
    const { url, dir } = await server(t, "", `use personas alice, bob
table rows:
  owner: principal
  value: int
  read <- .owner = viewer
  update <- allow
  sync to .owner
query read():
  return rows['r']
mutation transfer():
  update rows['r'] { owner: 'dev:bob' }
mutation edit():
  update rows['r'] { value: 8 }
`);
    await fetch(url + "/seed", { method: "POST", body: JSON.stringify([
      { table: "rows", row: { id: "r", owner: "dev:alice", value: 7 } },
    ]) });
    const base = tier === "process" ? processDevice({ binary, dir: join(dir, "device") })
      : webDevice({ wasm: readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url)), persist: memoryPersistence() });
    const gate = Promise.withResolvers(); let hold = false, starts = 0;
    const client = await createLocalClient({ url, persona: "alice", device: { async open(...args) {
      const core = await base.open(...args);
      return { ...core, async call(request, commit) {
        const result = await core.call(request, commit);
        if (hold && request.op === "query") { starts++; await gate.promise; }
        return result;
      } };
    } }, fetch: (input, init) => {
      if (new URL(input).pathname !== "/changes") return fetch(input, init);
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
    } });
    t.after(async () => { gate.resolve(); await client.close(); }); await client.sync();
    const handle = client.observe(q, {}); handle.subscribe(() => {}); t.after(() => handle.close());
    await until(() => handle.getSnapshot().data?.value === 7 && !handle.getSnapshot().revalidating);
    const owner = answerObservation(handle.getSnapshot());
    const mutate = async name => assert.equal((await fetch(url + "/m/" + name, { method: "POST",
      headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ id: crypto.randomUUID(), args: {} }),
    }).then(r => r.json())).state, "sent");
    let originalDeadline;
    if (continuing) {
      hold = true; await mutate("edit"); await client.sync(); await until(() => starts > 0);
      originalDeadline = episodeDeadline(handle.getSnapshot());
      assert.ok(Number.isFinite(originalDeadline));
    }
    handle.close(); hold = false;
    await mutate("transfer"); await client.sync();
    assert.equal((await client.query(q, {})).data, null, "the replica has applied the ownership change");
    const before = starts, seen = []; hold = true;
    handle.subscribe(() => seen.push(owner.snapshot));
    await until(() => starts > before);
    assert.equal(handle.getSnapshot().data?.value, 7);
    assert.equal(handle.getSnapshot().revalidating, true, "subscription takes the production policy transition");
    const deadline = episodeDeadline(handle.getSnapshot());
    assert.ok(Number.isFinite(deadline), "the replacement attempt arms its episode");
    if (continuing) assert.equal(deadline, originalDeadline, "resubscription never renews an existing episode");
    await new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now()) + 20));
    assert.deepEqual(owner.snapshot, { loading: true }, "the real timer withdraws without a snapshot accessor");
    assert.ok(seen.some(read => read.loading), "withdrawal notifies the resubscribed handle");
    hold = false; gate.resolve();
    await until(() => handle.getSnapshot().data === null && !handle.getSnapshot().revalidating);
  });
}

for (const domain of ["device", "server"]) for (const when of ["before", "after"]) {
  test(`closed raw local handle checks its ${domain} deadline when closed ${when} it is due`, t => {
    const f = fixture(t);
    f.arm({ [domain]: 1100 });
    if (when === "after") f.wall(1100);
    f.handle.close();
    assert.equal(f.watches.size, 0); assert.equal(f.owner.expiryTimer, null);
    f.wall(1100); t.mock.timers.tick(100);
    assert.equal(f.owner.snapshot.data, "private", "no closed-handle expiry timer runs");
    const loading = f.handle.getSnapshot();
    assert.deepEqual(loading, { loading: true });
    f.wall(1000); assert.equal(f.handle.getSnapshot(), loading);
  });
}

test("a closed remembered answer ignores a local wakeup but still checks its server deadline", t => {
  const f = fixture(t);
  f.arm({ device: 1100, server: 1500, localWakeup: true });
  f.handle.close(); f.wall(1100);
  assert.equal(f.handle.getSnapshot().data, "private");
  f.wall(1500); assert.deepEqual(f.handle.getSnapshot(), { loading: true });
});

for (const keep of [undefined, true]) for (const domain of ["device", "server"]) for (const access of ["snapshot", "peek"]) {
  test(`raw ${access} latches its ${domain} row deadline before timers, keep=${keep}`, t => {
    const f = fixture(t, keep), get = access === "peek" ? f.peek : () => f.handle.getSnapshot();
    f.arm({ [domain]: 1100 });
    const original = get();
    assert.equal(original.revalidating, undefined, "this test has no episode deadline or facade hold");
    f.wall(1099); assert.equal(get(), original);
    f.wall(1100);
    assert.equal(f.owner.snapshot, original, "the expiry timer has not delivered");
    const loading = get();
    assert.deepEqual(loading, { loading: true });
    assert.equal(f.notifications(), 1);
    assert.equal(f.handle.getSnapshot(), loading); assert.equal(f.peek(), loading);
    f.wall(1000);
    assert.equal(get(), loading, "rollback cannot restore the expired row");
    assert.equal(f.notifications(), 1, "expiry only notifies once");
  });
}

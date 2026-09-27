import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { guardClient } from "../dist/app-client.js";
import { ReadObservation } from "../dist/read-observation.js";
import { armReadExpiry, correctReadExpiries } from "../dist/read-expiry.js";
import { bindWatchPeek, observeWatch, peekObservation } from "../dist/observe-watch.js";
import { ServerClock } from "../dist/clock.js";

const q = { kind: "query", name: "read" }, options = { keep: true };
const ready = data => ({ data, complete: true, fresh: true, next: null, cut: null });
const why = { code: "E_AUTH", family: "auth", message: "session ended" };
async function until(check) {
  for (let n = 0; n < 500; n++) { if (check()) return; await delay(2); }
  assert.fail("authority did not settle");
}

function fixture(t) {
  let wall = 1000, hold = false, allow = true;
  const gate = Promise.withResolvers(), clock = new ServerClock(() => wall), watches = new Map();
  const notify = watch => { for (const listener of watch.subscribers) listener(); };
  const arm = (watch, d) => armReadExpiry(watch, d, clock, () => watches.get(watch.key) === watch, sweep);
  function sweep() {
    correctReadExpiries(watches.values(), clock, watch => {
      watch.expire(); return () => notify(watch);
    }, arm, () => {});
  }
  const stopClock = clock.subscribe(sweep);
  const raw = { observe(op, args, opts) {
    const key = `${opts?.keep ? "keep:" : ""}${op.name}:${JSON.stringify(args)}`;
    return observeWatch(watches, key, () => Object.assign(new ReadObservation(opts?.keep), {
      key, subscribers: new Set(), presenceRefresh: null,
    }), () => {}, () => {}, () => null);
  } };
  bindWatchPeek(raw, watches, () => null);
  const facade = guardClient(raw, async () => {
    if (hold) await gate.promise;
    if (allow === "error") throw Error("session storage failed");
    return allow;
  }, () => true, () => why);
  const client = facade.client;
  t.after(() => { gate.resolve(); facade.fence()(); for (const watch of watches.values()) watch.linger?.close(); stopClock(); });
  const owner = (args = {}) => watches.get(`keep:read:${JSON.stringify(args)}`);
  const publish = (data, deadlines = {}, args = {}) => {
    const watch = owner(args);
    arm(watch, { device: null, server: null, localWakeup: false, ...deadlines });
    watch.publish(ready(data)); notify(watch);
  };
  return { client, owner, publish, clock, facade, setWall: n => { wall = n; },
    hold: () => { hold = true; }, release: (ok = true) => { allow = ok; hold = false; gate.resolve(); } };
}

for (const domain of ["device", "server"]) for (const trigger of ["timer", "correction"]) {
  test(`facade holds A until its ${domain} deadline (${trigger}), including a lingering remount`, async t => {
    const f = fixture(t), watch = f.client.observe(q, {}, options);
    await until(() => f.owner());
    f.publish("A", { [domain]: 1100 });
    await until(() => watch.getSnapshot().data === "A");
    const since = f.owner().since;
    f.hold();
    f.publish("B", { [domain]: 2000 });
    const kept = watch.getSnapshot();
    assert.equal(kept.data, "A"); assert.equal(kept.fresh, false);
    assert.equal(kept.since, since);
    watch.close();
    assert.equal(peekObservation(f.client, q, {}, options), kept);
    const joined = f.client.observe(q, {}, options);
    const seen = [];
    joined.subscribe(() => seen.push(joined.getSnapshot()));
    assert.equal(joined.getSnapshot(), kept);
    if (trigger === "timer") { f.setWall(1100); await until(() => joined.getSnapshot().loading); }
    else {
      f.clock.sample(1100, 1000, 1000, "clock:1");
      assert.deepEqual(joined.getSnapshot(), { loading: true });
      f.clock.sample(1000, 1000, 1000, "clock:2");
      assert.deepEqual(joined.getSnapshot(), { loading: true }, "rollback never resurrects A");
    }
    assert.ok(seen.some(read => read.loading), "an opening remount receives expiry while its first authority check is blocked");
    f.release(); await until(() => joined.getSnapshot().data === "B");
    joined.close();
  });
}

test("held server data ignores a device reobservation wakeup, even when device time is ahead", async t => {
  const f = fixture(t), watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A", { device: 1100, server: 1500, localWakeup: true });
  await until(() => watch.getSnapshot().data === "A");
  f.hold(); f.publish("B", { server: 2000 });
  f.clock.raiseIssued(1600);
  assert.equal(watch.getSnapshot().data, "A");
  f.clock.sample(1500, 1000, 1000, "clock:1");
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  f.release(); await until(() => watch.getSnapshot().data === "B"); watch.close();
});

test("a replacement's earlier deadline cannot expire the approved answer", async t => {
  const f = fixture(t), watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A", { server: 1500 }); await until(() => watch.getSnapshot().data === "A");
  f.hold(); f.publish("B", { server: 1100 });
  f.clock.sample(1100, 1000, 1000, "clock:1");
  assert.equal(f.owner().snapshot.loading, true);
  assert.equal(watch.getSnapshot().data, "A");
  f.owner().reload();
  assert.equal(watch.getSnapshot().data, "A", "B's retry still waits behind A");
  f.clock.sample(1500, 1000, 1000, "clock:2");
  assert.deepEqual(watch.getSnapshot(), { loading: true }); watch.close();
});

test("all facade deadlines withdraw before a subscriber rolls the clock back", async t => {
  const f = fixture(t), a = f.client.observe(q, {}, options), b = f.client.observe(q, { b: true }, options);
  await until(() => f.owner() && f.owner({ b: true }));
  f.publish("A", { server: 1100 }); f.publish("A", { server: 1100 }, { b: true });
  await until(() => a.getSnapshot().data && b.getSnapshot().data);
  f.hold(); f.publish("B", { server: 2000 }); f.publish("B", { server: 2000 }, { b: true });
  let rolledBack = false;
  a.subscribe(() => {
    if (!a.getSnapshot().loading) return;
    assert.deepEqual(b.getSnapshot(), { loading: true });
    rolledBack = true; f.clock.sample(1000, 1000, 1000, "clock:2");
  });
  f.clock.sample(1100, 1000, 1000, "clock:1");
  assert.equal(rolledBack, true);
  assert.deepEqual(b.getSnapshot(), { loading: true }); a.close(); b.close();
});

for (const reset of ["scope", "denied", "authority", "fence", "linger"]) test(`held approval ends on ${reset}`, async t => {
  const f = fixture(t), watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A", { server: 1500 }); await until(() => watch.getSnapshot().data === "A");
  const owner = f.owner();
  f.hold(); f.publish("B", { server: 2000 });
  assert.equal(watch.getSnapshot().data, "A");
  if (reset === "scope") owner.reset(ready("same payload after reset"));
  if (reset === "denied") owner.publish({ denied: why });
  if (reset === "authority") { f.release(false); await until(() => watch.getSnapshot().denied); }
  if (reset === "fence") f.facade.fence()();
  if (reset === "linger") { watch.close(); owner.linger.close(); }
  assert.ok(!("data" in watch.getSnapshot()));
  assert.ok(!peekObservation(f.client, q, {}, options)?.data);
  assert.equal(owner.followers.size, 0, "reset releases the held timer and follower"); watch.close();
});

test("a remount's initial authority error withdraws the held answer for every subscriber", async t => {
  const f = fixture(t), watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A"); await until(() => watch.getSnapshot().data === "A");
  const seen = [];
  watch.subscribe(() => seen.push(watch.getSnapshot()));
  f.hold();
  const remount = f.client.observe(q, {}, options);
  assert.equal(remount.getSnapshot().data, "A");
  f.release("error");
  await until(() => remount.getSnapshot().denied?.code === "E_CLIENT");
  assert.equal(watch.getSnapshot().denied?.code, "E_CLIENT");
  assert.ok(seen.some(read => read.denied?.code === "E_CLIENT"));
  assert.equal(peekObservation(f.client, q, {}, options), undefined);
  watch.close(); remount.close();
});

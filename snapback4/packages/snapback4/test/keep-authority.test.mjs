import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { guardClient } from "../dist/app-client.js";
import { ReadObservation } from "../dist/read-observation.js";
import { armReadExpiry, correctReadExpiries, holdReadExpiry } from "../dist/read-expiry.js";
import { bindWatchPeek, observeWatch, peekObservation } from "../dist/observe-watch.js";
import { RememberedAnswers } from "../dist/local-reads.js";
import { ServerClock } from "../dist/clock.js";
import { deferReadNotifications } from "../dist/read-notifications.js";

const q = { kind: "query", name: "read" }, options = { keep: true };
const ready = data => ({ data, complete: true, fresh: true, next: null, cut: null });
const why = { code: "E_AUTH", family: "auth", message: "session ended" };
async function until(check) {
  for (let n = 0; n < 500; n++) { if (check()) return; await delay(2); }
  assert.fail("authority did not settle");
}

import { fixture } from "./helpers/authority-fixture.mjs";

for (const keep of [undefined, false, true]) {
  test(`facade fence announces its denial after an unchanged approved answer, keep=${keep}`, async t => {
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A"); await until(() => watch.getSnapshot().data === "A");
    const seen = [];
    watch.subscribe(() => seen.push(watch.getSnapshot()));
    f.facade.fence()();
    assert.equal(seen.length, 1, "a fence changes the visible snapshot even if the cached approval is unchanged");
    assert.equal(seen[0].denied.code, "E_AUTH");
    watch.close();
  });

  test(`replacement authority refusal announces one denial, keep=${keep}`, async t => {
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A"); await until(() => watch.getSnapshot().data === "A");
    f.hold(); f.publish("B");
    const seen = [];
    watch.subscribe(() => seen.push(watch.getSnapshot()));
    f.release(false);
    await until(() => watch.getSnapshot().denied);
    await delay(0);
    assert.equal(seen.length, 1, "shared rejection and refresh announce the same denial only once");
    assert.equal(seen[0], watch.getSnapshot());
    assert.equal(seen[0].denied.code, "E_AUTH");
    watch.close();
  });
}

for (const keep of [undefined, true]) {
  test(`a facade awaiting authority keeps A when its peer approves B, keep=${keep}`, async t => {
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A", { server: 5000 }); await until(() => watch.getSnapshot().data === "A");
    const peer = f.client.observe(q, {}, opts);
    await until(() => f.owner().subscribers.size === 2);
    await delay(0);
    const a = watch.getSnapshot(), first = Promise.withResolvers(), second = Promise.withResolvers();
    t.after(() => { first.resolve(true); second.resolve(true); });
    f.gateChecks([first, second]);
    f.publish("B", { server: 8000 });
    second.resolve(true); await until(() => peer.getSnapshot().data === "B");
    assert.deepEqual(watch.getSnapshot(), { ...a, revalidating: true }, "the peer's authority cannot approve B for this facade");
    first.resolve(true); await until(() => watch.getSnapshot().data === "B");
    assert.equal(watch.getSnapshot(), peer.getSnapshot());
    watch.close(); peer.close();
  });

  test(`opening authority refusal announces one denial to the remount and its peer, keep=${keep}`, async t => {
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A"); await until(() => watch.getSnapshot().data === "A");
    f.hold();
    const remount = f.client.observe(q, {}, opts), seen = [], peerSeen = [];
    assert.equal(remount.getSnapshot().data, "A");
    remount.subscribe(() => seen.push(remount.getSnapshot()));
    watch.subscribe(() => peerSeen.push(watch.getSnapshot()));
    f.release(false);
    await until(() => remount.getSnapshot().denied);
    await delay(0);
    assert.equal(seen.length, 1, "the refused opening remount announces once");
    assert.equal(peerSeen.length, 1, "shared rejection still reaches the live peer once");
    assert.equal(seen[0].denied.code, "E_AUTH");
    assert.equal(peerSeen[0], seen[0]);
    watch.close(); remount.close();
  });
}

for (const keep of [undefined, true]) for (const transition of ["reload", "replacement"]) {
  test(`opening remount receives the revalidating mark during ${transition}, keep=${keep}`, async t => {
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A"); await until(() => watch.getSnapshot().data === "A");
    f.hold();
    const remount = f.client.observe(q, {}, opts), seen = [];
    remount.subscribe(() => seen.push(remount.getSnapshot()));
    const original = remount.getSnapshot(), subscribers = f.owner().subscribers.size;
    assert.equal(original.revalidating, undefined);
    const deliver = deferReadNotifications(() => {
      if (transition === "reload") f.owner().reload();
      else f.owner().publish(ready("B"));
    });
    assert.equal(seen.length, 0, "shared delivery waits for the whole transition");
    deliver();
    assert.equal(seen.length, 1, "the opening remount is notified before its authority check completes");
    assert.deepEqual(seen[0], { ...original, revalidating: true });
    assert.equal(f.owner().subscribers.size, subscribers, "the remount has not attached to the raw source");
    f.owner().reload();
    assert.equal(seen.length, 1, "an unchanged held snapshot needs no notification");
    remount.close(); watch.close();
  });
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
    assert.equal(kept.revalidating, true); assert.equal(kept.data, "A"); assert.equal(kept.fresh, true);
    assert.equal(kept.since, undefined);
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

test("a replacement's earlier deadline withdraws the shared approved answer", async t => {
  const f = fixture(t), watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A", { server: 1500 }); await until(() => watch.getSnapshot().data === "A");
  f.hold(); f.publish("B", { server: 1100 });
  f.clock.sample(1100, 1000, 1000, "clock:1");
  assert.equal(f.owner().snapshot.loading, true);
  assert.equal(watch.getSnapshot().loading, true);
  f.owner().reload();
  assert.equal(watch.getSnapshot().loading, true, "B's retry cannot restore the withdrawn approval");
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
  if (reset === "linger") { watch.close(); owner.lingering.close(); }
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

for (const domain of ["device", "server"]) for (const access of ["snapshot", "peek"]) {
  test(`held ${domain} deadline is latched by ${access} before timer delivery`, async t => {
    const f = fixture(t), watch = f.client.observe(q, {}, options);
    await until(() => f.owner());
    f.publish("A", { [domain]: 1100 }); await until(() => watch.getSnapshot().data === "A");
    f.hold(); f.publish("B", { [domain]: 2000 });
    const ticket = f.memory.begin(), old = { read: ready("A"), nextExpiry: 1100, at: 1000, tables: new Set() };
    f.memory.set("read", { ...old, read: ready("C"), nextExpiry: 3000 }, { seq: 2, ticket: f.memory.begin() });
    f.setWall(1100);
    const read = access === "snapshot" ? watch.getSnapshot() : peekObservation(f.client, q, {}, options);
    assert.deepEqual(read, { loading: true });
    f.setWall(1000);
    assert.equal(watch.getSnapshot(), read, "one stable withdrawal survives rollback");
    if (domain === "server") {
      f.memory.set("read", old, { seq: 100, ticket });
      assert.equal(f.memory.get("read").read.data, "C", "accessor installs the memory barrier before notification");
    }
    watch.close();
  });
}

for (const withdrawal of ["reset", "denied", "retire"]) test(`opening remount is notified on ${withdrawal}`, async t => {
  const f = fixture(t), watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A"); await until(() => watch.getSnapshot().data === "A");
  f.hold(); f.publish("B"); watch.close();
  const remount = f.client.observe(q, {}, options), seen = [];
  remount.subscribe(() => seen.push(remount.getSnapshot()));
  assert.equal(remount.getSnapshot().data, "A");
  if (withdrawal === "reset") f.owner().reset({ loading: true });
  if (withdrawal === "denied") f.owner().publish({ denied: why });
  if (withdrawal === "retire") f.owner().lingering.close();
  assert.equal(seen.length, 1);
  assert.ok(!("data" in seen[0]));
  remount.close();
});

for (const order of ["B-first", "C-refuses"]) test(`independent authority completions preserve the newest check: ${order}`, async t => {
  const f = fixture(t), watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A"); await until(() => watch.getSnapshot().data === "A");
  const b = Promise.withResolvers(), c = Promise.withResolvers();
  f.gateChecks([b, c]);
  f.publish("B"); f.publish("C");
  if (order === "B-first") {
    b.resolve(true); await delay(0);
    assert.equal(watch.getSnapshot().data, "A", "B's approval must not publish unchecked C");
    c.resolve(true); await until(() => watch.getSnapshot().data === "C");
  } else {
    c.resolve(false); await until(() => watch.getSnapshot().denied);
    b.resolve(true); await delay(0);
    assert.equal(watch.getSnapshot().denied?.code, "E_AUTH", "older success cannot undo newer refusal");
  }
  watch.close();
});

test("an early expiry timer rearm preserves the held-answer memory fence", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let wall = 1000;
  const clock = new ServerClock(() => wall), owner = new ReadObservation(true), memory = new RememberedAnswers();
  const old = { read: ready("A"), nextExpiry: 1500, at: 1000, tables: new Set() }, ticket = memory.begin();
  const arm = (watch, d) => armReadExpiry(watch, d, clock, () => true, sweep,
    (due, now) => { if (due) memory.expire("read", now); });
  function sweep() {
    correctReadExpiries([owner], clock, () => () => {}, arm, () => {});
  }
  arm(owner, { device: null, server: 1500, localWakeup: false });
  let withdrawn = false;
  const held = holdReadExpiry(owner, () => { withdrawn = true; return () => {}; });
  arm(owner, { device: null, server: 1100, localWakeup: false });
  wall = 1099; t.mock.timers.tick(100);
  wall = 1100; t.mock.timers.tick(1);
  memory.set("read", { ...old, read: ready("C"), nextExpiry: 3000 }, { seq: 2, ticket: memory.begin() });
  wall = 1500; t.mock.timers.tick(400);
  assert.equal(withdrawn, true);
  wall = 1000;
  memory.set("read", old, { seq: 100, ticket });
  assert.equal(memory.get("read").read.data, "C");
  held.release();
});

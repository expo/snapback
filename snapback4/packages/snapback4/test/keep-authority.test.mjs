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
  for (const join of ["before", "after"]) test(`opening remount joins ${join} withdrawal and is notified on shared reapproval, keep=${keep}`, async t => {
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A"); await until(() => watch.getSnapshot().data === "A");
    const opening = Promise.withResolvers(); t.after(() => opening.resolve(true));
    let remount;
    const open = () => { f.gateChecks([opening]); remount = f.client.observe(q, {}, opts); };
    if (join === "before") open();
    f.owner().publish({ loading: true });
    for (const notify of f.owner().subscribers) notify();
    if (join === "after") open();
    assert.deepEqual(remount.getSnapshot(), { loading: true });
    const seen = [];
    remount.subscribe(() => seen.push(remount.getSnapshot()));
    f.publish("B"); await until(() => watch.getSnapshot().data === "B");
    assert.equal(f.owner().subscribers.size, 1, "the opening check is still blocked");
    assert.equal(remount.getSnapshot(), watch.getSnapshot());
    assert.deepEqual(seen, [remount.getSnapshot()], "reapproval uses the same notification owner after clearing the old data");
    assert.equal(f.owner().followers.size, 1);
    remount.close(); watch.close();
  });

  for (const stage of ["opening", "waiting"]) test(`closing an ${stage} facade captures its last shared answer, keep=${keep}`, async t => {
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const peer = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A", { server: 5000 }); await until(() => peer.getSnapshot().data === "A");
    const pending = Promise.withResolvers(), successful = Promise.withResolvers();
    t.after(() => { pending.resolve(true); successful.resolve(true); });
    if (stage === "opening") f.gateChecks([pending]);
    const closed = f.client.observe(q, {}, opts);
    if (stage === "waiting") {
      await until(() => f.owner().subscribers.size === 2); await delay(0);
      f.gateChecks([successful, pending]);
    }
    f.publish("B", { server: 8000 }); successful.resolve(true);
    await until(() => peer.getSnapshot().data === "B");
    const b = closed.getSnapshot();
    assert.equal(b, peer.getSnapshot());
    let calls = 0; closed.subscribe(() => calls++);
    closed.close(); closed.close();
    assert.equal(closed.getSnapshot(), b, "close captures visible B, even while private authority still waits");
    closed.subscribe(() => calls++); // A closed handle cannot acquire listeners again.
    f.hold(); f.publish("C", { server: 9000 });
    const loading = closed.getSnapshot();
    assert.deepEqual(loading, { loading: true }, "a closed handle drops B as soon as the source moves to C");
    f.release(); pending.resolve(true);
    await until(() => peer.getSnapshot().data === "C"); await delay(0);
    assert.equal(closed.getSnapshot(), loading, "late opening/replacement authority cannot revive a closed facade");
    assert.equal(f.owner().subscribers.size, 1, "only the live peer remains subscribed");
    assert.equal(calls, 0);
    peer.close();
  });

  test(`one shared approval survives 100 replacements, keep=${keep}`, async t => {
    t.mock.method(Date, "now", () => 1000);
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A", { server: 5000 }); await until(() => watch.getSnapshot().data === "A");
    for (let n = 0; n < 100; n++) {
      f.publish(`B${n}`, { server: 8000 + n });
      await until(() => watch.getSnapshot().data === `B${n}`);
    }
    const latest = watch.getSnapshot();
    assert.equal(f.owner().subscribers.size, 1);
    assert.equal(f.owner().followers.size, 1, "superseded approval followers are released");
    f.setWall(5000); f.clock.sample(5000);
    assert.equal(watch.getSnapshot(), latest, "old row expiry cannot withdraw the current approval");
    t.mock.method(Date, "now", () => 2001);
    assert.equal(watch.getSnapshot(), latest);
    assert.equal(f.owner().followers.size, 1, "old episode expiry cannot leave abandoned approvals");
    watch.close();
  });

  test(`opening remount getter and notifications follow shared replacements, keep=${keep}`, async t => {
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A"); await until(() => watch.getSnapshot().data === "A");
    const opening = Promise.withResolvers();
    t.after(() => opening.resolve(true));
    f.gateChecks([opening]);
    const remount = f.client.observe(q, {}, opts), seen = [];
    remount.subscribe(() => seen.push(remount.getSnapshot()));
    for (const body of ["B", "C"]) {
      seen.length = 0;
      f.publish(body);
      await until(() => watch.getSnapshot().data === body);
      assert.equal(f.owner().subscribers.size, 1, "opening authority is still blocked");
      assert.equal(remount.getSnapshot(), watch.getSnapshot());
      assert.equal(seen.length, 2, "one revalidation and one replacement notification");
      assert.equal(seen[0].loading, true);
      assert.equal(seen[1], remount.getSnapshot(), "the getter never advances without its notification");
    }
    remount.close(); watch.close();
  });

  test(`rejection clears the shared approval and notifies all live facades once, keep=${keep}`, async t => {
    t.mock.method(Date, "now", () => 1000);
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A", { server: 5000 }); await until(() => watch.getSnapshot().data === "A");
    const peer = f.client.observe(q, {}, opts);
    await until(() => f.owner().subscribers.size === 2); await delay(0);
    const waiting = Promise.withResolvers(), successful = Promise.withResolvers(), opening = Promise.withResolvers();
    t.after(() => { waiting.resolve(true); successful.resolve(true); opening.resolve(true); });
    f.gateChecks([waiting, successful]); f.publish("B", { server: 8000 });
    successful.resolve(true); await until(() => peer.getSnapshot().data === "B");
    f.gateChecks([opening]);
    const remount = f.client.observe(q, {}, opts), facades = [watch, peer, remount];
    const seen = facades.map(handle => {
      const events = []; handle.subscribe(() => events.push(handle.getSnapshot())); return events;
    });
    opening.reject(Error("session storage failed"));
    await until(() => remount.getSnapshot().denied); await delay(0);
    const denial = remount.getSnapshot();
    waiting.resolve(true); await delay(0);
    assert.equal(denial.denied.code, "E_CLIENT");
    for (let n = 0; n < facades.length; n++) {
      assert.equal(facades[n].getSnapshot(), denial, "no older facade retains an answer after shared rejection");
      assert.deepEqual(seen[n], [denial], "each live facade receives exactly one denial");
    }
    assert.equal(f.owner().followers.size, 0, "rejection releases the shared follower");
    assert.equal(peekObservation(f.client, q, {}, opts), undefined, "the refused answer cannot be peeked");
    f.setWall(5000); f.clock.sample(5000);
    t.mock.method(Date, "now", () => 2001);
    for (let n = 0; n < facades.length; n++) {
      assert.equal(facades[n].getSnapshot(), denial, "retired A's deadlines cannot replace denial");
      assert.deepEqual(seen[n], [denial]);
      facades[n].close();
    }
  });

  test(`a live waiting facade holds A until its peer approves shared B, keep=${keep}`, async t => {
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
    assert.deepEqual(watch.getSnapshot(), { loading: true }, "a changed image withdraws before B is approved");
    assert.equal(peer.getSnapshot(), watch.getSnapshot());
    const seen = [];
    watch.subscribe(() => seen.push(watch.getSnapshot()));
    second.resolve(true); await until(() => peer.getSnapshot().data === "B");
    assert.equal(watch.getSnapshot(), peer.getSnapshot(), "the peer's successful check authorizes B for every live facade");
    assert.deepEqual(seen, [peer.getSnapshot()], "the waiting facade is notified once while its own check is blocked");
    f.hold(); f.owner().reload();
    for (const notify of f.owner().subscribers) notify();
    assert.equal(watch.getSnapshot().data, "B", "another invalidation keeps the shared approved identity");
    assert.equal(watch.getSnapshot().revalidating, true);
    assert.equal(watch.getSnapshot(), peer.getSnapshot());
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
    assert.deepEqual(seen[0], transition === "reload" ? { ...original, revalidating: true } : { loading: true });
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
    f.publish("A", { [domain]: 2000 });
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
    f.release(); await until(() => joined.getSnapshot().data === "A");
    joined.close();
  });
}

test("held server data ignores a device reobservation wakeup, even when device time is ahead", async t => {
  const f = fixture(t), watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A", { device: 1100, server: 1500, localWakeup: true });
  await until(() => watch.getSnapshot().data === "A");
  f.hold(); f.publish("A", { server: 2000 });
  f.clock.raiseIssued(1600);
  assert.equal(watch.getSnapshot().data, "A");
  f.clock.sample(1500, 1000, 1000, "clock:1");
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  f.release(); await until(() => watch.getSnapshot().data === "A"); watch.close();
});

test("a replacement's earlier deadline withdraws the shared approved answer", async t => {
  const f = fixture(t), watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A", { server: 1500 }); await until(() => watch.getSnapshot().data === "A");
  f.hold(); f.publish("A", { server: 1100 });
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
  f.hold(); f.publish("A", { server: 2000 }); f.publish("A", { server: 2000 }, { b: true });
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
  f.hold(); f.publish("A", { server: 2000 });
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
    f.hold(); f.publish("A", { [domain]: 2000 });
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
  f.hold(); f.publish("A"); watch.close();
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
    assert.deepEqual(watch.getSnapshot(), { loading: true }, "B cannot publish unchecked C or restore A");
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

import { readyRead } from "../dist/read-presence.js";
// @ref LLP 3000.023#3.4 — row deadlines stay exact, including without timer delivery.
import test from "node:test";
import assert from "node:assert/strict";
import { ReadObservation } from "../dist/read-observation.js";
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

test("resubscribing a raw local handle rearms its original episode deadline", t => {
  const f = fixture(t);
  f.owner.reload(true); f.handle.close();
  f.wall(1500);
  let notifications = 0;
  f.handle.subscribe(() => notifications++);
  // Local rerun reloads when the subscription starts again.
  f.owner.reload();
  t.mock.timers.tick(499); f.wall(2000); t.mock.timers.tick(1);
  assert.deepEqual(f.owner.snapshot, { loading: true }, "the restarted timer withdraws without an accessor");
  assert.equal(notifications, 1, "resubscription does not renew the original deadline");
});

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

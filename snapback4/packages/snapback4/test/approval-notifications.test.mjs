import test from "node:test";
import assert from "node:assert/strict";
import { ReadApprovals } from "../dist/read-approval.js";
import { ReadObservation } from "../dist/read-observation.js";
import { fixture } from "./helpers/authority-fixture.mjs";

const q = { kind: "query", name: "read" };
const ready = data => ({ data, complete: true, fresh: true, next: null, cut: null });
// Authority uses only promises here; no wall-time races or polling timers.
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function gates(t, f, count) {
  const pending = Array.from({ length: count }, () => Promise.withResolvers());
  t.after(() => { for (const gate of pending) gate.resolve(true); });
  f.gateChecks([...pending]);
  return pending;
}

for (const keep of [undefined, false, true]) {
  const opts = keep === undefined ? undefined : { keep };
  test(`a rejecting live facade hears its peer's later approval, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default");
    const first = f.client.observe(q, {}, opts), peer = f.client.observe(q, {}, opts);
    await settle(); f.publish("A"); await settle();
    assert.equal(first.getSnapshot().data, "A");
    const [rejecting, approving] = gates(t, f, 2);
    f.publish("B"); rejecting.reject(Error("transient storage error")); await settle();
    assert.equal(first.getSnapshot().denied.code, "E_CLIENT");
    const seen = []; first.subscribe(() => seen.push(first.getSnapshot()));
    approving.resolve(true); await settle();
    assert.equal(peer.getSnapshot().data, "B");
    assert.equal(first.getSnapshot(), peer.getSnapshot());
    assert.deepEqual(seen, [peer.getSnapshot()]);
    assert.equal(f.owner().subscribers.size, 2, "rejection leaves the live raw subscription attached");
    first.close(); peer.close();
  });

  for (const beforePublish of [false, true]) test(`opening remount hears first approval (before publish=${beforePublish}), keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default"), first = f.client.observe(q, {}, opts);
    await settle();
    const [approving, opening] = gates(t, f, 2);
    let remount;
    if (beforePublish) {
      f.gateChecks([opening, approving]);
      remount = f.client.observe(q, {}, opts);
    }
    f.publish("A");
    remount ??= f.client.observe(q, {}, opts);
    const seen = []; remount.subscribe(() => seen.push(remount.getSnapshot()));
    assert.equal(remount.getSnapshot().loading, true);
    approving.resolve(true); await settle();
    assert.equal(f.owner().subscribers.size, 1, "remount's own opening authority is still blocked");
    assert.equal(remount.getSnapshot().data, "A");
    assert.deepEqual(seen, [remount.getSnapshot()], "first approval changes getter and notification together");
    first.close(); remount.close();
  });

  test(`each rejection notifies the shared denial after registrations release, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default");
    const facades = Array.from({ length: 3 }, () => f.client.observe(q, {}, opts));
    await settle(); f.publish("A"); await settle();
    const [first, second] = gates(t, f, 3);
    f.publish("B");
    const seen = facades.map(watch => {
      const events = []; watch.subscribe(() => events.push(watch.getSnapshot())); return events;
    });
    for (const [gate, message] of [[first, "first"], [second, "second"]]) {
      gate.reject(Error(message)); await settle();
      const denial = facades[2].getSnapshot();
      assert.equal(denial.denied.message, `Error: ${message}`);
      assert.equal(f.owner().followers.size, 0);
      for (let i = 0; i < facades.length; i++) {
        assert.equal(facades[i].getSnapshot(), denial);
        assert.deepEqual(seen[i].splice(0), [denial], "every live reader hears every distinct denial exactly once");
      }
    }
    for (const watch of facades) watch.close();
  });

  test(`opening refusal broadcasts a second denial after registrations release, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default");
    const first = f.client.observe(q, {}, opts), peer = f.client.observe(q, {}, opts);
    await settle(); f.publish("A"); await settle();
    const [rejecting] = gates(t, f, 2);
    f.publish("B"); rejecting.reject(Error("first")); await settle();
    assert.equal(peer.getSnapshot().denied.message, "Error: first");
    const [opening] = gates(t, f, 1), remount = f.client.observe(q, {}, opts);
    const seen = []; peer.subscribe(() => seen.push(peer.getSnapshot()));
    opening.reject(Error("second")); await settle();
    assert.equal(remount.getSnapshot().denied.message, "Error: second");
    assert.equal(peer.getSnapshot(), remount.getSnapshot());
    assert.deepEqual(seen, [peer.getSnapshot()], "opening refusal broadcasts without a raw refresh completion");
    first.close(); peer.close(); remount.close();
  });

  test(`release custody stays bounded through replacement, rejection and close, keep=${keep}`, () => {
    const approvals = new ReadApprovals(), owner = new ReadObservation(keep);
    let slot;
    for (let n = 0; n <= 100; n++) {
      owner.publish(ready(n));
      const next = approvals.approve(owner.snapshot);
      if (slot) assert.equal(next, slot, "one shared slot per raw watch");
      slot = next;
      assert.equal(owner.followers.size, 1);
      assert.equal(approvals.releases.size, 1, "superseded release closures leave custody");
    }
    approvals.reject(owner.snapshot, { denied: { code: "E_CLIENT" } });
    assert.equal(owner.followers.size, 0);
    assert.equal(approvals.releases.size, 0, "rejection releases all registrations");
    owner.publish(ready("recovery")); approvals.approve(owner.snapshot);
    assert.equal(approvals.releases.size, 1);
    approvals.close();
    assert.equal(owner.followers.size, 0);
    assert.equal(approvals.releases.size, 0, "close releases all registrations");
  });

  test(`seeded shared-slot notification invariant, keep=${keep}`, async t => {
    const coverage = new Map();
    for (let seed = 1; seed <= 30; seed++) await t.test(`seed ${seed}`, async t => {
      let wall = 1000, random = seed, serial = 0;
      const pick = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
      t.mock.method(Date, "now", () => wall);
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const f = fixture(t, keep ?? "default"), pending = [], records = [], trace = [];
      f.gateChecks(() => {
        const gate = Promise.withResolvers(); pending.push(gate); return gate.promise;
      });
      const open = () => {
        const watch = f.client.observe(q, {}, opts);
        const record = { watch, closed: false, closedCalls: 0, last: watch.getSnapshot(), events: [] };
        watch.subscribe(() => { record.last = watch.getSnapshot(); record.events.push(record.last); });
        records.push(record);
      };
      t.after(() => {
        for (const record of records) record.watch.close();
        for (const gate of pending) gate.resolve(true);
      });
      open();
      for (let step = 0; step < 180; step++) {
        const live = records.filter(record => !record.closed), owner = f.owner();
        const choices = ["open", "advance"];
        if (owner) choices.push("publish", "publish", "reset");
        if (pending.length) choices.push("approve", "approve", "reject");
        if (live.length) choices.push("close");
        const action = choices[pick(choices.length)];
        coverage.set(action, (coverage.get(action) ?? 0) + 1);
        trace.push(action);
        if (action === "open") open();
        if (action === "publish") f.publish(`answer ${++serial}`, { server: wall + 1 + pick(2200) });
        if (action === "approve" || action === "reject") {
          const index = pick(pending.length), [gate] = pending.splice(index, 1);
          trace[trace.length - 1] += ` ${index}`;
          if (action === "approve") gate.resolve(true);
          else gate.reject(Error(`rejection ${step}`));
        }
        if (action === "close") {
          const record = live[pick(live.length)];
          record.closed = true; record.watch.close(); record.closedCalls = record.events.length;
        }
        if (action === "reset") {
          owner.reset({ loading: true });
          for (const notify of owner.subscribers) notify();
        }
        if (action === "advance") {
          const elapsed = 1 + pick(1200); wall += elapsed; f.setWall(wall);
          // Exercise both timer delivery and access-time latching with timers delayed.
          if (pick(2)) t.mock.timers.tick(elapsed);
        }
        await settle();
        for (const [index, record] of records.entries()) {
          const context = `seed=${seed}, step=${step}, facade=${index}: ${trace.join(", ")}`;
          if (record.closed) {
            record.watch.getSnapshot();
            assert.equal(record.events.length, record.closedCalls, `closed facade is silent: ${context}`);
            continue;
          }
          const current = record.watch.getSnapshot();
          assert.equal(current, record.last, `getter changed without a callback: ${context}`);
          assert.equal(record.watch.getSnapshot(), current, `snapshot is stable: ${context}`);
        }
      }
    });
    for (const action of ["publish", "approve", "reject", "open", "close", "advance", "reset"])
      assert.ok(coverage.get(action) > 0, `${action} is exercised`);
  });
}

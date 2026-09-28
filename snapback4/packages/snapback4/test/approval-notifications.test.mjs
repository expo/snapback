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
    assert.equal(peer.getSnapshot().denied.code, "E_CLIENT", "pending success is older than rejection");
    const newer = gates(t, f, 2);
    for (const notify of f.owner().subscribers) notify();
    newer[1].resolve(true); await settle();
    assert.equal(peer.getSnapshot().data, "B", "a check started after refusal recovers B without another publication");
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


}

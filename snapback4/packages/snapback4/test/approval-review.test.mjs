import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/authority-fixture.mjs";

const q = { kind: "query", name: "read" };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function gates(t, f, n) {
  const pending = Array.from({ length: n }, () => Promise.withResolvers());
  t.after(() => pending.forEach(gate => gate.resolve(true)));
  f.gateChecks([...pending]); return pending;
}

for (const keep of [undefined, false, true]) {
  const opts = keep === undefined ? undefined : { keep };
  for (const order of ["C-ok-B-fail", "B-fail-C-ok", "C-ok-B-ok", "B-ok-C-fail"])
    test(`superseded refresh result preserves the newest check (${order}), keep=${keep}`, async t => {
      const f = fixture(t, keep ?? "default"), watch = f.client.observe(q, {}, opts);
      await settle(); f.publish("A"); await settle();
      const [b, c] = gates(t, f, 2); f.publish("B"); f.publish("C");
      const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot()));
      const outcomes = order.split("-");
      for (let i = 0; i < outcomes.length; i += 2) {
        (outcomes[i] === "B" ? b : c).resolve(outcomes[i + 1] === "ok"); await settle();
      }
      const read = watch.getSnapshot();
      if (order.endsWith("C-fail")) assert.equal(read.denied?.code, "E_AUTH");
      else {
        assert.equal(read.data, "C");
        assert.deepEqual(seen, [read], "obsolete failure neither withdraws nor fences C");
      }
      watch.close();
    });

  test(`opening adoption of the same denial does not fence recovery, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default"), first = f.client.observe(q, {}, opts);
    await settle(); f.publish("A"); await settle();
    const [replace, opening, recovery] = gates(t, f, 3);
    f.publish("B"); const remount = f.client.observe(q, {}, opts);
    replace.resolve(false); await settle();
    const refusal = first.getSnapshot(), seen = [];
    remount.subscribe(() => seen.push(remount.getSnapshot()));
    for (const notify of f.owner().subscribers) notify();
    opening.resolve(false); await settle();
    assert.equal(first.getSnapshot(), refusal); assert.deepEqual(seen, []);
    recovery.resolve(true); await settle();
    assert.equal(first.getSnapshot().data, "B");
    assert.equal(remount.getSnapshot(), first.getSnapshot());
    assert.deepEqual(seen, [first.getSnapshot()]);
    first.close(); remount.close();
  });

  test(`closed opening without an associated owner cannot revoke a later watch, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default"), [opening] = gates(t, f, 1);
    const closed = f.client.observe(q, {}, opts); closed.close();
    assert.equal(f.owner(), undefined);
    const live = f.client.observe(q, {}, opts); await settle(); f.publish("A"); await settle();
    const approved = live.getSnapshot(), seen = []; live.subscribe(() => seen.push(live.getSnapshot()));
    opening.reject(Error("unassociated opening failed")); await settle();
    assert.equal(live.getSnapshot(), approved); assert.deepEqual(seen, []);
    assert.equal(closed.getSnapshot().denied?.code, "E_CLIENT", "the closed caller may still see its own refusal");
    live.close();
  });

  test(`closed associated opening refuses its retired owner only, keep=${keep}`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(t, keep ?? "default"), first = f.client.observe(q, {}, opts);
    await settle(); f.publish("A"); await settle();
    const [opening] = gates(t, f, 1), closed = f.client.observe(q, {}, opts);
    closed.close(); first.close(); if (keep) t.mock.timers.tick(30_000);
    const live = f.client.observe(q, {}, opts); await settle(); f.publish("B"); await settle();
    const approved = live.getSnapshot(), seen = []; live.subscribe(() => seen.push(live.getSnapshot()));
    opening.reject(Error("old owner failed")); await settle();
    assert.equal(live.getSnapshot(), approved); assert.deepEqual(seen, []);
    live.close();
  });

  test(`closed loading latch survives a later source denial, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default"), closed = f.client.observe(q, {}, opts), peer = f.client.observe(q, {}, opts);
    await settle(); f.publish("A"); await settle(); closed.close();
    f.publish("B"); await settle();
    const loading = closed.getSnapshot(); assert.deepEqual(loading, { loading: true });
    f.owner().publish({ denied: { code: "E_AUTH", message: "source denied" } });
    for (const notify of f.owner().subscribers) notify();
    assert.equal(closed.getSnapshot(), loading); assert.equal(closed.getSnapshot(), loading);
    assert.equal(peer.getSnapshot().denied.code, "E_AUTH");
    peer.close();
  });
}

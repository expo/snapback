import test from "node:test";
import assert from "node:assert/strict";
import { answerIdentity } from "../dist/read-observation.js";
import { episodeDeadline } from "../dist/read-episode.js";
import { fixture } from "./helpers/authority-fixture.mjs";

const q = { kind: "query", name: "read" };
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function gates(t, f, count) {
  const pending = Array.from({ length: count }, () => Promise.withResolvers());
  t.after(() => { for (const gate of pending) gate.resolve(true); });
  f.gateChecks([...pending]); return pending;
}
function events(watch) {
  const seen = []; watch.subscribe(() => seen.push(watch.getSnapshot())); return seen;
}

for (const keep of [undefined, false, true]) {
  const opts = keep === undefined ? undefined : { keep };
  for (const beforeOwner of [false, true]) test(`opening refusal after raw retirement (peer attachment=${beforeOwner}), keep=${keep}`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(t, keep ?? "default");
    let first, remount, opening;
    if (beforeOwner) {
      const pending = gates(t, f, 2); opening = pending[1];
      first = f.client.observe(q, {}, opts);
      remount = f.client.observe(q, {}, opts);
      assert.equal(f.owner(), undefined, "the remount has no initial slot");
      pending[0].resolve(true); await settle();
    } else {
      first = f.client.observe(q, {}, opts); await settle();
    }
    f.publish("A"); await settle();
    if (!beforeOwner) {
      [opening] = gates(t, f, 1);
      remount = f.client.observe(q, {}, opts);
    }
    assert.equal(remount.getSnapshot().data, "A");
    const seen = events(remount);
    first.close();
    if (keep) t.mock.timers.tick(30_000);
    assert.equal(f.owner(), undefined, "the raw-map peek has disappeared");
    seen.length = 0;
    opening.reject(Error("opening failed")); await settle();
    const denial = remount.getSnapshot();
    assert.equal(denial.denied?.code, "E_CLIENT");
    assert.match(denial.denied.message, /opening failed/);
    assert.deepEqual(seen, [denial], "the attached retired slot delivers exactly one refusal");
    remount.close();
  });

  test(`opening before any raw owner hears approval and source denial, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default"), [firstOpen, peerOpen] = gates(t, f, 2);
    const first = f.client.observe(q, {}, opts), peer = f.client.observe(q, {}, opts), seen = events(peer);
    assert.equal(f.owner(), undefined);
    firstOpen.resolve(true); await settle(); f.publish("A"); await settle();
    assert.equal(peer.getSnapshot().data, "A");
    assert.equal(seen.at(-1), peer.getSnapshot());
    const denial = { denied: { code: "E_AUTH", message: "source refused" } };
    f.owner().publish(denial);
    for (const notify of f.owner().subscribers) notify();
    assert.equal(peer.getSnapshot().denied.code, "E_AUTH");
    assert.equal(seen.at(-1), peer.getSnapshot());
    assert.equal(seen.filter(read => read.data === "A").length, 1);
    assert.equal(seen.filter(read => read.denied).length, 1);
    first.close(); peer.close(); peerOpen.resolve(true); await settle();
  });

  test(`facade fencing withdraws before deferred notification, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default"), watch = f.client.observe(q, {}, opts);
    await settle(); f.publish("A"); await settle();
    const seen = events(watch), deliver = f.facade.fence();
    assert.deepEqual(seen, [], "the app owns delivery after publishing its new view");
    assert.equal(watch.getSnapshot().denied.code, "E_AUTH");
    deliver(); assert.deepEqual(seen, [watch.getSnapshot()]);
    watch.close();
  });

  for (const rejectIndex of [0, 1]) test(`shared refusal fences both older success orders (${rejectIndex}), keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default"), watches = [f.client.observe(q, {}, opts), f.client.observe(q, {}, opts)];
    await settle(); f.publish("A"); await settle();
    const pending = gates(t, f, 2); f.publish("B");
    const seen = watches.map(events);
    pending[rejectIndex].resolve(false); await settle();
    const denial = watches[rejectIndex].getSnapshot();
    pending[1 - rejectIndex].resolve(true); await settle();
    for (let i = 0; i < watches.length; i++) {
      assert.equal(watches[i].getSnapshot(), denial, "success started before shared refusal cannot restore B");
      assert.deepEqual(seen[i], [denial]);
    }
    // A check started after the refusal can recover every facade, including the rejecter.
    const newer = gates(t, f, 2); f.publish("C"); newer[1 - rejectIndex].resolve(true); await settle();
    assert.equal(watches[rejectIndex].getSnapshot().data, "C");
    assert.equal(watches[0].getSnapshot(), watches[1].getSnapshot());
    assert.equal(seen[rejectIndex].at(-1), watches[rejectIndex].getSnapshot());
    newer[rejectIndex].resolve(true); await settle();
    watches.forEach(watch => watch.close());
  });

  test(`opening adopts the shared denial once when its check also refuses, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default"), first = f.client.observe(q, {}, opts);
    await settle(); f.publish("A"); await settle();
    const [replacement, opening] = gates(t, f, 2); f.publish("B");
    const remount = f.client.observe(q, {}, opts), seen = events(remount);
    replacement.resolve(false); await settle();
    const denial = first.getSnapshot();
    assert.equal(remount.getSnapshot(), denial);
    assert.deepEqual(seen, [denial], "the opening getter reports the shared denial in its callback");
    opening.resolve(false); await settle();
    assert.equal(remount.getSnapshot(), denial);
    assert.deepEqual(seen, [denial], "the same failed opening does not manufacture a second denial");
    first.close(); remount.close();
  });

  for (const opening of [false, true]) test(`a ${opening ? "opening" : "replacement"} refusal after close clears live peers, keep=${keep}`, async t => {
    const f = fixture(t, keep ?? "default"), first = f.client.observe(q, {}, opts);
    await settle(); f.publish("A"); await settle();
    let waiter, late;
    if (opening) {
      [late] = gates(t, f, 1); waiter = f.client.observe(q, {}, opts);
      f.publish("B"); await settle();
    } else {
      waiter = f.client.observe(q, {}, opts); await settle();
      const pending = gates(t, f, 2); late = pending[1]; f.publish("B");
      pending[0].resolve(true); await settle();
    }
    assert.equal(first.getSnapshot().data, "B");
    const seen = events(first), closedSeen = events(waiter);
    waiter.close(); late.resolve(false); await settle();
    const denial = first.getSnapshot();
    assert.equal(denial.denied?.code, "E_AUTH", "closed handle's refusal still revokes shared approval");
    assert.deepEqual(seen, [denial]);
    assert.deepEqual(closedSeen, []);
    first.close();
  });
}

for (const keep of [undefined, true]) for (const closeBeforeReload of [false, true]) {
  test(`closed facade follows same identity's revalidation (close before=${closeBeforeReload}), keep=${keep}`, async t => {
    let host = 1000; t.mock.method(Date, "now", () => host);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts), peer = f.client.observe(q, {}, opts);
    await settle(); f.publish("A", { server: 9000 }); await settle();
    const original = watch.getSnapshot(), seen = events(watch);
    f.hold();
    if (closeBeforeReload) watch.close();
    f.owner().reload(); for (const notify of f.owner().subscribers) notify();
    if (!closeBeforeReload) watch.close();
    const closedCalls = seen.length, current = watch.getSnapshot();
    assert.equal(answerIdentity(current), answerIdentity(original));
    assert.equal(current, peer.getSnapshot());
    assert.equal(current.revalidating, true);
    assert.equal(episodeDeadline(current), keep ? undefined : 2000);
    host = 2000;
    if (keep) assert.equal(watch.getSnapshot(), current);
    else assert.deepEqual(watch.getSnapshot(), { loading: true });
    assert.equal(seen.length, closedCalls);
    peer.close();
  });
}

for (const keep of [undefined, true]) test(`release fences pending authority before raw callback delivery, keep=${keep}`, async t => {
  const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
  const watch = f.client.observe(q, {}, opts);
  await settle(); f.publish("A"); await settle();
  const [pending] = gates(t, f, 1); f.publish("B");
  f.owner().reset({ data: "C", complete: true, fresh: true, cut: null, next: null });
  const withdrawal = watch.getSnapshot(); assert.deepEqual(withdrawal, { loading: true });
  pending.resolve(true); await settle();
  assert.equal(watch.getSnapshot(), withdrawal, "release invalidates the check before raw subscribers run");
  watch.close();
});

test("closed captured episode enforces its deadline even when the source copy has none", async t => {
  let host = 1000; t.mock.method(Date, "now", () => host);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(t, "default"), watch = f.client.observe(q, {}), peer = f.client.observe(q, {});
  await settle(); f.publish("A"); await settle();
  const original = f.owner().snapshot;
  f.hold(); f.owner().reload(); for (const notify of f.owner().subscribers) notify();
  assert.equal(episodeDeadline(watch.getSnapshot()), 2000);
  watch.close();
  // Isolate the facade's cap: the detached source supplies an earlier copy of the
  // same identity with no episode. No source accessor or timer can mask the check.
  t.mock.method(f.owner(), "read", () => original);
  host = 1500; assert.equal(answerIdentity(watch.getSnapshot()), answerIdentity(original));
  host = 2000;
  const loading = watch.getSnapshot(); assert.deepEqual(loading, { loading: true });
  host = 1000; assert.equal(watch.getSnapshot(), loading, "rollback never revives a closed episode");
  peer.close();
});

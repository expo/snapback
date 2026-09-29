import { readyRead } from "../dist/read-presence.js";
// @ref LLP 3000.023#6 — policy, progress, deadline access and facade evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { ReadObservation, answerIdentity } from "../dist/read-observation.js";
import { episodeDeadline } from "../dist/read-episode.js";
import { LocalReads } from "../dist/local-reads.js";
import { bindWatchPeek, closeWatchAnswers, observeWatch, observationKey, peekObservation } from "../dist/observe-watch.js";
import { deferReadNotifications } from "../dist/read-notifications.js";
import { fixture } from "./helpers/authority-fixture.mjs";
const q = { kind: "query", name: "read" };
const ready = data => (readyRead({ data, complete: true, cut: null, fresh: false, since: 500, next: null }));
const why = { code: "HIDDEN", family: "rule", message: "hidden" };
async function until(check) { for (let n = 0; n < 500; n++) { if (check()) return; await delay(2); } assert.fail("read did not settle"); }

for (const keep of [undefined, true, false]) {
  for (const data of ["B", null, [], { denied: why }]) test(`replacement completes and clears revalidation: keep=${keep}, ${JSON.stringify(data)}`, async t => {
    let now = 1000; t.mock.method(Date, "now", () => now);
    const watch = new ReadObservation(keep), gate = Promise.withResolvers();
    watch.publish(ready("A")); const identity = answerIdentity(watch.snapshot);
    const work = watch.fetch(() => gate.promise, () => {});
    if (keep === false) assert.deepEqual(watch.read(null), { loading: true });
    else {
      assert.deepEqual(watch.read(null), { ...ready("A"), revalidating: true });
      assert.equal(answerIdentity(watch.snapshot), identity);
      now = 1999; watch.reload();
      assert.equal(episodeDeadline(watch.snapshot), undefined);
    }
    const replacement = data?.denied ? data : ready(data);
    gate.resolve({ read: replacement }); await work;
    assert.deepEqual(watch.read(null), replacement);
    assert.notEqual(answerIdentity(watch.snapshot), identity);
    watch.retire();
  });
  for (const failure of ["throw", "transportOffline", "retryExhausted", "retain:false", "loading"]) {
    test(`failure policy and explicit withdrawals: keep=${keep}, ${failure}`, async t => {
      const watch = new ReadObservation(keep), gate = Promise.withResolvers();
      watch.publish(ready("A"));
      const result = { read: failure === "loading" ? { loading: true } : ready("B"), transportOffline: failure === "transportOffline" };
      const work = watch.fetch(() => gate.promise, () => {}, failure === "retryExhausted" ? { accept: () => false }
        : failure === "retain:false" ? { retain: false } : {});
      if (failure === "retain:false") assert.deepEqual(watch.read(null), { loading: true });
      if (failure === "throw") { gate.reject(Error("device unavailable")); await assert.rejects(work); }
      else { gate.resolve(result); await work; }
      const retained = keep !== false && ["throw", "transportOffline", "retryExhausted"].includes(failure);
      assert.deepEqual(watch.read(null), retained ? { ...ready("A"), revalidating: true }
        : failure === "retain:false" ? ready("B") : { loading: true });
      watch.retire();
    });
  }
}

for (const access of ["snapshot", "peek", "timer"]) test(`one stable episode withdrawal at the deadline via ${access}, late success still lands`, async t => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watches = new Map(), raw = { observe() {} }, key = observationKey(q, {});
  bindWatchPeek(raw, watches, () => null);
  const handle = observeWatch(watches, key, () => Object.assign(new ReadObservation(), {
    key, subscribers: new Set(), presenceRefresh: null,
  }), () => {}, () => {}, () => null);
  const watch = watches.get(key), gate = Promise.withResolvers();
  watch.publish(ready("A")); watch.reload(true);
  let notifications = 0; handle.subscribe(() => notifications++);
  const work = watch.fetch(() => gate.promise, () => {});
  const deadline = episodeDeadline(handle.getSnapshot()), reset = watch.resetVersion;
  now = 1500; watch.reload(); now = 1999; watch.reload();
  assert.equal(episodeDeadline(watch.snapshot), deadline, "bursts never restart the episode");
  now = 2000;
  if (access === "timer") t.mock.timers.tick(1000);
  const get = () => access === "peek" ? peekObservation(raw, q, {}) : handle.getSnapshot();
  const loading = get();
  assert.deepEqual(loading, { loading: true });
  assert.equal(get(), loading); assert.equal(get(), loading);
  assert.equal(notifications, 1); assert.equal(watch.resetVersion, reset);
  now = 1000; assert.equal(get(), loading, "rollback never restores the answer");
  gate.resolve({ read: ready("late B") }); await work;
  assert.equal(get().data, "late B", "deadline did not retire the read in flight");
  handle.close();
});

for (const keep of [undefined, true]) test(`successful fallback and held composition keep the same episode: keep=${keep}`, async t => {
  let now = 1000; t.mock.method(Date, "now", () => now);
  const watch = new ReadObservation(keep), server = Promise.withResolvers();
  watch.publish(ready("A")); watch.reload();
  const work = watch.fetch(() => server.promise, () => {}, { publishResult: false });
  server.resolve({ read: ready("B") }); await work;
  now = 1999;
  assert.equal(watch.read(null).data, "A", "server success does not withdraw while the later device read is held");
  assert.equal(watch.read(null).revalidating, true);
  now = 5000; assert.equal(watch.read(null).data, "A");
  watch.publish(ready("composed B"));
  assert.equal(watch.read(null).data, "composed B");
  assert.equal(watch.read(null).revalidating, undefined);
  watch.retire();
});

for (const order of [[undefined, false, true], [true, false, undefined]]) test(`three watch keys and lifetimes in acquisition order ${order}`, t => {
  const watches = new Map(), raw = { observe() {} };
  bindWatchPeek(raw, watches, () => null);
  const open = keep => {
    const options = keep === undefined ? undefined : { keep }, key = observationKey(q, {}, options);
    return observeWatch(watches, key, () => Object.assign(new ReadObservation(keep), {
      key, subscribers: new Set(), presenceRefresh: null,
    }), watch => watch.publish(ready(String(keep))), () => {}, () => null);
  };
  const handles = order.map(open);
  assert.equal(watches.size, 3);
  const joined = order.map(open);
  joined.forEach((handle, i) => assert.equal(handle.getSnapshot(), handles[i].getSnapshot()));
  for (const watch of watches.values()) watch.reload();
  order.forEach((keep, i) => assert.equal(handles[i].getSnapshot().revalidating, keep === false ? undefined : true));
  handles.forEach(handle => handle.close()); joined.forEach(handle => handle.close());
  assert.equal(watches.size, 1);
  assert.equal(peekObservation(raw, q, {}), undefined);
  assert.equal(peekObservation(raw, q, {}, { keep: false }), undefined);
  assert.equal(peekObservation(raw, q, {}, { keep: true }).data, "true");
  for (const watch of watches.values()) watch.lingering.close();
});

for (const operation of ["clear_rows", "settle_exit", "adopt", "observe_store"]) test(`${operation} resets every retention policy and fences old reads`, async () => {
  const reads = new LocalReads();
  for (const keep of [undefined, false, true]) {
    const watch = Object.assign(new ReadObservation(keep), { presenceRefresh: null }), gate = Promise.withResolvers();
    watch.publish(ready("A"));
    const work = watch.fetch(() => gate.promise, () => {});
    reads.committed([watch], operation);
    assert.deepEqual(watch.read(null), { loading: true });
    gate.resolve({ read: ready("obsolete") }); await work;
    assert.deepEqual(watch.read(null), { loading: true });
  }
});

for (const keep of [undefined, true]) for (const withdrawal of ["expiry", "loading", "transportOffline", "retain:false", "reset", "denied"]) {
  test(`facade and opening remount share source ${withdrawal}, keep=${keep}`, async t => {
    const opts = keep === undefined ? undefined : { keep }, f = fixture(t, keep ?? "default");
    const watch = f.client.observe(q, {}, opts);
    await until(() => f.owner());
    f.publish("A", { server: 3000 }); await until(() => watch.getSnapshot().data === "A");
    f.hold(); f.publish("B", { server: 1100 });
    const joined = f.client.observe(q, {}, opts), seen = [];
    joined.subscribe(() => seen.push(joined.getSnapshot()));
    assert.equal(joined.getSnapshot().data, "A");
    if (withdrawal === "expiry") f.clock.sample(1100, 1000, 1000, "clock:1");
    if (withdrawal === "loading") f.owner().publish({ loading: true });
    if (withdrawal === "reset") f.owner().reset({ loading: true });
    if (withdrawal === "denied") f.owner().publish({ denied: why });
    if (withdrawal === "transportOffline") f.owner().reload(true);
    if (withdrawal === "transportOffline") await f.owner().fetch(async () => ({ read: ready("C"), transportOffline: true }), () => {});
    if (withdrawal === "retain:false") {
      const gate = Promise.withResolvers(), pending = f.owner().fetch(() => gate.promise, () => {}, { retain: false });
      assert.deepEqual(joined.getSnapshot(), { loading: true });
      gate.resolve({ read: { loading: true } }); await pending;
    }
    assert.ok(!("data" in watch.getSnapshot()));
    assert.ok(!("data" in joined.getSnapshot()));
    assert.ok(!peekObservation(f.client, q, {}, opts)?.data);
    assert.ok(seen.some(read => !("data" in read)), "opening remount notified before authority resumes");
    joined.close(); watch.close();
  });
}

test("facade inherits A's episode timestamp from the invalidation, through B and C authority", async t => {
  let now = 1000; t.mock.method(Date, "now", () => now);
  const f = fixture(t, "default"), watch = f.client.observe(q, {});
  await until(() => f.owner());
  f.owner().publish(ready("A"));
  for (const listener of f.owner().subscribers) listener();
  await until(() => watch.getSnapshot().data === "A");
  f.hold(); f.owner().reload(true);
  assert.equal(watch.getSnapshot().fresh, false); assert.equal(watch.getSnapshot().since, 500);
  now = 1900; f.publish("B");
  now = 1950; f.publish("C");
  assert.equal(episodeDeadline(watch.getSnapshot()), 2000);
  assert.equal(watch.getSnapshot().revalidating, true);
  now = 2000;
  const loading = peekObservation(f.client, q, {});
  assert.deepEqual(loading, { loading: true });
  assert.equal(watch.getSnapshot(), loading);
  f.release(); await until(() => watch.getSnapshot().data === "C");
  assert.equal(watch.getSnapshot().revalidating, undefined);
  watch.close();
});

test("an early episode timer rearms to the original deadline without accessor help", t => {
  let wall = 1000, notifications = 0;
  t.mock.method(Date, "now", () => wall);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watch = new ReadObservation();
  watch.onWithdrawal = () => notifications++;
  watch.publish(ready("A")); watch.reload(true);
  wall = 1500; t.mock.timers.tick(1000); // First delivery is early in the host clock.
  assert.equal(watch.snapshot.data, "A"); assert.equal(notifications, 0);
  wall = 2000; t.mock.timers.tick(500);
  assert.deepEqual(watch.snapshot, { loading: true });
  assert.equal(notifications, 1);
});

for (const keep of [undefined, false, true]) test(`facade withdrawal notifies once, including an opening remount, keep=${keep}`, async t => {
  let wall = 1000;
  t.mock.method(Date, "now", () => wall);
  const f = fixture(t, keep ?? "default"), options = keep === undefined ? undefined : { keep };
  const watch = f.client.observe(q, {}, options);
  await until(() => f.owner());
  f.publish("A"); await until(() => watch.getSnapshot().data === "A");
  f.hold();
  const opening = f.client.observe(q, {}, options), seen = [], joined = [];
  watch.subscribe(() => seen.push(watch.getSnapshot()));
  opening.subscribe(() => joined.push(opening.getSnapshot()));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  if (keep === undefined) {
    f.owner().reload(true);
    assert.equal(watch.getSnapshot().revalidating, true);
    assert.equal(opening.getSnapshot().revalidating, true);
    seen.length = 0; joined.length = 0;
    wall = 2000; t.mock.timers.tick(1000);
  } else {
    f.owner().publish({ loading: true });
    for (const subscriber of f.owner().subscribers) subscriber();
  }
  assert.deepEqual(seen, [{ loading: true }], "one facade callback for one withdrawal");
  if (keep !== false) assert.deepEqual(joined, [{ loading: true }], "the opening remount still receives the shared withdrawal");
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  opening.close(); watch.close();
});

test("closeWatchAnswers notifies each raw subscriber exactly once after withdrawing every peer", () => {
  const watches = new Map(), handles = [undefined, false, true].map(keep => {
    const key = observationKey(q, {}, { keep });
    return observeWatch(watches, key, () => Object.assign(new ReadObservation(keep), {
      key, subscribers: new Set(), presenceRefresh: null,
    }), watch => watch.publish(ready("A")), () => {}, () => null);
  });
  const seen = handles.map(() => [[], []]);
  handles.forEach((handle, i) => seen[i].forEach(events => handle.subscribe(() => events.push(handles.map(peer => peer.getSnapshot())))));
  const denied = { code: "E_CLOSED", family: "client", message: "closed" };
  const deliver = closeWatchAnswers(watches, denied);
  assert.deepEqual(seen, handles.map(() => [[], []]), "close collects notifications until its caller delivers");
  deliver();
  for (const listeners of seen) for (const events of listeners) {
    assert.deepEqual(events, [handles.map(() => ({ denied }))], "each subscriber receives one complete withdrawal");
  }
  handles.forEach(handle => handle.close());
});

test("an episode due inside a grouped commit waits until the settled peer is revalidating", t => {
  let wall = 1000, phase = "before";
  t.mock.method(Date, "now", () => wall);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const watches = new Map(), handles = ["A", "B"].map(name => {
    const key = observationKey(q, { name });
    return observeWatch(watches, key, () => Object.assign(new ReadObservation(), {
      key, subscribers: new Set(), presenceRefresh: null,
    }), watch => watch.publish(ready(name)), () => {}, () => null);
  });
  const [a, b] = [...watches.values()], seen = [];
  a.reload(true);
  handles[0].subscribe(() => seen.push({ phase, first: a.snapshot, peer: b.snapshot }));
  wall = 2000; phase = "inside";
  const deliver = deferReadNotifications(() => new LocalReads().committed(watches.values(), "apply"));
  assert.deepEqual(seen, [], "episode expiry must not notify in the middle of the commit loop");
  phase = "after"; deliver();
  assert.deepEqual(seen, [{ phase: "after", first: { loading: true }, peer: { ...ready("B"), revalidating: true } }]);
  handles.forEach(handle => handle.close());
});

for (const keep of [undefined, true]) test(`online change bounds an older facade hold through later source replacements, keep=${keep}`, async t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const f = fixture(t, keep ?? 'default'), watch = f.client.observe(q, {}, { keep });
  await until(() => f.owner());
  f.publish('A'); await until(() => watch.getSnapshot().data === 'A');
  f.hold(); f.publish('B');
  now = 4000; assert.equal(watch.getSnapshot().data, 'A', 'plain authority wait is unbounded');
  f.owner().reload(true);
  assert.equal(episodeDeadline(watch.getSnapshot()), 5000, 'held A inherits the online evidence time');
  now = 4500; f.publish('C');
  now = 4900; f.publish('D');
  now = 5000; assert.deepEqual(watch.getSnapshot(), { loading: true }, 'successful source replacements cannot renew unchecked A');
  f.release(); await until(() => watch.getSnapshot().data === 'D'); watch.close();
});

for (const keep of [undefined, true]) for (const operation of ["apply", "admit", "settle"]) {
  test(`local ${operation} retains within a change episode, keep=${keep}`, t => {
    let now = 1000; t.mock.method(Date, "now", () => now);
    const watch = Object.assign(new ReadObservation(keep), { presenceRefresh: null });
    t.after(() => watch.retire()); watch.publish(ready("A"));
    new LocalReads().committed([watch], operation);
    assert.equal(episodeDeadline(watch.snapshot), 2000);
    now = 1999; assert.equal(watch.read(null).data, "A");
    assert.equal(watch.read(null).revalidating, true);
    watch.publish(ready(null)); assert.equal(watch.read(null).data, null);
  });
}

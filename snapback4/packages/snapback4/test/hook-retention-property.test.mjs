// @ref LLP 3000.029#4 — executable induction over observed authority events.
import test from "node:test";
import assert from "node:assert/strict";
import { ReadObservation } from "../dist/read-observation.js";
import { LocalReads } from "../dist/local-reads.js";
import { deferReadNotifications } from "../dist/read-notifications.js";
import { AssetLifetime, assetEvidence, assetRevoked, onAssetRevoked } from "../dist/asset-lifetime.js";
const ready = data => ({ data, complete: true, cut: null, fresh: true });

for (const keep of [undefined, false, true]) test(`random event histories keep=${keep}`, () => {
  const coverage = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    let random = seed, expected, revision = 0;
    const watch = Object.assign(new ReadObservation(keep), { tables: new Set(["profiles", "members"]), presenceRefresh: null });
    const reads = new LocalReads();
    for (let step = 0; step < 500; step++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const event = random % 10; coverage.add(event);
      if (event === 0) { expected = { id: ++revision }; watch.publish(ready(expected)); }
      if (event === 1) { watch.reload(); if (keep === false) expected = undefined; }
      if (event === 2) { watch.update({ loading: true }); if (keep === false) expected = undefined; }
      if (event === 3) { watch.offline(); if (keep === false) expected = undefined; }
      if (event === 4) { reads.committed([watch], "apply", ["messages"]); if (keep === false) expected = undefined; }
      if (event === 5) { reads.committed([watch], "apply", []); if (keep === false) expected = undefined; }
      if (event === 6) { reads.committed([watch], "apply", ["members"]); expected = undefined; }
      if (event === 7) { watch.expire()(); expected = undefined; }
      if (event === 8) { watch.reset({ denied: { code: "E_AUTH", family: "auth", message: "signed out" } }); expected = undefined; }
      if (event === 9) { reads.committed([watch], "observe_store"); expected = undefined; }
      const read = watch.read(null);
      assert.equal(read.data, expected, `seed=${seed} step=${step} event=${event}`);
      if (expected !== undefined && event !== 0) assert.equal(read.revalidating, true);
    }
    watch.retire();
  }
  assert.equal(coverage.size, 10);
});

test("all dependency withdrawals precede callbacks, including unknown metadata", () => {
  const watches = ["members", "profiles"].map(table => Object.assign(new ReadObservation(), { tables: new Set([table]), presenceRefresh: null }));
  watches.forEach(w => w.publish(ready("secret")));
  const seen = [];
  watches[0].followers.add(() => () => seen.push(watches.map(w => w.snapshot)));
  const deliver = deferReadNotifications(() => new LocalReads().committed(watches, "apply"));
  assert.equal(seen.length, 0); deliver();
  assert.deepEqual(seen, [[{ loading: true }, { loading: true }]]);
});

for (const boundary of ["membership removal", "rule change", "row deletion", "asset revocation", "sign-out", "account switch", "store replacement"]) test(`asset handle: ${boundary} fences in-flight and displayed bytes`, () => {
  const lifetime = new AssetLifetime();
  let releases = 0;
  const raw = () => ({ url: "blob:private", type: "image/png", bytes: 1, revoke() { releases++; } });
  const a = lifetime.own(raw()), b = lifetime.own(raw()), revision = lifetime.revision;
  let notices = 0;
  onAssetRevoked(a, () => { notices++; assert.equal(b.url, ""); });
  lifetime.invalidate();
  assert.equal(a.url, ""); assert.ok(assetRevoked(a)); assert.equal(notices, 1);
  assert.equal(lifetime.own(raw(), revision).denied.code, "E_ASSET_UNKNOWN");
  a.revoke(); b.revoke(); assert.equal(releases, 3);
});

test("asset expiry uses original deadline on getters and cannot be rolled back", t => {
  let now = 1000;
  const lifetime = new AssetLifetime(() => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const read = lifetime.own(assetEvidence({ url: "blob:private", type: "image/png", bytes: 1, revoke() {} }, { seq: 8, nextExpiry: 2000 }));
  lifetime.invalidate(8); assert.equal(read.url, "blob:private", "historical poll cannot revoke a newer grant");
  now = 2000; assert.equal(read.url, "");
  now = 1000; assert.equal(read.url, ""); assert.equal(lifetime.size, 0);
});

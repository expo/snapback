// Authentic old compiler/wasm stores, not current schemas with deleted stamps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openLocalDevice } from '../dist/local-backend.js';
import { memoryPersistence, webDevice } from '../dist/web.js';
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const root = new URL('../../../crates/snapback4-lang/tests/fixtures/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const json = name => JSON.parse(read(name));
const ok = result => { assert.ok(!result.denied, JSON.stringify(result)); return result.ok; };
const now = 4_000_000_000_000;
for (const version of ['0411', '0412']) test(`authentic ${version} saveProfile: legacy semantics refuse until current adoption`, async () => {
  const path = `rp-profile-upgrade/${version}/`;
  const old = read(path + 'backend-schema.part') + read(path + 'backend-programs.part');
  assert.equal(JSON.parse(old).schema.operations.saveProfile.predicts, 'eligible');
  assert.equal(JSON.parse(old).schema.source_reservations, undefined);
  const kept = [{ s: 'm', k: 'device:backend', v: old }, ...json(path + 'acquired.json'), ...json(path + 'pending.json')];
  const current = { generation: 1, schema: json(`rp-calibrations/${version}/schema.json`), programs: json(`rp-calibrations/${version}/programs.json`) };
  const persist = memoryPersistence();
  await persist.save(version, kept);
  const opener = webDevice({ wasm, persist });
  await assert.rejects(openLocalDevice(opener, version, current), /E_SCHEMA_CAPABILITY.*maintained-id-sha256-v1/);
  // The refused kept open is read-only. Supplying the server's current bundle
  // performs the semantic upgrade while preserving the authentic old outbox.
  let d = await opener.open(version, current);
  const entry = (name, seq) => ({ id: `profile-${name}`, seq, op: 'saveProfile', viewer: 'alice', now,
    new_ids: [], predicted: [], predictable: true,
    args: { displayName: name, handle: 'alice', bio: 'A new bio', location: 'Berlin', link: null } });
  try {
    const queued = () => d.call({ op: 'queued' }).then(ok);
    assert.equal((await queued())[0].id, 'profile-before-upgrade');
    const q = ok(await d.call({ op: 'admit', entry: entry('offline', 2) }));
    assert.equal(q.predictable, true);
    assert.equal(q.predicted.length, 1);
    const before = (await queued()).map(({ id, args }) => ({ id, args }));
    assert.equal(before.length, 2);
    // Reopening now uses the adopted current backend and preserves custody.
    await d.close();
    d = await openLocalDevice(opener, version, current);
    assert.deepEqual((await queued()).map(({ id, args }) => ({ id, args })), before);
    ok(await d.call({ op: 'adopt', backend: current }));
    assert.deepEqual((await queued()).map(({ id, args }) => ({ id, args })), before);
    const after = ok(await d.call({ op: 'admit', entry: entry('online', 3) }));
    assert.equal(after.predictable, true);
    assert.equal(after.predicted.length, 1);
    // Re-executed against the real server by profile_upgrade.rs every suite.
    const settlement = json(path + 'settlement.json');
    for (const receipt of settlement.receipts) ok(await d.call({ op: 'settle', ...receipt }));
    for (const [i, page] of settlement.pages.entries()) ok(await d.call({ op: 'apply', first: i === 0, page }));
    assert.deepEqual(await queued(), []);
    const profile = ok(await d.call({ op: 'query', name: 'profile', args: { handle: 'alice' }, viewer: 'alice', now }));
    assert.equal(profile.data.displayName, 'online');
    assert.notEqual(profile.data.pending, true);
  } finally { await d.close(); }
});

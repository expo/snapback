// Assertions about observations, not a test of the unimplemented proposal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => JSON.parse(readFileSync(new URL('results/' + name, import.meta.url), 'utf8'));
for (const version of ['published', 'main']) {
  const lines = readFileSync(new URL(`results/${version}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
  const get = stage => { const x = lines.find(x => x.stage === stage); assert.ok(x, stage); return x; };
  assert.equal(get('finished').pass, true);
  const before = get('history-before-leave').read.data.map(x => x.id);
  assert.equal(before.length, 1);
  assert.deepEqual(get('history-server-after-leave').read.data, []);
  assert.equal(get('history-server-after-leave').guarded.denied.code, 'NOT_MEMBER');
  for (const stage of ['history-local-online-after-leave', 'history-held-online-after-leave', 'history-offline-after-leave-history', 'history-offline-after-leave-historyHeld']) {
    assert.deepEqual(get(stage).read.data.map(x => x.id), before);
    assert.deepEqual(get(stage).requests, []);
    assert.equal(get(stage).device[0].answer.retained, true);
  }
  assert.equal(get('history-rejoined').read.data.length, 2);
  assert.deepEqual(get('absence-offline-p19RawState').read, { loading: true });
  assert.deepEqual(get('composed-absence-offline').read, { loading: true });
  assert.deepEqual(get('absence-no-pending').pending, []);
  assert.deepEqual(get('absence-offline-postState').read.data, { liked: false, reposted: false });
  assert.equal(get('absence-offline-postState').read.complete, true);
  assert.deepEqual(get('present-own-keys-offline').read.data, { liked: true, reposted: true });
  assert.deepEqual(get('retained-search-offline-searchNewest').read.data, []);
  assert.deepEqual(get('retained-search-offline-searchHeld').read.data.map(x => x.id), before);
  assert.equal(get('scale-server-searchHeld').read.denied.code, 'E_QUERY_HELD');
  assert.equal(get('scale-server-searchNewest').read.data.length, 20);
  assert.equal(get('scale-server-searchNewest').read.complete, true);
  assert.deepEqual(get('scale-server-p19SearchOrdinary').read.data, []);
  assert.equal(get('scale-server-p19SearchOrdinary').read.complete, false);
  for (const op of ['searchNewest', 'searchHeld', 'p19SearchOrdinary']) {
    assert.equal(get('scale-offline-' + op).read.data.length, 20);
    assert.equal(get('scale-offline-' + op).read.complete, false);
    assert.equal(get('scale-offline-' + op).read.fresh, false);
  }
  for (const [name, code] of [['aggregate-explicit-sync', 'E_QUARRY_SYNTAX'], ['aggregate-narrow-read', 'E_SYNC'], ['digest-query', 'E_QUARRY_BOUND']]) {
    const d = read(`${version}-${name}.json`);
    assert.equal(d.ok, false); assert.ok(d.problems.some(p => p.code === code));
  }
  const pilot = read(version + '-own-keys.json');
  assert.equal(pilot.at(-1).pass, true);
  for (const stage of ['absent', 'present', 'synced-delete-offline']) {
    const r = pilot.find(x => x.stage === stage).read;
    assert.equal(r.complete, true); assert.equal(r.fresh, false);
    assert.equal(r.data.liked, stage === 'present');
  }
  console.log(`${version}: history, search, absence, diagnostics and owner-key controls match`);
}

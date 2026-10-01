import { hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverTimeline} from './helpers/timeline-recovery.mjs';

test('oversized historical timeline commit recovers by snapshot with pending writes on both hosts', {timeout:hangBudget(1020)}, async t=>{
  const report=await recoverTimeline();
  assert.equal(report.ceiling,16_777_216);
  assert.equal(report.sameGeneration,true);
  assert.equal(report.originalCommitEvents,1024);
  assert.deepEqual(report.serverFollowing.map(r=>r.postId).sort(),["original","pending-native-sqlite","pending-wasm-memory"]);
  assert.ok(report.historicalCommitMinimumBytes>report.ceiling);
  assert.ok(report.largestUpdateBytes<report.ceiling);
  assert.deepEqual(report.devices.map(d=>d.host).sort(),['native-sqlite','wasm-memory']);
  for(const device of report.devices) {
    assert.equal(device.restartLimit,1);
    assert.equal(device.restartFrom,0);
    assert.equal(device.restartSnapshot,true);
    assert.equal(device.pendingBefore.length,1);
    assert.equal(device.recoveredNotes,1020);
    assert.equal(device.settledNotes,1020);
    assert.ok(device.heldSubmissions>0);
    // @ref LLP 3000.019#3.3 — retryable delivery may change presentation
    // status while snapshot recovery must retain every original intent field.
    const intent = ({ dispatch, ...entry }) => entry;
    assert.deepEqual(device.pendingAfter.map(intent),device.pendingBefore.map(intent));
    assert.deepEqual(device.finalFollowing,report.serverFollowing);
  }
  t.diagnostic(JSON.stringify(report));
});

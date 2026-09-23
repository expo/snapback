import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverTimeline} from './helpers/timeline-recovery.mjs';

test('oversized historical timeline commit recovers by snapshot with pending writes on both hosts', {timeout:240000}, async t=>{
  const report=await recoverTimeline();
  assert.equal(report.ceiling,16_777_216);
  assert.ok(report.historicalCommitMinimumBytes>report.ceiling);
  assert.ok(report.largestUpdateBytes<report.ceiling);
  assert.deepEqual(report.devices.map(d=>d.host).sort(),['native-sqlite','wasm-memory']);
  for(const device of report.devices) {
    assert.equal(device.restartLimit,1);
    assert.equal(device.restartFrom,0);
    assert.equal(device.restartSnapshot,true);
    assert.equal(device.pendingBefore.length,1);
    assert.deepEqual(device.pendingAfter,device.pendingBefore);
    assert.deepEqual(device.finalFollowing,report.serverFollowing);
  }
  t.diagnostic(JSON.stringify(report));
});

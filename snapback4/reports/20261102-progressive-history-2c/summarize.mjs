import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const median = values => [...values].sort((a, b) => a - b)[1];
const root = import.meta.dirname;
const fixture = process.argv[2] ?? 'default';
const modes = {};
const allRuns = [];
for (const mode of ['progressive', 'legacy']) {
  const runs = [1, 2, 3].map(run => JSON.parse(readFileSync(join(root, `${fixture}-${mode}-${run}.json`), 'utf8')));
  assert.ok(runs.every(run => run.ok && run.checkpoints.inbox.offlineReopen.ok && run.checkpoints.foreground.offlineReopen.ok));
  allRuns.push(...runs);
  modes[mode] = {
    individual: runs.map(run => ({ run: run.run, inboxMs: run.checkpoints.inbox.ms, foregroundMs: run.checkpoints.foreground.ms, fullAcquisitionMs: run.fullAcquisitionMs, peakJsHeapBytes: run.peakJsHeapBytes, loadBefore: run.host.loadBefore, loadAfter: run.host.loadAfter, sync: run.sync })),
    median: { syncRequests: median(runs.map(run => run.sync.pages)), inboxMs: median(runs.map(run => run.checkpoints.inbox.ms)), foregroundMs: median(runs.map(run => run.checkpoints.foreground.ms)), fullAcquisitionMs: median(runs.map(run => run.fullAcquisitionMs)), peakJsHeapBytes: median(runs.map(run => run.peakJsHeapBytes)) },
  };
}
const first = JSON.parse(readFileSync(join(root, `${fixture}-progressive-1.json`), 'utf8'));
for (const run of allRuns) {
  assert.equal(run.host.node, 'v24.18.0');
  assert.equal(run.host.hostname, first.host.hostname);
  assert.equal(run.fixture.seedSha256, first.fixture.seedSha256);
  for (const path of ['packages/snapback4/src/wasm/snapback4_device_bg.wasm', 'target/debug/snapback4', 'apps/chat/snapback/schema.q']) {
    assert.equal(run.artifacts[path], first.artifacts[path], path);
  }
}
const summary = { at: new Date().toISOString(), witness: 'progressive-history-node-wasm-scale-summary', chunk: '2c', fixtureName: fixture, development: true, qualification: false, sourceCommit: first.sourceCommit, host: first.host, fixture: first.fixture, modes,
  fullAcquisitionMedianChangePercent: (modes.progressive.median.fullAcquisitionMs / modes.legacy.median.fullAcquisitionMs - 1) * 100,
  limits: first.limits, heapMeasurement: first.heapMeasurement, ok: true };
writeFileSync(join(root, `${fixture}-measurement-summary.json`), JSON.stringify(summary, null, 2) + '\n');
appendFileSync(join(root, '../../metrics/witness.jsonl'), JSON.stringify(summary) + '\n');
console.log(JSON.stringify({ fixture, medians: Object.fromEntries(Object.entries(modes).map(([mode, data]) => [mode, data.median])), fullAcquisitionMedianChangePercent: summary.fullAcquisitionMedianChangePercent, ok: true }));

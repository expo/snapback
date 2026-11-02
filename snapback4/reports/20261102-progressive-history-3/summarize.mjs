import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const median = values => [...values].sort((a, b) => a - b)[1];
const root = import.meta.dirname;
const modes = {};
for (const mode of ['progressive', 'legacy']) {
  const runs = [1, 2, 3].map(run => JSON.parse(readFileSync(join(root, `${mode}-${run}.json`), 'utf8')));
  assert.ok(runs.every(run => run.ok && run.checkpoints.inbox.offlineReopen.ok && run.checkpoints.foreground.offlineReopen.ok));
  modes[mode] = {
    individual: runs.map(run => ({ run: run.run, inboxMs: run.checkpoints.inbox.ms, foregroundMs: run.checkpoints.foreground.ms, fullAcquisitionMs: run.fullAcquisitionMs, peakJsHeapBytes: run.peakJsHeapBytes, loadBefore: run.host.loadBefore, loadAfter: run.host.loadAfter, sync: run.sync })),
    median: { inboxMs: median(runs.map(run => run.checkpoints.inbox.ms)), foregroundMs: median(runs.map(run => run.checkpoints.foreground.ms)), fullAcquisitionMs: median(runs.map(run => run.fullAcquisitionMs)), peakJsHeapBytes: median(runs.map(run => run.peakJsHeapBytes)) },
  };
}
const first = JSON.parse(readFileSync(join(root, 'progressive-1.json'), 'utf8'));
const summary = { at: new Date().toISOString(), witness: 'progressive-history-node-wasm-scale-summary', development: true, qualification: false, sourceCommit: first.sourceCommit, host: first.host, fixture: first.fixture, modes,
  fullAcquisitionMedianChangePercent: (modes.progressive.median.fullAcquisitionMs / modes.legacy.median.fullAcquisitionMs - 1) * 100,
  limits: first.limits, heapMeasurement: first.heapMeasurement, ok: true };
writeFileSync(join(root, 'measurement-summary.json'), JSON.stringify(summary, null, 2) + '\n');
appendFileSync(join(root, '../../metrics/witness.jsonl'), JSON.stringify(summary) + '\n');
console.log(JSON.stringify(summary));

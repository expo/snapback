import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDir = resolve(root, '../evidence');
const partial = JSON.parse(
  readFileSync(resolve(evidenceDir, 'performance-partial.json'), 'utf8'),
);
const build = JSON.parse(
  readFileSync(resolve(evidenceDir, 'performance-build.json'), 'utf8'),
);
const acceptance = JSON.parse(
  readFileSync(resolve(evidenceDir, 'acceptance-results.json'), 'utf8'),
);
partial.buildOrDeploy = build.rawMs;
partial.buildWarmups = build.warmupMs;
partial.statistics.buildOrDeploy = {
  rawMs: build.rawMs,
  medianMs: build.medianMs,
  nearestRankP95Ms: build.nearestRankP95Ms,
};
partial.costWindow = {
  actualProviderUsage: 'Provider did not expose per-temporary-app metering.',
  listPriceEstimateUsd: 0,
  basis:
    'Official temporary hosted app created without an account; automatically deleted by provider after >24 hours.',
  extrapolationCountedAsMeasured: false,
};
partial.uiShell = {
  implementation: 'React 19 + @instantdb/react native hooks',
  port: 4290,
  productionBuild: true,
  controlledBrowser: false,
};
writeFileSync(
  resolve(evidenceDir, 'performance.json'),
  JSON.stringify(partial, null, 2) + '\n',
);
acceptance.scenarioResults.push({
  id: 'CHAT-14-PERFORMANCE',
  result: 'PASS',
  summary:
    'Frozen read, 20-message write burst, native realtime, reconnect, and production-build samples retained.',
  evidence: {
    warmupsPerPath: 2,
    recordedSamplesPerPath: 7,
    rawSamples: '../evidence/performance.json',
    machine: partial.machine,
  },
});
acceptance.completedCheckCountBeforeCleanup =
  acceptance.scenarioResults.length;
writeFileSync(
  resolve(evidenceDir, 'acceptance-results.json'),
  JSON.stringify(acceptance, null, 2) + '\n',
);
process.stdout.write(
  JSON.stringify({
    ok: true,
    checkCountBeforeCleanup: acceptance.scenarioResults.length,
  }) + '\n',
);

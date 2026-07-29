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
const acceptancePath = resolve(evidenceDir, 'acceptance-results.json');
const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8'));
partial.rawSamples.buildOrDeploy = build.rawMs;
partial.buildWarmups = build.warmupMs;
partial.statistics.buildOrDeploy = {
  rawMs: build.rawMs,
  medianMs: build.medianMs,
  nearestRankP95Ms: build.nearestRankP95Ms,
};
partial.uiShell = {
  implementation: 'React 19 + @instantdb/react native hooks',
  port: 4325,
  productionBuild: true,
  controlledBrowser: true,
  browserEvidence: 'offline-smoke.json',
};
writeFileSync(
  resolve(evidenceDir, 'performance.json'),
  JSON.stringify(partial, null, 2) + '\n',
);
const performanceScenario = acceptance.scenarioResults.find(
  (scenario) => scenario.id === 'LINEAR-13-PERFORMANCE',
);
performanceScenario.evidence.buildWarmups = build.warmupMs.length;
performanceScenario.evidence.buildRecordedSamples = build.rawMs.length;
performanceScenario.evidence.rawReceipt = 'performance.json';
acceptance.completedCheckCountBeforeCleanup = acceptance.scenarioResults.length;
writeFileSync(acceptancePath, JSON.stringify(acceptance, null, 2) + '\n');
process.stdout.write(JSON.stringify({
  ok: true,
  checkCountBeforeCleanup: acceptance.scenarioResults.length,
  runtimePaths: 5,
  buildSamples: build.rawMs.length,
}) + '\n');

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMachineReport } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const resultRoot = resolve(repoRoot, 'demos/partiful-matrix/acceptance/results');
const output = option('out') ?? 'demos/partiful-matrix/acceptance/results/step0-native.json';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expected = new Set(
  ['swiftui', 'exact-contract'].flatMap((authoring) =>
    ['macos', 'ios'].flatMap((platform) =>
      ['snapback', 'supabase', 'convex', 'sqlite'].map(
        (backend) => `${authoring}:${platform}:${backend}`,
      ),
    ),
  ),
);

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
}

function child(name, file) {
  const bytes = readFileSync(resolve(resultRoot, file));
  return { name, file: `demos/partiful-matrix/acceptance/results/${file}`, sha256: sha256(bytes), report: JSON.parse(bytes) };
}

const report = {
  schemaVersion: 'partitime.native-baseline-aggregate.v1',
  claimId: 'STEP0.NATIVE_BASELINE',
  ok: false,
  outcome: 'fail',
  children: [],
  cells: [],
  workloadVersion: null,
  methodId: null,
  thresholdFormulaSetId: null,
};

try {
  const children = [
    child('swiftui', 'step0-native-swiftui.json'),
    child('exact-contract', 'step0-native-exact.json'),
  ];
  report.workloadVersion = children[0].report.workloadVersion;
  report.methodId = children[0].report.methodId;
  report.thresholdFormulaSetId = children[0].report.thresholdFormulaSetId;
  for (const entry of children) {
    assert.equal(entry.report.workloadVersion, report.workloadVersion, `${entry.name} workload differs`);
    assert.equal(entry.report.methodId, report.methodId, `${entry.name} method differs`);
    assert.equal(entry.report.thresholdFormulaSetId, report.thresholdFormulaSetId, `${entry.name} threshold formulas differ`);
    assert.equal(entry.report.ok, true, `${entry.name} child receipt did not pass`);
    assert.equal(entry.report.outcome, 'pass', `${entry.name} child outcome is not pass`);
    assert.equal(entry.report.claimId, 'STEP0.NATIVE_BASELINE', `${entry.name} is not a Step 0 receipt`);
    assert.equal(entry.report.claimEligible, true, `${entry.name} receipt is diagnostic-only`);
    assert.equal(entry.report.receiptPurpose, 'step0-native-baseline', `${entry.name} has the wrong receipt purpose`);
    assert.equal(entry.report.buildMode, 'fresh-xcode-build', `${entry.name} did not retain fresh Xcode builds`);
    assert.deepEqual(
      entry.report.buildResults.map(({ platform, status, timedOut }) => ({ platform, status, timedOut })),
      [
        { platform: 'macos', status: 0, timedOut: false },
        { platform: 'ios', status: 0, timedOut: false },
      ],
      `${entry.name} does not contain passing macOS and iOS build receipts`,
    );
    assert.equal(entry.report.cleanupErrors?.length ?? 0, 0, `${entry.name} child cleanup failed`);
    if (entry.name === 'exact-contract') {
      const exercisedIosBackends = entry.report.cells
        .filter(({ cell, ok }) => cell.startsWith('exact-contract:ios:') && ok)
        .map(({ cell }) => cell.split(':')[2])
        .sort();
      assert.deepEqual(
        entry.report.carrierCleanup?.map(({ backend }) => backend).sort(),
        exercisedIosBackends,
        'Exact child lacks one iOS termination receipt per exercised backend',
      );
      assert.ok(
        entry.report.carrierCleanup.every(({ status, timedOut }) => status === 0 && timedOut === false),
        'Exact child contains a failed iOS termination receipt',
      );
    }
    assert.match(entry.report.source?.snapbackRevision ?? entry.report.source?.snapback?.revision, /^[a-f0-9]{40}$/, `${entry.name} lacks a Snapback revision`);
    assert.match(entry.report.source?.exactRevision ?? entry.report.source?.exact?.revision, /^[a-f0-9]{40}$/, `${entry.name} lacks an Exact revision`);
    assert.ok(entry.report.environment?.os, `${entry.name} lacks environment identity`);
    assert.ok(entry.report.packages, `${entry.name} lacks package identity`);
    assert.equal(entry.report.cells.length, 8, `${entry.name} child did not run eight cells`);
    report.children.push({
      name: entry.name,
      path: entry.file,
      sha256: entry.sha256,
      schemaVersion: entry.report.schemaVersion,
      buildMode: entry.report.buildMode,
      buildResults: entry.report.buildResults,
      source: entry.report.source ?? null,
      packages: entry.report.packages,
      environment: entry.report.environment,
      backendHealth: entry.report.backendHealth,
      testInventory: entry.report.testInventory,
      binaries: entry.report.binaries,
      simulator: entry.report.simulator,
    });
    report.cells.push(...entry.report.cells.map(({ cell, ok, outcome, skipClass }) => ({
      cell,
      ok,
      ...(outcome === undefined ? {} : { outcome }),
      ...(skipClass === undefined ? {} : { skipClass }),
    })));
  }

  const actual = new Set(report.cells.map(({ cell }) => cell));
  assert.equal(actual.size, 16, 'native aggregate contains duplicate or missing cells');
  assert.deepEqual([...actual].sort(), [...expected].sort(), 'native aggregate cell inventory differs from the frozen 2×2×4 matrix');
    assert.ok(
      report.cells.every(({ ok, outcome, skipClass }) =>
        ok || (outcome === 'skip' && skipClass === 'remote-dependency')
      ),
      'one or more native cells failed outside the remote-dependency policy',
    );
  report.ok = true;
  report.outcome = 'pass';
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
}

writeMachineReport(resolve(repoRoot, output), report);
console.log(JSON.stringify(report));
process.exit(report.ok ? 0 : 1);

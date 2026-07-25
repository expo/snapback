import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const collector = resolve(here, 'step4-native-performance.mjs');

const releaseLane = {
  laneId: 'partitime.native-ios-release-simulator-hbc-agent-off.v1',
  buildConfiguration: 'Release',
  simulatorBuild: true,
  artifactMode: 'hermes-hbc',
  agentLoadedBeforeFirstFrame: false,
  debugOverlayEnabled: false,
  firstFrameObserver: 'native-host',
  authoritativeDataObserver: 'structured-product-marker',
};

function writeFixture(root, reactSample, exactSample) {
  const hostIdentity = { os: 'darwin-test', machine: 'fixture' };
  writeFileSync(resolve(root, 'react.json'), `${JSON.stringify({
    ok: true,
    profileId: 'react-expo/ios',
    repository: { sourceDirty: false },
    performance: { sample: reactSample },
  })}\n`);
  writeFileSync(resolve(root, 'exact.json'), `${JSON.stringify({
    ok: true,
    source: { snapback: { dirty: false }, exact: { dirty: false } },
    performance: { sample: exactSample },
  })}\n`);
  writeFileSync(resolve(root, 'inputs.json'), `${JSON.stringify({
    schemaVersion: 'partitime.native-performance-inputs.v1',
    platform: 'ios',
    hostIdentity,
    react: { hostIdentity, receipts: ['react.json'] },
    exact: { hostIdentity, receipts: ['exact.json'] },
  })}\n`);
}

test('native performance collector aggregates only comparable structured samples', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-native-performance-test-'));
  try {
    const sample = {
      definitionVersion: 'partitime.native-launch-stage.v2',
      lane: releaseLane,
      hermesEvaluationMs: 10,
      startupAssetWeightBytes: 100,
      coldLaunchMs: 20,
      firstAuthoritativeDataMs: 30,
    };
    writeFixture(root, sample, { ...sample, hermesEvaluationMs: 11 });
    const output = resolve(root, 'report.json');
    const child = spawnSync(process.execPath, [collector, '--quick', '--inputs', resolve(root, 'inputs.json'), '--out', output], {
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.claimEligible, false);
    assert.equal(report.cells['react-expo:ios:snapback'].aggregate.hermesEvaluationMs.p95, 10);
    assert.equal(report.cells['exact-contract:ios:snapback'].aggregate.hermesEvaluationMs.p95, 11);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native performance collector rejects a v2 sample from the wrong lane', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-native-performance-lane-test-'));
  try {
    const sample = {
      definitionVersion: 'partitime.native-launch-stage.v2',
      lane: releaseLane,
      hermesEvaluationMs: 10,
      startupAssetWeightBytes: 100,
      coldLaunchMs: 20,
      firstAuthoritativeDataMs: 30,
    };
    writeFixture(root, sample, {
      ...sample,
      lane: { ...releaseLane, buildConfiguration: 'Debug' },
    });
    const child = spawnSync(process.execPath, [
      collector,
      '--quick',
      '--inputs', resolve(root, 'inputs.json'),
      '--out', resolve(root, 'report.json'),
    ], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /did not attest the paired release lane/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

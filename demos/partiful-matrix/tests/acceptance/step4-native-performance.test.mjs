import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const collector = resolve(here, 'step4-native-performance.mjs');

test('native performance collector aggregates only comparable structured samples', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-native-performance-test-'));
  try {
    const hostIdentity = { os: 'darwin-test', machine: 'fixture' };
    const sample = {
      definitionVersion: 'partitime.native-launch-stage.v1',
      hermesEvaluationMs: 10,
      startupAssetWeightBytes: 100,
      coldLaunchMs: 20,
      firstAuthoritativeDataMs: 30,
    };
    const react = {
      ok: true,
      profileId: 'react-expo/ios',
      repository: { sourceDirty: false },
      performance: { sample },
    };
    const exact = {
      ok: true,
      source: { snapback: { dirty: false }, exact: { dirty: false } },
      performance: { sample: { ...sample, hermesEvaluationMs: 11 } },
    };
    writeFileSync(resolve(root, 'react.json'), `${JSON.stringify(react)}\n`);
    writeFileSync(resolve(root, 'exact.json'), `${JSON.stringify(exact)}\n`);
    writeFileSync(resolve(root, 'inputs.json'), `${JSON.stringify({
      schemaVersion: 'partitime.native-performance-inputs.v1',
      platform: 'ios',
      hostIdentity,
      react: { hostIdentity, receipts: ['react.json'] },
      exact: { hostIdentity, receipts: ['exact.json'] },
    })}\n`);
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

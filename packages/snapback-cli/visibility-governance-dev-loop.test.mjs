// Fresh-prime regression for the LLP 0234 D4 dev target-config path. Todo
// carries a governance activation record even with no active widening, so a
// successful managed bind proves the loop supplied a valid config rather than
// skipping activation validation. Rbac's minted carrier is exercised in the
// Node producer suite and Rust target-reader suite; its live boot currently has
// an inherited membership-grammar red outside this change.

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { generateApp, runDev } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repositoryRoot, 'target', 'debug', 'snapback');

test('freshly primed todo binds through snapback dev with an auto-minted config', async () => {
  assert(
    existsSync(runtimeBinary),
    `native snapback binary missing at ${runtimeBinary}; run scripts/bootstrap-ibex-runtime`,
  );
  const expectedAppId = 'todo';
  const backendRoot = join(repositoryRoot, 'demos', 'todo', 'snapback');
  const generated = await generateApp(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-governance-dev-loop-')));
  const stateRoot = join(scratch, '.snapback');
  let dev = null;
  try {
    dev = await runDev({
      backendDirectory: backendRoot,
      projectRoot: scratch,
      readyFile: join(stateRoot, 'dev.ready.json'),
      database: join(stateRoot, 'dev.sqlite3'),
      runtimeBinary,
      watch: true,
      serverStdio: ['ignore', 'ignore', 'ignore'],
      env: process.env,
    });
    assert.equal(dev.ok, true, JSON.stringify(dev.diagnostics));
    assert.equal(dev.state, 'generated-and-loaded');
    const health = await fetch(`${dev.serverUrl}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    const configPath = join(
      stateRoot,
      'visibility-governance-dev-target-config.json',
    );
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(config.targetClass, 'repository-local');
    assert.equal(config.verdict.providerProfile, 'repository-local-dev-mint-v1');
    assert.equal(
      config.verdict.deploymentIdentities.some(({ appId }) => appId === expectedAppId),
      true,
    );
    const initialEpoch = config.observerKeyEpoch;
    const restarted = await dev.verbs.restart({ requestId: 'governance-remint-restart' });
    assert.equal(restarted.ok, true, JSON.stringify(restarted.diagnostics));
    const restartEpoch = JSON.parse(readFileSync(configPath, 'utf8')).observerKeyEpoch;
    assert.notEqual(restartEpoch, initialEpoch, 'restart must remint a fresh observer key');

    const refreshed = await dev.verbs['dev-fresh']({ requestId: 'governance-remint-fresh' });
    assert.equal(refreshed.ok, true, JSON.stringify(refreshed.diagnostics));
    const freshEpoch = JSON.parse(readFileSync(configPath, 'utf8')).observerKeyEpoch;
    assert.notEqual(freshEpoch, restartEpoch, 'dev-fresh must remint a fresh observer key');
    console.log(`BOUND snapback-dev ${expectedAppId} ${dev.serverUrl}`);
  } finally {
    await dev?.close?.();
    if (dev !== null) console.log(`KILLED snapback-dev ${expectedAppId}`);
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('initial mint refusal is a typed generated-but-not-loaded result', async () => {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-governance-dev-refusal-')));
  const backendRoot = join(repositoryRoot, 'demos', 'todo', 'snapback');
  try {
    const refusal = Object.assign(
      new Error('test visibility governance development config mint refusal'),
      {
        code: 'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_REFUSED',
        details: { reason: 'test-refusal' },
      },
    );
    const result = await runDev({
      backendDirectory: backendRoot,
      projectRoot: scratch,
      runtimeBinary,
      watch: false,
      env: process.env,
      visibilityGovernanceDevEnvironment() {
        throw refusal;
      },
    });
    assert.equal(result.ok, false, JSON.stringify(result.diagnostics));
    assert.equal(result.state, 'generated-but-not-loaded', JSON.stringify(result.diagnostics));
    assert.equal(
      result.diagnostics[0].code,
      'SNAPBACK_VISIBILITY_GOVERNANCE_DEV_CONFIG_REFUSED',
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

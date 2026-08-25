import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { doctor } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback'),
);

test('doctor waits for sessions activation readiness before its legacy seed reset', async () => {
  assert.equal(
    existsSync(runtimeBinary),
    true,
    `native snapback binary missing at ${runtimeBinary}; run scripts/bootstrap-ibex-runtime or set SNAPBACK_RUNTIME_BINARY`,
  );
  const root = mkdtempSync(join(tmpdir(), 'snapback-doctor-seed-transition-'));
  const wrapper = join(root, 'snapback-transition-injector');
  const legacyResetMarker = join(root, 'legacy-reset-attempted');
  const activationReadyMarker = join(root, 'activation-ready');
  writeFileSync(wrapper, `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args[0] === 'start' && args.includes('--startup-artifacts')) {
  writeFileSync(${JSON.stringify(activationReadyMarker)}, 'startup carrier supplied\\n');
}
const legacySeedReset = args[0] === 'reset' && args.includes('--seed');
if (legacySeedReset) {
  appendFileSync(${JSON.stringify(legacyResetMarker)}, JSON.stringify(args) + '\\n');
}
if (legacySeedReset && !existsSync(${JSON.stringify(activationReadyMarker)})) {
  console.log(JSON.stringify({
    formatVersion: 'snapback.error-response.v1',
    diagnostic: {
      code: 'SNAPBACK_AUTH_MODE_PENDING',
      severity: 'error',
      subsystem: 'auth',
      message: 'app-data admission is closed for an injected auth-mode transition',
      details: {},
    },
  }, null, 2));
  process.exitCode = 5;
} else {
  const result = spawnSync(${JSON.stringify(runtimeBinary)}, args, {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
`);
  chmodSync(wrapper, 0o755);

  try {
    const report = await doctor({
      runtimeBinary: wrapper,
      env: { ...process.env, npm_config_offline: 'true' },
    });
    assert.equal(report.ok, true, JSON.stringify(report, null, 2));
    const bundleLoad = report.checks.find(
      ({ code }) => code === 'SNAPBACK_DOCTOR_BUNDLE_LOAD_OK',
    );
    assert.deepEqual(bundleLoad?.details?.activationReadiness, {
      requestedMode: 'sessions',
      signal: 'runtime-ready-file',
      timeoutMs: 15_000,
      startupCarrier: true,
    });
    assert.equal(
      existsSync(activationReadyMarker),
      true,
      'sessions doctor must establish generated artifacts before listener readiness',
    );
    assert.equal(
      existsSync(legacyResetMarker),
      true,
      'the transition injection must observe the doctor legacy seed reset',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

function writeTransitionWrapper(root, { staleGeneratedBinding = false } = {}) {
  const wrapper = join(root, 'snapback-transition-injector');
  const legacyResetMarker = join(root, 'legacy-reset-attempted');
  const activationReadyMarker = join(root, 'activation-ready');
  writeFileSync(wrapper, `#!/usr/bin/env node
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'start') {
    if (${JSON.stringify(staleGeneratedBinding)}) {
      const generated = join(process.cwd(), 'snapback', 'generated');
      const descriptorName = readdirSync(generated)
        .find((name) => /^app\\.descriptor\\.[0-9a-f]+\\.json$/u.test(name));
      if (!descriptorName) throw new Error('generated app descriptor not found');
      const manifestPath = join(generated, 'artifacts.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const graphRoot = resolve(generated, manifest.cache.graphPath);
      const descriptor = JSON.parse(readFileSync(join(graphRoot, descriptorName), 'utf8'));
      descriptor.api.queries.listTodos.expectedGeneration.bundleHash =
        'snapback.v1:sessions:function:sha256:' + '0'.repeat(64);
      const descriptorBytes = Buffer.from(JSON.stringify(descriptor));
      for (const root of [generated, graphRoot]) {
        writeFileSync(join(root, descriptorName), descriptorBytes);
      }
      const record = manifest.files.find(({ path }) => path === descriptorName);
      if (!record) throw new Error('generated app descriptor record not found');
      record.bytes = descriptorBytes.byteLength;
      record.sha256 = 'sha256:' + createHash('sha256').update(descriptorBytes).digest('hex');
      const manifestBytes = JSON.stringify(manifest, null, 2) + '\\n';
      writeFileSync(manifestPath, manifestBytes);
      writeFileSync(join(graphRoot, 'artifacts.json'), manifestBytes);
    }

    const readyFileIndex = args.indexOf('--ready-file');
    if (readyFileIndex < 0 || !args[readyFileIndex + 1]) {
      throw new Error('doctor start omitted --ready-file');
    }
    const publicReadyFile = args[readyFileIndex + 1];
    const nativeReadyFile = publicReadyFile + '.native';
    const nativeArgs = [...args];
    nativeArgs[readyFileIndex + 1] = nativeReadyFile;
    rmSync(nativeReadyFile, { force: true });
    rmSync(publicReadyFile, { force: true });
    const child = spawn(${JSON.stringify(runtimeBinary)}, nativeArgs, {
      env: process.env,
      stdio: 'inherit',
    });
    let exit = null;
    const exitPromise = new Promise((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('exit', (code, signal) => {
        exit = { code, signal };
        resolveExit(exit);
      });
    });
    const deadline = Date.now() + 15_000;
    while (!existsSync(nativeReadyFile)) {
      if (exit !== null) {
        throw new Error('native runtime exited before real readiness: ' + JSON.stringify(exit));
      }
      if (Date.now() >= deadline) throw new Error('native runtime readiness timed out');
      await delay(10);
    }
    await delay(100);
    if (args.includes('--startup-artifacts')) {
      writeFileSync(${JSON.stringify(activationReadyMarker)}, 'real runtime ready file observed\\n');
    }
    const temporaryReadyFile = publicReadyFile + '.stub-tmp';
    copyFileSync(nativeReadyFile, temporaryReadyFile);
    renameSync(temporaryReadyFile, publicReadyFile);
    const result = await exitPromise;
    process.exitCode = result.code ?? 1;
    return;
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
    return;
  }
  const result = spawnSync(${JSON.stringify(runtimeBinary)}, args, {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
`);
  chmodSync(wrapper, 0o755);
  return { activationReadyMarker, legacyResetMarker, wrapper };
}

test('doctor waits for sessions activation readiness before its legacy seed reset', async () => {
  assert.equal(
    existsSync(runtimeBinary),
    true,
    `native snapback binary missing at ${runtimeBinary}; run scripts/bootstrap-ibex-runtime or set SNAPBACK_RUNTIME_BINARY`,
  );
  const root = mkdtempSync(join(tmpdir(), 'snapback-doctor-seed-transition-'));
  const { activationReadyMarker, legacyResetMarker, wrapper } = writeTransitionWrapper(root);

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
      startup: {
        signal: 'runtime-ready-file',
        timeoutMs: 15_000,
        startupCarrier: true,
      },
      postBind: {
        signal: 'load-generated-return',
        branch: 'ensure-app',
        admissionBoundary: 'sessions-same-mode-activation',
      },
    });
    assert.equal(
      existsSync(activationReadyMarker),
      true,
      'the injection must observe the real native ready file before publishing readiness to doctor',
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

test('doctor fails when its generated binding is stale', async () => {
  assert.equal(
    existsSync(runtimeBinary),
    true,
    `native snapback binary missing at ${runtimeBinary}; run scripts/bootstrap-ibex-runtime or set SNAPBACK_RUNTIME_BINARY`,
  );
  const root = mkdtempSync(join(tmpdir(), 'snapback-doctor-stale-binding-'));
  const { wrapper } = writeTransitionWrapper(root, { staleGeneratedBinding: true });

  try {
    const report = await doctor({
      runtimeBinary: wrapper,
      env: { ...process.env, npm_config_offline: 'true' },
    });
    assert.equal(report.ok, false, JSON.stringify(report, null, 2));
    assert.equal(
      report.checks.some(({ code }) => code === 'SNAPBACK_DOCTOR_QUERY_OK'),
      false,
      'doctor must not accept a query through the stale generated binding',
    );
    const failure = report.checks.at(-1);
    assert.equal(failure?.code, 'SNAPBACK_ARTIFACT_IDENTITY_MISMATCH');
    assert.equal(failure?.details?.subcause, 'generation');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

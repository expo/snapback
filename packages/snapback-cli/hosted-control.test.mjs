// The hosted surface must survive npm packaging without reaching back into a
// Snapback checkout. This test imports and executes the extracted tarball
// directly; repository paths are used only before packing to prove that the
// package-owned generated schema mirrors have not drifted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  HOSTED_ASSETS,
  HOSTED_COMMAND_REGISTRY,
  HOSTED_LIFECYCLE_VERBS,
  __hostedControlTest,
} from './hosted-control.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'snapback-hosted-package-'));
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

try {
  assert.deepEqual(Object.keys(HOSTED_COMMAND_REGISTRY), [
    'plan',
    'inspect',
    'logs',
    ...Object.keys(HOSTED_LIFECYCLE_VERBS).map((verb) => `lifecycle ${verb}`),
  ]);
  assert.equal(new Set(Object.values(HOSTED_LIFECYCLE_VERBS)).size, 17);
  assert(Object.values(HOSTED_COMMAND_REGISTRY)
    .filter(({ kind }) => kind === 'lifecycle')
    .every(({ availability }) => availability === 'fail-closed-until-supervisor-executor'));

  for (const packageRelative of Object.values(HOSTED_ASSETS.schemas)) {
    const name = packageRelative.split('/').at(-1);
    assert.equal(
      sha256(readFileSync(join(here, packageRelative))),
      sha256(readFileSync(join(here, '..', '..', 'schemas', name))),
      `${name} package mirror drifted from the generated canonical schema`,
    );
  }

  const packed = spawnSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
    { cwd: here, encoding: 'utf8' },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const [{ filename, files }] = JSON.parse(packed.stdout);
  const packagedPaths = new Set(files.map(({ path }) => path));
  assert(packagedPaths.has('hosted-control.mjs'));
  assert(packagedPaths.has('adapters/fly-machines-vm-driver.mjs'));
  for (const path of Object.values(HOSTED_ASSETS.schemas)) assert(packagedPaths.has(path));

  const archive = join(root, filename);
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', root], { encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  const isolatedPackage = join(root, 'package');
  const isolated = await import(pathToFileURL(join(isolatedPackage, 'hosted-control.mjs')));

  const plan = isolated.createHostedPlan();
  assert.equal(plan.ok, true);
  assert.equal(plan.targetId, null);
  assert.equal(plan.commands.length, Object.keys(HOSTED_COMMAND_REGISTRY).length);
  assert.match(plan.driver.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.keys(plan.schemas).length, 4);
  assert(!JSON.stringify(plan).includes(here));

  const requestPath = join(root, 'request.json');
  const request = {
    schemaVersion: 'snapback.vm-adapter-lifecycle-request.v2',
    operation: 'provisionInactive',
    operationId: 'package-proof-operation',
    attempt: 0,
    targetBinding: {},
    planSha256: `sha256:${'1'.repeat(64)}`,
    requestSha256: `sha256:${'2'.repeat(64)}`,
    predecessorHead: {
      schemaVersion: 'snapback.hosted-control-head.v2',
      targetId: 'target-proof',
      generation: 0,
      bindingSha256: `sha256:${'3'.repeat(64)}`,
      activationGeneration: 0,
      activeReleaseId: null,
      journalRootSha256: `sha256:${'4'.repeat(64)}`,
      admissionGeneration: 0,
      spendFloor: 0,
      cleanupFloor: 0,
      replayFloor: 0,
      supervisorIncarnation: 'supervisor-proof',
      predecessorSha256: null,
      committedAtMs: 1,
    },
    effectIntent: {
      semanticEffectId: 'semantic-effect-proof',
    },
    lease: null,
    confirmationSha256: null,
  };
  assert.deepEqual(
    Object.keys(request).sort(),
    [...__hostedControlTest.LIFECYCLE_REQUEST_KEYS].sort(),
  );
  writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { mode: 0o600 });
  const refusal = isolated.invokeHostedLifecycle('provision-inactive', {
    requestPath,
    env: { PATH: process.env.PATH, HOME: root, LANG: 'C' },
  });
  assert.equal(refusal.schemaVersion, 'snapback.vm-adapter-lifecycle-response.v2');
  assert.equal(refusal.ok, false);
  assert.equal(refusal.operation, 'provisionInactive');
  assert.equal(refusal.terminal.outcome, 'notApplied');
  assert.equal(refusal.controlHead.targetId, 'target-proof');
  assert(refusal.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_HOSTED_SUPERVISOR_EXECUTOR_UNAVAILABLE',
  ));

  assert.throws(
    () => isolated.invokeHostedLifecycle('not-a-verb', { requestPath }),
    (error) => error.code === 'SNAPBACK_HOSTED_LIFECYCLE_VERB_UNKNOWN',
  );
  request.operation = 'releaseLease';
  writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { mode: 0o600 });
  assert.throws(
    () => isolated.invokeHostedLifecycle('provision-inactive', { requestPath }),
    (error) => error.code === 'SNAPBACK_HOSTED_REQUEST_INVALID',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('hosted control package tests passed');

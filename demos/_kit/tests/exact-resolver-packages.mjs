import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveExact } from '../exact-resolver.mjs';

const workspace = mkdtempSync(join(tmpdir(), 'snapback-exact-package-resolver-'));
const root = join(workspace, 'snapback');
const installRoot = join(root, 'demos', 'todo', 'surfaces', 'contract');
const contractRoot = join(installRoot, 'node_modules', '@exact', 'contract');
const foreignInstallRoot = join(root, 'admin-ui');

function writeCapableInstall(target, version) {
  const targetContract = join(target, 'node_modules', '@exact', 'contract');
  const targetDevtools = join(target, 'node_modules', '@exact', 'devtools');
  mkdirSync(join(targetContract, 'src', 'compiler'), { recursive: true });
  mkdirSync(join(targetContract, 'src', 'runtime'), { recursive: true });
  mkdirSync(join(targetDevtools, 'src', 'agent'), { recursive: true });
  writeFileSync(
    join(targetContract, 'package.json'),
    JSON.stringify({
      name: '@ccheever/exact-contract',
      version,
      exports: {
        './compiler': { import: './src/compiler/index.ts' },
        './runtime': { import: './src/runtime/index.ts' },
      },
    }),
  );
  writeFileSync(join(targetContract, 'src', 'compiler', 'index.ts'), 'export const compiler = true;\n');
  writeFileSync(join(targetContract, 'src', 'runtime', 'index.ts'), 'export const runtime = true;\n');
  writeFileSync(
    join(targetContract, 'src', 'runtime', 'data-provider.ts'),
    'export function createProviderEphemeralHandle() {}\n',
  );
  writeFileSync(join(targetContract, 'src', 'channels.ts'), 'export const pointerChannel = {};\n');
  writeFileSync(join(targetDevtools, 'src', 'agent', 'server.ts'), 'export const agent = true;\n');
}

try {
  mkdirSync(root, { recursive: true });
  writeCapableInstall(installRoot, '0.1.2');
  writeCapableInstall(foreignInstallRoot, '9.9.9-foreign');

  // A capable sibling checkout is deliberately present but must not shadow
  // the lock-installed package without an explicit override.
  const siblingRoot = join(workspace, 'exact');
  mkdirSync(join(siblingRoot, 'packages', 'exact-contract', 'src', 'compiler'), { recursive: true });
  mkdirSync(join(siblingRoot, 'packages', 'exact-contract', 'src', 'runtime'), { recursive: true });
  writeFileSync(join(siblingRoot, 'packages', 'exact-contract', 'src', 'compiler', 'index.ts'), 'export {};\n');
  writeFileSync(join(siblingRoot, 'packages', 'exact-contract', 'src', 'runtime', 'index.ts'), 'export {};\n');
  writeFileSync(join(siblingRoot, 'packages', 'exact-contract', 'src', 'runtime', 'data-provider.ts'), 'export function createProviderEphemeralHandle() {}\n');
  writeFileSync(join(siblingRoot, 'packages', 'exact-contract', 'src', 'channels.ts'), 'export const pointerChannel = {};\n');
  mkdirSync(join(siblingRoot, 'packages', 'exact-devtools', 'src', 'agent'), { recursive: true });
  writeFileSync(join(siblingRoot, 'packages', 'exact-devtools', 'src', 'agent', 'server.ts'), 'export {};\n');

  const logs = [];
  const resolved = resolveExact({
    repoRoot: root,
    targetInstallRoot: installRoot,
    requiredCapabilities: ['ephemeralBinding', 'valueChannels', 'agentApi'],
    logger: (message) => logs.push(message),
  });
  assert.equal(resolved.sourceKind, 'package');
  assert.equal(resolved.path, installRoot);
  assert.equal(resolved.packageRoot, contractRoot);
  assert.equal(resolved.version, '0.1.2');
  assert.equal(resolved.commit, null);
  assert.deepEqual(resolved.diagnostics, []);
  assert.match(logs[0], /selected locked package 0\.1\.2/);
  for (const capability of [
    'contractCompiler',
    'runtime',
    'dataBinding',
    'ephemeralBinding',
    'valueChannels',
    'agentApi',
  ]) {
    assert.equal(resolved.capabilities[capability], true, capability);
  }

  // A valid install elsewhere in the repo cannot rescue a missing target.
  const missingTarget = join(root, 'demos', 'missing', 'surfaces', 'contract');
  const missing = resolveExact({
    repoRoot: root,
    targetInstallRoot: missingTarget,
    logger: null,
  });
  assert.equal(missing.sourceKind, 'missing');
  assert.equal(missing.diagnostics[0].details.targetInstallRoot, missingTarget);
  assert.deepEqual(missing.diagnostics[0].details.searched, [`package:${missingTarget}`]);
  assert.equal(
    missing.diagnostics[0].details.searched.includes(`package:${foreignInstallRoot}`),
    false,
    'a foreign capable install must never satisfy the missing target',
  );

  // Nor can that foreign install mask a present-but-stale target package.
  const staleTarget = join(root, 'demos', 'stale', 'surfaces', 'contract');
  const staleContract = join(staleTarget, 'node_modules', '@exact', 'contract');
  mkdirSync(join(staleContract, 'src', 'compiler'), { recursive: true });
  writeFileSync(
    join(staleContract, 'package.json'),
    JSON.stringify({
      version: '0.0.1-stale',
      exports: { './compiler': { import: './src/compiler/index.ts' } },
    }),
  );
  writeFileSync(join(staleContract, 'src', 'compiler', 'index.ts'), 'export {};\n');
  const stale = resolveExact({ repoRoot: root, targetInstallRoot: staleTarget, logger: null });
  assert.equal(stale.sourceKind, 'missing');
  assert.deepEqual(stale.diagnostics[0].details.searched, [`package:${staleTarget}`]);
  assert.match(stale.diagnostics[0].details.probed[0], new RegExp(staleTarget));
  assert.match(stale.diagnostics[0].details.probed[0], /runtime/);

  const undeclared = resolveExact({ repoRoot: root, logger: null });
  assert.equal(undeclared.sourceKind, 'missing');
  assert.equal(undeclared.diagnostics[0].details.targetInstallRoot, null);
  assert.deepEqual(undeclared.diagnostics[0].details.searched, []);

  const previousRoot = process.env.SNAPBACK_EXACT_ROOT;
  process.env.SNAPBACK_EXACT_ROOT = siblingRoot;
  try {
    const overrideLogs = [];
    const overridden = resolveExact({
      repoRoot: root,
      targetInstallRoot: installRoot,
      requiredCapabilities: ['ephemeralBinding', 'valueChannels', 'agentApi'],
      logger: (message) => overrideLogs.push(message),
    });
    assert.equal(overridden.sourceKind, 'environment');
    assert.equal(overridden.path, siblingRoot);
    assert.match(overrideLogs[0], /selected explicit environment checkout/);
  } finally {
    if (previousRoot === undefined) delete process.env.SNAPBACK_EXACT_ROOT;
    else process.env.SNAPBACK_EXACT_ROOT = previousRoot;
  }

  // A bad environment override is authoritative even when local config names
  // a valid checkout. Silent fallback would make CI use a different Exact
  // implementation than the operator requested.
  mkdirSync(join(root, '.snapback'), { recursive: true });
  writeFileSync(join(root, '.snapback', 'local.json'), JSON.stringify({ exactRoot: siblingRoot }));
  process.env.SNAPBACK_EXACT_ROOT = join(workspace, 'missing-exact');
  try {
    const invalidEnvironment = resolveExact({
      repoRoot: root,
      targetInstallRoot: installRoot,
      logger: null,
    });
    assert.equal(invalidEnvironment.sourceKind, 'missing');
    assert.match(invalidEnvironment.diagnostics[0].details.searched[0], /^environment:/);
    assert.equal(
      invalidEnvironment.diagnostics[0].details.searched.some((entry) => entry.startsWith('local-config:')),
      false,
      'local config must not mask an explicit environment failure',
    );
  } finally {
    if (previousRoot === undefined) delete process.env.SNAPBACK_EXACT_ROOT;
    else process.env.SNAPBACK_EXACT_ROOT = previousRoot;
  }
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log('Exact package resolver test: ok');

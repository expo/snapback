import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveExact } from '../exact-resolver.mjs';

const workspace = mkdtempSync(join(tmpdir(), 'snapback-exact-package-resolver-'));
const root = join(workspace, 'snapback');
const installRoot = join(root, 'admin-ui');
const contractRoot = join(installRoot, 'node_modules', '@exact', 'contract');
const devtoolsRoot = join(installRoot, 'node_modules', '@exact', 'devtools');

try {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(contractRoot, 'src', 'compiler'), { recursive: true });
  mkdirSync(join(contractRoot, 'src', 'runtime'), { recursive: true });
  mkdirSync(join(devtoolsRoot, 'src', 'agent'), { recursive: true });
  writeFileSync(
    join(contractRoot, 'package.json'),
    JSON.stringify({
      name: '@ccheever/exact-contract',
      version: '0.1.2',
      exports: {
        './compiler': { import: './src/compiler/index.ts' },
        './runtime': { import: './src/runtime/index.ts' },
      },
    }),
  );
  writeFileSync(join(contractRoot, 'src', 'compiler', 'index.ts'), 'export const compiler = true;\n');
  writeFileSync(join(contractRoot, 'src', 'runtime', 'index.ts'), 'export const runtime = true;\n');
  writeFileSync(
    join(contractRoot, 'src', 'runtime', 'data-provider.ts'),
    'export function createProviderEphemeralHandle() {}\n',
  );
  writeFileSync(join(contractRoot, 'src', 'channels.ts'), 'export const pointerChannel = {};\n');
  writeFileSync(join(devtoolsRoot, 'src', 'agent', 'server.ts'), 'export const agent = true;\n');

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

  const previousRoot = process.env.SNAPBACK_EXACT_ROOT;
  process.env.SNAPBACK_EXACT_ROOT = siblingRoot;
  try {
    const overrideLogs = [];
    const overridden = resolveExact({
      repoRoot: root,
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
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

console.log('Exact package resolver test: ok');

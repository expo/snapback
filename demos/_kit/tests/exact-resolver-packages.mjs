import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveExact } from '../exact-resolver.mjs';

const root = mkdtempSync(join(tmpdir(), 'snapback-exact-package-resolver-'));
const installRoot = join(root, 'admin-ui');
const contractRoot = join(installRoot, 'node_modules', '@exact', 'contract');
const devtoolsRoot = join(installRoot, 'node_modules', '@exact', 'devtools');

try {
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

  const resolved = resolveExact({
    repoRoot: root,
    requiredCapabilities: ['ephemeralBinding', 'valueChannels', 'agentApi'],
  });
  assert.equal(resolved.sourceKind, 'package');
  assert.equal(resolved.path, installRoot);
  assert.equal(resolved.packageRoot, contractRoot);
  assert.equal(resolved.version, '0.1.2');
  assert.equal(resolved.commit, null);
  assert.deepEqual(resolved.diagnostics, []);
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
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Exact package resolver test: ok');

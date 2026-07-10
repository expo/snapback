import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveExactContractExport } from './exact-package.mjs';

const root = mkdtempSync(join(tmpdir(), 'snapback-exact-package-alias-'));
const packageRoot = join(root, 'node_modules', '@exact', 'contract');

try {
  mkdirSync(join(packageRoot, 'src', 'compiler'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@ccheever/exact-contract',
      version: '0.1.2',
      exports: { './compiler': { import: './src/compiler/index.ts' } },
    }),
  );
  writeFileSync(join(packageRoot, 'src', 'compiler', 'index.ts'), 'export const compiler = true;\n');

  const resolved = resolveExactContractExport('./compiler', { exactRoot: root });
  assert(resolved);
  assert.equal(resolved.packageRoot, packageRoot);
  assert.equal(resolved.path, join(packageRoot, 'src', 'compiler', 'index.ts'));
  assert.equal(resolved.specifier, '@exact/contract/compiler');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Exact published-alias package resolver test: ok');

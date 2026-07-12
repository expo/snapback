import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { importExactContractExport, resolveExactContractExport } from './exact-package.mjs';

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

  // An explicit checkout is selected directly and imports its real export.
  writeFileSync(join(packageRoot, 'src', 'compiler', 'index.ts'), 'export const compiler = "explicit";\n');
  const imported = await importExactContractExport('./compiler', { exactRoot: root });
  assert.equal(imported.compiler, 'explicit');

  // Once the package specifier resolves, an initialization failure is the
  // selected package's failure. It must never be translated into a missing-
  // package diagnostic or hidden by a checkout fallback.
  const brokenPath = join(root, 'broken-installed.mjs');
  writeFileSync(brokenPath, 'throw Object.assign(new Error("installed package exploded"), { code: "EXACT_FIXTURE_BROKEN" });\n');
  await assert.rejects(
    importExactContractExport('./runtime', {
      resolveSpecifier: () => pathToFileURL(brokenPath).href,
    }),
    (error) => error.code === 'EXACT_FIXTURE_BROKEN',
  );

  await assert.rejects(
    importExactContractExport('./missing', { exactRoot: root }),
    (error) => error.code === 'SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Exact published-alias package resolver test: ok');

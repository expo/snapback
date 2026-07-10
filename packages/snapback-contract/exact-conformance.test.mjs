import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EXACT_PROVIDER_CONFORMANCE_CHECK_ID,
  discoverExactProviderConformance,
} from './exact-conformance.mjs';

const root = mkdtempSync(join(tmpdir(), 'snapback-exact-conformance-package-'));
try {
  const packageRoot = join(root, 'node_modules', '@exact', 'contract');
  mkdirSync(join(packageRoot, 'src', 'conformance'), { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@ccheever/exact-contract',
      version: '0.1.2',
      exports: {
        './conformance': { import: './src/conformance/index.ts' },
      },
    }),
  );
  writeFileSync(
    join(packageRoot, 'src', 'conformance', 'index.ts'),
    'export const assertDataProviderConformance = async () => ({ ok: true });\n',
  );

  const report = discoverExactProviderConformance({ exactRoot: root });
  assert.equal(report.ok, true);
  assert.equal(report.runnable, true);
  assert.equal(report.exactVerify.check.id, EXACT_PROVIDER_CONFORMANCE_CHECK_ID);
  assert.equal(report.exactVerify.check.source, 'package-export');
  assert.equal(report.candidates[0].source, 'package-export');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('Exact package provider conformance discovery test: ok');

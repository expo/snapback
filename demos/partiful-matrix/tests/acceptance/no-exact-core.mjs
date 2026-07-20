import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMachineReport } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const loader = join(here, 'deny-exact-loader.mjs');
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const output = option('out');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identity = (path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) });
const packages = ['snapback-client', 'snapback-codegen', 'snapback-app-cli'];
const tests = [
  'packages/snapback-client/package.test.mjs',
  'packages/snapback-codegen/identifier-validation.test.mjs',
  'packages/snapback-codegen/authoring-validation.test.mjs',
  'packages/snapback-codegen/dependency-graph.test.mjs',
  'packages/snapback-codegen/operation-schemas.test.mjs',
  'packages/snapback-app-cli/package.test.mjs',
];

for (const name of packages) {
  const manifestPath = join(repoRoot, 'packages', name, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      assert.ok(!dependency.startsWith('@exact/'), `${name} declares Exact in ${field}: ${dependency}`);
    }
  }
}

const results = [];
for (const relative of tests) {
  const run = spawnSync(process.execPath, ['--no-warnings', '--experimental-loader', loader, relative], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  results.push({
    test: relative,
    status: run.status,
    signal: run.signal,
    stdout: run.stdout.trim().split('\n').slice(-3),
    stderr: run.stderr.trim().split('\n').filter(Boolean).slice(-3),
  });
  if (run.status !== 0) {
    process.stderr.write(run.stdout);
    process.stderr.write(run.stderr);
    throw new Error(`no-Exact core witness failed: ${relative}`);
  }
}

const report = {
  claimId: 'STEP0.NO_EXACT_CORE',
  ok: true,
  exactImportPolicy: 'denied by ESM loader',
  packages,
  results,
  testInventory: [
    'demos/partiful-matrix/tests/acceptance/no-exact-core.mjs',
    'demos/partiful-matrix/tests/acceptance/deny-exact-loader.mjs',
    ...packages.map((name) => `packages/${name}/package.json`),
    ...tests,
    'demos/_kit/harness.mjs',
  ].map(identity),
};
if (output !== null) writeMachineReport(resolve(repoRoot, output), report);
console.log(JSON.stringify(report));

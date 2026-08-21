#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// @ref LLP 0061#3-verification-snippets-that-ran — the Guide's exact
// transclusion is compiled as an external consumer against npm-packed bytes.
// @ref LLP 0044#client-upload-surface — the framework-neutral task stays on
// createAssetClient(client); the raw SnapbackClient grows no assets facade.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRelative = 'tests/fixtures/guide-asset-client-accessor/asset-client-example.mts';
const fixtureDirectory = join(root, dirname(fixtureRelative));
const fixtureSource = readFileSync(join(root, fixtureRelative), 'utf8');
const guideSource = readFileSync(join(root, 'guide/backend/assets.md'), 'utf8');
const exactFence = `\`\`\`ts source=${fixtureRelative}\n${fixtureSource}\`\`\``;
assert(
  guideSource.includes(exactFence),
  'guide/backend/assets.md must transclude the exact packed asset-client fixture',
);

const tsc = join(root, 'node_modules/.bin/tsc');
assert(existsSync(tsc), 'locked TypeScript is missing; run `bun install --frozen-lockfile`');

const scratch = mkdtempSync(join(tmpdir(), 'snapback-guide-asset-client-'));
const tarballDirectory = join(scratch, 'tarballs');
const scaffold = join(scratch, 'scaffold');
const npmCache = join(scratch, 'npm-cache');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function packInto(packageDirectory) {
  const output = run(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', tarballDirectory],
    {
      cwd: packageDirectory,
      env: { ...process.env, npm_config_cache: npmCache },
    },
  );
  const records = JSON.parse(output);
  assert.equal(records.length, 1, `npm pack returned ${records.length} records`);
  return join(tarballDirectory, records[0].filename);
}

function installPacked(packageName, tarball) {
  const target = join(scaffold, 'node_modules', ...packageName.split('/'));
  mkdirSync(target, { recursive: true });
  run('tar', ['-xzf', tarball, '--strip-components=1', '-C', target]);
  return target;
}

try {
  mkdirSync(tarballDirectory, { recursive: true });
  mkdirSync(scaffold, { recursive: true });
  writeFileSync(join(scaffold, 'package.json'), '{"private":true,"type":"module"}\n');
  cpSync(fixtureDirectory, scaffold, { recursive: true });
  writeFileSync(
    join(scaffold, 'raw-client-has-no-assets.mts'),
    `import type { SnapbackClient } from '@expo/snapback-client';\n\n`
      + `declare const client: SnapbackClient;\n`
      + `// @ts-expect-error The public raw client deliberately has no assets facade.\n`
      + `client.assets;\n`,
  );

  installPacked(
    '@expo/snapback-contract',
    packInto(join(root, 'packages/snapback-contract')),
  );
  const packedClient = installPacked(
    '@expo/snapback-client',
    packInto(join(root, 'packages/snapback-client')),
  );

  run(tsc, [
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'nodenext',
    '--moduleResolution', 'nodenext',
    '--lib', 'es2022,dom',
    join(scaffold, 'asset-client-example.mts'),
    join(scaffold, 'raw-client-has-no-assets.mts'),
  ], { cwd: scaffold });

  const publicClient = await import(pathToFileURL(join(packedClient, 'index.mjs')).href);
  assert.equal(typeof publicClient.createAssetClient, 'function');
  const rawClient = new publicClient.SnapbackClient('http://127.0.0.1:4287', {
    devDiagnosticsReporter: false,
    offlineQueue: false,
    rqsStore: null,
  });
  assert.equal(
    'assets' in rawClient,
    false,
    'raw SnapbackClient must not grow an assets facade without an intentional API decision',
  );
  await rawClient.close();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('check-guide-asset-client-example: packed public example typecheck passed');

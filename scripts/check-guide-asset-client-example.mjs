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
import { fileURLToPath } from 'node:url';

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

// Keep every retained mention explicit. Counts make an allowlisted historical
// or correction-oriented file fail if another copyable occurrence is added.
const rawClientAccessor = 'client' + '.assets.start';
const rawClientAccessorAllowlist = new Map([
  ['demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f3-packaged-asset-client-cannot-authenticate-sessions.json', 1],
  ['demos/rematch-bakeoff/snapback/guide-cache/backend_assets.md', 1],
  ['demos/upload-bakeoff/party-wall/snapback-r2/build-log.md', 1],
  ['diaries/0049-upload-bakeoff-party-wall.diary.md', 1],
  ['guide/backend/assets.md', 1],
  ['guide/capabilities.md', 2],
  ['guide/guide-flat.backend.generated.md', 1],
  ['guide/guide-flat.generated.md', 5],
  ['guide/guide-flat.meta.generated.md', 4],
  ['guide/retrieval-eval.md', 2],
  ['issues/closed/20260731-0044-l1-14-client-task-react.md', 1],
  ['issues/closed/20260821-guide-gap-asset-client-accessor-mismatch.md', 3],
  ['llp/0294-early-expo-workflow-closure.plan.md', 1],
]);

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

function checkRawClientAccessorSweep() {
  const grepPattern = 'client[.]assets[.][A-Za-z_$][A-Za-z0-9_$]*';
  const output = run(
    'git',
    ['grep', '-n', '-I', '-E', grepPattern, '--', '.'],
    { cwd: root },
  );
  const observed = new Map();
  for (const line of output.trimEnd().split('\n')) {
    const pathSeparator = line.indexOf(':');
    const lineSeparator = line.indexOf(':', pathSeparator + 1);
    assert(pathSeparator > 0 && lineSeparator > pathSeparator, `unexpected git grep row: ${line}`);
    const path = line.slice(0, pathSeparator);
    const sourceLine = line.slice(lineSeparator + 1);
    for (const match of sourceLine.matchAll(/client[.]assets[.][A-Za-z_$][A-Za-z0-9_$]*/gu)) {
      assert.equal(
        match[0],
        rawClientAccessor,
        `unallowlisted raw-client asset accessor ${match[0]} in ${path}`,
      );
      observed.set(path, (observed.get(path) ?? 0) + 1);
    }
  }

  for (const [path, count] of observed) {
    assert(
      rawClientAccessorAllowlist.has(path),
      `unallowlisted raw-client asset accessor in ${path}; use createAssetClient(client)`,
    );
    assert.equal(
      count,
      rawClientAccessorAllowlist.get(path),
      `raw-client asset accessor count drifted in ${path}`,
    );
  }
  for (const [path, count] of rawClientAccessorAllowlist) {
    assert.equal(
      observed.get(path),
      count,
      `raw-client asset accessor allowlist is stale for ${path}`,
    );
  }
}

try {
  checkRawClientAccessorSweep();
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
  installPacked(
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

  const runtimeProbe = join(scaffold, 'packed-client-runtime.mjs');
  writeFileSync(
    runtimeProbe,
    `import assert from 'node:assert/strict';\n`
      + `import { SnapbackClient, createAssetClient } from '@expo/snapback-client';\n\n`
      + `assert.equal(typeof createAssetClient, 'function');\n`
      + `const rawClient = new SnapbackClient('http://127.0.0.1:4287', {\n`
      + `  devDiagnosticsReporter: false,\n`
      + `  offlineQueue: false,\n`
      + `  rqsStore: null,\n`
      + `});\n`
      + `assert.equal(\n`
      + `  'assets' in rawClient,\n`
      + `  false,\n`
      + `  'raw SnapbackClient must not grow an assets facade without an intentional API decision',\n`
      + `);\n`
      + `await rawClient.close();\n`,
  );
  run(process.execPath, [runtimeProbe], { cwd: scaffold });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(
  `check-guide-asset-client-example: packed bare-specifier runtime, typecheck, and raw-client sweep passed (${rawClientAccessorAllowlist.size} allowlisted files)`,
);

#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0061#3-verification-snippets-that-ran — the Guide excerpt is
// source-bound to a fixture executed against freshly npm-packed package bytes.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRelative = 'scripts/auth-settlement-packed-proof.mjs';
const fixtureSource = readFileSync(join(root, fixtureRelative), 'utf8');
const excerptStart = '// guide-auth-settlement-packed-proof:start\n';
const excerptEnd = '// guide-auth-settlement-packed-proof:end';
const excerptStartAt = fixtureSource.indexOf(excerptStart);
const excerptEndAt = fixtureSource.indexOf(excerptEnd);
assert(excerptStartAt >= 0 && excerptEndAt > excerptStartAt, 'packed proof excerpt markers drifted');
const excerpt = fixtureSource.slice(excerptStartAt + excerptStart.length, excerptEndAt);
const guideSource = readFileSync(join(root, 'guide/recipes/auth-transition-writes.md'), 'utf8');
const exactFence = `\`\`\`js source=${fixtureRelative}\n${excerpt}\`\`\``;
assert(
  guideSource.includes(exactFence),
  'auth-transition recipe must transclude the exact packed settlement proof excerpt',
);

const scratch = mkdtempSync(join(tmpdir(), 'snapback-guide-auth-settlement-'));
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
}

try {
  mkdirSync(tarballDirectory, { recursive: true });
  mkdirSync(scaffold, { recursive: true });
  writeFileSync(join(scaffold, 'package.json'), '{"private":true,"type":"module"}\n');
  cpSync(join(root, fixtureRelative), join(scaffold, 'auth-settlement-packed-proof.mjs'));

  for (const [packageName, packageDirectory] of [
    ['@expo/snapback-contract', 'packages/snapback-contract'],
    ['@expo/snapback-client', 'packages/snapback-client'],
    ['@expo/snapback-react', 'packages/snapback-react'],
    ['react', 'node_modules/react'],
  ]) {
    installPacked(packageName, packInto(join(root, packageDirectory)));
  }

  const output = run(process.execPath, [join(scaffold, 'auth-settlement-packed-proof.mjs')], {
    cwd: scaffold,
    env: {
      ...process.env,
      SNAPBACK_AUTH_SETTLEMENT_MODULE_ROOT: join(scaffold, 'node_modules'),
    },
  });
  assert.deepEqual(JSON.parse(output), {
    oneShot: {
      signedOut: 'SNAPBACK_AUTH_REQUIRED',
      signingIn: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      signedIn: 'success',
      signingOut: 'SNAPBACK_CLIENT_AUTHORITY_CLEARING',
      revoked: 'SNAPBACK_AUTH_SESSION_REVOKED',
    },
    live: {
      signedOut: 'blocked:authentication-required',
      signingIn: 'blocked:authentication-not-settled',
      signedIn: 'ready',
      signingOut: 'blocked:authentication-not-settled',
      revoked: 'error:SNAPBACK_AUTH_SESSION_REVOKED',
    },
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('check-guide-auth-settlement-packed-proof: packed one-shot/live matrix passed');

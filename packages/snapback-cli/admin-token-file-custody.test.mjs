import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { __deploymentTest } from './deployment-control.mjs';

const INVALID_CODE = 'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID';
const root = mkdtempSync(join(tmpdir(), 'snapback-admin-token-custody-'));
const cli = join(import.meta.dirname, 'cli.mjs');
const native = join(root, 'snapback-native');

writeFileSync(native, `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "password" ] && [ "$3" = "unlock" ]; then
  exit 0
fi
exit 97
`);
chmodSync(native, 0o755);

test.after(() => rmSync(root, { force: true, recursive: true }));

function readToken(path, maximumBytes = 4 * 1024) {
  return __deploymentTest.readFileDescriptorSafeHarness(
    path,
    INVALID_CODE,
    { maximumBytes, ownerOnly: true },
  ).toString('utf8').trim();
}

function diagnosticDocument(stderr) {
  for (const line of stderr.split(/\r?\n/u)) {
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed?.diagnostics)) return parsed;
    } catch {
      // Ignore non-JSON process warnings; the CLI diagnostic remains one line.
    }
  }
  assert.fail(`stderr did not contain a diagnostic JSON document: ${stderr}`);
}

function cliEnvironment() {
  const env = { ...process.env, SNAPBACK_RUNTIME_BINARY: native };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return env;
}

function assertCliRefuses(path, options = {}) {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'auth', 'password', 'unlock',
      '--url', 'http://snapback.test',
      '--email', 'locked@example.test',
      '--admin-token-file', path,
    ],
    {
      encoding: 'utf8',
      env: cliEnvironment(),
      timeout: options.timeout,
    },
  );
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stderr);
  const diagnostic = diagnosticDocument(result.stderr).diagnostics[0];
  assert.equal(diagnostic.code, INVALID_CODE);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /EXECUTED/u);
  return { diagnostic, result };
}

test('admin-token custody refuses a symlink carrier', () => {
  const path = join(root, 'substituted-token');
  const forwarded = join(root, 'forwarded-token');
  writeFileSync(path, 'original-token\n', { mode: 0o600 });
  writeFileSync(forwarded, 'forwarded-token\n', { mode: 0o600 });
  assert.equal(readToken(path), 'original-token');

  unlinkSync(path);
  symlinkSync(forwarded, path);

  const { diagnostic, result } = assertCliRefuses(path);
  assert.match(diagnostic.details.observedMode, /^0[0-7]{3}$/u);
  assert.ok(diagnostic.details.failedPredicates.includes('not-a-regular-file'));
  assert.ok(diagnostic.details.failedPredicates.includes('symbolic-link'));
  assert.doesNotMatch(result.stderr, /forwarded-token/u);
});

test('admin-token custody refuses a file owned by a different uid', {
  skip: typeof process.getuid !== 'function',
}, () => {
  const path = join(root, 'wrong-owner-token');
  writeFileSync(path, 'wrong-owner-token\n', { mode: 0o600 });
  assert.throws(
    () => __deploymentTest.readFileDescriptorSafeHarness(
      path,
      INVALID_CODE,
      { maximumBytes: 4 * 1024, ownerOnly: true, ownerUid: process.getuid() + 1 },
    ),
    (error) => error?.code === INVALID_CODE
      && error?.diagnostic?.details?.failedPredicates?.includes('not-owned-by-current-user'),
  );
});

test('admin-token custody refuses a multiply linked file', () => {
  const path = join(root, 'linked-token');
  writeFileSync(path, 'linked-token\n', { mode: 0o600 });
  linkSync(path, join(root, 'linked-token-alias'));

  const { diagnostic } = assertCliRefuses(path);
  assert.equal(diagnostic.details.observedMode, '0600');
  assert.ok(diagnostic.details.failedPredicates.includes('link-count-not-one'));
});

test('admin-token custody refuses a file over its byte bound', () => {
  const path = join(root, 'oversize-token');
  writeFileSync(path, 'x'.repeat((4 * 1024) + 1), { mode: 0o600 });
  chmodSync(path, 0o600);

  const result = assertCliRefuses(path);
  assert.doesNotMatch(result.result.stderr, /x{32}/u);
});

test('admin-token custody rejects NUL without disclosing the token sentinel', () => {
  const path = join(root, 'nul-token');
  const sentinel = 'sbat_NUL_SENTINEL_MUST_NEVER_BE_DISCLOSED';
  writeFileSync(path, Buffer.from(`${sentinel}\0trailing-secret`), { mode: 0o600 });

  const { result } = assertCliRefuses(path);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(sentinel, 'u'));
});

test('admin-token custody refuses an owner-only FIFO without blocking', {
  skip: process.platform === 'win32',
}, () => {
  const path = join(root, 'token-fifo');
  const created = spawnSync('mkfifo', [path], { encoding: 'utf8', timeout: 2_000 });
  assert.equal(created.error, undefined, created.error?.message);
  assert.equal(created.status, 0, created.stderr);
  chmodSync(path, 0o600);

  const { diagnostic } = assertCliRefuses(path, { timeout: 2_000 });
  assert.equal(diagnostic.details.observedMode, '0600');
  assert.ok(diagnostic.details.failedPredicates.includes('not-a-regular-file'));
});

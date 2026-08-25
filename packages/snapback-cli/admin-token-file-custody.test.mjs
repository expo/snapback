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

import { readFileDescriptorSafe } from './deployment-control.mjs';

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
  return readFileDescriptorSafe(
    path,
    INVALID_CODE,
    { maximumBytes, ownerOnly: true },
  ).toString('utf8').trim();
}

function assertInvalid(operation) {
  assert.throws(operation, (error) => error?.code === INVALID_CODE);
}

function assertCliRefuses(path) {
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
      env: { ...process.env, SNAPBACK_RUNTIME_BINARY: native },
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stderr).diagnostics[0].code, INVALID_CODE);
  return result;
}

test('admin-token custody refuses a pathname substituted with a symlink', () => {
  const path = join(root, 'substituted-token');
  const forwarded = join(root, 'forwarded-token');
  writeFileSync(path, 'original-token\n', { mode: 0o600 });
  writeFileSync(forwarded, 'forwarded-token\n', { mode: 0o600 });
  assert.equal(readToken(path), 'original-token');

  unlinkSync(path);
  symlinkSync(forwarded, path);

  const result = assertCliRefuses(path);
  assert.doesNotMatch(result.stderr, /forwarded-token/u);
});

test('admin-token custody refuses a file owned by a different uid', {
  skip: typeof process.getuid !== 'function',
}, () => {
  const path = join(root, 'wrong-owner-token');
  writeFileSync(path, 'wrong-owner-token\n', { mode: 0o600 });
  const getuid = process.getuid;
  process.getuid = () => getuid() + 1;
  try {
    assertInvalid(() => readToken(path));
  } finally {
    process.getuid = getuid;
  }
});

test('admin-token custody refuses a multiply linked file', () => {
  const path = join(root, 'linked-token');
  writeFileSync(path, 'linked-token\n', { mode: 0o600 });
  linkSync(path, join(root, 'linked-token-alias'));

  assertCliRefuses(path);
});

test('admin-token custody refuses a file over its byte bound', () => {
  const path = join(root, 'oversize-token');
  writeFileSync(path, 'x'.repeat((4 * 1024) + 1), { mode: 0o600 });
  chmodSync(path, 0o600);

  const result = assertCliRefuses(path);
  assert.doesNotMatch(result.stderr, /x{32}/u);
});

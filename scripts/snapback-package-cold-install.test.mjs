import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runAsync } from './snapback-package-cold-install-lib.mjs';

const script = fileURLToPath(new URL('./snapback-package-cold-install.mjs', import.meta.url));

function runCli(args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 5_000,
  });
}

test('--help exits before reading the ledger or staging packages', () => {
  const missingLedger = join(tmpdir(), `snapback-cold-install-help-${process.pid}`, 'missing.json');
  const result = runCli(['--ledger', missingLedger, '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage:/u);
  assert.match(result.stdout, /--ledger <path>/u);
  assert.match(result.stdout, /--receipt <path>/u);
  assert.match(result.stdout, /--keep/u);
  assert.equal(result.stderr, '');
});

test('unknown flags and stale positional arguments fail before the proof', () => {
  for (const args of [
    ['--install-source', 'tarball'],
    ['tarball'],
    ['--receipt'],
    ['--help', '--unknown'],
  ]) {
    const result = runCli(args);
    assert.equal(result.status, 1, `unexpected success for ${args.join(' ')}`);
    assert.match(result.stderr, /snapback-package-cold-install:/u);
    assert.doesNotMatch(result.stderr, /publication ledger is missing/u);
  }
});

test('spawn ENOENT rejects without hanging or escaping the promise', async () => {
  const missingCommand = `snapback-command-that-does-not-exist-${process.pid}`;
  let deadline;
  try {
    await assert.rejects(
      Promise.race([
        runAsync(missingCommand, []),
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('runAsync did not settle after spawn ENOENT')),
            2_000,
          );
        }),
      ]),
      (error) => {
        assert.match(error.message, /failed to spawn/u);
        assert.equal(error.cause?.code, 'ENOENT');
        return true;
      },
    );
  } finally {
    clearTimeout(deadline);
  }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ERROR_CODES,
  checkCleanTree,
  checkPlatform,
  parseArgs,
} from './build-linux-runtime-release';

const scriptPath = fileURLToPath(new URL('./build-linux-runtime-release', import.meta.url));

test('--help prints usage and exits cleanly without applying the platform guard', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--help'], {
    cwd: dirname(scriptPath),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: scripts\/build-linux-runtime-release/u);
  assert.match(result.stdout, /--output-dir <path>/u);
  assert.equal(result.stderr, '');
});

test('platform guard admits only linux-x64', () => {
  assert.equal(checkPlatform({ platform: 'linux', arch: 'x64' }), true);
  assert.throws(
    () => checkPlatform({ platform: 'darwin', arch: 'arm64' }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.hostUnsupported);
      assert.equal(
        error.message,
        'build-linux-runtime-release requires a linux-x64 host '
          + '(observed darwin-arm64)',
      );
      return true;
    },
  );
});

test('clean-tree check refuses non-empty porcelain output', () => {
  assert.equal(checkCleanTree(''), true);
  assert.throws(
    () => checkCleanTree(' M scripts/example\n?? generated.txt\n'),
    (error) => {
      assert.equal(error.code, ERROR_CODES.dirtyTree);
      assert.equal(
        error.message,
        'release source tree must be clean before build; '
          + 'git status --porcelain --untracked-files=all was non-empty',
      );
      return true;
    },
  );
});

test('parseArgs parses output directory and rejects unknown flags', () => {
  assert.deepEqual(
    parseArgs(['--output-dir', '/tmp/snapback-release'], {
      homeDirectory: '/unused',
    }),
    { help: false, outputDir: '/tmp/snapback-release' },
  );
  assert.throws(
    () => parseArgs(['--skip-dirty-check']),
    (error) => {
      assert.equal(error.code, ERROR_CODES.argumentInvalid);
      assert.equal(error.message, 'unknown option --skip-dirty-check');
      return true;
    },
  );
});

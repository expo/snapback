import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMachineReport } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const output = resolve(
  repoRoot,
  option('out') ?? 'demos/partiful-matrix/acceptance/results/step0-required-skip-nonpass.json',
);
const temporary = `${output}.child-${process.pid}`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identity = (path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) });
const args = [
  'demos/partiful-matrix/tests/acceptance/browser-matrix.mjs',
  '--arm', 'react',
  '--backend', 'snapback',
  '--receipt', temporary,
];

try {
  const child = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CHROME_BIN: '/definitely/not/chrome' },
  });
  assert.equal(child.status, 1, `required-prerequisite skip exited ${child.status}`);
  assert.equal(child.signal, null, `required-prerequisite skip was signaled: ${child.signal}`);
  const report = JSON.parse(readFileSync(temporary, 'utf8'));
  assert.equal(report.ok, false);
  assert.equal(report.outcome, 'skip');
  writeMachineReport(output, {
    ...report,
    witness: {
      command: [process.execPath, ...args],
      exitStatus: child.status,
      signal: child.signal,
    },
    witnessInventory: [
      'demos/partiful-matrix/tests/acceptance/required-skip-nonpass.mjs',
      'demos/partiful-matrix/tests/acceptance/browser-matrix.mjs',
      'demos/_kit/harness.mjs',
      'demos/_kit/chrome-process.mjs',
    ].map(identity),
  });
  console.log(JSON.stringify({ ok: true, witnessedExitStatus: child.status, output }));
} finally {
  rmSync(temporary, { force: true });
}

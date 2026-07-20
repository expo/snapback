import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMachineReport } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const resultRoot = resolve(repoRoot, 'demos/partiful-matrix/acceptance/results');
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const profile = option('profile');
assert.ok(['react', 'vanilla'].includes(profile), '--profile must be react or vanilla');
const output = resolve(
  repoRoot,
  option('out') ?? `demos/partiful-matrix/acceptance/results/step2-${profile}.json`,
);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identity = (path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) });
const run = (command, args) => {
  const child = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  assert.equal(child.signal, null, `${command} ${args.join(' ')} was signaled: ${child.signal}`);
  assert.equal(child.status, 0, `${command} ${args.join(' ')} exited ${child.status}`);
  return {
    command: [command, ...args],
    exitStatus: child.status,
    stdoutSha256: sha256(child.stdout ?? ''),
    stderrSha256: sha256(child.stderr ?? ''),
  };
};
const git = (...args) => {
  const child = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(child.status, 0, `git ${args.join(' ')} failed: ${child.stderr}`);
  return child.stdout.trim();
};
const retainedChild = (id, path, command) => {
  const bytes = readFileSync(resolve(repoRoot, path));
  const receipt = JSON.parse(bytes);
  assert.equal(receipt.ok, true, `${id} receipt did not pass`);
  assert.equal(receipt.skipped ?? 0, 0, `${id} receipt contains skips`);
  for (const entry of receipt.testInventory ?? []) {
    assert.deepEqual(identity(entry.path), entry, `${id} test input drifted: ${entry.path}`);
  }
  return {
    id,
    ...command,
    artifact: { path, sha256: sha256(bytes) },
    passed: receipt.passed,
    total: receipt.total,
  };
};

const children = [];
children.push({
  id: 'poll-recovery',
  ...run(process.execPath, ['demos/partiful-matrix/tests/acceptance/poll-recovery.test.mjs']),
  artifact: null,
});
if (profile === 'react') {
  children.push({
    id: 'react-package',
    ...run('bun', ['run', '--cwd', 'packages/snapback-react', 'test']),
    artifact: null,
  });
  const path = 'demos/partiful-matrix/acceptance/results/step2-react-browser.json';
  const command = run(process.execPath, [
    'demos/partiful-matrix/tests/acceptance/browser-matrix.mjs',
    '--arm', 'react',
    '--receipt', path,
  ]);
  children.push(retainedChild('react-browser', path, command));
  assert.equal(children.at(-1).total, 13, 'React browser receipt check count drifted');
} else {
  const browserPath = 'demos/partiful-matrix/acceptance/results/step2-vanilla-browser.json';
  const browserCommand = run(process.execPath, [
    'demos/partiful-matrix/tests/acceptance/browser-matrix.mjs',
    '--arm', 'vanilla',
    '--receipt', browserPath,
  ]);
  children.push(retainedChild('vanilla-browser', browserPath, browserCommand));
  assert.equal(children.at(-1).total, 17, 'Vanilla browser receipt check count drifted');

  const lifecyclePath = 'demos/partiful-matrix/acceptance/results/step2-vanilla-lifecycle.json';
  const lifecycleCommand = run(process.execPath, [
    'demos/partiful-matrix/tests/acceptance/vanilla-lifecycle.mjs',
    '--receipt', lifecyclePath,
  ]);
  children.push(retainedChild('vanilla-lifecycle', lifecyclePath, lifecycleCommand));
  assert.equal(children.at(-1).total, 5, 'Vanilla lifecycle receipt check count drifted');

  const esmPath = 'demos/partiful-matrix/acceptance/results/step2-unbundled-esm.json';
  const esmCommand = run(process.execPath, [
    'demos/partiful-matrix/tests/acceptance/unbundled-esm.mjs',
    '--receipt', esmPath,
  ]);
  children.push(retainedChild('vanilla-unbundled-esm', esmPath, esmCommand));
  assert.equal(children.at(-1).total, 2, 'Vanilla unbundled ESM receipt check count drifted');
}

const sourcePaths = [
  'demos/partiful-matrix/tests/acceptance/step2-client-aggregate.mjs',
  'demos/partiful-matrix/tests/acceptance/poll-recovery.test.mjs',
  'demos/partiful-matrix/shared/poll-recovery.mjs',
  'packages/snapback-client/external-store.mjs',
  'packages/snapback-client/external-store.d.mts',
  'packages/snapback-client/external-store.test.mjs',
  ...(profile === 'react' ? [
    'packages/snapback-react/index.mjs',
    'packages/snapback-react/index.d.mts',
    'packages/snapback-react/package.test.mjs',
    'demos/partiful-matrix/shared/model.ts',
    'demos/partiful-matrix/surfaces/react/src/App.tsx',
    'demos/partiful-matrix/surfaces/react/src/provider.ts',
  ] : [
    'demos/partiful-matrix/surfaces/vanilla/src/lifecycle.js',
    'demos/partiful-matrix/surfaces/vanilla/src/main.js',
    'demos/partiful-matrix/surfaces/vanilla/src/provider.js',
    'demos/partiful-matrix/tests/acceptance/vanilla-lifecycle.mjs',
    'demos/partiful-matrix/tests/acceptance/unbundled-esm.mjs',
  ]),
];
const dirtySource = git('status', '--porcelain', '--untracked-files=all')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3))
  .filter((path) => !path.startsWith('demos/partiful-matrix/acceptance/results/'));
const report = {
  schemaVersion: 'partitime.step2-client-aggregate.v1',
  claimId: profile === 'react' ? 'STEP2.REACT_WEB' : 'STEP2.VANILLA',
  profile,
  ok: true,
  outcome: 'pass',
  recordedAt: new Date().toISOString(),
  repository: {
    revision: git('rev-parse', 'HEAD'),
    sourceDirty: dirtySource.length > 0,
    dirtySource,
  },
  children,
  sourceInventory: sourcePaths.map(identity),
};
assert.equal(report.repository.sourceDirty, false, `aggregate source is dirty: ${dirtySource.join(', ')}`);
writeMachineReport(relative(repoRoot, output), report);
console.log(JSON.stringify(report));

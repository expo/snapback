import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __test, doctor, generateApp, scaffoldApp, validateDevTarget } from './index.mjs';

const root = mkdtempSync(join(tmpdir(), 'snapback-cli-package-'));
try {
  const fakeRuntime = join(root, 'snapback');
  writeFileSync(fakeRuntime, '#!/bin/sh\nexit 0\n');
  chmodSync(fakeRuntime, 0o755);
  const report = doctor({ runtimeBinary: fakeRuntime, env: { ...process.env, DYLD_FRAMEWORK_PATH: '/must/not/be/needed' } });
  assert.equal(report.ok, true);
  assert.equal(report.runtime.source, 'override');

  const project = join(root, 'todo-contract');
  const scaffold = scaffoldApp(project);
  assert.equal(scaffold.ok, true);
  const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  assert.match(manifest.dependencies['@snapback/cli'], /^\^\d+\.\d+\.\d+/);
  const generated = await generateApp(join(project, 'snapback'));
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  assert.throws(
    () => validateDevTarget({ database: { path: join(root, 'other.sqlite3') } }, {
      readyFile: join(root, 'ready.json'),
      database: join(root, 'expected.sqlite3'),
    }),
    (error) => error.code === 'SNAPBACK_DEV_SERVER_TARGET_MISMATCH',
  );

  const commandLog = join(root, 'runtime-commands.log');
  const recordingRuntime = join(root, 'recording-snapback');
  writeFileSync(recordingRuntime, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${commandLog}'\nexit 0\n`);
  chmodSync(recordingRuntime, 0o755);
  const backend = join(root, 'seed-once', 'snapback');
  mkdirSync(join(backend, 'generated'), { recursive: true });
  writeFileSync(join(backend, 'seed.json'), '{"tables":{}}\n');
  __test.loadGenerated(
    recordingRuntime,
    join(root, 'seed-once'),
    backend,
    join(root, 'seed-once', '.snapback', 'dev.ready.json'),
    null,
    { seed: true },
  );
  __test.loadGenerated(
    recordingRuntime,
    join(root, 'seed-once'),
    backend,
    join(root, 'seed-once', '.snapback', 'dev.ready.json'),
    null,
  );
  const commands = readFileSync(commandLog, 'utf8').trim().split('\n');
  assert.equal(commands.filter((line) => line.startsWith('load ')).length, 2);
  assert.equal(commands.filter((line) => line.startsWith('reset ')).length, 1);
  console.log('package.test.mjs: doctor, scaffold, offline generation, attach fencing, and seed-once reload pass');
} finally {
  rmSync(root, { recursive: true, force: true });
}

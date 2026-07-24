import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import {
  __test,
  attachDevControlChannel,
  doctor,
  generateApp,
  scaffoldApp,
  validateDevTarget,
} from './index.mjs';

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

  // The interactive dev control channel: a TTY stdin gets single-key verbs
  // (s/r/R/q) instead of the JSON command channel, over the same verb slice.
  {
    const invoked = [];
    const verbs = {
      status: async (context) => invoked.push(['status', context]),
      reload: async (context) => invoked.push(['reload', context]),
      restart: async (context) => invoked.push(['restart', context]),
    };
    let stopped = 0;
    let rawMode = null;
    const tty = new PassThrough();
    tty.isTTY = true;
    tty.setRawMode = (value) => { rawMode = value; };
    const detach = attachDevControlChannel({
      verbs,
      stop: () => { stopped += 1; },
      onEvent: () => {},
      stdin: tty,
    });
    assert.equal(rawMode, true);
    tty.emit('data', 's');
    tty.emit('data', 'r');
    tty.emit('data', 'R');
    tty.emit('data', 'x');
    tty.emit('data', 'q');
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.deepEqual(invoked.map(([verb]) => verb), ['status', 'reload', 'restart']);
    assert.equal(stopped, 1);
    detach();
    assert.equal(rawMode, false);
  }

  // The machine-readable channel over the same verbs: JSON commands in,
  // structured command-error events (never a crash) for malformed input.
  {
    const invoked = [];
    const events = [];
    const verbs = {
      status: async (context) => invoked.push(['status', context]),
      reload: async (context) => invoked.push(['reload', context]),
      restart: async (context) => invoked.push(['restart', context]),
    };
    let stopped = 0;
    const stdin = new PassThrough();
    attachDevControlChannel({
      verbs,
      stop: () => { stopped += 1; },
      onEvent: (event) => events.push(event),
      stdin,
    });
    assert.equal(events[0].state, 'control-ready');
    assert.equal(events[0].channel, 'json');
    stdin.write('not json\n');
    stdin.write(`${JSON.stringify({ schemaVersion: 'snapback.dev-command.v1', verb: 'status', requestId: 'u-1' })}\n`);
    stdin.write(`${JSON.stringify({ schemaVersion: 'wrong.schema', verb: 'status' })}\n`);
    stdin.write(`${JSON.stringify({ schemaVersion: 'snapback.dev-command.v1', verb: 'dance' })}\n`);
    stdin.end();
    await new Promise((resolveTick) => setImmediate(resolveTick));
    assert.deepEqual(invoked, [['status', { requestId: 'u-1' }]]);
    const errorCodes = events
      .filter((event) => event.state === 'command-error')
      .map((event) => event.diagnostics[0].code);
    assert.deepEqual(errorCodes, [
      'SNAPBACK_DEV_COMMAND_INVALID',
      'SNAPBACK_DEV_COMMAND_INVALID',
      'SNAPBACK_DEV_COMMAND_UNKNOWN_VERB',
    ]);
    assert.equal(stopped, 1, 'stdin end must stop the loop');
  }

  console.log('package.test.mjs: doctor, scaffold, offline generation, attach fencing, seed-once reload, and dev control channels pass');
} finally {
  rmSync(root, { recursive: true, force: true });
}

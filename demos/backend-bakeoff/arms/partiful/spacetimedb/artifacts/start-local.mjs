#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  armBaseCommit,
  armRoot,
  cli,
  dataRoot,
  database,
  evidenceRoot,
  freezeAggregateSha256,
  frozenSnapbackCommit,
  globalArgs,
  logsRoot,
  server,
  startUptimeMs,
  startedAt,
  stateRoot,
  vitePort,
} from './constants.mjs';

async function listening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(300);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

if (await listening(3332) || await listening(vitePort)) {
  throw new Error('assigned port baseline is not empty');
}
await mkdir(dataRoot, { recursive: true });
await mkdir(logsRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
const logHandle = await open(path.resolve(logsRoot, 'server.log'), 'a', 0o600);
const child = spawn(
  cli,
  [
    ...globalArgs,
    'start',
    '--listen-addr=127.0.0.1:3332',
    `--data-dir=${dataRoot}`,
    '--non-interactive',
  ],
  {
    cwd: armRoot,
    detached: true,
    stdio: ['ignore', logHandle.fd, logHandle.fd],
  },
);
child.unref();
await writeFile(path.resolve(stateRoot, 'server.pid'), `${child.pid}\n`, { mode: 0o600 });

let ready = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
  const probe = spawnSync(cli, [...globalArgs, 'server', 'ping', server], {
    cwd: armRoot,
    encoding: 'utf8',
  });
  if (probe.status === 0) {
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) {
  throw new Error(`standalone server failed readiness: ${await readFile(path.resolve(logsRoot, 'server.log'), 'utf8')}`);
}

const absence = spawnSync(
  cli,
  [
    ...globalArgs,
    'describe',
    '--json',
    database,
    '--server',
    server,
    '--anonymous',
    '--yes',
    '--no-config',
  ],
  { cwd: armRoot, encoding: 'utf8' },
);
const absenceDiagnostic = `${absence.stdout}\n${absence.stderr}`.trim();
if (
  absence.status === 0 ||
  /Usage:|unexpected argument|required arguments were not provided/i.test(absenceDiagnostic) ||
  !/failed to find database|not found|unknown database/i.test(absenceDiagnostic)
) {
  throw new Error(`database absence probe was not a valid negative: ${absenceDiagnostic}`);
}

const baseline = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  activeWindowStartedAt: startedAt,
  activeWindowStartUptimeMs: startUptimeMs,
  mode: 'fresh-local',
  sourceBaseCommit: armBaseCommit,
  frozenSnapbackCommit,
  freezeAggregateSha256,
  exactTarget: {
    machine: 'ccheever-minisforum-AI-Series',
    server,
    database,
    serverPort: 3332,
    vitePort,
    dataRoot: 'state/data',
    cliRoot: 'state/cli',
    configPath: 'state/config/cli.toml',
  },
  preWriteProbes: {
    portsInitiallyClosed: [3332, vitePort],
    databaseDescribeCommand:
      `spacetime describe --json ${database} --server ${server} --anonymous --yes --no-config`,
    databaseDescribeExitCode: absence.status,
    databaseAbsentDiagnostic: absenceDiagnostic.split('\n').slice(-8),
    usageDiagnosticObserved: /Usage:|unexpected argument|required arguments were not provided/i.test(absenceDiagnostic),
    serverPid: child.pid,
  },
  sharedTarget: false,
  unrelatedBaselineMutationPlanned: false,
  containsSecretValues: false,
};
await writeFile(
  path.resolve(evidenceRoot, 'baseline.json'),
  `${JSON.stringify(baseline, null, 2)}\n`,
  { mode: 0o600 },
);
await writeFile(
  path.resolve(evidenceRoot, 'cleanup-plan.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    exactArmRoot: armRoot,
    exactServer: server,
    exactDatabaseName: database,
    databaseIdentity: null,
    exactPorts: [3332, vitePort],
    exactRuntimePath: stateRoot,
    guard:
      'Resolve and verify the database identity before deletion; stop only PIDs whose command and cwd bind them to this arm; never use server clear.',
    postCleanupDescribe:
      `spacetime describe --json ${database} --server ${server} --anonymous --yes --no-config`,
  }, null, 2)}\n`,
  { mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  ok: true,
  pid: child.pid,
  absenceExitCode: absence.status,
  usageDiagnosticObserved: false,
})}\n`);

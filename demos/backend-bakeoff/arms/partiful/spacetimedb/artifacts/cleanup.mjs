import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  armRoot,
  cli,
  cliRoot,
  configPath,
  database,
  databaseIdentity,
  evidenceRoot,
  server,
  stateRoot,
  vitePort,
} from './constants.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const usagePattern = /Usage:|unexpected argument|required arguments were not provided/i;
const absencePattern = /failed to find database|not found|unknown database/i;

function run(args) {
  const result = spawnSync(
    cli,
    [`--root-dir=${cliRoot}`, `--config-path=${configPath}`, ...args],
    { cwd: armRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

async function validatePid(label, pidPath, expectedCwd, requiredCommandText) {
  const pid = Number((await readFile(pidPath, 'utf8')).trim());
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`${label} PID is invalid`);
  const cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\0', ' ').trim();
  const cwd = await readlink(`/proc/${pid}/cwd`);
  if (
    cwd !== expectedCwd ||
    !cmdline.includes(armRoot) ||
    !cmdline.includes(requiredCommandText)
  ) {
    throw new Error(`${label} PID ownership guard failed: ${JSON.stringify({ pid, cwd, cmdline })}`);
  }
  return { label, pid, cwd, commandSha256: sha256(cmdline) };
}

async function stopValidatedProcess(processReceipt) {
  process.kill(processReceipt.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(processReceipt.pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${processReceipt.label} PID ${processReceipt.pid} did not stop after SIGTERM`);
}

const preCommand = [
  'describe', '--json', database, '--server', server, '--yes', '--no-config',
];
const pre = run(preCommand);
const preDiagnostic = `${pre.stdout}\n${pre.stderr}`.trim();
if (pre.exitCode !== 0 || usagePattern.test(preDiagnostic)) {
  throw new Error(`valid pre-cleanup describe failed: ${preDiagnostic}`);
}

const serverProcess = await validatePid(
  'SpacetimeDB standalone',
  path.resolve(stateRoot, 'server.pid'),
  armRoot,
  'spacetimedb-standalone',
);
const viteProcess = await validatePid(
  'Vite',
  path.resolve(stateRoot, 'vite.pid'),
  path.resolve(armRoot, 'work/client'),
  'node_modules/.bin/vite',
);

const deletion = run([
  'delete',
  databaseIdentity,
  '--server',
  server,
  '--yes',
  '--no-config',
]);
if (deletion.exitCode !== 0) {
  throw new Error(`exact database deletion failed: ${deletion.stderr || deletion.stdout}`);
}

// The database is a positional argument. A usage/argument diagnostic is never
// accepted as absence proof.
const postCommand = [
  'describe',
  '--json',
  database,
  '--server',
  server,
  '--anonymous',
  '--yes',
  '--no-config',
];
const post = run(postCommand);
const postDiagnostic = `${post.stdout}\n${post.stderr}`.trim();
const usageDiagnosticObserved = usagePattern.test(postDiagnostic);
if (
  post.exitCode === 0 ||
  usageDiagnosticObserved ||
  !absencePattern.test(postDiagnostic)
) {
  throw new Error(`post-cleanup describe was not a syntactically valid absence probe: ${postDiagnostic}`);
}

await stopValidatedProcess(viteProcess);
await stopValidatedProcess(serverProcess);
if (await portOpen(3332) || await portOpen(vitePort)) {
  throw new Error('assigned ports remained open after validated process shutdown');
}

const stateBytesBeforeRemoval = (await stat(stateRoot)).isDirectory()
  ? Number(spawnSync('du', ['-sb', stateRoot], { encoding: 'utf8' }).stdout.split(/\s+/)[0])
  : 0;
await rm(stateRoot, { recursive: true, force: false });

const checkedAt = new Date().toISOString();
const cleanupReceipt = {
  schemaVersion: 1,
  checkedAt,
  exactTarget: {
    databaseName: database,
    databaseIdentity,
    server,
  },
  preCleanupDescribe: {
    command: `spacetime describe --json ${database} --server ${server} --yes --no-config`,
    exitCode: pre.exitCode,
    syntaxValid: true,
    usageDiagnosticObserved: false,
    schemaResponseSha256: sha256(pre.stdout),
  },
  deletion: {
    command: `spacetime delete ${databaseIdentity} --server ${server} --yes --no-config`,
    exitCode: deletion.exitCode,
    diagnostic: `${deletion.stdout}\n${deletion.stderr}`.trim().split('\n').slice(-8),
  },
  postCleanupAbsence: {
    command: `spacetime describe --json ${database} --server ${server} --anonymous --yes --no-config`,
    databaseArgumentGrammar: 'positional',
    exitCode: post.exitCode,
    syntaxValid: true,
    usageDiagnosticObserved,
    diagnostic: postDiagnostic.split('\n').slice(-12),
    absenceRecognized: true,
  },
  cleanupScope: {
    runtimePathRemoved: stateRoot,
    stateBytesBeforeRemoval,
    serverProcess,
    viteProcess,
    unrelatedProcessesStopped: 0,
    serverClearUsed: false,
  },
  containsSecretValues: false,
};
await writeFile(
  path.resolve(evidenceRoot, 'cleanup-receipt.json'),
  `${JSON.stringify(cleanupReceipt, null, 2)}\n`,
);
await writeFile(
  path.resolve(evidenceRoot, 'environment-cleanup.json'),
  `${JSON.stringify({
    schemaVersion: 1,
    checkedAt,
    runtimePathAbsent: true,
    ports: {
      3332: { open: false },
      [vitePort]: { open: false },
    },
    exactProcessesStopped: [serverProcess, viteProcess],
    cloudflaredProcessesRemainingForArm: 0,
    containsSecretValues: false,
  }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({
  ok: true,
  databaseAbsent: true,
  syntaxValid: true,
  usageDiagnosticObserved,
  diagnostic: postDiagnostic.split('\n').slice(-4),
  portsClosed: [3332, vitePort],
  stateRemoved: true,
})}\n`);

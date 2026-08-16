import { createServer as createNetServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { eventually, listenerPids, run, spawnOwned, stopOwned } from './process.mjs';

async function portGuard(port) {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve();
      else reject(error);
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  return server.listening ? server : null;
}

function closeServer(server) {
  if (server === null) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}

async function staleOwnerCleanup(ownerFile, commandToken) {
  if (!existsSync(ownerFile)) return;
  try {
    const owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
    if (
      owner?.kind !== 'native-custody-probe-harness'
      || owner.commandToken !== commandToken
      || !Number.isSafeInteger(owner.pid)
    ) return;
    process.kill(owner.pid, 0);
    const command = execFileSync('ps', ['-p', String(owner.pid), '-o', 'command='], { encoding: 'utf8' });
    if (!command.includes('snapback-cli/cli.mjs') || !command.includes(commandToken)) return;
    if (process.platform !== 'win32') process.kill(-owner.pid, 'SIGTERM');
    else process.kill(owner.pid, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      process.kill(owner.pid, 0);
      if (process.platform !== 'win32') process.kill(-owner.pid, 'SIGKILL');
      else process.kill(owner.pid, 'SIGKILL');
    } catch { /* terminated after SIGTERM */ }
  } catch { /* stale receipt or process already gone */ }
}

export async function startBackend({ repoRoot, demoRoot, platform, serverPort, logPath = null }) {
  const backendRoot = join(demoRoot, 'snapback');
  const stateRoot = join(demoRoot, '.snapback', `native-custody-${platform}`);
  const ownerFile = join(stateRoot, 'harness-owner.json');
  const readyFile = join(stateRoot, 'dev.ready.json');
  const applicationReadyFile = join(stateRoot, 'application.ready.json');
  const database = join(stateRoot, 'probe.sqlite3');
  mkdirSync(stateRoot, { recursive: true });
  await staleOwnerCleanup(ownerFile, readyFile);
  const releaseDeadline = Date.now() + 5_000;
  while (listenerPids(serverPort).length > 0 && Date.now() < releaseDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const occupants = listenerPids(serverPort);
  if (occupants.length > 0) {
    const details = occupants.map((pid) => {
      try {
        return `${pid} (${execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()})`;
      } catch { return `${pid} (<process exited>)`; }
    });
    throw new Error(`P0/backend-port: TCP ${serverPort} has foreign occupant ${details.join(', ')}`);
  }
  for (const file of ['dev.ready.json', 'application.ready.json', 'probe.sqlite3']) {
    rmSync(join(stateRoot, file), { force: true });
  }
  for (const suffix of ['-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
    rmSync(join(stateRoot, `probe.sqlite3${suffix}`), { force: true });
  }

  await run(
    'Snapback app generation',
    process.execPath,
    [join(repoRoot, 'packages/snapback-codegen/index.mjs'), backendRoot],
    { cwd: demoRoot, timeoutMs: 120_000 },
  );

  const guards = [];
  try {
    for (let port = 4287; port < serverPort; port += 1) guards.push(await portGuard(port));
  } catch (error) {
    await Promise.all(guards.map(closeServer));
    throw new Error(
      `P0/backend-port: cannot reserve the range below requested --server-port ${serverPort}: ${error.message}`,
    );
  }
  const child = spawnOwned(
    'Snapback managed dev server',
    process.execPath,
    [
      join(repoRoot, 'packages/snapback-cli/cli.mjs'),
      'dev', 'snapback',
      '--ready-file', readyFile,
      '--application-ready-file', applicationReadyFile,
      '--db', database,
      '--json',
    ],
    { cwd: demoRoot, logPath },
  );
  writeFileSync(ownerFile, `${JSON.stringify({
    kind: 'native-custody-probe-harness',
    commandToken: readyFile,
    pid: child.pid,
    startedAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });

  let ready;
  try {
    ready = await eventually(() => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`managed dev server exited: ${child.capturedOutput().slice(-8_000)}`);
      }
      if (!existsSync(readyFile) || !existsSync(applicationReadyFile)) return null;
      const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
      const appReady = JSON.parse(readFileSync(applicationReadyFile, 'utf8'));
      return descriptor.ready === true && appReady.ok !== false ? descriptor : null;
    }, 'Snapback application readiness', 120_000, 100);
  } catch (error) {
    await stopOwned(child);
    rmSync(ownerFile, { force: true });
    throw error;
  } finally {
    await Promise.all(guards.map(closeServer));
  }
  if (ready.port !== serverPort) {
    await stopOwned(child);
    rmSync(ownerFile, { force: true });
    throw new Error(
      `P0/backend-port: requested ${serverPort}, runtime selected ${ready.port}; another process owns the chosen port`,
    );
  }
  const descriptor = JSON.parse(readFileSync(join(backendRoot, 'generated', 'app.descriptor.json'), 'utf8'));
  const capabilityPath = join(backendRoot, 'generated', 'capability.manifest.json');
  const capability = existsSync(capabilityPath)
    ? JSON.parse(readFileSync(capabilityPath, 'utf8'))
    : {};
  const serverCapabilities = capability.supportedCapabilities
    ?? capability.capabilities
    ?? [];

  return Object.freeze({
    child,
    descriptor,
    ready,
    stateRoot,
    binding({ origin, routing }) {
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 6 * 60 * 60_000);
      return Object.freeze({
        format: 'snapback.app-binding.v1',
        source: 'supervised-dev',
        descriptorIdentity: descriptor.identity.descriptor,
        target: Object.freeze({
          app: descriptor.identity.app,
          schema: descriptor.identity.schema,
          functions: descriptor.identity.functions,
          origin,
          routing,
        }),
        capabilities: Object.freeze({ offered: Object.freeze([
          ...new Set([
            ...(descriptor.capabilities?.required ?? []),
            ...(Array.isArray(serverCapabilities) ? serverCapabilities : []),
            'auth.application-bootstrap.v1',
            'auth.passwords',
          ]),
        ].sort()) }),
        provenance: Object.freeze({
          supervisorGeneration: `native-custody-${platform}-${process.pid}`,
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        }),
        integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
      });
    },
    async close() {
      await stopOwned(child);
      rmSync(ownerFile, { force: true });
    },
  });
}

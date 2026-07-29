import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  resolveRuntimeBinary,
  scrubDynamicLoaderEnvironment,
} from '@snapback/cli';

const expectedCommit = process.env.SNAPBACK_BAKEOFF_EXPECTED_COMMIT;
const identityReceiptPath = process.env.SNAPBACK_BAKEOFF_PACKAGE_IDENTITY_RECEIPT;
if (!expectedCommit || !identityReceiptPath) {
  throw new Error('SNAPBACK_BAKEOFF_EXPECTED_COMMIT and SNAPBACK_BAKEOFF_PACKAGE_IDENTITY_RECEIPT are required');
}

const assignedPorts = String(process.env.SNAPBACK_BAKEOFF_ASSIGNED_PORTS ?? '')
  .split(',')
  .filter(Boolean)
  .map((value) => Number(value));
if (assignedPorts.length !== 2 || assignedPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) {
  throw new Error('SNAPBACK_BAKEOFF_ASSIGNED_PORTS must name exactly two valid ports in API,Vite allocation order');
}
if (new Set(assignedPorts).size !== assignedPorts.length) throw new Error('assigned ports must be unique');

const starts = [];
let allocationIndex = 0;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const inside = (candidate, root) => {
  const rel = relative(realpathSync(root), realpathSync(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};
const lexicallyInside = (candidate, root) => {
  const rel = relative(realpathSync(root), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};
const closed = (port) => new Promise((resolveClosed) => {
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => {
    socket.destroy();
    resolveClosed(false);
  });
  socket.once('error', () => resolveClosed(true));
  socket.setTimeout(1_000, () => {
    socket.destroy();
    resolveClosed(false);
  });
});

export async function freePort() {
  if (allocationIndex >= assignedPorts.length) throw new Error('acceptance requested more ports than assigned');
  const port = assignedPorts[allocationIndex++];
  if (!(await closed(port))) throw new Error(`assigned port ${port} is already occupied`);
  return port;
}

async function readReady(readyFile, child, logTail) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`installed snapback start exited before readiness: ${logTail()}`);
    }
    if (existsSync(readyFile)) {
      try {
        return JSON.parse(readFileSync(readyFile, 'utf8'));
      } catch {
        // Atomic publication should make this rare; retry within the bound.
      }
    }
    await sleep(50);
  }
  throw new Error(`installed snapback start timed out: ${logTail()}`);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5_000) });
  const body = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${body}`);
  return JSON.parse(body);
}

async function awaitExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolveExit) => child.once('close', resolveExit)),
    sleep(10_000).then(() => { throw new Error('installed snapback child did not exit after installed snapback stop'); }),
  ]);
}

function packageManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function identityReceipt(finalCleanup = null) {
  const packageTreeRoot = starts[0]?.launch?.cwd
    ? join(starts[0].launch.cwd, 'node_modules')
    : null;
  writeFileSync(identityReceiptPath, `${JSON.stringify({
    schemaVersion: 'snapback.llp0102.external-package-identity.v1',
    expectedCommit,
    packageTreeRoot,
    starts,
    allStartsInstalledCli: packageTreeRoot !== null
      && starts.every((entry) => inside(entry.cliRealPath, packageTreeRoot)),
    allStartsInstalledRuntime: packageTreeRoot !== null
      && starts.every((entry) => inside(entry.runtime.binary, packageTreeRoot)),
    cargoFallbackUsed: false,
    sourceBinaryFallbackUsed: false,
    finalCleanup,
  }, null, 2)}\n`);
}

process.once('beforeExit', () => {
  const exactTargets = [...new Set(starts.flatMap((entry) => entry.lifecycleFiles ?? []))];
  const remnants = exactTargets.filter(existsSync);
  const finalCleanup = {
    checkedAtProcessBoundary: true,
    exactTargets,
    exactTargetsAbsent: remnants.length === 0,
    remnants,
  };
  identityReceipt(finalCleanup);
  if (remnants.length !== 0) {
    console.error(`external package lifecycle remnants survived arm cleanup: ${JSON.stringify(remnants)}`);
    process.exitCode = 1;
  }
});

export async function startServer(options) {
  const {
    port,
    bindPortExactly,
    db,
    cwd,
    startupArtifacts,
    captureImpersonationCapability,
    provenance,
  } = options;
  if (bindPortExactly !== true || captureImpersonationCapability !== true) {
    throw new Error('external confirmation requires exact binding and explicit impersonation capability capture');
  }
  if (!Number.isInteger(port) || !db || !cwd || !startupArtifacts || !provenance?.appId || !provenance?.artifactsPath) {
    throw new Error('external confirmation requires explicit port, db, cwd, startup artifacts, and bundle provenance');
  }
  const projectRoot = realpathSync(resolve(cwd));
  if (!lexicallyInside(db, projectRoot) || !inside(startupArtifacts, projectRoot) || !inside(provenance.artifactsPath, projectRoot)) {
    throw new Error('server inputs must all remain inside the external project');
  }
  if (!(await closed(port))) throw new Error(`assigned API port ${port} is occupied at bind time`);

  const cliLink = join(projectRoot, 'node_modules', '.bin', 'snapback');
  const cliRealPath = realpathSync(cliLink);
  const runtime = resolveRuntimeBinary();
  const runtimeRealPath = realpathSync(runtime.binary);
  const nodeModules = join(projectRoot, 'node_modules');
  if (!inside(cliRealPath, nodeModules) || !inside(runtimeRealPath, nodeModules)) {
    throw new Error('CLI or runtime escaped the installed external-project package tree');
  }
  if (runtime.source !== '@snapback/runtime-linux-x64') {
    throw new Error(`unexpected installed runtime source: ${runtime.source}`);
  }
  if (process.env.SNAPBACK_RUNTIME_BINARY || process.env.SNAPBACK_SERVER_BINARY) {
    throw new Error('runtime/server binary overrides are forbidden in the external confirmation');
  }

  const readyFile = join(dirname(db), `.installed-snapback-${port}.ready.json`);
  if (existsSync(readyFile)) throw new Error(`stale ready file exists: ${readyFile}`);
  const adminToken = `sbat_test_${randomUUID().replaceAll('-', '')}`;
  const args = [
    'start',
    '--port', String(port),
    '--ready-file', readyFile,
    '--db', resolve(db),
    '--startup-artifacts', resolve(startupArtifacts),
  ];
  const environment = scrubDynamicLoaderEnvironment({
    ...process.env,
    SNAPBACK_ADMIN_TOKEN: adminToken,
  });
  delete environment.SNAPBACK_RUNTIME_BINARY;
  delete environment.SNAPBACK_SERVER_BINARY;

  const child = spawn(cliLink, args, {
    cwd: projectRoot,
    env: environment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const append = (chunk) => {
    log = `${log}${chunk}`.slice(-32_768);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);

  let descriptor;
  try {
    descriptor = await readReady(readyFile, child, () => log);
    if (descriptor.port !== port || descriptor.serverUrl?.replace(/\/$/, '') !== `http://127.0.0.1:${port}`) {
      throw new Error(`ready descriptor did not attest assigned port ${port}`);
    }
    const health = await fetchJson(`http://127.0.0.1:${port}/health`);
    if (
      health?.binary?.startupNonce !== descriptor.startupNonce
      || health?.binary?.gitCommit !== expectedCommit
      || health?.binary?.gitDirty !== false
      || health?.binary?.buildProfile !== 'release'
    ) {
      throw new Error(`installed runtime identity mismatch: ${JSON.stringify(health?.binary)}`);
    }
    const advertisedCapability = descriptor.impersonationCapabilityFile;
    const expectedCapability = `${readyFile}.impersonation`;
    if (!advertisedCapability || realpathSync(advertisedCapability) !== realpathSync(expectedCapability)) {
      throw new Error('ready descriptor did not name the exact mechanical impersonation sidecar');
    }
    const impersonationCapability = readFileSync(expectedCapability, 'utf8');
    if (!/^sbic_[A-Za-z0-9_-]+\.[0-9a-f]{8}$/.test(impersonationCapability)) {
      throw new Error('installed server impersonation capability is malformed');
    }
    const inspect = await fetchJson(`http://127.0.0.1:${port}/inspect`, {
      headers: { 'x-snapback-auth-client-protocol': '1' },
    });
    const artifacts = JSON.parse(readFileSync(provenance.artifactsPath, 'utf8'));
    if (inspect?.functions?.appId !== provenance.appId || inspect?.functions?.bundleHash !== artifacts.bundleHash) {
      throw new Error(`installed server bundle provenance mismatch: ${JSON.stringify(inspect?.functions)}`);
    }

    const lifecycleFiles = [
      readyFile,
      ...Object.entries(descriptor)
        .filter(([key, value]) => key.endsWith('File') && typeof value === 'string')
        .map(([, value]) => value),
    ];
    const startRecord = {
      ordinal: starts.length + 1,
      port,
      cliLink,
      cliRealPath,
      cliPackage: packageManifest(join(dirname(cliRealPath), 'package.json')),
      runtime: {
        ...runtime,
        binary: runtimeRealPath,
        package: packageManifest(join(dirname(runtimeRealPath), '..', 'package.json')),
      },
      binaryIdentity: health.binary,
      startupNonce: descriptor.startupNonce,
      appId: inspect.functions.appId,
      bundleHash: inspect.functions.bundleHash,
      lifecycleFiles,
      launch: {
        executable: cliLink,
        args,
        cwd: projectRoot,
        cargoFallback: false,
        sourceBinaryFallback: false,
      },
      stopped: false,
      cleanup: null,
    };
    starts.push(startRecord);
    let stopPromise = null;
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      adminToken,
      credentials: Object.freeze({ adminToken }),
      clientOptions: Object.freeze({ adminToken }),
      reused: false,
      startupNonce: descriptor.startupNonce,
      impersonationCapability,
      assertAlive() {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error('installed Snapback child exited unexpectedly');
        }
      },
      get exit() {
        return child.exitCode === null && child.signalCode === null
          ? null
          : { code: child.exitCode, signal: child.signalCode, expected: startRecord.stopped };
      },
      onUnexpectedExit() {
        return () => {};
      },
      stop() {
        if (!stopPromise) {
          stopPromise = (async () => {
            const result = spawnSync(cliLink, ['stop', '--ready-file', readyFile], {
              cwd: projectRoot,
              env: environment,
              encoding: 'utf8',
              timeout: 15_000,
            });
            if (result.status !== 0) {
              throw new Error(`installed snapback stop failed (${result.status}): ${result.stderr || result.stdout}`);
            }
            await awaitExit(child);
            const remnants = [...new Set(startRecord.lifecycleFiles)].filter(existsSync);
            const stopCommandResiduals = remnants.filter((path) => path === `${readyFile}.secret-read-root`);
            const unexpectedRemnants = remnants.filter((path) => !stopCommandResiduals.includes(path));
            const portClosed = await closed(port);
            if (unexpectedRemnants.length !== 0 || !portClosed) {
              throw new Error(`installed lifecycle cleanup failed: ${JSON.stringify({ unexpectedRemnants, portClosed })}`);
            }
            startRecord.stopped = true;
            startRecord.cleanup = {
              command: [cliLink, 'stop', '--ready-file', readyFile],
              readyAndAdvertisedCapabilityFilesAbsent: unexpectedRemnants.length === 0,
              stopCommandResiduals,
              outerArmCleanupRequired: stopCommandResiduals.length !== 0,
              portClosed,
              exactTargets: [...new Set(startRecord.lifecycleFiles)],
            };
            identityReceipt({
              checkedAtProcessBoundary: false,
              exactTargetsAbsent: false,
              pendingOuterArmCleanup: stopCommandResiduals,
            });
          })();
        }
        return stopPromise;
      },
    };
  } catch (error) {
    if (existsSync(readyFile)) {
      spawnSync(cliLink, ['stop', '--ready-file', readyFile], {
        cwd: projectRoot,
        env: environment,
        encoding: 'utf8',
        timeout: 15_000,
      });
    }
    throw error;
  }
}

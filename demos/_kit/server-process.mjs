// Local Snapback server lifecycle for tests/demos.
//
// @ref LLP 0010#required-tool-surfaces — copies Valet's orchestrator disciplines:
//   reuse an already-running server via a health probe, and tear down with
//   SIGTERM->SIGKILL. The two corrections from that section apply: never serve
//   stale output, and local tooling must exit cleanly.
//
// Reuse is *verified*, never assumed (ENG-22757, extending ENG-22753's
// browser-suite fix; the Diary 0008 2026-07-01 :4420 gotcha): "something
// answers /health on the port" says nothing about WHICH server it is — a
// weeks-old binary from another checkout squatting the port used to be
// silently reused. A running server is reused only when the caller declares
// its committed app identity (`provenance: { appId, artifactsPath }` — or an
// explicit `bundleHash`) AND the live server's loaded bundle
// (`GET /inspect` → functions.appId/bundleHash) matches it.
//
// Bundle provenance can only identify a server that has loaded a functions
// bundle. For a server that never will — externally started + unprovisioned,
// or schema-only (`ensureApp({ schema })`) — the caller may pass
// `binaryProvenance: true` to fall back to the server-binary identity now on
// `/health` (build git commit + crate version; ENG-22798), reused only when it
// matches this checkout's clean build. Every other outcome — no provenance
// declared, unreachable /inspect, a wrong bundle, a dirty/mismatched binary —
// refuses reuse and starts a fresh isolated server on an OS-assigned port
// instead (so the returned `baseUrl` may differ from the requested port;
// callers must use the returned value).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  attestProcessGroupExit,
  signalProcessTree,
} from '../../scripts/lib/process-tree.mjs';

import {
  readCheckoutBinaryIdentity,
  readCommittedBundleHash,
  verifyApiProvenance,
  verifyBinaryProvenance,
} from './provenance.mjs';

export async function startServer({
  port = 4399,
  db = ':memory:',
  cwd = process.cwd(),
  env = {},
  provenance = null,
  // When true (or an identity object), a healthy server with NO loaded bundle
  // — unprovisioned or schema-only, which bundle provenance can never verify —
  // may still be reused if its /health server-binary identity matches this
  // checkout's clean build (ENG-22798). Default stays refuse-when-unverifiable.
  binaryProvenance = null,
  // Test-only restart seam: atomically ask the child to bind this exact port.
  // Readiness still requires the unique nonce, so an intervening squatter is
  // rejected by the child's bind failure rather than adopted. Ordinary starts
  // keep port zero and the OS-assigned isolation policy.
  bindPortExactly = false,
  startupTimeoutMs = 60_000,
} = {}) {
  return startServerWithDeps({
    port,
    db,
    cwd,
    env,
    provenance,
    binaryProvenance,
    bindPortExactly,
    startupTimeoutMs,
  }, {});
}

// Narrow dependency seam for the lifecycle regression suite. Production
// callers use startServer; tests substitute only the launched executable and
// checkout identity while exercising the real ports, ready-file handshake,
// HTTP probe, and process-tree teardown.
export async function __startServerForTests(options = {}, deps = {}) {
  return startServerWithDeps(options, deps);
}

async function startServerWithDeps({
  port = 4399,
  db = ':memory:',
  cwd = process.cwd(),
  env = {},
  provenance = null,
  binaryProvenance = null,
  bindPortExactly = false,
  startupTimeoutMs = 60_000,
} = {}, deps = {}) {
  if (bindPortExactly && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new TypeError('bindPortExactly requires an explicit TCP port from 1 through 65535');
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const requestedBaseUrl = `http://127.0.0.1:${port}`;
  const occupied = !bindPortExactly && port !== 0 && await isPortOccupied(port);

  // A requested port is a reuse candidate, never an unsafe spawn target. A
  // healthy matching Snapback process may be reused. Every other listener is
  // named before we ask the OS for an isolated port; cargo is never launched
  // into an occupied address (ENG-24378).
  if (!bindPortExactly && occupied && await isHealthy(requestedBaseUrl, fetchImpl)) {
    const verdict = await reuseVerdict(requestedBaseUrl, {
      provenance,
      binaryProvenance,
      cwd,
      fetchImpl,
    });
    if (verdict.ok) {
      console.log(`REUSED snapback server at :${port} (${verdict.detail})`);
      return serverHandle({
        baseUrl: requestedBaseUrl,
        adminToken: env.SNAPBACK_ADMIN_TOKEN ?? process.env.SNAPBACK_ADMIN_TOKEN ?? null,
        reused: true,
        stop: async () => {},
      });
    }
    console.error(
      `PROVENANCE MISMATCH: a server answers /health on :${port} but ${verdict.reason}. ` +
        'NOT reusing it — the new server will use an OS-assigned isolated port (ENG-22757/ENG-24378).',
    );
  } else if (!bindPortExactly && occupied) {
    console.error(
      `PORT OCCUPIED: a non-Snapback or unhealthy listener owns 127.0.0.1:${port}. ` +
        'NOT spawning into it — the new server will use an OS-assigned isolated port (ENG-24378).',
    );
  }

  const runtimeEnv = deps.preflight
    ? deps.preflight({ cwd })
    : preflightLocalRuntime({ cwd });
  const adminToken = resolveTestAdminToken(env);
  const expectedIdentity = deps.expectedIdentity ?? readCheckoutBinaryIdentity(cwd);
  const readyDir = mkdtempSync(join(tmpdir(), 'snapback-server-'));
  const readyFile = join(readyDir, 'ready.json');
  // Ordinary starts use port zero so the listener binds itself atomically. An
  // explicit restart bind also goes directly to the OS without a preflight
  // probe. In both modes the unique ready-file returns the bound port and
  // process nonce, eliminating adoption and probe-then-bind races.
  const args = [
    'run',
    '--quiet',
    '--',
    '--port',
    bindPortExactly ? String(port) : '0',
    '--ready-file',
    readyFile,
  ];
  if (db === ':memory:') args.push('--memory');
  else args.push('--db', db);

  const childEnv = {
    ...process.env,
    ...env,
    ...runtimeEnv,
    ...(adminToken ? { SNAPBACK_ADMIN_TOKEN: adminToken } : {}),
    ...(expectedIdentity.gitCommit && expectedIdentity.gitCommit !== 'unknown'
      ? { SNAPBACK_BUILD_GIT_COMMIT: expectedIdentity.gitCommit }
      : {}),
    SNAPBACK_BUILD_GIT_DIRTY: expectedIdentity.gitDirty ? 'true' : 'false',
  };
  const launch = deps.launchSpec
    ? deps.launchSpec({ args, readyFile, cwd, env: childEnv, expectedIdentity })
    : { command: 'cargo', args, cwd, env: childEnv };
  let child;
  try {
    child = (deps.spawnImpl ?? spawn)(launch.command, launch.args, {
      cwd: launch.cwd ?? cwd,
      env: launch.env ?? childEnv,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    rmSync(readyDir, { recursive: true, force: true });
    throw new Error(`snapback server spawn failed: ${error.message}`);
  }
  // Install this before inspecting exit state or waiting for readiness. The
  // close event is stronger than exit: it proves the leader's stdio handles
  // have drained, and retaining it here prevents stop() from missing an early
  // close that happens before teardown begins.
  trackLeaderClose(child);
  let log = '';
  let spawnError = null;
  const appendLog = (chunk) => {
    log += chunk;
    if (log.length > 1024 * 1024) log = log.slice(-1024 * 1024);
  };
  child.stdout?.on('data', appendLog);
  child.stderr?.on('data', appendLog);
  child.once('error', (error) => { spawnError = error; });

  const cleanup = () => rmSync(readyDir, { recursive: true, force: true });
  const deadline = Date.now() + startupTimeoutMs; // first run may compile
  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`snapback server spawn failed: ${spawnError.message}`);
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `snapback server exited before verified readiness (${child.exitCode ?? child.signalCode}):\n${log}`,
        );
      }
      const ready = readReadyDescriptor(readyFile);
      if (ready) {
        const verified = await verifySpawnedReady(ready, {
          expectedIdentity,
          fetchImpl,
          expectedPort: bindPortExactly ? port : null,
        });
        if (verified.ok) {
          const baseUrl = ready.serverUrl.replace(/\/$/, '');
          let stopPromise = null;
          return serverHandle({
            baseUrl,
            adminToken,
            reused: false,
            startupNonce: ready.startupNonce,
            stop: () => {
              if (!stopPromise) {
                stopPromise = stopChild(child, deps.stopOptions).finally(cleanup);
              }
              return stopPromise;
            },
          });
        }
        if (!verified.retry) {
          throw new Error(`spawned server identity verification failed: ${verified.reason}`);
        }
      }
      await sleep(100);
    }
    throw new Error(`snapback server did not publish verified readiness within ${startupTimeoutMs}ms:\n${log}`);
  } catch (error) {
    try {
      await stopChild(child, deps.stopOptions);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${error.message}; spawned server cleanup failed: ${cleanupError.message}`,
        { cause: error },
      );
    } finally {
      cleanup();
    }
    throw error;
  }
}

function serverHandle({ baseUrl, adminToken, reused, stop, startupNonce = null }) {
  const credentials = Object.freeze({ adminToken });
  return {
    baseUrl,
    adminToken,
    credentials,
    clientOptions: credentials,
    reused,
    startupNonce,
    stop,
  };
}

function resolveTestAdminToken(env) {
  // Server-backed demo tests talk through SnapbackClient, not the CLI that can
  // discover minted token files. Give the child an explicit local token and
  // mirror it into this process so clients created after startServer can use it.
  const explicit = env?.SNAPBACK_ADMIN_TOKEN ?? process.env.SNAPBACK_ADMIN_TOKEN;
  if (explicit && explicit.length > 0) return explicit;
  return `sbat_test_${randomUUID().replace(/-/g, '')}`;
}

// The reuse verdict for a healthy port. Bundle provenance is strongest (it
// pins the exact app + generated bundle), so it is tried first. Only when the
// server has NO loaded bundle (unprovisioned or schema-only — the one case
// bundle provenance cannot cover) does it fall back to binary provenance, if
// the caller opted in. A bundle that is present but WRONG (foreign app or hash
// drift) is a hard refusal, never a binary fallback. With neither declared
// there is nothing to verify against, so reuse is refused (the safe default).
async function reuseVerdict(baseUrl, { provenance, binaryProvenance, cwd }) {
  if (provenance) {
    const bundleHash = provenance.bundleHash ?? readCommittedBundleHash(provenance.artifactsPath);
    const bundle = await verifyApiProvenance(baseUrl, { appId: provenance.appId ?? null, bundleHash });
    if (bundle.ok) {
      return { ok: true, detail: `bundleHash ${bundle.bundleHash}` };
    }
    // Only "no loaded bundle" is eligible for a binary fallback; a present-but-
    // wrong bundle definitively identifies a different app — refuse.
    if (bundle.code !== 'no-bundle') {
      return { ok: false, reason: bundle.reason };
    }
  }

  if (binaryProvenance) {
    const expected =
      typeof binaryProvenance === 'object' && binaryProvenance.identity
        ? binaryProvenance.identity
        : readCheckoutBinaryIdentity(cwd);
    const binary = await verifyBinaryProvenance(baseUrl, expected);
    if (binary.ok) {
      return { ok: true, detail: `binary commit ${binary.gitCommit.slice(0, 12)}` };
    }
    return { ok: false, reason: binary.reason };
  }

  return {
    ok: false,
    reason:
      'this caller declares no identity to verify it against ' +
      '(pass `provenance: { appId, artifactsPath }` for bundle provenance, or ' +
      '`binaryProvenance: true` to verify an unprovisioned server by its /health build identity)',
  };
}

async function isHealthy(baseUrl, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

function isPortOccupied(port) {
  return new Promise((resolveOccupied) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (occupied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveOccupied(occupied);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(500, () => finish(true));
  });
}

function readReadyDescriptor(path) {
  if (!existsSync(path)) return null;
  let ready;
  try {
    ready = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`snapback ready file is malformed: ${error.message}`);
  }
  if (
    ready?.ready !== true ||
    typeof ready.serverUrl !== 'string' ||
    !/^http:\/\/(?:127\.0\.0\.1|\[::1\]):\d+$/.test(ready.serverUrl) ||
    !Number.isInteger(ready.port) ||
    ready.port < 1 ||
    ready.port > 65535 ||
    typeof ready.startupNonce !== 'string' ||
    ready.startupNonce.length === 0
  ) {
    throw new Error('snapback ready file is missing a loopback URL, bound port, or startup nonce');
  }
  if (Number(new URL(ready.serverUrl).port) !== ready.port) {
    throw new Error('snapback ready file serverUrl and port disagree');
  }
  return ready;
}

async function verifySpawnedReady(ready, { expectedIdentity, fetchImpl, expectedPort = null }) {
  if (expectedPort !== null && ready.port !== expectedPort) {
    return {
      ok: false,
      retry: false,
      reason: `ready file published port ${ready.port}, not requested exact port ${expectedPort}`,
    };
  }
  let response;
  try {
    response = await fetchImpl(`${ready.serverUrl}/health`, { signal: AbortSignal.timeout(750) });
  } catch (error) {
    return { ok: false, retry: true, reason: `health not ready: ${error.message}` };
  }
  if (!response.ok) {
    return { ok: false, retry: true, reason: `health returned HTTP ${response.status}` };
  }
  let health;
  try {
    health = await response.json();
  } catch (error) {
    return { ok: false, retry: false, reason: `health returned malformed JSON: ${error.message}` };
  }
  const binary = health?.binary;
  if (!health?.ok || !binary || typeof binary !== 'object') {
    return { ok: false, retry: false, reason: 'health is not a Snapback binary-identity response' };
  }
  if (binary.startupNonce !== ready.startupNonce) {
    return {
      ok: false,
      retry: false,
      reason: `health startup nonce ${binary.startupNonce ?? '<missing>'} does not match ready file ${ready.startupNonce}`,
    };
  }
  if (
    expectedIdentity.gitCommit &&
    expectedIdentity.gitCommit !== 'unknown' &&
    binary.gitCommit !== expectedIdentity.gitCommit
  ) {
    return {
      ok: false,
      retry: false,
      reason: `health commit ${binary.gitCommit ?? '<missing>'} does not match checkout ${expectedIdentity.gitCommit}`,
    };
  }
  if (
    expectedIdentity.crateVersion &&
    binary.crateVersion !== expectedIdentity.crateVersion
  ) {
    return {
      ok: false,
      retry: false,
      reason: `health crate version ${binary.crateVersion ?? '<missing>'} does not match checkout ${expectedIdentity.crateVersion}`,
    };
  }
  if (
    typeof expectedIdentity.gitDirty === 'boolean' &&
    binary.gitDirty !== expectedIdentity.gitDirty
  ) {
    return {
      ok: false,
      retry: false,
      reason: `health dirty-build marker ${binary.gitDirty ?? '<missing>'} does not match checkout ${expectedIdentity.gitDirty}`,
    };
  }
  return { ok: true };
}

const leaderCloseTrackers = new WeakMap();

function trackLeaderClose(child) {
  const existing = leaderCloseTrackers.get(child);
  if (existing) return existing;

  let resolveClosed;
  const tracker = {
    closed: false,
    detail: null,
    promise: new Promise((resolveClose) => { resolveClosed = resolveClose; }),
  };
  if (typeof child?.once !== 'function') {
    tracker.closed = true;
    tracker.detail = { code: child?.exitCode ?? null, signal: child?.signalCode ?? null };
    resolveClosed(tracker.detail);
  } else {
    child.once('close', (code, signal) => {
      tracker.closed = true;
      tracker.detail = { code, signal };
      resolveClosed(tracker.detail);
    });
  }
  leaderCloseTrackers.set(child, tracker);
  return tracker;
}

async function waitForLeaderClose(tracker, timeoutMs) {
  if (tracker.closed) return { ok: true, detail: tracker.detail };
  let timer = null;
  const result = await Promise.race([
    tracker.promise.then((detail) => ({ ok: true, detail })),
    new Promise((resolveClose) => {
      // Keep this timer referenced: stop() must not disappear with a still
      // unresolved cleanup promise after the leader process handle closes.
      timer = setTimeout(() => resolveClose({
        ok: false,
        error: `leader close was not observed within ${timeoutMs}ms`,
      }), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  return result;
}

function cleanupFailure(child, { term, graceful = null, kill = null, leader = null }) {
  const failures = [];
  if (term && !term.ok) failures.push(`TERM cleanup: ${term.error ?? 'not attested'}`);
  if (graceful && !graceful.ok) failures.push(`graceful exit: ${graceful.error ?? 'not attested'}`);
  if (kill && !kill.ok) failures.push(`KILL cleanup: ${kill.error ?? 'not attested'}`);
  if (leader && !leader.ok) failures.push(leader.error ?? 'leader close not attested');
  if (failures.length === 0) failures.push('unknown cleanup failure');
  const error = new Error(
    `snapback server process-tree cleanup not attested for pid ${child?.pid ?? '<unknown>'}: ` +
      failures.join('; '),
  );
  error.code = 'SNAPBACK_PROCESS_TREE_CLEANUP_FAILED';
  error.cleanup = { term, graceful, kill, leader };
  return error;
}

export async function stopChild(child, {
  graceMs = 3_000,
  platform = process.platform,
  spawnImpl = spawn,
  processKill = process.kill,
  taskkillTimeoutMs = Math.max(graceMs, 2_000),
  processGroupTimeoutMs = Math.max(graceMs, 2_000),
  processGroupPollMs = 10,
  leaderCloseTimeoutMs = platform === 'win32' ? taskkillTimeoutMs : processGroupTimeoutMs,
  signalTree = signalProcessTree,
} = {}) {
  if (!child?.pid) return;

  const closeTracker = trackLeaderClose(child);
  const signalOptions = {
    spawnImpl,
    platform,
    taskkillTimeoutMs,
    processGroupTimeoutMs,
    processGroupPollMs,
    processKill,
  };
  const gracefulDeadline = Date.now() + Math.max(0, graceMs);
  const term = await signalTree(child, 'SIGTERM', {
    ...signalOptions,
    // The TERM tree primitive is part of the grace window, not a separate
    // unbounded prelude to it. The hard leg keeps its own cleanup timeout.
    ...(platform === 'win32'
      ? { taskkillTimeoutMs: Math.max(1, Math.min(taskkillTimeoutMs, graceMs)) }
      : {}),
  });
  const gracefulRemainingMs = () => Math.max(0, gracefulDeadline - Date.now());

  if (platform === 'win32') {
    if (term.ok) {
      const leader = await waitForLeaderClose(closeTracker, gracefulRemainingMs());
      if (leader.ok) return;
    }

    // A nonzero/spawn-failed TERM taskkill is not completion evidence. The
    // hard leg gets one bounded recovery attempt, but stop() still cannot
    // resolve until /T /F itself closes successfully and the leader closes.
    const kill = await signalTree(child, 'SIGKILL', signalOptions);
    const leader = await waitForLeaderClose(closeTracker, leaderCloseTimeoutMs);
    if (kill.ok && leader.ok) return;
    throw cleanupFailure(child, { term, kill, leader });
  }

  if (term.ok) {
    const gracefulGroup = term.exitAttested
      ? term
      : attestProcessGroupExit(child.pid, {
          processKill,
          timeoutMs: gracefulRemainingMs(),
          pollMs: processGroupPollMs,
        });
    const [graceful, leader] = await Promise.all([
      gracefulGroup,
      waitForLeaderClose(closeTracker, gracefulRemainingMs()),
    ]);
    if (graceful.ok && leader.ok) {
      return;
    }
  }

  // TERM delivery and leader exit are not tree-exit evidence: a descendant may
  // ignore TERM or outlive Cargo. SIGKILL is successful only after signal-0
  // observes ESRCH for the detached group, then the leader close is observed.
  const kill = await signalTree(child, 'SIGKILL', signalOptions);
  const leader = await waitForLeaderClose(closeTracker, leaderCloseTimeoutMs);
  if (kill.ok && leader.ok) return;
  throw cleanupFailure(child, { term, kill, leader });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function preflightLocalRuntime({ cwd }) {
  if (process.platform !== 'darwin') return {};

  const ibexRoot = join(cwd, 'vendor', 'ibex');
  if (!existsSync(join(ibexRoot, 'build.rs'))) return {};

  const includeDir =
    envPath('HERMES_INCLUDE_DIR', cwd) ?? join(ibexRoot, 'ios', 'Frameworks', 'hermes-headers');
  const libDir = envPath('HERMES_LIB_DIR', cwd) ?? join(ibexRoot, 'ios', 'Frameworks');
  const hermesc =
    envPath('HERMESC', cwd) ??
    envPath('HERMES_COMPILER', cwd) ??
    defaultHermescPath(ibexRoot);

  const missing = [];
  if (!existsSync(join(includeDir, 'hermes', 'hermes.h')) || !existsSync(join(includeDir, 'jsi', 'jsi.h'))) {
    missing.push(`Hermes headers at ${includeDir}`);
  }
  const framework = resolveMacosHermesFramework(libDir);
  if (!framework) {
    missing.push(`macOS Hermes framework under ${libDir}`);
  }
  if (!existsSync(hermesc)) {
    missing.push(`hermesc at ${hermesc}`);
  }

  if (missing.length === 0) {
    return {
      DYLD_FRAMEWORK_PATH: withFrameworkPath(process.env, framework.searchDir),
    };
  }

  const error = new Error([
    'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING: macOS Ibex/Hermes prerequisites are missing.',
    '',
    'Missing:',
    ...missing.map((item) => `- ${item}`),
    '',
    'Run this once from the Snapback repo:',
    '  vendor/ibex/scripts/download-hermes.sh',
    '',
    'Or point Cargo at an existing Ibex/Hermes checkout with:',
    '  HERMES_INCLUDE_DIR=/path/to/ibex/ios/Frameworks/hermes-headers',
    '  HERMES_LIB_DIR=/path/to/ibex/ios/Frameworks',
    '  HERMESC=/path/to/hermesc',
  ].join('\n'));
  error.code = 'SNAPBACK_CAPABILITY_IBEX_HERMES_MISSING';
  throw error;
}

function envPath(name, cwd) {
  const value = process.env[name];
  if (!value) return null;
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function defaultHermescPath(ibexRoot) {
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  const toolsDir = join(ibexRoot, 'tools', 'hermes');
  const bare = join(toolsDir, 'hermesc');
  const suffixed = join(toolsDir, `hermesc-macos-${arch}`);
  return !existsSync(bare) && existsSync(suffixed) ? suffixed : bare;
}

function resolveMacosHermesFramework(libRoot) {
  const searchDirs = [
    libRoot,
    join(libRoot, 'macosx'),
    join(libRoot, 'hermes.xcframework', 'macos-arm64_x86_64'),
    join(libRoot, 'hermes.xcframework', 'macos-arm64'),
  ];

  for (const searchDir of searchDirs) {
    for (const frameworkName of ['hermesvm', 'hermes']) {
      if (findFrameworkBinary(join(searchDir, `${frameworkName}.framework`), frameworkName)) {
        return { searchDir, frameworkName };
      }
    }
  }
  return null;
}

function withFrameworkPath(env, frameworkDir) {
  const existing = env.DYLD_FRAMEWORK_PATH;
  if (!existing) return frameworkDir;
  const parts = existing.split(':').filter(Boolean);
  return parts.includes(frameworkDir) ? existing : [frameworkDir, ...parts].join(':');
}

function findFrameworkBinary(frameworkDir, frameworkName) {
  return [
    join(frameworkDir, 'Versions', 'Current', frameworkName),
    join(frameworkDir, 'Versions', '1', frameworkName),
    join(frameworkDir, 'Versions', '0', frameworkName),
    join(frameworkDir, frameworkName),
  ].some((candidate) => existsSync(candidate));
}

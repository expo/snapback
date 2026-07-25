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
//
// When a fresh server must be spawned, the launch command resolves by the
// LLP 0030 command-resolver ladder rather than always compiling the checkout:
// a caller-configured binary first (`serverBinary` option or the
// SNAPBACK_SERVER_BINARY env var), then a provenance-verified
// `target/debug/snapback`, then `cargo run` as the source-tree fallback.
// See README.md ("Server launch") and resolveLaunchPlans below.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
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

// A clean CI runner can spend nearly a minute compiling before the child
// publishes readiness. Keep that cold start bounded, with enough margin that
// scheduler variance does not turn a healthy build into a lifecycle failure.
const DEFAULT_SERVER_STARTUP_TIMEOUT_MS = 90_000;

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
  // LLP 0030 ladder rung 1: an explicit snapback server binary to launch
  // instead of resolving one. Must exist; its /health build stamp is still
  // compared against the checkout, but a mismatch reports loudly (see
  // handle.identity) instead of refusing — the paved escape for booting a
  // known-good binary while the checkout HEAD is broken or drifted.
  serverBinary = null,
  // Test-only restart seam: atomically ask the child to bind this exact port.
  // Readiness still requires the unique nonce, so an intervening squatter is
  // rejected by the child's bind failure rather than adopted. Ordinary starts
  // keep port zero and the OS-assigned isolation policy.
  bindPortExactly = false,
  // Closed cold-start carrier used by sessions-mode acceptance tests. The
  // child validates ownership, exact schema/functions identity, and shape.
  startupArtifacts = null,
  // Test-only capability handoff for the email-code capture mailbox. The
  // value is read only from the mechanical ready-file sibling after the
  // ready nonce has been verified against the live child.
  captureImpersonationCapability = false,
  startupTimeoutMs = DEFAULT_SERVER_STARTUP_TIMEOUT_MS,
} = {}) {
  return startServerWithDeps({
    port,
    db,
    cwd,
    env,
    provenance,
    binaryProvenance,
    serverBinary,
    bindPortExactly,
    startupArtifacts,
    captureImpersonationCapability,
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
  serverBinary = null,
  bindPortExactly = false,
  startupArtifacts = null,
  captureImpersonationCapability = false,
  startupTimeoutMs = DEFAULT_SERVER_STARTUP_TIMEOUT_MS,
} = {}, deps = {}) {
  if (bindPortExactly && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new TypeError('bindPortExactly requires an explicit TCP port from 1 through 65535');
  }
  let resolvedStartupArtifacts = null;
  if (startupArtifacts !== null) {
    if (typeof startupArtifacts !== 'string' || startupArtifacts.length === 0) {
      throw new TypeError('startupArtifacts must be a non-empty path');
    }
    resolvedStartupArtifacts = resolve(cwd, startupArtifacts);
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
    if (verdict.ok && !captureImpersonationCapability) {
      console.log(`REUSED snapback server at :${port} (${verdict.detail})`);
      return serverHandle({
        baseUrl: requestedBaseUrl,
        adminToken: env.SNAPBACK_ADMIN_TOKEN ?? process.env.SNAPBACK_ADMIN_TOKEN ?? null,
        reused: true,
        launch: { rung: 'reused', command: null },
        stop: async () => {},
      });
    }
    const reason = verdict.ok
      ? 'this test requires the new child\'s process-bound impersonation sidecar'
      : verdict.reason;
    console.error(
      `PROVENANCE MISMATCH: a server answers /health on :${port} but ${reason}. ` +
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

  // The kit no longer injects checkout-derived SNAPBACK_BUILD_GIT_COMMIT /
  // SNAPBACK_BUILD_GIT_DIRTY into spawned children. build.rs runs its own git
  // probe over the binary's real inputs (ENG-23365/ENG-23419), so injecting
  // the same launch-time read the kit later compares against made the commit
  // check a tautology on the `cargo run` rung — checkout drift was invisible
  // (issues/20260724-kit-identity-stamp-env-injection-tautology.md). The env
  // override stays reserved for deterministic stamps the caller or CI
  // environment supplies explicitly (e.g. scripts/verify-local-proof);
  // verification classifies that case as `env-stamped` instead of pretending
  // it verified the checkout.
  //
  // @ref LLP 0031#server-binary-identity-on-health — the stamp carries
  // information only when it is independent of the expectation it is
  // compared against.
  const childEnv = {
    ...process.env,
    ...env,
    ...runtimeEnv,
    ...(adminToken ? { SNAPBACK_ADMIN_TOKEN: adminToken } : {}),
  };

  const plans = resolveLaunchPlans({ serverBinary, cwd, deps, childEnv, expectedIdentity });
  const attemptContext = {
    port,
    db,
    bindPortExactly,
    resolvedStartupArtifacts,
    cwd,
    childEnv,
    deps,
    expectedIdentity,
    fetchImpl,
    startupTimeoutMs,
    captureImpersonationCapability,
    adminToken,
  };
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    try {
      return await launchServerAttempt(plan, attemptContext);
    } catch (error) {
      if (plan.fallback && index < plans.length - 1) {
        console.error(
          `PREBUILT SNAPBACK REJECTED (${plan.command}): ${error.message}\n` +
            'Falling back to the source-tree `cargo run` rung (LLP 0030 command-resolver ladder).',
        );
        continue;
      }
      throw error;
    }
  }
  throw new Error('snapback server launch resolved no runnable command (LLP 0030 ladder)');
}

// @ref LLP 0030#server-process-ownership — the command-resolver ladder governs
// the kit's shared server lifecycle, not only the Vite plugin: a caller-
// configured binary first, then a provenance-verified prebuilt binary, and
// `cargo run` as the source-tree fallback rather than the default and only
// path (issues/20260724-kit-prebuilt-binary-boot-path.md).
function resolveLaunchPlans({ serverBinary, cwd, deps, childEnv, expectedIdentity }) {
  // deps.launchSpec (test seam) substitutes the cargo rung's command, so the
  // machine-wide env override must not shadow a suite's fixture executable.
  const configured = serverBinary
    ?? (deps.launchSpec ? null : (childEnv.SNAPBACK_SERVER_BINARY || null));
  if (configured) {
    if (typeof configured !== 'string' || configured.length === 0) {
      throw new TypeError('serverBinary must be a non-empty path');
    }
    const command = resolve(cwd, configured);
    if (!existsSync(command)) {
      throw new Error(
        `configured snapback server binary does not exist: ${command} ` +
          '(serverBinary option or SNAPBACK_SERVER_BINARY). Build it with ' +
          '`cargo build`, or drop the configuration to use the LLP 0030 resolver ladder.',
      );
    }
    return [{ rung: 'configured', command }];
  }

  const plans = [];
  const candidate = join(
    cwd,
    'target',
    'debug',
    process.platform === 'win32' ? 'snapback.exe' : 'snapback',
  );
  // The automatic prebuilt rung engages only when the checkout itself is
  // pinned (known commit, clean tree): the booted binary's stamp must then
  // fully verify against it or the child is torn down and the ladder falls
  // through. A dirty checkout goes straight to `cargo run`, which rebuilds
  // with the local edits — the prebuilt binary could not contain them.
  const checkoutPinned = Boolean(
    expectedIdentity.gitCommit
      && expectedIdentity.gitCommit !== 'unknown'
      && expectedIdentity.gitDirty === false,
  );
  if (existsSync(candidate) && checkoutPinned) {
    plans.push({ rung: 'prebuilt', command: candidate, fallback: true, requireVerified: true });
  } else if (existsSync(candidate)) {
    console.log(
      `prebuilt ${candidate} skipped: this checkout is dirty or has no committed ` +
        'identity to verify it against; using the source-tree `cargo run` rung (LLP 0030 ladder)',
    );
  }
  plans.push({ rung: 'cargo' });
  return plans;
}

// One attempt of one resolver-ladder rung: spawn, own the process tree, wait
// for the nonce-verified ready descriptor, and classify the child's build
// identity. Throws with the child already torn down, so a fallback-eligible
// plan can be retried on the next rung.
async function launchServerAttempt(plan, {
  port,
  db,
  bindPortExactly,
  resolvedStartupArtifacts,
  cwd,
  childEnv,
  deps,
  expectedIdentity,
  fetchImpl,
  startupTimeoutMs,
  captureImpersonationCapability,
  adminToken,
}) {
  const readyDir = mkdtempSync(join(tmpdir(), 'snapback-server-'));
  const readyFile = join(readyDir, 'ready.json');
  // Ordinary starts use port zero so the listener binds itself atomically. An
  // explicit restart bind also goes directly to the OS without a preflight
  // probe. In both modes the unique ready-file returns the bound port and
  // process nonce, eliminating adoption and probe-then-bind races.
  const serverArgs = [
    '--port',
    bindPortExactly ? String(port) : '0',
    '--ready-file',
    readyFile,
  ];
  if (db === ':memory:') serverArgs.push('--memory');
  else serverArgs.push('--db', db);
  if (resolvedStartupArtifacts !== null) {
    serverArgs.push('--startup-artifacts', resolvedStartupArtifacts);
  }

  let launch;
  if (plan.rung === 'cargo') {
    const args = ['run', '--quiet', '--', ...serverArgs];
    launch = deps.launchSpec
      ? deps.launchSpec({ args, readyFile, cwd, env: childEnv, expectedIdentity })
      : { command: 'cargo', args, cwd, env: childEnv };
  } else {
    launch = { command: plan.command, args: serverArgs, cwd, env: childEnv };
  }
  // Explicit stamp overrides in the launch environment are the deterministic
  // CI seam (build.rs prefers them over its own git probe), so a cargo-built
  // child's stamp attests the caller's declaration, not an independent probe.
  // A prebuilt binary cannot be re-stamped by env at all, so the seam is only
  // relevant on the cargo rung.
  const launchEnv = launch.env ?? childEnv;
  const envStamp = plan.rung === 'cargo'
    && Boolean(launchEnv.SNAPBACK_BUILD_GIT_COMMIT || launchEnv.SNAPBACK_BUILD_GIT_DIRTY);
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
  const closeTracker = trackLeaderClose(child);
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
  const ownership = ownProcessTree(child, async () => {
    try {
      await stopChild(child, deps.stopOptions);
    } finally {
      cleanup();
    }
  });
  const deadline = Date.now() + startupTimeoutMs; // first run may compile
  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`snapback server spawn failed: ${spawnError.message}`);
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        // ChildProcess `exit` can precede `close` while inherited stdout or
        // stderr is still draining. Give that tail a bounded chance to land
        // before freezing the bounded diagnostic log (ENG-24378 follow-up).
        const drain = await waitForLeaderClose(
          closeTracker,
          deps.startupExitDrainTimeoutMs ?? 1_000,
        );
        const drainNote = drain.ok
          ? ''
          : `\n[startup log may be incomplete: ${drain.error}]`;
        throw new Error(
          `snapback server exited before verified readiness (${child.exitCode ?? child.signalCode}):\n` +
            `${log}${drainNote}`,
        );
      }
      const ready = readReadyDescriptor(readyFile);
      if (ready) {
        const verified = await verifySpawnedReady(ready, {
          expectedIdentity,
          fetchImpl,
          envStamp,
          expectedPort: bindPortExactly ? port : null,
        });
        if (verified.ok) {
          const identity = verified.identity;
          applyIdentityPolicy(plan, identity);
          const baseUrl = ready.serverUrl.replace(/\/$/, '');
          const impersonationCapability = captureImpersonationCapability
            ? readSpawnedImpersonationCapability(ready, readyFile)
            : null;
          let stopPromise = null;
          return serverHandle({
            baseUrl,
            adminToken,
            reused: false,
            startupNonce: ready.startupNonce,
            impersonationCapability,
            identity,
            launch: { rung: plan.rung, command: launch.command },
            stop: () => {
              if (!stopPromise) {
                stopPromise = ownership.stop();
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
      await ownership.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${error.message}; spawned server cleanup failed: ${cleanupError.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

function serverHandle({
  baseUrl,
  adminToken,
  reused,
  stop,
  startupNonce = null,
  impersonationCapability = null,
  identity = null,
  launch = null,
}) {
  const credentials = Object.freeze({ adminToken });
  return {
    baseUrl,
    adminToken,
    credentials,
    clientOptions: credentials,
    reused,
    startupNonce,
    impersonationCapability,
    // Honest build-identity classification of a spawned child (null when
    // reused): { verdict, mismatches, binary, expected }. Verdicts:
    // 'verified' | 'unpinned' | 'env-stamped' | 'unverifiable' |
    // 'stamp-mismatch' (see classifyBinaryIdentity).
    identity,
    // Which LLP 0030 resolver-ladder rung produced this server:
    // { rung: 'configured' | 'prebuilt' | 'cargo' | 'reused', command }.
    launch,
    stop,
  };
}

function readSpawnedImpersonationCapability(ready, readyFile) {
  const advertised = ready?.impersonationCapabilityFile;
  const expected = `${readyFile}.impersonation`;
  if (
    typeof advertised !== 'string'
    || realpathSync(advertised) !== realpathSync(expected)
  ) {
    throw new Error('snapback ready file does not name its mechanical impersonation sidecar');
  }
  const capability = readFileSync(expected, 'utf8');
  if (
    capability.length === 0
    || capability.length > 128
    || !/^sbic_[A-Za-z0-9_-]+\.[0-9a-f]{8}$/.test(capability)
  ) {
    throw new Error('snapback impersonation sidecar is malformed');
  }
  return capability;
}

function resolveTestAdminToken(env) {
  // Server-backed demo tests talk through SnapbackClient, not the CLI that can
  // discover minted token files. Give the child an explicit local token and
  // return it on the server handle so clients can opt into admin operations
  // without mutating or broadly propagating the parent process environment.
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

async function verifySpawnedReady(ready, {
  expectedIdentity,
  fetchImpl,
  expectedPort = null,
  envStamp = false,
}) {
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
  return { ok: true, identity: classifyBinaryIdentity(binary, expectedIdentity, { envStamp }) };
}

/// Honest classification of a spawned child's /health build stamp against the
/// launch-time checkout identity. Process identity is already proven by the
/// ready-file nonce; this classifies BUILD provenance. Verdicts:
///   - 'verified': both sides pinned to the same clean commit — the stamp
///     proves the binary was built from exactly the checkout's committed tree.
///   - 'env-stamped': the launch environment carries an explicit
///     SNAPBACK_BUILD_GIT_COMMIT/…GIT_DIRTY override (the deterministic CI
///     seam), so the stamp attests the caller's declaration, not an
///     independent probe; a commit comparison against the checkout would be
///     circular, so it is not performed.
///   - 'unpinned': the pinned facts agree but a side is dirty (or of unknown
///     dirtiness), so the bytes are not pinned to the commit. Honest, not a
///     failure: dirt outside the binary's tracked build inputs legitimately
///     does not re-stamp it (ENG-23365 tracks exactly the real inputs).
///   - 'unverifiable': a side has no commit identity at all.
///   - 'stamp-mismatch': pinned facts disagree (commit or crate version) —
///     the binary demonstrably is not this checkout's build.
export function classifyBinaryIdentity(binary, expectedIdentity, { envStamp = false } = {}) {
  const expectedCommit = expectedIdentity.gitCommit && expectedIdentity.gitCommit !== 'unknown'
    ? expectedIdentity.gitCommit
    : null;
  const binaryCommit = binary.gitCommit && binary.gitCommit !== 'unknown'
    ? binary.gitCommit
    : null;
  const mismatches = [];
  if (!envStamp && expectedCommit && binaryCommit && binaryCommit !== expectedCommit) {
    mismatches.push(`health commit ${binaryCommit} does not match checkout ${expectedCommit}`);
  }
  if (expectedIdentity.crateVersion && binary.crateVersion !== expectedIdentity.crateVersion) {
    mismatches.push(
      `health crate version ${binary.crateVersion ?? '<missing>'} does not match checkout ${expectedIdentity.crateVersion}`,
    );
  }
  let verdict;
  if (mismatches.length > 0) verdict = 'stamp-mismatch';
  else if (envStamp) verdict = 'env-stamped';
  else if (!expectedCommit || !binaryCommit) verdict = 'unverifiable';
  else if (binary.gitDirty !== false || expectedIdentity.gitDirty !== false) verdict = 'unpinned';
  else verdict = 'verified';
  return {
    verdict,
    mismatches,
    binary: {
      gitCommit: binary.gitCommit ?? null,
      gitDirty: typeof binary.gitDirty === 'boolean' ? binary.gitDirty : null,
      crateVersion: binary.crateVersion ?? null,
    },
    expected: {
      gitCommit: expectedIdentity.gitCommit ?? null,
      gitDirty: typeof expectedIdentity.gitDirty === 'boolean' ? expectedIdentity.gitDirty : null,
      crateVersion: expectedIdentity.crateVersion ?? null,
    },
  };
}

// Rung policy over the classified build identity (LLP 0030 ladder):
// - prebuilt (automatic): only a fully 'verified' stamp may keep the child —
//   anything weaker throws, tearing it down and falling back to `cargo run`.
// - configured (explicit serverBinary / SNAPBACK_SERVER_BINARY): the caller
//   chose the binary, so a stamp mismatch reports loudly and boots anyway —
//   the paved escape for a broken or drifted checkout HEAD — with the honest
//   verdict on the handle for callers that want to refuse.
// - cargo (including the deps.launchSpec test substitution): a pinned-fact
//   mismatch is a hard failure — with the env injection gone it means the
//   build genuinely is not this checkout's (e.g. a stale-stamp replay class
//   regression, or a foreign target directory).
function applyIdentityPolicy(plan, identity) {
  if (plan.requireVerified && identity.verdict !== 'verified') {
    throw new Error(
      `binary identity is ${identity.verdict}` +
        (identity.mismatches.length > 0 ? ` (${identity.mismatches.join('; ')})` : '') +
        `; stamp ${describeStamp(identity.binary)}, checkout ${describeStamp(identity.expected)}`,
    );
  }
  if (identity.mismatches.length > 0) {
    if (plan.rung !== 'configured') {
      throw new Error(
        `spawned server identity verification failed: ${identity.mismatches.join('; ')}`,
      );
    }
    console.error(
      `SERVER BINARY IDENTITY MISMATCH: ${identity.mismatches.join('; ')}. ` +
        'Booting anyway because this binary was explicitly configured ' +
        '(serverBinary / SNAPBACK_SERVER_BINARY); the handle reports ' +
        `identity.verdict "${identity.verdict}".`,
    );
  } else if (identity.verdict !== 'verified') {
    console.log(`spawned snapback binary identity: ${identity.verdict}`);
  }
}

function describeStamp({ gitCommit, gitDirty }) {
  const commit = gitCommit ? String(gitCommit).slice(0, 12) : 'unknown';
  return gitDirty === false ? commit : `${commit}+dirty/unknown`;
}

// @ref LLP 0010#required-tool-surfaces — parent-signal shutdown retains the
// same bounded, attested process-tree teardown as an explicit test cleanup.
// Owned helpers launch detached process groups so ordinary test completion can
// await a strict tree proof. Node's default SIGINT/SIGTERM behavior would skip
// that proof and strand those groups, so all live helpers share one signal
// owner. Normal stop() errors still reject their caller; signal-time failures
// are aggregated and printed before the original signal is re-delivered.
const ownedProcessTrees = new Set();
let ownedServerSignalShutdown = null;
let ownedServerSignalHandlersInstalled = false;

const ownedServerSignalHandlers = {
  SIGINT: () => beginOwnedServerSignalShutdown('SIGINT'),
  SIGTERM: () => beginOwnedServerSignalShutdown('SIGTERM'),
};

function installOwnedServerSignalHandlers() {
  if (ownedServerSignalHandlersInstalled) return;
  ownedServerSignalHandlersInstalled = true;
  process.on('SIGINT', ownedServerSignalHandlers.SIGINT);
  process.on('SIGTERM', ownedServerSignalHandlers.SIGTERM);
}

function removeOwnedServerSignalHandlers() {
  if (!ownedServerSignalHandlersInstalled) return;
  ownedServerSignalHandlersInstalled = false;
  process.removeListener('SIGINT', ownedServerSignalHandlers.SIGINT);
  process.removeListener('SIGTERM', ownedServerSignalHandlers.SIGTERM);
}

// Register ownership as soon as a process is spawned, before readiness or any
// other asynchronous work can observe an early exit. The immediate close
// tracker makes later stopChild() calls safe even when `close` fired before
// teardown began; the memoized stop action also joins explicit cleanup and
// parent-signal cleanup onto one process-tree proof.
//
// @ref LLP 0015#acceptance-rules — acceptance cleanup owns the complete detached
// subprocess tree and cannot publish completion before native exit attestation.
export function ownProcessTree(child, stopAction) {
  if (typeof stopAction !== 'function') {
    throw new TypeError('owned process-tree stop action must be a function');
  }
  trackLeaderClose(child);
  let stopPromise = null;
  const ownership = {
    stop() {
      if (!stopPromise) {
        stopPromise = Promise.resolve()
          .then(stopAction)
          .finally(() => {
            ownedProcessTrees.delete(ownership);
            if (ownedProcessTrees.size === 0 && !ownedServerSignalShutdown) {
              removeOwnedServerSignalHandlers();
            }
          });
      }
      return stopPromise;
    },
  };
  ownedProcessTrees.add(ownership);
  installOwnedServerSignalHandlers();
  return ownership;
}

function beginOwnedServerSignalShutdown(signal) {
  if (ownedServerSignalShutdown) {
    // A second signal is the operator's force-exit request. Restore native
    // handling before re-delivery instead of starting overlapping cleanups.
    // If another listener deliberately absorbs that signal, releasing the
    // active generation also prevents its eventual completion from erasing a
    // newer generation's handlers or leaving shutdown permanently latched.
    releaseOwnedServerSignalShutdown(ownedServerSignalShutdown, signal);
    return;
  }

  const shutdown = { signal };
  ownedServerSignalShutdown = shutdown;
  void finishOwnedServerSignalShutdown(shutdown);
}

async function finishOwnedServerSignalShutdown(shutdown) {
  const { signal } = shutdown;
  const failures = [];
  // A child registered by an already-running startup continuation while an
  // earlier batch settles joins the next batch; no owned tree is omitted.
  while (ownedProcessTrees.size > 0) {
    const owned = [...ownedProcessTrees];
    const results = await Promise.allSettled(owned.map((ownership) => ownership.stop()));
    failures.push(...results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason));
  }
  if (failures.length > 0) {
    console.error(new AggregateError(
      failures,
      `snapback signal cleanup failed for ${failures.length} owned process tree(s)`,
    ));
  }
  releaseOwnedServerSignalShutdown(shutdown, signal);
}

function releaseOwnedServerSignalShutdown(shutdown, signal) {
  // A force-exit signal may already have superseded this asynchronous cleanup
  // generation. In that case its release owns the re-dispatch; the stale
  // continuation must not remove handlers installed for later children.
  if (ownedServerSignalShutdown !== shutdown) return;
  removeOwnedServerSignalHandlers();
  ownedServerSignalShutdown = null;
  redispatchOwnedServerSignal(signal);
}

function redispatchOwnedServerSignal(signal) {
  try {
    process.kill(process.pid, signal);
  } catch (error) {
    console.error(`snapback could not re-deliver ${signal} after server cleanup: ${error.message}`);
    process.exitCode = 1;
  }
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
    `snapback subprocess-tree cleanup not attested for pid ${child?.pid ?? '<unknown>'}: ` +
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

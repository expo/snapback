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
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import {
  attestProcessGroupExit,
  signalProcessTree,
} from '../../scripts/lib/process-tree.mjs';
import { runRuntimeLinkProbe } from '../../scripts/runtime-link-smoke.mjs';

import {
  readCheckoutBinaryIdentity,
  readCommittedBundleHash,
  verifyApiProvenance,
  verifyBinaryProvenance,
} from './provenance.mjs';
import {
  createRuntimeRecoveryRecord,
  qualifyRuntimeBinary,
} from '../../packages/snapback-cli/runtime-recovery.mjs';
import {
  RUNTIME_READINESS_INVALID_CODE,
  issueRuntimeReadinessReceipt,
  verifyRuntimeReadinessReceipt,
} from '../../packages/snapback-cli/runtime-readiness.mjs';
import {
  resolveRegisteredVisibilityGovernanceDevBackendRoot,
  visibilityGovernanceDevEnvironment,
} from '../../packages/snapback-codegen/visibility-governance-dev-config.mjs';

// A clean CI runner can spend nearly a minute compiling before the child
// publishes readiness. Keep that cold start bounded, with enough margin that
// scheduler variance does not turn a healthy build into a lifecycle failure.
const DEFAULT_SERVER_STARTUP_TIMEOUT_MS = 90_000;
export const RUNTIME_RECOVERY_JSON_ENV = 'SNAPBACK_RUNTIME_RECOVERY_JSON';
const verifiedReadyDescriptors = new Map();

function oneLine(value, fallback) {
  const line = String(value ?? '').split(/\r?\n/u, 1)[0].trim();
  return line || fallback;
}

export function formatRuntimeRecoveryFailure(error, environment = process.env) {
  const record = error?.runtimeRecovery;
  if (!record) return null;
  const repairCommand = record.recovery?.repairCommand;
  const overrideCommand = record.recovery?.overrideCommand;
  const lines = [
    'RUNTIME RECOVERY',
    `reason: ${oneLine(error?.message, record.reuse?.reason ?? 'server command resolution failed')}`,
    `repairCommand: ${oneLine(repairCommand, 'unavailable')}`,
    `overrideCommand: ${oneLine(overrideCommand, 'unavailable')}`,
  ];
  if (environment?.[RUNTIME_RECOVERY_JSON_ENV] === '1') {
    lines.push(`recoveryJson: ${JSON.stringify(record)}`);
  }
  return lines.join('\n');
}

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
  // Exact backend whose generated identity this child will activate. Most
  // callers can leave this unset: bundle provenance or startup artifacts
  // resolve it mechanically. Ambiguous launchers must name it explicitly.
  governanceBackendRoot = null,
  // Closed LLP 0057 restore carrier emitted by `snapback auth restore`.
  // The lifecycle helper still owns readiness and teardown; it only projects
  // the native pre-bind declaration flag needed by backup acceptance.
  restoredFromBackup = null,
  // Optional LLP 0157/P1 trust root installed beside the exact generated
  // manifest pair. Acceptance launchers use this after
  // composition-activation-prepare; ordinary demos leave it absent.
  trustedCompositionActivation = null,
  // Test-only capability handoff for the email-code capture mailbox. The
  // value is read only from the mechanical ready-file sibling after the
  // ready nonce has been verified against the live child.
  captureImpersonationCapability = false,
  // Post-readiness death notification: called once with { code, signal,
  // expected: false } if the spawned child exits before stop() is requested.
  // Restart-on-death stays caller policy; the kit only detects and reports
  // (issues/closed/20260724-kit-post-readiness-child-watchdog.md). Never fires
  // for a reused server (there is no owned child to watch).
  onUnexpectedExit = null,
  // Start the child with SNAPBACK_CRON_DISABLED=1: cron definitions still
  // load and inspect, but the scheduler never claims a run on its own —
  // suites drive ticks deterministically via the admin cron/tick endpoint
  // (LLP 0028 §Scheduler state and run ledger).
  cronDisabled = false,
  startupTimeoutMs = DEFAULT_SERVER_STARTUP_TIMEOUT_MS,
  // SIGTERM grace before the SIGKILL escalation. The 3 s default fits the
  // small acceptance databases every demo lived at; a server closing a
  // multi-GiB SQLite store checkpoints its WAL inside SIGTERM handling
  // (verified behavior) and needs a scale-appropriate window, or the kill
  // escalation preempts the checkpoint and leaves a -wal sidecar behind.
  stopGraceMs = null,
} = {}) {
  try {
    return await startServerWithDeps({
      port,
      db,
      cwd,
      env,
      provenance,
      binaryProvenance,
      serverBinary,
      bindPortExactly,
      startupArtifacts,
      governanceBackendRoot,
      restoredFromBackup,
      trustedCompositionActivation,
      captureImpersonationCapability,
      onUnexpectedExit,
      cronDisabled,
      startupTimeoutMs,
      stopGraceMs,
    }, {});
  } catch (error) {
    const recovery = formatRuntimeRecoveryFailure(error, { ...process.env, ...env });
    if (recovery === null) throw error;
    console.error(recovery);
    // The public launcher is the shared demo entry-point boundary. An
    // exhausted resolver ladder is terminal here: the internal test seam
    // still throws for assertions, while demos exit without Node serializing
    // the attached recovery record a second time.
    process.exit(1);
  }
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
  governanceBackendRoot = null,
  restoredFromBackup = null,
  trustedCompositionActivation = null,
  captureImpersonationCapability = false,
  onUnexpectedExit = null,
  cronDisabled = false,
  startupTimeoutMs = DEFAULT_SERVER_STARTUP_TIMEOUT_MS,
  stopGraceMs = null,
} = {}, deps = {}) {
  if (bindPortExactly && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new TypeError('bindPortExactly requires an explicit TCP port from 1 through 65535');
  }
  if (stopGraceMs !== null && (!Number.isInteger(stopGraceMs) || stopGraceMs < 0)) {
    throw new TypeError('stopGraceMs must be a nonnegative integer when provided');
  }
  if (onUnexpectedExit !== null && typeof onUnexpectedExit !== 'function') {
    throw new TypeError('onUnexpectedExit must be a function when provided');
  }
  let resolvedStartupArtifacts = null;
  if (startupArtifacts !== null) {
    if (typeof startupArtifacts !== 'string' || startupArtifacts.length === 0) {
      throw new TypeError('startupArtifacts must be a non-empty path');
    }
    resolvedStartupArtifacts = resolve(cwd, startupArtifacts);
  }
  const resolvedGovernanceBackendRoot = resolveGovernanceBackendForLaunch({
    cwd,
    provenance,
    resolvedStartupArtifacts,
    governanceBackendRoot,
  });
  if (
    restoredFromBackup !== null
    && (typeof restoredFromBackup !== 'string' || restoredFromBackup.length === 0)
  ) {
    throw new TypeError('restoredFromBackup must be a non-empty declaration id');
  }
  let resolvedTrustedCompositionActivation = null;
  if (trustedCompositionActivation !== null) {
    if (
      typeof trustedCompositionActivation !== 'string'
      || trustedCompositionActivation.length === 0
    ) {
      throw new TypeError('trustedCompositionActivation must be a non-empty path');
    }
    resolvedTrustedCompositionActivation = resolve(cwd, trustedCompositionActivation);
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const requestedBaseUrl = `http://127.0.0.1:${port}`;
  const occupied = !bindPortExactly && port !== 0 && await isPortOccupied(port);

  // A requested port is a reuse candidate, never an unsafe spawn target. A
  // healthy matching Snapback process may be reused. Every other listener is
  // named before we ask the OS for an isolated port; cargo is never launched
  // into an occupied address (ENG-24378).
  if (!bindPortExactly && occupied && await isHealthy(requestedBaseUrl, fetchImpl)) {
    let verdict = await reuseVerdict(requestedBaseUrl, {
      provenance,
      binaryProvenance,
      cwd,
      fetchImpl,
    });
    // Rung readiness coverage for `reused` (LLP 0115 CV-3): a running server
    // cannot be re-qualified from outside, so reuse additionally requires a
    // locally receipted, digest-coherent runtime whose build identity the
    // live /health stamp matches. Anything else refuses reuse and starts a
    // fresh, receipt-gated server instead.
    let readiness = null;
    const reuseSeam = resolveReadinessSeam(deps);
    if (verdict.ok && reuseSeam) {
      readiness = await reusedRuntimeReadiness({
        baseUrl: requestedBaseUrl,
        cwd,
        env,
        serverBinary,
        seam: reuseSeam,
        fetchImpl,
      });
      if (!readiness.ok) verdict = { ok: false, reason: readiness.reason };
    }
    if (verdict.ok && !captureImpersonationCapability && !cronDisabled) {
      const recoveredDevIdentity = await recoverReusedDevIdentityCapability(
        requestedBaseUrl,
        { db, cwd, fetchImpl },
      );
      console.log(`REUSED snapback server at :${port} (${verdict.detail})`);
      return serverHandle({
        baseUrl: requestedBaseUrl,
        adminToken: env.SNAPBACK_ADMIN_TOKEN ?? process.env.SNAPBACK_ADMIN_TOKEN ?? null,
        devIdentityCapability: recoveredDevIdentity.capability,
        devIdentityCapabilityNote: recoveredDevIdentity.note,
        reused: true,
        launch: { rung: 'reused', command: null },
        runtimeRecovery: createRuntimeRecoveryRecord({
          selectionRung: 'reused',
          buildable: null,
          runnable: true,
          qualification: readiness
            ? {
                probe: 'persisted-receipt',
                ok: true,
                reason: 'a running server cannot be re-qualified in place; readiness is bound by receipt digest-coherence plus /health identity',
                receiptPath: readiness.verdict.receiptPath,
              }
            : null,
          reuseAllowed: true,
          reuseReason: verdict.detail,
        }),
        stop: async () => {},
      });
    }
    const reason = verdict.ok
      ? (cronDisabled
        ? 'this test requires a child started with SNAPBACK_CRON_DISABLED (a reused server may have a live scheduler)'
        : 'this test requires the new child\'s process-bound impersonation sidecar')
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
  let childEnv = {
    ...process.env,
    ...env,
    ...runtimeEnv,
    ...(cronDisabled ? { SNAPBACK_CRON_DISABLED: '1' } : {}),
    ...(adminToken ? { SNAPBACK_ADMIN_TOKEN: adminToken } : {}),
  };
  const plans = resolveLaunchPlans({ serverBinary, cwd, deps, childEnv, expectedIdentity });
  const attemptContext = {
    port,
    db,
    bindPortExactly,
    resolvedStartupArtifacts,
    resolvedGovernanceBackendRoot,
    restoredFromBackup,
    resolvedTrustedCompositionActivation,
    cwd,
    childEnv,
    explicitEnvironment: env === process.env ? {} : env,
    deps,
    expectedIdentity,
    fetchImpl,
    startupTimeoutMs,
    captureImpersonationCapability,
    adminToken,
    onUnexpectedExit,
    stopGraceMs,
  };
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    try {
      await proveCargoFallback(plan, {
        cwd,
        childEnv,
        deps,
        startupTimeoutMs,
      });
      certifyRuntimeReadiness(plan, { cwd, childEnv, deps, expectedIdentity });
      return await launchServerAttempt(plan, attemptContext);
    } catch (error) {
      if (plan.fallback && index < plans.length - 1) {
        console.error(
          `PREBUILT SNAPBACK REJECTED (${plan.command}): ${error.message}\n` +
            'Falling back to the source-tree `cargo run` rung (LLP 0030 command-resolver ladder).',
        );
        plans[index + 1].reuseSkipReason =
          `automatic ${plan.rung} reuse failed: ${error.message}`;
        continue;
      }
      const fallbackBinary = join(
        cwd,
        'target',
        'debug',
        process.platform === 'win32' ? 'snapback.exe' : 'snapback',
      );
      if (!error.runtimeRecovery) {
        error.runtimeRecovery = createRuntimeRecoveryRecord({
          selectedBinary: existsSync(fallbackBinary) ? fallbackBinary : null,
          selectionRung: plan.rung,
          expected: expectedIdentity,
          buildable: plan.rung === 'cargo' ? false : null,
          runnable: null,
          reuseAllowed: false,
          reuseReason: error.message,
          diagnostic: { code: 'SNAPBACK_SERVER_LAUNCH_FAILED' },
          producerInputs: {
            cwd,
            command: plan.command ?? 'cargo',
            rung: plan.rung,
          },
          repairCommand: `${join(cwd, 'scripts/bootstrap-ibex-runtime')}`,
          overrideCommand: existsSync(fallbackBinary)
            ? `SNAPBACK_SERVER_BINARY=${JSON.stringify(fallbackBinary)}`
            : null,
        });
      }
      throw error;
    }
  }
  throw new Error('snapback server launch resolved no runnable command (LLP 0030 ladder)');
}

function resolveGovernanceBackendForLaunch({
  cwd,
  provenance,
  resolvedStartupArtifacts,
  governanceBackendRoot,
}) {
  if (governanceBackendRoot !== null) {
    if (typeof governanceBackendRoot !== 'string' || governanceBackendRoot.length === 0) {
      throw new TypeError('governanceBackendRoot must be a non-empty path');
    }
    return resolve(cwd, governanceBackendRoot);
  }
  if (typeof provenance?.artifactsPath === 'string' && provenance.artifactsPath.length > 0) {
    return dirname(dirname(resolve(cwd, provenance.artifactsPath)));
  }
  if (resolvedStartupArtifacts === null
      || !existsSync(join(cwd, 'scripts', 'visibility-governance-dev-apps.v1.json'))) {
    return null;
  }
  let carrier;
  try {
    carrier = JSON.parse(readFileSync(resolvedStartupArtifacts, 'utf8'));
  } catch (error) {
    throw new TypeError(`startupArtifacts must contain readable JSON: ${error.message}`);
  }
  const governance = carrier?.schema?.visibilityGovernance;
  if (governance === undefined || governance === null) return null;
  return resolveRegisteredVisibilityGovernanceDevBackendRoot({
    repositoryRoot: cwd,
    appId: carrier.schema.appId,
    schemaHash: carrier.schema.schemaHash,
    functionBundleHash: carrier.functions?.bundleHash,
    generationInputsHash: governance.generationInputsHash,
  });
}

// @ref LLP 0115#cv-3-a-persisted-readiness-receipt-across-doctor-bootstrap-and-harness —
// every rung consumes the same persisted readiness receipt bootstrap/doctor
// use; fixture launchers (deps.launchSpec) get a disabled seam unless a test
// injects the pieces explicitly, mirroring proveCargoFallback's probe rule.
function resolveReadinessSeam(deps) {
  const injected = deps.verifyReadiness || deps.issueReadiness || deps.qualifyRuntime;
  if (!injected && deps.launchSpec) return null;
  return {
    verify: deps.verifyReadiness ?? verifyRuntimeReadinessReceipt,
    issue: deps.issueReadiness ?? issueRuntimeReadinessReceipt,
    qualify: deps.qualifyRuntime ?? qualifyRuntimeBinary,
  };
}

// Certify the `configured` and `prebuilt` rungs against the persisted
// readiness receipt before anything is spawned. An absent/stale/incoherent
// receipt self-heals by re-qualifying the exact resolved binary (the CV-2
// probe, milliseconds) and reissuing; when the binary cannot qualify — the
// incident state — this throws the shared CV-2 code, so a prebuilt failure
// falls back to the cargo rung and a configured failure is a hard coded
// error (issues/closed/20260730-kit-rungs-skip-handler-vm-qualification.md). The
// cargo rung is certified by the exact-link probe itself, which qualifies
// and issues the receipt for the binary it just built.
function certifyRuntimeReadiness(plan, { cwd, childEnv, deps, expectedIdentity }) {
  if (plan.rung !== 'configured' && plan.rung !== 'prebuilt') return;
  const seam = resolveReadinessSeam(deps);
  if (!seam) return;
  let verdict = seam.verify({ root: cwd, binaryPath: plan.command });
  let qualification = null;
  if (!verdict.ok) {
    qualification = seam.qualify(plan.command, childEnv);
    if (qualification.ok) {
      try {
        seam.issue({
          root: cwd,
          binaryPath: plan.command,
          qualification: {
            probe: 'restricted-no-eval-handler-vm',
            ok: true,
            report: qualification.report,
          },
          issuer: `kit-${plan.rung}`,
        });
      } catch {
        // Re-verification below reports the persistent state honestly.
      }
      verdict = seam.verify({ root: cwd, binaryPath: plan.command });
    }
  }
  if (!verdict.ok) {
    const code = qualification && !qualification.ok
      ? 'SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED'
      : RUNTIME_READINESS_INVALID_CODE;
    const detail = qualification && !qualification.ok
      ? `the ${plan.rung} binary could not create its restricted no-eval handler VM: ${qualification.reason}`
      : `readiness receipt ${verdict.reason} for the ${plan.rung} binary ${plan.command}`;
    const error = new Error(`${code}: ${detail}`);
    error.code = code;
    error.diagnostic = verdict.diagnostic ?? {
      code,
      severity: 'error',
      subsystem: 'runtime-readiness',
      message: detail,
    };
    error.runtimeRecovery = createRuntimeRecoveryRecord({
      selectedBinary: plan.command,
      selectionRung: plan.rung,
      expected: expectedIdentity,
      runnable: qualification ? qualification.ok : null,
      qualification: qualification
        ? { probe: 'restricted-no-eval-handler-vm', ok: qualification.ok, reason: qualification.reason }
        : { probe: 'persisted-receipt', ok: false, reason: verdict.reason },
      reuseAllowed: false,
      reuseReason: detail,
      diagnostic: { code },
      repairCommand: `${join(cwd, 'scripts/bootstrap-ibex-runtime')}`,
    });
    throw error;
  }
  plan.readiness = verdict;
}

async function proveCargoFallback(plan, {
  cwd,
  childEnv,
  deps,
  startupTimeoutMs,
}) {
  if (plan.rung !== 'cargo') return;
  // Fixture launchers do not compile Cargo. A test can still inject the probe
  // explicitly to exercise this boundary without a native build.
  const probe = deps.runtimeLinkProbe
    ?? (deps.launchSpec ? null : runRuntimeLinkProbe);
  if (probe === null) return;
  const configuredTarget = childEnv.CARGO_TARGET_DIR;
  const targetDirectory = configuredTarget
    ? resolve(cwd, configuredTarget)
    : join(cwd, 'target');
  const result = await probe({
    root: cwd,
    environment: childEnv,
    timeoutMs: startupTimeoutMs,
    targetDirectory,
    keepTarget: true,
  });
  if (!result?.ok) {
    const diagnostic = result?.diagnostic ?? {
      code: 'SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED',
      severity: 'error',
      subsystem: 'runtime-link',
      message: 'the exact runtime-link probe returned no usable result',
    };
    const error = new Error(`${diagnostic.code}: ${diagnostic.message}`);
    error.code = diagnostic.code;
    error.diagnostic = diagnostic;
    error.runtimeRecovery = result?.recovery ?? null;
    throw error;
  }
  plan.runtimeLinkRecovery = result.recovery;
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
  // pinned (known commit, clean runtime input set — the scoped dirtiness of
  // readCheckoutBinaryIdentity): the booted binary's stamp must then fully
  // verify against it or the child is torn down and the ladder falls through.
  // A dirty runtime input set goes straight to `cargo run`, which rebuilds
  // with the local edits — the prebuilt binary could not contain them. Edits
  // outside the input set (demo apps, LLPs, issues) cannot change the
  // binary's bytes and do not forfeit the prebuilt rung
  // (issues/closed/20260805-whole-tree-dirty-flag-forces-runtime-rebuild.md).
  const checkoutPinned = Boolean(
    expectedIdentity.gitCommit
      && expectedIdentity.gitCommit !== 'unknown'
      && expectedIdentity.gitDirty === false,
  );
  if (existsSync(candidate) && checkoutPinned) {
    plans.push({ rung: 'prebuilt', command: candidate, fallback: true, requireVerified: true });
  } else if (existsSync(candidate)) {
    console.log(
      `prebuilt ${candidate} skipped: this checkout's runtime input set is dirty or has ` +
        'no committed identity to verify it against; using the source-tree `cargo run` rung (LLP 0030 ladder)',
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
  resolvedGovernanceBackendRoot,
  restoredFromBackup,
  resolvedTrustedCompositionActivation,
  cwd,
  childEnv,
  explicitEnvironment,
  deps,
  expectedIdentity,
  fetchImpl,
  startupTimeoutMs,
  captureImpersonationCapability,
  adminToken,
  onUnexpectedExit = null,
  stopGraceMs = null,
}) {
  const readyDir = mkdtempSync(join(tmpdir(), 'snapback-server-'));
  const readyFile = join(readyDir, 'ready.json');
  let attemptChildEnv = childEnv;
  let governanceTargetConfigPath = null;
  const devRegistry = join(cwd, 'scripts', 'visibility-governance-dev-apps.v1.json');
  if (existsSync(devRegistry)) {
    // @ref LLP 0234#d4--production-authority-expires-fixtures-cannot-become-production
    // — each owned child gets a fresh config under the same per-start custody
    // directory as its ready descriptor. Ambient process.env paths are not
    // caller custody, and the independently resolved native profile remains
    // the reader-side production fence.
    try {
      const prepared = visibilityGovernanceDevEnvironment({
        environment: childEnv,
        callerEnvironment: explicitEnvironment,
        backendRoot: resolvedGovernanceBackendRoot,
        repositoryRoot: cwd,
        outputPath: join(readyDir, 'visibility-governance-dev-target-config.json'),
      });
      attemptChildEnv = prepared.environment;
      governanceTargetConfigPath = prepared.path;
    } catch (error) {
      rmSync(readyDir, { recursive: true, force: true });
      throw error;
    }
  }
  // Ordinary starts use port zero so the listener binds itself atomically. An
  // explicit restart bind also goes directly to the OS without a preflight
  // probe. In both modes the unique ready-file returns the bound port and
  // process nonce, eliminating adoption and probe-then-bind races.
  // @ref LLP 0024#dated-amendment-native-machine-mode-2026-08-08 — bare native
  // invocation is help-only; every owned server launch names `start`.
  const serverArgs = [
    'start',
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
  if (restoredFromBackup !== null) {
    serverArgs.push('--restored-from-backup', restoredFromBackup);
  }
  if (resolvedTrustedCompositionActivation !== null) {
    serverArgs.push('--trusted-composition-activation', resolvedTrustedCompositionActivation);
  }

  let launch;
  if (plan.rung === 'cargo') {
    const args = ['run', '--quiet', '--', ...serverArgs];
    launch = deps.launchSpec
      ? deps.launchSpec({ args, readyFile, cwd, env: attemptChildEnv, expectedIdentity })
      : { command: 'cargo', args, cwd, env: attemptChildEnv };
  } else {
    launch = { command: plan.command, args: serverArgs, cwd, env: attemptChildEnv };
  }
  // Explicit stamp overrides in the launch environment are the deterministic
  // CI seam (build.rs prefers them over its own git probe), so a cargo-built
  // child's stamp attests the caller's declaration, not an independent probe.
  // A prebuilt binary cannot be re-stamped by env at all, so the seam is only
  // relevant on the cargo rung.
  const launchEnv = launch.env ?? attemptChildEnv;
  const envStamp = plan.rung === 'cargo'
    && Boolean(launchEnv.SNAPBACK_BUILD_GIT_COMMIT || launchEnv.SNAPBACK_BUILD_GIT_DIRTY);
  let child;
  try {
    child = (deps.spawnImpl ?? spawn)(launch.command, launch.args, {
      cwd: launch.cwd ?? cwd,
      env: launch.env ?? attemptChildEnv,
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

  let registeredBaseUrl = null;
  const cleanup = () => {
    if (registeredBaseUrl !== null) {
      const registered = verifiedReadyDescriptors.get(registeredBaseUrl);
      if (registered?.readyFile === readyFile) verifiedReadyDescriptors.delete(registeredBaseUrl);
    }
    rmSync(readyDir, { recursive: true, force: true });
  };
  // Death seen at close time is classified against this flag: an exit that
  // lands after any owned teardown began (explicit stop() or the parent-signal
  // owner) is expected; anything earlier is an unexpected post-readiness death.
  const watchState = { exit: null, stopRequested: false, listeners: new Set() };
  const ownership = ownProcessTree(child, async () => {
    watchState.stopRequested = true;
    try {
      await stopChild(child, {
        ...deps.stopOptions,
        ...(stopGraceMs !== null ? {graceMs: stopGraceMs} : {}),
      });
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
          if (!bindPortExactly && port !== 0 && ready.port !== port) {
            // The requested port is a verified-reuse probe, never a bind
            // guarantee; the deliberate fallback to an OS-assigned isolated
            // port must be loud, not silent
            // (issues/closed/20260724-kit-bind-port-exactly-default-and-docs.md).
            console.error(
              `PORT REASSIGNED: requested :${port} but the isolated child bound :${ready.port}. ` +
                'Callers must read the returned baseUrl; pass bindPortExactly to bind-or-fail instead ' +
                '(demos/_kit/README.md "Port semantics").',
            );
          }
          const impersonationCapability = captureImpersonationCapability
            ? readSpawnedImpersonationCapability(ready, readyFile)
            : null;
          const devIdentityCapability = readSpawnedDevIdentityCapability(
            ready,
            readyFile,
            db,
            cwd,
          );
          registeredBaseUrl = baseUrl;
          verifiedReadyDescriptors.set(baseUrl, Object.freeze({ readyFile }));
          armChildWatchdog(watchState, { closeTracker, baseUrl, onUnexpectedExit, logTail: () => log });
          let stopPromise = null;
          return serverHandle({
            baseUrl,
            pid: child.pid,
            adminToken,
            reused: false,
            startupNonce: ready.startupNonce,
            impersonationCapability,
            devIdentityCapability,
            watch: watchState,
            identity,
            launch: { rung: plan.rung, command: launch.command },
            governanceTargetConfigPath,
            runtimeRecovery: createRuntimeRecoveryRecord({
              selectedBinary: plan.rung === 'cargo'
                ? join(cwd, 'target', 'debug', process.platform === 'win32' ? 'snapback.exe' : 'snapback')
                : plan.command,
              selectionRung: plan.rung,
              expected: expectedIdentity,
              actualStamp: identity.binary,
              buildable: plan.rung === 'cargo' ? true : null,
              runnable: true,
              qualification: plan.runtimeLinkRecovery?.qualification
                ?? (plan.readiness
                  ? {
                      probe: 'persisted-receipt',
                      ok: true,
                      reason: null,
                      receiptPath: plan.readiness.receiptPath,
                    }
                  : null),
              reuseAllowed: true,
              reuseReason: plan.reuseSkipReason
                ?? `selected ${plan.rung} binary launched with identity verdict ${identity.verdict}`,
              diagnostic: plan.runtimeLinkRecovery?.diagnostic ?? null,
              producerInputs: plan.runtimeLinkRecovery?.producerInputs ?? {
                cwd,
                command: launch.command,
                rung: plan.rung,
              },
              overrideCommand: plan.rung === 'configured'
                ? `SNAPBACK_SERVER_BINARY=${JSON.stringify(plan.command)}`
                : null,
            }),
            outputTail: () => log,
            stop: () => {
              if (!stopPromise) {
                stopPromise = ownership.stop().then(() => {
                  // Teardown of the (possibly already-dead) tree and the ready
                  // dir still runs, but a stop() issued only after the child
                  // died on its own must not attest a clean shutdown.
                  if (watchState.exit && !watchState.exit.expected) {
                    throw childDiedError({ baseUrl, exit: watchState.exit, phase: 'stop' });
                  }
                });
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
  pid = null,
  adminToken,
  reused,
  stop,
  startupNonce = null,
  impersonationCapability = null,
  devIdentityCapability = null,
  devIdentityCapabilityNote = null,
  watch = null,
  identity = null,
  launch = null,
  runtimeRecovery = null,
  governanceTargetConfigPath = null,
  outputTail = null,
}) {
  const credentials = Object.freeze({ adminToken, devIdentityCapability });
  return {
    baseUrl,
    pid,
    adminToken,
    credentials,
    clientOptions: credentials,
    reused,
    startupNonce,
    impersonationCapability,
    devIdentityCapability,
    devIdentityCapabilityNote,
    // Post-readiness watchdog surface. `exit` is null while the owned child is
    // alive (and always null for a reused server, which has no owned child);
    // after the child closes it is { code, signal, expected }. `expected` is
    // true only when an owned teardown (stop() or the parent-signal owner)
    // began before the exit.
    get exit() {
      return watch?.exit ?? null;
    },
    // Fail fast with a typed diagnostic instead of letting a dead backend
    // surface as raw connection errors mid-suite.
    assertAlive() {
      if (watch?.exit) throw childDiedError({ baseUrl, exit: watch.exit, phase: 'use' });
    },
    // Subscribe to unexpected death; fires immediately (async) when the child
    // is already dead. Returns an unsubscribe function.
    onUnexpectedExit(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('onUnexpectedExit listener must be a function');
      }
      if (!watch) return () => {};
      if (watch.exit) {
        if (!watch.exit.expected) queueMicrotask(() => listener(watch.exit));
        return () => {};
      }
      watch.listeners.add(listener);
      return () => watch.listeners.delete(listener);
    },
    // Honest build-identity classification of a spawned child (null when
    // reused): { verdict, mismatches, binary, expected }. Verdicts:
    // 'verified' | 'pinned-binary-dirty-checkout' | 'unpinned-binary' |
    // 'env-stamped' | 'unverifiable' | 'stamp-mismatch'
    // (see classifyBinaryIdentity).
    identity,
    // Which LLP 0030 resolver-ladder rung produced this server:
    // { rung: 'configured' | 'prebuilt' | 'cargo' | 'reused', command }.
    launch,
    // One shared recovery record across source doctor/bootstrap, packaged
    // doctor/dev, and demo harnesses. It keeps selection and binary stamp
    // facts together so callers never have to reconstruct a safe override
    // from prose.
    runtimeRecovery,
    governanceTargetConfigPath,
    // A bounded read-only view used by supervising acceptance gates when a
    // setup/lane failure needs the owned child's recent stdout/stderr. Callers
    // remain responsible for redaction before retaining or printing it.
    outputTail({ lines = 40 } = {}) {
      if (!Number.isInteger(lines) || lines < 1) throw new TypeError('output tail lines must be positive');
      return String(outputTail?.() ?? '').split(/\r?\n/u).slice(-lines).join('\n');
    },
    stop,
  };
}

// A child that dies after readiness must never masquerade as a live backend:
// the handle records the death, tells the caller, and every later use carries
// one typed diagnostic instead of raw ECONNREFUSED noise
// (issues/closed/20260724-kit-post-readiness-child-watchdog.md; the All Aboard
// external review watched an arm answer 500s from a dead child). The watchdog
// arms only after verified readiness — pre-readiness exits stay the startup
// loop's "exited before verified readiness" diagnostic.
function armChildWatchdog(watchState, { closeTracker, baseUrl, onUnexpectedExit, logTail }) {
  if (typeof onUnexpectedExit === 'function') watchState.listeners.add(onUnexpectedExit);
  void closeTracker.promise.then((detail) => {
    watchState.exit = Object.freeze({
      code: detail?.code ?? null,
      signal: detail?.signal ?? null,
      expected: watchState.stopRequested,
    });
    const listeners = [...watchState.listeners];
    watchState.listeners.clear();
    if (watchState.exit.expected) return;
    const tail = String(logTail?.() ?? '').slice(-4_096);
    console.error(
      `SNAPBACK SERVER DIED: the child for ${baseUrl} exited (${describeChildExit(watchState.exit)}) ` +
        'after verified readiness. Further handle use fails fast with SNAPBACK_SERVER_CHILD_DIED ' +
        `and stop() will not attest a clean teardown.${tail ? `\nRecent server output:\n${tail}` : ''}`,
    );
    for (const listener of listeners) {
      try {
        listener(watchState.exit);
      } catch (error) {
        console.error(`snapback onUnexpectedExit listener failed: ${error.message}`);
      }
    }
  });
}

function describeChildExit(exit) {
  return exit.signal !== null ? `signal ${exit.signal}` : `code ${exit.code ?? 'unknown'}`;
}

function childDiedError({ baseUrl, exit, phase }) {
  const detail = describeChildExit(exit);
  const error = new Error(
    phase === 'stop'
      ? `snapback server child for ${baseUrl} had already died (${detail}) before stop() was requested; ` +
        'the tree was cleaned up, but this stop cannot attest a clean shutdown'
      : `snapback server child for ${baseUrl} is no longer running (${detail}` +
        `${exit.expected ? ', stopped by this process' : ''})`,
  );
  error.code = 'SNAPBACK_SERVER_CHILD_DIED';
  error.exit = exit;
  return error;
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

function readSpawnedDevIdentityCapability(ready, readyFile, database, cwd) {
  const advertised = ready?.devIdentityCapabilityFile;
  // @ref LLP 0262#d2-carriers-per-shipped-topology — older binaries omit the
  // descriptor field; Stage 1 kit consumers remain compatible in that case.
  if (typeof advertised !== 'string') return null;
  const expected = database === ':memory:'
    ? `${readyFile}.dev-identity`
    : `${resolve(cwd, database)}.dev-identity`;
  const canonicalLeaf = (path) => {
    const resolved = resolve(cwd, path);
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
  };
  if (canonicalLeaf(advertised) !== canonicalLeaf(expected)) {
    throw new Error('snapback ready file does not name its dev-identity sidecar on the anchor ladder');
  }
  const metadata = lstatSync(expected);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o777) !== 0o600
  ) {
    throw new Error('snapback dev-identity sidecar must be a regular owner-only (0600) file');
  }
  const capability = readFileSync(expected, 'utf8').trim();
  if (
    capability.length === 0
    || capability.length > 256
    || !/^sbdev_[A-Za-z0-9._~-]+$/u.test(capability)
  ) {
    throw new Error('snapback dev-identity sidecar is malformed');
  }
  return capability;
}

async function recoverReusedDevIdentityCapability(baseUrl, { db, cwd, fetchImpl }) {
  const registered = verifiedReadyDescriptors.get(baseUrl);
  if (registered === undefined) {
    return {
      capability: null,
      note: 'dev-identity custody is unavailable: no nonce-verified ready descriptor is held for the reused server',
    };
  }
  try {
    const ready = readReadyDescriptor(registered.readyFile);
    if (ready === null || ready.serverUrl.replace(/\/$/u, '') !== baseUrl) {
      throw new Error('the retained ready descriptor no longer names the reused server');
    }
    const response = await fetchImpl(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) throw new Error(`health returned HTTP ${response.status}`);
    const health = await response.json();
    if (health?.binary?.startupNonce !== ready.startupNonce) {
      throw new Error('the retained ready descriptor nonce does not match live health');
    }
    const capability = readSpawnedDevIdentityCapability(
      ready,
      registered.readyFile,
      db,
      cwd,
    );
    return capability === null
      ? {
          capability: null,
          note: 'dev-identity custody is unavailable: the verified reused descriptor advertises no carrier',
        }
      : { capability, note: null };
  } catch (error) {
    return {
      capability: null,
      note: `dev-identity custody is unavailable: ${oneLine(error?.message, 'carrier recovery failed')}`,
    };
  }
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

// The `reused` rung's readiness binding. The running process's mapped
// framework cannot be re-digested from outside, so this is deliberately an
// identity bind, not a process proof: the live /health build stamp must match
// a local receipt that is still digest-coherent with the on-disk binary and
// CURRENT Hermes artifacts. A framework swapped after issuance refuses reuse
// (receipt framework-drift) even though the running process keeps serving its
// already-mapped copy — the fresh spawn relinks and requalifies instead.
async function reusedRuntimeReadiness({ baseUrl, cwd, env, serverBinary, seam, fetchImpl }) {
  let health;
  try {
    const response = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      return { ok: false, reason: `its /health identity is unavailable (HTTP ${response.status}), so no readiness receipt can be bound to it (${RUNTIME_READINESS_INVALID_CODE})` };
    }
    health = await response.json();
  } catch (error) {
    return { ok: false, reason: `its /health identity is unavailable (${error.message}), so no readiness receipt can be bound to it (${RUNTIME_READINESS_INVALID_CODE})` };
  }
  const live = health?.binary;
  const configured = serverBinary
    ?? env?.SNAPBACK_SERVER_BINARY
    ?? process.env.SNAPBACK_SERVER_BINARY
    ?? null;
  const candidate = configured
    ? resolve(cwd, configured)
    : join(cwd, 'target', 'debug', process.platform === 'win32' ? 'snapback.exe' : 'snapback');
  const verdict = seam.verify({ root: cwd, binaryPath: candidate });
  if (!verdict.ok) {
    return {
      ok: false,
      reason: `no coherent readiness receipt covers ${candidate} (${verdict.reason}); a running server cannot be re-qualified in place, so reuse requires a receipted local runtime (${RUNTIME_READINESS_INVALID_CODE})`,
    };
  }
  const receipted = verdict.receipt.buildIdentity;
  if (
    !live?.gitCommit
    || !receipted?.gitCommit
    || live.gitCommit !== receipted.gitCommit
    || (receipted.crateVersion && live.crateVersion !== receipted.crateVersion)
  ) {
    return {
      ok: false,
      reason: `its /health identity (commit ${String(live?.gitCommit ?? 'unknown').slice(0, 12)}) does not match the receipted local runtime ${candidate} (commit ${String(receipted?.gitCommit ?? 'unknown').slice(0, 12)}), so the readiness receipt cannot vouch for it (${RUNTIME_READINESS_INVALID_CODE})`,
    };
  }
  return { ok: true, candidate, verdict };
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
///   - 'pinned-binary-dirty-checkout': the binary's own stamp is a CLEAN
///     exact build of the agreed commit — its commit evidence is exact — and
///     only the comparing checkout is dirty (or of unknown dirtiness). Split
///     out of the old 'unpinned' so an explicitly configured exact binary is
///     not misread as weak provenance (LLP 0115 CV-15, Diary 0039 P2-15).
///   - 'unpinned-binary': the binary's own stamp is dirty or of unknown
///     dirtiness, so ITS bytes are not pinned to the agreed commit. Honest,
///     not a failure: dirt outside the binary's tracked build inputs
///     legitimately does not re-stamp it (ENG-23365 tracks the real inputs).
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
  else if (binary.gitDirty !== false) verdict = 'unpinned-binary';
  else if (expectedIdentity.gitDirty !== false) verdict = 'pinned-binary-dirty-checkout';
  else verdict = 'verified';
  return {
    verdict,
    mismatches,
    binary: {
      gitCommit: binary.gitCommit ?? null,
      gitDirty: typeof binary.gitDirty === 'boolean' ? binary.gitDirty : null,
      crateVersion: binary.crateVersion ?? null,
      buildProfile: binary.buildProfile ?? null,
      startupNonce: binary.startupNonce ?? null,
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

// A detached program may let a helper inherit the parent's stdout/stderr pipe
// even after the owned process group and its leader are gone. In that case
// Node deliberately withholds ChildProcess `close` until the inherited writer
// disappears, conflating an unrelated descriptor lifetime with process-tree
// lifetime. Release only the parent's read handles, and only after native
// process-group attestation has proved the owned tree exited. The prior data
// listeners have already drained every byte written by the owned tree.
function releaseLeaderPipesAfterTreeExit(child) {
  for (const stream of [child?.stdout, child?.stderr]) {
    if (stream && !stream.destroyed) stream.destroy();
  }
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
  initialSignal = 'SIGTERM',
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
  if (initialSignal !== 'SIGTERM' && initialSignal !== 'SIGKILL') {
    throw new TypeError('stopChild initialSignal must be SIGTERM or SIGKILL');
  }

  const closeTracker = trackLeaderClose(child);
  const signalOptions = {
    spawnImpl,
    platform,
    taskkillTimeoutMs,
    processGroupTimeoutMs,
    processGroupPollMs,
    processKill,
  };
  if (initialSignal === 'SIGKILL') {
    const kill = await signalTree(child, 'SIGKILL', signalOptions);
    if (kill.ok && platform !== 'win32') releaseLeaderPipesAfterTreeExit(child);
    const leader = await waitForLeaderClose(closeTracker, leaderCloseTimeoutMs);
    if (kill.ok && leader.ok) return;
    throw cleanupFailure(child, { term: null, kill, leader });
  }
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
    const graceful = await gracefulGroup;
    if (graceful.ok) releaseLeaderPipesAfterTreeExit(child);
    const leader = await waitForLeaderClose(closeTracker, gracefulRemainingMs());
    if (graceful.ok && leader.ok) {
      return;
    }
  }

  // TERM delivery and leader exit are not tree-exit evidence: a descendant may
  // ignore TERM or outlive Cargo. SIGKILL is successful only after signal-0
  // observes ESRCH for the detached group, then the leader close is observed.
  const kill = await signalTree(child, 'SIGKILL', signalOptions);
  if (kill.ok) releaseLeaderPipesAfterTreeExit(child);
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

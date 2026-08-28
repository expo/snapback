#!/usr/bin/env node
// @ref LLP 0015#peer-checkout-versus-submodule — production-build gate for every REQUIRED demo web
// surface, one code path shared by local verify and CI (ENG-22543, Diary 0011
// flip-condition 2 + the read-only judge's flip-condition 4).
//
// Why this exists (Diary 0011, Exact LLP 0286 cadence run #3): the required
// cursors-web Contract surface was DEV-GREEN, SHIP-BROKEN on the pin — it had
// never been production-built, so a `vite build` regression (Exact stage-0
// channels dragged the TypeScript compiler into the client graph, ENG-22537)
// shipped silently behind a green dev loop. The structural fix is a gate that
// production-builds EVERY required web surface on every Exact pin bump, so this
// class cannot recur silently. Every surface now pins Exact through its own
// committed bun.lock. The LLP 0189 low-noise posture currently keeps this gate
// explicit-only; scripts/required-surface-build-paths.v1.json is the proved
// affected-path authority for an eventual author-directed push restoration.
// These surfaces also bundle Snapback source through demos/_kit, so the gate
// first performs one frozen root-workspace install; that makes package-to-
// package `workspace:*` edges available in a clean checkout without weakening
// each surface's independent Exact registry lock.
//
// Surface set is DERIVED from the demo manifests (demos/*/demo.snapback.json),
// not from whichever package.json files happen to survive in the checkout: a
// web surface is gated iff its manifest entry is `requirement: "required"`
// and declares `buildTargets: ["web"]`. Missing directories, manifests,
// lockfiles, and build scripts are failures by surface id, never discovery
// filters (ENG-24497).
//
// ENG-22564 removes the old checkout mode completely: no exact.pin.json, no
// SNAPBACK_EXACT_ROOT, and no sibling source tree used as a native-asset bridge.
// A missing lockfile or surviving pin file is a hard failure.
//
// Demo backends commit only the deterministic review manifest
// (snapback/generated/artifacts.json); the digest-keyed codegen cache and the
// materialized generated graph are deliberately gitignored, and the surface
// Vite configs verify them fail-closed (SNAPBACK_CODEGEN_CACHE_INVALID) before
// building. A clean checkout therefore has review manifests but no graphs, so
// this gate materializes each gated demo's graph with the repo's own codegen
// before building, then refuses committed-review-manifest drift — the same
// materialize-then-refuse-drift shape deployment-identity.yml uses. The full
// all-demo regen ledger stays scripts/check-generated-artifacts; this gate
// regenerates only the demos whose surfaces it builds.

import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Dependency-free (node builtins only), so this import works on a clean
// checkout before the workspace install this script performs.
import { REVIEW_MANIFEST_FILE } from '../packages/snapback-codegen/review-surface.mjs';
import { cleanupError, signalProcessTree } from './lib/process-tree.mjs';

export { signalProcessTree } from './lib/process-tree.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEMOS_DIR = join(ROOT, 'demos');
const PATH_POLICY_PATH = join(ROOT, 'scripts', 'required-surface-build-paths.v1.json');
const BUILD_TIMEOUT_MS = Number(process.env.SNAPBACK_SURFACE_BUILD_TIMEOUT_MS ?? 300_000);
const INSTALL_TIMEOUT_MS = Number(process.env.SNAPBACK_SURFACE_INSTALL_TIMEOUT_MS ?? 180_000);
const CODEGEN_TIMEOUT_MS = Number(process.env.SNAPBACK_SURFACE_CODEGEN_TIMEOUT_MS ?? 120_000);

// Demos whose committed backend authors outbound actions: their codegen embeds
// the outbound-actions capability-manifest variant, so the flag is part of the
// graph identity and must match regeneration everywhere. Mirrors the per-demo
// env in scripts/check-generated-artifacts (the all-demo regen ledger).
const OUTBOUND_ACTION_DEMOS = new Set(['all-aboard']);
const LIST_ONLY = process.argv.includes('--list');
const OUTPUT_TAIL_BYTES = 128 * 1024;

function log(msg) {
  process.stdout.write(`[required-surface-builds] ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`[required-surface-builds] FAIL: ${msg}\n`);
  process.exit(1);
}

export function loadRequiredSurfaceBuildPathPolicy({ policyPath = PATH_POLICY_PATH } = {}) {
  return JSON.parse(readFileSync(policyPath, 'utf8'));
}

function validateUniquePathPatterns(patterns, label) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const seen = new Set();
  for (const pattern of patterns) {
    if (
      typeof pattern !== 'string'
      || pattern.length === 0
      || pattern.startsWith('/')
      || pattern.split('/').includes('..')
      || !/^!?[A-Za-z0-9._/*-]+$/u.test(pattern)
    ) {
      throw new Error(`${label} contains invalid GitHub path pattern ${JSON.stringify(pattern)}`);
    }
    if (seen.has(pattern)) throw new Error(`${label} contains duplicate pattern ${pattern}`);
    seen.add(pattern);
  }
}

function expectedRequiredSurfacePaths(surfaces) {
  const paths = new Set();
  for (const { demoId, surfaceName } of surfaces) {
    paths.add(`demos/${demoId}/snapback/**`);
    paths.add(`demos/${demoId}/surfaces/${surfaceName}/**`);
  }
  return [...paths].sort();
}

/**
 * Validate the eventual GitHub `paths` authority against the live manifest
 * inventory. A newly required web surface cannot land behind a stale selector:
 * its manifest path selects the introducing change, and this exact comparison
 * then requires its backend and surface roots to join the authority.
 */
// @ref LLP 0316#phase-6--the-required-signal — prove the affected selector
// independently; restoring automatic push execution remains author-gated.
export function validateRequiredSurfaceBuildPathPolicy(
  policy,
  { surfaces = collectRequiredWebSurfaces() } = {},
) {
  if (policy?.schemaVersion !== 'snapback.required-surface-build-paths.v1') {
    throw new Error('required-surface-build path policy has an unsupported schemaVersion');
  }
  validateUniquePathPatterns(policy.fixedPaths, 'required-surface-build fixed paths');
  validateUniquePathPatterns(
    policy.requiredSurfacePaths,
    'required-surface-build manifest-derived paths',
  );
  if (policy.requiredSurfacePaths.some((pattern) => pattern.startsWith('!'))) {
    throw new Error('manifest-derived required-surface paths may not be negated');
  }
  const requiredFixedPaths = [
    '.github/workflows/required-surface-builds.yml',
    'demos/*/demo.snapback.json',
    'scripts/check-required-surface-builds.mjs',
    'scripts/required-surface-build-paths.v1.json',
  ];
  for (const pattern of requiredFixedPaths) {
    if (!policy.fixedPaths.includes(pattern)) {
      throw new Error(`required-surface-build fixed paths omit ${pattern}`);
    }
  }
  const expected = expectedRequiredSurfacePaths(surfaces);
  const actual = [...policy.requiredSurfacePaths].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      'required-surface-build manifest-derived paths drifted: '
      + `expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
    );
  }
  const paths = [...policy.fixedPaths, ...policy.requiredSurfacePaths];
  if (new Set(paths).size !== paths.length) {
    throw new Error('required-surface-build fixed and manifest-derived paths overlap');
  }
  return paths;
}

function githubPathPatternRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    source += '\\^$.*+?()[]{}|'.includes(character) ? `\\${character}` : character;
  }
  return new RegExp(`^${source}$`, 'u');
}

/** Apply the checked, ordered GitHub-path subset used by the policy. */
export function selectRequiredSurfaceBuildPaths(
  changedPaths,
  {
    policy = loadRequiredSurfaceBuildPathPolicy(),
    surfaces = collectRequiredWebSurfaces(),
  } = {},
) {
  if (!Array.isArray(changedPaths)) throw new Error('changed paths must be an array');
  const patterns = validateRequiredSurfaceBuildPathPolicy(policy, { surfaces });
  return changedPaths.map((path) => {
    if (
      typeof path !== 'string'
      || path.length === 0
      || path.startsWith('/')
      || path.split('/').includes('..')
    ) {
      throw new Error(`invalid changed repository path ${JSON.stringify(path)}`);
    }
    let selected = false;
    const matchingPatterns = [];
    for (const declared of patterns) {
      const negated = declared.startsWith('!');
      const pattern = negated ? declared.slice(1) : declared;
      if (!githubPathPatternRegExp(pattern).test(path)) continue;
      selected = !negated;
      matchingPatterns.push(declared);
    }
    return { path, selected, matchingPatterns };
  });
}

// Collect the gated surfaces from the demo manifests (single source of truth).
export function collectRequiredWebSurfaces({ demosDir = DEMOS_DIR } = {}) {
  const surfaces = [];
  const demoIds = existsSync(demosDir)
    ? readdirSync(demosDir).filter((name) => statSync(join(demosDir, name)).isDirectory())
    : [];
  for (const demoId of demoIds.sort()) {
    const manifestPath = join(demosDir, demoId, 'demo.snapback.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      fail(`${demoId}/demo.snapback.json is not valid JSON: ${err.message}`);
    }
    for (const [surfaceName, entry] of Object.entries(manifest.surfaces ?? {})) {
      if (!entry || entry.requirement !== 'required') continue;
      if (!Array.isArray(entry.buildTargets)) {
        throw new Error(
          `${demoId}/${surfaceName}: every required surface must declare ` +
          '`buildTargets` (`["web"]` for production-built web surfaces, `[]` otherwise)',
        );
      }
      if (!entry.buildTargets?.includes('web')) continue;
      const surfaceDir = join(demosDir, demoId, 'surfaces', surfaceName);
      const pkgPath = join(surfaceDir, 'package.json');
      surfaces.push({ demoId, surfaceName, surfaceDir, pkgPath });
    }
  }
  return surfaces;
}

export function classifyRequiredWebSurface(surface) {
  const hasDirectory = existsSync(surface.surfaceDir);
  const hasPackage = existsSync(surface.pkgPath);
  let pkg = null;
  let packageError = null;
  if (hasPackage) {
    try {
      pkg = JSON.parse(readFileSync(surface.pkgPath, 'utf8'));
    } catch (error) {
      packageError = error.message;
    }
  }
  return {
    ...surface,
    hasDirectory,
    hasPackage,
    packageError,
    hasBuild: Boolean(pkg?.scripts?.build),
    hasLock: existsSync(join(surface.surfaceDir, 'bun.lock')),
    hasLegacyPin: existsSync(join(surface.surfaceDir, 'exact.pin.json')),
  };
}

export function requiredSurfaceStructuralErrors(surface) {
  const id = `${surface.demoId}/${surface.surfaceName}`;
  return [
    !surface.hasDirectory && `${id}: required web surface directory is missing`,
    !surface.hasPackage && `${id}: required web surface package.json is missing`,
    surface.packageError && `${id}: package.json is invalid JSON: ${surface.packageError}`,
    !surface.hasBuild && `${id}: required web surface package.json declares no \`build\` script`,
    surface.hasLegacyPin && `${id}: legacy exact.pin.json survives; registry packages + bun.lock are required`,
    !surface.hasLock && `${id}: no committed bun.lock; registry Exact consumption is not reproducibly pinned`,
  ].filter(Boolean);
}

function distHasArtifact(surfaceDir) {
  // Record that the build produced something (flip-condition 4: a recorded
  // Contract build artifact from source). Look for any emitted index.html.
  const distDir = join(surfaceDir, 'dist');
  if (!existsSync(distDir)) return false;
  const stack = [distDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (name === 'index.html' && st.size > 0) return true;
    }
  }
  return false;
}

function appendTail(current, chunk) {
  const next = current + chunk.toString();
  return next.length <= OUTPUT_TAIL_BYTES ? next : next.slice(-OUTPUT_TAIL_BYTES);
}

/** Run a gate subprocess with bounded output and TERM -> KILL tree cleanup. */
export function runBoundedProcess(command, args, {
  cwd = ROOT,
  env = process.env,
  timeoutMs,
  killGraceMs = 2_000,
  inheritOutput = true,
  spawnImpl = spawn,
  platform = process.platform,
  taskkillTimeoutMs = Math.max(killGraceMs, 2_000),
  processGroupTimeoutMs = Math.max(killGraceMs, 2_000),
  processGroupPollMs = 10,
  leaderCloseTimeoutMs = platform === 'win32' ? taskkillTimeoutMs : processGroupTimeoutMs,
  signalTree = signalProcessTree,
  // Optional readiness gate for callers that need the execution watchdog to
  // measure work after a child has explicitly initialized. The ordinary
  // install/build path leaves this null, so its watchdog starts immediately.
  readyWhen = null,
  readinessTimeoutMs = timeoutMs,
} = {}) {
  return new Promise((resolveRun) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    let watchdog = null;
    let readinessWatchdog = null;
    let timeoutReason = null;
    let readyReached = readyWhen === null;
    let settling = false;
    let termCleanup = null;
    let killCleanup = null;
    let child;
    let leaderClosed = false;
    let resolveLeaderClosed;
    const leaderClosedPromise = new Promise((resolveClose) => {
      resolveLeaderClosed = resolveClose;
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      if (readinessWatchdog) clearTimeout(readinessWatchdog);
      if (killTimer) clearTimeout(killTimer);
      resolveRun({ ...result, output });
    };

    const requestCleanup = (signal) => {
      const existing = signal === 'SIGKILL' ? killCleanup : termCleanup;
      if (existing) return existing;
      const cleanup = Promise.resolve()
        .then(() => signalTree(child, signal, {
          spawnImpl,
          platform,
          taskkillTimeoutMs,
          processGroupTimeoutMs,
          processGroupPollMs,
        }))
        .catch((error) => ({
          ok: false,
          mechanism: 'cleanup-seam',
          signal,
          pid: child?.pid ?? null,
          error: cleanupError(error),
        }));
      if (signal === 'SIGKILL') killCleanup = cleanup;
      else termCleanup = cleanup;
      return cleanup;
    };

    const finishFailure = async (result) => {
      if (settled || settling) return;
      settling = true;
      let cleanup;
      // A completed Windows taskkill /T attests the tree operation itself. On
      // POSIX, TERM delivery does not prove TERM-resistant descendants exited,
      // so every failure still gets the hard process-group leg.
      if (platform === 'win32' && termCleanup) {
        const termResult = await termCleanup;
        cleanup = termResult.ok ? termResult : await requestCleanup('SIGKILL');
      } else {
        cleanup = await requestCleanup('SIGKILL');
      }
      if (cleanup.ok) {
        let leaderCloseTimer;
        const closeObserved = leaderClosed || await Promise.race([
          leaderClosedPromise.then(() => true),
          new Promise((resolveClose) => {
            leaderCloseTimer = setTimeout(() => resolveClose(false), leaderCloseTimeoutMs);
          }),
        ]);
        if (leaderCloseTimer) clearTimeout(leaderCloseTimer);
        cleanup = closeObserved
          ? { ...cleanup, leaderClosed: true }
          : {
              ...cleanup,
              ok: false,
              leaderClosed: false,
              error: `process tree exited but leader close was not observed within ${leaderCloseTimeoutMs}ms`,
            };
      }
      const reason = cleanup.ok
        ? `${result.reason}; process tree terminated`
        : `${result.reason}; process-tree cleanup not attested (${cleanup.error ?? 'unknown cleanup failure'})`;
      finish({ ...result, reason, cleanup });
    };

    const terminateForTimeout = (reason) => {
      if (timedOut || settled) return;
      timedOut = true;
      timeoutReason = reason;
      void requestCleanup('SIGTERM');
      killTimer = setTimeout(() => {
        // Settle from the cleanup result even if a broken tree primitive never
        // causes the leader's close event. `finishFailure` serializes Windows
        // TERM -> KILL and bounds both taskkill attempts.
        void finishFailure({ ok: false, timedOut: true, reason: timeoutReason });
      }, killGraceMs);
      killTimer.unref?.();
    };

    const armExecutionWatchdog = () => {
      if (watchdog || timedOut || settled) return;
      watchdog = setTimeout(
        () => terminateForTimeout(`exceeded ${timeoutMs}ms watchdog`),
        timeoutMs,
      );
      watchdog.unref?.();
    };

    try {
      child = spawnImpl(command, args, {
        cwd,
        env,
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolveRun({ ok: false, reason: `spawn failed: ${error.message}`, output });
      return;
    }

    const onData = (stream) => (chunk) => {
      output = appendTail(output, chunk);
      if (inheritOutput) stream.write(chunk);
      if (readyWhen && !readyReached && !timedOut) {
        try {
          if (readyWhen(output)) {
            readyReached = true;
            if (readinessWatchdog) clearTimeout(readinessWatchdog);
            readinessWatchdog = null;
            armExecutionWatchdog();
          }
        } catch (error) {
          terminateForTimeout(`readiness predicate failed: ${error?.message ?? String(error)}`);
        }
      }
    };
    child.stdout?.on('data', onData(process.stdout));
    child.stderr?.on('data', onData(process.stderr));

    if (readyWhen) {
      readinessWatchdog = setTimeout(
        () => terminateForTimeout(`did not become ready within ${readinessTimeoutMs}ms`),
        readinessTimeoutMs,
      );
      readinessWatchdog.unref?.();
    } else {
      armExecutionWatchdog();
    }

    child.once('error', (error) => {
      const failure = { ok: false, reason: `spawn failed: ${error.message}` };
      if (child?.pid) void finishFailure(failure);
      else finish(failure);
    });
    // `exit` can precede the final stdout/stderr data events. `close` means the
    // child stdio handles are closed and the bounded diagnostic tail is fully
    // drained before callers inspect it.
    child.once('close', (code, signal) => {
      leaderClosed = true;
      resolveLeaderClosed();
      if (timedOut) {
        void finishFailure({ ok: false, timedOut: true, reason: timeoutReason });
      } else if (code === 0 && !readyReached) {
        // A nominally successful leader can still have left workers in its
        // process group. Readiness failure owns the same whole-tree cleanup as
        // a watchdog failure.
        void finishFailure({ ok: false, reason: 'exited 0 before required readiness was observed' });
      } else if (code === 0) {
        finish({ ok: true });
      } else {
        // A failing leader may have spawned workers which inherited neither its
        // exit status nor its lifetime. Never publish the failure until the
        // whole tree has received the hard cleanup leg.
        void finishFailure({ ok: false, reason: `exited ${code ?? signal}` });
      }
    });
  });
}

function expectedExactIdentity(surfaceDir) {
  const packageJson = JSON.parse(readFileSync(join(surfaceDir, 'package.json'), 'utf8'));
  const spec = packageJson.dependencies?.['@exact/contract'];
  const match = typeof spec === 'string' ? /^npm:(.+)@([^@]+)$/.exec(spec) : null;
  if (!match) {
    return { ok: false, reason: 'package.json must pin @exact/contract as npm:<published-name>@<exact-version>' };
  }
  const [, name, version] = match;
  const lockText = readFileSync(join(surfaceDir, 'bun.lock'), 'utf8');
  const workspacePin = `${JSON.stringify('@exact/contract')}: ${JSON.stringify(spec)}`;
  const packagePin = `${JSON.stringify('@exact/contract')}: [${JSON.stringify(`${name}@${version}`)}`;
  if (!lockText.includes(workspacePin) || !lockText.includes(packagePin)) {
    return { ok: false, reason: `bun.lock does not pin @exact/contract to ${name}@${version}` };
  }
  return { ok: true, name, version };
}

/** Verify that @exact/contract is the ordinary lock-pinned registry package. */
export function verifyInstalledExactContract(surfaceDir, {
  allowLinked = process.env.SNAPBACK_ALLOW_LINKED_EXACT === '1',
} = {}) {
  let expected;
  try {
    expected = expectedExactIdentity(surfaceDir);
  } catch (error) {
    return { ok: false, reason: `cannot read package/lock identity: ${error.message}` };
  }
  if (!expected.ok) return expected;

  const nodeModules = join(surfaceDir, 'node_modules');
  const scopeRoot = join(nodeModules, '@exact');
  const packageRoot = join(nodeModules, '@exact', 'contract');
  const manifestPath = join(packageRoot, 'package.json');
  try {
    const pathStats = [
      ['node_modules', nodeModules],
      ['node_modules/@exact', scopeRoot],
      ['node_modules/@exact/contract', packageRoot],
    ].map(([label, path]) => {
      try {
        return { label, path, stat: lstatSync(path) };
      } catch (error) {
        if (error?.code === 'ENOENT') return { label, path, stat: null };
        throw error;
      }
    });
    const linkedSegments = pathStats
      .filter(({ stat }) => stat?.isSymbolicLink())
      .map(({ label }) => label);
    const packagePresent = pathStats[2].stat !== null && existsSync(manifestPath);
    const surfaceReal = realpathSync(surfaceDir);
    const packageReal = packagePresent ? realpathSync(packageRoot) : null;
    const outside = packageReal !== null
      && packageReal !== surfaceReal
      && !packageReal.startsWith(`${surfaceReal}${sep}`);
    const linked = linkedSegments.length > 0 || outside;
    if (linked && !allowLinked) {
      return {
        ok: false,
        reason:
          `@exact/contract resolves through an unexpected linked source ` +
          `(${linkedSegments.join(', ') || packageReal}); ` +
          'set SNAPBACK_ALLOW_LINKED_EXACT=1 only for an explicit local-development override',
      };
    }
    if (!packagePresent) {
      return { ok: false, reason: '@exact/contract missing from surface node_modules after frozen install' };
    }
    const installed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (installed.name !== expected.name || installed.version !== expected.version) {
      return {
        ok: false,
        reason:
          `stale @exact/contract install: expected ${expected.name}@${expected.version} from bun.lock, ` +
          `found ${installed.name ?? '<unnamed>'}@${installed.version ?? '<unversioned>'}`,
      };
    }
    return { ok: true, identity: `${installed.name}@${installed.version}`, linked: linked || outside };
  } catch (error) {
    return { ok: false, reason: `cannot attest installed @exact/contract: ${error.message}` };
  }
}

async function runBuild(surface, env) {
  log(`$ bun run --cwd ${surface.surfaceDir.replace(ROOT + '/', '')} build`);
  const result = await runBoundedProcess('bun', ['run', '--cwd', surface.surfaceDir, 'build'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    timeoutMs: BUILD_TIMEOUT_MS,
  });
  if (!result.ok && result.timedOut) result.reason = `build DNF: ${result.reason}`;
  return result;
}

export async function ensureRegistryInstall(surface, {
  runInstall = () => runBoundedProcess(
    'bun',
    ['install', '--frozen-lockfile', '--cwd', surface.surfaceDir],
    { cwd: ROOT, timeoutMs: INSTALL_TIMEOUT_MS },
  ),
} = {}) {
  // Do not let a frozen install bless or mutate an implicit checkout link.
  const before = verifyInstalledExactContract(surface.surfaceDir);
  if (!before.ok && /unexpected linked source/.test(before.reason)) return before;

  // Always run the frozen install. An existing directory is not evidence that
  // it corresponds to the current lockfile; Bun's frozen resolution is the
  // authoritative cache validation/repair step.
  log(`$ bun install --frozen-lockfile --cwd ${surface.surfaceDir.replace(ROOT + '/', '')}`);
  const result = await runInstall();
  if (!result.ok) {
    const diagnostics = result.output?.trim();
    return {
      ...result,
      reason: `frozen install failed: ${result.reason}${diagnostics ? `\noutput tail:\n${diagnostics}` : ''}`,
    };
  }
  return verifyInstalledExactContract(surface.surfaceDir);
}

export async function ensureWorkspaceInstall({
  runInstall = () => runBoundedProcess(
    'bun',
    ['install', '--frozen-lockfile', '--cwd', ROOT],
    { cwd: ROOT, timeoutMs: INSTALL_TIMEOUT_MS },
  ),
} = {}) {
  log('$ bun install --frozen-lockfile --cwd .');
  const result = await runInstall();
  if (result.ok) return result;
  const diagnostics = result.output?.trim();
  return {
    ...result,
    reason:
      `root workspace frozen install failed: ${result.reason}`
      + (diagnostics ? `\noutput tail:\n${diagnostics}` : ''),
  };
}

// One gated demo backend per demo that commits a codegen review manifest.
// Derived from the same required-surface inventory as the builds themselves,
// never from directory discovery.
export function collectGatedGeneratedBackends(surfaces, { demosDir = DEMOS_DIR } = {}) {
  const backends = [];
  const seen = new Set();
  for (const { demoId } of surfaces) {
    if (seen.has(demoId)) continue;
    seen.add(demoId);
    const backendDir = join(demosDir, demoId, 'snapback');
    const reviewManifestPath = join(backendDir, 'generated', REVIEW_MANIFEST_FILE);
    if (!existsSync(reviewManifestPath)) continue;
    backends.push({
      demoId,
      backendDir,
      reviewManifestPath,
      outboundActions: OUTBOUND_ACTION_DEMOS.has(demoId),
    });
  }
  return backends;
}

// @ref LLP 0010#generated-artifacts — the committed review manifest is the
// source-owned identity witness; the digest-keyed cache and materialized graph
// it binds are gitignored and must be regenerated (never trusted, never
// hand-restored) before any consumer builds against them. Refusing drift in
// the committed manifest afterward keeps this a gate on committed state, not a
// silent regeneration that papers over a stale checkout.
export async function materializeGeneratedBackend(backend, {
  runCodegen = () => runBoundedProcess(
    process.execPath,
    ['packages/snapback-codegen/index.mjs', relative(ROOT, backend.backendDir)],
    {
      cwd: ROOT,
      env: backend.outboundActions
        ? { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1' }
        : { ...process.env },
      timeoutMs: CODEGEN_TIMEOUT_MS,
    },
  ),
  runDriftCheck = () => runBoundedProcess(
    'git',
    ['diff', '--exit-code', '--', relative(ROOT, backend.reviewManifestPath)],
    { cwd: ROOT, timeoutMs: CODEGEN_TIMEOUT_MS },
  ),
} = {}) {
  const backendRelative = relative(ROOT, backend.backendDir);
  log(`$ ${backend.outboundActions ? 'SNAPBACK_OUTBOUND_ACTIONS=1 ' : ''}node packages/snapback-codegen/index.mjs ${backendRelative}`);
  const generated = await runCodegen();
  if (!generated.ok) {
    return { ...generated, reason: `codegen materialization failed: ${generated.reason}` };
  }
  const drift = await runDriftCheck();
  if (!drift.ok) {
    return {
      ...drift,
      reason:
        `committed review manifest is stale for the current backend sources: ${drift.reason}; `
        + `regenerate with \`${backend.outboundActions ? 'SNAPBACK_OUTBOUND_ACTIONS=1 ' : ''}node packages/snapback-codegen/index.mjs ${backendRelative}\` and commit ${relative(ROOT, backend.reviewManifestPath)}`,
    };
  }
  return { ok: true };
}

async function main() {
  const surfaces = collectRequiredWebSurfaces().map(classifyRequiredWebSurface);
  if (surfaces.length === 0) {
    fail('no required web surfaces found — the manifest-derivation is broken (expected all-aboard + cursors-web)');
  }

  log(`required web surfaces (from demos/*/demo.snapback.json):`);
  for (const s of surfaces) {
    const defects = [
      !s.hasDirectory && 'NO surface directory',
      !s.hasPackage && 'NO package.json',
      s.packageError && 'INVALID package.json',
      !s.hasBuild && 'NO build script',
      s.hasLegacyPin && 'LEGACY exact.pin.json',
      !s.hasLock && 'NO bun.lock',
    ].filter(Boolean);
    log(`  - ${s.demoId}/${s.surfaceName} [registry]${defects.length ? ` (${defects.join(', ')})` : ''}`);
  }

  for (const surface of surfaces) {
    const [error] = requiredSurfaceStructuralErrors(surface);
    if (error) fail(error);
  }
  const selectorPatterns = validateRequiredSurfaceBuildPathPolicy(
    loadRequiredSurfaceBuildPathPolicy(),
    { surfaces },
  );
  log(
    `path selector authority: scripts/required-surface-build-paths.v1.json `
    + `(${selectorPatterns.length} ordered pattern(s))`,
  );
  if (LIST_ONLY) return;

  const workspaceInstall = await ensureWorkspaceInstall();
  if (!workspaceInstall.ok) fail(workspaceInstall.reason);

  // Materialize the gitignored codegen graphs the surface builds fail-closed
  // against, then refuse committed-review-manifest drift (see header comment).
  for (const backend of collectGatedGeneratedBackends(surfaces)) {
    const materialized = await materializeGeneratedBackend(backend);
    if (!materialized.ok) fail(`${backend.demoId}: ${materialized.reason}`);
    log(`OK: ${backend.demoId} generated graph materialized from the committed review manifest`);
  }

  let built = 0;
  for (const surface of surfaces) {
    const id = `${surface.demoId}/${surface.surfaceName}`;
    process.stdout.write(`\n[required-surface-builds] == ${id} (registry) ==\n`);

    const install = await ensureRegistryInstall(surface);
    if (!install.ok) fail(`${id}: ${install.reason}`);

    const result = await runBuild(surface, {});
    if (!result.ok) {
      fail(`${id}: production build failed — ${result.reason}`);
    }
    if (!distHasArtifact(surface.surfaceDir)) {
      fail(`${id}: build reported success but emitted no dist/**/index.html artifact`);
    }
    log(`OK: ${id} production-built (artifact recorded under dist/)`);
    built += 1;
  }

  process.stdout.write('\n');
  log(`verdict: ${built} required surface(s) production-built from committed registry locks`);
  if (built === 0) {
    fail('no required surface was actually built; the gate proved nothing');
  }
  log('REQUIRED-SURFACE-BUILDS PASS');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((err) => fail(err?.stack ?? String(err)));
}

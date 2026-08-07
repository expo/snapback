// Server/Vite reuse provenance (ENG-22753; Diary 0008 2026-07-01 :4420 gotcha).
//
// The acceptance suites reuse an already-running API server or Vite dev
// server when something answers on the expected port. That convention trusted
// whatever answered `/health` — including a weeks-old binary from another
// checkout, or a Vite serving a *different working tree* — and produced
// spurious failures whose code was simply not in the reused surface.
//
// These helpers make reuse conditional on verified provenance:
//   - `verifyApiProvenance` compares the running server's loaded-app identity
//     (`GET /inspect` → `functions.appId` / `functions.bundleHash`) against
//     the committed generated artifacts (`artifacts.json` bundleHash).
//   - `verifyViteProvenance` hits the dev-only source probe
//     (`VITE_SOURCE_PROBE_PATH`, served by a tiny plugin in each surface's
//     vite config) and compares the served checkout root, API origin, and any
//     required target profile the surface was started against.
//
// Both return `{ ok, reason, ... }` verdicts; they never throw on network
// failure — an unreachable or identity-less server is a NOT-ok verdict
// ("identity unavailable"), because silent reuse is exactly the bug.
// Callers must not reuse on a not-ok verdict: fall back to a fresh isolated
// port (`freePort()`), logging loudly.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

/// Dev-only provenance probe path served by the demo surfaces' vite configs.
/// The response shape is `{ app, surface, root, apiOrigin, targetProfile? }` with `root`
/// already realpath-resolved on the serving side.
export const VITE_SOURCE_PROBE_PATH = '/__snapback/source';

/// An OS-assigned free loopback port, for the fresh-isolated-server fallback.
export function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

/// The committed bundle identity: `bundleHash` from the demo's generated
/// `artifacts.json`. Throws if the artifact index is missing or hashless —
/// that is a broken checkout, not a reuse question.
export function readCommittedBundleHash(artifactsPath) {
  const artifacts = JSON.parse(readFileSync(artifactsPath, 'utf8'));
  if (typeof artifacts.bundleHash !== 'string' || artifacts.bundleHash.length === 0) {
    throw new Error(`no bundleHash in ${artifactsPath} — regenerate the demo's generated artifacts`);
  }
  return artifacts.bundleHash;
}

/// Verdict on reusing an already-running API server. `ok: true` only when the
/// server's loaded app matches the committed identity; every other outcome
/// (unreachable inspect, unprovisioned server, foreign app, hash drift) is a
/// not-ok verdict with a human-readable `reason`.
export async function verifyApiProvenance(apiUrl, { appId, bundleHash }) {
  let inspect;
  try {
    const res = await fetch(`${apiUrl}/inspect`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      return { ok: false, code: 'unreachable', reason: `its identity is unavailable (GET /inspect → HTTP ${res.status})` };
    }
    inspect = await res.json();
  } catch (error) {
    return { ok: false, code: 'unreachable', reason: `its identity is unavailable (GET /inspect failed: ${error.message})` };
  }
  const loadedApp = inspect?.functions?.appId ?? null;
  const loadedHash = inspect?.functions?.bundleHash ?? null;
  if (!loadedHash) {
    // No functions bundle loaded — an unprovisioned or schema-only server. This
    // is the one not-ok case where binary provenance (verifyBinaryProvenance
    // over /health) can still identify the server; `code` lets startServer fall
    // back rather than treat it as a wrong-app refusal.
    return {
      ok: false,
      code: 'no-bundle',
      reason: 'it reports no loaded app bundle (unprovisioned, or a stale/foreign server)',
    };
  }
  if (appId && loadedApp !== appId) {
    return { ok: false, code: 'app-mismatch', reason: `it is serving app "${loadedApp}", not "${appId}"` };
  }
  if (loadedHash !== bundleHash) {
    return {
      ok: false,
      code: 'hash-mismatch',
      reason: `its loaded bundleHash ${loadedHash} does not match the committed artifacts.json bundleHash ${bundleHash} (stale server or different checkout)`,
    };
  }
  return { ok: true, code: 'ok', appId: loadedApp, bundleHash: loadedHash };
}

/// Verdict on reusing an already-running Vite dev server. `ok: true` only when
/// the probe answers AND it serves this checkout's surface tree AND it was
/// started against the API origin and, when supplied, target profile this run
/// is using (both are baked into the bundle at Vite start, so a mismatch means
/// the reused surface would use the wrong backend semantics).
export async function verifyViteProvenance(
  viteUrl,
  { app, surface, root, apiOrigin, targetProfile },
) {
  let info;
  try {
    const res = await fetch(`${viteUrl}${VITE_SOURCE_PROBE_PATH}`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      return {
        ok: false,
        reason: `it exposes no source-provenance probe (GET ${VITE_SOURCE_PROBE_PATH} → HTTP ${res.status}; a foreign or pre-ENG-22753 server)`,
      };
    }
    // A probe-less Vite answers unknown paths with the index.html SPA
    // fallback (HTTP 200, text/html), so "200 but not JSON" is the common
    // foreign-Vite shape — name it, don't surface a JSON parse error.
    const body = await res.text();
    try {
      info = JSON.parse(body);
    } catch {
      return {
        ok: false,
        reason: `it exposes no source-provenance probe (GET ${VITE_SOURCE_PROBE_PATH} answered non-JSON; a foreign or pre-ENG-22753 server)`,
      };
    }
  } catch (error) {
    return { ok: false, reason: `its source-provenance probe failed (${error.message})` };
  }
  if (info?.app !== app || info?.surface !== surface) {
    return {
      ok: false,
      reason: `it serves ${info?.app ?? '?'}/${info?.surface ?? '?'}, not ${app}/${surface}`,
    };
  }
  const expectedRoot = realpathSync(root);
  if (info.root !== expectedRoot) {
    return {
      ok: false,
      reason: `it serves a different checkout's tree (${info.root}, expected ${expectedRoot})`,
    };
  }
  if (apiOrigin && info.apiOrigin !== apiOrigin) {
    return {
      ok: false,
      reason: `it was started against API origin ${info.apiOrigin}, but this run uses ${apiOrigin}`,
    };
  }
  if (targetProfile && info.targetProfile !== targetProfile) {
    return {
      ok: false,
      reason: `it was started for target profile ${info.targetProfile ?? '?'}, but this run requires ${targetProfile}`,
    };
  }
  return { ok: true, info };
}

// --- Server-binary provenance (ENG-22798) -------------------------------------
//
// Bundle provenance (verifyApiProvenance) can only identify a server that has
// loaded a functions bundle. An externally started UNPROVISIONED server, or a
// schema-only server (`ensureApp({ schema })`, no functions) like the
// cursors-web web surfaces, reports no bundle identity and is always refused.
//
// The server now stamps a build identity onto the ungated `/health` payload —
// `{ binary: { crateVersion, gitCommit, gitDirty, buildProfile, startupNonce } }`
// — so "is this MY checkout's binary?" is answerable before any app is
// provisioned. `verifyBinaryProvenance` is the verdict; `readCheckoutBinaryIdentity`
// computes the expected identity from a checkout. Refuse-when-unverifiable stays
// the default: a dirty/unknown build on either side is NOT soundly identifiable,
// so it is a not-ok verdict, never a silent reuse.

/// The expected server-binary identity of a Snapback checkout: its committed
/// git commit, whether the runtime binary's input set is dirty, and the crate
/// version from `Cargo.toml`. Dirtiness is scoped by the shared definition in
/// `scripts/runtime-build-inputs.txt` — the same set `build.rs` and
/// `verify-local-proof` stamp from — so demo/LLP/issue edits do not make a
/// prepared binary unverifiable, while an edit to any real input still does
/// (issues/closed/20260805-whole-tree-dirty-flag-forces-runtime-rebuild.md).
/// A dirty input set means the built bytes are not pinned to a commit, so
/// `gitDirty: true` — which `verifyBinaryProvenance` treats as unverifiable.
/// `git` failures (not a checkout, git absent) yield `gitCommit: 'unknown'` and
/// `gitDirty: true`, i.e. "cannot identify" rather than a throw. A checkout
/// without the shared definition file falls back to whole-tree status
/// (conservative: over-reports dirty, never under-reports).
export function readCheckoutBinaryIdentity(cwd = process.cwd()) {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  const gitCommit = git(['rev-parse', 'HEAD']);
  const inputPathspecs = runtimeInputPathspecs(cwd);
  const status = git([
    'status', '--porcelain', '--ignore-submodules=untracked',
    ...(inputPathspecs ? ['--', ...inputPathspecs] : []),
  ]);
  const crateVersion = readCrateVersion(cwd);
  return {
    crateVersion,
    gitCommit: gitCommit || 'unknown',
    // Unknown commit or a non-empty status ⇒ not pinned to a clean commit.
    gitDirty: !gitCommit || status === null || status.length > 0,
  };
}

/// Git pathspecs bounding the runtime binary's input set, read from the shared
/// definition `scripts/runtime-build-inputs.txt` (one pathspec per line, `#`
/// comments). `null` — file missing/unreadable/empty — means "no scoped
/// definition"; callers fall back to whole-tree status.
function runtimeInputPathspecs(cwd) {
  try {
    const pathspecs = readFileSync(join(cwd, 'scripts', 'runtime-build-inputs.txt'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    return pathspecs.length > 0 ? pathspecs : null;
  } catch {
    return null;
  }
}

/// The `version` from the repo-root `Cargo.toml` (`[package] version = "..."`),
/// matching what the server reports as `binary.crateVersion` (`CARGO_PKG_VERSION`).
/// Returns `null` if it cannot be read — a null expected version simply is not
/// compared (it is not, on its own, an identifying field).
function readCrateVersion(cwd) {
  try {
    const toml = readFileSync(join(cwd, 'Cargo.toml'), 'utf8');
    // First `version = "x"` after the `[package]` header.
    const pkg = toml.split(/^\s*\[/m).find((section) => section.startsWith('package]'));
    const match = (pkg ?? toml).match(/^\s*version\s*=\s*"([^"]+)"/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/// Verdict on reusing an already-running server by its BINARY identity, for the
/// case bundle provenance cannot cover (unprovisioned / schema-only). `ok: true`
/// only when the server's `/health` reports a build identity that is soundly
/// pinned (clean on both sides) AND every declared expected field matches. Every
/// other outcome — unreachable, no identity block (a pre-ENG-22798 or foreign
/// server), a dirty/unknown build on either side, or a field mismatch — is a
/// not-ok verdict with a human-readable `reason`. Never throws on network failure.
///
/// `expected` is a checkout identity from `readCheckoutBinaryIdentity`
/// (`{ crateVersion, gitCommit, gitDirty }`). An optional `startupNonce` is
/// compared too, for callers confirming a server *they* spawned still answers
/// (a spawner knows the nonce; an external verifier does not).
export async function verifyBinaryProvenance(healthUrl, expected = {}) {
  if (!expected.gitCommit || expected.gitCommit === 'unknown') {
    return { ok: false, reason: 'this checkout has no committed git identity to verify a binary against (dirty or not a checkout)' };
  }
  if (expected.gitDirty) {
    return {
      ok: false,
      reason: `this checkout is dirty (built bytes are not pinned to commit ${short(expected.gitCommit)}), so no running binary can be soundly identified as its build`,
    };
  }

  let health;
  try {
    const res = await fetch(`${healthUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      return { ok: false, reason: `its identity is unavailable (GET /health → HTTP ${res.status})` };
    }
    health = await res.json();
  } catch (error) {
    return { ok: false, reason: `its identity is unavailable (GET /health failed: ${error.message})` };
  }

  const binary = health?.binary;
  if (!binary || typeof binary !== 'object') {
    return { ok: false, reason: 'it reports no server-binary identity on /health (a pre-ENG-22798 or foreign server)' };
  }
  if (!binary.gitCommit || binary.gitCommit === 'unknown') {
    return { ok: false, reason: 'the running server was built without a git commit stamp (built outside a checkout), so it cannot be soundly identified' };
  }
  if (binary.gitDirty) {
    return { ok: false, reason: `the running server was built from a dirty tree (commit ${short(binary.gitCommit)} + uncommitted changes), so its exact bytes cannot be verified` };
  }
  if (binary.gitCommit !== expected.gitCommit) {
    return {
      ok: false,
      reason: `it is running commit ${short(binary.gitCommit)}, not this checkout's ${short(expected.gitCommit)} (a different checkout or a stale build)`,
    };
  }
  if (expected.crateVersion && binary.crateVersion && binary.crateVersion !== expected.crateVersion) {
    return {
      ok: false,
      reason: `it reports crate version ${binary.crateVersion}, not this checkout's ${expected.crateVersion}`,
    };
  }
  if (expected.startupNonce && binary.startupNonce !== expected.startupNonce) {
    return {
      ok: false,
      reason: `its startup nonce changed (${binary.startupNonce} ≠ the expected ${expected.startupNonce}) — the server restarted or is a different process`,
    };
  }
  return {
    ok: true,
    gitCommit: binary.gitCommit,
    crateVersion: binary.crateVersion ?? null,
    startupNonce: binary.startupNonce ?? null,
  };
}

function short(commit) {
  return typeof commit === 'string' ? commit.slice(0, 12) : String(commit);
}

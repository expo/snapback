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
//     vite config) and compares the served checkout root and the API origin
//     the surface was started against.
//
// Both return `{ ok, reason, ... }` verdicts; they never throw on network
// failure — an unreachable or identity-less server is a NOT-ok verdict
// ("identity unavailable"), because silent reuse is exactly the bug.
// Callers must not reuse on a not-ok verdict: fall back to a fresh isolated
// port (`freePort()`), logging loudly.

import { readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';

/// Dev-only provenance probe path served by the demo surfaces' vite configs.
/// The response shape is `{ app, surface, root, apiOrigin }` with `root`
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
      return { ok: false, reason: `its identity is unavailable (GET /inspect → HTTP ${res.status})` };
    }
    inspect = await res.json();
  } catch (error) {
    return { ok: false, reason: `its identity is unavailable (GET /inspect failed: ${error.message})` };
  }
  const loadedApp = inspect?.functions?.appId ?? null;
  const loadedHash = inspect?.functions?.bundleHash ?? null;
  if (!loadedHash) {
    return {
      ok: false,
      reason: 'it reports no loaded app bundle (unprovisioned, or a stale/foreign server)',
    };
  }
  if (appId && loadedApp !== appId) {
    return { ok: false, reason: `it is serving app "${loadedApp}", not "${appId}"` };
  }
  if (loadedHash !== bundleHash) {
    return {
      ok: false,
      reason: `its loaded bundleHash ${loadedHash} does not match the committed artifacts.json bundleHash ${bundleHash} (stale server or different checkout)`,
    };
  }
  return { ok: true, appId: loadedApp, bundleHash: loadedHash };
}

/// Verdict on reusing an already-running Vite dev server. `ok: true` only when
/// the probe answers AND it serves this checkout's surface tree AND it was
/// started against the API origin this run is using (`apiOrigin` is baked into
/// the bundle as `__SNAPBACK_API_ORIGIN__` at Vite start, so a mismatch means
/// the reused surface would talk to the wrong backend).
export async function verifyViteProvenance(viteUrl, { app, surface, root, apiOrigin }) {
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
  return { ok: true, info };
}

// Reuse-provenance unit suite (ENG-22753; no Snapback server required).
//
// Exercises demos/_kit/provenance.mjs against tiny in-process HTTP stubs:
// the API-side verdict (`/inspect` identity vs the committed bundleHash) and
// the Vite-side verdict (the `/__snapback/source` probe vs the local surface
// root and API origin). These are the checks the browser acceptance suites
// run before reusing whatever answers on their default ports — the Diary 0008
// 2026-07-01 :4420 gotcha (stale server / different checkout's Vite) must
// yield a not-ok verdict, never a silent reuse.
//
// Run: node demos/_kit/tests/provenance-unit.mjs

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assert, assertEqual, createSuite } from '../harness.mjs';
import {
  VITE_SOURCE_PROBE_PATH,
  freePort,
  readCheckoutBinaryIdentity,
  readCommittedBundleHash,
  verifyApiProvenance,
  verifyBinaryProvenance,
  verifyViteProvenance,
} from '../provenance.mjs';

const suite = createSuite('kit reuse provenance (ENG-22753)');

const HASH = 'sha256:feedfacecafef00d';

function serve(handler) {
  return new Promise((resolvePort) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolvePort({ url, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const jsonHandler = (routes) => (req, res) => {
  const body = routes[req.url];
  if (body === undefined) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

const scratch = mkdtempSync(join(tmpdir(), 'provenance-unit-'));
const servers = [];
const stub = async (routes) => {
  const server = await serve(jsonHandler(routes));
  servers.push(server);
  return server;
};

try {
  await suite.check('freePort returns a distinct usable loopback port', async () => {
    const port = await freePort();
    assert(Number.isInteger(port) && port > 0 && port < 65536, `bad port ${port}`);
    const again = await freePort();
    assert(Number.isInteger(again) && again > 0 && again < 65536, `bad second port ${again}`);
    return { port, again };
  });

  await suite.check('readCommittedBundleHash reads bundleHash; hashless index throws', async () => {
    const good = join(scratch, 'artifacts.json');
    writeFileSync(good, JSON.stringify({ appId: 'all-aboard', bundleHash: HASH }));
    assertEqual(readCommittedBundleHash(good), HASH, 'hash round-trips');
    const bad = join(scratch, 'artifacts-hashless.json');
    writeFileSync(bad, JSON.stringify({ appId: 'all-aboard' }));
    let threw = null;
    try { readCommittedBundleHash(bad); } catch (error) { threw = error; }
    assert(threw && /no bundleHash/.test(threw.message), `expected a no-bundleHash error, got ${threw?.message}`);
    return { hash: HASH };
  });

  await suite.check('API verdict: matching appId + bundleHash is ok (reuse allowed)', async () => {
    const api = await stub({ '/inspect': { functions: { appId: 'all-aboard', bundleHash: HASH } } });
    const verdict = await verifyApiProvenance(api.url, { appId: 'all-aboard', bundleHash: HASH });
    assert(verdict.ok, `expected ok, got: ${verdict.reason}`);
    assertEqual(verdict.bundleHash, HASH, 'verdict carries the hash for the REUSED log line');
    return verdict;
  });

  await suite.check('API verdict: bundleHash drift is not ok (the stale-server case)', async () => {
    const api = await stub({ '/inspect': { functions: { appId: 'all-aboard', bundleHash: 'sha256:0ld5t4l3' } } });
    const verdict = await verifyApiProvenance(api.url, { appId: 'all-aboard', bundleHash: HASH });
    assert(!verdict.ok, 'stale hash must not be reusable');
    assert(/does not match the committed/.test(verdict.reason), `reason names the drift: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('API verdict: foreign app is not ok', async () => {
    const api = await stub({ '/inspect': { functions: { appId: 'todo-v2', bundleHash: HASH } } });
    const verdict = await verifyApiProvenance(api.url, { appId: 'all-aboard', bundleHash: HASH });
    assert(!verdict.ok && /serving app "todo-v2"/.test(verdict.reason), `expected foreign-app verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('API verdict: unprovisioned server (no bundleHash) is not ok', async () => {
    const api = await stub({ '/inspect': { functions: { appId: 'local', bundleHash: null } } });
    const verdict = await verifyApiProvenance(api.url, { appId: 'all-aboard', bundleHash: HASH });
    assert(!verdict.ok && /no loaded app bundle/.test(verdict.reason), `expected unprovisioned verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('API verdict: identity unavailable (health-only decoy, /inspect 404) is not ok', async () => {
    // The literal Diary 0008 shape: something answers on the port but its
    // identity cannot be verified — reuse must be refused, not assumed.
    const decoy = await stub({ '/health': { ok: true } });
    const verdict = await verifyApiProvenance(decoy.url, { appId: 'all-aboard', bundleHash: HASH });
    assert(!verdict.ok && /identity is unavailable/.test(verdict.reason), `expected identity-unavailable verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('API verdict: connection failure is a not-ok verdict, never a throw', async () => {
    const port = await freePort();
    const verdict = await verifyApiProvenance(`http://127.0.0.1:${port}`, { appId: 'all-aboard', bundleHash: HASH });
    assert(!verdict.ok && /identity is unavailable/.test(verdict.reason), `expected unavailable verdict: ${verdict.reason}`);
    return verdict;
  });

  const surfaceRoot = realpathSync(scratch);
  const apiOrigin = 'http://127.0.0.1:4420';
  const targetProfile = 'local-dev-sqlite-ibex';
  const probeBody = {
    app: 'all-aboard',
    surface: 'contract',
    root: surfaceRoot,
    apiOrigin,
    targetProfile,
  };

  await suite.check('Vite verdict: matching app/surface/root/apiOrigin is ok', async () => {
    const vite = await stub({ [VITE_SOURCE_PROBE_PATH]: probeBody });
    const verdict = await verifyViteProvenance(vite.url, {
      app: 'all-aboard', surface: 'contract', root: scratch, apiOrigin, targetProfile,
    });
    assert(verdict.ok, `expected ok, got: ${verdict.reason}`);
    assertEqual(verdict.info.root, surfaceRoot, 'probe root round-trips realpathed');
    return verdict;
  });

  await suite.check('Vite verdict: a different target profile is not ok', async () => {
    const vite = await stub({
      [VITE_SOURCE_PROBE_PATH]: { ...probeBody, targetProfile: 'cloudflare-do-sqlite-v8' },
    });
    const verdict = await verifyViteProvenance(vite.url, {
      app: 'all-aboard', surface: 'contract', root: scratch, apiOrigin, targetProfile,
    });
    assert(
      !verdict.ok && /target profile/.test(verdict.reason),
      `expected target-profile verdict: ${verdict.reason}`,
    );
    return verdict;
  });

  await suite.check("Vite verdict: a different checkout's tree is not ok", async () => {
    const vite = await stub({ [VITE_SOURCE_PROBE_PATH]: { ...probeBody, root: '/some/other/worktree/surfaces/contract' } });
    const verdict = await verifyViteProvenance(vite.url, { app: 'all-aboard', surface: 'contract', root: scratch, apiOrigin });
    assert(!verdict.ok && /different checkout/.test(verdict.reason), `expected different-checkout verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Vite verdict: started against a different API origin is not ok', async () => {
    const vite = await stub({ [VITE_SOURCE_PROBE_PATH]: { ...probeBody, apiOrigin: 'http://127.0.0.1:59999' } });
    const verdict = await verifyViteProvenance(vite.url, { app: 'all-aboard', surface: 'contract', root: scratch, apiOrigin });
    assert(!verdict.ok && /API origin/.test(verdict.reason), `expected api-origin verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Vite verdict: wrong surface arm is not ok (contract vs react)', async () => {
    const vite = await stub({ [VITE_SOURCE_PROBE_PATH]: { ...probeBody, surface: 'react' } });
    const verdict = await verifyViteProvenance(vite.url, { app: 'all-aboard', surface: 'contract', root: scratch, apiOrigin });
    assert(!verdict.ok && /not all-aboard\/contract/.test(verdict.reason), `expected wrong-surface verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Vite verdict: probe missing (foreign or pre-ENG-22753 server) is not ok', async () => {
    const vite = await stub({ '/': { hello: 'world' } });
    const verdict = await verifyViteProvenance(vite.url, { app: 'all-aboard', surface: 'contract', root: scratch, apiOrigin });
    assert(!verdict.ok && /no source-provenance probe/.test(verdict.reason), `expected no-probe verdict: ${verdict.reason}`);
    return verdict;
  });

  // --- Binary provenance (ENG-22798) ------------------------------------------
  const COMMIT = '1a2b3c4d5e6f7081920aabbccddeeff001122334';
  const OTHER_COMMIT = 'ffeeddccbbaa00998877665544332211f0f0f0f0';
  const cleanExpected = { crateVersion: '0.1.0', gitCommit: COMMIT, gitDirty: false };
  const healthBody = (binary) => ({ '/health': { ok: true, target: 'local-dev-sqlite-ibex', binary } });
  const cleanBinary = { crateVersion: '0.1.0', gitCommit: COMMIT, gitDirty: false, buildProfile: 'debug', startupNonce: 'nonce-A' };

  await suite.check('API verdict carries code:no-bundle for an unprovisioned server (binary-fallback eligible)', async () => {
    const api = await stub({ '/inspect': { functions: { appId: 'local', bundleHash: null } } });
    const verdict = await verifyApiProvenance(api.url, { appId: 'all-aboard', bundleHash: HASH });
    assert(!verdict.ok && verdict.code === 'no-bundle', `expected code no-bundle, got ${verdict.code}`);
    return verdict;
  });

  await suite.check('API verdict carries code:hash-mismatch for a wrong bundle (NOT binary-fallback eligible)', async () => {
    const api = await stub({ '/inspect': { functions: { appId: 'all-aboard', bundleHash: 'sha256:0ld5t4l3' } } });
    const verdict = await verifyApiProvenance(api.url, { appId: 'all-aboard', bundleHash: HASH });
    assert(!verdict.ok && verdict.code === 'hash-mismatch', `expected code hash-mismatch, got ${verdict.code}`);
    return verdict;
  });

  await suite.check('Binary verdict: clean matching commit + version is ok (reuse allowed)', async () => {
    const api = await stub(healthBody(cleanBinary));
    const verdict = await verifyBinaryProvenance(api.url, cleanExpected);
    assert(verdict.ok, `expected ok, got: ${verdict.reason}`);
    assertEqual(verdict.gitCommit, COMMIT, 'verdict carries the commit');
    return verdict;
  });

  await suite.check('Binary verdict: a different commit is not ok (different checkout / stale build)', async () => {
    const api = await stub(healthBody({ ...cleanBinary, gitCommit: OTHER_COMMIT }));
    const verdict = await verifyBinaryProvenance(api.url, cleanExpected);
    assert(!verdict.ok && /not this checkout's/.test(verdict.reason), `expected commit-mismatch verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Binary verdict: a dirty running server is not ok (bytes unverifiable)', async () => {
    const api = await stub(healthBody({ ...cleanBinary, gitDirty: true }));
    const verdict = await verifyBinaryProvenance(api.url, cleanExpected);
    assert(!verdict.ok && /dirty tree/.test(verdict.reason), `expected server-dirty verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Binary verdict: a dirty local checkout refuses (cannot pin its own build)', async () => {
    const api = await stub(healthBody(cleanBinary));
    const verdict = await verifyBinaryProvenance(api.url, { ...cleanExpected, gitDirty: true });
    assert(!verdict.ok && /this checkout is dirty/.test(verdict.reason), `expected checkout-dirty verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Binary verdict: an unknown local commit refuses (nothing to verify against)', async () => {
    const api = await stub(healthBody(cleanBinary));
    const verdict = await verifyBinaryProvenance(api.url, { crateVersion: '0.1.0', gitCommit: 'unknown', gitDirty: false });
    assert(!verdict.ok && /no committed git identity/.test(verdict.reason), `expected no-identity verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Binary verdict: server missing the /health identity block is not ok (pre-ENG-22798)', async () => {
    const api = await stub({ '/health': { ok: true, target: 'local-dev-sqlite-ibex' } });
    const verdict = await verifyBinaryProvenance(api.url, cleanExpected);
    assert(!verdict.ok && /no server-binary identity/.test(verdict.reason), `expected no-identity-block verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Binary verdict: server built without a commit stamp (unknown) is not ok', async () => {
    const api = await stub(healthBody({ ...cleanBinary, gitCommit: 'unknown' })); // e.g. built outside a checkout
    const verdict = await verifyBinaryProvenance(api.url, cleanExpected);
    assert(!verdict.ok && /without a git commit stamp/.test(verdict.reason), `expected server-unknown verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Binary verdict: crate-version drift at the same commit is not ok', async () => {
    const api = await stub(healthBody({ ...cleanBinary, crateVersion: '9.9.9' }));
    const verdict = await verifyBinaryProvenance(api.url, cleanExpected);
    assert(!verdict.ok && /crate version 9\.9\.9/.test(verdict.reason), `expected version-drift verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Binary verdict: a changed startup nonce is not ok (restart / different process)', async () => {
    const api = await stub(healthBody(cleanBinary));
    const verdict = await verifyBinaryProvenance(api.url, { ...cleanExpected, startupNonce: 'nonce-B' });
    assert(!verdict.ok && /startup nonce changed/.test(verdict.reason), `expected nonce-change verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('Binary verdict: connection failure is a not-ok verdict, never a throw', async () => {
    const port = await freePort();
    const verdict = await verifyBinaryProvenance(`http://127.0.0.1:${port}`, cleanExpected);
    assert(!verdict.ok && /identity is unavailable/.test(verdict.reason), `expected unavailable verdict: ${verdict.reason}`);
    return verdict;
  });

  await suite.check('readCheckoutBinaryIdentity reads THIS snapback checkout (commit + crate version)', async () => {
    // Real git call against the repo root (three levels up from demos/_kit/tests).
    const repoRoot = join(import.meta.dirname, '..', '..', '..');
    const id = readCheckoutBinaryIdentity(repoRoot);
    assert(typeof id.gitDirty === 'boolean', 'gitDirty is a boolean');
    assert(id.gitCommit === 'unknown' || /^[0-9a-f]{40}$/.test(id.gitCommit), `commit looks like a sha or unknown: ${id.gitCommit}`);
    // Cargo.toml sits at the repo root, so a version should be readable.
    assert(id.crateVersion === null || /^\d+\.\d+\.\d+/.test(id.crateVersion), `crate version looks like semver or null: ${id.crateVersion}`);
    return id;
  });

  await suite.check('Vite verdict: SPA index.html fallback on the probe path (200, non-JSON) is not ok', async () => {
    // A probe-less Vite answers ANY unknown path with index.html and HTTP
    // 200 — the real-world shape of a foreign checkout's dev server.
    const server = await serve((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><html><body>All Aboard</body></html>');
    });
    servers.push(server);
    const verdict = await verifyViteProvenance(server.url, { app: 'all-aboard', surface: 'contract', root: scratch, apiOrigin });
    assert(!verdict.ok && /answered non-JSON/.test(verdict.reason), `expected non-JSON no-probe verdict: ${verdict.reason}`);
    return verdict;
  });
} finally {
  for (const server of servers) await server.close();
  rmSync(scratch, { recursive: true, force: true });
}

const report = suite.finish();
process.exit(report.ok ? 0 : 1);

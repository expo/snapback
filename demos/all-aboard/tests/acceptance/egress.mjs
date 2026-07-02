// All Aboard — Phase 3 action-egress seam acceptance (LLP 0027 / LLP 0009).
//
// Proves the opt-in outbound-action seam, without touching the real network:
//   - with SNAPBACK_OUTBOUND_ACTIONS on, an ACTION sees a callable `fetch`
//     (the native global returns a promise; the deny stub would throw) and a
//     populated ctx.secrets (the scoped, never-client-visible key pool);
//   - a QUERY in the same runtime is still denied fetch — egress is scoped to the
//     action execution class at the JS boundary, off the transactional path;
//   - with the flag off (the default), even an action is denied fetch, so the
//     strict posture is preserved unless egress is explicitly enabled.
//
// The Caltrain demo itself never calls fetch (it runs on the recorded feed); this
// fixture exercises the capability the demo's refresh action would use at Phase 3.
//
// Run: node demos/all-aboard/tests/acceptance/egress.mjs

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const probeDir = join(here, '..', 'egress-probe');
const gen = (f) => JSON.parse(readFileSync(join(probeDir, 'generated', f), 'utf8'));
const schema = gen('schema.manifest.json');
const functions = gen('functions.manifest.json');
const SECRETS = '{"feedKeys":["key-a","key-b"]}';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };

async function startApi(port, extraEnv) {
  const env = { ...process.env, ...extraEnv };
  if (process.platform === 'darwin' && !env.DYLD_FRAMEWORK_PATH) {
    env.DYLD_FRAMEWORK_PATH = join(repoRoot, 'vendor', 'ibex', 'ios', 'Frameworks');
  }
  const child = spawn('cargo', ['run', '--quiet', '--', '--port', String(port), '--memory'], { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'] });
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await urlOk(`${url}/health`)) return { url, stop: () => child.kill('SIGTERM') };
    if (child.exitCode !== null) throw new Error(`API exited (${child.exitCode})`);
    await sleep(400);
  }
  child.kill('SIGKILL');
  throw new Error('API did not become healthy');
}

async function runAction(url, name) {
  const res = await fetch(`${url}/_snapback/api/functions/${name}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: {}, read_set: [] }),
  });
  if (!res.ok) throw new Error(`run ${name} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const suite = createSuite('all-aboard egress seam (Phase 3)');
const servers = [];

// runAcceptance (ENG-22486) surfaces a setup throw and exits nonzero on a
// zero-check run — previously a pre-check failure here exited "PASS — 0/0".
await runAcceptance(suite, async () => {
  // --- Egress ENABLED runtime ---
  const on = await startApi(4430, { SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_ACTION_SECRETS: SECRETS });
  servers.push(on);
  const dbOn = new SnapbackClient(on.url);
  await dbOn.loadSchema(schema);
  await dbOn.loadFunctions(functions);

  await suite.check('with egress on, an action sees a callable fetch', async () => {
    const result = await runAction(on.url, 'egressProbe');
    assert(result.ok, `action failed: ${JSON.stringify(result.diagnostic)}`);
    assertEqual(result.result.fetchState, 'available', 'fetch is un-denied for the action class');
    return { fetchState: result.result.fetchState };
  });

  await suite.check('the action receives the scoped ctx.secrets key pool', async () => {
    const result = await runAction(on.url, 'egressProbe');
    assert(result.result.hasSecrets, 'ctx.secrets present');
    assertEqual(result.result.secrets.feedKeys, ['key-a', 'key-b'], 'secret key pool matches SNAPBACK_ACTION_SECRETS');
  });

  await suite.check('a query in the same runtime is still denied fetch', async () => {
    const { rows } = await dbOn.query('queryProbe', {});
    assert(/AMBIENT_CAPABILITY_DENIED/.test(rows[0].fetchState), `query fetch should be denied, got: ${rows[0].fetchState}`);
    return { queryFetchState: rows[0].fetchState };
  });

  on.stop();
  servers.pop();
  await sleep(300);

  // --- Egress DISABLED (default) runtime ---
  const off = await startApi(4431, {});
  servers.push(off);
  const dbOff = new SnapbackClient(off.url);
  await dbOff.loadSchema(schema);
  await dbOff.loadFunctions(functions);

  await suite.check('by default (flag off) even an action is denied fetch', async () => {
    const result = await runAction(off.url, 'egressProbe');
    assert(result.ok, `action failed: ${JSON.stringify(result.diagnostic)}`);
    assert(/AMBIENT_CAPABILITY_DENIED/.test(result.result.fetchState), `default should deny fetch, got: ${result.result.fetchState}`);
    return { fetchState: result.result.fetchState };
  });
}, { cleanups: [() => { for (const s of servers) { try { s.stop(); } catch { /* best effort */ } } }] });

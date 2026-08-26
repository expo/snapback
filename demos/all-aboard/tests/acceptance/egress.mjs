// All Aboard — Phase 3 action-egress seam + LLP 0036 config v1 acceptance.
//
// Proves the opt-in outbound-action seam and the declared-config subsystem,
// without touching the real network:
//   - with SNAPBACK_OUTBOUND_ACTIONS on, an ACTION sees a callable `fetch`
//     (the native global returns a promise; the deny stub would throw);
//   - the deprecated SNAPBACK_ACTION_SECRETS blob imports ONCE into the config
//     store for the declared `feedKeys` pool, and the action receives granted
//     ctx.secrets HANDLES: rotation walks the pool across invocations, every
//     accidental materialization path (stringify/template/concat) redacts, and
//     an undeclared entry fails with SNAPBACK_CONFIG_UNDECLARED;
//   - the gated /_snapback/api/config/* ops drive status/set/unset/verify with
//     names and states only — never values — and config survives app.reset;
//   - a QUERY in the same runtime is still denied fetch and has no ctx.secrets;
//   - with the flag off (the default), even an action is denied fetch, but the
//     granted handles still work — config does not depend on egress.
//
// Run: node demos/all-aboard/tests/acceptance/egress.mjs

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const probeDir = join(here, '..', 'egress-probe');
const gen = (f) => JSON.parse(readFileSync(join(probeDir, 'generated', f), 'utf8'));
const schema = gen('schema.manifest.json');
const functions = gen('functions.manifest.json');
const SECRETS = '{"feedKeys":["key-a","key-b"]}';
const REDACTED = '[snapback secret feedKeys]';

const ADMIN_TOKEN = process.env.SNAPBACK_ADMIN_TOKEN || 'egress-suite-admin-token';

// @ref LLP 0057#impersonationcapability-carrier — a headless child has no
// controlling terminal, so its process-bound bearer must use the ready-file
// sidecar lifecycle even though this suite never consumes that bearer.
async function startApi(extraEnv) {
  return startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    env: { ...extraEnv, SNAPBACK_ADMIN_TOKEN: ADMIN_TOKEN },
    startupTimeoutMs: 90_000,
  });
}

const adminHeaders = (server) => ({ 'x-snapback-admin-token': server.adminToken });

async function runAction(server, name, args = {}) {
  const res = await fetch(`${server.baseUrl}/_snapback/api/functions/${name}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...adminHeaders(server) },
    body: JSON.stringify({ args, read_set: [] }),
  });
  if (!res.ok) throw new Error(`run ${name} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function configApi(server, method, path, body) {
  const res = await fetch(`${server.baseUrl}/_snapback/api/config/${path}`, {
    method,
    headers: body === undefined
      ? adminHeaders(server)
      : { 'content-type': 'application/json', ...adminHeaders(server) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json, raw: JSON.stringify(json) };
}

const suite = createSuite('all-aboard egress seam + config v1 (LLP 0036)');
const servers = [];
const providers = [];

// runAcceptance (ENG-22486) surfaces a setup throw and exits nonzero on a
// zero-check run — previously a pre-check failure here exited "PASS — 0/0".
await runAcceptance(suite, async () => {
  // --- Egress ENABLED runtime, deprecated env blob supplied ---
  const on = await startApi({
    SNAPBACK_OUTBOUND_ACTIONS: '1',
    SNAPBACK_OUTBOUND_LOOPBACK: '1',
    SNAPBACK_ACTION_SECRETS: SECRETS,
  });
  servers.push(on);
  const dbOn = new SnapbackClient(on.baseUrl, on.clientOptions);
  await dbOn.loadSchema(schema);
  const loadResult = await dbOn.loadFunctions(functions);

  await suite.check('loading declared config over the env blob imports it once, loudly deprecated', async () => {
    const codes = (loadResult.diagnostics ?? []).map((d) => d.code);
    assert(codes.includes('SNAPBACK_ACTION_SECRETS_DEPRECATED'), `expected deprecation diagnostic, got ${codes.join(', ')}`);
    assert(codes.includes('SNAPBACK_CONFIG_ENV_IMPORTED'), `expected import diagnostic, got ${codes.join(', ')}`);
    return { codes };
  });

  await suite.check('with egress on, an action sees a callable fetch', async () => {
    const result = await runAction(on, 'egressProbe');
    assert(result.ok, `action failed: ${JSON.stringify(result.diagnostic)}`);
    assertEqual(result.result.fetchState, 'available', 'fetch is un-denied for the action class');
    assertEqual(result.result.config.rotatingExposed, 'key-a', 'first invocation gets the first pool member');
    return { fetchState: result.result.fetchState };
  });

  // 0137 a4-f1 conformance: a fetching action must be authorable and
  // executable end to end in BOTH forms — module form (closed-script
  // globalThis.__snapbackHandlers registration) and inline `handler:` form —
  // against a real local HTTP provider, with the module form committing the
  // response through a named mutation.
  const provider = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ delivered: true, path: req.url }));
  });
  await new Promise((ready) => provider.listen(0, '127.0.0.1', ready));
  providers.push(provider);
  const providerUrl = `http://127.0.0.1:${provider.address().port}/notify`;

  await suite.check('a module-form action fetches a local provider and commits the response', async () => {
    const result = await runAction(on, 'notifyDelivery', { url: providerUrl });
    assert(result.ok, `notifyDelivery failed: ${JSON.stringify(result.diagnostic)}`);
    assertEqual(result.result.delivered, true, 'action reports the delivery');
    const { rows } = await dbOn.query('listDeliveries', {});
    assert(
      rows.some((row) => row.url === providerUrl && /"delivered":true/.test(row.body)),
      `mutation must commit the fetched response, got ${JSON.stringify(rows)}`,
    );
    return { url: providerUrl, committed: rows.length };
  });

  await suite.check('an inline-form action performs the same outbound fetch', async () => {
    const result = await runAction(on, 'notifyInline', { url: providerUrl });
    assert(result.ok, `notifyInline failed: ${JSON.stringify(result.diagnostic)}`);
    assertEqual(result.result.delivered, true, 'inline action reports the delivery');
  });

  await suite.check('plain ctx.fetch works on the local target (host-mediated, a5-f1)', async () => {
    const result = await runAction(on, 'notifyHostFetch', { url: providerUrl });
    assert(result.ok, `notifyHostFetch failed: ${JSON.stringify(result.diagnostic)}`);
    assertEqual(result.result.delivered, true, 'ctx.fetch returns the portable {status, ok, url, bodyText} value');
    assert(/"delivered":true/.test(result.result.body), `bodyText carries the provider payload, got ${result.result.body}`);
  });

  await suite.check('granted handles rotate the imported pool across invocations', async () => {
    const second = await runAction(on, 'egressProbe');
    const third = await runAction(on, 'egressProbe');
    assertEqual(second.result.config.rotatingExposed, 'key-b', 'second invocation rotates to key-b');
    assertEqual(third.result.config.rotatingExposed, 'key-a', 'third wraps back to key-a');
    assertEqual(second.result.config.bearer, 'Bearer key-b', 'asBearer sugar carries the member');
  });

  await suite.check('every accidental materialization of a handle redacts', async () => {
    const result = await runAction(on, 'egressProbe');
    const config = result.result.config;
    assertEqual(config.stringified, JSON.stringify(REDACTED), 'JSON.stringify redacts');
    assertEqual(config.template, REDACTED, 'template literal redacts');
    assertEqual(config.concatenated, `prefix:${REDACTED}`, 'string concat redacts');
    assert(!config.stringified.includes('key-'), 'no key material in stringified form');
  });

  await suite.check('an entry outside the uses grant fails as SNAPBACK_CONFIG_UNDECLARED', async () => {
    const result = await runAction(on, 'egressProbe');
    assert(/SNAPBACK_CONFIG_UNDECLARED/.test(result.result.config.undeclaredError), `got: ${result.result.config.undeclaredError}`);
  });

  await suite.check('config.status reports names and states, never values', async () => {
    const { status, body, raw } = await configApi(on, 'GET', 'status');
    assertEqual(status, 200, 'status is readable');
    const entry = body.entries.find((e) => e.name === 'feedKeys');
    assert(entry, 'feedKeys is declared');
    assertEqual(entry.set, true, 'imported entry is set');
    assertEqual(entry.memberCount, 2, 'both pool members imported');
    assertEqual(entry.source, 'env-import', 'source recorded');
    assert(!raw.includes('key-a') && !raw.includes('key-b'), 'no value material in status');
    return { generation: body.generation, backendClass: body.backendClass };
  });

  await suite.check('config.verify runs the probe and records verification', async () => {
    const verify = await configApi(on, 'POST', 'verify', { entry: 'feedKeys' });
    assertEqual(verify.status, 200, `verify failed: ${verify.raw}`);
    assertEqual(verify.body.ok, true, 'probe verified the pool');
    const { body } = await configApi(on, 'GET', 'status');
    const entry = body.entries.find((e) => e.name === 'feedKeys');
    assert(entry.verified && entry.verified.ok, 'verification recorded in status');
  });

  await suite.check('config survives app.reset (deployment state, not app data)', async () => {
    await dbOn.reset();
    const { body } = await configApi(on, 'GET', 'status');
    const entry = body.entries.find((e) => e.name === 'feedKeys');
    assertEqual(entry.set, true, 'reset must not clear config');
  });

  await suite.check('config.unset empties the entry and actions fail as SNAPBACK_CONFIG_MISSING', async () => {
    const unset = await configApi(on, 'POST', 'unset', { entry: 'feedKeys' });
    assertEqual(unset.status, 200, `unset failed: ${unset.raw}`);
    const result = await runAction(on, 'egressProbe');
    assert(/SNAPBACK_CONFIG_MISSING/.test(result.result.config.rotatingError), `got: ${JSON.stringify(result.result.config)}`);
  });

  await suite.check('config.set restores the entry through the gated API', async () => {
    const set = await configApi(on, 'POST', 'set', { entry: 'feedKeys', values: ['key-c'], source: 'wizard' });
    assertEqual(set.status, 200, `set failed: ${set.raw}`);
    assertEqual(set.body.valueChanged, true, 'value changed');
    assert(!set.raw.includes('key-c'), 'no value material in the set envelope');
    const append = await configApi(on, 'POST', 'set', { entry: 'feedKeys', value: 'key-d', append: true });
    assertEqual(append.status, 200, `append failed: ${append.raw}`);
    const result = await runAction(on, 'egressProbe');
    assert(['key-c', 'key-d'].includes(result.result.config.rotatingExposed), 'action sees the new pool');
  });

  await suite.check('setting an undeclared entry is rejected', async () => {
    const set = await configApi(on, 'POST', 'set', { entry: 'nope', value: 'x' });
    assertEqual(set.status, 400, 'undeclared set fails');
    assert(/SNAPBACK_CONFIG_UNDECLARED/.test(set.raw), `got: ${set.raw}`);
  });

  await suite.check('a query in the same runtime is still denied fetch and has no ctx.secrets', async () => {
    const { rows } = await dbOn.query('queryProbe', {});
    assert(/AMBIENT_CAPABILITY_DENIED/.test(rows[0].fetchState), `query fetch should be denied, got: ${rows[0].fetchState}`);
    assertEqual(rows[0].secretsState, 'undefined', 'queries get no config surface');
    return { queryFetchState: rows[0].fetchState };
  });

  await on.stop();
  servers.pop();

  // --- Egress DISABLED (default) runtime ---
  const off = await startApi({ SNAPBACK_ACTION_SECRETS: SECRETS });
  servers.push(off);
  const dbOff = new SnapbackClient(off.baseUrl, off.clientOptions);
  await dbOff.loadSchema(schema);
  await dbOff.loadFunctions(functions);

  await suite.check('by default (flag off) even an action is denied fetch', async () => {
    const result = await runAction(off, 'egressProbe');
    assert(result.ok, `action failed: ${JSON.stringify(result.diagnostic)}`);
    assert(/AMBIENT_CAPABILITY_DENIED/.test(result.result.fetchState), `default should deny fetch, got: ${result.result.fetchState}`);
    return { fetchState: result.result.fetchState };
  });

  await suite.check('granted config handles work without egress — config does not ride the fetch grant', async () => {
    const result = await runAction(off, 'egressProbe');
    assertEqual(result.result.config.rotatingExposed, 'key-b', 'second invocation on this runtime rotates');
  });
}, {
  cleanups: [async () => {
    for (const provider of providers.splice(0)) provider.close();
    await Promise.allSettled(servers.splice(0).reverse().map((server) => server.stop()));
  }],
});

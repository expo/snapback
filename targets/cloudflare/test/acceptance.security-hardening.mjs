// ENG-24341 / ENG-24344 / ENG-24347 / ENG-24354 / ENG-24358 /
// ENG-24362 / ENG-24366: adversarial hosted-profile security boundaries.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { startProof, ADMIN_TOKEN, proxyOutboundTo, reportProofRuntimeFailure } from './harness.mjs';
import { SnapbackClient } from '../../../demos/_kit/client.mjs';
import { bindingNameFor } from '../config-set.mjs';
import { cloudflareClientOptions } from '../client-options.mjs';
import { admitChannelARate } from '../src/rate-windows.js';

// Keep transport failures attributable. This suite intentionally drives both
// Miniflare loopback HTTP and a local egress echo server; an unlabelled undici
// ECONNRESET otherwise gives no clue which lifecycle boundary regressed.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const target = typeof input === 'string' ? input : input?.url || String(input);
  try {
    // This proof creates and disposes many loopback Miniflare listeners. Do not
    // let undici retain a socket across those Worker lifetimes: every request
    // gets an explicit close handshake, eliminating the stale pooled-socket
    // race without retrying an assertion or suite.
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('connection', 'close');
    return await nativeFetch(input, { ...init, headers });
  } catch (error) {
    reportProofRuntimeFailure(target, error);
    error.message = `${target}: ${error.message}`;
    throw error;
  }
};

const schema = JSON.parse(fs.readFileSync(new URL('../../../demos/all-aboard/snapback/generated/schema.manifest.json', import.meta.url), 'utf8'));
const functions = JSON.parse(fs.readFileSync(new URL('../../../demos/all-aboard/snapback/generated/functions.manifest.json', import.meta.url), 'utf8'));
const seed = JSON.parse(fs.readFileSync(new URL('../../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));
const redactionCorpus = JSON.parse(fs.readFileSync(new URL('../../../tests/fixtures/secret-redaction-encoded-forms.json', import.meta.url), 'utf8'));
const EXPECTED_PROOF_SURFACE_CHECKS = 25;
let proofSurfaceChecks = 0;

const rateWindows = new Map();
assert.equal(admitChannelARate(rateWindows, 'oldest', 0, { maxKeys: 2 }), true);
assert.equal(admitChannelARate(rateWindows, 'newer', 1, { maxKeys: 2 }), true);
assert.equal(admitChannelARate(rateWindows, 'newest', 2, { maxKeys: 2 }), true);
assert.equal(rateWindows.has('oldest'), false, 'the Channel A rate map must evict its oldest key at the cap');
proofSurfaceChecks += 1;
assert.equal(admitChannelARate(rateWindows, 'post-expiry', 70_000, { maxKeys: 2 }), true);
assert.deepEqual([...rateWindows.keys()], ['post-expiry'], 'empty expired Channel A windows must be removed');
proofSurfaceChecks += 1;

async function jsonFetch(base, path, body, headers = {}) {
  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } catch (error) {
    error.message = `${path}: ${error.message}`;
    throw error;
  }
}

// Production: race an attacker seed against the legitimate compiled identity.
const production = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: { SNAPBACK_TESTING: '0', SNAPBACK_ACTION_RATE_LIMIT_PER_MINUTE: '2' },
});
try {
  const base = await production.url();
  const client = new SnapbackClient(base, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));
  const attackerStation = { ...seed.tables.stations[0], name: 'ATTACKER CONTROLLED' };
  const [attack, legitimate] = await Promise.all([
    jsonFetch(base, '/app/ensure', { seed: { tables: { stations: [attackerStation] } } }),
    jsonFetch(base, '/app/ensure', { schema, functions, seed }),
  ]);
  assert.equal(attack.status, 403);
  assert.equal(attack.body.diagnostic?.code, 'SNAPBACK_UNTRUSTED_SEED');
  assert.equal(legitimate.status, 200);
  assert.equal(legitimate.body.seed, 'seeded');
  const stations = await client.query('stationsQuery', {});
  assert.equal(stations.rows.length, 21);
  assert.ok(stations.rows.every((row) => row.name !== 'ATTACKER CONTROLLED'));

  const publicStatus = await fetch(`${base}/_snapback/api/config/status`);
  assert.equal(publicStatus.status, 403);
  const adminStatusResponse = await fetch(`${base}/_snapback/api/config/status`, {
    headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
  });
  const adminStatus = await adminStatusResponse.json();
  assert.equal(adminStatusResponse.status, 200);
  assert.ok(!Object.keys(adminStatus.grants).some((name) => name.startsWith('probe')));
  const productionGrant = await jsonFetch(base, '/connection/open', { connectionId: 'caller-readable-label' });
  assert.equal(productionGrant.status, 200);
  assert.notEqual(productionGrant.body.connectionId, 'caller-readable-label');
  assert.match(productionGrant.body.connectionId, /^conn_[A-Za-z0-9-]+$/);

  const anonymousPublicQuery = await jsonFetch(base, '/query/stationsQuery', { args: {} });
  assert.equal(anonymousPublicQuery.status, 200);
  assert.equal(anonymousPublicQuery.body.rows.length, 21);
  proofSurfaceChecks += 1;
  const anonymousNonPublicQuery = await jsonFetch(base, '/query/probeAmbient', { args: {} });
  assert.equal(anonymousNonPublicQuery.status, 401);
  assert.equal(anonymousNonPublicQuery.body.diagnostic?.code, 'SNAPBACK_AUTH_REQUIRED');
  proofSurfaceChecks += 1;
  const anonymousMutation = await jsonFetch(base, '/mutation/applyFeedTick', { args: { source: 'anonymous' } });
  assert.equal(anonymousMutation.status, 401);
  assert.equal(anonymousMutation.body.diagnostic?.code, 'SNAPBACK_AUTH_REQUIRED');
  proofSurfaceChecks += 1;
  const anonymousAction = await jsonFetch(base, '/action/routeEstimate', { args: {} });
  assert.equal(anonymousAction.status, 401);
  assert.equal(anonymousAction.body.diagnostic?.code, 'SNAPBACK_AUTH_REQUIRED');
  proofSurfaceChecks += 1;
  const grantedMutation = await jsonFetch(
    base,
    '/mutation/applyFeedTick',
    {
      connection_id: productionGrant.body.connectionId,
      args: { source: 'connection-granted' },
    },
    { 'x-snapback-connection-token': productionGrant.body.connectionToken },
  );
  assert.equal(grantedMutation.status, 200);
  assert.equal(grantedMutation.body.result?.tickIndex, 1);
  proofSurfaceChecks += 1;
  const wrongAdmin = await jsonFetch(
    base,
    '/query/stationsQuery',
    { args: {} },
    { 'x-snapback-admin-token': 'wrong-token-with-a-different-length' },
  );
  assert.equal(wrongAdmin.status, 403);
  assert.equal(wrongAdmin.body.diagnostic?.code, 'SNAPBACK_ADMIN_TOKEN_INVALID');
  proofSurfaceChecks += 1;
  const wrongSameLengthAdmin = await jsonFetch(
    base,
    '/query/stationsQuery',
    { args: {} },
    { 'x-snapback-admin-token': 'x'.repeat(ADMIN_TOKEN.length) },
  );
  assert.equal(wrongSameLengthAdmin.status, 403);
  assert.equal(wrongSameLengthAdmin.body.diagnostic?.code, 'SNAPBACK_ADMIN_TOKEN_INVALID');
  proofSurfaceChecks += 1;

  // Test-only arbitrary egress is absent, caller budget overrides are
  // stripped, and per-action admission limits cap public abuse.
  const hiddenProbe = await jsonFetch(
    base,
    '/action/probeSlowFetch',
    { args: { url: 'http://127.0.0.1:1/' } },
    { 'x-snapback-admin-token': ADMIN_TOKEN },
  );
  assert.equal(hiddenProbe.body.diagnostic?.code, 'SNAPBACK_ACTION_UNKNOWN');
  const hiddenCronOverride = await jsonFetch(base, '/_snapback/test/run-cron', {
    job: 'warmPoll',
    actionOverride: 'stationsQuery',
  });
  assert.equal(hiddenCronOverride.status, 404, 'the cron actionOverride seam must not exist without SNAPBACK_TESTING=1');
  const refresh1 = await client.action('refreshFeed', { args: { pollBudgetMs: 0, feedUrl: 'http://127.0.0.1:1/' } });
  const refresh2 = await client.action('refreshFeed', { args: { pollBudgetMs: 0, feedUrl: 'http://127.0.0.1:1/' } });
  assert.equal(refresh1.ok, true);
  assert.equal(refresh2.result?.skipped, 'updated-recently');
  const route1 = await client.action('routeEstimate', { args: {} });
  const route2 = await client.action('routeEstimate', { args: {} });
  const route3 = await client.action('routeEstimate', { args: {} });
  assert.equal(route1.ok, true);
  assert.equal(route2.ok, true);
  assert.equal(route3.diagnostic?.code, 'SNAPBACK_ACTION_RATE_LIMITED');
} finally {
  await production.dispose();
}

// Caller-scoped manual buckets do not interfere, while scheduled work has a
// distinct reserve that is still finite (scheduled is not a bypass).
const budgeted = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: {
    SNAPBACK_ACTION_RATE_LIMIT_PER_MINUTE: '1',
    SNAPBACK_SCHEDULED_ACTION_RATE_LIMIT_PER_MINUTE: '1',
  },
});
try {
  const base = await budgeted.url();
  const open = (label) => jsonFetch(base, '/connection/open', { connectionId: label });
  const callerA = await open('budget-a');
  const callerB = await open('budget-b');
  const callAs = (grant) => jsonFetch(
    base,
    '/action/routeEstimate',
    { connection_id: grant.body.connectionId, args: {} },
    { 'x-snapback-connection-token': grant.body.connectionToken },
  );
  assert.equal((await callAs(callerA)).body.ok, true);
  proofSurfaceChecks += 1;
  assert.equal((await callAs(callerA)).body.diagnostic?.code, 'SNAPBACK_ACTION_RATE_LIMITED');
  proofSurfaceChecks += 1;
  assert.equal((await callAs(callerB)).body.ok, true, 'a second connection must own a separate action bucket');
  proofSurfaceChecks += 1;

  const scheduledAtMs = Date.now();
  const scheduled1 = await jsonFetch(base, '/_snapback/test/run-cron', {
    job: 'warmPoll',
    actionOverride: 'routeEstimate',
    trigger: 'scheduled',
    scheduledAtMs,
  });
  const scheduled2 = await jsonFetch(base, '/_snapback/test/run-cron', {
    job: 'warmPoll',
    actionOverride: 'routeEstimate',
    trigger: 'scheduled',
    scheduledAtMs: scheduledAtMs + 1,
  });
  assert.equal(scheduled1.body.outcome, 'ok');
  proofSurfaceChecks += 1;
  assert.equal(scheduled2.body.outcome, 'failed', 'the separate scheduled reserve must still be capped');
  proofSurfaceChecks += 1;
} finally {
  await budgeted.dispose();
}

const SPECIAL_SECRET = redactionCorpus.secret;
function utf16Escaped(value, casing = 'lower') {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    let hex = value.charCodeAt(index).toString(16).padStart(4, '0');
    if (casing === 'upper') hex = hex.toUpperCase();
    if (casing === 'mixed') {
      hex = [...hex].map((character, offset) => (offset % 2 === 0 ? character.toUpperCase() : character.toLowerCase())).join('');
    }
    output += `\\u${hex}`;
  }
  return output;
}
let echoRequests = 0;
const echoServer = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const raw = url.searchParams.get('secret') || '';
  if (url.pathname === '/redirect') {
    response.writeHead(302, { location: `/echo?secret=${encodeURIComponent(raw)}` });
    response.end();
    return;
  }
  echoRequests += 1;
  const form = new URLSearchParams({ v: raw }).toString().slice(2);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    raw,
    url: encodeURIComponent(raw),
    doubleUrl: encodeURIComponent(encodeURIComponent(raw)),
    form,
    json: JSON.stringify(raw),
    nfc: raw.normalize('NFC'),
    nfd: raw.normalize('NFD'),
    unicodeLower: utf16Escaped(raw, 'lower'),
    unicodeUpper: utf16Escaped(raw, 'upper'),
    unicodeMixed: utf16Escaped(raw, 'mixed'),
    unicodePartial: raw.slice(0, 2) + utf16Escaped(raw.slice(2), 'mixed'),
  }));
});
await new Promise((resolve) => echoServer.listen(0, '127.0.0.1', resolve));
const echoOrigin = `http://127.0.0.1:${echoServer.address().port}`;
const authoredOrigin = 'https://upstream.example';

const testing = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: {
    [bindingNameFor('all-aboard', 'caltrainFeed')]: JSON.stringify(['caltrain-only-secret']),
    [bindingNameFor('all-aboard', 'directions')]: JSON.stringify([SPECIAL_SECRET]),
    SNAPBACK_CONFIG_GENERATION: '1',
  },
  outboundService: proxyOutboundTo(echoOrigin),
});
try {
  const base = await testing.url();
  const client = new SnapbackClient(base, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));
  await client.ensureApp({ seed });
  const testAction = (name, args = {}) => jsonFetch(base, '/_snapback/test/action', { name, args });
  const payload = await jsonFetch(base, '/_snapback/test/secrets-payload', { name: 'probeSecrets' });
  const grants = JSON.parse(payload.body.secretsJson).entries;
  const crossGrant = await testAction('probeSecretForgery', { capabilityId: grants.caltrainFeed.firstCapabilityId });
  const noGrant = await testAction('probeSecretForgeryNoGrant', { capabilityId: grants.directions.firstCapabilityId });
  assert.equal(crossGrant.body.result.rejected, true);
  assert.equal(crossGrant.body.result.code, 'SNAPBACK_HOST_FETCH_SLOT_INVALID');
  assert.equal(noGrant.body.result.rejected, true);
  assert.equal(noGrant.body.result.code, 'SNAPBACK_HOST_FETCH_SLOT_INVALID');

  const reversible = new Set(redactionCorpus.variants);
  const echoed = await testAction('probeSecretEcho', { url: `${authoredOrigin}/echo` });
  const echoedText = JSON.stringify(echoed.body);
  assert.equal(echoed.body.ok, true, echoedText);
  assert.ok(echoedText.includes('[redacted]'), echoedText);
  for (const variant of reversible) {
    if (variant) assert.ok(!echoedText.includes(variant), `secret representation crossed host boundary: ${variant}`);
  }
  assert.equal(echoed.body.result.url, `${authoredOrigin}/echo`);
  proofSurfaceChecks += 1;

  const echoCountBeforeRedirect = echoRequests;
  const redirected = await testAction('probeSecretEcho', { url: `${authoredOrigin}/redirect` });
  assert.equal(redirected.body.code, 'SNAPBACK_HOST_FETCH_REDIRECT_REFUSED');
  assert.equal(echoRequests, echoCountBeforeRedirect, 'manual redirect handling must not fetch the Location target');
  proofSurfaceChecks += 1;

  for (const refusedUrl of [
    'http://metadata/latest/meta-data',
    'http://metadata.google.internal/computeMetadata/v1',
    'http://service.localhost/private',
    'http://127.0.0.1/private',
    'http://[::ffff:127.0.0.1]/private',
  ]) {
    const refused = await testAction('probeSecretEcho', { url: refusedUrl });
    assert.equal(refused.body.code, 'SNAPBACK_HOST_FETCH_DESTINATION_REFUSED', refusedUrl);
    proofSurfaceChecks += 1;
  }
  for (const invalidUrl of [
    'ftp://example.com/file',
    'https://user:password@example.com/private',
    'https://./missing-host',
  ]) {
    const refused = await testAction('probeSecretEcho', { url: invalidUrl });
    assert.equal(refused.body.code, 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID', invalidUrl);
    proofSurfaceChecks += 1;
  }
  const failedFetch = await testAction('probeSecretEcho', { url: 'http://127.0.0.1:9/fail' });
  assert.equal(failedFetch.body.code, 'SNAPBACK_HOST_FETCH_DESTINATION_REFUSED');
  proofSurfaceChecks += 1;
  const failedText = JSON.stringify(failedFetch.body);
  for (const variant of reversible) {
    if (variant) assert.ok(!failedText.includes(variant));
  }
  const manualNested = await client.action('refreshFeed', { args: { source: 'recorded', trigger: 'manual-ledger-check' } });
  assert.equal(manualNested.ok, true);
  const manualLedger = await jsonFetch(base, '/_snapback/test/cron-claims', {});
  assert.equal(manualLedger.body.mutationResults, 0, 'ordinary actions must not accumulate retry-ledger rows');

  // WebSocket credentials: query-only is refused without echoing the token;
  // explicit header and browser subprotocol remain accepted.
  const opened = await jsonFetch(base, '/connection/open', { connectionId: 'security-ws' });
  const connectionId = opened.body.connectionId;
  const token = opened.body.connectionToken;
  const socketless = await jsonFetch(
    base,
    '/live/liveTrainStatus/subscribe',
    { connection_id: connectionId, input: { args: {} } },
    { 'x-snapback-connection-token': token }
  );
  assert.equal(socketless.status, 409);
  assert.equal(socketless.body.diagnostic?.code, 'SNAPBACK_CONNECTION_SOCKET_REQUIRED');
  const socketlessState = await jsonFetch(base, '/_snapback/test/connection-state', {});
  assert.equal(socketlessState.body.subscriptions.length, 0, 'socketless subscribe must not persist demand');
  const socketlessCron = await (await fetch(`${base}/_snapback/api/cron/status`)).json();
  assert.equal(socketlessCron.jobs[0].activation.state, 'inactive:no-demand');
  await jsonFetch(base, '/_snapback/test/schema-hardening', { operation: 'create-socketless-kit-orphan' });
  const corruptSocketlessCron = await (await fetch(`${base}/_snapback/api/cron/status`)).json();
  assert.equal(corruptSocketlessCron.jobs[0].activation.demand, 0, 'a corrupt v3 socketless kit row must not count as proof demand');
  const reapedSocketless = await jsonFetch(base, '/_snapback/test/subscription-migration', {});
  assert.equal(reapedSocketless.body.layout.subscriptionSchemaVersion, 3);
  assert.equal(reapedSocketless.body.layout.subscriptionCount, 0, 'v2→v3 migration must reap socketless kit rows');
  const queryOnly = await testing.raw(`/live/${connectionId}/stream?connection_token=${encodeURIComponent(token)}`, {
    headers: { upgrade: 'websocket' },
  });
  const queryFailure = await queryOnly.json();
  assert.equal(queryOnly.status, 401);
  assert.equal(queryFailure.diagnostic?.code, 'SNAPBACK_CONNECTION_TOKEN_QUERY_FORBIDDEN');
  assert.ok(!JSON.stringify(queryFailure).includes(token));

  function acceptSocket(response) {
    assert.equal(response.status, 101);
    const ws = response.webSocket;
    ws.accept();
    const queue = [];
    const waiters = [];
    ws.addEventListener('message', (event) => {
      const value = JSON.parse(event.data);
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else queue.push(value);
    });
    return {
      ws,
      next(timeoutMs = 1500) {
        if (queue.length) return Promise.resolve(queue.shift());
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('socket frame timeout')), timeoutMs);
          waiters.push((value) => { clearTimeout(timer); resolve(value); });
        });
      },
    };
  }

  const headerSocket = acceptSocket(await testing.raw(`/live/${connectionId}/stream`, {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', 'x-snapback-connection-token': token },
  }));
  const replacement = acceptSocket(await testing.raw(`/live/${connectionId}/stream`, {
    headers: {
      upgrade: 'websocket',
      'sec-websocket-protocol': `snapback.v1, snapback.connection-token.${token}`,
    },
  }));
  const subscribed = await jsonFetch(
    base,
    '/live/liveTrainStatus/subscribe',
    { connection_id: connectionId, input: { args: {} } },
    { 'x-snapback-connection-token': token }
  );
  assert.equal(subscribed.status, 200);
  // The first socket is now obsolete. Its socket-carried unsubscribe cannot
  // delete the replacement session's row.
  headerSocket.ws.send(JSON.stringify({ type: 'unsubscribe', subscriptionId: subscribed.body.subscription_id }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const replacementOwned = await jsonFetch(base, '/_snapback/test/connection-state', {});
  assert.equal(replacementOwned.body.subscriptions.length, 1);
  assert.notEqual(replacementOwned.body.subscriptions[0].socket_session_id, null);
  await testing.evict();
  headerSocket.ws.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await client.mutate('applyFeedTick', { args: { trigger: 'old-close-first', source: 'recorded' } });
  const replacementFrame = await replacement.next();
  assert.equal(replacementFrame.kind, 'live_replace');

  // Replacement-first closes current ownership and removes subscriptions;
  // the obsolete socket never resumes receiving frames.
  const current = acceptSocket(await testing.raw(`/live/${connectionId}/stream`, {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', 'x-snapback-connection-token': token },
  }));
  current.ws.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Drain frames the replacement legitimately received BEFORE current's open
  // closed it server-side: the armed warm poll (subscribe arms cron on this
  // bundle) can commit feed mutations at nondeterministic times, queueing
  // extra live_replace frames client-side. Those are pre-replacement traffic,
  // not a violation; the invariant under test is that nothing NEW arrives for
  // the post-replacement commit below (this drain closed a host-timing flake,
  // issues/closed/20260724-security-hardening-obsolete-socket-flake.md).
  for (;;) {
    try {
      await replacement.next(200);
    } catch (_) {
      break;
    }
  }
  const preFinal = await jsonFetch(base, '/_snapback/test/connection-state', {});
  assert.equal(preFinal.body.subscriptions.length, 0);
  await client.mutate('applyFeedTick', { args: { trigger: 'replacement-close-first', source: 'recorded' } });
  let obsoleteReceived = false;
  try {
    await replacement.next(250);
    obsoleteReceived = true;
  } catch (_) {}
  assert.equal(obsoleteReceived, false);
  replacement.ws.close();
} finally {
  await testing.dispose();
  echoServer.close();
}

// Durable connection capabilities are finite, route-safe, reaped after their
// idle lease, and remain healthy across repeated destructive reset/open cycles.
const bounded = await startProof({
  app: 'notes',
  port: 0,
  bindings: {
    SNAPBACK_CONNECTION_GRANT_LIMIT: '3',
    SNAPBACK_CONNECTION_GRANT_TTL_MS: '60000',
    SNAPBACK_CONNECTION_OPEN_RATE_PER_MINUTE: '4',
  },
});
try {
  const base = await bounded.url();
  const invalid = await jsonFetch(base, '/connection/open', { connectionId: 'not route safe' });
  const tooLong = await jsonFetch(base, '/connection/open', { connectionId: 'x'.repeat(129) });
  assert.equal(invalid.body.diagnostic?.code, 'SNAPBACK_CONNECTION_ID_INVALID');
  assert.equal(tooLong.body.diagnostic?.code, 'SNAPBACK_CONNECTION_ID_INVALID');
  const openedGrants = new Map();
  for (const connectionId of ['bounded-a', 'bounded-b', 'bounded-c']) {
    const grant = await jsonFetch(base, '/connection/open', { connectionId });
    assert.equal(grant.status, 200);
    openedGrants.set(connectionId, grant.body.connectionToken);
  }
  const full = await jsonFetch(base, '/connection/open', { connectionId: 'bounded-d' });
  assert.equal(full.status, 429);
  assert.equal(full.body.diagnostic?.code, 'SNAPBACK_CONNECTION_GRANT_LIMIT');
  await jsonFetch(base, '/_snapback/test/age-connections', {});
  const expiredUse = await fetch(`${base}/outbox/bounded-a`, {
    headers: { 'x-snapback-connection-token': openedGrants.get('bounded-a') },
  });
  assert.equal(expiredUse.status, 401, 'an idle-expired grant must be rejected even before the next open');
  const expired = await jsonFetch(base, '/_snapback/test/expire-connections', {});
  assert.equal(expired.body.reaped, 2);
  assert.equal((await jsonFetch(base, '/connection/open', { connectionId: 'bounded-d' })).status, 200);
  const rateLimited = await jsonFetch(base, '/connection/open', { connectionId: 'bounded-e' });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.diagnostic?.code, 'SNAPBACK_CONNECTION_OPEN_RATE_LIMIT');
  for (let index = 0; index < 5; index += 1) {
    const reset = await bounded.reset();
    assert.equal(reset.reset, true);
    const reopened = await jsonFetch(base, '/connection/open', { connectionId: `after-reset-${index}` });
    assert.equal(reopened.status, 200);
  }
} finally {
  await bounded.dispose();
}

// The legacy proof socket cannot bypass hosted bounds: accepted sockets,
// durable rows, rows per connection, and canonical args bytes all have hard
// ceilings. Persisted over-limit state fails startup but leaves health/reset.
const boundedSubscriptions = await startProof({
  app: 'notes',
  port: 0,
  bindings: {
    SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT: '3',
    SNAPBACK_SUBSCRIPTION_PER_CONNECTION_LIMIT: '2',
    SNAPBACK_SUBSCRIPTION_ARGS_BYTES: '64',
    SNAPBACK_LEGACY_PROOF_SOCKET_LIMIT: '2',
  },
});
try {
  const base = await boundedSubscriptions.url();
  const first = await boundedSubscriptions.openLiveSocket();
  const second = await boundedSubscriptions.openLiveSocket();
  const refusedSocket = await boundedSubscriptions.raw('/live/stream', { headers: { upgrade: 'websocket' } });
  assert.equal(refusedSocket.status, 429);
  assert.equal((await refusedSocket.json()).code, 'SNAPBACK_LEGACY_PROOF_SOCKET_LIMIT');

  first.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'a' } });
  assert.equal((await first.waitFor('snapshot')).type, 'snapshot');
  first.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'b' } });
  assert.equal((await first.waitFor('snapshot')).type, 'snapshot');
  first.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'c' } });
  assert.equal((await first.waitFor('error')).code, 'SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT');

  second.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'd' } });
  assert.equal((await second.waitFor('snapshot')).type, 'snapshot');
  second.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'e' } });
  assert.equal((await second.waitFor('error')).code, 'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT');
  second.send({ type: 'subscribe', name: 'listNotes', args: { boardId: 'x'.repeat(100) } });
  const oversized = await second.waitFor('error');
  assert.equal(oversized.code, 'SNAPBACK_SUBSCRIPTION_ARGS_TOO_LARGE');
  assert.equal(oversized.details?.limitBytes, 64);
  const boundedState = await jsonFetch(base, '/_snapback/test/connection-state', {});
  assert.equal(boundedState.body.subscriptions.length, 3, 'rejected legacy subscriptions persist no rows');

  await jsonFetch(base, '/_snapback/test/schema-hardening', {
    operation: 'insert-legacy-subscription',
    subscriptionId: 'overflow-global',
    connectionId: 'legacy-overflow',
    functionName: 'listNotes',
    argsJson: '{"boardId":"overflow"}',
    schemaVersion: 2,
  });
  const globalRefusal = await jsonFetch(base, '/_snapback/test/schema-hardening', { operation: 'reinitialize' });
  assert.equal(globalRefusal.body.startupError?.code, 'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT_EXCEEDED');
  assert.equal(
    globalRefusal.body.subscriptionSchemaVersion,
    2,
    'over-limit legacy rows must be refused before the v2→v3 copy starts'
  );
  assert.equal((await fetch(`${base}/health`)).status, 409);
  assert.equal((await boundedSubscriptions.reset()).reset, true);
  first.close();
  second.close();

  for (let index = 0; index < 3; index += 1) {
    await jsonFetch(base, '/_snapback/test/schema-hardening', {
      operation: 'insert-legacy-subscription',
      subscriptionId: `overflow-connection-${index}`,
      connectionId: 'one-legacy-connection',
      functionName: 'listNotes',
      argsJson: JSON.stringify({ boardId: `legacy-${index}` }),
    });
  }
  const connectionRefusal = await jsonFetch(base, '/_snapback/test/schema-hardening', { operation: 'reinitialize' });
  assert.equal(connectionRefusal.body.startupError?.code, 'SNAPBACK_SUBSCRIPTION_CONNECTION_LIMIT_EXCEEDED');
  assert.equal((await boundedSubscriptions.reset()).reset, true);

  await jsonFetch(base, '/_snapback/test/schema-hardening', {
    operation: 'insert-legacy-subscription',
    subscriptionId: 'overflow-args',
    connectionId: 'legacy-args',
    functionName: 'listNotes',
    argsJson: JSON.stringify({ boardId: 'z'.repeat(100) }),
  });
  const argsRefusal = await jsonFetch(base, '/_snapback/test/schema-hardening', { operation: 'reinitialize' });
  assert.equal(argsRefusal.body.startupError?.code, 'SNAPBACK_SUBSCRIPTION_ARGS_LIMIT_EXCEEDED');
  assert.equal((await boundedSubscriptions.reset()).reset, true);
  assert.equal((await boundedSubscriptions.health()).ok, true);
} finally {
  await boundedSubscriptions.dispose();
}

const concurrentSubscriptions = await startProof({
  app: 'notes',
  port: 0,
  bindings: {
    SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT: '1',
    SNAPBACK_SUBSCRIPTION_PER_CONNECTION_LIMIT: '1',
    SNAPBACK_TEST_SUBSCRIPTION_STAGE_DELAY_MS: '100',
  },
});
try {
  const base = await concurrentSubscriptions.url();
  const opened = [];
  for (const label of ['concurrent-a', 'concurrent-b']) {
    const grant = await jsonFetch(base, '/connection/open', { connectionId: label });
    const response = await concurrentSubscriptions.raw(`/live/${grant.body.connectionId}/stream`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', 'x-snapback-connection-token': grant.body.connectionToken },
    });
    response.webSocket.accept();
    opened.push({ grant: grant.body, socket: response.webSocket });
  }
  const attempts = await Promise.all(opened.map(({ grant }, index) => jsonFetch(
    base,
    '/live/listNotes/subscribe',
    { connection_id: grant.connectionId, input: { args: { boardId: `concurrent-${index}` } } },
    { 'x-snapback-connection-token': grant.connectionToken }
  )));
  assert.deepEqual(attempts.map((attempt) => attempt.status).sort((a, b) => a - b), [200, 429]);
  assert.equal(attempts.find((attempt) => attempt.status === 429)?.body.diagnostic?.code, 'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT');
  const state = await jsonFetch(base, '/_snapback/test/connection-state', {});
  assert.equal(state.body.subscriptions.length, 1, 'delayed concurrent snapshots cannot overbook the persisted cap');
  for (const { socket } of opened) socket.close();
} finally {
  await concurrentSubscriptions.dispose();
}

// Make the second admission inside persistSubscription load-bearing: stage a
// candidate while capacity is available, consume the final slot, then attempt
// the write. The stale staged decision must not overbook durable state.
const linearizedSubscriptions = await startProof({
  app: 'notes',
  port: 0,
  bindings: {
    SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT: '1',
    SNAPBACK_SUBSCRIPTION_PER_CONNECTION_LIMIT: '1',
  },
});
try {
  const base = await linearizedSubscriptions.url();
  const linearized = await jsonFetch(base, '/_snapback/test/subscription-linearization', {});
  assert.equal(linearized.status, 200);
  assert.equal(linearized.body.stagedAdmission?.ok, true);
  assert.equal(linearized.body.persisted?.ok, false);
  assert.equal(linearized.body.persisted?.code, 'SNAPBACK_SUBSCRIPTION_GLOBAL_LIMIT');
  assert.deepEqual(linearized.body.rows, ['linearization-filler']);
} finally {
  await linearizedSubscriptions.dispose();
}

const boundedSockets = await startProof({
  app: 'notes',
  port: 0,
  bindings: { SNAPBACK_ACCEPTED_SOCKET_LIMIT: '3' },
});
try {
  const base = await boundedSockets.url();
  const grant = await jsonFetch(base, '/connection/open', { connectionId: 'socket-flood' });
  const sockets = [];
  let current = null;
  for (let index = 0; index < 5; index += 1) {
    const previous = current;
    const response = await boundedSockets.raw(`/live/${grant.body.connectionId}/stream`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', 'x-snapback-connection-token': grant.body.connectionToken },
    });
    assert.equal(response.status, 101);
    response.webSocket.accept();
    current = response.webSocket;
    const state = await jsonFetch(base, '/_snapback/test/connection-state', {});
    assert.equal(state.body.acceptedSocketCount, 1, 'reconnect must replace, not accumulate, accepted sockets');
    // Miniflare's in-process client endpoint does not surface the server-side
    // close event, so the authoritative hibernation registry count above is
    // the observable that proves the old accepted socket was removed.
    if (previous) previous.close();
  }
  sockets.push(current);

  const secondGrant = await jsonFetch(base, '/connection/open', { connectionId: 'socket-global' });
  const secondSocket = await boundedSockets.raw(`/live/${secondGrant.body.connectionId}/stream`, {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', 'x-snapback-connection-token': secondGrant.body.connectionToken },
  });
  assert.equal(secondSocket.status, 101);
  secondSocket.webSocket.accept();
  sockets.push(secondSocket.webSocket);
  const thirdGrant = await jsonFetch(base, '/connection/open', { connectionId: 'socket-global-third' });
  const thirdSocket = await boundedSockets.raw(`/live/${thirdGrant.body.connectionId}/stream`, {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', 'x-snapback-connection-token': thirdGrant.body.connectionToken },
  });
  assert.equal(thirdSocket.status, 101);
  thirdSocket.webSocket.accept();
  sockets.push(thirdSocket.webSocket);
  const fourthGrant = await jsonFetch(base, '/connection/open', { connectionId: 'socket-global-refused' });
  const globallyRefused = await boundedSockets.raw(`/live/${fourthGrant.body.connectionId}/stream`, {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', 'x-snapback-connection-token': fourthGrant.body.connectionToken },
  });
  assert.equal(globallyRefused.status, 429);
  assert.equal((await globallyRefused.json()).diagnostic?.code, 'SNAPBACK_ACCEPTED_SOCKET_LIMIT');
  for (const socket of sockets) socket.close();
} finally {
  await boundedSockets.dispose();
}

// Miniflare retains a close-requested hibernation socket until the upgrade
// handler returns. With a one-socket test ceiling, replacement therefore
// closes the old socket and returns retryable 429; the retry is admitted only
// after the authoritative registry drops to zero. This proves close lag can
// never make the advertised physical cap soft.
const strictSocketCap = await startProof({
  app: 'notes',
  port: 0,
  bindings: {
    SNAPBACK_ACCEPTED_SOCKET_LIMIT: '1',
    SNAPBACK_SOCKETS_PER_CONNECTION_LIMIT: '1',
  },
});
try {
  const base = await strictSocketCap.url();
  const grant = await jsonFetch(base, '/connection/open', { connectionId: 'strict-reconnect' });
  const open = async () => strictSocketCap.raw(`/live/${grant.body.connectionId}/stream`, {
    headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'snapback.v1', 'x-snapback-connection-token': grant.body.connectionToken },
  });
  const waitForSocketCount = async (expected) => {
    const deadline = Date.now() + 2_000;
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await jsonFetch(base, '/_snapback/test/connection-state', {});
        if (last.body.acceptedSocketCount === expected) return;
      } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`accepted socket registry did not reach ${expected}: ${JSON.stringify(last?.body)}`);
  };
  let currentResponse = await open();
  assert.equal(currentResponse.status, 101);
  let current = currentResponse.webSocket;
  current.accept();
  for (let index = 0; index < 3; index += 1) {
    const closeAndRetry = await open();
    assert.equal(closeAndRetry.status, 429);
    assert.equal((await closeAndRetry.json()).diagnostic?.code, 'SNAPBACK_CONNECTION_SOCKET_LIMIT');
    await waitForSocketCount(0);
    current.close();
    currentResponse = await open();
    assert.equal(currentResponse.status, 101);
    current = currentResponse.webSocket;
    current.accept();
    await waitForSocketCount(1);
  }
  current.close();
} finally {
  await strictSocketCap.dispose();
}

// A deployment can wake with hibernated sockets admitted under older, larger
// ceilings. Simulate that upgrade by lowering testing-only limits after three
// proof sockets exist: startup posture is a structured refusal while the
// deterministic close-all cleanup runs, then health and bounded admission
// recover without an operator reset.
const upgradedSocketCaps = await startProof({
  app: 'notes',
  port: 0,
  bindings: {
    SNAPBACK_ACCEPTED_SOCKET_LIMIT: '4',
    SNAPBACK_LEGACY_PROOF_SOCKET_LIMIT: '4',
  },
});
try {
  const base = await upgradedSocketCaps.url();
  const oldSockets = [];
  for (let index = 0; index < 3; index += 1) {
    const response = await upgradedSocketCaps.raw('/live/stream', { headers: { upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    response.webSocket.accept();
    oldSockets.push(response.webSocket);
  }
  const lowered = await jsonFetch(base, '/_snapback/test/socket-limit-upgrade', {
    acceptedSockets: 1,
    legacyProofSockets: 1,
    socketsPerConnection: 1,
  });
  assert.equal(lowered.status, 200);
  assert.equal(lowered.body.ok, false);
  assert.equal(lowered.body.socketLimitError?.code, 'SNAPBACK_SOCKET_LIMIT_RECONCILIATION_PENDING');
  assert.equal(lowered.body.socketLimitError?.details?.policy, 'close-all-and-retry');
  const deadline = Date.now() + 2_000;
  let upgradedState = null;
  while (Date.now() < deadline) {
    upgradedState = await jsonFetch(base, '/_snapback/test/connection-state', {});
    if (upgradedState.body.acceptedSocketCount === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(upgradedState?.body.acceptedSocketCount, 0, 'over-limit hibernated registry must be drained');
  assert.equal((await upgradedSocketCaps.health()).ok, true);
  const admitted = await upgradedSocketCaps.raw('/live/stream', { headers: { upgrade: 'websocket' } });
  assert.equal(admitted.status, 101);
  admitted.webSocket.accept();
  const bounded = await upgradedSocketCaps.raw('/live/stream', { headers: { upgrade: 'websocket' } });
  assert.equal(bounded.status, 429);
  assert.equal((await bounded.json()).code, 'SNAPBACK_LEGACY_PROOF_SOCKET_LIMIT');
  admitted.webSocket.close();
  for (const socket of oldSockets) socket.close();
} finally {
  await upgradedSocketCaps.dispose();
}

assert.equal(proofSurfaceChecks, EXPECTED_PROOF_SURFACE_CHECKS, 'update the hardening witness count deliberately');
console.log(`cloudflare proof-surface hardening: ${proofSurfaceChecks}/${EXPECTED_PROOF_SURFACE_CHECKS} checks passed`);
console.log('cloudflare security-hardening acceptance: seed, actions, grants, redaction, admin status, and WebSocket ownership passed');

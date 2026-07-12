// ENG-24341 / ENG-24344 / ENG-24347 / ENG-24354 / ENG-24358 /
// ENG-24362 / ENG-24366: adversarial hosted-profile security boundaries.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { startProof, ADMIN_TOKEN } from './harness.mjs';
import { SnapbackClient } from '../../demos/_kit/client.mjs';
import { bindingNameFor } from '../config-set.mjs';

const schema = JSON.parse(fs.readFileSync(new URL('../../demos/all-aboard/snapback/generated/schema.manifest.json', import.meta.url), 'utf8'));
const functions = JSON.parse(fs.readFileSync(new URL('../../demos/all-aboard/snapback/generated/functions.manifest.json', import.meta.url), 'utf8'));
const seed = JSON.parse(fs.readFileSync(new URL('../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));

async function jsonFetch(base, path, body, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// Production: race an attacker seed against the legitimate compiled identity.
const production = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: { SNAPBACK_TESTING: '0', SNAPBACK_ACTION_RATE_LIMIT_PER_MINUTE: '2' },
});
try {
  const base = await production.url();
  const client = new SnapbackClient(base, { adminToken: ADMIN_TOKEN });
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

  const publicStatus = await fetch(`${base}/config/status`);
  assert.equal(publicStatus.status, 403);
  const adminStatusResponse = await fetch(`${base}/config/status`, {
    headers: { 'x-snapback-admin-token': ADMIN_TOKEN },
  });
  const adminStatus = await adminStatusResponse.json();
  assert.equal(adminStatusResponse.status, 200);
  assert.ok(!Object.keys(adminStatus.grants).some((name) => name.startsWith('probe')));
  const productionGrant = await jsonFetch(base, '/connection/open', { connectionId: 'caller-readable-label' });
  assert.equal(productionGrant.status, 200);
  assert.notEqual(productionGrant.body.connectionId, 'caller-readable-label');
  assert.match(productionGrant.body.connectionId, /^conn_[A-Za-z0-9-]+$/);

  // Test-only arbitrary egress is absent, caller budget overrides are
  // stripped, and per-action admission limits cap public abuse.
  const hiddenProbe = await jsonFetch(base, '/action/probeSlowFetch', { args: { url: 'http://127.0.0.1:1/' } });
  assert.equal(hiddenProbe.body.diagnostic?.code, 'SNAPBACK_ACTION_UNKNOWN');
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

const SPECIAL_SECRET = 'p+/%"\\ café\u0301 / é / 😀A';
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
const echoServer = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const raw = url.searchParams.get('secret') || '';
  if (url.pathname === '/redirect') {
    response.writeHead(302, { location: `/echo?secret=${encodeURIComponent(raw)}` });
    response.end();
    return;
  }
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

const testing = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: {
    [bindingNameFor('all-aboard', 'caltrainFeed')]: JSON.stringify(['caltrain-only-secret']),
    [bindingNameFor('all-aboard', 'directions')]: JSON.stringify([SPECIAL_SECRET]),
    SNAPBACK_CONFIG_GENERATION: '1',
  },
});
try {
  const base = await testing.url();
  const client = new SnapbackClient(base, { adminToken: ADMIN_TOKEN });
  await client.ensureApp({ seed });
  const testAction = (name, args = {}) => jsonFetch(base, '/__test/action', { name, args });
  const payload = await jsonFetch(base, '/__test/secrets-payload', { name: 'probeSecrets' });
  const grants = JSON.parse(payload.body.secretsJson).entries;
  const crossGrant = await testAction('probeSecretForgery', { capabilityId: grants.caltrainFeed.firstCapabilityId });
  const noGrant = await testAction('probeSecretForgeryNoGrant', { capabilityId: grants.directions.firstCapabilityId });
  assert.equal(crossGrant.body.result.rejected, true);
  assert.equal(crossGrant.body.result.code, 'SNAPBACK_HOST_FETCH_SLOT_INVALID');
  assert.equal(noGrant.body.result.rejected, true);
  assert.equal(noGrant.body.result.code, 'SNAPBACK_HOST_FETCH_SLOT_INVALID');

  const reversible = new Set([
    SPECIAL_SECRET,
    encodeURIComponent(SPECIAL_SECRET),
    encodeURIComponent(encodeURIComponent(SPECIAL_SECRET)),
    new URLSearchParams({ v: SPECIAL_SECRET }).toString().slice(2),
    JSON.stringify(SPECIAL_SECRET).slice(1, -1),
    SPECIAL_SECRET.normalize('NFC'),
    SPECIAL_SECRET.normalize('NFD'),
    utf16Escaped(SPECIAL_SECRET, 'lower'),
    utf16Escaped(SPECIAL_SECRET, 'upper'),
    utf16Escaped(SPECIAL_SECRET, 'mixed'),
    SPECIAL_SECRET.slice(0, 2) + utf16Escaped(SPECIAL_SECRET.slice(2), 'mixed'),
  ]);
  for (const path of ['/echo', '/redirect']) {
    const echoed = await testAction('probeSecretEcho', { url: `${echoOrigin}${path}` });
    const text = JSON.stringify(echoed.body);
    assert.equal(echoed.body.ok, true, text);
    assert.ok(text.includes('[redacted]'), text);
    for (const variant of reversible) {
      if (variant) assert.ok(!text.includes(variant), `secret representation crossed host boundary: ${variant}`);
    }
    assert.equal(echoed.body.result.url, `${echoOrigin}${path}`);
  }
  const failedFetch = await testAction('probeSecretEcho', { url: 'http://127.0.0.1:9/fail' });
  const failedText = JSON.stringify(failedFetch.body);
  for (const variant of reversible) {
    if (variant) assert.ok(!failedText.includes(variant));
  }
  const manualNested = await client.action('refreshFeed', { args: { source: 'recorded', trigger: 'manual-ledger-check' } });
  assert.equal(manualNested.ok, true);
  const manualLedger = await jsonFetch(base, '/__test/cron-claims', {});
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
  const socketlessState = await jsonFetch(base, '/__test/connection-state', {});
  assert.equal(socketlessState.body.subscriptions.length, 0, 'socketless subscribe must not persist demand');
  const socketlessCron = await (await fetch(`${base}/cron/status`)).json();
  assert.equal(socketlessCron.jobs[0].activation.state, 'inactive:no-demand');
  await jsonFetch(base, '/__test/schema-hardening', { operation: 'create-socketless-kit-orphan' });
  const corruptSocketlessCron = await (await fetch(`${base}/cron/status`)).json();
  assert.equal(corruptSocketlessCron.jobs[0].activation.demand, 0, 'a corrupt v3 socketless kit row must not count as proof demand');
  const reapedSocketless = await jsonFetch(base, '/__test/subscription-migration', {});
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
    headers: { upgrade: 'websocket', 'x-snapback-connection-token': token },
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
  const replacementOwned = await jsonFetch(base, '/__test/connection-state', {});
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
    headers: { upgrade: 'websocket', 'x-snapback-connection-token': token },
  }));
  current.ws.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
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
  await jsonFetch(base, '/__test/age-connections', {});
  const expiredUse = await fetch(`${base}/outbox/bounded-a`, {
    headers: { 'x-snapback-connection-token': openedGrants.get('bounded-a') },
  });
  assert.equal(expiredUse.status, 401, 'an idle-expired grant must be rejected even before the next open');
  const expired = await jsonFetch(base, '/__test/expire-connections', {});
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

console.log('cloudflare security-hardening acceptance: seed, actions, grants, redaction, admin status, and WebSocket ownership passed');

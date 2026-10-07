// @ref LLP 3000.033#1.3 — bearer whitespace cannot disguise a fixed-lifetime read token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { createApp } from '../dist/app.js';
import { signup, sessionKey, refreshSession } from '../dist/auth.js';
import { server } from './helpers/app-server.mjs';

const pad = token => ` \t${token}\t `;
const day = 86400_000;
const url = 'https://read.invalid';

// Astra's device reproduction: first prove the credential resolves as Read at
// the real server, then take all three SDK entry points offline.
for (const mode of ['direct', 'restored', 'app']) for (const padded of [false, true]) {
  test(`offline ${mode} refuses server-valid read credential, padded=${padded}`, async t => {
    const { url } = await server(t);
    const result = await signup(url, 'bob@example.test', 'read-only-review-password', { scope: 'read' });
    assert.equal(result.ok, true);
    const session = { ...result.session, token: padded ? pad(result.session.token) : result.session.token, scope: 'full' };
    const proof = await (await fetch(url + '/probe?scope=1', { headers: { authorization: `Bearer ${session.token}` } })).json();
    assert.equal(proof.scope, 'read', 'server resolves this spelling to read authority');
    const initial = mode === 'direct' ? [] : [[sessionKey(url), JSON.stringify(session)]];
    const values = new Map(initial);
    let opens = 0, traffic = 0, saves = 0;
    const store = {
      async get(k) { return values.get(k) ?? null; },
      async set(k, v) { saves++; values.set(k, v); },
      async delete(k) { saves++; values.delete(k); },
    };
    const options = { url, sessionStore: store,
      fetch: async () => { traffic++; throw Error('offline'); },
      device: { async open() { opens++; throw Error('DEVICE_OPENED'); } } };
    if (mode === 'app') {
      const app = createApp(options); t.after(() => app.close());
      assert.equal((await app.ready).why?.code, 'E_READ_ONLY_DEVICE');
    } else {
      await assert.rejects(createLocalClient({ ...options, ...(mode === 'direct' ? { session } : {}) }),
        error => error.why?.code === 'E_READ_ONLY_DEVICE');
    }
    assert.equal(opens, 0); assert.equal(traffic, 0); assert.equal(saves, 0);
    assert.deepEqual([...values], initial, 'admission does not rewrite stored credentials');
  });
}

// Astra's expiry reproduction, extended past Session.scope: readOnly=false
// must still expire solely from the token, including well before its cap.
for (const readOnly of [true, false]) for (const padded of [false, true]) for (const scope of ['read', 'full', undefined]) {
  test(`token-only expiry readOnly=${readOnly} padded=${padded} scope=${scope}`, async t => {
    const now = Date.now();
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
    const requests = [], changes = [];
    const session = { principal: 'bob', kind: 'user', token: padded ? pad('ro.reader') : 'ro.reader', scope,
      expiresAt: now + 3 * day, capExpiresAt: now + 4 * day };
    const client = createClient({ url, readOnly, session, fetch: async input => {
      requests.push(new URL(input).pathname);
      return Response.json({ ok: true, scope: 'read', viewer: 'bob', store_id: 'store', seq: 0 });
    } });
    t.after(() => client.close());
    client.onSession(value => changes.push(value));
    await flush();
    t.mock.timers.tick(2 * day); await flush();
    assert.deepEqual(client.session(), session, 'no intake normalization or early expiry at the refresh window');
    t.mock.timers.tick(day - 1); await flush();
    assert.deepEqual(client.session(), session, 'credential is live until expiresAt');
    t.mock.timers.tick(1); await flush();
    assert.equal(client.session(), null);
    assert.equal(changes.at(-1), null, 'expiry publishes signed-out state');
    assert.equal((await client.query({ kind: 'query', name: 'who' }, {})).denied.code, 'E_AUTH');
    assert.ok(!requests.includes('/auth/refresh'));
  });
}

for (const credential of ['session', 'token']) test(`padded ${credential} explicit refresh preserves asset credentials and bearer`, async t => {
  const token = pad('ro.reader'), requests = [];
  const session = { principal: 'bob', kind: 'user', token, scope: 'full', expiresAt: Date.now() + 3 * day };
  const client = createClient({ url, readOnly: false, ...(credential === 'session' ? { session } : { token }), fetch: async input => {
    requests.push(new URL(input).pathname);
    return Response.json({ data: ['kept'], complete: true, seq: 0, store_id: 'store' });
  } });
  t.after(() => client.close());
  assert.deepEqual((await client.query({ kind: 'query', name: 'who' }, {})).data, ['kept']);
  const source = client.assetSource('photo');
  assert.equal(source.headers.authorization, `Bearer ${token}`);
  assert.equal((await client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
  assert.deepEqual(client.assetSource('photo'), source);
  assert.deepEqual(requests, ['/q/who']);
  assert.equal((await refreshSession(url, token, async () => { throw Error('must not send'); })).why.code, 'E_READ_ONLY_REFRESH');
});

test('padded near-expiry startup schedules expiry without attempting refresh', async t => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const requests = [], token = pad('ro.reader');
  const client = createClient({ url, session: { principal: 'bob', kind: 'user', token, expiresAt: now + 1000 },
    fetch: async input => { requests.push(String(input)); throw Error('offline'); } });
  t.after(() => client.close());
  await flush(); assert.equal(client.session()?.token, token);
  t.mock.timers.tick(1000); await flush();
  assert.equal(client.session(), null);
  assert.deepEqual(requests, []);
});

test('read-token recognition uses the server ASCII whitespace set, not JavaScript trim', async () => {
  // Same boundary vectors as auth::tests::bearer_padding_matches_sdk_read_token_predicate.
  for (const padding of [' ', '\t', '\n', '\f', '\r', ' \t\n\f\r ']) {
    const token = `${padding}ro.reader${padding}`;
    let sent = 0;
    const result = await refreshSession(url, token, async () => { sent++; throw Error('offline'); });
    assert.equal(result.why.code, 'E_READ_ONLY_REFRESH', JSON.stringify(padding));
    assert.equal(sent, 0);
    await assert.rejects(createLocalClient({ url, session: { principal: 'bob', kind: 'user', token, expiresAt: Date.now() + day },
      device: { async open() { throw Error('DEVICE_OPENED'); } }, fetch: async () => { sent++; throw Error('offline'); } }),
    error => error.why?.code === 'E_READ_ONLY_DEVICE');
    assert.equal(sent, 0);
  }
  for (const padding of ['\v', '\u0085', '\u00a0', '\u2003', '\ufeff']) {
    const token = `${padding}ro.reader${padding}`, requests = [];
    const result = await refreshSession(url, token, async (_, init) => {
      requests.push(init.headers.authorization);
      return Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'invalid token' } });
    });
    assert.equal(result.why.code, 'E_AUTH');
    assert.deepEqual(requests, [`Bearer ${token}`], 'non-ASCII padding is not stripped into a read credential');
  }
});

test('padded full sessions still refresh automatically and explicitly', async t => {
  const now = Date.now(), token = pad('full'), requests = [];
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const session = { principal: 'bob', kind: 'user', token, expiresAt: now + 3 * day };
  const client = createClient({ url, session, fetch: async (input, init) => {
    requests.push([new URL(input).pathname, init.headers.authorization]);
    return Response.json({ session: { ...session, token: `full-${requests.length}`, expiresAt: Date.now() + 3 * day } });
  } });
  t.after(() => client.close());
  t.mock.timers.tick(2 * day); await flush();
  assert.equal(client.session()?.token, 'full-1');
  assert.equal((await client.refreshSession()).ok, true);
  assert.equal(client.session()?.token, 'full-2');
  assert.deepEqual(requests, [['/auth/refresh', `Bearer ${token}`], ['/auth/refresh', 'Bearer full-1']]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { createApp } from '../dist/app.js';
import { guest, memorySessionStore, keepSession } from '../dist/auth.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { onlineView } from '../dist/app-online-arm.js';
import { server, until } from './helpers/app-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
const wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const device = () => webDevice({ wasm, persist: memoryPersistence() });
const q = { kind: 'query', name: 'list' }, m = { kind: 'mutation', name: 'touch', ephemeral: true }, a = { kind: 'action', name: 'work' };
const source = `use identity
table notes:
  body: text <=100
  public 'session diagnostic fixture'
  online only
query list():
  return notes first 10 by .id
`;
const messages = {
  unknown: 'this session is unknown to this store (it may belong to a replaced store or another instance); sign in again and discard saved tokens from an earlier store',
  expired: 'this session expired on the server clock (a dev clock advance can expire sessions); sign in again',
  revoked: 'this session was signed out, revoked, or replaced by refresh; sign in again and discard the saved token',
};

for (const mode of ['online', 'local', 'app-online', 'app-device']) {
  test(`${mode}: each dev/serve refusal survives terminal cleanup and the online arm`, { timeout: hangBudget(30) }, async t => {
    const { url } = await server(t, undefined, source);
    for (const serve of [false, true]) for (const cause of Object.keys(messages)) await t.test(`${serve ? 'serve' : 'dev'} ${cause}`, async t => {
      const why = { code: 'E_AUTH', family: 'auth', message: serve ? 'this session is not live; sign in again' : messages[cause], guide: 'personas' };
      let refuse = false, requests = 0;
      const fetcher = (input, init) => {
        if (refuse && new URL(input).pathname.startsWith('/q/')) { requests++; return Promise.resolve(Response.json({ denied: why }, { status: 401 })); }
        return fetch(input, init);
      };
      const sessions = memorySessionStore();
      let client, app;
      if (mode.startsWith('app')) {
        app = createApp({ url, sessionStore: sessions, fetch: fetcher, ...(mode === 'app-device' ? { device: device() } : {}) });
        t.after(() => app.close()); await app.ready;
        assert.equal((await app.auth.guest()).ok, true);
        client = app.online;
      } else {
        const result = await guest(url); assert.equal(result.ok, true);
        const options = { url, session: result.session, sessionStore: sessions, fetch: fetcher };
        client = mode === 'local' ? await createLocalClient({ ...options, device: device() }) : createClient(options);
        t.after(() => client.close());
      }
      assert.ok('data' in await client.query(q, {}));
      refuse = true;
      const read = await client.query(q, {});
      assert.deepEqual(read.denied, why);
      assert.deepEqual((await client.query(q, {})).denied, why, 'subsequent query keeps cause');
      assert.deepEqual((await client.mutate(m, {})).why, why, 'subsequent signal keeps cause');
      assert.deepEqual((await client.act(a, {})).denied, why, 'subsequent action keeps cause');
      if (mode === 'app-online') {
        await until(() => app.auth.state === 'signed-out');
        assert.deepEqual(app.auth.why, why);
        assert.deepEqual((await app.online.query(q, {})).denied, why, 'new signed-out facade keeps cause');
      }
      assert.equal(requests, 1, 'no repeated refused request');
    });
  });
}

test('ordinary signed-out client and app online arm still say sign in', async t => {
  const client = createClient({ url: 'https://signed-out.invalid', fetch: () => { throw Error('unexpected request'); } });
  t.after(() => client.close());
  const arm = onlineView(client);
  for (const c of [client, arm]) {
    assert.match((await c.query(q, {})).denied.message, /sign in/);
    assert.match((await c.mutate(m, {})).why.message, /sign in/);
    assert.match((await c.act(a, {})).denied.message, /sign in/);
  }
});

test('real dev unknown-store bearer keeps the repair through online query and saved local startup', { timeout: hangBudget(20) }, async t => {
  const { url } = await server(t, undefined, source);
  const earlier = await server(t, undefined, source);
  const issued = await guest(earlier.url); assert.equal(issued.ok, true);
  const foreign = issued.session;
  const client = createClient({ url, session: foreign }); t.after(() => client.close());
  assert.equal((await client.query(q, {})).denied.message, messages.unknown);
  const sessions = memorySessionStore(); await keepSession(url, foreign, sessions);
  await assert.rejects(createLocalClient({ url, sessionStore: sessions, device: device() }), /unknown to this store.*discard saved tokens/);
});

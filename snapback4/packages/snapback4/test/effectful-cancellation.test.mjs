import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createApp } from '../dist/app.js';
import { keepSession, memorySessionStore, restoreSession } from '../dist/auth.js';

const q = { kind: 'query', name: 'page' }, m = { kind: 'mutation', name: 'charge' }, a = { kind: 'action', name: 'charge' };
const session = token => ({ token, principal: 'alice', kind: 'user', expiresAt: Date.now() + 30 * 86400_000 });
const until = async check => { for (let i = 0; i < 400; i++) { if (await check()) return; await delay(5); } assert.fail('effect custody did not settle'); };
const promptly = promise => Promise.race([promise, delay(500).then(() => assert.fail('caller stayed behind an effectful response'))]);

// Real fetch transport: headers arrive after the effect commits, but its body
// stays unread. Aborting loses the body, never the effect in this ledger.
async function wire(t) {
  const held = [], live = new Set(['old']), revoked = [], consumed = [];
  let store = 'A', serial = 0;
  const server = createServer(async (req, res) => {
    let encoded = ''; for await (const chunk of req) encoded += chunk;
    const path = new URL(req.url, 'http://wire.test').pathname;
    const json = path === '/assets' ? {} : JSON.parse(encoded || '{}');
    const token = req.headers.authorization?.slice(7);
    if (path === '/auth/logout') { live.delete(token); revoked.push(token); res.end('{}'); return; }
    if (path === '/probe') { res.end(JSON.stringify({ ok: live.has(token), store_id: store, seq: 10 })); return; }
    if (path.startsWith('/q/')) { res.end(JSON.stringify({ data: [], store_id: store, seq: 10 })); return; }
    let body;
    if (['/auth/login', '/auth/guest'].includes(path)) {
      const next = session('minted-' + ++serial); live.add(next.token); body = { session: next };
    } else if (path === '/assets') body = { asset: { id: 'unplaced', type: 'image/png', bytes: 1 } };
    else body = { state: path.startsWith('/m/') ? 'sent' : 'done', id: json.id, result: 'charged', store_id: store, seq: 11 };
    const entry = { path, body, res, released: false, aborted: false };
    res.on('close', () => { if (!entry.released) entry.aborted = true; });
    held.push(entry); res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const release = () => { for (const entry of held) if (!entry.released) { entry.released = true; entry.res.end(JSON.stringify(entry.body)); } };
  t.after(async () => { release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const fetcher = async (input, init) => {
    const response = await fetch(input, init), read = response.json.bind(response);
    response.json = async () => { const body = await read(); consumed.push(new URL(input).pathname); return body; };
    return response;
  };
  return { url, fetch: fetcher, held, live, revoked, consumed, release, replace() { store = 'B'; } };
}

for (const ending of ['sign-out', 'replacement', 'close']) test(`effectful mutation, action and upload finish after ${ending} cancels their callers`, async t => {
  const w = await wire(t), client = createClient({ url: w.url, session: session('old'), fetch: w.fetch });
  t.after(() => client.close()); await client.query(q, {});
  const upload = client.upload(new Uint8Array([1])), mutation = client.mutate(m, {}), action = client.act(a, {});
  await until(() => w.held.length === 3);
  if (ending === 'replacement') { w.replace(); assert.equal((await client.query(q, {})).denied.code, 'E_STORE_REPLACED'); }
  else await promptly(ending === 'sign-out' ? client.signOut() : client.close());
  const code = ending === 'replacement' ? 'E_STORE_REPLACED' : 'E_CLOSED';
  assert.equal((await promptly(upload)).why?.code, code);
  const written = await promptly(mutation), acted = await promptly(action);
  if (ending === 'replacement') {
    assert.equal(written.why?.code, code); assert.equal(acted.denied?.code, code);
  } else {
    assert.equal(written.state, 'pending'); assert.equal(acted.state, 'pending');
    assert.ok(written.id && acted.id, 'unknown effects keep their retry ids');
  }
  await delay(20); assert.ok(w.held.every(entry => !entry.aborted), 'caller cancellation must not abort a committed effect');
  w.release(); await until(() => ['/assets', '/m/charge', '/a/charge'].every(path => w.consumed.includes(path)));
  assert.equal(w.held.length, 3, 'no effect is retried or uploaded asset placed after cancellation');
});

for (const op of ['login', 'guest']) for (const ending of ['logout', 'close', 'replacement']) test(`a committed ${op} bearer is kept or revoked across ${ending}`, async t => {
  const w = await wire(t), sessionStore = memorySessionStore(); await keepSession(w.url, session('old'), sessionStore);
  const app = createApp({ url: w.url, sessionStore, fetch: w.fetch });
  t.after(() => app.close()); await app.ready; const prior = app.client; await prior.query(q, {});
  const opening = op === 'login' ? app.auth.login('alice@example.com', 'password') : app.auth.guest();
  await until(() => w.held.length === 1); const next = w.held[0].body.session.token;
  if (ending === 'replacement') { w.replace(); assert.equal((await prior.query(q, {})).denied.code, 'E_STORE_REPLACED'); }
  else {
    await promptly(ending === 'logout' ? app.auth.logout() : app.close());
    assert.equal((await promptly(opening)).ok, false);
  }
  await delay(20); assert.equal(w.held[0].aborted, false);
  w.release();
  if (ending === 'replacement') {
    assert.equal((await promptly(opening)).ok, true);
    assert.equal((await restoreSession(w.url, sessionStore)).token, next);
    assert.equal(app.client.session().token, next); assert.notEqual(app.client, prior);
  } else {
    await until(() => w.revoked.includes(next)); assert.equal(w.live.has(next), false);
    assert.notEqual((await restoreSession(w.url, sessionStore))?.token, next);
  }
});

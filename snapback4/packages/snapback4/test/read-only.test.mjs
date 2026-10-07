// @ref LLP 3000.033#3 — scope verification, custody, offline device admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/client.js';
import { createApp } from '../dist/app.js';
import { createLocalClient } from '../dist/local.js';
import { login, signup, guest, refreshSession, narrowSession, restoreSession, sessionKey } from '../dist/auth.js';
import { verifyReadClient } from '../dist/read-only.js';
import { storeKey } from '../dist/app-storage.js';
import { waitFor } from './helpers/wait.mjs';
const url = 'https://read.invalid', query = { kind: 'query', name: 'history' };
const full = () => ({ principal: 'bob', kind: 'member', token: 'full', expiresAt: Date.now() + 3600_000 });
const read = () => { const s = { ...full(), token: 'ro.reader', scope: 'read' }; return { ...s, capExpiresAt: s.expiresAt }; };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const probe = scope => Response.json({ ok: true, scope, viewer: 'bob', store_id: 'store', seq: 0 });
const answer = () => Response.json({ data: [], complete: true, next: null, seq: 0, store_id: 'store', tables: ['messages'], delivery: [{ table: 'messages', mutation: 'delivered', args: ['group', 'from', 'through'], fingerprint: 'x', rows: [['c', 1]] }] });
function alphabetStore(initial = []) {
  const values = new Map(initial), writes = [], check = k => assert.match(k, /^[A-Za-z0-9._-]+$/);
  return { values, writes, async get(k) { check(k); return values.get(k) ?? null; }, async set(k, v) { check(k); writes.push(k); values.set(k, v); }, async delete(k) { check(k); writes.push(k); values.delete(k); } };
}
test('held probe gates near-expiry startup, query, observe, asset, refresh and exported sources', async t => {
  const held = deferred(), requests = [];
  const client = createClient({ url, session: { ...full(), scope: 'read' }, readOnly: true, fetch: async input => {
    requests.push(new URL(input).pathname + new URL(input).search); await held.promise; return probe('full');
  } });
  t.after(() => client.close());
  const pending = client.query(query, {}), asset = client.asset('once'), refresh = client.refreshSession();
  const stop = client.observe(query, {}).subscribe(() => {}); t.after(stop);
  await delay(30);
  assert.deepEqual(requests, ['/probe?scope=1']);
  assert.deepEqual(client.assetSource('once'), { uri: '', headers: {} });
  held.resolve();
  assert.equal((await pending).denied.code, 'E_READ_ONLY_CREDENTIAL');
  assert.equal((await asset).denied.code, 'E_READ_ONLY_CREDENTIAL');
  assert.equal((await refresh).why.code, 'E_READ_ONLY_REFRESH');
  await client.signOut();
  assert.deepEqual(requests, ['/probe?scope=1'], 'failed validation cannot rotate or log out the full bearer');
});
for (const scope of [undefined, 'full']) test(`scope ${scope ?? 'unsupported'} refuses forged Session.scope`, async t => {
  const client = createClient({ url, session: { ...full(), scope: 'read' }, readOnly: true, fetch: async () => probe(scope) });
  t.after(() => client.close());
  assert.equal((await client.query(query, {})).denied.code, scope ? 'E_READ_ONLY_CREDENTIAL' : 'E_READ_ONLY_UNSUPPORTED');
});
test('local write refusals, no manifest acceptance and no at-cap automatic rotation', async t => {
  const requests = [], client = createClient({ url, session: read(), readOnly: true, fetch: async input => {
    const path = new URL(input).pathname; requests.push(path); return path === '/probe' ? probe('read') : answer();
  } });
  t.after(() => client.close());
  for (const kind of ['mutation', 'ephemeral']) assert.equal((await client.mutate({ kind, name: 'write' }, {})).why.code, 'E_READ_ONLY');
  assert.equal((await client.act({ kind: 'action', name: 'notify' }, {})).why.code, 'E_READ_ONLY');
  assert.equal((await client.upload(new Uint8Array([1]))).why.code, 'E_READ_ONLY');
  assert.equal((await client.logoutAll()).why.code, 'E_READ_ONLY');
  assert.ok('data' in await client.query(query, {})); await delay(350);
  assert.deepEqual(requests, ['/probe', '/q/history']);
  assert.equal(client.assetSource('photo').headers.authorization, 'Bearer ro.reader');
});
test('explicit refresh leaves the verified bearer and asset source unchanged', async t => {
  const requests = [], session = read();
  const client = createClient({ url, session, readOnly: true, fetch: async input => {
    requests.push(new URL(input).pathname); return probe('read');
  } });
  t.after(() => client.close());
  assert.equal(await verifyReadClient(client), undefined);
  const before = client.assetSource('photo');
  const result = await client.refreshSession();
  assert.equal(result.why.code, 'E_READ_ONLY_REFRESH');
  assert.match(result.why.message, /sign in again.*narrow/);
  assert.equal(client.session().token, session.token);
  assert.deepEqual(client.assetSource('photo'), before);
  assert.deepEqual(requests, ['/probe']);
  assert.equal((await refreshSession(url, session.token, async () => { throw Error('must not send'); })).why.code, 'E_READ_ONLY_REFRESH');
});
test('successful custody is SecureStore-legal and cannot consume the interactive journal', async t => {
  const session = read(), interactive = JSON.stringify(full()), journal = '{"pending":[{"id":"kept","op":"send","args":{}}]}';
  const writeKey = storeKey('writes', url, 'bob'), requests = [];
  const store = alphabetStore([[sessionKey(url), interactive], [sessionKey(url, true), JSON.stringify(session)], [writeKey, journal]]);
  const get = store.get;
  store.get = async key => {
    assert.ok(key.startsWith(sessionKey(url, true)), `read custody accessed interactive storage: ${key}`);
    return get(key);
  };
  const app = createApp({ url, readOnly: true, sessionStore: store, fetch: async input => {
    const path = new URL(input).pathname; requests.push(path);
    return path === '/probe' ? probe('read') : path === '/auth/refresh' ? Response.json({ session: { ...session, token: 'ro.next' } }) : answer();
  } });
  t.after(() => app.close());
  assert.equal((await app.ready).ok, true);
  assert.equal((await app.client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
  assert.ok('data' in await app.client.query(query, {})); await app.close();
  assert.equal(store.values.get(sessionKey(url)), interactive); assert.equal(store.values.get(writeKey), journal);
  assert.equal(JSON.parse(store.values.get(sessionKey(url, true))).token, session.token);
  assert.ok(store.writes.every(k => k.startsWith(sessionKey(url, true))));
  assert.ok(!requests.some(p => p.startsWith('/m/') || p.includes('logout') || p === '/auth/refresh'));
});
test('failed app startup preserves full credentials without retirement', async t => {
  const interactive = JSON.stringify(full()), requests = [], store = alphabetStore([[sessionKey(url), interactive], [sessionKey(url, true), interactive]]);
  const app = createApp({ url, readOnly: true, sessionStore: store, fetch: async input => { requests.push(new URL(input).pathname); return probe('full'); } });
  t.after(() => app.close());
  assert.equal((await app.ready).why.code, 'E_READ_ONLY_CREDENTIAL'); await app.close();
  assert.equal(store.values.get(sessionKey(url)), interactive); assert.deepEqual(requests, ['/probe']);
});
for (const scope of [undefined, 'full', 'forged']) test(`offline device admission rejects token with scope ${scope}`, async () => {
  let network = 0, opened = 0;
  const session = { ...read(), scope }, device = { async open() { opened++; throw Error('unexpected open'); } };
  const fetcher = async () => { network++; throw Error('offline'); };
  await assert.rejects(createLocalClient({ url, session, device, fetch: fetcher }), /E_READ_ONLY_DEVICE/);
  const store = alphabetStore([[sessionKey(url), JSON.stringify(session)]]);
  await assert.rejects(createLocalClient({ url, sessionStore: store, device, fetch: fetcher }), /E_READ_ONLY_DEVICE/);
  const app = createApp({ url, sessionStore: store, device, fetch: fetcher });
  assert.equal((await app.ready).why.code, 'E_READ_ONLY_DEVICE'); await app.close();
  assert.equal(network, 0); assert.equal(opened, 0); assert.deepEqual(store.writes, []);
});
test('legacy preservation, synchronous option validation and scoped auth helpers', async () => {
  const session = full(), store = alphabetStore([[sessionKey(url), JSON.stringify(session)]]);
  assert.deepEqual(await restoreSession(url, store), session); assert.deepEqual(store.writes, []);
  assert.throws(() => createApp({ url, readOnly: true, device: {} }), /E_READ_ONLY_DEVICE/);
  assert.throws(() => createClient({ url, readOnly: true, persona: 'bob' }), /E_READ_ONLY_CREDENTIAL/);
  const requests = [], fetcher = async (input, init) => { requests.push([new URL(input).pathname, init]); return Response.json({ session: read() }); };
  for (const result of [await login(url, 'bob@example.test', 'password', { scope: 'read' }, fetcher), await signup(url, 'bob@example.test', 'password', { scope: 'read' }, fetcher), await guest(url, { scope: 'read' }, fetcher)]) assert.equal(result.ok, true);
  assert.ok(requests.every(([, init]) => JSON.parse(init.body).scope === 'read'));
  assert.equal((await narrowSession(url, full(), fetcher)).ok, true);
  assert.equal(requests.at(-1)[0], '/auth/narrow'); assert.equal(requests.at(-1)[1].headers.authorization, 'Bearer full');
});

test('useSeen throws during an active render before observation; inactive rendering is legal', async () => {
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { SnapbackProvider, useSeen } = await import('../dist/react.js');
  let observed = 0, writes = 0;
  const client = { readOnly: true, observe() { observed++; throw Error('unexpected observation'); }, mutate() { writes++; } };
  const family = { member: query, scopeArgument: 'conversation', mapping: { floor:'joinedOrdinal', seen:'seenOrdinal' } };
  function Seen({active}) { useSeen(family, {scope:'chat', through:7, active}); return null; }
  const render = active => renderToString(createElement(SnapbackProvider,{client},createElement(Seen,{active})));
  assert.throws(()=>render(true),/E_READ_ONLY/); assert.equal(observed,0);
  assert.equal(render(false),''); assert.equal(writes,0);
});

for (const cap of [undefined, 0, 86400_000]) test(`read session expires without renewal (cap offset ${cap})`, async t=>{
  const requests=[],session={...read(),expiresAt:Date.now()+100};
  if(cap !== undefined)session.capExpiresAt=session.expiresAt+cap;else delete session.capExpiresAt;
  const client=createClient({url,session,readOnly:true,fetch:async input=>{requests.push(new URL(input).pathname);return probe('read');}});t.after(()=>client.close());
  await verifyReadClient(client);
  await waitFor(()=>client.session()===null,'read expiry');
  assert.equal((await client.query(query,{})).denied.code,'E_AUTH');
  assert.deepEqual(requests,['/probe']);
});

for (const readOnly of [true, false]) test(`read bearer never auto-refreshes even below cap; readOnly=${readOnly}`, async t => {
  const first = read(); first.capExpiresAt += 7 * 86400_000;
  const requests = [], client = createClient({ url, session: first, readOnly, fetch: async input => {
    requests.push(new URL(input).pathname); return probe('read');
  } });
  t.after(() => client.close());
  if (readOnly) await verifyReadClient(client);
  await delay(30);
  assert.equal(client.session().token, first.token);
  assert.equal((await client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
  assert.deepEqual(requests, readOnly ? ['/probe'] : []);
});

test('legacy full session restores offline and rejects a read successor before persistence', async t=>{
  const session={...full(),expiresAt:Date.now()+7*86400_000},store=alphabetStore([[sessionKey(url),JSON.stringify(session)]]);let opens=0;
  const backend={generation:1,schema:{tables:{}},programs:[]};
  const client=await createLocalClient({url,sessionStore:store,fetch:async input=>{if(new URL(input).pathname==='/auth/refresh')return Response.json({session:{...session,token:'ro.forged',scope:'full'}});throw Error('offline');},device:{async open(){opens++;return {async close(){},async call({op}){
    if(op==='sync_state')return {ok:{acquired:true,backend_required:false,store_id:null,watermark:0,generation:1,send_revision:0,restore_watermark:0,restore_images_at:0,receipt_outcomes:true,outbox_status:true,adoption_capture:{},pending_ids:[]}};
    if(op==='state')return {ok:{watermark:0,generation:1,native:null}};
    if(op==='backend')return {ok:backend};if(op==='meta')return {ok:null};if(op==='queued')return {ok:[]};return {ok:true};
  }}}}});t.after(()=>client.close());
  assert.equal(opens,1);assert.deepEqual(client.session(),session);assert.equal(store.values.get(sessionKey(url)),JSON.stringify(session));
  const writes=store.writes.length;
  await assert.rejects(client.refreshSession(),/E_READ_ONLY_DEVICE/);
  assert.deepEqual(client.session(),session);assert.equal(store.values.get(sessionKey(url)),JSON.stringify(session));assert.equal(store.writes.length,writes);
});

for(const mode of ['guest','refresh'])test(`device ${mode} refuses a read credential before opening or persisting`,async()=>{
  const requests=[],store=alphabetStore();let opened=0;
  await assert.rejects(createLocalClient({url,sessionStore:store,...(mode==='guest'?{guest:true}:{session:full()}),
    device:{async open(){opened++;throw Error('unexpected open');}},fetch:async input=>{
      requests.push(new URL(input).pathname);return Response.json({session:{...read(),scope:'full'}});
    }}),/E_READ_ONLY_DEVICE/);
  assert.deepEqual(requests,[`/auth/${mode}`]);assert.equal(opened,0);assert.deepEqual(store.writes,[]);
});

for (const method of ['signOut', 'close']) test(`refused read refresh cannot issue a late successor after ${method}`, async () => {
  const requests = [], session = read();
  const client = createClient({ url, session, readOnly: true, fetch: async input => {
    const path = new URL(input).pathname; requests.push(path);
    return path === '/probe' ? probe('read') : Response.json({ ok: true });
  } });
  await verifyReadClient(client);
  const refresh = client.refreshSession();
  await client[method]();
  assert.equal((await refresh).why.code, 'E_READ_ONLY_REFRESH');
  assert.deepEqual(requests, method === 'signOut' ? ['/probe', '/auth/logout'] : ['/probe']);
});

for (const cap of ['missing', 'at expiry', 'later']) test(`crossing the automatic refresh window never rotates a read session (${cap})`, async t => {
  const now = Date.now(), day = 86400_000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const session = { ...read(), expiresAt: now + 3 * day };
  if (cap === 'missing') delete session.capExpiresAt;
  else session.capExpiresAt = session.expiresAt + (cap === 'later' ? day : 0);
  const requests = [], client = createClient({ url, session, readOnly: true, fetch: async input => {
    requests.push(new URL(input).pathname); return probe('read');
  } });
  t.after(() => client.close()); await verifyReadClient(client);
  t.mock.timers.tick(2 * day);
  assert.equal((await client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
  assert.equal(client.session().token, session.token);
  t.mock.timers.tick(day);
  assert.equal(client.session(), null);
  assert.equal((await client.query(query, {})).denied.code, 'E_AUTH');
  assert.deepEqual(requests, ['/probe']);
});

test('retryable scope-probe failures never create a successor or trigger refresh recovery', async t => {
  const requests = [], session = read(); let failures = 3;
  const client = createClient({ url, session, readOnly: true, fetch: async input => {
    requests.push(new URL(input).pathname);
    return failures-- > 0 ? Response.json({ denied: { code: 'E_RATE_LIMIT', family: 'capacity', message: 'busy', retryable: true } }, { status: 503 }) : probe('read');
  } });
  t.after(() => client.close());
  for (let i = 0; i < 3; i++) {
    assert.equal((await verifyReadClient(client)).retryable, true);
    assert.equal((await client.refreshSession()).why.code, 'E_READ_ONLY_REFRESH');
    assert.equal(client.session().token, session.token);
    assert.deepEqual(client.assetSource('photo'), { uri: '', headers: {} });
  }
  assert.equal(await verifyReadClient(client), undefined);
  assert.equal(client.assetSource('photo').headers.authorization, `Bearer ${session.token}`);
  assert.deepEqual(requests, ['/probe', '/probe', '/probe', '/probe']);
});

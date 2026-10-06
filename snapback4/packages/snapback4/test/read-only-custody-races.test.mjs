// @ref LLP 3000.033#3 — Round 2 blind-review reproductions and alternate interleavings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../dist/app.js';
import { sessionKey } from '../dist/auth.js';
import { waitFor as until } from './helpers/wait.mjs';
const url='https://review-ro.invalid', key=sessionKey(url,true), query={kind:'query',name:'secret'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const session = (who, token = `ro.${who}`) => {
  const expiresAt = Date.now() + 86400000;
  return { token, principal: who, kind: 'user', scope: 'read', expiresAt, capExpiresAt: expiresAt };
};
const storage=(initial)=>{const values=new Map([[key,JSON.stringify(initial)]]);return {values,async get(k){return values.get(k)??null},async set(k,v){values.set(k,v)},async delete(k){values.delete(k)}}};
const base=async(input,init)=>{const path=new URL(input).pathname, token=init?.headers?.authorization?.slice(7),who=['ro.old','ro.next'].includes(token)?'bob':token?.slice(3);
 if(path==='/auth/login') return Response.json({session:session(JSON.parse(init.body).email.split('@')[0])});
 if(path==='/probe') return Response.json({ok:true,scope:'read',viewer:who,store_id:'test',seq:0});
 if(path==='/q/secret') return Response.json({data:`${who}-secret`,complete:true,seq:0,store_id:'test'});
 if(path==='/changes') return new Promise((resolve,reject)=>{const abort=()=>reject(Error('aborted'));if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});});
 return Response.json({ok:true});};
for(const trigger of ['logout','peer switch','close','replacement']) test(`fence notifies a subscribed rendered value on ${trigger}`,async t=>{
 const store=storage(session('bob')), app=createApp({url,readOnly:true,sessionStore:store,fetch:base});t.after(()=>app.close());await app.ready;
 const old=app.client, watch=old.observe(query,{});let rendered=watch.getSnapshot(), notices=0;
 const stop=watch.subscribe(()=>{rendered=watch.getSnapshot();notices++});t.after(()=>{stop();watch.close()});
 await until(()=>rendered.data==='bob-secret');const before=notices;const authAtWithdrawal=[];const authStop=watch.subscribe(()=>{if(!('data' in watch.getSnapshot()))authAtWithdrawal.push(app.auth.state)});t.after(authStop);
 if(trigger==='logout')await app.auth.logout();
 if(trigger==='replacement')assert.equal((await app.auth.login('alice@example.test','password')).ok,true);
 if(trigger==='close')await app.close();
 if(trigger==='peer switch') {const peer=createApp({url,readOnly:true,sessionStore:store,fetch:base});t.after(()=>peer.close());await peer.ready;assert.equal((await peer.auth.login('alice@example.test','password')).ok,true);assert.equal((await old.query(query,{})).denied.code,'E_AUTH');}
 assert.ok(notices>before,'withdrawal must notify the subscriber');assert.ok(authAtWithdrawal.length);assert.ok(authAtWithdrawal.every(state=>state!=='signed-in'),'auth publishes before withdrawal callbacks');
 assert.equal('data' in rendered,false,'a subscribed consumer must withdraw the previous principal without unrelated renders');
});
for(const scenario of ['logout during successor persistence','peer switch during successor probe','repeated successor probe failures'])test(scenario,{timeout:5000},async t=>{
 const store=storage(session('bob','ro.old')), entered=deferred(),release=deferred();t.after(()=>release.resolve());let live='ro.old',failures=3,writes=0;
 const orig=store.set;store.set=async(...args)=>{writes++;if(scenario==='logout during successor persistence'&&args[0]===key&&JSON.parse(args[1]).token==='ro.next'){entered.resolve();await release.promise}await orig(...args)};
 const transport=async(input,init)=>{const path=new URL(input).pathname,token=init.headers.authorization.slice(7);
  if(path==='/auth/refresh'){live='ro.next';return Response.json({session:session('bob',live)})}
  if(path==='/probe'&&token==='ro.next'){
   if(scenario==='peer switch during successor probe'){entered.resolve();await release.promise;}
   if(scenario==='repeated successor probe failures'&&failures-->0)throw Error('outage');
   return Response.json({ok:true,scope:'read',viewer:'bob',store_id:'test',seq:0});
  }
  return base(input,init);
 };
 const app=createApp({url,readOnly:true,sessionStore:store,fetch:transport});t.after(()=>app.close());await app.ready;
 const old=app.client;const rotation=old.refreshSession();
 if(scenario==='logout during successor persistence'){await entered.promise;const logout=app.auth.logout();release.resolve();await logout;await rotation;assert.equal(JSON.parse(store.values.get(key)??'null')?.token,undefined);assert.equal(app.auth.state,'signed-out')}
 if(scenario==='peer switch during successor probe'){await entered.promise;const peer=createApp({url,readOnly:true,sessionStore:store,fetch:base});t.after(()=>peer.close());await peer.ready;await peer.auth.login('alice@example.test','password');release.resolve();await rotation;assert.equal(JSON.parse(store.values.get(key)).principal,'alice');await until(()=>app.auth.state==='signed-out');assert.deepEqual(old.assetSource('secret'),{uri:'',headers:{}})}
 if(scenario==='repeated successor probe failures'){assert.equal((await rotation).ok,false);for(let i=0;i<2;i++){assert.ok('denied' in await old.query(query,{}));assert.equal(old.session(),null);assert.deepEqual(old.assetSource('secret'),{uri:'',headers:{}})}assert.ok('data' in await old.query(query,{}));assert.equal(JSON.parse(store.values.get(key)).token,'ro.next');assert.equal(writes,2)}
});

test('two read apps rotating one saved token retain the successful successor',{timeout:5000},async t=>{
 const store=storage(session('bob','ro.old')),entered=deferred(),release=deferred();t.after(()=>release.resolve());let rotations=0,live='ro.old',probes=0;const peerProbe=deferred();
 const transport=async(input,init)=>{const path=new URL(input).pathname,token=init.headers.authorization.slice(7);
  if(path==='/auth/refresh'){
   if(rotations++===0){live='ro.next';return Response.json({session:session('bob',live)})}
   return Response.json({denied:{code:'E_AUTH',family:'auth',message:'consumed predecessor'}},{status:401});
  }
  if(path==='/probe'&&token==='ro.next'){if(++probes===2)peerProbe.resolve();entered.resolve();await release.promise;return Response.json({ok:true,scope:'read',viewer:'bob',store_id:'test',seq:0})}
  return base(input,init);
 };
 const a=createApp({url,readOnly:true,sessionStore:store,fetch:transport}),b=createApp({url,readOnly:true,sessionStore:store,fetch:transport});t.after(()=>Promise.all([a.close(),b.close()]));await Promise.all([a.ready,b.ready]);
 const first=a.client.refreshSession();await entered.promise;const second=b.client.refreshSession();await peerProbe.promise;release.resolve();const [result,peer]=await Promise.all([first,second]);assert.equal(result.ok,true);assert.equal(peer.ok,true);assert.equal(rotations,1);

 assert.equal(JSON.parse(store.values.get(key)??'null')?.token,'ro.next');
});

test('a peer logout fences a login already waiting for its response',{timeout:5000},async t=>{
 const store=storage(session('bob')),entered=deferred(),release=deferred();t.after(()=>release.resolve());
 const transport=async(input,init)=>{if(new URL(input).pathname==='/auth/login'){entered.resolve();await release.promise;return Response.json({session:session('bob','ro.newlogin')})}return base(input,init)};
 const a=createApp({url,readOnly:true,sessionStore:store,fetch:base}),b=createApp({url,readOnly:true,sessionStore:store,fetch:transport});t.after(()=>Promise.all([a.close(),b.close()]));await Promise.all([a.ready,b.ready]);
 const signin=b.auth.login('bob@example.test','password');await entered.promise;await a.auth.logout();assert.equal(JSON.parse(store.values.get(key)??'null')?.token,undefined);release.resolve();const result=await signin;
 assert.equal(result.ok,false);
 assert.equal(JSON.parse(store.values.get(key)??'null')?.token,undefined,'a login begun before the shared logout must not restore custody');
});

for(const method of ['signOut','close'])test(`a fenced handle cannot ${method} a replacement account`,{timeout:5000},async t=>{
 const store=storage(session('bob')),requests=[];
 const app=createApp({url,readOnly:true,sessionStore:store,fetch:async(input,init)=>{requests.push([new URL(input).pathname,init?.headers?.authorization]);return base(input,init)}});t.after(()=>app.close());await app.ready;
 const old=app.client;assert.equal((await app.auth.login('alice@example.test','password')).ok,true);const current=app.client;assert.notEqual(old,current);
 assert.equal((await old.query(query,{})).denied.code,'E_AUTH');await old[method]();
 const read=await current.query(query,{});
 assert.equal(app.auth.state,'signed-in');assert.equal(JSON.parse(store.values.get(key)).principal,'alice');assert.ok(!requests.some(([p,bearer])=>p==='/auth/logout'&&bearer==='Bearer ro.alice'));
 assert.equal(read.data,'alice-secret','retired handle has no authority to end the replacement');
});

for (const mode of ['login', 'guest']) test(`peer logout while ${mode} credential verification is held`, async t => {
  const store = storage(session('bob')), entered = deferred(), release = deferred();
  const transport = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === `/auth/${mode}`) return Response.json({ session: session('alice', 'ro.opening') });
    if (path === '/probe' && new Headers(init?.headers).get('authorization') === 'Bearer ro.opening') {
      entered.resolve(); await release.promise;
      return Response.json({ ok: true, scope: 'read', viewer: 'alice', store_id: 'test', seq: 0 });
    }
    return base(input, init);
  };
  const a = createApp({ url, readOnly: true, sessionStore: store, fetch: base });
  const b = createApp({ url, readOnly: true, sessionStore: store, fetch: transport });
  t.after(async () => { release.resolve(); await Promise.all([a.close(), b.close()]); });
  await Promise.all([a.ready, b.ready]);
  const opening = mode === 'guest' ? b.auth.guest() : b.auth.login('alice@example.test', 'password');
  await entered.promise; assert.equal((await a.auth.logout()).ok, true);
  release.resolve(); assert.equal((await opening).ok, false);
  const restarted = createApp({ url, readOnly: true, sessionStore: store, fetch: base });
  t.after(() => restarted.close()); await restarted.ready;
  assert.equal(restarted.auth.state, 'signed-out');
  assert.equal(JSON.parse(store.values.get(key))?.token, undefined);
});

for (const method of ['signOut', 'close']) test(`old ${method} during replacement verification cannot cancel the opener`, async t => {
  const store = storage(session('bob')), entered = deferred(), release = deferred();
  const requests = [];
  const app = createApp({ url, readOnly: true, sessionStore: store, fetch: async (input, init) => {
    const path = new URL(input).pathname, token = new Headers(init?.headers).get('authorization');
    requests.push([path, token]);
    if (path === '/probe' && token === 'Bearer ro.alice') { entered.resolve(); await release.promise; }
    return base(input, init);
  } });
  t.after(async () => { release.resolve(); await app.close(); }); await app.ready;
  const old = app.client, opening = app.auth.login('alice@example.test', 'password');
  await entered.promise; await old[method](); release.resolve();
  assert.equal((await opening).ok, true);
  assert.equal((await app.client.query(query, {})).data, 'alice-secret');
  assert.ok(!requests.some(([path, token]) => path === '/auth/logout' && token === 'Bearer ro.alice'));
});

for (const held of ['response', 'persistence']) test(`peer refresh waits through held successor ${held}`, async t => {
  const store = storage(session('bob', 'ro.old')), entered = deferred(), release = deferred();
  let rotations = 0;
  const originalSet = store.set;
  store.set = async (key, bytes) => {
    if (held === 'persistence' && JSON.parse(bytes).token === 'ro.next') { entered.resolve(); await release.promise; }
    await originalSet(key, bytes);
  };
  const transport = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/auth/refresh') {
      rotations++;
      if (held === 'response') { entered.resolve(); await release.promise; }
      return rotations === 1 ? Response.json({ session: session('bob', 'ro.next') })
        : Response.json({ denied: { code: 'E_AUTH', family: 'auth', message: 'consumed' } }, { status: 401 });
    }
    return base(input, init);
  };
  const a = createApp({ url, readOnly: true, sessionStore: store, fetch: transport });
  const b = createApp({ url, readOnly: true, sessionStore: store, fetch: transport });
  t.after(async () => { release.resolve(); await Promise.all([a.close(), b.close()]); });
  await Promise.all([a.ready, b.ready]);
  const first = a.client.refreshSession(); await entered.promise;
  const second = b.client.refreshSession(); await delay(10); release.resolve();
  assert.equal((await first).ok, true); await second;
  assert.equal(rotations, 1); assert.equal(JSON.parse(store.values.get(key)).token, 'ro.next');
  assert.equal((await a.client.query(query, {})).data, 'bob-secret');
});

test('a peer recovers a successor after the first app repeatedly fails verification and closes', async t => {
  const store = storage(session('bob', 'ro.old'));
  let rotations = 0;
  const transport = async (input, init) => {
    if (new URL(input).pathname === '/auth/refresh') { rotations++; return Response.json({ session: session('bob', 'ro.next') }); }
    return base(input, init);
  };
  const a = createApp({ url, readOnly: true, sessionStore: store, fetch: async (input, init) => {
    if (new URL(input).pathname === '/probe' && new Headers(init?.headers).get('authorization') === 'Bearer ro.next') throw Error('offline');
    return transport(input, init);
  } });
  t.after(() => a.close()); await a.ready;
  assert.equal((await a.client.refreshSession()).ok, false);
  assert.ok('denied' in await a.client.query(query, {}));
  assert.equal(a.client.session(), null); assert.deepEqual(a.client.assetSource('secret'), { uri: '', headers: {} });
  await a.close();
  const b = createApp({ url, readOnly: true, sessionStore: store, fetch: transport });
  t.after(() => b.close()); assert.equal((await b.ready).ok, true);
  assert.equal((await b.client.query(query, {})).data, 'bob-secret');
  assert.equal(JSON.parse(store.values.get(key)).token, 'ro.next'); assert.equal(rotations, 1);
});

test('retirement rechecks custody after its held verification probe', async t => {
  const store = storage(session('bob')), entered = deferred(), release = deferred();
  let hold = false;
  const logouts = [];
  const app = createApp({ url, readOnly: true, sessionStore: store, fetch: async (input, init) => {
    const path = new URL(input).pathname, token = new Headers(init?.headers).get('authorization');
    if (hold && path === '/probe' && token === 'Bearer ro.bob') { entered.resolve(); await release.promise; }
    if (path === '/auth/logout') logouts.push(token);
    return base(input, init);
  } });
  t.after(async () => { release.resolve(); await app.close(); }); await app.ready;
  hold = true;
  assert.equal((await app.auth.login('alice@example.test', 'password')).ok, true);
  await entered.promise;
  // A peer restores this credential while retirement is verifying its scope.
  await store.set(key, JSON.stringify(session('bob')));
  release.resolve();
  await app.close();
  await delay(20);
  assert.ok(!logouts.includes('Bearer ro.bob'), 'a probe is not the retirement dispatch linearization point');
  assert.equal(JSON.parse(store.values.get(key)).token, 'ro.bob');
});

import { after as teardownAfter } from "./helpers/teardown.mjs";
import { hangBudget } from './helpers/wait.mjs';
// Real Chromium navigation: admission is asserted in the click's own stack,
// then a new document recovers the original ID through IndexedDB and /m.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { launch, root, binary } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';
const source = `use identity

table members:
  room: text <=40
  principal: principal
  admin: bool
  unique room, principal
  read <- exists members[.room, viewer]
  delete <- exists members[.room, viewer, admin = true]
  sync to members[.room]

table removals:
  total: int
  public 'Non-idempotent audit for navigation tests.'
  update <- allow
  online only

mutation removeMember(room: text <=40, principal: principal):
  require exists members[room, viewer, admin = true] else NOT_ADMIN
  delete members[room, principal]
  audit = removals['audit'] ! else NOT_FOUND
  update removals[audit] { total: audit.total + 1 }

query roster(room: text <=40):
  return members where .room = room first 50
query total():
  return removals['audit'].total
`;
const require = createRequire(join(root, 'apps/chat/package.json'));

test('progressive worker rollback persists through restore retry and close drain before refill/reopen', {timeout:hangBudget(20)}, async t=>{
  const witness=await launch({memory:true,entrySource:`
import { createLocalClient } from '${join(root,'packages/snapback4/src/local.ts')}';
import { localStatus } from '${join(root,'packages/snapback4/src/app.ts')}';
import { deviceRestore } from '${join(root,'packages/snapback4/src/device-restore.ts')}';
Object.assign(window,{createLocalClient,localStatus,deviceRestore});
`});
  t.after(()=>witness.close());
  const results=await witness.page.evaluate(async()=>{
    const results=[];
    for(const retry of ['transaction','close']) {
      const url=`https://rollback-${retry}.invalid`, inner=webDevice({worker:true});
      const backend={generation:1,store_id:'restore-store',schema:{tables:{}},programs:[{name:'read',kind:'Query',args:{},body:[{Return:{Literal:{String:'local'}}}]}]};
      let head=20, fail=false, attempts=0, blockCalls=false, evidence, hostCore;
      const fetch=async(input,init)=>{
        const path=new URL(input).pathname;
        if(path==='/schema')return Response.json(backend);
        if(path==='/probe')return Response.json({ok:true,store_id:backend.store_id,seq:head,generation:1});
        if(path==='/changes')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
        if(path==='/sync')return Response.json({generation:1,store_id:backend.store_id,snapshot:!JSON.parse(init.body).stream,watermark:head,images_at:head,events:[],committed_above:{},more:false});
        if(path.startsWith('/m/'))throw Error('a refused device attempted pending-write replay');
        return Response.json({data:'server',complete:true,tables:[],seq:head,store_id:backend.store_id,generation:1});
      };
      const device={custody:()=>Promise.resolve('none'),async open(...args){
        const core=hostCore=await inner.open(...args);
        return {...core,call:(...args)=>blockCalls?Promise.resolve({denied:{code:'E_STORE_RESTORE',family:'store',message:'fenced'}}):core.call(...args),
          [deviceRestore](proof,validated){evidence=proof;return core[deviceRestore](proof,validated);}};
      }};
      const post=Worker.prototype.postMessage;
      Worker.prototype.postMessage=function(message,...rest){
        if(message.action==='invoke'&&message.request?.op==='observe_store'&&message.request.page?.captured_restore_watermark===30){
          attempts++; if(fail){fail=false;throw Error('injected restore persistence failure');}
        }
        return post.call(this,message,...rest);
      };
      let client,reopened;
      try {
        client=await createLocalClient({url,persona:'alice',startup:'progressive',device,fetch});
        await client.query({kind:'query',name:'online'},{});
        for(let n=0;!client.acquired&&n<1000;n++)await new Promise(resolve=>setTimeout(resolve,5));
        if(!client.acquired)throw Error('worker acquisition timed out');
        head=30;await client.query({kind:'query',name:'online'},{});
        head=25;fail=true;await client.sync().catch(error=>{if(!String(error).includes('injected restore persistence failure'))throw error;});
        const immediate=await client.query({kind:'query',name:'read'},{});
        const failedAttempts=attempts;
        // Deny ordinary cleanup calls so only the host close drain can retry.
        if(retry==='close')blockCalls=true;
        else await hostCore.call({op:'sync_state',capture:false});
        const beforeClose=attempts;
        await client.close(); head=40;
        reopened=await createLocalClient({url,persona:'alice',device:webDevice({worker:true}),fetch});
        const read=await reopened.query({kind:'query',name:'read'},{});
        results.push({retry,immediate:immediate.denied?.code,read:read.denied?.code,failedAttempts,beforeClose,attempts,
          head:evidence?.head,floor:evidence?.capture.restore_watermark});
      } finally {Worker.prototype.postMessage=post;await client?.close();await reopened?.close();}
    }
    return results;
  });
  for(const result of results){
    assert.equal(result.immediate,'E_STORE_RESTORE',JSON.stringify(result));
    assert.equal(result.read,'E_STORE_RESTORE',JSON.stringify(result));
    assert.equal(result.failedAttempts,1,JSON.stringify(result));
    assert.equal(result.beforeClose,result.retry==='close'?1:2,JSON.stringify(result));
    assert.equal(result.attempts,2,JSON.stringify(result));
    assert.equal(result.head,25);assert.equal(result.floor,30);
  }
});

test('progressive direct-host rollback persists through the close drain before refill/reopen', {timeout:hangBudget(20)}, async t=>{
  const witness=await launch({memory:true,entrySource:`
import { createLocalClient } from '${join(root,'packages/snapback4/src/local.ts')}';
Object.assign(window,{createLocalClient});
`});
  t.after(()=>witness.close());
  const result=await witness.page.evaluate(async()=>{
    const inner=webDevice();
    const backend={generation:1,store_id:'restore-store',schema:{tables:{}},programs:[{name:'read',kind:'Query',args:{},body:[{Return:{Literal:{String:'local'}}}]}]};
    const results=[];
    for(const failures of [1,2]){
    const url=`https://rollback-direct-${failures}.invalid`;
    let head=20, fail=0, attempts=0;
    const fetch=async(input,init)=>{
      const path=new URL(input).pathname;
      if(path==='/schema')return Response.json(backend);
      if(path==='/probe')return Response.json({ok:true,store_id:backend.store_id,seq:head,generation:1});
      if(path==='/changes')return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
      if(path==='/sync')return Response.json({generation:1,store_id:backend.store_id,snapshot:!JSON.parse(init.body).stream,watermark:head,images_at:head,events:[],committed_above:{},more:false});
      if(path.startsWith('/m/'))throw Error('a refused device attempted pending-write replay');
      return Response.json({data:'server',complete:true,tables:[],seq:head,store_id:backend.store_id,generation:1});
    };
    // A direct host has no restore hook of its own: the client must retain and retry the proof.
    const device={custody:()=>Promise.resolve('none'),async open(...args){
      const core=await inner.open(...args);
      return {...core,call:(request,...rest)=>{
        if(request.op==='observe_store'&&request.page?.captured_restore_watermark===30){attempts++;if(fail>0){fail--;return Promise.reject(Error('injected restore persistence failure'));}}
        return core.call(request,...rest);}};
    }};
    let client,reopened,closeError;
    try {
      client=await createLocalClient({url,persona:'alice',startup:'progressive',device,fetch});
      await client.query({kind:'query',name:'online'},{});
      for(let n=0;!client.acquired&&n<1000;n++)await new Promise(resolve=>setTimeout(resolve,5));
      if(!client.acquired)throw Error('direct acquisition timed out');
      head=30;await client.query({kind:'query',name:'online'},{});
      head=25;fail=failures;await client.sync().catch(error=>{if(!String(error).includes('injected restore persistence failure'))throw error;});
      const immediate=await client.query({kind:'query',name:'read'},{});
      const failedAttempts=attempts;
      // With two injected failures the close-drain retry fails too: close must reject.
      await client.close().catch(error=>{closeError=String(error);}); head=40;
      reopened=await createLocalClient({url,persona:'alice',device:webDevice(),fetch});
      const read=await reopened.query({kind:'query',name:'read'},{});
      results.push({failures,immediate:immediate.denied?.code,read:read.denied?.code,failedAttempts,attempts,closeError});
    } finally {await client?.close().catch(()=>{});await reopened?.close();}
    }
    return results;
  });
  for(const r of result){
    assert.equal(r.immediate,'E_STORE_RESTORE',JSON.stringify(r));
    assert.equal(r.failedAttempts,1,JSON.stringify(r));
    assert.equal(r.attempts,2,JSON.stringify(r));
    if(r.failures===1){assert.equal(r.read,'E_STORE_RESTORE',JSON.stringify(r));assert.equal(r.closeError,undefined,JSON.stringify(r));}
    else assert.match(r.closeError??'',/injected restore persistence failure/,JSON.stringify(r));
  }
});

test('web startup: immediate admin navigation, synchronous refusals and acquisition hook', { timeout: hangBudget(120) }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-web-start-'));
  const sourceDir = join(project, 'snapback'); mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'schema.q'), source);
  teardownAfter(t, () => rmSync(project, { recursive: true, force: true }));
  const checked = spawnSync(binary(), ['check'], { cwd: project, encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const sourceOverrides = process.env.SNAPBACK4_WEB_START_OLD_GUARD === '1'
    ? { [join(root, 'packages/snapback4/src/app-client.ts')]: execFileSync('git', ['show', 'a52b48cad:snapback4/packages/snapback4/src/app-client.ts'], { cwd: root, encoding: 'utf8' }) } : {};
  if (process.env.SNAPBACK4_WEB_START_AUTHORITY_MUTANT === '1') {
    const path = join(root, 'packages/snapback4/src/web-journal.ts');
    sourceOverrides[path] = readFileSync(path, 'utf8').replace(
      'return storeLock(stamp.key, async () => await sameAdmissionAuthority(stamp, this.authority!, record.entry.viewer) ? admitted() : refused());', 'return admitted();');
  }
  if (process.env.SNAPBACK4_WEB_START_AUTHORITY_MUTANT === 'recovery') {
    const path = join(root, 'packages/snapback4/src/web-journal.ts');
    sourceOverrides[path] = readFileSync(path, 'utf8').replace('await this.authorize(record, async () => {',
      'await (async (_record, admitted) => admitted())(record, async () => {');
  }
  if (process.env.SNAPBACK4_WEB_START_AUTHORITY_MUTANT === 'fence') {
    const path = join(root, 'packages/snapback4/src/app.ts');
    sourceOverrides[path] = readFileSync(path, 'utf8').replace(
      'void authorized().catch(() => {});',
      'fence(scope, new SessionEpochChanged());');
  }
  const witness = await launch({ seed: [], sourceDir, sourceOverrides, entrySource: `
import { createApp } from '${join(root, 'packages/snapback4/src/app.ts')}';
import { keepSession, localStorageSessionStore, sessionKey } from '${join(root, 'packages/snapback4/src/auth.ts')}';
import { mintId, createClient } from '${join(root, 'packages/snapback4/src/client.ts')}';
import { memoryPersistence } from '${join(root, 'packages/snapback4/src/web.ts')}';
import { api } from '${join(sourceDir, 'generated/api.ts')}';
import { AppProvider, useAcquisition, useAcquired, useQuery } from '${join(root, 'packages/snapback4/src/react.tsx')}';
import { createElement as h } from '${require.resolve('react')}';
import { createRoot } from '${require.resolve('react-dom/client')}';
Object.assign(window, { createApp, keepSession, localStorageSessionStore, mintId, createClient, memoryPersistence, api, sessionKey });
window.mountProgress = (app) => {
  const target = document.createElement('div'); document.body.append(target);
  window.progress = [];
  function Status() {
    const value = useAcquisition(), acquired = useAcquired();
    window.progress.push({ ...value, acquiredLegacy: acquired });
    return h('p', { id: 'progress' }, value.acquired ? 'Offline ready' : 'Preparing offline: ' + value.rows);
  }
  createRoot(target).render(h(AppProvider, { app }, h(Status)));
};
` });
  teardownAfter(t, () => witness.close());
  const { page, api } = witness;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const signed = await fetch(api + '/auth/guest', { method: 'POST' }).then(r => r.json());
  assert.ok(signed.session?.principal, 'guest session issued');
  let session = signed.session;
  const seed = [{ table: 'removals', row: { id: 'audit', total: 0 } }];
  for (let room = 0; room < 5; room++) seed.push(
    { table: 'members', row: { id: `a${room}`, room: `room${room}`, principal: session.principal, admin: true } },
    { table: 'members', row: { id: `b${room}`, room: `room${room}`, principal: 'user:other', admin: false } });
  const seeded = await fetch(api + '/seed', { method: 'POST', body: JSON.stringify(seed) }).then(r => r.json());
  assert.equal(seeded.seeded, seed.length, JSON.stringify(seeded));
  const sent = []; page.on('request', request => { if (request.url().endsWith('/m/removeMember')) sent.push(JSON.parse(request.postData())); });
  const prepare = async ({ holdSync = false, holdAdmission = false } = {}) => {
    await page.evaluate(async ({ api, session, holdSync, holdAdmission }) => {
      const storage = localStorageSessionStore();
      await keepSession(api, session, storage);
      const persist = indexedDbPersistence(), save = persist.save;
      persist.save = (name, changes) => holdAdmission && changes.some(c => c.s === 'o') ? new Promise(() => {}) : save(name, changes);
      let release; const gate = new Promise(resolve => release = resolve);
      window.releaseSync = release;
      window.app = createApp({ url: api, sessionStore: storage, device: webDevice({ persist }), waitSeconds: 1,
        fetch: async (url, init) => { if (holdSync && String(url).endsWith('/sync')) await gate; return fetch(url, init); } });
      mountProgress(app);
      if (!holdSync) await app.ready;
    }, { api, session, holdSync, holdAdmission });
  };
  await t.test('createApp and generated api journal before immediate location.assign', async () => {
    await prepare({ holdAdmission: true });
    // Force the old guard's asynchronous epoch check to stay pending until
    // document teardown. The new guard can synchronously validate the stored
    // epoch and journal while another session operation holds this lock.
    await page.evaluate(api => new Promise(resolve => {
      void navigator.locks.request(sessionKey(api), async () => { resolve(); await new Promise(() => {}); });
    }), api);
    await page.evaluate(() => {
      const button = document.createElement('button'); button.textContent = 'Remove member'; document.body.append(button);
      button.onclick = () => {
        const id = mintId();
        app.mutate(api.removeMember, { room: 'room0', principal: 'user:other' }, { id });
        const journal = Object.keys(localStorage).filter(key => key.startsWith('snapback4-admission:')).map(key => JSON.parse(localStorage.getItem(key)));
        sessionStorage.setItem('click', JSON.stringify({ id, journal }));
        location.assign('/?removed=1');
      };
    });
    await page.getByRole('button', { name: 'Remove member', exact: true }).click({ noWaitAfter: true });
    await page.waitForURL('**/?removed=1'); await page.waitForFunction(() => !!window.createApp);
    const click = await page.evaluate(() => JSON.parse(sessionStorage.getItem('click')));
    if (process.env.SNAPBACK4_WEB_START_OLD_GUARD === '1' && click.journal.length === 0) {
      await page.evaluate(async api => {
        window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: webDevice(), waitSeconds: 1 });
        await app.ready;
      }, api);
      const total = await page.evaluate(() => app.client.query(api.total, {}));
      t.diagnostic(JSON.stringify({ oldGuard: true, synchronousJournalRecords: click.journal.length, mutationRequests: sent.length, removalsAfterReopen: total.data }));
      assert.equal(total.data, 1, 'the admin click must recover after navigation');
    }
    assert.equal(click.journal.length, 1); assert.equal(click.journal[0].entry.id, click.id);
    await page.evaluate(async api => {
      window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: webDevice(), waitSeconds: 1 });
      await app.ready;
    }, api);
    await until(() => page.evaluate(async id => (await app.client.write(id))?.state === 'sent', click.id), 'recovered write sent');
    const total = await page.evaluate(() => app.client.query(api.total, {}));
    assert.equal(total.data, 1);
    assert.ok(sent.length > 0); assert.ok(sent.every(write => write.id === click.id));
    await page.evaluate(() => app.close());
  });
  if (process.env.SNAPBACK4_WEB_START_OLD_GUARD === '1') return;
  await t.test('restored identified device journals while its first sync is held', async () => {
    await witness.reload();
    await prepare({ holdSync: true, holdAdmission: true });
    await page.waitForFunction(() => app.auth.state === 'signed-in');
    await page.evaluate(() => {
      const id = mintId();
      app.client.mutate(api.removeMember, { room: 'room2', principal: 'user:other' }, { id });
      const journal = Object.keys(localStorage).filter(key => key.startsWith('snapback4-admission:')).map(key => JSON.parse(localStorage.getItem(key)));
      sessionStorage.setItem('click', JSON.stringify({ id, journal }));
      location.assign('/?removed=2');
    });
    await page.waitForURL('**/?removed=2'); await page.waitForFunction(() => !!window.createApp);
    const click = await page.evaluate(() => JSON.parse(sessionStorage.getItem('click')));
    assert.equal(click.journal.length, 1); assert.equal(click.journal[0].entry.id, click.id);
    await page.evaluate(async api => {
      window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: webDevice(), waitSeconds: 1 });
      await app.ready;
    }, api);
    await until(() => page.evaluate(async id => (await app.client.write(id))?.state === 'sent', click.id), 'recovered write sent');
    assert.equal((await page.evaluate(() => app.client.query(api.total, {}))).data, 2);
    assert.ok(sent.some(write => write.id === click.id));
    await page.evaluate(() => app.close());
  });
  for (const phase of ['restoring', 'no-device', 'no-claim', 'ephemeral-device', 'storage-full']) await t.test(`synchronous refusal: ${phase}`, async () => {
    await witness.reload();
    const result = await page.evaluate(async ({ api, phase, session }) => {
      const storage = localStorageSessionStore(); await keepSession(api, session, storage);
      let release; const gate = new Promise(resolve => release = resolve);
      const persist = phase === 'ephemeral-device' ? memoryPersistence() : indexedDbPersistence();
      if (phase === 'no-claim') persist.claim = async () => null;
      const opener = webDevice({ persist });
      // A genuinely empty device has no durable backend identity.
      const device = { open: (name, backend) => opener.open(name + ':fresh-' + phase, backend) };
      window.app = createApp({ url: api, sessionStore: storage, ...(phase === 'no-device' ? {} : { device }), waitSeconds: 1,
        fetch: async (url, init) => { if (phase === 'before-first-sync' && String(url).endsWith('/sync')) await gate; return fetch(url, init); } });
      if (phase === 'before-first-sync') while (app.auth.state !== 'signed-in') await new Promise(r => setTimeout(r, 5));
      else if (phase !== 'restoring') await app.ready;
      const original = Storage.prototype.setItem;
      if (phase === 'storage-full') Storage.prototype.setItem = function (key, value) { if (key.startsWith('snapback4-admission:')) throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
      const id = mintId(), returned = app.mutate(window.api.removeMember, { room: 'room1', principal: 'user:other' }, { id });
      const immediate = { state: returned.state, code: returned.why?.code, id: returned.id };
      Storage.prototype.setItem = original;
      release();
      const outcome = await returned;
      await app.ready; await app.close();
      return { immediate, outcome, journal: Object.keys(localStorage).filter(key => key.startsWith('snapback4-admission:')).length };
    }, { api, phase, session });
    assert.equal(result.immediate.state, 'failed'); assert.equal(result.immediate.code, 'E_ADMISSION');
    assert.deepEqual(result.immediate, { state: result.outcome.state, code: result.outcome.why.code, id: result.outcome.id });
    assert.equal(result.journal, 0);
  });
  await t.test('repairing storage permits the refused id to be retried', async () => {
    await witness.reload(); await prepare();
    const result = await page.evaluate(async () => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key.startsWith('snapback4-admission:')) throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
      const id = mintId(), args = { room: 'room4', principal: 'user:other' };
      const first = app.client.mutate(api.removeMember, args, { id });
      const immediate = first.state;
      Storage.prototype.setItem = original;
      const retry = await app.client.mutate(api.removeMember, args, { id });
      await app.close();
      return { immediate, refused: (await first).why.code, retry };
    });
    assert.equal(result.immediate, 'failed'); assert.equal(result.refused, 'E_ADMISSION'); assert.equal(result.retry.state, 'sent');
  });
  await t.test('useAcquisition reports committed snapshot pages and completion', async () => {
    await witness.reload();
    await page.evaluate(async ({ api, session }) => {
      await keepSession(api, session, localStorageSessionStore());
      const opener = webDevice();
      window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: { open: (name, backend) => opener.open(name + ':progress', backend) }, waitSeconds: 1,
        fetch: async (url, init) => {
          if (String(url).endsWith('/sync')) {
            init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), limit: 2 }) };
            await new Promise(r => setTimeout(r, 20));
          }
          return fetch(url, init);
        } });
      mountProgress(app); await app.ready;
    }, { api, session });
    await page.waitForFunction(() => window.progress.some(p => p.acquired));
    const progress = await page.evaluate(() => window.progress);
    assert.ok(progress.some(p => !p.acquired && p.rows > 0));
    assert.ok(progress.some(p => p.acquired && p.rows === 7 && p.tables.members === 7), JSON.stringify(progress));
    assert.ok(progress.every(p => p.acquired === p.acquiredLegacy));
    await page.evaluate(() => app.close());
  });
  for (const change of ['logout', 'principal', 'epoch', 'recovery']) await t.test(`session-locked journal refuses stale authority: ${change}`, async () => {
    session = (await fetch(api + '/auth/guest', { method: 'POST' }).then(r => r.json())).session;
    await fetch(api + '/seed', { method: 'POST', body: JSON.stringify([{ table: 'members', row: { id: 'authority-' + change, room: 'room3', principal: session.principal, admin: true } }]) });
    await witness.reload(); await prepare();
    const peer = await page.context().newPage();
  peer.setDefaultTimeout(hangBudget()); peer.setDefaultNavigationTimeout(hangBudget());
    await peer.goto(page.url()); await peer.waitForFunction(() => !!window.sessionKey);
    try {
      await peer.evaluate(api => new Promise(resolve => {
        void navigator.locks.request(sessionKey(api), async () => {
          resolve(); await new Promise(release => window.releaseSession = release);
        });
      }), api);
      const before = sent.length;
      const captured = await page.evaluate(() => {
        const id = mintId();
        window.racingWrite = app.mutate(api.removeMember, { room: 'room3', principal: 'user:other' }, { id });
        const key = Object.keys(localStorage).find(k => k.startsWith('snapback4-admission:'));
        const record = JSON.parse(localStorage.getItem(key));
        return { id, record, store: decodeURIComponent(key.split(':')[1]) };
      });
      assert.equal(captured.record.authority.principal, session.principal);
      await until(() => page.evaluate(async api => (await navigator.locks.query()).pending.some(lock => lock.name === sessionKey(api)), api), 'admission queued on the session lock');
      const outbox = await page.evaluate(async ({ store, id }) => indexedDbPersistence().read(store, 'o', id), captured);
      assert.equal(outbox, null, 'the journal must wait for the session lock before device admission');
      assert.equal(sent.length, before);
      if (change === 'recovery') {
        await page.evaluate(() => location.assign('/?logout-recovery=1'));
        await page.waitForURL('**/?logout-recovery=1'); await page.waitForFunction(() => !!window.createApp);
      }
      const other = change === 'principal' ? (await fetch(api + '/auth/guest', { method: 'POST' }).then(r => r.json())).session : session;
      await peer.evaluate(async ({ api, change, other, epoch }) => {
        const value = change === 'principal' ? { ...other, snapback4Epoch: epoch }
          : change === 'epoch' ? { ...other, snapback4Epoch: String(BigInt(epoch) + 1n) }
          : { snapback4Logout: String(BigInt(epoch) + 1n) };
        await localStorageSessionStore().set(sessionKey(api), JSON.stringify(value));
        window.releaseSession();
      }, { api, change, other, epoch: captured.record.authority.epoch });
      if (change === 'recovery') {
        await page.evaluate(async ({ api, session, epoch }) => {
          // A subsequent sign-in must not promote the older unadmitted click.
          await navigator.locks.request(sessionKey(api), () => localStorageSessionStore().set(sessionKey(api), JSON.stringify({ ...session, snapback4Epoch: String(BigInt(epoch) + 1n) })));
          window.app = createApp({ url: api, sessionStore: localStorageSessionStore(), device: webDevice(), waitSeconds: 1 });
          await app.ready;
        }, { api, session, epoch: captured.record.authority.epoch });
        await page.waitForFunction(id => !Object.keys(localStorage).some(key => key.startsWith('snapback4-admission:') && key.endsWith(id)), captured.id);
        assert.equal(await page.evaluate(id => app.client.write(id), captured.id), undefined, 'recovery must cancel the stale intent before adding it to the outbox');
      } else {
        const outcome = await page.evaluate(() => racingWrite);
        assert.equal(outcome.state, 'failed'); assert.equal(outcome.why.code, 'E_AUTH');
      }
      await page.evaluate(() => app.close());
      assert.equal(sent.length, before, 'no stale journal may send /m');
      const observer = (await fetch(api + '/auth/guest', { method: 'POST' }).then(r => r.json())).session;
      const total = await fetch(api + '/q/total', { method: 'POST', headers: { authorization: `Bearer ${observer.token}` }, body: '{}' }).then(r => r.json());
      assert.equal(total.data, 3, JSON.stringify(total));
      t.diagnostic(JSON.stringify({ change, journaled: true, outboxWhileLocked: outbox, mutationRequests: sent.length - before, serverTotal: total.data }));
    } finally {
      await peer.evaluate(() => window.releaseSession?.());
      await peer.close();
    }
  });
  await t.test('a transient unlocked epoch observation refuses only that call', async () => {
    await witness.reload(); await prepare();
    const result = await page.evaluate(async apiUrl => {
      const client = app.client, get = Storage.prototype.getItem, key = sessionKey(apiUrl) + '.epoch';
      Storage.prototype.getItem = function (name) { return name === key ? '9999999' : get.call(this, name); };
      let write;
      try { write = client.mutate(api.removeMember, { room: 'room3', principal: 'user:other' }); }
      finally { Storage.prototype.getItem = get; }
      const immediate = { state: write.state, code: write.why?.code };
      const roster = await client.query(api.roster, { room: 'room3' });
      await app.close();
      return { immediate, rows: roster.data?.length, denied: roster.denied };
    }, api);
    assert.deepEqual(result.immediate, { state: 'failed', code: 'E_AUTH' });
    assert.equal(result.denied, undefined); assert.ok(result.rows > 0);
  });
  await t.test('the bare online browser transport refuses without custody', async () => {
    const outcome = await page.evaluate(async ({ api, session }) => {
      let sends = 0;
      const client = createClient({ url: api, session, fetch: () => { sends++; throw Error('must not dispatch'); } });
      const returned = client.mutate(window.api.removeMember, { room: 'room3', principal: 'user:other' });
      const immediate = { state: returned.state, code: returned.why?.code };
      await client.close(); return { immediate, outcome: (await returned).state, sends };
    }, { api, session });
    assert.deepEqual(outcome, { immediate: { state: 'failed', code: 'E_ADMISSION' }, outcome: 'failed', sends: 0 });
  });
  for (const legacy of [false, true]) await t.test(`IndexedDB ${legacy ? 'legacy' : 'packed'} rows retain atomic abort and reopen`, async () => {
    const result = await page.evaluate(async legacy => {
      const name = 'row-format-' + legacy;
      if (legacy) await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('changes', { keyPath: ['s', 'k'] });
        request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
      });
      const store = indexedDbPersistence();
      const initial = Array.from({ length: 1000 }, (_, n) => ({ s: 'r', k: 'row-' + n, v: 'old-' + n }));
      initial.push({ s: 'm', k: 'watermark', v: '1' }, { s: 'o', k: 'queued', v: 'intent' });
      await store.save(name, initial);
      const before = await store.load(name);
      const update = initial.map(c => c.s === 'r' ? { ...c, v: 'new-' + c.k } : { ...c, v: c.s === 'm' ? '2' : null });
      const put = IDBObjectStore.prototype.put;
      let aborted = false;
      IDBObjectStore.prototype.put = function (value) {
        const request = put.call(this, value);
        if (this.transaction.db.name === name && (value.s === '$bucket' || value.s === 'r')) { this.transaction.abort(); aborted = true; }
        return request;
      };
      let failed = false;
      try { await store.save(name, update); } catch { failed = true; }
      finally { IDBObjectStore.prototype.put = put; }
      const after = await indexedDbPersistence().load(name);
      await indexedDbPersistence().save(name, update);
      await indexedDbPersistence().save(name, [{ s: 'r', k: 'row-0', v: null }]);
      const final = await indexedDbPersistence().load(name);
      const same = values => JSON.stringify(values.sort((a, b) => (a.s + a.k).localeCompare(b.s + b.k)));
      return { aborted, failed, unchanged: same(before) === same(after), rows: final.filter(c => c.s === 'r').length,
        watermark: await store.read(name, 'm', 'watermark'), deleted: await store.read(name, 'r', 'row-0'),
        changed: await store.read(name, 'r', 'row-1'), queued: await store.read(name, 'o', 'queued') };
    }, legacy);
    assert.deepEqual(result, { aborted: true, failed: true, unchanged: true, rows: 999, watermark: '2', deleted: null, changed: 'new-row-1', queued: null });
  });
  assert.deepEqual(errors, []);
});

// Exercise the consumer's emitted import graph: a source-level import census
// misses shared chunks which can pull the local engine back into startup.
test("web startup bundle defers the local runtime under the 100 KB gzip SDK budget", async t => {
  const { measureWebApp } = await import("../../../scripts/measure-client.mjs");
  const result = await measureWebApp();
  const initial = result.files.filter(file => file.initial);
  const loaded = new Set(initial.flatMap(file => file.modules));
  for (const module of ["local.ts", "web-runtime.ts", "wasm/snapback4_device.js", "web-worker-device.ts"]) {
    assert.equal(loaded.has(module), false, `${module} must load with the device, not the page`);
    assert.ok(result.files.some(file => !file.initial && file.modules.includes(module)), `${module} must remain available after startup`);
  }
  assert.ok(result.files.some(file => file.file.endsWith(".wasm") && !file.initial), "the full device stays a separate asset");
  assert.ok(result.initial.gzip < 100_000, JSON.stringify(result.initial));
  t.diagnostic(JSON.stringify({ initial: result.initial, emitted: result.emitted, note: result.note }));
});

test('web startup: page works during deferred download and retains offline writes across reload', { timeout: hangBudget(20) }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-deferred-start-'));
  const sourceDir = join(project, 'snapback'); mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'schema.q'), `use identity
table notes:
  body: text <=100
  public 'Startup witness.'
  insert <- allow
  sync public
mutation add(body: text <=100):
  insert notes { body }
query list():
  return notes first 100
`);
  teardownAfter(t, () => rmSync(project, { recursive: true, force: true }));
  // No eager fixture bootstrap: exercise the production app/device imports.
  const witness = await launch({ sourceDir, bootstrap: false, minify: 'oxc',
    ready: () => typeof window.startStartup === 'function', entrySource: `
import { createApp } from '${join(root, 'packages/snapback4/src/app.ts')}';
import { localStorageSessionStore } from '${join(root, 'packages/snapback4/src/auth.ts')}';
import { webDevice } from '${join(root, 'packages/snapback4/src/web.ts')}';
document.body.innerHTML = '<label>Draft <input id="draft"></label><output id="echo"></output>';
document.querySelector('#draft').addEventListener('input', event => {
  document.querySelector('#echo').textContent = event.target.value;
});
window.startStartup = (url, offline = false) => {
  window.offline = offline;
  window.app = createApp({ url, sessionStore: localStorageSessionStore(), device: webDevice(), waitSeconds: 1,
    fetch: (...args) => window.offline ? Promise.reject(new TypeError('offline')) : fetch(...args) });
  return app.ready;
};
` });
  teardownAfter(t, () => witness.close());
  const { page, api } = witness;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').some(r => r.name.includes('.wasm'))), false);
  await page.locator('#draft').fill('page is usable');
  assert.equal(await page.locator('#echo').textContent(), 'page is usable');
  await page.evaluate(api => startStartup(api), api);
  assert.equal(await page.evaluate(() => app.auth.state), 'signed-out');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  await page.route('**/*.wasm', async route => { await gate; await route.continue(); });
  const requested = page.waitForRequest(request => request.url().endsWith('.wasm'));
  await page.evaluate(() => { window.opening = app.auth.guest(); });
  await requested;
  await page.locator('#draft').fill('still responsive while loading');
  assert.equal(await page.locator('#echo').textContent(), 'still responsive while loading');
  assert.notEqual(await page.evaluate(() => app.auth.state), 'signed-in');
  release();
  assert.equal((await page.evaluate(() => opening)).ok, true);
  await page.unroute('**/*.wasm');
  await page.waitForFunction(() => app.client.acquired);
  const queued = await page.evaluate(async () => {
    window.offline = true;
    const write = await app.mutate({ kind: 'mutation', name: 'add' }, { body: 'kept through deferred restore' });
    const read = await app.client.query({ kind: 'query', name: 'list' }, {});
    await app.close();
    return { write, read };
  });
  assert.equal(queued.write.state, 'pending', JSON.stringify(queued.write));
  assert.equal(queued.read.data[0].body, 'kept through deferred restore');
  await witness.reload();
  // The matching app shell is loaded; now take all requests offline before
  // the deferred module opens its device. WASM must come from IndexedDB.
  await page.route('**/*.wasm', route => route.abort());
  const restored = await page.evaluate(async api => {
    const ready = await startStartup(api, true);
    const read = await app.client.query({ kind: 'query', name: 'list' }, {});
    return { ready, read, pending: await app.client.pendingWrites() };
  }, api);
  assert.equal(restored.ready.ok, true, JSON.stringify(restored.ready));
  assert.equal(restored.read.data[0].body, 'kept through deferred restore');
  assert.equal(restored.pending.length, 1);
  assert.deepEqual(errors, []);
  await page.evaluate(() => app.close());
});

// @ref LLP 3000.002.000#6 — the mounted query survives a thirty-second engine download.
test('progressive worker startup: signed-in React data while WASM is held 30 seconds', { timeout: hangBudget(45) }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-progressive-start-'));
  const sourceDir = join(project, 'snapback'); mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'schema.q'), `use identity
table notes:
  body: text <=100
  public 'Progressive startup witness.'
  sync public
query list(c: cursor?):
  return notes first 1 after c
`);
  teardownAfter(t, () => rmSync(project, { recursive: true, force: true }));
  const witness = await launch({ sourceDir, bootstrap: false, minify: 'oxc', ready: () => typeof window.startProgressive === 'function', entrySource: `
import { createApp, localStatus } from '${join(root, 'packages/snapback4/src/app.ts')}';
import { createLocalClient } from '${join(root, 'packages/snapback4/src/local.ts')}';
import { storeLock } from '${join(root, 'packages/snapback4/src/app-storage.ts')}';
import { keepSession, localStorageSessionStore, memorySessionStore, sessionKey } from '${join(root, 'packages/snapback4/src/auth.ts')}';
import { webDevice } from '${join(root, 'packages/snapback4/src/web.ts')}';
import { AppProvider, useQuery, useLocalStatus } from '${join(root, 'packages/snapback4/src/react.tsx')}';
import { createElement as h, useEffect } from '${require.resolve('react')}';
import { createRoot } from '${require.resolve('react-dom/client')}';
const list = {kind:'query', name:'list'};
Object.assign(window, { webDevice, localStatus, createLocalClient, storeLock, memorySessionStore, sessionKey });
window.startProgressive = async (url, session) => {
  const storage = localStorageSessionStore(); await keepSession(url, session, storage);
  window.mounts = 0; window.unmounts = 0; window.reads = [];
  window.app = createApp({url, sessionStore:storage, device:webDevice({worker:true}), startup:'progressive', waitSeconds:1});
  await app.ready;
  window.firstClient = app.client;
  function Screen() {
    const read = useQuery(list, {c:null}), status = useLocalStatus();
    window.reads.push(read);
    useEffect(() => { window.mounts++; return () => { window.unmounts++; }; }, []);
    return h('div', {}, h('p', {id:'data'}, 'data' in read ? read.data.map(row=>row.body).join(',') : 'pending'), h('p', {id:'local'}, status.state));
  }
  const element = document.createElement('div'); document.body.append(element);
  window.reactRoot = createRoot(element); reactRoot.render(h(AppProvider, {app}, h(Screen)));
};
` });
  teardownAfter(t, () => witness.close());
  const { page, api } = witness;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const custody = await page.evaluate(async () => {
    const device = webDevice({worker:true}), name = 'snapback4-probe';
    const empty = await device.custody(name);
    const journal = 'snapback4-admission:' + encodeURIComponent(name + ':tab-orphan') + ':write';
    localStorage.setItem(journal, '{}'); const orphan = await device.custody(name); localStorage.removeItem(journal);
    await new Promise((resolve, reject) => { const r = indexedDB.open(name); r.onsuccess = () => {r.result.close();resolve();}; r.onerror = () => reject(r.error); });
    const existing = await device.custody(name);
    await new Promise(resolve => {indexedDB.deleteDatabase(name).onsuccess = resolve;});
    let free; const held = new Promise(resolve => {free=resolve;});
    const claim = navigator.locks.request(name, async () => { await held; });
    await new Promise(resolve => setTimeout(resolve, 20)); const busy = await device.custody(name); free(); await claim;
    let releaseWorker, claimed; const workerHeld = new Promise(resolve=>{releaseWorker=resolve;});
    const workerEntered = new Promise(resolve=>{claimed=resolve;});
    const workerClaim = navigator.locks.request('snapback4-worker:'+encodeURIComponent(name),async()=>{claimed();await workerHeld;});
    await workerEntered; const busyWorker=await device.custody(name); releaseWorker(); await workerClaim;
    const databases=indexedDB.databases; indexedDB.databases=async()=>{throw Error('blocked storage');};
    const unreadable=await device.custody(name); indexedDB.databases=databases;
    return {empty, orphan, existing, busy, busyWorker, unreadable, wasm:performance.getEntriesByType('resource').some(r=>r.name.endsWith('.wasm'))};
  });
  assert.deepEqual(custody, {empty:'none', orphan:'present', existing:'present', busy:'present', busyWorker:'present', unreadable:'unknown', wasm:false});
  // Two renderer contexts: the probe must wait for an admission in the
  // session Web Lock, then enumerate journal keys again after the commit.
  const other = await page.context().newPage();
  teardownAfter(t, () => other.close());
  await other.goto(page.url()); await other.waitForFunction(() => !!window.createLocalClient);
  await page.evaluate(() => {
    const url='https://custody-race.invalid', name='snapback4-'+encodeURIComponent(url+':alice');
    window.raceJournal='snapback4-admission:'+encodeURIComponent(name)+':A';
    window.raceCommit = new Promise(resolve => { window.commitRace=resolve; });
    window.raceHeld=false;
    window.raceAdmission=storeLock(sessionKey(url),async()=>{window.raceHeld=true;await raceCommit;localStorage.setItem(raceJournal,'{}');});
  });
  await page.waitForFunction(() => window.raceHeld);
  await other.evaluate(() => {
    window.raceProbed=false; window.raceOpened=false;
    const probe=webDevice({worker:true});
    window.raceOpening=createLocalClient({url:'https://custody-race.invalid',startup:'progressive',
      session:{token:'race',principal:'alice',kind:'user',expiresAt:Date.now()+7*86400000},sessionStore:memorySessionStore(),
      device:{custody:async name=>{window.raceProbed=true;return probe.custody(name);},open:async()=>{window.raceOpened=true;throw Error('ordinary recovery selected');}},
      fetch:async()=>Response.json({generation:1,store_id:'race',schema:{tables:{}},programs:[]})})
      .then(()=> 'incorrect online path',error=>error.message);
  });
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(await other.evaluate(()=>window.raceProbed),false,'probe waits for the other tab admission');
  await page.evaluate(async()=>{commitRace();await raceAdmission;});
  assert.match(await other.evaluate(()=>window.raceOpening),/ordinary recovery selected/);
  assert.equal(await other.evaluate(()=>window.raceOpened),true);
  await page.evaluate(()=>localStorage.removeItem(raceJournal));
  await other.close();
  const signed = await fetch(api + '/auth/guest', {method:'POST'}).then(r=>r.json());
  assert.ok(signed.session);
  assert.equal((await fetch(api+'/seed',{method:'POST',body:JSON.stringify([
    {table:'notes',row:{id:'a',body:'server data before engine'}}, {table:'notes',row:{id:'b',body:'second page'}},
  ])}).then(r=>r.json())).seeded,2);
  const release = Promise.withResolvers(); t.after(()=>release.resolve());
  await page.route('**/*.wasm', async route => {await release.promise; await route.continue();});
  const requested = page.waitForRequest(r=>r.url().endsWith('.wasm'));
  await page.evaluate(({api,session})=>startProgressive(api,session), {api,session:signed.session});
  await page.waitForFunction(()=>document.querySelector('#data')?.textContent==='server data before engine');
  await requested; const heldAt = Date.now();
  assert.equal(await page.evaluate(()=>app.auth.state),'signed-in');
  assert.equal(await page.evaluate(()=>app.client.acquired),false);
  const cursor = await page.evaluate(()=>reads.find(r=>'data' in r)?.next);
  assert.ok(cursor, 'first server page owns a continuation');
  await new Promise(resolve=>setTimeout(resolve,30000));
  assert.equal(await page.locator('#data').textContent(),'server data before engine');
  assert.equal(await page.evaluate(()=>app.client.acquired),false);
  release.resolve();
  await page.waitForFunction(()=>localStatus(app.client).getSnapshot().state==='ready');
  const result = await page.evaluate(async cursor=>{
    const first = reads.findIndex(r=>'data' in r);
    const page = await app.client.query({kind:'query',name:'list'},{c:cursor});
    return {same:app.client===firstClient,mounts,unmounts,loadingAfterData:reads.slice(first).some(r=>'loading' in r),page};
  },cursor);
  assert.equal(result.same,true); assert.equal(result.mounts,1); assert.equal(result.unmounts,0); assert.equal(result.loadingAfterData,false);
  assert.equal(result.page.data[0].body,'second page'); assert.deepEqual(errors,[]);
  t.diagnostic(`progressive worker WASM hold: ${Date.now()-heldAt} ms; mounted once; status ready`);
  await page.evaluate(async()=>{reactRoot.unmount();await app.close();});
});

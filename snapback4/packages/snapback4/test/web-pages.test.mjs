import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, root } from '../../../witness/lib.mjs';

test('format 3 upgrades atomically to bounded strict pages without losing device custody', {timeout:120000}, async t => {
  const witness = await launch({seed:Array.from({length:600},(_,n)=>({table:'migrationRows',row:{id:`r${n}`,value:n}})), extraSource:`
table migrationRows:
  value: int
  public 'migration fixture'
  sync public
query migratedRows(c: cursor ?):
  return migrationRows first 100 after c
`, entrySource:`
import { indexedDbStore } from '${join(root,'packages/snapback4/src/web-idb.ts')}';
import { prepareClient } from '${join(root,'packages/snapback4/src/client-start.ts')}';
import { createLocalClient as rawClient } from '${join(root,'packages/snapback4/src/local.ts')}';
Object.assign(window,{prepareClient,rawClient,pageStore:()=>indexedDbStore(indexedDbPersistence().claim,true)});
`});
  t.after(()=>witness.close());
  const result = await witness.page.evaluate(async()=>{
    const old=indexedDbPersistence(), modern=pageStore(), name='format-three-to-four';
    const rows=Array.from({length:6000},(_,n)=>({s:['r','s','b'][n%3],k:JSON.stringify(['rows',`r${n}`]),v:JSON.stringify({n,payload:'xyz'.repeat(80)})}));
    rows.push({s:'m',k:'device:watermark',v:'42'},{s:'m',k:'device:acquired-generation',v:'7'},
      {s:'o',k:'pending',v:'{"seq":1,"op":"send"}'},{s:'m',k:'device:snapshot:next',v:'continuation'},
      {s:'m',k:'device:delivery',v:'unacknowledged'});
    await old.save(name,rows);
    const raw=async(name)=>{const request=indexedDB.open(name);await new Promise((r,j)=>{request.onsuccess=r;request.onerror=j;});return request.result;};
    const marker=async()=>{const db=await raw(name),tx=db.transaction('changes'),q=tx.objectStore('changes').get(['$format','row-buckets']);await new Promise((r,j)=>{tx.oncomplete=r;tx.onabort=j;});db.close();return q.result.v;};
    const initial=await marker();
    // Abort conversion after a physical page write. No marker or partial page
    // may survive, and the original adapter can still read every image.
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...args){const r=put.call(this,value,...args);if(this.name==='pages')this.transaction.abort();return r;};
    let refused=false;try{await modern.load(name);}catch{refused=true;}finally{IDBObjectStore.prototype.put=put;}
    const aborted=await marker(), afterAbort=await old.load(name);
    const writes=[], transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);if(this.name===name&&tx.mode==='readwrite')writes.push(tx.durability);return tx;};
    let loaded;try{loaded=await modern.load(name);}finally{IDBDatabase.prototype.transaction=transaction;}
    const migrated=await marker(), canonical=cs=>cs.map(c=>JSON.stringify(c)).sort();
    const unchanged=JSON.stringify(canonical(loaded))===JSON.stringify(canonical(rows));
    const reopened=pageStore(), restored=await reopened.load(name);
    const point=await pageStore().read(name,'s',rows[1].k);
    const delta=[{...rows[0],v:'updated'},{...rows[1],v:null},{s:'r',k:'new',v:'new image'},{s:'m',k:'device:watermark',v:'43'}];
    const accepted=await reopened.saveIfCurrent(name,delta,()=>false);
    const afterStale=await reopened.read(name,'r',rows[0].k);
    await reopened.save(name,delta);
    let oldOwnerRefused=false;try{await modern.save(name,[{s:'m',k:'wrong',v:'stale'}]);}catch{oldOwnerRefused=true;}
    await modern.load(name);
    // A deletion set smaller than its page must not drop an unrelated row.
    await modern.save(name,[{...rows[3],v:null}]);
    const survivor=await modern.read(name,rows[6].s,rows[6].k);
    const finish=await pageStore().load(name);
    const db=await raw(name),tx=db.transaction(['pages','page-keys']),p=tx.objectStore('pages').getAll(),k=tx.objectStore('page-keys').getAll();
    await new Promise((r,j)=>{tx.oncomplete=r;tx.onabort=j;});db.close();
    return {initial,refused,aborted,abortUnchanged:JSON.stringify(canonical(afterAbort))===JSON.stringify(canonical(rows)),migrated,unchanged,
      restored:restored.length,expected:rows.length,point,pointExpected:rows[1].v,writes,accepted,afterStale,oldValue:rows[0].v,oldOwnerRefused,
      survivor,survivorExpected:rows[6].v,finalCount:finish.length,updated:finish.find(c=>c.k===rows[0].k)?.v,
      removed:finish.some(c=>c.k===rows[1].k),watermark:finish.find(c=>c.k==='device:watermark')?.v,
      maxRows:Math.max(...p.result.map(p=>p.rows.length)),pages:p.result.length,directories:k.result.length};
  });
  assert.equal(result.initial,'3');assert.equal(result.refused,true);assert.equal(result.aborted,'3');assert.equal(result.abortUnchanged,true);
  assert.equal(result.migrated,'4');assert.equal(result.unchanged,true);assert.equal(result.restored,result.expected);
  assert.equal(result.point,result.pointExpected);assert.deepEqual(result.writes,['strict']);
  assert.equal(result.accepted,false);assert.equal(result.afterStale,result.oldValue);assert.equal(result.oldOwnerRefused,true);
  assert.equal(result.survivor,result.survivorExpected);assert.equal(result.finalCount,result.expected-1);
  assert.equal(result.updated,'updated');assert.equal(result.removed,false);assert.equal(result.watermark,'43');
  assert.ok(result.maxRows<=512);assert.equal(result.pages,result.directories);
  for (const worker of [false,true]) {
    const reopened = await witness.page.evaluate(async({api,worker})=>{
      const suffix=`:format3-real-${worker}`, legacy=webDevice({persist:indexedDbPersistence()});
      const options={url:api,persona:'alice',device:{open:(name,backend)=>legacy.open(name+suffix,backend)},waitSeconds:1};
      const prepared=await prepareClient(options,()=>rawClient(options));await prepared.start();const oldAcquired=prepared.client.acquired;await prepared.client.close();
      const modern=webDevice({worker});
      const offline=await rawClient({...options,device:{open:(name,backend)=>modern.open(name+suffix,backend)},fetch:async()=>{throw new TypeError('offline migration');}});
      const rows=[];let c=null;
      do {const reply=await offline.query({kind:'query',name:'media.migratedRows'},{c});if(!reply.complete)throw Error(JSON.stringify({reply,worker,oldAcquired,acquired:offline.acquired,dbs:await indexedDB.databases()}));rows.push(...reply.data);c=reply.next??null;}while(c);
      const acquired=offline.acquired;await offline.close();
      return {acquired,count:rows.length,correct:rows.every(r=>r.value===Number(r.id.slice(1)))};
    },{api:witness.api,worker});
    assert.deepEqual(reopened,{acquired:true,count:600,correct:true});
  }

});

test('a long-lived format-3 adapter cannot use cached packing after another owner migrates', {timeout:120000}, async t => {
  const witness = await launch({entrySource:`
import { indexedDbStore } from '${join(root,'packages/snapback4/src/web-idb.ts')}';
Object.assign(window,{pageStore:()=>indexedDbStore(indexedDbPersistence().claim,true)});
`});
  t.after(()=>witness.close());
  const result = await witness.page.evaluate(async()=>{
    const old=indexedDbPersistence(), modern=pageStore(), name='cached-format-three';
    const rows=[{s:'r',k:'old',v:'row'}, {s:'s',k:'stage',v:'stage'}, {s:'b',k:'base',v:'base'}, {s:'m',k:'watermark',v:'1'}];
    await old.save(name,rows);
    await old.load(name); // Cache "3" on a long-lived object.
    // Leave physical version 3 / logical format 3, then cache "3" again.
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...args){const r=put.call(this,value,...args);if(this.name==='pages')this.transaction.abort();return r;};
    let aborted=false;
    try { await modern.load(name); } catch { aborted=true; } finally { IDBObjectStore.prototype.put=put; }
    await old.load(name);
    await modern.load(name);
    const writes=[],transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);if(this.name===name&&tx.mode==='readwrite')writes.push(tx.durability);return tx;};
    let stale,accepted;
    try {
      stale=await old.saveIfCurrent(name,[{s:'r',k:'old',v:'must abort'}],()=>false);
      accepted=await old.saveIfCurrent(name,[{s:'r',k:'old',v:'updated'},{s:'s',k:'stage',v:null},{s:'m',k:'watermark',v:'2'}],()=>true);
      await old.save(name,[{s:'b',k:'base',v:null},{s:'r',k:'new',v:'new row'}]);
    } finally { IDBDatabase.prototype.transaction=transaction; }
    const loaded=await pageStore().load(name);
    const point=await old.read(name,'r','old');
    const request=indexedDB.open(name);
    await new Promise((r,j)=>{request.onsuccess=r;request.onerror=j;});
    const db=request.result,tx=db.transaction('changes'),records=tx.objectStore('changes').getAll();
    await new Promise((r,j)=>{tx.oncomplete=r;tx.onabort=j;});db.close();
    return {aborted,stale,accepted,loaded:loaded.sort((a,b)=>a.k.localeCompare(b.k)),point,writes,
      stray:records.result.filter(c=>c.s==='$bucket'||['r','s','b'].includes(c.s)),
      format:records.result.find(c=>c.s==='$format'&&c.k==='row-buckets')?.v};
  });
  assert.equal(result.aborted,true);
  assert.equal(result.stale,false);
  assert.equal(result.accepted,true);
  assert.equal(result.point,'updated');
  assert.equal(result.format,'4');
  assert.deepEqual(result.stray,[], 'no buckets or direct packed rows may coexist with format-4 pages');
  assert.deepEqual(result.loaded,[{s:'r',k:'new',v:'new row'},{s:'r',k:'old',v:'updated'},{s:'m',k:'watermark',v:'2'}]);
  assert.deepEqual(result.writes,['strict','strict','strict']);
});

for (const mode of ['save', 'conditional', 'worker-host']) test(`migration during a format-3 ${mode} rechecks layout in the writing transaction`, {timeout:120000}, async t => {
  const witness = await launch({entrySource:`
import { indexedDbStore } from '${join(root,'packages/snapback4/src/web-idb.ts')}';
import { WebWorkerHost } from '${join(root,'packages/snapback4/src/web-worker-host.ts')}';
Object.assign(window,{WebWorkerHost,pageStore:()=>indexedDbStore(indexedDbPersistence().claim,true)});
`});
  t.after(()=>witness.close());
  const results = await witness.page.evaluate(async mode => {
    const results = [];
    for (const current of mode === 'save' ? [true] : [true, false]) {
      const name = `interleaved-${mode}-${current}`, old = indexedDbPersistence(), modern = pageStore();
      const original = [{s:'r',k:'old',v:'row'},{s:'s',k:'stage',v:'stage'},{s:'b',k:'base',v:'base'},{s:'m',k:'watermark',v:'1'}];
      const delta = [{s:'r',k:'old',v:'updated'},{s:'r',k:'new',v:'new'},{s:'s',k:'stage',v:null},{s:'b',k:'base',v:'new base'},{s:'m',k:'watermark',v:'2'}];
      await old.save(name,original);
      // The durable state of an aborted migration: physical v3, logical 3.
      await new Promise((resolve,reject)=>{
        const q=indexedDB.open(name,3);
        q.onupgradeneeded=()=>{q.result.createObjectStore('pages',{keyPath:'id'});q.result.createObjectStore('page-keys',{keyPath:'id'});};
        q.onsuccess=()=>{q.result.close();resolve();};q.onerror=()=>reject(q.error);
      });
      let host, finished=0;
      if(mode==='worker-host') {
        // Exercise the real host's commitIf and page-realm IDB adapter. Only the
        // Worker RPC is a fixture: today's Worker restricts conditional ops to
        // metadata; a row delta makes the adapter's layout defect observable.
        class PreparedWorker extends EventTarget {
          postMessage(message) {
            const control={predictions:[],queuedRevision:0};
            let ok={journal:[],control};
            if(message.action==='prepare-conditional')ok={changes:delta};
            if(message.action==='finish-conditional')finished++;
            queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{id:message.id,ok}})));
          }
          terminate() {}
        }
        host=new WebWorkerHost({name,release:async()=>{}},()=>new PreparedWorker());
        await host.open();
      }
      let release, heldResolve;
      const held=new Promise(resolve=>{heldResolve=resolve;});
      const get=IDBObjectStore.prototype.get, put=IDBObjectStore.prototype.put;
      const transaction=IDBDatabase.prototype.transaction;
      let captured=false, migrated=false, bucketWrites=0;
      const writes=[];
      IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);if(this.name===name&&tx.mode==='readwrite')writes.push(tx.durability);return tx;};
      IDBObjectStore.prototype.put=function(value,...args){if(migrated&&this.transaction.db.name===name&&value.s==='$bucket')bucketWrites++;return put.call(this,value,...args);};
      IDBObjectStore.prototype.get=function(key){
        const q=get.call(this,key), tx=this.transaction;
        if(!captured&&tx.db.name===name&&tx.mode==='readonly'&&JSON.stringify(key)==='["$format","row-buckets"]') {
          captured=true;
          // The physical read finishes normally, but its done() callback is
          // held. No active transaction blocks the independent migration.
          tx.addEventListener('complete',event=>{
            event.stopImmediatePropagation();
            const complete=tx.oncomplete;
            release=()=>complete.call(tx,event);
            heldResolve(q.result.v);
          },{once:true});
        }
        return q;
      };
      let accepted, markerDuringHold;
      try {
        const saving=mode==='worker-host' ? host.transaction(async tx=>{await tx.commitIf(()=>current);return true;}).catch(error=>{if(error.constructor.name==='StaleWorkerCommit')return false;throw error;})
          : mode==='conditional' ? old.saveIfCurrent(name,delta,()=>current) : old.save(name,delta).then(()=>true);
        const observed=await held;
        await modern.load(name);
        markerDuringHold=await old.read(name,'$format','row-buckets');
        migrated=true;release();
        accepted=await saving;
        if(observed!=='3')throw Error(`expected stale marker 3, got ${observed}`);
      } finally {
        IDBObjectStore.prototype.get=get;IDBObjectStore.prototype.put=put;IDBDatabase.prototype.transaction=transaction;
        await host?.close();
      }
      const loaded=await pageStore().load(name), point=await old.read(name,'r','old');
      const records=await new Promise((resolve,reject)=>{
        const q=indexedDB.open(name);
        q.onsuccess=()=>{const db=q.result,tx=db.transaction('changes'),r=tx.objectStore('changes').getAll();tx.oncomplete=()=>{db.close();resolve(r.result);};tx.onabort=()=>reject(tx.error);};q.onerror=()=>reject(q.error);
      });
      const canonical=rows=>rows.map(c=>JSON.stringify(c)).sort();
      const expected=current?[delta[0],delta[1],delta[3],delta[4]]:original;
      results.push({current,accepted,markerDuringHold,point,finished,bucketWrites,writes,
        rows:canonical(loaded),expected:canonical(expected),stray:records.filter(c=>c.s==='$bucket'||['r','s','b'].includes(c.s))});
    }
    return results;
  },mode);
  for(const result of results) {
    assert.equal(result.markerDuringHold,'4');
    assert.equal(result.accepted,result.current);
    assert.equal(result.bucketWrites,0,'no bucket may be written after migration, even in an aborted save');
    assert.deepEqual(result.stray,[]);
    assert.deepEqual(result.rows,result.expected);
    assert.equal(result.point,result.current?'updated':'row');
    assert.ok(result.writes.length>=2&&result.writes.every(d=>d==='strict'));
    if(mode==='worker-host')assert.equal(result.finished,result.current?1:0,'publish the Worker only after an accepted strict save');
  }
});

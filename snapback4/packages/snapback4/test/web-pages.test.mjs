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

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, root } from '../../../witness/lib.mjs';

test('web review: acquisition lifetimes and bounded persistence', { timeout: 120_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-web-review-'));
  const sourceDir = join(dir, 'snapback'); mkdirSync(sourceDir);
  writeFileSync(join(sourceDir, 'schema.q'), `use personas alice, bob
table constructor:
  value: int
  public 'Regression fixture rows are public.'
  sync public
query rows():
  return constructor first 50
query all(c: cursor ?):
  return constructor first 100 after c
`);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mutant = process.env.SNAPBACK4_WEB_REVIEW_MUTANT;
  const sourceOverrides = {};
  const path = name => join(root, 'packages/snapback4/src', name);
  if (mutant === 'delivery-guard') sourceOverrides[path('web-idb.ts')] = readFileSync(path('web-idb.ts'), 'utf8').replace('if (!current())', 'if (false)');
  if (mutant === 'delivery-gap') sourceOverrides[path('web-idb.ts')] = readFileSync(path('web-idb.ts'), 'utf8').replace('guard.onsuccess = () =>', 'guard.onsuccess = async () =>').replace('else tx.commit();', 'else { await Promise.resolve(); tx.commit(); }');
  if (mutant === 'reset') sourceOverrides[path('acquisition.ts')] = readFileSync(path('acquisition.ts'), 'utf8').replace('reset() { publish(empty); }', 'reset() {}');
  if (mutant === 'tables') sourceOverrides[path('acquisition.ts')] = readFileSync(path('acquisition.ts'), 'utf8').replaceAll('Object.create(null)', '{}');
  if (mutant === 'overflow-delete') sourceOverrides[path('web-idb-buckets.ts')] = readFileSync(path('web-idb-buckets.ts'), 'utf8')
    .replace('if (prior === undefined && spill && !cleared) store.delete([s, change.k]);', '/* mutant: leave deleted overflow rows on disk */')
    .replace('else if (saved.spill && !cleared) store.delete([s, change.k]);', '/* mutant: leave pure-deletion overflow rows on disk */');
  if (mutant === 'range-survivor') sourceOverrides[path('web-idb.ts')] = readFileSync(path('web-idb.ts'), 'utf8')
    .replace('request.result.every(key => Array.isArray(key) && key.length === 2 && typeof key[1] === "string" && keys.has(key[1]))', 'true');
  if (mutant === 'many-roots') sourceOverrides[path('web-idb-buckets.ts')] = readFileSync(path('web-idb-buckets.ts'), 'utf8')
    .replace('(legacy ? 255 : 63)', '255');
  if (mutant === 'database-version') sourceOverrides[path('web-idb.ts')] = readFileSync(path('web-idb.ts'), 'utf8')
    .replace('const DATABASE_VERSION = 2;', 'const DATABASE_VERSION = 1;');
  if (mutant === 'migration-durability' || mutant === 'migration-default') sourceOverrides[path('web-idb-buckets.ts')] = readFileSync(path('web-idb-buckets.ts'), 'utf8')
    .replace('durability: "strict"', `durability: "${mutant === 'migration-default' ? 'default' : 'relaxed'}"`);
  if (mutant === 'base-store') sourceOverrides[path('web-idb-buckets.ts')] = readFileSync(path('web-idb-buckets.ts'), 'utf8')
    .replace(' || s === "b"', '');
  for (const [name, selected] of [['local.ts', 'progress'], ['web-idb.ts', 'buckets']]) if (mutant === selected) {
    sourceOverrides[path(name)] = execFileSync('git', ['show', `18f3754fc:snapback4/packages/snapback4/src/${name}`], { cwd: root, encoding: 'utf8' });
  }
  const witness = await launch({ seed: [], sourceDir, sourceOverrides, entrySource: `
import { acquisition } from '${path('acquisition.ts')}';
import { prepareClient } from '${path('client-start.ts')}';
import { createLocalClient as rawClient } from '${path('local.ts')}';
import { indexedDbStore as preAqStore } from '${join(root, 'packages/snapback4/test/fixtures/pre-aq-f9620c815/web-idb.ts')}';
Object.assign(window, { acquisition, prepareClient, rawClient, preAqStore });
` });
  t.after(() => witness.close());
  const { page, api } = witness;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await t.test('delivery guard aborts the actual IndexedDB transaction before stale debt commits', async () => {
    const result = await page.evaluate(async () => {
      const store = indexedDbPersistence(), name = 'conditional-delivery';
      await store.save(name, [{s:'m',k:'existing',v:'kept'}]);
      let current = true, checks = 0;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, ...args) {
        const request = put.call(this,value,...args);
        if(value.k === 'delivery') current = false;
        return request;
      };
      let accepted;
      try { accepted = await store.saveIfCurrent(name, [{s:'m',k:'delivery',v:'debt'}], () => { checks++;return current; }); }
      finally { IDBObjectStore.prototype.put = put; }
      const after = await store.load(name);
      const fresh = await store.saveIfCurrent(name,[{s:'m',k:'delivery',v:'fresh'}],()=>true);
      return {accepted,checks,after:after.filter(c=>c.s==='m'),fresh,value:await store.read(name,'m','delivery')};
    });
    assert.equal(result.accepted,false);assert.equal(result.checks,1);
    assert.deepEqual(result.after,[{s:'m',k:'existing',v:'kept'}]);
    assert.equal(result.fresh,true);assert.equal(result.value,'fresh');
  });
  await t.test('IndexedDB commits in the passing guard turn before a queued fence change', async () => {
    const result = await page.evaluate(async () => {
      const store = indexedDbPersistence(), name = 'conditional-commit-gap';
      let current = true, checks = 0, currentAtCommit;
      const commit = IDBTransaction.prototype.commit;
      IDBTransaction.prototype.commit = function() { currentAtCommit = current; return commit.call(this); };
      let accepted;
      try {
        accepted = await store.saveIfCurrent(name, [{s:'m',k:'delivery',v:'debt'}], () => {
          checks++;queueMicrotask(() => { current = false; });return current;
        });
      } finally { IDBTransaction.prototype.commit = commit; }
      const stale = await store.saveIfCurrent(name, [{s:'m',k:'delivery',v:'stale'}], () => current);
      return {accepted,stale,checks,current,currentAtCommit,value:await store.read(name,'m','delivery')};
    });
    assert.deepEqual(result,{accepted:true,stale:false,checks:1,current:false,currentAtCommit:true,value:'debt'});
  });
  const seed = async rows => {
    const result = await fetch(api + '/seed', { method: 'POST', body: JSON.stringify(rows.map(row => ({ table: 'constructor', row }))) }).then(r => r.json());
    assert.equal(result.seeded, rows.length, JSON.stringify(result));
  };
  await t.test('same-store reacquisition reconciles progress with an already-true acquired flag', async () => {
    const first = await page.evaluate(async api => {
      const client = await rawClient({ url: api, persona: 'alice', device: webDevice(), waitSeconds: 1 });
      const result = { acquired: client.acquired, progress: acquisition(client).read() };
      await client.close(); return result;
    }, api);
    assert.equal(first.acquired, true); assert.equal(first.progress.acquired, true); assert.equal(first.progress.rows, 0);
    await seed([{ id: 'one', value: 1 }]);
    const again = await page.evaluate(async api => {
      const client = await rawClient({ url: api, persona: 'alice', device: webDevice(), waitSeconds: 1 });
      const result = { acquired: client.acquired, progress: acquisition(client).read() };
      await client.close(); return result;
    }, api);
    assert.equal(again.acquired, true);
    assert.equal(again.progress.acquired, true, JSON.stringify(again));
    assert.equal(again.progress.rows, 1); assert.equal(again.progress.tables.constructor, 1);
  });
  await t.test('a compiled special table name produces numeric own-property counts', async () => {
    const result = await page.evaluate(async api => {
      const client = await rawClient({ url: api, persona: 'bob', device: webDevice(), waitSeconds: 1 });
      const value = acquisition(client).read();
      const result = { ...value, nullPrototype: Object.getPrototypeOf(value.tables) === null };
      await client.close(); return result;
    }, api);
    assert.equal(result.rows, 1); assert.equal(result.tables.constructor, 1); assert.equal(result.nullPrototype, true);
  });
  await t.test('sign-out during a partial acquisition clears the raw client counts', { skip: mutant === 'tables' }, async () => {
    await seed(Array.from({ length: 6 }, (_, n) => ({ id: 'more-' + n, value: n + 2 })));
    await page.evaluate(async api => {
      let requests = 0;
      const opener = webDevice();
      const options = { url: api, persona: 'alice', device: { open: (name, backend) => opener.open(name + ':partial', backend) }, waitSeconds: 1,
        fetch: async (url, init) => {
          if (String(url).endsWith('/sync')) {
            init = { ...init, body: JSON.stringify({ ...JSON.parse(init.body), limit: 2 }) };
            if (++requests === 2) await new Promise(resolve => {
              window.partialHeld = true;
              if (init.signal.aborted) resolve(); else init.signal.addEventListener('abort', resolve, { once: true });
            });
          }
          return fetch(url, init);
        } };
      const opened = await prepareClient(options, () => rawClient(options));
      window.partialClient = opened.client;
      window.booleanNotifications = 0;
      partialClient.onAcquired(() => window.booleanNotifications++);
      window.partialOpening = opened.start();
    }, api);
    await page.waitForFunction(() => window.partialHeld && acquisition(partialClient).read().rows > 0);
    const result = await page.evaluate(async () => {
      const before = acquisition(partialClient).read();
      await partialClient.signOut(); await partialOpening;
      return { before, after: acquisition(partialClient).read(), viewer: partialClient.viewer(), acquired: partialClient.acquired,
        read: await partialClient.query({ kind: 'query', name: 'rows' }, {}), booleanNotifications };
    });
    assert.ok(result.before.rows > 0 && !result.before.acquired);
    assert.equal(result.viewer, null); assert.equal(result.read.denied.code, 'E_CLOSED');
    assert.deepEqual(result.after, { acquired: false, rows: 0, tables: {} });
    assert.equal(result.acquired, false);
    assert.equal(result.booleanNotifications, 0, 'unchanged legacy Boolean does not notify');
  });
  await t.test('one update stays bounded for 1,000 and 16,000 colliding rows', async () => {
    const results = await page.evaluate(async () => {
      const keys = [];
      for (let n = 0; keys.length < 16000; n++) {
        const key = 'collision-' + n;
        let hash = 2166136261;
        for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
        if ((hash & 255) === 0) keys.push(key);
      }
      window.collisionKeys = keys;
      const encoder = new TextEncoder(), output = [];
      for (const count of [1000, 16000]) {
        const name = 'bounded-' + count, store = indexedDbPersistence();
        const value = 'x'.repeat(1024);
        await store.save(name, keys.slice(0, count).map(k => ({ s: 'r', k, v: value })));
        const put = IDBObjectStore.prototype.put;
        let bytes = 0, maxBucketBytes = 0, maxEntries = 0, calls = 0;
        IDBObjectStore.prototype.put = function (record) {
          if (this.transaction.db.name === name) {
            calls++; bytes += encoder.encode(JSON.stringify(record)).byteLength;
            if (record.s === '$bucket') { maxBucketBytes = Math.max(maxBucketBytes, encoder.encode(record.v).byteLength); maxEntries = Math.max(maxEntries, JSON.parse(record.v).length); }
          }
          return put.call(this, record);
        };
        try { await store.save(name, [{ s: 'r', k: keys[0], v: 'y'.repeat(1024) }, { s: 'm', k: 'watermark', v: '2' }, { s: 'o', k: 'intent', v: 'pending' }]); }
        finally { IDBObjectStore.prototype.put = put; }
        const loaded = await indexedDbPersistence().load(name);
        output.push({ count, bytes, maxBucketBytes, maxEntries, calls, rows: loaded.filter(c => c.s === 'r').length,
          changed: await store.read(name, 'r', keys[0]), last: await store.read(name, 'r', keys[count - 1]) });
        await store.save(name, [{ s: 'r', k: keys[count - 1], v: 'overflow update' }, { s: 'r', k: keys[0], v: null }]);
        if (await store.read(name, 'r', keys[0]) !== null || await store.read(name, 'r', keys[count - 1]) !== 'overflow update') throw Error('packed/overflow update or delete lost');
        await store.save(name, [{ s: 'r', k: keys[count - 1], v: null }]);
        if (await store.read(name, 'r', keys[count - 1]) !== null) throw Error('deleted overflow row remains readable');
        const reopened = await indexedDbPersistence().load(name);
        if (reopened.some(c => c.s === 'r' && c.k === keys[count - 1])) throw Error('deleted overflow row resurrected on load');
        if (reopened.filter(c => c.s === 'r').length !== count - 2) throw Error('overflow deletion changed the wrong row');
      }
      return output;
    });
    for (const result of results) t.diagnostic(JSON.stringify({ ...result, changed: result.changed.length, last: result.last.length }));
    for (const result of results) {
      assert.equal(result.rows, result.count); assert.equal(result.changed, 'y'.repeat(1024)); assert.equal(result.last, 'x'.repeat(1024));
      assert.ok(result.maxEntries <= 512, 'entry cap'); assert.ok(result.maxBucketBytes <= 262144, 'UTF-8 value cap');
      assert.ok(result.bytes <= 270000, `one update wrote ${result.bytes} bytes in a ${result.count}-row store`);
    }
  });
  await t.test('entry cap, UTF-8 overflow and abort preserve rows, metadata and outbox together', async () => {
    const result = await page.evaluate(async () => {
      const name = 'bounded-atomic', store = indexedDbPersistence(), keys = collisionKeys;
      await store.save(name, keys.slice(0, 1000).map(k => ({ s: 'r', k, v: 'tiny' })).concat([
        { s: 'm', k: 'watermark', v: '1' }, { s: 'o', k: 'intent', v: 'pending' }]));
      const before = await store.load(name), put = IDBObjectStore.prototype.put;
      const huge = '🌏'.repeat(70000);
      const changes = [{ s: 'r', k: keys[0], v: huge }, { s: 'r', k: keys[999], v: 'overflow changed' },
        { s: 'm', k: 'watermark', v: '2' }, { s: 'o', k: 'intent', v: null }];
      let aborted = false;
      IDBObjectStore.prototype.put = function (value) {
        const request = put.call(this, value);
        if (this.transaction.db.name === name && value.s === 'r') { this.transaction.abort(); aborted = true; }
        return request;
      };
      let failed = false;
      try { await store.save(name, changes); } catch { failed = true; }
      finally { IDBObjectStore.prototype.put = put; }
      const after = await indexedDbPersistence().load(name);
      await store.save(name, changes);
      const packed = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('changes', 'readonly'), read = tx.objectStore('changes').get(['$bucket', 'r:0/0']);
          tx.oncomplete = () => { db.close(); resolve(read.result); }; tx.onerror = () => reject(tx.error);
        };
      });
      return { aborted, failed, unchanged: JSON.stringify(before) === JSON.stringify(after), entries: JSON.parse(packed.v).length,
        huge: await store.read(name, 'r', keys[0]) === huge, overflow: await store.read(name, 'r', keys[999]),
        watermark: await store.read(name, 'm', 'watermark'), outbox: await store.read(name, 'o', 'intent') };
    });
    assert.deepEqual(result, { aborted: true, failed: true, unchanged: true, entries: 511,
      huge: true, overflow: 'overflow changed', watermark: '2', outbox: null });
  });
  await t.test('an old unbounded bucket is split at load before later bounded updates', async () => {
    const result = await page.evaluate(async () => {
      const name = 'format-one', rows = [];
      for (let n = 0; rows.length < 1000; n++) {
        const key = 'old-' + n;
        let hash = 2166136261;
        for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
        if ((hash & 255) === 0) rows.push([key, 'z'.repeat(1024)]);
      }
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore('changes', { keyPath: ['s', 'k'] });
          store.put({ s: '$format', k: 'row-buckets', v: '1' });
          store.put({ s: '$bucket', k: 'r:0', v: JSON.stringify(rows) });
        };
        request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
      });
      const store = indexedDbPersistence(), loaded = await store.load(name);
      const physical = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('changes', 'readonly'), read = tx.objectStore('changes').getAll();
          tx.oncomplete = () => { db.close(); resolve(read.result); };
        };
      });
      const packed = physical.filter(c => c.s === '$bucket');
      return { rows: loaded.length, entries: loaded.filter(c => c.s === 'r').length,
        format: physical.find(c => c.s === '$format').v,
        packedEntries: Math.max(...packed.map(c => JSON.parse(c.v).length)),
        packedBytes: Math.max(...packed.map(c => new TextEncoder().encode(c.v).byteLength)),
        first: await store.read(name, 'r', rows[0][0]), last: await store.read(name, 'r', rows.at(-1)[0]) };
    });
    assert.equal(result.entries, 1000); assert.equal(result.first, 'z'.repeat(1024)); assert.equal(result.last, 'z'.repeat(1024));
    assert.equal(result.format, '3'); assert.ok(result.packedEntries <= 512); assert.ok(result.packedBytes <= 262144);
  });
  await t.test('publication clears only a proved deletion range, atomically with rows and the watermark', async () => {
    const result = await page.evaluate(async () => {
      const persistence = indexedDbPersistence(), name = 'bulk-delete', keys = collisionKeys.slice(0, 1400);
      const staged = keys.map(k => ({ s: 's', k, v: 'x'.repeat(1024) }));
      await persistence.save(name, [...staged, { s: 'r', k: 'live', v: 'before' },
        { s: 'm', k: 'watermark', v: '1' }, { s: 'o', k: 'intent', v: 'pending' }]);
      const before = await persistence.load(name);
      const changes = [...keys.map(k => ({ s: 's', k, v: null })), { s: 'r', k: 'live', v: 'after' },
        { s: 'm', k: 'watermark', v: '2' }, { s: 'o', k: 'intent', v: null }];
      const originalDelete = IDBObjectStore.prototype.delete, originalGet = IDBObjectStore.prototype.getAllKeys;
      const stringify = JSON.stringify;
      let abort = true, ranges = 0, singles = 0, encodedImages = 0, limits = [];
      IDBObjectStore.prototype.getAllKeys = function(range, count) {
        if (this.transaction.db.name === name) limits.push(count);
        return originalGet.call(this, range, count);
      };
      IDBObjectStore.prototype.delete = function(key) {
        if (this.transaction.db.name === name) {
          if (key instanceof IDBKeyRange) { ranges++; if (abort) { this.transaction.abort(); return; } }
          else if (key[0] === 's') singles++;
        }
        return originalDelete.call(this, key);
      };
      JSON.stringify = function(value, ...args) {
        if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'string' && value[1].length >= 1024) encodedImages++;
        return stringify.call(this, value, ...args);
      };
      let rejected = false, unchanged;
      try {
        try { await persistence.save(name, changes); } catch { rejected = true; }
        unchanged = stringify(await indexedDbPersistence().load(name)) === stringify(before);
        abort = false;
        await persistence.save(name, changes);
      } finally {
        IDBObjectStore.prototype.delete = originalDelete; IDBObjectStore.prototype.getAllKeys = originalGet; JSON.stringify = stringify;
      }
      const complete = await indexedDbPersistence().load(name);
      // The same optimization must refuse a range with a survivor, even when
      // the requested deletions include nonexistent keys and duplicates.
      await persistence.save(name, staged);
      const partialKeys = [...keys.slice(0, 800), ...keys.slice(0, 50),
        ...Array.from({ length: 1000 }, (_, n) => `absent-${n}`)];
      await persistence.save(name, partialKeys.map(k => ({ s: 's', k, v: null })));
      const survivors = (await indexedDbPersistence().load(name)).filter(c => c.s === 's');
      // A put in that namespace disqualifies the range, preserving call order.
      await persistence.save(name, [...keys.map(k => ({ s: 's', k, v: null })), { s: 's', k: keys[0], v: 'new stage' }]);
      const mixed = (await indexedDbPersistence().load(name)).filter(c => c.s === 's');
      return { rejected, unchanged, ranges, singles, limits, encodedImages,
        complete: complete.filter(c => ['s', 'r', 'm', 'o'].includes(c.s)),
        survivors: survivors.map(c => c.k).sort(), expected: keys.slice(800).sort(), mixed };
    });
    assert.equal(result.rejected, true); assert.equal(result.unchanged, true);
    assert.equal(result.ranges, 2); assert.equal(result.singles, 0);
    assert.deepEqual(result.limits, [1401, 1401], 'probe cost is bounded by unique requested deletions');
    assert.equal(result.encodedImages, 0, 'deletion never encodes an image just to measure its old size');
    assert.deepEqual(result.complete.sort((a,b) => a.s.localeCompare(b.s)), [
      { s: 'm', k: 'watermark', v: '2' }, { s: 'r', k: 'live', v: 'after' }]);
    assert.deepEqual(result.survivors, result.expected);
    assert.equal(result.mixed.length, 1); assert.equal(result.mixed[0].v, 'new stage');
  });
  await t.test('cold row batches use 64 bounded buckets in one strict transaction', async () => {
    const result = await page.evaluate(async () => {
      const name='acquisition-buckets', store=indexedDbPersistence();
      await store.load(name);
      const put=IDBObjectStore.prototype.put, get=IDBObjectStore.prototype.get, transaction=IDBDatabase.prototype.transaction;
      let gets=0,buckets=0,transactions=0,strict=true;
      IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);if(this.name===name&&tx.mode==='readwrite'){transactions++;strict&&=tx.durability==='strict';}return tx;};
      IDBObjectStore.prototype.get=function(...args){if(this.transaction.db.name===name)gets++;return get.apply(this,args);};
      IDBObjectStore.prototype.put=function(row,...args){if(this.transaction.db.name===name&&row.s==='$bucket')buckets++;return put.call(this,row,...args);};
      const rows=Array.from({length:10000},(_,n)=>({s:'s',k:`row-${n}`,v:`${n}:`+'x'.repeat(250)}));
      try {await store.save(name,rows.concat([{s:'m',k:'watermark',v:'one'}]));}
      finally{IDBObjectStore.prototype.put=put;IDBObjectStore.prototype.get=get;IDBDatabase.prototype.transaction=transaction;}
      const restored=await indexedDbPersistence().load(name), expected=new Map(rows.map(r=>[r.k,r.v]));
      return {gets,buckets,transactions,strict,rows:restored.filter(r=>r.s==='s').length,
        correct:restored.filter(r=>r.s==='s').every(r=>expected.get(r.k)===r.v),watermark:await store.read(name,'m','watermark')};
    });
    assert.deepEqual(result,{gets:64,buckets:64,transactions:1,strict:true,rows:10000,correct:true,watermark:'one'});
  });
  await t.test('a root split, later child writes and their conditional commit are atomic', async () => {
    const result=await page.evaluate(async()=>{
      const name='split-atomic',store=indexedDbPersistence(),keys=[];
      for(let n=0;keys.length<513;n++){
        const key=`split-${n}`;let hash=2166136261;for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619);
        if((hash&63)===0)keys.push(key);
      }
      await store.save(name,keys.slice(0,512).map(k=>({s:'r',k,v:`old:${k}`})).concat([{s:'m',k:'watermark',v:'old'},{s:'o',k:'intent',v:'kept'}]));
      const before=await store.load(name),put=IDBObjectStore.prototype.put;
      let rejected=false,aborted=false;
      IDBObjectStore.prototype.put=function(row,...args){const req=put.call(this,row,...args);if(this.transaction.db.name===name&&row.k==='r:0/0'){aborted=true;this.transaction.abort();}return req;};
      const delta=[{s:'r',k:keys[512],v:'new'},{s:'m',k:'watermark',v:'new'},{s:'o',k:'intent',v:null}];
      try{await store.save(name,delta);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
      const unchanged=JSON.stringify(await store.load(name))===JSON.stringify(before);
      await store.save(name,delta);
      let current=true,checks=0;
      IDBObjectStore.prototype.put=function(row,...args){const req=put.call(this,row,...args);if(this.transaction.db.name===name&&row.s==='$bucket')current=false;return req;};
      let accepted;try{accepted=await store.saveIfCurrent(name,[{s:'r',k:keys[0],v:'stale'}],()=>{checks++;return current;});}finally{IDBObjectStore.prototype.put=put;}
      const all=await indexedDbPersistence().load(name);
      return {rejected,aborted,unchanged,accepted,checks,rows:all.filter(r=>r.s==='r').length,
        allValues:keys.every((k,i)=>all.some(row=>row.s==='r'&&row.k===k&&row.v===(i===512?'new':`old:${k}`))),
        old:await store.read(name,'r',keys[0])===`old:${keys[0]}`,added:await store.read(name,'r',keys[512]),watermark:await store.read(name,'m','watermark'),outbox:await store.read(name,'o','intent')};
    });
    assert.deepEqual(result,{rejected:true,aborted:true,unchanged:true,accepted:false,checks:1,rows:513,allValues:true,old:true,added:'new',watermark:'new',outbox:null});
  });
  await t.test('format two migration keeps packed and overflow rows, stage, watermark and outbox across abort', async()=>{
    const result=await page.evaluate(async()=>{
      const name='format-two',key='old-packed';let hash=2166136261;for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619);
      await new Promise((resolve,reject)=>{
        const open=indexedDB.open(name,1);open.onupgradeneeded=()=>{
          const store=open.result.createObjectStore('changes',{keyPath:['s','k']});
          for(const row of [{s:'$format',k:'row-buckets',v:'2'},
            {s:'$bucket',k:`r:${hash&255}`,v:JSON.stringify([[key,'packed']]),spill:true},
            {s:'$bucket',k:`b:${hash&255}`,v:JSON.stringify([[key,'base packed']]),spill:true},
            {s:'b',k:'base-overflow',v:'old base overflow'},
            {s:'r',k:'overflow',v:'old overflow'},{s:'s',k:'stage',v:'unpublished'},
            {s:'m',k:'watermark',v:'seven'},{s:'o',k:'intent',v:'pending'}])store.put(row);
        };open.onsuccess=()=>{open.result.close();resolve();};open.onerror=()=>reject(open.error);
      });
      const store=indexedDbPersistence(),prior=await store.read(name,'r',key),put=IDBObjectStore.prototype.put;
      const migrationDurability=[];
      let rejected=false;IDBObjectStore.prototype.put=function(row,...args){const req=put.call(this,row,...args);if(this.transaction.db.name===name&&row.s==='$bucket'){migrationDurability.push(this.transaction.durability);this.transaction.abort();}return req;};
      try{await store.load(name);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
      const afterAbort={packed:await store.read(name,'r',key),overflow:await store.read(name,'r','overflow'),
        base:await store.read(name,'b',key),baseOverflow:await store.read(name,'b','base-overflow'),format:await store.read(name,'$format','row-buckets')};
      IDBObjectStore.prototype.put=function(row,...args){if(this.transaction.db.name===name&&row.s==='$format'&&row.v==='3')migrationDurability.push(this.transaction.durability);return put.call(this,row,...args);};
      try{await store.load(name);}finally{IDBObjectStore.prototype.put=put;}
      const migratedBase={packed:await store.read(name,'b',key),overflow:await store.read(name,'b','base-overflow')};
      await store.save(name,[{s:'r',k:'overflow',v:'updated'},{s:'b',k:'base-overflow',v:'updated base'}]);
      const all=await indexedDbPersistence().load(name);
      return {prior,rejected,afterAbort,migrationDurability,migratedBase,
        updatedBase:await store.read(name,'b','base-overflow'),base:await store.read(name,'b',key),
        all:all.sort((a,b)=>(a.s+a.k).localeCompare(b.s+b.k)),overflow:await store.read(name,'r','overflow'),format:await store.read(name,'$format','row-buckets')};
    });
    assert.equal(result.prior,'packed');assert.equal(result.rejected,true);
    assert.deepEqual(result.afterAbort,{packed:'packed',overflow:'old overflow',base:'base packed',baseOverflow:'old base overflow',format:'2'});
    assert.deepEqual(result.migratedBase,{packed:'base packed',overflow:'old base overflow'});
    assert.equal(result.base,'base packed');assert.equal(result.updatedBase,'updated base');
    assert.deepEqual(result.all,[{s:'b',k:'base-overflow',v:'updated base'},{s:'b',k:'old-packed',v:'base packed'},{s:'m',k:'watermark',v:'seven'},{s:'o',k:'intent',v:'pending'},{s:'r',k:'old-packed',v:'packed'},{s:'r',k:'overflow',v:'updated'},{s:'s',k:'stage',v:'unpublished'}]);
    assert.equal(result.overflow,'updated');assert.equal(result.format,'3');
    assert.deepEqual(result.migrationDurability,['strict','strict']);
  });
  await t.test('format three fences the actual pre-AQ adapter and preserves existing stores', async () => {
    const result = await page.evaluate(async () => {
      const name = 'pre-aq-version-fence', old = preAqStore(indexedDbPersistence().claim);
      // Keep another object store at physical version 1: the upgrade must retain it too.
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('changes', { keyPath: ['s', 'k'] })
            .put({ s: '$format', k: 'row-buckets', v: '2' });
          request.result.createObjectStore('extra').put('kept', 'sentinel');
        };
        request.onsuccess = () => { request.result.close(); resolve(); };
        request.onerror = () => reject(request.error);
      });
      const rows = Array.from({ length: 600 }, (_, i) => ({ s: 'r', k: `row-${i}`, v: `value-${i}` }));
      const metadata = [{ s: 'm', k: 'watermark', v: '1' }, { s: 'o', k: 'intent', v: 'pending' },
        { s: 's', k: 'stage', v: 'unpublished' }, { s: 'b', k: 'base', v: 'confirmed' }];
      await old.save(name, [...rows, ...metadata]);
      const sort = rows => rows.toSorted((a, b) => (a.s + a.k).localeCompare(b.s + b.k));
      const before = sort(await old.load(name)), current = indexedDbPersistence();
      const migrated = sort(await current.load(name));
      const rejected = [];
      // The cached owner and a fresh old owner must both fail before reading or writing.
      for (const adapter of [old, preAqStore(indexedDbPersistence().claim)]) {
        for (const operation of [() => adapter.load(name), () => adapter.read(name, 'r', 'row-0'),
          () => adapter.save(name, [{ s: 'r', k: 'row-0', v: null }, { s: 'm', k: 'watermark', v: '2' }]),
          () => adapter.save(name, [{ s: 'r', k: 'row-1', v: 'stale direct update' }])]) {
          try { await operation(); rejected.push(null); }
          catch (error) { rejected.push({ name: error.name, message: error.message }); }
        }
      }
      const afterOld = sort(await indexedDbPersistence().load(name));
      await current.save(name, [{ s: 'r', k: 'row-0', v: null }, { s: 'r', k: 'row-1', v: 'new packed update' },
        { s: 'm', k: 'watermark', v: '2' }]);
      const reopened = indexedDbPersistence(), after = await reopened.load(name);
      const physical = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('extra'), sentinel = tx.objectStore('extra').get('sentinel');
          tx.oncomplete = () => { resolve({ version: db.version, sentinel: sentinel.result }); db.close(); };
          tx.onabort = () => { db.close(); reject(tx.error); };
        };
        request.onerror = () => reject(request.error);
      });
      // Brand-new format-3 stores must fence the old adapter too.
      await current.save('fresh-version-fence', rows);
      let freshError;
      try { await old.load('fresh-version-fence'); } catch (error) { freshError = error.name; }
      return { before, migrated, afterOld, rejected, physical, freshError, count: after.filter(row => row.s === 'r').length,
        deleted: await reopened.read(name, 'r', 'row-0'), updated: await reopened.read(name, 'r', 'row-1'),
        watermark: await reopened.read(name, 'm', 'watermark'), format: await reopened.read(name, '$format', 'row-buckets') };
    });
    assert.equal(result.before.length, 604);
    assert.deepEqual(result.migrated, result.before);
    assert.equal(result.rejected.length, 8);
    for (const error of result.rejected) {
      assert.equal(error?.name, 'VersionError');
      assert.match(error.message, /requested version.*less than.*existing version/i);
    }
    assert.deepEqual(result.afterOld, result.before);
    assert.deepEqual(result.physical, { version: 2, sentinel: 'kept' });
    assert.equal(result.freshError, 'VersionError');
    assert.equal(result.count, 599);
    assert.equal(result.deleted, null);
    assert.equal(result.updated, 'new packed update');
    assert.equal(result.watermark, '2');
    assert.equal(result.format, '3');
  });
  await t.test('both browser devices acquire every page and reopen complete offline', async()=>{
    await seed(Array.from({length:12000},(_,n)=>({id:`acq-${String(n).padStart(5,'0')}`,value:n})));
    for(const worker of [false,true]){
      const result=await page.evaluate(async({api,worker})=>{
        let offline=false,pages=0;const opener=webDevice({worker}),suffix=worker?':complete-worker':':complete-default';
        const options={url:api,persona:'alice',device:{open:(name,backend)=>opener.open(name+suffix,backend)},waitSeconds:1,
          fetch:async(url,init)=>{if(offline)throw new TypeError('offline');if(String(url).endsWith('/sync'))pages++;return fetch(url,init);}};
        const prepared=await prepareClient(options,()=>rawClient(options)),client=prepared.client,progress=[];
        const stop=acquisition(client).subscribe(()=>progress.push({...acquisition(client).read()}));
        await prepared.start();stop();const acquired=client.acquired;await client.close();offline=true;
        const reopened=await rawClient(options),rows=[];let c=null;
        do{const read=await reopened.query({kind:'query',name:'all'},{c});if(!read.complete)throw Error(JSON.stringify(read));rows.push(...read.data);c=read.next??null;}while(c);
        const kept=rows.filter(r=>r.id.startsWith('acq-')),residency=await reopened.residency();
        const correct=kept.every(r=>r.value===Number(r.id.slice(4))),reopenedAcquired=reopened.acquired;await reopened.close();
        return {acquired,reopenedAcquired,pages,count:kept.length,unique:new Set(kept.map(r=>r.id)).size,correct,progress,residency:residency.tables.constructor.rows};
      },{api,worker});
      assert.equal(result.acquired,true);assert.equal(result.reopenedAcquired,true);assert.equal(result.count,12000);assert.equal(result.unique,12000);assert.equal(result.correct,true);
      assert.ok(result.residency>=12000);assert.equal(result.pages,3);
      assert.ok(result.progress.some(p=>p.rows>0&&!p.acquired));assert.equal(result.progress.at(-1).acquired,true);
      assert.equal(result.progress.at(-1).rows,result.residency);
    }
  });
  assert.deepEqual(errors, []);
});

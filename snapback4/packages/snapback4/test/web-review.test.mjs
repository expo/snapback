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
`);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const mutant = process.env.SNAPBACK4_WEB_REVIEW_MUTANT;
  const sourceOverrides = {};
  const path = name => join(root, 'packages/snapback4/src', name);
  if (mutant === 'delivery-guard') sourceOverrides[path('web-idb.ts')] = readFileSync(path('web-idb.ts'), 'utf8').replace('if (!current())', 'if (false)');
  if (mutant === 'reset') sourceOverrides[path('acquisition.ts')] = readFileSync(path('acquisition.ts'), 'utf8').replace('reset() { publish(empty); }', 'reset() {}');
  if (mutant === 'tables') sourceOverrides[path('acquisition.ts')] = readFileSync(path('acquisition.ts'), 'utf8').replaceAll('Object.create(null)', '{}');
  if (mutant === 'overflow-delete') sourceOverrides[path('web-idb-buckets.ts')] = readFileSync(path('web-idb-buckets.ts'), 'utf8')
    .replace('if (prior === undefined && spill) store.delete([s, change.k]);', '/* mutant: leave deleted overflow rows on disk */');
  for (const [name, selected] of [['local.ts', 'progress'], ['web-idb.ts', 'buckets']]) if (mutant === selected) {
    sourceOverrides[path(name)] = execFileSync('git', ['show', `18f3754fc:snapback4/packages/snapback4/src/${name}`], { cwd: root, encoding: 'utf8' });
  }
  const witness = await launch({ seed: [], sourceDir, sourceOverrides, entrySource: `
import { acquisition } from '${path('acquisition.ts')}';
import { prepareClient } from '${path('client-start.ts')}';
import { createLocalClient as rawClient } from '${path('local.ts')}';
Object.assign(window, { acquisition, prepareClient, rawClient });
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
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('changes', 'readonly'), read = tx.objectStore('changes').get(['$bucket', 'r:0']);
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
      const physical = await new Promise(resolve => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('changes', 'readonly'), read = tx.objectStore('changes').getAll();
          tx.oncomplete = () => { db.close(); resolve(read.result); };
        };
      });
      const packed = physical.find(c => c.s === '$bucket');
      return { rows: loaded.length, entries: loaded.filter(c => c.s === 'r').length,
        format: physical.find(c => c.s === '$format').v, packedEntries: JSON.parse(packed.v).length, packedBytes: new TextEncoder().encode(packed.v).byteLength,
        first: await store.read(name, 'r', rows[0][0]), last: await store.read(name, 'r', rows.at(-1)[0]) };
    });
    assert.equal(result.entries, 1000); assert.equal(result.first, 'z'.repeat(1024)); assert.equal(result.last, 'z'.repeat(1024));
    assert.equal(result.format, '2'); assert.ok(result.packedEntries <= 512); assert.ok(result.packedBytes <= 262144);
  });
  assert.deepEqual(errors, []);
});

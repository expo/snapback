import { DurableRows, type DurableRowsTx, type DirectoryRecord } from '../src/durable-rows.js';
import { directoryScopeKeys, imageScopeKeys, indexPrefix, prefixRange, scalarFromKey, stringFromKey, KEY_END } from '../src/durable-key.js';
import { RowImage } from '../../evaluator/src/row-image.js';
import { SEARCH_CONTRACT } from '../../evaluator/src/unicode.js';
import type { HeldProgram } from '../src/store/range-store.js';

const schema = { tables: { messages: { columns: {
  id: 'Id', group: 'Id', at: 'Int', body: { Text: { max: 100 } }, optional: { Optional: 'Int' },
}, indexes: {
  byId: { components: [{ Column: 'id' }], unique: true },
  byTime: { components: [{ Column: 'at' }], unique: false },
  search: { components: [{ Column: 'group' }, { WordPrefixes: { fields: ['body'], contract: SEARCH_CONTRACT } },
    { Column: 'at' }, { Column: 'id' }], unique: false },
} } } };
const program = { schema, schemaHash: 'durable-rows-test-schema', generation: 'durable-rows-test-generation', programs: {} } as unknown as HeldProgram;
const check = (value: unknown, message: string): void => { if (!value) throw Error(message); };
const json = (value: unknown) => JSON.stringify(value, (_key, v) => v instanceof ArrayBuffer ? [...new Uint8Array(v)]
  : ArrayBuffer.isView(v) ? [...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)] : v);
const equal = (actual: unknown, expected: unknown, message: string): void => { check(json(actual) === json(expected), `${message}: ${json(actual)} != ${json(expected)}`); };
async function refuses(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await work; } catch (error) { check(pattern.test(String(error)), `unexpected refusal: ${String(error)}`); return; }
  throw Error(`expected refusal ${pattern}`);
}
function prepared(id: string, seq: number, body = 'Coffee coffee CAFÉ', at = 1, group = 'g') {
  const row = RowImage.fromWire(schema, 'messages', { id, group, at, body }, message => { throw Error(message); }, program.schemaHash);
  return { table: 'messages', id, row, seq };
}
function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function withStore(run: (store: DurableRows, name: string) => Promise<void>): Promise<void> {
  const name = `durable-rows-controls:${crypto.randomUUID()}`;
  const store = await DurableRows.open(name, program);
  try { await run(store, name); } finally { store.close(); await req(indexedDB.deleteDatabase(name)); }
}
async function snapshot(store: DurableRows): Promise<unknown> {
  return store.transaction('readonly', async tx => {
    const records = await Promise.all(['pages', 'blocks', 'meta', 'proofs', 'scopes'].map(async name => {
      const store = tx.idb.objectStore(name), keys = tx.request(store.getAllKeys()), values = tx.request(store.getAll());
      return [name, await keys, await values];
    }));
    return records;
  });
}
async function indexed(tx: DurableRowsTx, index: 'keys' | 'scopeKeys', range: IDBKeyRange): Promise<DirectoryRecord[]> {
  const rows: DirectoryRecord[] = [], map = index === 'keys' ? tx.postings : tx.memberships;
  const bounds = index === 'scopeKeys' ? { lower: range.lower, upper: [...range.upper as IDBValidKey[], KEY_END], upperOpen: true }
    : { lower: range.lower, upper: range.upper, lowerOpen: range.lowerOpen, upperOpen: range.upperOpen };
  for await (const entry of map.seek(bounds)) {
    const key = entry.key as IDBValidKey[], id = scalarFromKey(key.at(-1)!);
    if (id === 'Null' || !('Id' in id)) throw Error('posting has no nominal Id tie');
    const record = await tx.directory(stringFromKey(key[0]), id.Id);
    check(record, 'posting has no directory'); rows.push(record!);
  }
  return rows;
}
const allIndex = (index: string) => prefixRange(indexPrefix('messages', index, []));

/** Real IndexedDB controls, bundled with the combined query-host suite in one allocated browser. */
export async function runDurableRowsControls(): Promise<Array<{ name: string; pass: boolean; error?: string }>> {
  const results: Array<{ name: string; pass: boolean; error?: string }> = [];
  async function test(name: string, run: () => Promise<void>) {
    try { await run(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error instanceof Error ? error.stack : String(error) }); }
  }

  await test('bounded pages, exact Unicode postings and ID tie order, empty-word scopes', () => withStore(async store => {
    const rows = Array.from({ length: 600 }, (_, i) => prepared(`m${String(i).padStart(3, '0')}`, 1));
    rows.push(prepared('\u{10000}', 1, '---'), prepared('\ue000', 1, '---'));
    let callbackFinished = false, commitCompleted = false;
    const changes = await store.transaction('readwrite', async tx => {
      const complete = tx.idb.oncomplete;
      tx.idb.oncomplete = event => { commitCompleted = true; complete?.call(tx.idb, event); };
      const changes = await tx.putRows(rows, 1);
      await tx.putMeta('state', { seq: 1, packets: ['earned-after-commit'] });
      callbackFinished = true; return changes;
    });
    check(callbackFinished && commitCompleted, 'transaction published before its complete event');
    equal(changes.length, 602, 'every new directory returned');
    await store.transaction('readonly', async tx => {
      const pages = await tx.request(tx.idb.objectStore('pages').getAll());
      equal(pages.map(encoded => JSON.parse(encoded).length), [256, 256, 90], 'page widths');
      const byTime = await indexed(tx, 'keys', allIndex('byTime'));
      equal(byTime.slice(-2).map(row => row.id), ['\ue000', '\u{10000}'], 'codepoint Id tie independent of UTF16 primary key');
      const prefix = indexPrefix('messages', 'search', [{ Scalar: { Id: 'g' } },
        { WordPrefix: { token: 'cof' } } as any]);
      equal((await indexed(tx, 'keys', prefixRange(prefix))).length, 600, 'repeated coffee creates one prefix posting per row');
      const normalized = indexPrefix('messages', 'search', [{ Scalar: { Id: 'g' } },
        { WordPrefix: { token: 'café' } } as any]);
      equal((await indexed(tx, 'keys', prefixRange(normalized))).length, 600, 'Unicode normalized prefix');
      const scope = directoryScopeKeys('messages', rows[0].row)[0];
      equal((await indexed(tx, 'scopeKeys', IDBKeyRange.only(scope))).length, 602, 'punctuation-only bodies retain derived scopes');
      const directory = (await tx.directory('messages', 'm000'))!;
      check(RowImage.equal(await tx.row(directory), rows[0].row), 'selected row roundtrip changed typed/omitted meaning');
      equal(directory.parts, RowImage.keys(rows[0].row), 'directory stores one logical component image');
    });
  }));

  await test('one touched page cache, immutable published image, metadata-only cold open', () => withStore(async (store, name) => {
    await store.transaction('readwrite', tx => tx.putRows(Array.from({ length: 300 }, (_, i) => prepared(`m${i}`, 1)), 1));
    store.close();
    const originalGet = IDBObjectStore.prototype.get, originalGetAll = IDBObjectStore.prototype.getAll;
    const reads: string[] = [];
    IDBObjectStore.prototype.get = function(...args: Parameters<IDBObjectStore['get']>) {
      if (this.transaction.db.name === name) reads.push(this.name); return originalGet.apply(this, args);
    };
    IDBObjectStore.prototype.getAll = function(...args: Parameters<IDBObjectStore['getAll']>) {
      if (this.transaction.db.name === name) reads.push(`${this.name}:all`); return originalGetAll.apply(this, args);
    };
    let reopened: DurableRows | undefined;
    try {
      reopened = await DurableRows.open(name, program);
      equal(reads, ['meta'], 'open must not read rows, directory or proofs'); reads.length = 0;
      const image = await reopened.transaction('readonly', async tx => {
        const a = (await tx.directory('messages', 'm0'))!, b = (await tx.directory('messages', 'm1'))!;
        await tx.row(a); return tx.row(b);
      });
      equal(reads.filter(name => name === 'pages').length, 1, 'two selected siblings load one physical page');
      check(RowImage.is(image) && Object.isFrozen(image), 'published image is not nominal and immutable');
      equal(RowImage.wire(image!).id, 'm1', 'image remains usable after transaction end');
    } finally {
      IDBObjectStore.prototype.get = originalGet; IDBObjectStore.prototype.getAll = originalGetAll;
      reopened?.close();
    }
  }));

  await test('updates touch only named pages; tombstone keeps sequence and removes every posting', () => withStore(async store => {
    await store.transaction('readwrite', tx => tx.putRows(Array.from({ length: 600 }, (_, i) => prepared(`m${i}`, 1)), 1));
    const before = await store.transaction('readonly', tx => tx.request(tx.idb.objectStore('pages').getAll()));
    const old = await store.transaction('readonly', tx => tx.directory('messages', 'm1'));
    const changes = await store.transaction('readwrite', tx => tx.putRows([
      prepared('m0', 2, 'Changed', 2), { table: 'messages', id: 'm1', row: null, seq: 2 },
    ], 2));
    equal(changes.length, 2, 'changed pairs'); equal(changes[1].before, old, 'scope upkeep gets exact old keys');
    equal(changes[1].after.parts, {}, 'tombstone index parts'); equal(imageScopeKeys('messages', changes[1].after.parts), [], 'tombstone scopes');
    await store.transaction('readonly', async tx => {
      const pages = await tx.request(tx.idb.objectStore('pages').getAll());
      check(pages[0] !== before[0], 'changed page missing'); equal(pages.slice(1), before.slice(1), 'untouched page bytes');
      const tombstone = (await tx.directory('messages', 'm1'))!;
      equal(tombstone.seq, 2, 'tombstone version'); equal(await tx.row(tombstone), null, 'tombstone body');
      equal((await indexed(tx, 'keys', allIndex('byId'))).length, 599, 'dead row must leave all ordinary postings');
    });
    await store.transaction('readwrite', tx => tx.putRows([prepared('m1', 3)], 3));
    await store.transaction('readonly', async tx => check(await tx.row((await tx.directory('messages', 'm1'))!), 'higher-version resurrection'));
  }));

  await test('same-sequence contradiction and stale/duplicate delivery abort all stores; retry succeeds', () => withStore(async store => {
    await store.transaction('readwrite', async tx => { await tx.putRows([prepared('m', 2)], 2); await tx.putMeta('state', { seq: 2 }); });
    const before = await snapshot(store);
    equal(await store.transaction('readwrite', tx => tx.putRows([prepared('m', 2)], 2)), [], 'same-sequence identical body is a no-op');
    for (const [rows, seq, error] of [
      [[prepared('m', 2, 'different')], 2, /contradictory/],
      [[prepared('m', 1)], 1, /behind/],
      [[prepared('m', 3), prepared('m', 3)], 3, /duplicate/],
    ] as const) {
      await refuses(store.transaction('readwrite', async tx => {
        tx.idb.objectStore('proofs').put({ attempt: true }, 'proof');
        await tx.putMeta('state', { seq });
        await tx.putRows(rows, seq);
      }), error);
      equal(await snapshot(store), before, 'refusal must roll back pages, directory blocks, metadata and proofs');
    }
    await store.transaction('readwrite', tx => tx.putRows([prepared('m', 3, 'retry')], 3));
    await store.transaction('readonly', async tx => equal(RowImage.wire((await tx.row((await tx.directory('messages', 'm'))!))!).body, 'retry', 'retry body'));
  }));

  await test('late request error after explicit commit aborts pages and all companion obligations, then cold retry', () => withStore(async (store, name) => {
    await store.transaction('readwrite', async tx => { await tx.putRows([prepared('m', 1)], 1); await tx.putMeta('collision', 'existing'); });
    const before = await snapshot(store);
    let callbackFinished = false, commitCalled = false, published = false;
    await refuses(store.transaction('readwrite', async tx => {
      await tx.putRows([prepared('m', 2, 'uncommitted')], 2);
      await tx.putMeta('state', { seq: 2, packets: ['must-roll-back'] });
      tx.idb.objectStore('proofs').put({ proof: 'must-roll-back' }, 'proof');
      tx.idb.objectStore('scopes').put({ count: 999 }, 'scope');
      tx.idb.objectStore('meta').add('duplicate', 'collision');
      const commit = tx.idb.commit.bind(tx.idb);
      tx.idb.commit = () => { commitCalled = true; commit(); };
      callbackFinished = true;
    }).then(() => { published = true; }), /ConstraintError/);
    check(callbackFinished && commitCalled && !published, 'must exercise asynchronous failure after explicit commit');
    equal(await snapshot(store), before, 'late abort changed committed five-store state');
    store.close(); const reopened = await DurableRows.open(name, program);
    try {
      equal(await snapshot(reopened), before, 'cold reopen after abort');
      await reopened.transaction('readwrite', async tx => { await tx.putRows([prepared('m', 2, 'retry')], 2); await tx.putMeta('state', { seq: 2 }); });
      await reopened.transaction('readonly', async tx => equal(RowImage.wire((await tx.row((await tx.directory('messages', 'm'))!))!).body, 'retry', 'cold retry'));
    } finally { reopened.close(); }
  }));

  await test('directory/body mismatches refuse on touch; unrelated corrupt page does not force eager hydration', () => withStore(async (store, name) => {
    await store.transaction('readwrite', tx => tx.putRows(Array.from({ length: 300 }, (_, i) => prepared(`m${i}`, 1)), 1));
    const first = (await store.transaction('readonly', tx => tx.directory('messages', 'm0')))!;
    const later = (await store.transaction('readonly', tx => tx.directory('messages', 'm299')))!;
    await store.transaction('readwrite', tx => tx.request(tx.idb.objectStore('pages').put('malformed JSON', later.page)));
    store.close(); const reopened = await DurableRows.open(name, program);
    try {
      await reopened.transaction('readonly', async tx => check(await tx.row(first), 'untouched corruption prevented unrelated read'));
      await refuses(reopened.transaction('readonly', tx => tx.row(later)), /JSON|Unexpected/);
      await reopened.transaction('readwrite', tx => tx.directories.apply([{ kind: 'put', key: [first.table, first.id], value: { ...first, parts: {} } }]));
      await refuses(reopened.transaction('readonly', async tx => tx.row((await tx.directory('messages', 'm0'))!)), /indexes disagree/);
    } finally { reopened.close(); }
  }));

  await test('caller directory alias, mismatched slot and sequence fail closed', () => withStore(async store => {
    await store.transaction('readwrite', tx => tx.putRows([prepared('a', 1), prepared('b', 1)], 1));
    const record = (await store.transaction('readonly', tx => tx.directory('messages', 'a')))!;
    await refuses(store.transaction('readonly', tx => tx.row({ ...record, seq: 2 })), /directory changed/);
    await store.transaction('readwrite', tx => tx.directories.apply([{ kind: 'put', key: [record.table, record.id], value: { ...record, slot: 1 } }]));
    await refuses(store.transaction('readonly', async tx => tx.row((await tx.directory('messages', 'a'))!)), /page and directory disagree/);
  }));

  await test('equivalent index declaration order preserves directory meaning across open', () => withStore(async (store, name) => {
    const original = prepared('m', 1);
    await store.transaction('readwrite', tx => tx.putRows([original], 1)); store.close();
    const reordered = structuredClone(program);
    (reordered.schema as any).tables.messages.indexes = Object.fromEntries(Object.entries(schema.tables.messages.indexes).reverse());
    const reopened = await DurableRows.open(name, reordered);
    try {
      await reopened.transaction('readonly', async tx => check(RowImage.equal(await tx.row((await tx.directory('messages', 'm'))!), original.row), 'index declaration order changed row admission'));
    } finally { reopened.close(); }
  }));

  await test('derived totals include termless rows and refuse missing established count custody', () => withStore(async store => {
    await store.transaction('readwrite', tx => tx.putRows([prepared('a', 1, '---'), prepared('b', 1)], 1));
    await store.transaction('readonly', async tx => equal(await tx.scopeTotal('messages', 'search'), 2, 'termless source still counts'));
    await store.transaction('readwrite', tx => tx.putRows([prepared('a', 2, 'different'), prepared('b', 2, 'Coffee', 2, 'other')], 2));
    await store.transaction('readonly', async tx => equal(await tx.scopeTotal('messages', 'search'), 2, 'body/scope movement preserves source total'));
    await store.transaction('readwrite', tx => tx.putRows([{ table: 'messages', id: 'a', row: null, seq: 3 }], 3));
    const counts = await store.transaction('readonly', tx => tx.getMeta('indexCounts'));
    await store.transaction('readonly', async tx => equal(await tx.scopeTotal('messages', 'search'), 1, 'tombstone removes source total'));
    const before = await snapshot(store);
    for (const partial of [true, false]) {
      await store.transaction('readwrite', async tx => {
        if (partial) await tx.putMeta('indexCounts', []);
        else await tx.request(tx.idb.objectStore('meta').delete('indexCounts'));
      });
      await refuses(store.transaction('readonly', tx => tx.scopeTotal('messages', 'search')), /counts? (is|are) absent/);
      await store.transaction('readwrite', tx => tx.putMeta('indexCounts', counts));
      equal(await snapshot(store), before, 'metadata repair leaves all rows/index blocks untouched');
    }
  }));

  await test('bootstrap peek leaves missing database absent and reads only exact-format metadata', async () => {
    const absent = `durable-rows-absent:${crypto.randomUUID()}`;
    equal(await DurableRows.peek(absent), {}, 'fresh peek');
    check(!(await indexedDB.databases()).some(db => db.name === absent), 'peek persisted an empty new database');
    await withStore(async (store, name) => {
      const state = { principal: 'fixture', seq: 1, packets: ['pending'] };
      await store.transaction('readwrite', async tx => {
        await tx.putRows([prepared('m', 1)], 1);
        await tx.putMeta('program', program); await tx.putMeta('state', state);
      });
      const originalGet = IDBObjectStore.prototype.get;
      const reads: string[] = [];
      IDBObjectStore.prototype.get = function(...args: Parameters<IDBObjectStore['get']>) {
        if (this.transaction.db.name === name) reads.push(this.name); return originalGet.apply(this, args);
      };
      try {
        const held = await DurableRows.peek(name);
        equal(held, { program, state }, 'peek raw held metadata'); equal(reads, ['meta', 'meta', 'meta'], 'peek must not hydrate body/directory/proofs');
      } finally { IDBObjectStore.prototype.get = originalGet; }
    });
  });

  await test('old physical format is refused intact, without upgrade or silent migration', async () => {
    const name = `durable-rows-old:${crypto.randomUUID()}`, opening = indexedDB.open(name, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result; db.createObjectStore('pages').put('old-page', 4);
      db.createObjectStore('meta').put('old-state', 'state'); db.createObjectStore('proofs');
    };
    const old = await req(opening); old.close();
    try {
      await refuses(DurableRows.open(name, program), /incompatible physical stores/);
      await refuses(DurableRows.peek(name), /incompatible physical stores/);
      const verify = await req(indexedDB.open(name, 1));
      try {
        equal([...verify.objectStoreNames], ['meta', 'pages', 'proofs'], 'old store schema changed');
        equal(await req(verify.transaction('pages').objectStore('pages').get(4)), 'old-page', 'old page changed');
      } finally { verify.close(); }
    } finally { await req(indexedDB.deleteDatabase(name)); }
  });
  return results;
}

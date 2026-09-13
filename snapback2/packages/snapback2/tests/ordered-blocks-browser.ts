// @ref LLP 1018.008.007.002#11-block-index-acquisition-restart — real IDB is the
// ordering oracle; controls exercise the physical map independently of Quarry.
import { OrderedBlocks, type OrderedBounds, type OrderedChange, type OrderedEntry } from '../src/ordered-blocks.js';

type Result = { name: string; pass: boolean; error?: string };
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
async function refuses(work: () => unknown | Promise<unknown>, pattern = /ordered blocks|DataError/): Promise<void> {
  try { await work(); } catch (error) { check(pattern.test(String(error)), `unexpected refusal: ${String(error)}`); return; }
  throw Error(`expected refusal ${pattern}`);
}
async function open(name: string): Promise<IDBDatabase> {
  const request = indexedDB.open(name, 1); request.onupgradeneeded = () => request.result.createObjectStore('blocks');
  return req(request);
}
async function withDB(work: (db: IDBDatabase, name: string) => Promise<void>): Promise<void> {
  const name = `ordered-block-controls:${crypto.randomUUID()}`, db = await open(name);
  try { await work(db, name); } finally { db.close(); await req(indexedDB.deleteDatabase(name)); }
}
async function transaction<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (tx: IDBTransaction, map: OrderedBlocks<any>) => Promise<T>): Promise<T> {
  const tx = db.transaction('blocks', mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new DOMException('Aborted', 'AbortError'));
  });
  void done.catch(() => undefined);
  try {
    const result = await work(tx, new OrderedBlocks(tx, 'blocks', 'n'));
    if (tx.error) throw tx.error;
    if (mode === 'readwrite') tx.commit();
    await done; return result;
  } catch (error) { try { tx.abort(); } catch { /* already complete or aborted */ } await done.catch(() => undefined); throw error; }
}
const puts = (start: number, count: number): OrderedChange<number>[] => Array.from({ length: count }, (_, i) => ({ kind: 'put', key: start + i, value: start + i }));
async function collect<V>(map: OrderedBlocks<V>, bounds?: OrderedBounds): Promise<OrderedEntry<V>[]> {
  const entries: OrderedEntry<V>[] = []; for await (const entry of map.seek(bounds)) entries.push(entry); return entries;
}
async function physical(db: IDBDatabase): Promise<{ keys: IDBValidKey[]; values: string[] }> {
  return transaction(db, 'readonly', async tx => {
    const store = tx.objectStore('blocks'), keys = req(store.getAllKeys()), values = req(store.getAll());
    return { keys: await keys, values: await values };
  });
}
function leafEntries(packed: string): { keyText: string; valueText: string }[] {
  const leaf = JSON.parse(packed); let previous = '';
  return leaf[4].map((part: [number, string, string]) => {
    previous = previous.slice(0, part[0]) + part[1]; return { keyText: previous, valueText: part[2] };
  });
}

/** Bundled into the one root-allocated real-browser lane; no private decoder is
 * imported, and no component timing or performance claim is produced. */
export async function runOrderedBlocksControls(): Promise<Result[]> {
  const results: Result[] = [];
  async function test(name: string, work: () => Promise<void>): Promise<void> {
    try { await work(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error instanceof Error ? error.stack : String(error) }); }
  }

  await test('ordered blocks: actual IDB mixed-key order and lossless canonical roundtrip', () => withDB(async db => {
    const buffer = new Uint8Array([9, 0, 255, 2]).buffer;
    const keys: IDBValidKey[] = [Infinity, -Infinity, 0, -1, 0.125, Number.MAX_VALUE, new Date(-8640000000000000), new Date(0),
      new Date(8640000000000000), '', '\0', '\ud800', '\udfff', '\ue000', '\u{10000}', 'a\0b',
      new ArrayBuffer(0), new Uint8Array([0]).buffer, new DataView(buffer, 1, 2), new Uint8Array([255]).buffer,
      [], [0], [0, -Infinity], [0, []], [new Date(0)], ['a'], [buffer], [[[]]], [[], []]];
    const expected = keys.map((key, value) => ({ key, value })).sort((a, b) => indexedDB.cmp(a.key, b.key));
    await transaction(db, 'readwrite', async (_tx, map) => {
      await map.apply(keys.map((key, value) => ({ kind: 'put', key, value })));
    });
    await transaction(db, 'readonly', async (_tx, map) => {
      const actual = await collect(map);
      equal(actual.map(entry => entry.value), expected.map(entry => entry.value), 'native IDB differential order');
      for (let i = 0; i < actual.length; i++) {
        check(indexedDB.cmp(actual[i]!.key, expected[i]!.key) === 0, `key roundtrip ${i}`);
        equal(await map.get(expected[i]!.key), expected[i]!.value, `point lookup ${i}`);
      }
      equal((await collect(map, { order: 'Desc' })).map(entry => entry.value), expected.map(entry => entry.value).reverse(), 'reverse mixed order');
    });
  }));

  await test('ordered blocks: cmp-equal forms and duplicate batch last-change semantics', () => withDB(async db => {
    await transaction(db, 'readwrite', async (_tx, map) => {
      const bytes = new Uint8Array([4, 5]);
      await map.apply([{ kind: 'put', key: -0, value: 1 }, { kind: 'put', key: 0, value: 2 },
        { kind: 'put', key: bytes, value: 3 }, { kind: 'delete', key: bytes.buffer }, { kind: 'put', key: new DataView(bytes.buffer), value: null },
        { kind: 'put', key: [new Date(0), bytes], value: 5 }, { kind: 'put', key: [new Date(0), bytes.buffer], value: 6 }]);
      equal(await map.get(-0), 2, 'zero equality'); equal(await map.get(bytes.buffer), null, 'binary equality preserves null');
      equal(await map.get([new Date(0), bytes]), 6, 'recursive equality'); equal((await collect(map)).length, 3, 'no cmp-equal duplicates');
      await map.apply([{ kind: 'delete', key: new Uint8Array([4, 5]) }, { kind: 'delete', key: -0 }]);
      check(await map.get(bytes.buffer) === undefined && await map.get(0) === undefined, 'canonical deletion');
    });
  }));

  await test('ordered blocks: open/closed ascending/descending bounds cross fences and gaps', () => withDB(async db => {
    await transaction(db, 'readwrite', async (_tx, map) => map.apply(puts(0, 780).filter(change => (change.key as number) % 3 === 0)));
    const values = Array.from({ length: 260 }, (_, i) => i * 3);
    await transaction(db, 'readonly', async (_tx, map) => {
      for (const [lower, upper] of [[-1, 900], [0, 777], [2, 767], [765, 777], [766, 769], [768, 768], [769, 768]]) {
        for (const lowerOpen of [false, true]) for (const upperOpen of [false, true]) for (const order of ['Asc', 'Desc'] as const) {
          const expected = values.filter(value => (lowerOpen ? value > lower! : value >= lower!) && (upperOpen ? value < upper! : value <= upper!));
          if (order === 'Desc') expected.reverse();
          equal((await collect(map, { lower, upper, lowerOpen, upperOpen, order })).map(entry => entry.value), expected, 'bounded differential');
        }
      }
      check(await map.get(766) === undefined && await map.get(900) === undefined, 'gap absence');
    });
  }));

  await test('ordered blocks: splits, repeated delete/reinsert, empty anchor and bounded physical fanout', () => withDB(async db => {
    await transaction(db, 'readwrite', async (_tx, map) => map.apply(puts(0, 1600)));
    let records = await physical(db);
    check(records.keys.length <= 9, 'initial entries must be packed into leaves');
    for (let round = 0; round < 3; round++) {
      await transaction(db, 'readwrite', async (_tx, map) => {
        await map.apply(Array.from({ length: 1600 }, (_, key) => ({ kind: 'delete' as const, key })));
        equal(await collect(map), [], 'all deleted');
        await map.apply(puts(0, 1600));
        equal((await collect(map)).map(entry => entry.value), Array.from({ length: 1600 }, (_, i) => i), 'reinserted');
      });
      records = await physical(db); check(records.keys.length <= 9, 'historical deletions may not leave physical fanout');
    }
    await transaction(db, 'readwrite', async (_tx, map) => map.apply(Array.from({ length: 1600 }, (_, key) => ({ kind: 'delete', key }))));
    records = await physical(db); equal(records.keys.length, 2, 'empty anchor plus first leaf');
    equal(JSON.parse(records.values[0]!).slice(2, 5), [null, 0, 1], 'empty count and tail');
    await transaction(db, 'readwrite', async (_tx, map) => { await map.apply(puts(4000, 1)); equal(await map.get(4000), 4000, 'empty reuse'); });
  }));

  await test('ordered blocks: oversized legal whole entries survive neighboring splits and deletion', () => withDB(async db => {
    const huge = 'm'.repeat(70000), value = { body: '\u{10000}'.repeat(18000) };
    await transaction(db, 'readwrite', async (_tx, map) => {
      await map.apply(Array.from({ length: 700 }, (_, i) => ({ kind: 'put', key: `z${String(i).padStart(4, '0')}`, value: i })));
      await map.apply([{ kind: 'put', key: huge, value }, { kind: 'put', key: 'a', value: 'small' }]);
      equal(await map.get(huge), value, 'oversized entry roundtrip');
      equal((await collect(map)).length, 702, 'oversized neighboring entries');
    });
    const records = await physical(db), encoder = new TextEncoder();
    for (let i = 1; i < records.values.length; i++) {
      const leaf = JSON.parse(records.values[i]!);
      check(leaf[4].length <= 256, 'entry cap');
      check(encoder.encode(records.values[i]!).length <= 65536 || leaf[4].length === 1, 'only whole singleton may exceed soft target');
    }
    await transaction(db, 'readwrite', async (_tx, map) => {
      await map.apply([{ kind: 'delete', key: huge }]); check(await map.get(huge) === undefined, 'oversized deletion');
      equal((await collect(map)).length, 701, 'neighbor preservation');
    });
  }));

  await test('ordered blocks: admitted inputs and returned values/keys have no cache aliases', () => withDB(async db => {
    await transaction(db, 'readwrite', async (tx, map) => {
      const shared = new Uint8Array([1, 2]), key: IDBValidKey[] = [shared, ['scope']], value = { list: [{ n: 1 }] };
      const pending = map.apply([{ kind: 'put', key, value }, { kind: 'put', key: [shared, ['other']], value: null }]);
      shared[0] = 255; (key[1] as IDBValidKey[])[0] = 'mutated'; value.list[0]!.n = 9;
      await pending;
      const original = [new Uint8Array([1, 2]), ['scope']];
      equal(await map.get(original), { list: [{ n: 1 }] }, 'inputs owned synchronously');
      const output = await map.get(original); output.list[0].n = 99;
      const entry = (await collect(map)).find(entry => entry.value !== null)!;
      new Uint8Array((entry.key as IDBValidKey[])[0] as ArrayBuffer)[0] = 99; (entry.value as any).list.length = 0;
      equal(await new OrderedBlocks(tx, 'blocks', 'n').get(original), { list: [{ n: 1 }] }, 'shared instance owns outputs');
      check(await map.get(['missing']) === undefined, 'negative interval admitted');
      await new OrderedBlocks(tx, 'blocks', 'n').apply([{ kind: 'put', key: ['missing'], value: 42 }]);
      equal(await map.get(['missing']), 42, 'negative interval invalidated across instances');
    });
  }));

  await test('ordered blocks: suspended iterators resume by semantic key through apply', () => withDB(async db => {
    await transaction(db, 'readwrite', async (_tx, map) => {
      await map.apply(puts(0, 600));
      const asc = map.seek({ lower: 254 }), desc = map.seek({ upper: 258, order: 'Desc' });
      equal((await asc.next()).value?.value, 254, 'asc first'); equal((await desc.next()).value?.value, 258, 'desc first');
      await map.apply([{ kind: 'delete', key: 254 }, { kind: 'delete', key: 255 }, { kind: 'put', key: 254.5, value: 254.5 },
        { kind: 'delete', key: 257 }, { kind: 'put', key: 257.5, value: 257.5 }, { kind: 'put', key: -1, value: -1 }]);
      equal((await asc.next()).value?.value, 254.5, 'asc resumes after deleted prior key');
      equal((await desc.next()).value?.value, 257.5, 'desc resumes after prior key');
      equal((await asc.next()).value?.value, 256, 'asc skips deleted successor');
      equal((await desc.next()).value?.value, 256, 'desc skips deleted successor');
      await asc.return!(); await desc.return!(); check((await asc.next()).done && (await desc.next()).done, 'return ends iterators');
    });
  }));

  await test('ordered blocks: absent readonly namespace stays absent and shares empty-to-present state', () => withDB(async db => {
    await transaction(db, 'readonly', async (_tx, map) => { check(await map.get(1) === undefined, 'absent lookup'); equal(await collect(map), [], 'absent seek'); });
    equal((await physical(db)).keys.length, 0, 'readonly creates no anchor');
    await transaction(db, 'readwrite', async (tx, map) => {
      check(await map.get(1) === undefined, 'cached absent');
      await new OrderedBlocks(tx, 'blocks', 'n').apply(puts(1, 1)); equal(await map.get(1), 1, 'shared absent publication');
      const other = new OrderedBlocks(tx, 'blocks', 'other'); check(await other.get(1) === undefined, 'namespace isolation');
      await other.apply([{ kind: 'put', key: 1, value: 5 }]); equal(await map.get(1), 1, 'other namespace cannot affect lookup');
    });
  }));

  await test('ordered blocks: unsupported values/keys refuse before writing a partial batch', () => withDB(async db => {
    await transaction(db, 'readwrite', async (_tx, map) => map.apply(puts(1, 1)));
    const before = await physical(db), cycle: any = {}; cycle.self = cycle;
    for (const invalid of [undefined, NaN, Infinity, { absent: undefined }, new Map(), new Date(), cycle, [1, , 3], () => 1]) {
      await refuses(() => transaction(db, 'readwrite', async (_tx, map) => map.apply([{ kind: 'put', key: 2, value: 2 }, { kind: 'put', key: 3, value: invalid }])));
      equal(await physical(db), before, 'invalid value must not publish earlier entries');
    }
    const circular: any[] = []; circular.push(circular);
    for (const key of [NaN, new Date(NaN), null, undefined, {}, [undefined], circular]) {
      await refuses(() => transaction(db, 'readwrite', async (_tx, map) => map.apply([{ kind: 'put', key: key as IDBValidKey, value: 1 }])));
      equal(await physical(db), before, 'invalid key leaves physical bytes');
    }
  }));

  await test('ordered blocks: missing anchor/first/middle/tail fail on relevant reads', async () => {
    for (const missing of ['anchor', 'first', 'middle', 'tail']) await withDB(async db => {
      await transaction(db, 'readwrite', async (_tx, map) => map.apply(puts(0, 900)));
      const records = await physical(db), index = missing === 'anchor' ? 0 : missing === 'first' ? 1 : missing === 'middle' ? 2 : records.keys.length - 1;
      const query = missing === 'first' || missing === 'anchor' ? 0 : missing === 'middle' ? 300 : 899;
      await transaction(db, 'readwrite', async tx => { await req(tx.objectStore('blocks').delete(records.keys[index]!)); });
      await refuses(() => transaction(db, 'readonly', async (_tx, map) => map.get(query)), /missing|gap/);
      await refuses(() => transaction(db, 'readonly', async (_tx, map) => collect(map)), /missing|gap/);
      await refuses(() => transaction(db, 'readonly', async (_tx, map) => collect(map, { order: 'Desc' })), /missing|gap/);
    });
  });

  await test('ordered blocks: malformed encoding, order, links and fences fail closed', async () => {
    const mutations: Array<(value: string) => string> = [
      () => '{bad',
      value => { const a = JSON.parse(value); a[0] = 9; return JSON.stringify(a); },
      value => { const a = JSON.parse(value); a[4][0][0] = 1; return JSON.stringify(a); },
      value => { const a = JSON.parse(value), first = leafEntries(value)[0]!; a[4] = [[0, first.keyText, first.valueText], [0, first.keyText, first.valueText]]; return JSON.stringify(a); },
      value => { const a = JSON.parse(value), entries = leafEntries(value); a[4] = entries.slice(0, 2).reverse().map(entry => [0, entry.keyText, entry.valueText]); return JSON.stringify(a); },
      value => { const a = JSON.parse(value); a[1] = '[0,9999]'; return JSON.stringify(a); },
      value => { const a = JSON.parse(value); a[2] = '[0,1]'; return JSON.stringify(a); },
      value => { const a = JSON.parse(value); a[3] = '[0,100]'; return JSON.stringify(a); },
      value => { const a = JSON.parse(value); a[4][0][2] = '1e999'; return JSON.stringify(a); },
    ];
    for (const mutate of mutations) await withDB(async db => {
      await transaction(db, 'readwrite', async (_tx, map) => map.apply(puts(0, 600)));
      const records = await physical(db);
      await transaction(db, 'readwrite', async tx => { await req(tx.objectStore('blocks').put(mutate(records.values[1]!), records.keys[1]!)); });
      await refuses(() => transaction(db, 'readonly', async (_tx, map) => map.get(0)));
    });
  });

  await test('ordered blocks: late transaction failure rolls back splits and cold reopen is exact', () => withDB(async (db, name) => {
    await transaction(db, 'readwrite', async (_tx, map) => map.apply(puts(0, 600)));
    const before = await physical(db);
    await refuses(() => transaction(db, 'readwrite', async (tx, map) => {
      await map.apply(puts(600, 1000));
      await req(tx.objectStore('blocks').add('duplicate anchor', ['n']));
    }), /ConstraintError/);
    equal(await physical(db), before, 'abort restores exact leaf bytes and anchor');
    db.close(); const reopened = await open(name);
    try {
      await transaction(reopened, 'readonly', async (_tx, map) => equal((await collect(map)).map(entry => entry.value), Array.from({ length: 600 }, (_, i) => i), 'cold current state'));
      await transaction(reopened, 'readwrite', async (_tx, map) => { await map.apply(puts(600, 1000)); equal((await collect(map)).length, 1600, 'cold retry'); });
    } finally { reopened.close(); }
  }));

  return results;
}

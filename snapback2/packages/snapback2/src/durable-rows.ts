// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client —
// current pages and durable indexes publish together; open does not hydrate rows.
import { RowImage } from '../../evaluator/src/row-image.js';
import { directoryKeys, directoryScopeKeys } from './durable-key.js';
import type { HeldProgram } from './store/range-store.js';

export interface DirectoryRecord {
  table: string; id: string; seq: number; page: number; slot: number;
  keys: IDBValidKey[][]; scopeKeys: IDBValidKey[][];
}
export interface PreparedNativeRow { table: string; id: string; row: RowImage | null; seq: number }
export interface DirectoryChange { before: DirectoryRecord | null; after: DirectoryRecord }
interface DiskRow { table: string; id: string; row: Record<string, unknown> | null; seq: number }
const stores = ['pages', 'directory', 'meta', 'proofs', 'scopes'];
const format = 'snapback2-durable-rows-v1';
function fail(message: string): never { throw new TypeError(`durable rows: ${message}`); }
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? Error('durable request failed'));
  });
}

async function transaction<T>(db: IDBDatabase, mode: 'readonly' | 'readwrite', run: (tx: IDBTransaction) => T | Promise<T>): Promise<T> {
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? Error('durable transaction aborted'));
    tx.onerror = () => { /* Transaction abort owns durability failure. */ };
  });
  void done.catch(() => undefined);
  let result: T;
  try {
    result = await run(tx);
    if (tx.error) throw tx.error;
    if (mode === 'readwrite') tx.commit();
  } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
  await done;
  return result;
}

function checkSchema(tx: IDBTransaction): void {
  if (tx.db.version !== 1 || [...tx.db.objectStoreNames].sort().join() !== [...stores].sort().join()) fail('incompatible physical stores');
  for (const name of stores) {
    const store = tx.objectStore(name), directory = name === 'directory';
    if (JSON.stringify(store.keyPath) !== (directory ? '["table","id"]' : 'null')
      || store.autoIncrement !== (name === 'pages')) fail('incompatible physical keys');
    const indexes = directory ? ['keys', 'scopeKeys'] : name === 'scopes' ? ['dependencyKeys', 'selectionKeys'] : [];
    if ([...store.indexNames].sort().join() !== indexes.join()) fail('incompatible physical indexes');
    for (const name of indexes) {
      const index = store.index(name);
      if (index.keyPath !== name || !index.multiEntry || index.unique) fail('incompatible physical index');
    }
  }
}

/** The only page cache is scoped to this transaction; it owns no global row pool. */
export class DurableRowsTx {
  private readonly pages = new Map<number, Promise<DiskRow[]>>();
  private writing = false;
  private readSequence = Number.MAX_SAFE_INTEGER;
  constructor(readonly idb: IDBTransaction, readonly program: HeldProgram, private readonly factory: IDBFactory) {}
  /** A custody snapshot fences every touched representative as well as query postings. */
  boundReads(seq: number): void {
    if (!integer(seq)) fail('invalid snapshot sequence');
    this.readSequence = Math.min(this.readSequence, seq);
  }
  request<T>(value: IDBRequest<T>): Promise<T> { return request(value); }
  getMeta<T = unknown>(key: IDBValidKey): Promise<T | undefined> { return request(this.idb.objectStore('meta').get(key)); }
  putMeta(key: IDBValidKey, value: unknown): Promise<IDBValidKey> {
    if (key === '_format') fail('the physical format marker is immutable');
    return request(this.idb.objectStore('meta').put(value, key));
  }
  private keyList(value: unknown): value is IDBValidKey[][] {
    if (!Array.isArray(value)) return false;
    for (const key of value) {
      if (!Array.isArray(key)) return false;
      try { this.factory.cmp(key, key); } catch { return false; }
    }
    return true;
  }
  private checkDirectory(value: unknown, table: string, id: string): DirectoryRecord {
    if (!object(value) || Object.keys(value).length !== 7 || value.table !== table || value.id !== id || !integer(value.seq)
      || !integer(value.page) || !integer(value.slot) || value.slot >= 256
      || !this.keyList(value.keys) || !this.keyList(value.scopeKeys)) fail('invalid row directory');
    if (value.seq > this.readSequence) fail('row is ahead of its snapshot');
    return value as unknown as DirectoryRecord;
  }
  async directory(table: string, id: string): Promise<DirectoryRecord | null> {
    if (typeof table !== 'string' || typeof id !== 'string') fail('invalid row identity');
    const value = await request(this.idb.objectStore('directory').get([table, id]));
    return value === undefined ? null : this.checkDirectory(value, table, id);
  }
  private sameKeys(left: IDBValidKey[][], right: IDBValidKey[][]): boolean {
    if (left.length !== right.length) return false;
    if (left.every((key, i) => this.factory.cmp(key, right[i]) === 0)) return true;
    // Index declarations have no order in schema identity; multiEntry postings are a set.
    const compare = (a: IDBValidKey, b: IDBValidKey) => this.factory.cmp(a, b);
    return this.factory.cmp([...left].sort(compare), [...right].sort(compare)) === 0;
  }
  private page(number: number): Promise<DiskRow[]> {
    let held = this.pages.get(number);
    if (!held) {
      held = request(this.idb.objectStore('pages').get(number)).then(encoded => {
        if (typeof encoded !== 'string') fail('missing or invalid page encoding');
        const entries: unknown = JSON.parse(encoded);
        if (!Array.isArray(entries) || entries.length === 0 || entries.length > 256) fail('invalid page width');
        const ids = new Set<string>();
        for (const entry of entries) {
          if (!object(entry) || Object.keys(entry).length !== 4 || typeof entry.table !== 'string' || typeof entry.id !== 'string' || !integer(entry.seq)
            || (entry.row !== null && (!object(entry.row) || entry.row.id !== entry.id))) fail('invalid page row');
          const key = JSON.stringify([entry.table, entry.id]);
          if (ids.has(key)) fail('duplicate page row');
          ids.add(key);
        }
        return entries as DiskRow[];
      });
      this.pages.set(number, held);
    }
    return held;
  }
  private async decode(record: DirectoryRecord): Promise<RowImage | null> {
    if (record.seq > this.readSequence) fail('row is ahead of its snapshot');
    const page = await this.page(record.page), entry = page[record.slot];
    if (!entry || entry.table !== record.table || entry.id !== record.id || entry.seq !== record.seq)
      fail('page and directory disagree');
    // Only the selected body is admitted. Sibling bodies are not typed or indexed on read.
    const row = entry.row === null ? null : RowImage.fromWire(this.program.schema, entry.table, entry.row, fail, this.program.schemaHash);
    if (!this.sameKeys(record.keys, row ? directoryKeys(record.table, row) : [])
      || !this.sameKeys(record.scopeKeys, row ? directoryScopeKeys(record.table, row) : []))
      fail('body and directory indexes disagree');
    return row;
  }
  async row(record: DirectoryRecord): Promise<RowImage | null> {
    if (!object(record) || typeof record.table !== 'string' || typeof record.id !== 'string') fail('invalid row directory');
    this.checkDirectory(record, record.table, record.id);
    const current = await this.directory(record.table, record.id);
    if (!current || current.seq !== record.seq || current.page !== record.page || current.slot !== record.slot
      || !this.sameKeys(current.keys, record.keys) || !this.sameKeys(current.scopeKeys, record.scopeKeys))
      fail('row directory changed');
    return this.decode(current);
  }
  /** Call serially; the caller adds proofs, scopes and obligations before this transaction completes. */
  async putRows(rows: readonly PreparedNativeRow[], seq: number,
    changed?: (table: string, old: RowImage | null, next: RowImage | null) => void): Promise<DirectoryChange[]> {
    if (this.idb.mode !== 'readwrite') fail('row writes require a readwrite transaction');
    if (this.writing) fail('overlapping row writes in one transaction');
    if (!integer(seq)) fail('invalid commit sequence');
    this.writing = true;
    try {
      const identities = new Set<string>();
      // Own mutable envelopes before the first await; nominal images already own their bodies.
      const incoming = rows.map(({ table, id, row, seq: version }) => {
        if (typeof table !== 'string' || typeof id !== 'string' || version !== seq) fail('invalid prepared row version');
        const key = JSON.stringify([table, id]);
        if (identities.has(key)) fail('duplicate prepared row');
        identities.add(key);
        if (!this.program.schema.tables?.[table]) fail('unknown prepared table');
        if (row !== null) {
          if (!RowImage.is(row) || RowImage.table(row) !== table) fail('matching prepared row required');
          row = RowImage.prepare(this.program.schema, table, row, this.program.schemaHash);
        }
        const wire = row === null ? null : RowImage.wire(row);
        if (wire && wire.id !== id) fail('prepared row identity mismatch');
        return { table, id, row, wire, seq, keys: row ? directoryKeys(table, row) : [],
          scopeKeys: row ? directoryScopeKeys(table, row) : [] };
      });
      const previous = await Promise.all(incoming.map(row => this.directory(row.table, row.id)));
      const current = await Promise.all(previous.map(record => record ? this.decode(record) : null));
      const changedPages = new Set<number>(), changes: DirectoryChange[] = [];
      const additions: Array<{ row: DiskRow; after: DirectoryRecord }> = [];
      for (let i = 0; i < incoming.length; i++) {
        const entry = incoming[i], before = previous[i];
        if (before && seq < before.seq) fail('row arrived behind its committed sequence');
        if (before?.seq === seq) {
          if (entry.row === null ? current[i] !== null : !RowImage.equal(current[i], entry.row))
            fail('contradictory row at the same sequence');
          continue;
        }
        if (entry.row === null ? current[i] !== null : !RowImage.equal(current[i], entry.row))
          changed?.(entry.table, current[i], entry.row);
        const after: DirectoryRecord = { table: entry.table, id: entry.id, seq, page: before?.page ?? 0,
          slot: before?.slot ?? 0, keys: entry.keys, scopeKeys: entry.scopeKeys };
        const row: DiskRow = { table: entry.table, id: entry.id, row: entry.wire, seq };
        if (before) {
          const page = await this.page(before.page);
          page[before.slot] = row; changedPages.add(before.page);
        } else additions.push({ row, after });
        changes.push({ before, after });
      }
      const pages = this.idb.objectStore('pages');
      for (const number of changedPages) pages.put(JSON.stringify(await this.page(number)), number);
      // Fresh rows fill fresh pages in this admitted batch; completed pages never get recopied to append.
      for (let at = 0; at < additions.length; at += 256) {
        const batch = additions.slice(at, at + 256), entries = batch.map(entry => entry.row);
        const number = await request(pages.add(JSON.stringify(entries)));
        if (!integer(number)) fail('invalid allocated page identity');
        this.pages.set(number, Promise.resolve(entries));
        for (let slot = 0; slot < batch.length; slot++) Object.assign(batch[slot].after, { page: number, slot });
      }
      const directory = this.idb.objectStore('directory');
      for (const { after } of changes) directory.put(after);
      return changes;
    } catch (error) { try { this.idb.abort(); } catch {} throw error; }
    finally { this.writing = false; }
  }
}

/** Fresh experimental format only. Schema and marker reads do not enumerate rows or pages. */
export class DurableRows {
  private constructor(private readonly db: IDBDatabase, readonly program: HeldProgram, private readonly factory: IDBFactory) {}
  /** Bootstrap sees only raw metadata; the caller admits the held program and session binding. */
  static async peek(name: string, factory: IDBFactory = indexedDB): Promise<{ program?: unknown; state?: unknown }> {
    const opening = factory.open(name);
    let absent = false;
    opening.onupgradeneeded = event => { absent = event.oldVersion === 0; opening.transaction!.abort(); };
    let db: IDBDatabase;
    try { db = await request(opening); } catch (error) { if (absent) return {}; throw error; }
    try {
      if (db.version !== 1 || [...db.objectStoreNames].sort().join() !== [...stores].sort().join()) fail('incompatible physical stores');
      return await transaction(db, 'readonly', async tx => {
        checkSchema(tx);
        const meta = tx.objectStore('meta');
        const [marker, program, state] = await Promise.all(['_format', 'program', 'state'].map(key => request(meta.get(key))));
        if (marker !== format) fail('incompatible physical format marker');
        return { program, state };
      });
    } finally { db.close(); }
  }
  static async open(name: string, program: HeldProgram, factory: IDBFactory = indexedDB): Promise<DurableRows> {
    const opening = factory.open(name, 1);
    opening.onupgradeneeded = event => {
      if (event.oldVersion !== 0 || opening.result.objectStoreNames.length !== 0) { opening.transaction!.abort(); return; }
      const db = opening.result;
      db.createObjectStore('pages', { autoIncrement: true });
      const directory = db.createObjectStore('directory', { keyPath: ['table', 'id'] });
      directory.createIndex('keys', 'keys', { multiEntry: true });
      directory.createIndex('scopeKeys', 'scopeKeys', { multiEntry: true });
      db.createObjectStore('meta').put(format, '_format');
      db.createObjectStore('proofs');
      const scopes = db.createObjectStore('scopes');
      scopes.createIndex('selectionKeys', 'selectionKeys', { multiEntry: true });
      scopes.createIndex('dependencyKeys', 'dependencyKeys', { multiEntry: true });
    };
    const db = await request(opening), carrier = new DurableRows(db, program, factory);
    db.onversionchange = () => db.close();
    try {
      if ([...db.objectStoreNames].sort().join() !== [...stores].sort().join()) fail('incompatible physical stores');
      await carrier.transaction('readonly', async tx => {
        checkSchema(tx.idb);
        if (await tx.getMeta('_format') !== format) fail('incompatible physical format marker');
      });
      return carrier;
    } catch (error) { db.close(); throw error; }
  }
  /** Await only request promises/microtasks in run: no network, timers or external asynchronous work. */
  async transaction<T>(mode: 'readonly' | 'readwrite', run: (tx: DurableRowsTx) => T | Promise<T>): Promise<T> {
    return transaction(this.db, mode, idb => run(new DurableRowsTx(idb, this.program, this.factory)));
  }
  close(): void { this.db.close(); }
}

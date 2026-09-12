// @ref LLP 1012#native-acquisition-restart — current physical pages and the evaluator share one owned row pool.
import { ClientStore } from '../../evaluator/src/store.js';
import { RowImage } from '../../evaluator/src/row-image.js';
import type { ClosureReceipt, RowRecord } from '../../evaluator/src/types.js';
import type { HeldProgram } from './store/range-store.js';

export interface NativePacket { id: string; log: string; events: string[]; rejected?: string }
export interface NativePosition { cursor: string | null; exhausted: boolean; acquired: number }
export interface NativeState {
  principal: string; tokenHash: string; authEpoch: number; generation: string; schemaHash: string;
  seq: number; readTime: number; serial: number; revision?: number; sealed: boolean;
  logs: Record<string, NativePosition>; packets: NativePacket[];
}
export type NativeRow = { table: string; id: string; row: RowImage | null; seq: number };
type DiskRow = { table: string; id: string; row: Record<string, unknown> | null; seq: number };
type Proof = { receipt: Omit<ClosureReceipt, 'rows'>; program?: unknown };
export interface NativeCommit {
  state: NativeState; rows: NativeRow[];
  proofs?: Record<string, Proof | null>;
  coverage?: Array<{ log: string; recipient: string; after: string | null; cursor: string | null; exhausted: boolean }>;
}
export interface NativeDisk {
  load(): Promise<{ program?: HeldProgram; state?: NativeState; pages: Array<[number, string]>; proofs: Array<[string, Proof]> }>;
  commit(change: { program?: HeldProgram; state: NativeState; pages: Array<[number, string | null]>; proofs: Record<string, Proof | null> }): Promise<void>;
  close(): void;
}
const key = (table: string, id: string) => JSON.stringify([table, id]);
function fail(message: string): never { throw new TypeError(message); }

/** No mirror of bodies, serialized projection cache, or later twin hydration. */
export class NativeCustody {
  readonly rows: ClientStore;
  state: NativeState;
  private readonly locations = new Map<string, number>();
  private readonly pages = new Map<number, Set<string>>();
  private readonly versions = new Map<string, number>();
  private readonly proofs = new Map<string, Proof>();
  private nextPage = 0;
  private initialized = false;
  private failed = false;
  constructor(readonly program: HeldProgram, state: NativeState, private readonly disk: NativeDisk) {
    this.state = state;
    this.rows = new ClientStore(program.schema, undefined, { readable: Object.entries<any>(program.schema.tables ?? {})
      .filter(([, table]) => table.retain === 'delivered-history').map(([name]) => name) });
  }
  async open(loaded?: Awaited<ReturnType<NativeDisk['load']>>): Promise<void> {
    const held = loaded ?? await this.disk.load();
    if (held.state) {
      for (const name of ['principal', 'tokenHash', 'authEpoch', 'generation', 'schemaHash'] as const)
        if (held.state[name] !== this.state[name]) fail(`native custody ${name} changed; retained partition requires reset`);
      if (held.state.sealed) fail('native custody is sealed');
      this.state = held.state;
      // Reopen installs directly into the same evaluator row pool, before any read is exposed.
      for (const [page, encoded] of held.pages) {
        if (!Number.isSafeInteger(page) || page < 0 || this.pages.has(page)) fail('invalid native page identity');
        const entries: DiskRow[] = JSON.parse(encoded);
        if (!Array.isArray(entries) || entries.length > 256) fail('invalid native page');
        const members = new Set<string>();
        for (const entry of entries) {
          const id = key(entry.table, entry.id);
          if (this.locations.has(id) || !Number.isSafeInteger(entry.seq) || entry.seq < 0 || entry.seq > this.state.seq)
            fail('invalid native row version');
          const row = entry.row === null ? null : RowImage.fromWire(this.program.schema, entry.table, entry.row, fail, this.program.schemaHash);
          if (row && entry.row!.id !== entry.id) fail('native row identity mismatch');
          if (row) this.rows.put(entry.table, row);
          this.locations.set(id, page); this.versions.set(id, entry.seq); members.add(id);
        }
        this.pages.set(page, members); this.nextPage = Math.max(this.nextPage, page + 1);
      }
      for (const [owner, proof] of held.proofs) { this.installProof(owner, proof); this.proofs.set(owner, proof); }
      for (const [log, position] of Object.entries(this.state.logs))
        this.rows.admitNativeCoverage({ log, recipient: this.state.principal, after: null, cursor: position.cursor, exhausted: position.exhausted });
      this.initialized = true;
    } else if (held.pages.length || held.proofs.length || held.program) fail('incomplete native partition');
    this.rows.registerHeld(this.program.programs, { viewer: this.state.principal, principal_kind: 'user', auth_epoch: this.state.authEpoch,
      args: {}, now: this.state.readTime, read_time: null, new_ids: [] });
  }
  private installProof(owner: string, proof: Proof | null): void {
    // Ranges retain body-free keys. Their actual row pool is this store.
    if (!proof) { this.rows.setReceipt(owner); return; }
    const ids = new Set<string>();
    for (const range of proof.receipt.ranges) {
      for (const id of range.row_ids) ids.add(key(range.table, id));
      if (range.halo) ids.add(key(range.halo.table, range.halo.id));
    }
    const rows: RowRecord[] = [];
    for (const id of ids) {
      const [table, rowId] = JSON.parse(id), row = this.rows.byId(table, rowId);
      if (row) rows.push({ table, id: rowId, row });
    }
    this.rows.setReceipt(owner, { ...proof.receipt, rows }, proof.program);
  }
  async commit(change: NativeCommit): Promise<void> {
    if (this.failed) fail('native custody publication failed; close and reopen');
    if (change.state.seq < this.state.seq) fail('native delivery arrived behind the committed sequence');
    for (const name of ['principal', 'tokenHash', 'authEpoch', 'generation', 'schemaHash'] as const)
      if (change.state[name] !== this.state[name]) fail(`native commit ${name} mismatch`);
    this.rows.validateNativeCoverage(change.coverage ?? []);
    change = { ...change, state: { ...change.state, revision: (this.state.revision ?? 0) + 1 } };
    const incoming = new Map<string, NativeRow>();
    for (const entry of change.rows) {
      const id = key(entry.table, entry.id), version = this.versions.get(id);
      if (incoming.has(id) || entry.seq !== change.state.seq) fail('duplicate or invalid native row version');
      if (entry.row && (!RowImage.is(entry.row) || RowImage.table(entry.row) !== entry.table
        || (RowImage.wire(entry.row).id !== entry.id))) fail('native commit requires matching prepared row');
      if (version === entry.seq) {
        const old = this.rows.byId(entry.table, entry.id);
        if (entry.row === null ? old !== null : !RowImage.equal(old, entry.row)) fail('contradictory native row at the same sequence');
      }
      incoming.set(id, entry);
    }
    // Prepare explicit changed physical pages. New rows do not rewrite completed pages.
    const changed = new Map<number, Set<string>>();
    let nextPage = this.nextPage, openPage: number | undefined;
    const assigned = new Map<string, number>();
    for (const id of incoming.keys()) {
      let page = this.locations.get(id);
      if (page === undefined) {
        if (openPage === undefined || changed.get(openPage)!.size === 256) { openPage = nextPage++; changed.set(openPage, new Set()); }
        page = openPage; assigned.set(id, page);
      }
      let members = changed.get(page);
      if (!members) { members = new Set(this.pages.get(page)); changed.set(page, members); }
      members.add(id);
    }
    const diskPages: Array<[number, string | null]> = [];
    for (const [page, members] of changed) {
      const entries: DiskRow[] = [];
      for (const id of members) {
        const [table, rowId] = JSON.parse(id), update = incoming.get(id);
        const row = update ? update.row : this.rows.byId(table, rowId);
        entries.push({ table, id: rowId, row: row === null ? null : RowImage.wire(row as RowImage), seq: update?.seq ?? this.versions.get(id)! });
      }
      diskPages.push([page, JSON.stringify(entries)]);
    }
    // The carrier transaction is the publication boundary, including newly earned ACK obligations.
    await this.disk.commit({ ...(!this.initialized ? { program: this.program } : {}), state: change.state,
      pages: diskPages, proofs: change.proofs ?? {} });
    try {
      for (const entry of incoming.values()) {
        if (entry.row) this.rows.put(entry.table, entry.row); else this.rows.remove(entry.table, entry.id);
        this.versions.set(key(entry.table, entry.id), entry.seq);
      }
      for (const [id, page] of assigned) this.locations.set(id, page);
      for (const [page, members] of changed) this.pages.set(page, members);
      this.nextPage = nextPage;
      for (const [owner, proof] of Object.entries(change.proofs ?? {})) {
        this.installProof(owner, proof);
        if (proof) this.proofs.set(owner, proof); else this.proofs.delete(owner);
      }
      for (const coverage of change.coverage ?? []) this.rows.admitNativeCoverage(coverage);
      this.state = change.state; this.initialized = true;
    } catch (error) { this.failed = true; throw error; }
  }
  proof(owner: string): Proof | undefined { return this.proofs.get(owner); }
  proofOwners(): string[] { return [...this.proofs.keys()]; }
  close(): void { this.disk.close(); }
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((yes, no) => { request.onsuccess = () => yes(request.result); request.onerror = () => no(request.error); });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((yes, no) => { tx.oncomplete = () => yes(); tx.onabort = () => no(tx.error ?? Error('native carrier aborted'));
    tx.onerror = () => { /* onabort owns transaction failure */ }; });
}
export async function nativeIndexedDB(name: string): Promise<NativeDisk> {
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => { request.result.createObjectStore('pages'); request.result.createObjectStore('meta'); request.result.createObjectStore('proofs'); };
  const db = await result(request);
  return {
    async load() {
      const tx = db.transaction(['pages', 'meta', 'proofs'], 'readonly'), done = complete(tx);
      const pageKeys = result(tx.objectStore('pages').getAllKeys()), pageValues = result(tx.objectStore('pages').getAll());
      const proofKeys = result(tx.objectStore('proofs').getAllKeys()), proofValues = result(tx.objectStore('proofs').getAll());
      const program = result(tx.objectStore('meta').get('program')), state = result(tx.objectStore('meta').get('state'));
      const [pk, pv, fk, fv, p, s] = await Promise.all([pageKeys, pageValues, proofKeys, proofValues, program, state]); await done;
      return { program: p, state: s, pages: pk.map((key, i) => [Number(key), pv[i]] as [number, string]), proofs: fk.map((key, i) => [String(key), fv[i]] as [string, Proof]) };
    },
    async commit(change) {
      const tx = db.transaction(['pages', 'meta', 'proofs'], 'readwrite'), done = complete(tx);
      try {
        for (const [key, value] of change.pages) if (value === null) tx.objectStore('pages').delete(key); else tx.objectStore('pages').put(value, key);
        for (const [key, value] of Object.entries(change.proofs)) if (value === null) tx.objectStore('proofs').delete(key); else tx.objectStore('proofs').put(value, key);
        if (change.program) tx.objectStore('meta').put(change.program, 'program');
        tx.objectStore('meta').put(change.state, 'state');
        tx.commit();
      } catch (error) { try { tx.abort(); } catch {} await done.catch(() => undefined); throw error; }
      await done;
    },
    close() { db.close(); },
  };
}

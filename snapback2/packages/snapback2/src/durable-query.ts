// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client —
// one readonly carrier transaction backs a single suspendable Quarry execution.
import { EvalError } from '../../evaluator/src/errors.js';
import { CoverageIndex } from '../../evaluator/src/coverage.js';
import { components, ordinaryColumns, preparePrefix, prepareScanBounds, compareScanBounds, scalarAtoms } from '../../evaluator/src/index-store.js';
import { NativeCoverage } from '../../evaluator/src/native-coverage.js';
import { PreparedRange } from '../../evaluator/src/range-preparation.js';
import { readQueryAuthority } from '../../evaluator/src/query.js';
import { RowImage } from '../../evaluator/src/row-image.js';
import { canonicalJson } from '../../evaluator/src/value-runtime.js';
import type { QueryHost, QueryCursor, QueryDirectory } from '../../evaluator/src/query-work.js';
import type { ClosureReceipt, Context, TraceRange, Value } from '../../evaluator/src/types.js';
import type { LogicalIndexAtom } from '../../evaluator/src/search-key.js';
import type { NativeState } from './native-custody.js';
import type { DurableRowsTx, DirectoryRecord } from './durable-rows.js';
import { directoryKeys, indexPrefix, scalarKey, scalarFromKey, KEY_END } from './durable-key.js';

export interface DurableProof {
  receipt: Omit<ClosureReceipt, 'rows'>;
  program?: unknown;
  /** Issued positions survive later row changes and physical reopen. */
  positions: Array<[table: string, index: string, id: string, columns: Value[] | null]>;
}
const identity = (table: string, id: string) => canonicalJson([table, id]);
const positionId = (table: string, index: string, id: string) => canonicalJson([table, index, id]);

function position(schema: any, table: string, index: string, keys: IDBValidKey[][],
  prefix: LogicalIndexAtom[]): Value[] | null {
  const start = indexPrefix(table, index, prefix), parts = components(schema, table, index);
  const key = keys.find(key => indexedDB.cmp(key.slice(0, start.length), start) === 0);
  return key ? key.slice(2, parts.length + 2).flatMap((key, i) => 'Column' in parts[i] ? [scalarFromKey(key)] : []) : null;
}

/** Admission retains original keys, never reconstructs old evidence from current rows. */
export function durableProof(schema: any, receipt: ClosureReceipt, program?: unknown): DurableProof {
  const pool = new Map(receipt.rows.map(row => [identity(row.table, row.id), row.row as RowImage]));
  const positions = new Map<string, DurableProof['positions'][number]>();
  for (const range of receipt.ranges) {
    const { prepared } = PreparedRange.tagged(schema, range, program);
    for (const id of [...range.row_ids, ...(range.halo ? [range.halo.id] : [])]) {
      const row = pool.get(identity(range.table, id));
      const keys = row && position(schema, range.table, range.index, directoryKeys(range.table, row), prepared.meaning.prefix);
      if (!keys && !range.evicted_ids?.includes(id)) throw new TypeError('durable proof member has no issued position');
      positions.set(positionId(range.table, range.index, id), [range.table, range.index, id, keys ?? null]);
    }
  }
  const { rows: _rows, ...bodyFree } = receipt;
  return { receipt: bodyFree, program, positions: [...positions.values()] };
}

export class DurableQueryHost implements QueryHost {
  private readonly facts: CoverageIndex;
  private readonly native: NativeCoverage;
  private readonly proofRows = new Map<string, DirectoryRecord | null>();
  private constructor(readonly tx: DurableRowsTx, readonly state: NativeState,
    private readonly directory: (descriptor: any) => QueryDirectory | undefined) {
    const schema = tx.program.schema;
    this.facts = new CoverageIndex(schema, (range, prefix, id) => {
      const row = this.proofRows.get(identity(range.table, id));
      return row ? position(schema, range.table, range.index, row.keys, prefix) : null;
    });
    this.native = new NativeCoverage(schema);
  }
  static async open(tx: DurableRowsTx, state: NativeState,
    directory: (descriptor: any) => QueryDirectory | undefined): Promise<DurableQueryHost> {
    tx.boundReads(state.seq);
    const host = new DurableQueryHost(tx, state, directory), store = tx.idb.objectStore('proofs');
    const [owners, proofs] = await Promise.all([tx.request(store.getAllKeys()), tx.request(store.getAll())]);
    for (let i = 0; i < owners.length; i++) {
      const proof = proofs[i] as DurableProof;
      if (!proof || !Array.isArray(proof.positions)) throw new TypeError('durable proof positions are absent');
      const issued = new Map<string, Value[] | null>();
      for (const [table, index, id, keys] of proof.positions) {
        const key = identity(table, id);
        if (!host.proofRows.has(key)) {
          const current = await tx.directory(table, id);
          if (current && current.seq > state.seq) throw new TypeError('durable proof row is ahead of its snapshot');
          host.proofRows.set(key, current);
        }
        issued.set(positionId(table, index, id), keys);
      }
      for (const range of proof.receipt.ranges) for (const id of [...range.row_ids, ...(range.halo ? [range.halo.id] : [])])
        if (!issued.has(positionId(range.table, range.index, id))) throw new TypeError('durable proof member position is absent');
      const authority = proof.receipt.schema_hash === tx.program.schemaHash ? proof.receipt : { ...proof.receipt, absences: [], verdicts: [] };
      host.facts.set(String(owners[i]), { ...authority, rows: [] }, proof.program,
        (table, index, id) => issued.get(positionId(table, index, id)) ?? null);
    }
    for (const [log, value] of Object.entries(state.logs))
      host.native.admit({ log, recipient: state.principal, after: null, cursor: value.cursor, exhausted: value.exhausted });
    return host;
  }
  async lookup(table: string, index: string, key: Value[]): Promise<Value | null> {
    const definition = this.tx.program.schema.tables?.[table]?.indexes?.[index];
    if (!definition || key.length !== ordinaryColumns(definition).length) throw new EvalError('E_TYPE', 'point requires a complete ordinary index key');
    const prefix = preparePrefix(this.tx.program.schema, table, index, scalarAtoms(key), []);
    const cursor = this.seek(table, index, prefix, null, null, null, 'Asc');
    try { const value = await cursor.next(); return value.done ? null : value.value; }
    finally { await cursor.return?.(); }
  }
  seek(table: string, index: string, prefix: LogicalIndexAtom[], after: Value | null,
    before: Value | null, range: any, order: 'Asc' | 'Desc'): QueryCursor {
    const schema = this.tx.program.schema, parts = components(schema, table, index);
    const bounds = prepareScanBounds(schema, table, parts, { prefix, after, before, range, order });
    if (prefix.some(atom => 'WordPrefix' in atom && atom.WordPrefix.empty)) return emptyCursor();
    const base = indexPrefix(table, index, prefix);
    let lower: IDBValidKey[] = base, upper: IDBValidKey[] = [...base, KEY_END];
    const minimum = (values: Value[] | null | undefined, strict: boolean) => {
      if (!values) return;
      const key = [...base, ...values.map(scalarKey), ...(strict ? [KEY_END] : [])];
      if (indexedDB.cmp(key, lower) > 0) lower = key;
    };
    const maximum = (values: Value[] | null | undefined, inclusive: boolean) => {
      if (!values) return;
      const key = [...base, ...values.map(scalarKey), ...(inclusive ? [KEY_END] : [])];
      if (indexedDB.cmp(key, upper) < 0) upper = key;
    };
    if (order === 'Asc') { minimum(bounds.after, true); maximum(bounds.before, false); }
    else { maximum(bounds.after, false); minimum(bounds.before, true); }
    minimum(bounds.gt, true); minimum(bounds.gte, false); maximum(bounds.lt, false); maximum(bounds.lte, true);
    if (indexedDB.cmp(lower, upper) >= 0) return emptyCursor();
    const request = this.tx.idb.objectStore('directory').index('keys')
      .openCursor(IDBKeyRange.bound(lower, upper, false, true), order === 'Asc' ? 'next' : 'prev');
    let pending = this.tx.request(request), first = true, stopped = false;
    const tx = this.tx, seq = this.state.seq;
    void pending.catch(() => undefined);
    return {
      async next() {
        if (stopped) return { done: true, value: undefined };
        for (;;) {
          const cursor = await pending;
          if (!cursor) { stopped = true; return { done: true, value: undefined }; }
          if (!first) { pending = tx.request(request); cursor.continue(); first = true; continue; }
          first = false;
          const encoded = cursor.key as IDBValidKey[];
          const suffix = encoded.slice(base.length, parts.length + 2).map(scalarFromKey);
          if (compareScanBounds(suffix, bounds, order) !== 0) {
            pending = tx.request(request); cursor.continue(); first = true; continue;
          }
          const record = cursor.value as DirectoryRecord;
          if (record.seq > seq) throw new TypeError('durable posting is ahead of its snapshot');
          const row = await tx.row(record);
          if (!row) throw new TypeError('durable posting points to a deleted row');
          // Advancing is deferred until the next pull, so abandoning a lane reads no halo.
          return { done: false, value: row as Value };
        }
      },
      async return() { stopped = true; return { done: true, value: undefined }; },
    };
  }
  readable(table: string): boolean { return this.tx.program.schema.tables?.[table]?.retain === 'delivered-history'; }
  async missingSearchAuthority(table: string, index: string, prefix: LogicalIndexAtom[], context: Context): Promise<boolean> {
    const parts = components(this.tx.program.schema, table, index), derived = parts.findIndex(part => 'WordPrefixes' in part);
    const word = prefix[derived];
    if (!word || !('WordPrefix' in word) || word.WordPrefix.empty || this.readable(table)) return false;
    const key = indexPrefix(table, index, prefix.slice(0, derived));
    const record = await this.tx.request(this.tx.idb.objectStore('directory').index('scopeKeys').get(key)) as DirectoryRecord | undefined;
    const row = record && await this.tx.row(record);
    return !!row && await readQueryAuthority(this, this.tx.program.schema, { ...context, args: {}, new_ids: [] }, table, row,
      parts.slice(0, derived).map(part => (part as { Column: string }).Column)) === null;
  }
  heldDirectory(descriptor: any): QueryDirectory | undefined { return this.directory(descriptor); }
  verdict(rule: string, digest: string, context: Context): boolean | null { return this.facts.verdict(rule, digest, context.viewer, context.auth_epoch); }
  hasAbsence(table: string, index: string, key: Value[]): boolean { return this.facts.hasAbsence(table, index, key); }
  hasCompleteRange(table: string, index: string, key: Value[]): boolean { return this.facts.drained(table, index, scalarAtoms(key)); }
  rangeStop(range: TraceRange, prefix: LogicalIndexAtom[]): TraceRange['stop'] { return this.facts.stop(range, prefix); }
  coversRange(range: TraceRange, prefix: LogicalIndexAtom[], program?: any, viewer?: string): boolean {
    return this.facts.covers(range, prefix) || !!(program?.kind === 'Query' && viewer !== undefined && this.native.covers(range, prefix, viewer));
  }
}
function emptyCursor(): QueryCursor {
  return { next: () => ({ done: true, value: undefined }), return: () => ({ done: true, value: undefined }) };
}

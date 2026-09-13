// @ref LLP 1018.008.007.002#11-block-index-acquisition-restart —
// one readonly carrier transaction backs a single suspendable Quarry execution.
import { EvalError } from '../../evaluator/src/errors.js';
import { CoverageIndex } from '../../evaluator/src/coverage.js';
import { components, ordinaryColumns, preparePrefix, prepareScanBounds, compareScanBounds, scalarAtoms, type KeyImage } from '../../evaluator/src/index-store.js';
import { NativeCoverage } from '../../evaluator/src/native-coverage.js';
import { PreparedRange } from '../../evaluator/src/range-preparation.js';
import { readQueryAuthority } from '../../evaluator/src/query.js';
import { RowImage } from '../../evaluator/src/row-image.js';
import { canonicalJson, totalCompare } from '../../evaluator/src/value-runtime.js';
import type { QueryHost, QueryCursor, QueryDirectory } from '../../evaluator/src/query-work.js';
import type { ClosureReceipt, Context, TraceRange, Value } from '../../evaluator/src/types.js';
import type { LogicalIndexAtom } from '../../evaluator/src/search-key.js';
import type { NativeState } from './native-custody.js';
import type { DurableRowsTx, DirectoryRecord } from './durable-rows.js';
import { imageScopeKeys, indexPrefix, scalarKey, scalarFromKey, KEY_END } from './durable-key.js';

export interface DurableProof {
  receipt: Omit<ClosureReceipt, 'rows'>;
  program?: unknown;
  /** Issued positions survive later row changes and physical reopen. */
  positions: Array<[table: string, index: string, id: string, columns: Value[] | null]>;
}
const identity = (table: string, id: string) => canonicalJson([table, id]);
const positionId = (table: string, index: string, id: string) => canonicalJson([table, index, id]);

function wordMatches(word: string, prefix: string): boolean {
  if (!prefix || !word.startsWith(prefix)) return false;
  const end = prefix.charCodeAt(prefix.length - 1), next = word.charCodeAt(prefix.length);
  // Posting expansion ends on a Unicode codepoint, never halfway through a pair.
  return !(end >= 0xd800 && end <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}
function position(schema: any, table: string, index: string, image: KeyImage,
  prefix: LogicalIndexAtom[]): Value[] | null {
  const parts = image[index], definition = components(schema, table, index);
  if (!parts || parts.length !== definition.length || prefix.length > parts.length) return null;
  // A wordless row has a scope, but no posting for any receipt prefix.
  if (parts.some(part => 'Words' in part && !part.Words.some(word => word.length))) return null;
  for (let i = 0; i < prefix.length; i++) {
    const atom = prefix[i], part = parts[i];
    if ('Scalar' in atom) {
      if (!('Scalar' in part) || totalCompare(part.Scalar, atom.Scalar)) return null;
    } else if (!('Words' in part) || !atom.WordPrefix.token
      || !part.Words.some(word => wordMatches(word, atom.WordPrefix.token!))) return null;
  }
  return parts.flatMap(part => 'Scalar' in part ? [part.Scalar] : []);
}
function postingMatches(schema: any, table: string, index: string, record: DirectoryRecord, key: IDBValidKey[]): boolean {
  const definition = components(schema, table, index), parts = record.parts[index];
  if (!parts || parts.length !== definition.length || key.length !== definition.length + 3
    || indexedDB.cmp(key.slice(0, 2), indexPrefix(table, index, [])) !== 0
    || indexedDB.cmp(key.at(-1)!, scalarKey({ Id: record.id })) !== 0) return false;
  return parts.every((part, i) => {
    if ('Column' in definition[i]) return 'Scalar' in part && indexedDB.cmp(key[i + 2], scalarKey(part.Scalar)) === 0;
    const value = scalarFromKey(key[i + 2]);
    return 'Words' in part && typeof value === 'object' && 'String' in value && !!value.String
      && indexedDB.cmp(key[i + 2], scalarKey(value)) === 0
      && part.Words.some(word => wordMatches(word, value.String));
  });
}
function postingId(key: IDBValidKey[]): string {
  const id = scalarFromKey(key.at(-1)!);
  if (typeof id !== 'object' || !('Id' in id)) throw new TypeError('durable posting has no nominal row identity');
  return id.Id;
}

/** Admission retains original keys, never reconstructs old evidence from current rows. */
export function durableProof(schema: any, receipt: ClosureReceipt, program?: unknown): DurableProof {
  const pool = new Map(receipt.rows.map(row => [identity(row.table, row.id), row.row as RowImage]));
  const positions = new Map<string, DurableProof['positions'][number]>();
  for (const range of receipt.ranges) {
    const { prepared } = PreparedRange.tagged(schema, range, program);
    for (const id of [...range.row_ids, ...(range.halo ? [range.halo.id] : [])]) {
      const row = pool.get(identity(range.table, id));
      const keys = row && position(schema, range.table, range.index, RowImage.keys(row), prepared.meaning.prefix);
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
      return row ? position(schema, range.table, range.index, row.parts, prefix) : null;
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
    const postings = this.tx.postings.seek({ lower, upper, upperOpen: true, order });
    let stopped = false;
    const tx = this.tx, seq = this.state.seq;
    return {
      async next() {
        if (stopped) return { done: true, value: undefined };
        for (;;) {
          const next = await postings.next();
          if (next.done) { stopped = true; return { done: true, value: undefined }; }
          const encoded = next.value.key;
          if (!Array.isArray(encoded) || encoded.length !== parts.length + 3)
            throw new TypeError('durable posting key has the wrong shape');
          const suffix = encoded.slice(base.length, parts.length + 2).map(scalarFromKey);
          if (compareScanBounds(suffix, bounds, order) !== 0) continue;
          const record = await tx.directory(table, postingId(encoded));
          if (!record || !postingMatches(schema, table, index, record, encoded))
            throw new TypeError('durable posting disagrees with its row directory');
          if (record.seq > seq) throw new TypeError('durable posting is ahead of its snapshot');
          const row = await tx.row(record);
          if (!row) throw new TypeError('durable posting points to a deleted row');
          // The next posting/body is pulled only when the evaluator requests it.
          return { done: false, value: row as Value };
        }
      },
      async return() { stopped = true; await postings.return?.(); return { done: true, value: undefined }; },
    };
  }

  readable(table: string): boolean { return this.tx.program.schema.tables?.[table]?.retain === 'delivered-history'; }
  async missingSearchAuthority(table: string, index: string, prefix: LogicalIndexAtom[], context: Context): Promise<boolean> {
    const parts = components(this.tx.program.schema, table, index), derived = parts.findIndex(part => 'WordPrefixes' in part);
    const word = prefix[derived];
    if (!word || !('WordPrefix' in word) || word.WordPrefix.empty || this.readable(table)) return false;
    const key = indexPrefix(table, index, prefix.slice(0, derived));
    const members = this.tx.memberships.seek({ lower: key, upper: [...key, KEY_END], upperOpen: true });
    let record: DirectoryRecord | null = null;
    try {
      const first = await members.next();
      if (!first.done) {
        const member = first.value.key;
        if (!Array.isArray(member) || member.length !== key.length + 1
          || indexedDB.cmp(member.slice(0, -1), key) !== 0) throw new TypeError('durable scope membership has the wrong shape');
        record = await this.tx.directory(table, postingId(member));
        if (!record || !imageScopeKeys(table, record.parts).some(scope => indexedDB.cmp(scope, key) === 0))
          throw new TypeError('durable scope membership disagrees with its row directory');
      }
    } finally { await members.return?.(); }
    const row = record && await this.tx.row(record);
    if (record && !row) throw new TypeError('durable scope membership points to a deleted row');
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

import { RowImage } from './row-image';
export { immutable } from './row-image';
import { ReadableDirectory } from './held-directory';
import { canonicalSchemaJson } from './certificate-identity';
import { CoverageIndex, prepareRange } from './coverage';
import { fail, EvalError } from './errors';
import { sha256 } from './hash';
import { HeldIndex, components, ordinaryColumns, preparePrefix, scalarAtoms } from './index-store';
import type { SearchExecution } from './search-runtime';
import { Runner } from './runner';
import { asString, field, fieldOrNull, canonicalJson, wireJson, validateInputs } from './value-runtime';
import type { LogicalIndexAtom } from './search-key';
import type { ClosureReceipt, Context, Execution, LocalExecution, Trace, TraceRange, TraceWrite, Value } from './types';

export interface ClientStoreOptions {
  readable?: Iterable<string>;
  program?: any;
}
const empty = (): ClosureReceipt => ({ rows: [], ranges: [], absences: [], verdicts: [] });
// @ref LLP 1012#indexed-held-search — one row pool/index generation and a bounded mutation journal, shared by all named programs.
export class ClientStore {
  private tables = new Map<string, Map<string, Value>>();
  private indexes = new Map<string, HeldIndex>();
  private facts: CoverageIndex;
  private readonly readableTables: Set<string>;
  private journal?: Map<string, { table: string; id: string; row: Value | null }>;
  private overlay?: Map<string, { table: string; id: string; row: Value | null }>;
  private reversibleDepth = 0;
  private readonly schemaHash: string;
  private directories = new Map<any, ReadableDirectory>();
  constructor(readonly schema: any, receipt: ClosureReceipt = empty(), private readonly options: ClientStoreOptions = {}) {
    this.schemaHash = sha256(canonicalSchemaJson(schema));
    this.readableTables = new Set(options.readable ?? []);
    for (const [table, definition] of Object.entries<any>(schema.tables)) {
      this.tables.set(table, new Map());
      for (const name of Object.keys(definition.indexes)) this.indexes.set(JSON.stringify([table, name]), new HeldIndex(schema, table, name, components(schema, table, name)));
    }
    this.facts = new CoverageIndex(schema, (r, logical, id) => this.index(r.table, r.index).position(id, logical));
    for (const record of receipt.rows) {
      if (asString(field(record.row,'id')) !== record.id) fail('E_INPUT', 'receipt row identity must match its body');
      this.put(record.table, record.row);
    }
    this.setReceipt('seed', receipt, options.program);
  }
  readable(table: string): boolean { return this.readableTables.has(table); }
  setReceipt(owner: string, receipt?: ClosureReceipt, program?: any, issuedKeys?: Parameters<CoverageIndex['set']>[3], pool?: Set<string>): boolean {
    const changed = this.facts.set(owner, this.checkedReceipt(receipt,pool), program, issuedKeys);
    this.touchProofs(changed); return changed.length > 0;
  }
  private checkedReceipt(receipt?: ClosureReceipt, admittedPool?: Set<string>): ClosureReceipt | undefined {
    if (receipt) {
      const pool = admittedPool ?? new Set(receipt.rows.map(r => JSON.stringify([r.table, r.id])));
      for (const r of receipt.ranges) {
        for (const id of r.row_ids) if (!pool.has(JSON.stringify([r.table, id])) && !r.evicted_ids?.includes(id))
          fail('E_INPUT', 'range member must reference its receipt row pool');
      }
      for (const r of receipt.ranges) if (r.halo && (r.halo.table !== r.table || !pool.has(JSON.stringify([r.halo.table, r.halo.id]))))
        fail('E_INPUT', 'halo must reference the same receipt row pool');
      if (receipt.schema_hash !== this.schemaHash) receipt = { ...receipt, absences: [], verdicts: [] };
    }
    return receipt;
  }
  // @ref LLP 1012#indexed-held-search — coverage owns proof keys, never a second full receipt row pool.
  private touchProofs(changes: Iterable<ReturnType<CoverageIndex['set']>[number]>): void {
    for (const changed of changes) if (changed) {
      for (const point of changed.absences) {
        const [table, index, key] = JSON.parse(point); this.touchAuthority(table, index, key);
      }
      for (const [key] of changed.verdicts) {
        const digest = JSON.parse(key)[1];
        for (const d of this.directories.values()) d.touchDigest(digest);
      }
    }
  }
  rehydrate(receipt: ClosureReceipt): number {
    if (this.journal) fail('E_INPUT', 'nested prediction transaction');
    // Validate the entire replacement before touching current rows or authority.
    const rows = receipt.rows.map(({ table,id,row }) => {
      const value = this.prepareRow(table,row);
      if (asString(field(value,'id')) !== id) fail('E_INPUT', 'receipt row identity must match its body');
      return { table,id,row: value };
    });
    const next = new CoverageIndex(this.schema, (r, logical, id) => this.index(r.table, r.index).position(id, logical));
    const changes = next.set('seed',this.checkedReceipt({ ...receipt,rows }),this.options.program);
    const old = this.facts, directories = this.directories;
    const ids = new Set(rows.map(r => JSON.stringify([r.table,r.id])));
    let removed = 0;
    this.journal = new Map(); this.facts = next; this.directories = new Map();
    try {
      for (const [table, held] of this.tables) for (const id of held.keys())
        if (!ids.has(JSON.stringify([table,id]))) { this.remove(table,id); removed++; }
      for (const r of rows) this.put(r.table,r.row);
      for (const r of this.journal.values()) next.changed(r.table,r.id);
    } catch (error) {
      this.facts = old; this.rollback(); throw error;
    } finally { this.directories = directories; }
    const touched = this.journal; this.journal = undefined;
    // Existing directory objects/indexes survive; all notifications see final facts and rows.
    for (const r of touched.values()) this.touchRows(r.table,r.row,this.byId(r.table,r.id));
    this.touchProofs(changes); this.touchProofs(old.authorityOwners());
    return removed;
  }
  applyMutation(program: any, context: Context, preview = false, certificate: any = null, predictDelivery = false): LocalExecution {
    validateInputs(this.schema, program, context.args);
    if (this.journal) fail('E_INPUT', 'nested prediction transaction');
    this.journal = new Map();
    const runner = new Runner(this, this.schema, context, certificate, undefined, predictDelivery);
    let execution: Execution;
    try { execution = runner.execute(program); }
    catch (error) {
      this.rollback();
      if (runner.coverageMisses().includes('missing-authority')) return { state: 'partial', partialSites: ['missing-authority'], execution: { result: 'Null', trace: runner.trace, next: null, writes: [] } };
      if (error instanceof EvalError) { error.trace = runner.trace; error.partialSites = this.uncoveredSites(runner.trace, runner.coverageMisses(), program, runner.search); }
      throw error;
    }
    const changed = [...this.journal.values()].map(r => ({ ...r, row: this.byId(r.table, r.id) }));
    this.rollback();
    const uncoveredSites = this.uncoveredSites(execution.trace, [], program, runner.search);
    const partialSites = runner.coverageMisses();
    if (partialSites.length) return { state: 'partial', partialSites, execution, uncoveredSites, authorityMisses: runner.authorityMisses() };
    if (!preview) for (const r of changed) { if (r.row) this.put(r.table, r.row); else this.remove(r.table, r.id); }
    return { state: 'predicted', partialSites: [], execution, uncoveredSites };
  }
  private rollback(): void {
    const journal = this.journal!; this.journal = undefined;
    this.reversibleDepth++;
    try { for (const r of journal.values()) { if (r.row) this.put(r.table, r.row); else this.remove(r.table, r.id); } }
    finally { this.reversibleDepth--; }
  }

  /** Apply only mutation-produced rows above authoritative rows/evidence. The
   * first touch records the base image, so a FIFO rebase scales with changed
   * rows rather than copying the held pool. */
  applyOverlay(writes: readonly TraceWrite[]): number {
    this.overlay ??= new Map();
    this.reversibleDepth++;
    try {
      for (const write of writes) {
        const key = JSON.stringify([write.table, write.id]);
        if (!this.overlay.has(key)) this.overlay.set(key,
          { table: write.table, id: write.id, row: this.byId(write.table, write.id) });
        if (write.row) this.put(write.table, write.row); else this.remove(write.table, write.id);
      }
    } finally { this.reversibleDepth--; }
    return writes.length;
  }

  /** Remove every pending image while retaining the authoritative pool and its
   * closure evidence. Returns the number of row keys restored. */
  clearOverlay(): number {
    const overlay = this.overlay;
    if (!overlay) return 0;
    this.overlay = undefined;
    this.reversibleDepth++;
    try {
      for (const base of overlay.values()) {
        if (base.row) this.put(base.table, base.row); else this.remove(base.table, base.id);
      }
    } finally { this.reversibleDepth--; }
    return overlay.size;
  }

  /** Authoritative image beneath a pending overlay, for same-sequence conflict checks. */
  baseById(table: string, id: string): Value | null {
    return this.overlay?.get(JSON.stringify([table, id]))?.row ?? this.byId(table, id);
  }
  reexecute(program: any, context: Context, certificate: any = null, search?: SearchExecution): LocalExecution {
    validateInputs(this.schema, program, context.args);
    const runner = new Runner(this, this.schema, context, certificate, search);
    let execution: Execution;
    try { execution = runner.execute(program); }
    catch (error) {
      if (error instanceof EvalError) { error.trace = runner.trace; error.partialSites = this.uncoveredSites(runner.trace, runner.coverageMisses(), program, runner.search); }
      throw error;
    }
    const partialSites = this.uncoveredSites(execution.trace, runner.coverageMisses(), program, runner.search);
    if (partialSites.length) execution.next = null;
    return { state: partialSites.length ? 'partial' : 'fresh', partialSites, execution };
  }
  uncoveredSites(trace: Trace, misses: string[] = [], program?: any, search?: SearchExecution): string[] {
    const partial = new Set(misses);
    for (const r of trace.ranges) if (!this.facts.covers(r, prepareRange(this.schema, r, program, search))) partial.add(r.site);
    // @ref LLP 1012#6-reads-offline — public group exhaustion proves this read's null, not primary/rule authority.
    for (const a of trace.absences) if (!this.hasAbsence(a.table, a.index, a.key) && this.lookup(a.table, a.index, a.key) === null) {
      const table = this.schema.tables[a.table];
      if (table.rules.read !== 'Allow' || !table.indexes[a.index].unique
        || !this.facts.drained(a.table, a.index, preparePrefix(this.schema, a.table, a.index, scalarAtoms(a.key), []))) partial.add(a.site);
    }
    return [...partial].sort();
  }
  rangeStop(range: TraceRange, logical: LogicalIndexAtom[]): TraceRange['stop'] { return this.facts.stop(range, logical); }
  rows(table: string): Value[] { return [...(this.tables.get(table)?.values() ?? [])]; }
  lookup(table: string, index: string, key: Value[]): Value | null {
    const definition = this.schema.tables?.[table]?.indexes?.[index];
    if (!definition || key.length !== ordinaryColumns(definition).length) fail('E_TYPE', 'point requires a complete ordinary index key');
    const prefix = preparePrefix(this.schema, table, index, scalarAtoms(key), []);
    return this.seek(table, index, prefix, null, null, null, 'Asc').next().value ?? null;
  }
  index(table: string, index: string): HeldIndex {
    const held = this.indexes.get(JSON.stringify([table, index]));
    if (!held) fail('E_SCHEMA', `missing index ${table}.${index}`);
    return held;
  }
  seek(table: string, index: string, prefix: LogicalIndexAtom[], after: Value | null, before: Value | null, range: any, order: 'Asc' | 'Desc'): Generator<Value> {
    return this.index(table, index).scan({ prefix, after, before, range, order });
  }
  scan(table: string, index: string, prefix: LogicalIndexAtom[], after: Value | null, before: Value | null, range: any, order: 'Asc' | 'Desc', limit: number): Value[] {
    const result: Value[] = [];
    if (limit > 0) for (const row of this.seek(table, index, prefix, after, before, range, order)) { result.push(row); if (result.length >= limit) break; }
    return result;
  }
  private prepareRow(table: string, row: Value): RowImage {
    return RowImage.prepare(this.schema,table,row,this.schemaHash);
  }
  put(table: string, row: Value): boolean {
    const value = this.prepareRow(table,row);
    const id = asString(field(value, 'id')), rows = this.tables.get(table);
    if (!rows) fail('E_SCHEMA', `missing table ${table}`);
    const old = this.byId(table, id);
    if (old === value) return false;
    const changed = !RowImage.equal(old,value);
    if (!changed) RowImage.keys(value,RowImage.keys(old as RowImage));
    this.record(table, id);
    for (const name of Object.keys(this.schema.tables[table].indexes)) this.index(table, name).putPrepared(id, value, RowImage.keys(value)[name]);
    rows.set(id, value);
    if (changed) {
      if (!this.journal && this.reversibleDepth === 0) this.facts.changed(table, id);
      this.touchRows(table, old, value);
    }
    return changed;
  }
  remove(table: string, id: string): Value | null {
    const old = this.byId(table, id); if (!old) return null;
    this.record(table, id);
    for (const name of Object.keys(this.schema.tables[table].indexes)) this.index(table, name).remove(id);
    this.tables.get(table)!.delete(id);
    if (!this.journal && this.reversibleDepth === 0) this.facts.changed(table, id);
    this.touchRows(table, old, null);
    return old;
  }
  registerHeld(programs: Record<string, { ir: unknown }>, context: Context): void {
    const visit = (value: any): void => {
      if (!value || typeof value !== 'object') return;
      if (value.held_search) {
        const d = value.held_search, lane = value.lanes?.[0];
        if (value.lanes.length !== 1 || !lane.source || lane.setup?.length || lane.scan.before !== null || lane.scan.range !== null
          || d.table !== lane.scan.table || d.index !== lane.scan.index || d.order !== lane.scan.order
          || canonicalJson(d.discovery.scan) !== canonicalJson(lane.source) || d.discovery.binding !== lane.binding
          || canonicalJson(d.term) !== canonicalJson(lane.scan.prefix.at(-1)?.WordPrefix)) fail('E_TRACE_SUBSET', 'held search metadata does not match its merge');
        const index = this.index(d.table, d.index);
        if (index.derived !== d.scope.length || d.suffix.at(-1) !== 'id') fail('E_TRACE_SUBSET', 'invalid held search partition');
        this.directories.set(d, new ReadableDirectory(index, d, context.viewer, row => new Runner(this, this.schema, context, null).readAuthority(d.table, row)));
      }
      for (const child of Object.values(value)) visit(child);
    };
    for (const operation of Object.values(programs)) visit(operation.ir);
  }
  missingSearchAuthority(table: string, name: string, logical: LogicalIndexAtom[], context: Context): boolean {
    const index = this.index(table, name), derived = logical[index.derived];
    if (!derived || !('WordPrefix' in derived) || derived.WordPrefix.empty || this.readable(table)) return false;
    // Equality-bound direct searches need only their exact scope, even on the first warm invocation.
    const row = index.scopes.get(logical.slice(0, index.derived).map(a => (a as { Scalar: Value }).Scalar))?.values().next().value;
    return !!row && new Runner(this, this.schema, { ...context, args: {}, new_ids: [] }, null)
      .readAuthority(table, row, index.parts.slice(0, index.derived).map(c => (c as { Column: string }).Column)) === null;
  }
  heldDirectory(descriptor: any): ReadableDirectory | undefined { return this.directories.get(descriptor); }
  private touchAuthority(table: string, index: string, key: Value[]): void {
    const dependency = canonicalJson([table, index, key.map(wireJson)]);
    for (const d of this.directories.values()) d.touch(dependency);
  }
  private touchRows(table: string, old: Value | null, next: Value | null): void {
    for (const row of [old, next]) if (row) {
      for (const [index, definition] of Object.entries<any>(this.schema.tables[table].indexes)) {
        if (definition.components.every((c: any) => 'Column' in c)) this.touchAuthority(table, index, ordinaryColumns(definition).map(c => fieldOrNull(row, c)));
        for (const d of this.directories.values()) if (d.index.table === table && d.index.name === index) d.refresh(definition.components.slice(0, d.index.derived).map((c: any) => fieldOrNull(row, c.Column)));
      }
    }
  }
  private record(table: string, id: string): void {
    const key = JSON.stringify([table, id]);
    if (this.journal && !this.journal.has(key)) this.journal.set(key, { table, id, row: this.byId(table, id) });
  }
  byId(table: string, id: string): Value | null { return this.tables.get(table)?.get(id) ?? null; }
  verdict(rule: string, digest: string, context: Context): boolean | null { return this.facts.verdict(rule, digest, context.viewer, context.auth_epoch); }
  authorityAbsence(table: string, id: string): boolean { return this.hasAbsence(table, 'byId', [{ Id: id }]); }
  hasAbsence(table: string, index: string, key: Value[]): boolean { return this.facts.hasAbsence(table, index, key); }
  hasCompleteRange(table: string, index: string, key: Value[]): boolean { return this.facts.drained(table, index, scalarAtoms(key)); }
}

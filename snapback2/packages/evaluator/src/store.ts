import { ReadableDirectory } from './held-directory';
import { canonicalSchemaJson } from './certificate-identity';
import { CoverageIndex, prepareRange } from './coverage';
import { EvalError } from './errors';
import { sha256 } from './hash';
import { HeldIndex, components, ordinaryColumns, preparePrefix, scalarAtoms } from './index-store';
import type { SearchExecution } from './search-runtime';
import { Runner } from './runner';
import { asString, clone, field, fieldOrNull, canonicalJson, wireJson, materializeOptionalFields, validateInputs, validateWriteRow } from './value-runtime';
import type { LogicalIndexAtom } from './search-key';
import type { ClosureReceipt, Context, Execution, LocalExecution, Trace, Value } from './types';

export interface ClientStoreOptions {
  readable?: Iterable<string>;
  program?: any;
}
const empty = (): ClosureReceipt => ({ rows: [], ranges: [], absences: [], verdicts: [] });
export function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) immutable(v);
    Object.freeze(value);
  }
  return value;
}

// @ref LLP 1012#indexed-held-search — one row pool/index generation and a bounded mutation journal, shared by all named programs.
export class ClientStore {
  private tables = new Map<string, Map<string, Value>>();
  private indexes = new Map<string, HeldIndex>();
  private facts: CoverageIndex;
  private readonly readableTables: Set<string>;
  private journal?: Map<string, { table: string; id: string; row: Value | null }>;
  private readonly schemaHash: string;
  private directories = new Map<any, ReadableDirectory>();
  private receipts = new Map<string, ClosureReceipt>();
  constructor(readonly schema: any, receipt: ClosureReceipt = empty(), private readonly options: ClientStoreOptions = {}) {
    this.schemaHash = sha256(canonicalSchemaJson(schema));
    this.readableTables = new Set(options.readable ?? []);
    for (const [table, definition] of Object.entries<any>(schema.tables)) {
      this.tables.set(table, new Map());
      for (const name of Object.keys(definition.indexes)) this.indexes.set(JSON.stringify([table, name]), new HeldIndex(schema, table, name, components(schema, table, name)));
    }
    this.facts = new CoverageIndex(schema, (r, logical, id) => this.index(r.table, r.index).position(id, logical));
    for (const record of receipt.rows) this.put(record.table, record.row);
    this.setReceipt('seed', receipt, options.program);
  }
  readable(table: string): boolean { return this.readableTables.has(table); }
  setReceipt(owner: string, receipt?: ClosureReceipt, program?: any): void {
    if (receipt) {
      const pool = new Set(receipt.rows.map(r => JSON.stringify([r.table, r.id])));
      for (const r of receipt.ranges) {
        for (const id of r.row_ids) if (!pool.has(JSON.stringify([r.table, id])) && !r.evicted_ids?.includes(id))
          throw new EvalError('E_INPUT', 'range member must reference its receipt row pool');
      }
      for (const r of receipt.ranges) if (r.halo && (r.halo.table !== r.table || !pool.has(JSON.stringify([r.halo.table, r.halo.id]))))
        throw new EvalError('E_INPUT', 'halo must reference the same receipt row pool');
      if (receipt.schema_hash !== this.schemaHash) receipt = { ...receipt, absences: [] };
    }
    const old = this.receipts.get(owner);
    this.facts.set(owner, receipt, program);
    if (receipt) this.receipts.set(owner, receipt); else this.receipts.delete(owner);
    for (const r of [old, receipt]) if (r) {
      for (const [table, index, key] of r.absences) this.touchAuthority(table, index, key);
      for (const v of r.verdicts) for (const d of this.directories.values()) d.touchDigest(v.pinned_inputs_digest);
    }
  }
  rehydrate(receipt: ClosureReceipt): number {
    const ids = new Set(receipt.rows.map(r => JSON.stringify([r.table, r.id])));
    let removed = 0;
    for (const [table, rows] of this.tables) for (const id of rows.keys()) if (!ids.has(JSON.stringify([table, id]))) { this.remove(table, id); removed++; }
    for (const r of receipt.rows) this.put(r.table, r.row);
    this.facts = new CoverageIndex(this.schema, (r, logical, id) => this.index(r.table, r.index).position(id, logical));
    this.setReceipt('seed', receipt, this.options.program);
    return removed;
  }
  applyMutation(program: any, context: Context, preview = false, certificate: any = null): LocalExecution {
    validateInputs(this.schema, program, context.args);
    if (this.journal) throw new EvalError('E_INPUT', 'nested prediction transaction');
    this.journal = new Map();
    const runner = new Runner(this, this.schema, context, certificate);
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
    for (const r of journal.values()) { if (r.row) this.put(r.table, r.row); else this.remove(r.table, r.id); }
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
    for (const a of trace.absences) if (!this.hasAbsence(a.table, a.index, a.key) && this.lookup(a.table, a.index, a.key) === null) partial.add(a.site);
    return [...partial].sort();
  }
  rows(table: string): Value[] { return [...(this.tables.get(table)?.values() ?? [])]; }
  lookup(table: string, index: string, key: Value[]): Value | null {
    const definition = this.schema.tables?.[table]?.indexes?.[index];
    if (!definition || key.length !== ordinaryColumns(definition).length) throw new EvalError('E_TYPE', 'point requires a complete ordinary index key');
    const prefix = preparePrefix(this.schema, table, index, scalarAtoms(key), []);
    return this.seek(table, index, prefix, null, null, null, 'Asc').next().value ?? null;
  }
  index(table: string, index: string): HeldIndex {
    const held = this.indexes.get(JSON.stringify([table, index]));
    if (!held) throw new EvalError('E_SCHEMA', `missing index ${table}.${index}`);
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
  put(table: string, row: Value): void {
    const value = Object.isFrozen(row) ? row : immutable(materializeOptionalFields(this.schema, table, clone(row)));
    validateWriteRow(this.schema, table, value);
    const id = asString(field(value, 'id')), rows = this.tables.get(table);
    if (!rows) throw new EvalError('E_SCHEMA', `missing table ${table}`);
    const old = this.byId(table, id);
    this.record(table, id);
    for (const name of Object.keys(this.schema.tables[table].indexes)) this.index(table, name).put(value);
    rows.set(id, value);
    if (!this.journal) this.facts.changed(table, id);
    this.touchRows(table, old, value);
  }
  remove(table: string, id: string): Value | null {
    const old = this.byId(table, id); if (!old) return null;
    this.record(table, id);
    for (const name of Object.keys(this.schema.tables[table].indexes)) this.index(table, name).remove(id);
    this.tables.get(table)!.delete(id);
    if (!this.journal) this.facts.changed(table, id);
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
          || canonicalJson(d.term) !== canonicalJson(lane.scan.prefix.at(-1)?.WordPrefix)) throw new EvalError('E_TRACE_SUBSET', 'held search metadata does not match its merge');
        const index = this.index(d.table, d.index);
        if (index.derived !== d.scope.length || d.suffix.at(-1) !== 'id') throw new EvalError('E_TRACE_SUBSET', 'invalid held search partition');
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

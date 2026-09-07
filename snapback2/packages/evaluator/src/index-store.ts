import { Ordered } from './ordered';
import { PostingTree } from './posting-tree';
import { PrefixDictionary } from './prefix-dictionary';
import { EvalError } from './errors';
import { asString, assertValue, columnDescriptor, compareArrays, field, fieldOrNull, totalCompare, validateColumnValue } from './value-runtime';
import { prepareIndexAtom, type IndexAtom, type IndexComponent, type LogicalIndexAtom } from './search-key';
import { searchFieldWords, scalarLength, SEARCH_CONTRACT, SearchInputError } from './unicode';
import type { Value } from './types';

export function components(schema: any, table: string, name: string): IndexComponent[] {
  const parts = schema.tables?.[table]?.indexes?.[name]?.components;
  if (!Array.isArray(parts)) throw new EvalError('E_SCHEMA', `missing index components ${table}.${name}`);
  return parts;
}
export function ordinaryColumns(index: { components: IndexComponent[] }): string[] {
  return index.components.map(c => { if (!('Column' in c)) throw new EvalError('E_TYPE', 'derived index is scan-only'); return c.Column; });
}
export const scalarAtoms = (values: Value[]): { Scalar: Value }[] => values.map(Scalar => ({ Scalar }));
export const prefixCompare = (key: Value[], prefix: Value[]): number => compareArrays(key.slice(0, prefix.length), prefix);
export function logicalKey(key: readonly LogicalIndexAtom[]): string {
  // Only prepared meaning enters this identity. Descriptor source JSON is never a key.
  return JSON.stringify(key.map(c => 'Scalar' in c ? c.Scalar : { WordPrefix: c.WordPrefix.token }));
}
export function preparePrefix(schema: any, table: string, index: string, atoms: IndexAtom[], maxima: (number | undefined)[], word = prepareIndexAtom): LogicalIndexAtom[] {
  const parts = components(schema, table, index);
  if (atoms.length > parts.length) throw new EvalError('E_TYPE', 'index prefix is too wide');
  const derived = parts.findIndex(c => 'WordPrefixes' in c);
  if (derived >= atoms.length) throw new EvalError('E_INPUT', 'search must equality-bind its derived component');
  try { return atoms.map((atom, i) => {
    const c = parts[i], prepared = word(c, atom, maxima[i]);
    if ('Column' in c && 'Scalar' in prepared && prepared.Scalar !== 'Null')
      // A trusted Input::Viewer can be system while caller arguments and stored rows cannot.
      validateColumnValue(schema, table, c.Column, prepared.Scalar, true);
    return prepared;
  }); } catch (error) { if (error instanceof SearchInputError) throw new EvalError("E_INPUT", error.message); throw error; }
}
export type KeyParts = Array<{ Scalar: Value } | { Words: string[] }>;
export type KeyImage = { [index: string]: KeyParts };
export function indexKeys(schema: any, table: string, name: string, value: (column: string) => Value): KeyParts {
  return components(schema, table, name).map(c => 'Column' in c ? { Scalar: value(c.Column) } : {
    Words: searchFieldWords(c.WordPrefixes.fields.map(f => {
      const v = value(f), t = schema.tables[table].columns[f];
      return { source: v === 'Null' ? null : asString(v), sourceMax: (t.Optional ?? t).Text.max };
    })),
  });
}
const scalar = (part: KeyParts[number]): Value => 'Scalar' in part ? part.Scalar : 'Null';
type PreparedKeys = { parts: KeyParts; nodes: Uint32Array; scope: Value[]; refs: number; identity: object };
type Record<Row> = { handle: number; keys: PreparedKeys; row: Row; id: Value };
export interface IndexScan {
  prefix: LogicalIndexAtom[]; after: Value | null; before: Value | null; range: any;
  order: 'Asc' | 'Desc';
  first?: Value[];
  last?: Value[];
}

/** Shared admission for execution and receipt replacement; no index mutation or seek. */
export function indexTuple(schema: any, table: string, parts: IndexComponent[], value: Value | null): Value[] | null {
  if (value === null) return null;
  const tuple = typeof value === 'object' && 'Array' in value;
  if (tuple && (Object.keys(value).length !== 1 || !Array.isArray(value.Array)))
    throw new EvalError('E_INPUT', 'index bound is not a tagged array');
  const candidates = tuple ? value.Array : [value];
  // Preserve whole-value preflight before width/type refusal, with authority only from current columns.
  candidates.forEach((item, i) => {
    const part = parts[i];
    assertValue(item, 'index bound', part && 'Column' in part ? columnDescriptor(schema, table, part.Column) : undefined, schema);
  });
  const values = tuple || parts.length === 1 ? candidates : [];
  if (!parts.length || !Array.isArray(values) || values.length !== parts.length) throw new EvalError('E_TYPE', 'cursor suffix width mismatch');
  values.forEach((value, i) => {
    const c = parts[i];
    if (!('Column' in c)) throw new EvalError('E_INPUT', 'derived suffix cannot be ordered');
    if (value !== 'Null') validateColumnValue(schema, table, c.Column, value);
  });
  return values;
}
export function prepareScanBounds(schema: any, table: string, parts: IndexComponent[], input: Omit<IndexScan, 'prefix'> & { prefix: readonly unknown[] }) {
  const suffix = parts.slice(input.prefix.length);
  const after = indexTuple(schema, table, suffix, input.after), before = indexTuple(schema, table, suffix, input.before);
  if (input.order !== 'Asc' && input.order !== 'Desc') throw new EvalError('E_INPUT', 'invalid scan order');
  for (const [kind, value] of Object.entries<Value | null>(input.range ?? {})) {
    if (!['gt', 'gte', 'lt', 'lte'].includes(kind)) throw new EvalError('E_INPUT', 'invalid scan bound');
    if (value === null) continue;
    const c = suffix[0];
    if (!c || !('Column' in c)) throw new EvalError('E_INPUT', 'range requires an ordinary suffix');
    if (value !== 'Null') validateColumnValue(schema, table, c.Column, value);
  }
  return { after, before };
}

/** One physical index with compact trie handles; source spelling never enters postings. */
export class HeldIndex<Row = Value> {
  private readonly records: (Record<Row> | undefined)[] = [undefined];
  private readonly prepared = new WeakMap<object, PreparedKeys>();
  private readonly freeRows: number[] = [];
  private readonly tree = new PostingTree((a, token, b, otherToken) => {
    const left = this.records[a]!, right = this.records[b]!;
    if (this.partition) { const cmp = this.partition(left.row) - this.partition(right.row); if (cmp) return cmp; }
    for (let i = 0; i < this.parts.length; i++) {
      const cmp = i === this.derived ? token - otherToken : totalCompare(scalar(left.keys.parts[i]), scalar(right.keys.parts[i]));
      if (cmp) return cmp;
    }
    return this.partition ? left.handle - right.handle : totalCompare(left.id, right.id);
  });
  readonly scopes = new Ordered<Value[], Set<Row>>(compareArrays);
  private readonly dictionary = new PrefixDictionary();
  private generation = 0;
  private resolved = new WeakMap<object, { generation: number; id?: number }>();
  private readonly reverse = new Map<string, Record<Row>>();
  get size(): number { return this.reverse.size; }
  readonly derived: number;
  private wordScalars = 0;
  constructor(readonly schema: any, readonly table: string, readonly name: string, readonly parts: IndexComponent[], private partition?: (row: Row) => number) {
    this.derived = parts.findIndex(c => 'WordPrefixes' in c);
    const definition = schema.tables[table].indexes[name];
    if (!parts.length || parts.length > 8 || parts.filter(c => 'WordPrefixes' in c).length > 1)
      throw new EvalError('E_SCHEMA', 'invalid index component shape');
    const names = new Set<string>();
    for (const c of parts) {
      if (Object.keys(c).length !== 1) throw new EvalError('E_SCHEMA', 'invalid index component');
      if ('Column' in c) {
        if (names.has(c.Column) || !schema.tables[table].columns[c.Column]) throw new EvalError('E_SCHEMA', 'invalid index column');
        names.add(c.Column);
      } else {
        const d = c.WordPrefixes;
        if (!d || Object.keys(d).length !== 2 || d.contract !== SEARCH_CONTRACT || definition.unique || this.derived === parts.length - 1
          || !d.fields.length || new Set(d.fields).size !== d.fields.length) throw new EvalError('E_SCHEMA', 'invalid search index');
        for (const f of d.fields) {
          const t = schema.tables[table].columns[f];
          if (!(t?.Optional ?? t)?.Text) throw new EvalError('E_SCHEMA', 'search field must be bounded text');
          const max = (t.Optional ?? t).Text.max; scalarLength('',max); this.wordScalars += 4 * max;
        }
      }
    }
  }
  remove(id: string): void {
    const old = this.reverse.get(id);
    if (!old) return;
    this.generation++;
    for (const token of old.keys.nodes) this.tree.remove(old.handle, token);
    if (this.derived < 0) this.tree.remove(old.handle, 0);
    if (this.derived >= 0 && !this.partition) {
      const rows = this.scopes.get(old.keys.scope)!;
      rows.delete(old.row);
      if (!rows.size) this.scopes.delete(old.keys.scope);
    }
    if (!--old.keys.refs) {
      for (let i = old.keys.nodes.length - 1; i >= 0; i--) this.dictionary.release(old.keys.nodes[i]);
      this.prepared.delete(old.keys.identity);
    }
    this.records[old.handle] = undefined; this.freeRows.push(old.handle); this.reverse.delete(id);
  }
  put(row: Row & Value): void {
    this.putPrepared(asString(field(row, 'id')), row, indexKeys(this.schema, this.table, this.name, c => fieldOrNull(row,c)));
  }
  /** Internal immutable-key custody uses the same postings without recovering source text. */
  putPrepared(id: string, row: Row, parts: KeyParts): void {
    if (parts.length !== this.parts.length) throw new EvalError('E_SCHEMA', 'immutable index width mismatch');
    const identity = parts, derived = parts[this.derived], words = derived && 'Words' in derived ? derived.Words : [];
    let scalars = 0;
    for (const word of words) {
      scalars += scalarLength(word,word.length);
      if (!word.length || scalars > this.wordScalars) throw new EvalError('E_INPUT', 'immutable search postings exceed source bounds');
    }
    const old = this.reverse.get(id);
    if (old?.keys.parts === parts && (!this.partition || this.partition(old.row) === this.partition(row))) {
      if (this.derived >= 0 && !this.partition) {
        const rows = this.scopes.get(old.keys.scope)!; rows.delete(old.row); rows.add(row);
      }
      old.row = row; return;
    }
    this.remove(id); this.generation++;
    let keys = this.prepared.get(identity);
    if (!keys) {
      const nodes = new Set<number>();
      if (this.derived >= 0) {
        for (const word of words) {
          let node = 0;
          for (const scalar of word) {
            node = this.dictionary.intern(node, scalar.codePointAt(0)!);
            if (!nodes.has(node)) { nodes.add(node); this.dictionary.retain(node); }
          }
        }
      }
      // @ref LLP 1012#indexed-held-search — Hermes TypedArray.from currently reads an array-like `.length` and
      // does not consume Set's iterator. Fill the compact owner directly so
      // every retained prefix node becomes a posting on every client arm.
      const ownedNodes = new Uint32Array(nodes.size); let offset = 0;
      for (const node of nodes) ownedNodes[offset++] = node;
      keys = { parts,nodes: ownedNodes,scope: parts.slice(0,this.derived).map(scalar),refs: 0,identity };
      this.prepared.set(identity,keys);
    }
    keys.refs++;
    if (this.derived >= 0 && !this.partition) {
      const rows = this.scopes.get(keys.scope) ?? new Set<Row>(); rows.add(row); this.scopes.set(keys.scope,rows);
    }
    const handle = this.freeRows.pop() ?? this.records.length;
    const record: Record<Row> = { handle,keys,row,id: this.partition ? 'Null' : { Id: id } };
    this.records[handle] = record; this.reverse.set(id, record);
    for (const token of keys.nodes) this.tree.put(handle, token);
    if (this.derived < 0) this.tree.put(handle, 0);
  }
  /** Current membership and ordinary key of one receipt member, without rebuilding or scanning postings. */
  position(id: string, prefix: LogicalIndexAtom[]): Value[] | null {
    const record = this.reverse.get(id), row = record?.row; if (!record || !row) return null;
    const key = record.keys.parts.map(scalar);
    for (let i = 0; i < prefix.length; i++) {
      const atom = prefix[i];
      if ('Scalar' in atom) { if (totalCompare(key[i], atom.Scalar)) return null; }
      else { const node = this.resolve(atom); if (node === undefined) return null; key[i] = { Int: node }; }
    }
    if (!this.tree.has(record.handle, this.derived < 0 ? 0 : (key[this.derived] as { Int: number }).Int)) return null;
    return key.filter((_, i) => i !== this.derived);
  }
  private resolve(atom: Extract<LogicalIndexAtom, { WordPrefix: unknown }>): number | undefined {
    let resolved = this.resolved.get(atom);
    if (!resolved || resolved.generation !== this.generation) {
      let node = 0;
      if (atom.WordPrefix.token !== null) for (const scalar of atom.WordPrefix.token) { node = this.dictionary.child(node, scalar.codePointAt(0)!); if (!node) break; }
      resolved = { generation: this.generation, id: node || undefined }; this.resolved.set(atom, resolved);
    }
    return resolved.id;
  }
  *scan(input: IndexScan, partition?: number): Generator<Row> {
    const prefix: Value[] = []; let empty = false;
    for (const atom of input.prefix) {
      if ('Scalar' in atom) prefix.push(atom.Scalar);
      else {
        const id = this.resolve(atom);
        if (id === undefined) empty = true;
        prefix.push({ Int: id ?? 0 });
      }
    }
    const { after, before } = prepareScanBounds(this.schema, this.table, this.parts, input), desc = input.order === 'Desc';
    if (empty) return;
    const compare = (key: Value[]): number => {
      const p = prefixCompare(key, prefix); if (p) return p;
      const suffix = key.slice(prefix.length, this.parts.length);
      if (input.first && compareArrays(suffix, input.first) < 0) return -1;
      if (input.last && compareArrays(suffix, input.last) > 0) return 1;
      if (after) { const c = compareArrays(suffix, after); if (desc ? c >= 0 : c <= 0) return desc ? 1 : -1; }
      if (before) { const c = compareArrays(suffix, before); if (desc ? c <= 0 : c >= 0) return desc ? -1 : 1; }
      for (const [kind, bound] of Object.entries<Value | null>(input.range ?? {})) {
        if (bound === null) continue;
        if (!suffix.length) throw new EvalError('E_TYPE', 'range has no ordinary suffix');
        const c = totalCompare(suffix[0], bound);
        if (kind === 'gt' ? c <= 0 : kind === 'gte' ? c < 0 : kind === 'lt' ? c >= 0 : c > 0) return kind[0] === 'g' ? -1 : 1;
      }
      return 0;
    };
    for (const handle of this.tree.seek((handle, token) => {
      const record = this.records[handle]!;
      if (partition !== undefined && this.partition) { const c = this.partition(record.row) - partition; if (c) return c; }
      const key = record.keys.parts.map(scalar);
      if (this.derived >= 0) key[this.derived] = { Int: token }; key.push(record.id); return compare(key);
    }, desc)) yield this.records[handle]!.row;
  }
}

import { Ordered } from './ordered';
import { PostingTree } from './posting-tree';
import { PrefixDictionary } from './prefix-dictionary';
import { EvalError } from './errors';
import { asString, compareArrays, field, fieldOrNull, totalCompare, validateTypedValue } from './value-runtime';
import { prepareIndexAtom, type IndexAtom, type IndexComponent, type LogicalIndexAtom } from './search-key';
import { searchFieldWords, SEARCH_CONTRACT, SearchInputError } from './unicode';
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
      validateTypedValue(schema.tables[table].columns[c.Column], prepared.Scalar, 'index component', false, true);
    return prepared;
  }); } catch (error) { if (error instanceof SearchInputError) throw new EvalError("E_INPUT", error.message); throw error; }
}
type Record = { handle: number; ordinary: Value[]; nodes: Uint32Array; scope: Value[]; row: Value; id: Value };
export interface IndexScan {
  prefix: LogicalIndexAtom[]; after: Value | null; before: Value | null; range: any;
  order: 'Asc' | 'Desc';
}

/** One physical index with compact trie handles; source spelling never enters postings. */
export class HeldIndex {
  private readonly records: (Record | undefined)[] = [undefined];
  private readonly freeRows: number[] = [];
  private readonly tree = new PostingTree((a, token, b, otherToken) => {
    const left = this.records[a]!, right = this.records[b]!;
    for (let i = 0; i < this.parts.length; i++) {
      const cmp = i === this.derived ? token - otherToken : totalCompare(left.ordinary[i], right.ordinary[i]);
      if (cmp) return cmp;
    }
    return totalCompare(left.id, right.id);
  });
  readonly scopes = new Ordered<Value[], Set<Value>>(compareArrays);
  private readonly dictionary = new PrefixDictionary();
  private generation = 0;
  private resolved = new WeakMap<object, { generation: number; id?: number }>();
  private readonly reverse = new Map<string, Record>();
  readonly derived: number;
  constructor(readonly schema: any, readonly table: string, readonly name: string, readonly parts: IndexComponent[]) {
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
        }
      }
    }
  }
  remove(id: string): void {
    const old = this.reverse.get(id);
    if (!old) return;
    this.generation++;
    for (const token of old.nodes) this.tree.remove(old.handle, token);
    if (this.derived < 0) this.tree.remove(old.handle, 0);
    if (this.derived >= 0) {
      const rows = this.scopes.get(old.scope)!;
      rows.delete(old.row);
      if (!rows.size) this.scopes.delete(old.scope);
    }
    for (let i = old.nodes.length - 1; i >= 0; i--) {
      this.dictionary.release(old.nodes[i]);
    }
    this.records[old.handle] = undefined; this.freeRows.push(old.handle); this.reverse.delete(id);
  }
  put(row: Value): void {
    const id = asString(field(row, 'id'));
    this.remove(id); this.generation++;
    const ordinary = this.parts.map(c => 'Column' in c ? fieldOrNull(row, c.Column) : 'Null' as Value);
    const nodes = new Set<number>();
    const scope = ordinary.slice(0, this.derived);
    if (this.derived >= 0) {
      const rows = this.scopes.get(scope) ?? new Set<Value>(); rows.add(row); this.scopes.set(scope, rows);
      const definition = this.parts[this.derived] as { WordPrefixes: { fields: string[] } };
      const words = searchFieldWords(definition.WordPrefixes.fields.map(f => {
        const value = fieldOrNull(row, f), t = this.schema.tables[this.table].columns[f];
        return { source: value === 'Null' ? null : asString(value), sourceMax: (t.Optional ?? t).Text.max };
      }));
      for (const word of words) {
        let node = 0;
        for (const scalar of word) {
          node = this.dictionary.intern(node, scalar.codePointAt(0)!);
          if (!nodes.has(node)) { nodes.add(node); this.dictionary.retain(node); }
        }
      }
    }
    const handle = this.freeRows.pop() ?? this.records.length;
    const record: Record = { handle, ordinary, nodes: Uint32Array.from(nodes), scope, row, id: { Id: id } };
    this.records[handle] = record; this.reverse.set(id, record);
    for (const token of nodes) this.tree.put(handle, token);
    if (this.derived < 0) this.tree.put(handle, 0);
  }
  /** Current membership and ordinary key of one receipt member, without rebuilding or scanning postings. */
  position(id: string, prefix: LogicalIndexAtom[]): Value[] | null {
    const record = this.reverse.get(id), row = record?.row; if (!record || !row) return null;
    const key = this.parts.map(c => 'Column' in c ? fieldOrNull(row, c.Column) : 'Null' as Value);
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
      if (!atom.WordPrefix.empty) for (const scalar of atom.WordPrefix.token!) { node = this.dictionary.child(node, scalar.codePointAt(0)!); if (!node) break; }
      resolved = { generation: this.generation, id: node || undefined }; this.resolved.set(atom, resolved);
    }
    return resolved.id;
  }
  *scan(input: IndexScan): Generator<Value> {
    const prefix: Value[] = []; let empty = false;
    for (const atom of input.prefix) {
      if ('Scalar' in atom) prefix.push(atom.Scalar);
      else {
        const id = this.resolve(atom);
        if (id === undefined) empty = true;
        prefix.push({ Int: id ?? 0 });
      }
    }
    const suffixWidth = this.parts.length - prefix.length;
    const tuple = (v: Value | null): Value[] | null => {
      if (v === null) return null;
      const values = typeof v === 'object' && 'Array' in v ? v.Array : suffixWidth === 1 ? [v] : [];
      if (!suffixWidth || values.length !== suffixWidth) throw new EvalError('E_TYPE', 'cursor suffix width mismatch');
      values.forEach((value, i) => {
        const c = this.parts[prefix.length + i];
        if (!('Column' in c)) throw new EvalError('E_INPUT', 'derived suffix cannot be ordered');
        if (value !== 'Null') validateTypedValue(this.schema.tables[this.table].columns[c.Column], value, 'cursor suffix', false);
      });
      return values;
    };
    const after = tuple(input.after), before = tuple(input.before), desc = input.order === 'Desc';
    if (input.order !== 'Asc' && input.order !== 'Desc') throw new EvalError('E_INPUT', 'invalid scan order');
    for (const [kind, value] of Object.entries<Value | null>(input.range ?? {})) {
      if (!['gt', 'gte', 'lt', 'lte'].includes(kind)) throw new EvalError('E_INPUT', 'invalid scan bound');
      if (value === null) continue;
      const c = this.parts[prefix.length];
      if (!c || !('Column' in c)) throw new EvalError('E_INPUT', 'range requires an ordinary suffix');
      if (value !== 'Null') validateTypedValue(this.schema.tables[this.table].columns[c.Column], value, 'range bound', false);
    }
    if (empty) return;
    const compare = (key: Value[]): number => {
      const p = prefixCompare(key, prefix); if (p) return p;
      const suffix = key.slice(prefix.length, this.parts.length);
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
      const record = this.records[handle]!, key = record.ordinary.slice();
      if (this.derived >= 0) key[this.derived] = { Int: token }; key.push(record.id); return compare(key);
    }, desc)) yield this.records[handle]!.row;
  }
}

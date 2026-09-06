// @ref LLP 1012#indexed-held-search — reverse carrier references keep normal swaps proportional to changed receipts/rows.
import { logicalKey, components } from '../../../evaluator/src/index-store.js';
import { prepareRange } from '../../../evaluator/src/coverage.js';
import { compareArrays, totalCompare } from '../../../evaluator/src/value-runtime.js';
import { searchFieldWords } from '../../../evaluator/src/unicode.js';
import { tagWireRangePrefix, tagWireIndexValues } from '../offline-protocol.js';
import { RowAssets } from './asset-policy.js';
import { canonical } from './canonical.js';
import { verdictFactKey } from './fact-integrity.js';
import type { PersistedRangeState, Receipt, ReceiptRange, StoredAnswer, StoredRow, OfflineSchema } from './range-store.js';
import type { LogicalIndexAtom } from '../../../evaluator/src/search-key.js';
import type { ChangedRecords } from './swap-journal.js';
const rowKey = (r: { table: string; id: string }) => `${r.table}\0${r.id}`;
type HeldRange = { owner: string; range: ReceiptRange; key: string };
export class CarrierIndex {
  readonly assets: RowAssets;
  readonly references = new Map<string, Set<string>>();
  readonly absences = new Map<string, Set<string>>();
  readonly verdicts = new Map<string, Set<string>>();
  private answers = new Map<string, { refs: string[]; absences: string[]; verdicts: string[]; ranges: HeldRange[] }>();
  private ranges = new Map<string, Set<HeldRange>>();
  private prepared = new WeakMap<object, { prefix: LogicalIndexAtom[]; key: string }>();
  constructor(private state: PersistedRangeState, private schema?: OfflineSchema) {
    this.assets = new RowAssets(state.onceColumns);
    for (const key of new Set([...Object.keys(state.rows), ...Object.keys(state.viewed)])) this.assets.set(key, state.rows[key], state.viewed[key]);
    for (const [key, answer] of Object.entries(state.answers)) this.set(key, answer);
  }
  private program(op: string): any { return this.state.programs[this.state.facts?.generation ?? '']?.programs[op]?.ir; }
  get schemaReady(): boolean { return !!(this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema); }
  rangeKey(range: ReceiptRange, op: string): string {
    const cached = this.prepared.get(range); if (cached) return cached.key;
    const program = this.program(op), schema = this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema;
    if (!schema) throw new TypeError('range admission requires a generation schema');
    const atoms = tagWireRangePrefix(schema, range as any, program);
    const prefix = prepareRange(schema, { ...range, prefix: atoms }, program);
    const key = canonical([range.site, range.table, range.index, logicalKey(prefix), range.order, range.after, range.before, range.gt, range.gte, range.lt, range.lte, range.ruleHash]);
    this.prepared.set(range, { prefix, key }); return key;
  }
  receipt(receipt: Receipt, rows: StoredRow[]): Receipt {
    const pool = new Map(rows.map(r => [rowKey(r), r]));
    return { ...structuredClone(receipt), ranges: receipt.ranges.map(range => {
      const row = (this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema) && pool.get(`${range.table}\0${range.rowIds.at(-1)}`);
      return { ...structuredClone(range), ...(row ? { heldSuffix: this.suffix(row, range) } : {}) };
    }) };
  }
  matching(range: ReceiptRange, op: string): Iterable<HeldRange> { return this.ranges.get(this.rangeKey(range, op)) ?? []; }
  set(key: string, answer?: StoredAnswer): void {
    const old = this.answers.get(key);
    if (old) {
      for (const id of old.refs) { const set = this.references.get(id)!; set.delete(key); if (!set.size) this.references.delete(id); }
      for (const id of old.absences) { const set = this.absences.get(id)!; set.delete(key); if (!set.size) this.absences.delete(id); }
      for (const id of old.verdicts) { const set = this.verdicts.get(id)!; set.delete(key); if (!set.size) this.verdicts.delete(id); }
      for (const r of old.ranges) { const set = this.ranges.get(r.key)!; set.delete(r); if (!set.size) this.ranges.delete(r.key); }
      this.answers.delete(key);
    }
    if (!answer) return;
    const refs = answer.refs.map(rowKey), absences = (answer.receipt?.absences ?? []).flatMap(([table, index, key]) => index === 'byId' && typeof key[0] === 'string' ? [`${table}\0${key[0]}`] : []);
    const verdicts = (answer.receipt?.verdicts ?? []).map(verdictFactKey);
    const ranges = (this.schema || this.state.programs[this.state.facts?.generation ?? '']?.schema ? answer.receipt?.ranges ?? [] : []).map(range => ({ owner: key, range, key: this.rangeKey(range, answer.op) }));
    for (const [map, ids] of [[this.references, refs], [this.absences, absences], [this.verdicts, verdicts]] as const)
      for (const id of ids) { const set = map.get(id) ?? new Set(); set.add(key); map.set(id, set); }
    for (const r of ranges) { const set = this.ranges.get(r.key) ?? new Set(); set.add(r); this.ranges.set(r.key, set); }
    this.answers.set(key, { refs, absences, verdicts, ranges });
  }
  update(state: PersistedRangeState, changed: ChangedRecords, schema?: OfflineSchema): void {
    this.state = state; this.schema = schema ?? this.schema;
    for (const key of new Set([...(changed.get('rows') ?? []), ...(changed.get('viewed') ?? [])])) this.assets.set(key, state.rows[key], state.viewed[key]);
    for (const key of changed.get('answers') ?? []) this.set(key, state.answers[key]);
  }
  /** All equality slots use normalized meaning. Range and cursor ordering sees only ordinary suffix values. */
  contains(row: StoredRow, range: ReceiptRange, op: string): boolean {
    const schema = this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema;
    this.rangeKey(range, op);
    const prefix = this.prepared.get(range)!.prefix, parts = components(schema, range.table, range.index);
    for (let i = 0; i < prefix.length; i++) {
      const atom = prefix[i], part = parts[i];
      if ('Scalar' in atom && 'Column' in part) {
        if (totalCompare(atom.Scalar, tagWireIndexValues(schema, range.table, range.index, [row.row[part.Column] as any ?? null], i)[0])) return false;
      } else if ('WordPrefix' in atom && 'WordPrefixes' in part) {
        if (atom.WordPrefix.empty || !searchFieldWords(part.WordPrefixes.fields.map(f => {
          const t = schema!.tables![range.table].columns![f] as any;
          return { source: row.row[f] as string ?? null, sourceMax: (t.Optional ?? t).Text.max };
        })).some(w => w.startsWith(atom.WordPrefix.token!))) return false;
      } else throw new TypeError('index atom does not match component');
    }
    const suffix = this.suffix(row, range);
    const bound = (v: any) => tagWireIndexValues(schema, range.table, range.index, Array.isArray(v) ? v : [v], range.prefix.length);
    if (range.after != null && (range.order === 'Asc' ? compareArrays(suffix, bound(range.after)) <= 0 : compareArrays(suffix, bound(range.after)) >= 0)) return false;
    if (range.before != null && (range.order === 'Asc' ? compareArrays(suffix, bound(range.before)) >= 0 : compareArrays(suffix, bound(range.before)) <= 0)) return false;
    for (const k of ['gt', 'gte', 'lt', 'lte'] as const) if (range[k] != null) {
      const c = totalCompare(suffix[0], bound(range[k])[0]);
      if (k === 'gt' ? c <= 0 : k === 'gte' ? c < 0 : k === 'lt' ? c >= 0 : c > 0) return false;
    }
    return true;
  }
  suffix(row: StoredRow, range: ReceiptRange) {
    const schema = this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema;
    const parts = components(schema, range.table, range.index).slice(range.prefix.length);
    return tagWireIndexValues(schema, range.table, range.index, parts.map(c => {
      if (!('Column' in c)) throw new TypeError('derived suffix is not orderable'); return row.row[c.Column] as any ?? null;
    }), range.prefix.length);
  }
}

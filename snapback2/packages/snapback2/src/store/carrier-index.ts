// @ref LLP 1012#indexed-held-search — reverse carrier references keep normal swaps proportional to changed receipts/rows.
import { components } from '../../../evaluator/src/index-store.js';
import { prepareRange } from '../../../evaluator/src/coverage.js';
import { compareArrays } from '../../../evaluator/src/value-runtime.js';
import { searchFieldWords } from '../../../evaluator/src/unicode.js';
import { tagWireRangePrefix, tagWireIndexValues } from '../offline-protocol.js';
import { RowAssets } from './asset-policy.js';
import { canonical } from './canonical.js';
import { verdictFactKey, factImageId, rowFactKey, factAssertion, factRow, answerProofs, type FactProof } from './fact-integrity.js';
import { FactIndex } from './fact-index.js';
import { ExtentIndex } from './extent-index.js';
import type { PersistedRangeState, Receipt, ReceiptRange, StoredAnswer, StoredRow, OfflineSchema } from './range-store.js';
import type { ChangedRecords } from './swap-journal.js';
import { rangeMeaningKey, type RangeMeaning, type KeyImage, type ExtentCondition } from './extent-facts.js';
const rowKey = (r: { table: string; id: string }) => `${r.table}\0${r.id}`;
type HeldRange = { owner: string; range: ReceiptRange; key: string };
export class CarrierIndex {
  readonly assets: RowAssets;
  readonly references = new Map<string, Set<string>>();
  readonly absences = new Map<string, Set<string>>();
  readonly verdicts = new Map<string, Set<string>>();
  readonly proofOwners = new Map<string, Set<string>>();
  readonly positives: FactIndex;
  readonly live: FactIndex;
  readonly closed = new ExtentIndex();
  private guards = new Map<string, [seq: number, digest: string]>();
  private extentOwners = new Map<string, { seq: number; id: string }>();
  private fullImages = new Map<string, Map<number,number>>();
  private masks = new Map<string,string>();
  private masked = new Map<string,Set<string>>();
  private answers = new Map<string, StoredAnswer>();
  private ranges = new Map<string, Map<string, Set<ReceiptRange>>>();
  private prepared = new WeakMap<object, { op: string; meaning: RangeMeaning }>();
  constructor(private state: PersistedRangeState, private schema?: OfflineSchema) {
    const current = state.programs[state.facts?.generation ?? '']?.schema ?? schema;
    this.positives = new FactIndex(current,true); this.live = new FactIndex(current,false,this.positives);
    this.assets = new RowAssets(state.onceColumns);
    for (const key of new Set([...Object.keys(state.rows), ...Object.keys(state.viewed)])) this.assets.set(key, state.rows[key], state.viewed[key]);
    for (const key of Object.keys(state.rows)) this.setRow(key);
    for (const key of Object.keys(state.rowFacts)) if (typeof state.rowFacts[key] !== 'number') this.setGuard(key);
    for (const [key, answer] of Object.entries(state.answers)) this.set(key, answer);
    for (const key of Object.keys(state.extentGuards)) this.setExtentGuard(key);
    for (const key of Object.keys(state.extentNegative)) this.setMask(key);
  }
  private program(op: string): any { return this.state.programs[this.state.facts?.generation ?? '']?.programs[op]?.ir; }
  get schemaReady(): boolean { return !!(this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema); }
  newFacts(): FactIndex { return new FactIndex(this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema,true); }
  proven(table: string, id: string, seq: number): boolean { return (this.fullImages.get(`${table}\0${id}`)?.get(seq) ?? 0) > 0; }
  private fullImage(key: string, seq: number | undefined, delta: number): void {
    if (seq === undefined) return;
    const counts = this.fullImages.get(key) ?? new Map<number,number>(), count = (counts.get(seq) ?? 0) + delta;
    if (count) counts.set(seq,count); else counts.delete(seq);
    if (counts.size) this.fullImages.set(key,counts); else this.fullImages.delete(key);
  }
  keyImage(row: StoredRow): KeyImage | undefined {
    const schema = this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema;
    if (!schema) return;
    const held = this.state.factImages[factImageId([rowFactKey(row.table,row.id), factAssertion(row)])!]?.keys;
    if (held) return held;
    const indexes: KeyImage = {};
    for (const name of Object.keys(schema.tables?.[row.table]?.indexes ?? {})) {
      indexes[name] = components(schema, row.table, name).map((part, offset) => 'Column' in part
        ? { Scalar: tagWireIndexValues(schema, row.table, name, [row.row[part.Column] as any ?? null], offset)[0] }
        : { Words: searchFieldWords(part.WordPrefixes.fields.map(f => {
          const type = schema.tables![row.table].columns![f] as any;
          return { source: row.row[f] as string ?? null, sourceMax: (type.Optional ?? type).Text.max };
        })) });
    }
    return indexes;
  }
  extent(range: ReceiptRange, op: string, rows: Map<string, StoredRow>): ExtentCondition | undefined {
    const meaning = this.prepare(range,op);
    const limits = range.stop === 'Limit' ? range.rowIds.flatMap(id => {
      const row = rows.get(`${range.table}\0${id}`); return row ? [this.suffix(row, range)] : [];
    }) : undefined;
    if (limits && !limits.length) return;
    return { ...meaning,op,present: [...new Set([...range.rowIds,...(range.haloId ? [range.haloId] : [])])].sort(), ...(limits ? { first: limits.reduce((a,b) => compareArrays(a,b) <= 0 ? a : b),
        last: limits.reduce((a,b) => compareArrays(a,b) >= 0 ? a : b) } : {}) };
  }
  rangeKey(range: ReceiptRange, op: string): string { return rangeMeaningKey(this.prepare(range,op)); }
  private prepare(range: ReceiptRange, op: string): RangeMeaning {
    const cached = this.prepared.get(range); if (cached?.op === op) return cached.meaning;
    const program = this.program(op), schema = this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema;
    if (!schema) throw new TypeError('range admission requires a generation schema');
    const atoms = tagWireRangePrefix(schema, range as any, program);
    const prefix = prepareRange(schema, { ...range, prefix: atoms }, program);
    const bound = (value: any) => value == null ? null : tagWireIndexValues(schema,range.table,range.index,
      Array.isArray(value) ? value : [value],range.prefix.length);
    const meaning: RangeMeaning = { site: range.site,ruleHash: range.ruleHash,table: range.table,index: range.index,prefix,order: range.order,
      after: bound(range.after),before: bound(range.before),gt: bound(range.gt),gte: bound(range.gte),lt: bound(range.lt),lte: bound(range.lte) };
    this.prepared.set(range,{ op,meaning }); return meaning;
  }
  receipt(receipt: Receipt, rows: StoredRow[]): Receipt {
    const pool = new Map(rows.map(r => [rowKey(r), r]));
    return { ...structuredClone(receipt), ranges: receipt.ranges.map(range => {
      const row = (this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema) && pool.get(`${range.table}\0${range.rowIds.at(-1)}`);
      return { ...structuredClone(range), ...(row ? { heldSuffix: this.suffix(row, range) } : {}) };
    }) };
  }
  matching(range: ReceiptRange, op: string): Iterable<HeldRange> { return this.matchingKey(this.rangeKey(range, op)); }
  *matchingKey(key: string): Iterable<HeldRange> {
    for (const [owner,ranges] of this.ranges.get(key) ?? []) for (const range of ranges) yield { owner,range,key };
  }
  maskTargets(key: string): Iterable<string> { return this.masked.get(key) ?? []; }
  private setMask(key: string): void {
    const old = this.masks.get(key), mask = this.state.extentNegative[key];
    if (old) { const set = this.masked.get(old)!; set.delete(key); if (!set.size) this.masked.delete(old); this.masks.delete(key); }
    if (mask?.active && mask.cause) {
      const set = this.masked.get(mask.cause) ?? new Set(); set.add(key); this.masked.set(mask.cause,set); this.masks.set(key,mask.cause);
    }
  }
  private positive(proof: FactProof, seq: number, delta: number): void {
    const image = factImageId(proof); if (!image) return;
    const [key,digest] = proof, { table,id: rowId } = factRow(key)!;
    this.positives.change({ id: canonical([key,digest,seq]), key,table,rowId,digest,seq, keys: this.state.factImages[image]?.keys },delta);
  }
  private setGuard(key: string): void {
    const old = this.guards.get(key), next = this.state.rowFacts[key];
    if (old) this.positive([key,old[1]],old[0],-1);
    if (Array.isArray(next)) { this.positive([key,next[1]],next[0],1); this.guards.set(key,next); } else this.guards.delete(key);
  }
  private extentReference(id: string, seq: number, delta: number): void {
    const owner = canonical([id,seq]);
    const condition = delta < 0 ? this.closed.get(owner)!.condition : this.state.factExtents[id].condition;
    this.closed.change(owner,condition,seq,delta);
  }
  private setExtentGuard(key: string): void {
    const old = this.extentOwners.get(key), next = this.state.extentGuards[key];
    if (old) this.extentReference(old.id,old.seq,-1);
    if (next) { this.extentReference(next.id,next.seq,1); this.extentOwners.set(key,next); } else this.extentOwners.delete(key);
  }
  private setRow(key: string): void {
    const old = this.live.get(key), row = this.state.rows[key];
    if (old) this.live.change(old,-1);
    if (row) this.live.change({ id: key,key: rowFactKey(row.table,row.id),table: row.table,rowId: row.id,
      digest: '',seq: this.state.rowSeq[key],keys: this.keyImage(row) },1);
  }
  private member(map: Map<string,Set<string>>, key: string, owner: string, delta: number): void {
    const set = map.get(key) ?? new Set<string>();
    if (delta > 0) set.add(owner); else set.delete(owner);
    if (set.size) map.set(key,set); else map.delete(key);
  }
  set(key: string, answer?: StoredAnswer): void {
    // The immutable persisted answer itself is the owner. Do not retain a second
    // copy of its refs, proof arrays, ranges or extent descriptors.
    for (const [held,delta] of [[this.answers.get(key),-1],[answer,1]] as const) {
      if (!held) continue;
      const fullSeq = held.fingerprint === undefined ? undefined : held.nextSeq ?? held.seq;
      for (const ref of held.refs) { const id = rowKey(ref); this.member(this.references,id,key,delta); this.fullImage(id,fullSeq,delta); }
      for (const [table,index,values] of held.receipt?.absences ?? []) if (index === 'byId' && typeof values[0] === 'string')
        this.member(this.absences,`${table}\0${values[0]}`,key,delta);
      for (const verdict of held.receipt?.verdicts ?? []) this.member(this.verdicts,verdictFactKey(verdict),key,delta);
      for (const proof of answerProofs(held)) { this.member(this.proofOwners,proof[0],key,delta); this.positive(proof,held.seq,delta); }
      for (const id of held.extentProofs ?? []) this.extentReference(id,held.seq,delta);
      if (this.schemaReady) for (const range of held.receipt?.ranges ?? []) {
        const meaning = this.rangeKey(range,held.op), owners = this.ranges.get(meaning) ?? new Map<string,Set<ReceiptRange>>();
        const ranges = owners.get(key) ?? new Set<ReceiptRange>();
        if (delta > 0) ranges.add(range); else ranges.delete(range);
        if (ranges.size) owners.set(key,ranges); else owners.delete(key);
        if (owners.size) this.ranges.set(meaning,owners); else this.ranges.delete(meaning);
      }
    }
    if (answer) this.answers.set(key,answer); else this.answers.delete(key);
  }
  update(state: PersistedRangeState, changed: ChangedRecords, schema?: OfflineSchema): void {
    this.state = state; this.schema = schema ?? this.schema;
    for (const key of new Set([...(changed.get('rows') ?? []), ...(changed.get('viewed') ?? [])])) this.assets.set(key, state.rows[key], state.viewed[key]);
    for (const key of changed.get('answers') ?? []) this.set(key, state.answers[key]);
    for (const key of changed.get('rows') ?? []) this.setRow(key);
    for (const key of changed.get('rowFacts') ?? []) this.setGuard(key);
    for (const key of changed.get('extentGuards') ?? []) this.setExtentGuard(key);
    for (const key of changed.get('extentNegative') ?? []) this.setMask(key);
  }
  suffix(row: StoredRow, range: ReceiptRange) {
    const schema = this.state.programs[this.state.facts?.generation ?? '']?.schema ?? this.schema;
    const parts = components(schema, range.table, range.index).slice(range.prefix.length);
    return tagWireIndexValues(schema, range.table, range.index, parts.map(c => {
      if (!('Column' in c)) throw new TypeError('derived suffix is not orderable'); return row.row[c.Column] as any ?? null;
    }), range.prefix.length);
  }
}

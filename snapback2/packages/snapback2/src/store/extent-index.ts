// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — seek retained closed assertions by prepared scope, token and interval.
import { Ordered } from '../../../evaluator/src/ordered.js';
import { PrefixDictionary } from '../../../evaluator/src/prefix-dictionary.js';
import { totalCompare } from '../../../evaluator/src/value-runtime.js';
import type { Value } from '../../../evaluator/src/types.js';
import { canonical } from './canonical.js';
import { extentContains, type ExtentCondition, type KeyImage } from './extent-facts.js';

export interface IndexedExtent { id: string; seq: number; condition: ExtentCondition; refs: number }
type Bound = Value | null;
type Summary = { low: Bound; high: Bound; seq: number };
type Entry = IndexedExtent & Summary;
const lowCompare = (a: Bound, b: Bound) => a === null ? b === null ? 0 : -1 : b === null ? 1 : totalCompare(a, b);
const highCompare = (a: Bound, b: Bound) => a === null ? b === null ? 0 : 1 : b === null ? -1 : totalCompare(a, b);
const minLow = (a: Bound, b: Bound) => lowCompare(a,b) <= 0 ? a : b;
const maxHigh = (a: Bound, b: Bound) => highCompare(a,b) >= 0 ? a : b;
function bounds(c: ExtentCondition): Summary {
  const lower = [c.gt?.[0], c.gte?.[0], c.first?.[0], (c.order === 'Asc' ? c.after : c.before)?.[0]].filter(v => v !== undefined) as Value[];
  const upper = [c.lt?.[0], c.lte?.[0], c.last?.[0], (c.order === 'Asc' ? c.before : c.after)?.[0]].filter(v => v !== undefined) as Value[];
  return { low: lower.reduce<Bound>((a,b) => a === null || totalCompare(a,b) < 0 ? b : a, null),
    high: upper.reduce<Bound>((a,b) => a === null || totalCompare(a,b) > 0 ? b : a, null), seq: 0 };
}
const bucketKey = (table: string, index: string, scalars: Array<Value | null>, token: number) => canonical([table,index,scalars,token]);

/** Every entry is owned by a charged guard or answer reference. Empty buckets and
 * shared token paths leave when the last reference leaves; queries never enumerate scopes. */
export class ExtentIndex {
  private dictionary = new PrefixDictionary();
  private buckets = new Map<string, Ordered<[Bound,string], Entry, Summary>>();
  private entries = new Map<string, { value: Entry; bucket: string; nodes: Uint32Array }>();
  private tables = new Map<string, number>();
  get(id: string): IndexedExtent | undefined { return this.entries.get(id)?.value; }
  has(table: string): boolean { return this.tables.has(table); }
  change(id: string, condition: ExtentCondition, seq: number, delta: number): void {
    const old = this.entries.get(id);
    if (old) {
      old.value.refs += delta;
      if (old.value.refs) return;
      const tree = this.buckets.get(old.bucket)!; tree.delete([old.value.low,id]);
      if (!tree.size) this.buckets.delete(old.bucket);
      for (let i = old.nodes.length - 1; i >= 0; i--) this.dictionary.release(old.nodes[i]);
      this.entries.delete(id);
      const count = this.tables.get(old.value.condition.table)! - 1;
      if (count) this.tables.set(old.value.condition.table,count); else this.tables.delete(old.value.condition.table);
      return;
    }
    if (delta < 0) throw new TypeError('missing indexed extent reference');
    let token = 0; const nodes: number[] = [], scalars: Array<Value | null> = [];
    for (const atom of condition.prefix) {
      if ('Scalar' in atom) scalars.push(atom.Scalar);
      else {
        scalars.push(null);
        for (const scalar of atom.WordPrefix.token ?? '') {
          token = this.dictionary.intern(token,scalar.codePointAt(0)!); this.dictionary.retain(token); nodes.push(token);
        }
      }
    }
    const bucket = bucketKey(condition.table,condition.index,scalars,token);
    let tree = this.buckets.get(bucket);
    if (!tree) {
      tree = new Ordered((a,b) => lowCompare(a[0],b[0]) || (a[1] < b[1] ? -1 : a[1] === b[1] ? 0 : 1),
        (left,value,right) => ({ low: minLow(left ? left.low : value.low,minLow(value.low,right ? right.low : value.low)),
          high: maxHigh(left ? left.high : value.high,maxHigh(value.high,right ? right.high : value.high)), seq: Math.max(left?.seq ?? -1,value.seq,right?.seq ?? -1) }));
      this.buckets.set(bucket,tree);
    }
    const value = { ...bounds(condition), id, condition, seq, refs: delta };
    tree.set([value.low,id],value); this.entries.set(id,{ value,bucket,nodes: Uint32Array.from(nodes) });
    this.tables.set(condition.table,(this.tables.get(condition.table) ?? 0) + 1);
  }
  *matching(table: string, image: KeyImage, seq: number): Generator<IndexedExtent> {
    const seen = new Set<string>();
    for (const [index,key] of Object.entries(image)) {
      const scalars: Array<Value | null> = []; let tokens = [0];
      for (let width = 0; width <= key.length; width++) {
        const first = key[width], value = first && 'Scalar' in first ? first.Scalar : null;
        for (const token of tokens) {
          const tree = this.buckets.get(bucketKey(table,index,scalars,token)); if (!tree) continue;
          const overlap = (s: Summary) => s.seq >= seq && (value === null || (lowCompare(s.low,value) <= 0 && highCompare(s.high,value) >= 0));
          for (const entry of tree.overlapping(overlap, e => overlap(e))) {
            if (seen.has(entry.id) || !extentContains(image,entry.condition)) continue;
            seen.add(entry.id); yield entry;
          }
        }
        if (!first) break;
        if ('Scalar' in first) scalars.push(first.Scalar);
        else {
          scalars.push(null); const found = new Set<number>();
          for (const word of first.Words) {
            let node = 0;
            for (const scalar of word) { node = this.dictionary.child(node,scalar.codePointAt(0)!); if (!node) break; found.add(node); }
          }
          tokens = [...found];
        }
      }
    }
  }
}

// @ref LLP 1012#5-retention-revocation-and-the-fence — checked range nonmembership is scoped to its immutable typed extent.
import { compareArrays, totalCompare } from '../../../evaluator/src/value-runtime.js';
import { logicalKey } from '../../../evaluator/src/index-store.js';
import { canonical } from './canonical.js';
import type { LogicalIndexAtom } from '../../../evaluator/src/search-key.js';
import type { Value } from '../../../evaluator/src/types.js';

/** Only index meanings survive body GC, never a historical application row. */
export type KeyImage = Record<string, Array<{ Scalar: Value } | { Words: string[] }>>;
export interface RangeMeaning {
  site: string;
  ruleHash: string;
  table: string;
  index: string;
  /** Private token data from trusted preparation; no prototype methods survive persistence. */
  prefix: LogicalIndexAtom[];
  order: 'Asc' | 'Desc';
  after: Value[] | null;
  before: Value[] | null;
  gt: Value[] | null;
  gte: Value[] | null;
  lt: Value[] | null;
  lte: Value[] | null;
}
export interface ExtentCondition extends RangeMeaning {
  op: string;
  first?: Value[];
  last?: Value[];
  present: string[];
}
export type ExtentProof = string;
export interface FactImage { refs: number; keys?: KeyImage }
export interface FactExtent { refs: number; condition: ExtentCondition }
const rangeKeys = new WeakMap<object,string>();
/** Exact prepared meaning; the digest of this key is never a replacement for equality. */
export function rangeMeaningKey(range: RangeMeaning): string {
  let key = rangeKeys.get(range);
  if (key === undefined) {
    key = canonical([range.site,range.table,range.index,logicalKey(range.prefix),range.order,
      range.after,range.before,range.gt,range.gte,range.lt,range.lte,range.ruleHash]);
    rangeKeys.set(range,key);
  }
  return key;
}

export function extentContains(image: KeyImage, extent: ExtentCondition): boolean {
  const key = image[extent.index];
  if (!key) throw new TypeError('immutable fact lacks its checked index');
  for (let i = 0; i < extent.prefix.length; i++) {
    const prefix = extent.prefix[i], value = key[i];
    if ('Scalar' in prefix && 'Scalar' in value) { if (totalCompare(prefix.Scalar, value.Scalar)) return false; }
    else if ('WordPrefix' in prefix && 'Words' in value) {
      if (prefix.WordPrefix.token === null || !value.Words.some(word => word.startsWith(prefix.WordPrefix.token!))) return false;
    } else throw new TypeError('immutable index component mismatch');
  }
  const suffix = key.slice(extent.prefix.length).map(value => {
    if (!('Scalar' in value)) throw new TypeError('derived suffix is not orderable'); return value.Scalar;
  });
  if (extent.after && (extent.order === 'Asc' ? compareArrays(suffix, extent.after) <= 0 : compareArrays(suffix, extent.after) >= 0)) return false;
  if (extent.before && (extent.order === 'Asc' ? compareArrays(suffix, extent.before) >= 0 : compareArrays(suffix, extent.before) <= 0)) return false;
  for (const name of ['gt', 'gte', 'lt', 'lte'] as const) if (extent[name]) {
    const c = totalCompare(suffix[0], extent[name]![0]);
    if (name === 'gt' ? c <= 0 : name === 'gte' ? c < 0 : name === 'lt' ? c >= 0 : c > 0) return false;
  }
  return (!extent.first || compareArrays(suffix, extent.first) >= 0) && (!extent.last || compareArrays(suffix, extent.last) <= 0);
}

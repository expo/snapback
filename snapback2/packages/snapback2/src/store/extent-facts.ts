// @ref LLP 1012#5-retention-revocation-and-the-fence — checked range nonmembership is scoped to its immutable typed extent.
import { totalCompare } from '../../../evaluator/src/value-runtime.js';
import { compareScanBounds, logicalKey } from '../../../evaluator/src/index-store.js';
import { canonical } from './canonical.js';
import type { LogicalIndexAtom } from '../../../evaluator/src/search-key.js';
import type { Value } from '../../../evaluator/src/types.js';

/** Only index meanings survive body GC, never a historical application row. */
import type { KeyImage } from '../../../evaluator/src/index-store.js';
export type { KeyImage } from '../../../evaluator/src/index-store.js';
import type { RangeMeaning } from '../../../evaluator/src/range-preparation.js';
export type { RangeMeaning } from '../../../evaluator/src/range-preparation.js';
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
  return compareScanBounds(suffix, extent, extent.order, extent.first, extent.last) === 0;
}

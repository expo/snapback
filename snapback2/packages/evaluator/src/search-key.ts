// Preparatory R2 contracts, not accepted by the current authoring/schema/IR surface.
// Wire descriptors carry source spellings; use only the prepared comparison API for key meaning.
// @ref LLP 1001#unicode-search-foundation — source descriptors compare by normalized meaning, with independent Q.
import type { Value } from './types';
import type { Expr } from '../../compiler/src/ir';
import { plainObject, totalCompare } from './value-runtime';
import { utf8Length } from './hash';
import { SEARCH_CONTRACT, type SearchContract, SearchInputError, SearchNormalizer, scalarLength, searchQueryToken } from './unicode';
export { SEARCH_CONTRACT, type SearchContract } from './unicode';

export type IndexComponent = { Column: string } | { WordPrefixes: { fields: string[]; contract: SearchContract } };
export type IndexKeyExpr<E = Expr> = { Scalar: E } | { WordPrefix: { source: E; contract: SearchContract; source_max: number } };
export interface WordPrefix { contract: SearchContract; source: string }
export type IndexAtom = { Scalar: Value } | { WordPrefix: WordPrefix };

/** Execution-local only; never persisted in place of the source descriptor. */
export class NormalizedWordPrefix {
  private constructor(readonly token: string | null) { Object.freeze(this); }
  static fromSource(source: string, sourceMax: number, normalizer: SearchNormalizer): NormalizedWordPrefix {
    return new NormalizedWordPrefix(searchQueryToken(source, sourceMax, normalizer));
  }
  get empty(): boolean { return this.token === null; }
  /** `word` must already be a token from the pinned normalizer. Empty search matches nothing. */
  matchesNormalizedWord(word: string): boolean { return this.token !== null && word.startsWith(this.token); }
}
export type LogicalIndexAtom = { Scalar: Value } | { WordPrefix: NormalizedWordPrefix };

function exact(value: unknown, keys: string[]): value is Record<string, any> {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function scalar(value: unknown): value is Value {
  if (value === 'Null') return true;
  if (!plainObject(value)) return false;
  for (const tag of ['Bool', 'Int', 'String', 'Id', 'Bytes']) {
    if (!exact(value, [tag])) continue;
    const data = value[tag];
    if (tag === 'Bool') return typeof data === 'boolean';
    if (tag === 'Int') return Number.isSafeInteger(data);
    if (typeof data !== 'string') return false;
    if (tag === 'Bytes') return /^(?:[0-9a-f]{2})*$/.test(data);
    scalarLength(data, 0x3fffffff);
    return true;
  }
  return false;
}

/** Q is supplied by the issuing certificate, independently of indexed field maxima.
 * The downstream slot validator still checks ordinary ColumnType/optionality and index shape. */
export function prepareIndexAtom(
  component: IndexComponent, atom: unknown, sourceMax?: number, normalizer = new SearchNormalizer(),
): LogicalIndexAtom {
  if ('Column' in component && exact(atom, ['Scalar']) && scalar(atom.Scalar)) {
    const value = atom.Scalar;
    return { Scalar: value === 'Null' ? value : Object.freeze({ ...value }) };
  }
  if ('WordPrefixes' in component && exact(atom, ['WordPrefix']) && exact(atom.WordPrefix, ['contract', 'source'])) {
    const prefix = atom.WordPrefix;
    if (prefix.contract !== SEARCH_CONTRACT || prefix.contract !== component.WordPrefixes.contract) throw new SearchInputError('unknown search contract');
    if (sourceMax === undefined) throw new SearchInputError('search source bound must come from the issuing operation');
    return { WordPrefix: NormalizedWordPrefix.fromSource(prefix.source, sourceMax, normalizer) };
  }
  throw new SearchInputError('index atom does not match its declared component');
}
export function decodeIndexAtom(json: string, component: IndexComponent, sourceMax?: number, normalizer = new SearchNormalizer()): { atom: IndexAtom; logical: LogicalIndexAtom } {
  if ('WordPrefixes' in component) {
    if (sourceMax === undefined) throw new SearchInputError('search source bound must come from the issuing operation');
    if (utf8Length(json) > wordPrefixWireMax(sourceMax)) throw new SearchInputError('index atom exceeds its declared byte bound');
  }
  let atom: unknown;
  try { atom = JSON.parse(json); } catch { throw new SearchInputError('invalid index atom descriptor'); }
  const logical = prepareIndexAtom(component, atom, sourceMax, normalizer);
  const value = atom as IndexAtom;
  const canonical = 'WordPrefix' in value ? { WordPrefix: { contract: value.WordPrefix.contract, source: value.WordPrefix.source } } : value;
  // Existing cursor convention: decode/re-encode, including duplicate-field refusal.
  if (JSON.stringify(canonical) !== json) throw new SearchInputError('index atom is not canonical tagged JSON');
  return { atom: canonical, logical };
}
export function wordPrefixWireMax(sourceMax: number): number {
  scalarLength('', sourceMax);
  return 4 * sourceMax + 63;
}
export function indexAtomsEqual(a: LogicalIndexAtom, b: LogicalIndexAtom): boolean {
  if ('Scalar' in a && 'Scalar' in b) return totalCompare(a.Scalar, b.Scalar) === 0;
  return 'WordPrefix' in a && 'WordPrefix' in b && a.WordPrefix.token === b.WordPrefix.token;
}
export function indexKeysEqual(a: readonly LogicalIndexAtom[], b: readonly LogicalIndexAtom[]): boolean {
  return a.length === b.length && indexKeyStartsWith(a, b);
}
/** Tuple containment: `ca` does not cover `cat`; every occupied slot compares by whole meaning. */
export function indexKeyStartsWith(key: readonly LogicalIndexAtom[], prefix: readonly LogicalIndexAtom[]): boolean {
  return key.length >= prefix.length && prefix.every((atom, i) => indexAtomsEqual(key[i], atom));
}
export function compareScalarAtoms(a: LogicalIndexAtom, b: LogicalIndexAtom): number {
  if ('Scalar' in a && 'Scalar' in b) return totalCompare(a.Scalar, b.Scalar);
  throw new SearchInputError('word-prefix atoms admit equality only');
}

// @ref LLP 1001#unicode-search-foundation — one normalization per distinct bounded source in an execution, metered shared primitives.
import { SearchNormalizer, normalizationSteps, SearchInputError, type NormalizationStats } from './unicode';
import { prepareIndexAtom, type IndexAtom, type IndexComponent, type LogicalIndexAtom } from './search-key';
import { EvalError } from './errors';
class MeteredNormalizer extends SearchNormalizer {
  constructor(private charge: (stats: NormalizationStats) => void) { super(); }
  override normalize(source: string, max: number) { const result = super.normalize(source, max); this.charge(result.stats); return result; }
}
export class SearchExecution {
  private cache = new Map<string, LogicalIndexAtom>();
  private normalizer: SearchNormalizer;
  private pending: NormalizationStats[] = [];
  constructor(private charge?: (stats: NormalizationStats) => void, private limit = Infinity) {
    this.normalizer = new MeteredNormalizer(stats => { if (this.charge) this.charge(stats); else this.pending.push(stats); });
  }
  /** Cursor preparation and evaluation share work; the execution ledger also owns any earlier preparation. */
  meter(charge: (stats: NormalizationStats) => void): void {
    this.charge = charge;
    const pending = this.pending; this.pending = [];
    for (const stats of pending) charge(stats);
  }
  atom = (component: IndexComponent, value: unknown, maximum?: number): LogicalIndexAtom => {
    try {
      if ('Column' in component) return prepareIndexAtom(component, value, maximum);
      const atom = value as IndexAtom, d = atom && typeof atom === 'object' && 'WordPrefix' in atom ? atom.WordPrefix : undefined;
      // Validate the whole wrapper before consulting a fixed-field cache key.
      if (!d || Object.keys(atom).length !== 1 || Object.keys(d).length !== 2 || !Object.hasOwn(d, 'source')
        || !Object.hasOwn(d, 'contract') || typeof d.source !== 'string' || d.contract !== component.WordPrefixes.contract)
        return prepareIndexAtom(component, value, maximum, this.normalizer);
      const key = JSON.stringify([d.contract, d.source, maximum]);
      const cached = this.cache.get(key); if (cached) return cached;
      const prepared = prepareIndexAtom(component, value, maximum, this.normalizer);
      if (this.cache.size >= this.limit) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, prepared); return prepared;
    } catch (error) { if (error instanceof SearchInputError) throw new EvalError('E_INPUT', error.message); throw error; }
  };
}
export { normalizationSteps };

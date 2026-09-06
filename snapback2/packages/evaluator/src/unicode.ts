// Standalone foundation; the legacy words() builtin is deliberately not wired here yet.
// @ref LLP 1001#unicode-search-foundation — pinned Unicode, independent fields and stable counting passes.
import { combining, folding, boundaries, decomposition, rangeValue, decomposeAt, composePair, MAX_DECOMPOSITION_DEPTH } from './unicode-tables';
export { TABLE_DIGEST, MAX_NFD_SCALARS, MAX_DECOMPOSITION_DEPTH, MAX_LOOKUP_PROBES } from './unicode-tables';

export const SEARCH_CONTRACT = 'u17-nfc-scf-nfc-wsp-p' as const;
export type SearchContract = typeof SEARCH_CONTRACT;
// U=4N and all scalar/segment positions fit Uint32. This is an implementation
// ceiling, independent of each field max/Q; resource certification imposes much smaller bounds.
export const MAX_SEARCH_SOURCE_SCALARS = 0x3fffffff;
export class SearchInputError extends Error {
  readonly code = 'E_INPUT';
  constructor(message: string) { super(`E_INPUT: ${message}`); this.name = 'SearchInputError'; }
}

/** Reject UTF-16 surrogates before allocating scratch or replacing any input bytes. */
export function scalarLength(source: string, sourceMax: number): number {
  if (typeof source !== 'string') throw new SearchInputError('expected scalar text');
  if (!Number.isSafeInteger(sourceMax) || sourceMax < 0 || sourceMax > MAX_SEARCH_SOURCE_SCALARS) throw new SearchInputError('invalid search source bound');
  let n = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = source.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new SearchInputError('unpaired surrogate');
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new SearchInputError('unpaired surrogate');
    if (++n > sourceMax) throw new SearchInputError('search source exceeds its declared scalar maximum');
  }
  return n;
}
/** Existing Text input domain, distinct from low-level NFC's full scalar domain.
 * Two scalar validation passes, no scratch; callers price input validation separately. */
export function validateSearchSource(source: string, sourceMax: number): number {
  const n = scalarLength(source, sourceMax);
  for (const ch of source) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) throw new SearchInputError('search text contains a disallowed control character');
  }
  return n;
}

/** Logical pass ledger. A table lookup costs <=12 binary probes; counts exclude immutable tables. */
export interface NormalizationStats {
  inputScalars: number;
  outputScalars: number;
  outputChunks: number;
  decompositionVisits: number;
  reorderVisits: number;
  cccBucketVisits: number;
  segmentBucketVisits: number;
  compositionVisits: number;
  foldVisits: number;
  tableLookups: number;
  peakScalars: number;
  scratchBytes: number;
}
function stats(): NormalizationStats {
  return { inputScalars: 0, outputScalars: 0, outputChunks: 0, decompositionVisits: 0, reorderVisits: 0,
    cccBucketVisits: 0, segmentBucketVisits: 0, compositionVisits: 0, foldVisits: 0,
    tableLookups: 0, peakScalars: 0, scratchBytes: 0 };
}
export function normalizationScratchBytes(sourceMax: number): number {
  scalarLength('', sourceMax);
  // Typed buffers: 20U+1028. TS UTF-16 chunk conversion: <=4U payload,
  // 24 bytes per 256-unit chunk (string header + array reference), 2080 fixed
  // bytes (array/view headers and <=256 numeric call arguments). Final text is output.
  return 96 * sourceMax + 3108 + 24 * Math.ceil(sourceMax / 32);
}
/** Counts the named passes plus bounded table lookups as primitives, not CPU cycles. */
export function normalizationSteps(stats: NormalizationStats): number {
  return 2 * stats.inputScalars + stats.outputScalars + stats.outputChunks + stats.decompositionVisits + stats.reorderVisits
    + stats.cccBucketVisits + stats.segmentBucketVisits + stats.compositionVisits + stats.foldVisits + stats.tableLookups;
}
export function normalizationStepBound(sourceMax: number): number {
  scalarLength('', sourceMax);
  // Two NFC stages: decomposition <=2(D+1)U, reorder <=8U, composition <=2U,
  // fold <=U, lookup <=2(D+1)U+9U, output <=U; segment buckets <=4U+4.
  return 2 * sourceMax + 4 * sourceMax * (4 * (MAX_DECOMPOSITION_DEPTH + 1) + 25) + 1028 + Math.ceil(sourceMax / 32);
}

/** Scratch is reused between both NFC stages and sequential fields. Allocation follows actual N. */
export class SearchNormalizer {
  private a = new Uint32Array(0);
  private b = new Uint32Array(0);
  private sa = new Uint32Array(0);
  private sb = new Uint32Array(0);
  private counts = new Uint32Array(1);
  private cccCounts = new Uint32Array(256);
  private length = 0;
  private meter = stats();

  normalize(source: string, sourceMax: number): { text: string; stats: NormalizationStats } {
    return this.run(source, sourceMax, true);
  }
  nfc(source: string, sourceMax: number): { text: string; stats: NormalizationStats } {
    return this.run(source, sourceMax, false);
  }
  private run(source: string, sourceMax: number, fold: boolean) {
    const n = scalarLength(source, sourceMax), u = 4 * n;
    if (this.a.length < u) {
      // Drop old buffers before growth, so resizing has no additional live scratch payload.
      this.a = this.b = this.sa = this.sb = this.counts = new Uint32Array(0);
      this.a = new Uint32Array(u); this.b = new Uint32Array(u);
      this.sa = new Uint32Array(u); this.sb = new Uint32Array(u);
      this.counts = new Uint32Array(u + 1);
    }
    this.meter = stats();
    this.meter.inputScalars = n;
    this.meter.scratchBytes = 16 * this.a.length + this.counts.byteLength + this.cccCounts.byteLength;
    this.length = 0;
    for (const ch of source) this.a[this.length++] = ch.codePointAt(0)!;
    this.canonical();
    if (fold) {
      for (let i = 0; i < this.length; i++) {
        this.meter.foldVisits++; this.meter.tableLookups++;
        this.a[i] += rangeValue(folding, this.a[i]);
      }
      this.canonical();
    }
    this.meter.outputScalars = this.length;
    // Reuse the idle scalar buffer for UTF-16. Chunked flat-string construction
    // avoids unbounded spread arguments and any growing-string concatenation.
    const units = new Uint16Array(this.b.buffer);
    let end = 0;
    for (let i = 0; i < this.length; i++) {
      const cp = this.a[i];
      if (cp < 0x10000) units[end++] = cp;
      else { const x = cp - 0x10000; units[end++] = 0xd800 + (x >>> 10); units[end++] = 0xdc00 + (x & 1023); }
    }
    const chunks: string[] = [];
    for (let start = 0; start < end; start += 256) chunks.push(String.fromCharCode(...units.subarray(start, Math.min(end, start + 256))));
    this.meter.outputChunks = chunks.length;
    this.meter.scratchBytes += 2 * end + 24 * chunks.length + 32 + 8 * Math.min(end, 256);
    const text = chunks.join('');
    return { text, stats: { ...this.meter } };
  }
  private canonical() {
    let written = 0;
    const append = (cp: number) => {
      if (written >= this.b.length) throw new Error('Unicode U=4N invariant');
      this.b[written++] = cp;
    };
    const decompose = (cp: number) => {
      this.meter.decompositionVisits++;
      if (cp >= 0xac00 && cp <= 0xd7a3) {
        const x = cp - 0xac00;
        append(0x1100 + Math.floor(x / 588)); append(0x1161 + Math.floor((x % 588) / 28));
        if (x % 28) append(0x11a7 + x % 28);
      } else {
        this.meter.tableLookups++;
        const i = decomposeAt(cp);
        if (i < 0) append(cp);
        else for (let j = 1; j <= decomposition[i + 3]; j++) decompose(decomposition[i + j]);
      }
    };
    for (let i = 0; i < this.length; i++) decompose(this.a[i]);
    [this.a, this.b] = [this.b, this.a]; this.length = written;
    this.meter.peakScalars = Math.max(this.meter.peakScalars, written);

    // R2: stable CCC pass, then stable starter-segment pass. Leading marks use segment 0.
    this.cccCounts.fill(0); this.meter.cccBucketVisits += 256;
    let segment = 0;
    for (let i = 0; i < written; i++) {
      this.meter.tableLookups++; this.meter.reorderVisits++;
      const cls = rangeValue(combining, this.a[i]);
      if (cls === 0) segment++;
      this.sa[i] = segment; this.cccCounts[cls]++;
    }
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      const n = this.cccCounts[i]; this.cccCounts[i] = sum; sum += n;
    }
    this.meter.cccBucketVisits += 256;
    for (let i = 0; i < written; i++) {
      this.meter.tableLookups++; this.meter.reorderVisits++;
      const pos = this.cccCounts[rangeValue(combining, this.a[i])]++;
      this.b[pos] = this.a[i]; this.sb[pos] = this.sa[i];
    }
    this.counts.fill(0, 0, segment + 1); this.meter.segmentBucketVisits += segment + 1;
    for (let i = 0; i < written; i++) { this.counts[this.sb[i]]++; this.meter.reorderVisits++; }
    sum = 0;
    for (let i = 0; i <= segment; i++) { const n = this.counts[i]; this.counts[i] = sum; sum += n; }
    this.meter.segmentBucketVisits += segment + 1;
    for (let i = 0; i < written; i++) { this.a[this.counts[this.sb[i]]++] = this.b[i]; this.meter.reorderVisits++; }

    let out = 0, starter = -1, last = 0;
    for (let i = 0; i < written; i++) {
      const cp = this.a[i];
      this.meter.compositionVisits++; this.meter.tableLookups++;
      const cls = rangeValue(combining, cp);
      let composite = 0;
      if (starter >= 0 && (last === 0 || last < cls)) {
        this.meter.tableLookups++; composite = composePair(this.a[starter], cp);
      }
      if (composite) this.a[starter] = composite;
      else { this.a[out] = cp; if (cls === 0) starter = out; out++; last = cls; }
    }
    this.length = out;
  }
}

export function normalizeSearch(source: string, sourceMax: number): string {
  return new SearchNormalizer().normalize(source, sourceMax).text;
}
export function isSearchBoundary(cp: number): boolean {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new SearchInputError('invalid Unicode scalar');
  return rangeValue(boundaries, cp) !== 0;
}
function* tokens(text: string): Generator<string> {
  let start = 0, offset = 0;
  for (const ch of text) {
    if (isSearchBoundary(ch.codePointAt(0)!)) {
      if (offset > start) yield text.slice(start, offset);
      start = offset + ch.length;
    }
    offset += ch.length;
  }
  if (offset > start) yield text.slice(start);
}
export function searchWords(source: string | null, sourceMax: number): string[] {
  return searchFieldWords([{ source, sourceMax }]);
}
export function searchFieldWords(fields: readonly { source: string | null; sourceMax: number }[]): string[] {
  const normalizer = new SearchNormalizer(), words = new Set<string>();
  for (const { source, sourceMax } of fields) {
    scalarLength('', sourceMax);
    if (source !== null) {
      validateSearchSource(source, sourceMax);
      for (const word of tokens(normalizer.normalize(source, sourceMax).text)) words.add(word);
    }
  }
  return [...words];
}
/** null is the distinguished empty search, never a wildcard. Counts occurrences before dedup. */
export function searchQueryToken(source: string, sourceMax: number, normalizer = new SearchNormalizer()): string | null {
  validateSearchSource(source, sourceMax);
  let token: string | null = null;
  for (const next of tokens(normalizer.normalize(source, sourceMax).text)) {
    if (token !== null) throw new SearchInputError('search one word');
    token = next;
  }
  return token;
}

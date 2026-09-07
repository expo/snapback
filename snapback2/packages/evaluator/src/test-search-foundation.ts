import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SEARCH_CONTRACT, SearchInputError, SearchNormalizer, normalizeSearch, searchWords, searchFieldWords,
  searchQueryToken, scalarLength, isSearchBoundary, normalizationScratchBytes, normalizationSteps,
  normalizationStepBound, TABLE_DIGEST, MAX_NFD_SCALARS, MAX_DECOMPOSITION_DEPTH, MAX_LOOKUP_PROBES, MAX_SEARCH_SOURCE_SCALARS } from './unicode';
import { decomposition, composition, combining, folding, boundaries, rangeValue } from './unicode-tables';
import { compareScalarAtoms, decodeIndexAtom, indexKeysEqual, indexKeyStartsWith, prepareIndexAtom,
  wordPrefixWireMax, type IndexComponent, type LogicalIndexAtom } from './search-key';

const root = new URL('../../../unicode/17.0.0/', import.meta.url);
const lines = (name: string) => readFileSync(new URL(name, root), 'utf8').split('\n');
const hex = (s: string) => Number.parseInt(s, 16);
const string = (s: string) => s.trim().split(/\s+/).filter(Boolean).map(cp => String.fromCodePoint(hex(cp))).join('');
for (const line of lines('SHA256SUMS').filter(Boolean)) {
  const [digest, name] = line.trim().split(/\s+/);
  assert.equal(createHash('sha256').update(readFileSync(new URL(name, root))).digest('hex'), digest);
}
assert.equal(MAX_NFD_SCALARS, 4);
assert.equal(MAX_SEARCH_SOURCE_SCALARS, 0x3fffffff);
assert.equal(TABLE_DIGEST, '29bb626cbddaec2bce2cc1efcac329a9ea07ee725322155b791005cd7781b9e8');
assert(MAX_DECOMPOSITION_DEPTH <= 4);
for (const count of [decomposition.length / 4, composition.length / 3, combining.length / 3, folding.length / 3, boundaries.length / 3]) {
  assert(count < 2 ** MAX_LOOKUP_PROBES, 'binary lookup primitive exceeded its pinned bound');
}

const normalizer = new SearchNormalizer();
let cases = 0;
const part1 = new Set<number>();
let section = '';
for (const line of lines('NormalizationTest.txt')) {
  const content = line.split('#')[0].trim();
  if (content.startsWith('@')) { section = content.split(';')[0]; continue; }
  if (!content) continue;
  const cs = content.split(';').slice(0, 5).map(string);
  if (section === '@Part1') part1.add(cs[0].codePointAt(0)!);
  for (let i = 0; i < 5; i++) assert.equal(normalizer.nfc(cs[i], 100).text, cs[i < 3 ? 1 : 3], content);
  cases++;
}
assert.equal(cases, 20034);

// Independent finite facts from official inputs, including all C/S entries and exact P* | White_Space.
const ds = new Map<number, number[]>(), folds = new Map<number, number>();
const expectedBoundary = new Uint8Array(0x110000);
for (const line of lines('UnicodeData.txt').filter(Boolean)) {
  const f = line.split(';'), cp = hex(f[0]);
  if (f[2].startsWith('P')) expectedBoundary[cp] = 1;
  if (f[5] && !f[5].startsWith('<')) ds.set(cp, f[5].split(' ').map(hex));
}
for (const line of lines('PropList.txt')) {
  const f = line.split('#')[0].split(';').map(s => s.trim());
  if (f[1] !== 'White_Space') continue;
  const [start, end = start] = f[0].split('..').map(hex);
  expectedBoundary.fill(1, start, end + 1);
}
for (const line of lines('CaseFolding.txt')) {
  const f = line.split('#')[0].split(';').map(s => s.trim());
  if (f[1] === 'C' || f[1] === 'S') folds.set(hex(f[0]), hex(f[2]));
}
function nfdLength(cp: number): number {
  if (cp >= 0xac00 && cp <= 0xd7a3) return (cp - 0xac00) % 28 ? 3 : 2;
  return ds.get(cp)?.reduce((n, c) => n + nfdLength(c), 0) ?? 1;
}
let maxNfd = 0;
for (let cp = 0; cp < 0x110000; cp++) {
  if (cp >= 0xd800 && cp <= 0xdfff) continue;
  maxNfd = Math.max(maxNfd, nfdLength(cp));
  assert.equal(isSearchBoundary(cp), !!expectedBoundary[cp], `boundary ${cp.toString(16)}`);
  assert.equal(cp + rangeValue(folding, cp), folds.get(cp) ?? cp, `fold ${cp.toString(16)}`);
  // Official NFC conformance's unlisted Part1 scalar identity, not just the explicit rows.
  if (!part1.has(cp)) {
    const s = String.fromCodePoint(cp);
    assert.equal(normalizer.nfc(s, 1).text, s, `unlisted scalar ${cp.toString(16)}`);
  }
}
assert.equal(maxNfd, 4);
assert.equal(folds.size, 1512);
for (const [cp, to] of folds) {
  assert(nfdLength(to) <= nfdLength(cp), 'folding increased NFD length');
  assert.equal(normalizeSearch(String.fromCodePoint(cp), 1), normalizeSearch(String.fromCodePoint(to), 1));
}

assert.deepEqual(searchWords('Élodie E\u0301lodie foo—bar don’t stop\u00a0here', 100), ['élodie', 'foo', 'bar', 'don', 't', 'stop', 'here']);
assert.deepEqual(searchWords('ſẞİıΣς Straße STRASSE 🦉+☕ a_b-c\'d', 100), ['sßİıσσ', 'straße', 'strasse', '🦉+☕', 'a', 'b', 'c', 'd']);
assert.deepEqual(searchWords(null, 0), []);
assert.deepEqual(searchFieldWords([
  { source: 'a', sourceMax: 1 }, { source: null, sourceMax: 4000 },
  { source: '\u0301', sourceMax: 1 }, { source: 'b A', sourceMax: 3 },
]), ['a', '\u0301', 'b']);
assert.deepEqual(searchFieldWords([{ source: 'foo', sourceMax: 3 }, { source: 'bar', sourceMax: 3 }]), ['foo', 'bar']);
assert.equal(searchQueryToken(' \t—', 3), null);
for (let cp = 0; cp < 0x20; cp++) {
  const s = String.fromCodePoint(cp);
  assert.equal(normalizeSearch(s, 1), s, 'low-level Unicode must retain the full scalar domain');
  if ([9, 10, 13].includes(cp)) assert.equal(searchQueryToken(s, 1), null);
  else {
    assert.throws(() => searchQueryToken(s, 1), SearchInputError);
    assert.throws(() => searchWords(s, 1), SearchInputError);
  }
}
for (const s of ['foo foo', 'FOO foo', 'É E\u0301', 'foo-bar']) {
  assert.throws(() => searchQueryToken(s, 100), (e: any) => e instanceof SearchInputError && e.code === 'E_INPUT' && e.message.endsWith('search one word'));
}
for (const s of ['\ud800', '\udfff', 'a\ud800z', '\ud800\ud800', '\udc00\ud800']) {
  assert.throws(() => normalizeSearch(s, 100), SearchInputError);
  assert.throws(() => searchWords(s, 100), SearchInputError);
}
assert.equal(scalarLength('𐐀', 1), 1);
assert.throws(() => normalizeSearch('𐐀a', 1), SearchInputError);
for (const q of [-1, 1.5, NaN, Infinity, 0x40000000]) assert.throws(() => normalizeSearch('', q), SearchInputError);
assert.deepEqual(searchWords('Élodie hello_world', 2000), ['élodie', 'hello', 'world'], 'authoring words uses the shared Unicode contract');

for (const [source, expected] of [
  ['\u0315\u0300'.repeat(1000), '\u0300'.repeat(1000) + '\u0315'.repeat(1000)],
  ['a' + '\u0315\u0300'.repeat(1000), 'à' + '\u0300'.repeat(999) + '\u0315'.repeat(1000)],
  ['a\u0315\u0300'.repeat(1000), 'à\u0315'.repeat(1000)],
  ['a\u0301\u0300', 'á\u0300'],
  ['𐐀'.repeat(2000), '𐐨'.repeat(2000)],
  ['\u{1d160}'.repeat(2000), '\u{1d158}\u{1d165}\u{1d16e}'.repeat(2000)],
  ['\u1f82'.repeat(4000), '\u1f82'.repeat(4000)],
] as const) {
  const n = scalarLength(source, 10000), u = 4 * n;
  const result = new SearchNormalizer().normalize(source, n);
  assert.equal(result.text, expected);
  assert(result.stats.outputScalars <= u && result.stats.peakScalars <= u);
  assert(result.stats.scratchBytes <= normalizationScratchBytes(n));
  assert.equal(result.stats.cccBucketVisits, 1024, 'CCC buckets cleared once per pass, never per segment');
  assert(result.stats.reorderVisits <= 8 * u);
  assert(result.stats.segmentBucketVisits <= 4 * u + 4);
  assert(normalizationSteps(result.stats) <= normalizationStepBound(n));
}
const reused = new SearchNormalizer();
assert(reused.normalize('x'.repeat(2000), 2000).stats.scratchBytes <= normalizationScratchBytes(2000));
assert(reused.normalize('x', 1).stats.scratchBytes >= 161028, 'ledger includes retained workspace high watermark');
assert(reused.normalize('x'.repeat(4000), 4000).stats.scratchBytes <= normalizationScratchBytes(4000));
const { scratchBytes, outputChunks, ...commonPasses } = new SearchNormalizer().normalize('É E\u0301 가', 20).stats;
assert.deepEqual(commonPasses, { inputScalars: 7, outputScalars: 5, decompositionVisits: 18,
  reorderVisits: 64, cccBucketVisits: 1024, segmentBucketVisits: 28,
  compositionVisits: 16, foldVisits: 5, tableLookups: 84, peakScalars: 8 });
assert.equal(outputChunks, 1);
assert.equal(scratchBytes, 1694); // Same passes as Rust; TS additionally constructs one UTF-16 chunk.

const component: IndexComponent = { WordPrefixes: { fields: ['name', 'handle'], contract: SEARCH_CONTRACT } };
const atom = (source: string) => ({ WordPrefix: { contract: SEARCH_CONTRACT, source } });
const key = (source: string, q = 2000) => prepareIndexAtom(component, atom(source), q);
const scope: LogicalIndexAtom = { Scalar: { Id: 'conversation' } };
assert(indexKeysEqual([scope, key('É')], [scope, key('E\u0301')]));
assert(indexKeyStartsWith([scope, key('E\u0301'), { Scalar: { Int: 1 } }], [scope, key('É')]));
assert(!indexKeyStartsWith([scope, key('cat')], [scope, key('ca')]));
assert(!indexKeysEqual([key('Straße')], [key('STRASSE')]));
assert(!indexKeysEqual([key('a')], [{ Scalar: { String: 'a' } }]));
// Indexed name raw max may be 1; independent query Q=2 accepts the decomposed spelling.
assert(indexKeysEqual([key('É', 1)], [key('E\u0301', 2)]));
assert.throws(() => key('E\u0301', 1), SearchInputError);
assert(indexKeysEqual([key('É'.repeat(1000), 1000)], [key('E\u0301'.repeat(1000), 2000)]));
assert(indexKeysEqual([key('𐐀'.repeat(2000))], [key('𐐨'.repeat(2000))]));
assert(indexKeysEqual([key('\u{1d160}'.repeat(2000), 2000)], [key('\u{1d158}\u{1d165}\u{1d16e}'.repeat(2000), 6000)]));
const empty = key(' —');
assert('WordPrefix' in empty && empty.WordPrefix.empty && !empty.WordPrefix.matchesNormalizedWord('anything'));
const ca = key('CA');
assert('WordPrefix' in ca && ca.WordPrefix.matchesNormalizedWord('café') && !ca.WordPrefix.matchesNormalizedWord('éca'));
assert.throws(() => compareScalarAtoms(ca, ca), SearchInputError);
assert(compareScalarAtoms({ Scalar: { String: '\uffff' } }, { Scalar: { String: '𐐀' } }) < 0);
assert(compareScalarAtoms({ Scalar: { String: 'x' } }, { Scalar: { Id: 'x' } }) < 0);
const wire = JSON.stringify(atom('E\u0301'));
assert.equal(JSON.stringify(decodeIndexAtom(wire, component, 2).atom), wire);
for (const json of [
  `{"WordPrefix":{"contract":"${SEARCH_CONTRACT}","source":"a","source":"a"}}`,
  `{"WordPrefix":{"contract":"${SEARCH_CONTRACT}","contract":"${SEARCH_CONTRACT}","source":"a"}}`,
  `{"WordPrefix":{"source":"a","contract":"${SEARCH_CONTRACT}"}}`,
  ` ${JSON.stringify(atom('a'))}`,
]) assert.throws(() => decodeIndexAtom(json, component, 100), SearchInputError);
for (const ch of ['𐐀', '"', '\\', '\t', '\n', '\r', '\u2028']) {
  const source = ch.repeat(2000), json = JSON.stringify(atom(source));
  assert(Buffer.byteLength(json) <= wordPrefixWireMax(2000));
  if (ch === '𐐀') assert.equal(Buffer.byteLength(json), wordPrefixWireMax(2000));
  decodeIndexAtom(json, component, 2000);
}
for (const bad of [
  {}, { WordPrefix: { source: 'foo' } }, { WordPrefix: { contract: 'unknown', source: 'foo' } },
  { WordPrefix: { contract: SEARCH_CONTRACT, source: 'foo', source_max: 999 } },
  { ...atom('foo'), extra: 1 }, { Scalar: { String: 'foo' } }, atom('foo foo'), atom('\ud800'),
  { WordPrefix: { contract: SEARCH_CONTRACT, source: null } },
  atom('\0'), atom('\u000b'), atom('\u001f'),
]) assert.throws(() => prepareIndexAtom(component, bad, 100), SearchInputError);
assert.throws(() => prepareIndexAtom(component, atom('foo')), SearchInputError);
assert.throws(() => prepareIndexAtom({ Column: 'name' }, atom('foo'), 100), SearchInputError);
for (const value of [{ String: '\ud800' }, { Id: '\ud800' }, { Int: 1.1 }, { Array: [] }, { Bytes: 'FF' }, { Bool: true, Int: 1 }]) {
  assert.throws(() => prepareIndexAtom({ Column: 'name' }, { Scalar: value }), SearchInputError);
}
console.log(`Unicode/search foundation: ${cases} normalization rows + unlisted scalars, ${folds.size} C/S folds, bounds and logical keys; tables ${TABLE_DIGEST}`);

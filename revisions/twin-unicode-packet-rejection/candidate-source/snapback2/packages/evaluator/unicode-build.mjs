// Build implementation imported by the existing package/test entry points, never by runtime code.
// Official inputs and their unchanged hashes live together under unicode/17.0.0.
// @ref LLP 1001#unicode-search-foundation — build shared pinned UCD inputs ahead of time.
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const inputs = new URL('../../unicode/17.0.0/', import.meta.url);
export const unicodeArtifact = new URL('./dist/unicode-tables.ts', import.meta.url);
const hex = s => Number.parseInt(s, 16);
const zig = n => n < 0 ? -2 * n - 1 : 2 * n;
const range = s => s.split('..').map(hex);
const lines = name => readFileSync(new URL(name, inputs), 'utf8').split('\n');

function varints(xs) {
  const bytes = [];
  for (let n of xs) {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('Unicode integer width changed');
    while (n >= 128) { bytes.push((n & 127) | 128); n = Math.floor(n / 128); }
    bytes.push(n);
  }
  return Buffer.from(bytes);
}
const width = n => n < 128 ? 1 : n < 16384 ? 2 : n < 2097152 ? 3 : n < 268435456 ? 4 : 5;

// Minimize operand bytes once, with fixed literal-first ties; no compressor-dependent tuning.
// A packet is (2 * count + mode), followed by literals or (first, zigzag step).
function packets(xs) {
  const n = xs.length, prefix = [0], cost = new Array(n + 1).fill(Infinity), choice = [];
  for (const x of xs) prefix.push(prefix.at(-1) + width(x));
  cost[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let count = n - i; count; count--) {
      const bytes = width(2 * count) + prefix[i + count] - prefix[i] + cost[i + count];
      if (bytes < cost[i]) { cost[i] = bytes; choice[i] = [count, 0]; }
    }
    if (i + 1 === n) continue;
    const step = xs[i + 1] - xs[i];
    let end = i + 2;
    while (end < n && xs[end] - xs[end - 1] === step) end++;
    for (let count = end - i; count >= 2; count--) {
      const bytes = width(2 * count + 1) + width(xs[i]) + width(zig(step)) + cost[i + count];
      if (bytes < cost[i]) { cost[i] = bytes; choice[i] = [count, 1]; }
    }
  }
  const encoded = [];
  for (let i = 0; i < n;) {
    const [count, mode] = choice[i];
    encoded.push(2 * count + mode);
    if (mode) encoded.push(xs[i], zig(xs[i + 1] - xs[i]));
    else for (let j = i; j < i + count; j++) encoded.push(xs[j]);
    i += count;
  }
  return varints(encoded);
}

function digest(columns) {
  // Each column is length-prefixed with a u32 LE for unambiguous cross-runtime custody.
  const hash = createHash('sha256');
  for (const bytes of columns) {
    const size = Buffer.alloc(4); size.writeUInt32LE(bytes.length);
    hash.update(size).update(bytes);
  }
  return hash.digest('hex');
}

export function generateUnicodeTables() {
  for (const line of lines('SHA256SUMS').filter(Boolean)) {
    const [expected, name] = line.trim().split(/\s+/);
    const actual = createHash('sha256').update(readFileSync(new URL(name, inputs))).digest('hex');
    if (actual !== expected) throw new Error(`Unicode 17 input hash mismatch: ${name}`);
  }
  const decomp = new Map(), ccc = new Map(), fold = new Map(), boundary = new Set(), excluded = new Set();
  for (const line of lines('UnicodeData.txt').filter(Boolean)) {
    const f = line.split(';'), cp = hex(f[0]);
    if (f[2].startsWith('P')) boundary.add(cp);
    if (+f[3]) ccc.set(cp, +f[3]);
    if (f[5] && !f[5].startsWith('<')) decomp.set(cp, f[5].split(' ').map(hex));
  }
  for (const [name, property, target] of [
    ['PropList.txt', 'White_Space', boundary],
    ['DerivedNormalizationProps.txt', 'Full_Composition_Exclusion', excluded],
  ]) {
    for (const line of lines(name)) {
      const f = line.split('#')[0].split(';').map(s => s.trim());
      if (f[1] !== property) continue;
      const [start, end = start] = range(f[0]);
      for (let cp = start; cp <= end; cp++) target.add(cp);
    }
  }
  for (const line of lines('CaseFolding.txt')) {
    const f = line.split('#')[0].split(';').map(s => s.trim());
    if (f[1] !== 'C' && f[1] !== 'S') continue;
    if (f[2].split(' ').length !== 1) throw new Error('Simple folding must map one scalar');
    fold.set(hex(f[0]), hex(f[2]));
  }
  let maxDepth = 0;
  function nfdLength(cp, depth = 0) {
    maxDepth = Math.max(maxDepth, depth);
    if (depth > 32) throw new Error('Cyclic Unicode decomposition');
    if (cp >= 0xac00 && cp <= 0xd7a3) return (cp - 0xac00) % 28 ? 3 : 2;
    const ds = decomp.get(cp);
    return ds ? ds.reduce((n, c) => n + nfdLength(c, depth + 1), 0) : 1;
  }
  const maxNfd = Math.max(3, ...[...decomp.keys()].map(cp => nfdLength(cp)));
  if (maxNfd !== 4) throw new Error('U = 4N proof changed');
  for (const [cp, to] of fold) {
    if (nfdLength(to) > nfdLength(cp)) throw new Error('Simple folding increases NFD length');
  }
  const columns = Array.from({ length: 7 }, () => []);
  let previous = 0;
  const destinations = [0, 0];
  for (const [cp, ds] of decomp) {
    if (ds.length > 2) throw new Error('Decomposition arity changed');
    columns[0].push(cp - previous); previous = cp;
    columns[1].push(2 * ds.length + +excluded.has(cp));
    ds.forEach((to, i) => { columns[2 + i].push(zig(to - destinations[i])); destinations[i] = to; });
  }
  for (const [column, entries] of [
    [4, [...ccc]], [5, [...fold].map(([cp, to]) => [cp, to - cp])],
    [6, [...boundary].sort((a, b) => a - b).map(cp => [cp])],
  ]) {
    const ranges = [];
    for (const [cp, value] of entries) {
      const last = ranges.at(-1);
      if (last && last[1] === cp - 1 && last[2] === value) last[1] = cp;
      else ranges.push([cp, cp, value]);
    }
    previous = 0;
    for (const [start, end, value] of ranges) {
      columns[column].push(start - previous, end - start); previous = start;
      if (value !== undefined) columns[column].push(column === 5 ? zig(value) : value);
    }
  }
  const encoded = columns.map(packets);
  const rows = [decomp.size, [...decomp].filter(([cp, ds]) => ds.length === 2 && !excluded.has(cp)).length,
    columns[4].length / 3, columns[5].length / 3, columns[6].length / 2];
  if (rows.some(n => !Number.isInteger(n) || n >= 4096)) throw new Error('Unicode lookup bound changed');
  const source = `// Generated from pinned Unicode 17 UCD; do not edit. See unicode/17.0.0/LICENSE.txt.\n`
    // The semantic digest remains the OLD canonical varint streams, not this packet container.
    + `export const TABLE_DIGEST = ${JSON.stringify(digest(columns.map(varints)))};\n`
    + `export const PACKET_DIGEST = ${JSON.stringify(digest(encoded))};\n`
    + `export const MAX_NFD_SCALARS = ${maxNfd};\nexport const MAX_DECOMPOSITION_DEPTH = ${maxDepth};\n`
    + `export const TABLE_ROWS = ${JSON.stringify(rows)};\n`
    + `export const COLUMN_LENGTHS = ${JSON.stringify(columns.map(xs => xs.length))};\n`
    + `export const MAX_COLUMN_VALUE = ${Math.max(...columns.map(xs => Math.max(...xs)))};\n`
    + `export const PACKETS = ${JSON.stringify(encoded.map(b => b.toString('base64')))};\n`;
  // A no-op rebuild preserves mtime; atomic replacement permits concurrent build/test entry paths.
  try { if (readFileSync(unicodeArtifact, 'utf8') === source) return; } catch (e) { if (e.code !== 'ENOENT') throw e; }
  mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
  const temporary = `${fileURLToPath(unicodeArtifact)}.${process.pid}.tmp`;
  writeFileSync(temporary, source);
  renameSync(temporary, unicodeArtifact);
}

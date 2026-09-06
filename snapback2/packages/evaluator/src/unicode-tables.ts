// Decode build output only. UCD parsing and code generation never run in the evaluator.
import { PACKED } from '../dist/unicode-tables';
export { TABLE_DIGEST, MAX_NFD_SCALARS, MAX_DECOMPOSITION_DEPTH } from '../dist/unicode-tables';

function unpack(s: string): number[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0, acc = 0, n = 0, shift = 0;
  const out: number[] = [];
  for (const ch of s) {
    const v = alphabet.indexOf(ch);
    if (v < 0) break;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) {
      bits -= 8;
      const b = (acc >> bits) & 255;
      n |= (b & 127) << shift;
      if (b & 128) shift += 7;
      else { out.push(n); n = shift = 0; }
    }
  }
  return out;
}
const unzig = (n: number) => n & 1 ? -(n + 1) / 2 : n / 2;
const columns = PACKED.map(unpack);
const d: number[] = [], c: number[][] = [];
let cp = 0;
const previous = [0, 0], positions = [0, 0];
for (let i = 0; i < columns[0].length; i++) {
  cp += columns[0][i];
  const flag = columns[1][i], xs = [0, 0];
  for (let j = 0; j < (flag >> 1); j++) xs[j] = previous[j] += unzig(columns[2 + j][positions[j]++]);
  d.push(cp, xs[0], xs[1], flag >> 1);
  if ((flag >> 1) === 2 && !(flag & 1)) c.push([xs[0], xs[1], cp]);
}
c.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
export const decomposition = new Uint32Array(d);
export const composition = new Uint32Array(c.flat());
function ranges(column: number): Int32Array {
  let cp = 0;
  const xs = columns[column], out: number[] = [];
  for (let i = 0; i < xs.length;) {
    cp += xs[i++];
    const end = cp + xs[i++];
    out.push(cp, end, column === 6 ? 1 : column === 5 ? unzig(xs[i++]) : xs[i++]);
  }
  return new Int32Array(out);
}
export const combining = ranges(4), folding = ranges(5), boundaries = ranges(6);

// Pinned tables have <4096 rows: every binary search takes at most 12 probes.
export const MAX_LOOKUP_PROBES = 12;
export function rangeValue(table: Int32Array, cp: number): number {
  let lo = 0, hi = table.length / 3;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (table[mid * 3 + 1] < cp) lo = mid + 1; else hi = mid;
  }
  return lo < table.length / 3 && table[lo * 3] <= cp ? table[lo * 3 + 2] : 0;
}
export function decomposeAt(cp: number): number {
  let lo = 0, hi = decomposition.length / 4;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (decomposition[mid * 4] < cp) lo = mid + 1; else hi = mid;
  }
  return decomposition[lo * 4] === cp ? lo * 4 : -1;
}
export function composePair(a: number, b: number): number {
  if (a >= 0x1100 && a < 0x1113 && b >= 0x1161 && b < 0x1176) return 0xac00 + ((a - 0x1100) * 21 + b - 0x1161) * 28;
  if (a >= 0xac00 && a <= 0xd7a3 && (a - 0xac00) % 28 === 0 && b > 0x11a7 && b < 0x11c3) return a + b - 0x11a7;
  let lo = 0, hi = composition.length / 3;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1, x = composition[mid * 3], y = composition[mid * 3 + 1];
    if (x < a || (x === a && y < b)) lo = mid + 1; else hi = mid;
  }
  return composition[lo * 3] === a && composition[lo * 3 + 1] === b ? composition[lo * 3 + 2] : 0;
}

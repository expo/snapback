// Decode build output only. UCD parsing and code generation never run in the evaluator.
import { PACKETS, COLUMN_LENGTHS, TABLE_ROWS, MAX_COLUMN_VALUE } from '../dist/unicode-tables';
export { TABLE_DIGEST, MAX_NFD_SCALARS, MAX_DECOMPOSITION_DEPTH } from '../dist/unicode-tables';

const unzig = (n: number) => n & 1 ? -(n + 1) / 2 : n / 2;
const invalid = (): never => { throw new TypeError('Invalid Unicode packet'); };

// @ref LLP 1001#unicode-search-foundation — bounded readers fill only the pinned final tables.
class PacketReader {
  private text: string;
  private left: number;
  private offset = 0;
  private bits = 0;
  private acc = 0;
  private run = 0;
  private affine = false;
  private value = 0;
  private step = 0;
  constructor(text: string, count: number) { this.text = text; this.left = count; }
  private integer(): number {
    let n = 0, scale = 1;
    for (let width = 0; width < 5; width++) {
      while (this.bits < 8) {
        if (this.offset >= this.text.length) invalid();
        const digit = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(this.text[this.offset++]);
        if (digit < 0) invalid();
        this.acc = (this.acc << 6) | digit; this.bits += 6;
      }
      this.bits -= 8;
      const byte = (this.acc >> this.bits) & 255;
      this.acc &= (1 << this.bits) - 1;
      if (width === 4 && byte > 15) invalid();
      n += (byte & 127) * scale;
      if (!(byte & 128)) {
        if (width && !byte) invalid();
        return n;
      }
      scale *= 128;
    }
    return invalid();
  }
  next(): number {
    if (!this.left) invalid();
    if (!this.run) {
      const header = this.integer();
      this.run = Math.floor(header / 2); this.affine = !!(header & 1);
      if (!this.run || this.run > this.left) invalid();
      if (this.affine) {
        if (this.run < 2) invalid();
        this.value = this.integer(); this.step = unzig(this.integer());
        const last = this.value + this.step * (this.run - 1);
        if (this.value > MAX_COLUMN_VALUE || last < 0 || last > MAX_COLUMN_VALUE) invalid();
      }
    }
    const n = this.affine ? this.value : this.integer();
    if (n > MAX_COLUMN_VALUE) invalid();
    this.value += this.step; this.run--; this.left--;
    return n;
  }
  finish(): void {
    if (this.left || this.run || this.acc || this.text.slice(this.offset) !== '='.repeat(this.bits / 2)) invalid();
  }
}

function initialize() {
  if (TABLE_ROWS.length !== 5 || TABLE_ROWS.some(n => !Number.isInteger(n) || n < 0 || n >= 4096)
    || PACKETS.length !== 7 || COLUMN_LENGTHS.length !== 7) invalid();
  const [d, c, k, f, w] = TABLE_ROWS;
  if (c > d || COLUMN_LENGTHS.some((n, i) => !Number.isInteger(n) || n < 0
    || (i === 3 ? n > d : n !== [d, d, d, 0, 3 * k, 3 * f, 2 * w][i]))) invalid();
  const readers = PACKETS.map((text, i) => new PacketReader(text, COLUMN_LENGTHS[i]));
  const decomposition = new Uint32Array(4 * d), composition = new Uint32Array(3 * c);
  const order = new Uint16Array(c);
  let cp = 0, first = 0, second = 0, count = 0;
  for (let i = 0; i < d; i++) {
    cp += readers[0].next();
    const flag = readers[1].next(), arity = flag >> 1;
    if (flag < 2 || flag > 5) invalid();
    first += unzig(readers[2].next());
    if (arity === 2) second += unzig(readers[3].next());
    const at = i * 4;
    decomposition[at] = cp; decomposition[at + 1] = first;
    decomposition[at + 2] = arity === 2 ? second : 0; decomposition[at + 3] = arity;
    if (arity === 2 && !(flag & 1)) {
      if (count === c) invalid();
      order[count++] = i;
    }
  }
  if (count !== c) invalid();
  order.sort((a, b) => decomposition[a * 4 + 1] - decomposition[b * 4 + 1]
    || decomposition[a * 4 + 2] - decomposition[b * 4 + 2]);
  for (let i = 0; i < c; i++) {
    const at = order[i] * 4;
    composition[i * 3] = decomposition[at + 1]; composition[i * 3 + 1] = decomposition[at + 2];
    composition[i * 3 + 2] = decomposition[at];
  }
  function ranges(column: number, rows: number): Int32Array {
    const out = new Int32Array(3 * rows), reader = readers[column];
    let cp = 0;
    for (let i = 0; i < out.length; i += 3) {
      cp += reader.next(); out[i] = cp; out[i + 1] = cp + reader.next();
      out[i + 2] = column === 6 ? 1 : column === 5 ? unzig(reader.next()) : reader.next();
    }
    return out;
  }
  const combining = ranges(4, k), folding = ranges(5, f), boundaries = ranges(6, w);
  for (const reader of readers) reader.finish();
  return { decomposition, composition, combining, folding, boundaries };
}
export const { decomposition, composition, combining, folding, boundaries } = initialize();

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

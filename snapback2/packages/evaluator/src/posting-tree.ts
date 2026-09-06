// @ref LLP 1012#indexed-held-search — persistent postings use numeric slots; row bodies and scalar keys stay shared.
// Five u32 cells per AVL node: left, right, row handle, trie handle, height. Freed slots never retain payloads.
export class PostingTree {
  private chunks: Uint32Array[] = [];
  private serial = 0;
  private free = 0;
  private root = 0;
  size = 0;
  constructor(private compare: (row: number, token: number, otherRow: number, otherToken: number) => number) {}
  private get(node: number, field: number): number { return node ? this.chunks[node >>> 10][(node & 1023) * 5 + field] : 0; }
  private set(node: number, field: number, value: number): void { this.chunks[node >>> 10][(node & 1023) * 5 + field] = value; }
  private height(node: number): number { return this.get(node, 4); }
  private fix(node: number): number { this.set(node, 4, 1 + Math.max(this.height(this.get(node, 0)), this.height(this.get(node, 1)))); return node; }
  private rotate(node: number, left: boolean): number {
    const side = left ? 1 : 0, other = 1 - side, top = this.get(node, side);
    this.set(node, side, this.get(top, other)); this.set(top, other, this.fix(node)); return this.fix(top);
  }
  private balance(node: number): number {
    const left = this.get(node, 0), right = this.get(node, 1), delta = this.height(left) - this.height(right);
    if (delta > 1) {
      if (this.height(this.get(left, 0)) < this.height(this.get(left, 1))) this.set(node, 0, this.rotate(left, true));
      return this.rotate(node, false);
    }
    if (delta < -1) {
      if (this.height(this.get(right, 1)) < this.height(this.get(right, 0))) this.set(node, 1, this.rotate(right, false));
      return this.rotate(node, true);
    }
    return this.fix(node);
  }
  put(row: number, token: number): void { this.root = this.change(this.root, row, token, true); }
  remove(row: number, token: number): void {
    this.root = this.change(this.root, row, token, false);
    if (!this.size) { this.chunks = []; this.serial = this.free = this.root = 0; }
  }
  private change(node: number, row: number, token: number, insert: boolean): number {
    if (!node) {
      if (!insert) return 0;
      if (this.free) { node = this.free; this.free = this.get(node, 0); }
      else {
        if (this.serial === 0xffffffff) throw new RangeError('posting capacity exceeded');
        node = ++this.serial; if (node >>> 10 >= this.chunks.length) this.chunks.push(new Uint32Array(1024 * 5));
      }
      this.set(node, 0, 0); this.set(node, 1, 0); this.set(node, 2, row); this.set(node, 3, token); this.set(node, 4, 1); this.size++;
      return node;
    }
    const cmp = this.compare(row, token, this.get(node, 2), this.get(node, 3));
    if (cmp) { const side = cmp < 0 ? 0 : 1; this.set(node, side, this.change(this.get(node, side), row, token, insert)); }
    else if (!insert) {
      const left = this.get(node, 0), right = this.get(node, 1);
      if (!left || !right) {
        this.set(node, 0, this.free); this.set(node, 1, 0); this.set(node, 2, 0); this.set(node, 3, 0); this.set(node, 4, 0);
        this.free = node; this.size--; return left || right;
      }
      let successor = right; while (this.get(successor, 0)) successor = this.get(successor, 0);
      const nextRow = this.get(successor, 2), nextToken = this.get(successor, 3);
      this.set(node, 2, nextRow); this.set(node, 3, nextToken);
      this.set(node, 1, this.change(right, nextRow, nextToken, false));
    }
    return this.balance(node);
  }
  has(row: number, token: number): boolean {
    let node = this.root;
    while (node) { const cmp = this.compare(row, token, this.get(node, 2), this.get(node, 3)); if (!cmp) return true; node = this.get(node, cmp < 0 ? 0 : 1); }
    return false;
  }
  *seek(compare: (row: number, token: number) => number, descending: boolean): Generator<number> {
    const stack: number[] = [], first = descending ? 1 : 0, next = 1 - first;
    let node = this.root;
    while (node || stack.length) {
      while (node) {
        const cmp = compare(this.get(node, 2), this.get(node, 3)) * (descending ? -1 : 1);
        if (cmp < 0) node = this.get(node, next); else { stack.push(node); node = this.get(node, first); }
      }
      node = stack.pop() ?? 0; if (!node) break;
      if (compare(this.get(node, 2), this.get(node, 3))) break;
      yield this.get(node, 2); node = this.get(node, next);
    }
  }
}

// @ref LLP 1012#indexed-held-search — persistent postings use numeric slots; row bodies and scalar keys stay shared.
// Five u32 cells per AVL node: left, right, row handle, trie handle, height. Freed slots never retain payloads.
import { SlotTree } from './slot-tree.js';
export class PostingTree extends SlotTree {
  constructor(private compare: (row: number, token: number, otherRow: number, otherToken: number) => number) { super(5, 0); }
  put(row: number, token: number): void { this.root = this.change(this.root, row, token, true); }
  remove(row: number, token: number): void { this.root = this.change(this.root, row, token, false); }
  private change(node: number, row: number, token: number, insert: boolean): number {
    if (!node) {
      if (!insert) return 0;
      node = this.allocate(); this.set(node, 2, row); this.set(node, 3, token);
      return node;
    }
    const cmp = this.compare(row, token, this.get(node, 2), this.get(node, 3));
    if (cmp) { const side = cmp < 0 ? 0 : 1; this.set(node, side, this.change(this.get(node, side), row, token, insert)); }
    else if (!insert) {
      const next = this.without(node); this.freeNode(node); return next;
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

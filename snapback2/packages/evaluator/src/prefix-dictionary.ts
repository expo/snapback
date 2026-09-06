// @ref LLP 1012#indexed-held-search — prefix identity is shared across scopes; resident storage counts every prefix.
// Seven u32 cells: parent, children, scalar, references, left, right, height.
// A node's children form an AVL tree by Unicode scalar. No source spelling or per-prefix object/Map is retained.
import { SlotTree } from './slot-tree.js';
export class PrefixDictionary extends SlotTree {
  constructor() { super(7, 4); }
  child(parent: number, scalar: number): number {
    let node = parent ? this.get(parent, 1) : this.root;
    while (node) { const cmp = scalar - this.get(node, 2); if (!cmp) return node; node = this.get(node, cmp < 0 ? 4 : 5); }
    return 0;
  }
  intern(parent: number, scalar: number): number {
    const found = this.child(parent, scalar); if (found) return found;
    const node = this.allocate(); this.set(node, 0, parent); this.set(node, 2, scalar);
    const root = this.insert(parent ? this.get(parent, 1) : this.root, node);
    if (parent) this.set(parent, 1, root); else this.root = root;
    return node;
  }
  private insert(root: number, node: number): number {
    if (!root) return node;
    const side = this.get(node, 2) < this.get(root, 2) ? 4 : 5;
    this.set(root, side, this.insert(this.get(root, side), node)); return this.balance(root);
  }
  retain(node: number): void { this.set(node, 3, this.get(node, 3) + 1); }
  release(node: number): void {
    const refs = this.get(node, 3) - 1; this.set(node, 3, refs); if (refs) return;
    const parent = this.get(node, 0);
    const root = this.remove(parent ? this.get(parent, 1) : this.root, this.get(node, 2));
    if (parent) this.set(parent, 1, root); else this.root = root;
    this.freeNode(node);
  }
  private remove(root: number, scalar: number): number {
    const cmp = scalar - this.get(root, 2);
    if (cmp) { const side = cmp < 0 ? 4 : 5; this.set(root, side, this.remove(this.get(root, side), scalar)); }
    else return this.without(root);
    return this.balance(root);
  }
}

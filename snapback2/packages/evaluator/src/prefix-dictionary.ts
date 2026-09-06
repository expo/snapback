// @ref LLP 1012#indexed-held-search — prefix identity is shared across scopes; resident storage counts every prefix.
// Seven u32 cells: parent, children, scalar, references, left, right, height.
// A node's children form an AVL tree by Unicode scalar. No source spelling or per-prefix object/Map is retained.
export class PrefixDictionary {
  private chunks: Uint32Array[] = [];
  private serial = 0;
  private free = 0;
  private root = 0;
  private size = 0;
  private get(node: number, field: number): number { return node ? this.chunks[node >>> 10][(node & 1023) * 7 + field] : 0; }
  private set(node: number, field: number, value: number): void { this.chunks[node >>> 10][(node & 1023) * 7 + field] = value; }
  private height(node: number): number { return this.get(node, 6); }
  private fix(node: number): number { this.set(node, 6, 1 + Math.max(this.height(this.get(node, 4)), this.height(this.get(node, 5)))); return node; }
  private rotate(node: number, left: boolean): number {
    const side = left ? 5 : 4, other = 9 - side, top = this.get(node, side);
    this.set(node, side, this.get(top, other)); this.set(top, other, this.fix(node)); return this.fix(top);
  }
  private balance(node: number): number {
    const left = this.get(node, 4), right = this.get(node, 5), delta = this.height(left) - this.height(right);
    if (delta > 1) {
      if (this.height(this.get(left, 4)) < this.height(this.get(left, 5))) this.set(node, 4, this.rotate(left, true));
      return this.rotate(node, false);
    }
    if (delta < -1) {
      if (this.height(this.get(right, 5)) < this.height(this.get(right, 4))) this.set(node, 5, this.rotate(right, false));
      return this.rotate(node, true);
    }
    return this.fix(node);
  }
  child(parent: number, scalar: number): number {
    let node = parent ? this.get(parent, 1) : this.root;
    while (node) { const cmp = scalar - this.get(node, 2); if (!cmp) return node; node = this.get(node, cmp < 0 ? 4 : 5); }
    return 0;
  }
  intern(parent: number, scalar: number): number {
    const found = this.child(parent, scalar); if (found) return found;
    let node: number;
    if (this.free) { node = this.free; this.free = this.get(node, 0); }
    else {
      if (this.serial === 0xffffffff) throw new RangeError('prefix dictionary capacity exceeded');
      node = ++this.serial; if (node >>> 10 >= this.chunks.length) this.chunks.push(new Uint32Array(1024 * 7));
    }
    this.set(node, 0, parent); this.set(node, 2, scalar); this.set(node, 6, 1); this.size++;
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
    for (let field = 1; field < 7; field++) this.set(node, field, 0);
    this.set(node, 0, this.free); this.free = node;
    if (--this.size === 0) { this.chunks = []; this.serial = this.free = this.root = 0; }
  }
  private remove(root: number, scalar: number): number {
    const cmp = scalar - this.get(root, 2);
    if (cmp) { const side = cmp < 0 ? 4 : 5; this.set(root, side, this.remove(this.get(root, side), scalar)); }
    else {
      const left = this.get(root, 4), right = this.get(root, 5);
      if (!left || !right) return left || right;
      let successor = right; while (this.get(successor, 4)) successor = this.get(successor, 4);
      // Move the node, not its scalar/prefix identity: existing posting handles must stay valid.
      const remainder = this.remove(right, this.get(successor, 2));
      this.set(successor, 4, left); this.set(successor, 5, remainder); root = successor;
    }
    return this.balance(root);
  }
}

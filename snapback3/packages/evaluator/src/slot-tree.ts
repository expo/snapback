// @ref LLP 1012#indexed-held-search — compact resident indexes share numeric-slot AVL mechanics, never per-posting objects.
export class SlotTree {
  private chunks: Uint32Array[] = [];
  private serial = 0;
  private free = 0;
  protected root = 0;
  size = 0;
  constructor(private width: number, private left: number) {}
  protected get(node: number, field: number): number { return node ? this.chunks[node >>> 10][(node & 1023) * this.width + field] : 0; }
  protected set(node: number, field: number, value: number): void { this.chunks[node >>> 10][(node & 1023) * this.width + field] = value; }
  private height(node: number): number { return this.get(node, this.width - 1); }
  private fix(node: number): number {
    this.set(node, this.width - 1, 1 + Math.max(this.height(this.get(node, this.left)), this.height(this.get(node, this.left + 1)))); return node;
  }
  private rotate(node: number, left: boolean): number {
    const side = this.left + +left, other = this.left + +!left, top = this.get(node, side);
    this.set(node, side, this.get(top, other)); this.set(top, other, this.fix(node)); return this.fix(top);
  }
  protected balance(node: number): number {
    const a = this.left, b = a + 1, left = this.get(node, a), right = this.get(node, b), delta = this.height(left) - this.height(right);
    if (delta > 1) {
      if (this.height(this.get(left, a)) < this.height(this.get(left, b))) this.set(node, a, this.rotate(left, true));
      return this.rotate(node, false);
    }
    if (delta < -1) {
      if (this.height(this.get(right, b)) < this.height(this.get(right, a))) this.set(node, b, this.rotate(right, false));
      return this.rotate(node, true);
    }
    return this.fix(node);
  }
  protected allocate(): number {
    let node: number;
    if (this.free) { node = this.free; this.free = this.get(node, 0); this.set(node, 0, 0); }
    else {
      if (this.serial === 0xffffffff) throw new RangeError('index slot capacity exceeded');
      node = ++this.serial; if (node >>> 10 >= this.chunks.length) this.chunks.push(new Uint32Array(1024 * this.width));
    }
    this.set(node, this.width - 1, 1); this.size++; return node;
  }
  protected freeNode(node: number): void {
    for (let field = 1; field < this.width; field++) this.set(node, field, 0);
    this.set(node, 0, this.free); this.free = node;
    if (!--this.size) { this.chunks = []; this.serial = this.free = this.root = 0; }
  }
  private withoutFirst(root: number): number {
    const left = this.get(root, this.left);
    if (!left) return this.get(root, this.left + 1);
    this.set(root, this.left, this.withoutFirst(left)); return this.balance(root);
  }
  protected without(root: number): number {
    const a = this.left, b = a + 1, left = this.get(root, a), right = this.get(root, b);
    if (!left || !right) return left || right;
    let successor = right; while (this.get(successor, a)) successor = this.get(successor, a);
    // Transplant the slot itself: dictionary handles retain their prefix identity.
    const remainder = this.withoutFirst(right);
    this.set(successor, a, left); this.set(successor, b, remainder); return this.balance(successor);
  }
}

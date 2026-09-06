// @ref LLP 1012#indexed-held-search — maintained ordered seeks, including ordinary indexes; no read-time sort.
type Fold<V, A> = (left: A | undefined, value: V, right: A | undefined) => A;
type Node<K, V, A> = { key: K; value: V; height: number; summary?: A; left?: Node<K, V, A>; right?: Node<K, V, A> };
const height = (node: Node<any, any, any> | undefined): number => node?.height ?? 0;
function fix<K, V, A>(node: Node<K, V, A>, fold?: Fold<V, A>): Node<K, V, A> {
  node.height = 1 + Math.max(height(node.left), height(node.right));
  if (fold) node.summary = fold(node.left?.summary, node.value, node.right?.summary);
  return node;
}
function rotate<K, V, A>(node: Node<K, V, A>, left: boolean, fold?: Fold<V, A>): Node<K, V, A> {
  const side = left ? "right" : "left", other = left ? "left" : "right";
  const top = node[side]!;
  node[side] = top[other]; top[other] = fix(node, fold);
  return fix(top, fold);
}
function balance<K, V, A>(node: Node<K, V, A>, fold?: Fold<V, A>): Node<K, V, A> {
  const delta = height(node.left) - height(node.right);
  if (delta > 1) {
    if (height(node.left!.left) < height(node.left!.right)) node.left = rotate(node.left!, true, fold);
    return rotate(node, false, fold);
  }
  if (delta < -1) {
    if (height(node.right!.right) < height(node.right!.left)) node.right = rotate(node.right!, false, fold);
    return rotate(node, true, fold);
  }
  return fix(node, fold);
}

export class Ordered<K, V, A = never> {
  private root?: Node<K, V, A>;
  size = 0;
  constructor(readonly compare: (a: K, b: K) => number, private fold?: Fold<V, A>) {}
  get summary(): A | undefined { return this.root?.summary; }
  set(key: K, value: V): void { this.root = this.change(this.root, key, value); }
  delete(key: K): void { this.root = this.change(this.root, key); }
  get(key: K): V | undefined {
    let node = this.root;
    while (node) { const c = this.compare(key, node.key); if (!c) return node.value; node = c < 0 ? node.left : node.right; }
  }
  private change(node: Node<K, V, A> | undefined, key: K, value?: V): Node<K, V, A> | undefined {
    if (!node) { if (value === undefined) return; this.size++; return fix({ key, value, height: 1 }, this.fold); }
    const c = this.compare(key, node.key);
    if (c < 0) node.left = this.change(node.left, key, value);
    else if (c > 0) node.right = this.change(node.right, key, value);
    else if (value !== undefined) node.value = value;
    else {
      if (!node.left || !node.right) { this.size--; return node.left ?? node.right; }
      let successor = node.right;
      while (successor.left) successor = successor.left;
      node.key = successor.key; node.value = successor.value;
      node.right = this.change(node.right, successor.key);
    }
    return balance(node, this.fold);
  }
  /** compare(key) is negative below the requested interval, positive above it. */
  *seek(compare: (key: K) => number, descending = false): Generator<[K, V]> {
    const stack: Node<K, V, A>[] = [];
    const first = descending ? "right" : "left", next = descending ? "left" : "right";
    let node = this.root;
    while (node || stack.length) {
      while (node) {
        const c = compare(node.key) * (descending ? -1 : 1);
        if (c < 0) node = node[next];
        else { stack.push(node); node = node[first]; }
      }
      node = stack.pop();
      if (!node) break;
      if (compare(node.key) !== 0) break;
      yield [node.key, node.value];
      node = node[next];
    }
  }
}

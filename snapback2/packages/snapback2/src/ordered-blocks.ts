// @ref LLP 1018.008.007.002#11-block-index-acquisition-restart — IDB is the
// fence index; bounded packed leaves replace individual posting records.
import { bad, compareKeys, nativeKey, ownKey, ownValue, readKey, readValue, type BlockKey } from './ordered-block-codec.js';

export type OrderedChange<V> = { kind: 'put'; key: IDBValidKey; value: V } | { kind: 'delete'; key: IDBValidKey };
export interface OrderedBounds { lower?: IDBValidKey; upper?: IDBValidKey; lowerOpen?: boolean; upperOpen?: boolean; order?: 'Asc' | 'Desc' }
export interface OrderedEntry<V> { key: IDBValidKey; value: V }
type Entry = { key: BlockKey; value: string };
type Leaf = { lower: BlockKey | null; upper: BlockKey | null; previous: BlockKey | null | false; entries: Entry[]; packed: string };
type Root = { tail: BlockKey | null; count: number; leaves: number; revision: number };
type State = { root?: Root | null; reading?: Promise<Root | null>; cache: Map<string, Leaf>; bytes: number; writing?: Promise<void>; failed: boolean };
type Change = { key: BlockKey; value?: string; ordinal: number };
const states = new WeakMap<IDBTransaction, Map<string, State>>();
const MAX_ENTRIES = 256, TARGET_BYTES = 65536, CACHE_BYTES = 1048576;
const utf8 = new TextEncoder();
const id = (key: BlockKey | null): string => key?.text ?? '';
const same = (a: BlockKey | null, b: BlockKey | null): boolean => id(a) === id(b);
const lowerCompare = (a: BlockKey | null, b: BlockKey | null): number => a === null ? b === null ? 0 : -1 : b === null ? 1 : compareKeys(a, b);
function request<T>(req: IDBRequest<T>): Promise<T> {
  const done = new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  void done.catch(() => undefined); return done;
}
function parse(text: unknown): any {
  if (typeof text !== 'string') bad('record must be a packed string');
  try { return JSON.parse(text); } catch { return bad('invalid packed JSON'); }
}
function fence(value: unknown): BlockKey | null { return value === null ? null : readKey(value); }
function integer(value: unknown, minimum: number): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum; }
function readRoot(text: unknown): Root {
  const a = parse(text);
  if (!Array.isArray(a) || a.length !== 6 || a[0] !== 'root' || a[1] !== 1 || !integer(a[3], 0) || !integer(a[4], 1) || !integer(a[5], 0)) bad('invalid anchor');
  const root = { tail: fence(a[2]), count: a[3], leaves: a[4], revision: a[5] };
  if ((root.leaves === 1) !== (root.tail === null) || root.count === 0 && root.leaves !== 1 || root.count > 0 && root.leaves > root.count) bad('inconsistent anchor');
  return root;
}
function packRoot(root: Root): string { return JSON.stringify(['root', 1, root.tail?.text ?? null, root.count, root.leaves, root.revision]); }
function triples(entries: Entry[]): [number, string, string][] {
  let previous = '';
  return entries.map(entry => {
    const key = entry.key.text; let prefix = 0;
    while (prefix < Math.min(key.length, previous.length) && key.charCodeAt(prefix) === previous.charCodeAt(prefix)) prefix++;
    const result: [number, string, string] = [prefix, key.slice(prefix), entry.value]; previous = key; return result;
  });
}
function packLeaf(lower: BlockKey | null, upper: BlockKey | null, previous: BlockKey | null | false, entries: Entry[]): Leaf {
  const packed = JSON.stringify([1, lower?.text ?? null, upper?.text ?? null, previous === false ? false : previous?.text ?? null, triples(entries)]);
  return { lower, upper, previous, entries, packed };
}
function readLeaf(text: unknown, expected: BlockKey | null): Leaf {
  const a = parse(text);
  if (!Array.isArray(a) || a.length !== 5 || a[0] !== 1 || !Array.isArray(a[4]) || a[4].length > MAX_ENTRIES) bad('invalid leaf');
  const lower = fence(a[1]), upper = fence(a[2]), previous = a[3] === false ? false : fence(a[3]);
  if (!same(lower, expected) || lower && upper && compareKeys(lower, upper) >= 0 || (lower === null) !== (previous === false)
    || previous && lower && compareKeys(previous, lower) >= 0) bad('invalid leaf fences');
  let prior = '', priorKey: BlockKey | undefined;
  const entries: Entry[] = a[4].map((part: unknown) => {
    if (!Array.isArray(part) || part.length !== 3 || !integer(part[0], 0) || part[0] > prior.length || typeof part[1] !== 'string' || typeof part[2] !== 'string') bad('invalid compressed entry');
    const text = prior.slice(0, part[0]) + part[1], key = readKey(text);
    if (priorKey && compareKeys(priorKey, key) >= 0 || lower && compareKeys(key, lower) < 0 || upper && compareKeys(key, upper) >= 0) bad('unordered or out-of-fence entry');
    readValue(part[2]); prior = text; priorKey = key; return { key, value: part[2] };
  });
  if (entries.length > 1 && utf8.encode(text as string).length > TARGET_BYTES) bad('oversized multiple-entry leaf');
  return { lower, upper, previous, entries, packed: text as string };
}
function search(entries: Entry[], key: BlockKey, after: boolean): number {
  let low = 0, high = entries.length;
  while (low < high) { const middle = (low + high) >>> 1, c = compareKeys(entries[middle]!.key, key); if (c < 0 || after && c === 0) low = middle + 1; else high = middle; }
  return low;
}

/** Values are finite plain JSON; keys have IndexedDB semantics. Calls within a
 * transaction share bounded leaf ownership. The caller still awaits IDB commit. */
export class OrderedBlocks<V> {
  private readonly state: State;
  constructor(private readonly tx: IDBTransaction, private readonly store: string, private readonly namespace: string, _factory?: IDBFactory) {
    let namespaces = states.get(tx); if (!namespaces) { namespaces = new Map(); states.set(tx, namespaces); }
    const name = JSON.stringify([store, namespace]);
    let state = namespaces.get(name);
    if (!state) {
      state = { cache: new Map(), bytes: 0, failed: false }; namespaces.set(name, state);
      tx.addEventListener('abort', () => { state!.failed = true; state!.cache.clear(); state!.bytes = 0; });
      tx.addEventListener('complete', () => { state!.failed = true; state!.cache.clear(); state!.bytes = 0; });
    }
    this.state = state;
  }
  private objectStore(): IDBObjectStore { if (this.state.failed) bad('transaction is no longer active'); return this.tx.objectStore(this.store); }
  private physical(lower: BlockKey | null): IDBValidKey { return lower === null ? [this.namespace, 0] : [this.namespace, 1, nativeKey(lower)]; }
  private retain(leaf: Leaf): Leaf {
    const cache = this.state.cache, key = id(leaf.lower), old = cache.get(key);
    if (old) this.state.bytes -= old.packed.length * 2;
    cache.delete(key); cache.set(key, leaf); this.state.bytes += leaf.packed.length * 2;
    while (cache.size > 1 && (this.state.bytes > CACHE_BYTES || cache.size > 64)) {
      const oldest = cache.entries().next().value!; cache.delete(oldest[0]); this.state.bytes -= oldest[1].packed.length * 2;
    }
    return leaf;
  }
  private async root(): Promise<Root | null> {
    if (this.state.failed) bad('transaction is no longer active');
    if (this.state.root !== undefined) return this.state.root;
    if (!this.state.reading) this.state.reading = (async () => {
      const text = await request(this.objectStore().get([this.namespace]));
      if (text !== undefined) return this.state.root = readRoot(text);
      const next = await request(this.objectStore().openCursor(IDBKeyRange.lowerBound([this.namespace])));
      if (next && Array.isArray(next.key) && next.key[0] === this.namespace) bad('missing namespace anchor');
      return this.state.root = null;
    })();
    return this.state.reading;
  }
  private check(leaf: Leaf, root: Root): Leaf {
    if ((leaf.upper === null) !== same(leaf.lower, root.tail) || !leaf.entries.length && (root.count !== 0 || leaf.lower !== null || leaf.upper !== null)) bad('leaf disagrees with anchor');
    return leaf;
  }
  private async leaf(lower: BlockKey | null, root: Root): Promise<Leaf> {
    const cached = this.state.cache.get(id(lower)); if (cached) return this.check(this.retain(cached), root);
    const text = await request(this.objectStore().get(this.physical(lower)));
    if (text === undefined) bad('missing leaf');
    return this.check(this.retain(readLeaf(text, lower)), root);
  }
  private async locate(key: BlockKey, root: Root): Promise<Leaf> {
    for (const leaf of this.state.cache.values()) {
      if ((!leaf.lower || compareKeys(leaf.lower, key) <= 0) && (!leaf.upper || compareKeys(key, leaf.upper) < 0)) return this.check(this.retain(leaf), root);
    }
    const cursor = await request(this.objectStore().openCursor(IDBKeyRange.bound([this.namespace, 0], [this.namespace, 1, nativeKey(key)]), 'prev'));
    if (!cursor || !Array.isArray(cursor.key) || cursor.key[0] !== this.namespace) bad('missing predecessor leaf');
    const k = cursor.key;
    const lower = k.length === 2 && k[1] === 0 ? null : k.length === 3 && k[1] === 1 ? ownKey(k[2]!) : bad('invalid physical leaf key');
    const leaf = this.check(this.retain(readLeaf(cursor.value, lower)), root);
    if (leaf.lower && compareKeys(leaf.lower, key) > 0 || leaf.upper && compareKeys(key, leaf.upper) >= 0) bad('gap before requested key');
    return leaf;
  }
  private async adjacent(leaf: Leaf, forward: boolean, root: Root): Promise<Leaf | null> {
    if (forward ? leaf.upper === null : leaf.previous === false) return null;
    const next = await this.leaf(forward ? leaf.upper : leaf.previous as BlockKey | null, root);
    if (forward ? next.previous === false || !same(next.previous, leaf.lower) : !same(next.upper, leaf.lower)) bad('broken adjacent fences');
    return next;
  }
  async get(key: IDBValidKey): Promise<V | undefined> {
    const owned = ownKey(key); await this.state.writing;
    const root = await this.root(); if (!root) return undefined;
    const leaf = await this.locate(owned, root), at = search(leaf.entries, owned, false), entry = leaf.entries[at];
    return entry && compareKeys(entry.key, owned) === 0 ? readValue(entry.value) as V : undefined;
  }
  seek(bounds: OrderedBounds = {}): AsyncIterableIterator<OrderedEntry<V>> {
    const lower = bounds.lower === undefined ? undefined : ownKey(bounds.lower), upper = bounds.upper === undefined ? undefined : ownKey(bounds.upper);
    const lowerOpen = !!bounds.lowerOpen, upperOpen = !!bounds.upperOpen, forward = bounds.order !== 'Desc';
    let ended = false, last: BlockKey | undefined, pending = Promise.resolve();
    if (bounds.order !== undefined && bounds.order !== 'Asc' && bounds.order !== 'Desc') bad('invalid order');
    if (lower && upper && (compareKeys(lower, upper) > 0 || compareKeys(lower, upper) === 0 && (lowerOpen || upperOpen))) ended = true;
    const pull = async (): Promise<IteratorResult<OrderedEntry<V>>> => {
      if (ended) return { done: true, value: undefined };
      await this.state.writing;
      const root = await this.root(); if (!root) { ended = true; return { done: true, value: undefined }; }
      const boundary = last ?? (forward ? lower : upper), open = last !== undefined || (forward ? lowerOpen : upperOpen);
      let leaf: Leaf | null = boundary ? await this.locate(boundary, root) : await this.leaf(forward ? null : root.tail, root);
      while (leaf) {
        let at = boundary ? search(leaf.entries, boundary, forward ? open : !open) : forward ? 0 : leaf.entries.length;
        if (!forward) at--;
        const entry = leaf.entries[at];
        if (entry) {
          if (lower && (compareKeys(entry.key, lower) < 0 || lowerOpen && compareKeys(entry.key, lower) === 0)
            || upper && (compareKeys(entry.key, upper) > 0 || upperOpen && compareKeys(entry.key, upper) === 0)) break;
          last = entry.key; return { done: false, value: { key: nativeKey(entry.key), value: readValue(entry.value) as V } };
        }
        leaf = await this.adjacent(leaf, forward, root);
      }
      ended = true; return { done: true, value: undefined };
    };
    return {
      [Symbol.asyncIterator]() { return this; },
      next: () => { const result = pending.then(pull); pending = result.then(() => undefined, () => undefined); return result; },
      return: async () => { ended = true; await pending; return { done: true, value: undefined }; },
    };
  }
  apply(changes: readonly OrderedChange<V>[]): Promise<void> {
    // Admit the entire batch before any await. Shared key subgraphs are copied
    // once in this call; no mutable caller object enters the transaction cache.
    const memo = new WeakMap<object, BlockKey>();
    const admitted: Change[] = changes.map((change, ordinal) => {
      if (change.kind !== 'put' && change.kind !== 'delete') bad('invalid change');
      return { key: ownKey(change.key, memo), value: change.kind === 'put' ? ownValue(change.value) : undefined, ordinal };
    });
    admitted.sort((a, b) => compareKeys(a.key, b.key) || a.ordinal - b.ordinal);
    const unique: Change[] = [];
    for (const change of admitted) {
      if (unique.length && compareKeys(unique[unique.length - 1]!.key, change.key) === 0) unique[unique.length - 1] = change;
      else unique.push(change);
    }
    const run = async () => { if (unique.length) await this.write(unique); };
    const writing = this.state.writing ? this.state.writing.then(run) : run();
    this.state.writing = writing;
    void writing.catch(() => undefined);
    return writing;
  }
  private async write(changes: Change[]): Promise<void> {
    let root = await this.root();
    const fresh = root === null;
    root ??= { tail: null, count: 0, leaves: 1, revision: 0 };
    const work = new Map<string, { leaf: Leaf; entries: Entry[] }>();
    const affected = new Map<string, { leaf: Leaf; changes: Change[] }>();
    const empty = packLeaf(null, null, false, []);
    let located: Leaf | undefined;
    for (const change of changes) {
      const leaf: Leaf = fresh ? empty : located && (!located.upper || compareKeys(change.key, located.upper) < 0) ? located : await this.locate(change.key, root);
      located = leaf;
      const key = id(leaf.lower);
      let group = affected.get(key); if (!group) { group = { leaf, changes: [] }; affected.set(key, group); }
      group.changes.push(change);
    }
    let difference = 0;
    for (const { leaf, changes: edits } of affected.values()) {
      const entries: Entry[] = []; let at = 0;
      for (const change of edits) {
        while (at < leaf.entries.length && compareKeys(leaf.entries[at]!.key, change.key) < 0) entries.push(leaf.entries[at++]!);
        if (at < leaf.entries.length && compareKeys(leaf.entries[at]!.key, change.key) === 0) at++;
        if (change.value !== undefined) entries.push({ key: change.key, value: change.value });
      }
      entries.push(...leaf.entries.slice(at)); difference += entries.length - leaf.entries.length;
      work.set(id(leaf.lower), { leaf, entries });
    }
    if (!fresh) for (const { leaf } of affected.values()) for (const forward of [false, true]) {
      const neighbor = await this.adjacent(leaf, forward, root);
      if (neighbor && !work.has(id(neighbor.lower))) work.set(id(neighbor.lower), { leaf: neighbor, entries: neighbor.entries });
    }
    const sorted = [...work.values()].sort((a, b) => lowerCompare(a.leaf.lower, b.leaf.lower));
    const segments: typeof sorted[] = [];
    for (const item of sorted) {
      const segment = segments[segments.length - 1], previous = segment?.[segment.length - 1];
      if (previous && same(previous.leaf.upper, item.leaf.lower)) {
        if (item.leaf.previous === false || !same(item.leaf.previous, previous.leaf.lower)) bad('broken rewrite fences');
        segment!.push(item);
      } else segments.push([item]);
    }
    const removed: Leaf[] = [], replacements = new Map<string, Leaf>();
    const links: { lower: BlockKey; previous: BlockKey | null; oldPrevious: BlockKey | null }[] = [];
    const nextRoot = { ...root, count: root.count + difference, revision: root.revision + 1 };
    for (const segment of segments) {
      const first = segment[0]!.leaf, last = segment[segment.length - 1]!.leaf, entries = segment.flatMap(item => item.entries);
      const leaves = this.partition(first.lower, last.upper, first.previous, entries);
      if (!leaves.length) bad('empty non-root rewrite');
      removed.push(...segment.map(item => item.leaf));
      for (const leaf of leaves) replacements.set(id(leaf.lower), leaf);
      nextRoot.leaves += leaves.length - segment.length;
      const end = leaves[leaves.length - 1]!;
      if (last.upper === null) nextRoot.tail = end.lower;
      else links.push({ lower: last.upper, previous: end.lower, oldPrevious: last.lower });
    }
    // A very large new fence can enlarge its successor's header. Repartition
    // that leaf as well, propagating only when its final lower fence changes.
    for (let at = 0; at < links.length; at++) {
      const link = links[at]!, planned = replacements.get(id(link.lower)), successor = planned ?? await this.leaf(link.lower, root);
      if (successor.previous === false || !same(successor.previous, link.oldPrevious)) bad('broken successor fence');
      if (same(successor.previous, link.previous)) continue;
      const leaves = this.partition(successor.lower, successor.upper, link.previous, successor.entries);
      for (const leaf of leaves) replacements.set(id(leaf.lower), leaf);
      nextRoot.leaves += leaves.length - 1;
      const end = leaves[leaves.length - 1]!;
      if (successor.upper === null) nextRoot.tail = end.lower;
      else if (!same(end.lower, successor.lower)) links.push({ lower: successor.upper, previous: end.lower, oldPrevious: successor.lower });
    }
    if (!integer(nextRoot.count, 0) || !integer(nextRoot.leaves, 1) || !integer(nextRoot.revision, 0)) bad('anchor arithmetic overflow');
    try {
      const store = this.objectStore(), requests: Promise<unknown>[] = [];
      for (const leaf of removed) if (!replacements.has(id(leaf.lower))) requests.push(request(store.delete(this.physical(leaf.lower))));
      for (const leaf of replacements.values()) requests.push(request(store.put(leaf.packed, this.physical(leaf.lower))));
      requests.push(request(store.put(packRoot(nextRoot), [this.namespace])));
      await Promise.all(requests);
      this.state.root = nextRoot; this.state.cache.clear(); this.state.bytes = 0;
      for (const leaf of replacements.values()) this.retain(leaf);
    } catch (error) {
      this.state.failed = true; this.state.cache.clear(); this.state.bytes = 0;
      try { this.tx.abort(); } catch { /* The request may already have aborted it. */ }
      throw error;
    }
  }
  private partition(lower: BlockKey | null, upper: BlockKey | null, previous: BlockKey | null | false, entries: Entry[]): Leaf[] {
    if (!entries.length) return lower === null && upper === null ? [packLeaf(null, null, false, [])] : [];
    const chunks: Entry[][] = []; let chunk: Entry[] = [], bytes = 2, prior = '';
    for (const entry of entries) {
      let prefix = 0; while (prefix < Math.min(prior.length, entry.key.text.length) && prior.charCodeAt(prefix) === entry.key.text.charCodeAt(prefix)) prefix++;
      let size = utf8.encode(JSON.stringify([prefix, entry.key.text.slice(prefix), entry.value])).length + 1;
      if (chunk.length && (chunk.length === MAX_ENTRIES || bytes + size > TARGET_BYTES)) {
        chunks.push(chunk); chunk = []; bytes = 2; prior = ''; size = utf8.encode(JSON.stringify([0, entry.key.text, entry.value])).length + 1;
      }
      chunk.push(entry); bytes += size; prior = entry.key.text;
    }
    if (chunk.length) chunks.push(chunk);
    // Headers contain real keys too. Split further if their encoded size makes
    // a multi-entry block exceed the target; one legal entry is never refused.
    for (let i = 0; i < chunks.length; i++) {
      const part = chunks[i]!, lo = i === 0 ? lower : part[0]!.key, hi = i + 1 === chunks.length ? upper : chunks[i + 1]![0]!.key;
      const prev = i === 0 ? previous : i === 1 ? lower : chunks[i - 1]![0]!.key;
      if (part.length > 1 && utf8.encode(packLeaf(lo, hi, prev, part).packed).length > TARGET_BYTES) {
        const middle = Math.ceil(part.length / 2); chunks.splice(i, 1, part.slice(0, middle), part.slice(middle)); i = Math.max(-1, i - 2);
      }
    }
    return chunks.map((part, i) => packLeaf(i === 0 ? lower : part[0]!.key, i + 1 === chunks.length ? upper : chunks[i + 1]![0]!.key,
      i === 0 ? previous : i === 1 ? lower : chunks[i - 1]![0]!.key, part));
  }
}

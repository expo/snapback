import { RangeReceipt } from '../../../evaluator/src/range-preparation.js';
import { RowImage, ImageKeys } from '../../../evaluator/src/row-image.js';
// @ref LLP 1012#indexed-held-search — mutate a bounded record journal under the carrier's serial transaction.
// Root dictionaries are not cloned. Nested records copy on write, so published rows/receipts stay immutable.
const proxies = new WeakMap<object, () => any>();
const traversable = (value: unknown): value is any[] | Record<string, any> =>
  !!value && typeof value === 'object' && !RowImage.is(value) && !ImageKeys.is(value) && !RangeReceipt.is(value);
export function raw<T>(value: T): T {
  if (!traversable(value)) return value;
  const unwrap = proxies.get(value); if (unwrap) return unwrap();
  let result: any = value;
  for (const [key, child] of Object.entries(value)) {
    const next = raw(child);
    if (next !== child) { if (result === value) result = Array.isArray(value) ? value.slice() : { ...value }; result[key] = next; }
  }
  return result;
}
/** Generic sources retain no mutable aliases; nominal immutable leaves keep their ownership. */
export function isolate<T>(value: T): T {
  if (!traversable(value)) return value;
  return (Array.isArray(value) ? value.map(isolate) : Object.fromEntries(Object.entries(value).map(([key, child]) => [key,isolate(child)]))) as T;
}
export type ChangedRecords = Map<string, Set<string>>;
export class SwapJournal<T extends object> {
  readonly changed: ChangedRecords = new Map();
  readonly draft: T;
  private undo: Array<() => void> = [];
  private saved = new WeakMap<object, Set<PropertyKey>>();
  constructor(readonly state: T) { this.draft = this.wrap(state, [], undefined); }
  private wrap(value: any, path: string[], parent?: (next: any) => void): any {
    if (!traversable(value)) return value;
    let current: any = value, copied = false;
    const children = new Map<PropertyKey, { value: any; proxy: any }>();
    const write = (key: PropertyKey, next: any, remove = false): void => {
      if (path.length >= 2 && !copied) {
        current = Array.isArray(current) ? current.slice() : { ...current };
        copied = true; parent!(current);
      }
      if (path.length < 2) {
        const keys = this.saved.get(current) ?? new Set<PropertyKey>(); this.saved.set(current, keys);
        if (!keys.has(key)) {
          keys.add(key); const before = current[key], existed = Object.hasOwn(current, key);
          const target = current;
          this.undo.push(() => { if (existed) target[key] = before; else delete target[key]; });
        }
        const category = path[0] ?? '*', records = this.changed.get(category) ?? new Set<string>();
        records.add(String(key)); this.changed.set(category, records);
      }
      if (remove) delete current[key]; else current[key] = raw(next);
      children.delete(key);
    };
    const proxy = new Proxy(Array.isArray(value) ? [] : {}, {
      get: (_, key) => {
        const next = current[key];
        if (!next || typeof next !== 'object') return next;
        const old = children.get(key); if (old && old.value === next) return old.proxy;
        const child = this.wrap(next, [...path, String(key)], v => write(key, v));
        children.set(key, { value: next, proxy: child }); return child;
      },
      set: (_, key, next) => { write(key, next); return true; },
      deleteProperty: (_, key) => { write(key, undefined, true); return true; },
      has: (_, key) => key in current,
      ownKeys: () => Reflect.ownKeys(current),
      getOwnPropertyDescriptor: (_, key) => {
        const d = Object.getOwnPropertyDescriptor(current, key);
        return d && { ...d, configurable: !(Array.isArray(current) && key === 'length'), writable: true };
      },
    });
    proxies.set(proxy, () => current); return proxy;
  }
  rollback(): void { for (let i = this.undo.length - 1; i >= 0; i--) this.undo[i](); }
}

export interface StoreRevision { incarnation: string; revision: number }
export interface StoreChange<S> extends StoreRevision {
  /** Present only on cold open, a reset or a missed revision. */
  snapshot?: S;
  records?: Record<string, Record<string, unknown>>;
  removed?: Record<string, string[]>;
}
/** A bounded revision journal keeps keys only: a purge cannot leave row bodies in an older delta. */
export class StoreChanges<S extends object> {
  private revision = 0;
  private incarnation = '';
  private history: { revision: number; keys: ChangedRecords; size: number }[] = [];
  private size = 0;
  private pending: ChangedRecords = new Map();
  dirty(category: string, keys: Iterable<string>): void {
    const held = this.pending.get(category) ?? new Set(); this.pending.set(category, held);
    for (const key of keys) held.add(key);
  }
  prepare(changed: ChangedRecords): void {
    for (const [category, keys] of this.pending) {
      const held = changed.get(category) ?? new Set(); changed.set(category, held);
      for (const key of keys) held.add(key);
    }
  }
  reset(current?: S, previous?: S): void {
    this.incarnation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++incarnations}`;
    this.revision = 0; this.history = []; this.size = 0; this.pending.clear();
    if (current && previous) for (const [key, value] of Object.entries<any>((current as any).answers ?? {}))
      if (value.fingerprint !== (previous as any).answers?.[key]?.fingerprint) this.dirty('answers', [key]);
  }
  publish(_state: S, changed: ChangedRecords): void {
    this.pending.clear();
    const keys: ChangedRecords = new Map(); let size = 0;
    for (const [category, entries] of changed) {
      keys.set(category, new Set(entries));
      for (const key of entries) size += key.length + category.length + 64;
    }
    this.history.push({ revision: ++this.revision, keys, size }); this.size += size;
    while (this.history.length > 32 || this.size > 262144) this.size -= this.history.shift()!.size;
  }
  read(state: S, since?: StoreRevision): StoreChange<S> {
    const base = { incarnation: this.incarnation, revision: this.revision };
    if (since?.incarnation === this.incarnation && Number.isSafeInteger(since.revision) && since.revision <= this.revision) {
      if (since.revision === this.revision) return base;
      if (since.revision >= (this.history[0]?.revision ?? this.revision + 1) - 1) {
        const keys: ChangedRecords = new Map();
        for (const h of this.history) if (h.revision > since.revision) for (const [category, entries] of h.keys) {
          const set = keys.get(category) ?? new Set<string>(); keys.set(category, set);
          for (const key of entries) set.add(key);
        }
        const records: Record<string, Record<string, unknown>> = {}, removed: Record<string, string[]> = {};
        for (const [category, entries] of keys) {
          const container = category === '*' ? state : (state as any)[category];
          records[category] = {}; removed[category] = [];
          for (const key of entries) {
            if (container && Object.hasOwn(container, key)) records[category][key] = container[key];
            else removed[category].push(key);
          }
        }
        return { ...base, records, removed };
      }
    }
    // Freeze/copy happens once in the twin's snapshot adapter, never in warm reads.
    return { ...base, snapshot: Object.fromEntries(Object.entries(state).map(([key, value]) => [key,
      value && typeof value === 'object' ? Array.isArray(value) ? value.slice() : { ...value } : value,
    ])) as S };
  }
}
let incarnations = 0;

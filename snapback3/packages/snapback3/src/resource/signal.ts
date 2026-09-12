import { SnapbackError } from './types.js';

export class Signal<T> {
  protected value: T;
  private listeners = new Set<() => void>();
  constructor(value: T, private readonly demand?: (active: boolean) => void) { this.value = Object.freeze(value); }
  getSnapshot = (): T => this.value;
  subscribe = (listener: () => void): (() => void) => {
    const first = this.listeners.size === 0;
    this.listeners.add(listener);
    if (first) this.demand?.(true);
    return () => {
      if (this.listeners.delete(listener) && this.listeners.size === 0) this.demand?.(false);
    };
  };
  set(value: T, notify = true): void {
    this.value = Object.freeze(value);
    if (notify) this.notify();
  }
  notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // An operation may be rendered without awaiting it. Preserve rejection for
  // explicit awaiters without producing an unhandled-rejection side effect.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

export function errorOf(error: unknown, fallback = 'S3_CLIENT'): SnapbackError {
  return error instanceof SnapbackError ? error : new SnapbackError(fallback, error instanceof Error ? error.message : String(error));
}

/** Own JSON before it becomes a resource key or an immutable operation payload. */
export function ownJson<T>(value: T): T {
  const seen = new Set<object>();
  const visit = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isSafeInteger(item) && !Object.is(item, -0)) return item;
    if (!item || typeof item !== 'object' || seen.has(item)) throw new SnapbackError('S3_ARGS', 'Arguments must be acyclic JSON with safe integers.');
    seen.add(item);
    try {
      if (Array.isArray(item)) return Object.freeze(item.map(visit));
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new SnapbackError('S3_ARGS', 'Arguments must contain plain JSON objects.');
      return Object.freeze(Object.fromEntries(Object.keys(item).sort()
        .filter(key => (item as any)[key] !== undefined).map(key => [key, visit((item as any)[key])])));
    } finally { seen.delete(item); }
  };
  return visit(value) as T;
}

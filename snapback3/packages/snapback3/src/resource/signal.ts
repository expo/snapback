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
    notifyObservers(this.listeners);
  }
}

/** Observer failures stay visible without changing the state transition that
 * already occurred or preventing later observers from seeing it. */
export function reportObserverError(error: unknown): void {
  let reporter: ((error: unknown) => void) | undefined;
  try { reporter = (globalThis as typeof globalThis & { reportError?: (error: unknown) => void }).reportError; } catch {}
  if (typeof reporter === 'function') {
    try { reporter(error); return; } catch {}
  }
  try { console.error('Snapback observer callback failed.', error); } catch {}
}

export function notifyObservers<Args extends unknown[]>(
  listeners: Iterable<(...args: Args) => void>, ...args: Args
): void {
  for (const listener of [...listeners]) {
    try { listener(...args); } catch (error) { reportObserverError(error); }
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

function copyJson<T>(value: T, freeze: boolean, code: string): T {
  const seen = new Set<object>();
  const visit = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isSafeInteger(item) && !Object.is(item, -0)) return item;
    if (!item || typeof item !== 'object' || seen.has(item))
      throw new SnapbackError(code, 'Values must be acyclic JSON with safe integers.');
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        const result = item.map(visit);
        return freeze ? Object.freeze(result) : result;
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new SnapbackError(code, 'Values must contain plain JSON objects.');
      const result = Object.fromEntries(Object.keys(item).sort()
        .filter(key => (item as any)[key] !== undefined).map(key => [key, visit((item as any)[key])]));
      return freeze ? Object.freeze(result) : result;
    } finally { seen.delete(item); }
  };
  return visit(value) as T;
}

/** Copy protocol/storage JSON without depending on the host's structuredClone. */
export function cloneJson<T>(value: T, code = 'S3_ARGS'): T { return copyJson(value, false, code); }

/** Own JSON before it becomes a resource key or an immutable operation payload. */
export function ownJson<T>(value: T): T { return copyJson(value, true, 'S3_ARGS'); }

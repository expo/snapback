// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client — suspension changes the storage boundary,
// not the program, authority evidence, or the single execution's work accounting.
import { EvalError } from './errors';
import { prepareRange } from './coverage';
import type { SearchExecution } from './search-runtime';
import type { LogicalIndexAtom } from './search-key';
import type { Context, Trace, TraceRange, Value } from './types';

export type Awaitable<T> = T | PromiseLike<T>;
export type QueryWork<T> = Generator<() => Awaitable<unknown>, T, any>;
export interface QueryCursor {
  next(): Awaitable<IteratorResult<Value>>;
  return?(value?: any): Awaitable<IteratorResult<Value>>;
}
export interface QueryDirectory {
  readonly fixed: readonly number[];
  select(values: Value[], limit: number): Awaitable<{ scopes: Value[][]; overflow: boolean; missing: boolean }>;
}

/** One authoritative local snapshot, held for the entire drive. Implementations
 * validate typed keys and return owned rows. Missing rows do not prove absence;
 * readable is the existing delivered-history policy, never a general sync flag.
 * Directory admission and unknown-scope checks retain the held-search contract.
 * No method requires enumerating the row pool or constructing HeldIndex objects. */
export interface QueryHost {
  lookup(table: string, index: string, key: Value[]): Awaitable<Value | null>;
  seek(table: string, index: string, prefix: LogicalIndexAtom[], after: Value | null,
    before: Value | null, range: any, order: 'Asc' | 'Desc'): Awaitable<QueryCursor>;
  readable(table: string): Awaitable<boolean>;
  missingSearchAuthority(table: string, index: string, prefix: LogicalIndexAtom[], context: Context): Awaitable<boolean>;
  heldDirectory(descriptor: any): Awaitable<QueryDirectory | undefined>;
  verdict(rule: string, digest: string, context: Context): Awaitable<boolean | null>;
  hasAbsence(table: string, index: string, key: Value[]): Awaitable<boolean>;
  hasCompleteRange(table: string, index: string, key: Value[]): Awaitable<boolean>;
  rangeStop(range: TraceRange, logical: LogicalIndexAtom[]): Awaitable<TraceRange['stop']>;
  coversRange(range: TraceRange, logical: LogicalIndexAtom[], program?: any, nativeViewer?: string): Awaitable<boolean>;
}

export function* read<T>(operation: () => Awaitable<T>): QueryWork<T> { return yield operation; }

export function* closeCursors(cursors: Iterable<QueryCursor>, failing = false): QueryWork<void> {
  let failure: { error: unknown } | undefined;
  for (const cursor of cursors) if (cursor.return) {
    try { yield* read(() => cursor.return!(undefined)); }
    catch (error) { failure ??= { error }; }
  }
  if (failure && !failing) throw failure.error;
}
const thenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as any).then === 'function';

/** Host failures enter the suspended machine so its finally blocks close cursors. */
export function driveSync<T>(work: QueryWork<T>): T {
  let result = work.next();
  while (!result.done) {
    let value: unknown;
    try {
      value = result.value();
      if (thenable(value)) {
        void Promise.resolve(value).catch(() => undefined);
        throw new EvalError('E_INPUT', 'asynchronous query host requires asynchronous execution');
      }
    } catch (error) { result = work.throw(error); continue; }
    result = work.next(value);
  }
  return result.value;
}

export async function driveAsync<T>(work: QueryWork<T>): Promise<T> {
  let result = work.next();
  while (!result.done) {
    let value: unknown;
    try { value = result.value(); if (thenable(value)) value = await value; }
    catch (error) { result = work.throw(error); continue; }
    result = work.next(value);
  }
  return result.value;
}

/** Completeness is shared with ClientStore; native coverage is query-only and
 * bound to the viewer. It never replaces primary absence or rule authority. */
export function* uncoveredSites(host: QueryHost, schema: any, trace: Trace, misses: string[] = [],
  program?: any, search?: SearchExecution, nativeViewer?: string): QueryWork<string[]> {
  const partial = new Set(misses);
  for (const range of trace.ranges) {
    const logical = prepareRange(schema, range, program, search);
    if (!(yield* read(() => host.coversRange(range, logical, program, nativeViewer)))) partial.add(range.site);
  }
  for (const absent of trace.absences) {
    const { table, index, key } = absent;
    if (!(yield* read(() => host.hasAbsence(table, index, key)))
      && (yield* read(() => host.lookup(table, index, key))) === null) {
      const definition = schema.tables[table];
      if (definition.rules.read !== 'Allow' || !definition.indexes[index].unique
        || !(yield* read(() => host.hasCompleteRange(table, index, key)))) partial.add(absent.site);
    }
  }
  return [...partial].sort();
}

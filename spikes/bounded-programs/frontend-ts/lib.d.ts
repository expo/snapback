interface SymbolConstructor { readonly iterator: unique symbol; }
declare const Symbol: SymbolConstructor;
interface IteratorResult<T> { done?: boolean; value: T; }
interface Iterator<T> { next(): IteratorResult<T>; }
interface Iterable<T> { [Symbol.iterator](): Iterator<T>; }

interface Array<T> extends Iterable<T> {
  readonly length: number;
  [index: number]: T;
  map<U>(callback: (value: T, index: number) => U): U[];
  flatMap<U>(callback: (value: T, index: number) => U[]): U[];
  filter(callback: (value: T, index: number) => boolean): T[];
  reduce<U>(callback: (value: U, item: T) => U, initial: U): U;
  some(callback: (value: T) => boolean): boolean;
  slice(start?: number, end?: number): T[];
  sort(comparator: (a: T, b: T) => number): T[];
  push(value: T): number;
  count(): number;
  countCapped(): { count: number; atCap: boolean };
}

interface ReadonlyArray<T> extends Array<T> {}
interface String {
  readonly length: number;
  split(separator: string): string[];
}
interface Number {}
interface Boolean {}
interface Function {}
interface Object {}
interface RegExp {}
interface IArguments {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}

declare class Map<K, V> {
  constructor(values?: Array<[K, V]>);
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
}
declare class Set<T> {
  constructor(values?: Array<T>);
  add(value: T): this;
  has(value: T): boolean;
}

declare const Math: {
  min(...values: number[]): number;
  max(...values: number[]): number;
  abs(value: number): number;
};

type Row = Record<string, any>;
type Page<T = Row> = Array<T> & { hasMore: boolean };
type Table = { readonly [index: string]: Table };
type Arg = { readonly max?: number; readonly kind?: string };
type Context = {
  db: Db;
  ctx: {
    viewer: any;
    now(): any;
    newId(): any;
    readonly readTime: any;
    readonly commitTime: any;
  };
  args: Record<string, any>;
};
type Db = {
  get(target: Table, key: any): any;
  exists(target: Table, key: any): boolean;
  scan(target: Table, prefix: any, options?: Record<string, any>): Page;
  insert(target: Table, row: Row): any;
  update(target: Table, key: any, patch: Row | ((row: any) => Row)): void;
  upsert(target: Table, key: any, row: Row | ((row: any) => Row)): void;
  delete(target: Table, key: any): void;
  require(condition: any, code?: string): void;
  assert(condition: any): void;
};

declare function table(name: string): Table;
declare function privateTable(name: string): Table;
declare function maintained(name: string, source: Table): Table;
declare function scalar(): Arg;
declare function id(table?: Table): Arg;
declare function text(options?: { max?: number } | number): Arg;
declare function int(): Arg;
declare function time(): Arg;
declare function optional(value: Arg): Arg;
declare function list(value: Arg, options: { max: number }): Arg;
declare function query(args: Record<string, Arg>, handler: (context: Context) => any): any;
declare function mutation(args: Record<string, Arg>, handler: (context: Context) => any): any;
declare function range(start: number, end: number): number[];
declare function mentionTokens(value: string): string[];
declare function deterministicShare(amount: number, recipients: any[], recipient: any): number;
declare function concat(...values: any[]): any;
declare function max(...values: any[]): any;
declare function min(...values: any[]): any;
declare function divmod(value: number, divisor: number): any;
declare function recurse(seed: any, step: (value: any) => any, options: { depth: number; fanout: number }): any[];
declare function publicReason(reason: string): any;

type Record<K extends string | number | symbol, T> = { [P in K]: T };

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
  some(callback: (value: T, index: number) => boolean): boolean;
  slice(start?: number, end?: number): T[];
  sort(comparator: (a: T, b: T) => number): T[];
  push(value: T): number;
  count(): number;
  countCapped(): { count: number; atCap: boolean };
}
interface ReadonlyArray<T> extends Array<T> {}
interface String { readonly length: number; split(separator: string): string[]; }
interface Number {}
interface Boolean {}
interface Function {}
interface Object {}
interface RegExp {}
interface IArguments {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface PromiseLike<T> { then<TResult>(onfulfilled: (value: T) => TResult | PromiseLike<TResult>): PromiseLike<TResult>; }
interface Promise<T> extends PromiseLike<T> {}
declare const Promise: { resolve<T>(value: T): Promise<T> };
declare class Map<K, V> {
  constructor(values?: Array<[K, V]>);
  readonly size: number;
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
}
declare class Set<T> {
  constructor(values?: Array<T>);
  readonly size: number;
  add(value: T): this;
  has(value: T): boolean;
}
declare const Math: {
  min(...values: number[]): number;
  max(...values: number[]): number;
  abs(value: number): number;
  random(): number;
};
declare const JSON: { stringify(value: unknown): string; parse(value: string): unknown };
declare const console: { log(...values: unknown[]): void; error(...values: unknown[]): void };
declare const Date: { now(): number; new(): unknown };
declare class URL { constructor(input: string, base?: string); readonly origin: string; }
declare class TextEncoder { encode(input?: string): unknown; }
declare class TextDecoder { decode(input?: unknown): string; }
declare function btoa(value: string): string;
declare function atob(value: string): string;
declare function setTimeout(callback: () => void, ms: number): number;
declare function fetch(input: string, init?: unknown): Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;
declare const meta: { readonly id: string; readonly effect?: string; readonly attempt?: number };
declare function eval(source: string): unknown;
declare const crypto: { randomUUID(): string };
declare class Error { constructor(message?: string); readonly message: string; }
type Record<K extends string | number | symbol, T> = { [P in K]: T };
type Exclude<T, U> = T extends U ? never : T;
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type Partial<T> = { [P in keyof T]?: T[P] };
type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;

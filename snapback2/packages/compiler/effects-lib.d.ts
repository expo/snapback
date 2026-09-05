// @ref LLP 1003#1-authoring — ES2020 is supplied by TypeScript; these are the actual Ibex/prelude tools, with no DOM library.
type HeadersInit = Headers | Iterable<readonly [string, string]> | Record<string, string>;
declare class Headers implements Iterable<[string, string]> {
  constructor(init?: HeadersInit);
  append(name: string, value: string): void;
  set(name: string, value: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  delete(name: string): void;
  forEach(callback: (value: string, name: string, headers: Headers) => void, thisArg?: unknown): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
}
// Response is returned by fetch; there is no global Response constructor.
interface Response {
  readonly status: number;
  readonly ok: boolean;
  readonly url: string;
  readonly redirected: boolean;
  readonly headers: Headers;
  readonly bodyUsed: boolean;
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface RequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: string | ArrayBuffer | Uint8Array;
  redirect?: "follow" | "error" | "manual";
}
declare function fetch(input: string | URL, init?: RequestInit): Promise<Response>;
declare const meta: { readonly id: string; readonly effect: string; readonly attempt: number };
declare const console: {
  log(...values: unknown[]): void;
  info(...values: unknown[]): void;
  debug(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
};
declare class TextEncoder {
  constructor();
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor();
  decode(input?: ArrayBuffer | ArrayBufferView): string;
}
declare function btoa(value: string): string;
declare function atob(value: string): string;
// The host arms one timer-delivery permit per pump; no interval or manual timer entry is exposed.
declare function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): number;
declare class URL {
  constructor(input: string | URL, base?: string | URL);
  href: string;
  readonly origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  readonly searchParams: URLSearchParams;
  toString(): string;
  toJSON(): string;
  static canParse(input: string | URL, base?: string | URL): boolean;
  static parse(input: string | URL, base?: string | URL): URL | null;
}
declare class URLSearchParams implements Iterable<[string, string]> {
  constructor(init?: string | URLSearchParams | Iterable<readonly [string, string]> | Record<string, string>);
  readonly size: number;
  append(name: string, value: string): void;
  delete(name: string, value?: string): void;
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string, value?: string): boolean;
  set(name: string, value: string): void;
  sort(): void;
  forEach(callback: (value: string, name: string, params: URLSearchParams) => void, thisArg?: unknown): void;
  entries(): IterableIterator<[string, string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[string, string]>;
  toString(): string;
}

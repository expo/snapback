declare module "snapback2" {
  export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  export type Bytes = { readonly Bytes: string };
  export type SeedValue = null | boolean | number | string | Bytes | SeedValue[] | { [key: string]: SeedValue };
  export type Decimal<S extends number> = number & {
    readonly __decimalScale: S;
    readonly __decimalBrand: unique symbol;
  };
  export type Money<C extends string, S extends number = 2> = Decimal<S> & {
    readonly __moneyCurrency: C;
    readonly __moneyBrand: unique symbol;
  };
  export type Column<T = unknown, Optional extends boolean = false> = {
    readonly __value: T;
    readonly __optional: Optional;
    readonly __column: unique symbol;
  };
  export type Arg<T = unknown, Optional extends boolean = false> = Column<T, Optional>;
  export type RowOfColumns<C extends Record<string, Column<any, any>>> =
    { id: string }
    & { [K in keyof C as C[K] extends Column<any, true> ? never : K]: C[K] extends Column<infer T, any> ? T : never }
    & { [K in keyof C as C[K] extends Column<any, true> ? K : never]?: C[K] extends Column<infer T, any> ? T : never };
  export type Table<Row extends Record<string, any> = Record<string, any>> = {
    readonly __row: Row;
    readonly __table: unique symbol;
  } & { readonly [index: string]: TableIndex<Row> };
  export type TableIndex<Row extends Record<string, any> = Record<string, any>> = {
    readonly __row: Row;
    readonly __index: unique symbol;
  };
  export type Rule = { readonly __rule: unique symbol };
  export type RuleTerm = { readonly __term: unique symbol };
  export type Channel<A = unknown> = { readonly __args: A; readonly __channel: unique symbol };
  export type Operation<Args, Result, Kind extends "query" | "mutation"> = {
    readonly __args: Args;
    readonly __result: Result;
    readonly __kind: Kind;
  };
  export type Effect<Payload = Json, Result = Json> = {
    readonly __payload: Payload;
    readonly __result: Result;
    readonly __effect: unique symbol;
  };

  export type ArgsOf<A extends Record<string, Arg<any, any>>> =
    { [K in keyof A as A[K] extends Arg<any, true> ? never : K]: A[K] extends Arg<infer T, any> ? T : never }
    & { [K in keyof A as A[K] extends Arg<any, true> ? K : never]?: A[K] extends Arg<infer T, any> ? T : never };
  export type Page<T> = Array<T> & { hasMore: boolean };
  export type WriteValue<T> = T extends Decimal<any> ? number : T extends string ? string : T extends Array<infer U> ? WriteValue<U>[] : T;
  export type WriteRow<R extends Record<string, any>> = { [K in keyof R]: WriteValue<R[K]> };
  export type Db = {
    get<R extends Record<string, any>>(target: Table<R> | TableIndex<R>, key: unknown): R | null;
    exists(target: Table<any> | TableIndex<any>, key: unknown): boolean;
    scan<R extends Record<string, any>>(target: Table<R> | TableIndex<R>, prefix: unknown, options?: Record<string, any>): Page<R>;
    insert<R extends Record<string, any>>(target: Table<R>, row: WriteRow<R>): R;
    update<R extends Record<string, any>>(target: Table<R>, key: unknown, patch: Partial<Omit<WriteRow<R>, "id">> | ((row: R) => Partial<Omit<WriteRow<R>, "id">>)): void;
    upsert<R extends Record<string, any>>(target: Table<R>, key: unknown, row: WriteRow<R> | ((row: R | null) => WriteRow<R>)): void;
    delete(target: Table<any>, key: unknown): void;
    require(condition: unknown, code?: string): void;
    assert(condition: unknown): void;
  };
  export type Context<A extends Record<string, any> = Record<string, any>> = {
    db: Db;
    ctx: { viewer: string; now(): number; newId(): string; readonly readTime: number; readonly commitTime: number; [name: string]: any };
    args: A;
  };

  export function schema<const S extends Record<string, unknown>>(value: S): { readonly __schema: S };
  export function table<const C extends Record<string, Column<any, any>>>(value: {
    columns: C;
    indexes?: Record<string, { columns: ReadonlyArray<keyof C | "id">; unique?: boolean }>;
    rules?: Partial<Record<"read" | "insert" | "update" | "delete", Rule>>;
    constraints?: ReadonlyArray<unknown>;
  }): Table<RowOfColumns<C>>;
  export const t: {
    id(): Column<string>;
    text(max: number): Column<string>;
    bytes(max: number): Column<Bytes>;
    int(): Column<number>;
    bool(): Column<boolean>;
    time(): Column<number>;
    enum<const V extends readonly [string, ...string[]]>(variants: V): Column<V[number]>;
    /** `t.decimal(scale)` declares a Decimal column; numeric literals assigned to it are whole units and are scaled by 10^scale. */
    decimal<const S extends number>(scale: S): Column<Decimal<S>>;
    /** `t.money(currency, scale)` declares a Money column; numeric literals assigned to it are whole units and are scaled by 10^scale. */
    money<const C extends string>(currency: C): Column<Money<C, 2>>;
    money<const C extends string, const S extends number>(currency: C, scale: S): Column<Money<C, S>>;
    ref<R extends Record<string, any>>(target: Table<R>): Column<string>;
    json<T extends Json = Json>(maxBytes: number): Column<T>;
    optional<T>(value: Column<T, any>): Column<T, true>;
    list<T>(value: Column<T, any>, options: { max: number }): Column<T[]>;
  };
  export const rule: {
    public(reason: string): Rule;
    allow(): Rule;
    deny(): Rule;
    eq(a: RuleTerm, b: RuleTerm): Rule;
    ne(a: RuleTerm, b: RuleTerm): Rule;
    and(...rules: Rule[]): Rule;
    or(...rules: Rule[]): Rule;
    not(value: Rule): Rule;
    exists(table: Table<any>, index: string, key: RuleTerm[]): Rule;
    system(): Rule;
    viewerIs(field: string): Rule;
    field(name: string): RuleTerm;
    readonly viewer: RuleTerm;
    literal(value: Json): RuleTerm;
  };
  export function channel<A extends Record<string, Arg<any, any>>>(value: {
    args: A;
    publish: Rule;
    subscribe: Rule;
    ttlMs: number;
  }): Channel<ArgsOf<A>>;
  export function query<A extends Record<string, Arg<any, any>>, R>(
    args: A,
    handler: (context: Context<ArgsOf<A>>) => R,
  ): Operation<ArgsOf<A>, R, "query">;
  export function mutation<A extends Record<string, Arg<any, any>>, R>(
    args: A,
    handler: (context: Context<ArgsOf<A>>) => R,
  ): Operation<ArgsOf<A>, R, "mutation">;
  export function effect<P extends Json, R extends Json>(value: {
    grants: string[];
    run: (payload: P, tools: { fetch: typeof fetch; meta: { id: string } }) => R | Promise<R>;
    then?: Operation<{ outboxId: string; effect: string; result: Awaited<R> }, unknown, "mutation">;
  }): Effect<P, Awaited<R>>;
  export function emit<P extends Json>(target: Effect<P, any>, payload: P): void;
  export function seed<const S extends { personas: string[]; rows: Record<string, SeedValue[]> }>(value: S): S;

  export function range(start: number, end: number): number[];
  /** `decimal(value, scale)` converts a value in whole units to the exact integer minor-unit wire value; for example, `decimal(2, 2)` is 200. */
  export function decimal<const S extends number>(value: number, scale: S): Decimal<S>;
  export function mentionTokens(value: string): string[];
  export function deterministicShare(amount: number, recipients: unknown[], recipient: unknown): number;
  export function concat(...values: unknown[]): string;
  export function max<const S extends number>(...values: Decimal<S>[]): Decimal<S>;
  export function max(...values: number[]): number;
  export function min<const S extends number>(...values: Decimal<S>[]): Decimal<S>;
  export function min(...values: number[]): number;
  export function divmod(value: number, divisor: number): { quotient: number; remainder: number };
  export function recurse<T>(seed: unknown, step: (value: any) => T | null, options: { depth: number; fanout: number }): T[];
}

declare module "snapback2" {
  export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  /** Server-minted authority subject; deliberately distinct from application row IDs. */
  export type Principal = string & { readonly __snapbackPrincipal: "Principal" };
  export type Cursor = string & { readonly __snapbackCursor: "Cursor" };
  export type Bytes = { readonly Bytes: string };
  // @ref LLP 1006#1-the-move — the phantom kind keeps the two closed asset records nominal without adding JSON bytes.
  export type ImageAsset = { readonly __asset: "image"; readonly id: string; readonly width: number; readonly height: number };
  export type VideoAsset = { readonly __asset: "video"; readonly id: string; readonly width: number; readonly height: number; readonly duration: number };
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
  export type Page<T> = Array<T>;
  export type IndexableScalar = string | number | boolean | null | Bytes | Json;
  export type WriteValue<T> = T extends Principal ? Principal : T extends Decimal<any> ? number : T extends string ? string : T extends Array<infer U> ? WriteValue<U>[] : T;
  export type WriteRow<R extends Record<string, any>> = {
    [K in keyof R]: WriteValue<R[K]> | (undefined extends R[K] ? null : never)
  };
  // @ref LLP 1001#1-store-storers — an update patch cannot rewrite the implicit storage identity.
  export type WritePatch<R extends Record<string, any>> =
    { [K in Exclude<keyof R, "id">]?: WriteValue<R[K]> | (undefined extends R[K] ? null : never) } & { readonly id?: never };
  export type Db = {
    get<R extends Record<string, any>>(target: Table<R> | TableIndex<R>, key: unknown): R | null;
    exists(target: Table<any> | TableIndex<any>, key: unknown): boolean;
    scan<R extends Record<string, any>>(target: Table<R> | TableIndex<R>, prefix: unknown, options?: {
      order?: "asc" | "desc";
      take?: number;
      /** Full post-prefix ordering tuple; scalar sugar needs one remaining column, the prefix may not name every column, and the index ends in id or is unique. Components are indexable scalars matching their column kinds; null is a universal pre-first sentinel. */
      after?: readonly unknown[] | IndexableScalar;
      /** Full post-prefix ordering tuple; scalar sugar needs one remaining column, the prefix may not name every column, and the index ends in id or is unique. Components are indexable scalars matching their column kinds; null is a universal pre-first sentinel. */
      before?: readonly unknown[] | IndexableScalar;
      range?: { gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown };
      /** Internal Quarry lowering tag; not an authored TypeScript surface. */
      mergeSite?: string;
      /** Internal Quarry lowering tag; not an authored TypeScript surface. */
      opaqueCursor?: boolean;
    }): Page<R>;
    insert<R extends Record<string, any>>(target: Table<R>, row: WriteRow<R>): R;
    update<R extends Record<string, any>>(target: Table<R>, key: unknown, patch: WritePatch<R> | ((row: R) => WritePatch<R>)): void;
    upsert<R extends Record<string, any>>(target: Table<R>, key: unknown, row: WriteRow<R> | ((row: R | null) => WriteRow<R>)): void;
    delete(target: Table<any>, key: unknown): void;
    require(condition: unknown, code?: string): void;
    assert(condition: unknown): void;
  };
  export type Context<A extends Record<string, any> = Record<string, any>> = {
    db: Db;
    ctx: { viewer: Principal; now(): number; newId(): string; readonly readTime: number; readonly commitTime: number; [name: string]: any };
    args: A;
  };

  export function schema<const S extends Record<string, unknown>>(value: S): { readonly __schema: S };
  export function table<const C extends Record<string, Column<any, any>>>(value: {
    columns: C;
    /** Client treatment of rows hidden by a fresh authorized answer; Quarry supplies the default. */
    retain?: "until-revoked" | "delivered-history";
    indexes?: Record<string, { columns: ReadonlyArray<keyof C | "id">; unique?: boolean }>;
    rules?: Partial<Record<"read" | "insert" | "update" | "delete", Rule>>;
    constraints?: ReadonlyArray<unknown>;
  }): Table<RowOfColumns<C>>;
  export const t: {
    cursor(): Arg<Cursor>;
    id(): Column<string>;
    principal(): Column<Principal>;
    text(max: number): Column<string>;
    bytes(max: number): Column<Bytes>;
    image(max: number): Column<ImageAsset>;
    video(max: number): Column<VideoAsset>;
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
    created(table: Table<any>, index: string, key: RuleTerm[]): Rule;
    system(): Rule;
    viewerIs(field: string): Rule;
    field(name: string): RuleTerm;
    oldField(name: string): RuleTerm;
    nextField(name: string): RuleTerm;
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
    run: (payload: P, tools: { readonly fetch: typeof fetch; readonly meta: {
      readonly id: string; readonly effect: string; readonly attempt: number;
    } }) => R | Promise<R>;
    then?: Operation<{ outboxId: string; effect: string; result: Awaited<R> }, unknown, "mutation">;
  }): Effect<P, Awaited<R>>;
  export function emit<P extends Json>(target: Effect<P, any>, payload: P): void;
  export function seed<const S extends { personas: string[]; rows: Record<string, SeedValue[]> }>(value: S): S;

  export function range(start: number, end: number): number[];
  /** `decimal(value, scale)` converts a value in whole units to the exact integer minor-unit wire value; for example, `decimal(2, 2)` is 200. */
  export function decimal<const S extends number>(value: number, scale: S): Decimal<S>;
  export function mentionTokens(value: string): string[];
  export function words(value: string): string[];
  /** Euclidean deterministic share: recipients are ordered by the runtime value order; empty, duplicate, or missing recipients refuse. */
  export function deterministicShare<A extends number>(amount: A, recipients: unknown[], recipient: unknown): A extends Decimal<any> ? A : number;
  export function concat(first: unknown, second: unknown, ...values: unknown[]): string;
  export function max<const S extends number>(first: Decimal<S>, second: Decimal<S>, ...values: Decimal<S>[]): Decimal<S>;
  export function max(first: number, second: number, ...values: number[]): number;
  export function min<const S extends number>(first: Decimal<S>, second: Decimal<S>, ...values: Decimal<S>[]): Decimal<S>;
  export function min(first: number, second: number, ...values: number[]): number;
  /** Euclidean quotient and remainder; a zero divisor refuses with `E_DIV_ZERO`. */
  export function divmod<A extends number>(value: A, divisor: number): { quotient: A extends Decimal<any> ? A : number; remainder: A extends Decimal<any> ? A : number };
  /** Internal Quarry lowering helper for a bounded multi-prefix merge. */
  export function mergeByIndex<T>(values: T[], fields: string[], order: "asc" | "desc", take: number, site: string, table: string): Page<T>;
  export function recurse<T>(seed: unknown, step: (value: any) => T | null, options: { depth: number; fanout: number }): T[];
}

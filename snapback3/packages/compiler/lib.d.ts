declare module "snapback3" {
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
  export type Page<T> = Array<T>;
  export type Table<Row extends Record<string, any> = Record<string, any>> = {
    readonly __row: Row;
    readonly __table: unique symbol;
  };
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

  // @ref LLP 1003#1-authoring — TypeScript backend modules declare effects; their then target is a bound Quarry mutation.
  export function effect<P extends Json, R extends Json>(value: {
    grants: string[];
    run: (payload: P, tools: { readonly fetch: typeof fetch; readonly meta: {
      readonly id: string; readonly effect: string; readonly attempt: number;
    } }) => R | Promise<R>;
    then?: Operation<{ outboxId: string; effect: string; result: Awaited<R> }, unknown, "mutation">;
  }): Effect<P, Awaited<R>>;
  export function seed<const S extends { personas: string[]; rows: Record<string, SeedValue[]> }>(value: S): S;

  /** Convert a client value in whole units to the exact integer minor-unit wire value. */
  export function decimal<const S extends number>(value: number, scale: S): Decimal<S>;
}

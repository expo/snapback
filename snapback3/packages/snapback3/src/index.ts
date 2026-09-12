export type { Op, Channel, Api, ArgsOf, ResultOf } from "./api.js";

/** Server-minted authority subject, distinct from application row identifiers. */
export type Principal = string & { readonly __snapbackPrincipal: "Principal" };
export type Cursor = string & { readonly __snapbackCursor: "Cursor" };
export type Bytes = { readonly Bytes: string };
export type ImageAsset = { readonly __asset: "image"; readonly id: string; readonly width: number; readonly height: number };
export type VideoAsset = { readonly __asset: "video"; readonly id: string; readonly width: number; readonly height: number; readonly duration: number };
export type Decimal<S extends number> = number & {
  readonly __decimalScale: S;
  readonly __decimalBrand: unique symbol;
};
export type Money<C extends string, S extends number = 2> = Decimal<S> & {
  readonly __moneyCurrency: C;
  readonly __moneyBrand: unique symbol;
};
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type SeedValue = null | boolean | number | string | Bytes | SeedValue[] | { [key: string]: SeedValue };
export type Page<T> = Array<T>;
export type Table<Row extends Record<string, unknown> = Record<string, unknown>> = {
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

// @ref LLP 2000#6-architectural-starting-points-and-experiments — reuse the
// existing typed Quarry/effects boundary while the data lifecycle is tested.
export function effect<P extends Json, R extends Json>(value: {
  grants: string[];
  run: (payload: P, tools: { readonly fetch: typeof fetch; readonly meta: {
    readonly id: string; readonly effect: string; readonly attempt: number;
  } }) => R | Promise<R>;
  then?: Operation<{ outboxId: string; effect: string; result: Awaited<R> }, unknown, "mutation">;
}): Effect<P, Awaited<R>> {
  return Object.freeze({ kind: "effect", value }) as unknown as Effect<P, Awaited<R>>;
}

/** Seeds are statically checked against the Quarry schema by the compiler. */
export function seed<const S extends { personas: string[]; rows: Record<string, SeedValue[]> }>(value: S): S {
  return value;
}

/** Convert whole units into exact integer minor units: decimal(2, 2) is 200. */
export function decimal<const S extends number>(value: number, scale: S): Decimal<S> {
  if (!Number.isFinite(value) || !Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw new RangeError("decimal(value, scale) requires a finite number and an integer scale from 0 through 12");
  }
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match) throw new RangeError(`decimal cannot encode ${String(value)}`);
  const negative = match[1] === "-";
  const wholeDigits = match[2]!;
  const fractionDigits = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  const digits = `${wholeDigits}${fractionDigits}`;
  const point = wholeDigits.length + exponent;
  const whole = point <= 0 ? "0" : point >= digits.length ? `${digits}${"0".repeat(point - digits.length)}` : digits.slice(0, point);
  const fraction = point <= 0 ? `${"0".repeat(-point)}${digits}` : point >= digits.length ? "" : digits.slice(point);
  if (fraction.length > scale) throw new RangeError(`${String(value)} has ${fraction.length} fractional digits, scale ${scale}`);
  const minor = `${whole}${fraction.padEnd(scale, "0")}`;
  const encoded = Number(negative ? `-${minor}` : minor);
  if (!Number.isSafeInteger(encoded)) throw new RangeError("decimal minor units exceed the safe integer wire range");
  return encoded as Decimal<S>;
}

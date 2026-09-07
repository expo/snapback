type Descriptor = Readonly<Record<string, unknown>>;
export {
  DeliveryEnvelopeDecodeError,
  decodeDeliveryEnvelope,
  decodeDeliveryMessage,
  deliveryRangeExtent,
  encodeDeliveryEnvelope,
  expandRows,
  toClosureReceipt,
} from "./offline-protocol.js";
export { schemaDigest } from "./offline-schema.js";
export type {
  DeliveryAuthority,
  DeliveryEnvelopeV1,
  DeliveryMessage,
  DeliveryRange,
  DeliveryRangeExtent,
  DeliveryReceipt,
  DeliveryRow,
  DeliveryVerdict,
  DeliveryUnchanged,
  WireEscapedObject,
  EvaluatorClosureReceipt,
  WireRowReference,
  WireValue,
} from "./offline-protocol.js";
/** Server-minted authority subject; deliberately distinct from application row IDs. */
export type Principal = string & { readonly __snapbackPrincipal: "Principal" };
export type Cursor = string & { readonly __snapbackCursor: "Cursor" };
export type Bytes = { readonly Bytes: string };
// @ref LLP 1006#1-the-move — the phantom kind keeps the two closed asset records nominal without adding JSON bytes.
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

// @ref LLP 1003#1-authoring — effects and seeds are the retained TypeScript backend declarations.
function inert(kind: string, value: unknown): Descriptor {
  return Object.freeze({ kind, value });
}

export function effect(value: Record<string, unknown>): Descriptor {
  return inert("effect", value);
}

export function seed(value: Record<string, unknown>): Descriptor {
  return inert("seed", value);
}

/** `decimal(value, scale)` converts a value in whole units to the exact integer minor-unit wire value; for example, `decimal(2, 2)` is 200. */
// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — client decimals cross the wire as exactly string-scaled integer minor units.
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
  if (fraction.length > scale) {
    throw new RangeError(`${String(value)} has ${fraction.length} fractional digits, scale ${scale}`);
  }
  const minor = `${whole}${fraction.padEnd(scale, "0")}`;
  const encoded = Number(negative ? `-${minor}` : minor);
  if (!Number.isSafeInteger(encoded)) throw new RangeError("decimal minor units exceed the safe integer wire range");
  return encoded as Decimal<S>;
}

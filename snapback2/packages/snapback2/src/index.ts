type Descriptor = Readonly<Record<string, unknown>>;
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

// @ref LLP 1002#2-the-authored-surface-the-snapback2-module — authoring calls return inert descriptors; handlers are never invoked here.

function inert(kind: string, value?: unknown): Descriptor {
  return Object.freeze(value === undefined ? { kind } : { kind, value });
}

export function schema(value: Record<string, unknown>): Descriptor {
  return inert("schema", value);
}

export function table(value: Record<string, unknown>): Descriptor {
  return inert("table", value);
}

export const t = Object.freeze({
  cursor: () => inert("cursor"),
  id: () => inert("id"),
  principal: () => inert("principal"),
  text: (max: number) => inert("text", { max }),
  bytes: (max: number) => inert("bytes", { max }),
  // @ref LLP 1006#3-authoring-surface — image/video are unconditional lowering descriptors, independent of installed codecs.
  image: (max: number) => inert("image", { max }),
  video: (max: number) => inert("video", { max }),
  int: () => inert("int"),
  bool: () => inert("bool"),
  time: () => inert("time"),
  enum: (variants: readonly string[]) => inert("enum", { variants }),
  /** `t.decimal(scale)` declares a Decimal column; numeric literals assigned to it are whole units and are scaled by 10^scale. */
  decimal: (scale: number) => inert("decimal", { scale }),
  /** `t.money(currency, scale)` declares a Money column; numeric literals assigned to it are whole units and are scaled by 10^scale. */
  money: (currency: string, scale = 2) => inert("money", { currency, scale }),
  ref: (target: unknown) => inert("ref", { target }),
  json: (maxBytes: number) => inert("json", { maxBytes }),
  optional: (value: unknown) => inert("optional", { value }),
  list: (value: unknown, options: { max: number }) => inert("list", { value, ...options }),
});

const viewer = inert("viewer");
export const rule = Object.freeze({
  public: (reason: string) => inert("public", { reason }),
  allow: () => inert("allow"),
  deny: () => inert("deny"),
  eq: (left: unknown, right: unknown) => inert("eq", { left, right }),
  ne: (left: unknown, right: unknown) => inert("ne", { left, right }),
  and: (...rules: unknown[]) => inert("and", rules),
  or: (...rules: unknown[]) => inert("or", rules),
  not: (value: unknown) => inert("not", value),
  exists: (target: unknown, index: string, key: unknown[]) =>
    inert("exists", { target, index, key }),
  created: (target: unknown, index: string, key: unknown[]) =>
    inert("created", { target, index, key }),
  system: () => inert("system"),
  viewerIs: (field: string) => inert("viewerIs", { field }),
  field: (name: string) => inert("field", { name }),
  oldField: (name: string) => inert("oldField", { name }),
  nextField: (name: string) => inert("nextField", { name }),
  viewer,
  literal: (value: unknown) => inert("literal", value),
});

export function channel(value: Record<string, unknown>): Descriptor {
  return inert("channel", value);
}

export function query(args: Record<string, unknown>, handler: unknown): Descriptor {
  return inert("query", { args, handler });
}

export function mutation(args: Record<string, unknown>, handler: unknown): Descriptor {
  return inert("mutation", { args, handler });
}

export function effect(value: Record<string, unknown>): Descriptor {
  return inert("effect", value);
}

export function emit(target: unknown, payload: unknown): Descriptor {
  return inert("emit", { target, payload });
}

export function seed(value: Record<string, unknown>): Descriptor {
  return inert("seed", value);
}

export function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
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

export function mentionTokens(value: string): string[] {
  return value.split(" ").filter((part) => part.startsWith("@"));
}

export function deterministicShare(amount: number, recipients: unknown[], recipient: unknown): number {
  const index = recipients.indexOf(recipient);
  const base = Math.floor(amount / recipients.length);
  return base + (index >= 0 && index < amount % recipients.length ? 1 : 0);
}

export function concat(...values: unknown[]): string {
  return values.join("");
}

export const max = Math.max;
export const min = Math.min;

export function divmod(value: number, divisor: number): { quotient: number; remainder: number } {
  return { quotient: Math.floor(value / divisor), remainder: value % divisor };
}

/** Internal Quarry lowering helper; authored descriptors are never executed. */
export function mergeByIndex<T>(
  _values: T[], _fields: string[], _order: "asc" | "desc", _take: number, _site: string, _table: string,
): T[] {
  throw new Error("snapback2: authored program descriptors are inert");
}

export function recurse(): never {
  throw new Error("snapback2: authored program descriptors are inert");
}

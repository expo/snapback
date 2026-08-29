type Descriptor = Readonly<Record<string, unknown>>;

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
  id: () => inert("id"),
  text: (max: number) => inert("text", { max }),
  int: () => inert("int"),
  bool: () => inert("bool"),
  time: () => inert("time"),
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
  exists: (target: unknown, index: string, key: unknown[], options?: { hidden?: boolean }) =>
    inert("exists", { target, index, key, options }),
  principal: (kind: string) => inert("principal", { kind }),
  viewerIs: (field: string) => inert("viewerIs", { field }),
  field: (name: string) => inert("field", { name }),
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

export function recurse(): never {
  throw new Error("snapback2: authored program descriptors are inert");
}

// @ref LLP 1018.003.000#3-shared-publication — private input custody follows the query value.
import type { ItemInputs } from "./client-items.js";

const frames = new WeakMap<object, ItemInputs>();
export const itemAddress = (table: string, id: string): string => `${table}\0${id}`;
export const emptyItemInputs: ItemInputs = { entries: [], observations: new Map(), predicted: new Map(), values: new Map() };
export function itemInputs(value: unknown): ItemInputs | undefined {
  return value !== null && typeof value === "object" ? frames.get(value) : undefined;
}
export function withItemInputs<T>(value: T, inputs: ItemInputs | undefined): T {
  if (inputs && value !== null && typeof value === "object") frames.set(value, inputs);
  return value;
}
export function carryItemInputs<T>(from: unknown, to: T): T { return withItemInputs(to, itemInputs(from)); }

/** Isolate the public value; captured immutable records are shared across queries. */
export function cloneItemPublication<T>(value: T): T {
  const copy = structuredClone(value), inputs = itemInputs(value);
  return withItemInputs(copy, inputs && rebindItemInputs(inputs, value, copy));
}

/** The reducer may preserve equal data identity; move its new evidence to those equal objects. */
export function rebindItemInputs(inputs: ItemInputs, from: unknown, to: unknown): ItemInputs {
  if (from === to || !inputs.values) return inputs;
  const values = new Map<object, string>();
  const walk = (a: unknown, b: unknown) => {
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return;
    const address = inputs.values!.get(a);
    if (address) { values.set(b, address); return; }
    for (const key of Object.keys(a)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
  };
  walk(from, to);
  return { ...inputs, values };
}

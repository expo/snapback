/** A generated reference carries its path without depending on client state. */
export const referencePath: unique symbol = Symbol.for("snapback3.referencePath");

export interface Op<Args, Result, Targets extends Record<string, "create" | "update" | "remove"> = {}> {
  readonly op: string;
  readonly [referencePath]: string;
  readonly __args?: (args: Args) => void;
  readonly __result?: Result;
  readonly __targets?: Targets;
}

export interface Channel<Args, Value> {
  readonly [referencePath]: string;
  readonly __channelArgs?: (args: Args) => void;
  readonly __value?: Value;
}

/** Extended by the compiler's generated API declarations. */
export interface Api {}
export type ResultOf<Operation> = Operation extends Op<any, infer Result, any> ? Result : never;
export type ArgsOf<Operation> = Operation extends Op<infer Args, any, any> ? Args : never;

const references = new Map<string, object>();
function reference(parts: string[]): object {
  const op = parts.join(".");
  const existing = references.get(op);
  if (existing) return existing;
  const value = new Proxy({ op, [referencePath]: op }, {
    get(_target, property) {
      if (property === referencePath) return op;
      if (property === Symbol.toStringTag) return "SnapbackOperation";
      if (property === "then") return undefined;
      if (property === "op" && parts.length >= 2) return op;
      return typeof property === "string" ? reference([...parts, property]) : undefined;
    },
  });
  references.set(op, value);
  return value;
}

export function referenceName(value: { readonly [referencePath]: string }): string {
  return value[referencePath];
}

// @ref LLP 2000#5-ownership-before-abstraction — the compiler owns operation
// types; references are only inert names supplied to the client runtime.
export const api: Api = reference([]) as Api;

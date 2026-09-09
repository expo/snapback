import { cursorArgument } from "../local-cursor.js";
import type { PersistedRangeState } from "./range-store.js";
import { imageCanonical as canonical } from "../../../evaluator/src/row-image.js";

/** The store's answer and cursor-chain keys retain their shape-preserving encoding. */
export { canonical };

/** One JSON form for warm state and every carrier: omit undefined fields, preserve null. */
export function jsonState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function canonicalAnswerKey(op: string, args: unknown, cursor = "c"): string {
  return `${op}\u0000${canonical(args === undefined ? args : jsonState(queryArgs(args, cursor)))}`;
}

/** A missing first-page cursor and an explicit null name the same observation. */
export function queryArgs<Args>(args: Args, cursor = "c"): Args {
  if (!args || typeof args !== "object" || (args as Record<string, unknown>)[cursor] != null) return args;
  const { [cursor]: _cursor, ...rest } = args as Record<string, unknown>;
  return rest as Args;
}

/** Declared operation arguments spell the first page as null; keys omit it. */
export function operationArgs<Args>(args: Args, cursor?: string): Args {
  return cursor && args && typeof args === "object" && (args as Record<string, unknown>)[cursor] == null
    ? { ...args, [cursor]: null } : args;
}

export function storedAnswerKey(state: PersistedRangeState, op: string, args: unknown): string {
  return canonicalAnswerKey(op, args, cursorArgument(state.programs[state.facts?.generation ?? ""]?.programs[op]));
}

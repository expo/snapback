import { imageCanonical as canonical } from "../../../evaluator/src/row-image.js";

/** The store's answer and cursor-chain keys retain their shape-preserving encoding. */
export { canonical };

/** One JSON form for warm state and every carrier: omit undefined fields, preserve null. */
export function jsonState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function canonicalAnswerKey(op: string, args: unknown): string {
  return `${op}\u0000${canonical(args === undefined ? args : jsonState(queryArgs(args)))}`;
}

/** A missing first-page cursor and an explicit null name the same observation. */
export function queryArgs<Args>(args: Args): Args {
  if (!args || typeof args !== "object" || !("c" in args) || args.c != null) return args;
  const { c: _cursor, ...rest } = args;
  return rest as Args;
}

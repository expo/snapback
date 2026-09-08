import { imageCanonical as canonical } from "../../../evaluator/src/row-image.js";

/** The store's answer and cursor-chain keys retain their shape-preserving encoding. */
export { canonical };

/** One JSON form for warm state and every carrier: omit undefined fields, preserve null. */
export function jsonState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function canonicalAnswerKey(op: string, args: unknown): string {
  return `${op}\u0000${canonical(args === undefined ? args : jsonState(args))}`;
}

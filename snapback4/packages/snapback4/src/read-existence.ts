import type { Ready, ReadyMetadata } from "./contract.ts";
import { copyOnce } from "./read-once.ts";
export { copyOnce };

// @ref LLP 3000.031#1.1 — page absence uses the predicate, not a predecessor's partial word.
// A preceding page can be partial solely because it has a continuation.
// Keep its pending fact separately for page accumulation, never on the wire.
const pendingFacts = new WeakMap<object, boolean>();
export function pendingRead(read: Ready<unknown>): boolean {
  // Custom clients without SDK facts cannot certify a partial page unblocked.
  return pendingFacts.get(read) ?? read.existence === "partial";
}

// @ref LLP 3000.031#1.1 — precedence is present, absent, partial; freshness never demotes.
export function readyExistence(read: ReadyMetadata & { readonly data: unknown }, pending: boolean): "present" | "absent" | "partial" {
  if (read.data !== null && !(Array.isArray(read.data) && read.data.length === 0)) return "present";
  return read.complete && read.cut === null && read.next == null && !pending ? "absent" : "partial";
}

/** Internal publication constructor. No existence field crosses the wire. */
export function readyRead<T>(read: ReadyMetadata & { readonly data: T }, pending = false): Ready<T> {
  const result = { ...read, existence: readyExistence(read, pending) } as Ready<T>;
  pendingFacts.set(result, pending);
  return copyOnce(read, result);
}

import type { Trace } from "./types";

export class EvalError extends Error {
  /** The run's trace up to the failure, attached by the store so a caller can tell an uncovered read from a genuine refusal. */
  trace?: Trace;
  /** The sites the failed run read outside coverage; empty when every read before the failure was covered. */
  partialSites?: string[];

  constructor(readonly code: string, message: string, readonly authoredCode: string | null = null) {
    super(`${code}: ${message}`);
  }
}

export function requireRowIdentity(
  table: string,
  operation: string,
  keyId: string,
  rowId: string,
): void {
  if (keyId !== rowId) {
    throw new EvalError("E_INPUT", `${table} ${operation} key ${keyId} does not match row id ${rowId}`);
  }
}

/** One throwing path preserves EvalError identity and authored refusal details. */
export function fail(code: string, message: string, authoredCode: string | null = null): never {
  throw new EvalError(code, message, authoredCode);
}

export class EvalError extends Error {
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

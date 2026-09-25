// @ref LLP 3000.014#5 — a fallback replaces current pages, preserving delivered history.
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function hasRetainedRows(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((row) => object(row) && row.retained === true);
  return object(value) && Object.values(value).some(hasRetainedRows);
}
export function keepRetainedRows(current: unknown, local: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(local)) {
    return [...current, ...local.filter((row) => object(row) && row.retained === true)];
  }
  if (object(current) && object(local)) {
    return Object.fromEntries(Object.entries(current).map(([field, value]) => [field, keepRetainedRows(value, local[field])]));
  }
  return current;
}

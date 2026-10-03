import type { Read } from "./contract.ts";
import { pendingRead, readyRead } from "./read-existence.ts";

// @ref LLP 3000.023#12 — a conditional table certificate is useful only with
// the evaluator's bare-row proof. Mask state is shared by every retained copy.
type Plan = { table: string; columns: string[]; many: boolean };
type Authority = { plan: Plan; unproven: boolean };
const authority = new WeakMap<object, Authority>();
const masked = new WeakMap<object, Read<unknown>>();
export function withOnce<T>(read: Read<T>, value: unknown, unproven = false): Read<T> {
  if (!value || typeof value !== "object" || !("data" in read)) return read;
  const p = value as Plan;
  const row = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (typeof p.table !== "string" || p.table.length > 120 || typeof p.many !== "boolean"
    || !Array.isArray(p.columns) || !p.columns.length || p.columns.length > 256
    || p.columns.some(c => typeof c !== "string" || c.length > 128)
    || (p.many ? !Array.isArray(read.data) || !read.data.every(row) : read.data !== null && !row(read.data))) return read;
  authority.set(read, { plan: p, unproven });
  return currentOnce(read);
}
export function oncePlan(read: object | undefined): Plan | undefined { return read && authority.get(read)?.plan; }
export function copyOnce<T extends object>(from: object, to: T): T {
  const state = authority.get(from); if (state) authority.set(to, state); return to;
}
export function unproveOnce(read: object): void { const state = authority.get(read); if (state) state.unproven = true; }
export function currentOnce<T>(read: Read<T>): Read<T> {
  const state = authority.get(read);
  if (!state?.unproven || !("data" in read)) return read;
  const cached = masked.get(read); if (cached) return cached as Read<T>;
  const row = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const copy = { ...value } as Record<string, unknown>;
    for (const column of state.plan.columns) if (Object.hasOwn(copy, column)) copy[column] = null;
    return copy;
  };
  const data = state.plan.many && Array.isArray(read.data) ? read.data.map(row) : row(read.data);
  // Preserve the private pending fact as well as public metadata. An empty
  // partial page may be unblocked; losing that fact makes every snapshot read
  // reclassify it and recursively notify its own subscribers.
  const next = copyOnce(read, readyRead({ ...read, data: data as T }, pendingRead(read)));
  masked.set(read, next); masked.set(next, next); return next;
}

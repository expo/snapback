import { deferReadNotifications } from "./read-notifications.ts";
import type { Read } from "./contract.ts";
import { pendingRead, readyRead } from "./read-existence.ts";

// @ref LLP 3000.023#12 — a conditional table certificate is useful only with
// the evaluator's bare-row proof. Mask state is shared by every retained copy.
type Plan = { table: string; columns: string[]; many: boolean };
export class OnceFence {
  readonly consumed = new Set<string>();
  revision = 0;
  consume(id: string): void { this.consumed.add(id); this.revision++; }
}
export function consumeOnce<W extends { snapshot: Read<unknown>; publish(read: Read<unknown>): unknown }>(fence: OnceFence, id: string, watches: Iterable<W>, notify: (watch: W) => void): void {
  fence.consume(id);
  const all = [...watches];
  deferReadNotifications(() => { for (const watch of all) watch.publish(currentOnce(watch.snapshot)); })();
  for (const watch of all) notify(watch);
}
type Authority = { plan?: Plan; unproven: boolean; sensitive: boolean; at: number; fence?: OnceFence };
const withheld: Read<never> = { loading: true };
const authority = new WeakMap<object, Authority>();
const masked = new WeakMap<object, { revision: number; unproven: boolean; read: Read<unknown> }>();
export function withOnce<T>(read: Read<T>, value: unknown, unproven = false, fence?: OnceFence, sensitive = false, at = fence?.revision ?? 0): Read<T> {
  if (fence && "data" in read) authority.set(read, { unproven, fence, sensitive, at });
  if (!value || typeof value !== "object" || !("data" in read)) return read;
  const p = value as Plan;
  const row = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (typeof p.table !== "string" || p.table.length > 120 || typeof p.many !== "boolean"
    || !Array.isArray(p.columns) || !p.columns.length || p.columns.length > 256
    || p.columns.some(c => typeof c !== "string" || c.length > 128)
    || (p.many ? !Array.isArray(read.data) || !read.data.every(row) : read.data !== null && !row(read.data))) return read;
  authority.set(read, { plan: p, unproven, sensitive: true, at, ...(fence ? { fence } : {}) });
  return currentOnce(read);
}
export function oncePlan(read: object | undefined): Plan | undefined { return read && authority.get(read)?.plan; }
export function copyOnce<T extends object>(from: object, to: T): T {
  const state = authority.get(from); if (state) authority.set(to, state); return to;
}
export function unproveOnce(read: object): void { const state = authority.get(read); if (state) state.unproven = true; }
export function currentOnce<T>(read: Read<T>): Read<T> {
  const state = authority.get(read);
  if (!state || !("data" in read) || !state.unproven && !state.fence?.consumed.size) return read;
  const revision = state.fence?.revision ?? 0;
  if (!state.plan && state.sensitive && (state.unproven || state.at !== revision)) return withheld;
  const cached = masked.get(read); if (cached?.revision === revision && cached.unproven === state.unproven) return cached.read as Read<T>;
  const consumed = (value: unknown): boolean => Array.isArray(value) ? value.some(consumed)
    : !!value && typeof value === "object" && "id" in value && typeof value.id === "string" && !!state.fence?.consumed.has(value.id);
  const leaf = (value: unknown): unknown => {
    if (consumed(value) && !Array.isArray(value)) return null;
    if (Array.isArray(value)) return value.map(leaf);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, cell]) => [key, consumed(cell) ? null : leaf(cell)]));
  };
  const row = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const copy = { ...value } as Record<string, unknown>;
    for (const column of state.plan!.columns) if (Object.hasOwn(copy, column)) copy[column] = null;
    return copy;
  };
  const source = leaf(read.data);
  const data = state.unproven && state.plan ? state.plan.many && Array.isArray(source) ? source.map(row) : row(source) : source;
  // Preserve the private pending fact as well as public metadata. An empty
  // partial page may be unblocked; losing that fact makes every snapshot read
  // reclassify it and recursively notify its own subscribers.
  const next = copyOnce(read, readyRead({ ...read, data: data as T }, pendingRead(read)));
  masked.set(read, { revision, unproven: state.unproven, read: next }); masked.set(next, { revision, unproven: state.unproven, read: next }); return next;
}

// @ref LLP 3000.000.000.000#2-served-capabilities — authenticated metadata, never authority to execute.
import type { Refusal } from "./contract.ts";

export interface ServedOperation { readonly kind: string; readonly args: Readonly<Record<string, unknown>> }
export interface ServedRelease {
  readonly generation: number;
  readonly operations: Readonly<Record<string, ServedOperation>>;
  readonly tables: Readonly<Record<string, { readonly fields: Readonly<Record<string, unknown>> }>>;
}
export type ReleaseSnapshot = ServedRelease | { readonly loading: true } | { readonly denied: Refusal };
export interface ReleaseSource {
  getSnapshot(): ReleaseSnapshot;
  subscribe(listener: () => void): () => void;
}
export const releaseLoading: ReleaseSnapshot = Object.freeze({ loading: true });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_, item) => object(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

/** A conservative signature check. A release switch may race it: still handle E_OP/E_INPUT. */
export function operationAvailable(release: ReleaseSnapshot, name: string, kind: string, args: Record<string, unknown>): boolean {
  if (!("generation" in release)) return false;
  const op = release.operations[name];
  return !!op && op.kind === kind && canonical(op.args) === canonical(args);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

function decode(value: unknown): ServedRelease | undefined {
  if (!object(value) || !Number.isSafeInteger(value.generation) || !Array.isArray(value.ops) || !Array.isArray(value.tables)) return;
  const operations: Record<string, ServedOperation> = Object.create(null);
  const tables: Record<string, { fields: Record<string, unknown> }> = Object.create(null);
  for (const op of value.ops) {
    if (!object(op) || typeof op.name !== "string" || typeof op.kind !== "string" || !object(op.args)) return;
    operations[op.name] = freeze({ kind: op.kind, args: op.args });
  }
  for (const table of value.tables) {
    if (!object(table) || typeof table.name !== "string" || !object(table.fields)) return;
    tables[table.name] = freeze({ fields: table.fields });
  }
  return Object.freeze({ generation: value.generation as number, operations: Object.freeze(operations), tables: Object.freeze(tables) });
}

/** Subscriptions keep a small catalog poll alive even when all query gates are closed.
 * Ordinary traffic withdraws the previous snapshot as soon as it observes a newer generation. */
export function servedRelease(options: { url: string; fetch: typeof fetch; headers(): Record<string, string>; current(): boolean }) {
  let snapshot: ReleaseSnapshot = releaseLoading;
  let credential = "", minimum = -1, closed = false, revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, pending: Promise<void> | undefined;
  let aborter: AbortController | undefined;
  const listeners = new Set<() => void>();
  const identity = () => canonical(options.headers());
  const publish = (next: ReleaseSnapshot) => { if (snapshot === next) return; snapshot = next; for (const listener of listeners) listener(); };
  const active = () => !closed && options.current();
  const getSnapshot = (): ReleaseSnapshot => {
    if (!active() || credential !== identity()) return releaseLoading;
    return snapshot;
  };
  const schedule = (delay: number) => {
    if (timer !== undefined || !listeners.size || closed) return;
    timer = setTimeout(() => { timer = undefined; void refresh(); }, delay);
  };
  async function refresh() {
    if (pending || !listeners.size || closed) return;
    const key = identity(), epoch = revision;
    if (credential !== key) { credential = key; minimum = -1; publish(releaseLoading); }
    if (!active()) { publish(releaseLoading); schedule(1000); return; }
    aborter = new AbortController();
    // A hung metadata request cannot hold the subscription forever.
    const timeout = setTimeout(() => aborter?.abort(), 10000);
    const work = (async () => {
      try {
        const response = await options.fetch(`${options.url}/`, { headers: { ...options.headers() }, signal: aborter!.signal });
        const value: unknown = await response.json();
        if (!active() || epoch !== revision || key !== identity()) return;
        if (object(value) && object(value.denied) && typeof value.denied.code === "string") {
          publish({ denied: value.denied as unknown as Refusal }); return;
        }
        const next = response.ok ? decode(value) : undefined;
        if (!next || next.generation < minimum) { publish(releaseLoading); return; }
        minimum = next.generation;
        if (!("generation" in snapshot) || canonical(next) !== canonical(snapshot)) publish(next);
      } catch { if (active() && epoch === revision && key === identity()) publish(releaseLoading); }
      finally { clearTimeout(timeout); }
    })();
    pending = work;
    await work;
    pending = undefined;
    schedule(1000);
  }
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      if (closed) return () => {};
      listeners.add(listener); schedule(0);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          if (timer !== undefined) clearTimeout(timer); timer = undefined;
          revision++; aborter?.abort(); snapshot = releaseLoading;
        }
      };
    },
    invalidate() {
      revision++; aborter?.abort(); publish(releaseLoading);
      if (timer !== undefined) clearTimeout(timer); timer = undefined; schedule(0);
    },
    hint(response: Response) {
      const value = response.headers.get("x-snapback-generation");
      const next = value === null ? NaN : Number(value);
      if (!Number.isSafeInteger(next) || next <= minimum || !active()) return;
      minimum = next; publish(releaseLoading);
      if (!pending) { if (timer !== undefined) clearTimeout(timer); timer = undefined; schedule(0); }
    },
    close() {
      closed = true; revision++; aborter?.abort();
      if (timer !== undefined) clearTimeout(timer); timer = undefined;
      publish(releaseLoading); listeners.clear();
    },
  };
}

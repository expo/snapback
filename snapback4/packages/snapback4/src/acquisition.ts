import type { Client } from "./contract.ts";

/** Rows durably received in this acquisition, by source table. Completion is
 * the device's snapshot-plus-catch-up barrier, independent of link status. */
export interface Acquisition {
  readonly acquired: boolean;
  readonly rows: number;
  readonly tables: Readonly<Record<string, number>>;
  /** Published coverage, restored on reopen; neither row counts nor totals. */
  readonly usable: { readonly tables: number; readonly groups: number };
}
interface Progress {
  read(): Acquisition;
  subscribe(notify: () => void): () => void;
}
const empty: Acquisition = Object.freeze({ acquired: false, rows: 0, tables: Object.freeze(Object.create(null)), usable: Object.freeze({ tables: 0, groups: 0 }) });
const reopened: Acquisition = Object.freeze({ ...empty, acquired: true });
const sources = new WeakMap<Client, Progress>();
export function acquisition(client: Client): Progress {
  return sources.get(client) ?? { read: () => client.acquired ? reopened : empty,
    subscribe: notify => client.onAcquired(() => notify()) };
}
export function acquisitionProgress() {
  let current = empty;
  let deferred: Record<string, number> = Object.create(null);
  const listeners = new Set<() => void>();
  const publish = (value: Acquisition) => { current = Object.freeze(value); for (const notify of listeners) notify(); };
  return {
    bind(client: Client) { sources.set(client, { read: () => current, subscribe(notify) { listeners.add(notify); return () => { listeners.delete(notify); }; } }); },
    acquired(value: boolean) { if (value !== current.acquired) publish({ ...current, acquired: value }); },
    reset() { deferred = Object.create(null); publish(empty); },
    // @ref LLP 3000.001.001#8-progress-and-ui — counts come from published device facts, including revocation and reopen.
    usable(state: { acquired_tables?: string[]; floored_groups?: number } | undefined) {
      const tables = state?.acquired_tables?.length ?? 0, groups = state?.floored_groups ?? 0;
      if (tables !== current.usable.tables || groups !== current.usable.groups) publish({ ...current, usable: Object.freeze({ tables, groups }) });
    },
    page(page: Record<string, unknown>, first: boolean, published = true) {
      if (!page.snapshot) {
        if (page.acquire) for (const event of page.events as { table: string; kind: string }[]) if (event.kind === "put") deferred[event.table] = (deferred[event.table] ?? 0) + 1;
        if (!published || !Object.keys(deferred).length) return;
        // @ref LLP 3000.001.001#8-progress-and-ui — compiler table names are data keys, including Object prototype names, on every publication path.
        const tables: Record<string, number> = Object.assign(Object.create(null), current.tables);
        for (const [table, count] of Object.entries(deferred)) tables[table] = (tables[table] ?? 0) + count;
        deferred = Object.create(null);
        publish({ ...current, rows: Object.values(tables).reduce((sum, count) => sum + count, 0), tables: Object.freeze(tables) });
        return;
      }
      deferred = Object.create(null);
      const tables: Record<string, number> = Object.assign(Object.create(null), first ? undefined : current.tables);
      for (const event of page.events as { table: string; kind: string }[]) if (event.kind === "put") tables[event.table] = (tables[event.table] ?? 0) + 1;
      publish({ ...current, acquired: false, rows: Object.values(tables).reduce((sum, count) => sum + count, 0), tables: Object.freeze(tables) });
    },
  };
}
export function guardAcquisition(client: Client, raw: Client, valid: () => boolean) {
  const source = acquisition(raw);
  sources.set(client, { read: () => valid() ? source.read() : empty,
    subscribe(notify) { const a = source.subscribe(notify), b = client.onAcquired(() => notify()); return () => { a(); b(); }; } });
}

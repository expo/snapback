import type { Client } from "./contract.ts";

/** Rows durably received in this acquisition, by source table. Completion is
 * the device's snapshot-plus-catch-up barrier, independent of link status. */
export interface Acquisition {
  readonly acquired: boolean;
  readonly rows: number;
  readonly tables: Readonly<Record<string, number>>;
}
interface Progress {
  read(): Acquisition;
  subscribe(notify: () => void): () => void;
}
const empty: Acquisition = Object.freeze({ acquired: false, rows: 0, tables: Object.freeze(Object.create(null)) });
const reopened: Acquisition = Object.freeze({ ...empty, acquired: true });
const sources = new WeakMap<Client, Progress>();
export function acquisition(client: Client): Progress {
  return sources.get(client) ?? { read: () => client.acquired ? reopened : empty,
    subscribe: notify => client.onAcquired(() => notify()) };
}
export function acquisitionProgress() {
  let current = empty;
  const listeners = new Set<() => void>();
  const publish = (value: Acquisition) => { current = Object.freeze(value); for (const notify of listeners) notify(); };
  return {
    bind(client: Client) { sources.set(client, { read: () => current, subscribe(notify) { listeners.add(notify); return () => { listeners.delete(notify); }; } }); },
    acquired(value: boolean) { if (value !== current.acquired) publish({ ...current, acquired: value }); },
    reset() { publish(empty); },
    page(page: Record<string, unknown>, first: boolean) {
      if (!page.snapshot) return;
      const tables: Record<string, number> = Object.assign(Object.create(null), first ? undefined : current.tables);
      for (const event of page.events as { table: string; kind: string }[]) if (event.kind === "put") tables[event.table] = (tables[event.table] ?? 0) + 1;
      publish({ acquired: false, rows: Object.values(tables).reduce((sum, count) => sum + count, 0), tables: Object.freeze(tables) });
    },
  };
}
export function guardAcquisition(client: Client, raw: Client, valid: () => boolean) {
  const source = acquisition(raw);
  sources.set(client, { read: () => valid() ? source.read() : empty,
    subscribe(notify) { const a = source.subscribe(notify), b = client.onAcquired(() => notify()); return () => { a(); b(); }; } });
}

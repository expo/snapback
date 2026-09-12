// The React arm: one provider, five hooks, nothing a screen must reconcile.
// Every hook returns a value from the card (contract.ts) and nothing else.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Write } from "./contract.ts";
import { isReady } from "./contract.ts";

const ClientContext = createContext<Client | null>(null);

export function SnapbackProvider({ client, children }: { client: Client; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): Client {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useClient: no <SnapbackProvider> above this component");
  return client;
}

const LOADING: Read<never> = { loading: true };

/** One live read. Re-renders when the value changes; never throws. */
export function useQuery<A, R>(op: Query<A, R>, args: A): Read<R> {
  const client = useClient();
  const key = JSON.stringify(args);
  const observed = useMemo(() => client.observe(op, args), [client, op, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => observed.close(), [observed]);
  return useSyncExternalStore(observed.subscribe, observed.getSnapshot, () => LOADING as Read<R>);
}

/** A page resource: the pages a screen has asked for, concatenated, and a way to ask for one more. */
class Pages<A extends { c?: Cursor | null }, R extends readonly unknown[]> {
  private observed: Observed<R>[] = [];
  private cursors: (Cursor | null)[] = [null];
  private subs = new Set<() => void>();
  private cache: { items: R[number][]; hasMore: boolean; read: Read<R> } | null = null;
  private unsubscribe: (() => void)[] = [];
  constructor(private client: Client, private op: Query<A, R>, private args: A) { this.open(null); }
  private open(c: Cursor | null) {
    const observed = this.client.observe(this.op, { ...this.args, c });
    this.observed.push(observed);
    this.unsubscribe.push(observed.subscribe(() => this.notify()));
  }
  private notify() { this.cache = null; for (const s of this.subs) s(); }
  subscribe = (notify: () => void) => { this.subs.add(notify); return () => { this.subs.delete(notify); }; };
  getSnapshot = () => {
    if (this.cache) return this.cache;
    const reads = this.observed.map((o) => o.getSnapshot());
    const items: R[number][] = [];
    let hasMore = false;
    let last: Read<R> = LOADING as Read<R>;
    for (const read of reads) {
      last = read;
      if (!isReady(read)) break;
      items.push(...(read.data as readonly R[number][]));
      hasMore = read.next != null;
    }
    this.cache = { items, hasMore, read: last };
    return this.cache;
  };
  loadMore = () => {
    const last = this.observed[this.observed.length - 1]?.getSnapshot();
    if (!last || !isReady(last) || last.next == null) return;
    if (this.cursors.includes(last.next)) return;
    this.cursors.push(last.next);
    this.open(last.next);
    this.notify();
  };
  close() { for (const u of this.unsubscribe) u(); for (const o of this.observed) o.close(); }
}

export function usePage<A extends { c?: Cursor | null }, R extends readonly unknown[]>(op: Query<A, R>, args: Omit<A, "c">) {
  const client = useClient();
  const key = JSON.stringify(args);
  const pages = useMemo(() => new Pages(client, op, args as A), [client, op, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => pages.close(), [pages]);
  const snapshot = useSyncExternalStore(pages.subscribe, pages.getSnapshot, pages.getSnapshot);
  return { items: snapshot.items, hasMore: snapshot.hasMore, read: snapshot.read, loadMore: pages.loadMore };
}

/** A write. `run` never throws; `last` is the most recent outcome. */
export function useMutation<A, R>(op: Mutation<A, R>) {
  const client = useClient();
  const [last, setLast] = useState<Write | undefined>(undefined);
  const [inFlight, setInFlight] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async (args: A): Promise<Write> => {
    setInFlight(true);
    const outcome = await client.mutate(op, args);
    if (alive.current) { setLast(outcome); setInFlight(false); }
    return outcome;
  }, [client, op]);
  return { run, last, inFlight };
}

export function useLink(): Link {
  const client = useClient();
  const subscribe = useCallback((notify: () => void) => client.onLink(() => notify()), [client]);
  return useSyncExternalStore(subscribe, client.link, client.link);
}

export function useViewer(): Principal | null {
  return useClient().viewer();
}

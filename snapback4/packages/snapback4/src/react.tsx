// The React arm: one provider and hooks over the client card.
// Every hook returns a value from the card (contract.ts) and nothing else.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Act, Action, ActOptions, AssetRead, Client, Cursor, Link, Mutation, Observed, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import type { Session } from "./auth.ts";
import type { App, AppAuth, AuthSnapshot } from "./app.ts";
import { isReady } from "./contract.ts";

const ClientContext = createContext<Client | null>(null);

const AppContext = createContext<App | null>(null);

/** Own the app outside render; changing accounts replaces the client context. */
export function AppProvider({ app, children }: { app: App; children: ReactNode }) {
  const snapshot = useSyncExternalStore(app.auth.onChange, app.auth.getSnapshot, app.auth.getSnapshot);
  return <AppContext.Provider value={app}><ClientContext.Provider value={app.client}>
    <AppAccount key={`${snapshot.state}:${snapshot.viewer ?? ""}`}>{children}</AppAccount>
  </ClientContext.Provider></AppContext.Provider>;
}

// Remount account-owned component state, including drafts and asset handles.
function AppAccount({ children }: { children: ReactNode }) { return children; }

export function useAuth(): AuthSnapshot & Pick<AppAuth, "signup" | "login" | "guest" | "logout" | "logoutEverywhere"> {
  const app = useContext(AppContext);
  if (!app) throw new Error("useAuth: no <AppProvider> above this component");
  const snapshot = useSyncExternalStore(app.auth.onChange, app.auth.getSnapshot, app.auth.getSnapshot);
  return { ...snapshot, signup: app.auth.signup, login: app.auth.login, guest: app.auth.guest,
    logout: app.auth.logout, logoutEverywhere: app.auth.logoutEverywhere };
}

export function SnapbackProvider({ client, children }: { client: Client; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): Client {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useClient: no <AppProvider> or <SnapbackProvider> above this component");
  return client;
}

const LOADING: Read<never> = { loading: true };

/** Constructing this resource is inert: only a committed subscription owns an
 * observation. React may discard a render or replay a subscription's setup. */
class Observation<R> {
  private observed: Observed<R> | null = null;
  private unsubscribe: (() => void) | null = null;
  private subs = new Set<() => void>();
  constructor(private open: () => Observed<R>) {}
  getSnapshot = (): Read<R> => this.observed?.getSnapshot() ?? LOADING;
  subscribe = (notify: () => void) => {
    this.subs.add(notify);
    if (!this.observed) {
      const observed = this.open();
      this.observed = observed;
      this.unsubscribe = observed.subscribe(() => {
        if (this.observed === observed) for (const s of this.subs) s();
      });
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.subs.delete(notify);
      if (this.subs.size) return;
      const observed = this.observed;
      this.observed = null;
      this.unsubscribe?.();
      this.unsubscribe = null;
      observed?.close();
    };
  };
}

/** One live read. Re-renders when the value changes; never throws. */
export function useQuery<A, R>(op: Query<A, R>, args: A): Read<R> {
  const client = useClient();
  const key = JSON.stringify(args);
  const observed = useMemo(() => new Observation(() => client.observe(op, args)), [client, op, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useSyncExternalStore(observed.subscribe, observed.getSnapshot, () => LOADING as Read<R>);
}

/** A page resource: the pages a screen has asked for, concatenated, and a way to ask for one more. */
class Pages<A extends { c?: Cursor | null }, R extends readonly unknown[]> {
  private pages: { cursor: Cursor | null; observed: Observed<R>; unsubscribe: () => void }[] = [];
  private requested = 1;
  private subs = new Set<() => void>();
  private cache: { items: R[number][]; hasMore: boolean; read: Read<R> } | null = null;
  private reconciling = false;
  constructor(private client: Client, private op: Query<A, R>, private args: A) {}
  private open(c: Cursor | null) {
    const observed = this.client.observe(this.op, { ...this.args, c });
    const page = { cursor: c, observed, unsubscribe: () => {} };
    this.pages.push(page);
    page.unsubscribe = observed.subscribe(() => {
      if (this.pages.includes(page)) this.notify();
    });
  }
  private drop(from: number) {
    for (const page of this.pages.splice(from)) {
      page.unsubscribe();
      page.observed.close();
    }
  }
  private notify() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      // A later page belongs to its predecessor's current cursor. Keep the
      // requested depth, but discard the old suffix before opening a new one:
      // deduplication alone cannot recover rows an old boundary skipped.
      for (let i = 0; i < this.pages.length; i++) {
        const read = this.pages[i]!.observed.getSnapshot();
        const next = isReady(read) && Array.isArray(read.data) ? read.next : null;
        if (!next || i + 1 >= this.requested || this.pages.slice(0, i + 1).some((p) => p.cursor === next)) {
          this.drop(i + 1);
          break;
        }
        if (this.pages[i + 1]?.cursor !== next) {
          this.drop(i + 1);
          this.open(next);
        }
      }
      this.cache = null;
    } finally { this.reconciling = false; }
    for (const s of this.subs) s();
  }
  subscribe = (notify: () => void) => {
    this.subs.add(notify);
    if (!this.pages.length) { this.open(null); this.notify(); }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.subs.delete(notify);
      if (!this.subs.size) { this.drop(0); this.cache = null; }
    };
  };
  getSnapshot = () => {
    if (this.cache) return this.cache;
    const items: R[number][] = [];
    let last: Read<R> = LOADING as Read<R>;
    let complete = true, fresh = true;
    let cut: import("./contract.ts").ReadCut = null;
    let since: number | undefined;
    let knownSince = true;
    for (const page of this.pages) {
      const read = page.observed.getSnapshot();
      last = read;
      if (!isReady(read)) break;
      if (!Array.isArray(read.data)) { last = LOADING as Read<R>; break; }
      items.push(...(read.data as readonly R[number][]));
      complete &&= read.complete;
      if (read.cut === "meter" || (cut === null && read.cut === "words")) cut = read.cut;
      fresh &&= read.fresh;
      if (read.since == null) knownSince = false;
      else since = Math.min(since ?? read.since, read.since);
    }
    const hasMore = isReady(last) && last.next != null && !this.pages.some((p) => p.cursor === last.next);
    const read: Read<R> = isReady(last)
      ? { data: items as unknown as R, complete, cut, fresh, ...(knownSince && since != null ? { since } : {}), ...(last.next !== undefined ? { next: last.next } : {}) }
      : last;
    this.cache = { items, hasMore, read };
    return this.cache;
  };
  loadMore = () => {
    if (!this.subs.size || !this.getSnapshot().hasMore) return;
    this.requested = Math.max(this.requested, this.pages.length + 1);
    this.notify();
  };
}

export function usePage<A extends { c?: Cursor | null }, R extends readonly unknown[]>(op: Query<A, R>, args: Omit<A, "c">) {
  const client = useClient();
  const key = JSON.stringify(args);
  const pages = useMemo(() => new Pages(client, op, args as A), [client, op, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const snapshot = useSyncExternalStore(pages.subscribe, pages.getSnapshot, pages.getSnapshot);
  return { items: snapshot.items, hasMore: snapshot.hasMore, read: snapshot.read, loadMore: pages.loadMore };
}

/** A write. `run` never throws; `last` is the most recent outcome, including
 * queued settlement. A sent replay has `replayed: true` and no result. */
function useTrackedMutation<A, R>(op: Mutation<A, R>, id?: string) {
  const client = useClient();
  const [last, setLast] = useState<Write<R> | undefined>(undefined);
  const [inFlight, setInFlight] = useState(false);
  const lifetime = useRef({ active: true, pending: 0, next: 0, latest: 0, ids: new Map<string, number>(), early: new Map<string, Exclude<Write, { state: "pending" }>>() });
  useEffect(() => {
    if (!lifetime.current.active) {
      lifetime.current = { active: true, pending: 0, next: 0, latest: 0, ids: new Map(), early: new Map() };
      setLast(undefined);
      setInFlight(false);
    }
    const owner = lifetime.current;
    if (id) owner.ids.set(id, owner.latest);
    let restored = false;
    const unsubscribe = client.onWrite((write) => {
      const run = owner.ids.get(write.id);
      if (run == null) {
        // Settlement can win the same turn in which mutate returns pending.
        // Keep that terminal result until the returned id binds it to a run.
        if (owner.pending > 0) {
          owner.early.set(write.id, write);
          if (owner.early.size > 256) owner.early.delete(owner.early.keys().next().value!);
        }
        return;
      }
      owner.ids.delete(write.id);
      if (write.id === id) restored = true;
      if (owner.active && lifetime.current === owner && run === owner.latest) setLast(write as Write<R>);
    });
    if (id) void client.write(id).then(write => {
      if (!restored && owner.active && lifetime.current === owner && owner.latest === 0) {
        setLast(write as Write<R> | undefined);
      }
    }).catch(() => { /* No receipt is not a failed mutation. Keep the subscribed outcome. */ });
    return () => { owner.active = false; unsubscribe(); };
  }, [client, op, id]);
  const run = useCallback(async (args: A): Promise<Write<R>> => {
    const owner = lifetime.current;
    const serial = ++owner.next;
    owner.latest = serial;
    owner.pending++;
    if (owner.active) setInFlight(true);
    let outcome: Write<R>;
    try { outcome = await client.mutate(op, args); }
    catch (error) {
      // A foreign Client can throw without exposing its minted id. Do not
      // invent an operation identity or claim that this is safe to retry.
      outcome = { state: "failed", id: "", why: { code: "E_CLIENT", family: "client", message: `The client did not return a write outcome; whether it was admitted is unknown. ${error instanceof Error ? error.message : String(error)}` } };
    }
    let visible = outcome;
    if (outcome.id) {
      owner.ids.set(outcome.id, serial);
      const early = owner.early.get(outcome.id);
      if (early) {
        owner.early.delete(outcome.id);
        owner.ids.delete(outcome.id);
        visible = early as Write<R>;
      } else if (outcome.state !== "pending") owner.ids.delete(outcome.id);
    }
    owner.pending--;
    if (owner.active && lifetime.current === owner) {
      if (serial === owner.latest) setLast(visible);
      setInFlight(owner.pending > 0);
    }
    return outcome;
  }, [client, op]);
  return { run, last, inFlight };
}

/** A write's latest outcome and in-flight calls, including terminal settlement. */
export function useMutation<A, R>(op: Mutation<A, R>) {
  return useTrackedMutation(op);
}

/** Track one write from submit to sent/failed. Pass its saved mutation id to
 * recover after remount/reopen without submitting it again. Unknown ids leave
 * last undefined. pending includes the interval before mutate returns an id. */
export function usePendingWrite<A, R>(op: Mutation<A, R>, id?: string) {
  const write = useTrackedMutation(op, id);
  return { ...write, pending: write.inFlight || write.last?.state === "pending" };
}

/** Durable acquisition, independent of whether the link is currently online. */
export function useAcquired(): boolean {
  const client = useClient();
  const subscribe = useCallback((notify: () => void) => client.onAcquired(() => notify()), [client]);
  const read = useCallback(() => client.acquired, [client]);
  return useSyncExternalStore(subscribe, read, read);
}

/** A worker action. `run` returns its outcome; pass a pending id again to
 * collect it. Concurrent calls keep `last` on the most recently started. */
export function useAction<A, R>(op: Action<A, R>) {
  const client = useClient();
  const [last, setLast] = useState<Act<R> | undefined>(undefined);
  const [inFlight, setInFlight] = useState(false);
  const lifetime = useRef({ active: true, pending: 0, next: 0, latest: 0 });
  useEffect(() => {
    lifetime.current = { active: true, pending: 0, next: 0, latest: 0 };
    const owner = lifetime.current;
    setLast(undefined);
    setInFlight(false);
    return () => { owner.active = false; };
  }, [client, op]);
  const run = useCallback(async (args: A, options?: ActOptions): Promise<Act<R>> => {
    const owner = lifetime.current;
    const serial = ++owner.next;
    owner.latest = serial;
    owner.pending++;
    if (owner.active) setInFlight(true);
    try {
      const outcome = await client.act(op, args, options);
      if (owner.active && lifetime.current === owner && serial === owner.latest) setLast(outcome);
      return outcome;
    } finally {
      owner.pending--;
      if (owner.active && lifetime.current === owner) setInFlight(owner.pending > 0);
    }
  }, [client, op]);
  return { run, last, inFlight };
}

export function useLink(): Link {
  const client = useClient();
  const subscribe = useCallback((notify: () => void) => client.onLink(() => notify()), [client]);
  return useSyncExternalStore(subscribe, client.link, client.link);
}

export function useViewer(): Principal | null {
  const client = useClient();
  const subscribe = useCallback((notify: () => void) => client.onViewer(() => notify()), [client]);
  return useSyncExternalStore(subscribe, client.viewer, client.viewer);
}

/** The session the local-first client holds, or null once it ended (after
 * `signOut()`, or once the server refused it); re-renders when it ends. A
 * screen that keeps the token — a native image header, a presence lease —
 * takes it from here and stops when it is null, so nothing reads a token
 * after sign-out. On a client without sessions (the online tier, a mock)
 * it is null. */
export function useSession(): Session | null {
  const client = useClient() as Client & Partial<{ session(): Session | null; onSession(notify: (session: Session | null) => void): () => void }>;
  const subscribe = useCallback((notify: () => void) => (client.onSession ? client.onSession(() => notify()) : () => {}), [client]);
  const read = useCallback(() => (client.session ? client.session() : null), [client]);
  return useSyncExternalStore(subscribe, read, read);
}

export type AssetState = { readonly status: "empty" } | { readonly status: "loading" } | { readonly status: "ready"; readonly url: string; readonly type: string } | { readonly status: "denied"; readonly why: Refusal };

/** The bytes of an asset a row the viewer may read holds, fetched under
 * the viewer's credentials as a blob URL for `src`. Revoked when the id
 * changes or the screen unmounts. A one-view photo is fetched once per
 * mount: a screen that shows it again is `denied` with `E_ASSET_VIEWED`,
 * which is the feature. Pass `null` to show nothing. */
export function useAsset(id: string | null | undefined): AssetState {
  const client = useClient();
  const [state, setState] = useState<AssetState>({ status: "loading" });
  useEffect(() => {
    if (!id) {
      setState({ status: "empty" });
      return;
    }
    let live = true;
    let read: AssetRead | null = null;
    setState({ status: "loading" });
    void client.asset(id).then((result) => {
      read = result;
      if (!live) {
        if ("url" in result) result.revoke();
        return;
      }
      setState("url" in result ? { status: "ready", url: result.url, type: result.type } : { status: "denied", why: result.denied });
    }).catch((error) => {
      if (live) setState({ status: "denied", why: { code: "E_CLIENT", family: "client", message: `The client did not return an asset outcome. ${error instanceof Error ? error.message : String(error)}` } });
    });
    return () => {
      live = false;
      if (read && "url" in read) read.revoke();
    };
  }, [client, id]);
  return id ? state : { status: "empty" };
}

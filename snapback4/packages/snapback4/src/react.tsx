import { assetError, assetRetryAt } from "./asset-download.ts";
// The React arm: one provider and hooks over the client card.
// Every hook returns a value from the card (contract.ts) and nothing else.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ObserveOptions, Act, Action, ActOptions, AssetRead, Client, Cursor, Link, Ephemeral, Signal, Mutation, MutateOptions, Observed, PendingWrite, Principal, Query, Read, Refusal, Write } from "./contract.ts";
import type { Session } from "./auth.ts";
import type { App, AppAuth, AuthSnapshot } from "./app.ts";
import { acquisition, type Acquisition } from "./acquisition.ts";
export type { Acquisition } from "./acquisition.ts";
import { clockDelay, onClock } from "./clock.ts";
import { isReady } from "./contract.ts";
import { Pages } from "./react-pages.ts";
import { pendingWritesSource } from "./react-pending-writes.ts";
import { peekObservation } from "./observe-watch.ts";

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

/** Server time for a render deadline. Re-render at that deadline and whenever
 * the estimate changes; held device queries already publish their own expiry. */
export function useNow(deadline: number | null = null): number {
  const client = useClient();
  const renderedNow = client.now();
  const [, tick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      const remaining = deadline === null ? 0 : clockDelay(client.now, deadline);
      if (remaining > 0) timer = setTimeout(() => { tick(n => n + 1); schedule(); }, Math.min(remaining, 2_147_483_647));
    };
    const stop = onClock(client.now, () => { tick(n => n + 1); schedule(); });
    schedule();
    // Render and subscription are separate phases: catch a missed correction
    // or a deadline crossed before this effect could install its timer.
    if (client.now() !== renderedNow) tick(n => n + 1);
    return () => { stop(); clearTimeout(timer); };
  }, [client, deadline]);
  return renderedNow;
}

const LOADING: Read<never> = { loading: true };

/** Constructing this resource is inert: only a committed subscription owns an
 * observation. React may discard a render or replay a subscription's setup. */
class Observation<R> {
  private observed: Observed<R> | null = null;
  private unsubscribe: (() => void) | null = null;
  private subs = new Set<() => void>();
  constructor(private open: () => Observed<R>, private peek: () => Read<R> | undefined) {}
  getSnapshot = (): Read<R> => this.observed?.getSnapshot() ?? this.peek() ?? LOADING;
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
export function useQuery<A, R>(op: Query<A, R>, args: A, options?: ObserveOptions): Read<R> {
  const client = useClient();
  const key = JSON.stringify(args);
  const observed = useMemo(() => new Observation(
    () => client.observe(op, args, options),
    () => peekObservation(client, op, args, options)), [client, op, key, options?.keep]); // eslint-disable-line react-hooks/exhaustive-deps
  return useSyncExternalStore(observed.subscribe, observed.getSnapshot, () => LOADING as Read<R>);
}

export function usePage<A extends { c?: Cursor | null }, R extends readonly unknown[]>(op: Query<A, R>, args: Omit<A, "c">, options?: ObserveOptions) {
  const client = useClient();
  const key = JSON.stringify(args);
  const pages = useMemo(() => new Pages(client, op, args as A, options), [client, op, key, options?.keep]); // eslint-disable-line react-hooks/exhaustive-deps
  const snapshot = useSyncExternalStore(pages.subscribe, pages.getSnapshot, pages.getSnapshot);
  return { items: snapshot.items, hasMore: snapshot.hasMore, read: snapshot.read, loadMore: pages.loadMore };
}

/** A write. `run` never throws; `last` is the most recent outcome, including
 * queued settlement. A sent replay has `replayed: true` and no result. */
interface MutationHook<A, Outcome> {
  run(args: A): Promise<Outcome>;
  last: Outcome | undefined;
  inFlight: boolean;
}
/** A durable write's hook: `run` takes `client.mutate`'s options, so `{ waitSeconds: 0 }`
 * returns at custody and `{ id }` submits under an id the app saved first. */
interface WriteHook<A, R> {
  run(args: A, options?: MutateOptions): Promise<Write<R>>;
  last: Write<R> | undefined;
  inFlight: boolean;
}
function useTrackedMutation<A, R>(op: Ephemeral<A, R>): MutationHook<A, Signal<R>>;
function useTrackedMutation<A, R>(op: Mutation<A, R>, id?: string): WriteHook<A, R> & { restoring: boolean };
function useTrackedMutation<A, R>(op: Mutation<A, R> | Ephemeral<A, R>, id?: string): MutationHook<A, Write<R> | Signal<R>> | WriteHook<A, R>;
function useTrackedMutation<A, R>(op: Mutation<A, R> | Ephemeral<A, R>, id?: string): MutationHook<A, Write<R> | Signal<R>> & { restoring?: boolean } {
  const client = useClient();
  const [last, setLast] = useState<Write<R> | Signal<R> | undefined>(undefined);
  const [inFlight, setInFlight] = useState(false);
  const restoration = useMemo(() => ({ pending: !!id }), [client, op, id]);
  const [, refreshRestoration] = useState(0);
  const lifetime = useRef({ active: true, pending: 0, next: 0, latest: 0, ids: new Map<string, number>(), early: new Map<string, Exclude<Write, { state: "pending" }>>() });
  useEffect(() => {
    if (!lifetime.current.active) {
      lifetime.current = { active: true, pending: 0, next: 0, latest: 0, ids: new Map(), early: new Map() };
      setLast(undefined);
      setInFlight(false);
    }
    const owner = lifetime.current;
    const restoredLookup = () => {
      if (owner.active && lifetime.current === owner && restoration.pending) {
        restoration.pending = false;
        refreshRestoration(n => n + 1);
      }
    };
    if (id) owner.ids.set(id, owner.latest);
    let restored = false;
    const unsubscribe = op.ephemeral ? () => {} : client.onWrite((write) => {
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
      if (write.id === id) { restored = true; restoredLookup(); }
      if (owner.active && lifetime.current === owner && run === owner.latest) setLast(write as Write<R>);
    });
    if (id) void client.write(id).then(write => {
      if (!restored && owner.active && lifetime.current === owner && owner.latest === 0) {
        setLast(write as Write<R> | undefined);
      }
    }).catch(() => { /* No receipt is not a failed mutation. Keep the subscribed outcome. */ }).finally(restoredLookup);
    return () => { owner.active = false; unsubscribe(); };
  }, [client, op, id, restoration]);
  const run = useCallback(async (args: A, options?: MutateOptions): Promise<Write<R> | Signal<R>> => {
    const owner = lifetime.current;
    const serial = ++owner.next;
    owner.latest = serial;
    owner.pending++;
    if (owner.active) setInFlight(true);
    let outcome: Write<R> | Signal<R>;
    try { outcome = op.ephemeral ? await client.mutate(op, args) : await client.mutate(op, args, options); }
    catch (error) {
      // A foreign Client can throw without exposing its minted id. Do not
      // invent an operation identity or claim that this is safe to retry.
      outcome = { state: "failed", id: "", why: { code: "E_CLIENT", family: "client", message: `The client did not return a write outcome; whether it was admitted is unknown. ${error instanceof Error ? error.message : String(error)}` } };
    }
    let visible = outcome;
    if (!op.ephemeral && outcome.id) {
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
  return { run, last, inFlight, restoring: restoration.pending };
}

/** A write's latest outcome and in-flight calls, including terminal settlement. */
export function useMutation<A, R>(op: Ephemeral<A, R>): MutationHook<A, Signal<R>>;
export function useMutation<A, R>(op: Mutation<A, R>): WriteHook<A, R>;
export function useMutation<A, R>(op: Mutation<A, R> | Ephemeral<A, R>) {
  return useTrackedMutation(op);
}

/** Track one write from submit to sent/failed. Pass its saved mutation id to
 * recover after remount/reopen without submitting it again. Unknown ids leave
 * last undefined. pending includes the interval before mutate returns an id.
 * `restoring` is true while a saved id's recorded outcome is being looked up;
 * `last === undefined` means unknown only once `restoring` is false. */
export function usePendingWrite<A, R>(op: Mutation<A, R>, id?: string) {
  const write = useTrackedMutation(op, id);
  return { ...write, pending: write.inFlight || write.last?.state === "pending" };
}

/** Admitted writes, oldest first, optionally restricted to one mutation.
 * Starts with [] while reading the first snapshot. */
// @ref LLP 3000.019#3.3 — render queued intent without inventing a predicted row.
export function usePendingWrites<A = unknown, R = unknown>(op?: Mutation<A, R>): readonly PendingWrite<A>[] {
  const client = useClient();
  const source = useMemo(() => pendingWritesSource(client, op?.name), [client, op?.name]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getServerSnapshot) as readonly PendingWrite<A>[];
}

/** Durable acquisition, independent of whether the link is currently online. */
export function useAcquired(): boolean {
  const client = useClient();
  const subscribe = useCallback((notify: () => void) => client.onAcquired(() => notify()), [client]);
  const read = useCallback(() => client.acquired, [client]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Snapshot progress without blocking server-fallback reads. */
export function useAcquisition(): Acquisition {
  const client = useClient();
  const source = useMemo(() => acquisition(client), [client]);
  return useSyncExternalStore(source.subscribe, source.read, source.read);
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

export type AssetState = { readonly status: "empty" } | { readonly status: "loading" } | { readonly status: "ready"; readonly url: string; readonly type: string } | { readonly status: "denied"; readonly why: Refusal } | { readonly status: "error"; readonly why: Refusal };

/** The bytes of an asset a row the viewer may read holds, fetched under
 * the viewer's credentials as a blob URL for `src`. Revoked when the id
 * changes or the screen unmounts. A one-view photo is fetched once per
 * mount: a screen that shows it again is `denied` with `E_ASSET_VIEWED`,
 * which is the feature. Pass `null` to show nothing. */
export function useAsset(id: string | null | undefined): AssetState {
  const client = useClient();
  const signedOut = useLink() === "signed-out";
  // @ref LLP 3000.008.002.000#6 — a display handle belongs to this client, principal and asset id, including the render before effect cleanup.
  // A raw online client can have a bearer before discovering its viewer.
  // That discovery is not an account change and must not consume a second view.
  const owner = useMemo(() => ({ client, signedOut, id }), [client, signedOut, id]);
  const [resolved, setResolved] = useState<{ owner: typeof owner; state: AssetState; lifetime: { live: boolean } }>();
  useEffect(() => {
    const { client, signedOut, id } = owner;
    if (!id || signedOut) return;
    let live = true, busy = false;
    const lifetime = { live: true };
    let read: AssetRead | null = null;
    const publish = (state: AssetState) => setResolved({ owner, state, lifetime });
    const load = () => {
      if (!live || busy || client.link() === "signed-out") return;
      busy = true;
      publish({ status: "loading" });
      void client.asset(id).then((result) => {
        read = result;
        if (!live) {
          if ("url" in result) result.revoke();
          return;
        }
        publish("url" in result ? { status: "ready", url: result.url, type: result.type }
          : { status: assetError(result.denied) ? "error" : "denied", why: result.denied });
      }).catch((error) => {
        read = null;
        if (live) publish({ status: "error", why: { code: "E_CLIENT", family: "client", message: `The client did not return an asset outcome. ${error instanceof Error ? error.message : String(error)}` } });
      }).finally(() => { busy = false; });
    };
    const recover = () => {
      if (read && "denied" in read && assetError(read.denied) && read.denied.retryable === true && Date.now() >= assetRetryAt(read.denied)) load();
    };
    let link = client.link();
    const unsubscribe = client.onLink(next => { const before = link; link = next; if (next === "online" && before !== "online") recover(); });
    const visible = () => { if (globalThis.document?.visibilityState === "visible") recover(); };
    globalThis.addEventListener?.("focus", recover);
    globalThis.addEventListener?.("online", recover);
    globalThis.document?.addEventListener("visibilitychange", visible);
    queueMicrotask(() => { if (live) load(); });
    return () => {
      live = false; lifetime.live = false;
      unsubscribe();
      globalThis.removeEventListener?.("focus", recover);
      globalThis.removeEventListener?.("online", recover);
      globalThis.document?.removeEventListener("visibilitychange", visible);
      if (read && "url" in read) read.revoke();
    };
  }, [owner]);
  if (!id) return { status: "empty" };
  if (signedOut) return { status: "denied", why: { code: "E_AUTH", family: "auth", message: "Sign in before loading an asset.", rewrite: "read the asset's home row with the signed-in client, then pass its asset id to useAsset", guide: "assets" } };
  return resolved?.owner === owner && resolved.lifetime.live ? resolved.state : { status: "loading" };
}

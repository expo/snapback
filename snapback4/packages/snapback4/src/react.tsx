import { releaseLoading, type ReleaseSnapshot } from "./release.ts";
export type { ReleaseSnapshot, ServedRelease } from "./release.ts";
import { hasUploads } from "./uploads.ts";
import { mintId } from "./client.ts";
import { settleMutation } from "./write-settlement.ts";
import { Following } from "./following.ts";
import type { FollowingQuery } from "./contract.ts";
export type { FollowingPhase, FollowingSnapshot } from "./following.ts";
import { readOnlyRefusal } from "./read-only.ts";
import { pendingItems, pendingState, observeIntents, intentReadSequence, type PendingItemsOptions, type PendingStateOptions, type PendingIntent, type MutationArgs } from "./pending-items.ts";
import { pendingItemsSource } from "./react-pending-items.ts";
export type { PendingItem, PendingIntent, IntentPhase, PendingItemsOptions, PendingStateOptions } from "./pending-items.ts";
import { inspect, type ReadInspection } from "./inspection.ts";
import { assetError, assetRetryAt } from "./asset-download.ts";
import { saveAsset, type Saved } from "./files.ts";
import { assetWaiting, assetWaitDelay, readAsset, type AssetProgressDetail, type AssetStage, type AssetWaiting } from "./asset-progress.ts";
export type { AssetStage, AssetWaiting } from "./asset-progress.ts";
// The React arm: one provider and hooks over the client card.
// Read hooks return the client card vocabulary; inspection is an opt-in diagnostic.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ObserveOptions, Act, Action, ActOptions, AssetRead, Client, Cursor, Link, Ephemeral, Signal, Mutation, MutateOptions, Observed, PendingWrite, Principal, Query, Read, Refusal, ResultOf, Write } from "./contract.ts";
import type { Session } from "./auth.ts";
import type { App, AppAuth, AuthSnapshot, Online } from "./app.ts";
import { acquisition, type Acquisition } from "./acquisition.ts";
export type { Acquisition } from "./acquisition.ts";
import { clockDelay, onClock } from "./clock.ts";
import { isReady } from "./contract.ts";
export { matchRead, matchReadList, type ReadMatchListHandlers, otherwiseAll, isReady, isPresent, isLoading, isDenied, isFailed, sentResult, existence, readPresentation, type ReadMatchHandlers, type ReadMatchFallbackHandlers, type ReadMatchOtherwiseAll, type ReadMatchOverrides, type OtherwiseAll, type ReadPresentation } from "./contract.ts";
export type { Client, Principal, Read, Ready, SettledRead, Write, Signal, Act, Outcome, Refusal, Query, Mutation, Ephemeral, Action, MutateOptions, PendingWrite, Link, Cursor, ArgsOf, ResultOf, RowOf } from "./contract.ts";
// React apps name the app they hand to <AppProvider> here; `createApp` itself
// stays in snapback4/app so this entry never imports the session runtime.
export type { App, AppOptions, AppAuth, AuthSnapshot, AuthState, AppResult, Online } from "./app.ts";
import { Pages } from "./react-pages.ts";
import { pendingWritesSource } from "./react-pending-writes.ts";
import { peekObservation } from "./observe-watch.ts";
import { readKey } from "./read-key.ts";

import { SeenOwner, type SeenOptions, type SeenSnapshot } from "./seen-progress.ts";
import type { ReceiptFamily } from "./receipt-family.ts";
export type { SeenOptions, SeenSnapshot } from "./seen-progress.ts";

const ClientContext = createContext<Client | null>(null);

const AppContext = createContext<App | null>(null);

/** Own the app outside render; changing accounts replaces the client context. */
export function AppProvider({ app, children }: { app: App; children: ReactNode }) {
  const snapshot = useSyncExternalStore(app.auth.onChange, app.auth.getSnapshot, app.auth.getSnapshot);
  const [boundary, setBoundary] = useState(() => ({ app, generation: 0 }));
  // Account identity is state, never a memo cache that React may discard.
  if (boundary.app !== app) setBoundary({ app, generation: boundary.generation + 1 });
  return <AppContext.Provider value={app}><ClientContext.Provider value={app.client}>
    <AppAccount key={`${boundary.generation}:${snapshot.viewer ?? ""}`}>{children}</AppAccount>
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

/** Initial app custody has opened successfully and an account is signed in.
 * This is admission readiness, not network availability or permission. */
export function useAppReady(): boolean {
  const app = useContext(AppContext);
  if (!app) throw new Error("useAppReady: no <AppProvider> above this component");
  const auth = useSyncExternalStore(app.auth.onChange, app.auth.getSnapshot, app.auth.getSnapshot);
  const [opened, setOpened] = useState<App | null>(null);
  useEffect(() => {
    let active = true;
    void app.ready.then(result => { if (active && result.ok) setOpened(app); }, () => {});
    return () => { active = false; };
  }, [app]);
  return opened === app && auth.state === "signed-in";
}

export function SnapbackProvider({ client, children }: { client: Client; children: ReactNode }) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): Client {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useClient: no <AppProvider> or <SnapbackProvider> above this component");
  return client;
}

/** Served capabilities follow generation changes, including when query gates are closed. */
export function useRelease(): ReleaseSnapshot {
  const client = useClient();
  const source = client.release;
  const subscribe = useCallback((notify: () => void) => source?.subscribe(notify) ?? (() => {}), [source]);
  const getSnapshot = useCallback(() => source?.getSnapshot() ?? releaseLoading, [source]);
  return useSyncExternalStore(subscribe, getSnapshot, () => releaseLoading);
}

/** The app-owned server arm; follows account changes and credential rotation. */
export function useOnline(): Online {
  const app = useContext(AppContext);
  if (!app) throw new Error("useOnline: no <AppProvider> above this component");
  return useSyncExternalStore(app.onOnlineChange, () => app.online, () => app.online);
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
  getSnapshot = (): Read<R> => this.observed?.getSnapshot() ?? this.peek() ?? (LOADING as Read<R>);
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

/** One live read. Re-renders when the value changes; never throws.
 * Mount route-owned child components only while their route is active. Unmount
 * releases this owner; keep:true still permits its existing 30-second linger.
 * Account/backend/argument keys belong to the shell. The bounded screen recipe
 * in CLIENT-AND-OPERATIONS.md also resets page/identity owners on withdrawal,
 * including generation changes. There is no inactive Read or query cache.
 * @ref LLP 3000.023#13 — tested route-owned composition before another hook option.
 */
export function useQuery<A, R>(op: Query<A, R>, args: A, options?: ReadHookOptions): Read<R> {
  const client = useClient();
  const skip = options?.skip === true;
  const key = skip ? null : readKey(op, args);
  const observed = useMemo(() => skip ? SKIPPED_READ as Observed<R> : new Observation(
    () => client.observe(op, args, observeOptions(options)),
    () => peekObservation(client, op, args, observeOptions(options))), [client, op, key, options?.keep, skip]); // eslint-disable-line react-hooks/exhaustive-deps
  return useSyncExternalStore(observed.subscribe, observed.getSnapshot, () => LOADING as Read<R>);
}

/** `useQuery`/`usePage` options: `keep` (as `client.observe`), and `skip`.
 * `skip: true` reads nothing: the hook returns `{ loading: true }` (a page:
 * no items, no more) and opens no observation, for a read whose arguments
 * do not exist yet. Pass placeholder arguments of the right type:
 * `useQuery(api.thread, { id: selected ?? "" }, { skip: !selected })`.
 * Turning `skip` off opens the read as if the hook had just mounted. */
// @ref LLP 3000.013#6.8 — conditional reads without a wrapper component; a skipped read owns nothing.
export interface ReadHookOptions extends ObserveOptions { readonly skip?: boolean }
/** The observation a skipped hook holds: always loading, never subscribed. */
const SKIPPED_READ = { getSnapshot: () => LOADING, subscribe: () => () => {}, close: () => {} } satisfies Observed<never>;
const observeOptions = (options: ReadHookOptions | undefined): ObserveOptions | undefined => {
  if (!options || !("skip" in options)) return options;
  const { skip: _skip, ...observe } = options;
  return observe;
};

/** What `useQuery(op, args)` returns, named by the operation, for props:
 * `function Header({ me }: { me: UseQuery<typeof api.myProfile> })`. A hook
 * result is the read itself; narrow it with `matchRead` or the guards. */
// @ref LLP 3000.013#6.4 — hook results are named by the operation, like UseMutation.
export type UseQuery<O> = O extends Query<any, any> ? Read<ResultOf<O>> : never;
/** What `usePage` returns: the rows of every requested page (deduplicated by
 * row id), whether another page exists, the combined read, and `loadMore`.
 * Guards take `page.read`; `matchRead` also accepts the whole page. */
export interface PageHook<R extends readonly unknown[]> {
  items: R[number][];
  hasMore: boolean;
  read: Read<R>;
  loadMore: () => void;
}
/** What `usePage(op, args)` returns, named by the operation, for props:
 * `function More({ page }: { page: UsePage<typeof api.thread> })`. */
export type UsePage<O> = O extends Query<any, any> ? ResultOf<O> extends readonly unknown[] ? PageHook<ResultOf<O>> : never : never;

/** A query `usePage` can page: it takes its cursor as `c` (`c: cursor ?` in
 * the schema) and reads `after c`. Any other query names the fix in its error. */
type PagedQuery<A, R> = Query<A, R> & ("c" extends keyof A ? unknown
  : { readonly "usePage needs a query that declares `c: cursor ?` and reads `after c`; see `snapback4 guide reads`": true });

/** Own the current requested cursor chain. A changed/withdrawn cursor releases
 * its old suffix. Mount this hook in an active route child; keep the composer
 * outside that child and bound point-reader IDs to requested pages/visible rows.
 * See the bounded screen recipe in CLIENT-AND-OPERATIONS.md.
 */
export function usePage<A, R extends readonly unknown[]>(op: PagedQuery<A, R>, args: Omit<A, "c">, options?: ReadHookOptions): PageHook<R> {
  const client = useClient();
  const skip = options?.skip === true;
  const key = skip ? null : readKey(op, args);
  const paged = op as Query<A & { c?: Cursor | null }, R>;
  const pages = useMemo(() => skip ? SKIPPED_PAGES : new Pages(client, paged, args as A & { c?: Cursor | null }, observeOptions(options)), [client, op, key, options?.keep, skip]); // eslint-disable-line react-hooks/exhaustive-deps
  const snapshot = useSyncExternalStore(pages.subscribe, pages.getSnapshot, pages.getSnapshot);
  return { items: snapshot.items as R[number][], hasMore: snapshot.hasMore, read: snapshot.read as Read<R>, loadMore: pages.loadMore };
}
/** The page chain a skipped `usePage` holds: loading, no items, nothing to load. */
const SKIPPED_PAGE_SNAPSHOT = { items: [] as never[], hasMore: false, read: LOADING };
const SKIPPED_PAGES = { subscribe: () => () => {}, getSnapshot: () => SKIPPED_PAGE_SNAPSHOT, loadMore: () => {} };

/** Complete online Following history; the SDK owns preparation and replay. */
export function useFollowing<A, R extends readonly unknown[]>(op: FollowingQuery<A, R>, args: A) {
  const client = useClient(), key = readKey(op, args);
  const following = useMemo(() => new Following(client, op, args), [client, op, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const snapshot = useSyncExternalStore(following.subscribe, following.getSnapshot, following.getSnapshot);
  return { ...snapshot, loadMore: following.loadMore, retry: following.retry, refresh: following.refresh };
}

/** A write. `run` never throws; `last` is the most recent outcome, including
 * queued settlement. A sent replay has `replayed: true` and no result. */
export interface MutationHook<A, Outcome> {
  run(args: A): Promise<Outcome>;
  last: Outcome | undefined;
  inFlight: boolean;
}
/** A durable write's hook: `run` waits for sent/failed independently of read
 * subscriptions and component lifetime. Offline it waits for reconnect.
 * Explicit `{ waitSeconds: 0 }` returns at custody; `{ id }` reuses saved intent. */
export interface WriteHook<A, R> {
  run(args: A, options?: MutateOptions): Promise<Write<R>>;
  /** Undefined before the first run. `isFailed(last)` narrows to the refusal
   * (`last.why`); `sentResult(last)` is the fresh result, if any (a replayed
   * receipt has none). */
  last: Write<R> | undefined;
  inFlight: boolean;
}
/** What `useMutation(op)` returns, named by the operation, for props:
 * `function Row({ remove }: { remove: UseMutation<typeof api.remove> })`. */
export type UseMutation<O> = O extends Ephemeral<infer A, infer R> ? MutationHook<A, Signal<R>>
  : O extends Mutation<infer A, infer R> ? WriteHook<A, R> : never;
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
    try { outcome = op.ephemeral ? await client.mutate(op, args) : await settleMutation(client, op, args, options); }
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

/** Compose rows with scoped intent cards, including success awaiting observation.
 * Pass explicit row/intent keys; a mutation id is never a row id. A predicted
 * row suppresses its card only while present. Intents carry no row authority,
 * ordinal, delivery receipt or asset handle. Rows retain their supplied order;
 * remaining intents follow in outbox order. See `snapback4 guide client`. */
export function usePendingItems<Row, M extends Mutation<any, any>>(options: PendingItemsOptions<Row, M>) {
  const client = useClient(), intents = usePendingIntents(client, write => options.writes.some(op => op.name === write.op) && options.scope(write as PendingWrite<MutationArgs<M>>));
  // Only confirmed matching rows end the online session's presentation. The
  // local device ignores these hints and owns retirement through observed writes.
  const confirmed = new Set(options.rows.filter(row => !(row as { pending?: boolean } | null)?.pending).map(options.rowKey));
  const observed = intents.filter(item => item.phase === "settling" && options.writes.some(op => op.name === item.write.op)
    && options.scope(item.write as PendingWrite<MutationArgs<M>>) && confirmed.has(options.intentKey(item.write as PendingWrite<MutationArgs<M>>))).map(item => item.write.id);
  const key = JSON.stringify(observed);
  useEffect(() => { observeIntents(client, JSON.parse(key)); }, [client, key]);
  return pendingItems(intents, options);
}

/** Select the latest admitted set-state intent without changing the mutation.
 * Read `.value` to display it and `.intent?.phase` to distinguish custody from
 * success awaiting observation. Pass the authorized `read` supplying `current`
 * for online retirement; value equality is not observation evidence.
 * Saving calls never override admitted intent. */
export function usePendingState<A, R, Value>(op: Mutation<A, R>, options: PendingStateOptions<A, Value>) {
  const client = useClient(), intents = usePendingIntents(client, write => write.op === op.name && options.scope(write as PendingWrite<A>));
  const selected = pendingState(intents, op, options);
  const matching = intents.filter(item => item.phase === "settling" && item.write.op === op.name && options.scope(item.write as PendingWrite<A>));
  const sequence = intentReadSequence(client, options.read);
  const observed = matching.filter(item => sequence !== undefined && item.receipt && item.receipt.seq <= sequence).map(item => item.write.id);
  const key = JSON.stringify(observed);
  useEffect(() => { observeIntents(client, JSON.parse(key)); }, [client, key]);
  return selected;
}

function usePendingIntents(client: Client, select: (write: PendingWrite) => boolean): readonly PendingIntent[] {
  const source = useMemo(() => pendingItemsSource(client), [client]);
  const selection = useRef(select); selection.current = select;
  const subscribe = useCallback((notify: () => void) => source.subscribe(notify, write => selection.current(write)), [source]);
  useEffect(() => source.refreshSelection(), [source, select]);
  return useSyncExternalStore(subscribe, source.getSnapshot, source.getServerSnapshot);
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
/** What `useAction(op)` returns; `UseAction<typeof api.invite>` names it for props. */
export interface ActionHook<A, R> {
  run(args: A, options?: ActOptions): Promise<Act<R>>;
  last: Act<R> | undefined;
  inFlight: boolean;
}
export type UseAction<O> = O extends Action<infer A, infer R> ? ActionHook<A, R> : never;
export function useAction<A, R>(op: Action<A, R>): ActionHook<A, R> {
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

/** The client's viewer, or null while none is signed in. Use it where signed
 * out is a state the component renders; under a signed-in gate use
 * `useSignedInViewer()`, which is never null. */
export function useViewer(): Principal | null {
  const client = useClient();
  const subscribe = useCallback((notify: () => void) => client.onViewer(() => notify()), [client]);
  return useSyncExternalStore(subscribe, client.viewer, client.viewer);
}

const noAuth = () => () => {};
const noSnapshot = () => null;
/** The signed-in viewer, never null, for a component rendered only under a
 * signed-in gate (`if (auth.state !== "signed-in") return <SignIn />`). Under
 * `<AppProvider>` it reads the same auth snapshot `useAuth()` narrows, so it
 * agrees with the gate above it; under `<SnapbackProvider>` it reads the
 * client's viewer. Rendered with no signed-in viewer it throws `E_AUTH`: that
 * is a missing gate, not a state to show. Where signed out is a state the
 * component renders, use `useViewer()` or `useAuth()`. */
// @ref LLP 3000.013#6.4 — a non-null viewer hook that reads the gate's own snapshot.
export function useSignedInViewer(): Principal {
  const app = useContext(AppContext);
  const auth = useSyncExternalStore(app ? app.auth.onChange : noAuth, app ? app.auth.getSnapshot : noSnapshot, app ? app.auth.getSnapshot : noSnapshot);
  const clientViewer = useViewer();
  const viewer = app ? (auth?.state === "signed-in" ? auth.viewer : null) : clientViewer;
  if (viewer === null) {
    const why: Refusal = { code: "E_AUTH", family: "auth", message: `useSignedInViewer: no signed-in viewer${auth ? ` (auth.state is "${auth.state}")` : ""}.`,
      rewrite: 'render this component only under `auth.state === "signed-in"` (useAuth), or call useViewer() where signed out is a state to show' };
    const gate = auth?.state === "restoring"
      ? 'Wait for restoration: `if (auth.state === "restoring") return <Loading />`; render this component only when `auth.state === "signed-in"`.'
      : 'Render it only under `auth.state === "signed-in"`, or use useViewer().';
    throw Object.assign(new Error(`E_AUTH: ${why.message} ${gate}`), { why });
  }
  return viewer;
}

/** The app for a development persona (`use personas`), owned by this
 * component: `open(persona)` runs in an effect when `persona` changes (pass
 * your own `createApp({ url, persona, device })`), the previous app closes in
 * that effect's cleanup and on unmount, and the result is `null` while no
 * persona is chosen and until the chosen persona's app exists, never the
 * previous persona's app. Render `<AppProvider app={app}>` from it and gate
 * on `useAuth().state` inside, as for any app. `open` is read when the persona
 * changes, so an inline arrow does not reopen the app on every render.
 * `const app = usePersonaApp(persona, name => createApp({ url, persona: name, device: webDevice() }))` */
// @ref LLP 3000.013#6.7 — wave 6: persona switching owned an App lifecycle every UI rewrote; one hook owns open/close.
export function usePersonaApp(persona: string | null, open: (persona: string) => App): App | null {
  const [current, setCurrent] = useState<{ readonly persona: string; readonly app: App } | null>(null);
  const opener = useRef(open);
  opener.current = open;
  useEffect(() => {
    if (!persona) return;
    const app = opener.current(persona);
    setCurrent({ persona, app });
    return () => {
      setCurrent(previous => previous?.app === app ? null : previous);
      void app.close();
    };
  }, [persona]);
  return current !== null && current.persona === persona ? current.app : null;
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

export type AssetState = { readonly status: "empty" } | { readonly status: "loading"; readonly waiting?: AssetWaiting } | { readonly status: "ready"; readonly url: string; readonly type: string; readonly name?: string } | { readonly status: "denied"; readonly why: Refusal } | { readonly status: "error"; readonly why: Refusal };

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
  const owner = useMemo(() => ({ client, signedOut, id, since: Date.now() }), [client, signedOut, id]);
  const [resolved, setResolved] = useState<{ owner: typeof owner; state: AssetState; lifetime: { live: boolean } }>();
  useEffect(() => {
    const { client, signedOut, id } = owner;
    if (!id || signedOut) return;
    let live = true, busy = false, recoveryRequested = false;
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    let diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
    let stage: AssetStage = "scheduled", since = owner.since;
    let detail: AssetProgressDetail = {};
    let interrupted: AssetWaiting["interrupted"];
    const lifetime = { live: true };
    let read: AssetRead | null = null;
    const publish = (state: AssetState) => setResolved({ owner, state, lifetime });
    const publishWaiting = () => {
      if (!live) return;
      const waiting = assetWaiting(stage, since, Date.now(), detail);
      publish({ status: "loading", waiting: interrupted ? { ...waiting, why: waiting.why ?? interrupted.why, interrupted } : waiting });
    };
    const diagnose = () => {
      clearTimeout(diagnosticTimer);
      diagnosticTimer = setTimeout(publishWaiting, Math.max(0, since + assetWaitDelay(detail) - Date.now()));
    };
    const progress = (next: AssetStage, update: AssetProgressDetail = {}) => {
      if (!live) return;
      // Snapshot from the clock and progress, not a prior React commit or timer
      // callback: the abort may supersede an uncommitted diagnostic update.
      if (next === "backoff" && stage !== next) {
        const previous = assetWaiting(stage, since, Date.now(), detail);
        interrupted = previous.why ? { ...previous, why: previous.why } : undefined;
      } else if (next !== "backoff") interrupted = undefined;
      if (stage !== next || (update.received ?? 0) > (detail.received ?? 0)) since = Date.now();
      stage = next; detail = update;
      publishWaiting(); diagnose();
    };
    const load = async () => {
      if (!live || busy || client.link() === "signed-out") return;
      clearTimeout(recoveryTimer); recoveryTimer = undefined;
      busy = true;
      since = Date.now(); progress("client");
      try {
        const result = await readAsset(client, id, progress);
        read = result;
        if (!live) {
          if ("url" in result) result.revoke();
          return;
        }
        publish("url" in result ? { status: "ready", url: result.url, type: result.type, ...(result.name === undefined ? {} : { name: result.name }) }
          : { status: assetError(result.denied) ? "error" : "denied", why: result.denied });
      } catch (error) {
        read = null;
        if (live) publish({ status: "error", why: { code: "E_CLIENT", family: "client", message: `The client did not return an asset outcome. ${error instanceof Error ? error.message : String(error)}` } });
      } finally {
        clearTimeout(diagnosticTimer);
        busy = false;
        if (recoveryRequested) { recoveryRequested = false; recover(); }
      }
    };
    const recover = () => {
      if (!live) return;
      if (busy) { recoveryRequested = true; return; }
      if (read && "denied" in read && assetError(read.denied) && read.denied.retryable === true) {
        if (Date.now() >= assetRetryAt(read.denied)) load();
        else if (recoveryTimer === undefined) recoveryTimer = setTimeout(() => {
          recoveryTimer = undefined; recover();
        }, Math.min(2_147_483_647, assetRetryAt(read.denied) - Date.now()));
      }
    };
    let link = client.link();
    const unsubscribe = client.onLink(next => { const before = link; link = next; if (next === "online" && before !== "online") recover(); });
    const visible = () => { if (globalThis.document?.visibilityState === "visible") recover(); };
    globalThis.addEventListener?.("focus", recover);
    globalThis.addEventListener?.("online", recover);
    globalThis.document?.addEventListener?.("visibilitychange", visible);
    diagnose();
    queueMicrotask(() => { if (live) void load(); });
    return () => {
      live = false; lifetime.live = false;
      clearTimeout(recoveryTimer);
      clearTimeout(diagnosticTimer);
      unsubscribe();
      globalThis.removeEventListener?.("focus", recover);
      globalThis.removeEventListener?.("online", recover);
      globalThis.document?.removeEventListener?.("visibilitychange", visible);
      if (read && "url" in read) read.revoke();
    };
  }, [owner]);
  if (!id) return { status: "empty" };
  if (signedOut) return { status: "denied", why: { code: "E_AUTH", family: "auth", message: "Sign in before loading an asset.", rewrite: "read the asset's home row with the signed-in client, then pass its asset id to useAsset", guide: "assets" } };
  return resolved?.owner === owner && resolved.lifetime.live ? resolved.state : { status: "loading", waiting: assetWaiting("scheduled", owner.since) };
}

/** Save a document on demand (LLP 3000.038): `save(id, name?)` fetches the
 * file under the viewer's credentials and hands it to the browser as a
 * download named `name` (default: the file's own name), so a list of files
 * fetches nothing until a button asks. `saving` is true while a save runs;
 * `why` keeps the last refusal. Browser only, like `saveAsset`. */
export function useSaveAsset(): { readonly save: (id: string, name?: string) => Promise<Saved>; readonly saving: boolean; readonly why: Refusal | null } {
  const client = useClient();
  const [state, setState] = useState<{ readonly running: number; readonly why: Refusal | null }>({ running: 0, why: null });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = useCallback(async (id: string, name?: string) => {
    setState(previous => ({ running: previous.running + 1, why: null }));
    let saved: Saved;
    try { saved = await saveAsset(client, id, name); }
    catch (error) { saved = { ok: false, why: { code: "E_CLIENT", family: "client", message: `the file could not be saved: ${error instanceof Error ? error.message : String(error)}` } }; }
    if (mounted.current) setState(previous => ({ running: previous.running - 1, why: saved.ok ? previous.why : saved.why }));
    return saved;
  }, [client]);
  return { save, saving: state.running > 0, why: state.why };
}

/** Opt-in development overlay data; disabled means no timer or inspection work. */
export function useInspection(enabled = false): ReadInspection | null {
  const client = useClient();
  const [sample, setSample] = useState<{ client: Client; value: ReadInspection } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => setSample({ client, value: inspect(client) });
    refresh(); const timer = setInterval(refresh, 250);
    return () => clearInterval(timer);
  }, [client, enabled]);
  return enabled && sample?.client === client ? sample.value : null;
}

/** Report only actually visible confirmed message positions. The app supplies
 * foreground/viewport visibility on web or native. Shares coalesced progress
 * and in-flight admission per client/family/scope; never pages or reports delivery.
 * Withdrawal, member replacement and final unmount discard local progress.
 * Known pre-admission refusals retry with bounded backoff; retry() wakes those
 * after repair. Other failures discard the rejected target; a different visible
 * position can start a new attempt. Admitted writes belong to the normal outbox.
 * @see LLP 3000.032 §4.3; guide receipts
 */
export function useSeen<M extends { id: string; pending?: boolean }, S extends string, T extends string>(
  family: ReceiptFamily<M, S, T>, options: SeenOptions,
): SeenSnapshot & { retry(): void } {
  const client = useClient();
  if (client.readOnly && options.active !== false) throw Object.assign(new Error("E_READ_ONLY: active useSeen requires a full session"), { why: readOnlyRefusal() });
  const owner = useMemo(() => new SeenOwner(client, family as unknown as ConstructorParameters<typeof SeenOwner>[1], options.scope), [client, family, options.scope]);
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getServerSnapshot);
  useEffect(() => { owner.update(options.through, options.active); });
  return { state: snapshot.state, through: snapshot.through, ...(snapshot.why ? { why: snapshot.why } : {}), retry: owner.retry };
}

/** The same hook works under React Native. Pass a kept id to resume its card after reload.
 * Admission resolves after the byte copy and placing mutation commit to the device. */
export function useUpload<A, R, K extends Extract<keyof A, string>>(op: Mutation<A, R>, argument: K, keptId?: string) {
  const client = useClient();
  const uploads = client as Client & import("./uploads.ts").UploadClient, available = hasUploads(client);
  const [id, setId] = useState(keptId), [state, setState] = useState<import("./uploads.ts").UploadIntent>();
  useEffect(() => { setId(keptId); }, [keptId, client]);
  useEffect(() => {
    if(!available){setState(undefined);return;}
    let alive = true, version = 0;
    const refresh = () => { const captured = ++version; if (!id) { setState(undefined); return; }
      void uploads.uploadIntent(id).then(next => { if (alive && captured === version) setState(next); }).catch(() => {}); };
    const stop = uploads.onUploads(refresh); refresh();
    return () => { alive = false; stop(); };
  }, [uploads, id, available]);
  const uploadAndPlace = useCallback(async (args: Omit<A, K>, bytes: Blob | ArrayBuffer | Uint8Array, options?: Omit<import("./uploads.ts").UploadAndPlaceOptions<K>, "argument">) => {
    const next:import("./uploads.ts").UploadIntent = available ? await uploads.uploadAndPlace(op, args, bytes, { ...options, argument }) :
      {state:"failed",id:options?.id??mintId(),why:{code:"E_UPLOAD_DEVICE",family:"client",message:"durable upload-and-place needs a device; createApp with webDevice() or nativeDevice"}};
    setId(next.id); setState(next); return next;
  }, [uploads, op, argument, available]);
  return { state, id, available, uploadAndPlace, retry: () => available && id ? uploads.retryUpload(id) : Promise.resolve(undefined),
    discard: () => available && id ? uploads.discardUpload(id) : Promise.resolve(undefined) };
}
export type { UploadIntent, UploadAndPlaceOptions } from "./uploads.ts";

export type { Saved } from "./files.ts";

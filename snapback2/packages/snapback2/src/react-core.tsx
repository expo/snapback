import { ClientPages, type PageSnapshot } from "./client-pages.js";
import { queryArgs } from "./store/canonical.js";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createClient } from "./client.js";
import { toRefusal } from "./client-wire.js";
import { viewedAssetIds } from "./client-assets.js";
import { referenceName, type Channel as ChannelRef, type Op } from "./api.js";
import { readiness, type Readiness, type Snapshot } from "./snapshot.js";
import type { HistorySnapshot, ItemRow, Items, ItemSnapshot, ItemsWithHistory } from "./client-items.js";
import {
  stableSerialize,
  type AuthApi,
  type AuthSnapshot,
  type AssetRecord,
  type AssetInput,
  type AssetUrlOptions,
  type ChannelHandle,
  type ChannelSnapshot,
  type ChannelWriteResult,
  type ClientSnapshot,
  type ConnectionState,
  type CreateClientOptions,
  type MutationResult,
  type OfflineClientOptions,
  type OutboxEntry,
  type OutboxStatus,
  type Principal,
  type Refusal,
  type SnapbackClient,
} from "./types.js";

export { initialQueryState, reduceQueryState } from "./types.js";
export type { QueryView } from "./types.js";
export { intentLabel, readiness, readinessMessages, reasonMessages, summarize } from "./snapshot.js";
export type { Readiness, ReadinessCode, Snapshot, SnapshotReasonCode, SnapshotStatus } from "./snapshot.js";

interface ProviderValue {
  client: SnapbackClient;
  snapshot: ClientSnapshot;
}

const Context = createContext<ProviderValue | null>(null);

export type SnapbackProviderProps = (
  | (CreateClientOptions & { client?: never })
  | { client: SnapbackClient; url?: never; persona?: never; token?: never; tokenStore?: never; fetch?: never; offline?: never }
) & { children: ReactNode };

/**
 * The offline options by value: the carrier factory by identity, the numbers
 * by value. A parent that renders an inline `offline={{ store, … }}` allocates
 * a new object every render; that must not allocate a new lock-holding client,
 * so the options are compared by their parts (`sameOffline`).
 */
function sameOffline(left: OfflineClientOptions | undefined, right: OfflineClientOptions | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.store === right.store
    && left.fenceDays === right.fenceDays
    && left.maxAssetBytes === right.maxAssetBytes;
}

/** The options the client is created with: the parts the client reads, by value. */
function offlineByValue(options: OfflineClientOptions): OfflineClientOptions {
  return {
    store: options.store,
    ...(options.fenceDays === undefined ? {} : { fenceDays: options.fenceDays }),
    ...(options.maxAssetBytes === undefined ? {} : { maxAssetBytes: options.maxAssetBytes }),
  };
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — React web is the first arm over the shared headless client.
export function SnapbackProvider({ client: supplied, url, persona, token, tokenStore, fetch, offline, children }: SnapbackProviderProps): React.ReactElement {
  if (persona !== undefined && (token !== undefined || tokenStore !== undefined)) {
    throw new TypeError("SnapbackProvider cannot combine dev persona `persona` with bearer token custody");
  }
  // A client opens its offline partition (and takes the principal's Web Lock)
  // the moment it is created, so it must be created exactly once per identity.
  // StrictMode double-invokes memo factories and discards one result, which
  // would leak a lock-holding client; a ref survives the re-render untouched,
  // and the identity compares `offline` by its values, not its reference.
  const identity = [supplied, url, persona, token, tokenStore, fetch] as const;
  const held = useRef<{ identity: readonly unknown[]; offline: OfflineClientOptions | undefined; client: SnapbackClient }>(undefined);
  if (!held.current
    || held.current.identity.some((item, index) => item !== identity[index])
    || !sameOffline(held.current.offline, offline)) {
    const stable = offline === undefined ? undefined : offlineByValue(offline);
    held.current = {
      identity,
      offline,
      client: supplied ?? createClient(persona !== undefined ? { url: url!, persona, fetch, offline: stable } : { url: url!, token, tokenStore, fetch, offline: stable }),
    };
  }
  const client = held.current.client;
  const [status, setStatus] = useState({ client, snapshot: client.snapshot });
  const snapshot = status.client === client ? status.snapshot : client.snapshot;
  const pendingClose = useRef<{ client: SnapbackClient; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);

  useEffect(() => {
    // StrictMode unmounts and remounts synchronously; a close deferred by one
    // tick is cancelled by the remount and still runs on a real unmount.
    if (pendingClose.current?.client === client) {
      clearTimeout(pendingClose.current.timer);
      pendingClose.current = undefined;
    }
    let active = true;
    const unsubscribe = client.subscribeStatus((snapshot) => { if (active) setStatus({ client, snapshot }); });
    setStatus({ client, snapshot: client.snapshot });
    void client.manifest().catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
      // Supplied clients belong to the caller and may outlive this provider.
      if (!supplied) pendingClose.current = { client, timer: setTimeout(() => client.close(), 0) };
    };
  }, [client, supplied]);

  return <Context.Provider value={{ client, snapshot }}>{children}</Context.Provider>;
}

function provider(): ProviderValue {
  const value = useContext(Context);
  if (!value) throw new Error("Snapback hooks require <SnapbackProvider>");
  return value;
}

/** The provider-owned client, for first-party platform components and custom transports. */
export function useSnapbackClient(): SnapbackClient {
  return provider().client;
}

export function useSnapbackSnapshot(): ClientSnapshot {
  return provider().snapshot;
}

export function useConnection(): ConnectionState {
  return provider().snapshot.connection;
}

/**
 * Reads a receipt-backed query. It subscribes by default; pass `{ live: false }`
 * for a one-shot read. Receipt state stays `complete`, `capped`, `partial`, or
 * `denied`; `live` and `connection` report the subscription transport separately.
 */
/** drain requires an ascending append log (after c first N, N <= 50); emits each page, then its tail.
 * Unsupported returned-page shapes remain refused. For newest-first data subscribe normally at c:null. */
export function useQuery<Args, Result, Row extends ItemRow, Draft, HistoryArgs, History>(
  ref: Op<Args, Result>, args: NoInfer<Args>,
  options: { live?: false; drain?: boolean; items: ItemsWithHistory<Args, Result, Row, Draft, HistoryArgs, History> },
): HistorySnapshot<Result, Row, Draft, History>;
export function useQuery<Args, Result, Row extends ItemRow, Draft>(
  ref: Op<Args, Result>, args: NoInfer<Args>,
  options: { live?: false; drain?: boolean; items: Items<Args, Result, Row, Draft> },
): ItemSnapshot<Result, Row, Draft>;
export function useQuery<Args, Result>(
  ref: Op<Args, Result>, args: NoInfer<Args>, options?: { live?: false; drain?: boolean; items?: undefined },
): Snapshot<Result>;
export function useQuery<Args, Result, Row extends ItemRow, Draft>(
  ref: Op<Args, Result>,
  args: NoInfer<Args>,
  options: { live?: false; drain?: boolean; items?: Items<Args, Result, Row, Draft> } = {},
): Snapshot<Result> {
  const { client, snapshot } = provider();
  const argsKey = stableSerialize(queryArgs(args));
  const stableArgs = useMemo(() => args, [argsKey]);
  const live = options.live !== false;
  if (!live && options.drain) throw new TypeError("useQuery drain requires a live subscription");
  const operation = referenceName(ref);
  const restoring = !!snapshot.token && snapshot.auth.state === "hydrating";
  const observed = useMemo(
    () => client.observe(ref, stableArgs, { ...options } as { live?: false; drain?: boolean; items: Items<Args, Result, Row, Draft> }),
    [client, snapshot.authGeneration, operation, argsKey, live, options.drain, options.items, restoring],
  );
  const state = useSyncExternalStore(observed.subscribe, observed.getSnapshot, observed.getSnapshot);
  return state;
}

export type { PageSnapshot } from "./client-pages.js";
// @ref LLP 1018.003#the-plain-tier — paging owns live observations, not a screen's cursor array.
export function usePage<Args, Result extends readonly unknown[], Key extends string = "c">(
  ref: Op<Args, Result>, args: NoInfer<Omit<Args, Key>>, options: { cursor?: Key } = {},
): PageSnapshot<Result> {
  const { client, snapshot } = provider();
  const cursor = options.cursor ?? "c", operation = referenceName(ref);
  const argsKey = stableSerialize(args);
  const pages = useMemo(() => new ClientPages(client, ref, structuredClone(args), cursor),
    [client, snapshot.authGeneration, operation, argsKey, cursor]);
  return useSyncExternalStore(pages.subscribe, pages.getSnapshot, pages.getSnapshot);
}

export interface UseMutationResult<Args, Result> {
  run(args: AssetInput<Args>): Promise<MutationResult<Result>>;
  /** A `run()` is awaiting the owner right now. */
  inFlight: boolean;
  /** Whether `run()` can be accepted now, and what the user can do if not (LLP 1018.003 §2). */
  can: Readiness;
  last: MutationResult<Result> | undefined;
}

/** The durable outbox of the open partition, FIFO, with `dismiss` for settled intents. */
export interface UseOutboxResult {
  entries: OutboxEntry[];
  /** Grant-present readiness: no particular write bound is implied. */
  can: Readiness;
  detail: { status: OutboxStatus; writer?: OutboxStatus };
  dismiss(intent: string): Promise<void>;
}

// @ref LLP 1012#7-writes-offline — the outbox opens before the first request,
// so a queued message is on screen at cold start before the network is tried.
// @ref LLP 1018.003#4-pending-rows-attribution-settlement-and-failure — the runtime
// exposes terminal history until explicit dismissal. Query items independently
// resolve their indicators from the displayed target's observation evidence.
function useOutboxState(op?: Op<any, any>): UseOutboxResult {
  const { client, snapshot } = provider();
  const operation = op === undefined ? undefined : referenceName(op);
  const identity = useMemo(() => ({}), [client, snapshot.authGeneration, operation]);
  const observed = useMemo(() => client.outbox.observe(op), [identity]);
  const { entries, status, writer } = useSyncExternalStore(observed.subscribe, observed.getSnapshot, observed.getSnapshot);
  const dismiss = useCallback((intent: string) => client.outbox.dismiss(intent), [client]);
  const queued = useMemo(
    () => entries.filter((entry) => entry.state === "queued" && (operation === undefined || entry.op === operation)).length,
    [entries, operation],
  );
  const can = useMemo(() => readiness(status, snapshot.connection, queued), [status, snapshot.connection, queued]);
  return useMemo(() => ({ entries, can, detail: { status, ...(writer === undefined ? {} : { writer }) }, dismiss }), [entries, can, status, writer, dismiss]);
}

export function useOutbox(): UseOutboxResult {
  return useOutboxState();
}

export function useMutation<Args, Result>(ref: Op<Args, Result>): UseMutationResult<Args, Result> {
  const { client, snapshot } = provider();
  const operation = referenceName(ref);
  const identity = useMemo(() => ({ client, generation: snapshot.authGeneration, operation }), [client, snapshot.authGeneration, operation]);
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const { can } = useOutboxState(ref);
  const [machine, setMachine] = useState<{
    identity: typeof identity;
    pending: number;
    last?: MutationResult<Result>;
  }>({ identity, pending: 0 });
  const visible = machine.identity === identity
    ? machine
    : { identity, pending: 0 };
  const run = useCallback(async (args: AssetInput<Args>) => {
    const active = () => activeIdentity.current === identity && client.snapshot.authGeneration === identity.generation;
    if (active()) setMachine((current) => current.identity === identity
      ? { ...current, pending: current.pending + 1 }
      : { identity, pending: 1 });
    try {
      const result = await client.mutation(ref, args);
      if (active()) setMachine((current) => ({
        identity,
        pending: current.identity === identity ? current.pending : 0,
        last: result,
      }));
      return result;
    } catch (error) {
      const result = { state: "rejected" as const, ...toRefusal(error) };
      if (active()) setMachine(current => ({ ...current, last: result }));
      return result;
    } finally {
      if (active()) setMachine((current) => current.identity === identity
        ? { ...current, pending: Math.max(0, current.pending - 1) }
        : current);
    }
  }, [identity, ref]);
  return useMemo(
    () => ({ run, inFlight: visible.pending > 0, can, last: visible.last }),
    [run, visible.pending, can, visible.last],
  );
}

export type AuthHookState = AuthSnapshot["state"];
export interface UseAuthResult extends AuthSnapshot, AuthApi { token?: string }

export function useAuth(): UseAuthResult {
  const { client, snapshot } = provider();
  // Bearer restoration starts in the client. A persona or a client with no
  // stored token keeps the lazy owner check; every hook joins that same flight.
  useEffect(() => {
    let active = true;
    void client.ready.then(() => {
      if (active && !client.snapshot.token && client.snapshot.auth.state === "hydrating") return client.auth.me();
    }).catch(() => undefined);
    return () => { active = false; };
  }, [client]);
  return { ...snapshot.auth, token: snapshot.token, ...client.auth };
}

export interface UseChannelResult<Value> extends ChannelSnapshot<Value> {
  set(value: Value): Promise<ChannelWriteResult>;
  clear(): Promise<ChannelWriteResult>;
}

export function useChannel<Args, Value>(ref: ChannelRef<Args, Value>, args: NoInfer<Args>): UseChannelResult<Value> {
  const { client, snapshot } = provider();
  const argsKey = stableSerialize(args);
  const room = useMemo(
    () => client.channel<Args, Value>(ref, args),
    [client, snapshot.authGeneration, referenceName(ref), argsKey],
  );
  const pendingClose = useRef<{ room: ChannelHandle<Value>; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  useEffect(() => {
    if (pendingClose.current?.room === room) {
      clearTimeout(pendingClose.current.timer);
      pendingClose.current = undefined;
    }
    return () => { pendingClose.current = { room, timer: setTimeout(() => room.close(), 0) }; };
  }, [room]);
  const subscribe = useCallback((notify: () => void) => {
    const observation = room.subscribe(notify);
    return () => observation.close();
  }, [room]);
  const state = useSyncExternalStore(subscribe, room.getSnapshot, room.getSnapshot);
  return useMemo(() => ({ ...state, set: room.set, clear: room.clear }), [state, room]);
}

type AssetUrlValue = string | (string | undefined)[] | undefined;

/**
 * Resolves records without putting authority in image URLs. A carrier is minted
 * only when explicitly requested for a player/download that cannot send headers.
 */
// @ref LLP 1006#2b-the-session-carrier-author-ruling-2026-09-03 — refreshes
// affect newly resolved URLs only; an already returned player src is immutable.
export function useAssetUrl(asset: AssetRecord | null | undefined, options?: AssetUrlOptions): string | undefined;
export function useAssetUrl(assets: readonly AssetRecord[], options?: AssetUrlOptions): (string | undefined)[] | undefined;
export function useAssetUrl(
  assetOrList: AssetRecord | readonly AssetRecord[] | null | undefined,
  options: AssetUrlOptions = {},
): AssetUrlValue {
  const { client, snapshot } = provider();
  // A blob: URL belongs to one client identity on one partition: a new client or an
  // auth transition (login, logout, expiry) re-runs the effect, which revokes and re-mints.
  const key = stableSerialize({
    assets: Array.isArray(assetOrList)
      ? assetOrList.map((asset) => asset.id)
      : assetOrList == null ? null : (assetOrList as AssetRecord).id,
    width: options.width,
    carrier: options.carrier === true,
    download: options.download === true,
    authGeneration: snapshot.authGeneration,
  });
  const stableAsset = useMemo(() => assetOrList, [key]);
  const identity = useMemo(() => ({ client, key }), [client, key]);
  const [resolved, setResolved] = useState<{ identity: typeof identity; value?: AssetUrlValue }>({ identity });
  const value = resolved.identity === identity ? resolved.value : undefined;
  useEffect(() => {
    let active = true;
    const created: string[] = [];
    const list: readonly AssetRecord[] = Array.isArray(stableAsset)
      ? stableAsset
      : stableAsset == null ? [] : [stableAsset as AssetRecord];
    // @ref LLP 1012#9-asset-bytes-on-the-device — a rendition the byte cache holds
    // answers as a blob: URL before any network URL or carrier is minted, and a viewed
    // view-once row gets no URL at all: the guard is the one `assetBlob` applies.
    void (async () => {
      await client.ready;
      const cache = client.assetCache;
      const objectUrls = typeof URL.createObjectURL === "function";
      const held = await Promise.all(list.map((asset) => objectUrls ? cache?.get(asset.id, options.width ?? null) : undefined));
      const missing = list.filter((_asset, index) => held[index] === undefined);
      const viewed = await viewedAssetIds(cache, missing.map((asset) => asset.id));
      const mintable = missing.filter((asset) => !viewed.has(asset.id));
      // A viewed guard can drop an entry during minting; preserve each asset's position.
      const minted = await Promise.all(mintable.map((asset) => client.assetUrl(asset, options)));
      const mintedById = new Map(mintable.map((asset, index) => [asset.id, minted[index]]));
      const urls = list.map((asset, index) => {
        const blob = held[index];
        if (!blob) return mintedById.get(asset.id);
        const url = URL.createObjectURL(blob);
        created.push(url);
        return url;
      });
      if (!active) {
        for (const url of created) URL.revokeObjectURL(url);
        return;
      }
      setResolved({ identity, value: Array.isArray(stableAsset) ? urls : urls[0] });
    })().catch(() => undefined);
    return () => {
      active = false;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [identity, stableAsset, options.width, options.carrier, options.download]);
  return value;
}

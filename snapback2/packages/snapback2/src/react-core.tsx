import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient, isSnapbackRefusal, type SnapbackRefusal } from "./client.js";
import { viewedAssetIds } from "./client-assets.js";
import { referenceName, type Channel as ChannelRef, type Op } from "./api.js";
import {
  initialQueryState,
  reduceQueryState,
  stableSerialize,
  type AuthApi,
  type AuthSnapshot,
  type AssetRecord,
  type AssetInput,
  type AssetUrlOptions,
  type ChannelHandle,
  type ClientSnapshot,
  type ConnectionState,
  type CreateClientOptions,
  type MutationResult,
  type OfflineClientOptions,
  type OutboxEntry,
  type OutboxStatus,
  type Principal,
  type QueryHookResult,
  type QueryMachineEvent,
  type QueryView,
  type RefusalEnvelope,
  type SnapbackClient,
} from "./types.js";

export { initialQueryState, reduceQueryState } from "./types.js";
export type { QueryView, QueryViewState } from "./types.js";

interface ProviderValue {
  client: SnapbackClient;
  snapshot: ClientSnapshot;
}

const Context = createContext<ProviderValue | null>(null);

export type SnapbackProviderProps = (
  | (CreateClientOptions & { client?: never })
  | { client: SnapbackClient; url?: never; as?: never; token?: never; tokenStore?: never; fetch?: never; offline?: never }
) & { children: ReactNode };

/**
 * The offline options by value: the carrier factory by identity, the numbers
 * by value. A parent that renders an inline `offline={{ store, onTombstone:
 * (row) => … }}` allocates a new object and new closures every render; that
 * must not allocate a new lock-holding client, so the callbacks are read
 * through a ref the runtime calls into (`throughRef`) and never compared.
 */
function sameOffline(left: OfflineClientOptions | undefined, right: OfflineClientOptions | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.store === right.store
    && left.fenceDays === right.fenceDays
    && left.maxAssetBytes === right.maxAssetBytes;
}

/** The options the client is created with: stable wrappers that call the latest callbacks the parent rendered. */
function throughRef(latest: { current: OfflineClientOptions | undefined }, options: OfflineClientOptions): OfflineClientOptions {
  return {
    store: options.store,
    ...(options.fenceDays === undefined ? {} : { fenceDays: options.fenceDays }),
    ...(options.maxAssetBytes === undefined ? {} : { maxAssetBytes: options.maxAssetBytes }),
    onTombstone: (row) => latest.current?.onTombstone?.(row) ?? [],
    viewOnce: (table, row) => latest.current?.viewOnce?.(table, row) ?? false,
  };
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — React web is the first arm over the shared headless client.
export function SnapbackProvider({ client: supplied, url, as, token, tokenStore, fetch, offline, children }: SnapbackProviderProps): React.ReactElement {
  if (as !== undefined && (token !== undefined || tokenStore !== undefined)) {
    throw new TypeError("SnapbackProvider cannot combine dev persona `as` with bearer token custody");
  }
  // A client opens its offline partition (and takes the principal's Web Lock)
  // the moment it is created, so it must be created exactly once per identity.
  // StrictMode double-invokes memo factories and discards one result, which
  // would leak a lock-holding client; a ref survives the re-render untouched,
  // and the identity compares `offline` by its values, not its reference.
  const identity = [supplied, url, as, token, tokenStore, fetch] as const;
  const latestOffline = useRef<OfflineClientOptions | undefined>(offline);
  latestOffline.current = offline;
  const held = useRef<{ identity: readonly unknown[]; offline: OfflineClientOptions | undefined; client: SnapbackClient }>(undefined);
  if (!held.current
    || held.current.identity.some((item, index) => item !== identity[index])
    || !sameOffline(held.current.offline, offline)) {
    const stable = offline === undefined ? undefined : throughRef(latestOffline, offline);
    held.current = {
      identity,
      offline,
      client: supplied ?? createClient(as !== undefined ? { url: url!, as, fetch, offline: stable } : { url: url!, token, tokenStore, fetch, offline: stable }),
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
export function useQuery<Args, Result>(
  ref: Op<Args, Result>,
  args: NoInfer<Args>,
  options: { live?: false; drain?: boolean } = {},
): QueryHookResult<Result> {
  const { client, snapshot } = provider();
  const argsKey = stableSerialize(args);
  const stableArgs = useMemo(() => args, [argsKey]);
  const live = options.live !== false;
  if (!live && options.drain) throw new TypeError("useQuery drain requires a live subscription");
  const operation = referenceName(ref);
  const identity = useMemo(
    () => ({ client, key: `${snapshot.authGeneration}:${operation}:${argsKey}:${live}:${options.drain === true}` }),
    [client, snapshot.authGeneration, operation, argsKey, live, options.drain],
  );
  const [machine, dispatch] = useReducer(
    (
      current: { identity: typeof identity; view: QueryView<Result> },
      action: { identity: typeof identity; event: QueryMachineEvent<Result> },
    ) => ({
      identity: action.identity,
      view: reduceQueryState(
        current.identity === action.identity ? current.view : initialQueryState<Result>(),
        action.event,
      ),
    }),
    { identity, view: initialQueryState<Result>() },
  );
  const state = machine.identity === identity ? machine.view : initialQueryState<Result>();
  const restoring = !!snapshot.token && snapshot.auth.state === "hydrating";

  useEffect(() => {
    let active = true;
    if (live) {
      const subscription = client.subscribe(ref, stableArgs, (delivery) => {
        if (active) dispatch({ identity, event: delivery });
      }, { drain: options.drain });
      return () => {
        active = false;
        subscription.close();
      };
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let backoff = 250;
      while (active) {
        try {
          const result = await client.query(ref, stableArgs);
          if (active) dispatch({ identity, event: result });
          return;
        } catch (error) {
          if (!active) return;
          if (isSnapbackRefusal(error) && error.code === "E_AUTH_SUPERSEDED") return;
          if (isSnapbackRefusal(error) && error.retryable) {
            await new Promise<void>((resolve) => { timer = setTimeout(resolve, backoff); });
            backoff = Math.min(backoff * 2, 5_000);
            continue;
          }
          const envelope = isSnapbackRefusal(error)
            ? error.envelope
            : { code: "E_CLIENT", family: "owner", message: String(error), guide: "owner/connect" };
          dispatch({ identity, event: { state: "refused", live: false, ...envelope } });
          return;
        }
      }
    })();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [identity, stableArgs, restoring]);

  return useMemo(() => ({ ...state, connection: snapshot.connection }), [state, snapshot.connection]);
}

export function useSubscription<Args, Result>(
  ref: Op<Args, Result>,
  args: NoInfer<Args>,
): QueryHookResult<Result> {
  return useQuery(ref, args);
}

export interface UseMutationResult<Args, Result> {
  run(args: AssetInput<Args>): Promise<MutationResult<Result>>;
  /** A `run()` is awaiting the owner right now. */
  inFlight: boolean;
  /** This op's intents still queued in the durable outbox, FIFO (LLP 1012 §7). */
  pending: OutboxEntry[];
  /**
   * `run()` will not refuse `E_OFFLINE_ID_BLOCK` for want of a replay grant, a
   * known bound, or capacity for `1 + maxNewIds`: no partition, or one holding a
   * current grant this write fits. False until the device has all three (the
   * first drain reaching its watermark, or a login, earns the grant); gate the
   * send on it rather than retrying the refusal (LLP 1012 §7).
   */
  ready: boolean;
  status: OutboxStatus;
  last: MutationResult<Result> | undefined;
  transport: SnapbackRefusal | undefined;
}

/** The durable outbox of the open partition, FIFO, with `dismiss` for settled intents. */
export interface UseOutboxResult {
  entries: OutboxEntry[];
  /** Grant-present readiness (`client.outbox.ready()`): no particular write bound is implied, and the fence does not gate it. */
  ready: boolean;
  status: OutboxStatus;
  /** Past means queued until this partition resumes; accepting writes remains enabled. */
  fence: "inside" | "past";
  dismiss(intent: string): Promise<void>;
}

// @ref LLP 1012#7-writes-offline — the outbox opens before the first request,
// so a queued message is on screen at cold start before the network is tried.
function useOutboxState(op?: Op<any, any>): UseOutboxResult {
  const { client, snapshot } = provider();
  const operation = op === undefined ? undefined : referenceName(op);
  const identity = useMemo(() => ({}), [client, snapshot.authGeneration, operation]);
  const initial: OutboxStatus = { ready: false, reason: "grant-missing", action: "resume", remaining: 0, fence: "inside" };
  const [state, setState] = useState<{ identity?: object; entries: OutboxEntry[]; status: OutboxStatus }>({ entries: [], status: initial });
  useEffect(() => {
    let active = true;
    let probe = 0;
    const unsubscribe = client.outbox.subscribe((entries) => {
      const current = ++probe;
      const publish = (status: OutboxStatus) => {
        if (active && current === probe) setState({ identity, entries, status });
      };
      void client.outbox.status(op).then(publish, () => publish({ ...initial, reason: "sealed", action: "login", fence: "past" }));
    });
    return () => { active = false; unsubscribe(); };
  }, [identity]);
  const dismiss = useCallback((intent: string) => client.outbox.dismiss(intent), [client]);
  return useMemo(() => ({ entries: state.identity === identity ? state.entries : [],
    ready: state.identity === identity && state.status.ready,
    status: state.identity === identity ? state.status : initial,
    fence: state.identity === identity ? state.status.fence : "inside", dismiss }), [state, identity, dismiss]);
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
  const { entries, ready, status } = useOutboxState(ref);
  const pending = useMemo(
    () => entries.filter((entry) => entry.op === operation && entry.state === "queued"),
    [entries, operation],
  );
  const [machine, setMachine] = useState<{
    identity: typeof identity;
    pending: number;
    last?: MutationResult<Result>;
    transport?: SnapbackRefusal;
  }>({ identity, pending: 0 });
  const visible = machine.identity === identity
    ? machine
    : { identity, pending: 0 };
  const run = useCallback(async (args: AssetInput<Args>) => {
    const active = () => activeIdentity.current === identity && client.snapshot.authGeneration === identity.generation;
    if (!active()) return client.mutation(ref, args);
    setMachine((current) => current.identity === identity
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
      if (active() && isSnapbackRefusal(error) && error.retryable) {
        setMachine((current) => current.identity === identity
          ? { ...current, transport: error }
          : { identity, pending: 0, transport: error });
      }
      throw error;
    } finally {
      if (active()) setMachine((current) => current.identity === identity
        ? { ...current, pending: Math.max(0, current.pending - 1) }
        : current);
    }
  }, [identity]);
  return useMemo(
    () => ({ run, inFlight: visible.pending > 0, pending, ready, status, last: visible.last, transport: visible.transport }),
    [run, visible.pending, pending, ready, status, visible.last, visible.transport],
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

export function useChannel<Args, Payload = unknown>(ref: ChannelRef<Args, Payload>, args: NoInfer<Args>): ChannelHandle<Payload> {
  const { client, snapshot } = provider();
  const argsKey = stableSerialize(args);
  return useMemo(
    () => client.channel<Args, Payload>(ref, args),
    [client, snapshot.authGeneration, referenceName(ref), argsKey],
  );
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

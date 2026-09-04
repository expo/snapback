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
import { referenceName, type Channel as ChannelRef, type Op } from "./api.js";
import {
  initialQueryState,
  reduceQueryState,
  stableSerialize,
  type AuthMe,
  type AuthSession,
  type AssetRecord,
  type AssetInput,
  type AssetUrlOptions,
  type ChannelHandle,
  type ClientSnapshot,
  type ConnectionState,
  type CreateClientOptions,
  type MutationResult,
  type ImageAsset,
  type Principal,
  type QueryHookResult,
  type QueryMachineEvent,
  type QueryView,
  type RefusalEnvelope,
  type SnapbackClient,
  type VideoAsset,
} from "./types.js";

export { initialQueryState, reduceQueryState } from "./types.js";
export type { QueryView, QueryViewState } from "./types.js";

interface ProviderValue {
  client: SnapbackClient;
  snapshot: ClientSnapshot;
}

const Context = createContext<ProviderValue | null>(null);

export type SnapbackProviderProps = CreateClientOptions & {
  children: ReactNode;
};

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — React web is the first arm over the shared headless client.
export function SnapbackProvider({ url, as, token, tokenStore, fetch, children }: SnapbackProviderProps): React.ReactElement {
  if (as !== undefined && (token !== undefined || tokenStore !== undefined)) {
    throw new TypeError("SnapbackProvider cannot combine dev persona `as` with bearer token custody");
  }
  const client = useMemo(
    () => createClient(as !== undefined
      ? { url, as, fetch }
      : { url, token, tokenStore, fetch }),
    [url, as, token, tokenStore, fetch],
  );
  const [snapshot, setSnapshot] = useState<ClientSnapshot>(client.snapshot);

  useEffect(() => {
    const unsubscribe = client.subscribeStatus(setSnapshot);
    void client.manifest().catch(() => undefined);
    return () => {
      unsubscribe();
      client.close();
    };
  }, [client]);

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
  options: { live?: false } = {},
): QueryHookResult<Result> {
  const { client, snapshot } = provider();
  const argsKey = stableSerialize(args);
  const stableArgs = useMemo(() => args, [argsKey]);
  const live = options.live !== false;
  const operation = referenceName(ref);
  const identity = useMemo(
    () => ({ client, key: `${snapshot.authGeneration}:${operation}:${argsKey}:${live}` }),
    [client, snapshot.authGeneration, operation, argsKey, live],
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

  useEffect(() => {
    let active = true;
    if (live) {
      const subscription = client.subscribe(ref, stableArgs, (delivery) => {
        if (active) dispatch({ identity, event: delivery });
      });
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
  }, [identity, stableArgs]);

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
  pending: boolean;
  last: MutationResult<Result> | undefined;
  transport: SnapbackRefusal | undefined;
}

export function useMutation<Args, Result>(ref: Op<Args, Result>): UseMutationResult<Args, Result> {
  const { client, snapshot } = provider();
  const [machine, setMachine] = useState<{
    generation: number;
    pending: number;
    last?: MutationResult<Result>;
    transport?: SnapbackRefusal;
  }>({ generation: snapshot.authGeneration, pending: 0 });
  const visible = machine.generation === snapshot.authGeneration
    ? machine
    : { generation: snapshot.authGeneration, pending: 0 };
  const run = useCallback(async (args: AssetInput<Args>) => {
    const startedGeneration = client.snapshot.authGeneration;
    setMachine((current) => current.generation === startedGeneration
      ? { ...current, pending: current.pending + 1 }
      : { generation: startedGeneration, pending: 1 });
    try {
      const result = await client.mutation(ref, args);
      const generation = client.snapshot.authGeneration;
      setMachine((current) => ({
        generation,
        pending: current.generation === generation ? current.pending : 0,
        last: result,
      }));
      return result;
    } catch (error) {
      if (isSnapbackRefusal(error) && error.retryable) {
        const generation = client.snapshot.authGeneration;
        setMachine((current) => current.generation === generation
          ? { ...current, transport: error }
          : { generation, pending: 0, transport: error });
      }
      throw error;
    } finally {
      setMachine((current) => current.generation === startedGeneration
        ? { ...current, pending: Math.max(0, current.pending - 1) }
        : current);
    }
  }, [client, referenceName(ref)]);
  return useMemo(
    () => ({ run, pending: visible.pending > 0, last: visible.last, transport: visible.transport }),
    [run, visible.pending, visible.last, visible.transport],
  );
}

export type AuthHookState = "hydrating" | "authenticated" | "anonymous" | "refused";
export interface UseAuthResult {
  state: AuthHookState;
  viewer?: Principal;
  kind?: string;
  token?: string;
  refusal?: RefusalEnvelope;
  signup(input: { email: string; password: string }): Promise<AuthSession>;
  login(input: { email: string; password: string }): Promise<AuthSession>;
  guest(): Promise<AuthSession>;
  logout(): Promise<{ ok: boolean }>;
  me(): Promise<AuthMe>;
}

export function useAuth(): UseAuthResult {
  const { client, snapshot } = provider();
  const requestEpoch = useRef(0);
  const activeClient = useRef(client);
  if (activeClient.current !== client) {
    activeClient.current = client;
    requestEpoch.current += 1;
  }
  type AuthState = Omit<UseAuthResult, "signup" | "login" | "guest" | "logout" | "me">;
  const [machine, setMachine] = useState<{ generation: number; value: AuthState }>({
    generation: snapshot.authGeneration,
    value: { state: "hydrating", token: snapshot.token },
  });
  const state = machine.generation === snapshot.authGeneration
    ? machine.value
    : { state: "hydrating" as const, token: snapshot.token };
  const me = useCallback(async () => {
    const generation = snapshot.authGeneration;
    const epoch = ++requestEpoch.current;
    try {
      const value = await client.auth.me();
      if (epoch === requestEpoch.current
        && activeClient.current === client
        && client.snapshot.authGeneration === generation) {
        setMachine({ generation, value: { state: "authenticated", ...value, token: client.snapshot.token } });
      }
      return value;
    } catch (error) {
      if (epoch === requestEpoch.current
        && activeClient.current === client
        && client.snapshot.authGeneration === generation) {
        if (isSnapbackRefusal(error)
          && (error.code === "E_AUTH" || error.code === "E_AUTH_REQUIRED" || error.code === "E_AUTH_SESSION")) {
          setMachine({ generation, value: { state: "anonymous", refusal: error.envelope } });
        } else if (!isSnapbackRefusal(error) || error.code !== "E_AUTH_SUPERSEDED") {
          const refusal = isSnapbackRefusal(error) ? error.envelope : undefined;
          setMachine({ generation, value: { state: "refused", refusal, token: client.snapshot.token } });
        }
      }
      throw error;
    }
  }, [client, snapshot.authGeneration]);

  useEffect(() => {
    void me().catch(() => undefined);
    return () => {
      requestEpoch.current += 1;
    };
  }, [me]);

  const establish = useCallback(async (action: () => Promise<AuthSession>) => {
    return action();
  }, []);

  return {
    ...state,
    token: snapshot.token,
    signup: (input) => establish(() => client.auth.signup(input)),
    login: (input) => establish(() => client.auth.login(input)),
    guest: () => establish(() => client.auth.guest()),
    logout: async () => {
      requestEpoch.current += 1;
      const result = await client.auth.logout();
      if (activeClient.current === client) {
        requestEpoch.current += 1;
        const generation = client.snapshot.authGeneration;
        setMachine({ generation, value: { state: "anonymous" } });
      }
      return result;
    },
    me,
  };
}

export function useChannel<Args, Payload = unknown>(ref: ChannelRef<Args, Payload>, args: NoInfer<Args>): ChannelHandle<Payload> {
  const { client, snapshot } = provider();
  const argsKey = stableSerialize(args);
  return useMemo(
    () => client.channel<Args, Payload>(ref, args),
    [client, snapshot.authGeneration, referenceName(ref), argsKey],
  );
}

type AssetUrlValue = string | string[] | undefined;

/**
 * Resolves records without putting authority in image URLs. A carrier is minted
 * only when explicitly requested for a player/download that cannot send headers.
 */
// @ref LLP 1006#2b-the-session-carrier-author-ruling-2026-09-03 — refreshes
// affect newly resolved URLs only; an already returned player src is immutable.
export function useAssetUrl(asset: AssetRecord | null | undefined, options?: AssetUrlOptions): string | undefined;
export function useAssetUrl(assets: readonly AssetRecord[], options?: AssetUrlOptions): string[] | undefined;
export function useAssetUrl(
  assetOrList: AssetRecord | readonly AssetRecord[] | null | undefined,
  options: AssetUrlOptions = {},
): AssetUrlValue {
  const client = useSnapbackClient();
  const key = stableSerialize({
    assets: Array.isArray(assetOrList)
      ? assetOrList.map((asset) => asset.id)
      : assetOrList == null ? null : (assetOrList as AssetRecord).id,
    width: options.width,
    carrier: options.carrier === true,
    download: options.download === true,
  });
  const stableAsset = useMemo(() => assetOrList, [key]);
  const identity = useMemo(() => ({ client, key }), [client, key]);
  const [resolved, setResolved] = useState<{ identity: typeof identity; value?: AssetUrlValue }>({ identity });
  const value = resolved.identity === identity ? resolved.value : undefined;
  useEffect(() => {
    let active = true;
    const request = Array.isArray(stableAsset)
      ? client.assetUrl(stableAsset, options)
      : client.assetUrl(stableAsset as AssetRecord | null | undefined, options);
    void request
      .then((next) => {
        if (active) setResolved({ identity, value: next });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [identity, stableAsset, options.width, options.carrier, options.download]);
  return value;
}

export type AssetImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & {
  asset: ImageAsset;
  width?: number | string;
  height?: number | string;
};

// @ref LLP 1006#8-sizes-ask-for-any-width — the web image measures its box,
// asks for device pixels, and keeps intrinsic record dimensions before bytes arrive.
export function AssetImage({ asset, width, height, style, ...props }: AssetImageProps): React.ReactElement {
  const { client, snapshot } = provider();
  const [element, setElement] = useState<HTMLImageElement | null>(null);
  const [requestedWidth, setRequestedWidth] = useState<number>();
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    if (!element) return;
    const update = (layoutWidth: number) => {
      const fallback = typeof width === "number" ? width : asset.width;
      const cssWidth = layoutWidth > 0 ? layoutWidth : fallback;
      const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
      setRequestedWidth(Math.max(1, Math.ceil(cssWidth * ratio)));
      setMeasured(true);
    };
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => update(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, width, asset.id, asset.width]);
  const deliveryUrl = useAssetUrl(measured ? asset : null, { width: requestedWidth });
  const [blobUrl, setBlobUrl] = useState<string>();
  useEffect(() => {
    if (!deliveryUrl || typeof URL.createObjectURL !== "function") return;
    let active = true;
    let created: string | undefined;
    const controller = new AbortController();
    setBlobUrl(undefined);
    void client.assetBlob(deliveryUrl, { signal: controller.signal }).then((blob) => {
      created = URL.createObjectURL(blob);
      if (active) setBlobUrl(created);
      else URL.revokeObjectURL(created);
    }).catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [client, deliveryUrl, snapshot.authGeneration]);
  return <img
    {...props}
    ref={setElement}
    src={blobUrl}
    width={width ?? asset.width}
    height={height ?? asset.height}
    style={{ aspectRatio: `${asset.width} / ${asset.height}`, ...style }}
  />;
}

export type AssetVideoProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, "src" | "width" | "height"> & {
  asset: VideoAsset;
  width?: number | string;
  height?: number | string;
};

// @ref LLP 1006#10-clients — video streams directly with a carrier because a
// native player/video element cannot send the session header or wait for a blob.
export function AssetVideo({ asset, width, height, style, controls, ...props }: AssetVideoProps): React.ReactElement {
  const url = useAssetUrl(asset, { carrier: true });
  return <video
    {...props}
    controls={controls ?? true}
    src={url}
    width={width ?? asset.width}
    height={height ?? asset.height}
    style={{ aspectRatio: `${asset.width} / ${asset.height}`, ...style }}
  />;
}

export function DevOverlay(): React.ReactElement {
  const { snapshot } = provider();
  const refusal = snapshot.lastRefusal;
  return (
    <aside aria-label="Snapback development status">
      <strong>Snapback</strong>
      <dl>
        <dt>Persona</dt><dd>{snapshot.persona ?? "token"}</dd>
        <dt>Connection</dt><dd>{snapshot.connection}</dd>
        <dt>Generation</dt><dd>{snapshot.generation ?? "—"}</dd>
        <dt>Last refusal</dt><dd>{refusal ? `${refusal.code}: ${refusal.message}` : "—"}</dd>
      </dl>
    </aside>
  );
}

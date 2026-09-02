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
  type ChannelHandle,
  type ClientSnapshot,
  type ConnectionState,
  type CreateClientOptions,
  type MutationResult,
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
  run(args: Args): Promise<MutationResult<Result>>;
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
  const run = useCallback(async (args: Args) => {
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

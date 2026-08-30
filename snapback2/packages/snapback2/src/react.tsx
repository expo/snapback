import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
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

export interface SnapbackProviderProps {
  url: string;
  as?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
  children: ReactNode;
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — React web is the first arm over the shared headless client.
export function SnapbackProvider({ url, as, token, fetch, children }: SnapbackProviderProps): React.ReactElement {
  const client = useMemo(() => createClient({ url, as, token, fetch }), [url, as, token, fetch]);
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
  const identity = useMemo(() => ({ client, key: `${operation}:${argsKey}:${live}` }), [client, operation, argsKey, live]);
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
  const { client } = provider();
  const [last, setLast] = useState<MutationResult<Result>>();
  const [transport, setTransport] = useState<SnapbackRefusal>();
  const [pendingCount, setPendingCount] = useState(0);
  const run = useCallback(async (args: Args) => {
    setPendingCount((value) => value + 1);
    try {
      const result = await client.mutation(ref, args);
      setLast(result);
      setTransport(undefined);
      return result;
    } catch (error) {
      if (isSnapbackRefusal(error) && error.retryable) setTransport(error);
      throw error;
    } finally {
      setPendingCount((value) => value - 1);
    }
  }, [client, referenceName(ref)]);
  return useMemo(
    () => ({ run, pending: pendingCount > 0, last, transport }),
    [run, pendingCount, last, transport],
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
  const [state, setState] = useState<Omit<UseAuthResult, "signup" | "login" | "guest" | "logout" | "me">>({
    state: "hydrating",
    token: snapshot.token,
  });
  const me = useCallback(async () => {
    try {
      const value = await client.auth.me();
      setState({ state: "authenticated", ...value, token: client.snapshot.token });
      return value;
    } catch (error) {
      if (isSnapbackRefusal(error) && (error.code === "E_AUTH" || error.code === "E_AUTH_REQUIRED")) {
        setState({ state: "anonymous", refusal: error.envelope });
      } else {
        const refusal = isSnapbackRefusal(error) ? error.envelope : undefined;
        setState({ state: "refused", refusal, token: client.snapshot.token });
      }
      throw error;
    }
  }, [client]);

  useEffect(() => {
    void me().catch(() => undefined);
  }, [me, snapshot.token]);

  const establish = useCallback(async (action: () => Promise<AuthSession>) => {
    const session = await action();
    await me();
    return session;
  }, [me]);

  return {
    ...state,
    token: snapshot.token,
    signup: (input) => establish(() => client.auth.signup(input)),
    login: (input) => establish(() => client.auth.login(input)),
    guest: () => establish(() => client.auth.guest()),
    logout: async () => {
      const result = await client.auth.logout();
      setState({ state: "anonymous" });
      return result;
    },
    me,
  };
}

export function useChannel<Args, Payload = unknown>(ref: ChannelRef<Args, Payload>, args: NoInfer<Args>): ChannelHandle<Payload> {
  const { client } = provider();
  const argsKey = stableSerialize(args);
  return useMemo(() => client.channel<Args, Payload>(ref, args), [client, referenceName(ref), argsKey]);
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

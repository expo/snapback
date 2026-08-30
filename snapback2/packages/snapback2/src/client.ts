import { api, type Api, type ApiProxy, type Op } from "./api.js";
import { ReconnectingSse } from "./sse.js";
import type {
  AuthSession,
  Channel,
  ChannelEvent,
  ChannelPublishResult,
  ClientSnapshot,
  CreateClientOptions,
  Manifest,
  MutationResult,
  QueryRefused,
  QueryResult,
  RefusalEnvelope,
  RefusedDelivery,
  SnapbackClient,
  Subscription,
  SubscriptionDelivery,
} from "./types.js";

export { api };
export type { Api, ApiProxy, Op };
export * from "./types.js";

function fallbackRefusal(code: string, message: string): RefusalEnvelope {
  return { code, family: "owner", message, guide: "owner/connect" };
}

function isRefusal(value: unknown): value is RefusalEnvelope {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.code === "string" && typeof item.family === "string" && typeof item.message === "string";
}

export class SnapbackRefusal extends Error {
  readonly envelope: RefusalEnvelope;
  readonly code: string;

  constructor(envelope: RefusalEnvelope, readonly retryable = false) {
    super(envelope.message);
    this.name = "SnapbackRefusal";
    this.envelope = envelope;
    this.code = envelope.code;
  }
}

async function responseRefusal(response: Response): Promise<SnapbackRefusal> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = undefined;
  }
  const envelope = isRefusal(value)
    ? value
    : fallbackRefusal("E_HTTP", `Snapback owner returned HTTP ${response.status}`);
  return new SnapbackRefusal(envelope);
}

function assertObject(value: unknown, surface: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SnapbackRefusal(fallbackRefusal("E_PROTOCOL_JSON", `${surface} returned a non-object JSON body`));
  }
  return value as Record<string, unknown>;
}

function sseObject(data: string, surface: string): Record<string, unknown> {
  try {
    return assertObject(JSON.parse(data), surface);
  } catch (error) {
    if (error instanceof SnapbackRefusal) throw error;
    throw new SnapbackRefusal(fallbackRefusal("E_PROTOCOL_SSE", `${surface} returned invalid JSON`));
  }
}

class Client implements SnapbackClient {
  readonly auth;
  private readonly url: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly persist;
  private readonly persona?: string;
  private currentToken?: string;
  private currentSnapshot: ClientSnapshot;
  private readonly statusListeners = new Set<(snapshot: ClientSnapshot) => void>();
  private readonly subscriptions = new Set<Subscription<unknown>>();
  private closed = false;

  constructor(options: CreateClientOptions) {
    if (!options?.url) throw new TypeError("createClient requires url");
    this.url = options.url.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") throw new TypeError("createClient requires a fetch implementation");
    this.persist = options.persist;
    this.persona = options.as;
    this.currentToken = options.token;
    this.currentSnapshot = {
      token: options.token,
      persona: options.as,
      connection: "connecting",
    };
    this.auth = {
      signup: (input: { email: string; password: string }) => this.session("/api/auth/signup", input),
      login: (input: { email: string; password: string }) => this.session("/api/auth/login", input),
      guest: () => this.session("/api/auth/guest", {}),
      logout: async () => {
        const result = await this.json("/api/auth/logout", { method: "POST" }) as { ok: boolean };
        await this.setToken(undefined);
        return result;
      },
      me: () => this.json("/api/auth/me") as Promise<{ viewer: string; kind: string }>,
    };
  }

  get snapshot(): ClientSnapshot {
    return this.currentSnapshot;
  }

  async query<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<QueryResult<Result>> {
    try {
      const value = assertObject(await this.json("/api/query", {
        method: "POST",
        body: JSON.stringify({ op: ref.op, args }),
      }), "query");
      if (!["complete", "capped", "partial", "denied"].includes(String(value.state))) {
        throw new SnapbackRefusal(fallbackRefusal("E_PROTOCOL_STATE", `query returned state ${String(value.state)}`));
      }
      return value as QueryResult<Result>;
    } catch (error) {
      if (error instanceof SnapbackRefusal && error.code === "E_AUTH_PERSONA_NOT_DEV") {
        return { state: "refused", ...error.envelope } as QueryRefused;
      }
      throw error;
    }
  }

  async mutation<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<MutationResult<Result>> {
    const value = assertObject(await this.json("/api/mutation", {
      method: "POST",
      body: JSON.stringify({ op: ref.op, args }),
    }), "mutation");
    if (value.state !== "committed" && value.state !== "rejected") {
      throw new SnapbackRefusal(fallbackRefusal("E_PROTOCOL_STATE", `mutation returned state ${String(value.state)}`));
    }
    return value as MutationResult<Result>;
  }

  subscribe<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
  ): Subscription<SubscriptionDelivery<Result>> {
    const path = `/api/subscribe?op=${encodeURIComponent(ref.op)}&args=${encodeURIComponent(JSON.stringify(args))}`;
    let lastData: Result | undefined;
    let lastSeq: number | undefined;
    const subscription = new ReconnectingSse<SubscriptionDelivery<Result>>({
      open: (lastEventId, signal) => this.stream(path, lastEventId, signal),
      decode: ({ data }) => {
        const value = sseObject(data, "subscription delivery") as SubscriptionDelivery<Result>;
        if (!["live", "stale", "refused", "partial"].includes(value.state)) {
          throw new SnapbackRefusal(fallbackRefusal("E_PROTOCOL_STATE", `subscription returned state ${String(value.state)}`));
        }
        if ("data" in value && value.data !== undefined) lastData = value.data;
        if (value.seq !== undefined) lastSeq = value.seq;
        this.patchSnapshot({
          connection: value.state === "refused" ? "refused" : value.state === "stale" ? "stale" : "live",
          lastRefusal: value.state === "refused"
            ? {
                code: value.code,
                family: value.family ?? "owner",
                message: value.message ?? value.code,
                site: value.site,
                rule: value.rule,
                rewrite: value.rewrite,
                guide: value.guide,
              }
            : this.currentSnapshot.lastRefusal,
        });
        return value;
      },
      onError: (error) => this.subscriptionError(error),
      onLoss: () => {
        this.patchSnapshot({ connection: "stale" });
        return { state: "stale", since: Date.now(), data: lastData, seq: lastSeq };
      },
      onEvent: callback,
    });
    return this.track(subscription);
  }

  channel<Payload = unknown>(ref: { op: string }, args: unknown): Channel<Payload> {
    const name = encodeURIComponent(ref.op);
    return {
      publish: async (payload: Payload) => {
        try {
          return await this.json(`/api/channel/${name}/publish`, {
            method: "POST",
            body: JSON.stringify({ args, payload }),
          }) as ChannelPublishResult;
        } catch (error) {
          if (error instanceof SnapbackRefusal && error.code === "E_AUTH_PERSONA_NOT_DEV") {
            return { state: "refused", ...error.envelope };
          }
          throw error;
        }
      },
      subscribe: (callback: (event: ChannelEvent<Payload>) => void) => {
        const path = `/api/channel/${name}/subscribe?args=${encodeURIComponent(JSON.stringify(args))}`;
        const subscription = new ReconnectingSse<ChannelEvent<Payload>>({
          open: (lastEventId, signal) => this.stream(path, lastEventId, signal),
          decode: ({ data }) => sseObject(data, "channel delivery") as unknown as ChannelEvent<Payload>,
          onError: async (error) => {
            const decision = await this.subscriptionError(error);
            return { retry: decision.retry };
          },
          onLoss: () => undefined,
          onEvent: callback,
        });
        return this.track(subscription);
      },
    };
  }

  async manifest(): Promise<Manifest> {
    const value = assertObject(await this.json("/api/manifest"), "manifest") as unknown as Manifest;
    this.patchSnapshot({ generation: value.generation });
    return value;
  }

  subscribeStatus(callback: (snapshot: ClientSnapshot) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.currentSnapshot);
    return () => this.statusListeners.delete(callback);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const subscription of this.subscriptions) subscription.close();
    this.subscriptions.clear();
    this.patchSnapshot({ connection: "closed" });
  }

  private track<Event>(subscription: Subscription<Event>): Subscription<Event> {
    this.subscriptions.add(subscription as Subscription<unknown>);
    const close = subscription.close.bind(subscription);
    subscription.close = () => {
      this.subscriptions.delete(subscription as Subscription<unknown>);
      close();
    };
    return subscription;
  }

  private async session(path: string, input: unknown): Promise<AuthSession> {
    const session = await this.json(path, { method: "POST", body: JSON.stringify(input) }) as AuthSession;
    await this.setToken(session.token);
    return session;
  }

  private async setToken(token: string | undefined): Promise<void> {
    this.currentToken = token;
    this.patchSnapshot({ token });
    await this.persist?.(token ?? null);
  }

  private headers(stream = false): Headers {
    const headers = new Headers();
    headers.set("Accept", stream ? "text/event-stream" : "application/json");
    if (!stream) headers.set("Content-Type", "application/json");
    if (this.currentToken) headers.set("Authorization", `Bearer ${this.currentToken}`);
    if (this.persona) headers.set("X-Snapback-As", this.persona);
    return headers;
  }

  private async json(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, { ...init, headers: this.headers() });
    } catch (error) {
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
        true,
      );
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
    if (!response.ok) {
      const refusal = await responseRefusal(response);
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
    try {
      return await response.json();
    } catch {
      const refusal = new SnapbackRefusal(fallbackRefusal("E_PROTOCOL_JSON", `${path} returned invalid JSON`));
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
  }

  private async stream(path: string, lastEventId: string | undefined, signal: AbortSignal): Promise<Response> {
    const headers = this.headers(true);
    if (lastEventId !== undefined) headers.set("Last-Event-ID", lastEventId);
    try {
      const response = await this.fetchImpl(`${this.url}${path}`, { headers, signal });
      if (!response.ok) throw await responseRefusal(response);
      return response;
    } catch (error) {
      if (error instanceof SnapbackRefusal) {
        this.recordRefusal(error.envelope);
        throw error;
      }
      if (signal.aborted) throw error;
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
        true,
      );
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
  }

  private subscriptionError(error: unknown): { event?: RefusedDelivery; retry: boolean } {
    const refusal = error instanceof SnapbackRefusal
      ? error
      : new SnapbackRefusal(
          fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
          true,
        );
    this.recordRefusal(refusal.envelope);
    if (refusal.retryable) return { retry: true };
    this.patchSnapshot({ connection: "refused", lastRefusal: refusal.envelope });
    return { retry: false, event: { state: "refused", ...refusal.envelope } };
  }

  private recordRefusal(envelope: RefusalEnvelope): void {
    this.patchSnapshot({ lastRefusal: envelope });
  }

  private patchSnapshot(patch: Partial<ClientSnapshot>): void {
    const next = { ...this.currentSnapshot, ...patch };
    if (patch.token === undefined && "token" in patch) delete next.token;
    this.currentSnapshot = next;
    for (const listener of this.statusListeners) listener(next);
  }
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — one small headless client speaks the owner wire directly.
export function createClient(options: CreateClientOptions): SnapbackClient {
  return new Client(options);
}

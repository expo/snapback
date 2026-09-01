import { api, referenceName, type Api, type ApiProxy, type Channel as ChannelRef, type Op } from "./api.js";
import { ReconnectingSse } from "./sse.js";
import type {
  AuthSession,
  AuthMe,
  ChannelDelivery,
  ChannelHandle,
  ChannelPublishResult,
  ClientSnapshot,
  CreateClientOptions,
  Manifest,
  LiveQueryDelivery,
  MutationResult,
  QueryRefusedDelivery,
  QueryResult,
  RefusalEnvelope,
  RefusedDelivery,
  SnapbackClient,
  Subscription,
  SubscriptionDelivery,
} from "./types.js";

export { api };
export type { Api, ApiProxy, ChannelRef as Channel, Op };
export * from "./types.js";

function fallbackRefusal(code: string, message: string): RefusalEnvelope {
  return { code, family: "owner", message, guide: "owner/connect" };
}

const snapbackRefusalBrand = Symbol.for("snapback2.SnapbackRefusal");

export class SnapbackRefusal extends Error {
  readonly [snapbackRefusalBrand] = true;
  readonly envelope: RefusalEnvelope;
  readonly code: string;

  constructor(envelope: RefusalEnvelope, readonly retryable = false) {
    super(envelope.message);
    this.name = "SnapbackRefusal";
    this.envelope = envelope;
    this.code = envelope.code;
  }
}

export function isSnapbackRefusal(value: unknown): value is SnapbackRefusal {
  return typeof value === "object"
    && value !== null
    && (value as { name?: unknown }).name === "SnapbackRefusal"
    && (value as Record<symbol, unknown>)[snapbackRefusalBrand] === true;
}

// @ref LLP 1002#4-the-wire — validate every state-specific body before exposing owner data to callers.
function wireShape(message: string): SnapbackRefusal {
  return new SnapbackRefusal({ code: "E_WIRE_SHAPE", family: "op", message, guide: "op/wire-shape" });
}

function wireObject(value: unknown, surface: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw wireShape(`${surface} must be an object`);
  }
  return value as Record<string, unknown>;
}

function has(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function present(record: Record<string, unknown>, field: string, surface: string): unknown {
  if (!has(record, field)) throw wireShape(`${surface} is missing ${field}`);
  return record[field];
}

function stringField(record: Record<string, unknown>, field: string, surface: string): string {
  const value = present(record, field, surface);
  if (typeof value !== "string" || value.length === 0) throw wireShape(`${surface}.${field} must be a non-empty string`);
  return value;
}

function numberField(record: Record<string, unknown>, field: string, surface: string): number {
  const value = present(record, field, surface);
  if (typeof value !== "number" || !Number.isFinite(value)) throw wireShape(`${surface}.${field} must be a number`);
  return value;
}

function optionalString(record: Record<string, unknown>, field: string, surface: string): string | undefined {
  if (!has(record, field)) return undefined;
  const value = record[field];
  if (typeof value !== "string") throw wireShape(`${surface}.${field} must be a string`);
  return value;
}

function optionalNumber(record: Record<string, unknown>, field: string, surface: string): number | undefined {
  if (!has(record, field)) return undefined;
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) throw wireShape(`${surface}.${field} must be a number`);
  return value;
}

function wireRefusalEnvelope(value: unknown, surface: string): RefusalEnvelope {
  const record = wireObject(value, surface);
  const envelope: RefusalEnvelope = {
    code: stringField(record, "code", surface),
    family: stringField(record, "family", surface),
    message: stringField(record, "message", surface),
    guide: stringField(record, "guide", surface),
  };
  for (const field of ["site", "rule", "rewrite"] as const) {
    const item = optionalString(record, field, surface);
    if (item !== undefined) envelope[field] = item;
  }
  return envelope;
}

function copyRefusal(envelope: RefusalEnvelope): RefusalEnvelope {
  const refusal: RefusalEnvelope = {
    code: envelope.code,
    family: envelope.family,
    message: envelope.message,
    guide: envelope.guide,
  };
  if (envelope.site !== undefined) refusal.site = envelope.site;
  if (envelope.rule !== undefined) refusal.rule = envelope.rule;
  if (envelope.rewrite !== undefined) refusal.rewrite = envelope.rewrite;
  return refusal;
}

function wireQuery<Result>(value: unknown, surface = "query response"): QueryResult<Result> {
  const record = wireObject(value, surface);
  switch (stringField(record, "state", surface)) {
    case "complete":
      return { state: "complete", data: present(record, "data", surface) as Result, seq: numberField(record, "seq", surface) };
    case "capped": {
      for (const field of ["site", "take", "reason"]) {
        if (has(record, field)) throw wireShape(`${surface}.capped must not carry ${field}`);
      }
      return {
        state: "capped",
        data: present(record, "data", surface) as Result,
        seq: numberField(record, "seq", surface),
      };
    }
    case "partial": {
      const partial = {
        state: "partial" as const,
        seq: numberField(record, "seq", surface),
        reason: stringField(record, "reason", surface),
      };
      return has(record, "data") ? { ...partial, data: record.data as Result } : partial;
    }
    case "denied":
      return { state: "denied", seq: numberField(record, "seq", surface), rule: stringField(record, "rule", surface) };
    default:
      throw wireShape(`${surface}.state must be complete, capped, partial, or denied`);
  }
}

function wireMutation<Result>(value: unknown): MutationResult<Result> {
  const surface = "mutation response";
  const record = wireObject(value, surface);
  switch (stringField(record, "state", surface)) {
    case "committed":
      return { state: "committed", data: present(record, "data", surface) as Result, seq: numberField(record, "seq", surface) };
    case "rejected":
      return { state: "rejected", ...wireRefusalEnvelope(record, "mutation rejected response") };
    default:
      throw wireShape(`${surface}.state must be committed or rejected`);
  }
}

function wireSubscription<Result>(data: string): LiveQueryDelivery<Result> | QueryRefusedDelivery {
  const surface = "subscription delivery";
  const record = sseObject(data, surface);
  if (stringField(record, "state", surface) === "refused") {
    const refusal = wireRefusalEnvelope(record, `${surface} refusal`);
    const seq = optionalNumber(record, "seq", surface);
    return {
      state: "refused",
      live: false,
      ...refusal,
      ...(seq === undefined ? {} : { seq }),
    };
  }
  return { ...wireQuery<Result>(record, surface), live: true };
}

function wireChannelDelivery<Payload>(data: string): ChannelDelivery<Payload> {
  const surface = "channel delivery";
  const record = sseObject(data, surface);
  if (record.state === "refused") {
    return { state: "refused", ...wireRefusalEnvelope(record, `${surface} refusal`) } as RefusedDelivery;
  }
  return {
    from: stringField(record, "from", surface),
    payload: present(record, "payload", surface) as Payload,
    at: numberField(record, "at", surface),
  };
}

function wireChannelPublish(value: unknown): ChannelPublishResult {
  const surface = "channel publish response";
  const record = wireObject(value, surface);
  if (record.ok === true) return { ok: true };
  if (record.state !== "refused") throw wireShape(`${surface} must contain ok: true or state: refused`);
  return { state: "refused", ...wireRefusalEnvelope(record, `${surface} refusal`) };
}

function wireAuthSession(value: unknown, surface: string): AuthSession {
  const record = wireObject(value, surface);
  return { token: stringField(record, "token", surface), viewer: stringField(record, "viewer", surface) };
}

function wireAuthMe(value: unknown): AuthMe {
  const surface = "auth me response";
  const record = wireObject(value, surface);
  return { viewer: stringField(record, "viewer", surface), kind: stringField(record, "kind", surface) };
}

function wireLogout(value: unknown): { ok: boolean } {
  const surface = "auth logout response";
  const record = wireObject(value, surface);
  if (typeof present(record, "ok", surface) !== "boolean") throw wireShape(`${surface}.ok must be a boolean`);
  return { ok: record.ok as boolean };
}

function wireManifest(value: unknown): Manifest {
  const surface = "manifest response";
  const record = wireObject(value, surface);
  const ops = wireObject(present(record, "ops", surface), `${surface}.ops`);
  for (const [name, operation] of Object.entries(ops)) {
    const item = wireObject(operation, `${surface}.ops.${name}`);
    stringField(item, "kind", `${surface}.ops.${name}`);
    present(item, "args", `${surface}.ops.${name}`);
  }
  return {
    generation: stringField(record, "generation", surface),
    ops: ops as unknown as Manifest["ops"],
    channels: wireObject(present(record, "channels", surface), `${surface}.channels`),
    auth: wireObject(present(record, "auth", surface), `${surface}.auth`),
  };
}

async function responseRefusal(response: Response): Promise<SnapbackRefusal> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new SnapbackRefusal(
      fallbackRefusal("E_TRANSPORT", `HTTP ${response.status} did not contain a refusal envelope`),
      true,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["code", "family", "guide"].some((field) => has(value as Record<string, unknown>, field))) {
    throw new SnapbackRefusal(
      fallbackRefusal("E_TRANSPORT", `HTTP ${response.status} did not contain a refusal envelope`),
      true,
    );
  }
  return new SnapbackRefusal(wireRefusalEnvelope(value, `HTTP ${response.status} refusal`));
}

function sseObject(data: string, surface: string): Record<string, unknown> {
  try {
    return wireObject(JSON.parse(data), surface);
  } catch (error) {
    if (isSnapbackRefusal(error)) throw error;
    throw wireShape(`${surface} must contain valid JSON`);
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
      connection: "reconnecting",
    };
    this.auth = {
      signup: (input: { email: string; password: string }) => this.session("/api/auth/signup", input),
      login: (input: { email: string; password: string }) => this.session("/api/auth/login", input),
      guest: () => this.session("/api/auth/guest", {}),
      logout: async () => {
        const result = wireLogout(await this.json("/api/auth/logout", { method: "POST" }));
        this.validated();
        await this.setToken(undefined);
        return result;
      },
      me: async () => {
        const result = wireAuthMe(await this.json("/api/auth/me"));
        this.validated();
        return result;
      },
    };
  }

  get snapshot(): ClientSnapshot {
    return this.currentSnapshot;
  }

  async query<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<QueryResult<Result>> {
    let backoff = 50;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = wireQuery<Result>(await this.json("/api/query", {
          method: "POST",
          body: JSON.stringify({ op: referenceName(ref), args }),
        }));
        this.validated();
        // Every typed receipt terminates this request. In particular, an
        // empty Capped array is the terminal drain state, never a retry cue.
        return result;
      } catch (error) {
        if (!isSnapbackRefusal(error)
          || (error.code !== "E_TRANSPORT" && error.code !== "E_NETWORK")
          || !error.retryable
          || attempt >= 3) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, backoff));
        backoff *= 2;
      }
    }
  }

  async mutation<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<MutationResult<Result>> {
    try {
      const result = wireMutation<Result>(await this.json("/api/mutation", {
        method: "POST",
        body: JSON.stringify({ op: referenceName(ref), args }),
      }));
      this.validated();
      return result;
    } catch (error) {
      if (isSnapbackRefusal(error) && error.code === "E_WIRE_SHAPE") {
        const ambiguous = new SnapbackRefusal(copyRefusal(error.envelope), true);
        this.patchSnapshot({
          connection: this.transportFailureState(),
          lastRefusal: ambiguous.envelope,
        });
        throw ambiguous;
      }
      throw error;
    }
  }

  subscribe<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
  ): Subscription<SubscriptionDelivery<Result>> {
    const path = `/api/subscribe?op=${encodeURIComponent(referenceName(ref))}&args=${encodeURIComponent(JSON.stringify(args))}`;
    let lastPair: { seq: number; data?: Result } | undefined;
    const subscription = new ReconnectingSse<SubscriptionDelivery<Result>>({
      open: (lastEventId, signal) => this.stream(path, lastEventId, signal),
      decode: ({ data }) => {
        const value = wireSubscription<Result>(data);
        if (value.state === "refused") {
          lastPair = undefined;
        } else {
          lastPair = "data" in value ? { seq: value.seq, data: value.data } : { seq: value.seq };
        }
        this.patchSnapshot({
          connection: "connected",
          lastRefusal: value.state === "refused" ? copyRefusal(value) : undefined,
        });
        return value;
      },
      onError: (error) => {
        const { retry, event, refusal } = this.subscriptionError(error);
        return {
          retry,
          event: event === undefined ? undefined : { ...event, live: false as const },
          failure: refusal,
        };
      },
      onLoss: () => {
        this.patchSnapshot({ connection: this.transportFailureState() });
        if (!lastPair) return undefined;
        return "data" in lastPair
          ? { state: "stale", live: false, since: Date.now(), seq: lastPair.seq, data: lastPair.data }
          : { state: "stale", live: false, since: Date.now(), seq: lastPair.seq };
      },
      terminal: (event) => event.state === "refused"
        ? new SnapbackRefusal(copyRefusal(event))
        : undefined,
      onEvent: callback,
    });
    return this.track(subscription);
  }

  channel<Args, Payload = unknown>(ref: ChannelRef<Args, Payload>, args: Args): ChannelHandle<Payload> {
    const path = referenceName(ref);
    const name = encodeURIComponent(path.startsWith("channels.") ? path.slice("channels.".length) : path);
    return {
      publish: async (payload: Payload) => {
        const result = wireChannelPublish(await this.json(`/api/channel/${name}/publish`, {
          method: "POST",
          body: JSON.stringify({ args, payload }),
        }));
        this.validated();
        return result;
      },
      subscribe: (callback: (event: ChannelDelivery<Payload>) => void) => {
        const path = `/api/channel/${name}/subscribe?args=${encodeURIComponent(JSON.stringify(args))}`;
        const subscription = new ReconnectingSse<ChannelDelivery<Payload>>({
          open: (lastEventId, signal) => this.stream(path, lastEventId, signal),
          decode: ({ data }) => {
            const value = wireChannelDelivery<Payload>(data);
            this.patchSnapshot({
              connection: "connected",
              lastRefusal: "state" in value && value.state === "refused"
                ? copyRefusal(value)
                : undefined,
            });
            return value;
          },
          onError: (error) => {
            const decision = this.subscriptionError(error);
            return { retry: decision.retry, event: decision.event, failure: decision.refusal };
          },
          onLoss: () => {
            this.patchSnapshot({ connection: this.transportFailureState() });
            return undefined;
          },
          terminal: (event) => "state" in event && event.state === "refused"
            ? new SnapbackRefusal(copyRefusal(event))
            : undefined,
          onEvent: callback,
        });
        return this.track(subscription);
      },
    };
  }

  async manifest(): Promise<Manifest> {
    const value = wireManifest(await this.json("/api/manifest"));
    this.validated();
    this.patchSnapshot({ generation: value.generation });
    return value;
  }

  subscribeStatus(callback: (snapshot: ClientSnapshot) => void): () => void {
    this.statusListeners.add(callback);
    try {
      callback(this.currentSnapshot);
    } catch (error) {
      this.statusListeners.delete(callback);
      throw error;
    }
    return () => this.statusListeners.delete(callback);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const subscription of this.subscriptions) subscription.close();
    this.subscriptions.clear();
    this.patchSnapshot({ connection: "offline" });
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
    const session = wireAuthSession(
      await this.json(path, { method: "POST", body: JSON.stringify(input) }),
      `${path.slice("/api/".length)} response`,
    );
    this.validated();
    await this.setToken(session.token);
    return session;
  }

  private async setToken(token: string | undefined): Promise<void> {
    this.currentToken = token;
    this.patchSnapshot({ token });
    await this.persist?.(token ?? null);
  }

  private headers(stream = false, hasBody = false): Headers {
    const headers = new Headers();
    headers.set("Accept", stream ? "text/event-stream" : "application/json");
    if (hasBody) headers.set("Content-Type", "application/json");
    if (this.currentToken) headers.set("Authorization", `Bearer ${this.currentToken}`);
    if (this.persona) headers.set("X-Snapback-As", this.persona);
    return headers;
  }

  private async json(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, {
        ...init,
        headers: this.headers(false, init.body !== undefined && init.body !== null),
      });
    } catch (error) {
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        try {
          const refusal = await responseRefusal(response);
          this.patchSnapshot({ connection: "connected" });
          this.recordRefusal(refusal.envelope);
          throw refusal;
        } catch (error) {
          if (isSnapbackRefusal(error)) {
            if (error.retryable) {
              this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: error.envelope });
            }
            throw error;
          }
        }
      }
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_TRANSPORT", `${path} returned HTTP ${response.status}`),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
    try {
      const value = await response.json();
      this.patchSnapshot({ connection: "connected" });
      return value;
    } catch {
      const refusal = wireShape(`${path} must contain valid JSON`);
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
  }

  private async stream(path: string, lastEventId: string | undefined, signal: AbortSignal): Promise<Response> {
    const headers = this.headers(true);
    if (lastEventId !== undefined) headers.set("Last-Event-ID", lastEventId);
    try {
      const response = await this.fetchImpl(`${this.url}${path}`, { headers, signal });
      this.patchSnapshot({ connection: "connected" });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          let refusal: SnapbackRefusal | undefined;
          try {
            refusal = await responseRefusal(response);
          } catch (error) {
            if (isSnapbackRefusal(error) && !error.retryable) throw error;
            // A non-envelope 4xx cannot be interpreted as a terminal owner refusal.
          }
          if (refusal !== undefined) throw refusal;
        }
        throw new SnapbackRefusal(
          fallbackRefusal("E_HTTP", `${path} returned HTTP ${response.status}`),
          true,
        );
      }
      return response;
    } catch (error) {
      if (isSnapbackRefusal(error)) {
        this.patchSnapshot({
          connection: error.retryable ? this.transportFailureState() : "connected",
          lastRefusal: error.envelope,
        });
        throw error;
      }
      if (signal.aborted) throw error;
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
  }

  private subscriptionError(error: unknown): { event?: RefusedDelivery; retry: boolean; refusal?: SnapbackRefusal } {
    const refusal = isSnapbackRefusal(error)
      ? error
      : new SnapbackRefusal(
          fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
          true,
        );
    if (refusal.retryable) {
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      return { retry: true };
    }
    this.patchSnapshot({ connection: "connected", lastRefusal: refusal.envelope });
    return { retry: false, refusal, event: { state: "refused", ...refusal.envelope } };
  }

  private recordRefusal(envelope: RefusalEnvelope): void {
    this.patchSnapshot({ lastRefusal: envelope });
  }

  private validated(): void {
    this.patchSnapshot({ connection: "connected", lastRefusal: undefined });
  }

  private transportFailureState(): "reconnecting" | "offline" {
    return typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "reconnecting";
  }

  private patchSnapshot(patch: Partial<ClientSnapshot>): ClientSnapshot {
    const next = { ...this.currentSnapshot, ...patch };
    if (patch.token === undefined && "token" in patch) delete next.token;
    if (patch.lastRefusal === undefined && "lastRefusal" in patch) delete next.lastRefusal;
    if (JSON.stringify(next) === JSON.stringify(this.currentSnapshot)) return this.currentSnapshot;
    this.currentSnapshot = next;
    for (const listener of this.statusListeners) {
      try {
        listener(next);
      } catch {
        // Application observers cannot turn a validated client operation into a refusal.
      }
    }
    return next;
  }
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — one small headless client speaks the owner wire directly.
export function createClient(options: CreateClientOptions): SnapbackClient {
  return new Client(options);
}

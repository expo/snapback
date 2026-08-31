import { api, referenceName, type Api, type ApiProxy, type Channel as ChannelRef, type Op } from "./api.js";
import { ReconnectingSse } from "./sse.js";
import type {
  AuthTokenStore,
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
  Principal,
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
      const take = optionalNumber(record, "take", surface);
      const site = has(record, "site") ? stringField(record, "site", surface) : undefined;
      const capped = {
        state: "capped",
        data: present(record, "data", surface) as Result,
        seq: numberField(record, "seq", surface),
      } as const;
      if (take === undefined && site === undefined) return capped;
      if (take !== undefined && site !== undefined) return { ...capped, take, site };
      throw wireShape(`${surface}.site and .take must appear together`);
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
    from: stringField(record, "from", surface) as Principal,
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

function terminalSessionEnvelope(value: unknown): RefusalEnvelope | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.code !== "E_AUTH_SESSION"
    || (record.state !== "rejected" && record.state !== "refused")) return undefined;
  return wireRefusalEnvelope(record, "terminal session response");
}

function wireAuthSession(value: unknown, surface: string): AuthSession {
  const record = wireObject(value, surface);
  return { token: stringField(record, "token", surface), viewer: stringField(record, "viewer", surface) as Principal };
}

function wireAuthMe(value: unknown): AuthMe {
  const surface = "auth me response";
  const record = wireObject(value, surface);
  return { viewer: stringField(record, "viewer", surface) as Principal, kind: stringField(record, "kind", surface) };
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

/** Adapts explicitly supplied browser storage; the client never selects storage itself. */
export function browserTokenStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  key: string,
): AuthTokenStore {
  if (!storage || typeof storage.getItem !== "function"
    || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") {
    throw new TypeError("browserTokenStore requires an explicit Storage implementation");
  }
  if (!key) throw new TypeError("browserTokenStore requires a non-empty key");
  return {
    load: () => storage.getItem(key),
    save: (token) => {
      if (token === null) storage.removeItem(key);
      else storage.setItem(key, token);
    },
  };
}

interface Authority {
  authGeneration: number;
  fence: number;
  token?: string;
}

type SessionExpiration =
  | { cleared: false }
  | { cleared: true; authGeneration: number; fence: number };

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — auth custody is restored explicitly and every principal transition fences old in-memory work.
class Client implements SnapbackClient {
  readonly auth;
  readonly ready: Promise<void>;
  private readonly url: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly tokenStore?: AuthTokenStore;
  private readonly persona?: string;
  private currentToken?: string;
  private authGeneration = 0;
  private operationFence = 0;
  private transitionTail: Promise<void> = Promise.resolve();
  private custodyTail: Promise<void> = Promise.resolve();
  private currentSnapshot: ClientSnapshot;
  private readonly statusListeners = new Set<(snapshot: ClientSnapshot) => void>();
  private readonly subscriptions = new Set<Subscription<unknown>>();
  private readonly writes = new Set<Promise<unknown>>();
  private closed = false;

  constructor(options: CreateClientOptions) {
    if (!options?.url) throw new TypeError("createClient requires url");
    if (options.as !== undefined && (options.token !== undefined || options.tokenStore !== undefined)) {
      throw new TypeError("createClient cannot combine dev persona `as` with bearer token custody");
    }
    this.url = options.url.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") throw new TypeError("createClient requires a fetch implementation");
    this.tokenStore = options.tokenStore;
    this.persona = options.as;
    this.currentSnapshot = {
      authGeneration: 0,
      persona: options.as,
      connection: "reconnecting",
    };
    this.auth = {
      signup: (input: { email: string; password: string }) => this.session("/api/auth/signup", input),
      login: (input: { email: string; password: string }) => this.session("/api/auth/login", input),
      guest: () => this.session("/api/auth/guest", {}),
      logout: () => this.logout(),
      me: () => this.me(),
    };
    this.ready = this.hydrate(options.token);
  }

  get snapshot(): ClientSnapshot {
    return this.currentSnapshot;
  }

  async query<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<QueryResult<Result>> {
    const authority = await this.operationAuthority();
    let backoff = 50;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const result = wireQuery<Result>(await this.json("/api/query", {
          method: "POST",
          body: JSON.stringify({ op: referenceName(ref), args }),
        }, authority));
        this.validated(authority);
        return result;
      } catch (error) {
        if (!isSnapbackRefusal(error)
          || (error.code !== "E_TRANSPORT" && error.code !== "E_NETWORK")
          || !error.retryable
          || attempt >= 3) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, backoff));
        this.ensureAuthority(authority);
        backoff *= 2;
      }
    }
  }

  async mutation<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<MutationResult<Result>> {
    const authority = await this.operationAuthority();
    return this.trackWrite(async () => {
      const result = wireMutation<Result>(await this.json("/api/mutation", {
        method: "POST",
        body: JSON.stringify({ op: referenceName(ref), args }),
      }, authority));
      if (result.state === "rejected" && result.code === "E_AUTH_SESSION") {
        const wasCurrent = this.authorityCurrent(authority);
        const expiration = await this.expireSession(authority);
        if (!wasCurrent || !this.expirationCurrent(expiration)) throw this.supersededRefusal();
        this.recordRefusal(result);
        return result;
      }
      this.validated(authority);
      return result;
    });
  }

  subscribe<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
  ): Subscription<SubscriptionDelivery<Result>> {
    const path = `/api/subscribe?op=${encodeURIComponent(referenceName(ref))}&args=${encodeURIComponent(JSON.stringify(args))}`;
    let lastPair: { seq: number; data?: Result } | undefined;
    let authority: Authority | undefined;
    let subscription: Subscription<SubscriptionDelivery<Result>>;
    subscription = new ReconnectingSse<SubscriptionDelivery<Result>>({
      open: async (lastEventId, signal) => {
        authority ??= await this.operationAuthority();
        return this.stream(path, lastEventId, signal, authority);
      },
      decode: ({ data }) => {
        const value = wireSubscription<Result>(data);
        if (value.state === "refused" && value.code === "E_AUTH_SESSION") {
          throw new SnapbackRefusal(copyRefusal(value));
        }
        this.ensureAuthority(authority);
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
      onError: async (error) => {
        const { retry, event, refusal } = await this.subscriptionError(error, authority, subscription);
        return {
          retry,
          event: event === undefined ? undefined : { ...event, live: false as const },
          failure: refusal,
        };
      },
      onLoss: () => {
        if (!this.authorityCurrent(authority)) return undefined;
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
        const authority = await this.operationAuthority();
        return this.trackWrite(async () => {
          const result = wireChannelPublish(await this.json(`/api/channel/${name}/publish`, {
            method: "POST",
            body: JSON.stringify({ args, payload }),
          }, authority));
          if ("state" in result) {
            if (result.code === "E_AUTH_SESSION") {
              const wasCurrent = this.authorityCurrent(authority);
              const expiration = await this.expireSession(authority);
              if (!wasCurrent || !this.expirationCurrent(expiration)) throw this.supersededRefusal();
            }
            this.recordRefusal(result);
          } else {
            this.validated(authority);
          }
          return result;
        });
      },
      subscribe: (callback: (event: ChannelDelivery<Payload>) => void) => {
        const path = `/api/channel/${name}/subscribe?args=${encodeURIComponent(JSON.stringify(args))}`;
        let authority: Authority | undefined;
        let subscription: Subscription<ChannelDelivery<Payload>>;
        subscription = new ReconnectingSse<ChannelDelivery<Payload>>({
          open: async (lastEventId, signal) => {
            authority ??= await this.operationAuthority();
            return this.stream(path, lastEventId, signal, authority);
          },
          decode: ({ data }) => {
            const value = wireChannelDelivery<Payload>(data);
            if ("state" in value && value.state === "refused" && value.code === "E_AUTH_SESSION") {
              throw new SnapbackRefusal(copyRefusal(value));
            }
            this.ensureAuthority(authority);
            this.patchSnapshot({
              connection: "connected",
              lastRefusal: "state" in value && value.state === "refused"
                ? copyRefusal(value)
                : undefined,
            });
            return value;
          },
          onError: async (error) => {
            const decision = await this.subscriptionError(error, authority, subscription);
            return { retry: decision.retry, event: decision.event, failure: decision.refusal };
          },
          onLoss: () => {
            if (!this.authorityCurrent(authority)) return undefined;
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
    const authority = await this.operationAuthority();
    const value = wireManifest(await this.json("/api/manifest", {}, authority));
    this.validated(authority);
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
    this.operationFence += 1;
    this.closeTransports();
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
    this.ensureBearerTransition(path.slice("/api/auth/".length));
    return this.transition(async (authority) => {
      const session = wireAuthSession(
        await this.json(path, { method: "POST", body: JSON.stringify(input) }, authority, false, false),
        `${path.slice("/api/".length)} response`,
      );
      await this.installToken(session.token);
      this.ensureOpen();
      this.validated(undefined);
      return session;
    });
  }

  private async logout(): Promise<{ ok: boolean }> {
    this.ensureBearerTransition("logout");
    return this.transition(async (authority) => {
      let result: { ok: boolean } | undefined;
      let requestFailure: unknown;
      try {
        result = wireLogout(await this.json(
          "/api/auth/logout",
          { method: "POST" },
          authority,
          false,
          false,
        ));
      } catch (error) {
        requestFailure = error;
      }
      await this.clearToken();
      this.ensureOpen();
      if (requestFailure !== undefined) throw requestFailure;
      this.validated(undefined);
      return result as { ok: boolean };
    });
  }

  private async me(): Promise<AuthMe> {
    const authority = await this.operationAuthority();
    const result = wireAuthMe(await this.json("/api/auth/me", {}, authority));
    this.validated(authority);
    return result;
  }

  private async hydrate(explicitToken: string | undefined): Promise<void> {
    let token = explicitToken;
    if (token === undefined && this.tokenStore) {
      try {
        token = (await this.tokenStore.load()) ?? undefined;
      } catch (error) {
        throw this.storageRefusal("load", error);
      }
    }
    if (token !== undefined && (typeof token !== "string" || token.length === 0)) {
      throw this.storageRefusal("load", new TypeError("stored token must be a non-empty string or null"));
    }
    if (explicitToken !== undefined) await this.saveToken(token!);
    if (this.closed) return;
    this.currentToken = token;
    this.authGeneration += 1;
    this.publishAuthSnapshot();
  }

  private headers(authority: Authority, stream = false, hasBody = false): Headers {
    const headers = new Headers();
    headers.set("Accept", stream ? "text/event-stream" : "application/json");
    if (hasBody) headers.set("Content-Type", "application/json");
    if (authority.token) headers.set("Authorization", `Bearer ${authority.token}`);
    if (this.persona) headers.set("X-Snapback-As", this.persona);
    return headers;
  }

  private async json(
    path: string,
    init: RequestInit,
    authority: Authority,
    enforceAuthority = true,
    clearTerminalSession = true,
  ): Promise<unknown> {
    if (enforceAuthority) this.ensureAuthority(authority);
    else this.ensureOpen();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, {
        ...init,
        headers: this.headers(authority, false, init.body !== undefined && init.body !== null),
      });
    } catch (error) {
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) {
        let refusal: SnapbackRefusal;
        try {
          refusal = await responseRefusal(response);
        } catch (error) {
          if (isSnapbackRefusal(error)) {
            if (enforceAuthority) this.ensureAuthority(authority);
            else this.ensureOpen();
            if (error.retryable) {
              this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: error.envelope });
            }
            throw error;
          }
          throw error;
        }
        const wasCurrent = !enforceAuthority || this.authorityCurrent(authority);
        let expiration: SessionExpiration | undefined;
        if (clearTerminalSession && refusal.code === "E_AUTH_SESSION") {
          expiration = await this.expireSession(authority);
        }
        if (enforceAuthority && (!wasCurrent
          || (expiration !== undefined && !this.expirationCurrent(expiration)))) {
          throw this.supersededRefusal();
        }
        if (enforceAuthority && !(clearTerminalSession && refusal.code === "E_AUTH_SESSION")) {
          this.ensureAuthority(authority);
        }
        else this.ensureOpen();
        this.patchSnapshot({ connection: "connected" });
        this.recordRefusal(refusal.envelope);
        throw refusal;
      }
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      const refusal = new SnapbackRefusal(
        fallbackRefusal("E_TRANSPORT", `${path} returned HTTP ${response.status}`),
        true,
      );
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      throw refusal;
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      const refusal = wireShape(`${path} must contain valid JSON`);
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
    const terminal = clearTerminalSession ? terminalSessionEnvelope(value) : undefined;
    if (terminal !== undefined && enforceAuthority && !this.authorityCurrent(authority)) {
      await this.expireSession(authority);
      throw this.supersededRefusal();
    }
    if (enforceAuthority) this.ensureAuthority(authority);
    else this.ensureOpen();
    this.patchSnapshot({ connection: "connected" });
    return value;
  }

  private async stream(
    path: string,
    lastEventId: string | undefined,
    signal: AbortSignal,
    authority: Authority,
  ): Promise<Response> {
    this.ensureAuthority(authority);
    const headers = this.headers(authority, true);
    if (lastEventId !== undefined) headers.set("Last-Event-ID", lastEventId);
    try {
      const response = await this.fetchImpl(`${this.url}${path}`, { headers, signal });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          let refusal: SnapbackRefusal | undefined;
          try {
            refusal = await responseRefusal(response);
          } catch (error) {
            if (isSnapbackRefusal(error) && !error.retryable) throw error;
            // A non-envelope 4xx cannot be interpreted as a terminal owner refusal.
          }
          if (refusal !== undefined) {
            if (refusal.code !== "E_AUTH_SESSION") this.ensureAuthority(authority);
            throw refusal;
          }
        }
        this.ensureAuthority(authority);
        throw new SnapbackRefusal(
          fallbackRefusal("E_HTTP", `${path} returned HTTP ${response.status}`),
          true,
        );
      }
      this.ensureAuthority(authority);
      this.patchSnapshot({ connection: "connected" });
      return response;
    } catch (error) {
      if (isSnapbackRefusal(error) && error.code === "E_AUTH_SESSION") throw error;
      if (!signal.aborted) this.ensureAuthority(authority);
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

  private async subscriptionError(
    error: unknown,
    authority: Authority | undefined,
    origin: Subscription<unknown>,
  ): Promise<{ event?: RefusedDelivery; retry: boolean; refusal?: SnapbackRefusal }> {
    const refusal = isSnapbackRefusal(error)
      ? error
      : new SnapbackRefusal(
          fallbackRefusal("E_NETWORK", error instanceof Error ? error.message : String(error)),
          true,
        );
    if (refusal.code === "E_AUTH_SUPERSEDED") {
      return { retry: false, refusal };
    }
    if (refusal.code === "E_AUTH_SESSION" && authority !== undefined) {
      const wasCurrent = this.authorityCurrent(authority);
      let expiration: SessionExpiration;
      try {
        expiration = await this.expireSession(authority, origin);
      } catch (error) {
        const terminal = isSnapbackRefusal(error)
          ? error
          : new SnapbackRefusal({
              code: "E_AUTH_TOKEN_STORE",
              family: "auth",
              message: `token store clear failed: ${error instanceof Error ? error.message : String(error)}`,
              guide: "auth/session",
            });
        this.patchSnapshot({ connection: "connected", lastRefusal: terminal.envelope });
        return {
          retry: false,
          refusal: terminal,
          event: { state: "refused", ...terminal.envelope },
        };
      }
      if (!wasCurrent || !this.expirationCurrent(expiration)) {
        return { retry: false, refusal: this.supersededRefusal() };
      }
    }
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

  private validated(authority: Authority | undefined): void {
    if (authority !== undefined) this.ensureAuthority(authority);
    else this.ensureOpen();
    this.patchSnapshot({ connection: "connected", lastRefusal: undefined });
  }

  private async operationAuthority(): Promise<Authority> {
    await this.ready;
    while (true) {
      const transition = this.transitionTail;
      await transition;
      if (transition === this.transitionTail) break;
    }
    this.ensureOpen();
    return {
      authGeneration: this.authGeneration,
      fence: this.operationFence,
      token: this.currentToken,
    };
  }

  private transition<T>(
    action: (authority: Authority) => Promise<T>,
    waitForWrites = true,
    except?: Subscription<unknown>,
  ): Promise<T> {
    this.operationFence += 1;
    this.closeTransports(except);
    const run = this.transitionTail.then(async () => {
      await this.ready;
      this.ensureOpen();
      if (waitForWrites) await this.settleWrites();
      const authority: Authority = {
        authGeneration: this.authGeneration,
        fence: this.operationFence,
        token: this.currentToken,
      };
      try {
        return await action(authority);
      } finally {
        this.authGeneration += 1;
        this.publishAuthSnapshot();
      }
    });
    this.transitionTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async expireSession(authority: Authority, origin?: Subscription<unknown>): Promise<SessionExpiration> {
    if (authority.token === undefined) return { cleared: false };
    return this.custody(async () => {
      if (this.currentToken !== authority.token) return { cleared: false };
      this.operationFence += 1;
      const fence = this.operationFence;
      const authGeneration = this.authGeneration + 1;
      this.closeTransports(origin);
      try {
        await this.clearTokenNow();
      } finally {
        this.authGeneration += 1;
        this.publishAuthSnapshot();
      }
      return { cleared: true, authGeneration, fence };
    });
  }

  private expirationCurrent(expiration: SessionExpiration): boolean {
    return expiration.cleared
      && !this.closed
      && this.currentToken === undefined
      && this.operationFence === expiration.fence
      && this.authGeneration === expiration.authGeneration;
  }

  private async installToken(token: string): Promise<void> {
    await this.custody(async () => {
      this.ensureOpen();
      await this.saveToken(token);
      // Persistence may have outlived close(). Retain the durable token for a
      // future client restore, but never resurrect this closed instance.
      this.ensureOpen();
      this.currentToken = token;
    });
  }

  private custody<Result>(action: () => Promise<Result>): Promise<Result> {
    const run = this.custodyTail.then(action);
    this.custodyTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async saveToken(token: string): Promise<void> {
    if (!this.tokenStore) return;
    try {
      await this.tokenStore.save(token);
    } catch (error) {
      throw this.storageRefusal("save", error);
    }
  }

  private async clearToken(): Promise<void> {
    await this.custody(() => this.clearTokenNow());
  }

  private async clearTokenNow(): Promise<void> {
    let failure: SnapbackRefusal | undefined;
    if (this.tokenStore) {
      try {
        await this.tokenStore.save(null);
      } catch (error) {
        failure = this.storageRefusal("clear", error);
      }
    }
    this.currentToken = undefined;
    if (failure) throw failure;
  }

  private storageRefusal(action: string, error: unknown): SnapbackRefusal {
    const refusal = new SnapbackRefusal({
      code: "E_AUTH_TOKEN_STORE",
      family: "auth",
      message: `token store ${action} failed: ${error instanceof Error ? error.message : String(error)}`,
      guide: "auth/session",
    });
    this.recordRefusal(refusal.envelope);
    return refusal;
  }

  private ensureBearerTransition(action: string): void {
    if (this.persona === undefined) return;
    const refusal = new SnapbackRefusal({
      code: "E_AUTH_PERSONA_TRANSITION",
      family: "auth",
      message: `dev persona clients cannot ${action} a bearer session`,
      guide: "auth/personas",
    });
    this.recordRefusal(refusal.envelope);
    throw refusal;
  }

  private trackWrite<Result>(run: () => Promise<Result>): Promise<Result> {
    const request = run();
    this.writes.add(request as Promise<unknown>);
    void request.finally(() => this.writes.delete(request as Promise<unknown>)).catch(() => undefined);
    return request;
  }

  private async settleWrites(): Promise<void> {
    while (this.writes.size > 0) await Promise.allSettled([...this.writes]);
  }

  private closeTransports(except?: Subscription<unknown>): void {
    for (const subscription of [...this.subscriptions]) {
      if (subscription !== except) subscription.close();
    }
  }

  private authorityCurrent(authority: Authority | undefined): authority is Authority {
    return authority !== undefined
      && !this.closed
      && authority.fence === this.operationFence
      && authority.authGeneration === this.authGeneration
      && authority.token === this.currentToken;
  }

  private ensureAuthority(authority: Authority | undefined): asserts authority is Authority {
    if (!this.authorityCurrent(authority)) {
      throw this.supersededRefusal();
    }
  }

  private supersededRefusal(): SnapbackRefusal {
    return new SnapbackRefusal({
      code: "E_AUTH_SUPERSEDED",
      family: "auth",
      message: "operation belonged to a previous authentication generation",
      guide: "auth/session",
    });
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new SnapbackRefusal({
        code: "E_CLIENT_CLOSED",
        family: "owner",
        message: "client is closed",
        guide: "owner/connect",
      });
    }
  }

  private publishAuthSnapshot(): void {
    this.patchSnapshot({ authGeneration: this.authGeneration, token: this.currentToken });
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
    for (const listener of this.statusListeners) listener(next);
    return next;
  }
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — one small headless client speaks the owner wire directly.
export function createClient(options: CreateClientOptions): SnapbackClient {
  return new Client(options);
}

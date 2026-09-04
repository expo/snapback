import { api, referenceName, type Api, type ApiProxy, type Channel as ChannelRef, type Op } from "./api.js";
import {
  AssetInputError,
  assetPath,
  assetRecord,
  expoUploadFetch,
  isBlobLike,
  isBrowserFile,
  isNativeAssetSource,
  mayNeedAssetPlanning,
  planAssetArguments,
  prepareAssetSource,
  preparedBody,
  substituteAssetRecords,
  withProgress,
  type PreparedAssetSource,
} from "./assets.js";
import { DrainSubscription } from "./drain.js";
import { OfflineProtocolShapeError } from "./offline-protocol.js";
import { OfflineRuntime, offlineView, type AcceptedDelivery, type MountedQuery } from "./offline.js";
import { ReconnectingSse } from "./sse.js";
import { stableSerialize } from "./types.js";
import type {
  AssetInput,
  AssetRecord,
  AssetUploadOptions,
  AssetUploadSource,
  AssetUrlOptions,
  AuthMe,
  AuthSession,
  AuthTokenStore,
  ChannelDelivery,
  ChannelHandle,
  ChannelPublishResult,
  ClientSnapshot,
  CreateClientOptions,
  Cursor,
  ImageAsset,
  LiveQueryDelivery,
  Manifest,
  MutationResult,
  Principal,
  QueryRefusedDelivery,
  QueryResult,
  RefusalEnvelope,
  RefusedDelivery,
  SnapbackClient,
  ServerQueryResult,
  Subscription,
  SubscriptionDelivery,
  VideoAsset,
} from "./types.js";

export { api };
export type { Api, ApiProxy, ChannelRef as Channel, Op };
export * from "./types.js";
export type {
  Coverage,
  HeldAnswer,
  OutboxEntry,
  OutboxStore,
  RangeStore,
  RangeStoreFactory,
  Receipt,
  ReceiptRange,
  StoreSwap,
} from "./store/range-store.js";

function fallbackRefusal(code: string, message: string): RefusalEnvelope {
  return { code, family: "owner", message, guide: "owner/connect" };
}

const snapbackRefusalBrand = Symbol.for("snapback2.SnapbackRefusal");

export class SnapbackRefusal extends Error {
  readonly [snapbackRefusalBrand] = true;
  readonly envelope: RefusalEnvelope;
  readonly code: string;

  constructor(envelope: RefusalEnvelope, readonly retryable = false, readonly status?: number) {
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

function nullableString(record: Record<string, unknown>, field: string, surface: string): string | null {
  const value = present(record, field, surface);
  if (value !== null && typeof value !== "string") throw wireShape(`${surface}.${field} must be a string or null`);
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

function isTerminalSession(envelope: Pick<RefusalEnvelope, "code" | "family">): boolean {
  return envelope.code === "E_AUTH_SESSION" && envelope.family === "auth";
}

function wireQuery<Result>(value: unknown, surface = "query response"): ServerQueryResult<Result> {
  const record = wireObject(value, surface);
  switch (stringField(record, "state", surface)) {
    case "complete":
      return {
        state: "complete", data: present(record, "data", surface) as Result,
        seq: numberField(record, "seq", surface), next: nullableString(record, "next", surface) as Cursor | null,
      };
    case "capped": {
      for (const field of ["site", "take", "reason"]) {
        if (has(record, field)) throw wireShape(`${surface}.capped must not carry ${field}`);
      }
      return {
        state: "capped",
        data: present(record, "data", surface) as Result,
        seq: numberField(record, "seq", surface),
        next: nullableString(record, "next", surface) as Cursor | null,
      };
    }
    case "partial": {
      if (has(record, "next")) throw wireShape(`${surface}.partial must not carry next`);
      const partial = {
        state: "partial" as const,
        seq: numberField(record, "seq", surface),
        reason: stringField(record, "reason", surface),
      };
      return has(record, "data") ? { ...partial, data: record.data as Result } : partial;
    }
    case "denied":
      if (has(record, "next")) throw wireShape(`${surface}.denied must not carry next`);
      return { state: "denied", seq: numberField(record, "seq", surface), rule: stringField(record, "rule", surface) };
    default:
      throw wireShape(`${surface}.state must be complete, capped, partial, or denied`);
  }
}

function wireMutation<Result>(value: unknown): MutationResult<Result> {
  const surface = "mutation response";
  const record = wireObject(value, surface);
  if (has(record, "next")) throw wireShape(`${surface} must not carry next`);
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
    if (has(record, "next")) throw wireShape(`${surface}.refused must not carry next`);
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
  if (record.state !== "rejected" && record.state !== "refused") return undefined;
  const refusal = wireRefusalEnvelope(record, "terminal session response");
  return isTerminalSession(refusal) ? refusal : undefined;
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
    stringField(item, "planHash", `${surface}.ops.${name}`);
    present(item, "args", `${surface}.ops.${name}`);
  }
  const manifest: Manifest = {
    generation: stringField(record, "generation", surface),
    programGeneration: stringField(record, "programGeneration", surface),
    ops: ops as unknown as Manifest["ops"],
    channels: wireObject(present(record, "channels", surface), `${surface}.channels`),
    auth: wireObject(present(record, "auth", surface), `${surface}.auth`),
  };
  if (typeof record.schemaHash === "string") manifest.schemaHash = record.schemaHash;
  if (record.tables && typeof record.tables === "object" && !Array.isArray(record.tables)) {
    manifest.tables = record.tables as Manifest["tables"];
  }
  if (record.schema && typeof record.schema === "object" && !Array.isArray(record.schema)) {
    manifest.schema = record.schema as Manifest["schema"];
  }
  return manifest;
}

function wireAssetSession(value: unknown): { token: string; expiresAt: number } {
  const surface = "asset session response";
  const record = wireObject(value, surface);
  return {
    token: stringField(record, "token", surface),
    expiresAt: numberField(record, "expiresAt", surface),
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
      response.status,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["code", "family", "guide"].some((field) => has(value as Record<string, unknown>, field))) {
    throw new SnapbackRefusal(
      fallbackRefusal("E_TRANSPORT", `HTTP ${response.status} did not contain a refusal envelope`),
      true,
      response.status,
    );
  }
  return new SnapbackRefusal(wireRefusalEnvelope(value, `HTTP ${response.status} refusal`), false, response.status);
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
    loadPrincipal: () => storage.getItem(`${key}:principal`),
    savePrincipal: (principal) => {
      if (principal === null) storage.removeItem(`${key}:principal`);
      else storage.setItem(`${key}:principal`, principal);
    },
  };
}

interface Authority {
  authGeneration: number;
  custodyGeneration: number;
  fence: number;
  token?: string;
}

type SessionExpiration =
  | { cleared: false }
  | { cleared: true; authGeneration: number; fence: number };

type InternalClientOptions = CreateClientOptions & { offlinePrincipal?: Principal };

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — auth custody is restored explicitly and every principal transition fences old in-memory work.
class Client implements SnapbackClient {
  readonly auth;
  readonly ready: Promise<void>;
  private readonly url: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly customFetch: boolean;
  private readonly tokenStore?: AuthTokenStore;
  private readonly persona?: string;
  private readonly createOptions: CreateClientOptions;
  private readonly offlineRuntime?: OfflineRuntime;
  private readonly mounted = new Map<string, MountedQuery>();
  private resumeTail: Promise<void> = Promise.resolve();
  private forcedOffline = false;
  private currentToken?: string;
  private currentPrincipal?: Principal;
  private authGeneration = 0;
  private custodyGeneration = 0;
  private operationFence = 0;
  private transitionTail: Promise<void> = Promise.resolve();
  private custodyTail: Promise<void> = Promise.resolve();
  private currentSnapshot: ClientSnapshot;
  private readonly statusListeners = new Set<(snapshot: ClientSnapshot) => void>();
  private readonly subscriptions = new Set<Subscription<unknown>>();
  private readonly writes = new Set<Promise<unknown>>();
  private carrier?: {
    token: string;
    expiresAt: number;
    authGeneration: number;
    custodyGeneration: number;
    fence: number;
  };
  private closed = false;

  constructor(options: InternalClientOptions) {
    if (!options?.url) throw new TypeError("createClient requires url");
    if (options.as !== undefined && (options.token !== undefined || options.tokenStore !== undefined)) {
      throw new TypeError("createClient cannot combine dev persona `as` with bearer token custody");
    }
    if (options.offline !== undefined) {
      if (!options.offline || typeof options.offline !== "object" || typeof options.offline.store !== "function") {
        throw new TypeError("createClient offline.store must be a carrier factory");
      }
      if (options.offline.fenceDays !== undefined
        && (!Number.isInteger(options.offline.fenceDays)
          || options.offline.fenceDays < 1 || options.offline.fenceDays > 30)) {
        throw new TypeError("createClient offline.fenceDays must be an integer from 1 through 30");
      }
      if (options.offline.maxAssetBytes !== undefined
        && (!Number.isSafeInteger(options.offline.maxAssetBytes) || options.offline.maxAssetBytes < 1)) {
        throw new TypeError("createClient offline.maxAssetBytes must be a positive safe integer");
      }
    }
    this.createOptions = options;
    this.url = options.url.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.customFetch = options.fetch !== undefined;
    if (typeof this.fetchImpl !== "function") throw new TypeError("createClient requires a fetch implementation");
    this.tokenStore = options.tokenStore;
    this.persona = options.as;
    this.currentSnapshot = {
      authGeneration: 0,
      persona: options.as,
      connection: "reconnecting",
    };
    try {
      this.offlineRuntime = options.offline ? new OfflineRuntime(options.offline) : undefined;
    } catch (error) {
      throw this.offlineRefusal(error);
    }
    this.auth = {
      signup: (input: { email: string; password: string }) => this.session("/api/auth/signup", input),
      login: (input: { email: string; password: string }) => this.session("/api/auth/login", input),
      guest: () => this.session("/api/auth/guest", {}),
      logout: () => this.logout(),
      me: () => this.me(),
    };
    this.ready = this.hydrate(options.token).then(() => this.initializeOffline());
  }

  get snapshot(): ClientSnapshot {
    return this.currentSnapshot;
  }

  async query<Args, Result>(ref: Op<Args, Result>, args: Args): Promise<QueryResult<Result>> {
    const authority = await this.operationAuthority();
    const op = referenceName(ref);
    if (this.forcedOffline) return this.offlineAnswer<Result>(op, args);
    let backoff = 50;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const raw = await this.json("/api/query", {
          method: "POST",
          body: JSON.stringify(this.offlineRuntime ? { op, args, receipt: 1 } : { op, args }),
        }, authority);
        const accepted = this.acceptOffline<Result>(op, args, raw);
        const result = wireQuery<Result>(accepted.result);
        await this.commitOffline(op, args, accepted);
        this.validated(authority);
        // Every typed receipt terminates this request. In particular, an
        // empty Capped array is the terminal drain state, never a retry cue.
        return result;
      } catch (error) {
        if (isSnapbackRefusal(error) && error.retryable && this.offlineRuntime && attempt >= 3) {
          return this.offlineAnswer<Result>(op, args);
        }
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

  async mutation<Args, Result>(ref: Op<Args, Result>, args: AssetInput<Args>): Promise<MutationResult<Result>> {
    const authority = await this.operationAuthority();
    return this.trackWrite(async () => {
      try {
        let mutationArgs: unknown = args;
        if (mayNeedAssetPlanning(args)) {
          // @ref LLP 1006#10-clients — the descriptor fence binds substitution
          // to the manifest read here. The owner independently validates the
          // resulting records against its live generation on every request.
          const operation = referenceName(ref);
          const descriptorManifest = await this.manifestFor(authority);
          const descriptor = descriptorManifest.ops[operation]?.args;
          if (descriptor === undefined) {
            throw this.assetInput(new AssetInputError(
              "E_ASSET_TYPE",
              `manifest generation ${descriptorManifest.generation} has no argument descriptor for ${operation}`,
            ));
          }
          const placements = await planAssetArguments(args, descriptor)
            .catch((error) => { throw this.assetInput(error); });
          if (placements.length > 0) {
            const records: AssetRecord[] = [];
            for (const placement of placements) {
              records.push(await this.uploadPrepared(placement.prepared, {}, authority));
            }
            const current = await this.manifestFor(authority);
            if (current.generation !== descriptorManifest.generation) {
              throw this.assetInput(new AssetInputError(
                "E_ASSET_NOT_READY",
                `descriptor generation changed from ${descriptorManifest.generation} to ${current.generation} during asset upload`,
              ));
            }
            mutationArgs = substituteAssetRecords(args, placements, records);
          }
        }
        const result = wireMutation<Result>(await this.json("/api/mutation", {
          method: "POST",
          body: JSON.stringify({ op: referenceName(ref), args: mutationArgs }),
        }, authority));
        if (result.state === "rejected" && isTerminalSession(result)) {
          const wasCurrent = this.authorityCurrent(authority);
          const expiration = await this.expireSession(authority);
          if (!wasCurrent || !this.expirationCurrent(expiration)) throw this.supersededRefusal();
          this.recordRefusal(result);
          return result;
        }
        this.validated(authority);
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
    });
  }

  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "image" }): Promise<ImageAsset>;
  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "video" }): Promise<VideoAsset>;
  upload(source: AssetUploadSource, options?: AssetUploadOptions): Promise<AssetRecord>;
  async upload(source: AssetUploadSource, options: AssetUploadOptions = {}): Promise<AssetRecord> {
    const authority = await this.operationAuthority();
    return this.trackWrite(async () => {
      const prepared = await prepareAssetSource(source)
        .catch((error) => { throw this.assetInput(error); });
      return this.uploadPrepared(prepared, options, authority);
    });
  }

  async assetUrl(asset: AssetRecord | null | undefined, options?: AssetUrlOptions): Promise<string | undefined>;
  async assetUrl(assets: readonly AssetRecord[], options?: AssetUrlOptions): Promise<string[]>;
  async assetUrl(
    assetOrList: AssetRecord | readonly AssetRecord[] | null | undefined,
    options: AssetUrlOptions = {},
  ): Promise<string | string[] | undefined> {
    const authority = await this.operationAuthority();
    const records = Array.isArray(assetOrList)
      ? assetOrList
      : assetOrList == null ? [] : [assetOrList as AssetRecord];
    const wantsCarrier = options.carrier === true || options.download === true;
    if (wantsCarrier && records.some((asset) => !("duration" in asset))) {
      throw this.assetInput(new AssetInputError(
        "E_ASSET_CARRIER_IMAGE",
        "image asset URLs never carry a session token; fetch the URL with assetHeaders or assetBlob",
      ));
    }
    let carrier: string | undefined;
    if (wantsCarrier && records.length > 0 && (authority.token !== undefined || this.persona !== undefined)) {
      carrier = await this.assetCarrier(authority);
    }
    try {
      if (Array.isArray(assetOrList)) {
        return assetOrList.map((asset) => assetPath(this.url, asset, options.width, carrier));
      }
      return assetOrList == null
        ? undefined
        : assetPath(this.url, assetOrList as AssetRecord, options.width, carrier);
    } catch (error) {
      throw this.assetInput(error);
    }
  }

  async assetHeaders(): Promise<Record<string, string>> {
    const authority = await this.operationAuthority();
    const headers: Record<string, string> = {};
    if (authority.token) headers.Authorization = `Bearer ${authority.token}`;
    if (this.persona) headers["X-Snapback-As"] = this.persona;
    return headers;
  }

  async assetBlob(url: string, options: { signal?: AbortSignal } = {}): Promise<Blob> {
    const authority = await this.operationAuthority();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw this.assetInput(new AssetInputError("E_ASSET_TYPE", "asset blob URL must be absolute"));
    }
    const base = new URL(this.url);
    if (parsed.origin !== base.origin || !parsed.pathname.startsWith("/api/asset/") || parsed.searchParams.has("s")) {
      throw this.assetInput(new AssetInputError(
        "E_ASSET_TYPE",
        "asset blob fetch requires a tokenless URL issued by this client",
      ));
    }
    const headers = this.headers(authority);
    headers.set("Accept", "*/*");
    const response = await this.fetchResponse(url, { headers, signal: options.signal }, authority);
    this.validated(authority);
    return response.blob();
  }

  subscribe<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
    options: { drain?: boolean } = {},
  ): Subscription<SubscriptionDelivery<Result>> {
    if (options.drain) return this.drain(ref, args, callback);
    return this.subscribeRegular(ref, args, callback);
  }

  private subscribeRegular<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
  ): Subscription<SubscriptionDelivery<Result>> {
    const op = referenceName(ref);
    const mountedKey = `${op}\u0000${stableSerialize(args)}`;
    this.mounted.set(mountedKey, { op, args, drain: false });
    let lastPair: { seq: number; data?: Result } | undefined;
    let authority: Authority | undefined;
    let subscription: Subscription<SubscriptionDelivery<Result>>;
    subscription = new ReconnectingSse<SubscriptionDelivery<Result>>({
      open: async (lastEventId, signal) => {
        authority ??= await this.operationAuthority();
        if (this.forcedOffline) throw this.networkOffline();
        const held = await this.offlineRuntime?.answer(op, args);
        let path = `/api/subscribe?op=${encodeURIComponent(op)}&args=${encodeURIComponent(JSON.stringify(args))}`;
        if (this.offlineRuntime) path += "&receipt=1";
        if (held?.validator) path += `&validator=${encodeURIComponent(held.validator)}`;
        return this.stream(path, lastEventId, signal, authority);
      },
      decode: async ({ data }) => {
        const raw = sseObject(data, "subscription delivery");
        const accepted = this.acceptOffline<Result>(op, args, raw);
        const value = accepted.envelope
          ? { ...wireQuery<Result>(accepted.result, "subscription delivery"), live: true as const }
          : wireSubscription<Result>(data);
        if (value.state === "refused" && isTerminalSession(value)) {
          throw new SnapbackRefusal(copyRefusal(value));
        }
        this.ensureAuthority(authority);
        if (value.state !== "refused") await this.commitOffline(op, args, accepted);
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
      bufferedTerminal: ({ data }) => {
        const value = wireSubscription<Result>(data);
        return value.state === "refused" && isTerminalSession(value)
          ? new SnapbackRefusal(copyRefusal(value))
          : undefined;
      },
      onError: async (error) => {
        const { retry, event, refusal } = await this.subscriptionError(error, authority, subscription);
        if (retry && this.offlineRuntime) {
          const held = await this.offlineRuntime.answer<Result>(op, args);
          this.patchSnapshot({ connection: "offline" });
          return { retry, event: offlineView(held) as SubscriptionDelivery<Result>, failure: refusal };
        }
        return {
          retry,
          event: event === undefined ? undefined : { ...event, live: false as const },
          failure: refusal,
        };
      },
      onLoss: () => {
        if (!this.authorityCurrent(authority)) return undefined;
        this.patchSnapshot({ connection: this.transportFailureState() });
        if (this.offlineRuntime) return undefined;
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
    const tracked = this.track(subscription);
    const close = tracked.close.bind(tracked);
    tracked.close = () => {
      this.mounted.delete(mountedKey);
      close();
    };
    return tracked;
  }

  private drain<Args, Result>(
    ref: Op<Args, Result>,
    args: Args,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
  ): Subscription<SubscriptionDelivery<Result>> {
    const op = referenceName(ref);
    const key = `${op}\u0000${stableSerialize(args)}`;
    this.mounted.set(key, { op, args, drain: true });
    const draining = new DrainSubscription<Args, Result>({
      args,
      query: (pageArgs) => this.query(ref, pageArgs),
      subscribe: (tailArgs, onEvent) => this.subscribeRegular(ref, tailArgs, onEvent),
      mark: async (watermark) => {
        if (!this.offlineRuntime) return;
        const tailArgs = { ...(args as Record<string, unknown>), c: watermark };
        const held = await this.offlineRuntime.answer(op, tailArgs);
        await this.offlineRuntime.markWatermark(op, args, watermark, held?.validator);
      },
      onEvent: callback,
    });
    const tracked = this.track(draining);
    const close = tracked.close.bind(tracked);
    tracked.close = () => {
      this.mounted.delete(key);
      close();
    };
    return tracked;
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
            if (isTerminalSession(result)) {
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
            if ("state" in value && value.state === "refused" && isTerminalSession(value)) {
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
          bufferedTerminal: ({ data }) => {
            const value = wireChannelDelivery<Payload>(data);
            return "state" in value && value.state === "refused" && isTerminalSession(value)
              ? new SnapbackRefusal(copyRefusal(value))
              : undefined;
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
    return this.manifestFor(authority);
  }

  async offline(): Promise<void> {
    await this.ready;
    this.ensureOpen();
    this.forcedOffline = true;
    this.patchSnapshot({ connection: "offline" });
    this.reconnectTransports();
  }

  async online(): Promise<void> {
    await this.ready;
    this.ensureOpen();
    this.forcedOffline = false;
    this.patchSnapshot({ connection: "reconnecting" });
    const authority = await this.operationAuthority();
    const run = this.performResume(authority);
    this.resumeTail = run.then(() => undefined, () => undefined);
    await run;
    this.reconnectTransports();
  }

  async restart(): Promise<SnapbackClient> {
    await this.ready;
    this.ensureOpen();
    const stayedOffline = this.forcedOffline;
    const offline = this.createOptions.offline;
    const options: InternalClientOptions = this.persona !== undefined
      ? { url: this.url, as: this.persona, fetch: this.fetchImpl, offline }
      : { url: this.url, token: this.currentToken, tokenStore: this.tokenStore, fetch: this.fetchImpl, offline,
          offlinePrincipal: this.currentPrincipal };
    this.closed = true;
    this.operationFence += 1;
    this.closeTransports();
    this.patchSnapshot({ connection: "offline" });
    await this.offlineRuntime?.close();
    const restarted = new Client(options);
    await restarted.ready;
    if (stayedOffline) await restarted.offline();
    return restarted;
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
    this.operationFence += 1;
    this.closeTransports();
    this.patchSnapshot({ connection: "offline" });
    void this.offlineRuntime?.close();
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
      await this.openOffline(session.viewer);
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
      let wipeFailure: unknown;
      try { await this.wipeOffline(); } catch (error) { wipeFailure = error; }
      await this.clearToken();
      this.ensureOpen();
      if (requestFailure !== undefined) throw requestFailure;
      if (wipeFailure !== undefined) throw wipeFailure;
      this.validated(undefined);
      return result as { ok: boolean };
    });
  }

  private async me(): Promise<AuthMe> {
    const authority = await this.operationAuthority();
    const result = wireAuthMe(await this.json("/api/auth/me", {}, authority));
    await this.openOffline(result.viewer);
    this.validated(authority);
    return result;
  }

  private async hydrate(explicitToken: string | undefined): Promise<void> {
    let token = explicitToken;
    let principal: string | null | undefined;
    if (token === undefined && this.tokenStore) {
      try {
        const [storedToken, storedPrincipal] = await Promise.all([
          this.tokenStore.load(), this.tokenStore.loadPrincipal?.(),
        ]);
        token = storedToken ?? undefined;
        principal = storedPrincipal;
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
    if (token !== undefined && principal) this.currentPrincipal = principal as Principal;
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

  private async manifestFor(authority: Authority): Promise<Manifest> {
    const value = wireManifest(await this.json("/api/manifest", {}, authority));
    this.validated(authority);
    this.patchSnapshot({ generation: value.generation });
    this.offlineRuntime?.manifest(value);
    return value;
  }

  private async uploadPrepared(
    prepared: PreparedAssetSource,
    options: AssetUploadOptions,
    authority: Authority,
  ): Promise<AssetRecord> {
    this.ensureAuthority(authority);
    let response: Response;
    if (options.onProgress && isBrowserFile(prepared.source) && !this.customFetch
      && typeof XMLHttpRequest === "function") {
      response = await this.xhrUpload(prepared.source, prepared.bytes, options, authority);
    } else {
      let body;
      try {
        body = await preparedBody(prepared);
      } catch (error) {
        throw this.assetInput(error);
      }
      const headers = this.headers(authority);
      headers.set("Content-Length", String(prepared.bytes));
      const nativeExpoFile = isNativeAssetSource(prepared.source)
        && !/^(?:data|https?):/i.test(prepared.source.uri)
        && isBlobLike(body);
      if (nativeExpoFile) {
        let nativeFetch: typeof globalThis.fetch;
        try {
          nativeFetch = await expoUploadFetch();
        } catch (error) {
          throw this.assetInput(error);
        }
        options.onProgress?.({ loaded: 0, total: prepared.bytes });
        response = await this.fetchResponse(`${this.url}/api/upload`, {
          method: "POST",
          headers,
          body: body as unknown as BodyInit,
        }, authority, nativeFetch);
        options.onProgress?.({ loaded: prepared.bytes, total: prepared.bytes });
      } else {
        body = withProgress(body, prepared.bytes, options);
        const stream = !isBlobLike(body);
        response = await this.fetchResponse(`${this.url}/api/upload`, {
          method: "POST",
          headers,
          body: body as unknown as BodyInit,
          ...(stream ? { duplex: "half" } as RequestInit : {}),
        }, authority);
      }
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw this.assetInput(new AssetInputError("E_ASSET_TYPE", "upload response must contain valid JSON"));
    }
    try {
      const record = assetRecord(value);
      const produced = Object.hasOwn(record, "duration") ? "video" : "image";
      if (options.kind && options.kind !== produced) {
        throw new AssetInputError("E_ASSET_TYPE", `upload produced ${produced === "image" ? "an image" : "a video"} asset but kind ${options.kind} was requested`);
      }
      this.validated(authority);
      return record;
    } catch (error) {
      throw this.assetInput(error);
    }
  }

  private xhrUpload(
    file: File | Blob,
    bytes: number,
    options: AssetUploadOptions,
    authority: Authority,
  ): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.url}/api/upload`);
      for (const [name, value] of this.headers(authority)) xhr.setRequestHeader(name, value);
      options.onProgress?.({ loaded: 0, total: bytes });
      xhr.upload.onprogress = (event) => options.onProgress?.({
        loaded: Math.min(bytes, event.loaded),
        total: bytes,
      });
      xhr.onerror = () => reject(this.networkRefusal("asset upload failed"));
      xhr.onabort = () => reject(this.networkRefusal("asset upload was aborted"));
      xhr.onload = () => {
        try {
          this.ensureAuthority(authority);
          options.onProgress?.({ loaded: bytes, total: bytes });
          resolve(new Response(xhr.responseText, {
            status: xhr.status,
            headers: { "Content-Type": xhr.getResponseHeader("Content-Type") ?? "application/json" },
          }));
        } catch (error) {
          reject(error);
        }
      };
      xhr.send(file);
    }).then(async (response) => {
      if (response.ok) return response;
      if (response.status >= 400 && response.status < 500) {
        const refusal = await responseRefusal(response);
        this.recordRefusal(refusal.envelope);
        throw refusal;
      }
      throw this.transportRefusal(`/api/upload returned HTTP ${response.status}`);
    });
  }

  private async fetchResponse(
    url: string,
    init: RequestInit,
    authority: Authority,
    fetchImpl: typeof globalThis.fetch = this.fetchImpl,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      this.ensureAuthority(authority);
      throw this.networkRefusal(error instanceof Error ? error.message : String(error));
    }
    this.ensureAuthority(authority);
    if (response.ok) return response;
    if (response.status >= 400 && response.status < 500) {
      const refusal = await responseRefusal(response);
      this.recordRefusal(refusal.envelope);
      throw refusal;
    }
    throw this.transportRefusal(`${new URL(url).pathname} returned HTTP ${response.status}`);
  }

  private async assetCarrier(authority: Authority): Promise<string> {
    const refreshBefore = Date.now() + 60_000;
    if (this.carrier
      && this.carrier.authGeneration === authority.authGeneration
      && this.carrier.custodyGeneration === authority.custodyGeneration
      && this.carrier.fence === authority.fence
      && this.carrier.expiresAt > refreshBefore) return this.carrier.token;
    const carrier = wireAssetSession(await this.json(
      "/api/auth/asset-session",
      { method: "POST", body: JSON.stringify({}) },
      authority,
    ));
    this.ensureAuthority(authority);
    this.carrier = {
      token: carrier.token,
      expiresAt: carrier.expiresAt,
      authGeneration: authority.authGeneration,
      custodyGeneration: authority.custodyGeneration,
      fence: authority.fence,
    };
    return carrier.token;
  }

  private assetInput(error: unknown): SnapbackRefusal {
    if (isSnapbackRefusal(error)) return error;
    const input = error instanceof AssetInputError
      ? error
      : new AssetInputError("E_ASSET_TYPE", error instanceof Error ? error.message : String(error));
    const refusal = new SnapbackRefusal({
      code: input.code,
      family: "input",
      message: input.message,
      rewrite: "pass a File or { uri, size?/fileSize?, type?/mimeType? } only to a matching manifest asset argument",
      guide: "assets/client",
    });
    this.recordRefusal(refusal.envelope);
    return refusal;
  }

  private networkRefusal(message: string): SnapbackRefusal {
    const refusal = new SnapbackRefusal(fallbackRefusal("E_NETWORK", message), true);
    this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
    return refusal;
  }

  private transportRefusal(message: string): SnapbackRefusal {
    const refusal = new SnapbackRefusal(fallbackRefusal("E_TRANSPORT", message), true);
    this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
    return refusal;
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
    if (this.forcedOffline) throw this.networkOffline();
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
        if (clearTerminalSession && isTerminalSession(refusal.envelope)) {
          expiration = await this.expireSession(authority);
        }
        if (enforceAuthority && (!wasCurrent
          || (expiration !== undefined && !this.expirationCurrent(expiration)))) {
          throw this.supersededRefusal();
        }
        if (enforceAuthority && !(clearTerminalSession && isTerminalSession(refusal.envelope))) {
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
    let terminal: RefusalEnvelope | undefined;
    try {
      terminal = clearTerminalSession ? terminalSessionEnvelope(value) : undefined;
    } catch (error) {
      if (enforceAuthority) this.ensureAuthority(authority);
      else this.ensureOpen();
      throw error;
    }
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
    if (this.forcedOffline) throw this.networkOffline();
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
            if (isTerminalSession(refusal.envelope)
              && (signal.aborted || !this.authorityCurrent(authority))) {
              await this.expireSession(authority);
              throw this.supersededRefusal();
            }
            if (!isTerminalSession(refusal.envelope)) this.ensureAuthority(authority);
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
      signal.throwIfAborted();
      this.patchSnapshot({ connection: "connected" });
      return response;
    } catch (error) {
      if (isSnapbackRefusal(error) && isTerminalSession(error.envelope)) throw error;
      // An aborted transport can still settle when a custom fetch ignores its
      // signal. Fence it before interpreting or publishing the late result.
      this.ensureAuthority(authority);
      if (signal.aborted) throw error;
      if (isSnapbackRefusal(error)) {
        this.patchSnapshot({
          connection: error.retryable ? this.transportFailureState() : "connected",
          lastRefusal: error.envelope,
        });
        throw error;
      }
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
    if (isTerminalSession(refusal.envelope) && authority !== undefined) {
      const wasCurrent = this.authorityCurrent(authority);
      let expiration: SessionExpiration;
      try {
        expiration = await this.expireSession(authority, origin);
      } catch (error) {
        if (this.closed) {
          return { retry: false, refusal: this.supersededRefusal() };
        }
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
      if (this.closed) {
        return { retry: false, refusal: this.supersededRefusal() };
      }
      if (!wasCurrent || !this.expirationCurrent(expiration)) {
        return { retry: false, refusal: this.supersededRefusal() };
      }
    }
    if (this.closed) {
      return { retry: false, refusal: this.supersededRefusal() };
    }
    if (refusal.retryable) {
      this.patchSnapshot({ connection: this.transportFailureState(), lastRefusal: refusal.envelope });
      return { retry: true };
    }
    this.patchSnapshot({ connection: "connected", lastRefusal: refusal.envelope });
    return { retry: false, refusal, event: { state: "refused", ...refusal.envelope } };
  }

  private async initializeOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    const principal = this.persona === undefined
      ? (this.createOptions as InternalClientOptions).offlinePrincipal ?? this.currentPrincipal
      : `dev:${this.persona}` as Principal;
    if (!principal) return;
    await this.openOffline(principal);
    await this.performResume({
      authGeneration: this.authGeneration,
      custodyGeneration: this.custodyGeneration,
      fence: this.operationFence,
      token: this.currentToken,
    });
  }

  private async openOffline(principal: Principal): Promise<void> {
    if (!this.offlineRuntime) return;
    try {
      await this.offlineRuntime.open(principal);
      this.currentPrincipal = principal;
    } catch (error) {
      throw this.offlineRefusal(error);
    }
  }

  private async sealOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    try { await this.offlineRuntime.seal(); }
    catch (error) { throw this.offlineRefusal(error); }
  }

  private async wipeOffline(): Promise<void> {
    if (!this.offlineRuntime) return;
    try { await this.offlineRuntime.wipe(); this.currentPrincipal = undefined; }
    catch (error) { throw this.offlineRefusal(error); }
  }

  private acceptOffline<Result>(op: string, args: unknown, raw: unknown): AcceptedDelivery<Result> {
    if (!this.offlineRuntime) return { result: raw as AcceptedDelivery<Result>["result"] };
    try {
      return this.offlineRuntime.accept<Result>(op, args, raw);
    } catch (error) {
      if (error instanceof OfflineProtocolShapeError) throw wireShape(error.message);
      throw error;
    }
  }

  private async commitOffline(
    op: string,
    args: unknown,
    accepted: AcceptedDelivery<unknown>,
  ): Promise<void> {
    if (!this.offlineRuntime) return;
    try { await this.offlineRuntime.commit(op, args, accepted); }
    catch (error) { throw this.offlineRefusal(error); }
  }

  private async offlineAnswer<Result>(op: string, args: unknown): Promise<QueryResult<Result>> {
    this.patchSnapshot({ connection: "offline" });
    try {
      return offlineView(await this.offlineRuntime?.answer<Result>(op, args)) as QueryResult<Result>;
    } catch (error) {
      throw this.offlineRefusal(error);
    }
  }

  private async performResume(authority: Authority, retry = true): Promise<void> {
    if (!this.offlineRuntime || this.forcedOffline) return;
    const mounted = [...this.mounted.values()];
    const request = await this.offlineRuntime.resumeRequest(mounted);
    if (!request) return;
    let value: unknown;
    try {
      value = await this.json("/api/resume", { method: "POST", body: JSON.stringify(request) }, authority);
    } catch (error) {
      if (isSnapbackRefusal(error) && error.status === 404) return;
      if (isSnapbackRefusal(error) && error.code === "E_OFFLINE_RESET") {
        await this.offlineRuntime.resetCoverage();
        for (const subscription of this.subscriptions) {
          (subscription as Subscription<unknown> & { reset?: () => void }).reset?.();
        }
        return;
      }
      if (isSnapbackRefusal(error) && error.code === "E_OFFLINE_RESUME" && retry) {
        await this.offlineRuntime.dropOldestUnmounted(mounted, 1);
        return this.performResume(authority, false);
      }
      throw error;
    }
    const response = wireObject(value, "resume response");
    const responseMounted = present(response, "mounted", "resume response");
    if (!Array.isArray(responseMounted)) throw wireShape("resume response.mounted must be an array");
    const swaps: Array<{ op: string; args: unknown; accepted: AcceptedDelivery<unknown> }> = [];
    const log = response.log;
    if (log && typeof log === "object" && !Array.isArray(log)
      && (log as Record<string, unknown>).unchanged !== true && request.log) {
      swaps.push({ op: request.log.op, args: request.log.args, accepted: this.acceptOffline(request.log.op, request.log.args, log) });
    }
    for (const [index, item] of responseMounted.entries()) {
      if (item && typeof item === "object" && !Array.isArray(item)
        && (item as Record<string, unknown>).unchanged === true) continue;
      const requested = request.mounted[index];
      if (!requested) throw wireShape("resume response returned an unrequested mounted query");
      swaps.push({ op: requested.op, args: requested.args, accepted: this.acceptOffline(requested.op, requested.args, item) });
    }
    try { await this.offlineRuntime.commitMany(swaps); }
    catch (error) { throw this.offlineRefusal(error); }
    this.validated(authority);
  }

  private networkOffline(): SnapbackRefusal {
    return new SnapbackRefusal({
      code: "E_NETWORK",
      family: "owner",
      message: "client transport is offline",
      rewrite: "call client.online() to restore this device transport",
      guide: "offline",
    }, true);
  }

  private offlineRefusal(error: unknown): SnapbackRefusal {
    if (isSnapbackRefusal(error)) return error;
    const carrier = this.createOptions?.offline?.store.carrier
      ?? this.createOptions?.offline?.store.name
      ?? "configured";
    const candidateCode = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    const code = candidateCode === "E_OFFLINE_LOCK" || candidateCode === "E_OFFLINE_CARRIER"
      ? candidateCode : "E_OFFLINE_CARRIER";
    const rewrite = code === "E_OFFLINE_LOCK"
      ? "this account is open in another tab"
      : `install or configure the ${carrier} carrier`;
    const refusal = new SnapbackRefusal({
      code,
      family: "offline",
      message: error instanceof Error ? error.message : String(error),
      site: "RangeStore.open",
      rewrite,
      guide: "offline",
    });
    this.recordRefusal(refusal.envelope);
    return refusal;
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
    await this.resumeTail;
    this.ensureOpen();
    return {
      authGeneration: this.authGeneration,
      custodyGeneration: this.custodyGeneration,
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
        custodyGeneration: this.custodyGeneration,
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
      if (this.currentToken !== authority.token
        || this.custodyGeneration !== authority.custodyGeneration) return { cleared: false };
      this.operationFence += 1;
      const fence = this.operationFence;
      const authGeneration = this.authGeneration + 1;
      this.closeTransports(origin);
      let sealFailure: unknown;
      try {
        try { await this.sealOffline(); } catch (error) { sealFailure = error; }
        await this.clearTokenNow();
        if (sealFailure !== undefined) throw sealFailure;
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
      await this.tokenStore?.savePrincipal?.(this.currentPrincipal ?? null);
      // Commit replacement custody only after durable persistence succeeds,
      // but before close can prevent its in-memory installation. Predecessor
      // evidence may clear a failed save; it cannot erase a completed one.
      this.custodyGeneration += 1;
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
        await this.tokenStore.savePrincipal?.(null);
      } catch (error) {
        failure = this.storageRefusal("clear", error);
      }
    }
    this.currentToken = undefined;
    this.currentPrincipal = undefined;
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

  private reconnectTransports(): void {
    for (const subscription of this.subscriptions) {
      (subscription as Subscription<unknown> & { reconnect?: () => void }).reconnect?.();
    }
  }

  private authorityCurrent(authority: Authority | undefined): authority is Authority {
    return authority !== undefined
      && !this.closed
      && authority.fence === this.operationFence
      && authority.authGeneration === this.authGeneration
      && authority.custodyGeneration === this.custodyGeneration
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
    return this.forcedOffline || (typeof navigator !== "undefined" && navigator.onLine === false)
      ? "offline" : "reconnecting";
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

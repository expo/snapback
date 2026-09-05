import type { AssetFetchOptions } from "./store/byte-cache.js";
import type { Channel as ChannelRef, Op } from "./api.js";
import type { AssetCache, ByteCacheEntry, ByteCacheStatus, ViewOncePredicate } from "./store/byte-cache.js";
import type { OutboxEntry, RangeStoreFactory, RowRef, StoredRow } from "./store/range-store.js";

export type { OutboxEntry, OutboxGrant, OutboxState, OutboxTrace } from "./store/range-store.js";

export type { AssetCache, ByteCacheEntry, ByteCacheStatus, ViewOncePredicate };

// @ref LLP 1006#1-the-move — the phantom kind keeps the two closed asset records
// nominal; these must stay identical to the package-root declarations the
// generated `snapback2` API imports, or a client-minted record cannot flow into
// a generated argument.
export type ImageAsset = { readonly __asset: "image"; readonly id: string; readonly width: number; readonly height: number };
export type VideoAsset = { readonly __asset: "video"; readonly id: string; readonly width: number; readonly height: number; readonly duration: number };

/** Server-minted authority subject; structurally compatible with `snapback2.Principal`. */
export type Principal = string & { readonly __snapbackPrincipal: "Principal" };
export type Cursor = string & { readonly __snapbackCursor: "Cursor" };

export interface RefusalEnvelope {
  code: string;
  family: string;
  message: string;
  site?: string;
  rule?: string;
  rewrite?: string;
  guide: string;
  /** Offline resume detail identifying the request member that exceeded a cap. */
  which?: string;
  /** Offline resume detail limiting the next bounded request. */
  cap?: number;
}

/** Opt-in body fields for a query request that asks for local-first custody. */
export interface QueryReceiptRequest {
  readonly receipt: true;
  readonly validator?: string;
}

/** Opt-in query fields for a subscription request that asks for local-first custody. */
export interface SubscribeReceiptRequest {
  readonly receipt: true;
  readonly validator?: string;
}

export type QueryComplete<Result> = { state: "complete"; data: Result; seq: number; next: Cursor | null };
export type QueryCapped<Result> = {
  state: "capped";
  data: Result;
  seq: number;
  next: Cursor | null;
};
export type QueryPartial<Result> = {
  state: "partial";
  data?: Result;
  seq: number;
  reason: string;
};
export type QueryDenied = {
  state: "denied";
  seq: number;
  rule: string;
};
export type ServerQueryResult<Result> =
  | QueryComplete<Result>
  | QueryCapped<Result>
  | QueryPartial<Result>
  | QueryDenied;

export type OfflineFacts = {
  live: false;
  connection: "offline";
  stale: { since: number };
  retained?: boolean;
  caughtUp?: boolean;
  watermark?: Cursor | null;
  /** Queued intents whose predicted rows are inside `data`, in order (the twin, LLP 1012 §7). */
  predicted?: string[];
  /** A local `partial`: the uncovered site and every uncovered site with its reason. */
  site?: string;
  sites?: Array<{ site: string; reason: "never-held" | "evicted" | "computed-key" }>;
};
export type OfflineQueryResult<Result> =
  | (QueryComplete<Result> & OfflineFacts)
  | (QueryCapped<Result> & OfflineFacts)
  | (QueryPartial<Result> & OfflineFacts)
  | (QueryDenied & OfflineFacts)
  | { state: "hydrating"; live: false; connection: "offline" };
export type QueryResult<Result> = ServerQueryResult<Result> | OfflineQueryResult<Result>;

export type MutationCommitted<Result> = { state: "committed"; seq: number; data: Result; intent?: string };
export type MutationRejected = {
  state: "rejected";
  code: string;
  family: string;
  message: string;
  retryable?: boolean;
  rewrite?: string;
  site?: string;
  rule?: string;
  guide: string;
  /** `conflict` when trace validation rolled a replayed write back (LLP 1012 §7). */
  reason?: string;
  intent?: string;
};
/** The write is durable in this device's outbox and will replay after the next resume. */
export type MutationQueued = { state: "queued"; intent: string; ids: string[] };
export type MutationResult<Result> = MutationCommitted<Result> | MutationRejected | MutationQueued;

export type LiveQueryDelivery<Result> = ServerQueryResult<Result> & { live: true; caughtUp?: boolean; watermark?: Cursor | null };
export type StaleDelivery<Result> = {
  state: "stale";
  live: false;
  since: number;
  data?: Result;
  seq?: number;
};
export type RefusedDelivery = {
  state: "refused";
  code: string;
  family: string;
  message: string;
  site?: string;
  rule?: string;
  rewrite?: string;
  guide: string;
  seq?: number;
};
export type QueryRefusedDelivery = RefusedDelivery & { live: false };
export type SubscriptionDelivery<Result> =
  | LiveQueryDelivery<Result>
  | (ServerQueryResult<Result> & { live: false; caughtUp?: boolean; watermark?: Cursor | null })
  | OfflineQueryResult<Result>
  | StaleDelivery<Result>
  | QueryRefusedDelivery;

export interface Subscription<Event> {
  close(): void;
  until(predicate: (event: Event) => boolean, timeoutMs?: number): Promise<Event>;
}

export interface AuthSession { token: string; viewer: Principal; authEpoch?: number }
export interface AuthMe { viewer: Principal; kind: string; authEpoch?: number }
export interface AuthApi {
  signup(input: { email: string; password: string }): Promise<AuthSession>;
  login(input: { email: string; password: string }): Promise<AuthSession>;
  guest(): Promise<AuthSession>;
  logout(): Promise<{ ok: boolean }>;
  me(): Promise<AuthMe>;
}

export interface ChannelEvent<Payload = unknown> { from: Principal; payload: Payload; at: number }
export type ChannelDelivery<Payload = unknown> = ChannelEvent<Payload> | RefusedDelivery;
export type ChannelPublishResult =
  | { ok: true }
  | ({ state: "refused" } & RefusalEnvelope);
export interface ChannelHandle<Payload = unknown> {
  publish(payload: Payload): Promise<ChannelPublishResult>;
  subscribe(callback: (event: ChannelDelivery<Payload>) => void): Subscription<ChannelDelivery<Payload>>;
}

export interface ManifestOperation { kind: string; args: unknown; planHash: string }
export interface ManifestTable { retain?: "until-revoked" | "delivered-history"; [key: string]: unknown }
export interface Manifest {
  generation: string;
  programGeneration: string;
  ops: Record<string, ManifestOperation>;
  channels: Record<string, unknown>;
  auth: Record<string, unknown>;
  schemaHash?: string;
  tables?: Record<string, ManifestTable>;
  schema?: { tables?: Record<string, ManifestTable>; [key: string]: unknown };
}

export type AssetRecord = ImageAsset | VideoAsset;
export interface NativeAssetSource {
  readonly uri: string;
  readonly size?: number;
  readonly fileSize?: number;
  readonly type?: string;
  readonly mimeType?: string;
}
export type AssetUploadSource = File | NativeAssetSource;
export interface UploadProgress {
  readonly loaded: number;
  readonly total: number;
}
export type AssetKind = "image" | "video";
export interface AssetUploadOptions {
  /**
   * The nominal record expected back. The server sniffs the bytes and decides the
   * kind; when `kind` is given the client verifies the returned record and refuses
   * `E_ASSET_TYPE` on a mismatch, so the result can flow straight into a generated
   * `image`/`video` argument (LLP 1006 §10). Without it the result is the union.
   */
  readonly kind?: AssetKind;
  /**
   * Reports streamed byte progress where the runtime supports request streams.
   * Expo native File uploads use expo/fetch's direct File body and report only
   * whole-body start and successful completion (0, then total).
   */
  readonly onProgress?: (progress: UploadProgress) => void;
}
export interface AssetUrlOptions {
  readonly width?: number;
  readonly carrier?: boolean;
  readonly download?: boolean;
}

/** Replaces generated asset leaves with the browser/native upload convenience accepted by the SDK. */
export type AssetInput<Value> =
  Value extends VideoAsset ? Value | File | NativeAssetSource
    : Value extends ImageAsset ? Value | File | NativeAssetSource
      : Value extends File ? Value
        : Value extends readonly (infer Item)[] ? AssetInput<Item>[]
          : Value extends object ? { [Key in keyof Value]: AssetInput<Value[Key]> }
            : Value;

export type ConnectionState = "connected" | "reconnecting" | "offline";
export interface AuthSnapshot {
  state: "hydrating" | "authenticated" | "anonymous" | "refused";
  viewer?: Principal;
  kind?: string;
  /** Previously confirmed for this token; display only, never fresh authorization. */
  restoringViewer?: Principal;
  refusal?: RefusalEnvelope;
  /** Unix milliseconds; present only while a restoration retry is scheduled. */
  retryAt?: number;
}
export interface ClientSnapshot {
  /** Client-local cache/transport partition; never a server bearer or epoch. */
  authGeneration: number;
  auth: AuthSnapshot;
  token?: string;
  persona?: string;
  connection: ConnectionState;
  generation?: string;
  lastRefusal?: RefusalEnvelope;
}

export interface AuthTokenStore {
  /** Restores the bearer before `client.ready` settles. */
  load(): string | null | undefined | Promise<string | null | undefined>;
  /** Persists a bearer, or clears custody with `null`. */
  save(token: string | null): void | Promise<void>;
  /** Optional token-bound custody for safe retained reads before network authentication. */
  loadPrincipalBinding?(): { token: string; principal: string } | null | undefined | Promise<{ token: string; principal: string } | null | undefined>;
  /** Legacy advisory principal; early reads require loadPrincipalBinding instead. */
  loadPrincipal?(): string | null | undefined | Promise<string | null | undefined>;
  savePrincipal?(principal: string | null, token?: string): void | Promise<void>;
}

interface ClientLocationOptions {
  url: string;
  fetch?: typeof globalThis.fetch;
  offline?: OfflineClientOptions;
}

export interface OfflineClientOptions {
  store: RangeStoreFactory;
  fenceDays?: number;
  /** Ceiling on cached asset bytes per partition, LRU by each rendition's own last read; default 256 MiB. */
  maxAssetBytes?: number;
  onTombstone?: (row: StoredRow) => RowRef[];
  /**
   * Names the rows whose media renders once: a viewed row is excluded from every
   * later offline answer and its bytes are never cached (LLP 1012 §9). This stands
   * in for LLP 1006's one-use delivery until that lands on the server.
   */
  viewOnce?: ViewOncePredicate;
}

/** A client has exactly one authority source: a dev persona or bearer custody. */
export type CreateClientOptions = ClientLocationOptions & (
  | { as: string; token?: never; tokenStore?: never }
  | { as?: never; token?: string; tokenStore?: AuthTokenStore }
);

// @ref LLP 1012#7-writes-offline — the outbox is readable before the first
// request, so a queued message is on screen at cold start.
export type OutboxSettlement = { stopped: false | "fence" | "transport" | "authority" | "offline" | "pending"; remaining: number };

export interface OutboxStatus {
  ready: boolean;
  reason: "ready" | "sealed" | "grant-missing" | "grant-expired" | "ids-exhausted" | "program-missing";
  action: "none" | "login" | "resume" | "load-program";
  /** Number of queued intents; settled entries are excluded. */
  remaining: number;
  fence: "inside" | "past";
}

export interface OutboxApi {
  /** Every durable intent of the open partition, FIFO; empty without a store. */
  entries(): Promise<OutboxEntry[]>;
  /** Drops one settled entry; queued intents cannot be dismissed. */
  dismiss(intent: string): Promise<void>;
  /** Observes the outbox; called with the current entries at once and after every change. */
  subscribe(listener: (entries: OutboxEntry[]) => void): () => void;
  /**
   * Without an op, true when a write will not refuse `E_OFFLINE_ID_BLOCK` for
   * want of a replay grant: no partition is open (today's bytes), or the open
   * partition holds a current, unexpired grant — minted by a login, a guest
   * call, or the first drain reaching its watermark. The fence gates replay and
   * prediction, not this (see `fence`). With an op, also means this write would
   * not refuse `E_OFFLINE_ID_BLOCK` for want of a known bound or capacity for
   * `1 + maxNewIds`. Grant, bound, fence, and expiry changes are observable
   * through `subscribe` even when the entries are unchanged (LLP 1012 §7).
   */
  ready<Args = unknown, Result = unknown>(op?: Op<Args, Result>): Promise<boolean>;
  /** Actionable admission state, using the same checks as enqueue. */
  status<Args = unknown, Result = unknown>(op?: Op<Args, Result>): Promise<OutboxStatus>;
  /** Past means replay waits for this partition's successful resume; enqueue remains ready. */
  fence(): Promise<"inside" | "past">;
  /** Replays FIFO; reports the stop reason and queued count without discarding work. */
  drain(): Promise<OutboxSettlement>;
  /**
   * Resolves once the in-flight replay, if any, emptied the queue or a retryable
   * transport failure stopped it; returns the stop reason and queued count,
   * and rejects with a non-retryable refusal that stopped it.
   */
  settled(): Promise<OutboxSettlement>;
}

export interface SnapbackClient {
  readonly auth: AuthApi;
  readonly outbox: OutboxApi;
  /** Settles only after explicit token restoration and any initial persistence. */
  readonly ready: Promise<void>;
  readonly snapshot: ClientSnapshot;
  query<Args, Result>(ref: Op<Args, Result>, args: NoInfer<Args>): Promise<QueryResult<Result>>;
  mutation<Args, Result>(ref: Op<Args, Result>, args: NoInfer<AssetInput<Args>>): Promise<MutationResult<Result>>;
  /** Uploads one browser File or Expo URI-backed File and returns its closed asset record. */
  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "image" }): Promise<ImageAsset>;
  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "video" }): Promise<VideoAsset>;
  upload(source: AssetUploadSource, options?: AssetUploadOptions): Promise<AssetRecord>;
  assetUrl(asset: AssetRecord | null | undefined, options?: AssetUrlOptions): Promise<string | undefined>;
  assetUrl(assets: readonly AssetRecord[], options?: AssetUrlOptions): Promise<string[]>;
  /** Authentication headers for a native image source; carriers stay reserved for players/downloads. */
  assetHeaders(): Promise<Record<string, string>>;
  /** Fetches a client-issued asset URL: the byte cache under the row's lease first, then the network with the header credential. */
  assetBlob(url: string, options?: AssetFetchOptions): Promise<Blob>;
  /** Native byte path: cache first, then an authenticated ArrayBuffer response; no Blob. */
  assetBytes(url: string, options?: AssetFetchOptions): Promise<import("./store/byte-cache.js").AssetBytes>;
  /** The partition's byte cache when the client has an offline store; components read it before the network. */
  readonly assetCache: AssetCache | undefined;
  /** Delivers validated query receipt states with `live: true`; transport loss is client-made `stale`. */
  subscribe<Args, Result>(
    ref: Op<Args, Result>,
    args: NoInfer<Args>,
    callback: (delivery: SubscriptionDelivery<Result>) => void,
    options?: { drain?: boolean },
  ): Subscription<SubscriptionDelivery<Result>>;
  channel<Args, Payload = unknown>(ref: ChannelRef<Args, Payload>, args: NoInfer<Args>): ChannelHandle<Payload>;
  manifest(): Promise<Manifest>;
  subscribeStatus(callback: (snapshot: ClientSnapshot) => void): () => void;
  /** Cut only this client's transport; the owner remains running. */
  offline(): Promise<void>;
  /** Restore transport and perform resume before new subscription opens. */
  online(): Promise<void>;
  /** Close and reopen this logical device on the same durable partition. */
  restart(): Promise<SnapbackClient>;
  /** Resolves when the offline carrier is quiet; safe to remove the store after. */
  close(): Promise<void>;
}

type ViewFacts = { live: boolean; stale?: { since: number }; retained?: boolean; caughtUp?: boolean; watermark?: Cursor | null; predicted?: string[] };
export type QueryView<Result> =
  | (QueryComplete<Result> & ViewFacts)
  | (QueryCapped<Result> & ViewFacts)
  | (QueryPartial<Result> & ViewFacts)
  | (QueryDenied & ViewFacts)
  | { state: "refused"; live: false; refusal: RefusalEnvelope }
  | { state: "stale"; live: false; data?: Result; seq?: number; since: number }
  | { state: "hydrating"; live: false };
export type QueryViewState = QueryView<unknown>["state"];
export type QueryHookResult<Result> = QueryView<Result> & { connection: ConnectionState };
export type QueryMachineEvent<Result> = QueryResult<Result> | SubscriptionDelivery<Result>;

export function initialQueryState<Result>(): QueryView<Result> {
  return { state: "hydrating", live: false };
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value as object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

export function stableSerialize(value: unknown): string {
  return canonical(value);
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — React preserves data identity while exposing every receipt-backed state.
export function reduceQueryState<Result>(
  current: QueryView<Result>,
  event: QueryMachineEvent<Result>,
): QueryView<Result> {
  const eventData = "data" in event ? event.data : undefined;
  const currentData = "data" in current ? current.data : undefined;
  const data = canonical(eventData) === canonical(currentData) ? currentData : eventData;
  const live = "live" in event ? event.live : false;
  const facts = {
    ...("stale" in event && event.stale !== undefined ? { stale: event.stale } : {}),
    ...("retained" in event && event.retained !== undefined ? { retained: event.retained } : {}),
    ...("caughtUp" in event && event.caughtUp !== undefined ? { caughtUp: event.caughtUp } : {}),
    ...("watermark" in event && event.watermark !== undefined ? { watermark: event.watermark } : {}),
    ...("predicted" in event && event.predicted !== undefined ? { predicted: event.predicted } : {}),
  };
  let next: QueryView<Result>;
  switch (event.state) {
    case "complete":
      next = { state: "complete", live, data: data as Result, seq: event.seq, next: event.next, ...facts };
      break;
    case "capped":
      next = { state: "capped", live, data: data as Result, seq: event.seq, next: event.next, ...facts };
      break;
    case "partial":
      next = data === undefined
        ? { state: "partial", live, seq: event.seq, reason: event.reason, ...facts }
        : { state: "partial", live, data: data as Result, seq: event.seq, reason: event.reason, ...facts };
      break;
    case "denied":
      next = { state: "denied", live, rule: event.rule, seq: event.seq, ...facts };
      break;
    case "hydrating":
      next = { state: "hydrating", live: false };
      break;
    case "refused": {
      const refusal: RefusalEnvelope = {
        code: event.code,
        family: event.family,
        message: event.message,
        guide: event.guide,
      };
      if (event.site !== undefined) refusal.site = event.site;
      if (event.rule !== undefined) refusal.rule = event.rule;
      if (event.rewrite !== undefined) refusal.rewrite = event.rewrite;
      next = { state: "refused", live: false, refusal };
      break;
    }
    case "stale":
      next = data === undefined
        ? { state: "stale", live: false, ...(event.seq === undefined ? {} : { seq: event.seq }), since: event.since }
        : {
            state: "stale",
            live: false,
            data: data as Result,
            ...(event.seq === undefined ? {} : { seq: event.seq }),
            since: event.since,
          };
      break;
  }
  return canonical(current) === canonical(next) ? current : next;
}

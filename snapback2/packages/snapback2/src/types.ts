import type { AssetFetchOptions } from "./store/byte-cache.js";
import type { Channel as ChannelRef, Op } from "./api.js";
import type { AssetCache, ByteCacheEntry, ByteCacheStatus } from "./store/byte-cache.js";
import type { OutboxEntry, RangeStoreFactory } from "./store/range-store.js";
import type { Snapshot } from "./snapshot.js";
import type { HistorySnapshot, ItemRow, Items, ItemSnapshot, ItemsWithHistory } from "./client-items.js";
import { canonical } from "./store/canonical.js";

export type { OutboxEntry, OutboxGrant, OutboxState, OutboxTrace } from "./store/range-store.js";

export type { AssetCache, ByteCacheEntry, ByteCacheStatus };

// @ref LLP 1006#1-the-move — the phantom kind keeps the two closed asset records
// nominal; these must stay identical to the package-root declarations the
// generated `snapback2` API imports, or a client-minted record cannot flow into
// a generated argument.
export type ImageAsset = { readonly __asset: "image"; readonly id: string; readonly width: number; readonly height: number };
export type VideoAsset = { readonly __asset: "video"; readonly id: string; readonly width: number; readonly height: number; readonly duration: number };

/** Server-minted authority subject; structurally compatible with `snapback2.Principal`. */
export type Principal = string & { readonly __snapbackPrincipal: "Principal" };
export type Cursor = string & { readonly __snapbackCursor: "Cursor" };

export interface Refusal {
  code: string;
  family: string;
  message: string;
  rewrite?: string;
  guide?: string;
  site?: string;
  rule?: string;
  retryable?: boolean;
  reason?: string;
}
export type Action = "sign-in" | "connect" | "other-tab" | "wait" | "none";

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
/** Locally enumerated readable domain; server coverage remains unknown. */
export type QueryHeld<Result> = { state: "held"; data: Result; seq: number; next: Cursor | null };
export type QueryPartial<Result> = {
  state: "partial";
  data?: Result;
  seq: number;
  reason: string;
};
/** A retained projection may keep its owner's certified page boundary, never a locally minted partial cursor. */
type RetainedContinuation = { next?: Cursor | null };
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

/** One row a queued intent predicted, with the intent that minted it (LLP 1018.003 §4). */
export type PredictedRow = { table: string; id: string; intent: string };
export type OfflineFacts = {
  live: false;
  connection: "offline";
  stale: { since: number };
  retained?: boolean;
  caughtUp?: boolean;
  watermark?: Cursor | null;
  /** Rows the partition's queued intents predicted at evaluation time, each with its intent (the twin, LLP 1012 §7); match `id` against the rows you render. */
  predicted?: PredictedRow[];
  /** A local `partial`: the uncovered site and every uncovered site with its reason. */
  site?: string;
  sites?: Array<{ site: string; reason: "never-held" | "evicted" | "computed-key" }>;
};
export type OfflineQueryResult<Result> =
  | (QueryHeld<Result> & OfflineFacts)
  | (QueryComplete<Result> & OfflineFacts)
  | (QueryCapped<Result> & OfflineFacts)
  | (QueryPartial<Result> & OfflineFacts & RetainedContinuation)
  | (QueryDenied & OfflineFacts)
  | { state: "hydrating"; live: false; connection: "offline" };
export type QueryResult<Result> = ServerQueryResult<Result> | OfflineQueryResult<Result> | RefusedDelivery;

export type MutationCommitted<Result> = { effects?: import("./store/success-compaction.js").SuccessEffects; state: "committed"; seq: number; data: Result; intent?: string;
  program?: import("./mutation-targets.js").MutationProgramIdentity };
export type MutationRejected = { state: "rejected"; intent?: string; current?: Readonly<Record<string, unknown>> | null } & Refusal;
/**
 * The write is durable on this device and will replay after the next resume:
 * in this tab's outbox, or, from a browser tab that is not the account's
 * writer, as an inbox row named `inbox:<key>` with no ids until the writer
 * admits it (LLP 1018.004 §1). Every member of `MutationResult` is terminal
 * or durable; there is no fourth verdict.
 */
export type MutationQueued = { state: "queued"; intent: string; ids: string[] };
export type MutationResult<Result> = MutationCommitted<Result> | MutationRejected | MutationQueued;

export type ReceiptSource = "server" | "twin";
export type LiveQueryDelivery<Result> = ServerQueryResult<Result> & { live: true; caughtUp?: boolean; watermark?: Cursor | null };
export type StaleDelivery<Result> = {
  state: "stale";
  live: false;
  since: number;
  data?: Result;
  seq?: number;
};
export type RefusedDelivery = Refusal & {
  state: "refused";
  seq?: number;
};
export type QueryRefusedDelivery = RefusedDelivery & { live: false };
export type SubscriptionDelivery<Result> = (
  | LiveQueryDelivery<Result>
  | (ServerQueryResult<Result> & { live: false; caughtUp?: boolean; watermark?: Cursor | null })
  | OfflineQueryResult<Result>
  | StaleDelivery<Result>
  | QueryRefusedDelivery
) & { source?: ReceiptSource };

export interface Subscription<Event> {
  close(): void;
  until(predicate: (event: Event) => boolean, timeoutMs?: number): Promise<Event>;
}

export interface AuthSession extends AuthMe { token: string }
export interface AuthMe { viewer: Principal; kind: string; authEpoch?: number }
export interface AuthApi {
  signup(input: { email: string; password: string }): Promise<AuthSession>;
  login(input: { email: string; password: string }): Promise<AuthSession>;
  guest(): Promise<AuthSession>;
  logout(): Promise<{ ok: boolean }>;
  me(): Promise<AuthMe>;
}

// @ref LLP 1001.000#observable-client-surface — ephemeral snapshots carry no durable receipt or private lease.
export interface ChannelEntry<Value> {
  readonly key: string;
  readonly from: Principal;
  readonly value: Value;
  readonly expiresAt: number;
}
export interface ChannelSnapshot<Value> {
  readonly entries: readonly ChannelEntry<Value>[];
  readonly key?: string;
  readonly status: "loading" | "ready" | "unavailable";
  readonly reason?: "reconnecting" | "offline" | "refused" | "closed";
  readonly refusal?: Refusal;
}
export type ChannelWriteResult =
  | { ok: true }
  | ({ state: "refused" } & Refusal);
export interface ChannelHandle<Value> {
  getSnapshot(): ChannelSnapshot<Value>;
  subscribe(callback: (snapshot: ChannelSnapshot<Value>) => void): Subscription<ChannelSnapshot<Value>>;
  set(value: Value): Promise<ChannelWriteResult>;
  clear(): Promise<ChannelWriteResult>;
  /** Releases this handle's entry and connection, including when it has no listeners. */
  close(): void;
}

export type DrainContract = { cursor: string } | { reason: string };
export interface ManifestOperation { kind: string; args: unknown; planHash: string; cursor?: string | null; drain?: DrainContract }
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
export interface UnclaimedUpload {
  readonly id: string;
  readonly kind: AssetKind;
  readonly state: "receiving" | "ready";
  readonly bytes: number;
  readonly createdAt: number;
  /** Null until claimed then released; a ready release uses bytes but no pending slot. */
  readonly releasedAt: number | null;
  /** A receiving cancellation can still own a pending slot until its files close. */
  readonly reclaiming: boolean;
}
export interface UploadListing {
  readonly uploads: readonly UnclaimedUpload[];
  /** Creator totals across all pages: pending objects and charged original bytes (including releases). */
  readonly usage: { readonly objects: number; readonly bytes: number };
  readonly limits: { readonly objects: number; readonly bytes: number };
  readonly next: string | null;
}
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
  authEpoch?: number;
  /** Previously confirmed for this token; display only, never fresh authorization. */
  restoringViewer?: Principal;
  refusal?: Refusal;
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
  lastRefusal?: Refusal;
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
  /** Begin with transport cut; only online() may reconnect. */
  startOffline?: boolean;
  url: string;
  fetch?: typeof globalThis.fetch;
  offline?: OfflineClientOptions;
}

export interface OfflineClientOptions {
  store: RangeStoreFactory;
  fenceDays?: number;
  /** Ceiling on cached asset bytes per partition, LRU by each rendition's own last read; default 256 MiB. */
  maxAssetBytes?: number;
}

/** A client has exactly one authority source: a dev persona or bearer custody. */
export type CreateClientOptions = ClientLocationOptions & (
  | { persona: string; token?: never; tokenStore?: never }
  | { persona?: never; token?: string; tokenStore?: AuthTokenStore }
);

// @ref LLP 1012#7-writes-offline — the outbox is readable before the first
// request, so a queued message is on screen at cold start.
export type OutboxSettlement = { stopped: false | "fence" | "transport" | "authority" | "offline" | "pending" | "writer-unresponsive"; remaining: number };

export interface OutboxStatus {
  ready: boolean;
  /**
   * A follower tab reports `forwarding` (ready: its writes are admitted by the
   * tab that holds the partition), `writer-unresponsive` (still ready; the
   * writer has not admitted its oldest row for five seconds), `inbox-full`, or
   * `follower` (no route to the partition's inbox) (LLP 1018.004 §3).
   */
  reason: "ready" | "sealed" | "grant-missing" | "grant-expired" | "ids-exhausted" | "program-missing"
    | "follower" | "forwarding" | "inbox-full" | "writer-unresponsive";
  action: Action;
  /** Number of queued intents, including a follower's unadmitted rows; settled entries are excluded. */
  remaining: number;
  fence: "inside" | "past";
  /** The partition writer is actively replaying; a connected read cannot establish this. */
  draining?: true;
  /**
   * The head of the queue is an intent the owner refused non-retryably as bad input or
   * schema (a removed enum case); every later intent waits behind it until it is
   * dismissed. `dismiss(intent)` returns its bytes for re-authoring (LLP 1020 A2).
   */
  blocked?: { intent: string; code: string };
  /** The account owner is actively acquiring capacity or reauthorizing replay. */
  recovering?: true;
}

/** What `outbox.dismiss` returns for a queued intent it admitted: the bytes to re-author. */
export interface DismissedIntent {
  intent: string;
  op: string;
  args: unknown;
  refusal: Refusal;
}

export interface OutboxApi {
  /** Every durable intent of the open partition, FIFO; empty without a store. */
  entries(): Promise<OutboxEntry[]>;
  /** Lazy client-owned snapshot; one read per revision and distinct operation. */
  observe<Args = unknown, Result = unknown>(op?: Op<Args, Result>): ObservedOutbox;
  /**
   * Drops one settled entry. A queued intent is dismissed only when its last replay drew a
   * non-retryable `input`/`schema` refusal (see `OutboxStatus.blocked`); then the
   * dismissal returns the intent's bytes and the FIFO behind it continues. Starting
   * another replay clears eligibility durably before sending; an unknown outcome
   * cannot be dismissed. A follower awaits the writer's durable dismissal result.
   */
  dismiss(intent: string): Promise<DismissedIntent | undefined>;
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

export interface OutboxSnapshot {
  readonly entries: OutboxEntry[];
  readonly status: OutboxStatus;
  /** On a follower: the writer's announced ledger status, beside this tab's own (LLP 1018.004 §3). */
  readonly writer?: OutboxStatus;
}
export interface ObservedOutbox {
  getSnapshot(): OutboxSnapshot;
  subscribe(notify: () => void): () => void;
}

export interface SnapbackClient {
  readonly auth: AuthApi;
  readonly outbox: OutboxApi;
  /** Settles only after explicit token restoration and any initial persistence. */
  readonly ready: Promise<void>;
  readonly snapshot: ClientSnapshot;
  query<Args, Result>(ref: Op<Args, Result>, args: NoInfer<Args>): Promise<QueryResult<Result>>;
  /** A lazy shared query snapshot. The first listener opens it; the last releases it. */
  observe<Args, Result, Row extends ItemRow, Draft, HistoryArgs, History>(
    ref: Op<Args, Result>, args: NoInfer<Args>,
    options: { live?: false; drain?: boolean; items: ItemsWithHistory<Args, Result, Row, Draft, HistoryArgs, History> },
  ): ObservedQuery<Result, HistorySnapshot<Result, Row, Draft, History>>;
  observe<Args, Result, Row extends ItemRow, Draft>(
    ref: Op<Args, Result>, args: NoInfer<Args>,
    options: { live?: false; drain?: boolean; items: Items<Args, Result, Row, Draft> },
  ): ObservedQuery<Result, ItemSnapshot<Result, Row, Draft>>;
  observe<Args, Result>(
    ref: Op<Args, Result>,
    args: NoInfer<Args>,
    options?: { live?: false; drain?: boolean; items?: undefined },
  ): ObservedQuery<Result>;
  mutation<Args, Result>(ref: Op<Args, Result>, args: NoInfer<AssetInput<Args>>): Promise<MutationResult<Result>>;
  /** Uploads one browser File or Expo URI-backed File and returns its closed asset record. */
  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "image" }): Promise<ImageAsset>;
  upload(source: AssetUploadSource, options: AssetUploadOptions & { readonly kind: "video" }): Promise<VideoAsset>;
  upload(source: AssetUploadSource, options?: AssetUploadOptions): Promise<AssetRecord>;
  /** Lists this account's unclaimed uploads, at most 100 per page, including after restart. */
  listUploads(options?: { after?: string }): Promise<UploadListing>;
  /** Discards own unclaimed bytes; running finalizers retain quota until closed. Missing/foreign ids return false. */
  discardUpload(id: string): Promise<boolean>;
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
  channel<Args, Value>(ref: ChannelRef<Args, Value>, args: NoInfer<Args>): ChannelHandle<Value>;
  manifest(): Promise<Manifest>;
  subscribeStatus(callback: (snapshot: ClientSnapshot) => void): () => void;
  /** Cut only this client's transport; the owner remains running. */
  offline(): Promise<void>;
  /** Restore transport and perform resume before new subscription opens. */
  /** Re-authorizes held data and replays writes; rejects unsupported saved logs without dropping them. */
  online(): Promise<void>;
  /** Close and reopen this logical device on the same durable partition. */
  restart(): Promise<SnapbackClient>;
  /** Resolves when the offline carrier is quiet; safe to remove the store after. */
  close(): Promise<void>;
}

type ViewFacts = {
  live: boolean;
  /** Whose certified evaluation produced this answer: the owner's receipt, or the twin over held rows (LLP 1018.003 §1). */
  source?: ReceiptSource;
  stale?: { since: number };
  retained?: boolean;
  caughtUp?: boolean;
  watermark?: Cursor | null;
  predicted?: PredictedRow[];
  /** A local partial's uncovered sites, as the twin published them (LLP 1012 §6). */
  site?: string;
  sites?: Array<{ site: string; reason: "never-held" | "evicted" | "computed-key" }>;
};
/** A stale view keeps the last receipt's verdict and facts beside `since` (LLP 1018.003 §2, transition invariants). */
export type StaleView<Result> = {
  state: "stale";
  live: false;
  since: number;
  data?: Result;
  seq?: number;
  next?: Cursor | null;
  verdict?: "complete" | "capped" | "partial" | "denied";
  reason?: string;
  rule?: string;
} & Omit<ViewFacts, "live" | "stale">;
export type QueryView<Result> =
  | (QueryHeld<Result> & ViewFacts)
  | (QueryComplete<Result> & ViewFacts)
  | (QueryCapped<Result> & ViewFacts)
  | (QueryPartial<Result> & ViewFacts & RetainedContinuation)
  | (QueryDenied & ViewFacts)
  | { state: "refused"; live: false; refusal: Refusal }
  | StaleView<Result>
  /** `offline`: the twin had nothing held for this query (LLP 1012 §6), as opposed to the first render. */
  | { state: "hydrating"; live: false; offline?: true };
export type QueryMachineEvent<Result> = QueryResult<Result> | SubscriptionDelivery<Result>;
export interface ObservedQuery<Result, Value extends Snapshot<Result> = Snapshot<Result>> {
  /** Referentially stable and recursively frozen until the shared query publishes a different view. */
  getSnapshot(): Value;
  /** Observes snapshot identity changes; read the value with `getSnapshot()`. */
  subscribe(notify: () => void): () => void;
}

export function initialQueryState<Result>(): QueryView<Result> {
  return { state: "hydrating", live: false };
}

export { canonical as stableSerialize };

const LOCAL_FACT_KEYS = ["retained", "caughtUp", "watermark", "predicted", "site", "sites"] as const;
const VIEW_FACT_KEYS = ["stale", ...LOCAL_FACT_KEYS] as const;
const RECEIPT_FACT_KEYS = ["source", "next", "reason", "rule", ...LOCAL_FACT_KEYS] as const;
const REFUSAL_FACT_KEYS = ["site", "rule", "rewrite", "reason", "retryable"] as const;

/** Copy only present facts; an omitted fact stays omitted across every projection. */
function defined(source: Record<string, any>, keys: readonly string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of keys) if (source[key] !== undefined) result[key] = source[key];
  return result;
}

// @ref LLP 1002#9-the-client-snapback2client-snapback2react-snapback2test — React preserves data identity while exposing every receipt-backed state.
// @ref LLP 1018.003#2-derive-never-add — the transition invariants: a stale
// event keeps the last receipt and never scrubs delivered data; denial,
// refusal, and reset scrub; the provenance axis records who evaluated.
export function reduceQueryState<Result>(
  current: QueryView<Result>,
  event: QueryMachineEvent<Result>,
): QueryView<Result> {
  const eventData = "data" in event ? event.data : undefined;
  const currentData = "data" in current ? current.data : undefined;
  const data = canonical(eventData) === canonical(currentData) ? currentData : eventData;
  const live = "live" in event ? event.live : false;
  const offline = "connection" in event && event.connection === "offline";
  const source: ReceiptSource = "source" in event && event.source !== undefined ? event.source : offline ? "twin" : "server";
  const facts = defined(event, VIEW_FACT_KEYS);
  let next: QueryView<Result>;
  switch (event.state) {
    case "complete":
    case "held":
    case "capped":
      next = { state: event.state, live, source, data: data as Result, seq: event.seq, next: event.next, ...facts };
      break;
    case "partial":
      next = { state: "partial", live, source, ...(data === undefined ? {} : { data: data as Result }),
        seq: event.seq, reason: event.reason, ...facts,
        ...("retained" in event && event.retained === true && "next" in event ? { next: event.next } : {}) };
      break;
    case "denied":
      next = { state: "denied", live, source, rule: event.rule, seq: event.seq, ...facts };
      break;
    case "hydrating":
      next = offline ? { state: "hydrating", live: false, offline: true } : { state: "hydrating", live: false };
      break;
    case "refused": {
      const refusal: Refusal = {
        code: event.code, family: event.family, message: event.message, guide: event.guide,
        ...defined(event, REFUSAL_FACT_KEYS),
      };
      next = { state: "refused", live: false, refusal };
      break;
    }
    case "stale": {
      // The last receipt survives only when the stale event names no other
      // sequence: a different seq means the event's data is held data the
      // receipt does not describe. A kept denial keeps no data.
      const previous = current;
      const receipted = current.state === "complete" || current.state === "capped" || current.state === "partial" || current.state === "denied"
        ? current : undefined;
      const verdict = receipted !== undefined ? receipted.state : current.state === "stale" ? current.verdict : undefined;
      const receiptSeq = "seq" in current ? current.seq : undefined;
      const keep = verdict !== undefined && (event.seq === undefined || event.seq === receiptSeq);
      const staleData = keep && verdict === "denied" ? undefined : data !== undefined ? data : currentData;
      const seq = keep ? receiptSeq : event.seq !== undefined ? event.seq : receiptSeq;
      const stale: StaleView<Result> = { state: "stale", live: false, since: event.since };
      if (staleData !== undefined) stale.data = staleData;
      if (seq !== undefined) stale.seq = seq;
      if (keep) {
        stale.verdict = verdict;
        Object.assign(stale, defined(previous, RECEIPT_FACT_KEYS));
      }
      next = stale;
      break;
    }
  }
  return canonical(current) === canonical(next) ? current : next;
}

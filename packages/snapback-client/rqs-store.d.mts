// Type declarations for rqs-store.mjs — Channel B persisted RQS resume store
// (web/IndexedDB arm) plus the shared verification, arbitration, and budget
// helpers consumed store-agnostically by index.mjs and rqs-store-file.mjs.

import type { RqsRow } from './rqs.mjs';

export const RQS_STORE_DATABASE_NAME: string;
export const RQS_STORE_MAX_BYTES: number;
export const RQS_STORE_MAX_ENTRIES: number;
export const RQS_TOKEN_MAX_BYTES: number;
export const RQS_REACT_BINDING_RECEIPT_MAX_BYTES: number;
export const DATABASE_VERSION: 3;

export interface RqsStoreMetaV3 {
  readonly formatVersion: 3;
  readonly clientStoreId: string;
  readonly queryInstanceIdHighWater: number;
  readonly generationCounters: Readonly<{
    writerGeneration: number;
    authorityGenerationHighWater: number;
    queryGenerationHighWater: number;
  }>;
  /** Hex encoding of the 32-byte store-local LLP 0157 handle key. */
  readonly handleKey: string;
  readonly durableRegistrations: Readonly<Record<string, unknown>>;
  readonly policyBudgetFacts: Readonly<Record<string, unknown>>;
  readonly brokerRoster: Readonly<Record<string, unknown>>;
  readonly fenceHighWaters: Readonly<Record<string, unknown>>;
  readonly tombstoneHighWaters: Readonly<Record<string, unknown>>;
  readonly barrierHighWaters: Readonly<Record<string, unknown>>;
}

export type RqsStoreIdentityResetResult =
  | Readonly<{
    reset: true;
    previousClientStoreId: string | null;
    clientStoreId: string;
  }>
  | Readonly<{ reset: false; reason: 'not_writer' | 'not_corrupt' }>;

/** Returns a detached, JSON-serializable receipt within the store limit, or
 * null when the input is not an acceptable receipt record. */
export function prepareReactBindingReceipt(
  receipt: unknown,
): Record<string, unknown> | null;

/** Canonical authority-independent persisted-entry key for one subscription
 * (query name + JCS args); null when the args cannot canonicalize. */
export function rqsEntryKey(name: string, args?: unknown): string | null;

/** The verified identity/meta half of a persisted resume entry. */
export interface RqsPersistedResumeMeta {
  readonly app: string;
  readonly generation: string;
  readonly versionStream: string;
  readonly queryArtifact: string;
  readonly argsHash: string;
  readonly contentDigest: string;
  readonly version: number;
}

/** One persisted store record as written by `commit`. Records read back via
 * `load` are untrusted until `verifyPersistedResumeEntry` accepts them. */
export interface RqsPersistedResumeRecord {
  readonly rows: readonly RqsRow[];
  readonly meta: RqsPersistedResumeMeta;
  readonly token: string;
  readonly bytes: number;
  readonly savedAt: number;
  readonly resumedAt: number;
  readonly inProgress: boolean;
}

export type RqsResumeEntryRefusalReason =
  | 'shape'
  | 'in_progress'
  | 'token'
  | 'meta'
  | 'rows'
  | 'identity'
  | 'digest';

/** Fail-closed verification of a persisted (or preloaded) resume entry.
 * Any refusal means "discard and subscribe fresh" (LLP 0091 §0B.3 T2). */
export function verifyPersistedResumeEntry(
  entry: unknown,
  options?: { readonly args?: unknown },
):
  | { ok: true; reason: null }
  | { ok: false; reason: RqsResumeEntryRefusalReason };

/** A digest-verified resume candidate for Channel A vs Channel B
 * arbitration: anything carrying `resume.meta` token identity. */
export interface RqsResumeCandidate {
  readonly resume?: Readonly<{
    meta?: Readonly<{
      app: string;
      generation: string;
      versionStream: string;
      queryArtifact: string;
      argsHash: string;
      version: number;
    }> | null;
  }> | null;
}

/** Channel A vs Channel B arbitration (LLP 0090 D3): the higher `version`
 * within matching token identity wins; any identity mismatch returns null
 * (discard BOTH and subscribe fresh). */
export function arbitrateResumeCandidates<
  A extends RqsResumeCandidate,
  B extends RqsResumeCandidate,
>(a: A | null | undefined, b: B | null | undefined): A | B | null;

/** Budget accounting for one persisted entry: serialized
 * `{rows, meta, token}` bytes (LLP 0091 §0A.5). */
export function rqsEntryRecordBytes(
  persisted: Readonly<{ rows: unknown; meta: unknown; token: unknown }>,
): number;

/** Least-recently-resumed eviction comparator: never-resumed entries first,
 * `savedAt` as the tiebreak. */
export function rqsEvictionOrder(
  a: Readonly<{ resumedAt?: number | null; savedAt?: number | null }>,
  b: Readonly<{ resumedAt?: number | null; savedAt?: number | null }>,
): number;

export type RqsStoreCommitResult =
  | Readonly<{ persisted: true; reason: null; bytes: number; evicted: readonly string[] }>
  | Readonly<{ persisted: false; reason: 'not_writer' | 'key' | 'oversize' | 'corrupt' }>;

export interface RqsStoreInspection {
  readonly writer: boolean;
  readonly entries: number;
  readonly bytes: number;
  readonly maxBytes: number;
  readonly maxEntries: number;
  /** Present on the file arm only. */
  readonly corrupt?: boolean;
}

export interface RqsMaterializationTransactionView {
  readonly materializations: Map<string, unknown>;
  readonly pageSets: Map<string, unknown>;
  readonly memberships: Map<string, unknown>;
  /** Legacy Channel-B records share this exact transaction domain so class
   * adoption can switch from the verified legacy key to QMK atomically. */
  readonly entries: Map<string, unknown>;
  outbox: unknown;
  storeMeta: RqsStoreMetaV3;
}

/** The store contract shared by the web/IndexedDB and native/file arms. */
export interface RqsResumeStore {
  isWriter(): boolean;
  whenLockSettled(): Promise<void>;
  /** Optional role-transition notification. File carriers without a native
   * watch primitive are polled only while pending work awaits writer custody. */
  subscribeWriterLock?(listener: (writer: boolean) => void): () => void;
  outboxEmpty(): Promise<boolean>;
  outboxAuthorizationStatus(): Promise<Readonly<{
    authorityGeneration: number;
    generation: number;
    suspended: boolean;
    pendingScopeCount: number;
    effectiveDisposition: 'retain' | 'quarantine' | 'delete';
  }>>;
  outboxApplyAuthorizationObligation(
    obligation: Readonly<Record<string, unknown>>,
    expectedAuthorityGeneration: number,
  ): Promise<Readonly<Record<string, unknown>>>;
  outboxResolveAuthorizationObligation(
    resolution: Readonly<Record<string, unknown>>,
    expectedAuthorityGeneration: number,
  ): Promise<Readonly<Record<string, unknown>>>;
  outboxAcknowledgeAuthorizationResolution(
    resolution: Readonly<Record<string, unknown>>,
    expectedAuthorityGeneration: number,
  ): Promise<boolean>;
  outboxRetireAuthorizationScopes(
    scopes: readonly Readonly<Record<string, unknown>>[],
    expectedAuthorityGeneration: number,
  ): Promise<Readonly<Record<string, unknown>>>;
  outboxEnqueue(
    record: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>> & { readonly insertionOwned: boolean }>;
  outboxRecords(): Promise<readonly Readonly<Record<string, unknown>>[]>;
  outboxMarkStranded(
    id: string,
    reason: string,
    predecessorPrincipalScope?: Readonly<Record<string, unknown>> | null,
    expectedAuthorizationFence?: Readonly<Record<string, unknown>> | null,
    effectProvenance?: Readonly<{
      effectCommitted: boolean | null;
      effectMayHaveCommitted: boolean | null;
    }> | null,
  ): Promise<false | Readonly<Record<string, unknown>>>;
  outboxDiscardPendingInsertion?(
    id: string,
    insertionSequence: number,
    expectedAuthorizationFence?: Readonly<Record<string, unknown>> | null,
  ): Promise<boolean>;
  outboxReconcileCustody(
    principalScope: Readonly<Record<string, unknown>>,
    authorityDescriptor: Readonly<Record<string, unknown>>,
    custody: Readonly<{ authorityEpoch: number; authorityKey: string }>,
    expectedAuthorityGeneration: number,
  ): Promise<false | Readonly<{
    deleted: number;
    deletedIds: readonly string[];
    stranded: number;
    strandedIds: readonly string[];
  }>>;
  outboxDiscardStranded(
    ids: readonly string[],
    principalScope: Readonly<Record<string, unknown>>,
  ): Promise<false | Readonly<{
    discarded: number;
    clientMutationIds: readonly string[];
  }>>;
  outboxMarkQuarantined?(
    id: string,
    refusal: Readonly<{ code: string }>,
  ): Promise<false | Readonly<{
    count: number;
    tombstones: readonly Readonly<Record<string, unknown>>[];
  }>>;
  outboxReenterQuarantined?(): Promise<false | Readonly<{
    count: number;
    clientMutationIds: readonly string[];
  }>>;
  outboxEnqueueWithOperationIdentity?(
    record: Readonly<Record<string, unknown>>,
    authorityCohortKey: string,
    range?: Readonly<Record<string, unknown>> | null,
  ): Promise<Readonly<Record<string, unknown>> & { readonly insertionOwned: boolean }>;
  outboxAssignOperationIdentity?(
    id: string,
    authorityCohortKey: string,
    range?: Readonly<Record<string, unknown>> | null,
  ): Promise<Readonly<Record<string, unknown>> | false | null>;
  outboxOperationIdentityRange?(
    authorityCohortKey: string,
  ): Promise<Readonly<Record<string, unknown>> | null>;
  /** Optional metadata slot used to prepare React bindings while offline. */
  loadReactBindingReceipt?(): Promise<Readonly<Record<string, unknown>> | null>;
  /** Writer-gated replacement; IndexedDB may defer until writer election. */
  commitReactBindingReceipt?(
    receipt: Readonly<Record<string, unknown>>,
  ): Promise<boolean | 'deferred'>;
  readStoreMeta(): Promise<RqsStoreMetaV3>;
  writeStoreMeta(meta: RqsStoreMetaV3): Promise<boolean>;
  allocateQueryInstanceId(): Promise<number | null>;
  /** Internal v3 section seam. The callback must be synchronous. */
  materializationTransaction<T>(
    mode: 'readonly' | 'readwrite',
    operation: (view: RqsMaterializationTransactionView) => T,
  ): Promise<T>;
  /** Raw persisted record — callers MUST verify with
   * `verifyPersistedResumeEntry` before trusting it. */
  load(key: string): Promise<RqsPersistedResumeRecord | null>;
  commit(
    key: string,
    entry: Readonly<{ rows: readonly RqsRow[]; meta: RqsPersistedResumeMeta; token: string }>,
  ): Promise<RqsStoreCommitResult>;
  markInProgress(key: string): Promise<boolean>;
  markResumed(key: string, at?: number): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  wipe(): Promise<boolean>;
  /** Clear resident/read projections for a session authority transition while
   * preserving the outbox for per-record descriptor reconciliation. */
  wipeForAuthorityTransition(): Promise<boolean>;
  resetCorruptStoreIdentity(): Promise<RqsStoreIdentityResetResult>;
  inspection(): Promise<RqsStoreInspection>;
  close(): Promise<void>;
}

/** IndexedDB-backed persisted RQS resume store under single-writer Web-Lock
 * ownership. `indexedDB` and `lockManager` are host handles (an `IDBFactory`
 * and a `LockManager`), typed structurally so this declaration does not
 * require the DOM lib; both are validated at runtime. */
export function createIndexedDbRqsResumeStore(options?: {
  readonly indexedDB?: unknown;
  readonly lockManager?: unknown;
  readonly databaseName?: string;
  readonly now?: () => number;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly clientStoreId?: string | null;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly broadcastChannelFactory?: ((name: string) => Readonly<{
    postMessage(message: unknown): void;
    close(): void;
    onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
  }>) | null;
  readonly outboxNormalizationTimeoutMs?: number;
  readonly onBeforeStoreIdentityRotation?: ((transition: Readonly<{
    carrier: 'indexeddb';
    databaseName: string;
    previousClientStoreId: string | null;
    nextClientStoreId: string;
  }>) => void | Promise<void>) | null;
  readonly relaunchOutboxEmpty?: (() => boolean | Promise<boolean>) | null;
}): RqsResumeStore;

/** Request a destructive legacy-outbox normalization from the exact
 * long-held IndexedDB Web-Lock owner. A committed outcome is only an ACK;
 * the caller must reread durable bytes before exposing payload state. */
export function requestIndexedDbOutboxNormalization(options?: {
  readonly databaseName?: string;
  readonly broadcastChannelFactory?: ((name: string) => Readonly<{
    postMessage(message: unknown): void;
    close(): void;
    onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
  }>) | null;
  readonly timeoutMs?: number;
}): Promise<
  | Readonly<{ status: 'committed' }>
  | Readonly<{
    status: 'unavailable';
    reason: 'channel-unavailable' | 'channel-failed' | 'timeout' | 'writer-refused';
  }>
>;

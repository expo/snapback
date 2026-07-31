import type { SnapbackAuthDisposition } from './auth-invalidation.mjs';
import type { SnapbackAuthBarrierContext } from './auth-coordinator.mjs';

export const SNAPBACK_CLIENT_STORE_VERSION: 6;
export const MAX_OFFLINE_LEDGER_IDS: number;

/** Canonical (sorted-key) JSON serialization. */
export const stableJson: (value: unknown) => string;

/** `${name}:${stableJson(args)}` retained-query key. */
export const retainedQueryKey: (name: string, args?: Record<string, unknown>) => string;

export interface SnapbackAuthInput {
  principal?: string | null;
  session_id?: string | null;
  sessionId?: string | null;
  user_id?: string | null;
  userId?: string | null;
}

/** SHA-256 over the length-delimited AuthInput tuple (`sha256:<hex>`). */
export const snapbackAuthFingerprint: (
  authOrUserId?: string | SnapbackAuthInput | null,
) => string;

/** Pre-v2 FNV-1a alias (`fnv1a:<hex>`), retained for compatibility tests. */
export const legacySnapbackAuthFingerprint: (
  authOrUserId?: string | SnapbackAuthInput | null,
) => string;

export interface SnapbackClientStoreQueryFence {
  readonly queryInstanceId: number;
  readonly authorityGeneration: number;
  readonly queryGeneration: number;
  readonly authorityInstanceId: string | null;
}

export interface SnapbackClientStorePrincipalScope {
  authMode: 'dev' | 'sessions';
  authorizationStreamIncarnation: string;
  userId: string | null;
}

export interface SnapbackClientStoreAuthorityDescriptor {
  descriptorVersion: 1;
  authorityInstanceId: string;
  sessionGeneration: number;
}

/**
 * Expected-scope CAS tuple accepted by most store operations. Authority
 * (`authorityEpoch`/`authorityKey`), queue (`authorityGeneration`/
 * `queueGeneration`), auth-fingerprint, and artifact axes are all optional;
 * an operation checks only the axes it fences.
 */
export interface SnapbackClientStoreExpectation {
  authorityEpoch?: number | null;
  authorityKey?: string | null;
  authorityGeneration?: number;
  queueGeneration?: number;
  authFingerprint?: string | null;
  schemaHash?: string | null;
  inputsHash?: string | null;
  targetProfileId?: string | null;
  appId?: string | null;
  databaseId?: string | null;
  versionStreamId?: string | null;
}

export interface SnapbackClientStoreQueueCapture {
  authorityGeneration: number;
  queueGeneration: number;
}

export interface SnapbackClientStoreQueueStatus extends SnapbackClientStoreQueueCapture {
  suspended: boolean;
  pendingScopeCount: number;
  effectiveDisposition?: SnapbackAuthDisposition;
}

export interface SnapbackClientStoreArtifactScope {
  schemaHash?: string | null;
  inputsHash?: string | null;
  targetProfileId?: string | null;
  appId?: string | null;
  databaseId?: string | null;
  versionStreamId?: string | null;
}

/**
 * Store-agnostic retained-query + offline-mutation contract (format 6).
 * Retained/queued records are open JSON shapes; they are typed as
 * `Record<string, unknown>` maps carrying the documented scope tags.
 */
export interface SnapbackClientStore {
  readonly version: number;

  bindAuthority(binding: {
    authorityEpoch: number;
    authorityKey: string;
    authMode?: 'dev' | 'sessions';
  }): Promise<{ authorityEpoch: number; authorityKey: string }>;

  transitionAuthority(options: {
    expectedEpoch: number | null;
    nextEpoch: number;
    nextAuthorityKey: string;
    expectedStoreGeneration?: number | null;
    disposition?: 'delete';
    queueTransition?: 'delete' | 'strand-redacted' | 'strand-rerecordable';
    transitionReason?: string;
    retainPrincipalData?: boolean;
    nextPrincipalScope?: SnapbackClientStorePrincipalScope | null;
    terminal?: boolean;
  }): Promise<{ authorityEpoch: number; authorityKey: string }>;

  purgeAuthority(options: { authorityKey: string }): Promise<{ purged: boolean; fenced: boolean }>;

  authorityScope(): Promise<{
    authorityEpoch: number | null;
    authorityKey: string | null;
  }>;

  authorityBindingCapture(): Promise<{
    storeGeneration: number;
    authorityEpoch: number | null;
    authorityKey: string | null;
    terminallyUnbound: boolean;
  }>;

  captureMutationQueue(
    expected?: SnapbackClientStoreExpectation,
  ): Promise<SnapbackClientStoreQueueStatus>;

  assertMutationQueueCapture(
    capture: SnapbackClientStoreQueueCapture,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<SnapbackClientStoreQueueCapture>;

  applyMutationQueueObligation(
    obligationValue: unknown,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<
    SnapbackClientStoreQueueStatus & {
      status: 'accepted' | 'duplicate' | 'stale-expectation';
    }
  >;

  scopeAuthorization(
    handshake: {
      principalScope: SnapbackClientStorePrincipalScope;
      authorityDescriptor: SnapbackClientStoreAuthorityDescriptor;
      queryAuthorization?: Record<string, never>;
    },
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{
    principalScope: SnapbackClientStorePrincipalScope;
    authorityDescriptor: SnapbackClientStoreAuthorityDescriptor;
    queryAuthorization: Record<string, unknown>;
  }>;

  resolveMutationQueueObligation(
    resolutionValue: unknown,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<SnapbackClientStoreQueueStatus & { ackToken: string }>;

  retireMutationQueueScopes(
    scopeValues: readonly unknown[],
    expected?: SnapbackClientStoreExpectation,
  ): Promise<SnapbackClientStoreQueueStatus & { retired: number }>;

  authorizationScope(expected?: SnapbackClientStoreExpectation): Promise<{
    principalScope: SnapbackClientStorePrincipalScope | null;
    authorityDescriptor: SnapbackClientStoreAuthorityDescriptor | null;
    queryAuthorization: Record<string, unknown>;
  }>;

  strandedMutations(
    expected?: SnapbackClientStoreExpectation,
  ): Promise<Record<string, unknown>[]>;

  discardStranded(expected?: SnapbackClientStoreExpectation): Promise<void>;

  scopeToAuth(
    authFingerprint: string | null,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<void>;

  scopeToArtifacts(
    scope?: SnapbackClientStoreArtifactScope,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<void>;

  initializeAuthorizedRetainedQuery(
    key: string,
    init: {
      authorization: unknown;
      issuerId: unknown;
      versionStream: string;
      principalId: string;
      activationHash: string;
      appId: string;
      targetProfileId: string;
    },
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{
    namespace: { clientStoreId: string; queryKey: string; queryInstanceId: number };
    fence: SnapbackClientStoreQueryFence;
  }>;

  captureAuthorizedRetainedQuery(
    key: string,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{
    namespace: { clientStoreId: string; queryKey: string; queryInstanceId: number };
    fence: SnapbackClientStoreQueryFence;
    disposition: SnapbackAuthDisposition;
  }>;

  receiveRetainedQueryObligation(
    key: string,
    obligationValue: unknown,
    fence: SnapbackClientStoreQueryFence,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{
    status: 'accepted' | 'duplicate' | 'stale-expectation';
    disposition?: SnapbackAuthDisposition;
    fence: SnapbackClientStoreQueryFence;
  }>;

  beginAuthorizedLeaseRequest(
    key: string,
    request: {
      fence: SnapbackClientStoreQueryFence;
      leaseRequestId: string;
      clientNowMs: number;
    },
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{
    request: {
      leaseRequestId: string;
      queryInstanceId: number;
      queryGeneration: number;
      startedClientMs: number;
    };
    fence: SnapbackClientStoreQueryFence;
  }>;

  commitAuthorizedRetainedSnapshot(
    key: string,
    commit: {
      fence: SnapbackClientStoreQueryFence;
      lease: unknown;
      record: Record<string, unknown>;
      clientNowMs: number;
    },
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{ fence: SnapbackClientStoreQueryFence; record: Record<string, unknown> }>;

  putAuthorizedRetainedQuery(
    key: string,
    update: {
      fence: SnapbackClientStoreQueryFence;
      record: Record<string, unknown>;
      clientNowMs: number;
    },
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{ fence: SnapbackClientStoreQueryFence; record: Record<string, unknown> }>;

  applyRetainedQueryResolution(
    key: string,
    resolution: {
      fence: SnapbackClientStoreQueryFence;
      resolution: unknown;
      record?: Record<string, unknown> | null;
    },
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{
    ackToken: string;
    disposition: SnapbackAuthDisposition;
    fence: SnapbackClientStoreQueryFence;
  }>;

  retireRetainedQueryScopes(
    key: string,
    retirement: {
      fence: SnapbackClientStoreQueryFence;
      retired: readonly { scopeId: unknown; revision?: number | null }[];
      record: Record<string, unknown>;
    },
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{
    disposition: SnapbackAuthDisposition;
    fence: SnapbackClientStoreQueryFence;
  }>;

  getAuthorizedRetainedQuery(
    key: string,
    read: { fence?: SnapbackClientStoreQueryFence | null; clientNowMs: number },
    expected?: SnapbackClientStoreExpectation,
  ): Promise<Record<string, unknown> | null>;

  beginAuthorizedQueryRetirement(
    key: string,
    fence: SnapbackClientStoreQueryFence,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<{ queryInstanceId: number; fence: SnapbackClientStoreQueryFence }>;

  finishAuthorizedQueryRetirement(
    key: string,
    queryInstanceId: number,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<boolean>;

  getRetainedQuery(
    key: string,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<Record<string, unknown> | null>;

  putRetainedQuery(
    key: string,
    record: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  enqueueMutation(record: Record<string, unknown>): Promise<Record<string, unknown>>;

  pendingMutations(
    options?: SnapbackClientStoreExpectation,
  ): Promise<Record<string, unknown>[]>;

  settleMutation(
    id: string,
    options?: SnapbackClientStoreExpectation & {
      status?: 'confirmed' | 'failed';
      output?: unknown;
      diagnostic?: unknown;
    },
  ): Promise<Record<string, unknown> | null>;

  pendingMutationAcknowledgements(
    limit?: number,
    authFingerprint?: string | null,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<string[]>;

  confirmMutationAcknowledgements(
    ids: Iterable<string>,
    authFingerprint?: string | null,
    expected?: SnapbackClientStoreExpectation,
  ): Promise<void>;

  failedMutations(
    expected?: SnapbackClientStoreExpectation,
  ): Promise<Record<string, unknown>[]>;

  snapshot(): Promise<Record<string, unknown>>;

  /** Explicit reset; the sole operation allowed to replace unparseable bytes. */
  clear(): Promise<Record<string, unknown>>;
}

/**
 * Deterministic reference for tests. Pass the same `state` object to a new
 * store to model an app reload without sharing a live adapter instance.
 */
export function createMemorySnapbackClientStore(options?: {
  state?: Record<string, unknown>;
}): SnapbackClientStore;

export interface SnapbackWebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SnapbackWebLocksLike {
  request<T>(
    name: string,
    options: Readonly<{ mode: 'exclusive' }>,
    operation: () => T | Promise<T>,
  ): Promise<T>;
}

/** Web implementation; callers may inject Storage/Web-Locks-compatible test doubles. */
export function createLocalStorageSnapbackClientStore(options?: {
  storage?: SnapbackWebStorageLike;
  key?: string;
  lockManager?: SnapbackWebLocksLike;
}): SnapbackClientStore;

/** Register one physical client store as the coordinator's durable participant. */
export function createSnapbackClientStoreAuthParticipant(
  store: Pick<SnapbackClientStore, 'transitionAuthority' | 'purgeAuthority'>,
  options?: { name?: string },
): Readonly<{
  name: string;
  quiesce(): void;
  blank(): void;
  clearMemory(): void;
  commitDurable(context: SnapbackAuthBarrierContext): Promise<void>;
  commitTerminalDurable(context: SnapbackAuthBarrierContext): Promise<void>;
  resume(): Promise<void>;
}>;

export function createClientMutationId(prefix?: string): string;

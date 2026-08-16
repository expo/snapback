// Snapback <-> Contract adapter (package root).

export const SNAPBACK_CONTRACT_ADAPTER_VERSION: 1;
export const SNAPBACK_CONTRACT_CAPABILITY_CLASS: 'Online';
export const SNAPBACK_CONTRACT_PARITY_CAPABILITY_CLASS: 'Parity';

export {
  compileResultContractValidator,
  RESULT_CONTRACT_LIMITS_V1,
} from './result-contract-validator.mjs';
export type {
  CompiledResultContractValidator,
  ResultContractDescriptorV1,
  ResultContractValidationOutcome,
  ResultValueContractV1,
} from './result-contract-validator.mjs';

export {
  createSnapbackProviderDiagnostic,
  createSnapbackProviderDiagnosticCollector,
  createSnapbackProviderDiagnosticError,
} from './diagnostics.mjs';
export type {
  SnapbackProviderDiagnostic,
  SnapbackProviderDiagnosticCollector,
  SnapbackProviderDiagnosticError,
  SnapbackProviderDiagnosticOptions,
  SnapbackProviderDiagnosticReport,
} from './diagnostics.mjs';

export {
  AUTH_DEFAULT_STORAGE_PARTITION,
  AuthCoordinator,
  authAppIdHash,
  authCustodyOwnerKeyHash,
  canonicalAgentAuthorityKey,
  canonicalAuthorityKey,
  createMemoryAuthCustodyStorage,
  deriveServiceAuthorityInstanceId,
  normalizeClientAuthority,
  normalizeAuthCustodyOwnerKey,
  SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION,
  SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION,
  validateAuthCustody,
  validateAuthCustodySenderKeys,
} from './auth-coordinator.mjs';
export type {
  SnapbackAuthBarrierContext,
  SnapbackAuthBarrierParticipant,
  SnapbackAuthCustodyOwnerKey,
  SnapbackAuthCustodyRecord,
  SnapbackAuthCustodyStorage,
  SnapbackAuthorityCapture,
  SnapbackAuthorityCredentialView,
  SnapbackClientAuthority,
} from './auth-coordinator.mjs';

export { createIndexedDbAuthCustodyStorage } from './auth-custody-indexeddb.mjs';

export {
  AUTH_INVALIDATION_REFIRE_MAX_MS,
  effectiveDisposition,
  mergeResyncObligation,
  nextInvalidationGeneration,
  nextQueryInstanceId,
  resolutionSatisfies,
  scopeKey,
  SNAPBACK_AUTH_INVALIDATION_PROTOCOL_VERSION,
  validateAuthorizationVersion,
  validateAuthenticatedBootIssuer,
  validateAuthorizationInvalidationConnection,
  validateCompositeWitness,
  validateDataWitness,
  validateIssuerId,
  validateIssuerRetirement,
  validateQueryNamespace,
  validateResolutionTicket,
  validateResyncObligation,
  validateScopeId,
  validateScopeRetirement,
} from './auth-invalidation.mjs';
export type {
  SnapbackAuthDisposition,
  SnapbackAuthorizationVersion,
  SnapbackCompositeWitness,
  SnapbackIssuerId,
  SnapbackQueryNamespace,
  SnapbackResolutionTicket,
  SnapbackResyncObligation,
  SnapbackScopeId,
} from './auth-invalidation.mjs';

export {
  createLiveQueryAuthorizationFence,
  createLiveQueryInstanceAllocator,
  createLiveQueryNamespace,
} from './query-authorization.mjs';
export type {
  SnapbackLiveQueryAuthorizationFence,
  SnapbackQueryAuthorizationFenceCapture,
} from './query-authorization.mjs';

export {
  authorizedLeaseActivationHash,
  authorizedLeaseHash,
  deriveAuthorizedLeaseCommit,
  SNAPBACK_AUTHORIZED_LEASE_DEFAULT_MS,
  SNAPBACK_AUTHORIZED_LEASE_HARD_MAX_MS,
  SNAPBACK_AUTHORIZED_LEASE_PROTOCOL_VERSION,
  validateAuthorizedLease,
  validateAuthorizedLeaseCapability,
} from './authorized-lease.mjs';
export type { SnapbackAuthorizedLease } from './authorized-lease.mjs';

export {
  CONTRACT_RECEIPT_CAPABILITY,
  contractReceiptCapability,
  SNAPBACK_CONTRACT_RECEIPT_CAPABILITY,
} from './capabilities.mjs';

export {
  SUPPORTED_CONTRACT_DATA_MANIFEST_VERSIONS,
  validateSnapbackContractArtifacts,
} from './artifact-validation.mjs';
export type {
  SnapbackArtifactIndex,
  SnapbackContractDataManifest,
  SnapbackContractQueryDescriptor,
} from './artifact-validation.mjs';

export {
  createDeferredContractLinks,
  createRenderFirstSnapbackContractSurface,
} from './render-first.mjs';
export type {
  CreateRenderFirstSnapbackContractSurfaceOptions,
  DeferredContractLinks,
  RenderFirstSnapbackContractSurface,
} from './render-first.mjs';

export { createKeyedSnapbackContractProvider } from './keyed-provider.mjs';
export type {
  ContractConnectionState,
  ContractQueryCell,
  KeyedSnapbackContractProvider,
} from './keyed-provider.mjs';

export {
  createClientMutationId,
  createLocalStorageSnapbackClientStore,
  createMemorySnapbackClientStore,
  createSnapbackClientStoreAuthParticipant,
  retainedQueryKey,
  snapbackAuthFingerprint,
  SNAPBACK_CLIENT_STORE_VERSION,
} from './client-store.mjs';
export type { SnapbackClientStore } from './client-store.mjs';

import type { SnapbackProviderDiagnostic } from './diagnostics.mjs';
import type { SnapbackContractDataManifest } from './artifact-validation.mjs';
import type { SnapbackClientStore } from './client-store.mjs';
import type { ContractConnectionState } from './keyed-provider.mjs';

// ---------------------------------------------------------------------------
// Derived optimistic overlays (re-exported at runtime from
// ./derived-overlay.mjs; declared inline here).
// ---------------------------------------------------------------------------

export type SnapbackOverlayClass = 'derived' | 'reducer' | 'none';

/** Overlay classes a mutation invocation can present. */
export const OVERLAY_CLASSES: readonly ['derived', 'reducer', 'none'];
export const DATA_TIER_PROFILE_VERSION: 1;
export const MAX_PLAN_STEPS: 64;
export const MAX_EXPR_DEPTH: 32;
export const MAX_INSERT_EACH_FANOUT: 1024;

export function canonicalizeJsonValue(value: unknown): unknown;
export function evalValueExpr(
  expression: unknown,
  environment: Readonly<{
    args?: unknown;
    authUserId?: string | null;
    bindings?: Map<string, unknown>;
    nowMs?: number;
    runtimeId?: (() => string) | null;
  }>,
  depth?: number,
): unknown;
export function truthy(value: unknown): boolean;
export function valuesEqual(left: unknown, right: unknown): boolean;

/** Serialized snapback `MutationPlan` embedded in a generated manifest. */
export interface SnapbackMutationPlan {
  readonly steps: readonly Readonly<Record<string, unknown>>[];
  readonly return_value?: unknown;
  readonly [key: string]: unknown;
}

export interface SnapbackOptimisticReducerContext {
  readonly userId?: string | null;
  readonly optimisticId: string;
  readonly baseVersion?: number | null;
  readonly nowMs?: number;
  readonly runtimeId?: ((count: number) => string) | null;
}

/**
 * The app-reducer contract: pure over (rows, args, ctx) and IDEMPOTENT —
 * re-applied to every authoritative server-rows write while in flight.
 */
export type SnapbackOptimisticReducer = (
  rows: readonly Record<string, unknown>[],
  args: Record<string, unknown>,
  context: SnapbackOptimisticReducerContext,
) => readonly Record<string, unknown>[];

export type SnapbackDerivedOverlayErrorHook = (
  code: 'SNAPBACK_CONTRACT_DERIVED_OVERLAY_SKIPPED',
  message: string,
  details: Readonly<{ mutation: string | undefined; code: string | null }>,
) => void;

/**
 * A plan is derivable for a boundary iff every table it names is the
 * boundary's visible table.
 */
export function planDerivableForTable(plan: unknown, table: string): boolean;

/** Derive an optimistic reducer from a serialized `MutationPlan`, or null. */
export function deriveOptimisticReducer(input: {
  name?: string;
  plan: SnapbackMutationPlan | Readonly<Record<string, unknown>>;
  table: string;
  onError?: SnapbackDerivedOverlayErrorHook | null;
}): SnapbackOptimisticReducer | null;

/** Build the derived-reducer map for every plan-bearing manifest mutation. */
export function deriveOptimisticReducers(input: {
  manifest: SnapbackContractDataManifest | Readonly<Record<string, unknown>>;
  table: string;
  onError?: SnapbackDerivedOverlayErrorHook | null;
}): Record<string, SnapbackOptimisticReducer>;

// ---------------------------------------------------------------------------
// Contract runtime / client seams
// ---------------------------------------------------------------------------

export interface ContractMountHandle {
  dispose(): void;
  readonly [key: string]: unknown;
}

/** The members of an Exact Contract runtime this adapter consumes. */
export interface ContractRuntimeLike {
  mount?(component: unknown, options?: Record<string, unknown>): ContractMountHandle;
  unmount?(rootId: number | string): void;
  createProviderQueryHandle?(
    provider: unknown,
    name: string,
    args: Record<string, unknown>,
  ): unknown;
  createProviderEphemeralHandle?(
    provider: unknown,
    name: string,
    args: Record<string, unknown>,
  ): unknown;
  createContractMockQueryBoundary?(initialRows: Record<string, unknown>): unknown;
  createBoundaryContractDataProvider?(
    manifest: unknown,
    boundary: unknown,
    options: Record<string, unknown>,
  ): unknown;
  createProviderMutation?(
    provider: unknown,
    name: string,
  ): (args?: Record<string, unknown>) => unknown;
  rotatePartition?(provider: unknown): unknown;
}

/** The members of a Snapback kit client this adapter consumes (all optional). */
export interface SnapbackContractClientLike {
  query?(name: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  mutate?(name: string, options?: Record<string, unknown>): Promise<unknown>;
  liveQuery?(name: string, options: Record<string, unknown>): Promise<Record<string, unknown>>;
  subscribeEphemeral?(name: string, options: Record<string, unknown>): Promise<unknown>;
  publishEphemeral?(name: string, options: Record<string, unknown>): Promise<unknown>;
  registerEphemeralRepublisher?(
    reference: unknown,
    callback: (context: Record<string, unknown>) => unknown,
  ): unknown;
  liveStreamManager?(...args: unknown[]): unknown;
  onReceipt?(listener: (receipt: unknown, publication?: unknown) => void): () => void;
  receipts?(): unknown[];
  authSession?(): Promise<unknown>;
  captureAuthority?(): unknown;
  authorityCaptureFor?(value: unknown): unknown;
  commitAuthorityPublication?(
    capture: unknown,
    commit: (view?: unknown) => unknown,
  ): Promise<{ committed: boolean; value?: unknown }>;
  registerAuthBarrierParticipant?(participant: unknown): () => unknown;
  disconnect?(connectionId: string): Promise<unknown>;
  authCoordinator?: unknown;
  agentAuthority?: unknown;
  authorityFence?: unknown;
  authProtocols?: Readonly<Record<string, number | null>> | null;
}

/** The coordinator contract createSnapbackContractSurface requires. */
export interface ContractAuthorityCoordinatorLike {
  capture(): unknown;
  isCurrent(capture: unknown): boolean;
  compareAndCommit(
    capture: unknown,
    commit: (view?: unknown) => unknown,
  ): Promise<{ committed: boolean; value?: unknown }>;
  registerParticipant(participant: unknown, options?: unknown): () => unknown;
  synchronize?(): Promise<unknown>;
  restoreOffline?(): Promise<unknown>;
  authority?: unknown;
  hasDurableCustody?: boolean;
}

export function mountSnapbackContractHeadless(
  runtime: ContractRuntimeLike,
  component: unknown,
  options?: Record<string, unknown>,
): ContractMountHandle;

// ---------------------------------------------------------------------------
// The generated-app Contract surface
// ---------------------------------------------------------------------------

export interface CreateSnapbackContractSurfaceOptions {
  runtime: ContractRuntimeLike;
  client: SnapbackContractClientLike;
  userId?: string;
  /** Explicit injection; ordinary kit callers expose client.authCoordinator. */
  authCoordinator?: ContractAuthorityCoordinatorLike | null;
  manifest: SnapbackContractDataManifest;
  artifactIndex?: Readonly<Record<string, unknown>> | null;
  schemaManifest?: Readonly<Record<string, unknown>> | null;
  functionManifest?: Readonly<Record<string, unknown>> | null;
  /** Async store contract for retained rows + monotonic queued mutations. */
  clientStore?: SnapbackClientStore | null;
  retainedIdentity?: Readonly<Record<string, unknown>> | null;
  /** Single-query mode binding (with boundaryKey); ignored in liveQueries mode. */
  queryName?: string;
  boundaryKey?: string;
  queryArgs?: Record<string, unknown>;
  /** App-supplied idempotent optimistic reducers, keyed by mutation name. */
  optimisticReducers?: Readonly<Record<string, SnapbackOptimisticReducer>>;
  livePush?: boolean;
  liveFallbackToPoll?: boolean;
  connectionId?: string | null;
  liveStreamOptions?: Record<string, unknown>;
  onConnectionChange?:
    | ((connection: ContractConnectionState, detail?: Readonly<Record<string, unknown>>) => void)
    | null;
  onSubscriptionEvent?: ((event: Readonly<Record<string, unknown>>) => void) | null;
  rootId?: string | null;
  onReceipt?: ((receipt: Readonly<Record<string, unknown>>) => void) | null;
  ephemeralPermissions?:
    | ((collection: string, scope: Readonly<Record<string, unknown>>) => readonly string[])
    | null;
  ephemeralIdleLingerMs?: number;
  /** Deterministic near-limit coverage only; production callers omit this. */
  testLifecycleGenerationSeeds?: Readonly<{
    resume?: number;
    socketLoss?: number;
    ephemeralWiring?: number;
  }> | null;
  /** Multi-query mode: named manifest live queries (name or `{ name, args }`). */
  liveQueries?:
    | readonly (string | Readonly<{ name: string; args?: Record<string, unknown> }>)[]
    | null;
  requiredQueries?: readonly (string | Readonly<{ name: string }>)[] | null;
  /** LLP 0063 Step 1: liveQueries becomes a descriptor allowlist over keyed scopes. */
  keyedQueryScopes?: boolean;
  /** Channel A preload lookup over the inlined boot payload. */
  rqsPreload?:
    | ((name: string, args: Record<string, unknown>) =>
        | Readonly<{ rows: readonly unknown[]; resume: unknown }>
        | null)
    | null;
  /** Channel C register-mode lookup over a register-mode bundle response. */
  rqsRegistered?:
    | ((name: string, args: Record<string, unknown>) =>
        | Readonly<{
            subscriptionId: string;
            rows: readonly unknown[];
            version: number;
            resume: unknown;
          }>
        | null)
    | null;
}

export interface SnapbackContractSurface {
  readonly adapterVersion: number;
  readonly capabilityClass: 'Online' | 'Parity';
  readonly links: Readonly<Record<string, (args?: Record<string, unknown>) => unknown>>;
  readonly provider: unknown;
  readonly diagnostics: SnapbackProviderDiagnostic[];
  pendingCount(): number;
  readonly declaredQueries: string[];
  readonly declaredMutations: string[];
  readonly livePush: boolean;
  readonly rootId: string;
  receipts(): unknown[];
  connection(name?: string): ContractConnectionState;
  mount(component: unknown, options?: Record<string, unknown>): ContractMountHandle;
  flush(): Promise<void>;
  dispose(): Promise<unknown>;

  // Mode-dependent members (single-query, multi-live, or keyed surfaces).
  readonly boundary?: unknown;
  readonly liveQueries?: readonly string[];
  readonly connectionId?: string;
  connections?(): Record<string, ContractConnectionState>;
  rotateAuthority?(next?: { userId?: string; authorityCapture?: unknown }): unknown;
  registerEphemeralRepublisher?(
    reference: unknown,
    callback: (context: Record<string, unknown>) => unknown,
  ): unknown;
  retained?(): unknown;
  /** Null in normal operation; the app-renderable migration quarantine state. */
  migrationBoundary?():
    | ({ kind: 'resync-required' | 'upgrade-required' } & Record<string, unknown>)
    | null;
  reconnect?(): Promise<unknown>;
  failedMutations?(): Promise<Record<string, unknown>[]>;
  readonly ephemeralSourceStarts?: (name: string) => number;
  prewarmEphemeral?(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

export function createSnapbackContractSurface(
  options: CreateSnapbackContractSurfaceOptions,
): Promise<SnapbackContractSurface>;

// ---------------------------------------------------------------------------
// Ephemeral wiring
// ---------------------------------------------------------------------------

export const EPHEMERAL_IDLE_LINGER_MS: number;

export interface SwappableEphemeralWiring {
  readonly descriptors: unknown;
  readonly sources: Record<string, unknown>;
  readonly supportsEphemeral: boolean;
  sourceStarts(name: string): number;
  prewarm(): Promise<unknown>;
  prewarmScope(name: string, args?: Record<string, unknown>): Promise<unknown>;
  buildLinks(
    provider: unknown,
    runtime: ContractRuntimeLike,
  ): Record<string, (args?: Record<string, unknown>) => unknown>;
  quiesce(): void;
  blank(): void;
  prepare(nextWiring: unknown): void;
  expose(): void;
  dispose(): void;
  readonly lifecycleTerminalError: unknown;
}

/** Narrow white-box seam for deterministic predecessor-callback testing. */
export function __createSwappableEphemeralWiringForTests(
  initialWiring: unknown,
  options?: Readonly<{
    generationSeed?: number;
    onLifecycleTerminal?: ((error: unknown) => void) | null;
  }>,
): SwappableEphemeralWiring;

// ---------------------------------------------------------------------------
// System surfaces (admin console and friends)
// ---------------------------------------------------------------------------

export type SnapbackSystemResourceInitial = unknown;

export interface SnapbackSystemResourceDefinition {
  readonly key?: string;
  readonly binding?: string;
  readonly initial: SnapbackSystemResourceInitial | (() => unknown);
}

/** A definition object, an initial-rows function, or the initial rows value. */
export type SnapbackSystemResource =
  | SnapbackSystemResourceDefinition
  | SnapbackSystemResourceInitial;

export interface SnapbackSystemSurfaceContext {
  readonly boundary: unknown;
  readonly diagnostics: SnapbackProviderDiagnostic[];
  addDiagnostic(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): SnapbackProviderDiagnostic;
  publish(key: string, rows: unknown): unknown[];
  publishOne(key: string, row: unknown): unknown[];
  queryRows(key: string): unknown;
  readonly targetSurface: string;
}

export type SnapbackSystemCommandRun = (
  args: Record<string, unknown>,
  context: SnapbackSystemSurfaceContext,
) => unknown;

export type SnapbackSystemCommand =
  | SnapbackSystemCommandRun
  | Readonly<{ run: SnapbackSystemCommandRun; track?: boolean }>;

export interface SnapbackSystemContractSurface {
  readonly adapterVersion: number;
  readonly capabilityClass: 'Online';
  readonly targetSurface: string;
  readonly boundary: unknown;
  readonly links: Record<string, (args?: Record<string, unknown>) => unknown>;
  readonly diagnostics: SnapbackProviderDiagnostic[];
  publish(key: string, rows: unknown): unknown[];
  publishOne(key: string, row: unknown): unknown[];
  queryRows(key: string): unknown;
  pendingCount(): number;
  mount(component: unknown, options?: Record<string, unknown>): ContractMountHandle;
  flush(): Promise<void>;
  dispose(): void;
}

/** Shared bridge for Contract system surfaces such as the Snapback admin console. */
export function createSnapbackSystemContractSurface(options: {
  runtime: ContractRuntimeLike;
  resources: Readonly<Record<string, SnapbackSystemResource>>;
  commands?: Readonly<Record<string, SnapbackSystemCommand>>;
  targetSurface?: string;
}): Promise<SnapbackSystemContractSurface>;

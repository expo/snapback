import type { SnapbackDiagnosticCode } from './diagnostic-codes.d.mts';
import type { SnapbackClientDiagnosticsChannel } from './client-diagnostics.mjs';
import type {
  AgentAuthorityCapture,
  AgentAuthorityCredentialInput,
} from './agent-authority.mjs';
import type {
  AuthCoordinator,
  SnapbackAuthBarrierParticipant,
  SnapbackAuthorityTransitionStatus,
} from '@expo/snapback-contract/auth-coordinator';

export {
  SnapbackDiagnosticError,
  isSnapbackDiagnosticError,
  projectAppRefusal,
} from './diagnostic-error.mjs';
export type {
  SnapbackAppRefusal,
  SnapbackDiagnosticLike,
  SnapbackDiagnosticOperation,
} from './diagnostic-error.mjs';
export { DEFAULT_AUTH_STORAGE_PARTITION } from './app-client-defaults.mjs';
export { createSnapbackAppClient } from './app-client.mjs';
export type {
  ApplicationAuthBootstrapV1,
  AuthBootstrapAdvisory,
  AuthBootstrapAuthoritySource,
  AuthBootstrapSnapshot,
  AuthCredentialMode,
  AuthDeclaredProviderV1,
  AuthEntryAdapter,
  AuthIdentityProvider,
  ProviderEntryContext,
  PublicAuthCustodyFacts,
  ResolvedProviderEntryV1,
  SnapbackAppBindingV1,
  SnapbackAppClient,
  SnapbackAppClientDebugEvent,
  SnapbackAppClientPlatform,
  SnapbackApplicationDescriptorV1,
  SnapbackAuthFacade,
  SnapbackSha256DigestAdapter,
} from './app-client.mjs';
export {
  ARGUMENT_NORMALIZATION_VERSION,
  exactArgumentContract,
  normalizeArgumentsAgainstContractV1,
  normalizeGeneratedArgumentsV1,
  optionalPropertyPathsV1,
} from './argument-normalization.mjs';

export type { SnapbackDiagnosticCode } from './diagnostic-codes.d.mts';
/** Closed classification of negotiation/configuration refusals that cannot
 * heal under an unchanged live subscribe or connection-open request. */
export declare function isTerminalLiveProtocolRefusal(error: unknown): boolean;
export {
  createClientDevConsoleReporter,
  createClientDiagnosticsChannel,
  DEFAULT_QUEUED_MUTATION_WEDGE_WARNING_MS,
  positiveDevelopmentEnvironment,
  projectDiagnosticV1,
} from './client-diagnostics.mjs';
export type {
  SnapbackClientDiagnosticsDisposable,
  SnapbackClientDiagnosticsChannel,
  SnapbackClientDiagnosticsOptions,
  SnapbackClientDiagnosticsSnapshot,
  SnapbackDevDiagnosticsConsole,
  SnapbackDiagnosticEventInput,
  SnapbackDiagnosticEventV2,
  SnapbackDiagnosticOccurrence,
  SnapbackDiagnosticV1Projection,
} from './client-diagnostics.mjs';

/** Stable, source-complete client diagnostic carrier (LLP 0010 / LLP 0193). */
export interface SnapbackDiagnostic {
  readonly schemaVersion: 'snapback.client-diagnostic.v1';
  readonly code: SnapbackDiagnosticCode;
  readonly severity: 'error';
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

/** Structural error returned by mutation promises without changing throw-based control flow. */
export interface SnapbackMutationError extends Error {
  readonly code: SnapbackDiagnosticCode;
  readonly diagnostic: SnapbackDiagnostic;
}

/** A declared application refusal; appCode remains application-defined. */
export interface SnapbackAppRefusalError extends SnapbackMutationError {
  readonly code: 'SNAPBACK_APP_REFUSAL';
  readonly diagnostic: SnapbackDiagnostic & Readonly<{
    code: 'SNAPBACK_APP_REFUSAL';
    details: Readonly<Record<string, unknown> & {
      appCode: string;
      appDetails?: unknown;
      appDetailsDropped?: boolean;
    }>;
  }>;
}

export {
  SNAPBACK_EXTERNAL_STORE_PROTOCOL,
  ExternalQueryScope,
  assertExternalStoreCompatibility,
  createExternalQueryStore,
  externalStoreIdentity,
} from './external-store.mjs';
export type {
  ExternalConnection,
  ExternalProviderDelivery,
  ExternalQueryStore,
  ExternalStoreController,
  ExternalStoreFreshness,
  ExternalStoreSnapshot,
  ExternalStoreStatus,
} from './external-store.mjs';
export { SnapbackCommandClient, createCommandClient } from './commands.mjs';
export {
  REMEDIATION_KIND_REGISTRY_VERSION,
  REMEDIATION_SET_MAX_ITEMS,
  REMEDIATION_SET_SCHEMA_VERSION,
  createIdentifierRemediationSet,
  decodeRemediationSet,
  remediationControlCatalogProjection,
} from './remediation.mjs';
export type { RemediationItemV1, RemediationKindV1, RemediationSetV1 } from './remediation.mjs';
export { createAssetClient } from './assets.mjs';
export type {
  AssetBearingCommandDescriptorV1,
  AssetBearingCommandReferenceV1,
  CommandArgs,
  CommandRef,
  CommandAssetSource,
  CommandAssetSourceAdapter,
  AdaptedCommandAssetSource,
  CommandOutcome,
  CommandResidue,
  CommandResult,
  CommandTask,
  CommandTaskSnapshot,
  MutationAttemptSnapshot,
  SnapbackCommandDiagnostic,
  TypedRemediation,
  PlatformCommandAssetSource,
} from './commands.mjs';
export {
  CANONICAL_CLIENT_VALUE_V1_LIMITS,
  canonicalizeClientValueV1,
  canonicalReactStoreKeyV1,
} from './canonical-client-value.mjs';
import type {
  ResultTransformRowV1,
  TransformPlanV1,
} from './result-transform.mjs';

export type SnapbackFunctionKind = 'Query' | 'LiveQuery' | 'Mutation' | 'Action' | 'Command';
export type SnapbackOperationKind = Exclude<SnapbackFunctionKind, 'Command'>;
export interface GeneratedMutationIrV1 {
  readonly format: 'snapback.generated-mutation-ir.v1';
  readonly operationHash: `sha256:${string}`;
  readonly sourceIdentity: Readonly<{
    functionId: string;
    implementationHash: string;
    authoredSourceHash?: `sha256:${string}`;
    activation: ArtifactGeneration;
  }>;
  readonly schemaIdentity: Readonly<{
    schemaVersion: string;
    appId: string;
    schemaHash: string;
  }>;
  readonly capabilityClass: 'local-executable' | 'server-only';
  readonly capabilityCode: string;
  readonly declaredEffectClass: 'snapback.browser-ir.insert-get-guard-patch.v1';
  readonly declaredReads: readonly string[];
  readonly localReadRequirements: readonly Readonly<{
    kind: 'point';
    table: string;
    idArg: string;
    binding: string | null;
    requiredFields: readonly string[];
  }>[];
  readonly schema: Readonly<Record<string, unknown>>;
  readonly plan: Readonly<Record<string, unknown>>;
  readonly mintSites: readonly string[];
  readonly usesRuntimeNow: boolean;
  readonly boundedSkew: BoundedSkewDeclaration | null;
}
export interface SnapbackFunctionReference<
  Name extends string = string,
  Kind extends SnapbackOperationKind = SnapbackOperationKind,
  Args = Record<string, unknown>,
  Result = unknown,
> {
  readonly artifactKind: 'functionReference';
  readonly schemaVersion: string;
  readonly appId: string;
  readonly id: string;
  readonly name: Name;
  readonly kind: Kind;
  readonly __snapbackReferenceKind: Kind;
  /** Generated authority admission. Optional only for compatibility with
   * references emitted before LLP 0247 rollout 1. */
  readonly authRequirement?: 'public' | 'optional-user' | 'authenticated';
  readonly implementationHash: string;
  readonly argsContractHash: string;
  /** Exact generated contract. Optional only for one-release compatibility
   * with older references that carry a closed `argumentSchema`. */
  readonly argsContract?: Readonly<{
    readonly fields: readonly Readonly<{
      readonly name: string;
      readonly required: boolean;
      readonly value: Readonly<Record<string, unknown>>;
    }>[];
  }>;
  readonly argumentSchema?: Readonly<Record<string, unknown>>;
  readonly resultContractHash: string;
  readonly authoredSourceHash?: `sha256:${string}`;
  readonly searchRequestContractHash?: string;
  readonly searchResourceArg?: string | null;
  readonly expectedGeneration?: ArtifactGeneration;
  readonly mutationIr?: GeneratedMutationIrV1;
  readonly __args?: Args;
  readonly __result?: Result;
}

export type QueryRef<Name extends string = string, Args = Record<string, unknown>, Result = unknown> =
  SnapbackFunctionReference<Name, 'Query', Args, Result>;
export type LiveQueryRef<Name extends string = string, Args = Record<string, unknown>, Result = unknown> =
  SnapbackFunctionReference<Name, 'LiveQuery', Args, Result>;
export type MutationRef<Name extends string = string, Args = Record<string, unknown>, Result = unknown> =
  SnapbackFunctionReference<Name, 'Mutation', Args, Result>;
export type ActionRef<Name extends string = string, Args = Record<string, unknown>, Result = unknown> =
  SnapbackFunctionReference<Name, 'Action', Args, Result>;

export interface ArtifactGeneration {
  readonly schemaVersion: string;
  readonly appId: string;
  readonly schemaHash: string;
  readonly bundleHash: string;
  readonly inputsHash: string;
}

/** Stable LLP 0179 application descriptor accepted by React binding
 * preparation. Environment endpoints and authority remain separate inputs. */
export interface SnapbackAppDescriptorV1 {
  readonly format: 'snapback.app.v1';
  readonly authoringProfile: 'snapback-explicit-v1' | 'snapback-familiar-ts-v1';
  readonly identity: Readonly<{
    app: string;
    schema: string;
    functions: string;
    descriptor: string;
  }>;
  readonly api: Readonly<{
    queries: object;
    mutations: object;
    assets: object;
    ephemeral: object;
    queryGroups: object;
  }>;
  readonly commands: Readonly<Record<string, unknown>>;
  readonly surfaces: Readonly<Record<string, unknown>>;
  readonly capabilities: Readonly<{ required: readonly string[] }>;
}

export interface SettlementIdentityClaims {
  readonly implementationHash: string;
  readonly activation: ArtifactGeneration;
}

export interface SettlementMintClaim {
  readonly claimed: string;
  readonly site: string;
  readonly occurrence: number;
}

export interface SettlementClaimSet {
  readonly version?: 1;
  readonly now?: number;
  readonly mints?: readonly SettlementMintClaim[];
}

export interface BoundedSkewDeclaration {
  readonly field: string;
  readonly maxSkewMs: number;
}

export interface FunctionInvocationFacts {
  readonly activeGeneration: ArtifactGeneration;
}

export interface SnapbackEphemeralReference<
  Name extends string = string,
  Scope = Record<string, unknown>,
  Value = unknown,
  KeyMode extends 'Connection' | 'Session' | 'User' | 'Custom' =
    'Connection' | 'Session' | 'User' | 'Custom',
> {
  readonly artifactKind: 'ephemeralCollectionReference';
  readonly schemaVersion: string;
  readonly appId: string;
  readonly id: string;
  readonly name: Name;
  readonly keyMode: KeyMode;
  readonly scopeFields: readonly string[];
  /** Exact contracts emitted by LLP 0247 codegen. Optional in the structural
   * public type so pre-rollout references remain assignable for one release;
   * runtime admission still refuses generated ephemeral calls without them. */
  readonly scopeContract?: Readonly<Record<string, unknown>>;
  readonly valueContract?: Readonly<Record<string, unknown>>;
  readonly routingFields: readonly string[];
  readonly defaultTtlMs: number;
  readonly maxTtlMs: number;
  readonly withdrawalVisibilityDeadlineMs?: number;
  readonly maxValueBytes: number;
  readonly publishRate: Readonly<{ sustainedHz: number; burst: number }>;
  readonly deliveryMode: 'latest';
  readonly __scope?: Scope;
  readonly __value?: Value;
}

export interface SnapbackQueryGroupReference<
  Route extends string = string,
  Params = Record<string, unknown>,
  Entries = Record<string, unknown>,
> {
  readonly artifactKind: 'queryGroupReference';
  readonly formatVersion: 1;
  readonly schemaVersion: string;
  readonly appId: string;
  readonly id: string;
  readonly route: Route;
  readonly definitionHash: string;
  readonly queries: readonly Readonly<{
    name: string;
    ref: SnapbackFunctionReference<string, 'LiveQuery', unknown, unknown>;
    args: Readonly<Record<string, unknown>>;
  }>[];
  readonly persist?: false;
  readonly __params?: Params;
  readonly __entries?: Entries;
}

export type QueryGroupParams<Ref> =
  Ref extends { readonly __params?: infer Params } ? Params : Record<string, unknown>;
export type QueryGroupEntries<Ref> =
  Ref extends { readonly __entries?: infer Entries } ? Entries : Record<string, unknown>;

export type FunctionArgs<Ref> =
  Ref extends { readonly __args?: infer Args } ? Args : Record<string, unknown>;
export type FunctionResult<Ref> =
  Ref extends { readonly __result?: infer Result } ? Result : unknown;
/** Public headless live-query value. A client-owned authorization/custody
 * blank is `null` for generated single-value (`document`/`value`) references;
 * row-array references continue to expose an empty array at runtime. Generated
 * reference phantoms currently carry the result value but not its contract
 * kind, so this safe public type includes the lifecycle blank for either form. */
export type LiveQueryConsumerResult<Ref> = FunctionResult<Ref> | null;
export type EphemeralScope<Ref> =
  Ref extends { readonly __scope?: infer Scope } ? Scope : Record<string, unknown>;
export type EphemeralValue<Ref> =
  Ref extends { readonly __value?: infer Value } ? Value : unknown;

/** Structurally compatible with the generated `Id<Table>` nominal type. */
export type SnapbackId<Table extends string> =
  string & { readonly __snapbackIdTable: Table };

/** Structurally compatible with the generated `ProvisionalId<Table>` type.
 * Its value is durable intent identity, never a speculative or canonical row
 * mint, and it is deliberately not assignable to `SnapbackId<Table>`. */
export type SnapbackProvisionalId<Table extends string> =
  string & { readonly __snapbackProvisionalIdTable: Table };

/**
 * Admit an id from an untyped boundary after validating Snapback's bounded
 * opaque-id grammar. This does not assert that the referenced row exists.
 */
export function admitSnapbackId<const Table extends string>(
  table: Table,
  value: string,
): SnapbackId<Table>;

export interface QueryOutput<Result> {
  readonly rows: Result;
  readonly version: number;
  readonly cursor?: string | null;
  readonly facts?: FunctionInvocationFacts;
}

/** LLP 0055 §Audit server-derived attribution block, copied verbatim. */
export interface FunctionAttribution {
  readonly actorUserId: string;
  readonly effectiveUserId: string | null;
  readonly grantId: string;
  readonly dryRun: boolean;
}

export interface MutationServerTiming {
  readonly authorizedAtMs: number;
  readonly executedAtMs: number;
  readonly committedAtMs: number;
}

export interface MutationOutput<Result> {
  readonly version: number;
  readonly changed_count: number;
  readonly result: Result;
  readonly authorityTransitions?: readonly AuthorityTransitionReceiptV1[];
  readonly ctx_ledger?: unknown;
  readonly authorityDescriptor: AuthorityDescriptorV1;
  readonly receipt: Readonly<Record<string, unknown>>;
  readonly attribution?: FunctionAttribution;
  readonly facts?: FunctionInvocationFacts;
  readonly timing: MutationServerTiming;
  readonly clientMutationId?: string;
  readonly optimistic?: Readonly<{
    operationHash: `sha256:${string}`;
    settlementIdentity: string;
  }>;
}

export interface AuthorityMembershipStateV1 {
  readonly role: string;
  readonly status: 'active' | 'invited';
}

export interface AuthorityTransitionReceiptV1 {
  readonly declaration: string;
  readonly predecessor: AuthorityMembershipStateV1 | null;
  readonly successor: AuthorityMembershipStateV1 | null;
  readonly subject: string;
  readonly scope: string | null;
  readonly invalidationDisposition:
    | 'global-authorization-epoch-advanced'
    | 'no-authorization-event'
    | 'preview-rolled-back';
}

export type MutationDispatchOutcome<Result> =
  | (MutationOutput<Result> & { readonly status: 'settled' })
  | {
    readonly status: 'queued';
    readonly clientMutationId: string;
    readonly sequence: number;
    readonly presentation: 'installed' | 'withheld' | 'unavailable';
    readonly operationCoverageDisposition?: string;
    readonly operationHash?: string;
    readonly blockedReason?: 'auth-barrier' | 'connectivity';
  };

export interface MutationTiming {
  readonly enqueuedAtMs: number | null;
  readonly dispatchedAtMs: number | null;
  readonly authorizedAtMs: number | null;
  readonly executedAtMs: number | null;
  readonly committedAtMs: number | null;
}

export interface MutationPhaseDurationsV1 {
  readonly queueWaitMs: number | null;
  readonly authWaitMs: number | null;
  readonly executionMs: number | null;
  readonly commitMs: number | null;
}

export interface MutationPhaseCostV1 extends MutationTiming, MutationPhaseDurationsV1 {
  readonly format: 'snapback.mutation-phase-cost.v1';
  /** Stable gated-inspection pseudonym, never the caller-supplied raw id. */
  readonly clientMutationId: `sha256:${string}`;
  readonly functionId: string;
  readonly disposition: string;
}

export interface MutationPhaseAggregateV1 {
  readonly functionId: string;
  readonly count: number;
  readonly queueWaitMs: Readonly<{ count: number; totalMs: number; maxMs: number | null }>;
  readonly authWaitMs: Readonly<{ count: number; totalMs: number; maxMs: number | null }>;
  readonly executionMs: Readonly<{ count: number; totalMs: number; maxMs: number | null }>;
  readonly commitMs: Readonly<{ count: number; totalMs: number; maxMs: number | null }>;
}

export interface MutationPhaseCostInspectionV1 {
  readonly format: 'snapback.mutation-phase-cost-inspection.v1';
  readonly records: readonly MutationPhaseCostV1[];
  readonly counters: readonly MutationPhaseAggregateV1[];
  readonly otherKeys: MutationPhaseAggregateV1;
  readonly evictedKeys: number;
  readonly droppedRecords: number;
  readonly retainedBytes: number;
  readonly recordLimit: number;
  readonly byteLimit: number;
}

export declare function inspectionPseudonymV1(value: string): `sha256:${string}`;
export declare function mutationPhaseDurationsV1(
  timing?: Partial<MutationTiming> | null,
): MutationPhaseDurationsV1;
export declare function projectMutationPhaseCostV1(input: Readonly<{
  clientMutationId: string;
  functionId: string;
  timing?: Partial<MutationTiming> | null;
  disposition: string;
}>): MutationPhaseCostV1;

export type MutationDisposition = (
  | { readonly status: 'pending'; readonly blockedReason: string | null }
  | {
    readonly status: 'settled';
    readonly settlement: MutationOutput<unknown>;
    readonly settledAt: number;
  }
  | {
    readonly status: 'failed';
    readonly failure: Readonly<{ readonly code: string; readonly message: string }>;
  }
  | { readonly status: 'stranded' }
  | { readonly status: 'quarantined' }
  | {
    readonly status: 'resultGone';
    readonly disposition: 'result-expired';
    readonly outcome: 'committed' | 'refused';
    readonly receiptDigest: `sha256:${string}`;
  }
  | { readonly status: 'unknown' }
) & {
  readonly timing: MutationTiming;
  /** Persisted enqueue target for v2 target-bound records. */
  readonly enqueueTarget?: Readonly<Record<string, unknown>>;
  /** Whether that persisted target matches this client's current target pin. */
  readonly targetMatchesCurrent?: boolean;
};

export interface OptimisticMutationViewSnapshot {
  readonly format: 'snapback.optimistic-rebase-snapshot.v1';
  readonly revision: number;
  readonly authoritativeRows: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  readonly visibleRows: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  readonly layers: readonly Readonly<Record<string, unknown>>[];
  readonly queuedOnly: readonly Readonly<Record<string, unknown>>[];
  readonly lastRebase: Readonly<Record<string, unknown>> | null;
}

export interface OptimisticMutationRebaseInput {
    readonly authoritativeRows?: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
    readonly retiredSettlementIdentities?: readonly string[];
    readonly settlementIdReplacements?: Readonly<Record<string, string>>;
    readonly cause?: string;
    readonly connected?: boolean;
}

export interface OptimisticMutationView {
  readonly format: 'snapback.optimistic-mutation-view.v1';
  readonly materializationIdentity?: Readonly<Record<string, unknown>> | null;
  readonly targetTables?: readonly string[] | null;
  readonly projectionMode?: 'project' | 'pending-only';
  rebase(input?: OptimisticMutationRebaseInput): Promise<Readonly<Record<string, unknown>>>;
  reload(input?: OptimisticMutationRebaseInput): Promise<Readonly<Record<string, unknown>>>;
  refresh(input?: OptimisticMutationRebaseInput): Promise<Readonly<Record<string, unknown>>>;
  getSnapshot(): OptimisticMutationViewSnapshot;
  inspection(): Readonly<Record<string, unknown>>;
  subscribe(listener: () => void): () => void;
  close(): void;
}

export interface GeneratedOptimisticPresentation {
  readonly status: 'none' | 'predicted' | 'pending-without-prediction';
  readonly materializationIdentity: Readonly<Record<string, unknown>> | null;
  readonly revision: number;
  readonly layers: readonly Readonly<Record<string, unknown>>[];
  readonly queuedOnly: readonly Readonly<Record<string, unknown>>[];
}

export interface AuthorityDescriptorV1 {
  readonly descriptorVersion: 1;
  readonly authorityInstanceId: string;
  readonly sessionGeneration: number;
}

/** Principal half of `currentAuthorizationScope()` — the blessed whoami. */
export interface PrincipalScopeV1 {
  readonly authMode: AuthMode;
  readonly authorizationStreamIncarnation: string;
  readonly userId: string | null;
}

/** Frozen return of `SnapbackClient.currentAuthorizationScope()`. */
export interface AuthorizationScopeV1 {
  readonly principalScope: PrincipalScopeV1;
  readonly authorityDescriptor: AuthorityDescriptorV1;
  readonly queryAuthorization: Readonly<Record<string, never>>;
}

/** Handshake authority block on `GET /auth/session` (mode projection). */
export interface AuthSessionAuthorityProjectionV1 {
  readonly kind: 'anonymous' | 'humanSession' | 'servicePrincipal';
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly isAuthenticated: boolean;
}

/** Closed `authSession()` projection. This is mode/authority, not whoami. */
export interface AuthSessionProjectionV1 {
  readonly protocolVersion: 1;
  readonly serverStartupNonce: string;
  readonly authorizationStreamIncarnation: string;
  readonly transitionGeneration: number;
  readonly activeMode: AuthMode;
  readonly desiredMode: AuthMode;
  readonly modeState: 'settled' | 'pendingRestart' | 'quarantined';
  readonly appDataAvailability: 'available' | 'refusedPending';
  readonly quarantineCode: string | null;
  readonly clientProtocols: Readonly<{
    readonly authClient: 1 | null;
    readonly authInvalidation: 1 | null;
    readonly authorityDescriptor: 1 | null;
    readonly authorizedLease: 1 | null;
  }>;
  readonly availability: Readonly<Record<string, unknown>>;
  readonly provider: Readonly<{
    readonly key: string;
    readonly available: boolean;
  }>;
  readonly transports: readonly ['bearer'];
  readonly authority: AuthSessionAuthorityProjectionV1;
  readonly authorityDescriptor: AuthorityDescriptorV1;
  readonly deploymentIdentity: Readonly<Record<string, unknown>> | null;
  readonly authorizedLease: Readonly<Record<string, unknown>> | null;
}

export interface AuthSessionCredentialProjectionV1 {
  readonly id: string;
  readonly userId: string;
  readonly provider: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
}

/** Public credential projection. The bearer is deliberately absent. */
export interface AuthCredentialPublicProjectionV1 {
  readonly tokenType: 'Bearer';
  readonly refreshAfter: number;
  readonly session: AuthSessionCredentialProjectionV1;
  readonly authorityDescriptor: AuthorityDescriptorV1;
}

/** One-time recovery custody returned only by signup/authPasswordSet/consume/rotate. */
export interface AuthRecoveryCredentialPublicProjectionV1
  extends AuthCredentialPublicProjectionV1 {
  readonly recoveryCodes: readonly string[];
}

export type SnapbackAuthRemediation = Readonly<{
  kind: string;
  riskClass: string;
  machineApplicable: boolean;
  requiresApproval: boolean;
  authorityEffect: string;
  precondition: Readonly<Record<string, unknown>>;
  description: string;
}>;

export type AuthenticatedCurrentPrincipalSnapshot = Readonly<{
  status: 'authenticated';
  userId: string;
  sessionId: string;
  sessionClass: 'humanSession' | 'servicePrincipal';
  /** Credential-entry projections carry the issuing provider; a restored
   * session handshake exposes only provider availability, so this remains
   * explicitly unknown until issuance is re-witnessed. */
  provider: string | null;
  authorityInstanceId: string;
  sessionGeneration: number;
  authorizationStreamIncarnation: string;
  /** Credential-entry projections carry expiry; a restored session handshake
   * does not, so these fields remain explicitly unknown until enriched. */
  expiresAt: number | null;
  absoluteExpiresAt: number | null;
}>;

export type CurrentPrincipalSnapshot =
  | Readonly<{ status: 'loading' }>
  | Readonly<{
      status: 'anonymous';
      authMode: AuthMode;
      authorizationStreamIncarnation: string;
      authorityInstanceId: string;
    }>
  | AuthenticatedCurrentPrincipalSnapshot
  | Readonly<{
      status: 'refreshing';
      principal: AuthenticatedCurrentPrincipalSnapshot;
    }>
  | Readonly<{
      status: 'blocked';
      diagnostic: SnapbackDiagnostic;
      remediations: readonly SnapbackAuthRemediation[];
    }>;

/** LLP 0238 D6 vocabulary-only projection over the existing flat methods. */
export interface SnapbackClientAuthNamespace {
  currentPrincipal(): CurrentPrincipalSnapshot;
  subscribeCurrentPrincipal(listener: () => void): () => void;
  readonly authSession: SnapbackClient['authSession'];
  readonly authRequestCode: SnapbackClient['authRequestCode'];
  readonly authStepUpRequest: SnapbackClient['authStepUpRequest'];
  readonly authExchange: SnapbackClient['authExchange'];
  readonly authEnterAsGuest: SnapbackClient['authEnterAsGuest'];
  readonly authClaimGuestWithPassword: SnapbackClient['authClaimGuestWithPassword'];
  readonly authPasswordSignup: SnapbackClient['authPasswordSignup'];
  readonly authPasswordSignIn: SnapbackClient['authPasswordSignIn'];
  readonly authPasswordChange: SnapbackClient['authPasswordChange'];
  readonly authPasswordSet: SnapbackClient['authPasswordSet'];
  readonly authPasswordReset: SnapbackClient['authPasswordReset'];
  readonly authRecoveryConsume: SnapbackClient['authRecoveryConsume'];
  readonly authRecoveryRotate: SnapbackClient['authRecoveryRotate'];
  readonly authRefresh: SnapbackClient['authRefresh'];
  readonly authLogout: SnapbackClient['authLogout'];
  readonly authTerminalStatus: SnapbackClient['authTerminalStatus'];
  readonly subscribeAuthTerminal: SnapbackClient['subscribeAuthTerminal'];
  readonly authorityTransitionStatus: SnapbackClient['authorityTransitionStatus'];
  readonly subscribeAuthorityTransition: SnapbackClient['subscribeAuthorityTransition'];
}

export interface AuthChallengePublicProjectionV1 {
  readonly challengeId: string;
  readonly expiresAt: number;
}

export interface AuthPasswordSetStepUpV1 {
  readonly challengeId: string;
  readonly code: string;
}

export interface SettledMutation {
  readonly clientMutationId: string;
  readonly function: string;
  readonly settlement: MutationOutput<unknown>;
  readonly settledAt: number;
  readonly authorityDescriptor: AuthorityDescriptorV1 | null;
  /** Persisted enqueue target for v2 target-bound records. */
  readonly enqueueTarget?: Readonly<Record<string, unknown>>;
  readonly targetMatchesCurrent?: boolean;
}

export interface ActionOutput<Result> {
  readonly ok: boolean;
  readonly result: Result;
  readonly diagnostic?: Readonly<Record<string, unknown>>;
  readonly facts?: FunctionInvocationFacts;
}

export const SNAPBACK_QUERY_OFFLINE_UNAVAILABLE: 'SNAPBACK_QUERY_OFFLINE_UNAVAILABLE';
export const SNAPBACK_STORE_RUNTIME_LOAD_FAILED: 'SNAPBACK_STORE_RUNTIME_LOAD_FAILED';
export function rqsRetentionIneligibilityReason(ref: unknown): string;

export interface SnapbackQueryOfflineUnavailableDiagnostic {
  readonly schemaVersion: 'snapback.client-diagnostic.v1';
  readonly code: typeof SNAPBACK_QUERY_OFFLINE_UNAVAILABLE;
  readonly severity: 'error';
  readonly subsystem: 'client';
  readonly message: string;
  readonly details: Readonly<{
    readonly function: string;
    readonly retentionClass: string;
    readonly retentionDisposition: 'volatile' | 'retainable';
    readonly localAnswer: Readonly<{
      readonly answerClass: 'unknown';
      readonly freshness: null;
      readonly reason: string;
    }>;
  }>;
}

export interface SnapbackQueryOfflineUnavailableError extends Error {
  readonly name: 'SnapbackQueryOfflineUnavailableError';
  readonly code: typeof SNAPBACK_QUERY_OFFLINE_UNAVAILABLE;
  readonly diagnostic: SnapbackQueryOfflineUnavailableDiagnostic;
  readonly cause: unknown;
}

export type SearchMatchAtomV1 =
  | { readonly Term: { readonly value: string; readonly field?: string } }
  | { readonly Phrase: { readonly values: readonly string[]; readonly field?: string } }
  | { readonly Prefix: { readonly value: string; readonly field?: string } };
export type SearchClauseV1 =
  | SearchMatchAtomV1
  | { readonly Filter: {
      readonly field: string;
      readonly op: 'eq';
      readonly value: string | number | boolean;
    } }
  | { readonly Not: SearchMatchAtomV1 }
  | { readonly Any: readonly SearchMatchAtomV1[] };
/** @deprecated Use SearchClauseV1 or SearchMatchAtomV1 for the closed shape. */
export type SearchAtomV1 = SearchClauseV1;
export interface SearchQueryAstV1 {
  readonly all: readonly SearchClauseV1[];
}
export interface SearchRequestV1 {
  readonly query: SearchQueryAstV1;
  readonly limit?: number;
  readonly after?: string;
}
export interface SearchMatchRangeV1 {
  readonly start: number;
  readonly end: number;
}
export interface SearchHighlightV1 {
  readonly field: string;
  readonly text: string;
  readonly matches: readonly SearchMatchRangeV1[];
}
/** @ref LLP 0073#ranking-order-and-cursors — generated operation refs bind
 * these generic defaults to one exact stored-field projection and row-id. */
export interface SearchItemV1<
  Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  RowId extends string = string,
> {
  readonly rowId: RowId;
  readonly score: number;
  readonly fields: Fields;
  readonly highlights: readonly SearchHighlightV1[];
}
declare const searchPageV1Brand: unique symbol;
export interface SearchPageV1<
  Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  RowId extends string = string,
> {
  /** Generated operation phantom; no runtime response is expected to carry it. */
  readonly [searchPageV1Brand]: true;
  readonly items: readonly SearchItemV1<Fields, RowId>[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

export interface VectorFilterV1 {
  readonly field: string;
  readonly op: 'eq';
  readonly value: string | number | boolean;
}
export interface VectorRequestV1 {
  readonly vector: readonly number[];
  readonly k?: number;
  readonly filters?: readonly VectorFilterV1[];
}
export interface VectorItemV1<
  Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  RowId extends string = string,
> {
  readonly rowId: RowId;
  readonly distance: number;
  readonly fields: Fields;
}
declare const vectorPageV1Brand: unique symbol;
export interface VectorPageV1<
  Fields extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  RowId extends string = string,
> {
  /** Generated operation phantom; no runtime response is expected to carry it. */
  readonly [vectorPageV1Brand]: true;
  readonly items: readonly VectorItemV1<Fields, RowId>[];
}

/**
 * Search operations deliberately carry an operation-level SearchPageV1
 * phantom while the ordinary query wire carries only that page's items in
 * QueryOutput.rows and its cursor at QueryOutput.cursor.
 */
export type QueryWireResult<Result> =
  Result extends SearchPageV1<infer Fields, infer RowId>
    ? readonly SearchItemV1<Fields, RowId>[]
    : Result extends VectorPageV1<infer Fields, infer RowId>
      ? readonly VectorItemV1<Fields, RowId>[]
      : Result;

export function parseSearchQueryV1(
  source: string,
  options?: { readonly fields?: readonly string[]; readonly minPrefixScalars?: number },
): SearchQueryAstV1;
export const search: Readonly<{
  term(value: string, field?: string): SearchMatchAtomV1;
  phrase(values: string | readonly string[], field?: string): SearchMatchAtomV1;
  prefix(value: string, field?: string): SearchMatchAtomV1;
  not(atom: SearchMatchAtomV1): SearchClauseV1;
  any(...atoms: readonly (SearchMatchAtomV1 | readonly SearchMatchAtomV1[])[]): SearchClauseV1;
  filter(field: string, value: string | number | boolean): SearchClauseV1;
  all(...clauses: readonly (SearchClauseV1 | readonly SearchClauseV1[])[]): SearchQueryAstV1;
}>;

/** Refuse-with-clarity retainability classification (LLP 0129 Phase 0 /
 * LLP 0053's retainability invariant): a non-retainable subscription names
 * WHY it will never render cold instead of silently acting online. */
export interface LiveQueryRetention {
  readonly retainable: boolean;
  readonly code: string | null;
  readonly reason: string | null;
  readonly store: RqsStoreInfo;
}

/** Renderable authorization-denial fact (0137 A1-Expo f4): recorded when a
 * fresh subscribe is ANSWERED with an authorization refusal (e.g. after a
 * bearer custody transition to a lesser-privileged successor). Cleared by
 * the next successful fresh subscribe and by the custody blank barrier. */
export interface LiveQueryAuthorizationDenial {
  readonly code: string | null;
  readonly message: string | null;
  readonly atMs: number;
}

/** For a typed generated reference, `Rows` should be the corresponding
 * `LiveQueryConsumerResult<Ref>` so a single-value lifecycle blank is explicit. */
export interface LiveQueryHandle<Rows> {
  subscriptionId: string | null;
  version: number;
  /** Wall-clock time of the most recent authoritative delivery. */
  readonly lastDeliveryAtMs: number | null;
  /** Storage commit version of the most recent authoritative delivery. */
  readonly authoritativeRevision: number;
  /** Client-clock lag for the most recent locally observed covered commit. */
  readonly deliveryLagMs: number | null;
  /** Headless has no consumer-value suppression layer; provider projections may. */
  readonly suppressedEqualSnapshots: number;
  rows: Rows;
  /** Canonical server/retained rows before generated private layers. */
  readonly authoritativeRows: Rows;
  /** Inspectable generated prediction or honest pending-without-prediction. */
  readonly optimisticPresentation: GeneratedOptimisticPresentation;
  /** Presentation authority axis. `optimistic` means `rows` includes private
   * prediction even when the canonical base freshness is `current`. */
  readonly answerClass:
    | 'unknown'
    | 'labeled-retained'
    | 'authoritative'
    | 'optimistic'
    | 'pending-without-prediction';
  /** Canonical base answer class before generated private layers. */
  readonly authoritativeAnswerClass: 'unknown' | 'labeled-retained' | 'authoritative';
  readonly connection: 'connecting' | 'live' | 'polling' | 'stale' | 'disconnected';
  readonly paused: boolean;
  /** Denial fact; null while the presented authority is not refused. */
  readonly authorizationDenial: LiveQueryAuthorizationDenial | null;
  /** Channel B freshness (LLP 0090 D1): rows from persistence/preload are
   * 'retained' until an authoritative answer makes them 'current'; null
   * while nothing authoritative-or-retained is held. */
  readonly freshness: 'retained' | 'current' | null;
  /** Retainability fact; null until the first subscribe classifies it. */
  readonly retention: LiveQueryRetention | null;
  /** Pending queued intents at retained-seed time (LLP 0090 D3 dated note,
   * 2026-08-01): non-zero means the retained rows are pre-intent. The live
   * queue state is `client.outboxStatus()`, not this boot-scoped fact. */
  readonly pendingIntentsAtSeed: number;
  poll(): Promise<Rows>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** The sole server-side-retirement await for this handle. Local teardown is
   * synchronous; typed ownership, session, and network failures reject this
   * task. UI unmount code may ignore the returned task. */
  dispose(): Promise<void>;
  /** Drains the fresh-subscribe tail, pause release, and best-effort cleanup
   * tail. Does not await disposal; await dispose() for server retirement. */
  settled(): Promise<void>;
  flushResumeState(): Promise<void>;
}

export interface RqsRegisteredSubscription {
  readonly subscriptionId: string;
  readonly rows: readonly unknown[];
  readonly version: number;
  readonly resume: null | Readonly<Record<string, unknown> & { readonly token: string }>;
  readonly attachDeadline: number | null;
  readonly authorization?: unknown;
}

export interface RqsMixedRegisteredSubscription extends RqsRegisteredSubscription {
  readonly bootDelivery: 'registered-live';
}

export interface RqsMixedReadOnlyResult {
  readonly bootDelivery: 'read-only';
  readonly subscriptionId: null;
  readonly rows: readonly unknown[];
  readonly version: number;
  readonly resume: null | Readonly<Record<string, unknown> & { readonly token: string }>;
  readonly freshness: 'snapshot';
  readonly attachDeadline: null;
}

export type RqsMixedBootEntry =
  | RqsMixedRegisteredSubscription
  | RqsMixedReadOnlyResult;

export interface RqsRegisteredRegistry {
  readonly connection: null | Readonly<{
    connectionId: string;
    grant: string;
    attachDeadline: number | null;
  }>;
  readonly generation: string | null;
  readonly versionStream: string | null;
  readonly size: number;
  lookup(name: string, args?: Readonly<Record<string, unknown>>): RqsRegisteredSubscription | null;
  consume(name: string, args?: Readonly<Record<string, unknown>>): RqsRegisteredSubscription | null;
}

export interface RqsMixedRegisteredRegistry {
  readonly formatVersion: 2;
  readonly profile: 'mixed-route.v2';
  readonly planHash: `sha256:${string}`;
  readonly aggregate: Readonly<{
    kind: 'mixed';
    weakest: 'read-only';
    liveChildren: number;
    readOnlyChildren: number;
  }>;
  readonly connection: Readonly<{
    connectionId: string;
    grant: string;
    attachDeadline: number;
  }>;
  readonly generation: string;
  readonly versionStream: string;
  readonly size: number;
  lookup(name: string, args?: Readonly<Record<string, unknown>>): RqsMixedBootEntry | null;
  consume(name: string, args?: Readonly<Record<string, unknown>>): RqsMixedBootEntry | null;
}

export function createRqsRegisteredRegistry(bundle: unknown): RqsRegisteredRegistry;

export type LiveQueryRegistrationOptions =
  | Readonly<{
      transport: 'stream';
      registeredSubscription?: RqsRegisteredSubscription | null;
    }>
  | Readonly<{
      transport?: 'poll';
      registeredSubscription?: null;
    }>;

export interface StartedLiveQueryHandle<Rows> {
  readonly current: LiveQueryHandle<Rows> | null;
  started(): Promise<void>;
  dispose(): void;
  settled(): Promise<void>;
}

export interface ReactBindingMismatchDiagnostic {
  readonly schemaVersion: string;
  readonly code: 'SNAPBACK_REACT_BINDING_MISMATCH';
  readonly severity: 'error';
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type ReactBindingDevelopmentSyncState =
  | Readonly<{
      readonly status: 'waiting';
      readonly message: 'Updating local backend…';
      readonly attempt: number;
      readonly elapsedMs: number;
      readonly diagnostic: ReactBindingMismatchDiagnostic;
    }>
  | Readonly<{
      readonly status: 'ready';
      readonly message: 'Local backend updated.';
      readonly attempt: number;
      readonly elapsedMs: number;
      readonly diagnostic: null;
    }>
  | Readonly<{
      readonly status: 'timed-out';
      readonly message: 'Client and local backend are still out of sync.';
      readonly attempt: number;
      readonly elapsedMs: number;
      readonly diagnostic: ReactBindingMismatchDiagnostic;
      readonly actions: readonly string[];
    }>;

export interface ReactBindingDevelopmentSyncOptions {
  /** Bounded local-dev retry window. Defaults to 10,000 ms; maximum 60,000. */
  readonly timeoutMs?: number;
  /** Delay between complete admission attempts. Defaults to 250 ms; maximum 5,000. */
  readonly pollIntervalMs?: number;
  /** Observational UI projection. Exceptions from the callback are ignored. */
  readonly onStateChange?: (state: ReactBindingDevelopmentSyncState) => void;
}

export interface PreparedReactBinding {
  readonly appId: string;
  readonly profile: string;
  readonly deploymentIdentity: Readonly<{
    targetProfileId: string;
    target: string;
    schemaHash: string | null;
    bundleHash: string;
    inputsHash: string | null;
  }>;
  /** Preparation provenance: 'deployment' when the live inspection admitted
   * the manifest; 'persisted-receipt' when a connectivity failure fell back
   * to the digest-bound offline binding receipt (LLP 0114 dated amendment). */
  readonly source: 'deployment' | 'persisted-receipt';
  readonly authMode: AuthMode | null;
  readonly routeManifestHash: string;
  readonly registeredBundleAvailable: boolean;
  readonly functionCatalogDigest: string;
  readonly capabilityDigest: string | null;
  readonly references: Readonly<Record<string, SnapbackFunctionReference>>;
  readonly ephemeral: Readonly<Record<string, SnapbackEphemeralReference>>;
  readonly groups: Readonly<Record<string, SnapbackQueryGroupReference>>;
  readonly assetIntents: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly commands: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly surfaces: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  prepareQueryGroup<Ref extends SnapbackQueryGroupReference>(
    reference: Ref,
    params: QueryGroupParams<Ref>,
    options?: {
      readonly fallbackToLive?: boolean;
      readonly userId?: string;
    },
  ): Promise<PreparedReactQueryGroup<Ref>>;
}

export interface PreparedReactQueryGroup<
  Ref extends SnapbackQueryGroupReference = SnapbackQueryGroupReference,
> {
  readonly artifactKind: 'preparedReactQueryGroup';
  readonly source: 'registered-bundle' | 'live-fallback' | 'live-recovery';
  readonly reason?:
    | 'registered_bundle_boot_v1-unavailable'
    | 'attach-deadline-expired'
    | 'unadopted-delta'
    | 'authority-replaced';
  readonly reference: Ref;
  readonly params: QueryGroupParams<Ref>;
  readonly boot: null | Readonly<{
    source: 'registered-bundle';
    commitVersion: number;
    generation: string;
    versionStream: string;
    attachDeadline: number;
  }>;
  readonly entries: readonly Readonly<{
    name: string;
    ref: SnapbackFunctionReference<string, 'LiveQuery', unknown, unknown>;
    args: Readonly<Record<string, unknown>>;
  }>[];
  dispose(): Promise<void>;
}

export function prepareReactQueryGroupForBinding<
  Ref extends SnapbackQueryGroupReference,
>(
  binding: PreparedReactBinding,
  reference: Ref,
  params: QueryGroupParams<Ref>,
  options?: {
    readonly fallbackToLive?: boolean;
    readonly userId?: string;
  },
): Promise<PreparedReactQueryGroup<Ref>>;
export function consumePreparedReactQueryGroup<
  Ref extends SnapbackQueryGroupReference,
>(
  binding: PreparedReactBinding,
  value: PreparedReactQueryGroup<Ref>,
): PreparedReactQueryGroup<Ref>;
export function abandonConsumedReactQueryGroup(
  value: PreparedReactQueryGroup,
): Promise<void>;

export interface EphemeralEntry<Value> {
  readonly key: string;
  readonly value: Value;
  readonly expiresAtMs: number;
  readonly receivedAtMs: number;
  readonly scopeEpoch: number;
  readonly entryVersion: number;
}

export type EphemeralRoomSnapshot<Value> =
  | Readonly<{
      status: 'pending' | 'resyncing';
      entries: readonly [];
      selfKey: null;
      diagnostic: null;
      connection: string;
      reason: string | null;
    }>
  | Readonly<{
      status: 'ready' | 'stale';
      entries: readonly EphemeralEntry<Value>[];
      selfKey: string;
      diagnostic: null;
      connection: string;
      reason: string | null;
    }>
  | Readonly<{
      status: 'error' | 'unsupported';
      entries: readonly [];
      selfKey: null;
      diagnostic: Readonly<Record<string, unknown>>;
      connection: string;
      reason: string | null;
    }>;

export interface EphemeralRoomHandle<Value> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): EphemeralRoomSnapshot<Value>;
  getServerSnapshot(): EphemeralRoomSnapshot<Value>;
  readonly grantedConnectionId: string | null;
  started(): Promise<void>;
  publish(value: Value, options?: { readonly ttlMs?: number }): Promise<EphemeralPublishOutcome>;
  delete(options?: EphemeralWithdrawalOptions): Promise<EphemeralDeleteSettlement | unknown>;
  dispose(): void;
  settled(): Promise<void>;
  inspection(): Readonly<Record<string, unknown>>;
}

export class EphemeralOverlay<Scope = Record<string, unknown>, Value = unknown> {
  readonly scope: Scope;
  readonly terminalDiagnostic: SnapbackDiagnostic | null;
  onChange(
    listener: (result: string, overlay: EphemeralOverlay<Scope, Value>) => void,
  ): () => void;
  publish(value: Value, options?: { ttlMs?: number; connectionId?: string }): Promise<EphemeralPublishOutcome>;
  delete(options?: { connectionId?: string } & EphemeralWithdrawalOptions): Promise<EphemeralDeleteSettlement | unknown>;
  drain(): Promise<unknown>;
  currentEntries(options?: { prune?: boolean }): EphemeralEntry<Value>[];
  dispose(): void;
}

export interface EphemeralPublishOutcome {
  readonly scope_epoch: number;
  readonly entry_version: number;
  readonly [member: string]: unknown;
}

export interface EphemeralWithdrawalOptions {
  readonly expectedScopeEpoch?: number | null;
  readonly expectedEntryVersion?: number | null;
  readonly authorityCapture?: unknown;
}

export type EphemeralDeleteSettlement = Readonly<{
  readonly status: 'deleted' | 'absent' | 'superseded';
  readonly message?: unknown;
  readonly expectedScopeEpoch?: number;
  readonly expectedEntryGeneration?: number;
  readonly actualScopeEpoch?: number;
  readonly actualEntryGeneration?: number;
}>;

export interface SnapbackClientOptions {
  readonly adminToken?: string | null;
  /** Dev-only custody capability for client-asserted identity requests. */
  readonly devIdentityCapability?: string | null;
  readonly bearerToken?: string | null;
  /**
   * `'anonymous-public'` sends the auth-client protocol offer with no
   * credential so headless consumers can read `auth: 'public'` operations
   * from a sessions server. Mutually exclusive with browser, agent, and
   * external-bearer custody. Auth-required operations receive the server's
   * ordinary anonymous refusal.
   */
  readonly custody?: 'anonymous-public' | null;
  readonly authClientProtocol?: number | null;
  /**
   * Authorization-invalidation capability advertisement. Defaults to `1`
   * because SnapbackClient implements the v1 invalidation state machine.
   * Pass `null` only as an embedded-integration escape hatch for a legacy
   * server; auth-scoped live work is then intentionally unavailable.
   */
  readonly authInvalidationProtocol?: 1 | null;
  readonly authorityDescriptorProtocol?: number | null;
  readonly authorizedLeaseProtocol?: number | null;
  readonly ephemeralAuthorityProtocol?: number | null;
  readonly ephemeralExpiryProtocol?: number | null;
  readonly authCoordinator?: AuthCoordinator | null;
  readonly agentAuthority?: unknown;
  readonly senderConstrained?: boolean;
  readonly clientStoreId?: string;
  readonly authCounterCeiling?: number;
  readonly rqsStore?: unknown;
  /**
   * LLP 0043 M2 queued-intent outbox (LLP 0129 Phase 0). 'auto' (default)
   * queues connectivity-refused mutations durably when the resolved store
   * carries the outbox contract; false disables; true requires support.
   * A generated local-executable mutation composes with the durable outbox when
   * available and otherwise degrades to server-delegated online dispatch (LLP
   * 0155 local-read admission); explicit `queue: true` still requires the outbox.
   * A queued delivery resolves
   * `{ status: 'queued', clientMutationId, sequence, presentation }` instead of
   * a settlement; it settles by ordered replay after reconnect.
   */
  readonly offlineQueue?: 'auto' | boolean;
  /** Automatic (default) owns one safety-gated drain lifecycle from client
   * readiness through close(). Manual keeps the controller and diagnostics but
   * schedules cycles only through drainNow()/replayQueuedMutations(). */
  readonly outboxDrain?: 'auto' | 'manual';
  /** LLP 0218 P4 relinquishment-event seam. When omitted, events land on
   * this client's LLP 0219 structured diagnostics channel; injecting an
   * observer redirects them (tests/tooling). */
  readonly devDiagnosticsChannel?: Readonly<{
    emit?(event: Readonly<Record<string, unknown>>): void;
  }> | null;
  /** Enable the default console reporter when (and only when) the shared
   * positive development-environment seam returns true. Defaults to true;
   * false detaches console reporting while preserving the structured channel. */
  readonly devDiagnosticsReporter?: boolean;
  /** Per-durable-head warning window for the queued/wedged dev condition. */
  readonly queuedMutationWedgeWarningMs?: number;
  readonly strictWireVersion?: boolean;
  readonly onWireVersionDiagnostic?: ((diagnostic: unknown) => void) | null;
}

/** DK-9 degradation fact: which persistence store the client resolved. */
export interface RqsStoreInfo {
  readonly source: 'default' | 'injected' | 'disabled';
  readonly implementation: string | null;
  readonly durable: boolean | null;
  readonly reason: string | null;
}

/** Latest answered target-capability discovery scheduled by ordinary client
 * read lifecycle. `null` means no lifecycle observation has been scheduled. */
export interface OfflineMutationReplayCapabilityDiscovery {
  readonly supported: boolean;
  readonly reason: string | null;
  readonly targetProfileId: string | null;
  readonly evidence: 'fresh' | 'configured' | 'cached' | null;
}

/** Outcome of one LLP 0043 M2 ordered outbox drain. */
export interface OutboxReplayOutcome {
  readonly replayed: number;
  readonly failed: number;
  readonly stranded: number;
  readonly quarantined: number;
  readonly remaining: number;
  readonly stopped?: boolean;
}

export interface OutboxFreshSnapshotBarrierV1 {
  readonly schemaVersion: 'snapback.outbox-fresh-snapshot-barrier.v1';
  readonly status: 'passed';
  readonly kind: 'full-snapshot';
}

export interface OutboxDispositionCounts {
  readonly pending: number;
  readonly failed: number;
  readonly stranded: number;
  readonly quarantined: number;
  readonly resultGone: number;
}

/** Checked receipt for an explicit cross-origin sidecar store handoff. The
 * global default store remains per-origin; only a caller-injected durable
 * store can enter this path. */
export interface OutboxAdoptionReceipt {
  readonly schemaVersion: 'snapback.outbox-adoption.v1';
  readonly candidateOrigin: string;
  readonly clientStoreId: string;
  readonly writer: true;
  readonly freshSnapshotBarrier: OutboxFreshSnapshotBarrierV1;
  readonly artifactGeneration: ArtifactGeneration;
  readonly before: OutboxDispositionCounts;
  readonly after: OutboxDispositionCounts;
  readonly pendingBefore: number;
  readonly replayed: number;
  readonly failedDelta: number;
  readonly strandedDelta: number;
  readonly quarantinedDelta: number;
  readonly resultGoneDelta: number;
  readonly remaining: number;
  readonly stopped: boolean;
}

/** Stable LLP 0081 payload-free observation of one held mutation. The durable
 * client store privately retains the intent for explicit successor re-entry. */
export interface QuarantinedMutationTombstone {
  readonly format: 'snapback.outbox-quarantine-tombstone.v1';
  readonly status: 'quarantined';
  readonly id: string;
  readonly clientMutationId: string;
  readonly function: string;
  readonly sequence: number;
  readonly quarantinedAt: number;
  readonly refusalCode: string;
  readonly quarantineDisposition:
    | 'upgrade-required-refusal'
    | 'dependent'
    | 'compatibility-unclassified';
  readonly causeClientMutationId: string;
  readonly provenance: Readonly<{
    readonly source: 'server-replay-refusal';
    readonly payload: 'redacted';
  }>;
}

export interface QuarantinedMutationReentryOutcome {
  readonly reentered: number;
  readonly clientMutationIds: readonly string[];
}

export interface OutboxPrincipalScope {
  readonly authMode: string;
  readonly authorizationStreamIncarnation: string;
  readonly userId: string | null;
}

/** Full-byte rerecordable custody outcome owned by the current principal.
 * Credential, sender, token/carrier, and lease material is never present. */
export interface StrandedMutation {
  readonly status: 'stranded';
  readonly id: string;
  readonly clientMutationId: string;
  readonly function: string;
  readonly args: unknown;
  readonly sequence: number;
  readonly reason: 'authority_instance_changed' | 'server_authority_stale_result' | string;
  readonly strandedAt: number;
  readonly predecessorPrincipalScope: OutboxPrincipalScope;
  readonly replayable: false;
  readonly rerecordable: true;
  readonly [key: string]: unknown;
}

export interface StrandedMutationDiscardOutcome {
  readonly discarded: number;
  readonly clientMutationIds: readonly string[];
}

export interface ResultGoneAcknowledgementOutcome {
  readonly acknowledged: number;
  readonly clientMutationIds: readonly string[];
}

export type OutboxDrainPhase =
  | 'idle'
  | 'waiting-barrier'
  | 'replaying'
  | 'backoff'
  | 'paused';

export interface OutboxDrainControllerStatus {
  readonly running: boolean;
  readonly automatic: boolean;
  readonly drainPhase: OutboxDrainPhase;
  readonly lastAttemptAtMs: number | null;
  readonly nextRetryAtMs: number | null;
  readonly blockedReason: string | null;
}

export interface OutboxDrainController {
  /** Request one safety-gated cycle and join its single-flight outcome. */
  drainNow(): Promise<OutboxReplayOutcome>;
  /** Remove timers/listeners and release this store's controller slot. */
  stop(): void;
  /** Cheap process-local drain state; durable counts remain on outboxStatus. */
  status(): OutboxDrainControllerStatus;
}

export interface OutboxDrainOptions {
  /** False keeps the safety controller but schedules cycles only via drainNow. */
  readonly automatic?: boolean;
  /** Host/test scheduler injection; retry bounds remain implementation-owned. */
  readonly timer?: Readonly<{
    setTimeout?(callback: () => void, delayMs: number): unknown;
    clearTimeout?(handle: unknown): void;
    now?(): number;
    random?(): number;
  }>;
  /** Browser-like source for the restored-connectivity `online` event. */
  readonly eventTarget?: Readonly<{
    addEventListener(type: 'online', listener: () => void): void;
    removeEventListener(type: 'online', listener: () => void): void;
  }> | null;
}

/** Live outbox facts (pure projection of the durable store's records plus
 * the single-flight drain flag). `supported: false` means this client
 * resolved no outbox-capable store. */
export interface OutboxStatus {
  readonly supported: boolean;
  readonly pending: number;
  readonly failed: number;
  /** Same-principal predecessor intents held across an authority-instance cut. */
  readonly stranded: number;
  /** Upgrade-incompatible intents held for explicit successor re-entry. */
  readonly quarantined: number;
  /** Outcome-known operations whose retained result payload is gone. These
   * are not replayable failures and keep ordered successors fenced. */
  readonly resultGone: number;
  readonly replaying: boolean;
  /** Effective process-local lifecycle scheduling mode for this store. */
  readonly drainMode: 'auto' | 'manual' | 'none';
  readonly oldestPendingAtMs: number | null;
  readonly drainPhase: OutboxDrainPhase;
  readonly lastAttemptAtMs: number | null;
  readonly nextRetryAtMs: number | null;
  readonly blockedReason: string | null;
}

/** Terminal-auth fact (0137 A6 f3): pure projection of the client's own
 * terminal custody cut. `terminated: true` means this client's current
 * authority is permanently done (for example SNAPBACK_AUTH_STREAM_RESET
 * after a receipted reset-install) — retries will not reconnect; rebuild
 * the session. Cleared by an explicit custody replacement. */
export interface AuthTerminalStatus {
  readonly terminated: boolean;
  readonly code: string | null;
  readonly authorityDisposition: 'carrier' | 'durableDelete' | null;
  readonly atMs: number | null;
}

export type AuthMode = 'dev' | 'sessions';
export type ExpectedDataVersionStreamV1 =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly value: string };
export interface SeedArtifactV1 {
  readonly formatVersion: 'snapback.seed.v1';
  readonly appId: string;
  readonly seedVersion: string;
  readonly seedDigest: string;
  readonly tables: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}
export interface ActiveSeedIdentityV1 {
  readonly appId: string;
  readonly seedVersion: string;
  readonly seedDigest: string;
  readonly dataVersionStream: string;
  readonly schemaHash: string;
  readonly directApplicationRows: number;
  readonly derivedProjectionRows: number;
  readonly totalApplicationEffects: number;
}
interface SeedReceiptBaseV1 {
  readonly formatVersion: 'snapback.seed.receipt.v1';
  readonly operationId: string;
  readonly requestDigest: string;
  readonly appId: string;
  readonly schemaHash: string;
  readonly dataVersionStream: string;
  readonly directApplicationRows: number;
  readonly derivedProjectionRows: number;
  readonly totalApplicationEffects: number;
  readonly resetDeletedRows: number;
}
export type SeedInstallReceiptV1 =
  | Readonly<SeedReceiptBaseV1 & {
      readonly operation: 'install';
      readonly outcome: 'installed';
      readonly seedVersion: string;
      readonly seedDigest: string;
    }>
  | Readonly<SeedReceiptBaseV1 & {
      readonly operation: 'reset-install';
      readonly outcome: 'reset-installed';
      readonly seedVersion: string;
      readonly seedDigest: string;
    }>
  | Readonly<SeedReceiptBaseV1 & {
      readonly operation: 'clear';
      readonly outcome: 'cleared';
      readonly seedVersion?: never;
      readonly seedDigest?: never;
    }>;
export interface SeedMatchedObservationV1 {
  readonly formatVersion: 'snapback.seed.matched-observation.v1';
  readonly outcome: 'matched';
  readonly active: ActiveSeedIdentityV1;
  readonly establishingReceipt: Extract<
    SeedInstallReceiptV1,
    { readonly operation: 'install' | 'reset-install' }
  >;
}
export type SeedEnsureResultV1 =
  | Readonly<{
      readonly state: 'installed';
      readonly receipt: Extract<SeedInstallReceiptV1, { readonly operation: 'install' }>;
    }>
  | Readonly<{
      readonly state: 'matched';
      readonly observation: SeedMatchedObservationV1;
    }>;
interface SeedPreviewCountsV1 {
  readonly current?: ActiveSeedIdentityV1;
  readonly requested?: ActiveSeedIdentityV1;
  readonly directApplicationRows: number;
  readonly derivedProjectionRows: number;
  readonly totalApplicationEffects: number;
  readonly resetDeletedRows: number;
}
export type SeedPreviewResultV1 =
  | Readonly<SeedPreviewCountsV1 & {
      readonly state: 'installable' | 'matched' | 'reset-installable' | 'clearable';
      readonly diagnosticCode?: never;
    }>
  | Readonly<SeedPreviewCountsV1 & {
      readonly state: 'refused';
      readonly diagnosticCode:
        | 'SNAPBACK_SEED_VERSION_REUSED'
        | 'SNAPBACK_SEED_MIGRATION_REQUIRED'
        | 'SNAPBACK_SEED_NONEMPTY_UNTRACKED'
        | 'SNAPBACK_SEED_PARTIAL_UNTRACKED'
        | 'SNAPBACK_SEED_OPERATION_HISTORICAL'
        | 'SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED';
    }>;
export declare function newSeedOperationIdV1(nowMs?: number): string;

type FunctionRef<
  Kind extends SnapbackOperationKind,
  Args = unknown,
  Result = unknown,
> = string | SnapbackFunctionReference<string, Kind, Args, Result>;
type NamedReference = string;

export interface SnapbackLiveManagerInspection {
  readonly connectionId: string;
  readonly ownershipTuple: SnapbackOwnershipTupleInspection;
  readonly open: boolean;
  readonly closed: boolean;
  readonly socketDemand: number;
  readonly durableListeners: number;
  readonly ephemeralListeners: number;
  readonly stateListeners: number;
  readonly readinessListeners: number;
  readonly pendingRequests: number;
  readonly reconnectTimer: number;
  readonly heartbeatTimer: number;
  readonly grantAgeMs: number | null;
}

export interface SnapbackOwnershipTupleInspection {
  readonly format: 'snapback.ownership-tuple-inspection.v1';
  /** Stable inspection pseudonym; the raw app id remains in the internal key. */
  readonly canonicalAppId: string | null;
  /** Stable inspection pseudonym; the raw partition remains in the internal key. */
  readonly storagePartition: string;
  readonly serverInstance: 'self';
  readonly authorityClass: string;
}

export interface SnapbackRuntimeCostDiagnosticsInspection {
  readonly enabled: boolean;
  readonly keyCapacity: number;
  readonly equivalentEnqueues: Readonly<{
    facts: readonly Readonly<{
      functionId: string;
      canonicalInputHash: `sha256:${string}`;
      enqueueCount: number;
      equivalentEnqueueCount: number;
    }>[];
    otherKeys: Readonly<{ enqueueCount: number; equivalentEnqueueCount: number }>;
    evictedKeys: number;
  }>;
  readonly housekeepingSupersessions: Readonly<{
    facts: readonly Readonly<{ functionId: string; supersededCount: number }>[];
    otherKeys: Readonly<{ supersededCount: number }>;
    evictedKeys: number;
  }>;
  readonly duplicateSubscriptions: Readonly<{
    facts: readonly Readonly<{
      functionId: string;
      canonicalInputHash: `sha256:${string}`;
      ownershipTupleHash: `sha256:${string}`;
      count: number;
      ownerLabels: readonly string[];
    }>[];
    otherKeys: Readonly<{ registrationCount: number }>;
    evictedKeys: number;
  }>;
  readonly assetIssuanceMultiplicity: Readonly<{
    facts: readonly Readonly<{
      assetIdentity: string;
      ownerLabel: string;
      issuanceCount: number;
    }>[];
    otherKeys: Readonly<{ issuanceCount: number }>;
    evictedKeys: number;
  }>;
}

export declare function projectOwnershipTupleInspectionV1(input: Readonly<{
  readonly canonicalAppId?: string | null;
  readonly storagePartition: string;
  readonly settledAuthority?: Readonly<{ state?: string; settled?: boolean }> | null;
}>): SnapbackOwnershipTupleInspection;

export type PendingDeliveryReasonV1 =
  | 'terminal-quarantine'
  | 'auth-barrier'
  | 'custody-unsettled'
  | 'authority-unavailable'
  | 'transport-recovery'
  | 'server-pending';

export type PendingDeliveryOutcomeClassV1 =
  | 'reason'
  | 'neutral'
  | 'snapshot-skew'
  | 'defect';

export interface PendingDeliveryOutcomeV1 {
  readonly outcome: PendingDeliveryOutcomeClassV1;
  readonly pendingDeliveryReason: PendingDeliveryReasonV1 | null;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface PendingDeliveryInspectionRowV1 extends PendingDeliveryOutcomeV1 {
  readonly format: 'snapback.pending-delivery-inspection-row.v1';
  /** Null only for the unconditional ordinary initial-PENDING lifecycle row. */
  readonly subscriptionId: string | null;
  readonly functionId: string | null;
  readonly serverRegistry: Readonly<Record<string, unknown>> | null;
  readonly wave: Readonly<Record<string, unknown>> | null;
}

export interface PendingDeliveryInspectionV1 {
  readonly format: 'snapback.pending-delivery-inspection.v1';
  readonly subscriptions: readonly PendingDeliveryInspectionRowV1[];
}

export declare function derivePendingDeliveryOutcomeV1(
  clientRow: Readonly<Record<string, unknown>> | null,
  serverRow: Readonly<Record<string, unknown>> | null,
): PendingDeliveryOutcomeV1;

export declare function joinPendingDeliveryInspectionV1(
  clientSnapshot: Readonly<Record<string, unknown>>,
  serverSnapshot: Readonly<Record<string, unknown>>,
  options?: Readonly<{ previous?: PendingDeliveryInspectionV1 | null }>,
): PendingDeliveryInspectionV1;

export interface SnapbackLocalResourceInspection {
  readonly managers: readonly SnapbackLiveManagerInspection[];
  readonly managerCount: number;
  readonly grants: readonly string[];
  readonly ownershipTuple: SnapbackOwnershipTupleInspection;
  readonly outboxSuspensionReason: string | null;
  readonly grantCount: number;
  readonly laneConsumers: readonly Readonly<{
    connectionId: string;
    durable: number;
    ephemeral: number;
  }>[];
  readonly subscriptions: readonly Readonly<{
    owner: string;
    connectionId: string;
    subscriptionId: string | null;
    functionName: string;
    state: 'active' | 'paused';
    subscriptionState: string;
    connection: string;
    connectionState: string;
    supersedesSubscriptionId: string | null;
    snapshotVersion: number;
    lastDeliveryAtMs: number | null;
    authoritativeRevision: number;
    deliveryLagMs: number | null;
    suppressedEqualSnapshots: number;
    terminalCode: string | null;
    ownershipTuple: SnapbackOwnershipTupleInspection;
    authBarrier: string | null;
    readiness: 'ready' | 'waiting';
    outboxSuspensionReason: string | null;
  }>[];
  readonly mutationPhaseCosts: MutationPhaseCostInspectionV1;
  readonly subscriptionCount: number;
  readonly runtimeCostDiagnostics: SnapbackRuntimeCostDiagnosticsInspection;
  readonly socketDemand: number;
  readonly timers: number;
  readonly listeners: number;
}

export interface StorePolicyInspectionV1 extends Readonly<Record<string, unknown>> {
  readonly format: 'snapback.store-policy-inspection.v1';
  readonly clientStoreId: string;
  readonly authorityPartitionDigest: `sha256:${string}`;
  readonly budgets: readonly Readonly<Record<string, unknown>>[];
  readonly registrations: Readonly<Record<string, number>>;
  readonly broker: Readonly<{
    writerGeneration: number;
    liveContextCount: number;
    livePairCount: number;
    suppressionActive: boolean;
    [key: string]: unknown;
  }>;
  readonly constants: Readonly<Record<string, number>>;
  readonly addresses: readonly Readonly<Record<string, unknown>>[];
}

export type QueryRegistrationScopeV1 =
  | Readonly<{
      readonly kind: 'page';
      readonly input:
        | Readonly<{ readonly kind: 'first' }>
        | Readonly<{
            readonly kind: 'cursor';
            readonly profileId: string;
            readonly digest: `sha256:${string}`;
          }>;
    }>
  | Readonly<{
      readonly kind: 'page-set';
      readonly from: 'first';
      readonly through: 'terminal';
    }>;

export type RegisterOutcomeV1 = Readonly<{
  readonly format: 'snapback.register-outcome.v1';
  readonly contextId: string;
  readonly requestId: string;
  readonly outcome:
    | Readonly<{ readonly kind: 'committed' }>
    | Readonly<{ readonly kind: 'released' }>
    | Readonly<{ readonly kind: 'refused'; readonly code: string }>;
}>;

export interface ProgrammaticQueryRegistrationOptions<Args = Record<string, unknown>> {
  /** Stable, store-scoped identity owned by the application. Never reuse an
   * identity for a different query or arguments. */
  readonly registrationId: string;
  readonly args?: Args;
  readonly userId?: string;
  readonly label?: string | null;
  readonly requestedScope?: QueryRegistrationScopeV1;
  readonly retentionRequest?: 'none' | 'durable';
  readonly idleTtlClass?: 'none' | 'default' | 'pinned';
}

export class SnapbackClient {
  constructor(baseUrl: string, options?: SnapbackClientOptions);
  /** Normalized origin used by framework-neutral client extensions. */
  readonly baseUrl: string;
  /** Constructor-selected default outbox scheduling policy. */
  readonly outboxDrainPolicy: 'auto' | 'manual';
  /** LLP 0238 D6 namespaced projection; flat methods remain compatible. */
  readonly auth: SnapbackClientAuthNamespace;
  /** This client's bounded, process-local structured diagnostics channel. */
  diagnosticsChannel(): SnapbackClientDiagnosticsChannel;
  /** Final client cleanup; the preferred lifecycle spelling. */
  close(): Promise<void>;
  /** Final auth/client cleanup. Disposes the diagnostics channel and releases
   * a client-owned default RQS store; an injected store remains caller-owned.
   * Compatibility alias for close(). */
  closeAuth(): Promise<void>;
  authSession(options?: Readonly<{ readonly force?: boolean }>): Promise<AuthSessionProjectionV1>;
  authRequestCode(email: string): Promise<AuthChallengePublicProjectionV1>;
  authStepUpRequest(input: Readonly<{
    readonly operation: 'passwordSet';
  }>): Promise<AuthChallengePublicProjectionV1>;
  authExchange(input: Readonly<{
    readonly challengeId: string;
    readonly code: string;
  }>): Promise<AuthCredentialPublicProjectionV1>;
  authEnterAsGuest(): Promise<AuthCredentialPublicProjectionV1>;
  authClaimGuestWithPassword(input: Readonly<{
    readonly email: string;
    readonly password: string;
  }>): Promise<AuthRecoveryCredentialPublicProjectionV1>;
  authPasswordSignup(input: Readonly<{
    readonly email: string;
    readonly password: string;
  }>): Promise<AuthRecoveryCredentialPublicProjectionV1>;
  authPasswordSignIn(input: Readonly<{
    readonly email: string;
    readonly password: string;
  }>): Promise<AuthCredentialPublicProjectionV1>;
  authPasswordChange(input: Readonly<{
    readonly currentPassword: string;
    readonly newPassword: string;
  }>): Promise<AuthCredentialPublicProjectionV1>;
  authPasswordSet(input: Readonly<{
    readonly newPassword: string;
    readonly stepUp: AuthPasswordSetStepUpV1;
  }>): Promise<AuthRecoveryCredentialPublicProjectionV1>;
  authPasswordReset(input: Readonly<{
    readonly challengeId: string;
    readonly code: string;
    readonly newPassword: string;
  }>): Promise<AuthCredentialPublicProjectionV1>;
  authRecoveryConsume(input: Readonly<{
    readonly email: string;
    readonly code: string;
  }>): Promise<AuthRecoveryCredentialPublicProjectionV1>;
  authRecoveryRotate(): Promise<AuthRecoveryCredentialPublicProjectionV1>;
  authRefresh(options?: Readonly<{
    readonly senderChallengeRetry?: boolean;
  }>): Promise<AuthCredentialPublicProjectionV1 | Readonly<{ readonly superseded: true }>>;
  authLogout(): Promise<null>;
  /** Blessed identity read: principal scope plus the authority descriptor. */
  currentAuthorityDescriptor(): Promise<AuthorityDescriptorV1>;
  currentAuthorizationScope(options?: {
    readonly devUserId?: string | null;
  }): Promise<AuthorizationScopeV1>;
  registerAuthBarrierParticipant(
    participant: SnapbackAuthBarrierParticipant,
  ): () => Promise<void>;
  /** Same-token no-op; any other value throws — use `replaceBearerToken`. */
  setBearerToken(token: string | null): void;
  replaceBearerToken(token: string | null): Promise<void>;
  clearAuthSession(): void;
  replaceAgentCredential(
    credential: AgentAuthorityCredentialInput,
  ): Promise<AgentAuthorityCapture>;
  health(): Promise<unknown>;
  inspect(): Promise<unknown>;
  captureAuthority(): unknown;
  allocateLiveQueryNamespace(
    ref: NamedReference,
    args?: Readonly<Record<string, unknown>>,
  ): unknown;
  isAuthorityCaptureCurrent(capture: unknown): boolean;
  localResourceInspection(connectionIds?: Iterable<string> | null): SnapbackLocalResourceInspection;
  mutationPhaseCostInspection(): MutationPhaseCostInspectionV1;
  storePolicyInspection(input: Readonly<{
    authorityPartitionDigest: `sha256:${string}`;
  }>): Promise<StorePolicyInspectionV1>;
  /** Durably register a generated query in the registration-derived sync set.
   * Works from writer and qualified non-writer client contexts. */
  registerQuery<Ref extends SnapbackFunctionReference<string, 'LiveQuery', unknown, unknown>>(
    ref: Ref,
    options: ProgrammaticQueryRegistrationOptions<FunctionArgs<Ref>>,
  ): Promise<RegisterOutcomeV1>;
  /** Evaluate a reclassified generated query's proof-verified local result.
   * Unreclassified plans and non-claiming carriers retain the closed floor. */
  evaluateLocalResultTransform<
    Ref extends SnapbackFunctionReference<string, 'LiveQuery', unknown, unknown>,
  >(
    ref: Ref,
    options: Readonly<{
      readonly args?: FunctionArgs<Ref>;
      readonly userId?: string | null;
      readonly transformPlan: TransformPlanV1;
      readonly overlayLayers?: readonly ((
        rows: readonly ResultTransformRowV1[],
      ) => readonly ResultTransformRowV1[])[];
    }>,
  ): Promise<readonly ResultTransformRowV1[]>;
  /** Idempotently release a programmatic registration. */
  releaseQueryRegistration(
    registrationId: string,
    options?: Readonly<{ readonly userId?: string }>,
  ): Promise<RegisterOutcomeV1>;
  prepareReactBinding(options: {
    readonly generatedManifest:
      | SnapbackAppDescriptorV1
      | Readonly<Record<string, unknown>>
      | {
          readonly functions: Readonly<Record<string, unknown>>;
          readonly schema?: Readonly<Record<string, unknown>>;
          readonly capabilityManifest?: Readonly<Record<string, unknown>>;
          readonly routes?: Readonly<Record<string, unknown>>;
        };
    /** Automatic only after the live target proves the exact local-dev/dev
     * profile. `false` restores immediate mismatch refusal. */
    readonly developmentSync?: false | ReactBindingDevelopmentSyncOptions;
  }): Promise<PreparedReactBinding>;
  ensureApp(options?: {
    readonly schema?: unknown;
    readonly functions?: unknown;
    readonly seed?: unknown;
    readonly routes?: unknown;
    readonly intent?: 'provision' | null;
    readonly requestedMode?: 'dev' | 'sessions' | null;
  }): Promise<unknown>;
  ensureVersionedSeed(
    artifact: SeedArtifactV1,
    options?: { readonly operationId?: string; readonly requestedMode?: AuthMode },
  ): Promise<SeedEnsureResultV1>;
  previewVersionedSeed(
    artifact: SeedArtifactV1,
    options?: {
      readonly operation?: 'install';
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream?: never;
    },
  ): Promise<SeedPreviewResultV1>;
  previewVersionedSeed(
    artifact: SeedArtifactV1,
    options: {
      readonly operation: 'resetInstall';
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
    },
  ): Promise<SeedPreviewResultV1>;
  previewVersionedSeed(
    artifact: null,
    options: {
      readonly operation: 'clear';
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
    },
  ): Promise<SeedPreviewResultV1>;
  resetInstallVersionedSeed(
    artifact: SeedArtifactV1,
    options: {
      readonly operationId?: string;
      readonly requestedMode?: AuthMode;
      readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
    },
  ): Promise<Extract<SeedInstallReceiptV1, { readonly operation: 'reset-install' }>>;
  clearVersionedSeed(options: {
    readonly operationId?: string;
    readonly requestedMode?: AuthMode;
    readonly expectedDataVersionStream: ExpectedDataVersionStreamV1;
  }): Promise<Extract<SeedInstallReceiptV1, { readonly operation: 'clear' }>>;
  releaseConnection(
    connectionId: string,
    options?: {
      readonly attachDeadline?: number | null;
      readonly timeoutMs?: number;
      readonly ifIdle?: boolean;
    },
  ): Promise<Readonly<{
    released: boolean;
    attached?: boolean;
    reason?: 'not-owned' | 'shared-demand';
  }>>;
  fetchBundle(options: {
    readonly route: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly mode?: 'read' | 'register';
    readonly idempotencyKey?: string | null;
    readonly devManifestEntry?: unknown;
    readonly userId?: string;
    readonly authorityCapture?: unknown;
    readonly authorizationNamespaces?: readonly unknown[];
    readonly authInvalidationProtocol?: 1 | null;
  }): Promise<unknown>;
  query<Ref extends FunctionRef<'Query' | 'LiveQuery'>>(
    ref: Ref,
    options?: { readonly args?: FunctionArgs<Ref>; readonly userId?: string },
  ): Promise<QueryOutput<QueryWireResult<FunctionResult<Ref>>>>;
  query<Result = unknown>(
    ref: NamedReference,
    options?: { readonly args?: Record<string, unknown>; readonly userId?: string },
  ): Promise<QueryOutput<Result>>;
  /** Wait for the latest settlement-ledger capability observation scheduled
   * by a successful query or by a live handle becoming current. */
  whenOfflineMutationReplayCapabilitySettled(): Promise<
    OfflineMutationReplayCapabilityDiscovery | null
  >;
  search<Ref extends SnapbackFunctionReference<
    string,
    'Query',
    SearchRequestV1,
    SearchPageV1
  >>(
    ref: Ref,
    options: Omit<FunctionArgs<Ref>, keyof SearchRequestV1> & {
      readonly query: SearchQueryAstV1;
      readonly limit?: number;
      readonly after?: string;
      readonly userId?: string;
    },
  ): Promise<FunctionResult<Ref>>;
  vectorSearch<Ref extends SnapbackFunctionReference<
    string,
    'Query',
    VectorRequestV1,
    VectorPageV1
  >> (
    ref: Ref,
    options: FunctionArgs<Ref> & { readonly userId?: string },
  ): Promise<FunctionResult<Ref>>;
  /** Create the generated-IR presentation over durable outbox intent. Boot
   * replays retained operations before this promise resolves. */
  createOptimisticMutationView(options?: {
    readonly authoritativeRows?: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
    readonly connected?: boolean;
  }): Promise<OptimisticMutationView>;
  mutate<Ref extends FunctionRef<'Mutation'>>(
    ref: Ref,
    options?: {
      readonly args?: FunctionArgs<Ref>;
      readonly userId?: string;
      readonly clientMutationId?: string | null;
      readonly authorityDescriptor?: AuthorityDescriptorV1 | null;
      readonly settlementLane?: 'replay-accept' | 're-derive' | null;
      readonly settlementIdentity?: SettlementIdentityClaims | null;
      readonly settlementClaims?: SettlementClaimSet | null;
      readonly boundedSkew?: BoundedSkewDeclaration | null;
      readonly optimisticOperation?: Readonly<Record<string, unknown>> | null;
      readonly authorityCapture?: unknown;
      readonly queue?: 'auto' | boolean;
      readonly housekeeping?: Readonly<{
        readonly key: string;
        readonly idempotent: true;
        readonly successorValid: true;
      }> | null;
    },
  ): Promise<MutationDispatchOutcome<FunctionResult<Ref>>>;
  mutate<Result = unknown>(
    ref: NamedReference,
    options?: {
      readonly args?: Record<string, unknown>;
      readonly userId?: string;
      readonly clientMutationId?: string | null;
      readonly authorityDescriptor?: AuthorityDescriptorV1 | null;
      readonly settlementLane?: 'replay-accept' | 're-derive' | null;
      readonly settlementIdentity?: SettlementIdentityClaims | null;
      readonly settlementClaims?: SettlementClaimSet | null;
      readonly boundedSkew?: BoundedSkewDeclaration | null;
      readonly optimisticOperation?: Readonly<Record<string, unknown>> | null;
      readonly authorityCapture?: unknown;
      readonly queue?: 'auto' | boolean;
      readonly housekeeping?: Readonly<{
        readonly key: string;
        readonly idempotent: true;
        readonly successorValid: true;
      }> | null;
    },
  ): Promise<MutationDispatchOutcome<Result>>;
  /** The resolved persistence store's implementation/durability facts. */
  readonly rqsStoreInfo: RqsStoreInfo;
  /** Start or join the one safety-gated drain controller for this store. */
  startOutboxDrain(options?: OutboxDrainOptions): OutboxDrainController;
  /** Drain the durable outbox in sequence order (single-flight). */
  replayQueuedMutations(): Promise<OutboxReplayOutcome>;
  /** Explicit sidecar-only handoff of one caller-owned durable store across a
   * transport-origin change. Requires an app-owned full-snapshot barrier,
   * exact artifact generation, store identity, and writer custody. */
  adoptQueuedMutations(options: {
    readonly expectedClientStoreId: string;
    readonly expectedGeneration: ArtifactGeneration;
    readonly afterFreshSnapshot: () =>
      | OutboxFreshSnapshotBarrierV1
      | Promise<OutboxFreshSnapshotBarrierV1>;
  }): Promise<OutboxAdoptionReceipt>;
  /** Payload-free tombstones for upgrade-incompatible queued intents. */
  quarantinedMutations(): Promise<readonly QuarantinedMutationTombstone[]>;
  /** Explicitly return the whole quarantine to pending after successor
   * artifact admission. This first cut does no per-intent transformation. */
  reenterQuarantinedMutations(): Promise<QuarantinedMutationReentryOutcome>;
  /** Current-principal, full-byte intents stranded by an authority change. */
  strandedMutations(): Promise<readonly StrandedMutation[]>;
  /** Explicitly discard current-principal stranded intent. */
  discardStrandedMutations(
    clientMutationIds: readonly string[],
  ): Promise<StrandedMutationDiscardOutcome>;
  /** Discard one predecessor and issue it as a new intent/new mutation id. */
  reRecordStrandedMutation(
    clientMutationId: string,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<string>;
  /** Complete settlements recoverable after a crash before caller publication. */
  settledMutations(options?: { readonly userId?: string | null }): Promise<readonly SettledMutation[]>;
  /** Make recovered settlements eligible for same-authority ACK piggyback. */
  markMutationSettlementsConsumed(
    clientMutationIds: readonly string[],
    options?: { readonly userId?: string | null },
  ): Promise<number>;
  /** Send a standalone authority-bound settlement acknowledgement. */
  acknowledgeMutations(options: {
    readonly userId?: string;
    readonly clientMutationIds?: readonly string[];
    readonly authorityDescriptor?: AuthorityDescriptorV1 | null;
    readonly authorityCapture?: unknown;
  }): Promise<unknown>;
  /** Live queued-intent facts for UI projection (LLP 0114 React arm). */
  outboxStatus(): Promise<OutboxStatus>;
  /** Non-consuming durable disposition for one mutation identity. */
  mutationStatus(clientMutationId: string): Promise<MutationDisposition>;
  /** Delivers the current durable disposition asynchronously, then changes. */
  subscribeMutation(
    clientMutationId: string,
    listener: (disposition: MutationDisposition) => void,
  ): () => void;
  /** Release result-gone ordered-successor fences after payload-free
   * application acknowledgement; never replays or re-records the operation. */
  acknowledgeResultGoneMutations(
    clientMutationIds: readonly string[],
  ): Promise<ResultGoneAcknowledgementOutcome>;
  /** Fires after every outbox transition (queue/replay/settle-failure) and
   * around each drain; returns the unsubscribe. Listeners observe only. */
  subscribeOutbox(listener: () => void): () => void;
  /** Terminal-auth fact: is this client's current authority permanently
   * done? Synchronous pure projection; see AuthTerminalStatus. */
  authTerminalStatus(): AuthTerminalStatus;
  /** Fires after a terminal-auth fact is recorded, escalated, or cleared by
   * a custody replacement; returns the unsubscribe. Listeners observe via
   * authTerminalStatus() and never own auth state. */
  subscribeAuthTerminal(listener: () => void): () => void;
  /** Phase-9 settled-authority readiness consumed by provider adapters. */
  authorityTransitionStatus(): SnapbackAuthorityTransitionStatus;
  subscribeAuthorityTransition(
    listener: (status: SnapbackAuthorityTransitionStatus) => void,
  ): () => void;
  /** Structured LLP 0043 M2 queue/replay diagnostics (bounded ring). */
  readonly outboxDiagnostics: readonly Record<string, unknown>[];
  action<Ref extends FunctionRef<'Action'>>(
    ref: Ref,
    options?: { readonly args?: FunctionArgs<Ref>; readonly userId?: string },
  ): Promise<ActionOutput<FunctionResult<Ref>>>;
  action<Result = unknown>(
    ref: NamedReference,
    options?: { readonly args?: Record<string, unknown>; readonly userId?: string },
  ): Promise<ActionOutput<Result>>;
  /** Primary one-shot action verb. Returns the typed result and throws
   * SnapbackDiagnosticError for application, protocol, or transport refusal. */
  run<Ref extends FunctionRef<'Action'>>(
    ref: Ref,
    options?: { readonly args?: FunctionArgs<Ref>; readonly userId?: string },
  ): Promise<FunctionResult<Ref>>;
  run<Result = unknown>(
    ref: NamedReference,
    options?: { readonly args?: Record<string, unknown>; readonly userId?: string },
  ): Promise<Result>;
  liveQuery<Ref extends FunctionRef<'Query' | 'LiveQuery'>>(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly args?: FunctionArgs<Ref>;
      readonly userId?: string;
      readonly pollCadenceMs?: number;
      readonly fallbackToPoll?: boolean;
      readonly ownerLabel?: string | null;
      readonly onUpdate?: (rows: LiveQueryConsumerResult<Ref>) => void;
      readonly onConnectionChange?: (
        connection: LiveQueryHandle<LiveQueryConsumerResult<Ref>>['connection'],
        detail?: { readonly error?: unknown },
      ) => void;
    } & LiveQueryRegistrationOptions,
  ): Promise<LiveQueryHandle<LiveQueryConsumerResult<Ref>>>;
  liveQuery<Row = unknown>(
    ref: NamedReference,
    options: {
      readonly connectionId: string;
      readonly args?: Record<string, unknown>;
      readonly userId?: string;
      readonly pollCadenceMs?: number;
      readonly fallbackToPoll?: boolean;
      readonly ownerLabel?: string | null;
      readonly onUpdate?: (rows: Row[]) => void;
      readonly onConnectionChange?: (
        connection: LiveQueryHandle<Row[]>['connection'],
        detail?: { readonly error?: unknown },
      ) => void;
    } & LiveQueryRegistrationOptions,
  ): Promise<LiveQueryHandle<Row[]>>;
  startLiveQuery<Ref extends FunctionRef<'LiveQuery'>>(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly args?: FunctionArgs<Ref>;
      readonly userId?: string;
      readonly pollCadenceMs?: number;
      readonly fallbackToPoll?: boolean;
      readonly ownerLabel?: string | null;
      readonly supersedes?: StartedLiveQueryHandle<LiveQueryConsumerResult<Ref>> | null;
      readonly onUpdate?: (rows: LiveQueryConsumerResult<Ref>) => void;
      readonly onConnectionChange?: (
        connection: LiveQueryHandle<LiveQueryConsumerResult<Ref>>['connection'],
        detail?: { readonly error?: unknown },
      ) => void;
    } & LiveQueryRegistrationOptions,
  ): StartedLiveQueryHandle<LiveQueryConsumerResult<Ref>>;
  subscribeLive<Ref extends FunctionRef<'LiveQuery'>>(
    ref: Ref,
    options?: {
      readonly connectionId?: string;
      readonly args?: FunctionArgs<Ref>;
      readonly userId?: string;
      readonly correlation?: unknown;
      readonly supersedes?: unknown;
      readonly authorizationNamespace?: string | null;
      readonly authorityCapture?: unknown;
      readonly resumeFromToken?: string | null;
    },
  ): Promise<EphemeralPublishOutcome>;
  unsubscribeLive<Ref extends FunctionRef<'LiveQuery'>>(
    ref: Ref,
    options?: {
      readonly subscriptionId?: string;
      readonly connectionId?: string;
      readonly userId?: string;
      readonly authorityCapture?: unknown;
    },
  ): Promise<unknown>;
  subscribeEphemeral<
    Ref extends string | SnapbackEphemeralReference<string, unknown, unknown>,
  >(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly scope?: EphemeralScope<Ref>;
      readonly userId?: string;
      readonly permissions?: readonly string[];
    },
  ): Promise<EphemeralOverlay<EphemeralScope<Ref>, EphemeralValue<Ref>>>;
  unsubscribeEphemeral<
    Ref extends string | SnapbackEphemeralReference<string, unknown, unknown>,
  >(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly scope?: EphemeralScope<Ref>;
      readonly userId?: string;
      readonly permissions?: readonly string[];
    },
  ): Promise<unknown>;
  registerEphemeralRepublisher<
    Ref extends string | SnapbackEphemeralReference<string, unknown, unknown>,
  >(
    ref: Ref,
    callback: (context: Readonly<{
      collection: string;
      scope: EphemeralScope<Ref>;
      publish(
        value: EphemeralValue<Ref>,
        options?: Readonly<Record<string, unknown>>,
      ): Promise<unknown>;
    }>) => void | EphemeralValue<Ref> | Promise<void | EphemeralValue<Ref>>,
  ): Readonly<{ dispose(): void }>;
  publishEphemeral<
    Ref extends string | SnapbackEphemeralReference<string, unknown, unknown>,
  >(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly scope?: EphemeralScope<Ref>;
      readonly value: EphemeralValue<Ref>;
      readonly ttlMs?: number | null;
      readonly userId?: string;
      readonly permissions?: readonly string[];
    },
  ): Promise<EphemeralPublishOutcome>;
  deleteEphemeral<
    Ref extends string | SnapbackEphemeralReference<string, unknown, unknown>,
  >(
    ref: Ref,
    options: {
      readonly connectionId: string;
      readonly scope?: EphemeralScope<Ref>;
      readonly userId?: string;
      readonly permissions?: readonly string[];
      readonly expectedScopeEpoch?: number | null;
      readonly expectedEntryVersion?: number | null;
      readonly authorityCapture?: unknown;
    },
  ): Promise<EphemeralDeleteSettlement | unknown>;
  disconnect(connectionId: string): Promise<unknown>;
  startEphemeralRoom<
    Ref extends SnapbackEphemeralReference<string, unknown, unknown, 'Connection'>,
  >(
    admittedDefinition: Readonly<{
      reference: Ref;
      definition: Readonly<Record<string, unknown>>;
      connectionId: string;
    }>,
    scope: EphemeralScope<Ref>,
  ): EphemeralRoomHandle<EphemeralValue<Ref>>;
}

export function createExternalSessionClient(
  baseUrl: string,
  options: SnapbackClientOptions & { readonly bearerToken: string },
): SnapbackClient;
export function bindSnapbackAppLifecycle(
  appState: {
    readonly currentState?: string | null;
    addEventListener(
      event: 'change',
      listener: (state: string) => void,
    ): { remove(): void } | (() => void);
  },
  handle: { pause(): void | Promise<void>; resume(): void | Promise<void> },
  options?: { activeState?: string; onError?: (error: unknown) => void },
): { dispose(): void; settled(): Promise<void> };

export const LIVE_HEARTBEAT_INTERVAL_MS: number;
export const LIVE_FRESHNESS_BUDGET_MS: number;
export const LIVE_RECONNECT_BASE_DELAY_MS: number;
export const LIVE_RECONNECT_MAX_DELAY_MS: number;
export const DEFAULT_POLL_CADENCE_MS: number;
export const LIVE_DURABLE_KINDS: Readonly<Record<string, string>>;
export const LIVE_SOCKET_KINDS: Readonly<Record<string, string>>;
export const DURABLE_BYTES_RESYNC_REASON: string;
export function durableBytesResyncSentinel(): Readonly<Record<string, unknown>>;
export function dispatchDurableBytesFrame(stream: unknown, frame: unknown): unknown;

export {
  AgentAuthorityFence,
  createMemoryAgentAuthorityCustodyStorage,
} from './agent-authority.mjs';
export type {
  AgentAuthorityCapture,
  AgentAuthorityCredentialInput,
  AgentAuthorityCustodyStorage,
  AgentAuthorityDescriptor,
  AgentAuthorityFenceOptions,
  AgentAuthorityParticipant,
  AgentCredentialOffer,
  AgentCredentialReplacementOffer,
  AgentCustodyOwner,
  AgentDurableAuthority,
  AgentTerminalHandle,
  AgentTerminationDisposition,
} from './agent-authority.mjs';
/** Exact JS twin of the server's service_authority_instance_id derivation;
 * extra credential fields (tokenId, bearerToken) are tolerated. */
export function deriveServiceAuthorityInstanceId(credential: {
  readonly actorUserId: string;
  readonly credentialId: string;
  readonly credentialGeneration: number;
  readonly grantId: string;
}): string;

export {
  compileResultContractValidator,
  RESULT_CONTRACT_LIMITS_V1,
} from '@expo/snapback-contract/result-contract-validator';

export {
  RQS_STORE_MAX_BYTES,
  RQS_STORE_MAX_ENTRIES,
  arbitrateResumeCandidates,
  createIndexedDbRqsResumeStore,
  rqsEntryKey,
  verifyPersistedResumeEntry,
} from './rqs-store.mjs';
export type {
  RqsPersistedResumeMeta,
  RqsPersistedResumeRecord,
  RqsResumeCandidate,
  RqsResumeEntryRefusalReason,
  RqsResumeStore,
  RqsStoreCommitResult,
  RqsStoreIdentityResetResult,
  RqsStoreInspection,
  RqsStoreMetaV3,
} from './rqs-store.mjs';

export {
  RQS_BOOT_ELEMENT_ID,
  createRqsPreloadRegistry,
  readInlineBootPayload,
  readRqsPreloadRegistry,
} from './rqs-preload-core.mjs';
export type {
  RqsBootDocument,
  RqsBootPayload,
  RqsPreloadEntry,
  RqsPreloadRegistry,
} from './rqs-preload-core.mjs';

export const DEFAULT_INGRESS_LIMIT_BYTES: Readonly<{
  appCall: number;
  authLifecycle: number;
  discovery: number;
  artifact: number;
  liveFrame: number;
}>;

export function assertPreparedReactBinding(binding: unknown): PreparedReactBinding;
export function preparedReactBindingClient(binding: unknown): SnapbackClient;
export function isPreparedReactQueryGroup(value: unknown): boolean;
export function admittedReactQueryGroup(
  binding: unknown,
  reference: SnapbackQueryGroupReference,
): SnapbackQueryGroupReference;
export function admittedReactSurface(
  binding: unknown,
  reference: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>>;
export function admittedReactCommand(
  binding: unknown,
  reference: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>>;
export function admittedReactReference(
  binding: unknown,
  reference: SnapbackFunctionReference,
  expectedKind: SnapbackOperationKind | readonly SnapbackOperationKind[],
): SnapbackFunctionReference;
export function preparedReactResultContract(
  binding: unknown,
  reference: SnapbackFunctionReference,
): Readonly<Record<string, unknown>> | null;
export interface PreparedReactEphemeralDefinition {
  readonly reference: SnapbackEphemeralReference;
  readonly definition: Readonly<Record<string, unknown>>;
  readonly staticPolicyDigest: string;
}
export function admittedReactEphemeralDefinition(
  binding: unknown,
  reference: SnapbackEphemeralReference,
): PreparedReactEphemeralDefinition;
/** The exact generation stamp codegen embeds on every generated reference. */
export interface RegeneratedReferenceGeneration {
  readonly schemaVersion: string;
  readonly appId: string;
  readonly schemaHash: string;
  readonly bundleHash: string;
  readonly inputsHash: string;
}
export function activeReactBindingDeploymentIdentity(
  binding: unknown,
): Readonly<Record<string, unknown>>;
export function classifyRegeneratedReactReference(
  binding: unknown,
  reference: unknown,
): RegeneratedReferenceGeneration | null;
export function handoffPreparedReactBindingGeneration(
  binding: unknown,
  targetGeneration: RegeneratedReferenceGeneration,
  options?: {
    readonly timeoutMs?: number;
    readonly pollIntervalMs?: number;
  },
): Promise<
  | Readonly<{ ok: true; generation: Readonly<Record<string, unknown>> }>
  | Readonly<{ ok: false; reason: string; cause?: string; groupId?: string }>
>;

export { createFileRqsResumeStore } from './rqs-store-file.mjs';
export {
  createExpoFilesAdapter,
  createExpoRqsResumeStore,
  registerExpoFileSystemRqsFiles,
} from './rqs-store-expo.mjs';
export type {
  ExpoDirectoryLike,
  ExpoFileLike,
  ExpoFileSystemModuleLike,
} from './rqs-store-expo.mjs';
export declare function createMemoryRqsResumeStore(options?: Record<string, unknown>): unknown;
export {
  clearNativeRqsFiles,
  registerNativeRqsFiles,
  resolveDefaultRqsStore,
  type DefaultRqsStoreResolution,
  type NativeRqsFilesProvider,
} from './rqs-store-default.mjs';
export type {
  ClientAuthorityMatrixCell,
  ClientAuthorityState,
  ClientAuthoritySurface,
  ClientAuthorityTerminal,
} from './authority-transition.mjs';
export {
  CLIENT_AUTHORITY_STATES,
  CLIENT_AUTHORITY_STATE_MATRIX,
  CLIENT_AUTHORITY_SURFACES,
  CLIENT_AUTHORITY_TERMINALS,
  authorityTransitionCell,
  classifyClientAuthorityState,
} from './authority-transition.mjs';

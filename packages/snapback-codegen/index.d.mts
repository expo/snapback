// Type declarations for index.mjs — Snapback codegen: executes
// source-authored schema/function definitions and emits the generated
// manifests, typed API, and Contract binding modules.

import type { MutationStep, ReturnSpec, ValueExpr } from './define.js';
import type {
  ContractDataManifest,
  ProviderBindingMetadata,
  ProviderIntrospection,
} from './provider-introspection.mjs';
import type { ReviewManifest } from './review-surface.mjs';
import type { CodegenSummary } from './codegen-summary.mjs';
import type { ResultValueContract } from './result-contracts.mjs';

export {
  formatCodegenSummary,
  groupedCodegenSummaryDiagnosticCodes,
} from './codegen-summary.mjs';
export {
  DECLARATION_SUGGESTION_REASON_CODES,
  applyDeclarationSuggestion,
  formatDeclarationSuggestionPatch,
  readDeclarationSuggestionFile,
  resolveDeclarationSuggestionTarget,
  suggestDeclarations,
} from './declaration-suggestion.mjs';
export type {
  DeclarationSuggestionApplyResultV1,
  DeclarationSuggestionDiagnosticV1,
  DeclarationSuggestionDiagnosticCode,
  DeclarationSuggestionEvidenceV1,
  DeclarationSuggestionHoleV1,
  DeclarationSuggestionPatchV1,
  DeclarationSuggestionReasonCode,
  DeclarationSuggestionResultV1,
  DeclarationSuggestionV1,
} from './declaration-suggestion.mjs';

export const SURFACE_MAX_PARAMS: 8;
export const SURFACE_MAX_MEMBERS: 24;
export const SURFACE_MAX_MEMBER_BINDINGS: 32;
export const SURFACE_MAX_SCOPE_RECORD_FIELDS: 8;
export const SURFACE_MAX_PER_APP: 32;

// @ref LLP 0211#representation-and-write-path — the public declaration
// carries the exact versioned encoding identity hashed by codegen.
export const STORED_STRUCTURED_ENCODING_V1: 'canonical-json-text.v1';

export interface StoredStructuredContractV1 {
  readonly version: 1;
  readonly descriptor: ResultValueContract;
  readonly encoding: typeof STORED_STRUCTURED_ENCODING_V1;
}

export function storedStructuredContractHash(
  contract: StoredStructuredContractV1,
): `sha256:${string}`;

/** Canonical sorted projection of Rust's registry-owned experimental ids. */
export function experimentalTargetCapabilityIdsCanonicalJson(): string;

/** Test-only canonical projection of schema-authorable registry ids and reviewed exceptions. */
export function targetCapabilityAuthoringVocabularyCanonicalJson(): string;

/**
 * Validates the closed, server-prepared trust root before codegen publishes it.
 * The returned value is the same candidate, preserving its caller-known shape.
 */
export function validateTrustedCompositionActivationV1<
  const Activation extends Readonly<Record<string, unknown>>,
>(
  candidate: Activation,
  options: Readonly<{
    expectedGeneration: unknown;
    authoredSourceHash: string;
    targetProfileId: string;
    authMode: string;
  }>,
): Activation;

export interface CodegenDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly subsystem: string;
  readonly message: string;
  readonly [detail: string]: unknown;
}

/** One emitted contract-data query binding as the cross-check observes it. */
export interface ContractQueryBinding {
  readonly subscription?: string;
  readonly mode?: string;
  readonly livePush?: boolean;
  readonly initialSnapshot?: boolean;
  readonly defaultLive?: boolean;
  readonly ephemeral?: boolean;
  readonly coalesce?: boolean;
  readonly maxDeltaRateHz?: number;
  readonly transport?: string;
  readonly pollCadenceMs?: number;
  readonly [fact: string]: unknown;
}

/**
 * Migration cross-check: the legacy `subscription` field and the v2 liveness
 * fields must agree; each mismatch is one CONTRACT_MANIFEST_MIGRATION_MISMATCH
 * error diagnostic.
 */
export function crossCheckContractQueryBinding(
  name: string,
  binding: ContractQueryBinding,
): Array<Readonly<{
  code: 'CONTRACT_MANIFEST_MIGRATION_MISMATCH';
  severity: 'error';
  subsystem: 'contract';
  message: string;
  query: string;
}>>;

export interface OperationSchemaArtifact {
  readonly file: string;
  readonly value: Readonly<Record<string, unknown>>;
}

/** Focused projection seam used by the operation-schema conformance corpus. */
export function renderOperationSchemas(
  appId: string,
  functions: ReadonlyArray<Readonly<{ name: string }>>,
  functionsModule: Readonly<Record<string, Readonly<{
    args?: Readonly<Record<string, unknown>>;
  }>>>,
): OperationSchemaArtifact[];

/** Every object-reachable route-param reference and its resolved validator. */
export function routeMappingParamTargets(
  mapping: unknown,
  fnArgs: Readonly<Record<string, unknown>> | undefined,
): ReadonlyArray<Readonly<{
  path: readonly string[];
  param: unknown;
  validator: Readonly<Record<string, unknown>> | null;
}>>;

/** Closed register-mode predicate shared with the route authoring fixture. */
export function routeRegisterGroupEligible(
  queries: ReadonlyArray<Readonly<{
    function: string;
    args?: Readonly<Record<string, unknown>>;
  }>>,
  functionsModule: Readonly<Record<string, Readonly<{
    __kind?: string;
    searchPlan?: unknown;
    args?: Readonly<Record<string, Readonly<{ primitive?: string }>>>;
  }>>>,
): boolean;

/** Closed mixed-route v2 predicate shared with the route authoring fixture. */
export function routeMixedGroupEligible(
  queries: ReadonlyArray<Readonly<{
    function: string;
    args?: Readonly<Record<string, unknown>>;
  }>>,
  functionsModule: Readonly<Record<string, Readonly<{
    __kind?: string;
    searchPlan?: unknown;
    args?: Readonly<Record<string, Readonly<{ primitive?: string }>>>;
  }>>>,
): boolean;

/** Phase-B familiar handler-context renderer; exported for the committed
 * exact facade/adversarial fixture. */
export function renderFamiliarHandlerRuntime(
  name: string,
  extracted: Readonly<{ expressionSource: string }>,
  canonicalRendered: Readonly<{
    source: string;
    segments: readonly Readonly<Record<string, unknown>>[];
  }>,
  contextKind: 'query' | 'mutation' | 'action',
  apiDigest: string,
): Readonly<{
  source: string;
  segments: readonly Readonly<Record<string, unknown>>[];
}>;

export interface ContractMutationDescriptor {
  readonly name: string;
  readonly args: unknown;
  readonly argOrder: readonly string[];
  readonly writes: readonly string[];
  readonly invalidates: readonly string[];
  readonly optimistic: boolean;
  readonly atomicOptimisticWithholding?: true;
  readonly plan?: unknown;
  readonly serverRunnable: true;
}

/** Builds the Contract projection for a declarative mutation plan. */
export function buildContractMutationDescriptor(options: Readonly<{
  name: string;
  args: unknown;
  argOrder: readonly string[];
  writes: readonly string[];
  plan: unknown;
  sequenceAllocationCount?: number;
}>): ContractMutationDescriptor;

/** Builds the Contract projection for a JavaScript mutation handler. */
export function buildContractJsMutationDescriptor(options: Readonly<{
  name: string;
  args: unknown;
  argOrder: readonly string[];
  writes: readonly string[];
  sequenceCount?: number;
}>): ContractMutationDescriptor;

export function contractCapabilitiesForMutations(
  contractMutations: Readonly<Record<string, ContractMutationDescriptor>>,
): Readonly<{
  optimisticMutations: boolean;
  derivedOptimisticOverlays: boolean;
  offlineReplay: boolean;
}>;

// @ref LLP 0037#decision-ratified-2026-07-02 — Rust-owned AgentSafe shapes
// project through the four committed schemas; the publication oracle compares
// every declaration below against those schemas in the DK-7 proof path.
export type AgentSafeActionReplayClassV1 = 'Missing' | 'Nondeterministic';
export type AgentSafeAggregateStateV1 = 'Missing' | 'Supported';
export type AgentSafeCapabilitySchemaVersion = 'agentSafe.v1';
export type AgentSafeDiffCoverageV1 = 'Missing' | 'Exact';
export type AgentSafeEnvelopeCoverageV1 = 'Missing' | 'Covered';
export type AgentSafeExplanationAccessV1 = 'publicCurrentPolicy' | 'administrative';
export type AgentSafeExplanationAdapterV1 = 'hostPlan' | 'ibexBuffered';
export type AgentSafeExplanationDetailV1 = 'Missing' | 'DigestOnly' | 'BoundedFacts';
export type AgentSafeExplanationLogicalLaneV1 = 'ordinaryMutation' | 'hostChildMutation';
export type AgentSafeExplanationProfileV1 =
  | 'generatedOwnedCrudOwnerCreateV1'
  | 'generatedOwnedCrudOwnerUpdateV1';
export type AgentSafeExplanationRetentionV1 = 'Missing' | 'EnvelopeBounded' | 'PolicyBounded';
export type AgentSafeForkBaseV1 = 'Missing' | 'currentHead' | 'namedCheckpoint';
export type AgentSafeForkEgressV1 = 'Missing' | 'denyAll' | 'captureOnly';
export type AgentSafeForkIsolationV1 = 'Missing' | 'hostMediated' | 'endToEnd';
export type AgentSafeForkPromotionV1 = 'Missing' | 'notPromotable' | 'promotable';
export type AgentSafeHandlerReplayClassV1 = 'Missing' | 'Deterministic';
export type AgentSafeHistoryClassV1 = 'Missing' | 'BoundedChanges' | 'NamedCheckpoints';
export type AgentSafeProofClassV1 =
  | 'Missing'
  | 'RecordedInventory'
  | 'verifiedCopyFidelity'
  | 'IndependentBoundaryProof';
export type AgentSafeResourceBoundClassV1 = 'Missing' | 'AdmissionAndResourceBounds';
export type AgentSafeSchemaEvolutionClassV1 = 'Missing' | 'ProofsWithoutLens';

export interface AgentSafeAggregateFactsV1 {
  readonly core: AgentSafeAggregateStateV1;
  readonly history: AgentSafeAggregateStateV1;
}

export interface AgentSafeDiffFactsV1 {
  readonly data: AgentSafeDiffCoverageV1;
  readonly effects: AgentSafeDiffCoverageV1;
}

export interface AgentSafeEnvelopeCoverageByAdapterV1 {
  readonly hostPlan: AgentSafeEnvelopeCoverageV1;
  readonly ibexBuffered: AgentSafeEnvelopeCoverageV1;
}

export interface AgentSafeEnvelopeCoverageByScopeV1 {
  readonly ordinaryMutation: AgentSafeEnvelopeCoverageByAdapterV1;
  readonly hostChildMutation: AgentSafeEnvelopeCoverageByAdapterV1;
  readonly migration: AgentSafeEnvelopeCoverageV1;
  readonly durableBackgroundWork: AgentSafeEnvelopeCoverageV1;
  readonly push: AgentSafeEnvelopeCoverageV1;
  readonly auth: AgentSafeEnvelopeCoverageV1;
}

export interface AgentSafeExplanationClassV1 {
  readonly detail: AgentSafeExplanationDetailV1;
  readonly retention: AgentSafeExplanationRetentionV1;
}

export interface AgentSafeExplanationScopeV1 {
  readonly logicalLane: AgentSafeExplanationLogicalLaneV1;
  readonly adapter: AgentSafeExplanationAdapterV1;
  readonly access: AgentSafeExplanationAccessV1;
  readonly profile: AgentSafeExplanationProfileV1;
}

export interface AgentSafeScopedExplanationFactV1 {
  readonly scope: AgentSafeExplanationScopeV1;
  readonly class: AgentSafeExplanationClassV1;
}

export interface AgentSafeExplanationFactsV1 {
  readonly scopedFacts: readonly AgentSafeScopedExplanationFactV1[];
}

export interface AgentSafeForkAxesV1 {
  readonly egress: AgentSafeForkEgressV1;
  readonly promotion: AgentSafeForkPromotionV1;
  readonly base: AgentSafeForkBaseV1;
  readonly isolation: AgentSafeForkIsolationV1;
}

export interface AgentSafeForkFactsV1 {
  readonly inApp: AgentSafeForkAxesV1;
  readonly derivedDeployment: AgentSafeForkAxesV1;
}

export interface AgentSafeReplayFactsV1 {
  readonly handlers: AgentSafeHandlerReplayClassV1;
  readonly actions: AgentSafeActionReplayClassV1;
}

export interface AgentSafeCapabilityFactsV1 {
  readonly envelope: AgentSafeEnvelopeCoverageByScopeV1;
  readonly explanation: AgentSafeExplanationFactsV1;
  readonly forks: AgentSafeForkFactsV1;
  readonly diff: AgentSafeDiffFactsV1;
  readonly history: AgentSafeHistoryClassV1;
  readonly proof: AgentSafeProofClassV1;
  readonly replay: AgentSafeReplayFactsV1;
  readonly schemaEvolution: AgentSafeSchemaEvolutionClassV1;
  readonly resourceBounds: AgentSafeResourceBoundClassV1;
  readonly aggregate: AgentSafeAggregateFactsV1;
}

export interface AgentSafeCapabilityExtensionV1 {
  readonly schemaVersion: AgentSafeCapabilitySchemaVersion;
  readonly target: AgentSafeCapabilityFactsV1;
  readonly appEffective: AgentSafeCapabilityFactsV1;
}

export interface TargetCapabilityManifest {
  readonly targetProfileId?: string;
  readonly supportedArtifactVersions?: readonly string[];
  readonly supportedAuthModes?: readonly string[];
  readonly supportedArtifactAuthPairs?: ReadonlyArray<Readonly<{
    schemaVersion?: string;
    authMode?: string;
  }>>;
  readonly supportedCapabilities?: readonly string[];
  readonly connectedClientPredicate?: Readonly<{
    capabilityId: 'realtime.connected-client-predicate';
    semanticsVersion: number;
    freshnessBudgetMs: number;
    transport: readonly ('managed-websocket' | 'authenticated-poll')[];
    authorityScope: string;
    aggregationMode: 'single-authority-routing';
  }>;
  readonly agentSafe?: AgentSafeCapabilityExtensionV1;
  readonly [fact: string]: unknown;
}

/**
 * The exact artifact/auth pair and every required capability must be
 * positively supported; dimension arrays do not grant their product.
 */
export function targetArtifactAuthProblems(
  manifest: TargetCapabilityManifest,
  version: string,
  authMode: string,
  required: readonly string[],
): Array<Readonly<{
  code: 'CODEGEN_ARTIFACT_AUTH_PAIR_UNSUPPORTED' | 'SNAPBACK_CAPABILITY_UNSUPPORTED';
  message: string;
  details: Readonly<Record<string, unknown>>;
}>>;

export interface MicroProfileCapabilityInput {
  readonly selectedKinds?: readonly string[];
}

export type MicroProfileCapabilityProblem = Readonly<{
  code:
    | 'CODEGEN_MICRO_ARGS_CONTRACT_CAPABILITY_REQUIRED'
    | 'CODEGEN_MICRO_RESULT_CONTRACT_CAPABILITY_REQUIRED'
    | 'CODEGEN_MICRO_LIVE_CAPABILITY_REQUIRED';
  message: string;
}>;

/** Stable fail-closed capability diagnostics for a generated Micro profile. */
export function microProfileCapabilityProblems(
  profile: MicroProfileCapabilityInput | null | undefined,
  capabilityManifest: TargetCapabilityManifest | null | undefined,
): MicroProfileCapabilityProblem[];

export interface MicroProfileArtifactDigests {
  readonly runtimeEntryDigest?: string;
  readonly declarationDigest?: string;
}

export type MicroProfileArtifactProblem = Readonly<{
  code: 'CODEGEN_MICRO_RUNTIME_DIGEST_DRIFT' | 'CODEGEN_MICRO_DECLARATION_DIGEST_DRIFT';
  message: string;
}>;

/** Recomputes the generated runtime/declaration digests recorded by a profile. */
export function verifyMicroProfileArtifacts(
  profile: MicroProfileArtifactDigests | null | undefined,
  runtimeEntry: string,
  declaration: string,
): MicroProfileArtifactProblem[];

export type SnapbackTargetProfile = 'local-dev-sqlite-ibex' | 'remote-service-sqlite-ibex';

export type GenerateOptions = Readonly<{
  targetProfile?: SnapbackTargetProfile;
  /** Selects the generated app binding kind structurally. Programmatic
   * generation defaults to release; authoring CLIs pass development. */
  appBindingMode?: 'development' | 'release';
  /** Alternate project root for the complete generated materialization,
   * content-addressed cache, and immutable generation envelope. */
  outputRoot?: string;
  /** Run complete generation validation without publishing generated output. */
  check?: boolean;
}>;

export interface GenerateFailure {
  readonly ok: false;
  readonly diagnostics: readonly CodegenDiagnostic[];
}

export interface GenerateSuccess {
  readonly ok: true;
  readonly diagnostics: readonly CodegenDiagnostic[];
  readonly inputsHash: string;
  readonly authoredSourceHash: string;
  readonly identities: Readonly<{
    schemaVersion: 'snapback.semantic-identity.v1';
    semanticId: `sha256:${string}`;
    executableId: `sha256:${string}`;
    executableIdsByTarget: Readonly<Record<string, `sha256:${string}`>>;
    evidenceId: `sha256:${string}`;
    normalizedContractId: `sha256:${string}`;
    normalizedSchemaId: `sha256:${string}`;
    bundleId: `sha256:${string}`;
    generationId: `sha256:${string}`;
  }>;
  readonly outDir: string;
  readonly schemaManifest: Readonly<Record<string, unknown>>;
  readonly functionManifest: Readonly<{
    functions: ReadonlyArray<Readonly<Record<string, unknown>>>;
    [fact: string]: unknown;
  }>;
  /** Consumer-committed structural facts for authorization review. */
  readonly authorizationReview: Readonly<Record<string, unknown>>;
  readonly normalizedDefinition: Readonly<{
    schemaVersion: 'snapback.normalized-application-definition.v1';
    excludedFields: readonly ['behavior', 'graphRecords', 'authoringProfile', 'appId'];
    normalizedContractId: `sha256:${string}`;
    normalizedSchemaId: `sha256:${string}`;
    definition: Readonly<Record<string, unknown>>;
  }>;
  readonly handlerRuntimeProfile: Readonly<Record<string, unknown>>;
  readonly capabilityManifest: Readonly<Record<string, unknown>>;
  readonly providerIntrospection: ProviderIntrospection;
  readonly providerBindingMetadata: ProviderBindingMetadata;
  readonly contractManifest: ContractDataManifest;
  readonly artifactIndex: ReviewManifest;
  readonly summary: CodegenSummary;
  readonly checked: boolean;
  readonly emitted: boolean;
  readonly cacheGraphRoot: string | null;
  /** Gitignored immutable Rollout-1 envelope; null for `--check`. */
  readonly generationEnvelopeRoot: string | null;
  /** Present only when a source-controlled `micro.profile.json` was selected. */
  readonly microProfile?: Readonly<Record<string, unknown>>;
}

export type GenerateResult = GenerateFailure | GenerateSuccess;

export type GenerateOptionsValidationResult =
  | Readonly<{ ok: true; options: GenerateOptions }>
  | GenerateFailure;

/**
 * Validates and normalizes the complete closed option record before it crosses
 * a worker serialization boundary. Known `undefined` properties are omitted.
 */
export function validateGenerateOptions(options?: unknown): GenerateOptionsValidationResult;

/** The closed trusted activation root carrying a v1 or v2 activation identity. */
export interface TrustedCompositionActivationV1 {
  format: 'snapback.trusted-composition-activation.v1';
  activation: ({
    format: 'snapback.composition-activation.v1';
    databaseId: string;
    deploymentId: string;
    targetProfileId: string;
    authMode: string;
    expectedGeneration: unknown;
    proofKeyManifestDigest: string;
  } | {
    format: 'snapback.composition-activation.v2';
    databaseId: string;
    deploymentId: string;
    targetProfileId: string;
    authMode: string;
    authoredSourceHash: string;
    mintedGeneration: unknown;
    proofKeyManifestDigest: string;
  });
  activationHash: string;
  proofKeys: {
    format: 'snapback.completeness-proof-keys.v1';
    keys: ReadonlyArray<{
      proofKeyId: string;
      algorithm: 'Ed25519';
      publicKeyBase64url: string;
    }>;
  };
}

/**
 * Validates a trusted-composition-activation record against the generated
 * deployment it must bind; returns the validated record or throws.
 */
export function validateTrustedCompositionActivationV1(
  candidate: unknown,
  options: Readonly<{
    expectedGeneration: unknown;
    authoredSourceHash: string;
    targetProfileId: string;
    authMode: string;
  }>,
): TrustedCompositionActivationV1;

/**
 * Runs generation in a fresh cache-busting worker process; never rejects —
 * worker failures come back as `{ ok: false }` diagnostics.
 */
export function generate(backendDir: string, options?: GenerateOptions): Promise<GenerateResult>;

/** In-process generation (no ESM cache busting between calls). */
export function generateInProcess(
  backendDir: string,
  options?: GenerateOptions,
): Promise<GenerateResult>;

/** Manifest atoms of the closed v1 value-expression profile. */
export type SerializedExprAtom =
  | 'AuthUserId'
  | 'AuthKind'
  | 'AuthActorKind'
  | 'AuthIsDelegated'
  | 'AuthActorUserId'
  | 'AuthActivityActorKind'
  | 'AuthGrantId'
  | 'ClientMutationDigest'
  | 'RuntimeId'
  | 'RuntimeNow'
  | 'Args';

export type SerializedExpr =
  | SerializedExprAtom
  | Readonly<{ Arg: string }>
  | Readonly<{ Literal: unknown }>
  | Readonly<{ Binding: string }>
  | Readonly<{ Field: { base: SerializedExpr; key: string } }>
  | Readonly<{ Binary: { op: string; left: SerializedExpr; right: SerializedExpr } }>
  | Readonly<{ Unary: { op: string; expr: SerializedExpr } }>
  | Readonly<{ If: { cond: SerializedExpr; then: SerializedExpr; else: SerializedExpr } }>
  | Readonly<{ Concat: readonly SerializedExpr[] }>
  | Readonly<{ Call: { func: string; args: readonly SerializedExpr[] } }>
  | Readonly<{ Record: { fields: Readonly<Record<string, SerializedExpr>> } }>;

/** Lowers an authoring value expression into its manifest form; throws on anything else. */
export function serializeExpr(expr: ValueExpr): SerializedExpr;

export type SerializedMutationStep =
  | Readonly<{ AllocateSequence: { counter: string; scope: SerializedExpr; into: string } }>
  | Readonly<{ Insert: { table: string; values: Readonly<Record<string, SerializedExpr>>; bind_id_as: string | null } }>
  | Readonly<{ Patch: { table: string; id: SerializedExpr; values: Readonly<Record<string, SerializedExpr>> } }>
  | Readonly<{ Get: { table: string; id: SerializedExpr; bind_as: string; else_error: string | null } }>
  | Readonly<{ Guard: { cond: SerializedExpr; else_error: string } }>
  | Readonly<{ Let: { bind_as: string; expr: SerializedExpr } }>
  | Readonly<{ DeleteWhere: { table: string; filter: ReadonlyArray<Readonly<{ field: string; op: string; value: SerializedExpr }>> } }>
  | Readonly<{ InsertEach: { table: string; source: SerializedExpr; item_as: string; values: Readonly<Record<string, SerializedExpr>> } }>
  | Readonly<{ AssertSourceChanged: { table: string; id: SerializedExpr; operation: string } }>
  | Readonly<{
      AssertCurrentRelation: {
        table: string;
        id: SerializedExpr;
        scope_table: string;
        scope_id: SerializedExpr;
        foreign_key_field: string;
        incarnation_field: string;
        else_error: string | null;
      };
    }>
  | Readonly<{ Delete: { table: string; id: SerializedExpr } }>;

export type SerializedMutationReturnValue =
  | 'ChangedCount'
  | Readonly<{ Binding: string }>
  | Readonly<{ Literal: unknown }>
  | Readonly<{ Document: { table: string; id: SerializedExpr } }>
  | Readonly<{ Expr: SerializedExpr }>;

export interface SerializedMutationPlan {
  readonly steps: readonly SerializedMutationStep[];
  readonly return_value: SerializedMutationReturnValue | null;
}

/**
 * Serializes an authoring mutation plan into its manifest form. With
 * `functionName` and `err`, plan-bound violations (steps/bytes/expression
 * depth) are reported through `err` instead of thrown.
 */
export function serializeMutationPlan(
  plan: Readonly<{ steps: readonly MutationStep[]; return_value?: ReturnSpec | null }>,
  functionName?: string | null,
  err?: ((
    code: string,
    subsystem: string,
    message: string,
    extra?: Readonly<Record<string, unknown>>,
  ) => void) | null,
): SerializedMutationPlan;

/**
 * Pure identity authority for inputs/schema/bundle hashes. v0+dev keeps the
 * historical truncated digests; only the exact v1+sessions tuple enters the
 * disjoint serialized namespaces (anything else throws).
 */
export function computeArtifactIdentityStrings(options: Readonly<{
  artifactVersion: string;
  authMode: string;
  appId?: string;
  sharedInputItems: readonly string[];
  schemaContentItems: readonly string[];
  bundleContentItems: readonly string[];
  authoredSourceItems?: readonly (string | Uint8Array)[];
}>): Readonly<{
  inputsHash: string;
  schemaHash: string;
  bundleHash: string;
  authoredSourceHash: string;
}>;

/** CLI entry (`[--json] [--target-profile <profile>] [backendDir]`). */
export function runCodegenCli(argv?: readonly string[]): Promise<void>;

/**
 * Validates the closed trusted activation artifact using v1 exact-generation
 * rules or v2 exact-authored-source rules. Throws `TypeError` on mismatch.
 */
export function validateTrustedCompositionActivationV1(
  candidate: unknown,
  context: Readonly<{
    expectedGeneration: Readonly<Record<string, unknown>>;
    authoredSourceHash: string;
    targetProfileId: string;
    authMode: string;
  }>,
): Readonly<Record<string, unknown>>;

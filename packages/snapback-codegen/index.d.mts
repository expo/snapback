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

export { formatCodegenSummary } from './codegen-summary.mjs';

/** Canonical sorted projection of Rust's registry-owned experimental ids. */
export function experimentalTargetCapabilityIdsCanonicalJson(): string;

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

export interface TargetCapabilityManifest {
  readonly targetProfileId?: string;
  readonly supportedArtifactVersions?: readonly string[];
  readonly supportedAuthModes?: readonly string[];
  readonly supportedArtifactAuthPairs?: ReadonlyArray<Readonly<{
    schemaVersion?: string;
    authMode?: string;
  }>>;
  readonly supportedCapabilities?: readonly string[];
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

export type GenerateOptions = Readonly<{ targetProfile?: SnapbackTargetProfile }>;

export interface GenerateFailure {
  readonly ok: false;
  readonly diagnostics: readonly CodegenDiagnostic[];
}

export interface GenerateSuccess {
  readonly ok: true;
  readonly diagnostics: readonly CodegenDiagnostic[];
  readonly inputsHash: string;
  readonly outDir: string;
  readonly schemaManifest: Readonly<Record<string, unknown>>;
  readonly functionManifest: Readonly<{
    functions: ReadonlyArray<Readonly<Record<string, unknown>>>;
    [fact: string]: unknown;
  }>;
  readonly capabilityManifest: Readonly<Record<string, unknown>>;
  readonly providerIntrospection: ProviderIntrospection;
  readonly providerBindingMetadata: ProviderBindingMetadata;
  readonly contractManifest: ContractDataManifest;
  readonly artifactIndex: ReviewManifest;
  readonly summary: CodegenSummary;
  readonly cacheGraphRoot: string;
  /** Present only when a source-controlled `micro.profile.json` was selected. */
  readonly microProfile?: Readonly<Record<string, unknown>>;
}

export type GenerateResult = GenerateFailure | GenerateSuccess;

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
}>): Readonly<{ inputsHash: string; schemaHash: string; bundleHash: string }>;

/** CLI entry (`[--json] [--target-profile <profile>] [backendDir]`). */
export function runCodegenCli(argv?: readonly string[]): Promise<void>;

/**
 * Validates a `snapback.trusted-composition-activation.v1` artifact against
 * the expected generation/target/auth identities and returns the frozen
 * activation record. Throws `TypeError` on any closed-record or identity
 * mismatch.
 */
export function validateTrustedCompositionActivationV1(
  candidate: unknown,
  context: Readonly<{
    expectedGeneration: Readonly<Record<string, unknown>>;
    targetProfileId: string;
    authMode: string;
  }>,
): Readonly<Record<string, unknown>>;

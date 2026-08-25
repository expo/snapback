import type {
  SnapbackAppBindingV1,
  SnapbackApplicationDescriptorV1,
} from '@expo/snapback-client';

export type StarterVerifyPathKind =
  | 'success'
  | 'failure'
  | 'action'
  | 'relational'
  | 'search'
  | 'snapshot-bundle';

export interface StarterArtifactGeneration {
  readonly schemaVersion: string;
  readonly appId: string;
  readonly schemaHash: string;
  readonly bundleHash: string;
  readonly inputsHash: string;
}

export interface GeneratedOperationReference {
  readonly artifactKind: 'functionReference';
  readonly schemaVersion: string;
  readonly appId: string;
  readonly id: string;
  readonly name: string;
  readonly kind: 'Query' | 'Mutation' | 'LiveQuery' | 'Action';
  readonly expectedGeneration: StarterArtifactGeneration;
}

declare const starterAcceptancePathToken: unique symbol;

export interface StarterAcceptancePath {
  readonly [starterAcceptancePathToken]: true;
  readonly id: string;
  readonly kind: StarterVerifyPathKind;
  readonly targetProfileId: string;
  readonly operation: GeneratedOperationReference | null;
  readonly functionId: string | null;
  readonly provenance: 'baseline' | 'none';
  readonly timeoutMs: number | null;
}

export interface StarterAcceptanceArtifacts extends StarterArtifactGeneration {
  readonly artifactKind: 'artifactIndex';
  readonly [key: string]: unknown;
}

export interface StarterAcceptanceReady {
  readonly ready: true;
  readonly serverUrl: string;
  readonly adminTokenFile?: string;
  readonly [key: string]: unknown;
}

export interface StarterLifecycleEvidenceV1 {
  readonly owned?: boolean;
  readonly waitLevel?: string;
  readonly firstQueryRetries?: number;
}

export interface StarterLifecycleStateV1 {
  readonly ready: StarterAcceptanceReady;
  readonly executable?: string | null;
  readonly readyFile?: string | null;
  readonly adminToken?: string | null;
  readonly loadedIdentity?: {
    readonly appId: string;
    readonly bundleHash: string;
  } | null;
  readonly adminClient?: any;
  readonly lifecycleEvents?: readonly Readonly<Record<string, unknown>>[];
  readonly lifecycleEvidence?: StarterLifecycleEvidenceV1;
  health?(): { readonly running: boolean; readonly diagnostic?: string | null };
}

export interface StarterLifecycleStartInputV1 {
  readonly appRoot: string;
  readonly stateRoot: string;
  readonly readinessTimeoutMs: number;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
}

export interface StarterLifecycleAdapterV1 {
  readonly schemaVersion: 'snapback.starter-lifecycle-adapter.v1';
  start(input: StarterLifecycleStartInputV1): Promise<StarterLifecycleStateV1>;
  stop(
    state: StarterLifecycleStateV1 | null,
    options: { readonly signal: AbortSignal },
  ): Promise<{ readonly exited: boolean }>;
}

export interface StarterStepOptions {
  readonly timeoutMs?: number;
}

export interface StarterSupervisedBindingOptions {
  readonly offeredCapabilities?: readonly string[];
  readonly supervisorGeneration?: string;
}

export interface StarterJourneyContext {
  readonly appRoot: string;
  readonly stateRoot: string;
  readonly signal: AbortSignal;
  readonly ready: StarterAcceptanceReady | null;
  readonly adminClient: any;
  readonly paths: Readonly<Record<string, StarterAcceptancePath>>;
  readonly artifacts: StarterAcceptanceArtifacts;
  readonly bindingFor: (
    app: SnapbackApplicationDescriptorV1,
    options?: StarterSupervisedBindingOptions,
  ) => SnapbackAppBindingV1;
  step(
    path: StarterAcceptancePath,
    callback: (signal: AbortSignal) => unknown | Promise<unknown>,
    options?: StarterStepOptions,
  ): Promise<unknown>;
  until<T>(
    predicate: (signal: AbortSignal) => T | Promise<T>,
    label: string,
    options?: {
      readonly timeoutMs?: number;
      readonly intervalMs?: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<T>;
  defer(cleanup: (signal: AbortSignal) => void | Promise<void>): void;
  mintSession(options: { readonly email: string }): Promise<{ readonly token: string }>;
  createSessionClient(options: {
    readonly email: string;
    readonly clientOptions?: Readonly<Record<string, unknown>>;
  }): Promise<any>;
}

export interface StarterAcceptanceDefinition {
  readonly schemaVersion: 'snapback.starter-acceptance-definition.v1';
  readonly acceptanceFile: string;
  readonly appRoot: string;
  readonly artifacts: StarterAcceptanceArtifacts;
  readonly paths: Readonly<Record<string, StarterAcceptancePath>>;
  readonly stepTimeoutMs: number;
  readonly readinessTimeoutMs: number;
  readonly overallTimeoutMs: number;
  readonly cleanupTimeoutMs: number;
  readonly preflight:
    | ((context: StarterJourneyContext, signal: AbortSignal) => void | Promise<void>)
    | null;
  readonly journey: (
    context: StarterJourneyContext,
    signal: AbortSignal,
  ) => void | Promise<void>;
}

export interface StarterAcceptanceCheck {
  readonly id: string;
  readonly status: 'passed';
  readonly details: unknown;
}

export interface StarterAcceptanceReceipt {
  readonly schemaVersion: 'snapback.starter-acceptance.v1';
  readonly status: 'passed' | 'failed';
  readonly expectedCheckCount: number;
  readonly executedCheckCount: number;
  readonly checks: readonly StarterAcceptanceCheck[];
  readonly identity: Readonly<{
    artifact: Readonly<{
      appId: string;
      inputsHash: string;
      schemaHash: string;
      bundleHash: string;
    }>;
    loaded: Readonly<{ appId: string; bundleHash: string }> | null;
  }>;
  readonly lifecycle: Readonly<{
    applicationReadyObserved: boolean;
    owned?: boolean;
    waitLevel?: string;
    firstQueryRetries?: number;
  }>;
  readonly operations: Readonly<Record<string, string>>;
  readonly cleanup: Readonly<{
    attempted: boolean;
    clientResourcesReleased: boolean;
    devExited: boolean;
    temporaryStateRemoved: boolean;
    ok: boolean;
  }>;
  readonly diagnostic: Readonly<{ code: string; message: string }> | null;
}

export interface StarterVerifyRegistrationPath {
  readonly id: string;
  readonly kind: StarterVerifyPathKind;
  readonly targetProfileId: string;
  readonly functionId: string | null;
}

/** Exact structural input accepted by `@expo/snapback-cli/verify`'s
 * `defineStarterVerifyProfile`; kept local to avoid a runtime package cycle. */
export interface StarterVerifyProfileOptions {
  readonly id: string;
  readonly title: string;
  readonly acceptanceFile: string | URL;
  readonly additionalTestFiles: readonly (string | URL)[];
  readonly requiredCapabilities: readonly string[];
  readonly paths: readonly StarterVerifyRegistrationPath[];
  readonly provenanceBaseline: readonly string[];
  readonly timeoutMs?: number;
}

export interface StarterReceiptAdmission {
  readonly complete: boolean;
  readonly invalidPathCount: number;
  readonly invalidPaths: readonly Readonly<Record<string, unknown>>[];
  readonly invalidPathsTruncated: boolean;
  readonly remediation: Readonly<Record<string, unknown>> | null;
  readonly observedPathIds: readonly string[];
}

export const STARTER_ACCEPTANCE_DEFINITION_VERSION: 'snapback.starter-acceptance-definition.v1';
export const STARTER_ACCEPTANCE_SCHEMA_VERSION: 'snapback.starter-acceptance.v1';
export const STARTER_LIFECYCLE_ADAPTER_VERSION: 'snapback.starter-lifecycle-adapter.v1';

export function defineStarterAcceptance(options: {
  readonly acceptanceFile: string | URL;
  readonly appRoot?: string | URL;
  readonly artifacts: StarterAcceptanceArtifacts;
  readonly paths?: Readonly<Record<string, {
    readonly id: string;
    readonly kind: StarterVerifyPathKind;
    readonly targetProfileId: string;
    readonly operation: GeneratedOperationReference | null;
    readonly provenance?: 'baseline' | 'none';
    readonly timeoutMs?: number;
  }>>;
  readonly stepTimeoutMs?: number;
  readonly readinessTimeoutMs?: number;
  readonly overallTimeoutMs?: number;
  readonly cleanupTimeoutMs?: number;
  readonly preflight?: (
    context: StarterJourneyContext,
    signal: AbortSignal,
  ) => void | Promise<void>;
  readonly journey: (
    context: StarterJourneyContext,
    signal: AbortSignal,
  ) => void | Promise<void>;
}): StarterAcceptanceDefinition;

export function createManagedDevLifecycleAdapter(): StarterLifecycleAdapterV1;
export function runStarterAcceptance(
  definition: StarterAcceptanceDefinition,
  options?: {
    readonly lifecycle?: StarterLifecycleAdapterV1;
    readonly emit?: boolean;
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly signal?: AbortSignal;
  },
): Promise<{ readonly receipt: StarterAcceptanceReceipt; readonly exitCode: 0 | 1 }>;
export function runStarterAcceptanceIfMain(
  meta: ImportMeta | string,
  definition: StarterAcceptanceDefinition,
  options?: Parameters<typeof runStarterAcceptance>[1],
): Promise<StarterAcceptanceReceipt | null>;

export function starterVerifyProfileOptions(
  definition: StarterAcceptanceDefinition,
  options: {
    readonly id: string;
    readonly title?: string;
    readonly additionalTestFiles?: readonly (string | URL)[];
    readonly requiredCapabilities?: readonly string[];
    readonly timeoutMs?: number;
  },
): StarterVerifyProfileOptions;

export function projectStarterAcceptanceReceipt(
  outcome: Readonly<Record<string, unknown>>,
): StarterAcceptanceReceipt;
export function parseStarterAcceptanceReceipt(stdout: string): Readonly<{
  kind: 'receipt' | 'missing-receipt' | 'malformed-receipt';
  receipt: StarterAcceptanceReceipt | null;
  invalidPaths: readonly Readonly<Record<string, unknown>>[];
}>;
export function validatePassingStarterReceipt(
  receipt: unknown,
  registeredPaths: readonly StarterVerifyRegistrationPath[],
  artifact: Readonly<Record<string, unknown>>,
): StarterReceiptAdmission;
export function starterConformanceProjection(
  paths: readonly StarterVerifyRegistrationPath[],
): readonly Readonly<Record<string, unknown>>[];

export interface ReplayAction {
  readonly seq: number;
  readonly actor: string;
  readonly fn?: string | GeneratedOperationReference;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly intent?: string;
  readonly [key: string]: unknown;
}

export interface ReplayQueryOptions {
  readonly args?: Readonly<Record<string, unknown>>;
  readonly pageSize?: number;
  readonly cursorKey?: string;
  readonly pageSizeKey?: string;
}

export interface ReplayMapperContext {
  readonly action: ReplayAction;
  settled(intent: string): unknown | null;
  query(
    reference: string | GeneratedOperationReference,
    options?: ReplayQueryOptions,
  ): Promise<Readonly<{
    rows: readonly unknown[];
    pages: number;
    version: number | null;
  }>>;
}

export interface ReplayDefinition {
  readonly schemaVersion: 'snapback.replay-definition.v1';
  readonly readyFile: string;
  readonly api: string | Readonly<Record<string, unknown>>;
  readonly actions: string | AsyncIterable<ReplayAction>;
  readonly actors: Readonly<{
    kind: 'mint';
    emailFor: ((actor: string) => string | Promise<string>) | string | null;
  }> | Readonly<{
    kind: 'bearer';
    bearerFor: ((actor: string) => string | Promise<string>) | string;
  }>;
  readonly clientPool: number;
  readonly transportCustody: 'minted' | 'none';
  readonly acknowledgeEvery: number;
  readonly acknowledgeBytes: number;
  readonly receiptsFile: string;
  readonly statusFile: string;
  readonly sessionCustodyFile: string;
  readonly settlementProjectionBytes: number;
  readonly checkpointCadenceMs: number;
  readonly mapper: ((context: ReplayMapperContext) => ReplayAction | Promise<ReplayAction>) | string | null;
  readonly settlementProjection:
    | ((result: unknown, action: ReplayAction, outcome: unknown) => unknown | Promise<unknown>)
    | string
    | null;
  readonly idempotent: boolean | ((action: ReplayAction) => boolean | Promise<boolean>) | string;
}

export interface ReplayPreflightReceipt {
  readonly schemaVersion: 'snapback.replay-preflight.v1';
  readonly actions: number;
  readonly resumeEligible: boolean;
  readonly acknowledgeWindow: Readonly<{
    count: number;
    bytes: number;
    maximumSettlementCharge: number;
  }>;
  readonly custody: Readonly<{
    requested: 'minted' | 'none';
    generatedIrReferences: number;
    deferredMapperActions: number;
  }>;
  readonly authorityComposition: Readonly<{
    actors: number;
    authFingerprints: number;
    largestAliasedActorCount: number;
    windowComposition: 'per-auth-fingerprint';
  }> | null;
  readonly advisories: readonly Readonly<{ code: string; message: string }>[];
  readonly ceilings: readonly Readonly<Record<string, unknown>>[];
  readonly unsafe: readonly string[];
}

export interface ReplayReceipt {
  readonly schemaVersion: 'snapback.replay-receipt.v1';
  readonly status: 'passed' | 'failed' | 'detached';
  readonly actions?: Readonly<{
    settled: number;
    failed: number;
    skipped: number;
    acknowledged: number;
    duplicatePossible: number;
    lastSeq: number | null;
    total: number | null;
  }>;
  readonly preflight?: ReplayPreflightReceipt | null;
  readonly custody?: Readonly<Record<string, unknown>>;
  readonly pool?: Readonly<Record<string, unknown>>;
  readonly acknowledgement?: Readonly<Record<string, unknown>>;
  readonly receiptsFile: string;
  readonly receiptsDigest?: string;
  readonly statusFile: string;
  readonly pid?: number;
  readonly diagnostic?: Readonly<Record<string, unknown>> | null;
  readonly finishedAt?: number;
}

export interface ReplayStatus {
  readonly v: 'snapback.replay-status.v1';
  readonly state: 'starting' | 'running' | 'stalled' | 'dead' | 'complete' | 'failed' | 'stopped';
  readonly settled: number;
  readonly failed: number;
  readonly total: number | null;
  readonly lastSeq: number | null;
  readonly pid: number;
  readonly receiptsFile: string;
  readonly statusFile: string;
  readonly updatedAt: number;
  readonly checkpointCadenceMs: number;
  readonly recovery?: 'resume' | 'wait-or-signal';
  readonly diagnostic?: Readonly<Record<string, unknown>> | null;
}

export const REPLAY_DEFINITION_VERSION: 'snapback.replay-definition.v1';
export const REPLAY_RECEIPT_VERSION: 'snapback.replay-receipt.v1';
export const REPLAY_STATUS_VERSION: 'snapback.replay-status.v1';
export const REPLAY_DISPATCH_CARRIER_MAX_BYTES: 1048576;
export const REPLAY_RETAINED_ROW_OVERHEAD_BYTES: 131072;
export const REPLAY_CEILINGS: Readonly<{
  retainedMutationRecordsPerAuthority: 1024;
  retainedMutationBytesPerAuthority: 8388608;
  retainedMutationResultBytes: 65536;
  queryTakeRows: 1024;
  bufferedMutationWrites: 1024;
  seedEffects: 1024;
}>;

export function defineReplay(options: {
  readonly readyFile: string | URL;
  readonly api: string | URL | Readonly<Record<string, unknown>>;
  readonly actions: string | URL | AsyncIterable<ReplayAction>;
  readonly actors?: Readonly<{
    mint: Readonly<{
      emailFor?: ((actor: string) => string | Promise<string>) | string | URL;
    }>;
  }> | Readonly<{
    bearerFor: ((actor: string) => string | Promise<string>) | string | URL;
  }>;
  readonly clientPool?: number;
  readonly transportCustody?: 'minted' | 'none';
  readonly acknowledgeEvery?: number;
  readonly acknowledgeBytes?: number;
  readonly receiptsFile?: string | URL;
  readonly statusFile?: string | URL;
  readonly sessionCustodyFile?: string | URL;
  readonly settlementProjectionBytes?: number;
  readonly checkpointCadenceMs?: number;
  readonly mapper?: ((context: ReplayMapperContext) => ReplayAction | Promise<ReplayAction>) | string | URL;
  readonly settlementProjection?:
    | ((result: unknown, action: ReplayAction, outcome: unknown) => unknown | Promise<unknown>)
    | string
    | URL;
  readonly idempotent?: boolean | ((action: ReplayAction) => boolean | Promise<boolean>) | string | URL;
}): ReplayDefinition;

export function runReplay(
  definition: ReplayDefinition,
  options?: Readonly<{
    resume?: boolean | Readonly<{ ambiguous: 'reexecute' }>;
    detach?: boolean;
    signal?: AbortSignal;
    onPreflight?: (receipt: ReplayPreflightReceipt) => void | Promise<void>;
  }>,
): Promise<Readonly<{ receipt: ReplayReceipt; exitCode: 0 | 1 }>>;

export function readReplayStatus(statusFile: string | URL): ReplayStatus;

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

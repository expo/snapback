export type StarterVerifyPathKind =
  | 'success'
  | 'failure'
  | 'action'
  | 'relational'
  | 'search'
  | 'snapshot-bundle';

export interface GeneratedOperationReference {
  readonly id: string;
  readonly name?: string;
  readonly kind?: string;
}

export interface StarterAcceptancePath {
  readonly id: string;
  readonly kind: StarterVerifyPathKind;
  readonly targetProfileId: string;
  readonly operation: GeneratedOperationReference | null;
  readonly functionId: string | null;
  readonly provenance: 'baseline' | 'none';
  readonly timeoutMs: number | null;
}

export interface StarterAcceptanceArtifacts {
  readonly appId: string;
  readonly inputsHash?: string;
  readonly schemaHash?: string;
  readonly bundleHash?: string;
  readonly [key: string]: unknown;
}

export interface StarterAcceptanceReady {
  readonly ready: true;
  readonly serverUrl: string;
  readonly adminTokenFile?: string;
  readonly [key: string]: unknown;
}

export interface StarterLifecycleStateV1 {
  readonly ready: StarterAcceptanceReady;
  readonly executable?: string | null;
  readonly readyFile?: string | null;
  readonly adminToken?: string | null;
  readonly loadedIdentity?: {
    readonly appId: string;
    readonly bundleHash?: string;
  } | null;
  readonly adminClient?: unknown;
  health?(): { readonly running: boolean; readonly diagnostic?: string | null };
}

export interface StarterLifecycleAdapterV1 {
  readonly schemaVersion: 'snapback.starter-lifecycle-adapter.v1';
  start(input: Readonly<Record<string, unknown>>): Promise<StarterLifecycleStateV1>;
  stop(state: StarterLifecycleStateV1 | null): Promise<{ readonly exited: boolean }>;
}

export interface StarterStepOptions {
  readonly timeoutMs?: number;
}

export interface StarterJourneyContext {
  readonly appRoot: string;
  readonly stateRoot: string;
  readonly ready: StarterAcceptanceReady | null;
  readonly adminClient: any;
  readonly paths: Readonly<Record<string, StarterAcceptancePath>>;
  readonly artifacts: StarterAcceptanceArtifacts;
  readonly bindingFor: (
    app: Readonly<Record<string, any>>,
    options?: { readonly offeredCapabilities?: readonly string[]; readonly supervisorGeneration?: string },
  ) => Readonly<Record<string, unknown>>;
  step(
    pathOrId: StarterAcceptancePath | string,
    callback: () => unknown | Promise<unknown>,
    options?: StarterStepOptions,
  ): Promise<unknown>;
  until<T>(
    predicate: () => T | Promise<T>,
    label: string,
    options?: { readonly timeoutMs?: number; readonly intervalMs?: number },
  ): Promise<T>;
  defer(cleanup: () => void | Promise<void>): void;
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
  readonly preflight: ((context: StarterJourneyContext) => void | Promise<void>) | null;
  readonly journey: (context: StarterJourneyContext) => void | Promise<void>;
}

export interface StarterAcceptanceReceipt {
  readonly schemaVersion: 'snapback.starter-acceptance.v1';
  readonly status: 'passed' | 'failed';
  readonly expectedCheckCount: number;
  readonly executedCheckCount: number;
  readonly checks: readonly Readonly<Record<string, unknown>>[];
  readonly identity: Readonly<Record<string, unknown>>;
  readonly lifecycle: Readonly<Record<string, unknown>>;
  readonly operations: Readonly<Record<string, string>>;
  readonly cleanup: Readonly<Record<string, boolean>>;
  readonly diagnostic: Readonly<Record<string, unknown>> | null;
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
    readonly operation?: GeneratedOperationReference | null;
    readonly provenance?: 'baseline' | 'none';
    readonly timeoutMs?: number;
  }>>;
  readonly stepTimeoutMs?: number;
  readonly readinessTimeoutMs?: number;
  readonly preflight?: (context: StarterJourneyContext) => void | Promise<void>;
  readonly journey: (context: StarterJourneyContext) => void | Promise<void>;
}): StarterAcceptanceDefinition;

export function createManagedDevLifecycleAdapter(): StarterLifecycleAdapterV1;
export function runStarterAcceptance(
  definition: StarterAcceptanceDefinition,
  options?: {
    readonly lifecycle?: StarterLifecycleAdapterV1;
    readonly emit?: boolean;
    readonly environment?: Readonly<Record<string, string | undefined>>;
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
): Readonly<Record<string, unknown>>;

export function projectStarterAcceptanceReceipt(
  outcome: Readonly<Record<string, unknown>>,
): StarterAcceptanceReceipt;
export function parseStarterAcceptanceReceipt(stdout: string): Readonly<Record<string, unknown>>;
export function validatePassingStarterReceipt(
  receipt: unknown,
  registeredPaths: readonly Readonly<Record<string, unknown>>[],
  artifact: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>>;
export function starterConformanceProjection(
  paths: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[];

// Hand-authored declarations for comparator-profile.mjs — the package-owned
// backend-comparison acceptance profile, runner, and receipt authority.

export const COMPARATOR_RECEIPT_SCHEMA_VERSION: 'snapback.comparator-receipt.v1';
export const COMPARATOR_PROFILE_SCHEMA_VERSION: 'snapback.comparator-profile.v1';

/** The five mandatory comparator checks, in execution order. */
export const COMPARATOR_CHECKS: readonly Readonly<{ id: string; name: string }>[];

/** A generated function reference (anything carrying `name`) or its name. */
export type ComparatorFunctionRef =
  | string
  | (Readonly<Record<string, unknown>> & { readonly name: string });

/**
 * The role client a comparator target mints. Checks call these members; a
 * custom `startTarget` adapter must provide all of them.
 */
export interface ComparatorTargetClient {
  readonly principalId: string;
  readonly principalSource: 'sessions-authenticated' | 'dev-asserted' | 'fixture-asserted';
  query(ref: ComparatorFunctionRef, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
  mutate(ref: ComparatorFunctionRef, options?: Readonly<Record<string, unknown>>): Promise<unknown>;
  liveQuery(
    ref: ComparatorFunctionRef,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<ComparatorLiveQueryHandle>;
  subscribeEphemeral(
    ref: ComparatorFunctionRef,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<ComparatorEphemeralOverlay>;
  publishEphemeral(
    ref: ComparatorFunctionRef,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  unsubscribeEphemeral(
    ref: ComparatorFunctionRef,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
  disconnect(connectionId: string): Promise<unknown>;
  inspect(): Promise<unknown>;
}

export interface ComparatorLiveQueryHandle {
  readonly rows: readonly unknown[];
  readonly version?: number;
  dispose?(): void;
}

export interface ComparatorEphemeralOverlay {
  currentEntries(options: { readonly prune: boolean }): unknown[];
  drain(): Promise<unknown>;
  dispose?(): void;
}

export interface ComparatorExtraCheckContext {
  readonly observer: ComparatorTargetClient;
  readonly actor: ComparatorTargetClient;
  readonly observerUserId: string;
  readonly actorUserId: string;
  readonly observerIdentitySource: string;
  readonly actorIdentitySource: string;
  readonly refs: ComparatorProfile['refs'];
}

/** Authoring input closed and frozen by `defineComparatorProfile`. */
export interface ComparatorProfileInput {
  schemaVersion?: 'snapback.comparator-profile.v1';
  id: string;
  title?: string;
  target: {
    backendDirectory: string;
    projectRoot?: string;
    runtimeBinary?: string;
    environment?: Readonly<Record<string, string>>;
  };
  refs: {
    liveQuery: ComparatorFunctionRef;
    liveMutation: ComparatorFunctionRef;
    atomicMutation: ComparatorFunctionRef;
    rejectedMutation: ComparatorFunctionRef;
    presence: ComparatorFunctionRef;
  };
  fixtures: {
    identities: {
      observerUserId: string;
      actorUserId: string;
    };
    live: {
      queryArgs?: Readonly<Record<string, unknown>>;
      mutationArgs?: Readonly<Record<string, unknown>>;
      matches(rows: readonly unknown[], detail: unknown): boolean;
    };
    atomic: {
      mutationArgs?: Readonly<Record<string, unknown>>;
      declaredWrites: readonly string[];
      snapshot(
        client: ComparatorTargetClient,
      ): Record<string, unknown> | Promise<Record<string, unknown>>;
    };
    rejection: {
      mutationArgs?: Readonly<Record<string, unknown>>;
      snapshot(client: ComparatorTargetClient): unknown | Promise<unknown>;
      diagnosticCode?: string;
    };
    presence: {
      scope?: Readonly<Record<string, unknown>>;
      value?: unknown;
      ttlMs: number;
      permissions?: readonly unknown[];
      matches(entry: unknown, phase: 'disconnect' | 'ttl' | 'separation'): boolean;
    };
  };
  extraChecks?: readonly {
    id: string;
    name: string;
    run(context: ComparatorExtraCheckContext): unknown | Promise<unknown>;
  }[];
  requiredCapabilities?: readonly string[];
  nonclaims?: readonly string[];
  setup?:
    | ((clients: {
        readonly observer: ComparatorTargetClient;
        readonly actor: ComparatorTargetClient;
      }) => unknown | Promise<unknown>)
    | null;
}

/** The closed, frozen profile produced by `defineComparatorProfile`. */
export interface ComparatorProfile {
  readonly schemaVersion: 'snapback.comparator-profile.v1';
  readonly id: string;
  readonly title: string;
  readonly target: Readonly<{
    backendDirectory: string;
    projectRoot?: string;
    runtimeBinary?: string;
    environment?: Readonly<Record<string, string>>;
  }>;
  readonly refs: Readonly<{
    liveQuery: ComparatorFunctionRef;
    liveMutation: ComparatorFunctionRef;
    atomicMutation: ComparatorFunctionRef;
    rejectedMutation: ComparatorFunctionRef;
    presence: ComparatorFunctionRef;
  }>;
  readonly fixtures: Readonly<{
    identities: Readonly<{ observerUserId: string; actorUserId: string }>;
    live: Readonly<{
      queryArgs: Readonly<Record<string, unknown>>;
      mutationArgs: Readonly<Record<string, unknown>>;
      matches(rows: readonly unknown[], detail: unknown): boolean;
    }>;
    atomic: Readonly<{
      mutationArgs: Readonly<Record<string, unknown>>;
      declaredWrites: readonly string[];
      snapshot(
        client: ComparatorTargetClient,
      ): Record<string, unknown> | Promise<Record<string, unknown>>;
    }>;
    rejection: Readonly<{
      mutationArgs: Readonly<Record<string, unknown>>;
      snapshot(client: ComparatorTargetClient): unknown | Promise<unknown>;
      diagnosticCode?: string;
    }>;
    presence: Readonly<{
      scope: Readonly<Record<string, unknown>>;
      value: unknown;
      ttlMs: number;
      permissions: readonly unknown[];
      matches(entry: unknown, phase: 'disconnect' | 'ttl' | 'separation'): boolean;
    }>;
  }>;
  readonly extraChecks: readonly Readonly<{
    id: string;
    name: string;
    run(context: ComparatorExtraCheckContext): unknown | Promise<unknown>;
  }>[];
  readonly requiredCapabilities: readonly string[];
  readonly nonclaims: readonly string[];
  readonly setup:
    | ((clients: {
        readonly observer: ComparatorTargetClient;
        readonly actor: ComparatorTargetClient;
      }) => unknown | Promise<unknown>)
    | null;
}

/** Close and freeze the comparator authoring shape. */
export function defineComparatorProfile(input: ComparatorProfileInput): ComparatorProfile;

/** Import a profile module (default or `profile` export) and close it. */
export function loadComparatorProfile(path: string): Promise<ComparatorProfile>;

// ---------------------------------------------------------------------------
// Targets and the runner
// ---------------------------------------------------------------------------

/** Cleanup attestation a comparator target's `close()` must produce. */
export interface ComparatorCleanupResult {
  ok: boolean;
  managed: boolean;
  leaderExited: boolean | null;
  temporaryStateRemoved: boolean;
  errors: readonly unknown[];
}

export interface ComparatorReceiptIdentity {
  readonly target: Readonly<{
    available: boolean;
    kind: string;
    profileId: string;
    serverUrl: string | null;
    databaseMode: string;
    managed: boolean;
  }>;
  readonly artifact: Readonly<{
    available: boolean;
    appId: string | null;
    bundleHash: string | null;
    inputsHash: string | null;
    schemaHash: string | null;
  }>;
  readonly binary: Readonly<{
    available: boolean;
    path: string | null;
    sha256: string | null;
    crateVersion: string | null;
    gitCommit: string | null;
    gitDirty: boolean | null;
    buildProfile: string | null;
    startupNonce: string | null;
  }>;
}

/** A started comparator target (local default or a hosted adapter). */
export interface ComparatorTarget {
  readonly identity: ComparatorReceiptIdentity;
  readonly capabilities?: readonly string[];
  readonly capabilityGaps?: readonly string[];
  createClient(options: {
    readonly role: 'observer' | 'actor';
    readonly userId: string;
  }): ComparatorTargetClient;
  assertAlive?(): void;
  close(): ComparatorCleanupResult | Promise<ComparatorCleanupResult>;
}

/** Explicit dependency seam for hosted adapters and fixture tests. */
export type ComparatorStartTarget = (
  target: ComparatorProfile['target'],
  context: Readonly<{
    profile: ComparatorProfile;
    timeoutMs: number;
    signal: AbortSignal;
  }>,
) => ComparatorTarget | Promise<ComparatorTarget>;

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export type ComparatorReceiptStatus = 'passed' | 'failed' | 'unsupported' | 'infrastructure-error';
export type ComparatorCheckStatus = 'passed' | 'failed' | 'infrastructure-error';

export interface ComparatorReceiptDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface ComparatorCheckResult {
  readonly id: string;
  readonly name: string;
  readonly status: ComparatorCheckStatus;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly durationMs: number;
  readonly details: unknown;
  readonly diagnostic: ComparatorReceiptDiagnostic | null;
}

export interface ComparatorPackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly algorithm: string;
  readonly files: readonly string[];
  readonly sha256: string;
}

export interface ComparatorCapabilityGap {
  readonly id: string;
  readonly blocking: boolean;
  readonly source: 'target-gap' | 'target-capability-manifest';
}

export interface ComparatorReceipt {
  readonly schemaVersion: 'snapback.comparator-receipt.v1';
  readonly profileId: string;
  readonly title: string;
  readonly status: ComparatorReceiptStatus;
  readonly exitCode: 0 | 1 | 2;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly durationMs: number;
  readonly executorPackages: Readonly<{
    cli: ComparatorPackageIdentity;
    client: ComparatorPackageIdentity;
  }>;
  readonly identity: ComparatorReceiptIdentity;
  readonly expectedChecks: readonly Readonly<{ id: string; name: string }>[];
  readonly checks: readonly ComparatorCheckResult[];
  readonly capabilityGaps: readonly ComparatorCapabilityGap[];
  readonly cleanup: Readonly<{
    attempted: boolean;
    ok: boolean;
    managed: boolean;
    leaderExited: boolean | null;
    temporaryStateRemoved: boolean;
    errors: readonly unknown[];
  }>;
  readonly nonclaims: readonly string[];
  readonly diagnostic: ComparatorReceiptDiagnostic | null;
}

/**
 * Run the published five-property comparator profile. The default
 * `startTarget` starts one isolated local Snapback target.
 */
export function runComparatorAcceptance(
  input: ComparatorProfileInput,
  options?: {
    readonly startTarget?: ComparatorStartTarget;
    readonly timeoutMs?: number;
    readonly receiptFile?: string | null;
  },
): Promise<ComparatorReceipt>;

export interface ComparatorReceiptValidationOptions {
  readonly nowMs?: number;
  readonly maxAgeMs?: number | null;
  readonly expectedIdentity?: ComparatorReceiptIdentity | null;
}

/** Closed receipt validator used both at write time and by later aggregators. */
export function validateComparatorReceipt(
  receipt: unknown,
  options?: ComparatorReceiptValidationOptions,
): ComparatorReceipt;

/** Validate and atomically write a receipt; returns the resolved path. */
export function writeComparatorReceipt(path: string, receipt: ComparatorReceipt): string;

/** Read, parse, and validate a retained receipt file. */
export function readComparatorReceipt(
  path: string,
  options?: ComparatorReceiptValidationOptions,
): ComparatorReceipt;

export const __comparatorTest: Readonly<{
  concludeReceipt: (receipt: ComparatorReceipt, infrastructureFailure: unknown) => ComparatorReceipt;
  expectedCheckDefinitions: (
    profile: ComparatorProfile,
  ) => readonly Readonly<{ id: string; name: string }>[];
  sameValue: (left: unknown, right: unknown) => boolean;
}>;

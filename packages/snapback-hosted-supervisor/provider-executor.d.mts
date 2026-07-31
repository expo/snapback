// Type declarations for provider-executor.mjs — supervisor-only executor for
// the closed Fly lifecycle V2 vocabulary (17 operations, one immutable
// applied/notApplied/commitUncertain terminal per attempt).

import type { FlyTargetBinding, HostedControlHead } from './index.mjs';

export type ProviderLifecycleOperation =
  | 'acquireLease'
  | 'renewLease'
  | 'uploadImmutableRelease'
  | 'provisionInactive'
  | 'compatibilityPreflight'
  | 'createVerifiedBackup'
  | 'stageRelease'
  | 'activateGeneration'
  | 'verifyServedPath'
  | 'rollback'
  | 'fenceExternalEffects'
  | 'restoreBackupInactive'
  | 'verifyRestoredComponents'
  | 'verifyRestoredApplication'
  | 'activateRestoredGeneration'
  | 'reconcileEffect'
  | 'releaseLease';

export const PROVIDER_LIFECYCLE_OPERATIONS: readonly ProviderLifecycleOperation[];

/**
 * Operations the current closed V2 carrier cannot safely execute; each maps to
 * the stable human-readable reason surfaced as a `notApplied` terminal.
 */
export const PROVIDER_OPERATION_BLOCKERS: Readonly<Record<ProviderLifecycleOperation, string>>;

export class ProviderExecutorRefusal extends Error {
  constructor(code: string, message: string, status?: number);
  name: 'ProviderExecutorRefusal';
  code: string;
  status: number;
}

/** The closed `snapback.provider-effect-intent.v1` shape (exact field set). */
export interface ProviderEffectIntentV1 {
  readonly schemaVersion: 'snapback.provider-effect-intent.v1';
  readonly operationId: string;
  readonly operation: ProviderLifecycleOperation;
  readonly requestSha256: string;
  readonly semanticEffectId: string;
  readonly targetBindingSha256: string;
  readonly planSha256: string;
  readonly effectKind: string;
  readonly logicalResourceName: string;
  readonly desiredProviderStateSha256: string;
  readonly predecessorHeadSha256: string;
}

export interface DeploymentLease {
  readonly leaseId: string;
  readonly operationId: string;
  readonly targetId: string;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
  readonly expectedActivationGeneration: number;
}

/** The closed `snapback.vm-adapter-lifecycle-request.v2` shape (exact field set). */
export interface AdapterLifecycleRequestV2 {
  readonly schemaVersion: 'snapback.vm-adapter-lifecycle-request.v2';
  readonly operation: ProviderLifecycleOperation;
  readonly operationId: string;
  readonly attempt: number;
  readonly planSha256: string;
  readonly requestSha256: string;
  readonly confirmationSha256: string | null;
  readonly targetBinding: FlyTargetBinding;
  readonly predecessorHead: HostedControlHead;
  readonly effectIntent: ProviderEffectIntentV1;
  readonly lease: DeploymentLease | null;
}

export interface ProviderEffectTerminalV1 {
  readonly schemaVersion: 'snapback.provider-effect-terminal.v1';
  readonly semanticEffectId: string;
  readonly outcome: 'notApplied' | 'applied' | 'commitUncertain';
  readonly recordedAtMs: number;
  readonly reason: string | null;
  readonly recoveryClass: string | null;
  readonly providerVersion: unknown;
  readonly lastObservationSha256: string | null;
  readonly redactedEvidenceSha256: string | null;
  readonly retainedResultSha256: string | null;
}

export interface ProviderEffectObservationV1 {
  readonly schemaVersion: 'snapback.provider-effect-observation.v1';
  readonly semanticEffectId: string;
  readonly providerRequestSha256: `sha256:${string}`;
  readonly providerUri: string;
  readonly observedAtMs: number;
  readonly providerRevision: unknown;
}

export interface ProviderExecutorDiagnostic {
  readonly code: string;
  readonly severity: 'error';
  readonly message: string;
}

export interface AdapterLifecycleResponseV2 {
  readonly schemaVersion: 'snapback.vm-adapter-lifecycle-response.v2';
  readonly operation: ProviderLifecycleOperation;
  readonly operationId: string;
  readonly ok: boolean;
  readonly idempotentReplay: boolean;
  readonly remoteEvidence: boolean;
  readonly requestSha256: string;
  readonly terminal: ProviderEffectTerminalV1;
  readonly controlHead: HostedControlHead;
  readonly observation: ProviderEffectObservationV1 | null;
  readonly diagnostics: readonly ProviderExecutorDiagnostic[];
}

/** Minimal structural view of the HTTP response the executor consumes. */
export interface ProviderHttpResponse {
  readonly status: number;
  readonly headers?: Readonly<{ get?(name: string): string | null | undefined }>;
  readonly body: AsyncIterable<Uint8Array | string>;
}

export type ProviderFetch = (
  url: string,
  init?: Readonly<{
    method?: string;
    headers?: Readonly<Record<string, string>>;
    signal?: unknown;
  }>,
) => Promise<ProviderHttpResponse>;

export interface TigrisControlHeadRead {
  readonly bytes: Uint8Array | readonly number[] | string;
  readonly version: string | number;
}

export interface ProviderLifecycleExecutor {
  execute(
    input: AdapterLifecycleRequestV2,
    hooks?: Readonly<{
      /** Awaited after the durable effecting observation, before the provider effect. */
      beforeProviderEffect?: (observation: ProviderEffectObservationV1) => unknown | Promise<unknown>;
    }>,
  ): Promise<AdapterLifecycleResponseV2>;
}

export function createFlyTigrisProviderExecutor(options?: Readonly<{
  fetchImpl?: ProviderFetch;
  resolveFlyControlToken?: (
    binding: FlyTargetBinding,
  ) => string | null | undefined | Promise<string | null | undefined>;
  readTigrisControlHead?: (
    binding: FlyTargetBinding,
  ) => TigrisControlHeadRead | Promise<TigrisControlHeadRead>;
  writeTigrisControlHead?: unknown;
  flyApiBase?: string;
  now?: () => number;
}>): ProviderLifecycleExecutor;

export const __providerExecutorTest: Readonly<{
  HEAD_KEYS: readonly string[];
  INTENT_KEYS: readonly string[];
  LEASE_KEYS: readonly string[];
  REQUEST_KEYS: readonly string[];
  bindingSha256: (binding: unknown) => `sha256:${string}`;
  headSha256: (head: unknown) => `sha256:${string}`;
}>;

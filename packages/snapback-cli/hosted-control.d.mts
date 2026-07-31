// Hand-authored declarations for hosted-control.mjs — the deliberately closed
// hosted command surface (read commands, signed operator requests, and the
// fail-closed lifecycle registry).

import type {
  AuthenticatedInspectionResult,
  AdapterQueryOptions,
  ControlPlaneOptions,
  ControlLogsResult,
} from './deployment-control.mjs';

export type HostedLifecycleVerb =
  | 'acquire-lease'
  | 'renew-lease'
  | 'upload-immutable-release'
  | 'provision-inactive'
  | 'compatibility-preflight'
  | 'create-verified-backup'
  | 'stage-release'
  | 'activate-generation'
  | 'verify-served-path'
  | 'rollback'
  | 'fence-external-effects'
  | 'restore-backup-inactive'
  | 'verify-restored-components'
  | 'verify-restored-application'
  | 'activate-restored-generation'
  | 'reconcile-effect'
  | 'release-lease';

/** Closed CLI verb → adapter operation map. */
export const HOSTED_LIFECYCLE_VERBS: Readonly<Record<HostedLifecycleVerb, string>>;

export type HostedCommandEntry =
  | Readonly<{ kind: 'read'; operation: string }>
  | Readonly<{
      kind: 'lifecycle';
      operation: string;
      availability: 'disabled';
      blockerCode: string;
    }>;

/** Closed registry of every hosted command spelling. */
export const HOSTED_COMMAND_REGISTRY: Readonly<Record<string, HostedCommandEntry>>;

export type HostedSchemaName =
  | 'flyTargetBindingV2'
  | 'hostedControlHeadV2'
  | 'lifecycleRequestV2'
  | 'lifecycleResponseV2';

/** Package-relative paths of the shipped driver and generated schemas. */
export const HOSTED_ASSETS: Readonly<{
  flyDriver: string;
  schemas: Readonly<Record<HostedSchemaName, string>>;
}>;

export interface HostedAssetResolution {
  flyDriver: string;
  flyDriverSha256: string;
  schemas: Readonly<Record<HostedSchemaName, string>>;
  schemaSha256: Readonly<Record<HostedSchemaName, string>>;
}

/** Resolve and digest the packaged driver and schema assets on disk. */
export function resolveHostedAssets(): HostedAssetResolution;

export interface HostedCommandPlan {
  readonly schemaVersion: 'snapback.hosted-command-plan.v1';
  readonly ok: true;
  readonly targetId: string | null;
  readonly targetDescriptorSha256: string | null;
  readonly driver: Readonly<{
    kind: 'fly-machines';
    sha256: string;
    lifecycleAvailability: 'disabled';
    blockerCode: string;
    requiredEvidence: readonly string[];
  }>;
  readonly commands: readonly (Readonly<{ command: string }> & HostedCommandEntry)[];
  readonly schemas: Readonly<Record<HostedSchemaName, string>>;
}

export function createHostedPlan(options?: ControlPlaneOptions & {
  readonly targetId?: string | null;
}): HostedCommandPlan;

/** Read commands reuse the target-neutral control plane. */
export function runHostedRead(
  operation: 'inspect',
  options: ControlPlaneOptions & AdapterQueryOptions & { readonly targetId: string },
): AuthenticatedInspectionResult;
export function runHostedRead(
  operation: 'logs',
  options: ControlPlaneOptions & AdapterQueryOptions & { readonly targetId: string },
): ControlLogsResult;

// ---------------------------------------------------------------------------
// Signed operator transport
// ---------------------------------------------------------------------------

export interface SupervisorResponseBodyV1 {
  readonly schemaVersion: 'snapback.supervisor-response-body.v1';
  readonly ok: boolean;
  readonly result: unknown;
  readonly diagnostic: Readonly<{ code: string; message: string; status: number }> | null;
}

export interface SupervisorServiceIntermediateV1 {
  readonly schemaVersion: 'snapback.supervisor-service-intermediate.v1';
  readonly installationId: string;
  readonly intermediateKeyId: string;
  readonly rootKeyId: string;
  readonly purpose: 'supervisor-response';
  readonly publicKeyEd25519: string;
  readonly serial: number;
  readonly revocationGeneration: number;
  readonly issuedAt: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly signature: string;
}

export interface SupervisorResponseV1 {
  readonly schemaVersion: 'snapback.supervisor-response.v1';
  readonly audience: 'snapback-operator';
  readonly installationId: string;
  readonly requestId: string;
  readonly requestSha256: string;
  readonly operatorCertificateSha256: string;
  readonly keyId: string;
  readonly issuedAt: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly supervisorIncarnation: string;
  readonly supervisorGeneration: number;
  readonly supervisorHeadSha256: string;
  readonly targetHeadSha256: string | null;
  readonly body: SupervisorResponseBodyV1;
  readonly bodySha256: string;
  readonly serviceIntermediate: SupervisorServiceIntermediateV1;
  readonly signature: string;
}

export interface HostedOperatorTransportRequest {
  readonly requestBytes: Uint8Array;
  readonly key: Uint8Array;
  readonly cert: Uint8Array;
  readonly ca: Uint8Array;
  readonly serverCertificateSha256: string;
  readonly timeoutMs: number;
}

/**
 * Submit a device-signed SupervisorRequestV1 file over certificate-pinned
 * mTLS and verify the doubly signed response before returning it.
 */
export function submitHostedOperatorRequest(options: {
  readonly requestPath: string;
  readonly endpoint: string;
  readonly clientKeyPath: string;
  readonly clientCertificatePath: string;
  readonly serverCaPath: string;
  readonly rootPublicKeyPath: string;
  readonly serverCertificateSha256: string;
  readonly timeoutMs?: number;
  readonly transport?: (
    endpoint: string,
    request: HostedOperatorTransportRequest,
  ) => Promise<unknown>;
}): Promise<SupervisorResponseV1>;

/** Structured fail-closed refusal every lifecycle verb currently returns. */
export interface HostedLifecycleRefusal {
  readonly schemaVersion: 'snapback.hosted-lifecycle-refusal.v1';
  readonly ok: false;
  readonly operation: string;
  readonly operationId: string;
  readonly code: string;
  readonly requestFileSha256: string;
  readonly diagnostics: readonly Readonly<{
    code: string;
    severity: 'error';
    message: string;
  }>[];
}

/**
 * Validate a generated AdapterLifecycleRequestV2 carrier and refuse it with a
 * structured blocker while the reviewed closed carrier gate is in place.
 */
export function invokeHostedLifecycle(
  verb: HostedLifecycleVerb,
  options: {
    readonly requestPath: string;
    readonly operatorRequestPath?: string;
    readonly endpoint?: string;
    readonly clientKeyPath?: string;
    readonly clientCertificatePath?: string;
    readonly serverCaPath?: string;
    readonly rootPublicKeyPath?: string;
    readonly serverCertificateSha256?: string;
    readonly timeoutMs?: number;
    readonly submitOperatorRequest?: typeof submitHostedOperatorRequest;
  },
): Promise<HostedLifecycleRefusal>;

export const __hostedControlTest: Readonly<{
  LIFECYCLE_REQUEST_KEYS: readonly string[];
  MAX_REQUEST_BYTES: number;
  OPERATOR_RESPONSE_KEYS: readonly string[];
  verifyOperatorResponse: (
    response: unknown,
    request: unknown,
    rootPublicKeyPem: string | Uint8Array,
  ) => SupervisorResponseV1;
}>;

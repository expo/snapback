// Type declarations for operator-authority.mjs — the standing supervisor's
// operator boundary: request admission, canonical response replay, per-device
// revocation, and bounded release-upload transitions.

/** Special-authority classes named by the closed request registry. */
export type SupervisorRequestAuthority =
  | 'scope'
  | 'enrollment-bundle'
  | 'certificate-self'
  | 'recovery-bootstrap'
  | 'scope-and-recovery-threshold'
  | 'recovery-threshold'
  | 'local-recovery-threshold'
  | 'recovery-owner-and-target-proof'
  | 'scope-and-explicit-approval';

export type SupervisorScope =
  | 'operator.enroll'
  | 'operator.admin'
  | 'root.admin'
  | 'target.register'
  | 'supervisor.read'
  | 'release.upload'
  | 'deploy.plan'
  | 'deploy.confirm'
  | 'deploy.apply'
  | 'deploy.reconcile'
  | 'backup.plan'
  | 'backup.confirm'
  | 'backup.apply'
  | 'backup.reconcile'
  | 'restore.plan'
  | 'restore.confirm'
  | 'restore.apply'
  | 'restore.activate'
  | 'restore.reconcile'
  | 'rollback.plan'
  | 'rollback.confirm'
  | 'rollback.apply'
  | 'rollback.reconcile'
  | 'cleanup.plan'
  | 'cleanup.confirm'
  | 'cleanup.apply'
  | 'cleanup.reconcile'
  | 'capability.publish'
  | 'capability.withdraw';

export interface SupervisorRequestRegistryEntry {
  readonly authority: SupervisorRequestAuthority;
  readonly credentialBearing: boolean;
  readonly scopes: readonly SupervisorScope[];
}

export const SUPERVISOR_REQUEST_REGISTRY: Readonly<Record<string, SupervisorRequestRegistryEntry>>;
export const SUPERVISOR_SCOPE_VOCABULARY: readonly SupervisorScope[];

export class OperatorAuthorityRefusal extends Error {
  constructor(code: string, message: string, status?: number, details?: unknown);
  name: 'OperatorAuthorityRefusal';
  code: string;
  status: number;
  details?: unknown;
}

/**
 * Canonical JSON over the authority value vocabulary (safe integers only);
 * refuses non-JSON-compatible values.
 */
export function canonicalAuthorityJson(value: unknown): string;

/** The closed `snapback.supervisor-request.v1` shape (exact field set). */
export interface SupervisorRequestV1 {
  readonly schemaVersion: 'snapback.supervisor-request.v1';
  readonly installationId: string;
  readonly rootKeyId: string;
  readonly deviceId: string;
  readonly deviceKeyId: string;
  readonly subject: string;
  readonly requestId: string;
  readonly variant: string;
  readonly scope: string | null;
  readonly sequence: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly certificateExpiresAtMs: number;
  readonly certificateRevocationGeneration: number;
  readonly observedRevocationGeneration: number;
  readonly operatorCertificateSha256: string;
  readonly targetHeadSha256: string | null;
  readonly body: unknown;
  readonly bodySha256: string;
  readonly credentialBearing: boolean;
  readonly signature: string;
}

export function operatorRequestSigningBytes(request: SupervisorRequestV1): Uint8Array;
export function operatorRequestBodySha256(body: unknown): `sha256:${string}`;
/** Validates the closed request shape, then digests its canonical bytes. */
export function operatorRequestCanonicalSha256(request: SupervisorRequestV1): `sha256:${string}`;

export interface OperatorDeviceRecord {
  deviceId: string;
  deviceKeyId: string;
  subject: string;
  publicKeyPem: string;
  effectiveScopes: SupervisorScope[];
  certificateSha256: string;
  certificateExpiresAtMs: number;
  certificateRevocationGeneration: number;
  status: 'active' | 'revoked';
  revokedAtGeneration: number | null;
  revokedAtMs?: number;
  enrolledAtMs: number;
  lastSequence: number;
}

export type RetainedResponseRef =
  | Readonly<{
      kind: 'inline';
      sha256: `sha256:${string}`;
      bytes: string;
      byteLength: number;
      retainedAtMs: number;
      retainUntilMs: number;
    }>
  | Readonly<{
      kind: 'object';
      sha256: `sha256:${string}`;
      objectKey: string;
      objectGeneration: number;
      byteLength: number;
      retainedAtMs: number;
      retainUntilMs: number;
    }>;

export interface RetainedOperatorRequest {
  requestId: string;
  requestSha256: string;
  requestCanonical: string;
  installationId: string;
  rootKeyId: string;
  deviceId: string;
  sequence: number;
  variant: string;
  scope: string | null;
  targetHeadSha256: string | null;
  credentialBearing: boolean;
  response: RetainedResponseRef;
  committedAtMs: number;
}

export interface PendingOperatorRequest {
  requestId: string;
  requestSha256: string;
  requestCanonical: string;
  installationId: string;
  rootKeyId: string;
  deviceId: string;
  sequence: number;
  variant: string;
  scope: string | null;
  targetHeadSha256: string | null;
  credentialBearing: boolean;
  reservedAtMs: number;
}

export interface OperatorResponseTombstone {
  requestId: string;
  requestSha256: string;
  responseSha256: string;
  deletedAtMs: number;
  terminal: true;
}

export interface ReleaseUploadState {
  attemptId: string;
  declaredBytes: number;
  declaredSha256: string;
  spendReservationId: string;
  temporaryObjectKey: string;
  requestId: string;
  state: 'reserved' | 'receiving' | 'complete' | 'cleanupOnly';
  receivedBytes: number;
  reservedAtMs: number;
  lastProgressAtMs: number;
  terminalAtMs: number | null;
  immutableObjectKey: string | null;
  actualSha256: string | null;
  cleanupDueAtMs: number | null;
  unusedSpendReleased: boolean;
}

/** The `snapback.supervisor-operator-authority-state.v1` snapshot. */
export interface SupervisorOperatorAuthorityState {
  schemaVersion: 'snapback.supervisor-operator-authority-state.v1';
  installationId: string;
  rootKeyId: string;
  operatorRevocationGeneration: number;
  devices: Record<string, OperatorDeviceRecord>;
  requestJournal: Record<string, RetainedOperatorRequest>;
  sequenceJournal: Record<string, Record<string, string>>;
  responseObjects: Record<string, { sha256: `sha256:${string}`; generation: number; bytes: string }>;
  responseTombstones: Record<string, OperatorResponseTombstone>;
  pendingRequests: Record<string, PendingOperatorRequest>;
  pendingUploads: Record<string, {
    request: SupervisorRequestV1;
    requestCanonical: string;
    requestSha256: string;
  }>;
  uploads: Record<string, ReleaseUploadState>;
  createdAtMs: number;
  updatedAtMs: number;
}

export type VerifySpecialAuthority = (input: {
  request: SupervisorRequestV1;
  authority: SupervisorRequestAuthority;
}) => boolean;

export type OperatorRequestExecutor = (input: {
  request: SupervisorRequestV1;
  state: SupervisorOperatorAuthorityState;
}) => unknown;

export interface ReleaseUploadReservationAck {
  readonly schemaVersion: 'snapback.release-upload-reservation.v1';
  readonly ok: true;
  readonly requestId: string;
  readonly attemptId: string;
  readonly temporaryObjectKey: string;
  readonly declaredBytes: number;
  readonly idleDeadlineMs: number;
  readonly totalDeadlineMs: number;
}

export interface ReleaseUploadPendingStatus {
  readonly schemaVersion: 'snapback.release-upload-pending.v1';
  readonly ok: true;
  readonly requestId: string;
  readonly state: 'reserved' | 'receiving' | 'complete' | 'cleanupOnly';
  readonly receivedBytes: number;
}

export interface ReleaseUploadProgress {
  readonly schemaVersion: 'snapback.release-upload-progress.v1';
  readonly ok: true;
  readonly requestId: string;
  readonly receivedBytes: number;
  readonly declaredBytes: number;
}

export type ReleaseUploadReceipt =
  | Readonly<{
      schemaVersion: 'snapback.release-upload-receipt.v1';
      ok: true;
      requestId: string;
      releaseSha256: `sha256:${string}`;
      receivedBytes: number;
      immutableObjectKey: string;
      spendReservationId: string;
      completedAtMs: number;
    }>
  | Readonly<{
      schemaVersion: 'snapback.release-upload-receipt.v1';
      ok: false;
      requestId: string;
      code: string;
      receivedBytes: number;
      declaredBytes: number;
      declaredSha256: string;
      actualSha256: string | null;
      temporaryObjectKey: string;
      cleanupOnly: true;
      cleanupDueAtMs: number;
      unusedSpendReleased: true;
      terminalAtMs: number;
    }>;

export type OperatorRequestReservation =
  | Readonly<{ state: 'terminal'; response: unknown; recovered: true }>
  | Readonly<{ state: 'reserved'; response: null; recovered: boolean }>;

export class SupervisorOperatorAuthority {
  constructor(options:
    | {
        installationId: string;
        rootKeyId: string;
        nowMs?: number;
        state?: undefined;
      }
    | {
        installationId?: string;
        rootKeyId?: string;
        nowMs?: number;
        state: SupervisorOperatorAuthorityState;
      });

  snapshot(): SupervisorOperatorAuthorityState;

  registerDevice(options: Readonly<{
    deviceId: string;
    deviceKeyId: string;
    subject: string;
    publicKeyPem: string;
    effectiveScopes: readonly SupervisorScope[];
    certificateSha256: string;
    certificateExpiresAtMs: number;
    certificateRevocationGeneration?: number;
    nowMs?: number;
  }>): OperatorDeviceRecord;

  revokeDevice(deviceId: string, options?: Readonly<{ nowMs?: number }>): OperatorDeviceRecord;

  reserveRequest(request: SupervisorRequestV1, options?: Readonly<{
    nowMs?: number;
    verifySpecialAuthority?: VerifySpecialAuthority;
  }>): OperatorRequestReservation;

  settleReservedRequest(
    request: SupervisorRequestV1,
    response: unknown,
    options?: Readonly<{ nowMs?: number }>,
  ): unknown;

  handleRequest(request: SupervisorRequestV1, options?: Readonly<{
    nowMs?: number;
    /** Required for a new request; exact replays return without executing. */
    execute?: OperatorRequestExecutor;
    verifySpecialAuthority?: VerifySpecialAuthority;
  }>): unknown;

  handleRequestAsync(request: SupervisorRequestV1, options?: Readonly<{
    nowMs?: number;
    execute?: (input: {
      request: SupervisorRequestV1;
      state: SupervisorOperatorAuthorityState;
    }) => unknown | Promise<unknown>;
    verifySpecialAuthority?: VerifySpecialAuthority;
  }>): Promise<unknown>;

  beginReleaseUpload(
    request: SupervisorRequestV1,
    upload: Readonly<{
      attemptId: string;
      declaredBytes: number;
      declaredSha256: string;
      spendReservationId: string;
      temporaryObjectKey: string;
    }>,
    options?: Readonly<{ nowMs?: number; verifySpecialAuthority?: VerifySpecialAuthority }>,
  ): ReleaseUploadReservationAck | ReleaseUploadPendingStatus | ReleaseUploadReceipt;

  appendReleaseUploadChunk(input: Readonly<{
    requestId: string;
    bytes: Uint8Array | string;
    nowMs?: number;
  }>): ReleaseUploadProgress | ReleaseUploadReceipt;

  finishReleaseUpload(input: Readonly<{ requestId: string; nowMs?: number }>): ReleaseUploadReceipt;

  abortReleaseUpload(requestId: string, options?: Readonly<{
    code?: string;
    nowMs?: number;
  }>): ReleaseUploadReceipt;

  reconcileOpenUploads(options?: Readonly<{ nowMs?: number }>): ReleaseUploadReceipt[];

  garbageCollectResponse(requestId: string, options?: Readonly<{ nowMs?: number }>): OperatorResponseTombstone;
}

export const __operatorAuthorityTest: Readonly<{
  INLINE_RESPONSE_BYTES: number;
  MAX_RESPONSE_BYTES: number;
  MAX_UPLOAD_BYTES: number;
  MAX_UPLOAD_TOTAL_MS: number;
  MAX_UPLOAD_IDLE_MS: number;
  REQUEST_KEYS: readonly string[];
  REQUEST_SCHEMA_VERSION: 'snapback.supervisor-request.v1';
  STATE_SCHEMA_VERSION: 'snapback.supervisor-operator-authority-state.v1';
  randomRequestId: () => string;
}>;

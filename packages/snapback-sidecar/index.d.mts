import type {
  EnvironmentVariables,
  ReadyDescriptor,
  ResolvedRuntime,
  RuntimeSelectionOptions,
} from '@expo/snapback-cli';

export type SidecarState = 'idle' | 'starting' | 'attached' | 'swapping' | 'stopping' | 'failed';
export const SIDECAR_STATES: readonly SidecarState[];

export class SidecarError extends Error {
  constructor(code: string, message: string, details?: unknown, options?: ErrorOptions);
  name: string;
  code: string;
  details?: unknown;
  toJSON(): Readonly<Record<string, unknown>>;
}

export class SidecarChildDiedError extends SidecarError {
  constructor(options: Readonly<{
    pid: number | null;
    exitCode: number | null;
    signal: string | null;
    generation: number;
    restartAttempt?: number;
  }>);
  name: 'SidecarChildDiedError';
  code: 'SIDECAR_CHILD_DIED';
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  generation: number;
  restartAttempt: number;
}

export class SidecarSwapError extends SidecarError {
  name: 'SidecarSwapError';
  code: 'SIDECAR_SWAP_FAILED';
  attached: 'old' | 'new';
  attachment: SidecarAttachment | null;
}

export interface OwnerOnlyCapabilityHandle {
  readonly kind: 'admin-token' | 'secret-read-root' | 'impersonation';
  readonly path: string;
  readonly available: true;
  /** Re-attest the startup nonce, then return the owner-custodied secret.
   * The handle's inspection and JSON forms always redact this value. */
  read(): Promise<string>;
  toJSON(): Readonly<{ kind: string; path: string; available: true; secret: '[REDACTED]' }>;
}

export interface SidecarCapabilities {
  readonly adminToken: OwnerOnlyCapabilityHandle;
  readonly secretReadRoot: OwnerOnlyCapabilityHandle;
  readonly impersonation: OwnerOnlyCapabilityHandle;
}

export interface SidecarHealthyStart {
  readonly attested: true;
  readonly checkedAtMs: number;
  readonly descriptorSha256: `sha256:${string}`;
  readonly startupNonce: string;
  readonly requestedPort: 0;
  readonly actualPort: number;
}

export interface SidecarAttachment {
  readonly schemaVersion: 'snapback.desktop-sidecar.v1';
  readonly generation: number;
  readonly purpose: string;
  readonly pid: number;
  readonly url: string;
  readonly port: number;
  readonly database: Readonly<{ mode: string; path?: string }>;
  readonly runtime: ResolvedRuntime;
  readonly descriptor: ReadyDescriptor & Readonly<{
    startupId: string;
    startupNonce: string;
    host: string;
    port: number;
    secretReadRootFile: string;
  }>;
  readonly capabilities: SidecarCapabilities;
  readonly healthyStart: SidecarHealthyStart;
}

export interface SidecarStopReceipt {
  readonly schemaVersion: 'snapback.desktop-sidecar-stop.v1';
  readonly alreadyStopped?: boolean;
  readonly pid?: number;
  readonly graceful: boolean;
  readonly stopStatus?: number | null;
  readonly stopSignal?: string | null;
  readonly childExited?: boolean;
  readonly descriptorRemoved?: boolean;
  readonly healthUnavailable?: boolean;
  readonly escalatedTo?: 'SIGTERM' | 'SIGKILL' | null;
}

export interface SidecarArtifactGeneration {
  readonly schemaVersion: string;
  readonly appId: string;
  readonly schemaHash: string;
  readonly bundleHash: string;
  readonly inputsHash: string;
}

export interface SidecarFreshSnapshotBarrierV1 {
  readonly schemaVersion: 'snapback.outbox-fresh-snapshot-barrier.v1';
  readonly status: 'passed';
  readonly kind: 'full-snapshot';
}

/** Authoritative predecessor cut for one explicitly shared caller-owned
 * sidecar store. Default per-origin stores never produce this handoff. */
export interface SidecarStoreHandoffSnapshotV1 {
  readonly schemaVersion: 'snapback.desktop-sidecar-store-handoff.v1';
  readonly clientStoreId: string;
  readonly writer: true;
  readonly artifactGeneration: SidecarArtifactGeneration;
  readonly pending: number;
  readonly failed: number;
  readonly quarantined: number;
  readonly resultGone: number;
}

export interface SidecarOutboxBindingV1 {
  readonly attachedUrl: string;
}

export interface SidecarOutboxBindingV2 {
  readonly schemaVersion: 'snapback.desktop-sidecar-binding.v2';
  readonly attachedUrl: string;
  readonly startupNonce: string;
  readonly clientStoreId: string;
  readonly writer: true;
  readonly freshSnapshotBarrier: SidecarFreshSnapshotBarrierV1;
  readonly artifactGeneration: SidecarArtifactGeneration;
}

export type SidecarOutboxBinding = SidecarOutboxBindingV1 | SidecarOutboxBindingV2;

export interface SidecarOutboxLease {
  readonly snapshot?: unknown;
  /** Resolve only after in-flight submissions have settled back into durable
   * client custody or completed. Pending durable intents may remain queued. */
  settled?(): Promise<void>;
  /** The application owns its data client. Replace or repoint that client to
   * this exact attachment before any queued replay is attempted. */
  rebind(context: Readonly<{
    outcome: 'swapped' | 'rolled-back' | 'recovered-new' | 'unchanged';
    attachment: SidecarAttachment;
    snapshot: unknown;
  }>): Promise<SidecarOutboxBinding>;
  /** Resume through a supported adoption path, or report the app store's
   * authoritative pending count when cross-client adoption is unavailable.
   * A swap does not commit unless this receipt attests the selected URL and
   * zero pending intents. */
  resume(context: Readonly<{
    outcome: 'swapped' | 'rolled-back' | 'recovered-new' | 'unchanged';
    attachment: SidecarAttachment;
    snapshot: unknown;
    binding: SidecarOutboxBinding;
  }>): Promise<SidecarOutboxResumeReceipt>;
}

export interface SidecarOutboxResumeReceiptV1 {
  readonly schemaVersion: 'snapback.desktop-sidecar-outbox-resume.v1';
  readonly attachedUrl: string;
  readonly replayed: number;
  readonly remaining: number;
  readonly failed?: number;
  readonly stopped?: boolean;
}

export interface SidecarOutboxResumeReceiptV2 {
  readonly schemaVersion: 'snapback.desktop-sidecar-outbox-resume.v2';
  readonly attachedUrl: string;
  readonly startupNonce: string;
  readonly clientStoreId: string;
  readonly writer: true;
  readonly freshSnapshotBarrier: SidecarFreshSnapshotBarrierV1;
  readonly artifactGeneration: SidecarArtifactGeneration;
  readonly pendingBefore: number;
  readonly replayed: number;
  readonly failedDelta: number;
  readonly quarantinedDelta: number;
  readonly resultGoneDelta: number;
  readonly remaining: number;
  readonly stopped: boolean;
}

export type SidecarOutboxResumeReceipt =
  | SidecarOutboxResumeReceiptV1
  | SidecarOutboxResumeReceiptV2;

export interface SidecarOutboxAdapter {
  quiesce(context: Readonly<{
    reason: 'runtime-swap';
    attachment: SidecarAttachment;
    from: ResolvedRuntime;
    to: ResolvedRuntime;
  }>): Promise<SidecarOutboxLease>;
  status?(): Promise<unknown>;
}

export interface SidecarRestartDecisionContext {
  readonly error: SidecarChildDiedError;
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface SidecarRestartPolicy {
  readonly mode?: 'surface' | 'restart';
  readonly maxAttempts?: number;
  readonly backoffMs?: number | ((attempt: number) => number);
  readonly decide?: (
    context: SidecarRestartDecisionContext,
  ) => 'surface' | 'restart' | Promise<'surface' | 'restart'>;
}

export interface SidecarEvent {
  readonly schemaVersion: 'snapback.desktop-sidecar.v1';
  readonly atMs: number;
  readonly state: SidecarState;
  readonly type: string;
  readonly attachment?: SidecarAttachment;
  readonly error?: SidecarChildDiedError;
  readonly [fact: string]: unknown;
}

export interface SidecarSwapReceipt {
  readonly schemaVersion: 'snapback.desktop-sidecar-swap-receipt.v1';
  readonly swapId: string;
  readonly outcome: 'swapped';
  readonly fromPid: number;
  readonly toPid: number;
  readonly from: ResolvedRuntime;
  readonly to: ResolvedRuntime;
  readonly attachment: SidecarAttachment;
  readonly outboxSnapshot: unknown;
  readonly outboxResume: SidecarOutboxResumeReceipt;
}

export interface SidecarSupervisorOptions extends RuntimeSelectionOptions {
  readonly database: string;
  readonly projectRoot?: string;
  readonly stateDirectory?: string;
  readonly startArgs?: readonly string[];
  readonly readyTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
  readonly healthTimeoutMs?: number;
  readonly env?: EnvironmentVariables;
  readonly serverStdio?: unknown;
  readonly fetch?: typeof globalThis.fetch;
  readonly restartPolicy?: SidecarRestartPolicy;
  readonly outbox?: SidecarOutboxAdapter;
  readonly upgradeRequiredCodes?: readonly string[];
  /** LLP 0081 attachment seam only: observe/classify the refusal and hand it
   * to app-owned quarantine UX. This package does not tombstone/re-enter. */
  readonly onUpgradeRequired?: (context: Readonly<{
    error: unknown;
    from: ResolvedRuntime;
    attempted: ResolvedRuntime;
    outboxSnapshot: unknown;
  }>) => void | Promise<void>;
}

export class SnapbackSidecarSupervisor {
  constructor(options: SidecarSupervisorOptions);
  readonly projectRoot: string;
  readonly database: string;
  readonly stateDirectory: string;
  readonly readyFile: string;
  readonly attachment: SidecarAttachment | null;
  readonly lastError: SidecarChildDiedError | null;
  status(): Readonly<{
    schemaVersion: 'snapback.desktop-sidecar.v1';
    state: SidecarState;
    attachment: SidecarAttachment | null;
    lastError: SidecarChildDiedError | null;
    restartPolicy: Readonly<{ maxAttempts: number }>;
  }>;
  subscribe(listener: (event: SidecarEvent) => void): () => void;
  start(): Promise<SidecarAttachment>;
  stop(): Promise<SidecarStopReceipt>;
  health(): Promise<Readonly<{
    schemaVersion: 'snapback.desktop-sidecar-health.v1';
    ok: true;
    pid: number;
    url: string;
    startupNonce: string;
    checkedAtMs: number;
  }>>;
  swap(options?: Readonly<{
    runtime?: RuntimeSelectionOptions;
    /** Candidate check before the swap commits. It is an updater/app hook,
     * not an LLP 0123 package-sealing claim. */
    verifyCandidate?: (attachment: SidecarAttachment) => void | Promise<void>;
  }>): Promise<SidecarSwapReceipt>;
}

export function createSidecarSupervisor(
  options: SidecarSupervisorOptions,
): SnapbackSidecarSupervisor;

export function validateHostReadyDescriptor(
  descriptor: ReadyDescriptor,
  context: Readonly<{
    readyFile: string;
    database: string;
    childPid?: number | null;
    allowNonLoopback?: boolean;
  }>,
): SidecarAttachment['descriptor'];

export function isUpgradeRequiredRefusal(
  error: unknown,
  additionalCodes?: readonly string[],
): boolean;

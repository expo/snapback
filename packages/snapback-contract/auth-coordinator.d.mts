export const SNAPBACK_AUTH_CUSTODY_FORMAT_VERSION: 2;
export const SNAPBACK_AUTH_SENDER_CUSTODY_FORMAT_VERSION: 3;
export const AUTH_CUSTODY_DATABASE_NAME: 'snapback-auth-custody';
export const AUTH_CUSTODY_DATABASE_VERSION: 1;
export const AUTH_CUSTODY_LEASE_MS: number;
export const AUTH_CUSTODY_LEASE_RENEW_MS: number;
export const AUTH_CUSTODY_SUPERSEDED_WAIT_MS: number;

export type SnapbackAuthMode = 'dev' | 'sessions';
export type SnapbackAuthCustodyPhase = 'settled' | 'clearing' | 'exhausted';

export type SnapbackClientAuthority =
  | {
      kind: 'anonymous';
      authMode: SnapbackAuthMode;
      authorizationStreamIncarnation: string;
    }
  | {
      kind: 'session';
      authMode: 'sessions';
      authorizationStreamIncarnation: string;
      sessionId: string;
      userId: string;
    };

export type SnapbackClientAuthorityView = SnapbackClientAuthority & {
  readonly isAuthenticated: boolean;
};

export interface SnapbackSenderPublicJwk {
  crv: 'P-256';
  kty: 'EC';
  x: string;
  y: string;
}

export interface SnapbackSenderNonce {
  value: string;
  generation: number;
  expiresAtMs: number;
}

export interface SnapbackSenderConstraint {
  formatVersion: 1;
  protocol: 'snapback.sender-constrained.v2';
  custodyGeneration: number;
  /** A non-extractable P-256 ECDSA signing CryptoKey. */
  privateKey: unknown;
  publicJwk: SnapbackSenderPublicJwk;
  thumbprint: string;
  nonce: SnapbackSenderNonce;
}

export interface SnapbackAuthTransitionIntent {
  formatVersion: 1 | 2;
  transitionId: string;
  expectedEpoch: number;
  expectedAuthorityKey: string;
  nextEpoch: number;
  nextAuthorityKey: string;
  reason: string;
  disposition: 'delete' | 'preserve';
  previousAuthority: SnapbackClientAuthority;
  nextAuthority: SnapbackClientAuthority;
  senderConstraintThumbprint?: string | null;
}

export interface SnapbackAuthCustodyRecord {
  formatVersion: number;
  appId: string;
  authorityEpoch: number;
  revision: number;
  phase: SnapbackAuthCustodyPhase;
  authority: SnapbackClientAuthority | null;
  pendingAuthority: SnapbackClientAuthority | null;
  bearer: string | null;
  pendingBearer: string | null;
  refreshAfterMs: number | null;
  transitionIntent: SnapbackAuthTransitionIntent | null;
  senderConstraint?: SnapbackSenderConstraint | null;
  pendingSenderConstraint?: SnapbackSenderConstraint | null;
}

export interface SnapbackAuthorityCapture {
  readonly authorityEpoch: number;
  readonly custodyRevision: number;
  readonly authorityKey: string;
}

export interface SnapbackAuthorityCredentialView extends SnapbackAuthorityCapture {
  readonly authority: SnapbackClientAuthority;
  readonly bearer: string | null;
  readonly refreshAfterMs: number | null;
}

/** Transactional owner handed to `withOwnership` operations. */
export interface SnapbackAuthCustodyOwner {
  read(): Promise<SnapbackAuthCustodyRecord | null>;
  replace(
    expectedRevision: number | null,
    next: SnapbackAuthCustodyRecord | Readonly<Record<string, unknown>>,
  ): Promise<SnapbackAuthCustodyRecord>;
  fencePublication?<T>(publish: () => T): Promise<T>;
}

export interface SnapbackAuthCustodyStorage {
  withOwnership<T>(
    appId: string,
    operation: (owner: SnapbackAuthCustodyOwner) => T | Promise<T>,
  ): Promise<T>;
}

/** Barrier context handed to participant callbacks. */
export interface SnapbackAuthBarrierContext {
  readonly appId: string;
  readonly expectedEpoch: number;
  readonly expectedAuthorityKey: string | null;
  readonly nextEpoch: number;
  readonly nextAuthorityKey: string | null;
  readonly reason: string;
  readonly disposition: 'delete' | 'preserve';
  readonly recovery?: boolean;
  readonly previousAuthority?: SnapbackClientAuthority | null;
  readonly nextAuthority?: SnapbackClientAuthority | null;
}

export interface SnapbackAuthResumeContext extends SnapbackAuthBarrierContext {
  readonly capture: SnapbackAuthorityCapture;
  readonly authority: SnapbackClientAuthority | null;
  stagePublication(
    capture: SnapbackAuthorityCapture,
    commit: (view: SnapbackAuthorityCredentialView) => unknown,
  ): void;
}

export interface SnapbackAuthBarrierParticipant {
  readonly name?: string;
  quiesce?(context: SnapbackAuthBarrierContext): void | Promise<void>;
  blank?(context: SnapbackAuthBarrierContext): void;
  clearMemory?(context: SnapbackAuthBarrierContext): void;
  commitDurable?(context: SnapbackAuthBarrierContext): void | Promise<void>;
  commitTerminalDurable?(context: SnapbackAuthBarrierContext): void | Promise<void>;
  resume?(context: SnapbackAuthResumeContext): void | Promise<void>;
}

export function normalizeClientAuthority(authority: unknown): SnapbackClientAuthority;

export function canonicalAuthorityKey(appId: string, authority: unknown): string;

export function canonicalAgentAuthorityKey(input: {
  actorUserId: string;
  credentialId: string;
  credentialGeneration: number;
  grantId: string;
}): string;

/** Exact JS twin of the server's `service_authority_instance_id` derivation. */
export function deriveServiceAuthorityInstanceId(input: {
  actorUserId: string;
  credentialId: string;
  credentialGeneration: number;
  grantId: string;
}): string;

export function authAppIdHash(appId: string): string;

export function validateAuthCustody(
  record: unknown,
  expectedAppId?: string | null,
): SnapbackAuthCustodyRecord;

/** Structural validation plus a live WebCrypto self-check of sender key pairs. */
export function validateAuthCustodySenderKeys(
  record: unknown,
  expectedAppId?: string | null,
): Promise<SnapbackAuthCustodyRecord>;

/** Deterministic transactional custody storage for unit tests and native shims. */
export function createMemoryAuthCustodyStorage(options?: {
  state?: { custody?: Record<string, unknown> };
}): SnapbackAuthCustodyStorage & {
  snapshot(appId: string): SnapbackAuthCustodyRecord | null;
};

/**
 * One context's view of the shared custody state and its ordered local barrier.
 * Storage is injected so tests, browsers, and native shells share one state machine.
 */
export class AuthCoordinator {
  constructor(options: {
    appId: string;
    storage: SnapbackAuthCustodyStorage;
    broadcastChannelFactory?: ((name: string) => unknown) | null;
    hintStorage?: unknown;
  });

  get appId(): string;
  get phase(): SnapbackAuthCustodyPhase | 'blank';
  get authority(): SnapbackClientAuthorityView | null;

  capture(): SnapbackAuthorityCapture;
  isCurrent(capture: SnapbackAuthorityCapture | null | undefined): boolean;
  settledView(): Readonly<
    SnapbackAuthorityCapture & {
      authority: SnapbackClientAuthority;
      refreshAfterMs: number | null;
    }
  >;

  /** Narrow transport read used during the post-settle resume barrier. */
  credentialFor(capture: SnapbackAuthorityCapture): Readonly<{
    authority: SnapbackClientAuthority;
    bearer: string | null;
    refreshAfterMs: number | null;
    revision: number;
  }>;

  senderCredentialFor(capture: SnapbackAuthorityCapture): Readonly<{
    authority: SnapbackClientAuthority;
    bearer: string | null;
    refreshAfterMs: number | null;
    revision: number;
    senderConstraint: SnapbackSenderConstraint;
  }>;

  /** Establish a fresh store only from a successful anonymous handshake. */
  establishAnonymous(authority: unknown): Promise<SnapbackAuthorityCapture>;

  /** Mandatory lifecycle/publication gate; reloads durable custody under ownership. */
  synchronize(): Promise<SnapbackAuthorityCapture | null>;

  /** Cold-process restore for lease-bounded offline reads; runs no participant resume. */
  restoreOffline(): Promise<SnapbackAuthorityCapture | null>;

  compareAndCommit<T>(
    capture: SnapbackAuthorityCapture | null,
    commit: (view: SnapbackAuthorityCredentialView) => T,
  ): Promise<{ committed: boolean; value?: T }>;

  compareAndRotateBearer(
    capture: SnapbackAuthorityCapture,
    successor: { bearer: string; refreshAfterMs: number },
  ): Promise<{ rotated: boolean; capture?: SnapbackAuthorityCapture }>;

  compareAndRotateSenderCredential(
    capture: SnapbackAuthorityCapture,
    successor: {
      bearer: string;
      refreshAfterMs: number;
      nonce: SnapbackSenderNonce | Readonly<Record<string, unknown>>;
      expectedSenderGeneration: number;
    },
  ): Promise<{ rotated: boolean; capture?: SnapbackAuthorityCapture }>;

  /** Serialize refresh across contexts; network I/O runs outside custody ownership. */
  withCredentialRotation(
    capture: SnapbackAuthorityCapture,
    rotate: (prepared: Readonly<{
      bearer: string | null;
      authority: SnapbackClientAuthority;
      refreshAfterMs: number | null;
    }>) => Promise<{ bearer: string; refreshAfterMs: number; value?: unknown }> | {
      bearer: string;
      refreshAfterMs: number;
      value?: unknown;
    },
  ): Promise<{ rotated: boolean; capture?: SnapbackAuthorityCapture; value?: unknown }>;

  withSenderCredentialRotation(
    capture: SnapbackAuthorityCapture,
    rotate: (prepared: Readonly<{
      bearer: string | null;
      authority: SnapbackClientAuthority;
      refreshAfterMs: number | null;
      senderConstraint: SnapbackSenderConstraint;
    }>) => Promise<{
      bearer: string;
      refreshAfterMs: number;
      nonce: SnapbackSenderNonce | Readonly<Record<string, unknown>>;
      value?: unknown;
    }> | {
      bearer: string;
      refreshAfterMs: number;
      nonce: SnapbackSenderNonce | Readonly<Record<string, unknown>>;
      value?: unknown;
    },
  ): Promise<{ rotated: boolean; capture?: SnapbackAuthorityCapture; value?: unknown }>;

  /** Serialize one sender-proof flight across every same-origin context. */
  withSenderRequestSerialization<T>(
    expectedCapture: SnapbackAuthorityCapture,
    operation: (prepared: Readonly<{
      capture: SnapbackAuthorityCapture;
      credential: Readonly<{
        authority: SnapbackClientAuthority;
        bearer: string | null;
        refreshAfterMs: number | null;
        senderConstraint: SnapbackSenderConstraint;
      }>;
    }>) => T | Promise<T>,
  ): Promise<T>;

  beginSenderRequestSerialization(
    expectedCapture: SnapbackAuthorityCapture,
  ): Promise<Readonly<{
    capture: SnapbackAuthorityCapture;
    credential: Readonly<{
      authority: SnapbackClientAuthority;
      bearer: string | null;
      refreshAfterMs: number | null;
      senderConstraint: SnapbackSenderConstraint;
    }>;
    release(): Promise<void>;
  }>>;

  waitForNewerRevision(
    capture: SnapbackAuthorityCapture,
    options?: {
      timeoutMs?: number;
      pollMs?: number;
      monotonicNow?: () => number;
    },
  ): Promise<SnapbackAuthorityCapture | null>;

  compareAndClear(
    capture: SnapbackAuthorityCapture,
    reason?: string,
  ): Promise<{ cleared: boolean }>;

  /**
   * Replace failed-closed or stuck-clearing custody from a server-witnessed
   * anonymous authority on a different authorization-stream incarnation.
   * Healthy settled custody must use capture-scoped transition/compare-clear.
   */
  recoverUnrecognizedAuthority(
    observedAnonymousAuthority: SnapbackClientAuthority | Readonly<Record<string, unknown>>,
    reason?: string,
  ): Promise<SnapbackAuthorityCapture>;

  transition(
    expected: SnapbackAuthorityCapture,
    successor:
      | SnapbackClientAuthority
      | Readonly<{
          authority: SnapbackClientAuthority | Readonly<Record<string, unknown>>;
          bearer?: string | null;
          refreshAfterMs?: number | null;
          senderConstraint?: SnapbackSenderConstraint | Readonly<Record<string, unknown>> | null;
        }>
      | Readonly<Record<string, unknown>>,
    reason?: string,
  ): Promise<SnapbackAuthorityCapture>;

  /** Returns an unregister function whose result is joinable (thenable). */
  registerParticipant(
    participant: SnapbackAuthBarrierParticipant,
    options?: { before?: SnapbackAuthBarrierParticipant | null },
  ): () => PromiseLike<void>;

  close(): Promise<void>;
}

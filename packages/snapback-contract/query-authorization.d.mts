import type {
  SnapbackAuthDisposition,
  SnapbackAuthorizationVersion,
  SnapbackCompositeWitness,
  SnapbackIssuerId,
  SnapbackQueryNamespace,
  SnapbackScopeId,
} from './auth-invalidation.mjs';

export interface SnapbackQueryAuthorizationFenceCapture {
  readonly queryInstanceId: number;
  readonly authorityGeneration: number;
  readonly queryGeneration: number;
  readonly authorityInstanceId: string | null;
}

/** Snapshot input accepted by the fence; `witness` defaults to the expected pair. */
export interface SnapbackLiveQuerySnapshotInput {
  readonly rows: readonly unknown[];
  readonly version: number;
  readonly witness?: unknown;
}

export interface SnapbackLiveQueryAcceptedSnapshot {
  readonly rows: unknown[];
  readonly version: number;
  readonly witness: SnapbackCompositeWitness;
}

/** Commit callbacks must be synchronous; a returned promise throws. */
export type SnapbackLiveQueryCommitEvent =
  | Readonly<{
      kind: 'snapshot';
      rows: unknown[];
      version: number;
      fence: SnapbackQueryAuthorizationFenceCapture;
      ackToken?: string;
    }>
  | Readonly<{
      kind: 'retain' | 'quarantine' | 'delete';
      fence: SnapbackQueryAuthorizationFenceCapture;
      ackToken?: string;
    }>;

export type SnapbackLiveQueryCommit = (event: SnapbackLiveQueryCommitEvent) => void;

export interface SnapbackLiveQueryOutcome {
  status:
    | 'accepted'
    | 'applied'
    | 'duplicate'
    | 'stale-expectation'
    | 'retired'
    | 'acknowledged'
    | 'rejected'
    | 'replaced'
    | 'pending-fresh-snapshot'
    | 'stale';
  fence: SnapbackQueryAuthorizationFenceCapture;
  disposition?: SnapbackAuthDisposition;
  ackToken?: string | null;
  obligation?: unknown;
  retired?: { scopeId: SnapbackScopeId; revision: number | null }[];
}

export interface SnapbackLiveQueryAuthorizationFence {
  receiveObligation(
    value: unknown,
    options?: { commit?: SnapbackLiveQueryCommit | null; deferCommit?: boolean },
  ): SnapbackLiveQueryOutcome;
  commitCurrentDisposition(input: {
    fence: SnapbackQueryAuthorizationFenceCapture;
    commit: SnapbackLiveQueryCommit;
  }): void;
  applyResolution(input: {
    fence: SnapbackQueryAuthorizationFenceCapture;
    resolution: unknown;
    snapshot?: SnapbackLiveQuerySnapshotInput | null;
    commit?: SnapbackLiveQueryCommit;
  }): SnapbackLiveQueryOutcome;
  acknowledge(ackToken: string): SnapbackLiveQueryOutcome;
  rejectAcknowledgement(
    ackToken: string,
    options?: { commit?: SnapbackLiveQueryCommit | null },
  ): SnapbackLiveQueryOutcome;
  applyLiveSnapshot(input: {
    fence: SnapbackQueryAuthorizationFenceCapture;
    snapshot: SnapbackLiveQuerySnapshotInput;
    commit?: SnapbackLiveQueryCommit;
  }): SnapbackLiveQueryOutcome;
  replaceAuthenticatedExpectation(input: {
    issuerId: unknown;
    authorizationScope?: unknown;
    connectionGeneration?: number | null;
    authorization: unknown;
    versionStream: string;
    snapshot: SnapbackLiveQuerySnapshotInput;
    commit?: SnapbackLiveQueryCommit | null;
  }): SnapbackLiveQueryOutcome;
  previewRetireScopes(input: {
    retirement: unknown;
    freshSnapshot?: SnapbackLiveQuerySnapshotInput | null;
  }): SnapbackLiveQueryOutcome;
  previewRetireIssuer(input: {
    retirement: unknown;
    freshSnapshot?: SnapbackLiveQuerySnapshotInput | null;
  }): SnapbackLiveQueryOutcome;
  retireScopes(input: {
    retirement: unknown;
    freshSnapshot?: SnapbackLiveQuerySnapshotInput | null;
    commit?: SnapbackLiveQueryCommit | null;
  }): SnapbackLiveQueryOutcome;
  retireIssuer(input: {
    retirement: unknown;
    freshSnapshot?: SnapbackLiveQuerySnapshotInput | null;
    commit?: SnapbackLiveQueryCommit | null;
  }): SnapbackLiveQueryOutcome;
  beginRetirement(input: {
    fence: SnapbackQueryAuthorizationFenceCapture;
    commit?: SnapbackLiveQueryCommit | null;
  }): {
    queryInstanceId: number;
    fence: SnapbackQueryAuthorizationFenceCapture;
    pendingOwnerContinuities: string[];
  };
  finishRetirement(): boolean;
  capture(): SnapbackQueryAuthorizationFenceCapture;
  namespace(): SnapbackQueryNamespace;
  disposition(): SnapbackAuthDisposition;
  isRenderable(fence?: SnapbackQueryAuthorizationFenceCapture): boolean;
  /** Diagnostic clone of the internal state (accepted rows redacted). */
  snapshot(): Record<string, unknown>;
}

/** One scalar is sufficient: retired live query ids are never reused. */
export function createLiveQueryInstanceAllocator(options?: {
  highWater?: number;
}): Readonly<{ allocate(): number; highWater(): number }>;

/** Build the exact namespace that must be sent before auth-scoped admission. */
export function createLiveQueryNamespace(input: {
  clientStoreId: string;
  queryKey: string;
  queryInstanceId: number;
}): SnapbackQueryNamespace;

export function createLiveQueryAuthorizationFence(options: {
  namespace: SnapbackQueryNamespace | Readonly<Record<string, unknown>>;
  authorityGeneration: number;
  authorityInstanceId?: string | null;
  issuerId: SnapbackIssuerId | Readonly<Record<string, unknown>>;
  authorizationScope?: unknown;
  connectionGeneration?: number | null;
  authorization: SnapbackAuthorizationVersion | Readonly<Record<string, unknown>>;
  versionStream: string;
  initialSnapshot: SnapbackLiveQuerySnapshotInput;
}): SnapbackLiveQueryAuthorizationFence;

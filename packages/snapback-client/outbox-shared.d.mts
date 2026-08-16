export declare const OUTBOX_MAX_RECORDS: 1024;
export declare const OUTBOX_MAX_RECORD_BYTES: 262144;
export declare const OUTBOX_MAX_PENDING_ACKS: 4096;
export declare const OUTBOX_QUARANTINE_TOMBSTONE_FORMAT: 'snapback.outbox-quarantine-tombstone.v1';

export interface OutboxError extends Error {
  readonly code: string;
}

export declare const outboxNotWriterError: () => OutboxError;
export declare const outboxFullError: () => OutboxError;
export declare const outboxAckFullError: () => OutboxError;
export declare const outboxOversizeError: (bytes: number) => OutboxError;

export interface OutboxRecordInput {
  readonly clientMutationId: string;
  readonly functionId: string;
  readonly args: unknown;
  readonly capturedAt?: string;
  readonly optimisticOperation?: Readonly<Record<string, unknown>> | null;
  /** Process epoch used only to merge durable and ephemeral presentation layers. */
  readonly optimisticProcessEpoch?: string | null;
  /** Realm-wide generated-mutation invocation order within optimisticProcessEpoch. */
  readonly optimisticInvocationSequence?: number | null;
  readonly expectedGeneration?: Readonly<{
    schemaVersion: string;
    appId: string;
    schemaHash: string;
    bundleHash: string;
    inputsHash: string;
  }> | null;
  readonly authorityDescriptor?: Readonly<{
    descriptorVersion: 1;
    authorityInstanceId: string;
    sessionGeneration: number;
  }> | null;
  readonly principalScope?: Readonly<{
    authMode: string;
    authorizationStreamIncarnation: string;
    userId: string | null;
  }>;
  readonly custody?: Readonly<{
    authorityEpoch: number;
    authorityKey: string;
  }>;
  readonly [key: string]: unknown;
}

export interface StoredOutboxRecord extends OutboxRecordInput {
  readonly sequence: number;
  readonly status: 'pending' | 'settled' | 'failed' | 'result-gone' | 'quarantined' | 'stranded';
}

export interface OutboxQuarantineTombstone {
  readonly format: typeof OUTBOX_QUARANTINE_TOMBSTONE_FORMAT;
  readonly status: 'quarantined';
  readonly id: string;
  readonly clientMutationId: string;
  readonly function: string;
  readonly sequence: number;
  readonly quarantinedAt: number;
  readonly refusalCode: string;
  readonly quarantineDisposition:
    | 'upgrade-required-refusal'
    | 'dependent'
    | 'compatibility-unclassified';
  readonly causeClientMutationId: string;
  readonly provenance: Readonly<{
    source: 'server-replay-refusal';
    payload: 'redacted';
  }>;
}

export declare function normalizeOutboxRecordInput(
  record: OutboxRecordInput
): OutboxRecordInput;

export declare function outboxRecordBytes(stored: StoredOutboxRecord): number;

export declare const outboxOrder: (
  a: StoredOutboxRecord,
  b: StoredOutboxRecord
) => number;

export interface OutboxState {
  sequence: number;
  records: Record<string, StoredOutboxRecord>;
  acks: string[];
  operationIdentityRanges: Record<string, Readonly<{
    range: Record<string, unknown>;
    nextCounter: number;
  }>>;
  authorizationQueue: Readonly<{
    generation: number;
    pendingByScope: Record<string, Readonly<Record<string, unknown>>>;
    resolvedByToken: Record<string, Readonly<Record<string, unknown>>>;
  }>;
}

export declare const emptyOutboxState: () => OutboxState;

export declare function validateOutboxState(value: unknown): OutboxState;

export declare function outboxAuthorizationStatus(state: OutboxState): Readonly<{
  generation: number;
  suspended: boolean;
  pendingScopeCount: number;
  effectiveDisposition: 'retain' | 'quarantine' | 'delete';
}>;

export declare const outboxOps: Record<
  string,
  (...args: never[]) => unknown
>;

export declare const pendingOutboxRecords: (
  state: OutboxState
) => StoredOutboxRecord[];

export declare const unresolvedOutboxRecords: (
  state: OutboxState
) => StoredOutboxRecord[];

export declare const allOutboxRecords: (
  state: OutboxState
) => Array<StoredOutboxRecord | OutboxQuarantineTombstone>;

export declare const pendingAcknowledgementsFor: (
  state: OutboxState,
  userId: string,
  limit: number
) => string[];

/** Connectivity classification shared by the M2 queue path and the offline
 * binding-receipt path: transport provenance (the fetch dispatch itself
 * rejected — no HTTP status, diagnostic, or receipt), independent of the
 * rejection's constructor; caller aborts/timeouts excluded. */
export declare function isConnectivityFailureError(error: unknown): boolean;

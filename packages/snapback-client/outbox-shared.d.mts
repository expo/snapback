export declare const OUTBOX_MAX_RECORDS: 1024;
export declare const OUTBOX_MAX_RECORD_BYTES: 262144;
export declare const OUTBOX_MAX_PENDING_ACKS: 4096;

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
  readonly expectedGeneration?: Readonly<{
    schemaVersion: string;
    appId: string;
    schemaHash: string;
    bundleHash: string;
    inputsHash: string;
  }> | null;
  readonly [key: string]: unknown;
}

export interface StoredOutboxRecord extends OutboxRecordInput {
  readonly sequence: number;
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
}

export declare const emptyOutboxState: () => OutboxState;

export declare function validateOutboxState(value: unknown): OutboxState;

export declare const outboxOps: Record<
  string,
  (...args: never[]) => unknown
>;

export declare const pendingOutboxRecords: (
  state: OutboxState
) => StoredOutboxRecord[];

export declare const allOutboxRecords: (
  state: OutboxState
) => StoredOutboxRecord[];

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

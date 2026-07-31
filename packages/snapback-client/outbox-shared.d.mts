export declare const OUTBOX_MAX_RECORDS: 1024;
export declare const OUTBOX_MAX_RECORD_BYTES: 262144;
export declare const OUTBOX_MAX_PENDING_ACKS: 4096;

export interface OutboxError extends Error {
  readonly code: string;
}

export declare const outboxNotWriterError: () => OutboxError;
export declare const outboxFullError: () => OutboxError;
export declare const outboxOversizeError: (bytes: number) => OutboxError;

export interface OutboxRecordInput {
  readonly clientMutationId: string;
  readonly functionId: string;
  readonly args: unknown;
  readonly capturedAt?: string;
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
}

export declare const emptyOutboxState: () => OutboxState;

export declare function validateOutboxState(value: unknown): OutboxState;

export declare const outboxOps: Record<
  string,
  (...args: never[]) => unknown
>;

import type { DeliveryEnvelopeV1, DeliveryRow } from './protocol.js';

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export type Args = Record<string, unknown>;

export interface Session {
  token: string;
  principal: { id: string; kind: string; name?: string };
  authEpoch: number;
  expiresAt: number;
}

export interface Program {
  kind: 'query' | 'mutation' | 'Query' | 'Mutation';
  ir: any;
  certificate: any;
  planHash: string;
}

export interface Manifest {
  generation: string;
  schemaHash: string;
  schema: any;
  programs: Record<string, Program>;
  seq: number;
}

export class SnapbackError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'SnapbackError';
  }
}

export interface ResourceSnapshot<T> {
  readonly data: T | undefined;
  readonly status: 'loading' | 'ready' | 'error' | 'denied';
  /** Completeness belongs to this resource at seq; it never implies a composite snapshot. */
  readonly complete: boolean;
  readonly fresh: boolean;
  readonly seq?: number;
  readonly next?: string | null;
  readonly error?: SnapbackError;
}

export interface Readable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export interface QueryResource<T> extends Readable<ResourceSnapshot<T>> {
  refresh(): Promise<ResourceSnapshot<T>>;
}

export interface MutationReceipt<T = unknown> {
  state: 'committed' | 'rejected' | 'conflict';
  intent: string;
  seq: number;
  data?: T;
  code?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface OperationSnapshot<T = unknown> {
  readonly id: string;
  readonly op: string;
  readonly args: Readonly<Args>;
  readonly status: 'persisting' | 'queued' | 'sending' | 'observing' | 'committed' | 'rejected' | 'conflict' | 'parked' | 'error' | 'sealed';
  readonly receipt?: MutationReceipt<T>;
  readonly error?: SnapbackError;
}

export interface Operation<T> extends Readable<OperationSnapshot<T>> {
  readonly id: string;
  /** Resolves only after the immutable intent is durably admitted by the adapter. */
  readonly durable: Promise<void>;
  /** Resolves only after a terminal server receipt is durably recorded. */
  readonly settled: Promise<MutationReceipt<T>>;
}

export interface ClientSnapshot {
  readonly status: 'starting' | 'online' | 'offline' | 'signed-out' | 'error';
  readonly principal: Session['principal'] | null;
  readonly pending: readonly OperationSnapshot[];
  readonly error?: SnapbackError;
}

export interface StoredOperation {
  id: string;
  principal: string;
  /** Exact JSON body, frozen before the first request; never regenerated on retry. */
  body: string;
  status: 'queued' | 'parked' | 'committed' | 'rejected' | 'conflict';
  createdAt: number;
  receipt?: MutationReceipt;
  error?: { code: string; message: string };
  dismissed?: true;
  observed?: true;
}

export interface StoredResource {
  key: string;
  op: string;
  args: Args;
  rowKeys: string[];
  envelope: Omit<DeliveryEnvelopeV1, 'rows'>;
}

export interface FrameHeader {
  seq: number;
  generation: string;
  schemaHash: string;
  principal: string;
  authEpoch: number;
}

export interface FramePatch extends FrameHeader {
  rows: DeliveryRow[];
  resources: StoredResource[];
}

export interface StoredState {
  version: 1;
  session: Session | null;
  manifest: Manifest | null;
  frame: FramePatch | null;
  operations: StoredOperation[];
}

export interface StoragePatch {
  /** Origin marker for notifications; never persisted as application data. */
  source?: string;
  session?: Session | null;
  manifest?: Manifest;
  frame?: FramePatch | null;
  operations?: StoredOperation[];
}

/** Updates are atomic. A frame merges only with the same sequence and authority;
 * operation puts never replace unrelated journal entries. */
export interface ClientStorage {
  load(): Promise<StoredState>;
  write(patch: StoragePatch): Promise<void>;
  subscribe?(listener: (event: { source?: string; type: 'authority' }) => void): () => void;
  close?(): void;
}

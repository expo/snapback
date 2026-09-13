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

export interface PendingResourceItem {
  readonly operationId: string;
  readonly table: string;
  readonly id: string;
  readonly effect: 'create' | 'update' | 'delete';
}

export interface ResourceSnapshot<T> {
  readonly data: T | undefined;
  readonly status: 'loading' | 'ready' | 'error' | 'denied';
  /** Completeness belongs to this resource at seq; it never implies a composite snapshot. */
  readonly complete: boolean;
  readonly fresh: boolean;
  /** Local FIFO effects included in data. When present, fresh is false;
   * complete and seq describe only the authoritative base beneath them. */
  readonly pending?: readonly PendingResourceItem[];
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

export interface AcquisitionSnapshot {
  readonly id: string;
  readonly status: 'acquiring' | 'ready' | 'cancelled' | 'error' | 'sealed';
  readonly pages: number;
  readonly chains: number;
  readonly seq?: number;
  readonly error?: SnapbackError;
}

export interface Acquisition extends Readable<AcquisitionSnapshot> {
  /** Completion of the current acquisition cycle. Transient outages keep this
   * promise pending; cancel or a terminal error settles it and resume starts a new cycle. */
  readonly completed: Promise<AcquisitionSnapshot>;
  cancel(): void;
  resume(): Promise<AcquisitionSnapshot>;
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
  /** Durable client admission order. Older stores fall back to their adapter's
   * load order and createdAt; this field never travels on the mutation wire. */
  order?: number;
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

export interface AcquisitionDeclaration {
  key: string;
  op: string;
  args: Args;
  cursor: string;
  follow: boolean;
  validator?: string;
}

export interface StoredAcquisitionResource {
  acquisitionId: string;
  /** The ordinary query identity. Several pages share one chain identity. */
  key: string;
  chainKey: string;
  op: string;
  args: Args;
  rowVersionKeys: string[];
  envelope: Omit<DeliveryEnvelopeV1, 'rows'>;
}

export interface StoredAcquisitionRow {
  versionKey: string;
  /** The sequence where these exact bytes were delivered, not a later validation. */
  seq: number;
  row: DeliveryRow;
}

export interface StoredAcquisition {
  id: string;
  declarationHash: string;
  principal: string;
  authEpoch: number;
  generation: string;
  schemaHash: string;
  status: 'acquiring' | 'ready' | 'cancelled';
  phase: 'traverse' | 'validate';
  seq?: number;
  rootKeys: string[];
  derivedDeclarations: AcquisitionDeclaration[];
  pending: AcquisitionDeclaration[];
  resourceKeys: string[];
  pages: number;
}

export interface AcquisitionPatch {
  acquisition: StoredAcquisition;
  rows: StoredAcquisitionRow[];
  resources: StoredAcquisitionResource[];
}

export type AcquisitionCheckpointIdentity = Pick<StoredAcquisition,
  'id' | 'declarationHash' | 'principal' | 'authEpoch' | 'generation' | 'schemaHash'>;
export type AcquisitionCancellation = AcquisitionCheckpointIdentity & { token: string };

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
  version: 1 | 2;
  session: Session | null;
  manifest: Manifest | null;
  frame: FramePatch | null;
  operations: StoredOperation[];
  /** Missing in v1 stores. Loading treats it as an empty collection. */
  acquisitions?: StoredAcquisition[];
  acquisitionRows?: StoredAcquisitionRow[];
  acquisitionResources?: StoredAcquisitionResource[];
  acquisitionFloor?: number;
  acquisitionsInvalidated?: boolean;
}

export interface StoragePatch {
  /** Origin marker for notifications; never persisted as application data. */
  source?: string;
  session?: Session | null;
  /** Fail-closed cleanup that applies only while this exact old authority is
   * still durable, so a delayed failure cannot erase a newer signed-in account. */
  clearSession?: { token: string; principal: string; authEpoch: number; acquisition?: AcquisitionCheckpointIdentity };
  manifest?: Manifest;
  frame?: FramePatch | null;
  operations?: StoredOperation[];
  acquisition?: AcquisitionPatch;
  /** Cancel only the exact dataset declaration and authority that requested it. */
  cancelAcquisition?: AcquisitionCancellation;
  /** Authority changes erase acquisition metadata and bytes in the same write. */
  clearAcquisitions?: true;
  /** Retain physical rows/resources while withdrawing every ready checkpoint. */
  invalidateAcquisitions?: true;
  acquisitionFloor?: number;
  acquisitionsInvalidated?: boolean;
}

/** Updates are atomic. A frame merges only with the same sequence and authority;
 * operation puts never replace unrelated journal entries. */
export interface ClientStorage {
  load(): Promise<StoredState>;
  write(patch: StoragePatch): Promise<void>;
  subscribe?(listener: (event: { source?: string; type: 'authority' }) => void): () => void;
  close?(): void | Promise<void>;
}

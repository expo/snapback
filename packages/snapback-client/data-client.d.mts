import type { SnapbackDiagnosticEventInput as DataDiagnosticV1 } from './client-diagnostics.mjs';

export interface DataTransactionChunkV1<
  Resource extends string = string,
  Operation extends 'create' | 'update' | 'delete' = 'create' | 'update' | 'delete',
  Args extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  Result = unknown,
> {
  readonly artifactKind: 'dataTransactionChunk';
  readonly resource: Resource;
  readonly operation: Operation;
  readonly args: Args;
  readonly __result?: Result;
}

export type DataTransactionResultV1<Chunk> = Chunk extends DataTransactionChunkV1<
  string,
  'create' | 'update' | 'delete',
  Readonly<Record<string, unknown>>,
  infer Result
> ? Result : never;

export type DataTransactionResultTupleV1<Chunks extends readonly DataTransactionChunkV1[]> = {
  readonly [Position in keyof Chunks]: DataTransactionResultV1<Chunks[Position]>;
};

export interface DataTransactionStateV1<ResultTuple extends readonly unknown[]> {
  readonly intentId: string;
  readonly presentation: 'installed' | 'withheld' | 'unavailable' | 'rebased';
  readonly custody: 'preparing' | 'accepted' | 'not-offered';
  readonly dispatch: 'preparing' | 'queued' | 'pending' | 'settled' | 'refused' | 'failed' | 'stranded' | 'quarantined' | 'resultGone' | 'unknown';
  readonly settlement: 'pending' | 'committed' | 'refused' | 'result-gone';
  readonly observation: 'origin-only' | 'converged';
  readonly results?: ResultTuple;
}

export type DataDispatchV1 =
  | Readonly<{ status: 'settled'; intentId: string }>
  | Readonly<{ status: 'queued'; intentId: string; custody: 'accepted'; presentation: 'installed' | 'withheld' | 'unavailable' }>
  | Readonly<{ status: 'pending'; intentId: string; custody: 'not-offered'; blockedReason: 'outcome-unknown'; presentation: 'installed' | 'withheld' | 'unavailable' }>
  | Readonly<{ status: 'refused'; intentId: string; refusal: DataDiagnosticV1 }>;

export type DataSettlementV1<ResultTuple extends readonly unknown[]> =
  | Readonly<{ status: 'committed'; intentId: string; results: ResultTuple; receiptDigest: string }>
  | Readonly<{ status: 'refused'; intentId: string; refusal: DataDiagnosticV1; receiptDigest: string }>;

export interface DataTransactionHandleV1<ResultTuple extends readonly unknown[]> {
  readonly intentId: string;
  snapshot(): DataTransactionStateV1<ResultTuple>;
  subscribe(listener: () => void): () => void;
  readonly dispatched: Promise<DataDispatchV1>;
  readonly settled: Promise<DataSettlementV1<ResultTuple>>;
  refreshSettlement(): Promise<void>;
  dispose(): void;
}

export type DataCursorV1 = `dc1.${string}`;

export interface DataPageV1<Row = Readonly<Record<string, unknown>>> {
  readonly rows: readonly Readonly<Row>[];
  readonly cursor: DataCursorV1 | null;
  readonly complete: boolean;
}

export interface DataPendingWriteV1 {
  readonly intentId: string;
  readonly state: 'preparing' | 'queued' | 'pending' | 'settled-awaiting-convergence';
  readonly presentation: 'installed' | 'withheld' | 'unavailable';
}

export type { DataDiagnosticV1 };

export type DataQueryStateV1<Result> = (
  | Readonly<{ status: 'pending'; data: undefined; error: null; connection: string; freshness: 'unknown'; retention: Readonly<Record<string, unknown>> | null }>
  | Readonly<{ status: 'blocked'; reason: 'authentication-required'; data: undefined; error: null; connection: string; freshness: 'unknown'; retention: null }>
  | Readonly<{ status: 'ready'; data: Result; error: null; connection: string; freshness: 'current' | 'snapshot'; retention: Readonly<Record<string, unknown>> | null }>
  | Readonly<{ status: 'refreshing'; data: Result; error: null; connection: string; freshness: 'retained' | 'current'; retention: Readonly<Record<string, unknown>> | null }>
  | Readonly<{ status: 'error'; data: undefined; error: DataDiagnosticV1; connection: string; freshness: 'unknown'; retention: Readonly<Record<string, unknown>> | null }>
  | Readonly<{ status: 'skipped'; data: undefined; error: null; connection: string; freshness: 'unknown'; retention: null }>
) & Readonly<{ pendingWrites: readonly DataPendingWriteV1[] }>;

export interface DataWatchHandleV1<Result = DataPageV1> {
  snapshot(): DataQueryStateV1<Result>;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  dispose(): void;
}

type AnyDataTransactionBuilderV1 = Readonly<Record<
  string,
  Readonly<Record<string, (args: Readonly<Record<string, unknown>>) => DataTransactionChunkV1>>
>>;

type DataTransactionBuilderFromGeneratedDataV1<Data> = Data extends {
  readonly __snapbackDataTypeBinding?: Readonly<{ readonly tx: infer Builder }>;
} ? Builder : AnyDataTransactionBuilderV1;

type DataDescriptorRowV1<Descriptor> = Descriptor extends {
  readonly __result?: infer Row;
} ? Row : Readonly<Record<string, unknown>>;

export interface DataClientV1<TransactionBuilder = AnyDataTransactionBuilderV1> {
  readonly tx: TransactionBuilder;
  transact<const Chunks extends readonly DataTransactionChunkV1[]>(
    ...chunks: Chunks
  ): DataTransactionHandleV1<DataTransactionResultTupleV1<Chunks>>;
  transaction<ResultTuple extends readonly unknown[]>(intentId: string): DataTransactionHandleV1<ResultTuple>;
  pendingWrites(descriptor: unknown): Promise<readonly DataPendingWriteV1[]>;
  read<const Descriptor>(descriptor: Descriptor, options?: Readonly<Record<string, unknown>>): Promise<DataPageV1<DataDescriptorRowV1<Descriptor>>>;
  watch<const Descriptor>(descriptor: Descriptor, options?: Readonly<Record<string, unknown>>): DataWatchHandleV1<DataPageV1<DataDescriptorRowV1<Descriptor>>>;
  explain(descriptor: unknown): Readonly<Record<string, unknown>>;
}

export declare function createDataClient<const Data extends object>(
  input: Readonly<{ client: object; data: Data }>,
): DataClientV1<DataTransactionBuilderFromGeneratedDataV1<Data>> & Data;

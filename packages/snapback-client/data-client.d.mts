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

export interface DataTransactionHandleV1<ResultTuple extends readonly unknown[]> {
  readonly intentId: string;
  snapshot(): DataTransactionStateV1<ResultTuple>;
  subscribe(listener: () => void): () => void;
  readonly dispatched: Promise<Readonly<Record<string, unknown>>>;
  readonly settled: Promise<Readonly<Record<string, unknown>>>;
  refreshSettlement(): Promise<void>;
  dispose(): void;
}

type AnyDataTransactionBuilderV1 = Readonly<Record<
  string,
  Readonly<Record<string, (args: Readonly<Record<string, unknown>>) => DataTransactionChunkV1>>
>>;

type DataTransactionBuilderFromGeneratedDataV1<Data> = Data extends {
  readonly __snapbackDataTypeBinding?: Readonly<{ readonly tx: infer Builder }>;
} ? Builder : AnyDataTransactionBuilderV1;

export interface DataClientV1<TransactionBuilder = AnyDataTransactionBuilderV1> {
  readonly tx: TransactionBuilder;
  transact<const Chunks extends readonly DataTransactionChunkV1[]>(
    ...chunks: Chunks
  ): DataTransactionHandleV1<DataTransactionResultTupleV1<Chunks>>;
  transaction<ResultTuple extends readonly unknown[]>(intentId: string): DataTransactionHandleV1<ResultTuple>;
  pendingWrites(descriptor: unknown): Promise<readonly Readonly<Record<string, unknown>>[]>;
  query(descriptor: unknown, options?: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
}

export declare function createDataClient<const Data extends object>(
  input: Readonly<{ client: object; data: Data }>,
): DataClientV1<DataTransactionBuilderFromGeneratedDataV1<Data>>;

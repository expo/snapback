// Headless asset upload client (LLP 0044 §Client upload surface, L1-14).

export declare const ASSET_RECORD_LIVE_FUNCTION: '_snapback.assetRecord';
export declare const MY_MEMBERSHIPS_LIVE_FUNCTION: '_snapback.myMemberships';
export interface MyMembershipRow {
  id: string;
  resource: string | null;
  role: string;
  sinceMs: number;
}

export declare const PERSISTED_RESUME_FACT_MEMBERS: readonly [
  'assetId',
  'attemptId',
  'attemptExpiresAtMs',
  'fileSize',
  'fileName',
];

export type AssetTaskStatus =
  | 'creating'
  | 'uploading'
  | 'paused'
  | 'finalizing'
  | 'ready'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export interface AssetTaskSnapshot {
  readonly assetId: string | null;
  readonly assetRef: string | null;
  readonly attemptId: string | null;
  readonly attemptExpiresAtMs: number | null;
  readonly status: AssetTaskStatus;
  readonly diagnostic: { code?: string; message?: string } | null;
  readonly bytesTransferred: number;
  readonly totalBytes: number;
  readonly previewUrl: string | null;
  readonly integrityBasis: string;
}

export interface AssetFileLike {
  size: number;
  name?: string;
  type?: string;
  slice(start: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface AssetUploadTask {
  readonly done: Promise<AssetTaskSnapshot>;
  snapshot(): AssetTaskSnapshot;
  subscribe(listener: (snapshot: AssetTaskSnapshot) => void): () => void;
  pause(): void;
  resume(): void;
  cancel(options?: { discardAsset?: boolean }): Promise<AssetTaskSnapshot>;
  retry(): Promise<AssetUploadTask>;
}

export interface AssetTaskStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(): string[];
}

export declare function createMemoryAssetTaskStore(): AssetTaskStore;

export interface AssetUploadReferenceLike {
  artifactKind: 'assetUploadReference';
  name: string;
  intentPolicyHash?: string;
}

export declare class SnapbackAssetClient {
  constructor(
    client: { baseUrl: string; subscribeLive: (ref: unknown, options?: unknown) => unknown },
    options?: { taskStore?: AssetTaskStore | null; chunkBytes?: number },
  );
  taskStoreKey(options: { userId?: string | null; assetId: string }): string;
  start(options: {
    upload: AssetUploadReferenceLike;
    args?: Record<string, unknown>;
    file: AssetFileLike;
    userId?: string | null;
    declaredFilename?: string | null;
    declaredContentType?: string | null;
    previewUrl?: string | null;
  }): AssetUploadTask;
  resumePersisted(options: {
    assetId: string;
    file: AssetFileLike;
    userId?: string | null;
  }): AssetUploadTask | null;
  record(assetId: string, options?: { userId?: string | null }): Promise<unknown>;
  watch(assetId: string, options?: { userId?: string | null; connectionId?: string }): unknown;
  deliveryUrl(
    assetId: string,
    options?: { variant?: string; maxWidth?: number | null; width?: number | null },
  ): string;
  watchStore(
    assetId: string,
    options?: { userId?: string | null; connectionId?: string | null },
  ): AssetRecordWatchStore;
}

export interface AssetRecordWatchSnapshot {
  readonly status: 'connecting' | 'ready' | 'blank' | 'error';
  readonly record: Record<string, unknown> | null;
  readonly mode: 'live' | 'static';
  readonly diagnostic?: { code?: string; message?: string };
}

export interface AssetRecordWatchStore {
  getSnapshot(): AssetRecordWatchSnapshot;
  subscribe(listener: (snapshot: AssetRecordWatchSnapshot) => void): () => void;
  dispose(): void;
}

export declare function createAssetClient(
  client: ConstructorParameters<typeof SnapbackAssetClient>[0],
  options?: ConstructorParameters<typeof SnapbackAssetClient>[1],
): SnapbackAssetClient;

/** Test-only export: the browser digest fallback, cross-checked against
 * node:crypto by the package test. Not part of the client surface. */
export declare class __testIncrementalSha256 {
  update(bytes: Uint8Array | ArrayLike<number>): void;
  digestBytes(): Uint8Array;
  digest(encoding?: 'hex' | 'base64'): string | Uint8Array;
}

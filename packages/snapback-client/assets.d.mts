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

export interface AssetDiagnostic {
  readonly schemaVersion?: string;
  readonly code?: string;
  readonly severity?: string;
  readonly message?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly [member: string]: unknown;
}

export interface AssetTaskSnapshot {
  readonly assetId: string | null;
  readonly assetRef: string | null;
  readonly attemptId: string | null;
  readonly attemptExpiresAtMs: number | null;
  readonly status: AssetTaskStatus;
  readonly diagnostic: AssetDiagnostic | null;
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

export interface AssetPickerSource {
  readonly uri: string;
  readonly mimeType?: string;
  readonly fileName?: string;
}

export type AssetUploadSource = AssetFileLike | Blob | File | AssetPickerSource;

export interface AssetSignedUrlOptions {
  readonly variant?: string;
  readonly widthPx?: number;
  readonly ttlMs?: number;
}

export interface AssetSignedUrlResult {
  readonly url: string;
  readonly expiresAt: number;
  readonly variant: string;
}

export type AssetIssuedUrlStatus =
  | 'issuing'
  | 'ready'
  | 'refreshing'
  | 'unavailable'
  | 'denied';

export interface AssetIssuedUrlSnapshot {
  readonly url: string | null;
  readonly status: AssetIssuedUrlStatus;
  readonly diagnostic: AssetDiagnostic | null;
  readonly expiresAt: number | null;
  readonly rendition: string | null;
}

export interface AssetIssuedUrlStore {
  getSnapshot(): AssetIssuedUrlSnapshot;
  getServerSnapshot(): AssetIssuedUrlSnapshot;
  subscribe(listener: (snapshot: AssetIssuedUrlSnapshot) => void): () => void;
  refresh(): Promise<void>;
}

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

export interface MediaRef<K extends MediaKind = MediaKind> {
  readonly assetId: string;
  readonly kind: K;
}

export type MediaState<K extends MediaKind = MediaKind> =
  | Readonly<{ status: 'empty'; media: null }>
  | Readonly<{ status: 'issuing'; media: MediaRef<K> }>
  | Readonly<{
      status: 'ready';
      media: MediaRef<K>;
      url: string;
      expiresAt: number;
      rendition: string;
    }>
  | Readonly<{
      status: 'refreshing';
      media: MediaRef<K>;
      url: string;
      expiresAt: number;
      rendition: string;
      diagnostic?: AssetDiagnostic;
    }>
  | Readonly<{
      status: 'unavailable' | 'denied';
      media: MediaRef<K>;
      diagnostic: AssetDiagnostic;
    }>;

export interface MediaStore<K extends MediaKind = MediaKind> {
  getSnapshot(): MediaState<K>;
  getServerSnapshot(): MediaState<K>;
  subscribe(listener: (snapshot: MediaState<K>) => void): () => void;
  refresh(): Promise<void>;
}

/** One stable generated assetCollection child returned by its bounded read. */
export interface MediaCollectionItem<K extends MediaKind = MediaKind> {
  readonly itemId: string;
  readonly ordinal: number;
  readonly media: MediaRef<K>;
}

/** Render projection for one collection child. `itemId` remains the durable
 * identity even when ordinal or delivery state changes. */
export interface MediaCollectionItemState<K extends MediaKind = MediaKind> {
  readonly itemId: string;
  readonly ordinal: number;
  readonly state: MediaState<K>;
  readonly refresh: () => Promise<void>;
}

export type MediaCollectionState<K extends MediaKind = MediaKind> =
  readonly MediaCollectionItemState<K>[];

export interface MediaCollectionStore<K extends MediaKind = MediaKind> {
  getSnapshot(): MediaCollectionState<K>;
  getServerSnapshot(): MediaCollectionState<K>;
  subscribe(listener: (snapshot: MediaCollectionState<K>) => void): () => void;
  refresh(itemId?: string): Promise<void>;
}

export interface AssetUploadTerminalError extends Error {
  readonly code: string;
  readonly status: Exclude<AssetTaskStatus, 'creating' | 'uploading' | 'paused' | 'finalizing' | 'ready'>;
  readonly terminalStatus: this['status'];
  readonly diagnostic: AssetDiagnostic;
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

export type AssetFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export declare function createMemoryAssetTaskStore(): AssetTaskStore;

export interface AssetUploadReferenceLike {
  artifactKind: 'assetUploadReference';
  name: string;
  intentPolicyHash?: string;
  implementationHash?: string;
}

export declare class SnapbackAssetClient {
  constructor(
    client: { baseUrl: string; subscribeLive: (ref: unknown, options?: unknown) => unknown },
    options?: {
      taskStore?: AssetTaskStore | null;
      chunkBytes?: number;
      /** Host transport adapter; Expo registers expo/fetch for binary TUS bodies. */
      fetch?: AssetFetch | null;
    },
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
    /** Exact authority cohort captured by a composing command. Direct asset
     * callers normally omit this and retain the existing per-request capture. */
    authorityCapture?: unknown;
    /** Internal external-bearer generation fence used by a composing command.
     * Direct callers normally omit this. */
    externalTransportGeneration?: number;
  }): AssetUploadTask;
  resumePersisted(options: {
    assetId: string;
    file: AssetFileLike;
    userId?: string | null;
  }): AssetUploadTask | null;
  upload(
    upload: AssetUploadReferenceLike,
    source: AssetUploadSource,
    options?: { args?: Record<string, unknown> },
  ): Promise<string>;
  record(assetId: string, options?: { userId?: string | null }): Promise<unknown>;
  watch(assetId: string, options?: { userId?: string | null; connectionId?: string }): unknown;
  deliveryUrl(
    assetId: string,
    options?: { variant?: string; maxWidth?: number | null; width?: number | null },
  ): string;
  publicDeliveryUrl(
    assetId: string,
    options?: { variant?: string; width?: number | null },
  ): string;
  signedUrl(assetId: string, options?: AssetSignedUrlOptions): Promise<AssetSignedUrlResult>;
  issuedUrlStore(assetId: string, options?: AssetSignedUrlOptions): AssetIssuedUrlStore;
  mediaStore<K extends MediaKind>(
    mediaRefOrNull: MediaRef<K> | null | undefined,
    options?: AssetSignedUrlOptions,
  ): MediaStore<K>;
  mediaCollectionStore<K extends MediaKind>(
    items: readonly MediaCollectionItem<K>[],
    options?: AssetSignedUrlOptions,
  ): MediaCollectionStore<K>;
  watchStore(
    assetId: string,
    options?: { userId?: string | null; connectionId?: string | null },
  ): AssetRecordWatchStore;
}

export interface AssetRecordWatchSnapshot {
  readonly status: 'connecting' | 'ready' | 'blank' | 'error';
  readonly record: Record<string, unknown> | null;
  readonly mode: 'live' | 'static';
  readonly diagnostic?: AssetDiagnostic;
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

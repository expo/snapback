// Type declarations for rqs-store-file.mjs — Channel B persisted RQS resume
// store, native/DK-9 file arm. Same observable contract as the web arm
// (`RqsResumeStore`), backed by durable local files.

import type { RqsResumeStore } from './rqs-store.mjs';

export const RQS_FILE_STORE_FORMAT: string;
export declare const RQS_FILE_STORE_FORMAT_V2: 'snapback-rqs-store-file.v2';

/** Injectable filesystem adapter (the Node default lazily loads `node:fs`;
 * Hermes/React Native hosts inject their own over the platform FS). */
export interface RqsFilesAdapter {
  readonly powerLossDurable?: boolean;
  mkdir(path: string): Promise<void>;
  /** null when the file does not exist. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  /** false when the path already exists (`wx` semantics). */
  writeFileExclusive(path: string, data: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  /** false when the path was already gone. */
  unlink(path: string): Promise<boolean>;
  readdir(path: string): Promise<readonly string[]>;
  /** Persist the directory entry created by rename before publication. */
  syncDirectory(path: string): Promise<void>;
  processId(): number;
  processAlive(pid: number): boolean;
}

export function createNodeFilesAdapter(): RqsFilesAdapter;

export function legacyFileRqsStorePath(options: {
  readonly directory: string;
  readonly identity?: string | number | null;
}): string;

export function inspectLegacyFileRqsStore(options: {
  readonly directory: string;
  readonly files: RqsFilesAdapter;
  readonly identity?: string | number | null;
}): Promise<
  | Readonly<{ status: 'absent'; pathIdentity: string }>
  | Readonly<{ status: 'unreadable'; pathIdentity: string; error?: unknown }>
  | Readonly<{
      status: 'discardable' | 'pending-custody';
      pathIdentity: string;
      predecessorClientStoreId: string;
      predecessorHandleKey: string;
      custodyCount: number;
    }>
>;

export function deleteLegacyFileRqsStore(options: {
  readonly directory: string;
  readonly files: RqsFilesAdapter;
  readonly identity?: string | number | null;
}): Promise<string>;

export function acquireLegacyFileRqsStoreMigrationLease(options: {
  readonly directory: string;
  readonly files: RqsFilesAdapter;
  readonly identity?: string | number | null;
  readonly now?: () => number;
}): Promise<
  | Readonly<{
      status: 'writer-active';
      pathIdentity: string;
      lockPath: string;
      owner: Readonly<{ pid: number; instanceId?: string }> | null;
    }>
  | Readonly<{
      status: 'acquired';
      pathIdentity: string;
      lockPath: string;
      inspect(): ReturnType<typeof inspectLegacyFileRqsStore>;
      deleteAndConfirmAbsent(): Promise<string>;
      release(): Promise<void>;
    }>
>;

/** Durable file-backed persisted RQS resume store for native/Node hosts. */
export function createFileRqsResumeStore(options: {
  readonly directory: string;
  readonly files?: RqsFilesAdapter;
  readonly identity?: string | number | null;
  readonly now?: () => number;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly clientStoreId?: string | null;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly onBeforeStoreIdentityRotation?: ((transition: Readonly<{
    carrier: 'file';
    path: string;
    previousClientStoreId: string | null;
    nextClientStoreId: string;
  }>) => void | Promise<void>) | null;
  readonly relaunchOutboxEmpty?: (() => boolean | Promise<boolean>) | null;
}): RqsResumeStore;

export declare const RQS_FILE_STORE_FORMAT_V1: 'snapback-rqs-store-file.v1';

export declare const RQS_STORE_GC_DEFAULT_MAX_AGE_MS: number;

/** Directory janitor for the shared default state directory: unlinks sibling
 * per-origin blobs (and their stale locks) that are provably abandoned —
 * never the caller's own identity, a live holder's blob, pending queued
 * intent, corrupt bytes, or anything younger than `maxAgeMs`. Availability
 * only; failures skip the candidate. */
export declare function sweepStaleRqsBlobs(options: {
  readonly directory: string;
  readonly files?: RqsFilesAdapter;
  readonly keepIdentity?: string | number | null;
  readonly maxAgeMs?: number;
  readonly now?: () => number;
}): Promise<{ swept: number; kept: number }>;

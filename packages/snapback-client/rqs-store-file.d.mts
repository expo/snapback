// Type declarations for rqs-store-file.mjs — Channel B persisted RQS resume
// store, native/DK-9 file arm. Same observable contract as the web arm
// (`RqsResumeStore`), backed by durable local files.

import type { RqsResumeStore } from './rqs-store.mjs';

export const RQS_FILE_STORE_FORMAT: string;

/** Injectable filesystem adapter (the Node default lazily loads `node:fs`;
 * Hermes/React Native hosts inject their own over the platform FS). */
export interface RqsFilesAdapter {
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
  processId(): number;
  processAlive(pid: number): boolean;
}

export function createNodeFilesAdapter(): RqsFilesAdapter;

/** Durable file-backed persisted RQS resume store for native/Node hosts. */
export function createFileRqsResumeStore(options: {
  readonly directory: string;
  readonly files?: RqsFilesAdapter;
  readonly identity?: string | number | null;
  readonly now?: () => number;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly relaunchOutboxEmpty?: (() => boolean | Promise<boolean>) | null;
}): RqsResumeStore;

export declare const RQS_FILE_STORE_FORMAT_V1: 'snapback-rqs-store-file.v1';

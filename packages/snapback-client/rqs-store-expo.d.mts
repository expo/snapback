// Type declarations for the React Native/Expo projection of the durable
// Channel B file store. The consumed API is structural so applications keep
// ownership of the expo-file-system dependency and module instance.

import type { RqsFilesAdapter } from './rqs-store-file.mjs';
import type { RqsResumeStore } from './rqs-store.mjs';
import type { NativeRqsFilesProvider } from './rqs-store-default.mjs';

export interface ExpoFileLike {
  readonly uri: string;
  readonly exists: boolean;
  create(options?: { intermediates?: boolean; overwrite?: boolean }): void;
  write(content: string): void;
  textSync(): string;
  text(): Promise<string>;
  delete(): void;
  moveSync(
    destination: ExpoFileLike | ExpoDirectoryLike,
    options?: { overwrite?: boolean },
  ): void;
}

export interface ExpoDirectoryLike {
  readonly uri: string;
  readonly exists: boolean;
  create(options?: {
    intermediates?: boolean;
    overwrite?: boolean;
    idempotent?: boolean;
  }): void;
  list(): Array<ExpoFileLike | ExpoDirectoryLike>;
  delete(): void;
}

export interface ExpoFileSystemModuleLike {
  // Constructor parameters are typed `any[]` deliberately: construct
  // signatures are strictly contravariant, so declaring the union we pass
  // would reject the REAL expo-file-system module (its constructors accept
  // the narrower `string | File | Directory`). The instances we consume are
  // still checked structurally via the return types.
  readonly File: new (...uris: any[]) => ExpoFileLike;
  readonly Directory: new (...uris: any[]) => ExpoDirectoryLike;
  readonly Paths: {
    readonly document: ExpoDirectoryLike;
    readonly cache: ExpoDirectoryLike;
  };
}

export function createExpoFilesAdapter(
  fileSystem: ExpoFileSystemModuleLike,
): RqsFilesAdapter;

export function createExpoRqsResumeStore(options: {
  readonly fileSystem: ExpoFileSystemModuleLike;
  readonly directory?: string;
  readonly identity?: string | number | null;
  readonly now?: () => number;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly relaunchOutboxEmpty?: (() => boolean | Promise<boolean>) | null;
}): RqsResumeStore;

export function registerExpoFileSystemRqsFiles(
  fileSystem: ExpoFileSystemModuleLike,
  options?: { readonly directory?: string },
): Readonly<NativeRqsFilesProvider>;

import type { PushInstallationStorage } from './push-registry.mjs';

export interface ExpoPushInstallationFileLike {
  readonly uri: string;
  readonly exists: boolean;
  create(options?: { readonly intermediates?: boolean; readonly overwrite?: boolean }): void;
  write(content: string): void;
  textSync(): string;
  delete(): void;
}

export interface ExpoPushInstallationDirectoryLike {
  readonly uri: string;
  readonly exists: boolean;
  create(options?: {
    readonly intermediates?: boolean;
    readonly idempotent?: boolean;
  }): void;
}

export interface ExpoPushFileSystemModuleLike {
  readonly File: new (...uris: any[]) => ExpoPushInstallationFileLike;
  readonly Directory: new (...uris: any[]) => ExpoPushInstallationDirectoryLike;
  readonly Paths: {
    readonly document: ExpoPushInstallationDirectoryLike;
  };
}

export function createExpoPushInstallationStorage(options: {
  readonly fileSystem: ExpoPushFileSystemModuleLike;
  readonly directory?: string;
}): PushInstallationStorage;

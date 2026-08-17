import type { RqsResumeStore } from './rqs-store.mjs';

export const EXPO_SQLITE_STORE_SCHEMA_VERSION: 1;
export const EXPO_SQLITE_STORE_PROFILE: 'durable-fragments-v1';

export interface SqliteAsyncDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...parameters: unknown[]): Promise<unknown>;
  getFirstAsync(sql: string, ...parameters: unknown[]): Promise<Record<string, unknown> | null>;
  getAllAsync(sql: string, ...parameters: unknown[]): Promise<Record<string, unknown>[]>;
  closeAsync(): Promise<void>;
}

export interface SqliteModuleNamespace {
  openDatabaseAsync(
    name: string,
    options: Readonly<{ useNewConnection: true }>,
  ): Promise<SqliteAsyncDatabase>;
}

export interface SqliteQualificationFacts {
  readonly profile: 'durable-fragments-v1';
  readonly schemaVersion: 1;
  readonly databaseName: string;
  readonly sqliteVersion: string;
  readonly sqliteSourceId: string;
  readonly compileOptions: readonly string[];
  readonly pragmas: Readonly<{
    lockingMode: 'exclusive';
    journalMode: 'wal';
    synchronous: 2;
    foreignKeys: 1;
    fullfsync: 1 | null;
  }>;
}

export interface SqliteRqsResumeStore extends RqsResumeStore {
  durability(): Readonly<{ implementation: 'expo-sqlite'; durable: true }>;
  qualificationFacts(): SqliteQualificationFacts;
  /** Qualification-only full database check on the owned connection. */
  qualificationIntegrityCheck(): Promise<string>;
  predecessorFences(): Promise<readonly Readonly<Record<string, unknown>>[]>;
  recordPredecessorFence(fence: Readonly<{
    predecessorClientStoreId: string;
    predecessorHandleKey: string;
    pathIdentity: string;
  }>): Promise<Readonly<Record<string, unknown>>>;
  confirmPredecessorAbsent(
    predecessorClientStoreId: string,
    pathIdentity: string,
  ): Promise<boolean>;
}

export interface CreateSqliteRqsResumeStoreOptions {
  readonly sqlite: SqliteModuleNamespace;
  readonly databaseName: string;
  readonly now?: () => number;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly clientStoreId?: string | null;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly platformOperatingSystem?: string | null;
  readonly onBeforeStoreIdentityRotation?: ((input: Readonly<Record<string, unknown>>) => void | Promise<void>) | null;
  readonly relaunchOutboxEmpty?: (() => boolean | Promise<boolean>) | null;
  readonly faultInjector?: ((boundary: string) => void | Promise<void>) | null;
  /** Qualification-only deterministic quota seam. */
  readonly qualificationMaxPageCount?: number | null;
  /** Ordinary main app only; extensions/headless secondary processes refuse. */
  readonly runtimeKind?: 'main-app' | string;
}

export function createSqliteRqsResumeStore(
  options: CreateSqliteRqsResumeStoreOptions,
): Promise<SqliteRqsResumeStore>;

export const createExpoSqliteRqsResumeStore: typeof createSqliteRqsResumeStore;

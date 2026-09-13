import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { createPlatformClient, type ClientOptions, type SnapbackClient } from './client.js';
import { sha256 } from '../../evaluator/src/hash.js';
import { normalizeOwnerUrl } from './client-platform.js';
import { expoSqliteDriver } from './expo/sqlite.js';
import { createSQLiteStorage, type SQLiteStorage } from './resource/sqlite.js';
import type { ClientStorage } from './resource/types.js';

export * from './client.js';
export * from './react.js';
export { expoSqliteDriver } from './expo/sqlite.js';
export type { ExpoSQLiteModule } from './expo/sqlite.js';
export { createSQLiteStorage } from './resource/sqlite.js';
export type { SQLiteStorage, SqliteDriver, SqliteExecutor, SqliteParams, SqliteValue } from './resource/sqlite.js';

export type ExpoClientOptions = Omit<ClientOptions, 'storage'> & (
  | { /** Omit for the owner-URL-scoped default. A supplied plain basename is an explicit shared namespace. */ databaseName?: string; storage?: never }
  | { /** Advanced/test override. Explicit adapters remain caller-owned. */ storage: ClientStorage | false; databaseName?: never }
);

/** Lower-level storage construction requires an explicit namespace. */
export function createExpoSQLiteStorage(databaseName: string): SQLiteStorage {
  if (typeof databaseName !== 'string') {
    throw new TypeError('createExpoSQLiteStorage: databaseName is required; createExpoClient scopes its default to the owner URL.');
  }
  return createSQLiteStorage(() => expoSqliteDriver(databaseName));
}

/** One-call native entrypoint. The ordinary client owns its private SQLite
 * connection; explicit storage injection remains caller-owned. */
// @ref LLP 2000#5-ownership-before-abstraction — native applications should
// receive durable identity/recovery without constructing another lifecycle owner.
export function createExpoClient(options: ExpoClientOptions): SnapbackClient {
  if (options.databaseName !== undefined && options.storage !== undefined) {
    throw new TypeError('createExpoClient: choose databaseName or storage, not both.');
  }
  const { databaseName, storage, ...clientOptions } = options;
  return createPlatformClient({ ...clientOptions, ...(storage !== undefined ? { storage } : {}) }, {
    defaultStorage: () => createExpoSQLiteStorage(databaseName
      ?? `snapback3-${sha256(normalizeOwnerUrl(clientOptions.url))}.db`),
    // Expo 57's response implements the web Response stream contract used by
    // /api/events, while its input type deliberately excludes some DOM-only forms.
    fetch: expoFetch as typeof globalThis.fetch,
    idFactory: randomUUID,
  });
}

import { fetch as expoFetch } from "expo/fetch";
import { createClient } from "../client.js";
import type { CreateClientOptions, OfflineClientOptions, SnapbackClient } from "../types.js";
import { expoSqliteDriver } from "../store/sqlite-expo.js";
import { sqliteRangeStore, type SqliteRangeStoreOptions } from "../store/sqlite.js";
import { expoSecureTokenStore } from "./token-store.js";
import { PersistentRangeStore, type RangeStoreFactory } from "../store/range-store.js";
import { SqliteBackend } from "../store/sqlite.js";
import { NativeAssetFiles, attachAssetFiles, fileBackend } from "../react-native/files.js";
import { expoAssetFileSystem } from "./files.js";

export { expoSecureTokenStore } from "./token-store.js";
export { expoSqliteDriver } from "../store/sqlite-expo.js";
export { sqliteRangeStore, inProcessLocks } from "../store/sqlite.js";
export type { SqliteDriver, SqliteExecutor, SqliteParams, SqliteRangeStoreOptions } from "../store/sqlite.js";

export function expoSqliteStore(name = "snapback2.db", options: SqliteRangeStoreOptions = {}) {
  const factory = (() => {
    const files = new NativeAssetFiles(expoAssetFileSystem());
    const store = new PersistentRangeStore(fileBackend(new SqliteBackend(() => expoSqliteDriver(name), options), files));
    attachAssetFiles(store, files);
    return store;
  }) as RangeStoreFactory;
  Object.defineProperty(factory, "carrier", { value: "SQLite" });
  return factory;
}

export type CreateExpoClientOptions = CreateClientOptions extends infer Options
  ? Options extends CreateClientOptions
    ? Omit<Options, "offline"> & {
      /** Restore a persisted transport cut before the first request or carrier resume. */
      startOffline?: boolean;
      offline?: Omit<OfflineClientOptions, "store"> & { store?: OfflineClientOptions["store"] };
    }
    : never
  : never;

// @ref LLP 1013#5-the-entries — streaming Expo fetch and native custody are
// defaults; createClient itself checks the one-authority rule before opening.
export function createExpoClient(options: CreateExpoClientOptions): SnapbackClient {
  return createClient({
    ...options,
    fetch: options.fetch ?? expoFetch,
    offline: { ...options.offline, store: options.offline?.store ?? expoSqliteStore() },
    ...(options.persona !== undefined ? {} : { tokenStore: options.tokenStore ?? expoSecureTokenStore() }),
  } as CreateClientOptions);
}

import { fetch as expoFetch } from "expo/fetch";
import { createClient } from "../client.js";
import type { CreateClientOptions, OfflineClientOptions, SnapbackClient } from "../types.js";
import { expoSqliteDriver } from "../store/sqlite-expo.js";
import { sqliteRangeStore, type SqliteRangeStoreOptions } from "../store/sqlite.js";
import { expoSecureTokenStore } from "./token-store.js";

export { expoSecureTokenStore } from "./token-store.js";
export { expoSqliteDriver } from "../store/sqlite-expo.js";
export { sqliteRangeStore, inProcessLocks } from "../store/sqlite.js";
export type { SqliteDriver, SqliteExecutor, SqliteParams, SqliteRangeStoreOptions } from "../store/sqlite.js";

export function expoSqliteStore(name = "snapback2.db", options: SqliteRangeStoreOptions = {}) {
  return sqliteRangeStore(() => expoSqliteDriver(name), options);
}

export type CreateExpoClientOptions = CreateClientOptions extends infer Options
  ? Options extends CreateClientOptions
    ? Omit<Options, "offline"> & { offline?: Omit<OfflineClientOptions, "store"> & { store?: OfflineClientOptions["store"] } }
    : never
  : never;

// @ref LLP 1013#5-the-entries — streaming Expo fetch and native custody are
// defaults; createClient itself checks the one-authority rule before opening.
export function createExpoClient(options: CreateExpoClientOptions): SnapbackClient {
  return createClient({
    ...options,
    fetch: options.fetch ?? expoFetch,
    offline: { ...options.offline, store: options.offline?.store ?? expoSqliteStore() },
    ...(options.as !== undefined ? {} : { tokenStore: options.tokenStore ?? expoSecureTokenStore() }),
  } as CreateClientOptions);
}

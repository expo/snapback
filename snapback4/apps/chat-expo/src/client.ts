// One call opens the device's replica: SQLite for the rows, the secure
// store for the session, a guest when there is none. The persona door is
// for development against `snapback4 dev` on the same machine.
import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import { createLocalClient, type LocalClient, type LocalOptions } from "snapback4/local";
import { expoSqliteDriver, openSqlite } from "snapback4/replica";

export const url = process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400";
const persona = process.env.EXPO_PUBLIC_SNAPBACK_PERSONA;

const sessionStore = {
  get: (key: string) => SecureStore.getItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_")),
  set: (key: string, value: string) => SecureStore.setItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_"), value),
  delete: (key: string) => SecureStore.deleteItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_")),
};

export const sqliteStore = {
  async open(name: string, schema: Parameters<typeof openSqlite>[1]) {
    const db = await SQLite.openDatabaseAsync(`${name.replace(/[^A-Za-z0-9._-]/g, "_")}.db`);
    return openSqlite(expoSqliteDriver(db), schema);
  },
};

export function openClient(extra: Partial<LocalOptions> = {}): Promise<LocalClient> {
  return createLocalClient({ url, ...(persona ? { persona } : { guest: true, sessionStore }), store: sqliteStore, waitSeconds: 20, ...extra });
}

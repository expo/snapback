// One call opens the device: the Rust module when this build carries it
// (a development or production build), else the TypeScript tier over
// expo-sqlite (Expo Go). Either way the secure store keeps the session and
// a guest is minted when there is none; the persona door is for
// development against `snapback4 dev` on the same machine.
import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import { createLocalClient, type LocalClient, type LocalOptions } from "snapback4/local";
import { createNativeClient, type NativeClient } from "snapback4/native";
import { expoSqliteDriver, openSqlite } from "snapback4/replica";
import { documentDirectory, nativeAvailable, nativeDevice } from "snapback4-expo";

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

export type DeviceClient = LocalClient | NativeClient;

/** Which tier this build runs: the Rust module, or the TypeScript twin. */
export const tier: "native" | "local" = nativeAvailable() ? "native" : "local";

export function openClient(extra: Partial<LocalOptions> = {}): Promise<DeviceClient> {
  const identity = extra.persona ?? persona ? { persona: extra.persona ?? persona } : { guest: true, sessionStore };
  if (tier === "native") return createNativeClient({ url, ...identity, native: nativeDevice, dataDir: documentDirectory(), waitSeconds: 20, fetch: extra.fetch });
  return createLocalClient({ url, ...identity, store: sqliteStore, waitSeconds: 20, ...extra });
}

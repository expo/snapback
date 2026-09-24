import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { webDevice } from "snapback4/web";

const sessionStore = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  delete: (key: string) => SecureStore.deleteItemAsync(key),
};
export const url = process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400";
export const tier = Platform.OS === "web" ? "web" : nativeAvailable() ? "native" : "online";
// Browser persistence is explicit: scripts on the page can read the token.
export const app = createApp({ url,
  sessionStore: Platform.OS === "web" ? localStorageSessionStore() : sessionStore,
  device: tier === "web" ? webDevice() : tier === "native" ? nativeDevice : undefined,
});

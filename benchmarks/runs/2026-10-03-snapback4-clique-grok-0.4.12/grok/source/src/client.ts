import { smokeOrigin } from "snapback4-expo/witness";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { webDevice } from "snapback4/web";
import { withIntentStorage } from "./intents";
import { intentStorage } from "./intent-store";

export const SNAPBACK_PORT = 49361;
export const url = smokeOrigin(process.env.EXPO_PUBLIC_SNAPBACK_URL ?? `http://127.0.0.1:${SNAPBACK_PORT}`);
export const tier = Platform.OS === "web" ? "web replica" : nativeAvailable() ? "native replica" : "online (Expo Go)";
const nativeStore = withIntentStorage({
  get: (key: string) => SecureStore.getItemAsync(key),
  set: async (key: string, value: string) => SecureStore.setItemAsync(key, value),
  delete: async (key: string) => SecureStore.deleteItemAsync(key),
}, intentStorage);
export const app = createApp({
  url,
  sessionStore: Platform.OS === "web" ? localStorageSessionStore() : nativeStore,
  device: Platform.OS === "web" ? webDevice() : nativeAvailable() ? nativeDevice : undefined,
  assets: { keep: "viewed", maxBytes: 67108864 },
});

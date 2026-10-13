import { smokeOrigin } from "snapback4-expo/witness";
import { withIntentStorage } from "./intents";
import { intentStorage } from "./intent-store";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { webDevice } from "snapback4/web";

const sessionStore = withIntentStorage({
  get: (key: string) => SecureStore.getItemAsync(key),
  set: async (key: string, value: string) => SecureStore.setItemAsync(key, value),
  delete: async (key: string) => SecureStore.deleteItemAsync(key),
}, intentStorage);
export const url = smokeOrigin(process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400");
export const tier = Platform.OS === "web" ? "web" : nativeAvailable() ? "native" : "online";
// Browser persistence is explicit: scripts on the page can read the token.
const witnessPersona = Platform.OS === "web" && new URLSearchParams(window.location.search).get("witness") === "web"
  ? new URLSearchParams(window.location.search).get("as") ?? undefined : undefined;
export const app = createApp({ ...(witnessPersona ? { persona: witnessPersona } : {}), url,
  sessionStore: Platform.OS === "web" ? localStorageSessionStore() : sessionStore,
  device: tier === "web" ? webDevice() : tier === "native" ? nativeDevice : undefined,
});

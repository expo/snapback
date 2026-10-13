import { registerWebWitness } from "snapback4/witness-web";
import { api } from "../snapback/generated/api";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { smokeOrigin } from "snapback4-expo/witness";
import { webDevice } from "snapback4/web";

// The backend `snapback4 dev` serves; the iOS simulator reaches this machine's
// loopback. Set EXPO_PUBLIC_SNAPBACK_URL to your TLS deployment for a phone.
export const url = smokeOrigin((Platform.OS === "web" ? new URLSearchParams(window.location.search).get("api") : null) ?? process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400");

// Development and production builds carry the native device (offline data and
// a durable outbox); Expo Go has no native module and uses the online client;
// web uses the wasm device.
export const tier = Platform.OS === "web" ? "web" : nativeAvailable() ? "native" : "online";

const sessionStore = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  delete: (key: string) => SecureStore.deleteItemAsync(key),
};
// Browser storage is readable by any script on the page; SecureStore is not.
const witnessPersona = Platform.OS === "web" && new URLSearchParams(window.location.search).get("witness") === "web"
  ? new URLSearchParams(window.location.search).get("as") ?? undefined : undefined;
export const app = createApp({ ...(witnessPersona ? { persona: witnessPersona } : {}),
  url,
  sessionStore: Platform.OS === "web" ? localStorageSessionStore() : sessionStore,
  device: tier === "web" ? webDevice() : tier === "native" ? nativeDevice : undefined,
});

registerWebWitness(app, api);

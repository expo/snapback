import { proofDevice } from "./np-gate";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { webDevice } from "snapback4/web";
import { withIntentStorage } from "./intents";
import { intentStorage } from "./intent-store";
export const url =
  (Platform.OS === "web" && typeof window !== "undefined"
    ? (window as any).CLIQUE_BACKEND_URL
    : undefined) ??
  process.env.EXPO_PUBLIC_SNAPBACK_URL ??
  "http://127.0.0.1:49360";
export const app = createApp({
  url,
  sessionStore:
    Platform.OS === "web"
      ? localStorageSessionStore()
      : withIntentStorage(
          {
            get: SecureStore.getItemAsync,
            set: SecureStore.setItemAsync,
            delete: SecureStore.deleteItemAsync,
          },
          intentStorage,
        ),
  device:
    Platform.OS === "web"
      ? webDevice()
      : nativeAvailable()
        ? proofDevice
        : undefined,
  assets: { keep: "viewed", maxBytes: 67108864 },
});

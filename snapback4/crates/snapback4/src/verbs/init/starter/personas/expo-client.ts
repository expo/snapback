import { registerWebWitness } from "snapback4/witness-web";
import { api } from "../snapback/generated/api";
import { Platform } from "react-native";
import { createApp, type App } from "snapback4/app";
import { nativeAvailable, nativeDevice } from "snapback4-expo";
import { smokeOrigin } from "snapback4-expo/witness";
import { webDevice } from "snapback4/web";

// The backend `snapback4 dev` serves; the iOS simulator reaches this machine's
// loopback. Set EXPO_PUBLIC_SNAPBACK_URL to point at another `snapback4 dev`.
export const url = smokeOrigin((Platform.OS === "web" ? new URLSearchParams(window.location.search).get("api") : null) ?? process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400");

// Development and production builds carry the native device (offline data and
// a durable outbox); Expo Go has no native module and uses the online client;
// web uses the wasm device.
export const tier = Platform.OS === "web" ? "web" : nativeAvailable() ? "native" : "online";

// Your schema declares `use personas` and no `use identity`, so nobody signs
// in: on `snapback4 dev` an app acts as a declared persona (`dev:alice`) with
// no session. The url must be loopback, and `serve` refuses personas: add
// `use identity` and a sign-in screen before you deploy (`snapback4 guide personas`).
export const personas: readonly string[] = PERSONAS;

// One app per persona, each with its own device and store; close it on switch.
export const openApp = (persona: string): App => {
  const app = createApp({
  url,
  persona,
  device: tier === "web" ? webDevice() : tier === "native" ? nativeDevice : undefined,
});
  registerWebWitness(app, api);
  return app;
};

import { createApp, type App } from "snapback4/app";
import { webDevice } from "snapback4/web";

// The backend `snapback4 dev` serves. Set VITE_SNAPBACK_URL for a deployment.
export const url = (import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:4400").replace(/\/$/, "");

// Your schema declares `use personas` and no `use identity`, so nobody signs
// in: on `snapback4 dev` an app acts as a declared persona (`dev:alice`) with
// no session. The url must be loopback, and `serve` refuses personas: add
// `use identity` and a sign-in screen before you deploy (`snapback4 guide personas`).
export const personas: readonly string[] = PERSONAS;

// One app per persona, each with its own device and store; close it on switch.
export const openApp = (persona: string): App => createApp({ url, persona, device: webDevice() });

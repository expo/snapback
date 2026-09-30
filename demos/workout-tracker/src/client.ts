import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
export const url = (import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:4488").replace(/\/$/, "");
// Explicit persistence: page scripts can read the bearer. Use memory by omitting sessionStore.
export const app = createApp({ url, device: webDevice(), sessionStore: localStorageSessionStore() });

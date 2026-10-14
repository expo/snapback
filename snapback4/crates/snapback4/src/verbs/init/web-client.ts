import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
export const url = (new URLSearchParams(window.location.search).get("api") ?? import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:4400").replace(/\/$/, "");
// Explicit persistence: page scripts can read the bearer. Use memory by omitting sessionStore.
const witnessPersona = new URLSearchParams(window.location.search).get("witness") === "web"
  ? new URLSearchParams(window.location.search).get("as") ?? undefined : undefined;
export const app = createApp({ ...(witnessPersona ? { persona: witnessPersona } : {}), url, device: webDevice(), sessionStore: localStorageSessionStore() });

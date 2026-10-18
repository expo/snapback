import { registerWebWitness } from "snapback4/witness-web";
import { api } from "../snapback/generated/api.ts";
import { createApp, type App } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";

// The backend `snapback4 dev` serves. Set VITE_SNAPBACK_URL for a deployment.
export const url = (new URLSearchParams(window.location.search).get("api") ?? import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:4400").replace(/\/$/, "");

// A device supplies offline reads for synced tables and queues writes.
// With no synced table, init omits the device and uses the browser write journal.
// localStorageSessionStore() keeps the session across reloads; any script on
// this origin can read it. Device-less browser writes require this store.
const witnessPersona = new URLSearchParams(window.location.search).get("witness") === "web"
  ? new URLSearchParams(window.location.search).get("as") ?? undefined : undefined;
export const app = createApp({ ...(witnessPersona ? { persona: witnessPersona } : {}), url, device: webDevice(), sessionStore: localStorageSessionStore() });

registerWebWitness(app, api);

// Dev-only persona choices are hidden for deployed backends. The SDK also
// refuses personas away from loopback; serve never accepts persona sessions.
export const personas: readonly string[] = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname) ? ["alice", "bob"] : [];
export const openApp = (persona: string): App => createApp({ url, persona, device: webDevice() });

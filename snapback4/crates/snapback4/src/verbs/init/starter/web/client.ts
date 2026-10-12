import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";

// The backend `snapback4 dev` serves. Set VITE_SNAPBACK_URL for a deployment.
export const url = (import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:4400").replace(/\/$/, "");

// This schema syncs todos, so the app opens a device: webDevice() keeps a local
// replica and a durable outbox, so reads work offline and writes queue. If no
// table declares `sync`, drop `device`: createApp then journals each write in
// localStorage and ships no wasm (no offline reads; `guide client`).
// localStorageSessionStore() keeps the session across reloads; any script on
// this origin can read it. Omit sessionStore to keep sessions in memory.
export const app = createApp({ url, device: webDevice(), sessionStore: localStorageSessionStore() });

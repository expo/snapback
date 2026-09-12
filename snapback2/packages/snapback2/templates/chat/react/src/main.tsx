import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { browserTokenStore } from "snapback2/client";
import { indexedDbRangeStore, SnapbackProvider } from "snapback2/react";
import { App } from "./App";

const url = import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:3210";
const tokenStore = browserTokenStore(sessionStorage, `snapback2:${url}:auth`);
const offline = { store: indexedDbRangeStore() };
createRoot(document.getElementById("root")!).render(
  <StrictMode><SnapbackProvider url={url} tokenStore={tokenStore} offline={offline}><App /></SnapbackProvider></StrictMode>,
);

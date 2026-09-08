import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { indexedDbRangeStore, SnapbackProvider } from "snapback2/react";
import { App } from "./App";

const url = import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:3210";
// @ref LLP 1018.003#3-tombstones-are-declared-certified-and-shared — which log rows
// evict which bodies is the schema's `tombstones` line, not an option here.
const offline = { store: indexedDbRangeStore() };
createRoot(document.getElementById("root")!).render(
  <StrictMode><SnapbackProvider url={url} persona="alice" offline={offline}><App /></SnapbackProvider></StrictMode>,
);

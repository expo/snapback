import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { indexedDbRangeStore, SnapbackProvider } from "snapback2/react";
import { App } from "./App";

const url = import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:3210";
const offline = { store: indexedDbRangeStore() };
createRoot(document.getElementById("root")!).render(
  <StrictMode><SnapbackProvider url={url} as="alice" offline={offline}><App /></SnapbackProvider></StrictMode>,
);

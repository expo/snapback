import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { indexedDbRangeStore, SnapbackProvider } from "snapback2/react";
import { App } from "./App";

const url = import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:3210";
// @ref LLP 1012#3-the-model-on-one-page-and-the-program-shape — a `removed` or
// `expired` log row evicts the body it names in the same swap it arrives in.
const offline = {
  store: indexedDbRangeStore(),
  onTombstone: (item: { table: string; row: Record<string, unknown> }) =>
    item.table === "deliveries"
      && (item.row.kind === "removed" || item.row.kind === "expired")
      && typeof item.row.messageId === "string"
      ? [{ table: "messages", id: item.row.messageId }]
      : [],
};
createRoot(document.getElementById("root")!).render(
  <StrictMode><SnapbackProvider url={url} as="alice" offline={offline}><App /></SnapbackProvider></StrictMode>,
);

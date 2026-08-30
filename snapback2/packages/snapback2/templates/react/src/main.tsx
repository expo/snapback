import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SnapbackProvider } from "snapback2/react";
import { App } from "./App";

const url = import.meta.env.VITE_SNAPBACK_URL ?? "http://127.0.0.1:3210";
createRoot(document.getElementById("root")!).render(
  <StrictMode><SnapbackProvider url={url} as="alice"><App /></SnapbackProvider></StrictMode>,
);

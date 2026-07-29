import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App } from "./App";
import "./styles.css";

const url = import.meta.env.VITE_CONVEX_URL;
if (!url) throw new Error("VITE_CONVEX_URL is required");
const client = new ConvexReactClient(url);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={client}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);

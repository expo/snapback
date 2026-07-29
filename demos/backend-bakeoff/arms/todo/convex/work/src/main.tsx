import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import App from "./App";

const deploymentUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!deploymentUrl) throw new Error("VITE_CONVEX_URL is required");
const convex = new ConvexReactClient(deploymentUrl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  </StrictMode>,
);

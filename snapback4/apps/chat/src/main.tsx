import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(<App />);

// Development uses Vite's live modules. Offline loading is a production build feature.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}shell.js`, {
      scope: import.meta.env.BASE_URL, updateViaCache: "none",
    }).catch(error => console.error("Offline shell could not be installed", error));
  });
}

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// strictPort: a busy port fails loudly instead of moving the app elsewhere.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // React plus the Snapback client is one ~550 kB chunk (~175 kB gzip); the
  // device's wasm is a separate asset.
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1024 },
});

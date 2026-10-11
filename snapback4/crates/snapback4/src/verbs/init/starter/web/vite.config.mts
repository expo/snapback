import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `.mts` loads this config as ESM whatever package.json's "type" says, so Vite
// never takes its deprecated CommonJS path. strictPort: a busy port fails
// loudly instead of moving the app elsewhere. `init --web-port N` writes N for
// both (run one at a time).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  // React plus the Snapback client is one ~550 kB chunk (~175 kB gzip); the
  // device's wasm is a separate asset.
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1024 },
});

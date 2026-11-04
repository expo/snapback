const proofRange = [process.env.PORT_LO, process.env.PORT_HI];
if (proofRange.some(v => v !== undefined) && (!proofRange.every(v => v && /^\d+$/.test(v)) || Number(proofRange[0]) < 1 || Number(proofRange[1]) > 65535 || Number(proofRange[0]) >= Number(proofRange[1]))) throw Error("PORT_LO/PORT_HI must provide at least two valid ports");
const backendPort = proofRange[0] === undefined ? 4400 : Number(proofRange[0]);
const frontendPort = proofRange[0] === undefined ? 5173 : backendPort + 1;
process.env.VITE_SNAPBACK_URL ??= `http://127.0.0.1:${backendPort}`;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `.mts` loads this config as ESM whatever package.json's "type" says, so Vite
// never takes its deprecated CommonJS path. strictPort: a busy port fails
// loudly instead of moving the app elsewhere. `init --web-port N` writes N for
// both (run one at a time).
export default defineConfig({
  plugins: [react()],
  server: { port: frontendPort, strictPort: true },
  preview: { port: frontendPort, strictPort: true },
  // React plus the Snapback client is one ~550 kB chunk (~175 kB gzip); the
  // device's wasm is a separate asset.
  build: { target: "es2022", sourcemap: false, chunkSizeWarningLimit: 1024 },
});

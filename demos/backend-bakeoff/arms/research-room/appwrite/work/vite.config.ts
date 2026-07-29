import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { vitePort } from "./scripts/constants.mjs";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: vitePort },
});

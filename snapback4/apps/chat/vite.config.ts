import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { offlineShell } from "./shell.ts";

// Vite 8 bundles with rolldown and minifies with oxc (LLP 3000 §7, toolchain).
export default defineConfig({ plugins: [react(), offlineShell()], build: { target: "es2022", sourcemap: false } });

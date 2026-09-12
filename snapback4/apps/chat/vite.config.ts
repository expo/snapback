import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite 8 bundles with rolldown and minifies with oxc (LLP 3000 §7, toolchain).
export default defineConfig({ plugins: [react()], build: { target: "es2022", sourcemap: false } });

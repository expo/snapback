#!/usr/bin/env node
// The client's bytes on the pinned toolchain (rolldown via Vite 8, oxc
// minify): each tier's entry points bundled alone, React external, gzip-9.
// LLP 3000 §3: online tier ≤ Convex's shipped React client; local-first
// tier ≤ PowerSync's web client. Appends one line to metrics/client.jsonl.
import { gzipSync, brotliCompressSync } from "node:zlib";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, appendFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "packages/snapback4/src");
// Vite (rolldown + oxc) is the app's pinned toolchain; borrow it from there.
const { build } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
// The local-first tier is JavaScript over the wasm device: the client, the
// web opener and the wasm-bindgen glue; the wasm itself is measured by
// `scripts/measure-wasm.sh` and reported here beside it when built.
const tiers = {
  online: ["contract.ts", "client.ts", "react.tsx"],
  "local-first": ["contract.ts", "local.ts", "web.ts", "react.tsx"],
};
async function measure() {
  const out = { at: new Date().toISOString(), sha: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), tiers: {} };
  for (const [tier, entries] of Object.entries(tiers)) {
    const dir = mkdtempSync(join(tmpdir(), `sb4-bytes-${tier}-`));
    await build({
      root: pkg,
      logLevel: "silent",
      build: { outDir: dir, emptyOutDir: true, minify: "oxc", target: "es2022", sourcemap: false, lib: { entry: Object.fromEntries(entries.map((e) => [e.replace(/\.tsx?$/, ""), join(pkg, e)])), formats: ["es"] }, rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime"] } },
    });
    // Vite's library build inlines the wasm the web opener names as a data
    // URL; the JavaScript is what is measured here, the wasm below.
    const files = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => Buffer.from(readFileSync(join(dir, f), "utf8").replace(/data:application\/wasm;base64,[A-Za-z0-9+/=]+/g, "wasm")));
    const raw = files.reduce((a, b) => a + b.length, 0);
    const gzip = gzipSync(Buffer.concat(files), { level: 9 }).length;
    const brotli = brotliCompressSync(Buffer.concat(files)).length;
    out.tiers[tier] = { raw, gzip, brotli };
    rmSync(dir, { recursive: true, force: true });
  }
  const wasm = join(pkg, "wasm/snapback4_device_bg.wasm");
  if (existsSync(wasm)) {
    const bytes = readFileSync(wasm);
    out.wasm = { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotliCompressSync(bytes).length };
  }
  mkdirSync(join(root, "metrics"), { recursive: true });
  out.webApp = await measureWebApp();
  appendFileSync(join(root, "metrics/client.jsonl"), JSON.stringify(out) + "\n");
  console.log(JSON.stringify(out));
}

// A representative application's named imports, including identity, the device,
// pagination, pending writes and media. React and authored UI remain external.
// Unlike the historical library tiers, this is a production application build:
// WASM is an emitted asset and each HTTP resource is compressed independently.
export async function measureWebApp() {
  const entry = join(pkg, "__measure_web_app__.ts");
  const source = `
import { createApp } from "./app.ts";
import { localStorageSessionStore } from "./auth.ts";
import { webDevice } from "./web.ts";
import { AppProvider, useAuth, useQuery, useMutation, usePage, useLink, useUpload, useAsset, usePendingWrites } from "./react.tsx";
Object.assign(globalThis, { createApp, localStorageSessionStore, webDevice, AppProvider, useAuth, useQuery, useMutation, usePage, useLink, useUpload, useAsset, usePendingWrites });
`;
  const result = await build({
    configFile: false, root: pkg, logLevel: "silent",
    plugins: [{ name: "client-measurement-entry", resolveId(id) { if (id === entry) return entry; }, load(id) { if (id === entry) return source; } }],
    build: { write: false, minify: "oxc", target: "es2022", sourcemap: false, assetsInlineLimit: 0,
      rollupOptions: { input: entry, external: ["react", "react-dom", "react/jsx-runtime"] } },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(result => result.output);
  const chunks = new Map(output.filter(file => file.type === "chunk").map(file => [file.fileName, file]));
  const initial = new Set();
  const visit = file => {
    if (initial.has(file.fileName)) return;
    initial.add(file.fileName);
    for (const name of file.imports) if (chunks.has(name)) visit(chunks.get(name));
  };
  for (const file of chunks.values()) if (file.isEntry) visit(file);
  const files = output.filter(file => /\.(js|wasm)$/.test(file.fileName)).map(file => {
    const bytes = Buffer.from(file.type === "chunk" ? file.code : file.source);
    return { file: file.fileName, initial: initial.has(file.fileName), raw: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotliCompressSync(bytes).length,
      modules: file.type === "chunk" ? Object.keys(file.modules).map(id => id.startsWith(pkg + "/") ? id.slice(pkg.length + 1) : id) : [] };
  });
  const sum = selected => Object.fromEntries(["raw", "gzip", "brotli"].map(key => [key, selected.reduce((sum, file) => sum + file[key], 0)]));
  return { initial: sum(files.filter(file => file.initial)), emitted: sum(files), files,
    note: "Initial static JS graph; React and authored UI excluded. Emitted totals include deferred WASM and optional worker assets. Device opening still waits for the local runtime; this does not measure first data or offline readiness." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--web-app")) console.log(JSON.stringify(await measureWebApp()));
  else await measure();
}

#!/usr/bin/env node
// The client's bytes on the pinned toolchain (rolldown via Vite 8, oxc
// minify): each tier's entry points bundled alone, React external, gzip-9.
// LLP 3000 §3: online tier ≤ Convex's shipped React client; local-first
// tier ≤ PowerSync's web client. Appends one line to metrics/client.jsonl.
import { gzipSync, brotliCompressSync } from "node:zlib";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, appendFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = join(root, "packages/snapback4/src");
// Vite (rolldown + oxc) is the app's pinned toolchain; borrow it from there.
const { build } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
const tiers = {
  online: ["contract.ts", "client.ts", "react.tsx"],
  "local-first": ["contract.ts", "local.ts", "react.tsx"],
};
const out = { at: new Date().toISOString(), sha: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), tiers: {} };
for (const [tier, entries] of Object.entries(tiers)) {
  const dir = mkdtempSync(join(tmpdir(), `sb4-bytes-${tier}-`));
  await build({
    root: pkg,
    logLevel: "silent",
    build: { outDir: dir, emptyOutDir: true, minify: "oxc", target: "es2022", sourcemap: false, lib: { entry: Object.fromEntries(entries.map((e) => [e.replace(/\.tsx?$/, ""), join(pkg, e)])), formats: ["es"] }, rollupOptions: { external: ["react", "react-dom", "react/jsx-runtime"] } },
  });
  const files = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(dir, f)));
  const raw = files.reduce((a, b) => a + b.length, 0);
  const gzip = gzipSync(Buffer.concat(files), { level: 9 }).length;
  const brotli = brotliCompressSync(Buffer.concat(files)).length;
  out.tiers[tier] = { raw, gzip, brotli };
  rmSync(dir, { recursive: true, force: true });
}
mkdirSync(join(root, "metrics"), { recursive: true });
appendFileSync(join(root, "metrics/client.jsonl"), JSON.stringify(out) + "\n");
console.log(JSON.stringify(out));

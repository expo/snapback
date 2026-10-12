#!/usr/bin/env node
// LLP 3000.013.000 §9: what a writing browser page ships with and without the
// device. Two Vite production builds of the same page (createApp, a session
// store, one mutate), one adding `device: webDevice()`. Every emitted asset is
// counted, raw and gzip-9; the device's wasm and worker are named. Prints JSON.
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "packages/snapback4/src");
const { build } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
const page = device => `import { createApp } from "${join(src, "app.ts")}";
import { localStorageSessionStore } from "${join(src, "auth.ts")}";
${device ? `import { webDevice } from "${join(src, "web.ts")}";` : ""}
const app = createApp({ url: "http://127.0.0.1:4400", sessionStore: localStorageSessionStore()${device ? ", device: webDevice()" : ""} });
document.querySelector("button")!.onclick = () => { void app.mutate({ kind: "mutation", name: "click" }, {}); };
`;
const files = dir => readdirSync(dir, { recursive: true }).map(String).filter(file => statSync(join(dir, file)).isFile());
const out = {};
for (const [name, device] of [["online", false], ["device", true]]) {
  const dir = mkdtempSync(join(tmpdir(), `sb4-online-writes-${name}-`));
  try {
    writeFileSync(join(dir, "main.ts"), page(device));
    writeFileSync(join(dir, "index.html"), `<!doctype html><button>click</button><script type="module" src="./main.ts"></script>`);
    await build({ root: dir, logLevel: "silent", build: { outDir: join(dir, "dist"), emptyOutDir: true, target: "es2022", assetsInlineLimit: 0 } });
    const assets = files(join(dir, "dist")).map(file => {
      const bytes = readFileSync(join(dir, "dist", file));
      return { file: relative(".", file).replace(/-[A-Za-z0-9_-]{8}\./, "."), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
    }).filter(asset => !asset.file.endsWith(".html"));
    const sum = list => list.reduce((acc, a) => ({ raw: acc.raw + a.raw, gzip: acc.gzip + a.gzip }), { raw: 0, gzip: 0 });
    out[name] = { total: sum(assets), js: sum(assets.filter(a => a.file.endsWith(".js"))), wasm: sum(assets.filter(a => a.file.endsWith(".wasm"))), assets };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
out.saved = { raw: out.device.total.raw - out.online.total.raw, gzip: out.device.total.gzip - out.online.total.gzip };
console.log(JSON.stringify(out, null, 2));

// What every Chromium witness needs: the local-first client bundled into a
// page, a seeded `snapback4 dev`, and a browser with a CDP session for the
// heap. Each witness seeds its own rows and measures its own thing.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, globSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The binary under test: `SNAPBACK4_BIN` (a release build for throughput numbers), else the debug build. */
export const binary = () => process.env.SNAPBACK4_BIN ? resolve(process.env.SNAPBACK4_BIN) : join(root, "target/debug/snapback4");

export function chromiumExecutable() {
  const candidates = [
    ...globSync(`${process.env.HOME}/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`).sort().reverse(),
    ...globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`).sort().reverse(),
    ...globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`).sort().reverse(),
    ...globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-linux/chrome`).sort().reverse(),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const exe = candidates.find((path) => existsSync(path));
  if (!exe) throw new Error("no Chromium: install playwright's chromium or Google Chrome");
  return exe;
}

/** The chat backend's scale seed: `groups` conversations of `messages`
 * each, `members` principals in every one (alice admin, bob member, then
 * fillers), so bob's partition is the whole thing. */
export function scaleSeed({ groups, messages, members }) {
  const rows = [];
  const fillers = Array.from({ length: Math.max(0, members - 2) }, (_, n) => `dev:member${n}`);
  for (let g = 0; g < groups; g++) {
    const conversation = `c${String(g).padStart(3, "0")}`;
    rows.push({ table: "conversations", row: { id: conversation, title: `Group ${g}`, creatorId: "dev:alice" } });
    for (const [n, principal] of ["dev:alice", "dev:bob", ...fillers].entries()) {
      rows.push({ table: "memberships", row: { id: `${conversation}-m${n}`, conversationId: conversation, principal, role: n === 0 ? "admin" : "member", joinedAt: n } });
    }
    for (let m = 0; m < messages; m++) {
      rows.push({ table: "messages", row: { id: `${conversation}-msg${String(m).padStart(5, "0")}`, conversationId: conversation, authorId: m % 2 ? "dev:alice" : "dev:bob", body: `message ${m} in group ${g}: the quick brown fox jumps over the lazy dog`, at: 1_700_000_000_000 + g * 1_000_000 + m, editedAt: null, photo: null } });
    }
  }
  return rows;
}

/** A `snapback4 dev` on the chat backend in a temporary project, seeded. */
export async function devServer({ seed, extraSource = "", port = 4460 + (process.pid % 20) }) {
  const app = mkdtempSync(join(tmpdir(), "sb4-witness-app-"));
  cpSync(join(root, "apps/chat/snapback"), join(app, "snapback"), { recursive: true });
  rmSync(join(app, "snapback/generated"), { recursive: true, force: true });
  if (extraSource) writeFileSync(join(app, "snapback/media.q"), extraSource);
  const api = `http://127.0.0.1:${port}`;
  const server = spawn(binary(), ["dev", "--port", String(port), "--no-watch"], { cwd: app, stdio: ["ignore", "ignore", "inherit"] });
  for (let i = 0; i < 100; i++) { try { await fetch(api); break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
  const t0 = performance.now();
  const seeded = await fetch(`${api}/seed`, { method: "POST", body: JSON.stringify(seed) }).then((r) => r.json());
  const seedMs = +(performance.now() - t0).toFixed(1);
  return { api, app, seeded: seeded.seeded, seedMs, close() { server.kill(); rmSync(app, { recursive: true, force: true }); } };
}

/** Bundle the client into a page, start a seeded dev server, open Chromium. */
export async function launch({ seed, extraSource = "", headless = true }) {
  const require = createRequire(join(root, "package.json"));
  const { chromium } = require("playwright-core");
  const exe = chromiumExecutable();
  const { build } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
  // The page: the one client over the wasm device, bundled with the wasm
  // beside it (`scripts/build-wasm.sh` first), served from a directory.
  const harness = mkdtempSync(join(tmpdir(), "sb4-witness-"));
  const entry = join(harness, "harness.ts");
  writeFileSync(entry, `import { createLocalClient } from "${join(root, "packages/snapback4/src/local.ts")}";\nimport { webDevice } from "${join(root, "packages/snapback4/src/web.ts")}";\n(window as any).createLocalClient = (options: any) => createLocalClient({ device: webDevice(), ...options });\n`);
  writeFileSync(join(harness, "index.html"), `<!doctype html><title>witness</title><script type="module" src="./harness.ts"></script>`);
  await build({ root: harness, logLevel: "silent", build: { outDir: join(harness, "dist"), emptyOutDir: true, minify: false, target: "es2022", assetsInlineLimit: 0 } });

  const dev = await devServer({ seed, extraSource });
  const { api, app, seeded, seedMs } = dev;

  const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
  const pageServer = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const file = join(harness, "dist", path === "/" ? "index.html" : path);
    if (!existsSync(file)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", types[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  await new Promise((r) => pageServer.listen(0, "127.0.0.1", r));
  const pageUrl = `http://127.0.0.1:${pageServer.address().port}/`;
  let browser;
  try {
  browser = await chromium.launch({ executablePath: exe, headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const ready = async () => { await page.goto(pageUrl); await page.waitForFunction(() => typeof window.createLocalClient === "function"); };
  await ready();
  return {
    page,
    api,
    app,
    seeded,
    seedMs,
    chromium: exe.includes("Testing") ? exe.split("/").find((p) => p.startsWith("chromium-")) : "system chrome",
    async reload() { await page.reload(); await page.waitForFunction(() => typeof window.createLocalClient === "function"); },
    async heapMb() { const { metrics } = await cdp.send("Performance.getMetrics"); return +((metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1_048_576).toFixed(1); },
    async close() {
      await browser.close();
      pageServer.close();
      rmSync(harness, { recursive: true, force: true });
      dev.close();
    },
  };
  } catch (error) {
    await browser?.close();
    pageServer.close();
    dev.close();
    rmSync(harness, { recursive: true, force: true });
    throw error;
  }
}

export function record(line) {
  const path = join(root, "metrics/witness.jsonl");
  writeFileSync(path, `${readFileSync(path, "utf8")}${JSON.stringify(line)}\n`);
}

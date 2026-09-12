#!/usr/bin/env node
// The Chromium witness (LLP 2000.000 §11.5): what the simulator cannot
// reach — IndexedDB. A real page on the local-first client against a real
// `snapback4 dev`: the replica syncs into IndexedDB, reads run over it,
// a queued write survives a reload, and the store's bytes are what the
// server sent. Prints one JSON line.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, cpSync, rmSync, readFileSync, globSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(process.env.HOME, "projects/snapback/snapback2/packages/snapback2/package.json"));
const { chromium } = require("playwright-core");
const candidates = [
  ...globSync(`${process.env.HOME}/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`).sort().reverse(),
  ...globSync(`${process.env.HOME}/.cache/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`).sort().reverse(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const exe = candidates.find((path) => existsSync(path));
if (!exe) throw new Error("no Chromium: install playwright's chromium or Google Chrome");

// 1. Bundle a harness page that exposes the client to the page.
const { build } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
const harness = mkdtempSync(join(tmpdir(), "sb4-witness-"));
const entry = join(harness, "harness.ts");
const { writeFileSync } = await import("node:fs");
writeFileSync(entry, `import { createLocalClient } from "${join(root, "packages/snapback4/src/local.ts")}";\n(window as any).createLocalClient = createLocalClient;\n`);
await build({ root: harness, logLevel: "silent", build: { outDir: join(harness, "dist"), emptyOutDir: true, minify: false, target: "es2022", lib: { entry, formats: ["es"], fileName: () => "harness.js" } } });
const bundle = readFileSync(join(harness, "dist/harness.js"), "utf8");

// 2. A dev server on the chat backend, seeded.
const app = mkdtempSync(join(tmpdir(), "sb4-witness-app-"));
cpSync(join(root, "apps/chat/snapback"), join(app, "snapback"), { recursive: true });
rmSync(join(app, "snapback/generated"), { recursive: true, force: true });
const port = 4460 + (process.pid % 20);
const api = `http://127.0.0.1:${port}`;
const server = spawn(join(root, "target/debug/snapback4"), ["dev", "--port", String(port), "--no-watch"], { cwd: app, stdio: ["ignore", "ignore", "inherit"] });
for (let i = 0; i < 100; i++) { try { await fetch(api); break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
await fetch(`${api}/seed`, { method: "POST", body: JSON.stringify([
  { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
  { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
  { table: "memberships", row: { id: "m2", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 2 } },
  ...Array.from({ length: 300 }, (_, n) => ({ table: "messages", row: { id: `seed${String(n).padStart(4, "0")}`, conversationId: "c1", authorId: n % 2 ? "dev:alice" : "dev:bob", body: `seed ${n}`, at: 1_700_000_000_000 + n, editedAt: null, photo: null } })),
]) });

// 3. The page.
const pageServer = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(`<!doctype html><title>witness</title><script type="module">${bundle}</script>`); });
await new Promise((r) => pageServer.listen(0, "127.0.0.1", r));
const pageUrl = `http://127.0.0.1:${pageServer.address().port}/`;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const out = { chromium: exe.includes("Testing") ? exe.split("/").find((p) => p.startsWith("chromium-")) : "system chrome" };
try {
  await page.goto(pageUrl);
  await page.waitForFunction(() => typeof window.createLocalClient === "function");
  // First session: sync into IndexedDB, read locally, send while offline (a
  // blocked fetch), then leave the page with the write queued.
  const first = await page.evaluate(async (api) => {
    const t0 = performance.now();
    // The client's fetch is looked up per call, so the page can cut the link.
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1, fetch: (...args) => window.fetch(...args) });
    const synced = performance.now() - t0;
    const thread = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
    const inbox = await client.query({ kind: "query", name: "inbox" }, {});
    const state = await client.replica.state();
    // Go offline: every fetch fails from here.
    const realFetch = window.fetch;
    window.fetch = () => Promise.reject(new TypeError("offline"));
    const write = await client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "queued while offline" });
    const local = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
    window.fetch = realFetch;
    await client.close();
    return { syncMs: +synced.toFixed(1), threadRows: thread.data.length, threadComplete: thread.complete, next: !!thread.next, count: inbox.data[0].count, watermark: state.watermark, write: write.state, pendingLocally: local.data[0].pending === true, localFresh: local.fresh };
  }, api);
  Object.assign(out, { first });
  // Second session: a fresh page on the same origin opens the same
  // IndexedDB; the replica is already there and the queued write lands.
  await page.reload();
  await page.waitForFunction(() => typeof window.createLocalClient === "function");
  const second = await page.evaluate(async (api) => {
    const rows = await new Promise((resolve, reject) => {
      const open = indexedDB.open(`snapback4:${api}:dev:bob`, 1);
      open.onsuccess = () => { const tx = open.result.transaction("rows"); const req = tx.objectStore("rows").count(); req.onsuccess = () => { resolve(req.result); open.result.close(); }; req.onerror = () => reject(req.error); };
      open.onerror = () => reject(open.error);
    });
    const t0 = performance.now();
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1 });
    const reopened = performance.now() - t0;
    let thread;
    for (let i = 0; i < 100; i++) {
      thread = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
      if (thread.data[0]?.body === "queued while offline" && !thread.data[0].pending) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const state = await client.replica.state();
    await client.close();
    return { rowsInIdbBeforeOpen: rows, reopenMs: +reopened.toFixed(1), landed: thread.data[0]?.body === "queued while offline" && !thread.data[0].pending, watermark: state.watermark };
  }, api);
  Object.assign(out, { second });
  out.ok = first.threadRows === 50 && first.threadComplete && first.next && first.count === 300 && first.write === "pending" && first.pendingLocally && !first.localFresh && second.rowsInIdbBeforeOpen > 300 && second.landed && second.watermark > first.watermark;
} finally {
  await browser.close();
  server.kill();
  pageServer.close();
  rmSync(harness, { recursive: true, force: true });
  rmSync(app, { recursive: true, force: true });
}
console.log(JSON.stringify({ witness: "chromium-indexeddb", ...out }));
process.exit(out.ok ? 0 : 1);

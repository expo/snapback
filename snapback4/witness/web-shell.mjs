#!/usr/bin/env node
// Production export, real service worker, and the wasm/IndexedDB replica.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromiumExecutable } from "./lib.mjs";
import { webShell } from "../packages/snapback4/bin/web-shell.js";

const root = resolve(import.meta.dirname, "..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const executablePath = chromiumExecutable();
const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
const { build } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")));
const dir = await mkdtemp(join(tmpdir(), "sb4-web-shell-"));
const started = performance.now();
let backend, server, browser, output = "";
try {
  await mkdir(join(dir, "snapback"));
  await writeFile(join(dir, "snapback/schema.q"), `use identity guests
table notes:
  owner: principal
  body: text <=100
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation add(body: text <=100):
  insert notes { owner: viewer, body }
query list():
  return notes[viewer] first 10 by byOwner
`);
  backend = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [backend.stdout, backend.stderr]) stream.on("data", bytes => { output += bytes; });
  let api;
  for (let n = 0; n < 500 && !api; n++) { assert.equal(backend.exitCode, null, output); api = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (!api) await delay(10); }
  assert.ok(api, output);
  await writeFile(join(dir, "index.html"), '<!doctype html><title>Snapback offline shell</title><h1>Exported shell</h1><main>Opening replica…</main><script type="module" src="/entry.js"></script>');
  await writeFile(join(dir, "entry.js"), `import { createApp } from "snapback4/app";
import { localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
const app = createApp({ url: ${JSON.stringify(api)}, device: webDevice(), sessionStore: localStorageSessionStore() });
window.app = app;
await app.ready;
if (app.auth.state === 'signed-out') { const result = await app.auth.guest(); if (!result.ok) throw Error(result.why.message); }
let read = await app.client.query({ kind: 'query', name: 'list' }, {});
if ('data' in read && read.data.length === 0 && read.fresh) {
  await app.mutate({ kind: 'mutation', name: 'add' }, { body: 'Replica note' });
  await app.client.sync();
  read = await app.client.query({ kind: 'query', name: 'list' }, {});
}
document.querySelector('main').textContent = 'data' in read ? read.data.map(row => row.body).join(', ') : JSON.stringify(read);
document.body.dataset.link = app.client.link();
document.body.dataset.viewer = app.auth.viewer;
`);
  await build({ root: dir, base: "/chat/", configFile: false, logLevel: "error", resolve: { alias: ["app", "auth", "web"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/dist/${name}.js`) })) }, build: { target: "es2022", outDir: "dist" } });
  const shell = await webShell(join(dir, "dist"), "/chat/");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (!path.startsWith("/chat/")) { res.writeHead(404).end(); return; }
    const leaf = path.slice(6) || "index.html";
    try { const content = await readFile(join(dir, "dist", leaf)); res.writeHead(200, { "content-type": types[extname(leaf)] ?? "application/octet-stream", "cache-control": "no-store" }); res.end(content); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/chat/`;
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext(), errors = [];
  let page = await context.newPage();
  const track = page => { page.setDefaultTimeout(15000); page.on("pageerror", error => { errors.push(error.message); console.error(error.message); }); }; track(page);
  await page.goto(url);
  console.error("web-shell: online page opened");
  await page.waitForFunction(() => document.querySelector("main").textContent === "Replica note");
  const viewer = await page.getAttribute("body", "data-viewer");
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active));
  const entries = await page.evaluate(async () => {
    const names = await caches.keys();
    return Promise.all(names.filter(name => name.startsWith("snapback4-shell:")).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)));
  });
  assert.ok(entries.flat().every(address => address.startsWith(url)), "shell cache contains only export files");
  console.error("web-shell: replica and shell acquired");
  await page.close();
  const stopped = new Promise(resolve => backend.once("exit", resolve)); backend.kill("SIGTERM"); await stopped;
  await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  server = undefined;
  await context.setOffline(true);
  page = await context.newPage(); track(page);
  await page.goto(url + "deep/route");
  console.error("web-shell: offline navigation opened");
  await page.waitForFunction(() => document.querySelector("main").textContent === "Replica note");
  assert.equal(await page.locator("h1").textContent(), "Exported shell");
  assert.equal(await page.getAttribute("body", "data-link"), "offline");
  assert.equal(await page.getAttribute("body", "data-viewer"), viewer);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("main").textContent === "Replica note");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ witness: "web-shell", ok: true, files: shell.files, offlineNewPage: true, offlineReload: true, replica: true, accountRestored: true, backendStopped: true, shellServerStopped: true, elapsedMs: Math.round(performance.now() - started) }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  if (backend?.exitCode === null && backend?.signalCode === null) { const stopped = new Promise(resolve => backend.once("exit", resolve)); backend.kill("SIGTERM"); await stopped; }
  await rm(dir, { recursive: true, force: true });
}

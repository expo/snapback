// Whole-partition acquisition on isolated SQLite backups of the completed Clique scale replay.
// Run from snapback4 after building production, wasm and the package. No source store is mutated.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, rmSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromiumExecutable } from "../../witness/lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const evidence = process.env.INVENTORY_EVIDENCE ?? join(root, "reports/20260925-intent-integration-r9");
const scratch = process.env.INVENTORY_SCRATCH ?? join(root, "target/intent-integration-r9-scale");
const app = process.env.CLIQUE_SCALE_APP ?? join(process.env.HOME, "clique-cmp-20260925/lanes/astra-snapback4/scale-instance");
const fixture = process.env.CLIQUE_SCALE_LOG ?? join(process.env.HOME, "clique-cmp-20260925/instrument/fixtures/scale.log");
const legacyControl = process.argv.includes("--legacy-own");
const inventoryFile = legacyControl ? "inventory-own-control.json" : "inventory.json";
const modes = legacyControl ? ["legacy-own"] : ["follows-full", "follows-online", "follows-full-own", "follows-online-own"];
const binaries = Object.fromEntries(modes.map(mode => [mode, legacyControl ? (process.env.SNAPBACK4_BEFORE_BIN ?? join(process.env.HOME, ".cache/clique/snapback4-0.4.1/snapback4")) : (process.env.SNAPBACK4_BIN ?? join(root, "target/production/snapback4"))]));
const own = name => ["posts", "reposts", "follows"].includes(name) || /^following(Posts|RemovedEvents|Feed|Edges|Work)$/.test(name);
function digest(file) {
  const fd = openSync(file, "r"), hash = createHash("sha256"), buffer = Buffer.alloc(4 * 1024 * 1024);
  let bytes = 0;
  try {
    for (let size; (size = readSync(fd, buffer)) > 0;) { bytes += size; hash.update(buffer.subarray(0, size)); }
    return { bytes, sha256: hash.digest("hex") };
  } finally { closeSync(fd); }
}
function fingerprints(directory, prefix = "") {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const name = prefix + entry.name, path = join(directory, entry.name);
    return entry.isDirectory() ? Object.entries(fingerprints(path, name + "/")) : [[name, digest(path)]];
  }));
}
mkdirSync(scratch, { recursive: true });
mkdirSync(evidence, { recursive: true });
const saved = join(scratch, "snapshot.sqlite");
if (!existsSync(saved)) {
  const copy = spawnSync("python3", ["-c", "import sqlite3,sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()", join(app, ".snapback4/store.sqlite"), saved], { stdio: "inherit" });
  assert.equal(copy.status, 0, "read-only SQLite backup");
}
if (process.argv.includes("--prepare")) { console.log("scale snapshot prepared"); process.exit(0); }
for (const mode of modes) {
  const dir = join(scratch, mode);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "snapback"), { recursive: true });
  mkdirSync(join(dir, ".snapback4"), { recursive: true });
  copyFileSync(saved, join(dir, ".snapback4/store.sqlite"));
  for (const file of readdirSync(join(app, "snapback")).filter(file => file.endsWith(".q"))) {
    let source = readFileSync(join(app, "snapback", file), "utf8");
    if (!legacyControl && file === "schema.q") {
      for (const table of ["posts", "reposts"]) {
        const begin = source.indexOf(`table ${table}:`);
        const sync = source.indexOf("sync public", begin);
        assert.ok(begin >= 0 && sync > begin);
        source = source.slice(0, sync) + "sync public last 1000 by .at" + source.slice(sync + "sync public".length);
      }
    }
    if (mode.startsWith("follows-online")) {
      source = source.replace(/(table follows:[\s\S]*?)sync public/, "$1online only");
    }
    if (mode.endsWith("-own")) {
      // Independent acquisition of precisely the view's own partition. Keep
      // the same source rows/rules; other app tables and aggregates stay online.
      source = source.replace(/^table (\w+):[\s\S]*?(?=^\S|$(?![\s\S]))/gm, block => {
        const name = block.match(/^table (\w+):/)[1];
        return own(name) ? block : block.replace(/^  sync .*$/gm, "  online only");
      }).replace(/^(view \w+: count[^\n]*\n)(?:  online only\n)?/gm, "$1  online only\n");
    }
    writeFileSync(join(dir, "snapback", file), source);
  }
}

const require = createRequire(join(root, "package.json"));
const { chromium } = require("playwright-core");
const { build } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
const harness = join(scratch, "browser");
mkdirSync(harness, { recursive: true });
writeFileSync(join(harness, "harness.ts"), `import {createLocalClient} from ${JSON.stringify(join(root, "packages/snapback4/src/local.ts"))};
import {webDevice} from ${JSON.stringify(join(root, "packages/snapback4/src/web.ts"))};
Object.assign(window, {createLocalClient, webDevice});`);
writeFileSync(join(harness, "index.html"), '<!doctype html><title>bounded Following</title><script type="module" src="./harness.ts"></script>');
await build({ root: harness, logLevel: "silent", build: { outDir: join(harness, "dist"), emptyOutDir: true, minify: false, target: "es2022", assetsInlineLimit: 0 } });
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
const pageServer = createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  const file = join(harness, "dist", path === "/" ? "index.html" : path);
  if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
  res.end(readFileSync(file));
});
await new Promise(resolve => pageServer.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true });
const credentials = readFileSync(fixture, "utf8").split("\n").find(line => line.includes(" u0500 register "))
  .match(/"(?:[^"\\]|\\.)*"|\S+/g).map(word => word.startsWith('"') ? JSON.parse(word) : word).slice(3);
const result = {
  at: new Date().toISOString(), browser: browser.version(), node: process.version,
  harness: digest(fileURLToPath(import.meta.url)), actor: "u0500", fixture: digest(fixture),
  sourceStore: join(app, ".snapback4/store.sqlite"),
  sourceSnapshot: digest(saved),
  browserBundle: fingerprints(join(harness, "dist")),
  quarry: Object.fromEntries(modes.map(mode => [mode, fingerprints(join(scratch, mode, "snapback"))])),
  scope: "whole authorized device partition, including all additional application tables; snapshot row bytes are UTF-8 JSON of event.data, wire bytes include snapshot and catch-up envelopes; time is authenticated createLocalClient through completed IndexedDB acquisition, excluding login, page load and UI rendering",
  floor: legacyControl ? null : 1000, inboxFloor: legacyControl ? null : 1000, historyWindow: 1000, ownedEvents: legacyControl ? "legacy fully synced event rows" : "source-row slots; zero owned rows for either floored kind", design: legacyControl ? "U round-1 before server, view-only control on current wasm/IndexedDB" : "LLP 3000.016 revision 12",
  storageFormat: "Lane V IndexedDB format 2 (verified row-buckets marker); rowBytes are logical UTF-8 row JSON, not disk usage",
  revision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  clientWasm: digest(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")),
  binaries: Object.fromEntries(Object.entries(binaries).map(([mode, path]) => [mode, { path, ...digest(path) }])),
  runs: [],
};
try {
  for (const mode of modes) {
    const server = spawn(binaries[mode], ["dev", "--port", "0", "--replay", "--no-watch"], { cwd: join(scratch, mode), stdio: ["ignore", "pipe", "pipe"] });
    console.log(JSON.stringify({ mode, stage: "server-start", pid: server.pid }));
    const exited = once(server, "exit");
    let log = "", url;
    for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const deadline = Date.now() + 240000;
      while (!url && Date.now() < deadline) {
        assert.equal(server.exitCode, null, log);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(url, "server readiness");
      await page.goto(`http://127.0.0.1:${pageServer.address().port}/`);
      await page.waitForFunction(() => typeof window.createLocalClient === "function");
      const measured = await page.evaluate(async ({ url, credentials }) => {
        const login = await fetch(url + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: credentials[0], password: credentials[1] }) }).then(response => response.json());
        if (!login.session) throw Error("fixture login failed");
        const backend = await fetch(url + "/schema", { headers: { authorization: "Bearer " + login.session.token } }).then(response => response.json());
        const tables = Object.fromEntries(Object.keys(backend.schema.tables).filter(name => backend.schema.tables[name].sync).map(name => [name, { rows: 0, bytes: 0 }]));
        let wireBytes = 0, snapshotPages = 0, catchupPages = 0;
        const start = performance.now();
        const client = await window.createLocalClient({ url, session: login.session, device: window.webDevice(), waitSeconds: 1,
          fetch: async (...args) => {
            const response = await fetch(...args);
            if (new URL(args[0]).pathname === "/sync") {
              const text = await response.clone().text(), page = JSON.parse(text);
              wireBytes += new TextEncoder().encode(text).byteLength;
              if (page.snapshot) {
                snapshotPages++;
                for (const event of page.events ?? []) {
                  const inventory = tables[event.table] ??= { rows: 0, bytes: 0 };
                  inventory.rows++;
                  inventory.bytes += new TextEncoder().encode(JSON.stringify(event.data)).byteLength;
                }
              } else catchupPages++;
            }
            return response;
          },
        });
        const acquisitionMs = performance.now() - start;
        const acquired = client.acquired;
        await client.close();
        // Inspect persistence after stopping the acquisition timer. These are
        // record counts, not a physical IndexedDB disk-size measurement.
        const storage = [];
        for (const info of await indexedDB.databases()) {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(info.name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            if (!db.objectStoreNames.contains("changes")) continue;
            const records = await new Promise((resolve, reject) => {
              const request = db.transaction("changes", "readonly").objectStore("changes").getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            storage.push({ format: records.find(r => r.s === "$format" && r.k === "row-buckets")?.v,
              buckets: records.filter(r => r.s === "$bucket").length, records: records.length });
          } finally { db.close(); }
        }
        return { acquisitionMs, acquired, tables, wireBytes, snapshotPages, catchupPages, storage };
      }, { url, credentials });
      assert.equal(measured.acquired, true);
      assert.ok(measured.storage.some(s => s.format === "2" && s.buckets > 0), "packed acquisition persisted");
      measured.rows = Object.values(measured.tables).reduce((sum, table) => sum + table.rows, 0);
      measured.rowBytes = Object.values(measured.tables).reduce((sum, table) => sum + table.bytes, 0);
      result.runs.push({ mode, ...measured });
      console.log(JSON.stringify({ mode, acquisitionMs: measured.acquisitionMs, rows: measured.rows, rowBytes: measured.rowBytes, wireBytes: measured.wireBytes }));
      writeFileSync(join(evidence, inventoryFile), JSON.stringify(result, null, 2) + "\n");
    } finally {
      await context.close();
      if (server.exitCode === null && server.signalCode === null) server.kill("SIGTERM");
      await exited;
    }
  }
  result.baseline = JSON.parse(readFileSync(join(root, "reports/20260925-bounded-following-r1/inventory.json"), "utf8"));
  result.slotsRound0 = JSON.parse(readFileSync(join(root, "reports/20260925-event-slots/inventory.json"), "utf8"));
  for (const run of [...result.baseline.runs, ...result.runs]) {
    run.viewOwn = Object.entries(run.tables).filter(([name]) => own(name)).reduce((a, [, t]) => ({ rows: a.rows + t.rows, rowBytes: a.rowBytes + t.bytes }), { rows: 0, rowBytes: 0 });
  }
  result.reduction = Object.fromEntries(result.runs.map(run => [run.mode, {
    viewRowsVsRound1Before: result.baseline.runs[0].viewOwn.rows / run.viewOwn.rows,
    viewBytesVsRound1Before: result.baseline.runs[0].viewOwn.rowBytes / run.viewOwn.rowBytes,
    viewRowsVsRound1After: result.baseline.runs[1].viewOwn.rows / run.viewOwn.rows,
    viewBytesVsRound1After: result.baseline.runs[1].viewOwn.rowBytes / run.viewOwn.rowBytes,
  }]));
  writeFileSync(join(evidence, inventoryFile), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ reduction: result.reduction }));
} finally {
  await browser.close();
  pageServer.close();
}

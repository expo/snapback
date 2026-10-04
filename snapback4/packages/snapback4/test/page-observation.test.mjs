import { waitFor as awaitState } from './helpers/wait.mjs';
import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "../dist/app.js";
import { memorySessionStore } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";
import { chromiumExecutable } from "../../../witness/lib.mjs";
import { exercise } from "./fixtures/page-observation.mjs";

const root = resolve(import.meta.dirname, "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");

async function backend(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-kept-page-"));
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), readFileSync(new URL("./fixtures/page-ready.q", import.meta.url)));
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise(resolve => host.once("exit", resolve));
  let log = "";
  host.stdout.on("data", bytes => { log += bytes; }); host.stderr.on("data", bytes => { log += bytes; });
  t.after(async () => {
    if (host.exitCode === null && host.signalCode === null) host.kill("SIGTERM");
    await exited; rmSync(dir, { recursive: true, force: true });
  });
  const url = await awaitState(() => {
    assert.equal(host.exitCode, null, log);
    return log.match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];
  }, "page observation server", { diagnostics: () => log });
  return { url, dir };
}

test("native process devices withdraw an expired inbox during fallback, offline and on account switch", { timeout: hangBudget(2) }, async t => {
  const { url, dir } = await backend(t);
  let serial = 0;
  const result = await exercise({ url, createApp, memorySessionStore,
    deviceFactory: () => processDevice({ dir: join(dir, `device-${serial++}`), binary }) });
  assert.equal(result.initialUnread, 3);
  assert.equal(result.expiryCleared, true);
  assert.equal(result.serverFallback, true);
  assert.equal(result.accountCleared, true);
});

test("web IndexedDB device withdraws expired inbox data in useQuery and usePage", { timeout: hangBudget(11) }, async t => {
  let executablePath;
  try { executablePath = chromiumExecutable(); }
  catch (error) { t.skip(`Chromium unavailable: ${error.message}`); return; }
  const { url, dir } = await backend(t);
  const require = createRequire(join(root, "packages/snapback4/package.json"));
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  const { createServer } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
  writeFileSync(join(dir, "index.html"), '<!doctype html><div id="app"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(dir, "harness.jsx"), `
    import { createElement as h } from "react";
    import { flushSync } from "react-dom";
    import { createRoot } from "react-dom/client";
    import { createApp } from "/@fs/${root}/packages/snapback4/src/app.ts";
    import { localStorageSessionStore } from "/@fs/${root}/packages/snapback4/src/auth.ts";
    import { webDevice } from "/@fs/${root}/packages/snapback4/src/web.ts";
    import { AppProvider, useQuery, usePage } from "/@fs/${root}/packages/snapback4/src/react.tsx";
    import { exercise } from "/@fs/${root}/packages/snapback4/test/fixtures/page-observation.mjs";
    const query = { kind: "query", name: "inbox" };
    let latest;
    function Inbox() {
      latest = { query: useQuery(query, {}), page: usePage(query, {}) };
      return h("pre", null, JSON.stringify(latest));
    }
    let storeNumber = 0;
    window.run = () => exercise({ url: location.origin + "/backend", createApp,
      memorySessionStore: () => {
        const prefix = "page-observation-" + storeNumber++ + ":";
        return localStorageSessionStore({ getItem: key => localStorage.getItem(prefix + key),
          setItem: (key, value) => localStorage.setItem(prefix + key, value),
          removeItem: key => localStorage.removeItem(prefix + key) }, prefix);
      },
      deviceFactory: () => webDevice(), durableSessions: true,
      mount: async app => {
        const root = createRoot(document.getElementById("app"));
        flushSync(() => root.render(h(AppProvider, { app }, h(Inbox))));
        return { read: () => latest, close: () => root.unmount() };
      }
    });
  `);
  const server = await createServer({ root: dir, configFile: false, logLevel: "error",
    server: { host: "127.0.0.1", port: 0, fs: { allow: [root, dir] }, proxy: { "/backend": { target: url, rewrite: path => path.slice(8) } } },
    resolve: { alias: [
      { find: /^react$/, replacement: require.resolve("react") },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
      { find: /^react-dom$/, replacement: require.resolve("react-dom") },
      { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
    ] },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ timeout: hangBudget(), executablePath, headless: true });
    const page = await browser.newPage();
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget());
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => typeof window.run === "function");
    const result = await page.evaluate(() => window.run());
    assert.equal(result.initialUnread, 3);
    assert.equal(result.expiryCleared, true);
    assert.equal(result.accountCleared, true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await server.close();
  }
});

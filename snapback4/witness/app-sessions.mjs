#!/usr/bin/env node
// Separate browser realms must serialize the epoch check and session write.
// Build the package first, then: node witness/app-sessions.mjs
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { root, chromiumExecutable, devServer } from "./lib.mjs";

const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
const { build } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")));
const dir = await mkdtemp(join(tmpdir(), "sb4-app-sessions-"));
const started = performance.now();
const until = async (read, label) => {
  const deadline = performance.now() + 15_000;
  do { if (await read()) return; await delay(10); } while (performance.now() < deadline);
  assert.fail(`timed out: ${label}`);
};
let backend, server, browser;
try {
  backend = await devServer({ seed: [] });
  const { api } = backend;
  const bob = await (await fetch(api + "/auth/signup", { method: "POST", body: JSON.stringify({ email: "bob@example.com", password: "password-b" }) })).json();
  assert.ok(bob.session);
  await fetch(api + "/auth/logout", { method: "POST", headers: { authorization: `Bearer ${bob.session.token}` } });
  await writeFile(join(dir, "index.html"), '<!doctype html><title>Session tabs</title><script type="module" src="/entry.js"></script>');
  await writeFile(join(dir, "entry.js"), `import { createApp } from "snapback4/app";
import { localStorageSessionStore, sessionKey, restoreSession } from "snapback4/auth";
const url = ${JSON.stringify(api)}, store = localStorageSessionStore();
const key = sessionKey(url);
const gate = new Promise(resolve => { window.releaseSession = resolve; });
Object.assign(window, { key, stored: () => restoreSession(url, store), openApp: async () => {
  window.app = createApp({ url, sessionStore: { ...store, async set(name, value) {
    if (window.holdNextSession && name === key && value !== await store.get(name)) {
      window.holdNextSession = false;
      window.heldSession = JSON.parse(value);
      // The app has read its epoch, but has not written the successor yet.
      await gate;
    }
    await store.set(name, value);
  } } });
  return app.ready;
} });
`);
  await build({ root: dir, configFile: false, logLevel: "error", resolve: { alias: ["app", "auth"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/dist/${name}.js`) })) }, build: { target: "es2022", outDir: "dist" } });
  server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const leaf = path === "/" ? "index.html" : path.slice(1);
    try {
      const content = await readFile(join(dir, "dist", leaf));
      res.writeHead(200, { "content-type": extname(leaf) === ".js" ? "text/javascript" : "text/html", "cache-control": "no-store" }).end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true });
  const context = await browser.newContext(), errors = [];
  const page = async () => {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.openApp));
    assert.equal((await page.evaluate(() => openApp())).ok, true);
    return page;
  };
  const a = await page();
  assert.equal((await a.evaluate(() => app.auth.signup("alice@example.com", "password-a"))).ok, true);
  const b = await page();
  assert.equal(await a.evaluate(() => app.auth.viewer), await b.evaluate(() => app.auth.viewer));
  await a.evaluate(() => { window.holdNextSession = true; window.refreshing = app.client.refreshSession(); });
  await a.waitForFunction(() => Boolean(window.heldSession));
  const successor = await a.evaluate(() => heldSession.token);
  await b.evaluate(() => {
    window.switching = (async () => {
      const logout = await app.auth.logout();
      if (!logout.ok) throw Error(logout.why.message);
      const login = await app.auth.login("bob@example.com", "password-b");
      if (!login.ok) throw Error(login.why.message);
      window.switched = true;
      return login.session;
    })();
    void switching.catch(error => { window.switchError = error.message; });
  });
  // With Web Locks, B queues behind A's write. Without them, B completes
  // logout/login before A resumes. Either event is observable: no timing sleep
  // or shared module promise map can manufacture the intended interleaving.
  await until(() => b.evaluate(async () => window.switched || window.switchError || (await navigator.locks.query()).pending.some(lock => lock.name === window.key)), "B queued on the session lock or completed its login");
  await a.evaluate(() => releaseSession());
  assert.equal((await a.evaluate(() => refreshing)).ok, true);
  const kept = await b.evaluate(() => switching);
  // Ordinary close drains A's asynchronous onSession save before inspection.
  await a.evaluate(() => app.close());
  assert.equal(await b.evaluate(async () => (await stored())?.principal), bob.session.principal, "Alice's delayed save must not replace Bob across tabs");
  assert.equal(await b.evaluate(async () => (await stored())?.token === app.client.session()?.token), true, "storage must contain Bob's current bearer");
  assert.equal(kept.principal, bob.session.principal);
  const reopened = await page();
  assert.equal(await reopened.evaluate(() => app.auth.viewer), bob.session.principal);
  await b.evaluate(() => app.close());
  await reopened.evaluate(() => app.close());
  // Wait for background remote revocation without retaining or printing tokens.
  await until(async () => (await (await fetch(api + "/probe", { headers: { authorization: "Bearer " + successor } })).json()).denied?.code === "E_AUTH", "Alice's successor revoked");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ witness: "app-sessions", ok: true, separatePages: true, sharedLocalStorage: true, delayedSaveFencedByLogout: true, bobRestored: true, successorRevoked: true, elapsedMs: Math.round(performance.now() - started) }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  await backend?.close();
  await rm(dir, { recursive: true, force: true });
}

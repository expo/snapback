// Actual `init --web` output in fresh Chromium realms, served at a subpath.
// Run after the binary, package and wasm builds; intentionally outside test.sh.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { webShell } from "../packages/snapback4/bin/web-shell.js";
import { binary, root, chromiumExecutable, scaleSeed } from "./lib.mjs";

const temporary = mkdtempSync(join(tmpdir(), "sb4-web-starter-"));
const app = join(temporary, "app");
const require = createRequire(join(root, "package.json"));
const { chromium } = require("playwright-core");
const appRequire = createRequire(join(root, "apps/chat/package.json"));
const { build } = await import(pathToFileURL(appRequire.resolve("vite")).href);
let processServer, stopServer, api, browser, pageServer, deployed;
let aliceSession, bobSession;
let workerOnlyPatch = false, failInstallAsset = false;
const requests = [], mutations = [], writeResponses = [], pageErrors = [];
const out = { witness: "production-web-starter", base: "/chat/" };
async function until(check, description, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw Error(`Timed out: ${description}`);
}
function command(args) {
  const result = spawnSync(binary(), args, { cwd: app, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function start() {
  const port = api ? new URL(api).port : "0";
  processServer = spawn(binary(), ["dev", "--port", port, "--no-watch"], { cwd: app, stdio: ["ignore", "pipe", "pipe"] });
  const owned = processServer;
  let log = "", stdout = "";
  owned.stdout.on("data", data => { stdout += data; });
  owned.stderr.on("data", data => { log += data; });
  const closed = new Promise(resolve => owned.once("close", resolve));
  stopServer = async () => {
    if (owned.exitCode == null && owned.signalCode == null) owned.kill();
    const timer = setTimeout(() => { if (owned.exitCode == null && owned.signalCode == null) owned.kill("SIGKILL"); }, 5000);
    try { await closed; } finally { clearTimeout(timer); }
  };
  await until(() => {
    if (owned.exitCode != null) throw Error(log);
    const address = stdout.match(/^http:\/\/127\.0\.0\.1:\d+\r?\n/m)?.[0].trim();
    if (address) { api = address; return true; }
  }, "backend readiness");
}
async function buildApp(directory) {
  await build({ root: app, configFile: join(app, "vite.config.ts"), base: "/chat/", logLevel: "warn", define: { "import.meta.env.VITE_SNAPBACK_URL": JSON.stringify(api) }, build: { outDir: directory, emptyOutDir: true } });
  await webShell(directory, "/chat/");
}
function installedPackage(name) {
  if (name === "snapback4") return join(root, "packages/snapback4");
  let entry;
  try { entry = appRequire.resolve(`${name}/package.json`); }
  catch { entry = appRequire.resolve(name); }
  for (let directory = dirname(entry); directory !== dirname(directory); directory = dirname(directory)) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === name) return directory;
  }
  throw Error(`Could not locate installed ${name}`);
}
function linkDependencies() {
  const manifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  // Resolve from the reference app so Bun's hoisted and app-local packages
  // both work. Each link targets the actual package, not a partial directory.
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const destination = join(app, "node_modules", name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(installedPackage(name), destination, "dir");
  }
  const generatedRequire = createRequire(join(app, "package.json"));
  for (const name of ["vite", "@vitejs/plugin-react", "react", "react-dom/client"]) {
    assert.ok(generatedRequire.resolve(name), `generated starter resolves ${name}`);
  }
  // snapback4 has import-only exports; createRequire.resolve would select
  // the wrong condition. Verify the linked published ESM entry directly.
  const sdk = join(app, "node_modules/snapback4");
  const sdkManifest = JSON.parse(readFileSync(join(sdk, "package.json"), "utf8"));
  assert.ok(existsSync(join(sdk, sdkManifest.exports["./web"].import)), "generated starter has the built SDK web entry");
}
async function trackedPage(context) {
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => { if (request.url().startsWith(`${api}/m/`)) mutations.push({ path: new URL(request.url()).pathname, body: request.postData() }); });
  page.on("response", response => {
    if (response.url().startsWith(`${api}/m/`)) {
      const id = JSON.parse(response.request().postData() ?? "{}").id;
      writeResponses.push(response.json().then(body => ({ ...body, id })).catch(() => null));
    }
  });
  return page;
}
async function acquired(page) {
  await page.getByText("Local data acquired", { exact: false }).waitFor();
}
async function pick(page) {
  await page.getByRole("navigation", { name: "Inbox" }).getByRole("button").first().click();
  await page.getByRole("heading", { name: "Group 0", exact: true }).waitFor();
  await page.getByText("message 1 in group 0:", { exact: false }).waitFor();
}
async function saved(page, principal = aliceSession.principal) {
  return page.evaluate(({ api, principal }) => JSON.parse(localStorage.getItem(`snapback4-chat:${JSON.stringify([api, principal])}`)), { api, principal });
}
try {
  const init = spawnSync(binary(), ["init", app, "--web"], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stdout + init.stderr);
  // Reuse the qualified workspace packages; no registry or provider is needed.
  linkDependencies();
  rmSync(join(app, "snapback/worker.ts")); // no external invitation worker in this journey
  command(["check"]);
  await start();
  aliceSession = (await fetch(`${api}/auth/guest`, { method: "POST", body: "{}" }).then(r => r.json())).session;
  bobSession = (await fetch(`${api}/auth/guest`, { method: "POST", body: "{}" }).then(r => r.json())).session;
  const rows = JSON.parse(JSON.stringify(scaleSeed({ groups: 1, messages: 2, members: 2 }))
    .replaceAll("dev:alice", aliceSession.principal).replaceAll("dev:bob", bobSession.principal));
  const seed = await fetch(`${api}/seed`, { method: "POST", body: JSON.stringify(rows) }).then(r => r.json());
  assert.equal(seed.seeded, 5);
  const first = join(temporary, "build-a"), second = join(temporary, "build-b");
  await buildApp(first);
  deployed = first;
  const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css" };
  pageServer = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    requests.push(path);
    response.setHeader("cache-control", "no-store");
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><title>Uncontrolled witness observer</title>"); return;
    }
    if (["/chat/api-private", "/chat/media-private", "/chat/personal"].includes(path)) {
      response.setHeader("content-type", path.endsWith("personal") ? "text/html" : "text/plain");
      response.end(`private fixture bytes ${path}`); return;
    }
    if (!path.startsWith("/chat/") || path.includes("..")) { response.writeHead(404).end(); return; }
    const leaf = path.slice("/chat/".length) || "index.html";
    const file = join(deployed, leaf);
    if (!existsSync(file)) { response.writeHead(404).end(); return; }
    if (failInstallAsset && leaf.startsWith("assets/")) {
      failInstallAsset = false; response.writeHead(503).end("injected install download failure"); return;
    }
    response.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
    const content = readFileSync(file);
    response.end(leaf === "snapback4-sw.js" && workerOnlyPatch ? Buffer.concat([content, Buffer.from("\nself.witnessWorkerUpdate = true;\n")]) : content);
  });
  await new Promise(resolve => pageServer.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${pageServer.address().port}`;
  const address = `${origin}/chat/`;
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true });
  const context = await browser.newContext();
  // The starter now restores real sessions. The witness's query parameter
  // chooses a preauthenticated fixture before the app starts; no persona door
  // or authentication controller is added to generated application code.
  await context.addInitScript(({ api, alice, bob }) => {
    const as = new URLSearchParams(location.search).get("as");
    if (as) localStorage.setItem(`snapback4:${api}:session`, JSON.stringify(as === "alice" ? alice : bob));
  }, { api, alice: aliceSession, bob: bobSession });
  let page = await trackedPage(context);
  await page.goto(`${address}?as=alice`);
  await acquired(page); await pick(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload(); await acquired(page);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const bob = await trackedPage(context);
  await bob.goto(`${address}?as=bob`); await acquired(bob); await bob.close();

  // Stop the actual backend, take all browser networking away, and persist
  // two ordered sends plus a nonpredicting write in the real SDK outbox.
  await context.setOffline(true); await stopServer();
  await page.getByRole("status").filter({ hasText: /^Offline$/ }).waitFor();
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await page.getByText("Queued on this device; no predicted row.", { exact: false }).waitFor();
  for (const body of ["offline first", "offline second"]) {
    await page.getByRole("textbox", { name: "Message", exact: true }).fill(body);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await until(async () => await page.getByRole("textbox", { name: "Message", exact: true }).inputValue() === "", "durable send admission");
  }
  const intents = (await saved(page)).intents;
  assert.equal(intents.length, 3);
  assert.equal(new Set(intents.map(i => i.id)).size, 3);
  assert.equal(intents[0].operation, "markRead");
  await page.close();
  page = await trackedPage(context);
  await page.goto(`${address}?as=alice`);
  await page.getByText("offline first", { exact: true }).waitFor();
  await page.getByText("offline second", { exact: true }).waitFor();
  await page.getByText("As of", { exact: false }).waitFor();
  await until(async () => await page.locator('[data-write-state="pending"]').count() === 3, "same pending receipts in a new realm");
  assert.deepEqual((await saved(page)).intents, intents);
  out.reopen = { newRealm: true, stoppedBackend: true, pendingIds: intents.map(i => i.id), nonpredicting: true, stale: true };
  console.log(JSON.stringify({ stage: "reopen", ...out.reopen }));
  await page.evaluate(() => { location.hash = "room=unknown-room"; });
  await page.getByText("Reconnect to check; it may still exist.", { exact: false }).waitFor();
  assert.ok(!mutations.some(request => /create|dm/i.test(request.path)), "held and unknown routes never create");
  await page.evaluate(() => { location.hash = "room=c000"; });
  await page.getByText("offline first", { exact: true }).waitFor();
  await page.goto(`${address}?as=bob`);
  await page.getByText(`as ${bobSession.principal}`, { exact: false }).waitFor();
  assert.equal(await page.locator('[data-write-id]').count(), 0);
  assert.ok(!(await page.locator("body").innerText()).includes("offline first"));
  assert.deepEqual((await saved(page)).intents, intents, "A references survive B switching");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Signed out", exact: true }).waitFor();
  await until(async () => !(await page.getByRole("button", { name: "Continue as a guest" }).isDisabled()), "offline sign-out completes");
  out.accountIsolation = { pendingHidden: true, referencesPreserved: true, offlineSignOut: true };
  console.log(JSON.stringify({ stage: "accountIsolation", ...out.accountIsolation }));
  await page.close();
  page = await trackedPage(context);
  await page.goto(`${address}?as=alice`);
  await page.getByText("offline first", { exact: true }).waitFor();
  await start(); await context.setOffline(false);
  await until(async () => await page.locator('[data-write-state="sent"]').count() === 3, "original writes settle after reconnect");
  const thread = await fetch(`${api}/q/thread`, { method: "POST", headers: { authorization: `Bearer ${aliceSession.token}` }, body: JSON.stringify({ args: { conversationId: "c000" } }) }).then(r => r.json());
  const sentRows = thread.data.filter(row => row.body?.startsWith("offline "));
  assert.equal(sentRows.length, 2);
  assert.deepEqual(sentRows.map(row => row.body), ["offline second", "offline first"]);
  const firstRequests = mutations.filter(r => /\/m\/(?:send|markRead)$/.test(r.path)).map(r => JSON.parse(r.body).id);
  assert.ok(firstRequests.every(id => intents.some(i => i.id === id)), "reconnect keeps the original IDs");
  const replies = (await Promise.all(writeResponses)).filter(write => write?.state === "sent");
  const sequences = intents.map(intent => replies.find(write => write.id === intent.id)?.seq);
  assert.ok(sequences.every(Number.isSafeInteger), "each queued ID has an authoritative response");
  assert.ok(sequences.every((seq, i) => i === 0 || sequences[i - 1] < seq), "queued writes settle in admission order");
  out.reconnect = { rows: 2, ordered: true, originalIds: true, duplicateRows: 0, sequences };
  console.log(JSON.stringify({ stage: "reconnect", ...out.reconnect }));

  // Revoke membership while a nonpredicting write is queued. The SDK terminal
  // refusal must remain visible, including after the next page restart.
  await context.setOffline(true);
  await page.getByRole("status").filter({ hasText: /^Offline$/ }).waitFor();
  await page.getByRole("button", { name: "Mark read", exact: true }).click();
  await until(async () => await page.locator('[data-write-state="pending"]').count() === 1, "queued refusal candidate");
  const failedId = (await saved(page)).intents.at(-1).id;
  const leave = await fetch(`${api}/m/leave`, { method: "POST", headers: { authorization: `Bearer ${aliceSession.token}` }, body: JSON.stringify({ args: { conversationId: "c000" } }) }).then(r => r.json());
  assert.equal(leave.state, "sent");
  await context.setOffline(false);
  await page.locator(`[data-write-id="${failedId}"][data-write-state="failed"]`).waitFor();

  // Restore access so the failed receipt can be inspected in its room.
  const rejoined = await fetch(`${api}/seed`, { method: "POST", body: JSON.stringify([{ table: "memberships", row: { id: "restored-alice", conversationId: "c000", principal: aliceSession.principal, role: "admin", joinedAt: Date.now() } }]) }).then(r => r.json());
  assert.equal(rejoined.seeded, 1);
  await page.locator(`[data-write-id="${failedId}"][data-write-state="failed"]`).waitFor();
  await page.close(); page = await trackedPage(context); await page.goto(`${address}?as=alice`);
  await page.locator(`[data-write-id="${failedId}"][data-write-state="failed"]`).waitFor();
  // Inject only a UI reference to an absent SDK ID: recovery may never invent
  // a fresh write. This also represents eviction or a crash before admission.
  await page.evaluate(({ api, principal }) => {
    const key = `snapback4-chat:${JSON.stringify([api, principal])}`;
    const state = JSON.parse(localStorage.getItem(key));
    state.intents.push({ id: "00000000000000000000000000", room: "c000", operation: "send" });
    localStorage.setItem(key, JSON.stringify(state));
  }, { api, principal: aliceSession.principal });
  await page.reload();
  await page.locator(`[data-write-id="${failedId}"][data-write-state="failed"]`).waitFor();
  await page.locator('[data-write-id="00000000000000000000000000"]').getByText("Outcome unknown.", { exact: false }).waitFor();
  out.receipts = { failedAfterRestart: true, unknownRemainsUnknown: true };
  console.log(JSON.stringify({ stage: "receipts", ...out.receipts }));

  // The default guest path must keep its actual identity across an offline
  // page restart and clear credentials on offline sign-out without erasing data.
  // Leave the fixture account's open tab alone and start a distinct guest,
  // so the offline reopen owns that guest's original replica store.
  await page.evaluate(api => localStorage.removeItem(`snapback4:${api}:session`), api);
  let guest = await trackedPage(context);
  await guest.goto(address);
  await guest.getByRole("button", { name: "Continue as a guest" }).click();
  await acquired(guest);
  const session = await guest.evaluate(api => JSON.parse(localStorage.getItem(`snapback4:${api}:session`)), api);
  assert.ok(session?.principal && session?.token);
  await guest.close(); await context.setOffline(true);
  guest = await trackedPage(context); await guest.goto(address); await acquired(guest);
  await guest.getByText(`as ${session.principal}`, { exact: false }).waitFor();
  await guest.getByRole("button", { name: "Sign out", exact: true }).click();
  await until(async () => !(await guest.getByRole("button", { name: "Continue as a guest" }).isDisabled()), "guest offline sign-out completes");
  assert.equal(await guest.evaluate(api => localStorage.getItem(`snapback4:${api}:session`), api), null);
  const guestStores = await guest.evaluate(async () => (await indexedDB.databases()).map(db => db.name));
  assert.ok(guestStores.some(name => name.includes(encodeURIComponent(session.principal))));
  await guest.close(); await context.setOffline(false);

  // Hold a real logout request open: completion must mean local credentials
  // are already gone, even if this page is closed before revocation answers.
  guest = await trackedPage(context); await guest.goto(address);
  await guest.getByRole("button", { name: "Continue as a guest" }).click(); await acquired(guest);
  const stalledPrincipal = await guest.evaluate(api => JSON.parse(localStorage.getItem(`snapback4:${api}:session`)).principal, api);
  let logoutRequested = false, releaseLogout;
  const heldLogout = new Promise(resolve => { releaseLogout = resolve; });
  await guest.route(`${api}/auth/logout`, async route => {
    logoutRequested = true;
    await heldLogout;
    await route.abort().catch(() => {});
  });
  try {
    await guest.getByRole("button", { name: "Sign out", exact: true }).click();
    await until(() => logoutRequested, "stalled logout request started");
    await guest.getByRole("heading", { name: "Signed out", exact: true }).waitFor();
    assert.equal(await guest.evaluate(api => localStorage.getItem(`snapback4:${api}:session`), api), null);
    await guest.close(); await context.setOffline(true);
    guest = await trackedPage(context); await guest.goto(address);
    await guest.getByRole("heading", { name: "Signed out", exact: true }).waitFor();
    assert.ok(!(await guest.locator("body").innerText()).includes(stalledPrincipal), "offline reopen cannot restore the signed-out principal");
    assert.equal(await guest.evaluate(api => localStorage.getItem(`snapback4:${api}:session`), api), null);
    await guest.close(); await context.setOffline(false);
  } finally { releaseLogout(); }
  out.guest = { samePrincipalOfflineReopen: true, credentialsCleared: true, replicaPreserved: true, stalledLogoutOfflineReopenRefused: true };
  console.log(JSON.stringify({ stage: "guest", ...out.guest }));

  // Cache privacy and deployment lifecycle on the actual production worker.
  await page.evaluate(async () => {
    for (const path of ["api-private", "media-private", "personal"]) await fetch(`/chat/${path}`, { headers: { authorization: "Bearer fixture-not-a-secret" } });
  });
  const old = await page.evaluate(async () => ({ keys: await caches.keys(), assets: (await (await caches.open((await caches.keys()).find(k => k.startsWith("snapback4-shell:")))).keys()).map(r => r.url), controller: navigator.serviceWorker.controller.scriptURL }));
  for (const asset of old.assets) assert.ok(new URL(asset).pathname === "/chat/index.html" || /^\/chat\/assets\//.test(new URL(asset).pathname));
  assert.ok(!old.assets.some(url => /api-private|media-private|personal/.test(url)));
  const shellHasPrivateBytes = await page.evaluate(async token => {
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) {
      const body = await (await (await caches.open(name)).match(request)).text();
      if (body.includes(token) || body.includes("private fixture bytes")) return true;
    }
    return false;
  }, session.token);
  assert.equal(shellHasPrivateBytes, false);
  // A worker-only deployment has the same entry/assets cache identity. If
  // its install fails, it must not delete the still-active worker's cache.
  workerOnlyPatch = true; failInstallAsset = true;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`failed update did not become redundant: installing=${registration.installing?.state}, waiting=${registration.waiting?.state}, active=${registration.active?.state}`)), 15000);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing.addEventListener("statechange", () => {
          if (installing.state === "redundant") { clearTimeout(timer); resolve(true); }
        });
      }, { once: true });
      registration.update().catch(error => { clearTimeout(timer); reject(error); });
    });
  });
  assert.equal(failInstallAsset, false, "worker-only update attempted the failed download");
  const oldCache = old.keys.find(k => k.startsWith("snapback4-shell:"));
  assert.ok((await page.evaluate(() => caches.keys())).includes(oldCache));
  const immutable = old.assets.find(url => /\/assets\/.*\.js$/.test(url));
  assert.ok(immutable);
  await context.setOffline(true);
  assert.equal(await page.evaluate(url => fetch(url).then(r => r.status), immutable), 200, "failed same-assets update preserves offline assets");
  await context.setOffline(false); workerOnlyPatch = false;
  writeFileSync(join(app, "index.html"), readFileSync(join(app, "index.html"), "utf8").replace("<title>Snapback 4 chat</title>", "<title>Snapback 4 chat updated</title>"));
  // Change an immutable asset as well, so old-tab asset availability is real.
  writeFileSync(join(app, "src/main.tsx"), readFileSync(join(app, "src/main.tsx"), "utf8") + '\ndocument.documentElement.dataset.shellVersion = "second";\n');
  await buildApp(second); deployed = second;
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
  assert.equal(await page.evaluate(url => fetch(url).then(r => r.status), immutable), 200, "old tab still loads its removed asset");
  assert.ok((await page.evaluate(() => caches.keys())).includes(old.keys.find(k => k.startsWith("snapback4-shell:"))));
  await page.close();
  // An out-of-scope page can inspect registration without keeping the old
  // worker alive. Wait for activation before navigating back into its scope.
  page = await trackedPage(context); await page.goto(origin);
  await page.waitForFunction(async scope => {
    const registration = await navigator.serviceWorker.getRegistration(scope);
    return registration && !registration.waiting && registration.active?.state === "activated";
  }, address);
  await page.goto(address);
  await until(async () => await page.title() === "Snapback 4 chat updated", "new worker activates after old tabs close");
  const currentKeys = await page.evaluate(() => caches.keys());
  assert.equal(currentKeys.filter(k => k.startsWith("snapback4-shell:")).length, 1);
  assert.ok(!currentKeys.includes(old.keys.find(k => k.startsWith("snapback4-shell:"))));
  out.shell = { subpath: true, allowlistOnly: true, failedSameAssetsUpdateKeptCache: true, oldTabAssetKept: true, newBuildActivated: true };
  console.log(JSON.stringify({ stage: "shell", ...out.shell }));
  assert.deepEqual(pageErrors, []);
  out.ok = true;
} finally {
  await browser?.close();
  await stopServer?.();
  if (pageServer) await new Promise(resolve => pageServer.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}
console.log(JSON.stringify(out));

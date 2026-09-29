// @ref LLP 3000.029#1 — the comparative's EnsureProfile gate, on a real wasm client.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromiumExecutable } from "../../../witness/lib.mjs";
import { server } from "./helpers/app-server.mjs";
import { profileSchema, profileRows } from "./helpers/retention-profile.mjs";
const root = resolve(import.meta.dirname, "../../..");

for (const tier of ["wasm", "online"]) test(`Astra 5 browser ${tier}: builder profile gate survives another profile update and unrelated mutation`, { timeout: 30000 }, async t => {
  const { url, dir } = await server(t, undefined, profileSchema);
  const seed = await fetch(url + "/seed", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify(profileRows) }).then(r => r.json());
  assert.equal(seed.seeded, 2);
  await fetch(url + "/m/unrelated", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ id: "00000000000000000000000001", args: {} }) });
  const require = createRequire(join(root, "packages/snapback4/package.json"));
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  const { createServer } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
  writeFileSync(join(dir, "index.html"), '<link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(dir, "harness.jsx"), harness.replace('TIER', JSON.stringify(tier)).replace('API_URL', JSON.stringify(url)).replace('WASM_URL', JSON.stringify(`/@fs/${root}/packages/snapback4/src/wasm/snapback4_device_bg.wasm`)));
  const vite = await createServer({ root: dir, configFile: false, logLevel: "error",
    plugins: process.env.LV_BASELINE ? [{ name: "restore-023-timeout", enforce: "pre", transform(code, id) {
      if (id.endsWith("/read-observation.ts")) return code.replace("revalidatingAnswer(this.snapshot, false)", "revalidatingAnswer(this.snapshot, !this.linger)");
    } }] : [], server: { host: "127.0.0.1", port: 0, fs: { allow: [root, dir] } }, resolve: { alias: [
    ...["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client"].map(name => ({ find: new RegExp(`^${name}$`), replacement: require.resolve(name) })),
    ...["react", "client", "local", "web", "online-dispatch"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === "react" ? "tsx" : "ts"}`) })),
  ] } });
  await vite.listen();
  const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ["--no-sandbox"] });
  t.after(async () => { await browser.close(); await vite.close(); });
  const page = await browser.newPage();
  const errors = []; page.on("response", async response => { if (response.status() === 500) errors.push((await response.text()).slice(0, 3000)); }); page.on("requestfailed", req => { if (req.failure()?.errorText !== "net::ERR_ABORTED") errors.push(req.url() + ": " + req.failure()?.errorText); }); page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); }); page.on("pageerror", e => errors.push(String(e)));
  await page.goto(vite.resolvedUrls.local[0]);
  try { await page.waitForSelector("#draft", { timeout: 10000 }); } catch (error) { assert.fail(JSON.stringify({ errors, body: await page.locator("body").innerText(), read: await page.evaluate(() => [window.stage, window.read]), error: String(error) })); }
  await page.locator("#draft").fill("unfinished message");
  await page.evaluate(() => window.revalidate());
  await page.waitForFunction(() => window.read?.revalidating || window.flashes > 0);
  assert.equal(await page.evaluate(() => window.flashes), 0, "a plain mutation receipt cannot withdraw the gate");
  await new Promise(resolve => setTimeout(resolve, 1600));
  if (process.env.LV_BASELINE) {
    assert.equal(await page.locator("#draft").count(), 0, "the baseline loading flash unmounted the route");
    await page.evaluate(() => window.release());
    await page.waitForSelector("#draft");
    assert.equal(await page.evaluate(() => window.mounts), 2);
    assert.equal(await page.evaluate(() => location.pathname), "/");
    t.diagnostic("baseline reproduced: profile loading unmounted the signed-in route; remount reset /conversation/bob to /");
    await page.evaluate(() => window.finish());
    return;
  }
  assert.equal(await page.locator("#draft").inputValue(), "unfinished message");
  assert.equal(await page.evaluate(() => location.pathname), "/conversation/bob");
  assert.equal(await page.evaluate(() => window.mounts), 1);
  assert.equal(await page.evaluate(() => window.read.revalidating), true);
  await page.evaluate(() => window.release());
  await page.waitForFunction(() => window.read?.data && !window.read.revalidating);
  const before = await page.evaluate(() => window.profileReads);
  const changed = await fetch(url + "/m/saveProfile", { method: "POST", headers: { "x-snapback-persona": "bob" }, body: JSON.stringify({ id: "bob-profile", args: { displayName: "Bob changed", handle: "bob", bio: null, location: null, link: null } }) }).then(r => r.json());
  assert.equal(changed.state, "sent", JSON.stringify(changed));
  await page.waitForFunction(before => window.profileReads > before && !window.read?.revalidating, before);
  t.diagnostic("sequential unrelated write");
  await page.evaluate(() => window.unrelated());
  t.diagnostic("sequential unrelated write settled");
  await page.waitForFunction(() => window.read?.data && !window.read.revalidating);
  assert.equal(await page.locator("#draft").inputValue(), "unfinished message");
  assert.equal(await page.evaluate(() => window.mounts), 1);
  assert.equal(await page.evaluate(() => location.pathname), "/conversation/bob");
  if (tier === 'online') {
    const replay = await page.evaluate(() => window.replay());
    assert.equal(replay.replayed, true, JSON.stringify(replay));
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#draft").count(), 1, "historical receipt cannot withdraw validated profile");
    await page.evaluate(() => window.release());
    await page.waitForFunction(() => window.read?.data && !window.read.revalidating);
  } else {
    await page.evaluate(() => window.holdProfileSync());
    await fetch(url + "/m/saveProfile", { method: "POST", headers: { "x-snapback-persona": "bob" }, body: JSON.stringify({ id: "bob-overlap", args: { displayName: "Bob overlaps", handle: "bob", bio: null, location: null, link: null } }) });
    await page.waitForFunction(() => window.syncCaptured);
    t.diagnostic("overlap sync captured");
    await page.evaluate(() => window.predictNote());
    t.diagnostic("overlap prediction admitted");
    await page.evaluate(() => window.releaseProfileSync());
    await page.waitForFunction(() => window.read?.data && !window.read.revalidating);
  }
  assert.equal(await page.locator("#draft").inputValue(), "unfinished message");
  assert.equal(await page.evaluate(() => window.mounts), 1);
  assert.deepEqual(errors, []);
  const result = await page.evaluate(() => ({ route: location.pathname, mounts: window.mounts, loadingAfterData: window.flashes, profile: window.read.data.handle }));
  assert.equal(result.loadingAfterData, 0);
  t.diagnostic(JSON.stringify(result));
  await page.evaluate(() => window.finish());
});

const harness = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SnapbackProvider, useQuery } from "snapback4/react";
import { createLocalClient } from "snapback4/local";
import { createClient } from "snapback4/client";
import { ownDispatch } from "snapback4/online-dispatch";
import { webDevice } from "snapback4/web";
const tier = TIER;
window.profileReads = 0; window.applies = 0;
window.stage = "wasm";
const wasm = new Uint8Array(await fetch(WASM_URL).then(r => r.arrayBuffer()));
const underlying = webDevice({ wasm });
let held = false, release, syncRelease, noteRelease;
let syncHeld = false, noteHeld = false, syncGate = Promise.resolve(), noteGate = Promise.resolve();
let gate = Promise.resolve();
window.stage = "client";
const fetcher = async (input, init) => {
  if (held && new URL(input).pathname === '/q/myProfile') await gate;
  const path = new URL(input).pathname;
  if (noteHeld && path === '/m/unrelated') await noteGate;
  const result = await fetch(input, init);
  if (syncHeld && path === '/sync') { window.syncCaptured = true; await syncGate; }
  if (new URL(input).pathname === '/q/myProfile') window.profileReads++;
  return result;
};
const options = { url: API_URL, persona: "alice", fetch: fetcher, waitSeconds: 1 };
const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options, device: { async open(...args) {
  const core = await underlying.open(...args);
  return { ...core, async call(request, committed) {
    if (held && request.op === "query") await gate;
    const result = await core.call(request, committed);
    if (request.op === 'apply') window.applies++;
    if (request.op === 'query' && request.name === 'myProfile') window.profileReads++;
    return result;
  } };
} } });
// Test custody owner for the standalone online transport; the production app
// uses its durable admission journal. This fixture isolates mounted read behavior.
if (tier === 'online') ownDispatch(client, { observe() {}, async before(id, store) { localStorage.setItem('test-custody:' + store + ':' + id, 'admitted'); } });
window.stage = "sync";
if (tier !== 'online') await client.sync();
window.stage = "render";
history.replaceState(null, "", "/conversation/bob");
window.mounts = 0; window.flashes = 0;
let shown = false;
function Route() {
  const [draft, setDraft] = useState(() => { window.mounts++; if (window.mounts > 1) history.replaceState(null, "", "/"); return ""; });
  return <input id="draft" value={draft} onChange={e => setDraft(e.target.value)} />;
}
const profile = { kind: "query", name: "myProfile" };
function EnsureProfile() {
  const read = useQuery(profile, {}); window.read = read;
  if ("loading" in read) { if (shown) window.flashes++; return null; }
  if ("denied" in read || !read.data) return null;
  shown = true;
  return <Route />;
}
const root = createRoot(document.getElementById("root"));
root.render(<SnapbackProvider client={client}><EnsureProfile /></SnapbackProvider>);
window.revalidate = () => { held = true; gate = new Promise(resolve => { release = resolve; }); if (tier === 'online') { void client.mutate({ kind: 'mutation', name: 'saveProfile' }, { displayName: 'alice', handle: 'alice', bio: null, location: null, link: null }); } else void client.sync(); };
window.unrelated = async () => { const write = await client.mutate({ kind: 'mutation', name: 'unrelated' }, {}); if (write.state === 'failed') throw Error(JSON.stringify(write)); return write; };
window.release = () => { held = false; release(); };
window.replay = () => { held = true; gate = new Promise(resolve => { release = resolve; }); return client.mutate({ kind: 'mutation', name: 'unrelated' }, {}, { id: '00000000000000000000000001' }); };
window.holdProfileSync = () => { syncHeld = true; noteHeld = true; window.syncCaptured = false; syncGate = new Promise(r => syncRelease = r); noteGate = new Promise(r => noteRelease = r); };
window.predictNote = async () => { const write = await client.mutate({ kind: 'mutation', name: 'unrelated' }, {}, { waitSeconds: 0 }); if (write.state === 'failed') throw Error(JSON.stringify(write)); for (let i = 0; i < 500; i++) { if ((await client.pendingWrites()).some(w => w.predicted.length)) return; await new Promise(r => setTimeout(r, 10)); } throw Error('notes prediction missing: ' + JSON.stringify(await client.pendingWrites())); };
window.releaseProfileSync = async () => { const applied = window.applies; syncHeld = false; syncRelease(); for (let i = 0; i < 500 && window.applies === applied; i++) await new Promise(r => setTimeout(r, 10)); if (window.applies === applied) throw Error("held sync did not apply"); noteHeld = false; noteRelease(); await client.sync(); };
window.finish = async () => { root.unmount(); window.refreshPeer?.close(); await client.close(); };
`;

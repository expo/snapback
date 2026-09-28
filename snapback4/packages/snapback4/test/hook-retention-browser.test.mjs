// @ref LLP 3000.029#1 — the comparative's EnsureProfile gate, on a real wasm client.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromiumExecutable } from "../../../witness/lib.mjs";
import { server } from "./helpers/app-server.mjs";
const root = resolve(import.meta.dirname, "../../..");

test("browser: EnsureProfile preserves /conversation/bob through a held plain revalidation", async t => {
  const { url, dir } = await server(t, undefined, `use personas alice
table profiles:
  handle: text
  read <- allow
  sync public
query myProfile():
  return profiles['alice']
`);
  const seed = await fetch(url + "/seed", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify([{ table: "profiles", row: { id: "alice", handle: "alice" } }]) }).then(r => r.json());
  assert.equal(seed.seeded, 1);
  const require = createRequire(join(root, "packages/snapback4/package.json"));
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  const { createServer } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
  writeFileSync(join(dir, "index.html"), '<link rel="icon" href="data:,"><div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(dir, "harness.jsx"), harness.replace('API_URL', JSON.stringify(url)).replace('WASM_URL', JSON.stringify(`/@fs/${root}/packages/snapback4/src/wasm/snapback4_device_bg.wasm`)));
  const vite = await createServer({ root: dir, configFile: false, logLevel: "error",
    plugins: process.env.LV_BASELINE ? [{ name: "restore-023-timeout", enforce: "pre", transform(code, id) {
      if (id.endsWith("/read-observation.ts")) return code.replace("revalidatingAnswer(this.snapshot, false)", "revalidatingAnswer(this.snapshot, !this.linger)");
    } }] : [], server: { host: "127.0.0.1", port: 0, fs: { allow: [root, dir] } }, resolve: { alias: [
    ...["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client"].map(name => ({ find: new RegExp(`^${name}$`), replacement: require.resolve(name) })),
    ...["react", "local", "web"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === "react" ? "tsx" : "ts"}`) })),
  ] } });
  await vite.listen();
  const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ["--no-sandbox"] });
  t.after(async () => { await browser.close(); await vite.close(); });
  const page = await browser.newPage();
  const errors = []; page.on("response", async response => { if (response.status() === 500) errors.push((await response.text()).slice(0, 3000)); }); page.on("requestfailed", req => errors.push(req.url() + ": " + req.failure()?.errorText)); page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); }); page.on("pageerror", e => errors.push(String(e)));
  await page.goto(vite.resolvedUrls.local[0]);
  try { await page.waitForSelector("#draft", { timeout: 10000 }); } catch (error) { assert.fail(JSON.stringify({ errors, body: await page.locator("body").innerText(), read: await page.evaluate(() => [window.stage, window.read]), error: String(error) })); }
  await page.locator("#draft").fill("unfinished message");
  await page.evaluate(() => window.revalidate());
  await page.waitForFunction(() => window.read?.revalidating);
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
import { webDevice, memoryPersistence } from "snapback4/web";
window.stage = "wasm";
const wasm = new Uint8Array(await fetch(WASM_URL).then(r => r.arrayBuffer()));
const underlying = webDevice({ wasm, persist: memoryPersistence() });
let held = false, release;
let gate = Promise.resolve();
window.stage = "client";
const client = await createLocalClient({ url: API_URL, persona: "alice", device: { async open(...args) {
  const core = await underlying.open(...args);
  return { ...core, async call(request, committed) {
    if (held && request.op === "query") await gate;
    return core.call(request, committed);
  } };
} } });
window.stage = "sync";
await client.sync();
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
window.revalidate = () => { held = true; gate = new Promise(resolve => { release = resolve; }); void client.sync(); };
window.release = () => { held = false; release(); };
window.finish = async () => { root.unmount(); await client.close(); };
`;

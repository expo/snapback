// Read-only qualification of the supplied frozen app export; only its backend URL
// and a hook-state recorder are replaced in the served response, never on disk.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { chromium } from "playwright-core";
import { chromiumExecutable } from "../../witness/lib.mjs";
import { avatarFixture } from "../../packages/snapback4/test/helpers/avatar-fixture.mjs";

test("frozen calibration app", { timeout: 120_000 }, async t => {
  const fixture = await avatarFixture(t);
  const root = "/home/ccheever/sb4-intent/cal26-app/dist-scale";
  const recordHooks = process.env.AV_RECORD_HOOKS !== "0";
  let instrumentation = 0;
  const host = createServer((req, res) => {
    const path = new URL(req.url, "http://local").pathname;
    const file = path.endsWith("snapback4_device_bg.a8d025c5f3a6835e5aa89f2c560f6f4a.wasm")
      ? new URL("../../target/av-published/package/dist/wasm/snapback4_device_bg.wasm", import.meta.url)
      : join(root, path === "/" || !extname(path) ? "index.html" : path);
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    const ext = extname(String(file));
    let body = readFileSync(file);
    if (ext === ".js") {
      let source = body.toString().replaceAll("http://127.0.0.1:49363", fixture.url);
      const marker = 't?u:{status:"empty"}};var t=';
      if (source.includes(marker)) {
        instrumentation++;
        if (recordHooks) source = source.replace(marker, '(globalThis.__assetTrace??=[]).push({id:t,...u}),t?u:{status:"empty"}};var t=');
      }
      body = source;
    }
    res.writeHead(200, { "content-type": ext === ".js" ? "application/javascript" : ext === ".wasm" ? "application/wasm" : ext === ".html" ? "text/html" : "application/octet-stream" });
    res.end(body);
  });
  await new Promise(resolve => host.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ["--no-sandbox"] });
  t.after(async () => { await browser.close(); await new Promise(resolve => host.close(resolve)); });
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [], assets = [], transport = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("requestfailed", r => transport.push(`${r.url()}: ${r.failure()?.errorText}`));
  page.on("response", r => { if (new URL(r.url()).pathname.startsWith("/assets/")) assets.push({ url: r.url(), status: r.status() }); });
  const base = `http://127.0.0.1:${host.address().port}`;
  await page.goto(base);
  await page.getByTestId("sm-auth-email").fill("bob@avatars.test");
  await page.getByTestId("sm-auth-password").fill("password-avatars");
  await page.getByTestId("sm-auth-submit").click();
  try { await page.getByRole("link", { name: "Chats", exact: true }).waitFor({ timeout: 5000 }); }
  catch (error) { throw Error(JSON.stringify({ error: String(error), body: await page.locator("body").innerText(), errors, instrumentation })); }
  for (const [name, path] of [["dm", `/chat/${fixture.dm}`], ["group", `/chat/${fixture.group}`], ["feed", "/"]]) {
    await page.goto(base + path);
    if (name === "feed") await page.getByTestId("sm-feed-tab-global").click();
    await page.waitForTimeout(5000);
    const result = await page.evaluate(() => ({
      href: location.href, text: document.body.innerText.slice(0, 1000),
      trace: (window.__assetTrace ?? []).slice(-100),
      avatars: [...document.querySelectorAll('[aria-label^="Avatar for "]')].map(n => ({ tag: n.tagName, source: n.dataset.sourceUri, label: n.getAttribute("aria-label"), images: [...n.querySelectorAll("img")].map(i => ({ src: i.src, complete: i.complete, width: i.naturalWidth })) })),
    }));
    console.log(JSON.stringify({ name, result, errors, assets, transport }));
    const avatars = name === "feed" ? result.avatars.filter(a => a.label === "Avatar for alice" || a.label === "Avatar for carol") : result.avatars;
    assert.ok(avatars.length >= 20, `${name}: expected 20 avatars`);
    assert.ok(avatars.every(a => a.source && a.images.some(i => i.complete && i.width > 0)), `${name}: every avatar paints`);
    if (recordHooks) assert.ok(result.trace.some(s => s.id && s.status === "ready"));
  }
  assert.ok(instrumentation > 0);
  assert.deepEqual(errors, []);
});

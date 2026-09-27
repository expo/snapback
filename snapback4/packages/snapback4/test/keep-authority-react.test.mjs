import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromiumExecutable } from "../../../witness/lib.mjs";

const root = resolve(import.meta.dirname, "../../..");
test("createApp kept useQuery and usePage preserve input state through 20 delayed authority replacements", async t => {
  const executablePath = chromiumExecutable();
  const require = createRequire(join(root, "packages/snapback4/package.json"));
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  const { createServer } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
  const temporary = mkdtempSync(join(tmpdir(), "sb4-kept-authority-react-"));
  let server, browser;
  t.after(async () => { await browser?.close(); await server?.close(); rmSync(temporary, { recursive: true, force: true }); });
  writeFileSync(join(temporary, "index.html"), '<!doctype html><div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(temporary, "harness.jsx"), harness);
  server = await createServer({ root: temporary, configFile: false, logLevel: "error",
    server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary] } },
    resolve: { alias: [
      { find: /^react$/, replacement: require.resolve("react") },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
      { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve("react/jsx-dev-runtime") },
      { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
      ...["app", "auth", "react"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === "react" ? "tsx" : "ts"}`) })),
    ] } });
  await server.listen();
  browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(server.resolvedUrls.local[0]);
  try { await page.waitForFunction(() => window.latest?.query?.data?.[0] === 0 && window.latest?.page?.data?.[0] === 0); }
  catch (error) { assert.fail(JSON.stringify({ errors, latest: await page.evaluate(() => window.latest), error: String(error) })); }
  await page.locator("#query").fill("query draft");
  await page.locator("#page").fill("page draft");
  await page.evaluate(() => window.begin());
  for (let version = 1; version <= 20; version++) {
    await page.evaluate(() => window.replace());
    await page.waitForFunction(version => window.latest.query.data?.[0] === version && window.latest.page.data?.[0] === version, version);
    assert.equal(await page.locator("#query").inputValue(), "query draft", `query replacement ${version}`);
    assert.equal(await page.locator("#page").inputValue(), "page draft", `page replacement ${version}`);
  }
  const result = await page.evaluate(() => window.result());
  assert.deepEqual(result.mounts, { query: 1, page: 1 });
  assert.equal(result.loading, 0, "no intermediate loading commit unmounts an editor");
  assert.ok(result.delays >= 20, "session authority was actually delayed");
  assert.ok(result.stale > 0, "the UI rendered kept stale answers");
  await page.evaluate(() => window.finish());
});

const harness = `
import React, { useState, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { createApp } from "snapback4/app";
import { memorySessionStore, keepSession } from "snapback4/auth";
import { AppProvider, useQuery, usePage } from "snapback4/react";
const url = "http://kept-react.test", memory = memorySessionStore();
await keepSession(url, { kind: "user", token: "alice", principal: "alice", expiresAt: Date.now() + 86400000 }, memory);
let version = 0, delayed = false, delays = 0, loading = 0, stale = 0;
const polls = [];
const mounts = { query: 0, page: 0 };
window.latest = {};
const app = createApp({ url, sessionStore: { ...memory, async get(key) {
  if (delayed) { delays++; await new Promise(resolve => setTimeout(resolve, 50)); }
  return memory.get(key);
} }, fetch: async (input, init) => {
  const path = new URL(input).pathname;
  if (path === "/schema") return Response.json({ schema: { tables: {} }, programs: [] });
  if (path === "/probe") return Response.json({ ok: true, principal: "alice" });
  if (path === "/changes") return new Promise((resolve, reject) => {
    polls.push(resolve);
    init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true });
  });
  if (path === "/q/read") return Response.json({ data: [version], complete: true, tables: ["notes"], seq: version });
  if (path === "/m/edit") return Response.json({ state: "sent", id: JSON.parse(init.body).id, seq: ++version });
  throw Error(path);
} });
const ready = await app.ready;
if (!ready.ok) throw Error(JSON.stringify(ready));
const op = { kind: "query", name: "read" };
function Editor({ kind }) {
  const [text, setText] = useState(() => { mounts[kind]++; return ""; });
  return <input id={kind} value={text} onChange={event => setText(event.target.value)} />;
}
function Screen({ kind, read }) {
  window.latest[kind] = read;
  useLayoutEffect(() => {
    if (delayed && read.loading) loading++;
    if (delayed && read.fresh === false) stale++;
  });
  return "data" in read ? <Editor kind={kind} /> : <span>Loading</span>;
}
function Query() { return <Screen kind="query" read={useQuery(op, {}, { keep: true })} />; }
function Page() { return <Screen kind="page" read={usePage(op, {}, { keep: true }).read} />; }
const root = createRoot(document.getElementById("root"));
root.render(<AppProvider app={app}><Query /><Page /></AppProvider>);
window.begin = () => { delayed = true; };
window.replace = async () => {
  while (!polls.length) await new Promise(resolve => setTimeout(resolve, 5));
  polls.shift()(Response.json({ seq: ++version, tables: ["notes"] }));
};
window.result = () => ({ mounts, loading, stale, delays });
window.finish = async () => { root.unmount(); delayed = false; await app.close(); };
`;

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { chromiumExecutable } from "../../../witness/lib.mjs";
import { server, binary } from "./helpers/app-server.mjs";
import { guest } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { harness, nativeViews } from "./helpers/social-browser.mjs";

const root = resolve(import.meta.dirname, "../../..");
test("social recipes in React/browser: real online signals and media, controlled read interleavings", { timeout: 90_000 }, async t => {
  const dir = mkdtempSync(join(root, ".social-browser-"));
  let vite, browser;
  t.after(async () => { await browser?.close(); await vite?.close(); rmSync(dir, { recursive: true, force: true }); });
  for (const args of [["new", dir, "--template", "social"], ["check"]]) {
    const run = spawnSync(binary, args, { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  }
  const { url } = await server(t, undefined, readFileSync(join(dir, "snapback/schema.q"), "utf8"));
  const js = ts.transpileModule(readFileSync(join(dir, "snapback/generated/api.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  const { api } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const sessions = await Promise.all([guest(url), guest(url), guest(url)]);
  sessions.forEach(value => assert.equal(value.ok, true));
  const [alice, bob, carol] = sessions.map(value => value.session);
  const client = createClient({ url, token: alice.token });
  t.after(() => client.close());
  const send = async (op, args) => { const write = await client.mutate(op, args); assert.equal(write.state, "sent", JSON.stringify(write)); return write.result; };
  const conversation = await send(api.createConversation, { title: "Friends" });
  await send(api.add, { conversation, principal: bob.principal });
  await send(api.send, { conversation, text: "retained coffee", photo: null });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3e0AAAAASUVORK5CYII=", "base64");
  const upload = async text => {
    const result = await client.upload(png); assert.equal(result.ok, true);
    await send(api.send, { conversation, text, photo: { id: result.asset.id } });
    return result.asset.id;
  };
  const photo = await upload("normal once"), latePhoto = await upload("late once"), accountPhoto = await upload("account once");
  const history = (await client.query(api.history, { conversation })).data;
  writeFileSync(join(dir, "fixture.json"), JSON.stringify({ url, conversation, alice, bob, carol, history, photo, latePhoto }));
  writeFileSync(join(dir, "harness.jsx"), harness);
  writeFileSync(join(dir, "native.jsx"), nativeViews);
  writeFileSync(join(dir, "picker.js"), "export async function launchImageLibraryAsync() { return { canceled: true }; }\n");
  writeFileSync(join(dir, "index.html"), '<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  const require = createRequire(join(root, "packages/snapback4/package.json"));
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  vite = await createServer({ root: dir, configFile: false, logLevel: "error", server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
    resolve: { alias: [
      { find: /^react$/, replacement: require.resolve("react") },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
      { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
      { find: "react-native", replacement: join(dir, "native.jsx") },
      { find: "expo-image-picker", replacement: join(dir, "picker.js") },
      { find: "starter-conversation", replacement: join(dir, "src/Conversation.tsx") },
      { find: "starter-api", replacement: join(dir, "snapback/generated/api.ts") },
      ...["react", "client", "auth", "contract"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === "react" ? "tsx" : "ts"}`) })),
    ] }, esbuild: { jsx: "automatic" } });
  await vite.listen();
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(), errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(vite.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.fixtureReady);
  const composer = page.getByTestId("composer");
  await composer.fill("my draft"); await composer.focus();
  await page.evaluate(() => { window.composerNode = document.querySelector('[data-testid="composer"]'); });

  await t.test("route, history and decorations revalidate independently without draft/focus loss", async () => {
    for (const name of ["conversationScreen", "messageReceipts", "history"]) {
      await page.evaluate(name => window.setRead(name, { loading: true }), name);
      assert.equal(await composer.inputValue(), "my draft");
      assert.equal(await composer.evaluate(node => node === window.composerNode && document.activeElement === node), true);
      if (name !== "history") assert.equal(await page.getByTestId("history").locator('[data-testid^="message-"]').count(), history.length);
    }
    await page.evaluate(() => {
      window.setRead("history", window.ready(window.historyRows, { revalidating: true }));
      window.setRead("messageReceipts", { denied: { code: "NOT_MEMBER", message: "Decoration refused" } });
      window.setRead("receiptMember", window.ready(null));
    });
    assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
    assert.equal(await composer.inputValue(), "my draft");
    await page.evaluate(() => window.leave());
    await page.evaluate(() => { window.setRead("history", window.ready(window.historyRows.map(row => ({ ...row, retained: true })), { fresh: false })); });
    assert.equal(await composer.evaluate(node => document.activeElement === node), true);
    const ids = await page.getByTestId("history").locator('[data-testid^="message-"]').evaluateAll(nodes => nodes.map(node => node.dataset.testid));
    assert.equal(new Set(ids).size, history.length);
    await page.evaluate(() => window.rejoin()); await page.evaluate(() => window.restore());
    assert.equal(await composer.inputValue(), "my draft");
    assert.deepEqual(await page.evaluate(() => window.components), { mounts: 1, unmounts: 0 });
  });

  await t.test("typing expires, drops on disconnect, needs a fresh keystroke and never queues", async () => {
    await composer.fill("new activity");
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 1);
    await composer.blur();
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 0);
    await composer.fill("disconnect activity");
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 1);
    await page.evaluate(() => window.drop());
    await composer.fill("dropped hint");
    await page.evaluate(() => window.expire());
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 0);
    assert.deepEqual(await page.evaluate(() => window.outboxes()), [[], []]);
    const sends = await page.evaluate(() => window.requests.filter(r => r.path === "/m/setTyping" && r.account === "alice").length);
    await page.evaluate(() => window.reconnect());
    // Longer than the hook's renewal cadence: a retained draft cannot restart it.
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => window.requests.filter(r => r.path === "/m/setTyping" && r.account === "alice").length), sends);
    await composer.fill("fresh keystroke");
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 1);
    await page.evaluate(() => window.leave()); await page.evaluate(() => window.expire());
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 0);
    await composer.fill("revoked cannot renew");
    assert.equal((await page.evaluate(() => window.typingAtPeer())).length, 0);
    await page.evaluate(() => window.rejoin());
    await page.evaluate(() => window.peerTyping());
    await page.getByText("Someone is typing…").waitFor();
    await page.evaluate(() => window.peerStop());
  });

  await t.test("one handle survives list remount, closes, rejects second open and cleans a late result", async () => {
    const select = id => page.getByTestId(`message-${history.find(row => row.photo?.id === id).id}`).getByRole("button", { name: "View once photo" }).click();
    await select(photo); await page.getByRole("button", { name: "Open media", exact: true }).click();
    await page.getByAltText("Once photo").waitFor();
    await page.evaluate(() => window.setRead("history", { loading: true }));
    await page.evaluate(() => window.restore());
    assert.equal(await page.getByAltText("Once photo").count(), 1);
    assert.deepEqual(await page.evaluate(() => window.assetCalls), [photo]);
    assert.deepEqual(await page.evaluate(() => window.revoked), []);
    await page.getByRole("button", { name: "Close photo" }).click();
    assert.deepEqual(await page.evaluate(() => window.revoked), [photo]);
    await select(photo); await page.getByRole("button", { name: "Open media", exact: true }).click();
    await page.getByText(/E_ASSET_VIEWED/).waitFor();
    await page.getByRole("button", { name: "Close photo" }).click();
    await select(latePhoto); await page.evaluate(() => window.holdAsset());
    await page.getByRole("button", { name: "Open media", exact: true }).click();
    await page.waitForFunction(() => window.assetHeld());
    await page.getByRole("button", { name: "Close photo" }).click();
    await page.evaluate(() => window.releaseAsset());
    await page.waitForFunction(id => window.revoked.includes(id), latePhoto);
    assert.equal(await page.getByTestId("once-viewer").count(), 0);
  });

  await t.test("account reset clears draft and stops the prior typing owner", async () => {
    await page.getByTestId(`message-${history.find(row => row.photo?.id === accountPhoto).id}`).getByRole("button", { name: "View once photo" }).click();
    await page.getByRole("button", { name: "Open media", exact: true }).click();
    await page.getByAltText("Once photo").waitFor();
    await composer.fill("private prior-account draft");
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 1);
    await page.evaluate(() => window.accountSwitch());
    assert.equal(await composer.inputValue(), "");
    assert.equal(await composer.evaluate(node => node === window.composerNode), false);
    await page.waitForFunction(id => window.revoked.includes(id), accountPhoto);
    assert.equal(await page.getByTestId("once-viewer").count(), 0);
    await page.evaluate(() => window.expire());
    assert.equal((await page.evaluate(() => window.typingAtPeer())).length, 0);
    assert.equal(await page.getByTestId("history").locator('[data-testid^="message-"]').count(), 0);
  });
  await page.evaluate(() => window.finish());
  assert.deepEqual(errors, []);
});

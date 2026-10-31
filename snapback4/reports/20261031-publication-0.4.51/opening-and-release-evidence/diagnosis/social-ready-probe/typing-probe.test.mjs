import { after as teardownAfter } from "file:///home/ccheever/sb4-pub-0441/snapback4/packages/snapback4/test/helpers/teardown.mjs";
import { createBrowserServer, loadBrowserPage, reloadBrowserPage } from 'file:///home/ccheever/sb4-pub-0441/snapback4/packages/snapback4/test/helpers/browser-server.mjs';
import { hangBudget } from 'file:///home/ccheever/sb4-pub-0441/snapback4/packages/snapback4/test/helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { chromiumExecutable } from "file:///home/ccheever/sb4-pub-0441/snapback4/witness/lib.mjs";
import { server, binary, until } from "file:///home/ccheever/sb4-pub-0441/snapback4/packages/snapback4/test/helpers/app-server.mjs";
import { guest, signup, login } from "file:///home/ccheever/sb4-pub-0441/snapback4/packages/snapback4/dist/auth.js";
import { createClient } from "file:///home/ccheever/sb4-pub-0441/snapback4/packages/snapback4/dist/client.js";
import { harness, nativeViews, routerHarness, onlineClientHarness, searchHarness } from "file:///home/ccheever/sb4-pub-0451-records/diagnosis/social-ready-probe/social-browser.mjs";

const root = "/home/ccheever/sb4-pub-0441/snapback4";
test("social recipes in React/browser: real online signals and media, controlled read interleavings", { timeout: hangBudget(303) }, async t => {
  const dir = mkdtempSync(join(root, ".social-browser-"));
  let vite, browser;
  teardownAfter(t, () => rmSync(dir, { recursive: true, force: true }));
  teardownAfter(t, () => vite?.close());
  teardownAfter(t, () => browser?.close());
  for (const args of [["new", dir, "--template", "social"], ["check"]]) {
    const run = spawnSync(binary, args, { cwd: dir, encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  }
  const { url } = await server(t, undefined, readFileSync(join(dir, "snapback/schema.q"), "utf8"));
  const js = ts.transpileModule(readFileSync(join(dir, "snapback/generated/api.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText.replaceAll('"snapback4/contract"', JSON.stringify('file:///home/ccheever/sb4-pub-0441/snapback4/packages/snapback4/dist/contract.js'));
  const { api } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const sessions = await Promise.all([signup(url, "alice@social.test", "social-password"), guest(url), guest(url)]);
  sessions.forEach(value => assert.equal(value.ok, true));
  const [alice, bob, carol] = sessions.map(value => value.session);
  const client = createClient({ url, token: alice.token });
  teardownAfter(t, () => client.close());
  const secondLogin = await login(url, "alice@social.test", "social-password"); assert.equal(secondLogin.ok, true);
  const secondSession = createClient({ url, token: secondLogin.session.token });
  const peerSession = createClient({ url, token: bob.token });
  teardownAfter(t, () => Promise.all([secondSession.close(), peerSession.close()]));
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
  const photo = await upload("normal once"), latePhoto = await upload("late once"), withdrawnPhoto = await upload("withdrawn once"), withdrawnLatePhoto = await upload("withdrawn late once"), accountPhoto = await upload("account once");
  const unsentUpload = await client.upload(png); assert.equal(unsentUpload.ok, true);
  const unsentPhoto = unsentUpload.asset.id;
  const history = (await client.query(api.history, { conversation })).data;
  writeFileSync(join(dir, "fixture.json"), JSON.stringify({ url, conversation, alice, bob, carol, history, photo, latePhoto }));
  writeFileSync(join(dir, "harness.jsx"), harness);
  writeFileSync(join(dir, "device.wasm"), readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")));
  writeFileSync(join(dir, "native.jsx"), nativeViews);
  writeFileSync(join(dir, "router.jsx"), routerHarness);
  writeFileSync(join(dir, "online-client.js"), onlineClientHarness);
  writeFileSync(join(dir, "route-client.js"), 'export const url = (await (await fetch("/fixture.json")).json()).url;');
  writeFileSync(join(dir, "picker.js"), "export async function launchImageLibraryAsync() { return window.pickAsset ? { canceled: false, assets: [{ uri: 'data:image/png;base64,iVBORw0KGgo=' }] } : { canceled: true }; }\n");
  writeFileSync(join(dir, "index.html"), '<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  const require = createRequire(join(root, "packages/snapback4/package.json"));

  vite = await createBrowserServer({ root: dir, configFile: false, logLevel: "error", server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
    resolve: { alias: [
      { find: /^react$/, replacement: require.resolve("react") },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
      { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
      { find: "react-native", replacement: join(dir, "native.jsx") },
      { find: "expo-image-picker", replacement: join(dir, "picker.js") },
      { find: "starter-route", replacement: join(dir, "app/conversation/[id].tsx") },
      { find: "expo-router", replacement: join(dir, "router.jsx") },
      { find: /^(\.\.\/\.\.\/src|\.)\/client$/, replacement: join(dir, "route-client.js") },
      { find: "./intent-store", replacement: join(dir, "src/intent-store.web.ts") },
      { find: "real-client", replacement: join(root, "packages/snapback4/src/client.ts") },
      { find: "snapback4/client", replacement: join(dir, "online-client.js") },
      { find: "starter-api", replacement: join(dir, "snapback/generated/api.ts") },
      ...["react", "app", "auth", "contract", "web"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === "react" ? "tsx" : "ts"}`) })),
    ] }, esbuild: { jsx: "automatic" } });
  await vite.listen();
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  browser = await chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget());
  await page.exposeFunction("leaveSession", async () => {
    const write = await secondSession.mutate(api.leave, { conversation });
    assert.equal(write.state, "sent", JSON.stringify(write)); return write;
  });
  await page.exposeFunction("rejoinSession", async () => {
    const write = await peerSession.mutate(api.add, { conversation, principal: alice.principal });
    assert.equal(write.state, "sent", JSON.stringify(write)); return write;
  });
  page.on("pageerror", error => errors.push(String(error)));
  await loadBrowserPage(t, page, vite.resolvedUrls.local[0]);
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
      window.setRead("receiptMember", window.ready({ principal: "alice" }, { revalidating: true }));
    });
    assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isEnabled(), true);
    assert.equal(await composer.inputValue(), "my draft");
    await page.evaluate(() => { window.setRead("receiptMember", { denied: { code: "NOT_MEMBER", message: "Removed" } }); });
    assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
    assert.equal(await composer.inputValue(), "my draft");
    for (const uncertain of ["loading", "partial"]) {
      await page.evaluate(state => window.setRead("receiptMember", state === "loading" ? { loading: true } : window.ready(null, { complete: false })), uncertain);
      assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), false, uncertain);
    }
    await page.evaluate(() => { window.setRead("receiptMember", window.ready(null)); });
    await page.getByText("You are no longer a member. Your draft stays here.").waitFor();
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

  await t.test("loading, revalidating and offline membership allow custody and eventual server delivery", async () => {
    for (const state of ["loading", "revalidating", "offline", "incomplete"]) {
      await page.evaluate(state => window.setRead("receiptMember", state === "revalidating" ? window.ready(null, { revalidating: true }) : state === "incomplete" ? window.ready(null, { complete: false }) : { loading: true }), state);
      await page.getByText("Membership is being checked. You can queue a message.").waitFor();
      assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isEnabled(), true);
      await page.evaluate(() => window.drop());
      const text = `queued with ${state} membership`;
      await composer.fill(text);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await until(() => page.evaluate(async text => (await window.savedSends()).some(w => w.op === "send" && w.args.text === text), text), "async browser predicate");
      assert.equal(await composer.inputValue(), "");
      assert.ok(!(await page.evaluate(() => window.serverHistory())).data.some(row => row.text === text));
      await page.evaluate(() => window.reconnect());
      await until(() => page.evaluate(async text => (await window.serverHistory()).data.some(row => row.text === text), text), "async browser predicate");
      await until(() => page.evaluate(async () => !(await window.savedSends()).some(w => w.op === "send")), "async browser predicate");
    }
    await page.evaluate(async () => { window.restore(); await Promise.all(window.onlineArms.map(arm => arm.query({ name: "typingIn", kind: "query" }, { conversation: window.historyRows[0].conversation }))); });
    // Known-offline one-shots refuse before their reconnect probe completes.
    await page.waitForFunction(() => window.onlineArms.filter(arm => arm.viewer()).every(arm => arm.link() === "online"));
  });

  await t.test("older bubbles recover receipts after withdrawal without losing history", async () => {
    await page.evaluate(() => {
      const older = { ...window.historyRows[0], id: "older-message", text: "older bubble", photo: null };
      window.setRead("history:older-cursor", window.ready([older]));
      window.setRead("messageReceipts:older-cursor", window.ready([{ id: older.id, receipt: "delivered" }]));
      window.setRead("messageReceipts", { loading: true });
      window.setRead("history", window.ready(window.historyRows, { next: "older-cursor" }));
    });
    await page.getByRole("button", { name: "Older messages" }).click();
    const bubble = page.getByTestId("message-older-message");
    await bubble.getByText("older bubble", { exact: true }).waitFor();
    await page.evaluate(() => window.setRead("messageReceipts", window.ready(window.historyRows.map(row => ({ id: row.id, receipt: "delivered" })), { next: "older-cursor" })));
    await bubble.getByText("older bubble · delivered").waitFor();
    const calls = await page.evaluate(() => window.observations.filter(call => call.args.c === "older-cursor"));
    assert.deepEqual(calls.map(call => call.op).sort(), ["history", "messageReceipts"]);
    await page.evaluate(() => window.setRead("messageReceipts:older-cursor", { denied: { code: "NOT_MEMBER", message: "Receipts withdrawn" } }));
    assert.equal(await bubble.innerText(), "older bubbleReply");
    await page.evaluate(() => window.restore());
    await bubble.waitFor({ state: "detached" });
  });

  const signalCount = name => page.evaluate(name => window.requests.filter(r => r.path === "/m/" + name && r.account === "alice").length, name);
  const tick = () => page.evaluate(() => window.tick());
  const quietAfter = async action => {
    await composer.fill("activity " + await signalCount("setTyping"));
    console.log("TYPING_WAIT 182 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 1), "typing wait 182");
    const stops = await signalCount("stopTyping");
    await action();
    await page.waitForFunction(before => window.requests.filter(r => r.path === "/m/stopTyping" && r.account === "alice").length > before, stops);
    console.log("TYPING_WAIT 186 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 0), "typing wait 186");
    const renewals = await signalCount("setTyping");
    await tick(); await tick();
    assert.equal(await signalCount("setTyping"), renewals, "cleanup must end renewal");
    assert.ok((await page.evaluate(() => window.outboxes())).every(box => box.length === 0),JSON.stringify(await page.evaluate(() => window.outboxes())));
  };
  await t.test("renewal, idle without blur, Send, route visibility/key and unmount stop before expiry", async () => {
    await composer.fill("controlled activity");
    console.log("TYPING_WAIT 194 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 1), "typing wait 194");
    const before = await signalCount("setTyping");
    await tick();
    await page.waitForFunction(before => window.requests.filter(r => r.path === "/m/setTyping" && r.account === "alice").length > before, before);
    const stops = await signalCount("stopTyping");
    await tick(); // 2.002s idle, still focused, before the four-second expiry.
    await page.waitForFunction(before => window.requests.filter(r => r.path === "/m/stopTyping" && r.account === "alice").length > before, stops);
    console.log("TYPING_WAIT 201 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 0), "typing wait 201");
    assert.equal(await composer.evaluate(node => document.activeElement === node), true);
    // DOM click avoids blur, so Send itself must stop the lease.
    await quietAfter(() => page.getByRole("button", { name: "Send", exact: true }).evaluate(node => node.click()));
    await quietAfter(() => page.evaluate(() => window.background(true)));
    await page.evaluate(() => window.background(false));
    await quietAfter(() => page.evaluate(() => window.focusRoute(false)));
    await page.evaluate(() => window.focusRoute(true));
    await page.getByRole("textbox", { name: "Account to invite" }).fill("invite draft");
    await quietAfter(() => page.evaluate(() => window.navigate("another-conversation")));
    assert.equal(await page.getByRole("textbox", { name: "Account to invite" }).inputValue(), "", "route key resets route-owned state");
    assert.equal(await composer.inputValue(), "", "route key replaces the old composer");
    await page.evaluate(() => window.restoreRoute());
    await quietAfter(() => page.evaluate(() => window.unmount()));
    await page.evaluate(() => window.mount());
    await composer.waitFor();
    await page.evaluate(() => { window.composerNode = document.querySelector('[data-testid="composer"]'); });
  });

  await t.test("a late failed renewal cannot stop a newer successful typing lease", async () => {
    await composer.fill("start lease");
    console.log("TYPING_WAIT 222 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 1), "typing wait 222");
    await page.evaluate(() => window.holdTypingFailure());
    await tick(); // Hold the interval renewal's result after it reaches the server.
    await page.waitForFunction(() => window.typingFailureHeld());
    const settled = await page.evaluate(() => window.typingResults.length);
    await composer.fill("newer keystroke");
    await page.waitForFunction(n => window.typingResults.length > n, settled);
    assert.equal(await page.evaluate(() => window.typingResults.at(-1)), "sent");
    await page.evaluate(() => window.releaseTypingFailure());
    await page.waitForFunction(n => window.typingResults.length === n + 2, settled);
    assert.equal(await page.evaluate(() => window.typingResults.at(-1)), "failed");
    const renewals = await signalCount("setTyping"), stops = await signalCount("stopTyping");
    await tick();
    await page.waitForFunction(n => window.requests.filter(r => r.path === "/m/setTyping" && r.account === "alice").length > n, renewals, { timeout: hangBudget() });
    await tick(); // Idle stop still owns the newer lease, before its server expiry.
    await page.waitForFunction(n => window.requests.filter(r => r.path === "/m/stopTyping" && r.account === "alice").length > n, stops);
    console.log("TYPING_WAIT 238 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 0), "typing wait 238");
    const after = await signalCount("setTyping");
    await tick();
    assert.equal(await signalCount("setTyping"), after);
    assert.ok((await page.evaluate(() => window.outboxes())).every(box => box.length === 0),JSON.stringify(await page.evaluate(() => window.outboxes())));

    // The current generation's failure still ends renewal and relies on expiry.
    await page.evaluate(() => window.holdTypingFailure());
    await composer.fill("current refused renewal");
    await page.waitForFunction(() => window.typingFailureHeld());
    const outcomes = await page.evaluate(() => window.typingResults.length);
    await page.evaluate(() => window.releaseTypingFailure());
    await page.waitForFunction(n => window.typingResults.length > n, outcomes);
    const failedRenewals = await signalCount("setTyping"), failedStops = await signalCount("stopTyping");
    await tick();
    assert.equal(await signalCount("setTyping"), failedRenewals);
    assert.equal(await signalCount("stopTyping"), failedStops);
    await page.evaluate(() => window.expire());
    console.log("TYPING_WAIT 256 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 0), "typing wait 256");
  });

  await t.test("typing expires, drops on disconnect, needs a fresh keystroke and never queues", async () => {
    await composer.fill("new activity");
    console.log("TYPING_WAIT 261 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 1), "typing wait 261");
    await composer.blur();
    console.log("TYPING_WAIT 263 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 0), "typing wait 263");
    await composer.fill("disconnect activity");
    console.log("TYPING_WAIT 265 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 1), "typing wait 265");
    await page.evaluate(() => window.drop());
    await composer.fill("dropped hint");
    assert.equal(await composer.evaluate(node => node === window.composerNode && document.activeElement === node), true);
    await page.evaluate(() => window.expire());
    console.log("TYPING_WAIT 270 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 0), "typing wait 270");
    assert.ok((await page.evaluate(() => window.outboxes())).every(box => box.length === 0),JSON.stringify(await page.evaluate(() => window.outboxes())));
    const sends = await page.evaluate(() => window.requests.filter(r => r.path === "/m/setTyping" && r.account === "alice").length);
    await page.evaluate(() => window.reconnect());
    assert.equal(await composer.inputValue(), "dropped hint");
    assert.equal(await composer.evaluate(node => node === window.composerNode && document.activeElement === node), true);
    // Longer than the hook's renewal cadence: a retained draft cannot restart it.
    await page.evaluate(() => window.tick(1300));
    assert.equal(await page.evaluate(() => window.requests.filter(r => r.path === "/m/setTyping" && r.account === "alice").length), sends);
    await composer.fill("fresh keystroke");
    console.log("TYPING_WAIT 280 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 1), "typing wait 280");
    await page.evaluate(() => window.leave()); await page.evaluate(() => window.expire());
    console.log("TYPING_WAIT 282 "+JSON.stringify(await page.evaluate(()=>({links:window.onlineArms.map(a=>a.link()),requests:window.requests.slice(-8),results:window.typingResults}))));
    await until(() => page.evaluate(async () => (await window.typingAtPeer()).length === 0), "typing wait 282");
    await composer.fill("revoked cannot renew");
    assert.equal((await page.evaluate(() => window.typingAtPeer())).length, 0);
    await page.evaluate(() => window.rejoin());
    await page.evaluate(() => window.peerTyping());
    await page.getByText("Someone is typing…").waitFor();
    await page.evaluate(() => window.peerStop());
  });

  await page.evaluate(() => window.finish());
});

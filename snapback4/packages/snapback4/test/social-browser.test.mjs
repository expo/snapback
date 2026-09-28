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
import { guest, signup, login } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { harness, nativeViews, routerHarness, onlineClientHarness } from "./helpers/social-browser.mjs";

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
  const sessions = await Promise.all([signup(url, "alice@social.test", "social-password"), guest(url), guest(url)]);
  sessions.forEach(value => assert.equal(value.ok, true));
  const [alice, bob, carol] = sessions.map(value => value.session);
  const client = createClient({ url, token: alice.token });
  t.after(() => client.close());
  const secondLogin = await login(url, "alice@social.test", "social-password"); assert.equal(secondLogin.ok, true);
  const secondSession = createClient({ url, token: secondLogin.session.token });
  const peerSession = createClient({ url, token: bob.token });
  t.after(() => Promise.all([secondSession.close(), peerSession.close()]));
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
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  vite = await createServer({ root: dir, configFile: false, logLevel: "error", server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
    resolve: { alias: [
      { find: /^react$/, replacement: require.resolve("react") },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
      { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
      { find: "react-native", replacement: join(dir, "native.jsx") },
      { find: "expo-image-picker", replacement: join(dir, "picker.js") },
      { find: "starter-route", replacement: join(dir, "app/conversation/[id].tsx") },
      { find: "expo-router", replacement: join(dir, "router.jsx") },
      { find: "../../src/client", replacement: join(dir, "route-client.js") },
      { find: "./intent-store", replacement: join(dir, "src/intent-store.web.ts") },
      { find: "real-client", replacement: join(root, "packages/snapback4/src/client.ts") },
      { find: "snapback4/client", replacement: join(dir, "online-client.js") },
      { find: "starter-api", replacement: join(dir, "snapback/generated/api.ts") },
      ...["react", "app", "auth", "contract", "web"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === "react" ? "tsx" : "ts"}`) })),
    ] }, esbuild: { jsx: "automatic" } });
  await vite.listen();
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(), errors = [];
  await page.exposeFunction("leaveSession", async () => {
    const write = await secondSession.mutate(api.leave, { conversation });
    assert.equal(write.state, "sent", JSON.stringify(write)); return write;
  });
  await page.exposeFunction("rejoinSession", async () => {
    const write = await peerSession.mutate(api.add, { conversation, principal: alice.principal });
    assert.equal(write.state, "sent", JSON.stringify(write)); return write;
  });
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
      window.setRead("receiptMember", window.ready({ principal: "alice" }, { revalidating: true }));
    });
    assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
    assert.equal(await composer.inputValue(), "my draft");
    await page.evaluate(() => { window.setRead("receiptMember", window.ready(null)); });
    await page.evaluate(() => window.leave());
    await page.evaluate(() => { window.setRead("history", window.ready(window.historyRows.map(row => ({ ...row, retained: true })), { fresh: false })); });
    assert.equal(await composer.evaluate(node => document.activeElement === node), true);
    const ids = await page.getByTestId("history").locator('[data-testid^="message-"]').evaluateAll(nodes => nodes.map(node => node.dataset.testid));
    assert.equal(new Set(ids).size, history.length);
    await page.evaluate(() => window.rejoin()); await page.evaluate(() => window.restore());
    assert.equal(await composer.inputValue(), "my draft");
    assert.deepEqual(await page.evaluate(() => window.components), { mounts: 1, unmounts: 0 });
  });

  await t.test("older bubbles share the history cursor and retain text when receipts withdraw", async () => {
    await page.evaluate(() => {
      const older = { ...window.historyRows[0], id: "older-message", text: "older bubble", photo: null };
      window.setRead("history:older-cursor", window.ready([older]));
      window.setRead("messageReceipts:older-cursor", window.ready([{ id: older.id, receipt: "delivered" }]));
      window.setRead("history", window.ready(window.historyRows, { next: "older-cursor" }));
    });
    await page.getByRole("button", { name: "Older messages" }).click();
    const bubble = page.getByTestId("message-older-message");
    await bubble.getByText("older bubble · delivered").waitFor();
    const calls = await page.evaluate(() => window.observations.filter(call => call.args.c === "older-cursor"));
    assert.deepEqual(calls.map(call => call.op).sort(), ["history", "messageReceipts"]);
    await page.evaluate(() => window.setRead("messageReceipts:older-cursor", { denied: { code: "NOT_MEMBER", message: "Receipts withdrawn" } }));
    assert.equal(await bubble.innerText(), "older bubble");
    await page.evaluate(() => window.restore());
    await bubble.waitFor({ state: "detached" });
  });

  const signalCount = name => page.evaluate(name => window.requests.filter(r => r.path === "/m/" + name && r.account === "alice").length, name);
  const tick = () => page.evaluate(() => window.tick());
  const quietAfter = async action => {
    await composer.fill("activity " + await signalCount("setTyping"));
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 1);
    const stops = await signalCount("stopTyping");
    await action();
    await page.waitForFunction(before => window.requests.filter(r => r.path === "/m/stopTyping" && r.account === "alice").length > before, stops);
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 0);
    const renewals = await signalCount("setTyping");
    await tick(); await tick();
    assert.equal(await signalCount("setTyping"), renewals, "cleanup must end renewal");
    assert.ok((await page.evaluate(() => window.outboxes())).every(box => box.length === 0));
  };
  await t.test("renewal, idle without blur, Send, route visibility/key and unmount stop before expiry", async () => {
    await composer.fill("controlled activity");
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 1);
    const before = await signalCount("setTyping");
    await tick();
    await page.waitForFunction(before => window.requests.filter(r => r.path === "/m/setTyping" && r.account === "alice").length > before, before);
    const stops = await signalCount("stopTyping");
    await tick(); // 2.002s idle, still focused, before the four-second expiry.
    await page.waitForFunction(before => window.requests.filter(r => r.path === "/m/stopTyping" && r.account === "alice").length > before, stops);
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 0);
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
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 1);
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
    await page.waitForFunction(n => window.requests.filter(r => r.path === "/m/setTyping" && r.account === "alice").length > n, renewals, { timeout: 3000 });
    await tick(); // Idle stop still owns the newer lease, before its server expiry.
    await page.waitForFunction(n => window.requests.filter(r => r.path === "/m/stopTyping" && r.account === "alice").length > n, stops);
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 0);
    const after = await signalCount("setTyping");
    await tick();
    assert.equal(await signalCount("setTyping"), after);
    assert.ok((await page.evaluate(() => window.outboxes())).every(box => box.length === 0));

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
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 0);
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
    assert.equal(await composer.evaluate(node => node === window.composerNode && document.activeElement === node), true);
    await page.evaluate(() => window.expire());
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 0);
    assert.ok((await page.evaluate(() => window.outboxes())).every(box => box.length === 0));
    const sends = await page.evaluate(() => window.requests.filter(r => r.path === "/m/setTyping" && r.account === "alice").length);
    await page.evaluate(() => window.reconnect());
    assert.equal(await composer.inputValue(), "dropped hint");
    assert.equal(await composer.evaluate(node => node === window.composerNode && document.activeElement === node), true);
    // Longer than the hook's renewal cadence: a retained draft cannot restart it.
    await page.evaluate(() => window.tick(1300));
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
    const listMounts = await page.evaluate(() => window.listMounts);
    await page.evaluate(() => window.setRead("history", { loading: true }));
    await page.getByTestId("history").waitFor({ state: "detached" });
    await page.evaluate(() => window.restore());
    await page.waitForFunction(before => window.listMounts > before, listMounts);
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

  await t.test("the viewer's own read keeps the handle through loading and revokes on withdrawal, including in flight", async () => {
    const select = id => page.getByTestId(`message-${history.find(row => row.photo?.id === id).id}`).getByRole("button", { name: "View once photo" }).click();
    for (const [id, inFlight] of [[withdrawnPhoto, false], [withdrawnLatePhoto, true]]) {
      await select(id);
      if (inFlight) await page.evaluate(() => window.holdAsset());
      await page.getByRole("button", { name: "Open media", exact: true }).click();
      if (inFlight) await page.waitForFunction(() => window.assetHeld());
      else await page.getByAltText("Once photo").waitFor();
      const counts = await page.evaluate(() => [window.assetCalls.length, window.revoked.length]);
      await page.evaluate(() => window.setRead("messagePhoto", { loading: true }));
      assert.equal(await page.getByTestId("once-viewer").count(), 1);
      if (!inFlight) assert.equal(await page.getByAltText("Once photo").count(), 1);
      await page.evaluate(id => window.setRead("messagePhoto", window.ready(window.historyRows.find(row => row.photo?.id === id))), id);
      assert.deepEqual(await page.evaluate(() => [window.assetCalls.length, window.revoked.length]), counts);
      await page.evaluate(inFlight => window.setRead("messagePhoto", inFlight ? { denied: { code: "NOT_MEMBER", message: "Media withdrawn" } } : window.ready(null)), inFlight);
      await page.getByTestId("once-viewer").waitFor({ state: "detached" });
      if (inFlight) {
        assert.deepEqual(await page.evaluate(() => [window.assetCalls.length, window.revoked.length]), counts);
        await page.evaluate(() => window.releaseAsset());
      }
      await page.waitForFunction(id => window.revoked.includes(id), id);
      assert.deepEqual(await page.evaluate(() => [window.assetCalls.length, window.revoked.length]), [counts[0], counts[1] + 1]);
    }
  });

  await t.test("two offline sends keep independent failures and attachment arguments after another session leaves", async () => {
    await page.evaluate(() => window.drop());
    await composer.fill("first offline message");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(async () => (await window.savedSends()).filter(w => w.op === "send").length === 1);
    // The picker stub uploads no bytes; its already-uploaded asset id travels in the real send args.
    await page.evaluate(id => { window.pickAsset = id; }, unsentPhoto);
    await page.getByRole("button", { name: "Attach once photo" }).click();
    await page.getByRole("button", { name: "Remove attachment" }).waitFor();
    await composer.fill("second offline message");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(async () => (await window.savedSends()).filter(w => w.op === "send").length === 2);
    assert.ok(!(await page.evaluate(() => window.serverHistory())).data.some(row => row.text.includes("offline message")), "neither send reached the server while offline");
    assert.equal((await page.evaluate(() => window.leave())).state, "sent");
    await page.evaluate(() => window.reconnect());
    try { await page.getByRole("button", { name: "Edit unsent message" }).nth(1).waitFor({ timeout: 5000 }); }
    catch (error) { throw Error(String(error) + JSON.stringify(await page.evaluate(async () => ({ pending: await window.savedSends(), text: document.body.innerText, settlements: await window.sendOutcomes() })))); }
    const failed = page.locator('[data-testid^="send-"]');
    assert.equal(await failed.count(), 2, JSON.stringify(await failed.allTextContents()));
    assert.match(await failed.nth(0).innerText(), /first offline message/);
    const outcomes = await page.evaluate(() => window.sendOutcomes());
    assert.ok(outcomes.every(entry => entry.outcome?.state === "failed" && entry.outcome.why.code === "NOT_MEMBER"), JSON.stringify(outcomes));
    assert.match(await failed.nth(1).innerText(), /second offline message.*Attached once photo/s);
    await page.evaluate(() => window.unmount()); await page.evaluate(() => window.mount());
    await page.getByRole("button", { name: "Edit unsent message" }).nth(1).waitFor();
    assert.equal(await failed.count(), 2, "saved IDs recover both outcomes on remount");
    await failed.nth(1).getByRole("button", { name: "Edit unsent message" }).click();
    assert.equal(await composer.inputValue(), "second offline message");
    await page.getByRole("button", { name: "Remove attachment" }).waitFor();
    await failed.nth(0).getByRole("button", { name: "Edit unsent message" }).click();
    assert.equal(await composer.inputValue(), "second offline message first offline message");
    await page.evaluate(() => window.rejoin());
  });

  await t.test("observations make retention explicit", async () => {
    const observed = await page.evaluate(() => window.observations);
    for (const name of ["receiptMember", "messageReceipts", "messagePhoto", "typingIn"]) {
      const calls = observed.filter(call => call.op === name);
      assert.ok(calls.length > 0, name);
      assert.ok(calls.every(call => call.options?.keep === false), name + " withdraws immediately");
    }
    for (const name of ["conversationScreen", "history"]) assert.ok(observed.filter(call => call.op === name).every(call => call.options?.keep === undefined), name + " uses bounded SDK retention");
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
    assert.equal(await page.locator('[data-testid^="send-"]').count(), 0, "other account never sees prior intents");
    await page.waitForFunction(id => window.revoked.includes(id), accountPhoto);
    assert.equal(await page.getByTestId("once-viewer").count(), 0);
    await page.waitForFunction(async () => (await window.typingAtPeer()).length === 0);
    assert.equal((await page.evaluate(() => window.typingAtPeer())).length, 0);
    assert.equal(await page.getByTestId("history").locator('[data-testid^="message-"]').count(), 0);
  });
  await page.evaluate(() => window.finish());
  assert.deepEqual(errors, []);
});

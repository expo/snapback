// Calibration #26's exact Quarry program and query/useAsset patterns, on the public package entries.
// @ref LLP 3000.008.002.000#6 — author avatars keep profile authority across message/feed observations.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { processDevice } from "../dist/native.js";
import { mintId } from "../dist/client.js";
import { login } from "../dist/auth.js";
import { chromiumExecutable } from "../../../witness/lib.mjs";
import { binary } from "./helpers/app-server.mjs";
import { avatarFixture } from "./helpers/avatar-fixture.mjs";

const root = resolve(import.meta.dirname, "../../..");
const clientDir = process.env.AV_CLIENT_DIR ?? join(root, "packages/snapback4/dist");

test("message authors and feed avatars share ordinary home-row authority", { timeout: 120_000 }, async t => {
  const fixture = await avatarFixture(t);
  const require = createRequire(join(root, "packages/snapback4/package.json"));
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  const { createServer } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
  const temporary = mkdtempSync(join(tmpdir(), "sb4-avatar-react-"));
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
      ...["app", "auth", "react", "web", "local"].map(name => ({ find: `snapback4/${name}`, replacement: join(clientDir, `${name}.js`) })),
      { find: "#fetch", replacement: join(clientDir, "default-fetch.js") },
    ] } });
  await server.listen();
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ["--no-sandbox"] });
  for (const tier of ["online", "process", "wasm"]) await t.test(tier, async t => {
    const page = await browser.newPage();
    const devices = [], errors = [];
    t.after(async () => { await page.close(); for (const d of devices) await d.close(); });
    page.on("pageerror", error => errors.push(String(error)));
    const opener = processDevice({ binary, dir: join(fixture.dir, tier) });
    await page.exposeFunction("deviceOpen", async (name, backend) => { devices.push(await opener.open(name, backend)); return devices.length - 1; });
    await page.exposeFunction("deviceCall", (index, request) => devices[index].call(request));
    await page.exposeFunction("deviceClose", index => devices[index].close());
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.start);
    const signedIn = await login(fixture.url, "bob@avatars.test", "password-avatars"); assert.equal(signedIn.ok, true);
    await page.evaluate(options => window.start(options), { tier, url: fixture.url, session: signedIn.session, dm: fixture.dm, group: fixture.group });
    try {
      await page.waitForFunction(() => ["dm", "group", "feed", "inbox"].every(scope => {
        const nodes = [...document.querySelectorAll(`[data-scope="${scope}"]`)];
        return nodes.length === (scope === "inbox" ? 2 : 20) && nodes.every(n => n.dataset.status === "ready" && n.querySelector("img")?.naturalWidth > 0);
      }), null, { timeout: 15_000 });
    } catch (error) {
      assert.fail(JSON.stringify({ error: String(error), errors, state: await page.evaluate(() => window.diagnostics()) }));
    }
    t.diagnostic(JSON.stringify(await page.evaluate(() => window.diagnostics().counts)));
    const alice = fixture.users.alice, bob = fixture.users.bob;
    const before = await page.evaluate(principal => window.images(principal), alice.session.principal);
    assert.equal((await page.evaluate(id => window.readAsset(id), before.id)).ready, true, "another handle for the same id resolves independently");
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('[data-scope="dm"] img')].every(i => i.complete && i.naturalWidth > 0)), "releasing the extra handle does not revoke bubble handles");

    const next = await fixture.upload(alice.client);
    await fixture.write(alice.client, "placeAvatar", { avatar: { id: next.id } });
    await page.waitForFunction(({ principal, id, count }) => {
      const images = window.images(principal);
      return images.id === id && images.ready && images.urls.length === count;
    }, { principal: alice.session.principal, id: next.id, count: before.urls.length });
    assert.equal((await page.evaluate(id => window.readAsset(id), before.id)).denied.code, "E_ASSET_UNKNOWN", "replacement revokes the old home placement");
    assert.ok(await page.evaluate(async urls => (await Promise.all(urls.map(url => fetch(url).then(() => false, () => true)))).every(Boolean), before.urls), "replacement releases every old display URL");
    await page.evaluate(id => window.probe(id), before.id);
    await page.waitForFunction(() => window.probeState?.status === "denied");
    const denied = await page.evaluate(() => window.probeState);
    assert.equal(denied.why.code, "E_ASSET_UNKNOWN"); assert.ok(denied.why.message);
    await page.evaluate(() => window.probe(null));
    await page.waitForFunction(() => window.probeState?.status === "empty");

    const once = await fixture.upload(alice.client), unopened = await fixture.upload(alice.client);
    for (const photo of [once, unopened]) await fixture.write(alice.client, "messaging.send", {
      conversation: fixture.group, id: mintId(), text: "Private one-view photo", quote: null, photo: null, video: null, oncePhoto: { id: photo.id },
    });
    assert.equal((await page.evaluate(id => window.readAsset(id), once.id)).ready, true);
    assert.equal((await page.evaluate(id => window.readAsset(id), once.id)).denied.code, "E_ASSET_VIEWED", "one view per principal remains exact");
    await fixture.write(alice.client, "messaging.remove", { conversation: fixture.group, principal: bob.session.principal });
    assert.equal((await page.evaluate(id => window.readAsset(id), unopened.id)).denied.code, "E_ASSET_UNKNOWN", "membership revocation refuses even an unopened private image");
    assert.equal((await page.evaluate(id => window.readAsset(id), next.id)).ready, true, "leaving a conversation does not revoke its author's public profile avatar");
    await fixture.write(alice.client, "messaging.add", { conversation: fixture.group, principal: bob.session.principal });
    await page.evaluate(() => window.signOut());
    await page.waitForFunction(() => !document.querySelector('[data-status="ready"]'));
    const signedOut = await page.evaluate(id => window.readAsset(id), next.id);
    assert.ok(["E_AUTH", "E_CLOSED"].includes(signedOut.denied.code), JSON.stringify(signedOut));
    t.diagnostic("replacement, independent handles, released-id refusal, one-view consumption, membership revocation and sign-out passed");
    await page.evaluate(() => window.finish());
    assert.deepEqual(errors, []);
  });
});

const harness = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, SnapbackProvider, useQuery, usePage, useAsset, useViewer } from "snapback4/react";
import { createApp } from "snapback4/app";
import { createLocalClient } from "snapback4/local";
import { keepSession, localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
const q = name => ({ kind: "query", name });
const profileById = q("profileById"), history = q("messaging.history"), global = q("social.global"), inbox = q("messaging.inbox");
const snapshots = {}, requests = [];
let app, root, config;
function Avatar({ scope, id, principal, supplied }) {
  const a = useQuery(profileById, { principal });
  const author = supplied ?? ("data" in a ? a.data : null);
  const avatar = useAsset(author?.avatar?.id ?? null);
  snapshots[scope + ":" + id] = { principal, profile: a, assetId: author?.avatar?.id, avatar };
  return <div data-scope={scope} data-status={avatar.status} data-asset={author?.avatar?.id} data-principal={principal}>
    {avatar.status === "ready" ? <img src={avatar.url} alt={author?.displayName} /> : <span>{avatar.status === "denied" ? avatar.why.message : author?.displayName}</span>}
  </div>;
}
function Chat({ scope, conversation }) {
  const messages = usePage(history, { conversation });
  return <section>{messages.items.map(m => <Avatar key={m.id} scope={scope} id={m.id} principal={m.sender} />)}</section>;
}
function Feed() {
  const feed = usePage(global, {});
  return <section>{feed.items.map(e => <Avatar key={e.id} scope="feed" id={e.id} principal={e.card.authorId} supplied={e.author} />)}</section>;
}
function Inbox() {
  const chats = usePage(inbox, {}), viewer = useViewer();
  return <section>{chats.items.filter(e => e.chat).map(e => <Avatar key={e.conversation} scope="inbox" id={e.conversation} principal={e.chat.peerA === viewer ? e.chat.peerB : e.chat.peerA} />)}</section>;
}
function Probe() {
  const [id, setId] = useState(null); window.probe = setId;
  const state = useAsset(id); window.probeState = state;
  return <div data-probe={state.status} />;
}
window.start = async options => {
  config = options;
  const sessions = localStorageSessionStore(); await keepSession(options.url, options.session, sessions);
  const device = options.tier === "wasm" ? webDevice() : options.tier === "process" ? {
    async open(name, backend) { const index = await window.deviceOpen(name, backend); return { call: request => window.deviceCall(index, request), close: () => window.deviceClose(index) }; }
  } : undefined;
  const clientOptions = { url: options.url, sessionStore: sessions, device, assets: { keep: "viewed", maxBytes: 67108864 },
    fetch: async (input, init) => { const response = await fetch(input, init); if (new URL(input).pathname.startsWith("/assets/")) requests.push({ path: new URL(input).pathname, status: response.status }); return response; } };
  if (options.tier === "process") {
    const client = await createLocalClient({ ...clientOptions, session: options.session });
    app = { client, close: () => client.close() };
  } else {
    app = createApp(clientOptions);
    const result = await app.ready; if (!result.ok) throw Error(JSON.stringify(result));
  }
  root = createRoot(document.getElementById("root"));
  const content = <><Chat scope="dm" conversation={options.dm} /><Chat scope="group" conversation={options.group} /><Feed /><Inbox /><Probe /></>;
  root.render(options.tier === "process" ? <SnapbackProvider client={app.client}>{content}</SnapbackProvider> : <AppProvider app={app}>{content}</AppProvider>);
};
window.diagnostics = () => ({ tier: config.tier, requests, snapshots, counts: ["dm", "group", "feed", "inbox"].map(scope => ({ scope, ready: [...document.querySelectorAll('[data-scope="' + scope + '"]')].filter(n => n.dataset.status === "ready").length })) });
window.images = principal => {
  const nodes = [...document.querySelectorAll('[data-principal="' + principal + '"]')];
  return { id: nodes[0]?.dataset.asset, ready: nodes.every(n => n.dataset.asset === nodes[0].dataset.asset && n.dataset.status === "ready" && n.querySelector("img")?.naturalWidth > 0), urls: nodes.map(n => n.querySelector("img")?.src).filter(Boolean) };
};
window.readAsset = async id => {
  const read = await app.client.asset(id);
  if ("denied" in read) return read;
  const bytes = (await (await fetch(read.url)).blob()).size; read.revoke();
  return { ready: true, bytes };
};
window.signOut = () => app.auth ? app.auth.logout() : app.client.signOut();
window.finish = async () => { root.unmount(); await app.close(); };
`;

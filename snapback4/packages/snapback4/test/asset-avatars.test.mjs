import { createBrowserServer, loadBrowserPage } from './helpers/browser-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
// Calibration #26's exact Quarry program and query/useAsset patterns, on the public package entries.
// @ref LLP 3000.008.002.000#6 — author avatars keep profile authority across message/feed observations.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { processDevice } from "../dist/native.js";
import { createClient, mintId } from "../dist/client.js";
import { login } from "../dist/auth.js";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { chromiumExecutable } from "../../../witness/lib.mjs";
import { binary } from "./helpers/app-server.mjs";
import { avatarFixture } from "./helpers/avatar-fixture.mjs";

const root = resolve(import.meta.dirname, "../../..");
const clientDir = process.env.AV_CLIENT_DIR ?? join(root, "packages/snapback4/dist");

for (const duplicate of [false, true]) for (const shape of ['mutable', 'sealed', 'frozen']) test(`Expo conversion refusal keeps the local client online (${duplicate ? 'duplicate Blob' : 'native store'}, ${shape})`, async t => {
  const { nativeBlobHost, expoBlobResponse } = await import('./helpers/native-blob.mjs');
  const f = await avatarFixture(t), host = nativeBlobHost(), links = [];
  const expo = expoBlobResponse(host, { duplicate, convert: async () => { throw Error('native conversion unavailable'); } });
  let requests = 0;
  const client = await createLocalClient({ url: f.url, session: f.users.bob.session,
    device: processDevice({ binary, dir: join(f.dir, 'native-conversion') }),
    fetch: async (url, init) => {
      if (new URL(url).pathname.startsWith('/assets/')) {
        requests++; const reply = expo.response();
        return shape === 'frozen' ? Object.freeze(reply) : shape === 'sealed' ? Object.seal(reply) : reply;
      }
      return fetch(url, init);
    },
  });
  t.after(() => client.close()); await client.sync();
  client.onLink(link => links.push(link));
  t.mock.property(globalThis, 'Blob', host.Blob);
  const result = await client.asset(f.users.alice.avatar.id);
  assert.equal(result.denied.code, 'E_CLIENT');
  assert.equal(requests, 1); assert.equal(expo.counts.reads, 1);
  assert.equal(client.link(), 'online'); assert.ok(!links.includes('offline'), JSON.stringify(links));
});

test('completed ordinary and once bytes survive rotation; new local downloads await its bearer', { timeout: hangBudget(28) }, async t => {
  const f = await avatarFixture(t);
  for (const tier of ['online', 'process', 'wasm']) await t.test(tier, async t => {
    const signed = await login(f.url, 'bob@avatars.test', 'password-avatars'); assert.equal(signed.ok, true);
    let unblockBody, unblockRefresh, bodyEntered, refreshEntered, holdingBody = false, holdingRefresh = false;
    let bodyGate, refreshGate; const assetCalls = [];
    const options = { url: f.url, session: signed.session, assets: { keep: 'viewed', maxBytes: 1000000 }, fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path.startsWith('/assets/')) assetCalls.push({ path, bearer: new Headers(init.headers).get('authorization'), range: new Headers(init.headers).get('range') });
      const response = await fetch(url, init);
      if (holdingBody && path.startsWith('/assets/') && response.ok) { bodyEntered(); await bodyGate; }
      if (holdingRefresh && path === '/auth/refresh') { refreshEntered(); await refreshGate; }
      return response;
    } };
    const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options,
      device: tier === 'process' ? processDevice({ binary, dir: join(f.dir, 'completed-rotation') }) : webDevice({ wasm: readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')), persist: memoryPersistence() }),
    });
    t.after(async () => { unblockBody?.(); unblockRefresh?.(); await client.close(); });
    await client.sync?.();
    for (const once of [false, true]) {
      const photo = once ? await f.upload(f.users.alice.client) : f.users.alice.avatar;
      if (once) await f.write(f.users.alice.client, 'messaging.send', { conversation: f.dm, id: mintId(), text: 'rotate once', quote: null, photo: null, video: null, oncePhoto: { id: photo.id } });
      const entered = new Promise(resolve => { bodyEntered = resolve; });
      bodyGate = new Promise(resolve => { unblockBody = resolve; }); holdingBody = true;
      const start = assetCalls.length, reading = client.asset(photo.id);
      await entered;
      let rotation;
      if (once) {
        const refreshing = new Promise(resolve => { refreshEntered = resolve; });
        refreshGate = new Promise(resolve => { unblockRefresh = resolve; }); holdingRefresh = true;
        rotation = client.refreshSession(); await refreshing;
      } else assert.equal((await client.refreshSession()).ok, true);
      holdingBody = false; unblockBody();
      const read = await reading;
      if (once) { holdingRefresh = false; unblockRefresh(); assert.equal((await rotation).ok, true); }
      assert.ok('url' in read, JSON.stringify({ tier, once, read }));
      assert.ok((await (await fetch(read.url)).arrayBuffer()).byteLength > 0); read.revoke();
      assert.equal(assetCalls.length - start, once ? 2 : 1, 'completed bytes never require a replay');
      if (once) assert.equal((await client.asset(photo.id)).denied.code, 'E_ASSET_VIEWED');
    }
    if (tier === 'online') return;
    const held = await client.asset(f.users.alice.avatar.id); assert.ok('url' in held); t.after(() => held.revoke());
    const before = await (await fetch(held.url)).arrayBuffer();
    const entered = new Promise(resolve => { refreshEntered = resolve; });
    refreshGate = new Promise(resolve => { unblockRefresh = resolve; }); holdingRefresh = true;
    const refresh = client.refreshSession(); await entered;
    const start = assetCalls.length, reading = client.asset(f.users.alice.avatar.id);
    await new Promise(resolve => setTimeout(resolve, 30));
    const sentDuringRefresh = assetCalls.length - start;
    holdingRefresh = false; unblockRefresh(); assert.equal((await refresh).ok, true);
    const read = await reading;
    assert.equal(sentDuringRefresh, 0, 'no old bearer is dispatched while its successor is withheld');
    assert.ok('url' in read, JSON.stringify(read)); read.revoke();
    assert.equal(assetCalls.at(-1).bearer, 'Bearer ' + client.session().token);
    assert.deepEqual(await (await fetch(held.url)).arrayBuffer(), before, 'rotation never invalidates the retained handle');
  });
});

test('local queue saturation keeps link and retained media live', { timeout: hangBudget(15) }, async t => {
  const f = await avatarFixture(t);
  for (const tier of ['process', 'wasm']) await t.test(tier, async t => {
    const signed = await login(f.url, 'bob@avatars.test', 'password-avatars'); assert.equal(signed.ok, true);
    let blockers = 0, failSocket = false; const links = [], streams = [];
    const client = await createLocalClient({ url: f.url, session: signed.session, assets: { keep: 'viewed', maxBytes: 1000000 },
      device: tier === 'process' ? processDevice({ binary, dir: join(f.dir, 'queue-link') }) : webDevice({ wasm: readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')), persist: memoryPersistence() }),
      fetch: async (url, init) => {
        if (new URL(url).pathname === '/assets/blocker') { blockers++; return new Response(new ReadableStream({ start(stream) { streams.push(stream); } })); }
        if (failSocket && new URL(url).pathname.startsWith('/assets/')) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
        return fetch(url, init);
      },
    });
    t.after(() => client.close()); await client.sync();
    const held = await client.asset(f.users.alice.avatar.id); assert.ok('url' in held); t.after(() => held.revoke());
    const before = await (await fetch(held.url)).arrayBuffer(); client.onLink(link => links.push(link));
    const pending = Array.from({ length: 6 }, () => client.asset('blocker'));
    while (blockers !== 6) await new Promise(resolve => setTimeout(resolve, 1));
    // Compress only the SDK admission timer, keeping real servers/devices and
    // body timers. Exact thirty-second accounting is checked in asset-retry.
    const realTimeout = globalThis.setTimeout;
    const timer = t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => realTimeout(fn, ms === 30000 ? 20 : ms, ...args));
    const refused = await client.asset(f.users.alice.avatar.id); timer.mock.restore();
    const observed = { link: client.link(), links: [...links] };
    assert.equal(observed.link, 'online'); assert.ok(!observed.links.includes('offline'), JSON.stringify(observed));
    assert.equal(refused.denied.code, 'E_CLIENT'); assert.equal(refused.denied.retryable, true);
    assert.deepEqual(await (await fetch(held.url)).arrayBuffer(), before);
    for (const stream of streams) stream.close();
    for (const read of await Promise.all(pending)) if ('url' in read) read.revoke();
    failSocket = true;
    const retained = await client.asset(f.users.alice.avatar.id);
    assert.ok(links.includes('offline'), 'an actual socket reset still marks transport offline');
    assert.ok('url' in retained, JSON.stringify(retained)); retained.revoke();
    await client.close();
  });
});

test('queued local avatars survive credential rotation without invalidating retained handles', { timeout: hangBudget(19) }, async t => {
  const fixture = await avatarFixture(t);
  for (const tier of ['process', 'wasm']) await t.test(tier, async t => {
    const signed = await login(fixture.url, 'bob@avatars.test', 'password-avatars'); assert.equal(signed.ok, true);
    let unblock, blocked = 0, queued = false, core;
    const gate = new Promise(resolve => { unblock = resolve; });
    const assetBearers = [];
    const device = tier === 'process' ? processDevice({ binary, dir: join(fixture.dir, 'rotation') }) : webDevice({ wasm: readFileSync(join(root, 'packages/snapback4/src/wasm/snapback4_device_bg.wasm')), persist: memoryPersistence() });
    const client = await createLocalClient({ url: fixture.url, session: signed.session,
      device: { open: async (...args) => (core = await device.open(...args)) },
      assets: { keep: 'viewed', maxBytes: 1000000 },
      fetch: async (url, init) => {
        if (new URL(url).pathname === '/assets/blocker') {
          blocked++; await gate;
          return Response.json({ denied: { code: 'E_RULE', family: 'rule', message: 'test blocker finished' } }, { status: 403 });
        }
        if (queued && new URL(url).pathname.startsWith('/assets/')) assetBearers.push(new Headers(init.headers).get('authorization'));
        return fetch(url, init);
      },
    });
    t.after(async () => { unblock(); await client.close(); });
    await client.sync();
    const id = fixture.users.alice.avatar.id;
    const held = await client.asset(id); assert.ok('url' in held, JSON.stringify(held));
    const manifest = JSON.parse((await core.call({ op: 'meta', key: 'media:manifest' })).ok);
    assert.ok(manifest.some(entry => entry.id === id && entry.confirmed), 'start with retained, receipt-confirmed bytes');
    const before = await (await fetch(held.url)).arrayBuffer();
    const blockers = Array.from({ length: 6 }, () => client.asset('blocker'));
    while (blocked < 6) await new Promise(resolve => setTimeout(resolve, 1));
    queued = true;
    const pending = Array.from({ length: 34 }, () => client.asset(id));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(assetBearers.length, 0, 'all 34 avatar calls wait behind six active transfers');
    assert.equal((await client.refreshSession()).ok, true);
    const next = client.session().token; assert.notEqual(next, signed.session.token);
    unblock(); await Promise.all(blockers);
    const reads = await Promise.all(pending);
    try {
      assert.equal(reads.filter(read => 'url' in read).length, 34, JSON.stringify(reads));
      assert.deepEqual(assetBearers, Array(34).fill('Bearer ' + next));
      assert.deepEqual(await (await fetch(held.url)).arrayBuffer(), before, 'rotation never revokes a retained live handle');
    } finally { held.revoke(); for (const read of reads) if ('url' in read) read.revoke(); }
  });
});

test("message authors and feed avatars share ordinary home-row authority", { timeout: hangBudget(54) }, async t => {
  const fixture = await avatarFixture(t);
  const require = createRequire(join(root, "packages/snapback4/package.json"));
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");

  const temporary = mkdtempSync(join(tmpdir(), "sb4-avatar-react-"));
  let server, browser;
  t.after(async () => { await browser?.close(); await server?.close(); rmSync(temporary, { recursive: true, force: true }); });
  writeFileSync(join(temporary, "index.html"), '<!doctype html><div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(temporary, "harness.jsx"), harness);
  server = await createBrowserServer({ root: temporary, configFile: false, logLevel: "error",
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
  browser = await chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ["--no-sandbox"] });
  for (const tier of ["online", "process", "wasm"]) await t.test(tier, async t => {
    const page = await browser.newPage();
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget());
    const devices = [], errors = [];
    t.after(async () => { await page.close(); for (const d of devices) await d.close(); });
    page.on("pageerror", error => errors.push(String(error)));
    const opener = processDevice({ binary, dir: join(fixture.dir, tier) });
    await page.exposeFunction("deviceOpen", async (name, backend) => { devices.push(await opener.open(name, backend)); return devices.length - 1; });
    await page.exposeFunction("deviceCall", (index, request) => devices[index].call(request));
    await page.exposeFunction("deviceClose", index => devices[index].close());
    await loadBrowserPage(t, page, server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.start);
    const signedIn = await login(fixture.url, "bob@avatars.test", "password-avatars"); assert.equal(signedIn.ok, true);
    await page.evaluate(options => window.start(options), { tier, url: fixture.url, session: signedIn.session, dm: fixture.dm, group: fixture.group, faultControl: !!process.env.AV_FAULT_CONTROL });
    {
      await page.waitForFunction(() => ["dm", "group", "feed", "inbox"].every(scope => window.diagnostics().counts.find(c => c.scope === scope).ready === (scope === "inbox" ? 2 : 20)));
      const faultId = await page.evaluate(principal => window.images(principal).id, fixture.users.alice.session.principal);
      for (const mode of ["reset", "overload", "timeout", "burst", ...(process.env.AV_FAULT_CONTROL ? [] : ["exhaust"])]) {
        const state = await page.evaluate(({ id, mode }) => window.faultProbe(id, mode), { id: faultId, mode });
        t.diagnostic(JSON.stringify({ tier, mode, ...state }));
        if (!process.env.AV_FAULT_CONTROL) {
          if (mode === "burst") { assert.equal(state.ready, 40); assert.equal(state.peak, 6); assert.equal(state.rejected, 0); }
          else if (mode === "exhaust") {
            assert.equal(state.state.status, "error"); assert.equal(state.state.why.code, "E_OFFLINE"); assert.equal(state.calls, 4);
            assert.equal((await page.evaluate(() => window.recoverProbe())).status, "ready", "exhausted hook recovers on reconnect/refocus");
          } else { assert.equal(state.state.status, "ready"); assert.equal(state.calls, 2); }
        }
      }
      if (process.env.AV_FAULT_CONTROL) { await page.evaluate(() => window.finish()); return; }
    }
    try {
      await page.waitForFunction(() => ["dm", "group", "feed", "inbox"].every(scope => {
        const nodes = [...document.querySelectorAll(`[data-scope="${scope}"]`)];
        return nodes.length === (scope === "inbox" ? 2 : 20) && nodes.every(n => n.dataset.status === "ready" && n.querySelector("img")?.naturalWidth > 0);
      }), null, { timeout: hangBudget() });
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
import { waitFor as awaitState } from '/@fs/${new URL('./helpers/wait.mjs', import.meta.url).pathname}';
import { createRoot } from "react-dom/client";
import { AppProvider, SnapbackProvider, useQuery, usePage, useAsset, useViewer } from "snapback4/react";
import { createApp } from "snapback4/app";
import { createLocalClient } from "snapback4/local";
import { keepSession, localStorageSessionStore } from "snapback4/auth";
import { webDevice } from "snapback4/web";
const q = name => ({ kind: "query", name });
const profileById = q("profileById"), history = q("messaging.history"), global = q("social.global"), inbox = q("messaging.inbox");
const snapshots = {}, requests = [];
let app, root, config, fault, inFlight = 0, peak = 0, rejected = 0, faultCalls = 0;
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
  const clientOptions = { url: options.url, sessionStore: sessions, device, assets: { keep: "none", maxBytes: 0 },
    fetch: async (input, init) => {
      const asset = new URL(input).pathname.startsWith("/assets/");
      if (!asset || !fault) return fetch(input, init);
      faultCalls++;
      if (fault === "exhaust" || fault === "reset" && faultCalls === 1) throw new TypeError("injected ECONNRESET");
      // Headers arrive but the body never progresses. Opaque fetch deadlines
      // are size-based and exercised with virtual time in asset-retry.test.
      if (fault === "timeout" && faultCalls === 1) return new Response(new ReadableStream(), { headers: { "content-type": "image/png", "accept-ranges": "bytes" } });
      if (fault === "overload" && faultCalls === 1 || fault === "burst" && inFlight >= 6) { rejected++; return Response.json({ denied: { code: "E_RATE_LIMIT", family: "limit", message: "injected six-connection cap", retryable: true } }, { status: 503, headers: { "Retry-After": "0.1" } }); }
      inFlight++; peak = Math.max(peak, inFlight);
      try { if (fault === "burst") await new Promise(r => setTimeout(r, 100)); return await fetch(input, init); }
      finally { inFlight--; }
    } };
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
window.faultProbe = async (id, mode) => {
  window.probe(null); if (app.client.sync) await app.client.sync();
  await new Promise(r => setTimeout(r, 100));
  fault = mode; faultCalls = peak = rejected = 0;
  if (mode === "burst") {
    const results = await Promise.all(Array.from({ length: 40 }, () => window.readAsset(id)));
    fault = null; return { ready: results.filter(r => r.ready).length, denied: results.filter(r => r.denied).map(r => r.denied.code), calls: faultCalls, peak, rejected };
  }
  window.probe(id);
  if (config.faultControl) await new Promise(r => setTimeout(r, mode === "timeout" ? 31000 : 3000));
  else {
    await awaitState(() => window.probeState.status === (mode === "exhaust" ? "error" : "ready"), "asset probe outcome");
  }
  const state = window.probeState; fault = null; if (mode !== "exhaust") window.probe(null);
  return { state, calls: faultCalls };
};
window.recoverProbe = async () => {
  if (app.client.sync) await app.client.sync();
  window.dispatchEvent(new Event("focus"));
  await awaitState(() => window.probeState.status === "ready", "asset recovery");
  const state = window.probeState; window.probe(null); return state;
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

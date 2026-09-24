// Real React subscriptions over the server and the wasm/IndexedDB web device.
// Holding /changes excludes server sweeps as a source of invalidation.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromiumExecutable, devServer, root } from "../../../witness/lib.mjs";

const source = `table typing:
  conversationId: conversations
  principal: principal
  expiresAt: time
  unique conversationId, principal
  cap 50 by conversationId
  expire at .expiresAt
  read <- exists memberships[.conversationId, viewer]
  sync to memberships[.conversationId]
query typingNow(conversationId: conversations):
  return typing where .conversationId = conversationId
`;

for (const age of [0, 3000]) test(`useQuery expires 4.5 s typing rows aged ${age} ms before mount on both clients`, { timeout: 30_000 }, async t => {
  let executablePath;
  try { executablePath = chromiumExecutable(); }
  catch (error) { t.skip(`Chromium unavailable: ${error.message}`); return; }
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  const require = createRequire(join(root, "packages/snapback4/package.json"));
  const { createServer } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
  const temporary = mkdtempSync(join(tmpdir(), "sb4-typing-"));
  let server, browser, dev;
  try {
    dev = await devServer({ extraSource: source, seed: [
      { table: "conversations", row: { id: "room", title: "Typing", creatorId: "dev:alice" } },
      { table: "memberships", row: { id: "member", conversationId: "room", principal: "dev:alice", role: "admin", joinedAt: 1 } },
    ] });
    assert.equal(dev.seeded, 2);
    writeFileSync(join(temporary, "index.html"), '<!doctype html><div id="app"></div><script type="module" src="/harness.jsx"></script>');
    writeFileSync(join(temporary, "harness.jsx"), harness);
    server = await createServer({ root: temporary, configFile: false, logLevel: "error",
      server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary] } },
      resolve: { alias: [
        { find: /^react$/, replacement: require.resolve("react") },
        { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
        { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
        ...["react", "client", "local", "web"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === "react" ? "tsx" : "ts"}`) })),
      ] },
    });
    await server.listen();
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => typeof window.openClients === "function");
    await page.evaluate(url => window.openClients(url), dev.api);
    const expiresAt = Date.now() + 4500;
    const seeded = await fetch(`${dev.api}/seed`, { method: "POST", body: JSON.stringify([
      { table: "typing", row: { id: "typing", conversationId: "room", principal: "dev:alice", expiresAt } },
    ]) }).then(r => r.json());
    assert.equal(seeded.seeded, 1, JSON.stringify(seeded));
    // Different remaining lifetimes plus the no-early-evaluation assertion
    // below reject a fixed mount delay, including periodic fixed-delay polling.
    if (age) await page.waitForTimeout(age);
    await page.evaluate(() => window.mount());
    await page.waitForFunction(() => ["online", "local"].every(tier => window.visibleAt[tier] != null));
    const deadline = expiresAt + 1000;
    await page.waitForFunction(() => ["online", "local"].every(tier => window.expiredAt[tier] != null));
    const result = await page.evaluate(() => ({ reads: window.reads, requests: window.requests, mountedAt: window.mountedAt,
      visibleAt: window.visibleAt, expiredAt: window.expiredAt, evaluations: window.evaluations, rendered: document.getElementById("app").textContent }));
    // Measure the React render, not when the runner receives a browser IPC reply.
    for (const tier of ["online", "local"]) {
      assert.ok(result.visibleAt[tier] < expiresAt, `${tier} renders the live row first`);
      const early = result.evaluations[tier].filter(at => at > result.visibleAt[tier] + 100 && at < expiresAt - 20);
      assert.deepEqual(early, [], `${tier} must schedule the row deadline, not poll before it`);
      assert.ok(result.expiredAt[tier] >= expiresAt && result.expiredAt[tier] <= deadline,
        `${tier} must render expiry at the row's deadline: ${JSON.stringify(result)}`);
    }
    if (age) assert.ok(deadline < result.mountedAt + 2900, "the aged row must also reject a fixed 2.9-second delay");
    assert.equal(result.reads.local.fresh, false, "expiry is evaluated while offline");
    assert.equal(result.reads.online.fresh, true);
    assert.ok(result.requests.queries >= 2, "the online timer must refetch without /changes");
    assert.equal(result.requests.localQueries, 0, "the web observation must run on the device");
    assert.equal(result.rendered, "online:0local:0", "useQuery must update both DOM subtrees");
    assert.deepEqual(errors, []);
    t.diagnostic(`expiry ${expiresAt}; React expiry lateness online=${result.expiredAt.online - expiresAt} ms local=${result.expiredAt.local - expiresAt} ms; online queries ${result.requests.queries}`);
    await page.evaluate(() => window.closeClients());
  } finally {
    await browser?.close(); await server?.close(); await dev?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
});

const harness = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { SnapbackProvider, useQuery } from "snapback4/react";
import { createClient } from "snapback4/client";
import { createLocalClient } from "snapback4/local";
import { webDevice } from "snapback4/web";
const op = { kind: "query", name: "media.typingNow" };
let online, local, offline = false, root;
window.reads = {};
window.visibleAt = {};
window.expiredAt = {};
window.evaluations = { online: [], local: [] };
window.requests = { queries: 0, localQueries: 0 };
const transport = tier => async (input, init) => {
  const path = new URL(input).pathname;
  if (path.startsWith("/q/")) {
    window.requests[tier === "local" ? "localQueries" : "queries"]++;
    window.evaluations[tier].push(Date.now());
  }
  if (tier === "local" && offline) throw new TypeError("offline witness");
  if (path === "/changes") return new Promise((_, reject) => {
    if (init?.signal?.aborted) reject(init.signal.reason);
    else init?.signal?.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  return fetch(input, init);
};
window.openClients = async url => {
  online = createClient({ url, persona: "alice", fetch: transport("online") });
  const device = webDevice();
  local = await createLocalClient({ url, persona: "alice", fetch: transport("local"), device: {
    open: async (...args) => {
      const core = await device.open(...args);
      return { ...core, call: (request, ...rest) => {
        if (request.op === "query") window.evaluations.local.push(Date.now());
        return core.call(request, ...rest);
      } };
    },
  } });
};
function Probe({ tier }) {
  const read = useQuery(op, { conversationId: "room" });
  if (read.data?.length === 1) window.visibleAt[tier] ??= Date.now();
  if (window.visibleAt[tier] != null && read.data?.length === 0) window.expiredAt[tier] ??= Date.now();
  window.reads[tier] = read;
  return h("span", null, tier + ":" + (read.data?.length ?? "loading"));
}
window.mount = async () => {
  await local.sync();
  offline = true;
  await local.sync();
  window.mountedAt = Date.now();
  root = createRoot(document.getElementById("app"));
  root.render(h("div", null,
    h(SnapbackProvider, { client: online }, h(Probe, { tier: "online" })),
    h(SnapbackProvider, { client: local }, h(Probe, { tier: "local" }))));
};
window.closeClients = async () => { root.unmount(); await Promise.all([online.close(), local.close()]); };
`;

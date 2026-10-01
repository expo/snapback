import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000#publication-suite-under-contention — preserve semantics independently of host scheduling.
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

// One minute each for startup, mount, expiry delivery and cleanup. The 4.5 s
// row lifetime below uses the controlled browser clock, not this hang guard.
for (const age of [0, 3000]) test(`useQuery expires 4.5 s typing rows aged ${age} ms before mount on both clients`, { timeout: hangBudget(28) }, async t => {
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
      // Observe actual expiry callbacks, including callbacks that merely check
      // the deadline and rearm without evaluating a query. Keep the real timer,
      // callback, delay and cancellation; this instrumentation changes no clock.
      plugins: [{ name: "observe-expiry-wakeups", enforce: "pre", transform(code, id) {
        if (id.split("?")[0] !== join(root, "packages/snapback4/src/read-expiry.ts")) return;
        const needle = "watch.expiryTimer = setTimeout(";
        assert.equal(code.split(needle).length, 2, "instrument exactly the expiry timer");
        return code.replace(needle, "watch.expiryTimer = window.observeExpiryTimer(watch, deadlines, setTimeout, ");
      } }],
      // The temporary root has no package manifest. Prebundle its known CJS
      // dependencies up front so late discovery cannot reload open clients.
      optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client"] },
      // This fixture is immutable: development reloads must not replace the
      // browsing context while the real deadline assertions are running.
      server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [root, temporary] } },
      resolve: { alias: [
        { find: /^react$/, replacement: require.resolve("react") },
        { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
        { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve("react/jsx-dev-runtime") },
        { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
        ...["react", "client", "local", "web"].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === "react" ? "tsx" : "ts"}`) })),
      ] },
    });
    await server.listen();
    browser = await chromium.launch({ timeout: hangBudget(), executablePath, headless: true });
    const page = await browser.newPage();
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget());
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // Separate process/browser startup from the 4.5-second semantic deadline.
    // The browser owns its scheduling clock; the real server is advanced only
    // after the pre-expiry assertions, with its supported dev clock control.
    const start = Date.now() + 3_600_000;
    await page.clock.install({ time: start - 60_000 });
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => typeof window.openClients === "function");
    await page.clock.pauseAt(start);
    const until = async predicate => {
      return awaitState(async () => {
        await page.clock.runFor(0);
        return page.evaluate(predicate);
      }, `browser state did not settle: ${predicate}`);
    };
    await page.evaluate(url => window.openClients(url), dev.api);
    const expiresAt = start + 4500;
    const seeded = await fetch(`${dev.api}/seed`, { method: "POST", body: JSON.stringify([
      { table: "typing", row: { id: "typing", conversationId: "room", principal: "dev:alice", expiresAt } },
    ]) }).then(r => r.json());
    assert.equal(seeded.seeded, 1, JSON.stringify(seeded));
    // Different remaining lifetimes reject a fixed mount delay. The callback
    // instrumentation below also rejects polling that performs no early query.
    if (age) await page.clock.runFor(age);
    await page.evaluate(() => window.mount());
    await until(() => ["online", "local"].every(tier => window.visibleAt[tier] != null));
    await page.clock.runFor(4500 - age - 1);
    assert.deepEqual(await page.evaluate(() => ["online", "local"].map(tier => window.reads[tier].data?.length)), [1, 1],
      "both clients retain the live row until its exact deadline");
    const advanced = await fetch(`${dev.api}/dev/clock/advance`, { method: "POST", body: JSON.stringify({ duration: "2h" }) }).then(r => r.json());
    assert.equal(advanced.advancedMs, 7_200_000);
    await page.clock.runFor(1001);
    const deadline = expiresAt + 1000;
    // Online invalidation publishes loading, so a later IPC read can sample a
    // different render. Capture both ready expiry answers in the same browser
    // turn; the first expiry timestamps still enforce the original deadline.
    const result = await until(() => {
      if (!["online", "local"].every(tier => window.expiredAt[tier] != null && window.reads[tier]?.data?.length === 0)) return false;
      return { reads: { ...window.reads }, requests: { ...window.requests }, mountedAt: window.mountedAt,
        visibleAt: { ...window.visibleAt }, expiredAt: { ...window.expiredAt }, evaluations: structuredClone(window.evaluations),
        expiryWakeups: structuredClone(window.expiryWakeups),
        rendered: document.getElementById("app").textContent };
    });
    assert.deepEqual(result.expiryWakeups.filter(wake => wake.at < expiresAt), [],
      "expiry timers must not wake to poll before the row deadline");
    for (const tier of ["online", "local"]) {
      assert.ok(result.expiryWakeups.some(wake => wake.tier === tier && wake.at >= expiresAt && wake.at <= deadline),
        `${tier} expiry callback must be observed at the deadline: ${JSON.stringify(result.expiryWakeups)}`);
    }
    // Measure React renders in the controlled clock, never browser IPC latency.
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
    // Teardown joins the real background loops, including a one-second retry
    // already asleep after the deliberately offline sync. Let that timer run.
    await page.clock.resume();
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
window.expiryWakeups = [];
window.observeExpiryTimer = (watch, deadlines, timer, callback, delay) => {
  const tier = deadlines.device === null ? "online" : "local";
  return timer(() => {
    window.expiryWakeups.push({ tier, at: Date.now(), deadlines });
    callback();
  }, delay);
};
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
  const response = await fetch(input, init);
  // Scheduling is under the browser clock. Do not sample the independent real
  // server clock into it; server clock estimation has its own skew tests.
  const headers = new Headers(response.headers);
  headers.delete("x-snapback-time"); headers.delete("x-snapback-clock");
  return new Response(response.body, { status: response.status, headers });
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

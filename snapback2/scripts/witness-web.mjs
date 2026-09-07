#!/usr/bin/env node
// The browser witness for LLP 1012 §10 (lane O2, scheduled, never blocking):
// real Chromium over the chat template's React screens and the IndexedDB
// carrier, driven through Playwright. It files nothing itself; the schedule
// that runs it turns a red into a bounded ticket.
//
// Run from `snapback2/` after `cargo build --workspace --bins` and
// `(cd packages/snapback2 && node build.mjs)`:
//
//   node scripts/witness-web.mjs            # Google Chrome via playwright-core's "chrome" channel
//   SNAPBACK2_WITNESS_BROWSER=/path/to/chromium node scripts/witness-web.mjs
//   node scripts/witness-web.mjs --sessions # LLP 1018 shared subscriptions and tab takeover only
//   node scripts/witness-web.mjs --keep     # leave the scratch project and profile behind
//
// playwright-core is an optional devDependency of packages/snapback2; when it
// is absent or no browser is found, this exits 2 with a one-line reason.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(workspace, "packages/snapback2");
const packageRequire = createRequire(resolve(packageRoot, "package.json"));
const { build } = packageRequire("esbuild");
const dist = resolve(packageRoot, "dist");
const binary = resolve(workspace, "target/debug/snapback2");
const keep = process.argv.includes("--keep");
const indexedSearchBody = "Café expires while offline";
const indexedSearchTerm = "CAFE\u0301";
const sessionsOnly = process.argv.includes("--sessions");
const steps = [];

function step(name, detail) {
  steps.push({ name, verdict: "pass", ...(detail === undefined ? {} : { detail }) });
  process.stdout.write(`ok   ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}\n`);
}

function fail(name, error) {
  steps.push({ name, verdict: "fail", detail: String(error?.stack ?? error) });
  process.stdout.write(`FAIL ${name}\n${String(error?.stack ?? error)}\n`);
}

function precondition(condition, message) {
  if (!condition) {
    process.stdout.write(`witness-web: ${message}\n`);
    process.exit(2);
  }
}

async function loadPlaywright() {
  try {
    return packageRequire("playwright-core");
  } catch {
    return undefined;
  }
}

function launchOptions() {
  const executablePath = process.env.SNAPBACK2_WITNESS_BROWSER;
  return executablePath ? { executablePath } : { channel: "chrome" };
}

async function bundleApp(url) {
  const out = await mkdtemp(join(tmpdir(), "snapback2-witness-app-"));
  // The witness entry wraps the template's App with the hooks the witness
  // needs: a barrier inside the IndexedDB swap, a transport fault list, and
  // the client on window for offline()/online(). It is written under the
  // package's dist/ so react resolves from the package's own node_modules.
  const entry = resolve(dist, ".witness-main.tsx");
  await writeFile(entry, `
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { indexedDbRangeStore, SnapbackProvider, useSnapbackClient } from "snapback2/react";
import { api } from "snapback2/client";
(window as any).__api = api;
import { App } from "${resolve(packageRoot, "templates/chat/react/src/App.tsx")}";

const faults: Array<{ path: string; status: number }> = ((window as any).__witnessFaults = []);
const requests: Array<Record<string, unknown>> = ((window as any).__witnessRequests = []);
const transport: typeof fetch = async (input, init) => {
  const started = Date.now();
  let response: Response;
  try { response = await fetch(input, init); }
  catch (error) { requests.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET", error: String(error), ms: Date.now() - started }); throw error; }
  const path = new URL(String(input)).pathname;
  requests.push({ path, method: init?.method ?? "GET", status: response.status, ms: Date.now() - started });
  const index = faults.findIndex((fault) => fault.path === path);
  if (index < 0) return response;
  const [fault] = faults.splice(index, 1);
  await response.arrayBuffer().catch(() => undefined);
  return new Response(JSON.stringify({ message: "injected " + fault!.status }), { status: fault!.status, headers: { "content-type": "application/json" } });
};
const offline = {
  store: indexedDbRangeStore({ beforeReplace: () => (window as any).__witnessBarrier?.() }),
  onTombstone: (item: { table: string; row: Record<string, unknown> }) =>
    item.table === "deliveries" && (item.row.kind === "removed" || item.row.kind === "expired") && typeof item.row.messageId === "string"
      ? [{ table: "messages", id: item.row.messageId }]
      : [],
};
function Expose() {
  const client = useSnapbackClient();
  useEffect(() => { (window as any).__snapback = client; }, [client]);
  return null;
}
createRoot(document.getElementById("root")!).render(
  <StrictMode><SnapbackProvider url=${JSON.stringify(url)} as="alice" fetch={transport} offline={offline}><Expose /><App /></SnapbackProvider></StrictMode>,
);
`);
  try {
    await build({
      absWorkingDir: packageRoot,
      entryPoints: [entry],
      outfile: resolve(out, "app.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      jsx: "automatic",
      // The client's native asset paths `import("expo/fetch")` and `import("expo-file-system")`
      // behind runtime guards; a web app's bundler leaves those unresolved packages external,
      // but here Expo is installed in the workspace and following it reaches React Native's
      // Flow-typed sources, which esbuild cannot parse. Keep the browser bundle web-only.
      external: ["expo", "expo/*", "expo-*", "react-native", "react-native/*"],
      define: { "import.meta.env.VITE_SNAPBACK_URL": JSON.stringify(url) },
      plugins: [{
        name: "package-dist",
        setup(plugin) {
          plugin.onResolve({ filter: /^snapback2\/(react|client)$/ }, (args) => ({ path: resolve(dist, `${args.path.slice("snapback2/".length)}.mjs`) }));
        },
      }],
    });
  } finally {
    await rm(entry, { force: true });
  }
  await writeFile(resolve(out, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>witness</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`);
  return out;
}

function serveStatic(root) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };
  const server = createServer(async (request, response) => {
    const path = request.url === "/" ? "/index.html" : request.url ?? "/index.html";
    try {
      const body = await readFile(resolve(root, `.${path}`));
      response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolveServer) => server.listen(0, "127.0.0.1", () => resolveServer(server)));
}

async function startOwner(project) {
  const env = {
    ...process.env,
    SNAPBACK2_COMPILER: resolve(dist, "compiler.mjs"),
    SNAPBACK2_GUIDE: resolve(dist, "guide"),
    SNAPBACK2_TEMPLATES: resolve(dist, "templates"),
    SNAPBACK2_TEST_RUNNER: resolve(dist, "test-runner.mjs"),
  };
  const init = spawnSync(binary, ["init", project, "--template", "chat", "--client", "react", "--json"], { env, encoding: "utf8" });
  precondition(init.status === 0, `snapback2 init failed: ${init.stdout}${init.stderr}`);
  const dev = spawnSync(binary, ["dev", "--project", project, "--json"], { env, encoding: "utf8" });
  precondition(dev.status === 0, `snapback2 dev failed: ${dev.stdout}${dev.stderr}`);
  const info = JSON.parse(await readFile(resolve(project, ".snapback/owner.json"), "utf8"));
  return {
    url: info.url,
    env,
    stop: () => spawnSync(binary, ["dev", "--project", project, "--stop", "--json"], { env, encoding: "utf8" }),
  };
}

async function seed(url) {
  const { createClient, api } = await import(resolve(dist, "client.mjs"));
  const alice = createClient({ url, as: "alice" });
  const bob = createClient({ url, as: "bob" });
  const bobPrincipal = (await bob.auth.me()).viewer;
  const group = await alice.mutation(api.groups.groupCreate, { title: "Witness room", members: [bobPrincipal] });
  if (group.state !== "committed") throw new Error(`group creation was ${group.state}`);
  const conversations = ["conversation-1", "conversation-2", group.data.id];
  for (const conversationId of conversations) {
    const posted = await alice.mutation(api.deliveries.post, { conversationId, body: `seeded in ${conversationId}` });
    if (posted.state !== "committed") throw new Error(`seed post was ${posted.state}`);
  }
  const doomed = await alice.mutation(api.deliveries.post, { conversationId: "conversation-1", body: indexedSearchBody });
  alice.close();
  bob.close();
  return { conversations, doomedMessageId: doomed.state === "committed" ? doomed.data.id : undefined };
}

async function openChat(page, conversationId) {
  await page.click(`nav[aria-label=Inbox] li[data-conversation="${conversationId}"] button`);
  await page.waitForSelector("section[aria-label=Thread] li[data-state=row]", { timeout: 10_000 });
}

// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — actual
// Chromium tabs, Web Locks, BroadcastChannel, IndexedDB, and the owner prove one queue.
async function sharedSessions(context, writer, appUrl, ownerUrl) {
  await writer.waitForFunction(async () => window.__snapback && (await window.__snapback.outbox.status()).ready,
    null, { timeout: 15_000 });
  const added = [];
  const replayed = [];
  context.on("request", (request) => {
    if (request.url() === ownerUrl + "/api/live/control") added.push(...(request.postDataJSON()?.add ?? []));
    if (request.url() === ownerUrl + "/api/mutation") replayed.push(request.postDataJSON());
  });
  const shared = await writer.evaluate(async () => {
    const client = window.__snapback;
    const op = window.__api.deliveries.thread;
    const args = { conversationId: "conversation-2", c: null };
    const first = client.subscribe(op, args, () => undefined);
    const second = client.subscribe(op, args, () => undefined);
    const [a, b] = await Promise.all([first.until(e => e.state === "complete", 5000), second.until(e => e.state === "complete", 5000)]);
    const two = client.sharedConsumers(op, args);
    first.close();
    const one = client.sharedConsumers(op, args);
    const survivor = await second.until(e => e.state === "complete", 5000);
    second.close();
    return { two, one, zero: client.sharedConsumers(op, args), seq: [a.seq, b.seq, survivor.seq], data: [a.data, b.data, survivor.data] };
  });
  assert.deepEqual([shared.two, shared.one, shared.zero], [2, 1, 0]);
  assert.equal(new Set(shared.seq).size, 1);
  assert.deepEqual(shared.data[0], shared.data[1]);
  assert.deepEqual(shared.data[0], shared.data[2]);
  const children = added.filter(child => child.path.includes("deliveries.thread"));
  assert.equal(children.length, 1, "duplicate app consumers add exactly one logical owner subscription");
  step("two app consumers share one logical owner subscription; closing one preserves the other", { consumers: [2, 1, 0], logicalSubscriptions: children.length });

  const follower = await context.newPage();
  await follower.goto(appUrl);
  await follower.waitForFunction(async () => window.__snapback
    && (await window.__snapback.outbox.status(window.__api.deliveries.post)).ready,
    null, { timeout: 15_000 });
  await openChat(follower, "conversation-1");
  const beforeWrites = replayed.length;

  // Cut only the writer's owner transport: the follower remains live. An actual
  // page close releases the browser-owned lock without calling client.close().
  await writer.bringToFront();
  await writer.waitForFunction(async () => (await window.__snapback.outbox.status(window.__api.deliveries.post)).ready, null, { timeout: 15_000 });
  const ownerOrigin = new URL(ownerUrl).origin;
  await writer.route(url => url.origin === ownerOrigin, route => route.abort("connectionrefused"));
  step("writer readiness before going offline", await writer.evaluate(async () => ({ status: await window.__snapback.outbox.status(), post: await window.__snapback.outbox.status(window.__api.deliveries.post), entries: await window.__snapback.outbox.entries() })));
  await writer.evaluate(() => window.__snapback.offline());
  step("writer readiness after going offline", await writer.evaluate(async () => ({ status: await window.__snapback.outbox.status(), post: await window.__snapback.outbox.status(window.__api.deliveries.post) })));
  const writerFirst = await writer.evaluate(() => window.__snapback.mutation(window.__api.deliveries.post,
    { conversationId: "conversation-1", body: "1018 writer first" }));
  const followerMiddle = await follower.evaluate(() => window.__snapback.mutation(window.__api.deliveries.post,
    { conversationId: "conversation-1", body: "1018 follower middle" }));
  const writerSecond = await writer.evaluate(() => window.__snapback.mutation(window.__api.deliveries.post,
    { conversationId: "conversation-1", body: "1018 writer second" }));
  const queued = [writerFirst, followerMiddle, writerSecond];
  assert.deepEqual(queued.map(row => row.state), ["queued", "queued", "queued"]);
  assert.equal(replayed.length, beforeWrites, "writer-local and forwarded offline admission send no owner mutation bytes");
  assert.deepEqual(await writer.evaluate(async () => (await window.__snapback.outbox.entries()).map(entry => entry.intent)),
    queued.map(row => row.intent), "both tabs enter one durable writer-admission order");
  step("both tabs durably enqueue through the one offline writer", {
    origins: ["writer", "follower", "writer"], intents: queued.map(row => row.intent),
  });
  await writer.close();
  await follower.bringToFront();
  const replayDeadline = Date.now() + 15_000;
  while (replayed.slice(beforeWrites).filter(request => queued.some(row => row.intent === request.replay?.intent)).length < 3
    && Date.now() < replayDeadline) await follower.waitForTimeout(100);
  step("takeover observation", await follower.evaluate(async () => ({ status: await window.__snapback.outbox.status(), entries: await window.__snapback.outbox.entries() })));
  await follower.waitForFunction(async () => (await window.__snapback.outbox.entries()).filter(e => e.state === "queued").length === 0, null, { timeout: 15_000 });
  await follower.evaluate(() => window.__snapback.outbox.settled());
  const inherited = replayed.slice(beforeWrites).filter(request => queued.some(row => row.intent === request.replay?.intent));
  assert.deepEqual(inherited.map(request => request.replay.intent), queued.map(row => row.intent), "inherited queue replays FIFO exactly once");
  const { createClient, api } = await import(resolve(dist, "client.mjs"));
  const verifier = createClient({ url: ownerUrl, as: "alice" });
  try {
    const thread = await verifier.query(api.deliveries.thread, { conversationId: "conversation-1", c: null });
    assert.equal(thread.state, "complete");
    const bodies = thread.data.map(row => row.message?.body);
    for (const body of ["1018 writer first", "1018 follower middle", "1018 writer second"]) {
      assert.equal(bodies.filter(item => item === body).length, 1);
    }
    assert.ok(bodies.indexOf("1018 writer second") < bodies.indexOf("1018 follower middle")
      && bodies.indexOf("1018 follower middle") < bodies.indexOf("1018 writer first"),
    "newest-first owner rows preserve the durable cross-tab admission order");
  } finally { await verifier.close(); }
  const after = await follower.evaluate(() => window.__snapback.mutation(window.__api.deliveries.post,
    { conversationId: "conversation-1", body: "1018 new writer" }));
  assert.equal(after.state, "committed");
  step("closing the writer transfers its Web Lock and one cross-tab FIFO queue; the new writer commits", {
    replayIntents: inherited.map(request => request.replay.intent), rowsPerIntent: 1,
  });
}

async function main() {
  precondition(spawnSync(binary, ["--version"]).status !== null, `${binary} is not built; run cargo build --workspace --bins`);
  const playwright = await loadPlaywright();
  precondition(playwright, "playwright-core is not installed; add it (optional devDependency of packages/snapback2) to run the witness");
  const project = await mkdtemp(join(tmpdir(), "snapback2-witness-project-"));
  const profile = await mkdtemp(join(tmpdir(), "snapback2-witness-profile-"));
  const owner = await startOwner(project);
  const seeded = await seed(owner.url);
  const appRoot = await bundleApp(owner.url);
  const server = await serveStatic(appRoot);
  const appUrl = `http://127.0.0.1:${server.address().port}/`;
  let context;
  const ownerOrigin = new URL(owner.url).origin;
  const cutOwner = (url) => url.origin === ownerOrigin;
  // `ownerCut` boots the app with the backend unreachable: the page still
  // loads from the witness's static server, every owner request is refused.
  const launch = async ({ ownerCut = false } = {}) => {
    context = await playwright.chromium.launchPersistentContext(profile, { ...launchOptions(), headless: true });
    if (ownerCut) await context.route(cutOwner, (route) => route.abort("connectionrefused"));
    const page = await context.newPage();
    page.on("pageerror", (error) => process.stdout.write(`page error: ${error}\n`));
    await page.goto(appUrl);
    return page;
  };
  const close = async () => { await context?.close().catch(() => undefined); context = undefined; };
  try {
    // Seed, drain, open three chats.
    let page = await launch();
    if (sessionsOnly) {
      await sharedSessions(context, page, appUrl, owner.url);
    } else {
    await page.waitForFunction(() => /log downloaded/.test(document.querySelector("[role=status][data-connection]")?.textContent ?? ""), null, { timeout: 15_000 });
    const [neverOpened, ...opened] = [...seeded.conversations].reverse();
    for (const conversationId of opened) await openChat(page, conversationId);
    const listed = await page.$$eval("nav[aria-label=Inbox] li", (nodes) => nodes.length);
    if (listed !== 3) throw new Error(`the inbox listed ${listed} chats`);
    step("seed, drain, and open three chats (two threads opened online, one left unopened)", { chats: listed, opened: opened.length });

    // The UI uses the real global indexed query. A decomposed uppercase token
    // finds the composed mixed-case word and records the exact prefix coverage.
    await page.fill("section[aria-label=Search] input", indexedSearchTerm);
    await page.waitForSelector(`section[aria-label=Search] li[data-message="${seeded.doomedMessageId}"]`, { timeout: 10_000 });
    await page.waitForFunction(() => {
      const state = document.querySelector("section[aria-label=Search] .scope")?.getAttribute("data-state");
      return state === "complete" || state === "capped";
    }, null, { timeout: 10_000 });
    const warmSearch = await page.$eval("section[aria-label=Search] .scope", (node) => ({ state: node.getAttribute("data-state"), text: node.textContent }));
    if (warmSearch.state !== "complete" && warmSearch.state !== "capped") throw new Error(`warm indexed search was ${JSON.stringify(warmSearch)}`);
    step("Unicode one-word prefix runs through the live messages.search index", warmSearch);

    // Enqueue one message while offline.
    await context.setOffline(true);
    await page.evaluate(() => window.__snapback.offline());
    await openChat(page, neverOpened);
    await page.fill("form[aria-label=Composer] input", "Café queued in the browser");
    // Report the composer's own reason when it will not send, instead of a bare click timeout.
    await page.waitForSelector("form[aria-label=Composer] button[type=submit]:enabled", { timeout: 10_000 }).catch(async (error) => {
      const diagnosis = await page.evaluate(async () => {
        const client = window.__snapback;
        const status = document.querySelector("form[aria-label=Composer] small[role=status]");
        let outbox;
        try { outbox = await client.outbox.status?.(); } catch (e) { outbox = String(e); }
        return { composer: status ? { waiting: status.getAttribute("data-waiting"), text: status.textContent } : null, snapshot: client.snapshot, outbox, entries: await client.outbox.entries?.() };
      }).catch((e) => String(e));
      throw new Error(`the composer would not send offline: ${JSON.stringify(diagnosis)}\n${error.message}`);
    });
    await page.click("form[aria-label=Composer] button[type=submit]");
    await page.waitForSelector("li[data-state=queued]", { timeout: 5_000 });
    const queued = await page.$eval("li[data-state=queued]", (node) => ({ id: node.getAttribute("data-message"), text: node.textContent }));
    if (!/Sending…/.test(queued.text ?? "") || /\d:\d\d/.test(queued.text ?? "")) throw new Error(`pending bubble text was ${queued.text}`);
    await page.waitForSelector(`section[aria-label=Search] li[data-message="${queued.id}"]`, { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector("section[aria-label=Search] .scope")?.getAttribute("data-state") === "held", null, { timeout: 10_000 });
    step("the mounted indexed search publishes the offline prediction", queued);

    // Kill the profile at rest, cold start with the backend unreachable.
    await close();
    page = await launch({ ownerCut: true });
    await openChat(page, neverOpened).catch(() => undefined);
    const coldQueued = await page.$(`li[data-state=queued][data-message="${queued.id}"]`);
    const coldInbox = await page.$$eval("nav[aria-label=Inbox] li", (nodes) => nodes.length);
    if (!coldQueued || coldInbox < 3) {
      const diagnosis = await page.evaluate(async () => {
        const client = window.__snapback;
        const inbox = await client.query(window.__api.deliveries.inbox, { c: null }).catch((e) => ({ threw: e?.envelope?.code ?? String(e) }));
        const rows = Array.isArray(inbox?.data) ? inbox.data : [];
        return { header: document.querySelector("[role=status][data-connection]")?.textContent, inbox: { state: inbox.state, connection: inbox.connection, threw: inbox.threw, rows: rows.length, conversations: [...new Set(rows.map((r) => r.conversationId))], caughtUp: inbox.caughtUp },
          snapshot: { connection: client.snapshot.connection, auth: client.snapshot.auth?.state }, outbox: (await client.outbox.entries()).map((e) => e.state), requests: window.__witnessRequests };
      }).catch((e) => String(e));
      throw new Error(`cold start held ${coldInbox} chats and queued=${Boolean(coldQueued)}: ${JSON.stringify(diagnosis)}`);
    }
    await page.fill("section[aria-label=Search] input", indexedSearchTerm);
    await page.waitForSelector(`section[aria-label=Search] li[data-message="${queued.id}"]`, { timeout: 10_000 });
    const coldSearch = await page.$eval("section[aria-label=Search] .scope", (node) => ({ state: node.getAttribute("data-state"), text: node.textContent }));
    if (coldSearch.state !== "held") throw new Error(`cold indexed search was ${JSON.stringify(coldSearch)}`);
    step("cold offline: a chat never opened online renders held rows and its prediction; indexed search agrees", { chats: coldInbox, search: coldSearch });

    // Carrier refused → E_OFFLINE_CARRIER.
    await close();
    context = await playwright.chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "snapback2-witness-nocarrier-")), { ...launchOptions(), headless: true });
    await context.addInitScript(() => { Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true }); });
    page = await context.newPage();
    await page.goto(appUrl);
    await page.waitForFunction(() => /E_OFFLINE_CARRIER/.test(document.body.textContent ?? ""), null, { timeout: 10_000 });
    step("boot with the carrier refused shows E_OFFLINE_CARRIER");
    await close();

    // Backend up: 503 after the first commit, kill mid-commit, exactly one row, second in order.
    page = await launch({ ownerCut: true });
    await page.evaluate(() => window.__snapback.offline());
    await openChat(page, neverOpened);
    await page.fill("form[aria-label=Composer] input", "second queued message");
    await page.click("form[aria-label=Composer] button[type=submit]");
    await page.waitForFunction(() => document.querySelectorAll("li[data-state=queued]").length === 2, null, { timeout: 5_000 });
    await context.unroute(cutOwner);
    await page.evaluate(() => { window.__witnessFaults.push({ path: "/api/mutation", status: 503 }); });
    await page.evaluate(() => window.__snapback.online());
    await page.evaluate(() => window.__snapback.outbox.settled());
    const afterFault = await page.$$eval("li[data-state=queued]", (nodes) => nodes.length);
    if (afterFault !== 2) throw new Error(`a 503 after the commit settled an intent (${afterFault} queued)`);
    // Kill the profile inside the settlement swap: the barrier holds the IndexedDB transaction open.
    await page.evaluate(() => { window.__witnessBarrier = () => new Promise(() => undefined); });
    const draining = page.evaluate(() => window.__snapback.outbox.drain()).catch(() => undefined);
    await page.waitForTimeout(500);
    await close();
    await draining;
    page = await launch();
    await page.evaluate(() => window.__snapback.outbox.settled());
    await page.evaluate(() => window.__snapback.outbox.drain());
    await openChat(page, neverOpened);
    await page.waitForFunction(() => document.querySelectorAll("li[data-state=queued]").length === 0, null, { timeout: 10_000 });
    const { createClient, api } = await import(resolve(dist, "client.mjs"));
    const verifier = createClient({ url: owner.url, as: "alice" });
    const thread = await verifier.query(api.deliveries.thread, { conversationId: neverOpened, c: null });
    verifier.close();
    const bodies = thread.data.map((row) => row.message?.body);
    const count = (body) => bodies.filter((item) => item === body).length;
    if (count("Café queued in the browser") !== 1 || count("second queued message") !== 1) throw new Error(`rows: ${JSON.stringify(bodies)}`);
    if (bodies.indexOf("second queued message") > bodies.indexOf("Café queued in the browser")) throw new Error("replay order was not preserved");
    step("503 after the commit and a kill inside the settlement swap: exactly one row each, in order");

    // Revocation received on resume invalidates the same persistent index trace.
    await page.fill("section[aria-label=Search] input", indexedSearchTerm);
    await page.waitForSelector(`section[aria-label=Search] li[data-message="${seeded.doomedMessageId}"]`, { timeout: 10_000 });
    await page.waitForFunction(() => {
      const state = document.querySelector("section[aria-label=Search] .scope")?.getAttribute("data-state");
      return state === "complete" || state === "capped";
    }, null, { timeout: 10_000 });
    await page.evaluate(() => window.__snapback.offline());
    const revoker = createClient({ url: owner.url, as: "alice" });
    const unsent = await revoker.mutation(api.deliveries.unsend, { messageId: seeded.doomedMessageId });
    revoker.close();
    if (unsent.state !== "committed") throw new Error(`unsend was ${unsent.state}`);
    await page.evaluate(() => window.__snapback.online());
    await page.waitForFunction(({ doomed, queued }) => {
      const ids = [...document.querySelectorAll("section[aria-label=Search] .hits li")].map((node) => node.getAttribute("data-message"));
      const state = document.querySelector("section[aria-label=Search] .scope")?.getAttribute("data-state");
      return !ids.includes(doomed) && ids.includes(queued) && (state === "complete" || state === "capped");
    }, { doomed: seeded.doomedMessageId, queued: queued.id }, { timeout: 10_000 });
    const heldAfterRevocation = await page.evaluate(async (term) => {
      await window.__snapback.offline();
      const result = await window.__snapback.query(window.__api.messages.search, { term, c: null });
      return { state: result.state, ids: Array.isArray(result.data) ? result.data.map((row) => row.id) : [] };
    }, indexedSearchTerm);
    if (heldAfterRevocation.state !== "held" || heldAfterRevocation.ids.includes(seeded.doomedMessageId)
      || !heldAfterRevocation.ids.includes(queued.id)) throw new Error(`held search after revocation: ${JSON.stringify(heldAfterRevocation)}`);
    step("revocation removes only the expired indexed row; the settled prediction remains in held Unicode search (LLP 1016 D5)");
    await page.evaluate(() => window.__snapback.online());

    await sharedSessions(context, page, appUrl, owner.url);
    }
  } catch (error) {
    fail("witness", error);
  } finally {
    await close();
    server.close();
    owner.stop();
    if (!keep) {
      await rm(project, { recursive: true, force: true });
      await rm(profile, { recursive: true, force: true });
      await rm(appRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`kept project ${project}, profile ${profile}, app ${appRoot}\n`);
    }
  }
  const failed = steps.filter((item) => item.verdict === "fail").length;
  process.stdout.write(`${JSON.stringify({ name: "witness-web", kind: "witness", verdict: failed === 0 ? "pass" : "fail", steps })}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();

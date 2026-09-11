#!/usr/bin/env node
// The browser witness for LLP 1012 §10 (lane O2, never blocking): real
// Chromium over the chat template's React screens and the IndexedDB carrier,
// driven through Playwright, signed in as a real account through the starter's
// own form. No schedule runs it; run it after changing the chat starter or
// client custody, and file a red as a ticket.
//
// Run from `snapback2/` after `cargo build --workspace --bins` and
// `(cd packages/snapback2 && node build.mjs)`:
//
//   node scripts/witness-web.mjs            # Google Chrome via playwright-core's "chrome" channel
//   SNAPBACK2_WITNESS_BROWSER=/path/to/chromium node scripts/witness-web.mjs
//   node scripts/witness-web.mjs --sessions # LLP 1018 shared subscriptions and tab takeover only
//   node scripts/witness-web.mjs --capacity # exact 256/257 boundary and no-poll live-write witness
//   node scripts/witness-web.mjs --signup   # signup grant + first IndexedDB-backed profile write only
//   node scripts/witness-web.mjs --offline-replay # one writer's browser-offline admission and exact flush
//   node scripts/witness-web.mjs --keep     # leave the scratch project and profile behind
//
// playwright-core is an optional devDependency of packages/snapback2; when it
// is absent or no browser is found, this exits 2 with a one-line reason.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, loadavg, tmpdir } from "node:os";
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
const capacityOnly = process.argv.includes("--capacity");
const signupOnly = process.argv.includes("--signup");
const offlineReplayOnly = process.argv.includes("--offline-replay");
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
import { api, browserTokenStore, createClient } from "snapback2/client";
import * as diagnostics from "snapback2/internal";
(window as any).__diagnostics = diagnostics;
(window as any).__api = api;
import { App } from "${resolve(packageRoot, "templates/chat/react/src/App.tsx")}";

const broadcast = ((window as any).__witnessBroadcast = {
  sent: [] as Array<Record<string, unknown>>,
  dropped: [] as Array<Record<string, unknown>>,
  /** Message types this tab drops instead of posting: the channel carries nudges only, so dropping one delays, never loses (LLP 1018.004 §4). */
  dropTypes: [] as string[],
});
// Keep Chromium's real cross-tab channel; the witness hook only withholds
// nudges so unadmitted rows can be observed before the writer's poll.
const nativeBroadcastPost = BroadcastChannel.prototype.postMessage;
BroadcastChannel.prototype.postMessage = function(message: unknown) {
  const copy = structuredClone(message) as Record<string, unknown>;
  broadcast.sent.push(copy);
  if (typeof copy.type === "string" && broadcast.dropTypes.includes(copy.type)) {
    broadcast.dropped.push(copy);
    return;
  }
  nativeBroadcastPost.call(this, message);
};

const faults: Array<{ path: string; status: number }> = ((window as any).__witnessFaults = []);
const requests: Array<Record<string, unknown>> = ((window as any).__witnessRequests = []);
const transport: typeof fetch = async (input, init) => {
  const started = Date.now();
  let response: Response;
  try { response = await fetch(input, init); }
  catch (error) { requests.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET", error: String(error), ms: Date.now() - started }); throw error; }
  const path = new URL(String(input)).pathname;
  const request = { path, method: init?.method ?? "GET", status: response.status, ms: Date.now() - started,
    ...(path === "/api/mutation" ? { body: init?.body } : {}), injectedStatus: undefined as number | undefined };
  requests.push(request);
  const index = faults.findIndex((fault) => fault.path === path);
  if (index < 0) return response;
  const [fault] = faults.splice(index, 1);
  request.injectedStatus = fault!.status;
  await response.arrayBuffer().catch(() => undefined);
  return new Response(JSON.stringify({ message: "injected " + fault!.status }), { status: fault!.status, headers: { "content-type": "application/json" } });
};
const offline = {
  store: indexedDbRangeStore({ beforeReplace: state => (window as any).__witnessBarrier?.(state) }),
};
// The starter's own custody (templates/chat/react/src/main.tsx): a bearer session kept in localStorage.
const tokenStore = browserTokenStore(localStorage, ${JSON.stringify(`snapback2:${url}:auth`)});
(window as any).__startSignupWitness = () => {
  const requests: Array<{ path: string; body?: unknown }> = [];
  const signupFetch: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, ...(init?.body === undefined ? {} : { body: init.body }) });
    if (path === "/api/auth/me") return new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new DOMException("startup superseded", "AbortError")), { once: true }));
    return fetch(input, init);
  };
  let ready = false;
  const startupToken = "superseded-startup-token";
  const client = createClient({ url: ${JSON.stringify(url)}, fetch: signupFetch,
    offline: { store: indexedDbRangeStore({ databasePrefix: "snapback2-signup:" }) },
    tokenStore: {
      load: () => startupToken,
      save: () => undefined,
      loadPrincipalBinding: () => ({ token: startupToken, principal: "dev:superseded-startup" }),
      savePrincipal: () => undefined,
    },
  });
  client.ready.then(() => { ready = true; }, () => { ready = true; });
  return ((window as any).__signupWitness = { client, requests, ready: () => ready });
};
function Expose() {
  const client = useSnapbackClient();
  useEffect(() => { (window as any).__snapback = client; }, [client]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><SnapbackProvider url=${JSON.stringify(url)} tokenStore={tokenStore} fetch={transport} offline={offline}><Expose /><App /></SnapbackProvider></StrictMode>,
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

async function signupWitness(page) {
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const account = { email: `signup-${nonce}@example.test`, password: "browser-signup-password-12345" };
  const profile = { displayName: "Browser Signup", handle: `browser${nonce.replace(/\D/g, "").slice(-10)}`,
    avatarUrl: null, bio: "first durable write", location: "Web", link: null };
  await page.evaluate(() => {
    const witness = window.__startSignupWitness();
    window.__signupRun = {};
  });
  await pollUntil(page, () => window.__signupWitness.requests.some(request => request.path === "/api/auth/me"), undefined,
    { label: "pending startup identity check" });
  await page.evaluate(({ account }) => {
    const witness = window.__signupWitness;
    window.__signupRun.readyAtCall = witness.ready();
    witness.client.auth.signup(account).then(
      session => { window.__signupRun.session = session; },
      error => { window.__signupRun.error = error?.stack ?? String(error); },
    );
  }, { account });
  await pollUntil(page, () => window.__signupWitness.requests.some(request => request.path === "/api/auth/signup"), undefined,
    { label: "signup request while startup is pending" });
  const pending = await page.evaluate(() => ({ readyAtCall: window.__signupRun.readyAtCall, readyAtDispatch: window.__signupWitness.ready() }));
  await pollUntil(page, () => window.__signupRun.session !== undefined || window.__signupRun.error !== undefined, undefined,
    { label: "signup session" });
  const result = await page.evaluate(async (profile) => {
    const witness = window.__signupWitness;
    if (window.__signupRun.error) throw new Error(window.__signupRun.error);
    const session = window.__signupRun.session;
    const readiness = await witness.client.outbox.status(window.__api.profiles.createMyProfile);
    const mutation = await witness.client.mutation(window.__api.profiles.createMyProfile, profile);
    const entries = await witness.client.outbox.entries();
    const entry = entries.find(item => item.op === "profiles.createMyProfile");
    const grant = entry && await new Promise((resolve, reject) => {
      const open = indexedDB.open(`snapback2-signup:${session.viewer}`);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction("meta", "readonly");
        const request = transaction.objectStore("meta").get(JSON.stringify(["grants", entry.grant]));
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { database.close(); resolve(request.result?.value); };
      };
    });
    const mine = await witness.client.query(window.__api.profiles.mine, {});
    await witness.client.close();
    return { session, readiness, mutation, mine, entry, grant, requests: witness.requests };
  }, profile);
  assert.equal(pending.readyAtCall, false, "signup begins before client.ready settles");
  assert.equal(pending.readyAtDispatch, true, "the session transition supersedes startup before installing new custody");
  assert.equal(result.readiness.ready, true, "signup installed its principal-bound replay grant");
  assert.equal(result.mutation.state, "committed", `first profile write was ${JSON.stringify(result.mutation)}`);
  assert.equal(result.mine.state, "complete");
  assert.equal(result.mine.data?.handle, profile.handle);
  assert.equal(result.entry?.state, "committed", "the profile intent is durable committed history");
  assert.equal(result.grant?.id, result.entry?.grant, "the replay grant is present in the real IndexedDB partition");
  const paths = result.requests.map(request => request.path);
  assert.equal(paths.includes("/api/auth/login"), false);
  assert.equal(paths.includes("/api/resume"), false);
  const replay = result.requests.filter(request => request.path === "/api/mutation")
    .map(request => JSON.parse(String(request.body)).replay)[0];
  assert.equal(replay?.grant, result.entry?.grant, "the first write uses the IndexedDB-admitted signup grant");
  step("signup during pending startup commits the first profile through IndexedDB without login, reload, or resume", {
    viewer: result.session.viewer, intent: result.entry.intent, grant: result.entry.grant,
  });
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
  // The browser signs in as a real account, as the starter does; the seeded personas are the other members.
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const account = { email: `witness-${nonce}@example.test`, password: "browser-witness-password-12345" };
  const signup = createClient({ url });
  const principal = (await signup.auth.signup(account)).viewer;
  await signup.close();
  const alice = createClient({ url, persona: "alice" });
  const bob = createClient({ url, persona: "bob" });
  const bobPrincipal = (await bob.auth.me()).viewer;
  // Join before the seeded messages are sent, so the account receives their deliveries.
  for (const conversationId of ["conversation-1", "conversation-2"]) {
    const joined = await alice.mutation(api.groups.memberAdd, { conversationId, principal });
    if (joined.state !== "committed") throw new Error(`adding the account to ${conversationId} was ${JSON.stringify(joined)}`);
  }
  const group = await alice.mutation(api.groups.groupCreate, { title: "Witness room", members: [bobPrincipal, principal] });
  if (group.state !== "committed") throw new Error(`group creation was ${group.state}`);
  const conversations = ["conversation-1", "conversation-2", group.data.id];
  for (const conversationId of conversations) {
    const posted = await alice.mutation(api.messages.send, { conversationId, body: `seeded in ${conversationId}` });
    if (posted.state !== "committed") throw new Error(`seed post was ${posted.state}`);
  }
  const doomed = await alice.mutation(api.messages.send, { conversationId: "conversation-1", body: indexedSearchBody });
  alice.close();
  bob.close();
  return { account: { ...account, principal }, conversations, doomedMessageId: doomed.state === "committed" ? doomed.data.id : undefined };
}

// Log in through the starter's own form; the bearer then stays in the profile's localStorage across relaunches.
async function submitLogin(page, account) {
  await page.fill("section[aria-label=Account] input[type=email]", account.email);
  await page.fill("section[aria-label=Account] input[type=password]", account.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
}

async function signIn(page, account) {
  await submitLogin(page, account);
  await page.waitForFunction((principal) => {
    const text = document.querySelector("section[aria-label=Account]")?.textContent ?? "";
    return text.includes(`Signed in as ${principal}`) && document.querySelector("[role=status][data-connection]") !== null;
  }, account.principal, { timeout: 15_000 });
}

// Playwright's waitForFunction does not await an async predicate (a pending
// Promise is truthy), so every wait on client state polls `evaluate` instead.
async function pollUntil(page, predicate, argument, { timeout = 10_000, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(predicate, argument)) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout}ms waiting for ${label}`);
    await page.waitForTimeout(50);
  }
}

async function openChat(page, conversationId) {
  await page.click(`nav[aria-label=Inbox] li[data-conversation="${conversationId}"] button`);
  await page.waitForSelector("section[aria-label=Thread] li[data-state=row]", { timeout: 10_000 });
  await page.waitForFunction((id) => {
    const summary = document.querySelector("section[aria-label=Thread] .thread-summary");
    const messages = document.querySelector("section[aria-label=Thread] ol.bubbles");
    const source = messages?.getAttribute("data-view-source");
    return window.__diagnostics.sharedConsumers(window.__snapback, window.__api.messages.conversationView, { conversationId: id }) === 1
      && (source === "composite"
        ? summary?.getAttribute("data-view-state") === messages?.getAttribute("data-view-state")
          && summary?.getAttribute("data-view-seq") === messages?.getAttribute("data-view-seq")
        : source === "partial-history" && summary?.getAttribute("data-view-state") === "partial"
          && !summary?.hasAttribute("data-count") && !summary?.hasAttribute("data-preview-message"));
  }, conversationId, { timeout: 10_000 });
  return page.evaluate((id) => {
    const summary = document.querySelector("section[aria-label=Thread] .thread-summary");
    const messages = document.querySelector("section[aria-label=Thread] ol.bubbles");
    return { conversationId: id,
      consumers: window.__diagnostics.sharedConsumers(window.__snapback, window.__api.messages.conversationView, { conversationId: id }),
      state: summary?.getAttribute("data-view-state"), seq: summary?.getAttribute("data-view-seq"),
      count: summary?.getAttribute("data-count"), previewMessage: summary?.getAttribute("data-preview-message"),
      source: messages?.getAttribute("data-view-source"),
      historyState: document.querySelector("section[aria-label=Thread] .thread-history-note")?.getAttribute("data-history-state"),
      historyText: document.querySelector("section[aria-label=Thread] .thread-history-note")?.textContent,
      rows: [...(messages?.querySelectorAll("li[data-message]") ?? [])].map((node) => node.getAttribute("data-message")),
    };
  }, conversationId);
}

// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — actual
// Chromium tabs, Web Locks, BroadcastChannel, IndexedDB, and the owner prove one queue.
async function sharedSessions(context, writer, appUrl, ownerUrl, principal) {
  await pollUntil(writer, async () => window.__snapback && (await window.__snapback.outbox.status()).ready,
    null, { timeout: 15_000 });
  const added = [];
  const controls = [];
  const replayed = [];
  context.on("request", (request) => {
    if (request.url() === ownerUrl + "/api/live/control") {
      const body = request.postDataJSON() ?? {};
      controls.push(body); added.push(...(body.add ?? []));
    }
    if (request.url() === ownerUrl + "/api/mutation") replayed.push(request.postDataJSON());
  });
  try {
  const sharedArgs = { conversationId: "conversation-2" };
  const shared = await writer.evaluate(async (args) => {
    const client = window.__snapback;
    const op = window.__api.messages.conversationView;
    const first = window.__diagnostics.subscribe(client, op, args, () => undefined);
    const second = window.__diagnostics.subscribe(client, op, args, () => undefined);
    let firstOpen = true, secondOpen = true;
    try {
      const resolved = e => e.state === "complete" || e.state === "capped";
      const [a, b] = await Promise.all([first.until(resolved, 5000), second.until(resolved, 5000)]);
      const two = window.__diagnostics.sharedConsumers(client, op, args);
      first.close(); firstOpen = false;
      const one = window.__diagnostics.sharedConsumers(client, op, args);
      const survivor = await second.until(resolved, 5000);
      second.close(); secondOpen = false;
      return { two, one, zero: window.__diagnostics.sharedConsumers(client, op, args), seq: [a.seq, b.seq, survivor.seq],
        authoritativeNext: (await client.query(op, args)).next ?? null,
        next: [a.next, b.next, survivor.next], sameIdentity: a.data === b.data && b.data === survivor.data,
        data: [a.data, b.data, survivor.data] };
    } finally {
      if (firstOpen) first.close();
      if (secondOpen) second.close();
    }
  }, sharedArgs);
  assert.deepEqual([shared.two, shared.one, shared.zero], [2, 1, 0]);
  assert.equal(new Set(shared.seq).size, 1);
  assert.deepEqual(shared.next, Array(3).fill(shared.authoritativeNext), "shared consumers preserve the authoritative continuation");
  assert.equal(shared.sameIdentity, true, "both consumers read the entry's one immutable value");
  assert.deepEqual(shared.data[0], shared.data[1]);
  assert.deepEqual(shared.data[0], shared.data[2]);
  assert.ok(Array.isArray(shared.data[0].messages) && shared.data[0].messages.length <= 50);
  assert.ok(Array.isArray(shared.data[0].preview) && shared.data[0].preview.length <= 1);
  assert.equal(typeof shared.data[0].count, "number");
  if (shared.data[0].preview.length) assert.equal(shared.data[0].preview[0].id, shared.data[0].messages[0].id);
  const children = added.filter(child => child.path.includes("messages.conversationView"));
  const described = children.map(child => {
    const path = new URL(child.path, ownerUrl);
    let args;
    try {
      args = JSON.parse(path.searchParams.get("args") ?? "{}");
    } catch { args = { malformed: path.searchParams.get("args") }; }
    return { id: child.id, op: path.searchParams.get("op"), args, lastEventId: child.lastEventId };
  });
  const targetChildren = described.filter(child => child.op === "messages.conversationView"
    && child.args.conversationId === sharedArgs.conversationId);
  const targetIds = [...new Set(targetChildren.map(child => child.id))];
  assert.equal(targetIds.length, 1,
    `duplicate app consumers add exactly one logical owner stream identity: ${JSON.stringify({ described, controls })}`);
  const removeDeadline = Date.now() + 2_000;
  while (!controls.some(control => control.remove?.includes(targetIds[0])) && Date.now() < removeDeadline) {
    await writer.waitForTimeout(25);
  }
  const transport = await writer.evaluate(() => window.__witnessRequests
    .filter(request => request.path === "/api/live/control").slice(-8));
  assert.ok(controls.some(control => control.remove?.includes(targetIds[0])),
    `last close must remove the active owner stream: ${JSON.stringify({ targetIds, controls, transport })}`);
  step("two app consumers share one coherent list/count/preview snapshot; closing one preserves the other", {
    consumers: [2, 1, 0], streamId: targetIds[0], addOccurrences: targetChildren.length,
    seq: shared.seq[0], next: shared.next[0], count: shared.data[0].count,
    preview: shared.data[0].preview[0]?.message?.body,
    siblingAdds: described.filter(child => !targetIds.includes(child.id)), transport,
  });
  } catch (error) {
    fail("two app consumers share one logical owner subscription and release it", error);
  }

  // @ref LLP 1002#4-the-wire — exercise the exact logical-stream boundary in
  // a real browser: 256 distinct shapes remain live while only child 257 is
  // refused, and the full latest state arrives under second-client writes.
  try {
  const capacity = await writer.evaluate(async ({ count, ownerUrl }) => {
    const headers = { "Content-Type": "application/json", "X-Snapback-As": "alice" };
    const abort = new AbortController();
    const response = await fetch(`${ownerUrl}/api/live`, { method: "POST", body: "{}", headers, signal: abort.signal });
    if (!response.ok || !response.body) throw new Error(`live open returned ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const pending = [];
    let buffered = "";
    const consume = () => {
      for (;;) {
        const end = buffered.indexOf("\n\n");
        if (end < 0) return;
        const block = buffered.slice(0, end); buffered = buffered.slice(end + 2);
        const data = block.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
        if (data) pending.push(JSON.parse(data));
      }
    };
    while (!pending.some(frame => typeof frame.session === "string")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("live stream closed before its session frame");
      buffered += decoder.decode(chunk.value, { stream: true }); consume();
    }
    const session = pending.find(frame => typeof frame.session === "string").session;
    const deliveries = new Map();
    for (const frame of pending) if (typeof frame.id === "string") deliveries.set(frame.id, frame.data);
    pending.length = 0;
    const pump = (async () => {
      try {
        for (;;) {
          consume();
          while (pending.length) {
            const frame = pending.shift();
            if (typeof frame.id === "string") deliveries.set(frame.id, frame.data);
          }
          const chunk = await reader.read();
          if (chunk.done) return;
          buffered += decoder.decode(chunk.value, { stream: true });
        }
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      }
    })();
    const add = Array.from({ length: count }, (_, index) => ({
      id: `capacity-${index}`,
      path: `/api/subscribe?op=messages.thread&args=${encodeURIComponent(JSON.stringify({
        conversationId: index === 0 ? "conversation-1" : `capacity-${index}`, c: null,
      }))}`,
    }));
    const admitted = await fetch(`${ownerUrl}/api/live/control`, { method: "POST", headers,
      body: JSON.stringify({ session, add, remove: [] }) });
    const acknowledgement = await admitted.json();
    window.__capacityWitness = { abort, deliveries, pump, session, ownerUrl, headers };
    return { status: admitted.status, acknowledgement, opened: add.length,
      distinctShapes: new Set(add.map(child => child.path)).size };
  }, { count: 256, ownerUrl });
  assert.equal(capacity.status, 200);
  assert.deepEqual(capacity.acknowledgement, { ok: true });
  assert.equal(capacity.opened, 256);
  assert.equal(capacity.distinctShapes, 256);

  const refusal = await writer.evaluate(async () => {
    const witness = window.__capacityWitness;
    const response = await fetch(`${witness.ownerUrl}/api/live/control`, { method: "POST", headers: witness.headers,
      body: JSON.stringify({ session: witness.session, add: [{ id: "capacity-256",
        path: `/api/subscribe?op=messages.thread&args=${encodeURIComponent(JSON.stringify({ conversationId: "capacity-256", c: null }))}` }], remove: [] }) });
    const envelope = await response.json();
    return { status: response.status, code: envelope.code, family: envelope.family, guide: envelope.guide,
      responsive: document.body.isConnected };
  });
  assert.deepEqual(refusal, { status: 400, code: "E_OWNER_BUSY", family: "owner", guide: "owner/dev", responsive: true });

  const liveWrites = Array.from({ length: 12 }, (_, index) => `capacity-live-${Date.now()}-${index}`);
  const clientModule = await import(resolve(dist, "client.mjs"));
  const secondClient = clientModule.createClient({ url: ownerUrl, persona: "alice" });
  try {
    for (const body of liveWrites) {
      const result = await secondClient.mutation(clientModule.api.messages.send, { conversationId: "conversation-1", body });
      assert.equal(result.state, "committed");
    }
  } finally { await secondClient.close(); }
  await pollUntil(writer, (bodies) => {
    const event = window.__capacityWitness?.deliveries.get("capacity-0");
    const delivered = event?.data?.map(row => row.message?.body) ?? [];
    return bodies.every(body => delivered.includes(body));
  }, liveWrites, { timeout: 15_000, label: "all sustained writes in the live capacity child" });
  const delivered = await writer.evaluate((bodies) => {
    const event = window.__capacityWitness.deliveries.get("capacity-0");
    return { state: event.state, live: event.live, seq: event.seq,
      retained: bodies.filter(body => event.data.some(row => row.message?.body === body)).length };
  }, liveWrites);
  await writer.evaluate(async () => {
    const witness = window.__capacityWitness;
    await fetch(`${witness.ownerUrl}/api/live/control`, { method: "POST", headers: witness.headers,
      body: JSON.stringify({ session: witness.session, close: true }) }).catch(() => undefined);
    witness.abort.abort(); await witness.pump.catch(() => undefined);
    delete window.__capacityWitness;
  });
  step("256 distinct browser subscriptions survive a local 257th-child refusal and sustained second-client writes without polling", {
    opened: capacity.opened, distinctShapes: capacity.distinctShapes, refusal, writes: liveWrites.length,
    delivered, host: { cpus: cpus().length, load: loadavg().map(value => Number(value.toFixed(2))) },
  });
  } catch (error) {
    await writer.evaluate(async () => {
      const witness = window.__capacityWitness;
      if (!witness) return;
      witness.abort.abort(); await witness.pump.catch(() => undefined);
      delete window.__capacityWitness;
    }).catch(() => undefined);
    fail("256/257 live capacity and sustained no-poll delivery", error);
  }
  if (capacityOnly) return;

  try {
  const follower = await context.newPage();
  await follower.goto(appUrl);
  await pollUntil(follower, async () => window.__snapback
    && (await window.__snapback.outbox.status(window.__api.messages.send)).ready, null, { timeout: 15_000 });
  await openChat(follower, "conversation-1");

  // @ref LLP 1018.004#6-the-test-fake-and-the-witness — a follower's sends are
  // durable rows: queued at once, back after a reload before any network
  // request, admitted by the writer in key order, and executed exactly once.
  const beforeInboxWrites = replayed.length;
  const inboxBodies = ["1018.004 durable one", "1018.004 durable two"];
  await follower.evaluate(() => { window.__witnessBroadcast.dropTypes = ["inbox"]; });
  for (const body of inboxBodies) {
    await follower.fill("form[aria-label=Composer] input[aria-label=Message]", body);
    await follower.waitForSelector("form[aria-label=Composer] button[type=submit]:enabled", { timeout: 10_000 });
    await follower.click("form[aria-label=Composer] button[type=submit]");
    await follower.waitForFunction(() => document.querySelector("form[aria-label=Composer] input[aria-label=Message]")?.value === "",
      null, { timeout: 5_000 });
  }
  const queuedRows = await follower.evaluate(async () => {
    const entries = await window.__snapback.outbox.entries();
    return {
      rows: entries.filter(entry => entry.inbox !== undefined).map(entry => ({ intent: entry.intent, state: entry.state, ids: entry.ids.length, inbox: entry.inbox })),
      bubbles: [...document.querySelectorAll("section[aria-label=Thread] li[data-state=queued]")].map(node => node.textContent ?? ""),
      sendDisabled: document.querySelector("form[aria-label=Composer] button[type=submit]")?.disabled,
      status: await window.__snapback.outbox.status(),
    };
  });
  assert.equal(queuedRows.rows.length, 2, `two durable rows: ${JSON.stringify(queuedRows)}`);
  assert.deepEqual(queuedRows.rows.map(row => [row.state, row.ids, row.intent]), queuedRows.rows.map(row => ["queued", 0, `inbox:${row.inbox}`]),
    "each row is queued, without ids, under its alias");
  assert.equal(queuedRows.bubbles.length, 2, "both bubbles show");
  assert.ok(queuedRows.bubbles[0].includes(inboxBodies[0]) && queuedRows.bubbles[1].includes(inboxBodies[1]), "bubbles in send order");
  assert.equal(queuedRows.sendDisabled, false, "a queued row does not block the next send");
  assert.ok(["forwarding", "writer-unresponsive"].includes(queuedRows.status.reason) && queuedRows.status.ready, `follower status ${JSON.stringify(queuedRows.status)}`);
  assert.equal(replayed.length, beforeInboxWrites, "an unadmitted row sends no owner mutation");
  step("a follower's sends are durable rows: queued at once, bubbles in order, the composer still enabled", queuedRows);

  await follower.reload();
  await follower.waitForFunction(() => window.__snapback && window.__witnessBroadcast, null, { timeout: 15_000 });
  await follower.evaluate(() => { window.__witnessBroadcast.dropTypes = ["inbox"]; });
  await follower.waitForFunction(() => /messages available on this device|Connected/.test(document.querySelector("[role=status][data-connection]")?.textContent ?? ""), null, { timeout: 15_000 });
  await openChat(follower, "conversation-1");
  await follower.waitForFunction(() => document.querySelectorAll("section[aria-label=Thread] li[data-state=queued]").length === 2, null, { timeout: 10_000 });
  const reloaded = await follower.evaluate(async () => ({
    mutationRequests: window.__witnessRequests.filter(request => request.path === "/api/mutation").length,
    rows: (await window.__snapback.outbox.entries()).filter(entry => entry.inbox !== undefined).map(entry => entry.intent),
    bubbles: [...document.querySelectorAll("section[aria-label=Thread] li[data-state=queued]")].map(node => node.textContent ?? ""),
  }));
  assert.equal(reloaded.mutationRequests, 0, "the reloaded tab made no mutation request");
  assert.deepEqual(reloaded.rows, queuedRows.rows.map(row => row.intent), "the same rows, from durable state");
  step("a reload shows the device's queued rows from durable state before any network request", reloaded);

  await follower.evaluate(() => { window.__witnessBroadcast.dropTypes = []; });
  await writer.evaluate(() => window.__snapback.inbox.admit());
  await writer.evaluate(() => window.__snapback.outbox.settled());
  await pollUntil(follower, async (keys) => {
    const entries = await window.__snapback.outbox.entries();
    return keys.every(key => entries.some(entry => entry.inbox === key && entry.ids.length > 0 && entry.state === "committed"));
  }, queuedRows.rows.map(row => row.inbox), { timeout: 15_000 });
  const admittedEntries = await writer.evaluate(async () => (await window.__snapback.outbox.entries())
    .filter(entry => entry.inbox !== undefined).map(entry => ({ intent: entry.intent, inbox: entry.inbox, state: entry.state, body: entry.args?.body })));
  assert.deepEqual(admittedEntries.map(entry => entry.inbox), queuedRows.rows.map(row => row.inbox), "admitted in key order");
  const inboxWrites = replayed.slice(beforeInboxWrites).filter(request => inboxBodies.includes(request.args?.body));
  assert.deepEqual(inboxWrites.map(request => request.args.body), inboxBodies, `each row executed once, in order: ${JSON.stringify(inboxWrites)}`);
  await follower.waitForFunction(() => document.querySelectorAll("section[aria-label=Thread] li[data-state=queued]").length === 0, null, { timeout: 15_000 });
  const inboxVerification = await import(resolve(dist, "client.mjs"));
  const inboxVerifier = inboxVerification.createClient({ url: ownerUrl, persona: "alice" });
  try {
    const thread = await inboxVerifier.query(inboxVerification.api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(thread.state, "complete");
    for (const body of inboxBodies) assert.equal(thread.data.filter(row => row.message?.body === body).length, 1, `the server stores ${body} once`);
  } finally { await inboxVerifier.close(); }
  step("the writer admits durable rows in key order; each executes exactly once; the follower reads the ledger entries", {
    admitted: admittedEntries, ownerWrites: inboxWrites.length,
  });

  // A follower's dismissal is a durable command the writer consumes.
  await follower.evaluate((intent) => window.__snapback.outbox.dismiss(intent), admittedEntries[0].intent);
  await pollUntil(writer, async (intent) => !(await window.__snapback.outbox.entries()).some(entry => entry.intent === intent),
    admittedEntries[0].intent, { timeout: 10_000 });
  await pollUntil(follower, async (intent) => !(await window.__snapback.outbox.entries()).some(entry => entry.intent === intent), admittedEntries[0].intent, { timeout: 10_000 });
  step("a follower's dismissal is a durable command the writer consumes; both tabs' history agree", { dismissed: admittedEntries[0].intent });

  const beforeWrites = replayed.length;
  const beforeIntents = await writer.evaluate(async () =>
    (await window.__snapback.outbox.entries()).map(entry => entry.intent));

  // Cut only the writer's owner transport: the follower remains live. An actual
  // page close releases the browser-owned lock without calling client.close().
  await writer.bringToFront();
  await pollUntil(writer, async () => (await window.__snapback.outbox.status(window.__api.messages.send)).ready, null, { timeout: 15_000 });
  const ownerOrigin = new URL(ownerUrl).origin;
  await writer.route(url => url.origin === ownerOrigin, route => route.abort("connectionrefused"));
  step("writer readiness before going offline", await writer.evaluate(async () => ({ status: await window.__snapback.outbox.status(), post: await window.__snapback.outbox.status(window.__api.messages.send), entries: await window.__snapback.outbox.entries() })));
  await writer.evaluate(() => window.__snapback.offline());
  step("writer readiness after going offline", await writer.evaluate(async () => ({ status: await window.__snapback.outbox.status(), post: await window.__snapback.outbox.status(window.__api.messages.send) })));
  const writerFirst = await writer.evaluate(() => window.__snapback.mutation(window.__api.messages.send,
    { conversationId: "conversation-1", body: "1018 writer first" }));
  const followerMiddle = await follower.evaluate(() => window.__snapback.mutation(window.__api.messages.send,
    { conversationId: "conversation-1", body: "1018 follower middle" }));
  const writerSecond = await writer.evaluate(() => window.__snapback.mutation(window.__api.messages.send,
    { conversationId: "conversation-1", body: "1018 writer second" }));
  const queued = [writerFirst, followerMiddle, writerSecond];
  assert.deepEqual(queued.map(row => row.state), ["queued", "queued", "queued"]);
  assert.equal(replayed.length, beforeWrites, "writer-local and follower offline admission send no owner mutation bytes");
  assert.match(followerMiddle.intent, /^inbox:\d+$/, "a follower's result names its durable row");
  const ledger = await writer.evaluate(async () => (await window.__snapback.outbox.entries()).map(entry => ({ intent: entry.intent, inbox: entry.inbox })));
  const middleEntry = ledger.find(entry => entry.inbox === Number(followerMiddle.intent.slice("inbox:".length)));
  assert.ok(middleEntry, `the writer admitted the follower's row before its own second write: ${JSON.stringify(ledger)}`);
  const intents = [writerFirst.intent, middleEntry.intent, writerSecond.intent];
  assert.deepEqual(ledger.map(entry => entry.intent), [...beforeIntents, ...intents],
    "the device's durable order is the ledger's: writer, follower, writer");
  step("both tabs durably enqueue through the one offline writer", {
    origins: ["writer", "follower", "writer"], intents,
  });
  // One more follower row, its nudge withheld, is left for the next writer to admit on takeover.
  await follower.evaluate(() => { window.__witnessBroadcast.dropTypes = ["inbox"]; });
  const leftBehind = await follower.evaluate(() => window.__snapback.mutation(window.__api.messages.send,
    { conversationId: "conversation-1", body: "1018.004 admitted on takeover" }));
  assert.equal(leftBehind.state, "queued");
  await follower.evaluate(() => { window.__witnessBroadcast.dropTypes = []; });
  await writer.close();
  await follower.bringToFront();
  const replayDeadline = Date.now() + 15_000;
  while (replayed.slice(beforeWrites).filter(request => intents.includes(request.replay?.intent)).length < 3
    && Date.now() < replayDeadline) await follower.waitForTimeout(100);
  step("takeover observation", await follower.evaluate(async () => ({ status: await window.__snapback.outbox.status(), entries: await window.__snapback.outbox.entries() })));
  await pollUntil(follower, async () => (await window.__snapback.outbox.entries()).filter(e => e.state === "queued").length === 0, null, { timeout: 15_000 });
  await follower.evaluate(() => window.__snapback.outbox.settled());
  const inherited = replayed.slice(beforeWrites).filter(request => intents.includes(request.replay?.intent));
  assert.deepEqual(inherited.map(request => request.replay.intent), intents, "inherited queue replays FIFO exactly once");
  const takeoverAdmitted = replayed.slice(beforeWrites).filter(request => request.args?.body === "1018.004 admitted on takeover");
  const takeoverState = await follower.evaluate(async (principal) => ({
    status: await window.__snapback.outbox.status(), lastRefusal: window.__snapback.snapshot.lastRefusal,
    entries: (await window.__snapback.outbox.entries()).map(entry => ({ intent: entry.intent, inbox: entry.inbox, state: entry.state,
      body: entry.args?.body, ids: entry.ids.length, response: entry.response })),
    rows: await new Promise((resolve) => {
      const open = indexedDB.open(`snapback2:${principal}`);
      open.onsuccess = () => { const db = open.result; const tx = db.transaction(["inbox"], "readonly");
        const all = tx.objectStore("inbox").getAll(); all.onsuccess = () => { resolve(all.result); db.close(); }; };
      open.onerror = () => resolve("open failed");
    }),
  }), principal);
  assert.equal(takeoverAdmitted.length, 1, `the row left behind was admitted by the new writer and executed once: ${JSON.stringify(takeoverState)}`);
  assert.ok(replayed.slice(beforeWrites).indexOf(takeoverAdmitted[0]) > replayed.slice(beforeWrites).indexOf(inherited[2]),
    "the inherited intents replay before the row admitted on takeover");
  const { createClient, api } = await import(resolve(dist, "client.mjs"));
  const verifier = createClient({ url: ownerUrl, persona: "alice" });
  try {
    const thread = await verifier.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(thread.state, "complete");
    const bodies = thread.data.map(row => row.message?.body);
    for (const body of ["1018 writer first", "1018 follower middle", "1018 writer second", "1018.004 admitted on takeover"]) {
      assert.equal(bodies.filter(item => item === body).length, 1);
    }
    assert.ok(bodies.indexOf("1018 writer second") < bodies.indexOf("1018 follower middle")
      && bodies.indexOf("1018 follower middle") < bodies.indexOf("1018 writer first"),
    "newest-first owner rows preserve the durable cross-tab admission order");
  } finally { await verifier.close(); }
  const after = await follower.evaluate(() => window.__snapback.mutation(window.__api.messages.send,
    { conversationId: "conversation-1", body: "1018 new writer" }));
  assert.equal(after.state, "committed");
  step("closing the writer transfers its Web Lock and one cross-tab FIFO queue; the new writer admits the row left behind and commits", {
    replayIntents: inherited.map(request => request.replay.intent), rowsPerIntent: 1, admittedOnTakeover: takeoverAdmitted.length,
  });

  // Lifecycle: with a third tab following the new writer, the writer's partition
  // is wiped (sign-out takes the same path). The
  // deletion completes beneath the third tab's open inbox connection because
  // that connection closes on versionchange; the third tab's wait then wins the
  // freed lock and it becomes the writer of a fresh, empty partition.
  const third = await context.newPage();
  await third.goto(appUrl);
  await pollUntil(third, async () => window.__snapback
    && ["forwarding", "writer-unresponsive"].includes((await window.__snapback.outbox.status()).reason), null,
  { timeout: 15_000, label: "the third tab following the new writer" });
  const thirdBefore = await third.evaluate(async () => (await window.__snapback.outbox.entries()).length);
  assert.ok(thirdBefore > 0, "the third tab reads the writer's ledger through its inbox route");
  await follower.evaluate(() => window.__snapback.offlineRuntime.wipe());
  // A fresh partition has no grant until its first drain, so the takeover shows as the marker clearing, not as `ready`.
  await pollUntil(third, async () => !window.__snapback.offlineRuntime.following
    && !["forwarding", "writer-unresponsive", "follower"].includes((await window.__snapback.outbox.status()).reason), null,
  { timeout: 15_000, label: "the third tab taking over the freed partition" });
  const thirdAfter = await third.evaluate(async (principal) => ({
    entries: (await window.__snapback.outbox.entries()).length,
    status: await window.__snapback.outbox.status(),
    databases: (await indexedDB.databases()).map(entry => entry.name).filter(name => name?.includes(principal)),
  }), principal);
  assert.equal(thirdAfter.entries, 0, "the deletion completed beneath the third tab's connection: its fresh partition holds no ledger");
  step("a wipe deletes the partition beneath an open follower connection; the follower's route ends and its wait takes over a fresh partition", {
    before: thirdBefore, after: thirdAfter,
  });
  await third.close();
  } catch (error) {
    fail("two offline tabs share one durable queue and transfer writer ownership", error);
  }
}

// @ref LLP 1018.004#1-the-write-record — the focused stall witness keeps one
// real IndexedDB partition and one context: this page owns the Web Lock, admits
// one durable row offline, then sends that row's exact envelope after resume.
async function singleContextOfflineReplay(context, page, ownerUrl, principal) {
  for (const other of context.pages()) if (other !== page) await other.close();
  assert.equal(context.pages().length, 1, "the replay witness has exactly one browser page");
  await pollUntil(page, async (principal) => {
    const client = window.__snapback;
    if (!client || client.offlineRuntime?.principal !== principal
      || typeof client.offlineRuntime?.programGeneration !== "string"
      || !Number.isSafeInteger(client.offlineRuntime?.authEpoch)) return false;
    const status = await client.outbox.status(window.__api.messages.send);
    return status.ready && status.remaining === 0;
  }, principal, { timeout: 15_000, label: "the single writer's exact send readiness" });
  const evidence = async () => ({ pages: context.pages().length, ...await page.evaluate(async () => {
    const client = window.__snapback;
    const databases = (await indexedDB.databases()).map(entry => entry.name)
      .filter(name => typeof name === "string" && name.startsWith("snapback2:"));
    return {
      persona: client.snapshot.persona,
      principal: client.offlineRuntime.principal,
      authEpoch: client.offlineRuntime.authEpoch,
      generation: client.offlineRuntime.programGeneration,
      following: client.offlineRuntime.following,
      status: await client.outbox.status(window.__api.messages.send),
      partitions: databases,
    };
  }) });
  const before = await evidence();
  assert.equal(before.persona, undefined, "the page holds a bearer session, not a dev persona");
  assert.equal(before.principal, principal);
  assert.equal(before.following, false, "the only page owns the account partition instead of following another writer");
  assert.deepEqual(before.partitions, [`snapback2:${principal}`]);
  assert.deepEqual({ ready: before.status.ready, reason: before.status.reason, action: before.status.action,
    remaining: before.status.remaining, fence: before.status.fence },
  { ready: true, reason: "ready", action: "none", remaining: 0, fence: "inside" });

  const body = `single-context offline replay ${Date.now()}`;
  await page.evaluate(() => window.__snapback.offline());
  await context.setOffline(true);
  await page.evaluate(() => { window.__witnessRequests.length = 0; });
  const queued = await page.evaluate(async ({ body }) => {
    const client = window.__snapback;
    const started = performance.now();
    const mutation = await Promise.race([
      client.mutation(window.__api.messages.send, { conversationId: "conversation-1", body }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("offline mutation exceeded 15 seconds")), 15_000)),
    ]);
    const entries = await client.outbox.entries();
    return { mutation, ms: performance.now() - started,
      entry: entries.find(entry => entry.intent === mutation.intent),
      status: await client.outbox.status(window.__api.messages.send),
      mutationRequests: window.__witnessRequests.filter(request => request.path === "/api/mutation"
        && JSON.parse(String(request.body)).op === "messages.send"),
      principal: client.offlineRuntime.principal, authEpoch: client.offlineRuntime.authEpoch,
      generation: client.offlineRuntime.programGeneration, following: client.offlineRuntime.following,
      partitions: (await indexedDB.databases()).map(entry => entry.name)
        .filter(name => typeof name === "string" && name.startsWith("snapback2:")) };
  }, { body });
  assert.equal(queued.mutation.state, "queued", JSON.stringify(queued));
  assert.ok(queued.ms < 15_000, `offline admission took ${queued.ms}ms`);
  assert.equal(queued.entry?.state, "queued");
  assert.equal(queued.entry?.op, "messages.send");
  assert.deepEqual(queued.entry?.args, { conversationId: "conversation-1", body });
  assert.equal(queued.mutationRequests.length, 0, "offline admission sends no mutation request");
  assert.deepEqual({ principal: queued.principal, authEpoch: queued.authEpoch, generation: queued.generation,
    following: queued.following }, { principal: before.principal, authEpoch: before.authEpoch,
    generation: before.generation, following: false });
  assert.deepEqual(queued.partitions, before.partitions);
  assert.deepEqual({ ready: queued.status.ready, reason: queued.status.reason, remaining: queued.status.remaining },
    { ready: true, reason: "ready", remaining: 1 });

  await context.setOffline(false);
  const flushed = await page.evaluate(async ({ intent }) => {
    const client = window.__snapback;
    const started = performance.now();
    const settlement = await Promise.race([
      (async () => { await client.online(); return client.outbox.settled(); })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("offline replay exceeded 15 seconds")), 15_000)),
    ]);
    const entries = await client.outbox.entries();
    return { settlement, ms: performance.now() - started,
      entry: entries.find(entry => entry.intent === intent),
      status: await client.outbox.status(window.__api.messages.send),
      mutationRequests: window.__witnessRequests.filter(request => request.path === "/api/mutation"
        && JSON.parse(String(request.body)).op === "messages.send"),
      principal: client.offlineRuntime.principal, authEpoch: client.offlineRuntime.authEpoch,
      generation: client.offlineRuntime.programGeneration, following: client.offlineRuntime.following,
      partitions: (await indexedDB.databases()).map(entry => entry.name)
        .filter(name => typeof name === "string" && name.startsWith("snapback2:")) };
  }, { intent: queued.mutation.intent });
  assert.deepEqual(flushed.settlement, { stopped: false, remaining: 0 });
  assert.ok(flushed.ms < 15_000, `offline replay took ${flushed.ms}ms`);
  assert.equal(flushed.entry?.state, "committed", JSON.stringify(flushed));
  assert.equal(flushed.mutationRequests.length, 1,
    `one queued intent emits one owner mutation request: ${JSON.stringify(flushed.mutationRequests)}`);
  const request = {
    op: queued.entry.op,
    args: queued.entry.args,
    replay: { grant: queued.entry.grant, offset: queued.entry.offset, count: queued.entry.count,
      intent: queued.entry.intent, trace: queued.entry.trace ?? { points: [], verdicts: [] } },
  };
  assert.equal(String(flushed.mutationRequests[0].body), JSON.stringify(request),
    "the browser flush preserves the durable admission envelope byte-for-byte");
  assert.deepEqual({ principal: flushed.principal, authEpoch: flushed.authEpoch, generation: flushed.generation,
    following: flushed.following }, { principal: before.principal, authEpoch: before.authEpoch,
    generation: before.generation, following: false });
  assert.deepEqual(flushed.partitions, before.partitions);
  assert.deepEqual({ ready: flushed.status.ready, reason: flushed.status.reason, remaining: flushed.status.remaining },
    { ready: true, reason: "ready", remaining: 0 });

  const { createClient, api } = await import(resolve(dist, "client.mjs"));
  const verifier = createClient({ url: ownerUrl, persona: "alice" });
  try {
    const thread = await verifier.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(thread.state, "complete");
    assert.equal(thread.data.filter(row => row.message?.body === body).length, 1,
      "the replayed intent produced exactly one owner row");
  } finally { await verifier.close(); }
  step("one IndexedDB writer admits offline and flushes one exact envelope without a 15-second stall", {
    before, queued: { intent: queued.entry.intent, ms: Math.round(queued.ms), remaining: queued.status.remaining },
    flushed: { ms: Math.round(flushed.ms), remaining: flushed.status.remaining, requests: flushed.mutationRequests.length },
  });
}

async function main() {
  precondition(spawnSync(binary, ["--version"]).status !== null, `${binary} is not built; run cargo build --workspace --bins`);
  const playwright = await loadPlaywright();
  precondition(playwright, "playwright-core is not installed; add it (optional devDependency of packages/snapback2) to run the witness");
  const project = await mkdtemp(join(tmpdir(), "snapback2-witness-project-"));
  const profile = await mkdtemp(join(tmpdir(), "snapback2-witness-profile-"));
  const owner = await startOwner(project);
  const seeded = signupOnly ? undefined : await seed(owner.url);
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
    // Seed, sign in, drain, open three chats.
    let page = await launch();
    if (!signupOnly) {
      await signIn(page, seeded.account);
      step("a real account signs in through the starter's form", { principal: seeded.account.principal });
    }
    if (signupOnly) {
      await signupWitness(page);
    } else if (offlineReplayOnly) {
      await singleContextOfflineReplay(context, page, owner.url, seeded.account.principal);
    } else if (sessionsOnly || capacityOnly) {
      await sharedSessions(context, page, appUrl, owner.url, seeded.account.principal);
    } else {
    await page.waitForFunction(() => /messages available on this device/.test(document.querySelector("[role=status][data-connection]")?.textContent ?? ""), null, { timeout: 15_000 });
    const [neverOpened, ...opened] = [...seeded.conversations].reverse();
    const coherentViews = [];
    for (const conversationId of opened) coherentViews.push(await openChat(page, conversationId));
    const listed = await page.$$eval("nav[aria-label=Inbox] li", (nodes) => nodes.length);
    if (listed !== 3) throw new Error(`the inbox listed ${listed} chats`);
    if (coherentViews.some((view) => view.consumers !== 1 || (view.state !== "complete" && view.state !== "capped")
      || !/^\d+$/.test(view.count ?? "") || !view.previewMessage || !view.rows.includes(view.previewMessage))) {
      throw new Error(`mounted composite consumers were incoherent: ${JSON.stringify(coherentViews)}`);
    }
    step("seed, drain, and open three chats with one coherent list/count/preview value", {
      chats: listed, opened: opened.length, coherentViews,
    });

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

    // A warmed composite remains one value through a local prediction, its
    // settlement, and a removal that returns count and preview to the earlier message.
    const coherentConversation = opened[0];
    const beforeComposite = await openChat(page, coherentConversation);
    await context.setOffline(true); await page.evaluate(() => window.__snapback.offline());
    const predictedComposite = await page.evaluate(async ({ conversationId, body }) =>
      window.__snapback.mutation(window.__api.messages.send, { conversationId, body }),
    { conversationId: coherentConversation, body: "coherent offline prediction" });
    if (predictedComposite.state !== "queued") throw new Error(`composite prediction was ${JSON.stringify(predictedComposite)}`);
    await page.waitForFunction(({ id }) => {
      const summary = document.querySelector("section[aria-label=Thread] .thread-summary");
      const list = document.querySelector("section[aria-label=Thread] ol.bubbles");
      return summary?.getAttribute("data-preview-message") === id
        && list?.getAttribute("data-view-source") === "composite"
        && list.querySelector(`li[data-message="${id}"][data-state="queued"]`);
    }, { id: predictedComposite.ids[0] }, { timeout: 10_000 });
    const predictedView = await openChat(page, coherentConversation);
    await context.setOffline(false);
    await page.evaluate(async () => { await window.__snapback.online(); await window.__snapback.outbox.settled(); });
    await page.waitForFunction(({ id, seq }) => {
      const summary = document.querySelector("section[aria-label=Thread] .thread-summary");
      return document.querySelector(`section[aria-label=Thread] li[data-message="${id}"][data-state="row"]`)
        && Number(summary?.getAttribute("data-view-seq")) > Number(seq);
    }, { id: predictedComposite.ids[0], seq: predictedView.seq }, { timeout: 10_000 });
    const settledView = await openChat(page, coherentConversation);
    const removed = await page.evaluate((messageId) =>
      window.__snapback.mutation(window.__api.messages.unsend, { messageId }), predictedComposite.ids[0]);
    if (removed.state !== "committed") throw new Error(`composite revocation was ${JSON.stringify(removed)}`);
    await page.waitForFunction(({ id, count, preview }) => {
      const summary = document.querySelector("section[aria-label=Thread] .thread-summary");
      return !document.querySelector(`section[aria-label=Thread] li[data-message="${id}"]`)
        && summary?.getAttribute("data-count") === count
        && summary.getAttribute("data-preview-message") === preview;
    }, { id: predictedComposite.ids[0], count: beforeComposite.count, preview: beforeComposite.previewMessage }, { timeout: 10_000 }).catch(async (error) => {
      const diagnosis = await page.evaluate((id) => {
        const summary = document.querySelector("section[aria-label=Thread] .thread-summary");
        const row = document.querySelector(`section[aria-label=Thread] li[data-message="${id}"]`);
        return { summary: summary && Object.fromEntries([...summary.attributes].map((a) => [a.name, a.value])), text: summary?.textContent,
          row: row && { state: row.getAttribute("data-state"), text: row.textContent } };
      }, predictedComposite.ids[0]).catch((e) => String(e));
      throw new Error(`composite revocation never settled: ${JSON.stringify({ beforeComposite, settledView, diagnosis })}\n${error.message}`);
    });
    const revokedView = await openChat(page, coherentConversation);
    if (predictedView.source !== "composite" || settledView.source !== "composite" || revokedView.source !== "composite"
      || predictedView.seq === settledView.seq || settledView.seq === revokedView.seq
      || settledView.count === beforeComposite.count || revokedView.count !== beforeComposite.count
      || revokedView.previewMessage !== beforeComposite.previewMessage) {
      throw new Error(`composite lifecycle was incoherent: ${JSON.stringify({ beforeComposite, predictedView, settledView, revokedView })}`);
    }
    step("one composite snapshot covers offline prediction, settlement, and removal", {
      before: beforeComposite, predicted: predictedView, settled: settledView, revoked: revokedView,
    });

    // Enqueue one message while offline.
    await context.setOffline(true);
    await page.evaluate(() => window.__snapback.offline());
    const partialHistory = await openChat(page, neverOpened);
    if (partialHistory.source !== "partial-history" || partialHistory.state !== "partial"
      || partialHistory.count !== null || partialHistory.previewMessage !== null
      || !partialHistory.historyState || !/Count and preview unavailable/.test(partialHistory.historyText ?? "")) {
      throw new Error(`never-opened history exposed an independently fresh composite field: ${JSON.stringify(partialHistory)}`);
    }
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
    await page.waitForFunction(() => {
      const scope = document.querySelector("section[aria-label=Search] .scope");
      return scope?.getAttribute("data-state") === "ready"
        && scope.getAttribute("data-status") === "ready"
        && scope.getAttribute("data-receipt") === "none"
        && scope.getAttribute("data-reason") === "held"
        && scope.getAttribute("data-predicted") === "true"
        && /Matching downloaded messages/.test(scope.textContent ?? "")
        && /server has not confirmed/.test(scope.textContent ?? "");
    }, null, { timeout: 10_000 });
    step("the mounted indexed search publishes the offline prediction; partial history hides composite count and preview", {
      queued, partialHistory,
    });

    // Kill the profile at rest, cold start with the backend unreachable.
    await close();
    page = await launch({ ownerCut: true });
    const coldPartialHistory = await openChat(page, neverOpened).catch(() => undefined);
    const coldQueued = await page.$(`li[data-state=queued][data-message="${queued.id}"]`);
    const coldInbox = await page.$$eval("nav[aria-label=Inbox] li", (nodes) => nodes.length);
    if (!coldQueued || coldInbox < 3) {
      const diagnosis = await page.evaluate(async () => {
        const client = window.__snapback;
        const inbox = await client.query(window.__api.messages.inbox, { c: null }).catch((e) => ({ threw: e?.envelope?.code ?? String(e) }));
        const rows = Array.isArray(inbox?.data) ? inbox.data : [];
        return { header: document.querySelector("[role=status][data-connection]")?.textContent, inbox: { state: inbox.state, connection: inbox.connection, threw: inbox.threw, rows: rows.length, conversations: [...new Set(rows.map((r) => r.conversationId))], caughtUp: inbox.caughtUp },
          snapshot: { connection: client.snapshot.connection, auth: client.snapshot.auth?.state }, outbox: (await client.outbox.entries()).map((e) => e.state), requests: window.__witnessRequests };
      }).catch((e) => String(e));
      throw new Error(`cold start held ${coldInbox} chats and queued=${Boolean(coldQueued)}: ${JSON.stringify(diagnosis)}`);
    }
    await page.fill("section[aria-label=Search] input", indexedSearchTerm);
    await page.waitForSelector(`section[aria-label=Search] li[data-message="${queued.id}"]`, { timeout: 10_000 });
    const coldSearch = await page.$eval("section[aria-label=Search] .scope", (node) => ({
      state: node.getAttribute("data-state"), status: node.getAttribute("data-status"),
      receipt: node.getAttribute("data-receipt"), reason: node.getAttribute("data-reason"),
      predicted: node.getAttribute("data-predicted"), text: node.textContent,
    }));
    if (coldSearch.state !== "ready" || coldSearch.status !== "ready" || coldSearch.receipt !== "none"
      || coldSearch.reason !== "held" || coldSearch.predicted !== "true"
      || !/Matching downloaded messages/.test(coldSearch.text ?? "")
      || !/server has not confirmed/.test(coldSearch.text ?? "")) throw new Error(`cold indexed search was ${JSON.stringify(coldSearch)}`);
    if (coldPartialHistory?.source !== "partial-history" || coldPartialHistory.count !== null
      || coldPartialHistory.previewMessage !== null || !coldPartialHistory.historyState
      || !/Count and preview unavailable/.test(coldPartialHistory.historyText ?? "")) {
      throw new Error(`cold partial history exposed composite count or preview: ${JSON.stringify(coldPartialHistory)}`);
    }
    step("cold offline: a chat never opened online renders partial history without count/preview; indexed search agrees",
      { chats: coldInbox, search: coldSearch, partialHistory: coldPartialHistory });

    // Carrier refused → E_OFFLINE_CARRIER.
    await close();
    context = await playwright.chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), "snapback2-witness-nocarrier-")), { ...launchOptions(), headless: true });
    await context.addInitScript(() => { Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true }); });
    page = await context.newPage();
    await page.goto(appUrl);
    // A fresh profile holds no session: logging in without a carrier stays signed out and says why.
    await submitLogin(page, seeded.account);
    await page.waitForFunction(() => window.__snapback?.snapshot.lastRefusal?.code === "E_OFFLINE_CARRIER"
      && /IndexedDB and Web Locks are required/.test(document.querySelector("section[aria-label=Account] [role=alert]")?.textContent ?? ""),
    null, { timeout: 10_000 }).catch(async (error) => {
      const diagnosis = await page.evaluate(() => ({ account: document.querySelector("section[aria-label=Account]")?.textContent,
        auth: window.__snapback?.snapshot.auth, lastRefusal: window.__snapback?.snapshot.lastRefusal })).catch((e) => String(e));
      throw new Error(`the refused carrier was never reported: ${JSON.stringify(diagnosis)}\n${error.message}`);
    });
    const carrier = await page.evaluate(() => ({ auth: window.__snapback.snapshot.auth.state,
      code: window.__snapback.snapshot.lastRefusal.code, alert: document.querySelector("section[aria-label=Account] [role=alert]")?.textContent }));
    if (carrier.auth === "authenticated") throw new Error(`a login without a carrier installed a session: ${JSON.stringify(carrier)}`);
    step("with the carrier refused, logging in stays signed out, says IndexedDB is required, and records E_OFFLINE_CARRIER", carrier);
    await close();

    // Backend up: 503 after the first commit, kill mid-commit, exactly one row, second in order.
    page = await launch({ ownerCut: true });
    await page.evaluate(() => window.__snapback.offline());
    await openChat(page, neverOpened);
    await page.fill("form[aria-label=Composer] input", "second queued message");
    await page.click("form[aria-label=Composer] button[type=submit]");
    await page.waitForFunction(() => document.querySelectorAll("li[data-state=queued]").length === 2, null, { timeout: 5_000 });
    // Receipt acknowledgements for delivered pages (`_delivery.<log>.ack`) are queued work of their own
    // and can join the queue after reconnecting; the checks below follow the two sends.
    const sendsOf = (items) => items.filter(item => item.op === "messages.send");
    const queuedBeforeFault = sendsOf(await page.evaluate(async () => (await window.__snapback.outbox.entries())
      .filter(entry => entry.state === "queued").map(({ intent, ids, args, op }) => ({ intent, ids, args, op }))))
      .map(({ intent, ids, args }) => ({ intent, ids, args }));
    assert.equal(queuedBeforeFault.length, 2, "both intents are durable before reconnect");
    assert.equal(queuedBeforeFault[0].ids[0], queued.id, "the first cold intent keeps its pinned message id");
    await page.evaluate((id) => { window.__witnessPinnedBubble = document.querySelector(`li[data-message="${id}"]`); }, queued.id);
    // beforeReplace runs before opening the IndexedDB transaction. Kill only after the first intent's
    // committed image reaches that persistence boundary, so install the barrier before reconnecting.
    // @ref LLP 1018.008.000#replay-after-transport-recovery — reaching the owner again after the lost
    // receipt is a recovery opportunity; the client's one automatic retry is what reaches the barrier.
    await page.evaluate(([first, second]) => {
      window.__witnessBarrier = state => {
        if (state.outbox[first]?.state !== "committed") return;
        window.__witnessSettlement = { first: state.outbox[first].state, second: state.outbox[second]?.state };
        return new Promise(() => undefined);
      };
    }, queuedBeforeFault.map(entry => entry.intent));
    await context.unroute(cutOwner);
    await page.evaluate(() => { window.__witnessFaults.push({ path: "/api/mutation", status: 503 }); });
    await page.evaluate(() => window.__snapback.online());
    const afterFault = await page.evaluate(async () => ({
      settlement: await window.__snapback.outbox.settled(),
      queued: (await window.__snapback.outbox.entries()).filter(entry => entry.state === "queued")
        .map(({ intent, ids, args, op }) => ({ intent, ids, args, op })),
      requests: window.__witnessRequests.filter(request => request.path === "/api/mutation")
        .map(request => ({ ...request, op: JSON.parse(String(request.body)).op })),
    }));
    const faultRequests = sendsOf(afterFault.requests);
    assert.equal(afterFault.settlement.stopped, "transport", "the lost receipt stops replay");
    assert.ok(afterFault.queued.every(entry => entry.op === "messages.send" || /^_delivery\.[^.]+\.ack$/.test(entry.op)),
      `only the sends and receipt acknowledgements stay queued: ${JSON.stringify(afterFault.queued.map(entry => entry.op))}`);
    assert.deepEqual(sendsOf(afterFault.queued).map(({ intent, ids, args }) => ({ intent, ids, args })), queuedBeforeFault,
      "the 503 preserves both intents and their pinned bytes");
    assert.equal(faultRequests.length, 1, "screen/auth lifetimes cause no additional replay");
    assert.equal(faultRequests[0].status, 200, "the injected 503 follows a real owner response");
    assert.equal(faultRequests[0].injectedStatus, 503, "the intended mutation response was lost");
    // Settlement is durable custody; React publication has its own boundary.
    // Check both, and keep the original DOM identity assertion across them.
    await page.waitForFunction(() => document.querySelector("ol.bubbles")?.getAttribute("data-view-source") === "composite"
      && document.querySelectorAll("li[data-state=queued]").length === 2, null, { timeout: 10_000 });
    const retainedThroughComposite = await page.evaluate((id) =>
      window.__witnessPinnedBubble === document.querySelector(`li[data-message="${id}"]`), queued.id);
    if (!retainedThroughComposite) throw new Error("partial history to coherent composite remounted the pinned bubble");
    step("partial history becomes a coherent composite without remounting its pinned bubble", { stopped: "transport", queued: 2 });
    await page.waitForFunction(() => window.__witnessSettlement !== undefined, null, { timeout: 10_000 });
    assert.deepEqual(await page.evaluate(() => window.__witnessSettlement), { first: "committed", second: "queued" });
    const beforeKill = sendsOf(await page.evaluate(() => window.__witnessRequests.filter(request => request.path === "/api/mutation")
      .map(request => ({ body: request.body, op: JSON.parse(String(request.body)).op })))).map(request => request.body);
    assert.deepEqual(beforeKill, [faultRequests[0].body, faultRequests[0].body], "the automatic retry is byte-identical; the second intent has not replayed");
    await close();
    page = await launch();
    await page.evaluate(() => window.__snapback.outbox.settled());
    await page.evaluate(() => window.__snapback.outbox.drain());
    await openChat(page, neverOpened);
    await page.waitForFunction(() => document.querySelectorAll("li[data-state=queued]").length === 0, null, { timeout: 10_000 });
    await page.waitForSelector(`li[data-message="${queued.id}"][data-state=row]`, { timeout: 10_000 });
    const coldMutations = await page.evaluate(() => window.__witnessRequests.filter(request => request.path === "/api/mutation")
      .map(request => ({ body: request.body, op: JSON.parse(String(request.body)).op })));
    const afterKill = sendsOf(coldMutations).map(request => request.body);
    assert.deepEqual(afterKill.map(body => JSON.parse(body).replay.intent), queuedBeforeFault.map(entry => entry.intent),
      `cold recovery replays the two durable intents in exact FIFO order: ${JSON.stringify(coldMutations.map(request => request.op))}`);
    assert.equal(afterKill[0], beforeKill[0], "the interrupted settlement retains the identical first envelope");
    const durableAfterKill = await page.evaluate(async () => (await window.__snapback.outbox.entries())
      .map(({ intent, ids, args, state }) => ({ intent, ids, args, state })));
    assert.deepEqual(durableAfterKill.filter(entry => queuedBeforeFault.some(queued => queued.intent === entry.intent)),
      queuedBeforeFault.map(entry => ({ ...entry, state: "committed" })), "both intent records survive as committed history");
    const { createClient, api } = await import(resolve(dist, "client.mjs"));
    const verifier = createClient({ url: owner.url, persona: "alice" });
    const thread = await verifier.query(api.messages.thread, { conversationId: neverOpened, c: null });
    verifier.close();
    const bodies = thread.data.map((row) => row.message?.body);
    const count = (body) => bodies.filter((item) => item === body).length;
    if (count("Café queued in the browser") !== 1 || count("second queued message") !== 1) throw new Error(`rows: ${JSON.stringify(bodies)}`);
    if (bodies.indexOf("second queued message") > bodies.indexOf("Café queued in the browser")) throw new Error("replay order was not preserved");
    step("503 after the commit and a kill before settlement persistence: identical retries, exactly one row each, in order; the partial-history bubble survived the coherent transition");

    // Revocation received on resume invalidates the same persistent index trace.
    await page.fill("section[aria-label=Search] input", indexedSearchTerm);
    await page.waitForSelector(`section[aria-label=Search] li[data-message="${seeded.doomedMessageId}"]`, { timeout: 10_000 });
    await page.waitForFunction(() => {
      const state = document.querySelector("section[aria-label=Search] .scope")?.getAttribute("data-state");
      return state === "complete" || state === "capped";
    }, null, { timeout: 10_000 });
    await page.evaluate(() => window.__snapback.offline());
    const revoker = createClient({ url: owner.url, persona: "alice" });
    const unsent = await revoker.mutation(api.messages.unsend, { messageId: seeded.doomedMessageId });
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

    await sharedSessions(context, page, appUrl, owner.url, seeded.account.principal);
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

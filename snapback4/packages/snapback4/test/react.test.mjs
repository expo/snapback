// React's actual effect/subscription replay, with controlled transport and
// observations. Skipped only when Chromium is unavailable; no backend or
// simulator is launched. React Native host views are DOM stubs, so these cover
// the shared composer/open lifecycle rather than native layout or input APIs.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromiumExecutable } from "../../../witness/lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("React hooks and reference-app lifetimes", async (t) => {
  let executablePath;
  try { executablePath = chromiumExecutable(); }
  catch (error) { t.skip(`Chromium unavailable: ${error.message}`); return; }
  const { chromium } = createRequire(join(root, "package.json"))("playwright-core");
  const require = createRequire(join(root, "packages/snapback4/package.json"));
  const { createServer } = await import(pathToFileURL(createRequire(join(root, "apps/chat/package.json")).resolve("vite")).href);
  const temporary = mkdtempSync(join(tmpdir(), "sb4-react-"));
  let server, browser;
  try {
    writeFileSync(join(temporary, "index.html"), '<!doctype html><title>React witness</title><script type="module" src="/harness.jsx"></script>');
    writeFileSync(join(temporary, "harness.jsx"), harness);
    server = await createServer({
      root: temporary, configFile: false, logLevel: "error",
      server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary] } },
      resolve: { alias: [
        { find: /^react$/, replacement: require.resolve("react") },
        { find: /^react\/jsx-runtime$/, replacement: require.resolve("react/jsx-runtime") },
        { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
        { find: "snapback4/app", replacement: join(root, "packages/snapback4/src/app.ts") },
        { find: "snapback4/auth", replacement: join(root, "packages/snapback4/src/auth.ts") },
        { find: "snapback4/client", replacement: join(root, "packages/snapback4/src/client.ts") },
        { find: "snapback4/react", replacement: join(root, "packages/snapback4/src/react.tsx") },
        { find: "web-state", replacement: join(root, "apps/chat/src/state.ts") },
        { find: "web-composer", replacement: join(root, "apps/chat/src/Composer.tsx") },
        { find: "web-app", replacement: join(root, "apps/chat/src/App.tsx") },
        { find: "expo-thread", replacement: join(root, "apps/chat-expo/src/Thread.tsx") },
        { find: "expo-app", replacement: join(root, "apps/chat-expo/App.tsx") },
      ] },
      plugins: [{
        name: "controlled-reference-app-dependencies",
        enforce: "pre",
        resolveId(id, importer = "") {
          if (id === "react-native") return "\0native-host-views";
          if (id === "snapback4-expo/witness") return "\0witness-launch";
          if (id === "expo-status-bar") return "\0status-bar";
          if (/snapback\/generated\/api(?:\.ts)?$/.test(id)) return "\0generated-api";
          if (id === "snapback4/local" || (id === "./src/client" && importer.endsWith("/chat-expo/App.tsx"))) return "\0open-client";
          if (id === "./src/witness" && importer.endsWith("/chat-expo/App.tsx")) return "\0witness";
          if (/\/(?:chat\/src|chat-expo)\/App\.tsx$/.test(importer) && /\/(?:Inbox|Thread)(?:\.tsx)?$/.test(id)) return "\0home-views";
        },
        load(id) {
          if (id === "\0open-client") return "export const openClient = (...args) => globalThis.openClient(...args); export const createLocalClient = openClient;";
          if (id === "\0generated-api") return 'export const api = { send: { kind: "mutation", name: "send" }, markRead: { kind: "mutation", name: "markRead" }, room: { kind: "query", name: "room" }, thread: { kind: "query", name: "thread" } };';
          if (id === "\0home-views") return "export const Inbox = () => null; export const Thread = () => null;";
          if (id === "\0witness-launch") return "export const witness = () => null;";
          if (id === "\0witness") return "export const runWitness = () => Promise.resolve();";
          if (id === "\0status-bar") return "export const StatusBar = () => null;";
          if (id === "\0native-host-views") return `
            import { createElement as h } from "react";
            export const View = ({ children }) => h("div", null, children);
            export const SafeAreaView = View;
            export const Text = ({ children }) => h("span", null, children);
            export const FlatList = () => null;
            export const TextInput = ({ value, onChangeText, placeholder }) => h("input", { value, onChange: e => onChangeText(e.target.value), placeholder });
            export const Button = ({ title, disabled, onPress }) => h("button", { disabled, onClick: onPress }, title);
            export const StyleSheet = { create: value => value, hairlineWidth: 1 };
          `;
        },
      }],
    });
    await server.listen();
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => typeof window.reactCases === "object");
    for (const name of await page.evaluate(() => Object.keys(window.reactCases))) {
      await t.test(name, async () => {
        const result = await page.evaluate(async (name) => {
          try { await window.reactCases[name](); return null; }
          catch (error) { return error.stack ?? String(error); }
        }, name);
        assert.equal(result, null);
      });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
});

const harness = `
import { StrictMode, act, useState, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider, useAuth, useClient, SnapbackProvider, useQuery, usePage, useMutation, usePendingWrite, useAcquired, useAction, useViewer, useAsset } from "snapback4/react";
import { createApp } from "snapback4/app";
import { createClient } from "snapback4/client";
import { memorySessionStore, keepSession } from "snapback4/auth";
import { Composer } from "web-composer";
import { ViewState } from "web-state";
import { Thread } from "expo-thread";
import { App as WebApp } from "web-app";
import { App as ExpoApp } from "expo-app";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.process = { env: {} };
const query = { kind: "query", name: "read" };
const mutation = { kind: "mutation", name: "write" };
const ready = (data, next = null, flags = {}) => ({ data, complete: true, cut: null, fresh: true, since: 100, next, ...flags });
const check = (condition, message) => { if (!condition) throw Error(message); };
const equal = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), message + ": " + JSON.stringify(actual));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sent = id => ({ state: "sent", id, seq: 1, result: { reused: id } });
const failed = id => ({ state: "failed", id, why: { code: "E_INPUT", family: "input", message: "message refused" } });

function controlled(read = () => ready([])) {
  const records = [], writes = [], viewerListeners = new Set(), writeListeners = new Set(), acquiredListeners = new Set();
  const receipts = new Map();
  let viewer = "dev:test";
  const client = {
    records, writes, receipts, closes: 0, acquired: false,
    onAcquired(listener) { acquiredListeners.add(listener); return () => acquiredListeners.delete(listener); },
    setAcquired(value) { client.acquired = value; for (const listener of acquiredListeners) listener(value); },
    write: async id => receipts.get(id),
    observe(op, args) {
      const listeners = new Set();
      const record = {
        args, value: read(args), closes: 0,
        getSnapshot() { return record.value; },
        subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        close() { record.closes++; },
        set(value) { record.value = value; for (const callback of listeners) callback(); },
      };
      records.push(record);
      return record;
    },
    query: async (_, args) => read(args),
    mutate(_, args, options) { const result = deferred(); writes.push({ ...result, args, options }); return result.promise; },
    upload: async () => ({ ok: false, why: { code: "E_ASSET_UNKNOWN", family: "asset", message: "no upload" } }),
    asset: async id => ({ denied: { code: "E_ASSET_UNKNOWN", family: "asset", message: id } }),
    assetSource: id => ({ uri: "mock://" + id, headers: {} }),
    link: () => "online", onLink: () => () => {},
    viewer: () => viewer,
    onViewer(listener) { viewerListeners.add(listener); return () => viewerListeners.delete(listener); },
    onWrite(listener) { writeListeners.add(listener); return () => writeListeners.delete(listener); },
    setViewer(next) { viewer = next; for (const listener of viewerListeners) listener(next); },
    emitWrite(write) { receipts.set(write.id, write); for (const listener of writeListeners) listener(write); },
    close: async () => { client.closes++; },
  };
  return client;
}
let root, host;
async function mount(component, client) {
  await unmount();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render(component, client);
}
async function render(component, client) {
  await act(async () => { root.render(h(StrictMode, null, client ? h(SnapbackProvider, { client }, component) : component)); });
}
async function unmount() {
  if (root) await act(async () => root.unmount());
  host?.remove(); root = null; host = null;
}
const active = client => client.records.filter(record => !record.closes);
const one = client => { check(active(client).length === 1, "one live observation"); return active(client)[0]; };
const allClosed = client => check(client.records.every(record => record.closes === 1), "every acquired observation closed exactly once");
async function edit(text) {
  await act(async () => {
    const input = host.querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    const form = host.querySelector("form");
    if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    else [...host.querySelectorAll("button")].find(button => button.textContent === "Send").click();
  });
}

const cases = {
  async "AppProvider switches real clients, resets account state and routes existing mutation/query hooks"() {
    const seen = [];
    const app = createApp({ url: "https://app.invalid", sessionStore: memorySessionStore(), fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/auth/signup") {
        const principal = JSON.parse(init.body).email;
        return Response.json({ session: { principal, token: principal, kind: "user", expiresAt: Date.now() + 7 * 86400000 } });
      }
      if (path === "/auth/logout") return Response.json({ ok: true });
      if (path === "/q/read") return Response.json({ data: init.headers.authorization, tables: ["notes"], seq: 1 });
      if (path === "/m/write") { const write = JSON.parse(init.body); seen.push([init.headers.authorization, write]); return Response.json({ state: "sent", id: write.id, seq: 1, result: null }); }
      if (path === "/changes") return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
      throw Error("unexpected route " + path);
    } });
    let auth, client, read, write, setDraft;
    function Screen() {
      auth = useAuth(); client = useClient(); read = useQuery(query, {}); write = useMutation(mutation);
      const [draft, set] = useState("empty"); setDraft = set;
      return h("p", null, auth.state + ":" + auth.viewer + ":" + draft);
    }
    try {
      await mount(h(AppProvider, { app }, h(Screen)));
      await act(async () => { await app.ready; });
      check(auth.state === "signed-out", "restore publishes signed out");
      await act(async () => { await auth.signup("alice", "password"); });
      const alice = client;
      await act(async () => { setDraft("alice draft"); await write.run({ body: "alice write" }); });
      equal(read.data, "Bearer alice", "query hook uses Alice");
      await act(async () => { await auth.signup("bob", "password"); });
      check(client !== alice && auth.viewer === "bob", "provider switched clients");
      check(host.textContent.endsWith(":empty"), "account-owned draft was reset");
      equal(read.data, "Bearer bob", "query hook uses Bob");
      await act(async () => { await write.run({ body: "bob write" }); });
      equal(seen.map(entry => entry[0]), ["Bearer alice", "Bearer bob"], "existing mutation hook follows the current client");
      await act(async () => { await auth.logout(); });
      equal(auth.state, "signed-out", "logout updates useAuth");
      check(client !== alice && client.viewer() === null, "no stale account client remains");
    } finally { await unmount(); await app.close(); }
  },

  async "two online owners notify both pending-write hooks when the shared journal settles once"() {
    const store = memorySessionStore(), owners = [], waits = [deferred(), deferred()], entered = [false, false];
    const initial = { principal: "alice", token: "same-session", kind: "user", expiresAt: Date.now() + 7 * 86400000 };
    await keepSession("https://shared.invalid", initial, store);
    let a, b;
    const calls = [0, 0], events = [[], []], id = "00000000000000000000000001";
    function Pending({ index }) {
      const write = usePendingWrite(mutation, id);
      return h("p", { id: "owner-" + index }, write.last?.state ?? "unknown");
    }
    const until = async (check, message) => {
      for (let n = 0; n < 200; n++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
      throw Error(message);
    };
    try {
      for (let index = 0; index < 2; index++) {
        const app = createApp({ url: "https://shared.invalid", sessionStore: store, fetch: async (url, init) => {
          if (new URL(url).pathname !== "/m/write") throw Error("unexpected route " + url);
          if (++calls[index] === 1) throw Error("initial request offline");
          entered[index] = true;
          await waits[index].promise;
          return Response.json({ state: "sent", id, seq: 1, replayed: index === 1 });
        } });
        owners.push(app); await app.ready;
        app.client.onWrite(write => events[index].push(write.state));
      }
      a = owners[0]; b = owners[1];
      equal((await a.mutate(mutation, { body: "shared" }, { id })).state, "pending", "A queued");
      equal((await b.mutate(mutation, { body: "shared" }, { id })).state, "pending", "B queued same ID");
      await mount(h("div", null, ...owners.map((app, index) => h(AppProvider, { app, key: index }, h(Pending, { index })))));
      for (let n = 0; n < 100 && ![...host.querySelectorAll("p")].every(p => p.textContent === "pending"); n++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      equal([...host.querySelectorAll("p")].map(p => p.textContent), ["pending", "pending"], "both hooks pending");
      await until(() => entered.every(Boolean), "both retry requests held");
      await act(async () => { waits[0].resolve(); await until(() => events[0].length === 1, "A terminal notification"); });
      equal(host.querySelector("#owner-0").textContent, "sent", "A hook settled");
      equal(host.querySelector("#owner-1").textContent, "pending", "B still waits for its confirmation");
      await act(async () => { waits[1].resolve(); await until(() => events[1].length === 1, "B must notify even after A retired the entry"); });
      equal(host.querySelector("#owner-1").textContent, "sent", "B hook settled without polling write(id)");
      await act(async () => { await a.client.write(id); await b.client.write(id); });
      equal(events, [["sent"], ["sent"]], "notifications deduplicate separately for each owner");
    } finally { waits.forEach(wait => wait.resolve()); await unmount(); await Promise.all(owners.map(app => app.close())); }
  },

  async "useQuery owns observations through Strict Mode, equivalent arguments and unmount"() {
    const client = controlled(args => ready(args)); let latest;
    function Probe({ value }) { latest = useQuery(query, { value }); return null; }
    await mount(h(Probe, { value: 1 }), client);
    equal(latest.data, { value: 1 }, "ready after effect replay");
    check(client.records.length === 2, "discarded render acquired no resource");
    const original = one(client);
    await render(h(Probe, { value: 1 }), client);
    check(one(client) === original, "equivalent arguments keep the observation");
    await render(h(Probe, { value: 2 }), client);
    check(original.closes === 1, "old arguments release the observation");
    await act(async () => one(client).set(ready({ value: 3 })));
    equal(latest.data, { value: 3 }, "new observation remains live");
    await unmount(); allClosed(client);
  },
  async "useMutation survives replay, rejection, concurrent writes and an obsolete lifetime"() {
    const client = controlled(); let latest;
    function Probe() { latest = useMutation(mutation); return null; }
    await mount(h(Probe), client);
    let first;
    await act(async () => { first = latest.run({ n: 1 }); });
    check(latest.inFlight, "write is in flight");
    await act(async () => { client.writes[0].resolve(sent("first")); await first; });
    equal((await first).result, { reused: "first" }, "run resolves with the server result");
    equal(latest.last.result, { reused: "first" }, "last carries the server result");
    check(latest.last.id === "first" && !latest.inFlight, "write settles after Strict Mode replay");
    let rejected;
    await act(async () => { rejected = latest.run({ n: 2 }); });
    await act(async () => { client.writes[1].reject(Error("storage failed")); await rejected; });
    check(latest.last.state === "failed" && latest.last.why.code === "E_CLIENT" && !latest.inFlight, "foreign client rejection is an explicit outcome");
    check(latest.last.id === "" && !latest.last.why.retryable, "unknown outcome invents neither identity nor retry safety");
    let a, b;
    await act(async () => { a = latest.run({ n: 3 }); b = latest.run({ n: 4 }); });
    await act(async () => { client.writes[2].resolve(sent("a")); await a; });
    check(latest.inFlight, "another write still owns inFlight");
    await act(async () => { client.writes[3].resolve(sent("b")); await b; });
    check(!latest.inFlight, "last concurrent write clears inFlight");
    let pending;
    await act(async () => { pending = latest.run({ n: 4.5 }); client.writes[4].resolve({ state: "pending", id: "queued" }); await pending; });
    check(latest.last.state === "pending", "durably admitted write is initially pending");
    await act(async () => client.emitWrite(failed("queued")));
    check(latest.last.state === "failed" && latest.last.id === "queued", "terminal settlement replaces pending state");
    let raced;
    await act(async () => {
      raced = latest.run({ n: 4.75 });
      client.emitWrite({ state: "sent", id: "raced", seq: 1, replayed: true });
      client.writes[5].resolve({ state: "pending", id: "raced" });
      await raced;
    });
    check(latest.last.state === "sent" && latest.last.id === "raced", "terminal settlement wins a race with the pending return");
    const receipt = { state: "sent", id: "raced", seq: 1, replayed: true };
    equal(latest.last, receipt, "the hook preserves replay identity without fabricating a result");
    let obsolete;
    await act(async () => { obsolete = latest.run({ n: 5 }); });
    const replacement = controlled();
    await render(h(Probe), replacement);
    await act(async () => { client.writes[6].resolve(sent("obsolete")); await obsolete; });
    check(latest.last === undefined && !latest.inFlight, "old client's write does not settle into the new lifetime");
    let abandoned;
    await act(async () => { abandoned = latest.run({ n: 6 }); });
    await unmount();
    replacement.writes[0].resolve(sent("after-unmount")); await abandoned;
  },
  async "useMutation preserves fresh null and direct, queued and early replay receipts"() {
    const client = controlled(); let latest;
    function Probe() { latest = useMutation(mutation); return null; }
    await mount(h(Probe), client);
    const nil = { state: "sent", id: "nil", seq: 1, result: null };
    let first;
    await act(async () => { first = latest.run({}); client.writes[0].resolve(nil); await first; });
    equal(await first, nil, "run keeps fresh null");
    equal(latest.last, nil, "last keeps fresh null");
    const replay = { state: "sent", id: "replayed", seq: 2, replayed: true };
    let direct;
    await act(async () => { direct = latest.run({}); client.writes[1].resolve(replay); await direct; });
    equal(await direct, replay, "run keeps direct replay");
    equal(latest.last, replay, "last keeps direct replay");
    check(!("result" in latest.last), "a replay never acquires a result property");
    const queued = { ...replay, id: "queued" };
    await act(async () => { const pending = latest.run({}); client.writes[2].resolve({ state: "pending", id: queued.id }); await pending; });
    await act(async () => client.emitWrite(queued));
    equal(latest.last, queued, "onWrite preserves the queued replay");
    const early = { ...replay, id: "early" };
    await act(async () => {
      const pending = latest.run({});
      client.emitWrite(early);
      client.writes[3].resolve({ state: "pending", id: early.id });
      await pending;
    });
    equal(latest.last, early, "early replay notification wins over pending");
    check(!("result" in latest.last) && !latest.inFlight, "early replay has no invented result");
    await unmount();
  },
  async "W5c acquisition and pending writes survive remount, receipt races and client replacement"() {
    const client = controlled(); let latest, acquired;
    function Probe({ id }) { latest = usePendingWrite(mutation, id); acquired = useAcquired(); return null; }
    await mount(h(Probe), client);
    check(acquired === false && !latest.pending, "an unacquired idle client is explicit");
    await act(async () => client.setAcquired(true));
    check(acquired === true, "acquisition notifies React");
    let submit;
    await act(async () => { submit = latest.run({}); });
    check(latest.pending && latest.inFlight, "the chip starts at submit before an id returns");
    await act(async () => { client.writes[0].resolve({ state: "pending", id: "held", reason: "queued without a row: not acquired yet" }); await submit; });
    check(latest.pending && !latest.inFlight && latest.last.id === "held", "admitted pending keeps the chip");
    await act(async () => client.emitWrite(sent("held")));
    check(!latest.pending && latest.last.state === "sent", "sent removes pending");
    await act(async () => { const p = latest.run({}); client.writes[1].resolve({ state: "pending", id: "refused" }); await p; });
    await act(async () => client.emitWrite(failed("refused")));
    check(!latest.pending && latest.last.state === "failed", "failed removes pending and preserves refusal");
    await unmount();
    const reopened = controlled(); reopened.acquired = true;
    reopened.receipts.set("restored", { state: "pending", id: "restored" });
    await mount(h(Probe, { id: "restored" }), reopened);
    check(latest.pending && latest.last.id === "restored" && !latest.inFlight, "an id restores pending after reopen without resubmission");
    const replay = { state: "sent", id: "restored", seq: 2, replayed: true };
    await act(async () => reopened.emitWrite(replay));
    equal(latest.last, replay, "replay preserves execution identity alone");
    check(!latest.pending && reopened.writes.length === 0, "recovery never resubmits");
    await unmount();
    await mount(h(Probe, { id: "restored" }), reopened);
    equal(latest.last, replay, "terminal receipt settled before mount is restored too");
    const delayed = deferred(); reopened.write = () => delayed.promise;
    await render(h(Probe, { id: "race" }), reopened);
    await act(async () => reopened.emitWrite(failed("race")));
    await act(async () => delayed.resolve({ state: "pending", id: "race" }));
    check(latest.last.state === "failed" && !latest.pending, "late hydration cannot replace a terminal event");
    await render(h(Probe, { id: "unknown" }), controlled());
    check(latest.last === undefined && !latest.pending && acquired === false, "new client and unknown id clear the old outcome");
    await unmount();
  },
  async "useAction tracks concurrent results, retry ids and obsolete lifetimes"() {
    const client = controlled(), calls = [];
    client.act = (_, args, options) => { const call = deferred(); calls.push({ ...call, args, options }); return call.promise; };
    const op = { kind: "action", name: "invite" };
    let latest;
    function Probe() { latest = useAction(op); return null; }
    await mount(h(Probe), client);
    let first, second;
    await act(async () => { first = latest.run({ email: "one" }); second = latest.run({ email: "two" }); });
    check(latest.inFlight, "concurrent actions are in flight");
    const done = { state: "done", id: "two", result: { principal: "member:two" } };
    await act(async () => { calls[1].resolve(done); await second; });
    equal(latest.last, done, "latest action's result");
    await act(async () => { calls[0].resolve({ state: "failed", id: "one", why: { code: "E_ACTION_FAILED" } }); await first; });
    equal(latest.last, done, "older failure cannot overwrite the newest result");
    check(!latest.inFlight, "both settled");
    let pending;
    await act(async () => { pending = latest.run({}, { id: "same" }); });
    equal(calls[2].options, { id: "same" }, "the retry id is forwarded");
    await act(async () => { calls[2].resolve({ state: "pending", id: "same" }); await pending; });
    check(latest.last.state === "pending", "pending is visible");
    let denied;
    await act(async () => { denied = latest.run({}); });
    await act(async () => { calls[3].resolve({ denied: { code: "E_OFFLINE" }, id: "offline" }); await denied; });
    check(latest.last.denied.code === "E_OFFLINE", "offline denial is visible");
    let obsolete;
    await act(async () => { obsolete = latest.run({}); });
    const replacement = controlled(); replacement.act = async () => done;
    await render(h(Probe), replacement);
    await act(async () => { calls[4].resolve(done); await obsolete; });
    check(latest.last === undefined && !latest.inFlight, "old action cannot enter a new lifetime");
    await unmount();
  },
  async "useViewer subscribes and useAsset has empty and failed outcomes"() {
    const client = controlled();
    let viewer, asset, calls = 0, revoked = 0;
    client.asset = async id => {
      calls++;
      if (id === "broken") throw Error("blob construction failed");
      return { url: "blob:" + id, type: "image/png", bytes: 1, revoke: () => { revoked++; } };
    };
    function Probe({ id }) { viewer = useViewer(); asset = useAsset(id); return null; }
    await mount(h(Probe, { id: null }), client);
    check(viewer === "dev:test" && asset.status === "empty" && calls === 0, "null asset is empty and performs no fetch");
    await act(async () => client.setViewer(null));
    check(viewer === null, "viewer change re-renders without another hook");
    await render(h(Probe, { id: "broken" }), client);
    await act(async () => {});
    check(asset.status === "denied" && asset.why.code === "E_CLIENT", "asset rejection becomes a typed hook outcome");
    await render(h(Probe, { id: "photo" }), client);
    await act(async () => {});
    check(asset.status === "ready" && asset.url === "blob:photo", "asset readiness is observed");
    await render(h(Probe, { id: null }), client);
    check(asset.status === "empty" && revoked === 1, "clearing the id revokes the old object URL");
    await unmount();
  },
  async "usePage rebinds insertion, deletion and reorder boundaries and aggregates read state"() {
    const pages = new Map([[null, ready(["a", "b"], "b")], ["b", ready(["c", "d"], "d")], ["a", ready(["b", "c"], "c")], ["c", ready(["d", "e"], "e")]]);
    const client = controlled(args => pages.get(args.c)); let latest;
    function Probe({ scope }) { latest = usePage(query, { scope }); return null; }
    await mount(h(Probe, { scope: "one" }), client);
    check(client.records.length === 2, "page construction is inert under discarded render");
    await act(async () => latest.loadMore());
    equal(latest.items, ["a", "b", "c", "d"], "initial two pages");
    check(latest.read.cut === null, "complete page collection has no cut");
    const first = active(client)[0], oldSecond = active(client)[1];
    await act(async () => first.set(ready(["z", "a"], "a")));
    equal(latest.items, ["z", "a", "b", "c"], "insertion loses no boundary row");
    check(oldSecond.closes === 1, "obsolete suffix closed");
    await act(async () => first.set(ready(["b", "c"], "c")));
    equal(latest.items, ["b", "c", "d", "e"], "deletion duplicates no boundary row");
    await act(async () => first.set(ready(["e", "a"], "a", { complete: false, cut: "words", fresh: false, since: 10 })));
    equal(latest.items, ["e", "a", "b", "c"], "reorder replaces the suffix");
    check(!latest.read.complete && !latest.read.fresh && latest.read.since === 10, "combined state includes the earlier page");
    check(latest.read.cut === "words", "earlier page word cut survives aggregation");
    const second = active(client)[1];
    await act(async () => second.set(ready(["b", "c"], "c", { complete: false, cut: "meter" })));
    check(latest.read.cut === "meter", "later meter cut wins over earlier words");
    await act(async () => second.set(ready(["b", "c"], "c", { complete: false, cut: "words" })));
    await act(async () => first.set(ready(["e", "a"], "a", { complete: false, cut: "meter" })));
    check(latest.read.cut === "meter", "earlier meter cut wins over later words");
    await act(async () => first.set(ready(["e", "a"], "a", { complete: false, cut: null })));
    check(latest.read.cut === "words", "withheld earlier reason does not erase a later disclosed cut");
    await act(async () => second.set(ready(["b", "c"], "c", { complete: false, cut: null })));
    check(latest.read.cut === null && !latest.read.complete, "withheld reasons stay incomplete across pages");
    equal(latest.read.data, latest.items, "read data describes all combined items");
    await render(h(Probe, { scope: "two" }), client);
    equal(latest.items, ["a", "b"], "new arguments reset the requested depth");
    check(active(client).length === 1, "new arguments close every old page");
    await unmount(); allClosed(client);
  },
  async "usePage keeps the oldest stale timestamp across fresh and stale pages"() {
    const client = controlled();
    let latest;
    function Screen() { latest = usePage(query, {}); return null; }
    await mount(h(Screen), client);
    try {
      await act(async () => active(client)[0].set(ready(["a"], "a", { fresh: false, since: 80 })));
      await act(async () => latest.loadMore());
      await act(async () => active(client)[1].set(ready(["b"], "b", { since: undefined })));
      check(latest.read.since === 80 && !latest.read.fresh, "fresh page without since preserves the stale timestamp");
      await act(async () => latest.loadMore());
      await act(async () => active(client)[2].set(ready(["c"], null, { fresh: false, since: 40 })));
      check(latest.read.since === 40, "minimum of stale pages");
      await act(async () => active(client)[1].set(ready(["b"], "b", { since: 1 })));
      check(latest.read.since === 40, "fresh pages do not contribute old timestamps");
      await act(async () => active(client)[2].set(ready(["c"], null, { fresh: false, since: undefined })));
      check(latest.read.since === undefined, "unknown stale timestamp remains unknown");
    } finally { await unmount(); }
  },

  async "real observations retain every unavailable page, preserve since, and clear on refusal and close"() {
    let phase = "ready", seq = 0, latest;
    const client = createClient({ url: "http://observation.test", persona: "alice", fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/changes") return new Promise((_, reject) => {
        if (init.signal.aborted) reject(Error("closed"));
        else init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true });
      });
      if (path === "/m/write") return Response.json({ state: "sent", id: JSON.parse(init.body).id, seq: ++seq, result: null });
      if (path === "/q/read") {
        if (phase === "loading") return Response.json({ loading: true });
        if (phase === "missing") return Response.json({});
        if (phase === "denied") return Response.json({ denied: { code: "E_RULE", family: "rule", message: "access withdrawn" } });
        const { c } = JSON.parse(init.body).args;
        return Response.json({ data: c ? ["b"] : ["a"], next: c ? null : "a", complete: true, seq });
      }
      throw Error(path);
    } });
    function Probe() { latest = { query: useQuery(query, {}), page: usePage(query, {}) }; return null; }
    const settle = async condition => {
      for (let n = 0; n < 100; n++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
        if (condition()) return;
      }
      throw Error("observation did not settle");
    };
    const rerun = async value => {
      phase = value;
      await act(async () => { await client.mutate(mutation, {}); });
      await settle(() => true);
    };
    try {
      await mount(h(Probe), client);
      await settle(() => latest.page.hasMore);
      await act(async () => latest.page.loadMore());
      await settle(() => latest.page.items.length === 2);
      equal(latest.page.items, ["a", "b"], "two published pages");
      await rerun("loading");
      equal(latest.page.items, ["a", "b"], "both unavailable pages remain visible");
      equal(latest.query.data, ["a"], "useQuery keeps its answer too");
      check(!latest.query.fresh && !latest.page.read.fresh, "all kept answers are stale");
      const since = [latest.query.since, latest.page.read.since];
      check(since.every(Number.isFinite), "kept answers have their publication time");
      await rerun("missing");
      equal([latest.query.since, latest.page.read.since], since, "missing-data reruns preserve timestamps");
      equal(latest.page.items, ["a", "b"], "missing-data reruns preserve every page");
      await rerun("denied");
      check(latest.query.denied?.code === "E_RULE" && latest.page.read.denied?.code === "E_RULE", "refusals replace kept answers");
      equal(latest.page.items, [], "refused first page clears visible items");
      await rerun("loading");
      check(latest.query.denied?.code === "E_RULE" && latest.page.read.denied?.code === "E_RULE", "an unavailable rerun cannot retract the refusal or resurrect its old data");
      await rerun("ready");
      await act(async () => client.close());
      check(latest.query.denied?.code === "E_CLOSED" && latest.page.read.denied?.code === "E_CLOSED", "close clears both hooks");
      equal(latest.page.items, [], "closed client retains no page");
    } finally { await unmount(); await client.close(); }
  },
  async "usePage treats every non-array ready value as loading and keeps the earlier pages"() {
    for (const invalid of [null, undefined, {}, "text", 7, false]) {
      const client = controlled(args => args.c == null ? ready(["a"], "a") : args.c === "a" ? ready(["b"], "b") : ready(["c"]));
      let latest;
      function Probe() { latest = usePage(query, {}); return null; }
      await mount(h(Probe), client);
      await act(async () => latest.loadMore());
      await act(async () => latest.loadMore());
      equal(latest.items, ["a", "b", "c"], "three resolved pages");
      const [first, second, third] = active(client);
      await act(async () => second.set(ready(invalid, "b")));
      equal(latest.items, ["a"], "an unavailable middle page keeps the prefix");
      check("loading" in latest.read && !latest.hasMore, "invalid data is not a ready combined read or a continuation");
      check(third.closes === 1, "the suffix of an invalid page is closed");
      await act(async () => latest.loadMore());
      check(active(client).length === 2, "loadMore cannot follow an invalid page's cursor");
      await act(async () => second.set(ready(["b"], "b")));
      equal(latest.items, ["a", "b", "c"], "recovery restores requested depth");
      await act(async () => first.set(ready(invalid, "a")));
      equal(latest.items, [], "an invalid first page has no visible items");
      check("loading" in latest.read && !latest.hasMore, "the first page also waits");
      await unmount(); allClosed(client);
    }
  },
  async "usePage discards an in-flight suffix and does not claim a ready combined read"() {
    const client = controlled(args => args.c == null ? ready(["a", "b"], "b") : { loading: true }); let latest;
    function Probe() { latest = usePage(query, {}); return null; }
    await mount(h(Probe), client);
    await act(async () => { latest.loadMore(); latest.loadMore(); });
    check(active(client).length === 2, "only one next page request at a time");
    check("loading" in latest.read && !latest.hasMore, "unresolved suffix has no combined freshness claim");
    const first = active(client)[0], obsolete = active(client)[1];
    await act(async () => first.set(ready(["z", "a"], "a")));
    check(obsolete.closes === 1, "pending old boundary is closed");
    await act(async () => obsolete.set(ready(["obsolete"], null)));
    equal(latest.items, ["z", "a"], "late old page cannot reenter the result");
    await act(async () => active(client)[1].set(ready(["b", "c"], null, { fresh: false, since: 30 })));
    equal(latest.items, ["z", "a", "b", "c"], "replacement completes the contiguous range");
    check(!latest.read.fresh && latest.read.since === 30 && !latest.hasMore, "last page contributes freshness and end position");
    await unmount(); allClosed(client);
  },
};

for (const [name, Component] of [["web", WebApp], ["Expo", ExpoApp]]) {
  cases[name + " app closes asynchronous opens before/after cleanup and ignores obsolete failures"] = async () => {
    let opens = [];
    globalThis.openClient = () => { const result = deferred(); opens.push(result); return result.promise; };
    await mount(h(Component));
    check(opens.length === 2, "Strict Mode replays the client-open effect");
    const live = controlled();
    await act(async () => { opens[0].reject(Error("obsolete open")); opens[1].resolve(live); });
    check(!host.textContent.includes("obsolete open") && !host.textContent.includes("Opening"), "only current open result renders");
    await unmount(); check(live.closes === 1, "resolved client closes on cleanup");
    opens = [];
    await mount(h(Component)); await unmount();
    const abandoned = opens.map(() => controlled());
    await act(async () => opens.forEach((open, n) => open.resolve(abandoned[n])));
    check(abandoned.every(client => client.closes === 1), "clients resolving after cleanup close immediately");
    opens = [];
    await mount(h(Component));
    await act(async () => { opens[0].reject(Error("obsolete")); opens[1].reject(Error("current open failed")); });
    check(host.textContent.includes("current open failed") && !host.textContent.includes("obsolete"), "current rejection is visible");
    await unmount();
  };
}

cases["web sign-out reports completion only after durable clearing and offers retry on failure"] = async () => {
  const client = controlled();
  let opens = 0, ending = deferred();
  globalThis.openClient = () => Promise.resolve(opens++ === 0 ? controlled() : client);
  client.signOut = () => ending.promise;
  await mount(h(WebApp));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Sign out").click());
  check(host.textContent.includes("Signing out…") && !host.textContent.includes("Signed out"), "pending deletion cannot announce sign-out");
  check(client.closes === 0, "effect cleanup does not race the SDK sign-out lifecycle");
  await act(async () => ending.reject(Error("session storage unavailable")));
  check(host.textContent.includes("session storage unavailable") && !host.textContent.includes("Continue as a guest"), "failure is visible without a completed sign-out path");
  ending = deferred();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Retry").click());
  await act(async () => ending.resolve());
  check(host.textContent.includes("Signed out") && host.textContent.includes("Continue as a guest"), "completion follows successful retry");
  await unmount();
};

for (const [name, Component] of [["web", Composer], ["Expo", Thread]]) {
  cases[name + " composer preserves edits, immediate failure and offline admission"] = async () => {
    const client = controlled();
    localStorage.clear();
    const view = new ViewState(client, "http://starter-test", client.viewer());
    await mount(h(Component, { conversationId: "c", view, onBack: () => {} }), client);
    await edit("draft A"); await submit();
    check(client.writes.length === 1, "draft submitted once");
    await edit("draft B");
    await act(async () => client.writes[0].resolve(sent("a")));
    check(host.querySelector("input").value === "draft B", "settling A preserves new draft B");
    await submit();
    await act(async () => client.writes[1].resolve(failed("b")));
    check(host.querySelector("input").value === "draft B" && host.textContent.includes("message refused"), "refusal preserves and explains the draft");
    await submit();
    await act(async () => client.writes[2].resolve({ state: "pending", id: "pending-b" }));
    check(host.querySelector("input").value === "" && host.textContent.includes("Queued"), "durable offline admission releases the draft");
    await edit("draft C"); await submit();
    check(client.writes.length === 4, "another draft need not await acknowledgement of the pending one");
    await act(async () => client.writes[3].resolve(sent("c")));
    check(host.querySelector("input").value === "", "successful unchanged draft clears");
    await edit("failed earlier draft"); await submit(); await edit("newer draft");
    await act(async () => client.writes[4].resolve(failed("earlier")));
    check(host.querySelector("input").value === "newer draft" && host.textContent.includes("failed earlier draft"), "failure retains both the submitted and current drafts");
    await submit();
    await act(async () => client.writes[5].resolve(sent("newer")));
    check(host.textContent.includes("failed earlier draft"), "a later success does not discard an unsent message");
    await unmount(); allClosed(client);
  };
}
cases["web composer fences old account callbacks and preserves saved write identities"] = async () => {
  localStorage.clear();
  const a = controlled(), b = controlled();
  b.setViewer("dev:other");
  const av = new ViewState(a, "http://starter-test", a.viewer());
  const bv = new ViewState(b, "http://starter-test", b.viewer());
  const admit = a.mutate;
  a.mutate = (op, args, options) => {
    check(av.read().intents.some(intent => intent.id === options.id), "reference is durable before SDK dispatch");
    return admit(op, args, options);
  };
  await mount(h(Composer, { key: av.key, conversationId: "a-room", view: av }), a);
  await edit("A private draft"); await submit();
  const original = av.read().intents[0].id;
  check(original.length === 26 && a.writes.length === 1 && a.writes[0].options.id === original, "saved ID is the SDK admission ID");
  av.active = false;
  await render(h(Composer, { key: bv.key, conversationId: "b-room", view: bv }), b);
  await act(async () => a.writes[0].resolve(failed(original)));
  check(!host.textContent.includes(original) && !host.textContent.includes("A private draft") && !host.textContent.includes("message refused"), "A result cannot enter B UI");
  check(b.writes.length === 0 && bv.read().intents.length === 0, "account switch does not replay A as B");
  check(av.read().intents[0].id === original, "switch preserves A reference");
  let refused = false;
  try { av.remember({ id: "late", room: "a-room", operation: "send" }); } catch { refused = true; }
  check(refused, "a delayed A callback cannot admit another reference");
  const otherBackend = new ViewState(a, "http://different-backend", a.viewer());
  check(otherBackend.read().intents.length === 0, "references do not cross backends");
  await unmount();
};
window.reactCases = cases;
`;

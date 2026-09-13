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
        { find: "snapback4/react", replacement: join(root, "packages/snapback4/src/react.tsx") },
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
          if (id === "expo-status-bar") return "\0status-bar";
          if (/snapback\/generated\/api(?:\.ts)?$/.test(id)) return "\0generated-api";
          if (id === "snapback4/local" || (id === "./src/client" && importer.endsWith("/chat-expo/App.tsx"))) return "\0open-client";
          if (id === "./src/witness" && importer.endsWith("/chat-expo/App.tsx")) return "\0witness";
          if (/\/(?:chat\/src|chat-expo)\/App\.tsx$/.test(importer) && /\/(?:Inbox|Thread)(?:\.tsx)?$/.test(id)) return "\0home-views";
        },
        load(id) {
          if (id === "\0open-client") return "export const openClient = (...args) => globalThis.openClient(...args); export const createLocalClient = openClient;";
          if (id === "\0generated-api") return 'export const api = { send: { kind: "mutation", name: "send" }, thread: { kind: "query", name: "thread" } };';
          if (id === "\0home-views") return "export const Inbox = () => null; export const Thread = () => null;";
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
import { StrictMode, act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { SnapbackProvider, useQuery, usePage, useMutation } from "snapback4/react";
import { Composer } from "web-composer";
import { Thread } from "expo-thread";
import { App as WebApp } from "web-app";
import { App as ExpoApp } from "expo-app";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.process = { env: {} };
const query = { kind: "query", name: "read" };
const mutation = { kind: "mutation", name: "write" };
const ready = (data, next = null, flags = {}) => ({ data, complete: true, fresh: true, since: 100, next, ...flags });
const check = (condition, message) => { if (!condition) throw Error(message); };
const equal = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected), message + ": " + JSON.stringify(actual));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const sent = id => ({ state: "sent", id, seq: 1 });
const failed = id => ({ state: "failed", id, why: { code: "E_INPUT", family: "input", message: "message refused" } });

function controlled(read = () => ready([])) {
  const records = [], writes = [];
  const client = {
    records, writes, closes: 0,
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
    mutate(_, args) { const result = deferred(); writes.push({ ...result, args }); return result.promise; },
    link: () => "online", onLink: () => () => {}, viewer: () => "dev:test",
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
    let obsolete;
    await act(async () => { obsolete = latest.run({ n: 5 }); });
    const replacement = controlled();
    await render(h(Probe), replacement);
    await act(async () => { client.writes[4].resolve(sent("obsolete")); await obsolete; });
    check(latest.last === undefined && !latest.inFlight, "old client's write does not settle into the new lifetime");
    let abandoned;
    await act(async () => { abandoned = latest.run({ n: 6 }); });
    await unmount();
    replacement.writes[0].resolve(sent("after-unmount")); await abandoned;
  },
  async "usePage rebinds insertion, deletion and reorder boundaries and aggregates read state"() {
    const pages = new Map([[null, ready(["a", "b"], "b")], ["b", ready(["c", "d"], "d")], ["a", ready(["b", "c"], "c")], ["c", ready(["d", "e"], "e")]]);
    const client = controlled(args => pages.get(args.c)); let latest;
    function Probe({ scope }) { latest = usePage(query, { scope }); return null; }
    await mount(h(Probe, { scope: "one" }), client);
    check(client.records.length === 2, "page construction is inert under discarded render");
    await act(async () => latest.loadMore());
    equal(latest.items, ["a", "b", "c", "d"], "initial two pages");
    const first = active(client)[0], oldSecond = active(client)[1];
    await act(async () => first.set(ready(["z", "a"], "a")));
    equal(latest.items, ["z", "a", "b", "c"], "insertion loses no boundary row");
    check(oldSecond.closes === 1, "obsolete suffix closed");
    await act(async () => first.set(ready(["b", "c"], "c")));
    equal(latest.items, ["b", "c", "d", "e"], "deletion duplicates no boundary row");
    await act(async () => first.set(ready(["e", "a"], "a", { complete: false, fresh: false, since: 10 })));
    equal(latest.items, ["e", "a", "b", "c"], "reorder replaces the suffix");
    check(!latest.read.complete && !latest.read.fresh && latest.read.since === 10, "combined state includes the earlier page");
    equal(latest.read.data, latest.items, "read data describes all combined items");
    await render(h(Probe, { scope: "two" }), client);
    equal(latest.items, ["a", "b"], "new arguments reset the requested depth");
    check(active(client).length === 1, "new arguments close every old page");
    await unmount(); allClosed(client);
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

for (const [name, Component] of [["web", Composer], ["Expo", Thread]]) {
  cases[name + " composer preserves edits, immediate failure and offline admission"] = async () => {
    const client = controlled();
    await mount(h(Component, { conversationId: "c", onBack: () => {} }), client);
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
window.reactCases = cases;
`;

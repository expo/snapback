// React's actual effect/subscription replay, with controlled transport and
// observations. Skipped only when Chromium is unavailable; no backend or
// simulator is launched. React Native host views are DOM stubs, so these cover
// the shared composer/open lifecycle rather than native layout or input APIs.
import test from "node:test";
import { reactHarness } from "./helpers/react-harness.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import ts from "typescript";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromiumExecutable } from "../../../witness/lib.mjs";
import { journalChanges } from "../dist/journal-changes.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

test("journal storage listener belongs to the last shared owner", (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget(), registered = [], removed = [], wrappers = new Map();
  const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  let deliveries = 0, aNotices = 0, bNotices = 0;
  t.mock.method(target, "addEventListener", (type, handler, options) => {
    assert.equal(type, "storage");
    registered.push(handler);
    const wrapped = event => { deliveries++; handler(event); };
    wrappers.set(handler, wrapped);
    add(type, wrapped, options);
  });
  t.mock.method(target, "removeEventListener", (type, handler, options) => {
    assert.equal(type, "storage");
    removed.push(handler);
    remove(type, wrappers.get(handler), options);
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  const key = "snapback4.test.shared-journal.writes";
  const storageChanged = () => {
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: key });
    target.dispatchEvent(event);
  };
  let a, b;
  try {
    a = journalChanges(key, () => aNotices++);
    b = journalChanges(key, () => bNotices++);
    assert.equal(registered.length, 1, "two owners share one storage listener");
    storageChanged();
    assert.deepEqual([deliveries, aNotices, bNotices], [1, 1, 1]);
    a.close();
    assert.equal(removed.length, 0, "the first close keeps the shared listener");
    storageChanged();
    assert.deepEqual([deliveries, aNotices, bNotices], [2, 1, 2]);
    b.close();
    storageChanged();
    assert.deepEqual([deliveries, aNotices, bNotices], [2, 1, 2], "after final close the event reaches no handler or owner");
    assert.equal(removed.length, 1, "the last close removes the shared listener");
    assert.equal(removed[0], registered[0], "removal uses the registered handler");
  } finally {
    a?.close(); b?.close();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

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
        { find: "test-online-custody", replacement: join(root, "packages/snapback4/src/app-online.ts") },
        { find: "test-online-dispatch", replacement: join(root, "packages/snapback4/src/online-dispatch.ts") },
        { find: "test-guard-client", replacement: join(root, "packages/snapback4/src/app-client.ts") },
        { find: "test-server-clock", replacement: join(root, "packages/snapback4/src/clock.ts") },
        { find: "snapback4/app", replacement: join(root, "packages/snapback4/src/app.ts") },
        { find: "snapback4/auth", replacement: join(root, "packages/snapback4/src/auth.ts") },
        { find: "snapback4/client", replacement: join(root, "packages/snapback4/src/client.ts") },
        { find: "snapback4/react", replacement: join(root, "packages/snapback4/src/react.tsx") },
        { find: "web-state", replacement: join(root, "apps/chat/src/state.ts") },
        { find: "web-composer", replacement: join(root, "apps/chat/src/Composer.tsx") },
        { find: "web-app", replacement: join(root, "apps/chat/src/App.tsx") },
        { find: "expo-inbox", replacement: join(root, "apps/chat-expo/src/Inbox.tsx") },
        { find: "expo-thread", replacement: join(root, "apps/chat-expo/src/Thread.tsx") },
        { find: "expo-app", replacement: join(root, "apps/chat-expo/App.tsx") },
      ] },
      plugins: [{
        name: "controlled-reference-app-dependencies",
        enforce: "pre",
        resolveId(id, importer = "") {
          if (id === "./intent-store" && importer.includes("/chat-expo/src/")) return join(root, "apps/chat-expo/src/intent-store.web.ts");
          if (id === "react-native") return "\0native-host-views";
          if (id === "snapback4-expo/witness") return "\0witness-launch";
          if (id === "expo-status-bar") return "\0status-bar";
          if (/snapback\/generated\/api(?:\.ts)?$/.test(id)) return "\0generated-api";
          if (id === "snapback4/local" || (id === "./src/client" && importer.endsWith("/chat-expo/App.tsx"))) return "\0open-client";
          if (id === "./src/witness" && importer.endsWith("/chat-expo/App.tsx")) return "\0witness";
          if (/\/(?:chat\/src|chat-expo)\/App\.tsx$/.test(importer) && /\/(?:Inbox|Thread)(?:\.tsx)?$/.test(id)) return "\0home-views";
        },
        load(id) {
          if (id === "\0open-client") return `
            export const openClient = (...args) => globalThis.openClient(...args);
            export const createLocalClient = openClient;
            export const persona = undefined;
            export const url = "http://starter-test";
            export async function openApp(...args) {
              const client = await openClient(...args);
              const snapshot = { state: "signed-in", viewer: client.viewer() };
              return { client, auth: { getSnapshot: () => snapshot, onChange: () => () => {} }, close: () => client.close() };
            }
          `;
          if (id === "\0generated-api") return 'export const api = { send: { kind: "mutation", name: "send" }, markRead: { kind: "mutation", name: "markRead" }, room: { kind: "query", name: "room" }, thread: { kind: "query", name: "thread" }, inbox: { kind: "query", name: "inbox" } };';
          if (id === "\0home-views") return "export const Inbox = () => null; export const Thread = () => null;";
          if (id === "\0witness-launch") return "export const witness = () => null;";
          if (id === "\0witness") return "export const runWitness = () => Promise.resolve();";
          if (id === "\0status-bar") return "export const StatusBar = () => null;";
          if (id === "\0native-host-views") return `
            import { createElement as h } from "react";
            export const View = ({ children }) => h("div", null, children);
            export const SafeAreaView = View;
            export const Text = ({ children }) => h("span", null, children);
            export const FlatList = ({ data, renderItem, ListEmptyComponent, onEndReached }) => h("div", null, data.length ? data.map((item, index) => h("div", { key: index }, renderItem({ item }))) : ListEmptyComponent, onEndReached && h("button", { onClick: onEndReached }, "Load more"));
            export const Pressable = ({ children, onPress }) => h("button", { onClick: onPress }, children);
            export const TextInput = ({ value, onChangeText, placeholder }) => h("input", { value, onChange: e => onChangeText(e.target.value), placeholder });
            export const Button = ({ title, disabled, onPress }) => h("button", { disabled, onClick: onPress }, title);
            export const StyleSheet = { create: value => value, hairlineWidth: 1 };
          `;
        },
      }],
    });
    await server.listen();
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
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
    await t.test("shared online journal invalidates pending hooks across browser tabs", async () => {
      const peer = await page.context().newPage();
      try {
        await peer.goto(server.resolvedUrls.local[0]);
        await peer.waitForFunction(() => typeof window.openPendingPeer === "function");
        await page.evaluate(async () => { localStorage.clear(); window.pendingPeer = await window.openPendingPeer(); await window.pendingPeer.mount(); });
        await peer.evaluate(async () => { window.pendingPeer = await window.openPendingPeer(); await window.pendingPeer.submit(); });
        await page.waitForFunction(() => window.pendingPeer.snapshot()[0]?.state === "sent");
        await page.evaluate(async () => { await window.pendingPeer.unmount(); await window.pendingPeer.mount(); });
        await page.waitForFunction(() => window.pendingPeer.snapshot()[0]?.state === "sent");
        await peer.evaluate(() => window.pendingPeer.settle());
        await page.waitForFunction(() => window.pendingPeer.snapshot().length === 0);
        assert.deepEqual(await page.evaluate(() => window.pendingPeer.client.pendingWrites()), []);
        await page.evaluate(() => window.pendingPeer.pause());
        const notices = await page.evaluate(() => window.pendingPeer.notices());
        await peer.evaluate(() => window.pendingPeer.submit());
        await page.waitForTimeout(50);
        assert.equal(await page.evaluate(() => window.pendingPeer.notices()), notices, "paused custody detaches shared invalidations");
      } finally {
        await page.evaluate(() => window.pendingPeer?.close());
        await peer.evaluate(() => window.pendingPeer?.close());
        await peer.close();
      }
    });
    await t.test("closing the last journal owner during admission still invalidates another tab", async () => {
      const peer = await page.context().newPage();
      try {
        await peer.goto(server.resolvedUrls.local[0]);
        await peer.waitForFunction(() => typeof window.openPendingPeer === "function");
        await page.evaluate(async () => { localStorage.clear(); window.pendingPeer = await window.openPendingPeer(); await window.pendingPeer.mount(); window.pendingPeer.holdStorage(); });
        const admitted = await peer.evaluate(async () => {
          window.pendingPeer = await window.openPendingPeer();
          return window.pendingPeer.closeOnAdmission();
        });
        assert.equal(admitted.state, "pending", "closing on notification cannot refuse committed custody");
        await page.waitForFunction(() => window.pendingPeer.notices() >= 2 && window.pendingPeer.earlyReads() >= 2 && window.pendingPeer.storageEvents() >= 2);
        await page.evaluate(() => window.pendingPeer.releaseStorage());
        await page.waitForFunction(id => window.pendingPeer.snapshot().some(w => w.id === id), admitted.id);
        assert.deepEqual(await page.evaluate(async () => (await window.pendingPeer.client.pendingWrites()).map(w => [w.id, w.state])),
          [[admitted.id, "queued"]], "A's hook and durable list see B's admission after B closes");
      } finally {
        await page.evaluate(() => window.pendingPeer?.close());
        await peer.evaluate(() => window.pendingPeer?.close());
        await peer.close();
      }
    });
    await t.test("clearing localStorage in another tab invalidates the journal hook", async () => {
      const peer = await page.context().newPage();
      try {
        await peer.goto(server.resolvedUrls.local[0]);
        const admitted = await page.evaluate(async () => {
          localStorage.clear();
          window.pendingPeer = await window.openPendingPeer();
          await window.pendingPeer.mount();
          return window.pendingPeer.submit();
        });
        await page.waitForFunction(id => window.pendingPeer.snapshot().some(w => w.id === id && w.state === "sent"), admitted.id);
        assert.deepEqual(await page.evaluate(async () => (await window.pendingPeer.client.pendingWrites()).map(w => w.id)), [admitted.id]);
        // No peer client or broadcast: clear emits a real key=null storage
        // event, which must reread the journal and update the mounted hook.
        await peer.evaluate(() => localStorage.clear());
        await page.waitForFunction(() => window.pendingPeer.snapshot().length === 0);
        assert.deepEqual(await page.evaluate(() => window.pendingPeer.client.pendingWrites()), []);
      } finally {
        await page.evaluate(() => window.pendingPeer?.close());
        await peer.close();
      }
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    rmSync(temporary, { recursive: true, force: true });
  }
});

const expiryRecipe = ts.transpile(readFileSync(new URL("../CLIENT-AND-OPERATIONS.md", import.meta.url), "utf8")
  .match(/function useExpiringRows[\s\S]*?\n}/)[0], { target: ts.ScriptTarget.ES2022 });
const receiptsRecipe = ts.transpile(readFileSync(new URL("../../../crates/snapback4-lang/src/guide/receipts.rs", import.meta.url), "utf8")
  .match(/function runsOf[\s\S]*?\nfunction useReceipts[\s\S]*?\n}/)[0], { target: ts.ScriptTarget.ES2022 });
const harness = reactHarness(expiryRecipe, receiptsRecipe);

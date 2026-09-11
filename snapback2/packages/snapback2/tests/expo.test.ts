import { assertRefused } from "./live-fixture.ts";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { statSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire, register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { build } from "esbuild";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { api, browserTokenStore, createClient } from "../dist/client.mjs";
import { RefusalError, composeHistory } from "../dist/client-observed-test.mjs";
import { nodeSqliteDriver } from "../dist/sqlite-test.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { fakeOwner, seededStore } from "./fake-owner.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__snapbackNative ??= { React, fileUris: [], fileBodies: new Map(), videoSources: [] };
register(new URL("./native-mocks/loader.mjs", import.meta.url));
const expoEntry = await import("../dist/expo.mjs");
const nativeEntry = await import("../dist/react-native.mjs");
const coreEntry = await import("../dist/react-core.mjs");
const { SnapbackProvider, createExpoClient, expoSecureTokenStore, expoSqliteDriver } = expoEntry;
const { useSnapbackClient, useConnection, useAuth, useMutation, useOutbox, useSnapbackSnapshot } = nativeEntry;
const { witnessControl, runSqliteDriverConformance } = await import("../dist/expo/witness.mjs");

test("Expo starter account screen uses real signup, login, guest and logout with shared identity", async () => {
  const bundlePath = fileURLToPath(new URL("../dist/.expo-auth.test.mjs", import.meta.url));
  const bundled = await build({ entryPoints: [fileURLToPath(new URL("../templates/chat/expo/src/Auth.tsx", import.meta.url))],
    bundle: true, write: false, format: "esm", jsx: "automatic", external: ["react", "react/jsx-runtime", "react-native", "snapback2/react-native"] });
  await writeFile(bundlePath, bundled.outputFiles[0]!.text);
  const { Auth } = await import(pathToFileURL(bundlePath).href);
  const secure = expoSecureTokenStore("template", secureFake());
  const paths: string[] = [];
  const client = createClient({ url: "http://native-auth.test", tokenStore: secure, fetch: async (input, init) => {
    const path = new URL(String(input)).pathname; paths.push(path);
    assert.equal(new Headers(init?.headers).get("X-Snapback-As"), null);
    if (path === "/api/auth/me") return Response.json({ code: "E_AUTH_REQUIRED", family: "auth", message: "Sign in", guide: "auth" }, { status: 401 });
    if (path === "/api/auth/logout") return Response.json({ ok: true });
    if (path.startsWith("/api/auth/")) {
      const guest = path.endsWith("guest");
      if (!guest) assert.deepEqual(JSON.parse(String(init?.body)), { email: "native@example.test", password: "password" });
      return Response.json({ token: guest ? "guest-token" : "account-token", viewer: guest ? "guest-id" : "account-id", kind: guest ? "guest" : "user" });
    }
    return Response.json({ generation: "g", programGeneration: "p", ops: {}, channels: {}, auth: {} });
  } });
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  function Identity() { return React.createElement("Identity", null, nativeEntry.useViewer()); }
  const press = async (title: string) => { await act(async () => {
    renderer!.root.findAllByType("NativeButton").find(node => node.props.title === title)!.props.onPress();
    await new Promise<void>(resolve => setImmediate(resolve));
  }); };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client }, React.createElement(Auth, null, React.createElement(Identity)))); await client.ready; });
    assert.equal(renderer!.root.findAllByType("Identity").length, 0);
    for (const action of ["Sign up", "Log in", "Continue as guest"]) {
      await act(async () => { for (const field of renderer!.root.findAllByType("NativeTextInput")) field.props.onChangeText(field.props.secureTextEntry ? "password" : "native@example.test"); });
      await press(action);
      assert.equal(renderer!.root.findByType("Identity").children[0], action === "Continue as guest" ? "guest-id" : "account-id");
      assert.equal(await secure.load(), action === "Continue as guest" ? "guest-token" : "account-token");
      await press("Log out");
      assert.equal(renderer!.root.findAllByType("Identity").length, 0);
      assert.equal(await secure.load(), null);
    }
    assert.ok(["signup", "login", "guest", "logout", "me"].every(action => paths.includes(`/api/auth/${action}`)));
  } finally { if (renderer) await act(async () => renderer!.unmount()); await client.close(); await rm(bundlePath, { force: true }); }
});

// Keep the real shared outbox read model when a test supplies transport doubles.
const outboxBundle = await build({ entryPoints: [fileURLToPath(new URL("../src/client-outbox-observed.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node" });
const { observeOutbox } = await import(`data:text/javascript;base64,${Buffer.from(outboxBundle.outputFiles[0]!.contents).toString("base64")}`);
function observeTestOutbox(client: any) {
  client.outbox.observe = observeOutbox(() => client.outbox.entries(), (op: unknown) => client.outbox.status(op),
    (notify: () => void) => client.outbox.subscribe(notify), () => String(client.snapshot.authGeneration));
}

for (const arm of ["Expo", "React"]) test(`${arm} renders real loading-history drafts and keeps the bubble into a usable composite`, async () => {
  const bundlePath = fileURLToPath(new URL("../dist/.expo-thread-history.test-bundle.mjs", import.meta.url));
  const bundled = await build({
    stdin: {
      contents: arm === "Expo" ? 'export { Thread } from "./screens/Thread";' : 'export { Thread } from "./Thread";',
      resolveDir: fileURLToPath(new URL(`../templates/chat/${arm.toLowerCase()}/src`, import.meta.url)),
      sourcefile: "expo-thread.tsx",
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-native"],
    plugins: [{
      name: "package-dist",
      setup(plugin) {
        plugin.onResolve({ filter: /^snapback2\/(react|react-native|client)$/ }, (args) => ({
          path: `./${args.path.slice("snapback2/".length)}.mjs`, external: true,
        }));
      },
    }],
  });
  await writeFile(bundlePath, bundled.outputFiles[0]!.text);
  const { Thread } = await import(`${pathToFileURL(bundlePath).href}?fresh=${Date.now()}`);
  const listeners = new Set<() => void>();
  const observed: string[] = [];
  const message = { messageId: "message-held", at: 1, kind: "message",
    message: { id: "message-held", at: 1, authorId: "profile-alice", body: "independently held" } };
  const items = [{ key: "message-held", data: message.message, predicted: false, pending: [] }];
  const reason = { code: "partial", message: "Some data is not downloaded." };
  const receipt = { state: "partial", source: "twin", seq: 1, next: null };
  const primary: any = { status: "unavailable", data: undefined, partial: false, next: null, reason, receipt, items };
  const history: any = { status: "ready", data: [message], items, receipt: { ...receipt, state: "complete" } };
  let snapshot: any = composeHistory(primary, history);
  const client: any = {
    ready: Promise.resolve(),
    snapshot: { authGeneration: 1, connection: "offline", auth: { state: "authenticated", viewer: "profile-alice" } },
    observe(ref: any, _args: unknown, options: any) {
      observed.push(`${ref.op}${options?.items?.history ? "+history" : ""}`);
      return { getSnapshot: () => snapshot, subscribe(notify: () => void) { listeners.add(notify); return () => { listeners.delete(notify); }; } };
    },
    subscribeStatus() { return () => undefined; },
    manifest: async () => ({}),
    mutation: async () => ({ state: "rejected" }),
    outbox: {
      entries: async () => [],
      subscribe(notify: (entries: any[]) => void) { notify([]); return () => undefined; },
      status: async () => ({ ready: false, reason: "sealed", action: "sign-in", remaining: 0, fence: "past" }),
      dismiss: async () => undefined,
    },
  };
  observeTestOutbox(client);
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  const publish = async (next: any) => {
    snapshot = next;
    await act(async () => { for (const notify of [...listeners]) notify(); });
  };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client },
      React.createElement(Thread, { conversationId: "conversation-1" }))); });
    assert.deepEqual(observed, ["messages.conversationView+history"], "one observation, carrying the declared history");
    const partialTree = JSON.stringify(renderer!.toJSON());
    assert.match(partialTree, /independently held/);
    assert.match(partialTree, /Message count unavailable/);
    assert.match(partialTree, /Count and preview unavailable/);

    const draft = { key: "draft-1", data: { id: "draft-1", body: "hidden primary row", at: 1 },
      draft: { body: "unfinished local send" }, predicted: true,
      pending: [{ intent: "intent-1", kind: "create", state: "queued", label: "Sending…", dismissible: false }] };
    const loading = composeHistory({ ...primary, items: [...items, draft] }, { status: "loading", items: [] } as any);
    assert.equal(loading.partial, false);
    assert.equal(loading.itemsFrom, "drafts");
    assert.equal(loading.history.status, "loading");
    assert.equal(loading.items.length, 1);
    assert.equal(loading.items[0].data, undefined);
    await publish(loading);
    const loadingTree = JSON.stringify(renderer!.toJSON());
    assert.match(loadingTree, /Count and preview unavailable/, "loading history is still the fallback in force");
    assert.doesNotMatch(loadingTree, /independently held|hidden primary row/);
    assert.match(loadingTree, /unfinished local send|Sending…/);
    assert.match(loadingTree, /Message count unavailable/);
    const bubble = () => arm === "Expo"
      ? renderer!.root.findAllByType("NativeView").find(node => node.props.testID === "message-draft-1")
      : renderer!.root.findAllByType("li").find(node => node.props["data-message"] === "draft-1");
    const pending = bubble(); assert.ok(pending);
    if (arm === "React") {
      assert.equal(renderer!.root.findByType("ol").props["data-view-source"], "partial-history");
      assert.equal(renderer!.root.findByType("ol").props["data-view-state"], "loading");
      assert.equal(renderer!.root.findAllByType("p").find(node => node.props.className === "thread-history-note")!.props["data-history-state"], "loading");
    }
    const value = { messages: [message], count: 1, preview: [message] };
    await publish(composeHistory({ status: "ready", data: value, partial: false, next: null,
      receipt: { ...receipt, state: "complete" }, items: [...items, { ...draft, data: { ...draft.data, body: draft.draft.body } }] } as any, undefined));
    assert.strictEqual(bubble(), pending, "the drafts-only bubble survives composite publication");
    if (arm === "React") assert.equal(renderer!.root.findByType("ol").props["data-view-source"], "composite");
    const usableTree = JSON.stringify(renderer!.toJSON());
    assert.match(usableTree, /1 message · Latest: independently held/);
    assert.doesNotMatch(usableTree, /Count and preview unavailable/);
    assert.equal(observed.length, 1, "the same composed observation serves every state");
  } finally {
    await act(async () => { renderer?.unmount(); });
    await rm(bundlePath, { force: true });
  }
});

for (const arm of ["Expo", "React"]) test(`${arm} cached once-photo waits for account confirmation and cannot reopen on logout`, async t => {
  const bundlePath = fileURLToPath(new URL(`../dist/.${arm.toLowerCase()}-thread-once.test-bundle.mjs`, import.meta.url));
  const bundled = await build({
    stdin: { contents: arm === "Expo" ? 'export { Thread } from "./screens/Thread";' : 'export { Thread } from "./Thread";',
      resolveDir: fileURLToPath(new URL(`../templates/chat/${arm.toLowerCase()}/src`, import.meta.url)), sourcefile: "once-entry.tsx", loader: "tsx" },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022", jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-native"],
    plugins: [{ name: "package-dist", setup(plugin) {
      plugin.onResolve({ filter: /^snapback2\/(react|react-native|client)$/ }, args => ({
        path: `./${args.path.slice("snapback2/".length)}.mjs`, external: true,
      }));
    } }],
  });
  await writeFile(bundlePath, bundled.outputFiles[0]!.text);
  const { Thread } = await import(pathToFileURL(bundlePath).href);
  const owner = fakeOwner();
  const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
  let confirm!: () => void;
  const confirmation = new Promise<void>(done => { confirm = done; });
  const requests: string[] = [];
  const client = createClient({ url: "http://once-account.test", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/auth/me") await confirmation;
    if (path === "/api/auth/logout") return new Response(JSON.stringify({ ok: true }));
    if (path.startsWith("/api/asset/")) {
      requests.push(client.snapshot.auth.state);
      return new Response(png, { headers: { "content-type": "image/png" } });
    }
    return owner.fetch(input, init);
  } });
  const message = { id: "cached-once", at: 1, authorId: "dev:alice", oncePhoto: {
    id: "s2id-00000000000000000000000000000008-0000000000000001", width: 8, height: 8,
  } };
  // Keep the cached row visible even after logout: query reset must not mask a screen-owned opening.
  const held = { status: "ready", data: undefined, partial: true, next: null,
    items: [{ key: message.id, data: message, predicted: false, pending: [] }] };
  client.observe = () => ({ getSnapshot: () => held, subscribe: () => () => undefined }) as any;
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  function Screen() {
    return React.createElement(Thread, { conversationId: "conversation-1" });
  }
  const bubble = () => arm === "Expo"
    ? renderer!.root.findAllByType("NativeView").find(node => node.props.testID === "message-cached-once")!
    : renderer!.root.findByProps({ "data-message": "cached-once" });
  const list = () => renderer!.root.findByType(arm === "Expo" ? "NativeScrollView" : "ol");
  const button = () => bubble().findAllByType(arm === "Expo" ? "NativeButton" : "button")
    .find(node => arm === "Expo" ? node.props.title === "View photo once" : node.props.children === "View photo once");
  const images = () => bubble().findAllByType(arm === "Expo" ? "NativeImage" : "img");
  const press = async () => { await act(async () => {
    const control = button()!;
    (arm === "Expo" ? control.props.onPress : control.props.onClick)();
    await new Promise(done => setImmediate(done));
  }); };
  try {
    await client.ready;
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client }, React.createElement(Screen)), {
      createNodeMock: element => element.type === "img" ? { getBoundingClientRect: () => ({ width: 240 }) } : null,
    }); });
    assert.equal(client.snapshot.auth.state, "hydrating");
    assert.equal(client.snapshot.auth.viewer ?? client.snapshot.auth.restoringViewer, undefined);
    const originalList = list(), originalBubble = bubble();
    const disabled = button()!.props.disabled === true;
    // Invoke the callback even when disabled to prove it cannot record an unknown opening.
    await press();
    const unknown = { disabled, images: images().length, requests: requests.length };
    t.diagnostic(`unknown: ${JSON.stringify(unknown)}`);
    assert.deepEqual(unknown, { disabled: true, images: 0, requests: 0 });
    await act(async () => { confirm(); await client.auth.me(); });
    assert.equal(client.snapshot.auth.viewer, "dev:alice");
    assert.equal(button()!.props.disabled, false, "confirmation must not find a recorded unknown opening");
    assert.equal(images().length, 0);
    assert.equal(requests.length, 0);
    await press();
    assert.equal(button(), undefined);
    assert.equal(images().length, 1);
    assert.ok(arm === "Expo" ? images()[0].props.source?.uri : images()[0].props.src, "the real asset component received bytes");
    assert.deepEqual(requests, ["authenticated"], "the confirmed account spends exactly one opening");
    assert.strictEqual(list(), originalList);
    assert.strictEqual(bubble(), originalBubble);
    await act(async () => { await client.auth.logout(); });
    assert.equal(client.snapshot.auth.state, "anonymous");
    assert.strictEqual(list(), originalList, "logout keeps the conversation/list mounted");
    assert.strictEqual(bubble(), originalBubble, "the same cached once-photo remains visible");
    assert.equal(images().length, 0, "the old opening cannot re-match anonymous identity");
    assert.equal(button()!.props.disabled, true);
    await press();
    assert.equal(images().length, 0);
    assert.deepEqual(requests, ["authenticated"], "logout and its disabled callback cannot request more bytes");
    t.diagnostic("confirmed: 1 image, 1 authenticated asset request; logout: 0 images, 0 additional requests; list and bubble unchanged");
  } finally {
    confirm(); await act(async () => renderer?.unmount()); await client.close();
    await rm(bundlePath, { force: true });
  }
});

for (const arm of ["Expo", "React"]) for (const boundary of ["logout/re-login", "A→B→A", "restoring confirmation"])
test(`${arm} once-photo opening scope: ${boundary}`, async t => {
  const bundlePath = fileURLToPath(new URL(`../dist/.${arm.toLowerCase()}-thread-scope.test-bundle.mjs`, import.meta.url));
  const bundled = await build({
    stdin: { contents: arm === "Expo" ? 'export { Thread } from "./screens/Thread";' : 'export { Thread } from "./Thread";',
      resolveDir: fileURLToPath(new URL(`../templates/chat/${arm.toLowerCase()}/src`, import.meta.url)), sourcefile: "scope-entry.tsx", loader: "tsx" },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022", jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-native"],
    plugins: [{ name: "package-dist", setup(plugin) {
      plugin.onResolve({ filter: /^snapback2\/(react|react-native|client)$/ }, args => ({
        path: `./${args.path.slice("snapback2/".length)}.mjs`, external: true,
      }));
    } }],
  });
  await writeFile(bundlePath, bundled.outputFiles[0]!.text);
  const { Thread } = await import(`${pathToFileURL(bundlePath).href}?boundary=${encodeURIComponent(boundary)}`);
  const owner = fakeOwner(), restoring = boundary === "restoring confirmation";
  const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
  let confirm!: () => void, principal = "dev:alice";
  const confirmation = new Promise<void>(done => { confirm = done; });
  const requests: string[] = [];
  const client = createClient({ url: "http://once-scope.test",
    ...(restoring ? { tokenStore: { load: () => "token-alice", save: () => undefined,
      loadPrincipalBinding: () => ({ token: "token-alice", principal: "dev:alice" }), savePrincipal: () => undefined } } : {}),
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/auth/me") { await confirmation; return Response.json({ viewer: principal, kind: "user" }); }
      if (path === "/api/auth/login") {
        principal = JSON.parse(String(init?.body)).email === "bob@example.com" ? "dev:bob" : "dev:alice";
        return Response.json({ token: `token-${principal}`, viewer: principal, kind: "user" });
      }
      if (path === "/api/auth/logout") return Response.json({ ok: true });
      if (path.startsWith("/api/asset/")) {
        requests.push(principal);
        return new Response(png, { headers: { "content-type": "image/png" } });
      }
      return owner.fetch(input, init);
    } });
  const message = { id: "cached-once", at: 1, authorId: "dev:alice", oncePhoto: {
    id: "s2id-00000000000000000000000000000008-0000000000000001", width: 8, height: 8,
  } };
  // Keep the row across every auth transition so query invalidation cannot hide an old opening.
  const held = { status: "ready", data: undefined, partial: true, next: null,
    items: [{ key: message.id, data: message, predicted: false, pending: [] }] };
  client.observe = () => ({ getSnapshot: () => held, subscribe: () => () => undefined }) as any;
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  const commits: { account: string | null | undefined; images: number }[] = [];
  function Screen() {
    const { session: auth } = useAuth();
    React.useLayoutEffect(() => { if (renderer) commits.push({
      account: auth.state === "anonymous" ? null : auth.viewer ?? auth.restoringViewer, images: images().length,
    }); });
    return React.createElement(Thread, { conversationId: "conversation-1" });
  }
  const bubble = () => arm === "Expo"
    ? renderer!.root.findAllByType("NativeView").find(node => node.props.testID === "message-cached-once")!
    : renderer!.root.findByProps({ "data-message": "cached-once" });
  const list = () => renderer!.root.findByType(arm === "Expo" ? "NativeScrollView" : "ol");
  const images = () => bubble().findAllByType(arm === "Expo" ? "NativeImage" : "img");
  const button = () => bubble().findAllByType(arm === "Expo" ? "NativeButton" : "button")
    .find(node => arm === "Expo" ? node.props.title === "View photo once" : node.props.children === "View photo once");
  const press = async () => { await act(async () => {
    const control = button()!;
    (arm === "Expo" ? control.props.onPress : control.props.onClick)();
    await new Promise(done => setImmediate(done));
  }); };
  const login = async (name: string) => { await act(async () => {
    await client.auth.login({ email: `${name}@example.com`, password: "password" });
    await new Promise(done => setImmediate(done));
  }); };
  try {
    await client.ready;
    if (!restoring) { confirm(); await client.auth.me(); }
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client }, React.createElement(Screen)), {
      createNodeMock: element => element.type === "img" ? { getBoundingClientRect: () => ({ width: 240 }) } : null,
    }); });
    const originalList = list(), originalBubble = bubble();
    if (restoring) {
      assert.equal(client.snapshot.auth.viewer, undefined);
      assert.equal(client.snapshot.auth.restoringViewer, "dev:alice");
    }
    assert.equal(button()!.props.disabled, false);
    await press();
    assert.equal(images().length, 1);
    const openedImage = images()[0];
    commits.length = 0;
    if (restoring) {
      await act(async () => { confirm(); await client.auth.me(); await new Promise(done => setImmediate(done)); });
      assert.equal(client.snapshot.auth.viewer, "dev:alice");
      assert.strictEqual(images()[0], openedImage, "same-account confirmation preserves the opening and mounted image");
      assert.ok(commits.length > 0 && commits.every(commit => commit.account === "dev:alice" && commit.images === 1));
      assert.deepEqual(requests, ["dev:alice"], "confirmation completes the explicit opening exactly once");
      assert.ok(arm === "Expo" ? images()[0].props.source?.uri : images()[0].props.src);
      t.diagnostic("restoring dev:alice → confirmed dev:alice: same mounted image; exactly 1 Alice byte request; list and bubble unchanged");
    } else {
      assert.deepEqual(requests, ["dev:alice"]);
      if (boundary === "logout/re-login") await act(async () => { await client.auth.logout(); });
      else await login("bob");
      assert.ok(commits.length > 0 && commits.every(commit => commit.images === 0), "the changed scope commits no old asset");
      assert.equal(images().length, 0);
      assert.deepEqual(requests, ["dev:alice"]);
      if (boundary === "A→B→A") { await press(); assert.deepEqual(requests, ["dev:alice", "dev:bob"]); }
      const spent = [...requests];
      commits.length = 0;
      await login("alice");
      t.diagnostic(`${boundary}: return to Alice: images=${images().length}, additional requests=${requests.length - spent.length}, commits=${JSON.stringify(commits)}`);
      assert.ok(commits.length > 0 && commits.every(commit => commit.account === "dev:alice" && commit.images === 0), "no return-to-Alice commit may auto-mount an old opening");
      assert.equal(button()!.props.disabled, false, "returning Alice must choose to open again");
      assert.deepEqual(requests, spent, "returning Alice cannot automatically re-request her photo");
      await press();
      assert.equal(images().length, 1);
      assert.deepEqual(requests, [...spent, "dev:alice"], "only the new explicit click requests Alice bytes");
    }
    assert.strictEqual(list(), originalList, "account transitions keep the conversation/list mounted");
    assert.strictEqual(bubble(), originalBubble, "the cached bubble never remounts");
  } finally {
    confirm(); await act(async () => renderer?.unmount()); await client.close();
    await rm(bundlePath, { force: true });
  }
});

test("the Expo witness samples the composed observation only once eligible history has loaded, and reports a timeout", async () => {
  const bundlePath = fileURLToPath(new URL("../dist/.expo-composed-facts.test-bundle.mjs", import.meta.url));
  const bundled = await build({
    stdin: { contents: 'export { composedFacts } from "./composed-facts";',
      resolveDir: fileURLToPath(new URL("../templates/chat/expo/src", import.meta.url)), sourcefile: "facts.ts", loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "node", target: "es2022",
    plugins: [{ name: "package-dist", setup(plugin) {
      plugin.onResolve({ filter: /^snapback2\/client$/ }, () => ({ path: "./client.mjs", external: true }));
    } }],
  });
  await writeFile(bundlePath, bundled.outputFiles[0]!.text);
  const { composedFacts } = await import(`${pathToFileURL(bundlePath).href}?fresh=${Date.now()}`);
  const offline = { freshness: { live: false, connection: "offline" }, local: { predicted: [], retained: false } };
  const loadingHistory = { status: "loading", ...offline, items: [] };
  const readyHistory = { status: "ready", data: [], ...offline, items: [{ key: "m", data: { id: "m" }, predicted: false, pending: [] }] };
  let history: any = loadingHistory;
  let subscriptions = 0;
  const client: any = { observe: () => ({
    getSnapshot: () => ({ status: "unavailable", receipt: { state: "partial", source: "twin", seq: 1 }, ...offline,
      itemsFrom: history.status === "ready" ? "history" : "drafts", items: history.items, history }),
    subscribe: () => { subscriptions += 1; return () => { subscriptions -= 1; }; },
  }) };
  try {
    setTimeout(() => { history = readyHistory; }, 80);
    const settled = await composedFacts(client, "c", 2_000);
    assert.deepEqual(settled, { itemsFrom: "history", status: "unavailable", verdict: "partial",
      history: { status: "ready", verdict: null }, keys: ["m"], timedOut: false }, "a data-less partial waits for its history");
    history = loadingHistory;
    const gaveUp = await composedFacts(client, "c", 60);
    assert.equal(gaveUp.timedOut, true, "a sample that gave up says so");
    assert.equal(gaveUp.itemsFrom, "drafts");
    assert.equal(subscriptions, 0, "the helper releases its own subscription");
  } finally {
    await rm(bundlePath, { force: true });
  }
});

function secureFake() {
  const values = new Map<string, string>();
  const reads: string[] = [];
  const deletes: string[] = [];
  let failure = false;
  const keyCheck = (key: string) => assert.match(key, /^[A-Za-z0-9._-]+$/);
  return {
    values, reads, deletes,
    fail(value: boolean) { failure = value; },
    async getItemAsync(key: string) { keyCheck(key); reads.push(key); return values.get(key) ?? null; },
    async setItemAsync(key: string, value: string) {
      keyCheck(key);
      assert.ok(new TextEncoder().encode(value).byteLength <= 2048);
      if (failure) throw new Error("keychain locked");
      values.set(key, value);
    },
    async deleteItemAsync(key: string) { keyCheck(key); deletes.push(key); values.delete(key); },
  };
}

test("Expo production Hermes lowering keeps frozen evaluator state writable and brands unforgeable", async () => {
  // Keep transformed output under the package so Expo's injected @babel/runtime helpers resolve as Metro resolves them.
  const root = await mkdtemp(fileURLToPath(new URL(".row-image-expo-", import.meta.url)));
  try {
    const require = createRequire(import.meta.url);
    const expoRequire = createRequire(require.resolve("expo/package.json"));
    const presetPath = expoRequire.resolve("babel-preset-expo");
    const babel = createRequire(presetPath)("@babel/core");
    const metroCaller = {
      name: "metro", bundler: "metro", platform: "android", engine: "hermes",
      isDev: false, isServer: false, isNodeModule: true, supportsStaticESM: true,
    };
    const transform = async (source: string, filename: string) => {
      const result = await babel.transformAsync(source, {
        babelrc: false, configFile: false, filename,
        // Runtime helpers are inlined only so this standalone transformed module can execute outside Metro's resolver.
        presets: [[presetPath, { enableBabelRuntime: false }]], sourceType: "module", caller: metroCaller,
      });
      assert(result?.code);
      const output = join(root, filename);
      await writeFile(output, result.code);
      return import(`${pathToFileURL(output).href}?fresh=${Date.now()}`);
    };

    const legacy = await transform(
      `export class LegacyImage { #digest; constructor() { Object.freeze(this); } digest() { return this.#digest ??= "cached"; } }`,
      "legacy-image.mjs",
    );
    assert.throws(() => new legacy.LegacyImage().digest(), /read.only|writable|frozen/i,
      "the former frozen private-field cache fails after the production Hermes transform");

    const legacyReceipt = await transform(
      `export class LegacyReceipt { #prepared; #wire; constructor(value, prepared, wire) {
        for (const [key, child] of Object.entries(value)) Object.defineProperty(this, key, { value: child, enumerable: true });
        this.#prepared = prepared; this.#wire = wire; Object.setPrototypeOf(this, Object.prototype); Object.freeze(this);
      } static own(value, prepared, wire) { return new LegacyReceipt(value, prepared, wire); }
        static get(value, wire) { return value && typeof value === "object" && #prepared in value && value.#wire === wire ? value.#prepared : undefined; } }`,
      "legacy-receipt.mjs",
    );
    const legacyPrepared = {};
    const heldLegacy = legacyReceipt.LegacyReceipt.own({ site: "issued" }, legacyPrepared, false);
    const forgedLegacy = Object.create(Object.getPrototypeOf(heldLegacy), {
      ...Object.getOwnPropertyDescriptors(heldLegacy), site: { value: "altered", enumerable: true },
    });
    assert.equal(legacyReceipt.LegacyReceipt.get(forgedLegacy, false), legacyPrepared,
      "the former lowered private-field guard can be copied onto altered public fields");

    const source = await readFile(new URL("../dist/image-runtime.mjs", import.meta.url), "utf8");
    const { RowImage, ImageKeys, RangeReceipt } = await transform(source, "image-runtime.mjs");
    const schema = { tables: { rows: {
      columns: { id: "Id", body: { Text: { max: 40 } }, note: { Optional: { Text: { max: 40 } } } },
      indexes: { byId: { components: [{ Column: "id" }], unique: true } },
      rules: { read: "Allow", insert: "Deny", update: "Deny", delete: "Deny" },
      constraints: [], retain: "until-revoked",
    } }, maintains: [], channels: {}, auth: { password: false, guests: false }, effects: [] };
    const image = RowImage.prepare(schema, "rows", { Row: { id: { Id: "r1" }, body: { String: "hello" } } });
    assert(Object.isFrozen(image));
    assert.equal(RowImage.digest(image), RowImage.digest(image), "lazy digest cache survives frozen Expo output");
    const firstKeys = RowImage.keys(image);
    const replacement = ImageKeys.restore(structuredClone(firstKeys));
    assert.notEqual(replacement, firstKeys);
    assert.equal(RowImage.keys(image, replacement), replacement, "equivalent key ownership can be rebound lazily");
    const forgedImage = Object.create(Object.getPrototypeOf(image), Object.getOwnPropertyDescriptors(image));
    const forgedKeys = Object.create(Object.getPrototypeOf(replacement), Object.getOwnPropertyDescriptors(replacement));
    assert(!RowImage.is(forgedImage));
    assert(!ImageKeys.is(forgedKeys));
    const prepared = {};
    const heldRange = RangeReceipt.own({ site: "issued" }, prepared, false);
    assert.equal(RangeReceipt.get(heldRange, false), prepared);
    const forgedRange = Object.create(Object.getPrototypeOf(heldRange), {
      ...Object.getOwnPropertyDescriptors(heldRange), site: { value: "altered", enumerable: true },
    });
    assert.equal(RangeReceipt.get(forgedRange, false), undefined,
      "copied descriptors cannot transfer prepared-range custody to altered public fields");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Expo SecureStore uses legal keys, caches reads, bounds values, and deletes token plus principal", async () => {
  const fake = secureFake();
  const store = expoSecureTokenStore("app-1.x_y", fake);
  assert.throws(() => expoSecureTokenStore("has:colon", fake), TypeError);
  assert.throws(() => expoSecureTokenStore("", fake), TypeError);
  await Promise.all([store.load(), store.load()]);
  assert.deepEqual(fake.reads, ["snapback2.app-1.x_y.token"]);
  await store.save("bearer");
  await store.savePrincipal("principal");
  assert.equal(await store.load(), "bearer");
  assert.equal(await store.loadPrincipal(), "principal");
  assert.equal(fake.reads.length, 1);
  assert.deepEqual([...fake.values.keys()], ["snapback2.app-1.x_y.token", "snapback2.app-1.x_y.principal"]);
  await assert.rejects(store.save("雪".repeat(683)), /2 KB/);
  assert.equal(await store.load(), "bearer");
  fake.fail(true);
  await assert.rejects(store.save("new bearer"), /locked/);
  assert.equal(await store.load(), "bearer", "failed writes do not publish a cached token");
  await store.save(null);
  assert.deepEqual(fake.deletes.sort(), ["snapback2.app-1.x_y.principal", "snapback2.app-1.x_y.token"]);
  assert.equal(fake.values.size, 0);
  assert.equal(await store.load(), null);
  assert.equal(await store.loadPrincipal(), null);
});

test("Expo driver scopes statements to the exclusive executor and normalizes null", async () => {
  const calls: string[] = [];
  const connection = (name: string) => ({
    async runAsync(_sql, _params) { calls.push(`${name}.run`); },
    async getFirstAsync(_sql, _params) { calls.push(`${name}.get`); return null; },
    async getAllAsync(_sql, _params) { calls.push(`${name}.all`); return []; },
  });
  (globalThis as any).__snapbackExpoSqlite = async (name, options) => {
    assert.equal(name, "conformance.db");
    assert.deepEqual(options, { useNewConnection: true });
    return { ...connection("outer"), async execAsync() {}, async closeAsync() { calls.push("close"); },
      async withExclusiveTransactionAsync(body) { calls.push("begin"); await body(connection("tx")); calls.push("commit"); } };
  };
  const driver = expoSqliteDriver("conformance.db");
  assert.equal(driver.identity, "expo-sqlite:file:///documents/SQLite/conformance.db");
  assert.notEqual(driver.identity, expoSqliteDriver("separate.db").identity);
  // Two spellings of one file must not earn two locks: a name is a plain basename or it is refused.
  for (const alias of ["/conformance.db", "./conformance.db", "sub/../conformance.db", "..", ".hidden.db", "a\\b.db"]) {
    assert.throws(() => expoSqliteDriver(alias), TypeError, `${alias} is not a plain database name`);
  }
  assert.equal(await driver.get("missing"), undefined);
  assert.equal(await driver.transaction(async (tx) => {
    await tx.run("insert", [new Uint8Array([1])]);
    assert.equal(await tx.get("missing"), undefined);
    assert.deepEqual(await tx.all("all"), []);
    return 7;
  }), 7);
  await driver.close();
  assert.deepEqual(calls, ["outer.get", "begin", "tx.run", "tx.get", "tx.all", "commit", "close"]);
});

test("Expo COMMIT failure rolls back its exclusive connection and the next queued transaction succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-expo-commit-"));
  const path = join(root, "commit.db");
  const outer = new DatabaseSync(path);
  const failure = new Error("Expo commit failed once");
  const calls: string[] = [];
  let failCommit = true;
  const connection = (database: DatabaseSync) => ({
    async runAsync(sql, params) { database.prepare(sql).run(...params); },
    async getFirstAsync(sql, params) { return database.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql, params) { return database.prepare(sql).all(...params); },
  });
  (globalThis as any).__snapbackExpoSqlite = async () => ({ ...connection(outer),
    async execAsync(sql) { outer.exec(sql); },
    async closeAsync() { outer.close(); },
    // SDK 54 owns BEGIN/COMMIT/ROLLBACK and closes the exclusive connection in finally.
    async withExclusiveTransactionAsync(body) {
      const tx = new DatabaseSync(path);
      try {
        calls.push("begin"); tx.exec("BEGIN");
        await body(connection(tx));
        calls.push("commit");
        if (failCommit) { failCommit = false; throw failure; }
        tx.exec("COMMIT");
      } catch (error) {
        calls.push("rollback"); tx.exec("ROLLBACK"); throw error;
      } finally { calls.push("close"); tx.close(); }
    },
  });
  const driver = expoSqliteDriver("commit.db");
  try {
    await driver.exec("CREATE TABLE attempts (value INTEGER)");
    const failed = driver.transaction((tx) => tx.run("INSERT INTO attempts VALUES (1)"));
    const next = driver.transaction((tx) => tx.run("INSERT INTO attempts VALUES (2)"));
    await assert.rejects(failed, (error) => error === failure);
    await next;
    assert.deepEqual((await driver.all<{ value: number }>("SELECT value FROM attempts")).map((row) => row.value), [2]);
    assert.deepEqual(calls, ["begin", "commit", "rollback", "close", "begin", "commit", "close"]);
  } finally { await driver.close(); await rm(root, { recursive: true, force: true }); }
});

test("built native entries exclude node and IndexedDB, share react-core, and ship source maps", async () => {
  for (const name of ["expo", "react-native"]) {
    const source = await readFile(new URL(`../dist/${name}.mjs`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /node:|indexedDB/);
    assert.match(source, /snapback2\/react-core/);
    assert.doesNotMatch(source, /createContext/);
    const map = JSON.parse(await readFile(new URL(`../dist/${name}.mjs.map`, import.meta.url), "utf8"));
    assert.ok(map.sources.length > 0);
  }
  const core = await readFile(new URL("../dist/react-core.mjs", import.meta.url), "utf8");
  assert.match(core, /createContext/);
  assert.doesNotMatch(core, /node:|indexedDB/);
});

test("Metro resolves browser React before native while retaining native and default entries and types", async () => {
  const require = createRequire(import.meta.url);
  const { getDefaultConfig } = require("expo/metro-config");
  const metroRequire = createRequire(require.resolve("expo/metro-config"));
  const { resolvePackageTargetFromExports } = metroRequire("metro-resolver/private/PackageExportsResolve");
  const ts = require("typescript");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const { resolver } = getDefaultConfig(root);
  // SDK 54 scopes react-native to iOS/Android; older/custom Metro configs also
  // assert it globally, so web can receive BOTH browser and react-native.
  for (const globalNative of [false, true]) {
    for (const platform of ["web", "ios", "android", null]) {
      const conditions = [...resolver.unstable_conditionNames, ...(globalNative ? ["react-native"] : [])];
      const native = platform !== "web" && (globalNative || platform === "ios" || platform === "android");
      const expected = native ? "react-native" : "react";
      const context = {
        isESMImport: true,
        unstable_conditionNames: conditions,
        unstable_conditionsByPlatform: resolver.unstable_conditionsByPlatform,
        assetExts: new Set(resolver.assetExts),
        fileSystemLookup(path: string) {
          try { return { exists: true, type: statSync(path).isFile() ? "f" : "d", realPath: realpathSync(path) }; }
          catch { return { exists: false }; }
        },
      };
      const label = `${platform ?? "default"}, global native=${globalNative}`;
      const resolved = resolvePackageTargetFromExports(context, root, "snapback2/react", "react", pkg.exports, platform);
      assert.equal(resolved.filePath, join(root, `dist/${expected}.mjs`), label);
      const declarations = ts.resolveModuleName("snapback2/react", join(root, "consumer.ts"), {
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        customConditions: [...conditions, ...(resolver.unstable_conditionsByPlatform[platform] ?? [])],
      }, ts.sys).resolvedModule;
      assert.equal(declarations?.resolvedFileName, join(root, `dist/${expected}.d.ts`), `${label}: types`);
    }
  }
  const web = await import("../dist/react.mjs");
  assert.equal(typeof web.indexedDbRangeStore, "function");
  assert.ok(!("indexedDbRangeStore" in nativeEntry));
  assert.equal(typeof browserTokenStore, "function", "browser token custody is exported by client");
});

test("built Expo entry exports every native component and hook by name", () => {
  for (const entry of [nativeEntry, expoEntry]) assert.equal(typeof entry.usePage, "function");
  const nativeNames = Object.keys(nativeEntry).filter((name) => !(name in coreEntry)).sort();
  assert.ok(nativeNames.includes("AssetImage") && nativeNames.includes("AssetVideo"));
  assert.deepEqual(Object.keys(expoEntry).filter((name) => nativeNames.includes(name)).sort(), nativeNames);
  for (const name of nativeNames) assert.equal(typeof expoEntry[name], typeof nativeEntry[name], name);
});

test("native provider preserves a cold transport cut through rerenders and identity replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-provider-cut-"));
  const store = fileRangeStore(root), owner = fakeOwner();
  await seededStore(store);
  let requests = 0, resumes = 0, current: any, renderer: any;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests++;
    if (String(input).includes("/api/resume")) resumes++;
    return owner.fetch(input, init);
  };
  function Probe() { current = useSnapbackClient(); nativeEntry.useQuery(api.messages.inbox, {}); return null; }
  const tree = (persona = "alice", startOffline = true) => React.createElement(React.StrictMode, {},
    React.createElement(SnapbackProvider, { url: "http://provider-cut.test", persona, startOffline, fetch, offline: { store } }, React.createElement(Probe)));
  try {
    await act(async () => { renderer = TestRenderer.create(tree()); });
    await act(async () => { await current.ready; });
    const first = current;
    await act(async () => { renderer.update(tree()); });
    assert.equal(current, first);
    assert.equal(requests, 0); assert.equal(resumes, 0);
    await act(async () => { await current.online(); });
    assert.ok(requests > 0); assert.ok(resumes > 0);
    await act(async () => { await first.close(); });
    requests = resumes = 0;
    await act(async () => { renderer.update(tree("bob")); });
    await act(async () => { await current.ready; });
    assert.notEqual(current, first);
    assert.equal(requests, 0); assert.equal(resumes, 0);
    await act(async () => { await current.online(); });
    assert.ok(requests > 0);
    const online = current;
    await act(async () => { renderer.update(tree("bob", false)); });
    assert.notEqual(current, online, "startOffline participates in provider construction identity");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await current?.close(); await new Promise(resolve => setTimeout(resolve, 20));
    await rm(root, { recursive: true, force: true });
  }
});

test("emitted web declarations exclude node modules and SQLite test exports", async () => {
  for (const name of ["react", "client", "react-core"]) {
    const source = await readFile(new URL(`../dist/${name}.d.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /node:|sqlite-exports|native-modules/);
  }
  await assert.rejects(readFile(new URL("../dist/store/sqlite-node.d.ts", import.meta.url)), { code: "ENOENT" });
});

test("compiler source imports no Expo fetch or filesystem modules", async () => {
  const ts = createRequire(import.meta.url)("typescript");
  const root = new URL("../../compiler/src/", import.meta.url).pathname;
  const sources = ts.sys.readDirectory(root, [".ts", ".tsx", ".js", ".jsx"]);
  assert.ok(sources.length > 0);
  // Compiler mappings exist only for transitive client files; they must never type-check compiler imports.
  for (const path of sources) {
    const { importedFiles } = ts.preProcessFile(await readFile(path, "utf8"), true, true);
    for (const imported of importedFiles) {
      assert.ok(!["expo/fetch", "expo-file-system"].includes(imported.fileName), `${path}: ${imported.fileName}`);
    }
  }
});

test("native development dependencies match Expo SDK 54 and use real expo-sqlite declarations", async () => {
  const require = createRequire(import.meta.url);
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const expected = { expo: "54.0.37", "expo-sqlite": "16.0.10", "expo-secure-store": "15.0.8",
    "expo-file-system": "19.0.24", "expo-video": "3.0.16", "react-native": "0.81.5", react: "19.1.0" };
  for (const [name, version] of Object.entries(expected)) {
    assert.equal(pkg.devDependencies[name], version, `${name}: reproducible pin`);
    assert.equal(require(`${name}/package.json`).version, version, `${name}: installed version`);
  }
  const ts = require("typescript");
  const source = new URL("../src/store/sqlite-expo.ts", import.meta.url).pathname;
  const resolved = ts.resolveModuleName("expo-sqlite", source, { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys).resolvedModule;
  assert.match(resolved.resolvedFileName, /expo-sqlite\/build\/index\.d\.ts$/);
  const build = await readFile(new URL("../build.mjs", import.meta.url), "utf8");
  assert.match(build, /types: \[\]/);
  assert.doesNotMatch(build, /paths:\s*\{/);
});

test("built witness conformance opens two connections and reports WAL plus every check name", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-expo-conformance-"));
  const opened: unknown[] = [];
  try {
    const result = await runSqliteDriverConformance(() => {
      const driver = nodeSqliteDriver(join(root, "witness.db"));
      opened.push(driver);
      return driver;
    });
    assert.equal(opened.length, 2);
    assert.notEqual(opened[0], opened[1]);
    assert.equal(result.journalMode, "wal");
    assert.deepEqual(result.checks, ["journal_mode readback", "BLOB 1", "BLOB 1048576", "BLOB 0",
      "JSON tuple key round trip", "missing row is undefined", "rollback on throw",
      "real COMMIT failure rolls back and next transaction succeeds", "late beforeCommit holds transaction", "transaction result"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("replacing a supplied client clears authentication, mutations, and outbox readiness before delayed work settles", async () => {
  const deferred = () => {
    let resolve!: (value: any) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const bobMe = deferred(), aliceReady = deferred(), bobReady = deferred();
  const owner = fakeOwner();
  const alice = createClient({ url: "http://swap.test", persona: "alice", fetch: owner.fetch });
  const bob = createClient({ url: "http://swap.test", persona: "bob", fetch: async (input, init) =>
    String(input).endsWith("/api/auth/me") ? new Response(JSON.stringify(await bobMe.promise)) : owner.fetch(input, init) });
  await Promise.all([alice.ready, bob.ready]);
  assert.equal(alice.snapshot.authGeneration, bob.snapshot.authGeneration);
  const lateSuccess = deferred(), lateFailure = deferred(), bobMutation = deferred();
  let delayAlice = false;
  let emitAlice!: (entries: any[]) => void;
  let aliceEntries = [{ intent: "alice", op: "send", state: "queued" }];
  alice.outbox.entries = async () => aliceEntries;
  alice.outbox.subscribe = (callback) => { emitAlice = entries => { aliceEntries = entries; callback(entries); }; callback(aliceEntries); return () => undefined; };
  const readiness = (ready: boolean) => ({ ready, reason: "ready" as const, action: "none" as const, remaining: 1, fence: "inside" as const });
  alice.outbox.status = () => (delayAlice ? aliceReady.promise : Promise.resolve(true)).then(readiness);
  bob.outbox.subscribe = (callback) => { callback([{ intent: "bob", op: "send", state: "queued" }]); return () => undefined; };
  bob.outbox.entries = async () => [{ intent: "bob", op: "send", state: "queued" }];
  bob.outbox.status = () => bobReady.promise.then(readiness);
  observeTestOutbox(alice); observeTestOutbox(bob);
  const transport = new RefusalError({ code: "E_TRANSPORT", family: "owner", message: "alice transport", guide: "owner" }, true);
  alice.mutation = async (_ref, args: any) => {
    if (args.stage === "last") return { state: "committed", seq: 1, data: "alice" };
    if (args.stage === "transport") throw transport;
    return args.stage === "late-success" ? lateSuccess.promise : lateFailure.promise;
  };
  bob.mutation = () => bobMutation.promise;
  let current: any;
  const renders: any[] = [];
  function Consumer() {
    current = { client: useSnapbackClient(), snapshot: useSnapbackSnapshot(), auth: useAuth(), mutation: useMutation(api.send), outbox: useOutbox() };
    renders.push(current);
    return null;
  }
  const tree = (client) => React.createElement(SnapbackProvider, { client }, React.createElement(Consumer));
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(tree(alice)); });
    await act(async () => { await current.mutation.run({ stage: "last" }); });
    await act(async () => { await assertRefused(current.mutation.run({ stage: "transport" })); });
    assert.equal(current.auth.session.viewer, "dev:alice");
    assert.equal(current.mutation.last.code, "E_TRANSPORT");
    assert.equal(current.mutation.last.retryable, true);
    assert.equal(current.mutation.can.send, true);
    assert.deepEqual(current.outbox.entries.map((entry) => entry.intent), ["alice"]);
    let oldSuccess, oldFailure;
    await act(async () => {
      oldSuccess = current.mutation.run({ stage: "late-success" });
      oldFailure = current.mutation.run({ stage: "late-failure" }).catch((error) => error);
      delayAlice = true;
      emitAlice([{ intent: "late-alice", op: "send", state: "queued" }]);
    });
    assert.equal(current.mutation.inFlight, true);
    renders.length = 0;
    await act(async () => { renderer.update(tree(bob)); });
    for (const view of renders) {
      assert.equal(view.client, bob);
      assert.equal(view.snapshot.persona, "bob", "even the first render uses Bob's snapshot");
      assert.equal(view.auth.session.viewer, undefined);
      assert.equal(view.auth.session.state, "hydrating");
      assert.equal(view.mutation.last, undefined);
      assert.equal(view.mutation.inFlight, false);
      assert.equal(view.mutation.can.send, false);
      assert.deepEqual(view.outbox.entries, []);
    }
    let newRun;
    await act(async () => {
      bobMe.resolve({ viewer: "dev:bob", kind: "dev" });
      bobReady.resolve(true);
      newRun = current.mutation.run({});
    });
    await act(async () => {
      aliceReady.resolve(true);
      emitAlice([{ intent: "after-unsubscribe", op: "send", state: "queued" }]);
      lateSuccess.resolve({ state: "committed", seq: 2, data: "late-alice" });
      lateFailure.reject(transport);
      await Promise.all([oldSuccess, oldFailure]);
    });
    assert.equal(current.auth.session.viewer, "dev:bob");
    assert.equal(current.mutation.last, undefined);
    assert.equal(current.mutation.inFlight, true, "Alice's completion cannot decrement Bob's pending run");
    assert.equal(current.outbox.can.send, true);
    assert.deepEqual(current.outbox.entries.map((entry) => entry.intent), ["bob"]);
    await act(async () => { bobMutation.resolve({ state: "committed", seq: 3, data: "bob" }); await newRun; });
    assert.equal(current.mutation.last.data, "bob");
    assert.equal(current.mutation.inFlight, false);
  } finally { if (renderer) await act(async () => renderer.unmount()); await alice.close(); await bob.close(); }
});

test("built Expo provider and native hook share one context; supplied client remains caller-owned", async () => {
  const client = createClient({ url: "http://context.test", persona: "alice", fetch: fakeOwner().fetch });
  let observed: unknown;
  function Consumer() { observed = useSnapbackClient(); return React.createElement("status", null, useConnection()); }
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(React.StrictMode, null,
    React.createElement(SnapbackProvider, { client }, React.createElement(Consumer)))); });
  assert.equal(observed, client);
  await act(async () => renderer.unmount());
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.notEqual(client.snapshot.connection, "offline", "unmount does not close caller-owned clients");
  await client.close();
});

test("createExpoClient defaults to Expo fetch and secure custody, preserves overrides, and never adds tokenStore beside as", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-expo-"));
  const fake = secureFake();
  (globalThis as any).__snapbackSecureStore = fake;
  let requests = 0;
  const owner = fakeOwner();
  const fetch = async (input, init) => { requests++; return owner.fetch(input, init); };
  (globalThis as any).__snapbackNative.expoFetch = fetch;
  const offline = { store: fileRangeStore(root) };
  const persona = createExpoClient({ url: "http://expo.test", persona: "alice", offline });
  let bearer;
  let customCalls = 0;
  const custom = createExpoClient({ url: "http://expo.test", tokenStore: { load: () => null, save() {} },
    fetch: async (input, init) => { customCalls++; return fetch(input, init); }, offline });
  try {
    await persona.ready;
    assert.equal(fake.reads.length, 0, "persona constructor supplies no token store");
    bearer = createExpoClient({ url: "http://expo.test", offline });
    await bearer.ready;
    assert.ok(fake.reads.includes("snapback2.default.token"));
    await persona.manifest();
    assert.ok(requests >= 1);
    // An explicit invalid custody combination must fail with createClient's exact error.
    const invalid = { url: "http://expo.test", persona: "alice", tokenStore: { load: () => null, save() {} }, offline };
    let expected;
    try { createClient(invalid as any); } catch (error) { expected = error; }
    assert.throws(() => createExpoClient(invalid as any), (error) => error instanceof TypeError && error.message === expected.message);
    assert.equal(typeof witnessControl, "function");
    await custom.ready;
    await custom.manifest();
    assert.equal(customCalls, 1);
  } finally { await persona.close(); await bearer?.close(); await custom.close(); await rm(root, { recursive: true, force: true }); }
});


test("createExpoClient defaults to the SQLite carrier and refuses a native open failure", async () => {
  const fake = secureFake();
  (globalThis as any).__snapbackSecureStore = fake;
  let opened;
  (globalThis as any).__snapbackExpoSqlite = async (name) => { opened = name; throw new Error("native file unavailable"); };
  const client = createExpoClient({ url: "http://expo.test", persona: "sqlite-default", fetch: fakeOwner().fetch });
  try {
    await assert.rejects(client.ready, (error: any) => error.code === "E_OFFLINE_CARRIER" && /native file unavailable/.test(error.message));
    assert.equal(opened, "snapback2.db");
    assert.equal(fake.reads.length, 0);
  } finally { await client.close(); }
});

test("browser and SecureStore principal records retain the authenticating token across a stale writer", async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const secure = secureFake();
  for (const factory of [() => browserTokenStore(storage, "binding"), () => expoSecureTokenStore("binding", secure)]) {
    const first = factory();
    await first.save("token-a");
    await first.savePrincipal("alice", "token-a");
    const second = factory();
    await second.savePrincipal(null);
    await second.save("token-b");
    // A late auth/me from the first instance must keep A's binding, even
    // though B's bearer already occupies the other persisted key.
    await first.savePrincipal("alice", "token-a");
    const cold = factory();
    assert.equal(await cold.load(), "token-b");
    assert.deepEqual(await cold.loadPrincipalBinding(), { token: "token-a", principal: "alice" });
    await cold.savePrincipal("bob", "token-b");
    assert.deepEqual(await factory().loadPrincipalBinding(), { token: "token-b", principal: "bob" });
  }
});


test("Expo provider and two native auth hooks share one cut/reconnect flight", async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const secure = expoSecureTokenStore("auth-parity", secureFake());
  await secure.save("token-a"); await secure.savePrincipal("alice", "token-a");
  let cut = true, requests = 0;
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const client = createClient({ url: "http://expo-auth.test", tokenStore: secure, fetch: async input => {
    if (String(input).endsWith("/api/auth/me")) {
      requests++;
      if (cut) throw new TypeError("cut");
      return pending;
    }
    return Response.json({ generation: "g", programGeneration: "p", ops: {}, channels: {}, auth: {} });
  } });
  const views: any[] = [];
  function Probe({ index }: { index: number }) { views[index] = useAuth(); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await client.ready; await flush();
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client },
      React.createElement(Probe, { index: 0 }), React.createElement(Probe, { index: 1 }))); await flush(); });
    assert.equal(requests, 2, "initial cut plus the Provider manifest transition");
    assert.deepEqual(views[0], views[1]);
    assert.equal(views[0].session.state, "hydrating");
    assert.equal(views[0].session.restoringViewer, "alice");
    await act(async () => { cut = false; await client.offline(); await client.online(); await flush(); });
    assert.equal(requests, 3);
    const one = client.auth.me(), two = client.auth.me();
    await act(async () => { await client.offline(); await client.online(); await flush(); });
    assert.equal(requests, 3);
    await act(async () => { finish(Response.json({ viewer: "alice", kind: "user", authEpoch: 1 })); await Promise.all([one, two]); await flush(); });
    assert.deepEqual(views[0], views[1]);
    assert.equal(views[0].session.viewer, "alice");
    assert.equal(views[0].session.kind, "user");
  } finally {
    finish(Response.json({ viewer: "alice", kind: "user" }));
    if (renderer) await act(async () => renderer.unmount());
    await client.close();
  }
});

test("native provider owns one client through StrictMode and inline offline options, then closes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-native-provider-"));
  const disk = fileRangeStore(root), owner = fakeOwner();
  let opens = 0, closes = 0, current: any, renderer: any;
  const store = () => {
    const held = disk(), open = held.open.bind(held), close = held.close.bind(held);
    held.open = async (...args) => { opens++; return open(...args); };
    held.close = async () => { closes++; await close(); };
    return held;
  };
  function Probe() { current = useSnapbackClient(); return null; }
  const tree = () => React.createElement(React.StrictMode, {}, React.createElement(SnapbackProvider,
    { url: "http://native-provider.test", persona: "alice", offline: { store }, fetch: owner.fetch }, React.createElement(Probe)));
  try {
    await act(async () => { renderer = TestRenderer.create(tree()); });
    await current.ready;
    const first = current;
    await act(async () => { renderer.update(tree()); });
    assert.equal(current, first); assert.equal(current.snapshot.persona, "alice"); assert.equal(opens, 1);
    assert.equal(closes, 0);
    await act(async () => { renderer.unmount(); }); renderer = undefined;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(closes, 1);
  } finally { if (renderer) await act(async () => renderer.unmount()); await current?.close(); await rm(root, { recursive: true, force: true }); }
});

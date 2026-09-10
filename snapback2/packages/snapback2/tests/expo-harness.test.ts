import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire, register } from "node:module";
import { fileURLToPath } from "node:url";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { nativeFixture, deferred, photo, clip, delivery, payload } from "./native-fixture.ts";
import { assertNoMediaOnDisk } from "../../../scripts/witness-expo/container.mjs";
import { twinSource } from "../../../scripts/witness-expo/attribution.mjs";
import { controlServer } from "../../../scripts/witness-expo/control.mjs";
import { RealOwnerHarness } from "./owner-harness.ts";
import { subscribe } from "../src/internal.js";
import { api, createClient, mutationTarget } from "../dist/client.mjs";
import { fileRangeStore } from "../dist/test.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(packageRoot, "../..");
const execute = promisify(execFile);
const tick = () => act(async () => { await new Promise((done) => setTimeout(done, 1)); });
async function until(predicate: () => boolean, label: string | (() => string) = "native rendered state") {
  for (let i = 0; i < 1000 && !predicate(); i++) await tick();
  assert.ok(predicate(), typeof label === "function" ? label() : label);
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__snapbackNative ??= { React, fileBodies: new Map(), fileUris: [], videoSources: [] };
register(new URL("./native-mocks/loader.mjs", import.meta.url));
const { SnapbackProvider, useAuth } = await import("../dist/expo.mjs");
const { MediaView, configuration, persist, NormalApp, Chat, Composer, Thread } = await import("../dist/witness-test.mjs");

test("built Expo under Hermes-like globals logs in, drains, and views a photo", async () => {
  const { stdout } = await execute(process.execPath, [join(packageRoot, "tests/hermes-expo.ts")], { timeout: 5_000 });
  assert.match(stdout, /Hermes-like built Expo: login, drain, photo PASS/);
});

test("Expo app shows a readiness error after the client is already constructed", async () => {
  const original = (globalThis as any).__snapbackExpoSqlite;
  const originalSecure = (globalThis as any).__snapbackSecureStore;
  (globalThis as any).__snapbackSecureStore = {
    getItemAsync: async (key: string) => key.endsWith(".token") ? "device-session" : JSON.stringify({ token: "device-session", principal: "dev:alice" }),
    setItemAsync: async () => undefined, deleteItemAsync: async () => undefined,
  };
  (globalThis as any).__snapbackExpoSqlite = async () => { throw new Error("device carrier refused"); };
  let renderer!: ReturnType<typeof TestRenderer.create>;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(NormalApp)); });
    await until(() => JSON.stringify(renderer.toJSON()).includes("device carrier refused"));
    assert.match(JSON.stringify(renderer.toJSON()), /device carrier refused/);
  } finally { if (renderer) await act(async () => renderer.unmount()); (globalThis as any).__snapbackExpoSqlite = original; (globalThis as any).__snapbackSecureStore = originalSecure; }
});

test("witness source map contains the portable conformance runner under src and no tests", async () => {
  const map = JSON.parse(await readFile(join(packageRoot, "dist/expo/witness.mjs.map"), "utf8"));
  assert.ok(map.sources.some((path: string) => path.endsWith("/src/store/sqlite-driver.conformance.ts")));
  assert.ok(map.sources.every((path: string) => !path.includes("/tests/")));
  const rows = (await readFile(join(workspace, "metrics/expo.jsonl"), "utf8")).trim().split("\n");
  assert.equal(rows.length, 1); assert.ok(JSON.parse(rows[0]).method.includes("Hermes") || JSON.parse(rows[0]).method.includes("HBC"));
  assert.ok(!rows[0].includes("/Users/") && !rows[0].includes("/home/"));
});

test("native file queue rechecks view-once after a waiting materialization", async () => {
  const f = await nativeFixture(); const held = deferred(), writing = deferred();
  try {
    await f.client.assetCache!.putBytes(photo.id, 8, payload);
    f.hooks.write = async () => { writing.resolve(); await held.promise; };
    const first = f.files.get(f.client.assetCache!, photo.id, 8); await writing.promise;
    const second = f.files.get(f.client.assetCache!, photo.id, 8);
    await tick(); f.client.assetCache!.viewOnce = async () => true;
    held.resolve();
    assert.equal(await first, undefined); assert.equal(await second, undefined);
    assert.equal(f.writes.length, 1, "only the write started before viewing; the queued read never writes");
    assert.equal(f.data.size, 0);
  } finally { held.resolve(); await f.close(); }
});

test("MediaView ordinary onLoad waits for its file source; undefined source reports loaded false", async () => {
  const f = await nativeFixture(); const held = deferred(), writing = deferred();
  f.hooks.write = async () => { writing.resolve(); await held.promise; };
  const results: any[] = [];
  const media = { asset: photo, nonce: 1, once: false, loaded: false, resolve: (value) => results.push(value) };
  let renderer!: ReturnType<typeof TestRenderer.create>;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client: f.client }, React.createElement(MediaView, { media }))); });
    await writing.promise;
    await until(() => renderer.root.findByType("NativeImage").props.source?.uri.startsWith("data:"));
    await act(async () => renderer.root.findByType("NativeImage").props.onLoad());
    assert.deepEqual(results, [], "memory wins the first load, but cannot satisfy ordinary file acceptance");
    held.resolve(); await until(() => renderer.root.findByType("NativeImage").props.source?.uri.startsWith("file://"));
    await act(async () => renderer.root.findByType("NativeImage").props.onLoad({ nativeEvent: { source: { uri: "data:image/png;base64,AQID" } } }));
    assert.deepEqual(results, [], "a late memory-source event cannot masquerade as file loading");
    await act(async () => renderer.root.findByType("NativeImage").props.onLoad({ nativeEvent: { source: renderer.root.findByType("NativeImage").props.source } }));
    assert.equal(results[0].loaded, true); assert.match(results[0].uri, /^file:\/\//);
    await act(async () => f.store.seal());
    await act(async () => renderer.root.findByType("NativeImage").props.onLoad());
    assert.deepEqual(results.at(-1), { loaded: false });
  } finally { held.resolve(); if (renderer) await act(async () => renderer.unmount()); await f.close(); }
});

test("MediaView observes native video playback and cannot reopen a viewed photo or video", async () => {
  const f = await nativeFixture({ once: true }); const results: any[] = [];
  let renderer!: ReturnType<typeof TestRenderer.create>;
  const view = (asset, nonce, hidden = false) => React.createElement(SnapbackProvider, { client: f.client },
    React.createElement(MediaView, { key: nonce, media: { asset, nonce, once: true, hidden, loaded: false, resolve: (value) => results.push(value) } }));
  try {
    await act(async () => { renderer = TestRenderer.create(view(photo, 1)); });
    await until(() => Boolean(renderer.root.findByType("NativeImage").props.source));
    await act(async () => renderer.root.findByType("NativeImage").props.onLoad());
    assert.match(results[0].uri, /^data:/); assert.equal(results[0].loaded, true);
    await act(async () => renderer.update(view(photo, 2, true))); await until(() => results.length > 1);
    assert.equal(renderer.root.findByType("NativeImage").props.source, undefined); assert.equal(results.at(-1).loaded, false);
    await f.store.commit({ deliveries: [delivery("video", clip)] });
    f.requests.length = 0;
    await act(async () => renderer.update(view(clip, 3)));
    await until(() => renderer.root.findAllByType("NativeMemoryVideo").length === 1);
    await act(async () => renderer.root.findByType("NativeMemoryVideo").props.onPlaybackStart({ nativeEvent: {} }));
    assert.equal(results.at(-1).loaded, true); assert.equal(results.at(-1).playing, true);
    assert.equal(await f.client.assetCache!.viewed(clip.id), true);
    assert.equal(f.requests.length, 1); assert.deepEqual(f.writes, []); assert.equal(f.data.size, 0);
    await act(async () => renderer.update(view(clip, 4, true))); await until(() => results.length === 4);
    assert.equal(results.at(-1).loaded, false); assert.equal(results.at(-1).uri, undefined);
    assert.equal(await f.client.assetCache!.viewed(clip.id), true); assert.equal(f.requests.length, 1);
  } finally { if (renderer) await act(async () => renderer.unmount()); await f.close(); }
});

test("witness configuration temp rename preserves the prior version on failure and merges serialized patches", async () => {
  const native = (globalThis as any).__snapbackNative; native.fileBodies.clear();
  try {
    await persist({ name: "alice", offline: true });
    native.beforeMove = () => { throw new Error("kill before rename"); };
    await assert.rejects(persist({ offline: false }), /kill before rename/);
    assert.equal((await configuration()).offline, true);
    native.beforeMove = undefined;
    await Promise.all([persist({ offline: false }), persist({ fault: "carrier" })]);
    assert.deepEqual(await configuration(), { name: "alice", offline: false, fault: "carrier", assets: [] });
    assert.equal([...native.fileBodies.keys()].filter((name: any) => name.endsWith(".json")).length, 1);
  } finally { native.beforeMove = undefined; native.fileBodies.clear(); }
});

test("attribution regex matches actual esbuild input-map sources and excludes non-twin client modules", async () => {
  const maps = await Promise.all(["client", "client-runtime"].map(async entry =>
    JSON.parse(await readFile(join(packageRoot, `dist/${entry}.mjs.map`), "utf8"))));
  const map = { sources: [...new Set(maps.flatMap(map => map.sources as string[]))] };
  const matched = map.sources.filter((path: string) => twinSource.test(path));
  assert.ok(matched.some((path: string) => path.endsWith("/src/twin.ts")));
  assert.ok(matched.some((path: string) => path.endsWith("/src/twin-hydrate.ts")));
  assert.ok(matched.some((path: string) => path.includes("evaluator/src/")));
  const expected = map.sources.filter((path: string) => path.includes("evaluator/src/") || ["../src/twin.ts", "../src/twin-hydrate.ts"].includes(path));
  assert.deepEqual(matched, expected);
  assert.ok(map.sources.some((path: string) => path.endsWith("/src/client.ts") && !twinSource.test(path)));
});

test("container-wide witness scan finds private payloads in URLSession cache, tmp, Documents, and remuxed video", async () => {
  const root = await mkdtemp(join(tmpdir(), "e2-container-"));
  const bytes = await readFile(join(workspace, "scripts/witness-expo/view-once.mp4"));
  const forbidden = [{ id: clip.id, bytes }];
  try {
    for (const name of ["Library/Caches/com.apple.nsurlsessiond/Cache.db", "tmp/player.mp4", "Documents/hidden"]) {
      const path = join(root, name); await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.concat([Buffer.from("database prefix"), bytes, Buffer.from("suffix")]));
      await assert.rejects(assertNoMediaOnDisk(root, forbidden), /bytes on disk/); await rm(path);
    }
    const mdat = bytes.indexOf(Buffer.from("mdat")); assert.ok(mdat > 0);
    const path = join(root, "tmp/remuxed.mp4");
    await writeFile(path, bytes.subarray(mdat + 4, mdat - 4 + bytes.readUInt32BE(mdat - 4)));
    await assert.rejects(assertNoMediaOnDisk(root, forbidden), /bytes on disk/); await rm(path);
    await assertNoMediaOnDisk(root, forbidden);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// @ref LLP 1018.003#5-the-certified-thread-projection — the scaffold ships no shared reducer module; every relative import still resolves.
test("fresh chat Expo scaffold from dist resolves every relative import", async () => {
  const root = await mkdtemp(join(tmpdir(), "e2-scaffold-"));
  try {
    await execute(join(workspace, "target/debug/snapback2"), ["init", root, "--template", "chat", "--client", "expo", "--json"], {
      cwd: workspace, env: { ...process.env, SNAPBACK2_TEMPLATES: join(packageRoot, "dist/templates"), SNAPBACK2_COMPILER: join(packageRoot, "dist/compiler.mjs") }, timeout: 10_000,
    });
    const walk = async (directory: string): Promise<string[]> => (await Promise.all((await readdir(directory, { withFileTypes: true }))
      .filter((entry) => !entry.name.startsWith(".")).map((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
    let imports = 0;
    for (const file of (await walk(root)).filter((file) => /\.[cm]?[jt]sx?$/.test(file))) {
      const content = await readFile(file, "utf8");
      for (const match of content.matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.[^"']+)["']/g)) {
        const target = resolve(dirname(file), match[1]); imports++;
        const candidates = /\.[a-z]+$/.test(target) ? [target] : [target, ...[".ts", ".tsx", ".js", ".jsx", ".json", ...(file.includes("/snapback/") ? [".q"] : []), "/index.ts", "/index.js"].map((ext) => target + ext)];
        assert.ok((await Promise.all(candidates.map((path) => stat(path).then((s) => s.isFile(), () => false)))).some(Boolean), `${file}: unresolved ${match[1]}`);
      }
    }
    assert.ok(imports >= 12, `expected the scaffold's own relative imports, saw ${imports}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("control server refuses a second socket without replacing the active controller", async () => {
  const server = await controlServer(0);
  const require = createRequire(import.meta.url); const { WebSocket } = require("ws");
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const opened = (value) => new Promise((done, fail) => { value.once("open", done); value.once("error", fail); });
  try {
    await opened(socket); const generation = server.generation;
    socket.on("message", (data) => { const { id } = JSON.parse(String(data)); socket.send(JSON.stringify({ id, ok: true, result: "first" })); });
    const second = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const closed = new Promise<number>((done) => second.once("close", done)); await opened(second);
    assert.equal(await closed, 1008); assert.equal(server.generation, generation);
    assert.equal(await server.command("state"), "first");
  } finally { socket.terminate(); await server.close(); }
});

test("control reset after kill closes a stale socket and accepts the relaunched app", async () => {
  const server = await controlServer(0);
  const require = createRequire(import.meta.url); const { WebSocket } = require("ws");
  const first = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const opened = (value) => new Promise((done, fail) => { value.once("open", done); value.once("error", fail); });
  let second;
  try {
    await opened(first); const generation = server.generation;
    const pending = assert.rejects(server.command("park"), /app disconnected/);
    const closed = new Promise((done) => first.once("close", done));
    server.reset(); await pending; await closed;
    second = new WebSocket(`ws://127.0.0.1:${server.port}`); await opened(second);
    second.send(JSON.stringify({ event: "connected" })); await server.connected(generation);
    second.on("message", (data) => { const { id } = JSON.parse(String(data)); second.send(JSON.stringify({ id, ok: true, result: "relaunched" })); });
    assert.equal(server.generation, generation + 1); assert.equal(await server.command("state"), "relaunched");
    const harness = await readFile(join(workspace, "scripts/witness-expo.mjs"), "utf8");
    assert.match(harness, /process.kill\(pid, "SIGKILL"\);\s+control.reset\(\)/);
  } finally { first.terminate(); second?.terminate(); await server.close(); }
});

test("useAssetUrl array types require callers to handle refused positions", async () => {
  const require = createRequire(import.meta.url); const ts = require("typescript");
  const root = await mkdtemp(join(tmpdir(), "e2-url-types-")); const sample = join(root, "sample.ts");
  try {
    await writeFile(sample, `import { useAssetUrl } from "snapback2/react";
      import type { ImageAsset } from "snapback2/client";
      declare const asset: ImageAsset;
      const scalar: string | undefined = useAssetUrl(asset);
      const positions: (string | undefined)[] | undefined = useAssetUrl([asset]);
      // @ts-expect-error a refused position is undefined
      const unsafe: string[] | undefined = useAssetUrl([asset]);
      if (positions?.[0] !== undefined) positions[0].toUpperCase();
      import { useQuery } from "snapback2/react";
      import type { HistorySnapshot, ItemsWithHistory, Op } from "snapback2/client";
      type Row = { id: string }; type Page = { message: Row | null }[]; type View = { messages: Page; count: number };
      declare const view: Op<{ conversationId: string }, View>;
      declare const declared: ItemsWithHistory<{ conversationId: string }, View, Row, never, { conversationId: string; c: null }, Page>;
      const options = { items: declared, drain: false };
      const custody: HistorySnapshot<View, Row, never, Page> = useQuery(view, { conversationId: "c" }, options);
      const from: "query" | "history" | "drafts" = custody.itemsFrom;
      void from;
    `);
    const program = ts.createProgram({ rootNames: [sample], options: {
      strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: { "snapback2/react": [join(packageRoot, "dist/react.d.ts")],
        "snapback2/react-core": [join(packageRoot, "dist/react-core.d.ts")],
        "snapback2/client": [join(packageRoot, "dist/client.d.ts")] },
    } });
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const nativeText = (renderer: ReturnType<typeof TestRenderer.create>) => JSON.stringify(renderer.toJSON());
const nativeInput = (renderer: ReturnType<typeof TestRenderer.create>) => renderer.root.findByType("NativeTextInput");
const nativeButton = (renderer: ReturnType<typeof TestRenderer.create>, title: string) =>
  renderer.root.findAllByType("NativeButton").find(node => node.props.title === title)!;
const refusal = () => new Response(JSON.stringify({ state: "rejected", code: "MEMBERSHIP_REQUIRED", family: "rule",
  message: "Membership required", rewrite: "Join this conversation before sending" }), { headers: { "content-type": "application/json" } });

describe("rendered Expo chat", () => {
let chatOwner: RealOwnerHarness;
before(async () => { chatOwner = await RealOwnerHarness.create({ fullChat: true }); });
after(async () => { await chatOwner?.close(); });

for (const transport of [false, true]) test(`Expo Composer renders ${transport ? "transport" : "rule"} refusal and clears account-owned text`, async () => {
  const client = createClient({ url: chatOwner.url, fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/api/mutation") {
      if (transport) throw new TypeError("connection lost");
      return refusal();
    }
    return globalThis.fetch(input, init);
  } });
  let renderer!: ReturnType<typeof TestRenderer.create>;
  try {
    await client.ready; await client.auth.guest();
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client },
      React.createElement(Composer, { conversationId: "conversation-1" }))); });
    await act(async () => nativeInput(renderer).props.onChangeText("keep native draft"));
    await act(async () => nativeButton(renderer, "Send").props.onPress());
    await until(() => nativeText(renderer).includes("Not sent:"));
    assert.match(nativeText(renderer), transport ? /connect|retry/i : /Join this conversation/);
    assert.equal(nativeInput(renderer).props.value, "keep native draft");
    await act(async () => { await client.auth.logout(); });
    assert.doesNotMatch(nativeText(renderer), /Not sent:|Join this conversation/);
    assert.equal(nativeInput(renderer).props.value, "");
  } finally { if (renderer) await act(async () => renderer.unmount()); await client.close(); }
});

for (const state of ["committed", "rejected"]) test(`Expo ignores a late ${state} send after changing conversations`, async () => {
  let release!: () => void, started!: () => void, consumed!: (value: any) => void, finished!: (value: any) => void;
  const bodyConsumed = new Promise<any>(done => { consumed = done; });
  const mutationFinished = new Promise<any>(done => { finished = done; });
  const gate = new Promise<void>(done => { release = done; });
  const entered = new Promise<void>(done => { started = done; });
  const client = createClient({ url: chatOwner.url, persona: "alice", fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/api/mutation") {
      started(); await gate;
      const response = state === "rejected" ? refusal() : await globalThis.fetch(input, init);
      const read = response.json.bind(response);
      response.json = async () => { const value = await read(); consumed(value); return value; };
      return response;
    }
    return globalThis.fetch(input, init);
  } });
  const mutate = client.mutation.bind(client);
  client.mutation = (...args) => { const result = mutate(...args); void result.then(finished); return result; };
  let renderer!: ReturnType<typeof TestRenderer.create>;
  const view = (conversationId: string) => React.createElement(SnapbackProvider, { client }, React.createElement(Composer, { conversationId }));
  try {
    await client.ready; await client.auth.me();
    await act(async () => { renderer = TestRenderer.create(view("conversation-1")); });
    await act(async () => nativeInput(renderer).props.onChangeText("same native draft"));
    await act(async () => { nativeButton(renderer, "Send").props.onPress(); await entered; });
    await act(async () => renderer.update(view("conversation-2")));
    assert.equal(nativeInput(renderer).props.value, "", "a different conversation has its own draft");
    await act(async () => nativeInput(renderer).props.onChangeText("same native draft"));
    await act(async () => {
      release();
      assert.equal((await bodyConsumed).state, state, "the old response body was consumed");
      assert.equal((await mutationFinished).state, state);
      await new Promise<void>(done => setImmediate(done)); // Flush the hook and send continuation.
    });
    assert.equal(nativeInput(renderer).props.value, "same native draft");
    assert.doesNotMatch(nativeText(renderer), /Not sent:/);
    assert.equal(nativeButton(renderer, "Send").props.disabled, false);
  } finally { release(); if (renderer) await act(async () => renderer.unmount()); await client.close(); }
});

test("Expo Thread queues in partial history, preserves the bubble through failed Sync and recovery, and follows owner removal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "a2-native-history-"));
  const store = fileRangeStore(directory);
  const warm = createClient({ url: chatOwner.url, persona: "alice", offline: { store } });
  const writer = createClient({ url: chatOwner.url, persona: "alice" });
  let client: ReturnType<typeof createClient> | undefined, renderer!: ReturnType<typeof TestRenderer.create>;
  let failResume = true, sends = 0;
  try {
    await warm.ready;
    const group = await writer.mutation(api.groups.groupCreate, { title: "Native transition", members: ["dev:bob"] });
    assert.equal(group.state, "committed");
    const conversationId = group.data.id;
    assert.equal((await writer.mutation(api.messages.send, { conversationId, body: "native held message" })).state, "committed");
    const drain = subscribe(warm, api.messages.inbox, {}, () => undefined, { drain: true });
    await drain.until(event => event.caughtUp === true, 5_000); drain.close(); await warm.close();
    client = createClient({ url: chatOwner.url, persona: "alice", startOffline: true, offline: { store }, fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (failResume && path === "/api/resume") throw new TypeError("native sync cut");
      if (path === "/api/mutation" && JSON.parse(String(init?.body)).op === "messages.send") sends++;
      return globalThis.fetch(input, init);
    } });
    await client.ready;
    await act(async () => { renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client },
      React.createElement(Chat))); });
    const conversation = () => renderer.root.findAllByType("NativePressable").find(node =>
      node.findAllByType("NativeText").some(text => text.children.includes(conversationId)));
    await until(() => Boolean(conversation()));
    await act(async () => conversation()!.props.onPress());
    await until(() => nativeText(renderer).includes("Downloaded history"));
    assert.match(nativeText(renderer), /Message count unavailable/);
    await act(async () => nativeInput(renderer).props.onChangeText("native recovery message"));
    await act(async () => nativeButton(renderer, "Send").props.onPress());
    await until(() => nativeText(renderer).includes("Sending…"));
    assert.equal(nativeInput(renderer).props.value, "");
    const entry = (await client.outbox.entries()).find((entry: any) => entry.op === "messages.send")!;
    const id = mutationTarget(api.messages.send, "messages").id(entry)!;
    const bubble = () => renderer.root.findAllByType("NativeView").find(node => node.props.testID === `message-${id}`);
    const pending = bubble(); assert.ok(pending);
    await act(async () => nativeButton(renderer, "Sync now").props.onPress());
    await until(() => nativeText(renderer).includes("native sync cut"));
    assert.equal((await client.outbox.entries()).find((entry: any) => entry.op === "messages.send")!.state, "queued");
    assert.strictEqual(bubble(), pending);
    await until(() => Boolean(nativeButton(renderer, "Sync now")));
    failResume = false;
    await act(async () => nativeButton(renderer, "Sync now").props.onPress());
    await until(() => nativeText(renderer).includes("2 messages · Latest: native recovery message")
      && !nativeText(renderer).includes("Sending…") && !nativeText(renderer).includes("native sync cut"));
    assert.strictEqual(bubble(), pending, "the rendered bubble survives history to composite transition");
    assert.doesNotMatch(nativeText(renderer), /Downloaded history|Sending…|native sync cut/);
    assert.equal(sends, 1, "recovery executes the queued send exactly once");
    assert.equal((await writer.mutation(api.messages.unsend, { messageId: id })).state, "committed");
    const summary = () => renderer.root.findAllByType("NativeText").find(node => node.props.testID === "thread-summary")!.children.join("");
    await until(() => !bubble() && summary() === "1 message · Latest: native held message");
    assert.equal(summary(), "1 message · Latest: native held message", "live content history previews the remaining message");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    await warm.close(); await client?.close(); await writer.close(); await rm(directory, { recursive: true, force: true });
  }
});


for (const boundary of ["navigation", "account", "anonymous"]) test(`Expo cold Composer preserves confirmation and clears draft/Sync state at ${boundary}`, async (t) => {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  const update = async (client: any, conversationId: string) => { await act(async () => {
    const view = React.createElement(SnapbackProvider, { client }, React.createElement(Composer, { conversationId }), React.createElement(CommitProbe, { conversationId }));
    if (renderer) renderer.update(view); else renderer = TestRenderer.create(view);
  }); };
  const input = () => nativeInput(renderer);
  const body = () => input().props.value;
  const typeDraft = async (value: string) => { await act(async () => input().props.onChangeText(value)); };
  const tree = () => nativeText(renderer);
  const syncButton = (title: string) => nativeButton(renderer, title).props;
  const pressSync = async () => { await act(async () => syncButton("Sync now").onPress()); };
  const wait = until;
  const commits: { conversationId: string; state: string; viewer?: string; body: string }[] = [];
  function CommitProbe({ conversationId }: { conversationId: string }) {
    const { session: auth } = useAuth();
    React.useLayoutEffect(() => {
      if (renderer) commits.push({ conversationId, state: auth.state, viewer: auth.viewer, body: body() });
    });
    return null;
  }
  const directory = await mkdtemp(join(tmpdir(), "a2-cold-composer-"));
  const store = fileRangeStore(directory);
  const warm = createClient({ url: chatOwner.url, persona: "alice", offline: { store } });
  const other = createClient({ url: chatOwner.url });
  let client: any, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const replayEntered = new Promise<void>(done => { entered = done; });
  let sends = 0;
  try {
    await warm.ready;
    await warm.query(api.messages.thread, { conversationId: "conversation-1" });
    const drain = subscribe(warm, api.messages.inbox, {}, () => undefined, { drain: true });
    await drain.until(event => event.live === true && event.caughtUp === true, 5_000);
    await warm.offline();
    const queued = await warm.mutation(api.messages.send, { conversationId: "conversation-1", body: "queued before cold confirmation" });
    assert.equal(queued.state, "queued");
    drain.close(); await warm.close();
    client = createClient({ url: chatOwner.url, persona: "alice", startOffline: true, offline: { store }, fetch: async (input, init) => {
      const response = await globalThis.fetch(input, init);
      if (new URL(String(input)).pathname !== "/api/mutation") return response;
      sends++;
      assert.equal((await response.json()).state, "committed");
      entered(); await gate;
      return new Response(JSON.stringify({ message: "lost receipt" }), { status: 503 });
    } });
    await client.ready;
    await update(client, "conversation-1");
    assert.equal(client.snapshot.auth.viewer, undefined);
    await typeDraft("unfinished cold draft");
    const coldInput = input();
    await pressSync();
    await act(async () => { await replayEntered; });
    assert.equal(client.snapshot.auth.viewer, "dev:alice");
    assert.equal(body(), "unfinished cold draft", "first confirmation preserves the unsent draft");
    assert.strictEqual(input(), coldInput, "first confirmation keeps the Composer mounted");
    assert.equal(syncButton("Syncing…").disabled, true, "Sync stays in flight while its response is held");
    release();
    await wait(() => tree().includes("1 queued; sync paused. Your messages are saved."));
    assert.equal(body(), "unfinished cold draft");
    assert.equal(syncButton("Sync now").disabled, false);
    assert.equal(sends, 1, "confirmation must not trigger an extra replay");
    assert.equal((await client.outbox.entries()).find((entry: any) => entry.op === "messages.send")!.state, "queued");
    await other.ready; await other.auth.guest();
    if (boundary === "anonymous") await other.auth.logout();
    commits.length = 0;
    await update(boundary === "navigation" ? client : other, boundary === "navigation" ? "conversation-2" : "conversation-1");
    assert.ok(commits.length > 0);
    assert.ok(commits.every(commit => commit.body === ""), `${boundary}: no committed frame exposes the old draft`);
    assert.equal(body(), "", `${boundary}: draft reset is synchronous`);
    assert.ok(!tree().includes("sync paused"), `${boundary}: old Sync advice is gone`);
    assert.ok(!tree().includes("Syncing…"), `${boundary}: old Sync activity is gone`);
    // Exercise navigation and a live logout independently of the boundary above.
    await typeDraft("navigation draft");
    commits.length = 0;
    await update(boundary === "navigation" ? client : other, boundary === "navigation" ? "conversation-1" : "conversation-2");
    assert.ok(commits.length > 0 && commits.every(commit => commit.body === ""));
    await update(other, "conversation-1");
    if (boundary === "anonymous") await act(async () => { await other.auth.guest(); });
    await typeDraft("logout draft");
    commits.length = 0;
    await act(async () => { await other.auth.logout(); });
    const anonymous = commits.filter(commit => commit.state === "anonymous");
    assert.ok(anonymous.length > 0);
    assert.ok(anonymous.every(commit => commit.body === ""), "no anonymous commit exposes the old draft");
    assert.equal(other.snapshot.auth.state, "anonymous");
    assert.equal(body(), "", "logout resets the draft synchronously");
    t.diagnostic("cold confirmation: unsent draft + input identity + in-flight Sync + stopped advice preserved; 1 replay; all scope resets verified");
  } finally {
    release(); await act(async () => renderer?.unmount());
    await warm.close(); await client?.close(); await other.close();

    await rm(directory, { recursive: true, force: true });
  }
});


test("Expo keeps the conversation mounted without carrying a once-photo opening to the next viewer", async (t) => {
  let bobAssetRequests = 0;
  const alice = createClient({ url: chatOwner.url, persona: "alice" });
  const bob = createClient({ url: chatOwner.url, persona: "bob", fetch: async (input, init) => {
    if (new URL(String(input)).pathname.startsWith("/api/asset/")) bobAssetRequests++;
    return globalThis.fetch(input, init);
  } });
  let renderer!: ReturnType<typeof TestRenderer.create>;
  const view = (client: any) => React.createElement(SnapbackProvider, { client }, React.createElement(Thread, { conversationId: "conversation-1" }));
  try {
    await alice.ready; await alice.auth.me(); await bob.ready; await bob.auth.me();
    const png = await readFile(new URL("../../../scripts/witness-expo/view-once.png", import.meta.url));
    const photo = await alice.upload(new Blob([png], { type: "image/png" }), { kind: "image" });
    const sent = await alice.mutation(api.messages.sendOncePhoto, { conversationId: "conversation-1", photo });
    assert.equal(sent.state, "committed");
    await act(async () => { renderer = TestRenderer.create(view(alice)); });
    const bubble = () => renderer.root.findAllByType("NativeView").find(node => node.props.testID === `message-${sent.data.id}`);
    const button = () => bubble()?.findAllByType("NativeButton").find(node => node.props.title === "View photo once");
    await until(() => Boolean(button()));
    const list = renderer.root.findAllByType("NativeScrollView").find(node => node.findAllByProps({ testID: "thread-summary" }).length)!;
    await act(async () => button()!.props.onPress());
    await until(() => !!bubble()?.findAllByType("NativeImage")[0]?.props.source?.uri);
    await act(async () => renderer.update(view(bob)));
    await until(() => Boolean(button()), () => `Bob unopened photo: ${JSON.stringify(bob.snapshot.auth)} ${nativeText(renderer)}`);
    assert.ok(renderer.root.findAllByType("NativeScrollView").find(node => node.findAllByProps({ testID: "thread-summary" }).length) === list, "viewer changes preserve the conversation/list");
    assert.equal(bubble()!.findAllByType("NativeImage").length, 0);
    assert.equal(bobAssetRequests, 0, "Bob has not chosen to spend his view-once delivery");
    const unopened = bubble();
    await act(async () => button()!.props.onPress());
    await until(() => !!bubble()?.findAllByType("NativeImage")[0]?.props.source?.uri);
    assert.equal(bobAssetRequests, 1, "Bob's click requests his photo bytes exactly once");
    assert.strictEqual(bubble(), unopened, "opening preserves Bob's bubble");
    assert.ok(renderer.root.findAllByType("NativeScrollView").includes(list));
    t.diagnostic("Alice → Bob: 0 Bob byte requests before click; exactly 1 after explicit open; list and Bob bubble unchanged");
  } finally { if (renderer) await act(async () => renderer.unmount()); await alice.close(); await bob.close(); }
});

});

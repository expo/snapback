import assert from "node:assert/strict";
import { test } from "node:test";
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

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(packageRoot, "../..");
const execute = promisify(execFile);
const tick = () => act(async () => { await new Promise((done) => setTimeout(done, 1)); });
async function until(predicate: () => boolean) { for (let i = 0; i < 100 && !predicate(); i++) await tick(); assert.ok(predicate()); }
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).__snapbackNative ??= { React, fileBodies: new Map(), fileUris: [], videoSources: [] };
register(new URL("./native-mocks/loader.mjs", import.meta.url));
const { SnapbackProvider } = await import("../dist/expo.mjs");
const { MediaView, configuration, persist, NormalApp } = await import("../dist/witness-test.mjs");

test("built Expo under Hermes-like globals logs in, drains, and views a photo", async () => {
  const { stdout } = await execute(process.execPath, [join(packageRoot, "tests/hermes-expo.ts")], { timeout: 5_000 });
  assert.match(stdout, /Hermes-like built Expo: login, drain, photo PASS/);
});

test("Expo app shows a readiness error after the client is already constructed", async () => {
  const original = (globalThis as any).__snapbackExpoSqlite;
  (globalThis as any).__snapbackExpoSqlite = async () => { throw new Error("device carrier refused"); };
  let renderer!: ReturnType<typeof TestRenderer.create>;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(NormalApp)); });
    await until(() => JSON.stringify(renderer.toJSON()).includes("device carrier refused"));
    assert.match(JSON.stringify(renderer.toJSON()), /device carrier refused/);
  } finally { if (renderer) await act(async () => renderer.unmount()); (globalThis as any).__snapbackExpoSqlite = original; }
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
  const map = JSON.parse(await readFile(join(packageRoot, "dist/client.mjs.map"), "utf8"));
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

test("fresh chat Expo scaffold from dist resolves every relative import including shared JS", async () => {
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
    assert.ok(imports > 15);
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

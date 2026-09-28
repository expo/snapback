import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { createApp } from "snapback4/app";
import { createClient } from "snapback4/client";
import { memorySessionStore } from "snapback4/auth";
import { webDevice, memoryPersistence } from "snapback4/web";
import { binary, until } from "./helpers/app-server.mjs";

const root = resolve(import.meta.dirname, "../../..");
function starter(t) {
  // Under the workspace so TypeScript sees the installed public dependencies.
  const dir = mkdtempSync(join(root, ".social-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const args of [["new", dir, "--template", "social"], ["check"]]) {
    const result = spawnSync(binary, args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  return dir;
}
export async function generatedApi(dir) {
  const source = readFileSync(join(dir, "snapback/generated/api.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  return (await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`)).api;
}

test("published social starter and guide snippets typecheck against generated operations", t => {
  const dir = starter(t);
  const guide = spawnSync(binary, ["guide", "social"], { encoding: "utf8" });
  assert.equal(guide.status, 0, guide.stderr);
  const snippets = [...guide.stdout.matchAll(/```tsx?\n\/\/ (src\/[^\n]+)\n([\s\S]*?)```/g)];
  assert.equal(snippets.length, 4);
  for (const [, name, source] of snippets) {
    assert.equal(source, readFileSync(join(dir, name), "utf8"), `${name}: card and installed file`);
    writeFileSync(join(dir, name), source); // Compile the emitted guide text.
  }
  const config = ts.readConfigFile(join(dir, "tsconfig.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dir);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => dir, getNewLine: () => "\n",
  }));
});

// @ref LLP 3000.028#8 — scaffold/check/dev and the installed client vocabulary.
test("social starter runs through the public client: feed, likes, receipts, typing, media and retained history", { timeout: 90_000 }, async t => {
  const dir = starter(t), api = await generatedApi(dir);
  let output = "";
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", bytes => { output += bytes; }); server.stderr.on("data", bytes => { output += bytes; });
  t.after(async () => { if (server.exitCode === null) { const stopped = new Promise(resolve => server.once("exit", resolve)); server.kill("SIGTERM"); await stopped; } });
  const url = await until(() => { assert.equal(server.exitCode, null, output); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, "social dev ready");
  const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
  const open = async () => {
    const app = createApp({ url, sessionStore: memorySessionStore(), device: webDevice({ wasm, persist: memoryPersistence() }) });
    t.after(() => app.close());
    assert.equal((await app.ready).ok, true);
    assert.equal((await app.auth.guest()).ok, true);
    return app;
  };
  const alice = await open(), bob = await open();
  const a = alice.client, b = bob.client;
  const write = async (client, op, args) => {
    const result = await client.mutate(op, args);
    assert.equal(result.state, "sent", JSON.stringify(result));
    return result.result;
  };
  await write(a, api.saveProfile, { name: "Alice" });
  assert.equal((await a.query(api.profile, { principal: a.viewer() })).data.name, "Alice");
  const post = await write(b, api.post, { body: "First social post" });
  await write(a, api.follow, { principal: b.viewer() });
  await until(async () => (await a.query(api.feed, {})).data?.some(row => row.post === post.id), "Following backfill");
  await a.sync();
  assert.deepEqual((await a.query(api.postState, { post: post.id })).data, { liked: false });
  await write(a, api.setLike, { post: post.id, liked: true });
  await until(async () => (await a.query(api.postState, { post: post.id })).data?.liked === true, "liked");
  const conversation = await write(a, api.createConversation, { title: "Friends" });
  await write(a, api.add, { conversation, principal: b.viewer() });
  const message = await write(a, api.send, { conversation, text: "coffee tomorrow", photo: null });
  await b.sync();
  await until(async () => (await b.query(api.history, { conversation })).data?.[0]?.id === message, "ordinary history");
  await until(async () => (await a.query(api.messageReceipts, { conversation })).data?.[0]?.receipt === "delivered", "SDK delivery reporter");
  await write(b, api.seen, { conversation, through: 1 });
  await until(async () => (await a.query(api.messageReceipts, { conversation })).data?.[0]?.receipt === "read", "seen receipt");

  let offline = false, dispatched = 0;
  const online = createClient({ url, token: b.session().token, fetch: (input, init) => {
    if (offline) return Promise.reject(new Error("disconnected"));
    if (new URL(input).pathname === "/m/setTyping") dispatched++;
    return fetch(input, init);
  } });
  t.after(() => online.close());
  assert.equal((await online.mutate(api.setTyping, { conversation })).state, "sent");
  assert.equal((await a.query(api.typingIn, { conversation })).data.length, 1);
  await fetch(`${url}/dev/clock/advance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ duration: "5s" }) });
  assert.equal((await a.query(api.typingIn, { conversation })).data.length, 0);
  offline = true;
  // End the prior lease and discover the disconnect before testing a new hint;
  // an equal renewal within 1s may legitimately reuse its last sent result.
  await online.mutate(api.stopTyping, { conversation });
  const dropped = await online.mutate(api.setTyping, { conversation });
  assert.equal(dropped.state, "failed");
  assert.deepEqual(await online.pendingWrites(), []);
  assert.deepEqual(await b.pendingWrites(), []);
  offline = false;
  const before = dispatched;
  await online.query(api.typingIn, { conversation });
  assert.equal(dispatched, before, "no typing replay on reconnect");

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3e0AAAAASUVORK5CYII=", "base64");
  const upload = await a.upload(png); assert.equal(upload.ok, true, JSON.stringify(upload));
  await write(a, api.send, { conversation, text: "one photo", photo: { id: upload.asset.id } });
  await b.sync();
  const handle = await b.asset(upload.asset.id); assert.ok("url" in handle, JSON.stringify(handle)); handle.revoke();
  assert.equal((await b.asset(upload.asset.id)).denied.code, "E_ASSET_VIEWED");
  const beforeLeave = (await b.query(api.history, { conversation })).data.map(row => row.id);
  await write(b, api.leave, { conversation }); await b.sync();
  await write(a, api.send, { conversation, text: "after leave", photo: null }); await b.sync();
  const retained = await b.query(api.history, { conversation });
  assert.deepEqual(retained.data.map(row => row.id), beforeLeave, "ordinary history keeps only delivered images");
  assert.equal((await online.mutate(api.setTyping, { conversation })).state, "failed", "revoked member cannot renew");
  const search = await b.query(api.searchChat, { conversation, q: "coffee" });
  assert.deepEqual(search.data.map(row => row.id), [message]);
  const previous = b.viewer();
  await bob.auth.logout(); await bob.auth.guest();
  assert.notEqual(bob.client.viewer(), previous);
  assert.deepEqual((await bob.client.query(api.history, { conversation })).data, [], "new account has no retained old history");
});

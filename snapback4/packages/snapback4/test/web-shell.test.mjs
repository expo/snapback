import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Script, runInNewContext } from "node:vm";
import { webShell } from "../bin/web-shell.js";

async function fixture(t, shape) {
  const dir = await mkdtemp(join(tmpdir(), "sb4-shell-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const names = shape === "expo" ? ["index.html", "about.html", "rooms/one.html", "_expo/static/js/web/index-abc.js", "assets/icon.png", "assets/engine.wasm"]
    : ["index.html", "nested/index.html", "assets/index-abc.js", "assets/index-abc.css", "assets/space name.wasm"];
  for (const name of names) { await mkdir(join(dir, name, ".."), { recursive: true }); await writeFile(join(dir, name), name.endsWith(".html") ? `<!doctype html><body>${name}</body>` : name); }
  return { dir, names };
}
function runtime(source, shared = new Map()) {
  const listeners = {}, requests = [];
  let offline = false, fail;
  const caches = {
    has: async key => shared.has(key), keys: async () => [...shared.keys()], delete: async key => shared.delete(key),
    async open(key) {
      if (!shared.has(key)) shared.set(key, new Map());
      const entries = shared.get(key);
      return { put: async (key, value) => { entries.set(key, value); }, match: async key => entries.get(key) };
    },
  };
  runInNewContext(source, { self: { location: { origin: "https://app.test" }, addEventListener: (name, fn) => { listeners[name] = fn; } }, URL, Request, Response, caches,
    fetch: async request => { requests.push(request); if (offline || request.url.endsWith(fail ?? "\0")) throw Error("offline"); return { ok: true, type: "basic", url: request.url }; } });
  return {
    shared, requests,
    offline(value) { offline = value; }, fail(value) { fail = value; },
    async event(name) { let work; listeners[name]({ waitUntil(promise) { work = promise; } }); await work; },
    fetch(path, { mode = "cors", method = "GET", authorization = false } = {}) {
      let response;
      listeners.fetch({ request: { url: new URL(path, "https://app.test").href, mode, method, headers: new Headers(authorization ? { authorization: "Bearer secret" } : {}) }, respondWith(promise) { response = promise; } });
      return response;
    },
  };
}
for (const shape of ["vite", "expo"]) test(`web-shell ${shape}: every exported file, every HTML, content hash and idempotence`, async t => {
  const { dir, names } = await fixture(t, shape);
  const first = await webShell(dir, "/chat/");
  assert.equal(first.files, names.length);
  const worker = await readFile(join(dir, "snapback4-sw.js"), "utf8");
  for (const name of names.filter(name => name.endsWith(".html"))) {
    const html = await readFile(join(dir, name), "utf8");
    assert.equal(html.match(/<!-- snapback4:web-shell -->/g)?.length, 1);
    assert.ok(html.includes('/chat/snapback4-sw.js'));
    new Script(html.match(/<script>(.*?)<\/script>/s)[1]);
  }
  assert.deepEqual(await webShell(dir, "/chat/"), first);
  assert.equal(await readFile(join(dir, "snapback4-sw.js"), "utf8"), worker);
  const sw = runtime(worker);
  await sw.event("install");
  assert.equal(sw.requests.length, names.length);
  assert.ok(sw.requests.every(request => request.credentials === "omit" && request.redirect === "error"));
  sw.offline(true);
  assert.equal((await sw.fetch("/chat/deep/route", { mode: "navigate" })).url, "https://app.test/chat/index.html");
  for (const name of names) assert.equal((await sw.fetch("/chat/" + name.split("/").map(encodeURIComponent).join("/"))).url, "https://app.test/chat/" + name.split("/").map(encodeURIComponent).join("/"));
  for (const path of ["https://backend.test/sync", "https://backend.test/asset/private", "/sync", "/q/private", "/asset/private", "/chat/m/send", "/outside"]) assert.equal(sw.fetch(path), undefined, path);
  assert.equal(sw.fetch("https://backend.test/index.html", { mode: "navigate" }), undefined);
  assert.equal(sw.fetch("/chat/index.html", { authorization: true }), undefined);
  assert.equal(sw.fetch("/chat/index.html", { method: "POST" }), undefined);
  await writeFile(join(dir, names.at(-1)), "changed");
  assert.notEqual((await webShell(dir, "/chat/")).cache, first.cache);
});

test("web-shell update waits for activation and failed installation preserves active caches", async t => {
  const { dir } = await fixture(t, "vite");
  const first = await webShell(dir), sw = runtime(await readFile(join(dir, "snapback4-sw.js"), "utf8"));
  await sw.event("install");
  sw.shared.set("snapback4-shell:%2Fother%2F:unrelated", new Map());
  await writeFile(join(dir, "assets/index-abc.js"), "updated");
  const second = await webShell(dir), next = runtime(await readFile(join(dir, "snapback4-sw.js"), "utf8"), sw.shared);
  next.fail(".wasm"); await assert.rejects(next.event("install"));
  assert.equal(sw.shared.has(first.cache), true); assert.equal(sw.shared.has(second.cache), false);
  next.fail(undefined); await next.event("install");
  assert.equal(sw.shared.has(first.cache), true, "old tabs retain their files while the new worker waits");
  next.fail(".wasm"); await assert.rejects(next.event("install"));
  assert.equal(sw.shared.has(second.cache), true, "failed same-cache update does not destroy an existing build");
  await next.event("activate");
  assert.equal(sw.shared.has(first.cache), false); assert.equal(sw.shared.has("snapback4-shell:%2Fother%2F:unrelated"), true);
});

test("web-shell CLI runs without a platform binary and rejects unsafe bases/symlinks", async t => {
  const { dir } = await fixture(t, "expo");
  const cli = resolve(import.meta.dirname, "../bin/snapback4.js");
  const result = spawnSync(process.execPath, [cli, "web-shell", dir], { encoding: "utf8", env: { ...process.env, SNAPBACK4_BIN: "/missing/binary" } });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /web-shell: 6 files/);
  const invalid = spawnSync(process.execPath, [cli, "web-shell", dir, "--base", "https://evil.test/"], { encoding: "utf8" });
  assert.equal(invalid.status, 2); assert.match(invalid.stderr, /E_INPUT at web-shell/); assert.match(invalid.stderr, /rewrite:.*snapback4 web-shell dist --base \//);
  for (const base of ["https://evil.test/", "//evil/", "/../", "/chat", "/a/./"]) await assert.rejects(webShell(dir, base));
  await symlink("index.html", join(dir, "leak.html"));
  await assert.rejects(webShell(dir), /symlink/);
});

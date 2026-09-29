import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { blobArrayBuffer, fetchAsset, uploadAsset } from "../dist/assets.js";
import { MediaCache } from "../dist/local-assets.js";
import { createClient } from "../dist/client.js";

const nativeBytes = new WeakMap();
function nativeBlob(bytes, type = "image/png", mode = "load", dataResult) {
  let closes = 0;
  const blob = {
    get size() { assert.equal(closes, 0); return bytes.length; },
    get type() { assert.equal(closes, 0); return type; },
    get closes() { return closes; },
    close() { closes++; assert.equal(closes, 1, "a response Blob must only be closed once"); },
  };
  nativeBytes.set(blob, { bytes, mode, dataResult });
  return blob;
}
function installReader(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "FileReader"), readers = [];
  Object.defineProperty(globalThis, "FileReader", { configurable: true, value: class {
    constructor() { readers.push(this); }
    readAsArrayBuffer(blob) { this.read(blob, "buffer"); }
    readAsDataURL(blob) { this.read(blob, "data"); }
    read(blob, method) {
      this.method = method;
      assert.equal(blob.closes, 0, "the response Blob must stay alive during copying");
      const { bytes, mode, dataResult } = nativeBytes.get(blob);
      const type = blob.type;
      if (mode === "throw") throw new Error("read failed synchronously");
      this.finish = () => {
        if (mode === "error") { this.error = new Error("read failed"); this.onerror(); }
        else if (mode === "abort") this.onabort();
        else {
          this.result = method === "buffer" ? (mode === "invalid" ? "not bytes" : Uint8Array.from(bytes).buffer)
            : mode === "invalid" ? new ArrayBuffer(0) : dataResult ?? `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
          this.onload();
        }
      };
      if (mode !== "manual") queueMicrotask(this.finish);
    }
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, "FileReader", previous) : delete globalThis.FileReader);
  return readers;
}
function installUrls(t) {
  const created = [], revoked = [];
  t.mock.method(URL, "createObjectURL", blob => { created.push(blob); return `blob:native-${created.length}`; });
  // Native URL revocation is a no-op for the backing bytes: Blob.close must do it.
  t.mock.method(URL, "revokeObjectURL", url => { revoked.push(url); });
  return { created, revoked };
}
function response(blob, ranges = "bytes") {
  return { ok: true, status: 200, headers: new Headers({ "accept-ranges": ranges, "x-snapback-asset-home": encodeURIComponent(JSON.stringify(home(blob.type))) }), blob: async () => blob };
}
function fetchBlob(blob, viewed, ranges) {
  return fetchAsset("https://assets.invalid", {}, async () => response(blob, ranges), "photo", viewed);
}
async function deviceFiles(t) {
  const directory = await mkdtemp(join(tmpdir(), "snapback4-blob-"));
  const homes = new Map(), writes = [], caches = [];
  const bytesPath = id => join(directory, id);
  const read = async path => { try { return await readFile(path); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
  function openCore() {
    return {
      async call({ op, key, value, id, home: receipt }) {
        if (op === "state") return { ok: { watermark: 1 } };
        if (op === "asset_home") return { ok: ["store_id", "table", "row", "column"].every(key => receipt?.[key] === homes.get(id)?.[key]) ? homes.get(id) : null };
        assert.equal(key, "media:manifest");
        if (op === "meta") return { ok: (await read(join(directory, "manifest")))?.toString() ?? null };
        assert.equal(op, "set_meta");
        await writeFile(join(directory, "manifest"), value);
        return { ok: true };
      },
      media: {
        read: async id => (await read(bytesPath(id)))?.toString("hex") ?? null,
        write: async (id, hex) => { writes.push(id); await writeFile(bytesPath(id), Buffer.from(hex, "hex")); },
        remove: async id => { await rm(bytesPath(id), { force: true }); },
        uri: id => pathToFileURL(bytesPath(id)).href,
      },
    };
  }
  async function open() {
    const core = openCore(), cache = new MediaCache(core, "user:alice", { keep: "viewed", maxBytes: 4096 });
    caches.push(cache);
    await cache.open();
    return { core, cache };
  }
  t.after(async () => { for (const cache of caches) await cache.close(); await rm(directory, { recursive: true, force: true }); });
  return { homes, writes, open, bytesPath, manifest: async () => JSON.parse(await readFile(join(directory, "manifest"), "utf8")) };
}
const home = type => ({ store_id: "media-store", table: "messages", row: "message", column: "photo", generation: 1, expiresAt: null, type });

for (const coordinate of ["store_id", "table", "row", "column", "missing"]) test(`an invalid ${coordinate} receipt cannot erase another confirmed entry`, async t => {
  const files = await deviceFiles(t), current = home("image/png");
  files.homes.set("photo", current);
  const { cache } = await files.open();
  const kept = await cache.viewed("photo", new Blob([Uint8Array.of(1, 2, 3)], { type: "image/png" }), response({ type: "image/png" }));
  assert.ok(kept?.url);
  const before = await readFile(files.bytesPath("photo"));
  const reply = response({ type: "image/png" });
  if (coordinate === "missing") reply.headers.delete("x-snapback-asset-home");
  else reply.headers.set("x-snapback-asset-home", encodeURIComponent(JSON.stringify({ ...current, [coordinate]: "old" })));
  await cache.viewed("photo", new Blob(["old"], { type: "image/png" }), reply);
  assert.deepEqual(await readFile(files.bytesPath("photo")), before);
  kept.revoke(); await cache.close();
  const reopened = await files.open();
  const retained = await reopened.cache.read("photo"); assert.ok("url" in retained); retained.revoke();
});

test("an invalid receipt for the confirmed entry's own cell retires it", async t => {
  const files = await deviceFiles(t);
  files.homes.set("photo", home("image/png"));
  const { cache } = await files.open();
  const kept = await cache.viewed("photo", new Blob(["bytes"], { type: "image/png" }), response({ type: "image/png" }));
  assert.ok(kept?.url);
  files.homes.delete("photo");
  await cache.viewed("photo", new Blob(["old"], { type: "image/png" }), response({ type: "image/png" }));
  assert.deepEqual(await files.manifest(), []);
  await assert.rejects(readFile(files.bytesPath("photo")), { code: "ENOENT" });
});

for (const type of ["image/png", "video/mp4"]) test(`native ${type} bytes survive a fresh cache opener; response ownership ends after copying`, async t => {
  const readers = installReader(t), urls = installUrls(t), files = await deviceFiles(t);
  const bytes = [0, 255, 128, 4, 9], blob = nativeBlob(bytes, type);
  files.homes.set("photo", home(type));
  const { core, cache } = await files.open();
  const originalWrite = core.media.write;
  core.media.write = async (...args) => { assert.equal(blob.closes, 0); await originalWrite(...args); assert.equal(blob.closes, 0); };
  const result = await fetchBlob(blob, (body, reply) => cache.viewed("photo", body, reply));
  assert.equal(result.url, core.media.uri("photo"));
  assert.equal(result.type, type);
  assert.equal(result.bytes, bytes.length);
  assert.equal(blob.closes, 1, "the retained file replaces the response Blob");
  assert.deepEqual([...await readFile(new URL(result.url))], bytes);
  result.revoke(); result.revoke();
  assert.deepEqual([...await readFile(files.bytesPath("photo"))], bytes, "releasing a file handle keeps ordinary cached bytes");
  await cache.close();
  const reopened = await files.open();
  const held = await reopened.cache.read("photo");
  assert.deepEqual([...await readFile(new URL(held.url))], bytes);
  held.revoke();
  assert.equal(readers.length, 1);
  assert.equal(readers[0].onload, null);
  assert.deepEqual(urls.created, [], "native retained files need no Blob URL");
});

for (const receipt of ["valid", "absent", "malformed", "incomplete", "no table", "no row", "no column"]) test(`once responses with ${receipt} receipts remove stale ordinary bytes without reading or storing the once Blob`, async t => {
  const readers = installReader(t), urls = installUrls(t), files = await deviceFiles(t);
  files.homes.set("photo", home("image/png"));
  const { core, cache } = await files.open();
  // Exercise live Blob URL revocation as well as removal of the durable file.
  delete core.media.uri;
  const viewed = (body, reply) => cache.viewed("photo", body, reply);
  const ordinary = await fetchBlob(nativeBlob([1, 2]), viewed);
  const once = nativeBlob([3, 4]);
  const reply = response(once, "none");
  if (receipt === "absent") reply.headers.delete("x-snapback-asset-home");
  if (receipt === "malformed") reply.headers.set("x-snapback-asset-home", "%not-json");
  if (receipt === "incomplete") reply.headers.set("x-snapback-asset-home", encodeURIComponent(JSON.stringify({ store_id: "old-store" })));
  // Each coordinate alone: an old store's receipt missing it cannot protect current bytes.
  if (receipt.startsWith("no ")) {
    const partial = { store_id: "old-store", table: "photos", row: "photo", column: "image" };
    delete partial[receipt.slice(3)];
    reply.headers.set("x-snapback-asset-home", encodeURIComponent(JSON.stringify(partial)));
  }
  const result = await fetchAsset("https://assets.invalid", {}, async () => reply, "photo", viewed);
  assert.equal(readers.length, 1, "once bytes must not enter byte extraction");
  assert.deepEqual(files.writes, ["photo"]);
  assert.deepEqual(await files.manifest(), []);
  await assert.rejects(readFile(files.bytesPath("photo")), { code: "ENOENT" });
  assert.deepEqual(urls.revoked, [ordinary.url], "the live ordinary handle loses its bytes");
  assert.equal(once.closes, 0, "the transient view owns its live native Blob");
  result.revoke(); result.revoke();
  assert.equal(once.closes, 1);
  assert.deepEqual(urls.revoked, [ordinary.url, result.url]);
  await cache.close();
  const reopened = await files.open();
  assert.equal((await reopened.cache.read("photo")).denied.code, "E_OFFLINE");
});

test("once falls back to a transient data URI without a second fetch or durable bytes", async t => {
  const readers = installReader(t), urls = installUrls(t), files = await deviceFiles(t);
  // Expo 57's URL conversion can throw before inspecting an otherwise valid Blob.
  URL.createObjectURL = () => { throw new TypeError("undefined is not a function"); };
  files.homes.set("photo", home("image/png"));
  const { cache } = await files.open();
  const viewed = (body, reply) => cache.viewed("photo", body, reply);
  (await fetchBlob(nativeBlob([1, 2]), viewed)).revoke();
  const bytes = [0, 255, 128], once = nativeBlob(bytes);
  let fetches = 0;
  const result = await fetchAsset("https://assets.invalid", {}, async () => {
    fetches++;
    return response(once, "none");
  }, "photo", viewed);
  assert.equal(result.url, "data:image/png;base64,AP+A");
  assert.equal(result.bytes, bytes.length);
  assert.equal(once.closes, 1, "the native Blob is released as soon as the transient copy is ready");
  assert.equal(fetches, 1);
  assert.deepEqual(readers.map(reader => reader.method), ["buffer", "data"]);
  assert.deepEqual(files.writes, ["photo"]);
  assert.deepEqual(await files.manifest(), []);
  await assert.rejects(readFile(files.bytesPath("photo")), { code: "ENOENT" });
  const copied = result.url;
  result.revoke(); result.revoke();
  assert.equal(result.url, "", "revocation drops the handle's own reference");
  assert.equal(copied, "data:image/png;base64,AP+A", "a caller's immutable string copy cannot be revoked");
  assert.equal(once.closes, 1);
  assert.deepEqual(urls.revoked, [], "data URLs have no object-URL registration to revoke");
  await cache.close();
  const reopened = await files.open();
  assert.equal((await reopened.cache.read("photo")).denied.code, "E_OFFLINE");
});

test("data URI fallback preserves supported media bytes and handles a missing object-URL function", async t => {
  const readers = installReader(t), urls = installUrls(t);
  URL.createObjectURL = undefined;
  for (const [index, type] of ["image/jpeg", "image/png", "image/webp", "video/mp4"].entries()) {
    const bytes = [0, 255, 128, 4].slice(0, index + 1), blob = nativeBlob(bytes, type);
    const result = await fetchBlob(blob);
    assert.equal(result.type, type);
    assert.equal(result.bytes, bytes.length);
    assert.ok(result.url.startsWith(`data:${type};base64,`));
    assert.deepEqual([...Buffer.from(result.url.split(",")[1], "base64")], bytes);
    assert.equal(blob.closes, 1);
    result.revoke();
    assert.equal(result.url, "");
  }
  assert.equal(readers.length, 4);
  assert.deepEqual(urls.revoked, []);
});

test("data URI fallback rejects reader failures, unsupported media and malformed or mismatched copies", async t => {
  const readers = installReader(t);
  installUrls(t);
  URL.createObjectURL = () => { throw new TypeError("object URLs unavailable"); };
  const blobs = [
    ...["error", "abort", "invalid", "throw"].map(mode => nativeBlob([1], "image/png", mode)),
    ...["not a URI", "https://assets.invalid/photo", "javascript:alert(1)", "data:text/html;base64,AQ==",
      "data:image/jpeg;base64,AQ==", "data:image/png,AQ==", "data:image/png;base64,AQ",
      "data:image/png;base64,A===", "data:image/png;base64,!!!!", "data:image/png;base64,AQID",
      "data:image/png;base64,AQ==#fragment"].map(uri => nativeBlob([1], "image/png", "load", uri)),
    nativeBlob([1], "text/html"),
  ];
  for (const blob of blobs) {
    assert.equal((await fetchBlob(blob)).denied.code, "E_OFFLINE");
    assert.equal(blob.closes, 1);
  }
  assert.equal(readers.length, blobs.length - 1, "unsupported media does not enter conversion");
  for (const reader of readers) for (const name of ["onload", "onerror", "onabort"]) assert.equal(reader[name], null);
  delete globalThis.FileReader;
  const unavailable = nativeBlob([1]);
  assert.equal((await fetchBlob(unavailable)).denied.code, "E_OFFLINE");
  assert.equal(unavailable.closes, 1);
});

test("data URI fallback rejects trailing line terminators even when they fill the expected encoded length", async t => {
  const readers = installReader(t);
  installUrls(t);
  URL.createObjectURL = () => { throw new TypeError("object URLs unavailable"); };
  for (const terminator of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    const encoded = (terminator.length === 2 ? "AQ" : "AQI") + terminator;
    assert.equal(encoded.length, 4, "a three-byte Blob expects four encoded characters");
    assert.ok(Buffer.from(encoded, "base64").length < 3, "a permissive decoder would return too few bytes");
    const blob = nativeBlob([1, 2, 3], "image/png", "load", `data:image/png;base64,${encoded}`);
    assert.equal((await fetchBlob(blob)).denied.code, "E_OFFLINE");
    assert.equal(blob.closes, 1);
  }
  assert.equal(readers.length, 5);
  for (const reader of readers) for (const name of ["onload", "onerror", "onabort"]) assert.equal(reader[name], null);
});

test("a delayed transient conversion cannot publish an obsolete session's asset", async t => {
  const readers = installReader(t), urls = installUrls(t);
  URL.createObjectURL = () => { throw new TypeError("object URLs unavailable"); };
  const session = token => ({ principal: "user:alice", kind: "user", token, expiresAt: Date.now() + 86400_000 });
  for (const ending of ["close", "sign-out", "rotation"]) {
    const old = nativeBlob([1], "image/png", "manual"), next = nativeBlob([2]);
    const before = readers.length;
    let fetches = 0;
    const client = createClient({ url: "https://assets.invalid", session: session("old"), fetch: async url => {
      const path = new URL(url).pathname;
      if (path === "/changes") return new Promise(() => {});
      if (path === "/auth/refresh") return Response.json({ session: session("next") });
      if (path === "/auth/logout") return Response.json({ ok: true });
      return response(++fetches === 1 ? old : next, "none");
    } });
    t.after(() => client.close());
    const reading = client.asset("photo");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readers.length, before + 1);
    assert.equal(old.closes, 0, "an in-progress reader still owns its Blob");
    if (ending === "rotation") assert.equal((await client.refreshSession()).ok, true);
    else await (ending === "close" ? client.close() : client.signOut());
    readers[before].finish();
    const result = await reading;
    assert.equal(old.closes, 1);
    if (ending === "rotation") {
      assert.equal(result.denied.code, "E_AUTH");
      assert.equal(fetches, 1, "rotation cannot consume another view after a successful download");
      assert.equal(next.closes, 0, "no replacement response was requested");
    } else {
      assert.equal(result.denied.code, "E_CLOSED");
      assert.equal(fetches, 1);
    }
    await client.close();
  }
  assert.deepEqual(urls.revoked, []);
});

test("FileReader errors, aborts, invalid results and synchronous failures settle and close response Blobs", async t => {
  const readers = installReader(t), urls = installUrls(t), files = await deviceFiles(t);
  files.homes.set("photo", home("image/png"));
  const { cache } = await files.open();
  for (const mode of ["error", "abort", "invalid", "throw"]) {
    const blob = nativeBlob([1], "image/png", mode);
    const result = await fetchBlob(blob, (body, reply) => cache.viewed("photo", body, reply));
    assert.equal(result.denied.code, "E_OFFLINE");
    assert.equal(blob.closes, 1);
  }
  delete globalThis.FileReader;
  const unavailable = nativeBlob([2]);
  assert.equal((await fetchBlob(unavailable, (body, reply) => cache.viewed("photo", body, reply))).denied.code, "E_OFFLINE");
  assert.equal(unavailable.closes, 1, "a missing host reader also releases its response Blob");
  for (const reader of readers) for (const name of ["onload", "onerror", "onabort"]) assert.equal(reader[name], null);
  assert.deepEqual(files.writes, []);
  assert.deepEqual(urls.created, []);
});

test("modern Blob reads and browser URLs retain their behavior without FileReader", async t => {
  const readers = installReader(t);
  const blob = new Blob([new Uint8Array([0, 255, 128])], { type: "image/png" });
  assert.deepEqual([...new Uint8Array(await blobArrayBuffer(blob))], [0, 255, 128]);
  const result = await fetchBlob(blob);
  assert.deepEqual([...new Uint8Array(await (await fetch(result.url)).arrayBuffer())], [0, 255, 128]);
  result.revoke(); result.revoke();
  await assert.rejects(fetch(result.url));
  const failure = new Error("modern reader failed");
  assert.throws(() => blobArrayBuffer({ arrayBuffer() { throw failure; } }), error => error === failure);
  await assert.rejects(blobArrayBuffer({ arrayBuffer: async () => { throw failure; } }), error => error === failure);
  assert.equal(readers.length, 0, "a direct reader's failure must not trigger a second read");
});

test("failed retention and URL creation close owned response Blobs; revoke cleans up even if URL disposal throws", async t => {
  const urls = installUrls(t);
  const retention = nativeBlob([1]);
  const result = await fetchBlob(retention, async () => { throw new Error("storage failed"); });
  assert.equal(result.denied.code, "E_OFFLINE");
  assert.equal(retention.closes, 1);
  assert.deepEqual(urls.created, []);
  URL.createObjectURL = () => { throw new Error("no URL"); };
  const noUrl = nativeBlob([2]);
  assert.equal((await fetchBlob(noUrl)).denied.code, "E_OFFLINE");
  assert.equal(noUrl.closes, 1);
  URL.createObjectURL = () => "blob:throw-on-revoke";
  URL.revokeObjectURL = () => { throw new Error("URL disposal failed"); };
  const live = nativeBlob([3]);
  const handle = await fetchBlob(live);
  assert.equal(live.closes, 0);
  assert.throws(() => handle.revoke(), /URL disposal failed/);
  handle.revoke();
  assert.equal(live.closes, 1);
});

test("upload keeps caller-owned Blobs open on both success and failure", async () => {
  const blob = nativeBlob([1, 2]);
  const asset = { id: "uploaded", type: "image/png", bytes: 2, width: 1, height: 1, duration: null };
  const result = await uploadAsset("https://assets.invalid", {}, async (_url, init) => {
    assert.equal(init.body, blob);
    return Response.json({ asset });
  }, blob);
  assert.deepEqual(result, { ok: true, asset });
  assert.equal(blob.closes, 0);
  assert.equal((await uploadAsset("https://assets.invalid", {}, async () => { throw new Error("offline"); }, blob)).ok, false);
  assert.equal(blob.closes, 0);
});

// @ref LLP 3000.019#3.5 — old inferred homes and receipt-less downloads confer no authority.
test("retention drops old inferred homes and refuses downloads without a valid home receipt", async t => {
  installReader(t); installUrls(t);
  const files = await deviceFiles(t);
  files.homes.set("photo", home("image/png"));
  const { core, cache } = await files.open();
  for (const receipt of [null, "bad-json", "%GG", encodeURIComponent(JSON.stringify({ table: "messages", row: "message" })), ...[undefined, "", 7].map(store_id => encodeURIComponent(JSON.stringify({ store_id, table: "messages", row: "message", column: "photo" })))]) {
    const blob = nativeBlob([1, 2]);
    const reply = response(blob);
    if (receipt === null) reply.headers.delete("x-snapback-asset-home");
    else reply.headers.set("x-snapback-asset-home", receipt);
    assert.equal(await cache.viewed("photo", blob, reply), undefined);
    assert.equal((await cache.read("photo")).denied.code, "E_OFFLINE");
    blob.close();
  }
  assert.deepEqual(files.writes, []);
  (await fetchBlob(nativeBlob([1, 2]), (blob, reply) => cache.viewed("photo", blob, reply))).revoke();
  await cache.close();
  const manifest = await files.manifest();
  delete manifest[0].confirmed;
  await core.call({ op: "set_meta", key: "media:manifest", value: JSON.stringify(manifest) });
  const reopened = await files.open();
  assert.equal((await reopened.cache.read("photo")).denied.code, "E_OFFLINE");
  assert.deepEqual(await files.manifest(), []);
  await assert.rejects(readFile(files.bytesPath("photo")), { code: "ENOENT" });
});

for (const trigger of ["read", "reconcile", "reopen", "unbound reopen"]) test(`retained receipt store binding is revalidated on ${trigger}`, async t => {
  installReader(t); installUrls(t);
  const files = await deviceFiles(t);
  files.homes.set("photo", home("image/png"));
  let { core, cache } = await files.open();
  (await fetchBlob(nativeBlob([1, 2]), (blob, reply) => cache.viewed("photo", blob, reply))).revoke();
  const manifest = await files.manifest();
  assert.equal(manifest[0].home.store_id, "media-store");
  if (trigger === "unbound reopen") {
    delete manifest[0].home.store_id;
    await core.call({ op: "set_meta", key: "media:manifest", value: JSON.stringify(manifest) });
  } else files.homes.set("photo", { ...home("image/png"), store_id: "replacement" });
  if (trigger.includes("reopen")) { await cache.close(); ({ cache } = await files.open()); }
  if (trigger === "reconcile") await cache.reconcile();
  assert.equal((await cache.read("photo")).denied.code, "E_OFFLINE");
  assert.deepEqual(await files.manifest(), []);
  await assert.rejects(readFile(files.bytesPath("photo")), { code: "ENOENT" });
});

test("a foreign once receipt checks the entry after serialized writes and never copies its body", async t => {
  const readers = installReader(t), files = await deviceFiles(t);
  const current = home("image/png");
  files.homes.set("photo", current);
  const { core, cache } = await files.open();
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const call = core.call;
  core.call = async request => {
    if (request.op === "asset_home") { entered.resolve(); await release.promise; }
    return call(request);
  };
  const pending = cache.viewed("photo", nativeBlob([1, 2]), response({ type: "image/png" }));
  await entered.promise;
  const foreign = response({ type: "image/png" }, "none");
  foreign.headers.set("x-snapback-asset-home", encodeURIComponent(JSON.stringify({ ...current, store_id: "old-store" })));
  const onceBody = nativeBlob([9, 9]);
  const delayed = cache.viewed("photo", onceBody, foreign);
  release.resolve();
  const kept = await pending;
  await delayed;
  assert.ok(kept?.url);
  assert.deepEqual([...await readFile(new URL(kept.url))], [1, 2]);
  assert.deepEqual(files.writes, ["photo"]);
  assert.equal(readers.length, 1, "the once body was never copied");
  kept.revoke(); onceBody.close();
  await cache.close();
  const reopened = await files.open();
  const retained = await reopened.cache.read("photo");
  assert.ok("url" in retained); retained.revoke();
});

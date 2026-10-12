import { captureStdout } from './helpers/server-output.mjs';
import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.038#7 — file uploads declare type and name; downloads report the name and stay attachments.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { uploadAsset, fetchAsset } from "../dist/assets.js";
import { dispositionName, uploadFile, saveAsset } from "../dist/files.js";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { createMockClient } from "../dist/mock.js";
import { webDevice, memoryPersistence } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const pdf = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

test("a file upload names its kind, filename and declared type; media uploads are unchanged", async () => {
  const sent = [];
  const send = async (url, init) => { sent.push({ url, type: init.headers["content-type"] }); return Response.json({ asset: { id: "a", type: "application/pdf", bytes: 4, width: null, height: null, duration: null, name: "Résumé.pdf" } }); };
  const file = new File([pdf], "Résumé.pdf", { type: "application/pdf" });
  const uploaded = await uploadAsset("http://h.invalid", { authorization: "Bearer t", "content-type": "application/json" }, send, file, undefined, { file: {} });
  assert.equal(uploaded.ok, true); assert.equal(uploaded.asset.name, "Résumé.pdf");
  await uploadAsset("http://h.invalid", {}, send, new Uint8Array(pdf), undefined, { file: { type: "application/pdf", name: "a/b.pdf" } });
  await uploadAsset("http://h.invalid", {}, send, new Uint8Array(pdf), undefined, { file: {} });
  await uploadAsset("http://h.invalid", {}, send, new Uint8Array(pdf));
  assert.deepEqual(sent, [
    { url: "http://h.invalid/assets?as=file&name=R%C3%A9sum%C3%A9.pdf", type: "application/pdf" },
    { url: "http://h.invalid/assets?as=file&name=a%2Fb.pdf", type: "application/pdf" },
    { url: "http://h.invalid/assets?as=file&name=", type: "application/octet-stream" },
    { url: "http://h.invalid/assets", type: "application/octet-stream" },
  ]);
  assert.deepEqual(uploadFile(file, { name: "override.pdf" }), { type: "application/pdf", name: "override.pdf" });
  assert.deepEqual(uploadFile(new Blob(["x"]), {}), { name: "" });
});

test("a download reports the attachment's filename and the media type without parameters", async () => {
  const headers = { "content-type": "text/plain; charset=utf-8", "accept-ranges": "bytes", "content-disposition": "attachment; filename=\"_t.txt\"; filename*=UTF-8''%C3%A9t%C3%A9.txt" };
  const read = await fetchAsset("http://h.invalid", {}, async () => new Response("hello", { headers }), "doc");
  assert.ok("url" in read, JSON.stringify(read));
  assert.equal(read.type, "text/plain"); assert.equal(read.name, "été.txt"); assert.equal(read.bytes, 5);
  read.revoke();
  const media = await fetchAsset("http://h.invalid", {}, async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "image/png", "accept-ranges": "bytes" } }), "photo");
  assert.ok("url" in media); assert.equal("name" in media, false, "media handles carry no name"); media.revoke();
  assert.equal(dispositionName("attachment; filename=\"plain.pdf\""), "plain.pdf");
  assert.equal(dispositionName("attachment; filename*=UTF-8''bad%E0%A4"), undefined);
  assert.equal(dispositionName(null), undefined);
});

test("the mock answers a file upload with file facts", async () => {
  const client = createMockClient({ viewer: "alice", tables: {}, ops: {} });
  const uploaded = await client.upload(new File([pdf], "lab.pdf", { type: "application/pdf" }), { file: {} });
  assert.equal(uploaded.ok, true);
  assert.deepEqual({ ...uploaded.asset, id: "x" }, { id: "x", type: "application/pdf", bytes: pdf.length, width: null, height: null, duration: null, name: "lab.pdf" });
  client.close?.();
});

test("saveAsset hands the bytes to a browser download under the file's name, then revokes", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const clicked = [];
  const body = { appendChild() {} };
  const document = { body, createElement: () => ({ style: {}, click() { clicked.push({ href: this.href, download: this.download, rel: this.rel }); }, remove() {} }) };
  const previous = globalThis.document; globalThis.document = document;
  t.after(() => { globalThis.document = previous; });
  let revoked = 0;
  const client = { asset: async () => ({ url: "blob:x", type: "application/pdf", bytes: 3, name: "lab.pdf", revoke: () => revoked++ }) };
  assert.deepEqual(await saveAsset(client, "id"), { ok: true, name: "lab.pdf" });
  assert.deepEqual(await saveAsset(client, "id", "renamed.pdf"), { ok: true, name: "renamed.pdf" });
  assert.deepEqual(clicked.map(c => c.download), ["lab.pdf", "renamed.pdf"]);
  assert.equal(revoked, 0, "revoking at once could cancel the download");
  t.mock.timers.tick(60_000);
  assert.equal(revoked, 2);
  const refused = await saveAsset({ asset: async () => ({ denied: { code: "E_ASSET_UNKNOWN", family: "asset", message: "gone" } }) }, "id");
  assert.equal(refused.ok, false); assert.equal(refused.why.code, "E_ASSET_UNKNOWN");
  globalThis.document = undefined;
  assert.equal((await saveAsset(client, "id")).why.code, "E_CLIENT", "a host without a document is told what to use");
});

const source = `use personas alice, bob, stranger
table receipts:
  owner: principal
  scan: file <=10000 ('application/pdf', 'text/plain')
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation file(scan: file <=10000 ('application/pdf', 'text/plain')):
  return insert receipts { owner: viewer, scan }
`;

async function server(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-asset-files-"));
  mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), source);
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(child);
  const exited = once(child, "exit");
  let log = "", url;
  for (const stream of [child.stdout, child.stderr]) stream.on("data", b => { log += b; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  const deadline = performance.now() + hangBudget();
  while (!url) { if (child.exitCode != null || performance.now() > deadline) throw Error(log); await new Promise(r => setTimeout(r, 20)); }
  const clients = [];
  t.after(async () => { for (const c of clients) await c.close(); child.kill(); await exited; rmSync(dir, { recursive: true, force: true }); });
  return { url, clients };
}

test("end to end: a PDF uploads, places, downloads as an attachment and survives offline with its name", { timeout: hangBudget(8) }, async t => {
  const { url, clients } = await server(t);
  const alice = createClient({ url, persona: "alice" }); clients.push(alice);
  const bob = createClient({ url, persona: "bob" }); clients.push(bob);
  const spoofed = await alice.upload(new File(["<html><script>alert(1)</script></html>"], "x.pdf", { type: "application/pdf" }), { file: {} });
  assert.equal(spoofed.ok, false); assert.equal(spoofed.why.code, "E_ASSET_TYPE");
  const html = await alice.upload(new File(["<html></html>"], "x.html", { type: "text/html" }), { file: {} });
  assert.equal(html.ok, false); assert.equal(html.why.code, "E_ASSET_TYPE");
  const uploaded = await alice.upload(new File([pdf], "../Lab results.pdf", { type: "application/pdf" }), { file: {} });
  assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
  assert.equal(uploaded.asset.name, "Lab results.pdf"); assert.equal(uploaded.asset.type, "application/pdf");
  const placed = await alice.mutate({ kind: "mutation", name: "file" }, { scan: { id: uploaded.asset.id } });
  assert.equal(placed.state, "sent", JSON.stringify(placed));
  assert.deepEqual(placed.result.scan, { id: uploaded.asset.id, type: "application/pdf", bytes: pdf.length, name: "Lab results.pdf" });
  const read = await alice.asset(uploaded.asset.id);
  assert.ok("url" in read, JSON.stringify(read));
  assert.equal(read.name, "Lab results.pdf"); assert.equal(read.type, "application/pdf");
  assert.deepEqual(Buffer.from(await (await fetch(read.url)).arrayBuffer()), pdf); read.revoke();
  const raw = await fetch(`${url}/assets/${uploaded.asset.id}`, { headers: { "x-snapback-persona": "alice" } });
  assert.match(raw.headers.get("content-disposition"), /^attachment; /);
  assert.equal(raw.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await fetch(`${url}/assets/${uploaded.asset.id}`, { headers: { "x-snapback-persona": "bob" } })).status, 404);
  assert.equal((await bob.asset(uploaded.asset.id)).denied?.code, "E_ASSET_UNKNOWN");

  let offline = false;
  const device = webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
  const local = await createLocalClient({ url, persona: "alice", device, waitSeconds: 1, assets: { keep: "viewed", maxBytes: 10000 },
    fetch: (...args) => offline ? Promise.reject(Error("offline")) : fetch(...args) });
  clients.push(local); await local.sync();
  const online = await local.asset(uploaded.asset.id); assert.ok("url" in online, JSON.stringify(online)); online.revoke();
  offline = true;
  const kept = await local.asset(uploaded.asset.id);
  assert.ok("url" in kept, JSON.stringify(kept));
  assert.equal(kept.name, "Lab results.pdf", "the retained file keeps its name offline"); kept.revoke();
});

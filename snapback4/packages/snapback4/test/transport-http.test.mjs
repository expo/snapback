import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
// Both real device stores, the real HTTP parser, and an idle TCP proxy that
// blackholes response bytes without closing the held downstream connection.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { createClient } from "../dist/client.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { processDevice } from "../dist/native.js";
import { changeFeed } from "../dist/changes.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const headers = { "x-snapback-persona": "alice", "content-type": "application/json" };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { return awaitState(check); }
const source = `use identity
use personas alice
table items:
  body: text <=100
  read <- allow
  insert <- allow
  sync public last 1000 by byId
mutation noChange():
  return null
query items():
  return items[] first 1000 by byId
`;

async function host(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-transport-"));
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), source);
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(child);
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", data => { log += data; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  child.stderr.on("data", data => { log += data; });
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map(client => client.close()));
    if (child.exitCode == null && child.signalCode == null) child.kill();
    await exited;
    rmSync(dir, { recursive: true, force: true });
  });
  await until(() => { assert.equal(child.exitCode, null, log); return url; });
  const post = (path, body) => fetch(url + path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body), signal: AbortSignal.timeout(hangBudget()) });
  const rows = Array.from({ length: 37 }, (_, n) => ({ table: "items", row: { id: `row-${String(n).padStart(3, "0")}`, body: `item ${n}` } }));
  assert.equal((await (await post("/seed", rows)).json()).seeded, rows.length);
  const opener = (tier, name) => {
    const data = join(dir, name);
    mkdirSync(data, { recursive: true });
    return tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: data,
      spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
  };
  return { url, post, opener, clients };
}

function oldLine(ids) {
  return `GET /sync?from=1091&limit=4000&pending=${encodeURIComponent(JSON.stringify(ids))} HTTP/1.1`;
}

test("sync request-line boundaries and a deliberate body ceiling", { timeout: hangBudget(16) }, async t => {
  const f = await host(t);
  for (const count of [232, 233, 256]) {
    const ids = Array.from({ length: count }, (_, n) => String(n).padStart(26, "0"));
    const long = ids.map(id => id.padStart(128, "x"));
    const body = JSON.stringify({ from: 1091, limit: 4000, after: null, stream: false, pending: long });
    console.log(JSON.stringify({ boundary: count, oldOrdinaryLineBytes: Buffer.byteLength(oldLine(ids)), oldMaxIdLineBytes: Buffer.byteLength(oldLine(long)), postLineBytes: Buffer.byteLength("POST /sync HTTP/1.1"), postOrdinaryBodyBytes: Buffer.byteLength(JSON.stringify({ from: 1091, limit: 4000, after: null, stream: false, pending: ids })), postBodyBytes: Buffer.byteLength(body) }));
    assert.equal(Buffer.byteLength(oldLine(ids)), ({ 232: 8171, 233: 8206, 256: 9011 })[count]);
    for (const pending of [ids, long]) {
      const response = await f.post("/sync", { from: 1091, limit: 4000, after: null, stream: false, pending });
      assert.equal(response.status, 200);
      assert.ok(Array.isArray((await response.json()).events));
    }
  }
  assert.equal((await fetch(f.url + "/sync?from=0", { headers })).status, 404, "the GET form was removed");
  // Worst-case JSON escaping still leaves room for an opaque cursor.
  const escaped = { pending: Array.from({ length: 256 }, () => "\u0001".repeat(128)) };
  assert.equal((await f.post("/sync", escaped)).status, 200);
  const ceiling = 256 * 1024;
  const exact = await f.post("/sync", "{}" + " ".repeat(ceiling - 2));
  assert.equal(exact.status, 200);
  await exact.arrayBuffer();
  const oversized = await f.post("/sync", "{}" + " ".repeat(ceiling - 1));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).denied.code, "E_INPUT");
  for (const body of ["{", { pending: ["x".repeat(129)] }, { pending: Array(257).fill("id") }, { pending: [7] }, { from: -1 }, { limit: "1" }, { stream: 1 }, { after: false }]) {
    const response = await f.post("/sync", body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).denied.code, "E_INPUT");
  }
  async function raw(text) {
    const socket = connect({ host: "127.0.0.1", port: +new URL(f.url).port });
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("data", chunk => { answer += chunk; });
    await once(socket, "connect");
    socket.end(text);
    await once(socket, "close");
    return answer;
  }
  for (const count of [232, 233, 256]) {
    const ids = Array.from({ length: count }, (_, n) => String(n).padStart(26, "0"));
    const response = await raw(oldLine(ids) + "\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\n\r\n");
    assert.match(response, count === 232 ? /^HTTP\/1.1 404/ : /^HTTP\/1.1 400/, "the exact old boundary still belongs to the parser; POST bypasses it");
  }
  const prefix = "POST /sync HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nOrigin: http://localhost:3000\r\nConnection: close\r\n";
  const declared = await raw(prefix + `Content-Length: ${ceiling + 1}\r\nExpect: 100-continue\r\n\r\n`);
  const chunked = await raw(prefix + `Transfer-Encoding: chunked\r\n\r\n${(ceiling + 1).toString(16)}\r\n${" ".repeat(ceiling + 1)}\r\n0\r\n\r\n`);
  for (const answer of [declared, chunked]) {
    assert.match(answer, /^HTTP\/1.1 413/);
    assert.match(answer, /E_INPUT/);
    assert.match(answer, /Access-Control-Allow-Origin: http:\/\/localhost:3000/i);
    assert.doesNotMatch(answer, /100 Continue/);
  }
});

// Each boundary owns its server and queue. These are protocol assertions;
// concurrent queues otherwise spend the timeout contending during replay.
for (const tier of ["wasm", "native"]) for (const count of [232, 233, 256]) for (const recovery of (count === 256 ? ["automatic", "explicit sync"] : ["automatic"])) test(`${tier}: maximum pending ids (${count}), cursor batches and every terminal acknowledgement (${recovery})`, { timeout: hangBudget(16) }, async t => {
  const f = await host(t);
  // The final case also has a tail beyond sync_state's 256-id window.
  const ids = Array.from({ length: count + (count === 256 ? 17 : 0) }, (_, n) => `${tier}-${count}-${n}`.padEnd(128, "x"));
  const device = f.opener(tier, `boundary-${count}`);
  let core, client;
  const receipts = new Set(), ordinaryReceipts = new Set(), terminal = new Map(), pendingSizes = [], cursors = [];
  client = await createLocalClient({ url: f.url, persona: "alice", device: {
    async open(...args) {
      core = await device.open(...args);
      t.after(() => { if (!client) return core.close(); });
      for (const [index, id] of ids.entries()) {
        const admitted = await core.call({ op: "admit", entry: { id, seq: index + 1, op: "noChange", args: {}, viewer: "dev:alice", now: Date.now() } });
        assert.ok(admitted.ok, JSON.stringify(admitted));
        assert.ok((await core.call({ op: "begin_send" })).ok);
        assert.equal((await (await f.post("/m/noChange", { id, args: {} })).json()).state, "sent");
        // Lose that terminal reply: recover through a sync receipt or a
        // same-id replay, with exactly one eventual terminal notification.
      }
      return core;
    },
  }, fetch: async (input, init) => {
    if (new URL(input).pathname === "/m/noChange") {
      const id = JSON.parse(init.body).id;
      assert.ok(!receipts.has(id), "a sync-acknowledged terminal id must not be reposted");
      if (recovery === "explicit sync") return new Response("replay unavailable", { status: 503 });
      const response = await fetch(input, init), write = await response.clone().json();
      assert.equal(write.state, "sent"); ordinaryReceipts.add(id);
      return response;
    }
    if (new URL(input).pathname !== "/sync") return fetch(input, init);
    assert.equal(init.method, "POST");
    assert.equal(new URL(input).search, "");
    const body = JSON.parse(init.body);
    pendingSizes.push(body.pending.length);
    if (body.after) cursors.push(body.after);
    const response = await fetch(input, { ...init, body: JSON.stringify({ ...body, limit: 7 }) });
    const page = await response.clone().json();
    assert.equal(response.status, 200, JSON.stringify(page));
    assert.equal(page.denied, undefined);
    for (const id of Object.keys(page.acknowledged)) receipts.add(id);
    return response;
  } });
  f.clients.push(client);
  client.onWrite(write => {
    assert.equal(write.state, "sent");
    terminal.set(write.id, (terminal.get(write.id) ?? 0) + 1);
  });
  // Shared FIFO settlement can replay the whole tail before its next sync.
  // Fence replay and explicitly sync after retirement advances the id window.
  // Settling up to 273 receipts is real work on the wasm store. Allow it the
  // existing 40-second test budget, reserving ten seconds for setup/cleanup.
  await until(async () => {
    if (recovery === "explicit sync") await client.sync();
    return terminal.size === ids.length && (await core.call({ op: "queued" })).ok.length === 0;
  });
  assert.equal(pendingSizes[0], count);
  assert.ok(cursors.length >= 5, "the real snapshot continues across six batches");
  assert.deepEqual([...new Set([...receipts, ...ordinaryReceipts])].sort(), [...ids].sort(), "every id has a server acknowledgement, including the tail");
  if (recovery === "explicit sync") assert.ok(ids.slice(256).some(id => receipts.has(id)), "sync acknowledgements advance beyond the first pending window");
  assert.ok([...terminal.values()].every(n => n === 1), "one terminal event per queued write");
  const read = await client.query({ kind: "query", name: "items" }, {});
  assert.equal(read.data.length, 37);
  assert.equal(new Set(read.data.map(row => row.id)).size, 37);
  console.log(JSON.stringify({ store: tier, pendingBoundary: count, recovery, syncAcknowledged: receipts.size, ordinaryAcknowledged: ordinaryReceipts.size, terminalWrites: terminal.size, snapshotCursors: cursors.length }));
  await client.close();
});

test("idle polls detect packet silence at 0.5, 5 and 15 seconds on both stores", { timeout: hangBudget(8) }, async t => {
  const f = await host(t);
  const scenarios = new Map();
  const upstreams = new Set();
  const proxy = createServer((request, response) => {
    const [, name, ...rest] = request.url.split("/");
    const scenario = scenarios.get(name);
    if (scenario.cut) { response.writeHead(503); response.end(); return; }
    const path = "/" + rest.join("/");
    const idle = path.startsWith("/changes?");
    if (idle && !scenario.start) {
      scenario.start = performance.now();
      scenario.timer = setTimeout(() => { scenario.cut = performance.now(); }, scenario.offset);
    }
    const upstream = httpRequest(f.url + path, { method: request.method, headers: { ...request.headers, host: new URL(f.url).host } }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers);
      incoming.on("data", bytes => { if (!scenario.cut) response.write(bytes); });
      incoming.on("end", () => { if (!scenario.cut) response.end(); });
    });
    upstreams.add(upstream);
    upstream.on("error", () => { if (!scenario.cut) response.destroy(); });
    upstream.on("close", () => upstreams.delete(upstream));
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  t.after(() => { for (const s of scenarios.values()) clearTimeout(s.timer); for (const upstream of upstreams) upstream.destroy(); proxy.closeAllConnections(); proxy.close(); });
  await Promise.all(["wasm", "native"].flatMap(tier => [500, 5000, 15000].map(async offset => {
    const name = `${tier}-${offset}`;
    const times = { offset, start: 0, cut: 0, rejection: 0, notification: 0 };
    scenarios.set(name, times);
    const url = `http://127.0.0.1:${proxy.address().port}/${name}`;
    const client = await createLocalClient({ url, persona: "alice", device: f.opener(tier, name), fetch: async (input, init) => {
      if (new URL(input).pathname.endsWith("/changes")) init.signal.addEventListener("abort", () => { if (times.cut && !times.rejection) times.rejection = performance.now(); }, { once: true });
      return fetch(input, init);
    } });
    f.clients.push(client);
    client.onLink(link => { if (link === "offline" && !times.notification) times.notification = performance.now(); });
    await until(() => times.notification);
    const report = { store: tier, offsetMs: offset, requestStartMs: times.start, cutMs: times.cut, rejectionMs: times.rejection, notificationMs: times.notification, detectionMs: times.notification - times.cut };
    console.log(JSON.stringify(report));
    assert.ok(times.cut > times.start, "no false offline transition before the cut");
    assert.ok(times.rejection >= times.cut);
    assert.ok(report.detectionMs <= 5000, JSON.stringify(report));
    times.cut = 0;
    await until(() => client.link() === "online");
    assert.equal((await client.query({ kind: "query", name: "items" }, {})).data.length, 37);
    await client.close();
  })));
});

test("healthy heartbeat polls, buffered native fetch and browser connectivity hints", { timeout: hangBudget(10) }, async t => {
  const f = await host(t);
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const feed = changeFeed(fetch, f.url, lifetime.signal, () => assert.fail("healthy link"), () => {});
  const seq = (await (await fetch(f.url, { headers })).json()).seq;
  const start = performance.now();
  const result = await feed(seq, 5, headers);
  assert.equal(result.json.seq, seq);
  assert.ok(performance.now() - start >= 4900, "heartbeats keep one held poll healthy beyond the silence deadline");
  // React Native's non-streaming Response shape: healthy short polls and a
  // hung request share the browser watchdog, without browser network events.
  const OriginalResponse = globalThis.Response;
  globalThis.Response = class BufferedResponse {};
  try {
    const buffered = changeFeed(async (input, init) => {
      assert.equal(new URL(input).searchParams.get("wait"), "2");
      const response = await fetch(input, init);
      return { ok: response.ok, json: () => response.json() };
    }, f.url, lifetime.signal, () => {}, () => {});
    assert.equal((await buffered(seq, 25, headers)).json.seq, seq);
    const hung = changeFeed(() => new Promise(() => {}), f.url, lifetime.signal, () => {}, () => {});
    const cut = performance.now();
    await assert.rejects(hung(seq, 25, headers), /no response bytes/);
    assert.ok(performance.now() - cut <= 5000, "even a native fetch that ignores abort cannot block the watchdog");
  } finally { globalThis.Response = OriginalResponse; }
  const target = new EventTarget();
  const savedAdd = globalThis.addEventListener, savedRemove = globalThis.removeEventListener;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  let online = 0;
  const client = createClient({ url: f.url, persona: "alice", fetch: async (...args) => { if (new URL(args[0]).pathname === "/probe") online++; return fetch(...args); } });
  f.clients.push(client);
  try {
    target.dispatchEvent(new Event("offline"));
    assert.equal(client.link(), "offline");
    target.dispatchEvent(new Event("online"));
    await until(() => client.link() === "online");
    assert.equal(online, 1, "the browser online hint still authenticates through /probe");
    await client.close();
    target.dispatchEvent(new Event("online"));
    assert.equal(online, 1, "closing unregisters hints");
  } finally { await client.close(); globalThis.addEventListener = savedAdd; globalThis.removeEventListener = savedRemove; }
});

test("a streaming poll rechecks a revoked bearer before its final JSON", { timeout: hangBudget(8) }, async t => {
  const f = await host(t);
  const session = (await (await f.post("/auth/guest", {})).json()).session;
  const bearer = { authorization: `Bearer ${session.token}` };
  const seq = (await (await fetch(f.url, { headers: bearer })).json()).seq;
  const response = await fetch(`${f.url}/changes?since=${seq}&wait=1&heartbeat=1`, { headers: bearer });
  assert.equal(response.status, 200, "the first heartbeat starts the response");
  assert.equal((await fetch(f.url + "/auth/logout", { method: "POST", headers: bearer, body: "{}" })).status, 200);
  assert.equal((await response.json()).denied.code, "E_AUTH", "a heartbeat conveys no renewed authority");
});

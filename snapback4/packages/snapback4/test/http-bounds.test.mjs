// The real HTTP host: bounded admission, bounded encoding, and slow network
// clients release the engine. Only this test's recorded child/socket handles
// are closed. No process discovery, arbitrary port selection, or publication.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const MiB = 1 << 20;
const source = `use personas alice
table items:
  body: text <=400000
  read <- allow
  insert <- allow
  sync public last 10000 by byId
table photos:
  image: image <=10000000 once
  read <- allow
  insert <- allow
mutation add():
  return insert items { body: 'admitted' }
mutation attach(photo: image <=10000000):
  return insert photos { image: photo }
query ping():
  return 1
query count():
  return count(items[] first 2 by byId)
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("HTTP admission, encoding, slow readers and idle changes polls", { timeout: 60_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-http-bounds-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  const sockets = new Set();
  const headers = { "x-snapback-persona": "alice" };
  const post = (path, body) => fetch(url + path, { method: "POST", headers, body, signal: AbortSignal.timeout(3000) });
  const ping = async () => {
    const response = await post("/q/ping", "{}");
    assert.equal((await response.json()).data, 1);
  };
  async function raw(data) {
    const socket = connect({ host: "127.0.0.1", port: Number(new URL(url).port) });
    sockets.add(socket);
    let answer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { answer += chunk; });
    await once(socket, "connect");
    socket.end(data);
    await once(socket, "close");
    sockets.delete(socket);
    return answer;
  }
  async function rawBytes(data) {
    const socket = connect({ host: "127.0.0.1", port: Number(new URL(url).port) });
    sockets.add(socket);
    const chunks = [];
    socket.on("data", (chunk) => { chunks.push(chunk); });
    await once(socket, "connect");
    socket.end(data);
    const [hadError] = await once(socket, "close");
    sockets.delete(socket);
    assert.equal(hadError, false, "the peer sees an orderly EOF after the truncated response");
    assert.equal(socket.readableEnded, true, "the response stream reached EOF");
    return Buffer.concat(chunks);
  }
  try {
    const deadline = Date.now() + 3000;
    while (!url && child.exitCode == null && Date.now() < deadline) await sleep(10);
    assert.ok(url, log || "server did not listen");
    await t.test("the liveness probe requires credentials and has an explicit success body", async () => {
      const missing = await fetch(url + "/probe", { signal: AbortSignal.timeout(1000) });
      assert.equal(missing.status, 401);
      assert.equal((await missing.json()).denied?.code, "E_AUTH");
      const admitted = await fetch(url + "/probe", { headers, signal: AbortSignal.timeout(1000) });
      assert.equal(admitted.status, 200);
      const body = await admitted.json();
      assert.deepEqual(body, { ok: true, seq: 0, store_id: body.store_id });
      assert.match(body.store_id, /^[0-9a-f]{32}$/);
    });
    await t.test("catalog, generated API, native module, and change activity refuse anonymous callers", async () => {
      for (const path of ["/", "/schema", "/api.ts", "/native.wasm", "/changes?since=0&wait=0"]) {
        const response = await fetch(url + path, { signal: AbortSignal.timeout(500) });
        assert.equal(response.status, 401, `${path} must require a principal`);
        assert.equal((await response.json()).denied?.code, "E_AUTH");
      }
    });
    await t.test("declared/chunked oversize, truncation and invalid UTF-8 do not execute a write", async () => {
      const oversizedHeader = await raw(`GET / HTTP/1.1\r\nHost: localhost\r\nX-Oversized: ${"x".repeat(8193)}\r\nConnection: close\r\n\r\n`);
      assert.match(oversizedHeader, /^HTTP\/1.1 431/m);
      const declared = await raw(`POST /m/add HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: ${MiB + 1}\r\nExpect: 100-continue\r\nx-snapback-persona: alice\r\n\r\n`);
      assert.match(declared, /^HTTP\/1.1 413/m);
      assert.match(declared, /E_INPUT/);
      assert.doesNotMatch(declared, /100 Continue/);
      const chunked = await raw(`POST /m/add HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nTransfer-Encoding: chunked\r\nx-snapback-persona: alice\r\n\r\n${(MiB + 1).toString(16)}\r\n${" ".repeat(MiB + 1)}\r\n0\r\n\r\n`);
      assert.match(chunked, /^HTTP\/1.1 413/m);
      const truncated = await raw("POST /m/add HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 4096\r\nx-snapback-persona: alice\r\n\r\n{}");
      assert.match(truncated, /^HTTP\/1.1 400/m);
      assert.match(truncated, /Content-Length|cannot read/);
      const invalid = await post("/m/add", new Uint8Array([0xff]));
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).denied?.code, "E_INPUT");
      assert.equal((await (await post("/q/count", "{}")).json()).data, 0);
      const exact = await post("/m/add", "{}" + " ".repeat(MiB - 2));
      assert.equal((await exact.json()).state, "sent", "a JSON request at its exact admitted limit runs");
      assert.equal((await (await post("/q/count", "{}")).json()).data, 1);
    });
    await t.test("seed and upload retain their separate larger request ceilings", async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({ table: "items", row: { id: `large-${i}`, body: "x".repeat(400000) } }));
      const seeded = await post("/seed", JSON.stringify(rows));
      assert.equal((await seeded.json()).seeded, 4, "seed bodies larger than ordinary JSON remain admitted");
      const upload = await post("/assets", "not an image" + " ".repeat(2 * MiB));
      assert.notEqual(upload.status, 413, "uploads keep the 64 MiB ceiling");
      assert.match((await upload.json()).denied?.code ?? "", /^E_ASSET/);
    });
    await t.test("one-view assets finalize only after a complete non-range response", async () => {
      const png = new Uint8Array(8 * MiB);
      png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 6]);
      const uploaded = await (await post("/assets", png)).json();
      assert.ok(uploaded.asset?.id, JSON.stringify(uploaded));
      const id = uploaded.asset.id;
      const attached = await (await post("/m/attach", JSON.stringify({ args: { photo: { id } } }))).json();
      assert.equal(attached.state, "sent", JSON.stringify(attached));

      const ranged = await fetch(`${url}/assets/${id}`, { headers: { ...headers, range: "bytes=0-0" }, signal: AbortSignal.timeout(3000) });
      assert.equal(ranged.status, 416);
      assert.equal((await ranged.json()).denied?.code, "E_ASSET_RANGE");

      await new Promise((resolve, reject) => {
        const socket = connect({ host: "127.0.0.1", port: Number(new URL(url).port) });
        sockets.add(socket);
        let answer = "";
        socket.on("error", reject);
        socket.on("connect", () => socket.write(`GET /assets/${id} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\n\r\n`));
        socket.on("data", (chunk) => {
          answer += chunk.toString("latin1");
          if (answer.includes("\r\n\r\n")) {
            assert.match(answer, /^HTTP\/1.1 200/m);
            socket.destroy();
          }
        });
        socket.on("close", () => { sockets.delete(socket); resolve(); });
      });

      const assetPath = join(directory, ".snapback4", "assets", id);
      writeFileSync(assetPath, png.subarray(0, 2 * MiB));
      const pipelined = await rawBytes(
        `GET /assets/${id} HTTP/1.1\r\nHost: localhost\r\nTE: identity\r\nx-snapback-persona: alice\r\n\r\n`
        + "POST /q/ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 2\r\nx-snapback-persona: alice\r\n\r\n{}",
      );
      const headerEnd = pipelined.indexOf(Buffer.from("\r\n\r\n")) + 4;
      assert.ok(headerEnd >= 4, "the truncated response includes its headers");
      assert.match(pipelined.subarray(0, headerEnd).toString("latin1"), /^HTTP\/1\.1 200[\s\S]*Content-Length: 8388608/im);
      assert.ok(pipelined.length > headerEnd, "the peer receives the available asset prefix");
      assert.ok(pipelined.length - headerEnd < png.length, "the peer reaches EOF before the declared asset length");
      assert.equal(pipelined.indexOf(Buffer.from("HTTP/1.1"), 1), -1, "a queued response cannot append bytes after the truncated body");
      writeFileSync(assetPath, png);

      const complete = await fetch(`${url}/assets/${id}`, { headers, signal: AbortSignal.timeout(5000) });
      assert.equal(complete.status, 200);
      assert.equal((await complete.arrayBuffer()).byteLength, png.length);
      const viewed = await fetch(`${url}/assets/${id}`, { headers, signal: AbortSignal.timeout(3000) });
      assert.equal(viewed.status, 410);
      assert.equal((await viewed.json()).denied?.code, "E_ASSET_VIEWED");
    });
    await t.test("eight idle polls leave health/schema/query work free and commits wake subscribers", async () => {
      const controllers = Array.from({ length: 8 }, () => new AbortController());
      const polls = controllers.map((controller) => fetch(url + "/changes?since=99999999&wait=1", { headers, signal: controller.signal }).then((response) => response.json()).catch(() => null));
      try {
        await sleep(80);
        const started = Date.now();
        for (const path of ["/", "/schema"]) assert.equal((await fetch(url + path, { headers, signal: AbortSignal.timeout(500) })).status, 200);
        await ping();
        assert.ok(Date.now() - started < 500, "ordinary work must not await the long-poll interval");
        const { seq } = await (await fetch(url, { headers })).json();
        const wake = fetch(url + `/changes?since=${seq}&wait=2`, { headers }).then((response) => response.json());
        await sleep(30);
        const write = await (await post("/m/add", "{}")).json();
        const notified = await wake;
        assert.ok(notified.seq >= write.seq);
        assert.ok(notified.tables.includes("items"));
      } finally {
        controllers.forEach((controller) => controller.abort());
        await Promise.all(polls);
      }
    });
    await t.test("oversized sync JSON is refused and a smaller page remains valid", async () => {
      for (let batch = 0; batch < 10; batch++) {
        const rows = Array.from({ length: 4 }, (_, i) => ({ table: "items", row: { id: `bulk-${batch}-${i}`, body: "x".repeat(400000) } }));
        assert.equal((await (await post("/seed", JSON.stringify(rows))).json()).seeded, 4);
      }
      const oversized = await post("/sync", JSON.stringify({ limit: 100 }));
      const answer = await oversized.text();
      assert.ok(answer.length < 1000, "a large result becomes a small typed refusal");
      assert.equal(JSON.parse(answer).denied?.code, "E_BOUND");
      const smaller = await (await post("/sync", JSON.stringify({ limit: 1 }))).json();
      assert.equal(smaller.events.length, 1);
      assert.equal(smaller.more, true);
    });
    await t.test("Wasm and process clients acquire wide snapshots by shrinking the same cursor", async () => {
      for (const tier of ["wasm", "process"]) {
        const limits = [], requests = [], discoveries = [];
        const device = tier === "wasm"
          ? webDevice({ wasm, persist: memoryPersistence() })
          : processDevice({ binary, dir: join(directory, `device-${tier}`) });
        const client = await createLocalClient({ url, persona: "alice", device, waitSeconds: 1, fetch: async (input, init) => {
          if (new URL(input).pathname === "/sync") {
            const body = JSON.parse(init.body);
            if (body.metadata) discoveries.push(body);
            else { limits.push(body.limit); requests.push(body); }
          }
          return fetch(input, init);
        } });
        try {
          assert.equal(client.acquired, true, `${tier} must publish only the complete snapshot and catch-up`);
          assert.ok(discoveries.length > 0, `${tier} discovers authenticated metadata after overflow`);
          assert.deepEqual(limits.slice(0, 8), [4000, 2000, 1000, 500, 250, 125, 62, 31]);
          assert.ok(requests.slice(0, 8).every(request => request.from === 0 && request.after === null && request.stream === false), `${tier} retries one cursor and watermark`);
          assert.ok(requests.some(request => request.after !== null), `${tier} continues the reduced snapshot pages`);
          assert.ok(requests.some(request => request.stream === true), `${tier} completes catch-up before acquisition`);
          assert.equal((await client.query({ kind: "query", name: "count" }, {})).data, 2);
        } finally { await client.close(); }
      }
    });
    await t.test("a paused large response releases the engine before network progress", async () => {
      const socket = connect({ host: "127.0.0.1", port: Number(new URL(url).port), readableHighWaterMark: 1024 });
      sockets.add(socket);
      await once(socket, "connect");
      socket.write('POST /sync HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 12\r\n\r\n{"limit":38}');
      await once(socket, "readable");
      try {
        const started = Date.now();
        await ping();
        assert.ok(Date.now() - started < 500, "slow output must not hold the engine lock");
      } finally { socket.destroy(); sockets.delete(socket); }
    });
  } catch (error) {
    console.error(log);
    throw error;
  } finally {
    for (const socket of sockets) socket.destroy();
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await exited;
    rmSync(directory, { recursive: true, force: true });
  }
});

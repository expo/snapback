import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { runInNewContext } from "node:vm";
import { uploadAsset } from "../dist/assets.js";
import { defaultFetch } from "../dist/node-fetch.js";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const rateLimit = { code: "E_RATE_LIMIT", family: "auth", message: "all upload slots are full", retryable: true };
const asset = { id: "uploaded", type: "image/png", bytes: 3, width: 1, height: 1, duration: null };
const bytes = new Uint8Array([1, 2, 3]);
const wasm = readFileSync(new URL("../src/wasm/snapback4_device_bg.wasm", import.meta.url));

for (const tier of ["online", "web"]) test(`${tier} upload retries two HTTP admission refusals, then returns the admitted asset`, async t => {
  const attempts = [], bodies = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const reply = (body, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
    if (path === "/schema") return reply({ generation: 1, schema: { tables: {} }, programs: [] });
    if (path === "/sync") return reply({ snapshot: false, events: [], watermark: 0, more: false, generation: 1, acknowledged: [] });
    if (path === "/changes") return; // Close with the client/server; never send a fake change.
    if (path === "/probe") return reply({ ok: true });
    if (path !== "/assets") return reply({}, 404);
    attempts.push(Date.now());
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    bodies.push(Buffer.concat(chunks));
    assert.equal(request.headers["x-snapback-persona"], "alice");
    if (attempts.length <= 2) {
      response.setHeader("Retry-After", "0");
      return reply({ denied: rateLimit }, 429);
    }
    reply({ asset });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const options = { url: `http://127.0.0.1:${server.address().port}`, persona: "alice" };
  const client = tier === "online" ? createClient(options) : await createLocalClient({ ...options, device: webDevice({ wasm, persist: memoryPersistence() }) });
  t.after(() => client.close());
  const uploaded = await client.upload(bytes);
  assert.deepEqual(uploaded, { ok: true, asset });
  assert.equal(attempts.length, 3);
  assert.ok(attempts[1] - attempts[0] >= 245, "first retry backs off");
  assert.ok(attempts[2] - attempts[1] >= 495, "second retry increases backoff");
  for (const body of bodies) assert.deepEqual(body, Buffer.from(bytes));
});

function immediateTimers(t) {
  const delays = [];
  t.mock.method(Math, "random", () => 0.5);
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { delays.push(delay); queueMicrotask(callback); return 0; });
  return delays;
}

test("upload admission attempts are bounded and return the last refusal unchanged", async t => {
  const delays = immediateTimers(t);
  let attempts = 0;
  const result = await uploadAsset("http://uploads.invalid", {}, async () => {
    attempts++; return Response.json({ denied: rateLimit }, { status: 429 });
  }, bytes);
  assert.equal(attempts, 4); assert.deepEqual(delays, [281.25, 562.5, 1125]);
  assert.deepEqual(result, { ok: false, why: rateLimit });
});

for (const realm of ["current", "foreign"]) for (const host of ["web", "React Native"])
for (const kind of ["ArrayBuffer", "Uint8Array", "subarray"]) test(`${host} upload snapshots a ${realm}-realm ${kind} before the first attempt`, async t => {
  immediateTimers(t);
  if (host === "React Native") t.mock.method(globalThis, "Blob", class extends Blob {
    constructor(parts, options) {
      if (parts.some(part => part instanceof ArrayBuffer || ArrayBuffer.isView(part)))
        throw new Error("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported");
      super(parts, options);
    }
  });
  const values = kind === "subarray" ? [8, 1, 2, 3, 7] : [1, 2, 3];
  const original = realm === "foreign" ? runInNewContext(`new Uint8Array(${JSON.stringify(values)})`) : new Uint8Array(values);
  assert.equal(original instanceof Uint8Array, realm === "current");
  assert.equal(original.buffer instanceof ArrayBuffer, realm === "current");
  const input = kind === "ArrayBuffer" ? original.buffer : kind === "subarray" ? original.subarray(1, 4) : original;
  const bodies = [];
  const result = await uploadAsset("http://uploads.invalid", {}, async (_, init) => {
    if (host === "React Native") assert.ok(init.body instanceof Uint8Array, "send an owned view through the native buffer transport");
    bodies.push([...new Uint8Array(await new Response(init.body).arrayBuffer())]);
    original.fill(9);
    return bodies.length === 1 ? Response.json({ denied: rateLimit }, { status: 429 }) : Response.json({ asset });
  }, input);
  assert.deepEqual(result, { ok: true, asset });
  assert.deepEqual(bodies, [[1, 2, 3], [1, 2, 3]]);
  assert.ok(original.every(byte => byte === 9));
});

test("repeated Retry-After: 6 consumes the cumulative ten-second wait budget", async t => {
  const delays = immediateTimers(t);
  let attempts = 0;
  const result = await uploadAsset("http://uploads.invalid", {}, async () => {
    attempts++;
    return Response.json({ denied: rateLimit }, { status: 429, headers: { "Retry-After": "6" } });
  }, bytes);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [6750]);
  assert.deepEqual(result, { ok: false, why: rateLimit });
});

for (const why of [{ ...rateLimit, retryable: false }, { ...rateLimit, retryable: undefined }, { ...rateLimit, code: "E_STORE" }, { ...rateLimit, code: "E_AUTH", retryable: false }]) {
  test(`upload does not retry ${why.code} with retryable=${why.retryable}`, async t => {
    const delays = immediateTimers(t);
    let attempts = 0;
    const result = await uploadAsset("http://uploads.invalid", {}, async () => { attempts++; return Response.json({ denied: why }, { status: 429 }); }, bytes);
    assert.equal(attempts, 1); assert.deepEqual(delays, []);
    assert.equal(result.why.code, why.code);
  });
}

test("an upload with a lost reply is not retried because the bytes may have been stored", async t => {
  const delays = immediateTimers(t);
  let attempts = 0;
  const result = await uploadAsset("http://uploads.invalid", {}, async () => { attempts++; throw Error("lost response"); }, bytes);
  assert.equal(attempts, 1); assert.equal(result.why.code, "E_OFFLINE"); assert.deepEqual(delays, []);
  assert.match(result.why.message, /lost response/);
  assert.doesNotMatch(result.why.message, /unreachable/);
});

for (const [status, body] of [[503, "overloaded"], [413, "too large"], [200, "invalid json"], [200, "null"], [200, "{}"]]) {
  test(`upload reports HTTP ${status} with an invalid envelope without calling it unreachable`, async () => {
    let attempts = 0;
    const result = await uploadAsset("http://uploads.invalid", {}, async () => {
      attempts++;
      return new Response(body, { status });
    }, bytes);
    assert.equal(attempts, 1, "an invalid reply does not prove the upload was refused");
    assert.equal(result.ok, false);
    assert.equal(result.why.code, "E_HTTP_RESPONSE");
    assert.match(result.why.message, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(result.why.message, /unreachable/);
  });
}

test("upload preserves a server store refusal and its actual cause", async () => {
  const why = { code: "E_STORE", family: "store", message: "cannot keep the upload: No space left on device (os error 28)", retryable: true };
  const result = await uploadAsset("http://uploads.invalid", {}, async () => Response.json({ denied: why }, { status: 503 }), bytes);
  assert.deepEqual(result, { ok: false, why });
});

for (const capacity of ["connection", "worker"]) test(`fresh replay host reports ${capacity} overload to the real upload transport and recovers`, { timeout: hangBudget(11) }, async t => {
  const dir = await mkdtemp(join(tmpdir(), "sb4-upload-overload-"));
  await mkdir(join(dir, "snapback"));
  await writeFile(join(dir, "snapback/schema.q"), `use personas alice
table photos:
  photo: image <=10000
  read <- allow
`);
  const binary = process.env.SNAPBACK4_BIN ?? fileURLToPath(new URL("../../../target/debug/snapback4", import.meta.url));
  const child = spawn(binary, ["dev", "--fresh", "--replay", "--no-watch", "--port", "0"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "";
  child.stderr.on("data", bytes => { log += bytes; });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    child.kill("SIGTERM"); await exited;
    await rm(dir, { recursive: true, force: true });
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(Error(`server startup timeout: ${log}`)), hangBudget());
    child.stdout.on("data", bytes => {
      output += bytes;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    child.once("exit", () => { clearTimeout(timeout); reject(Error(`server exited: ${log}`)); });
  });
  const port = Number(new URL(url).port);
  // Slow headers fill connection leases; 100-continue witnesses prove that
  // unfinished mutations occupy all 32 workers before the upload is attempted.
  await Promise.all(Array.from({ length: capacity === "connection" ? 128 : 32 }, async () => {
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    sockets.push(socket);
    await once(socket, "connect");
    if (capacity === "worker") {
      const ready = once(socket, "data");
      socket.write("POST /m/held HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nContent-Length: 100000\r\nExpect: 100-continue\r\n\r\n");
      assert.match(String((await ready)[0]), /HTTP\/1.1 100 Continue/);
    }
  }));
  const png = Buffer.alloc(2081);
  Buffer.from("89504e470d0a1a0a0000000d494844520000000100000001", "hex").copy(png);
  let attempts = 0;
  const result = await uploadAsset(url, { "x-snapback-persona": "alice" }, (...args) => { attempts++; return defaultFetch(...args); }, png);
  assert.equal(attempts, 4, "the actual server refusal must be retryable");
  assert.equal(result.ok, false, log);
  assert.equal(result.why.code, "E_RATE_LIMIT", JSON.stringify(result));
  assert.match(result.why.message, /HTTP connections/);
  assert.match(log, capacity === "connection" ? /E_RATE_LIMIT at http: all 128 HTTP connections/ : /E_RATE_LIMIT at workers: cumulative refused=\[0, [1-9]/);
  assert.equal(child.exitCode, null, "host remains alive");
  for (const socket of sockets) socket.destroy();
  const recovered = await uploadAsset(url, { "x-snapback-persona": "alice" }, defaultFetch, png);
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
});

for (const [header, expected] of [["2", 2000], ["Thu, 24 Sep 2026 12:00:03 GMT", 3000], ["invalid", 250], ["Wed, 23 Sep 2026 12:00:00 GMT", 250]]) {
  test(`upload honors Retry-After ${header}`, async t => {
    const delays = immediateTimers(t);
    t.mock.method(Date, "now", () => Date.parse("2026-09-24T12:00:00Z"));
    let attempts = 0;
    const result = await uploadAsset("http://uploads.invalid", {}, async () => ++attempts === 1
      ? Response.json({ denied: rateLimit }, { status: 429, headers: { "Retry-After": header } }) : Response.json({ asset }), bytes);
    assert.equal(result.ok, true); assert.deepEqual(delays, [expected * 1.125]);
  });
}

test("Retry-After beyond the ten-second wait budget returns without retrying early", async t => {
  const delays = immediateTimers(t);
  let attempts = 0;
  const result = await uploadAsset("http://uploads.invalid", {}, async () => {
    attempts++; return Response.json({ denied: rateLimit }, { status: 429, headers: { "Retry-After": "60" } });
  }, bytes);
  assert.equal(attempts, 1); assert.deepEqual(delays, []); assert.deepEqual(result.why, rateLimit);
});

test("closing the client during admission backoff prevents another upload", async t => {
  let attempts = 0, close;
  t.mock.method(globalThis, "setTimeout", (callback) => { close(); queueMicrotask(callback); return 0; });
  const client = createClient({ url: "http://uploads.invalid", persona: "alice", fetch: async () => {
    attempts++; return Response.json({ denied: rateLimit }, { status: 429 });
  } });
  close = () => client.close();
  assert.equal((await client.upload(bytes)).why.code, "E_CLOSED");
  assert.equal(attempts, 1);
});

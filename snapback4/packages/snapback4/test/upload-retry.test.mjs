import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { uploadAsset } from "../dist/assets.js";
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
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { delays.push(delay); queueMicrotask(callback); return 0; });
  return delays;
}

test("upload admission attempts are bounded and return the last refusal unchanged", async t => {
  const delays = immediateTimers(t);
  let attempts = 0;
  const result = await uploadAsset("http://uploads.invalid", {}, async () => {
    attempts++; return Response.json({ denied: rateLimit }, { status: 429 });
  }, bytes);
  assert.equal(attempts, 4); assert.deepEqual(delays, [250, 500, 1000]);
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
});

for (const [header, expected] of [["2", 2000], ["Thu, 24 Sep 2026 12:00:03 GMT", 3000], ["invalid", 250], ["Wed, 23 Sep 2026 12:00:00 GMT", 250]]) {
  test(`upload honors Retry-After ${header}`, async t => {
    const delays = immediateTimers(t);
    t.mock.method(Date, "now", () => Date.parse("2026-09-24T12:00:00Z"));
    let attempts = 0;
    const result = await uploadAsset("http://uploads.invalid", {}, async () => ++attempts === 1
      ? Response.json({ denied: rateLimit }, { status: 429, headers: { "Retry-After": header } }) : Response.json({ asset }), bytes);
    assert.equal(result.ok, true); assert.deepEqual(delays, [expected]);
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
  await client.upload(bytes);
  assert.equal(attempts, 1);
});

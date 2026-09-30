import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { defaultFetch } from "../dist/node-fetch.js";
import { createClient } from "../dist/client.js";
import { server } from "./helpers/app-server.mjs";
import { ephemeralServer } from "./helpers/ephemeral-server.mjs";

async function peer(t, respond) {
  const requests = [], sockets = new Set();
  const host = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    requests.push({ path: request.url, body, socket: request.socket });
    if (request.url === "/probe") return response.end('{}');
    await respond(request, response, body, requests.filter(r => r.path !== "/probe").length);
  });
  host.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  host.listen(0, "127.0.0.1"); await once(host, "listening");
  t.after(async () => { for (const socket of sockets) socket.destroy(); host.close(); await once(host, "close"); });
  const url = `http://127.0.0.1:${host.address().port}`;
  const warm = async () => { await (await defaultFetch(url + "/probe")).text(); await delay(20); };
  return { url, requests, warm };
}
const post = body => ({ method: "POST", body: JSON.stringify(body) });
const offline = read => read.denied?.code === "E_OFFLINE";

for (const warm of [false, true]) for (const always of [false, true])
  test(`socket reset: reused=${warm}, reset again=${always}`, async t => {
    const f = await peer(t, (request, response, body, n) => {
      if (n === 1 || always) request.socket.resetAndDestroy();
      else response.end(JSON.stringify({ data: 1, complete: true, tables: [], seq: 0 }));
    });
    if (warm) await f.warm();
    let retries = 0;
    const client = createClient({ url: f.url, persona: "alice",
      fetch: (input, init) => defaultFetch(input, init, { onRetry: () => { retries++; } }),
    }); t.after(() => client.close());
    const read = await client.query({ kind: "query", name: "ping" }, {});
    const sent = f.requests.filter(r => r.path === "/q/ping");
    assert.equal(sent.length, warm ? 2 : 1);
    assert.equal(retries, warm ? 1 : 0, "notify each transport retry, including one that fails");
    assert.equal(offline(read), !warm || always, JSON.stringify(read));
    if (warm) {
      assert.equal(sent[0].socket, f.requests[0].socket, "the failed attempt really reused the warm socket");
      assert.notEqual(sent[1].socket, sent[0].socket, "the one retry uses a fresh connection");
      if (!always) assert.equal(read.data, 1);
    }
  });

test("retry observation stays with its caller and host fetch sees every attempt", async t => {
  const respond = (request, response, _, n) => {
    if (n === 1) request.socket.resetAndDestroy();
    else response.end('{}');
  };
  const observed = await peer(t, respond), other = await peer(t, respond);
  await observed.warm(); await other.warm();
  const originalFetch = globalThis.fetch, calls = [];
  t.mock.method(globalThis, "fetch", (input, init) => {
    calls.push(String(input));
    assert.equal(Object.hasOwn(init, "onRetry"), false, "private observer never enters host fetch options");
    return originalFetch(input, init);
  });
  const globalDispatchers = () => Object.getOwnPropertySymbols(globalThis)
    .filter(symbol => String(symbol).includes("undici.globalDispatcher"))
    .map(symbol => [symbol, globalThis[symbol]]);
  const before = globalDispatchers();
  let retries = 0;
  const replies = await Promise.all([
    defaultFetch(observed.url + "/sync", post({}), { onRetry: () => { retries++; } }),
    defaultFetch(other.url + "/sync", post({})),
  ]);
  await Promise.all(replies.map(reply => reply.text()));
  assert.equal(retries, 1, "the concurrent unobserved caller must not be recorded");
  for (const f of [observed, other]) {
    assert.equal(f.requests.filter(r => r.path === "/sync").length, 2);
    assert.equal(calls.filter(url => url === f.url + "/sync").length, 2);
  }
  assert.deepEqual(globalDispatchers(), before, "no process-wide dispatcher replacement");
});

for (const phase of ["partial header", "body"])
  test(`no retry after response bytes: ${phase}`, async t => {
    const f = await peer(t, async (request, response) => {
      request.socket.write(phase === "partial header" ? "HTTP/1.1 200" : 'HTTP/1.1 200 OK\r\nContent-Length: 100\r\nContent-Type: application/json\r\n\r\n{"data":');
      await delay(30); request.socket.resetAndDestroy();
    });
    await f.warm();
    const client = createClient({ url: f.url, persona: "alice" }); t.after(() => client.close());
    assert.ok(offline(await client.query({ kind: "query", name: "ping" }, {})));
    assert.equal(f.requests.filter(r => r.path === "/q/ping").length, 1);
  });

for (const [path, init] of [
  ["/auth/refresh", post({ token: "fixture" })],
  ["/assets", post({})], ["/assets/once", {}], ["/a/work", post({ id: "id" })],
  ["/m/ephemeral", post({ id: "id", args: {} })],
  ["/m/add", post({ retry_write: true, args: {} })],
]) test(`no ambiguous replay for ${path}`, async t => {
  const f = await peer(t, request => request.socket.resetAndDestroy());
  await f.warm();
  await assert.rejects(defaultFetch(f.url + path, init));
  assert.equal(f.requests.filter(r => r.path === path).length, 1);
});

test("a delivered overload is returned without socket retries", async t => {
  const f = await peer(t, (_, response) => { response.writeHead(503, { "Retry-After": "1" }); response.end('{"denied":{"code":"E_RATE_LIMIT"}}'); });
  await f.warm();
  assert.equal((await defaultFetch(f.url + "/q/ping", post({}))).status, 503);
  assert.equal(f.requests.filter(r => r.path === "/q/ping").length, 1);
});

test("a reset retry preserves one real durable mutation and its write ID", async t => {
  const backend = await server(t, undefined, `use personas alice
table items:
  body: text <=100
  read <- allow
  insert <- allow
mutation add():
  insert items { body: 'once' }
query count():
  return count(items[] first 100 by byId)
`);
  const replies = [];
  const f = await peer(t, async (request, response, body, n) => {
    const reply = await fetch(backend.url + request.url, { method: "POST", headers: { "x-snapback-persona": "alice" }, body });
    const text = await reply.text(); replies.push(JSON.parse(text));
    if (n === 1) request.socket.resetAndDestroy();
    else response.end(text);
  });
  await f.warm();
  const response = await defaultFetch(f.url + "/m/add", post({ id: "keepalive-write", retry_write: true, args: {} }));
  assert.equal((await response.json()).state, "sent");
  assert.equal(replies.length, 2);
  assert.equal(replies[0].state, "sent");
  assert.equal(replies[1].replayed, true);
  const writes = f.requests.filter(r => r.path === "/m/add");
  assert.equal(writes[0].body, writes[1].body);
  const count = await fetch(backend.url + "/q/count", { ...post({ args: {} }), headers: { "x-snapback-persona": "alice" } });
  assert.equal((await count.json()).data, 1);
});

test("the private agent retires idle sockets within the one-second budget", async t => {
  const f = await peer(t, (_, response) => response.end('{}'));
  await f.warm();
  const socket = f.requests[0].socket;
  const before = performance.now();
  await Promise.race([once(socket, "close"), delay(2500).then(() => assert.fail("idle socket was not retired"))]);
  assert.ok(performance.now() - before < 2500);
  await (await defaultFetch(f.url + "/q/ping", post({}))).text();
  assert.notEqual(f.requests[1].socket, socket);
});

test("a retryable durable envelope cannot execute an ephemeral operation", async t => {
  const f = await ephemeralServer(t);
  const headers = { "x-snapback-persona": "alice" };
  const send = retry_write => defaultFetch(f.url + "/m/setTyping", { ...post({ id: "id", args: { room: "r" }, retry_write }), headers });
  const refused = await (await send(true)).json();
  assert.equal(refused.state, "failed"); assert.equal(refused.why.code, "E_INPUT");
  const query = () => defaultFetch(f.url + "/q/typingIn", { ...post({ args: { room: "r" } }), headers: { "x-snapback-persona": "bob" } }).then(r => r.json());
  assert.deepEqual((await query()).data, []);
  assert.equal((await (await send(false)).json()).state, "sent");
  assert.equal((await query()).data.length, 1);
});

test("a reused-socket retry retains the original URL, body, write ID and headers", async t => {
  const requests = []; let input, init;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    if (request.url === "/probe") return response.end('{}');
    requests.push({ path: request.url, body: Buffer.concat(chunks).toString(), token: request.headers.authorization });
    if (requests.length === 1) {
      input.pathname = "/m/other";
      init.body = JSON.stringify({ id: "second", args: {}, retry_write: true });
      init.headers.authorization = "Bearer other-principal";
      request.socket.resetAndDestroy();
    } else response.end('{}');
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); server.close(); await once(server, "close"); });
  const base = `http://127.0.0.1:${server.address().port}`;
  input = new URL(base + "/m/add");
  init = { method: "POST", headers: { authorization: "Bearer original-principal" }, body: JSON.stringify({ id: "first", args: {}, retry_write: true }) };
  await (await defaultFetch(base + "/probe")).text(); await delay(20);
  await (await defaultFetch(input, init)).text();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0]);
});

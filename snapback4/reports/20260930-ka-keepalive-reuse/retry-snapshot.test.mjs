import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { defaultFetch } from "../../packages/snapback4/dist/node-fetch.js";

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

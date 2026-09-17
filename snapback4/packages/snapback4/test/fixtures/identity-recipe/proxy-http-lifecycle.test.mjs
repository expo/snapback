import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import test from "node:test";
import { closeExpectedProxy, createProxyPhase, settlesWithin, trackProxyExchange } from "./proxy-phase.mjs";

async function harness(proofHandler, initialFailure = null) {
  let failure = initialFailure;
  const lifecycle = createProxyPhase(code => { failure ??= code; });
  const exchanges = new Set();
  const server = createServer(async (request, response) => {
    let exchange;
    exchange = trackProxyExchange(lifecycle, request, response, () => exchanges.delete(exchange));
    exchanges.add(exchange);
    try {
      if (exchange.requestPhase.phase !== "proof") {
        response.writeHead(503, { connection: "close", "content-length": "0" }).end();
        return;
      }
      await proofHandler(request, response, exchange);
    } finally { exchange.handlerDone(); }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const request = path => new Promise(resolve => {
    const outgoing = get({ host: "127.0.0.1", port, path }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.once("end", () => resolve({ status: response.statusCode, body }));
      response.once("aborted", () => resolve({ aborted: true }));
      response.once("error", () => resolve({ error: true }));
    });
    outgoing.once("error", () => resolve({ error: true }));
  });
  const close = (drainMilliseconds = 50, closeMilliseconds = 50) => closeExpectedProxy({
    server, lifecycle, exchanges, currentFailure: () => failure, drainMilliseconds, closeMilliseconds,
  });
  return { close, exchanges, failure: () => failure, lifecycle, request, server };
}

test("proof stays active after handler return until the response finishes", async () => {
  let response;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const run = await harness((_request, found) => {
    response = found;
    found.write("buffered");
    markStarted();
  });
  const received = run.request("/slow");
  await started;
  assert.equal(await run.lifecycle.waitForProofDrain(5), false);
  response.end();
  assert.deepEqual(await received, { status: 200, body: "buffered" });
  assert.equal(await run.lifecycle.waitForProofDrain(20), true);
  assert.equal(await run.close(), null);
});

test("premature proof response close without an error event is fatal", async () => {
  const run = await harness((_request, response) => { response.destroy(); });
  assert.equal(await settlesWithin(run.request("/cut"), 50), true);
  assert.equal(run.failure(), "proxy-proof-request");
  assert.equal(await run.close(), "proxy-proof-request");
});

test("the registered intentional committed-mint cut is the only close exemption", async () => {
  const run = await harness((_request, response, exchange) => {
    exchange.intentionalCut();
    response.destroy();
  });
  assert.equal(await settlesWithin(run.request("/intentional-cut"), 50), true);
  assert.equal(run.failure(), null);
  assert.equal(await run.close(), null);
});

test("teardown serves 503 while a proof response is still draining", async () => {
  let proofResponse;
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const run = await harness((request, response) => {
    assert.equal(request.url, "/proof");
    proofResponse = response;
    response.write("proof");
    markStarted();
  });
  const proof = run.request("/proof");
  await started;
  const closing = run.close(200, 50);
  const teardown = await run.request("/during-teardown");
  assert.deepEqual(teardown, { status: 503, body: "" });
  proofResponse.end();
  assert.deepEqual(await proof, { status: 200, body: "proof" });
  assert.equal(await closing, null);
});

test("drain timeout aborts pending work and closes the owned server", async () => {
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const run = await harness((_request, response) => { response.write("held"); markStarted(); });
  const pending = run.request("/held");
  await started;
  assert.equal(await run.close(5, 50), "proxy-proof-drain-timeout");
  assert.equal(await settlesWithin(pending, 50), true);
  assert.equal(run.server.listening, false);
  assert.equal(run.exchanges.size, 0);
});

test("preexisting failure survives bounded abort cleanup unchanged", async () => {
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const run = await harness((_request, response) => { response.write("held"); markStarted(); }, "engine-spawn");
  const pending = run.request("/held");
  await started;
  assert.equal(await run.close(5, 50), "engine-spawn");
  assert.equal(await settlesWithin(pending, 50), true);
  assert.equal(run.server.listening, false);
  assert.equal(run.failure(), "engine-spawn");
});

import { captureStdout } from './helpers/server-output.mjs';
import { hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { connect } from "node:net";
import { createServer as httpsServer } from "node:https";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binary, until } from "./helpers/app-server.mjs";
import { defaultFetch } from "../dist/node-fetch.js";

const source = `use identity
use personas alice
query ping():
  return 1
`;

async function host(t, serve) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-keepalive-"));
  mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), source);
  if (serve) {
    const deployed = spawnSync(binary, ["deploy", join(dir, "release")], { cwd: dir, encoding: "utf8" });
    assert.equal(deployed.status, 0, deployed.stdout + deployed.stderr);
  }
  const child = spawn(binary, [...(serve ? ["serve", "release"] : ["dev", "--no-watch"]), "--port", "0"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(child);
  const exited = once(child, "exit"); let log = "";
  child.stdout.on("data", bytes => { log += bytes; }); child.stderr.on("data", bytes => { log += bytes; });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; rmSync(dir, { recursive: true, force: true }); });
  const url = await until(() => { assert.equal(child.exitCode, null, log); return readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  return { url, dir };
}

async function raw(url, version, connection, path = "/probe", method = "GET") {
  const socket = connect({ host: "127.0.0.1", port: Number(new URL(url).port) });
  socket.setEncoding("utf8"); let answer = "";
  const headers = new Promise((resolve, reject) => {
    socket.setTimeout(hangBudget(), () => reject(Error("no response headers before deadline")));
    socket.on("data", bytes => { answer += bytes; if (answer.includes("\r\n\r\n")) resolve(answer.split("\r\n\r\n")[0]); });
    socket.on("error", reject);
    socket.on("end", () => { if (!answer.includes("\r\n\r\n")) reject(Error(answer || "no headers")); });
  });
  await once(socket, "connect");
  socket.write(`${method} ${path} HTTP/${version}\r\nHost: localhost\r\n${connection}x-snapback-persona: alice\r\n\r\n`);
  try { return await headers; } finally { socket.destroy(); }
}

for (const serve of [false, true]) test(`${serve ? "serve" : "dev"}: keep-alive headers agree with HTTP connection policy`, async t => {
  const { url } = await host(t, serve);
  for (const [version, connection, keep] of [
    ["1.1", "", true], ["1.1", "Connection: keep-alive\r\n", true],
    ["1.1", "Connection: close\r\n", false],
    ["1.0", "", false], ["1.0", "Connection: keep-alive\r\n", true],
    ["1.0", "Connection: keep-alive, close\r\n", false],
    ["1.1", "Connection: keep-alive\r\nConnection: ClOsE\r\n", false],
    ["1.1", "Connection: x-close\r\n", true],
  ]) {
    const reply = await raw(url, version, connection);
    assert.match(reply, /^HTTP\/1\.[01] (?:200|401)/);
    if (keep) { assert.match(reply, /\r\nKeep-Alive: timeout=5(?:\r\n|$)/i); assert.match(reply, /\r\nConnection: keep-alive(?:\r\n|$)/i); }
    else { assert.doesNotMatch(reply, /\r\nKeep-Alive:/i); assert.match(reply, /\r\nConnection: close(?:\r\n|$)/i); }
  }
  if (!serve) {
    const ordinary = await defaultFetch(url + "/api.ts", { headers: { "x-snapback-persona": "alice" } });
    assert.equal(ordinary.headers.get("keep-alive"), "timeout=5"); await ordinary.text();
    const refused = await raw(url, "1.1", "Content-Length: 1048577\r\nExpect: 100-continue\r\n", "/q/ping", "POST");
    assert.match(refused, /^HTTP\/1.1 413/); assert.match(refused, /Connection: close/i); assert.doesNotMatch(refused, /Keep-Alive:/i);
    const streamedClose = await raw(url, "1.1", "Connection: close\r\n", "/changes?since=0&wait=6&heartbeat=1");
    assert.match(streamedClose, /Connection: close/i); assert.doesNotMatch(streamedClose, /Keep-Alive:/i);
  }
});

test("serve through a trusted TLS terminator retains SDK keep-alive", async t => {
  // serve's shipped TLS topology is HTTPS at a reverse proxy, HTTP to serve.
  const { url, dir } = await host(t, true);
  const cert = join(dir, "cert.pem"), key = join(dir, "key.pem");
  const made = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  const proxy = httpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (request, response) => {
    const upstream = await fetch(url + request.url);
    response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
    response.end(Buffer.from(await upstream.arrayBuffer()));
  });
  proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
  t.after(async () => { proxy.closeAllConnections(); proxy.close(); await once(proxy, "close"); });
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { channel } from 'node:diagnostics_channel';
    import { defaultFetch } from ${JSON.stringify(new URL("../dist/node-fetch.js", import.meta.url).href)};
    const sockets = [];
    channel('undici:client:sendHeaders').subscribe(({socket}) => sockets.push(socket));
    for (let i = 0; i < 2; i++) {
      const response = await defaultFetch('https://127.0.0.1:${proxy.address().port}/probe');
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('keep-alive'), 'timeout=5');
      await response.text(); await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(sockets.length, 2); assert.equal(sockets[0], sockets[1]); assert.equal(sockets[0].encrypted, true);
  `], { env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", bytes => { log += bytes; }); child.stderr.on("data", bytes => { log += bytes; });
  const [code] = await once(child, "exit"); assert.equal(code, 0, log);
});

test("held and heartbeat /changes responses exceed idle timeout and remain reusable", { timeout: hangBudget(5) }, async t => {
  const { url } = await host(t, false);
  const headers = { "x-snapback-persona": "alice" };
  for (const heartbeat of [0, 1]) {
    const start = performance.now();
    const response = await defaultFetch(url + `/changes?since=0&wait=6&heartbeat=${heartbeat}`, { headers, signal: AbortSignal.timeout(hangBudget()) });
    assert.equal(response.headers.get("keep-alive"), "timeout=5");
    const body = await response.json();
    assert.equal(body.seq, 0, JSON.stringify(body));
    assert.ok(performance.now() - start >= 5900, "held response survives the five-second idle boundary");
    const next = await defaultFetch(url + "/probe", { headers });
    assert.equal((await next.json()).ok, true);
  }
});

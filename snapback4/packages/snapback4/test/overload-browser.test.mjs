import { hangBudget, waitFor } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { connect, createServer as createTcpServer } from 'node:net';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { chromiumExecutable } from '../../../witness/lib.mjs';
import { binary } from './helpers/app-server.mjs';
import { signalChild, spawnTracked as spawn } from '../../../scripts/test-signals.mjs';
import { captureStdout } from './helpers/server-output.mjs';

// @ref LLP 3000#http-overload-diagnostics — existing leases keep their real deadlines.
// A TCP connect only establishes the kernel socket, not a host admission lease.
// Warm requests can still own slots, and silent leases expire after five seconds.
// Keep replacing closed/refused sockets throughout the witness; a one-shot bank
// can remain below capacity forever after either event, particularly under load.
function occupyConnections(port, count, onRefused = () => {}) {
  const sockets = new Set(), timers = new Set();
  let stopped = false;
  function open() {
    if (stopped) return;
    const socket = connect(port, '127.0.0.1'); sockets.add(socket);
    socket.on('error', () => {});
    const reply = [];
    socket.on('data', bytes => reply.push(bytes));
    socket.once('end', () => { if (/^HTTP\/1\.[01] 503 /.test(Buffer.concat(reply).toString())) onRefused(); });
    socket.resume(); // Consume refusals/EOF so close can replenish the slot.
    socket.once('close', () => {
      sockets.delete(socket);
      if (stopped) return;
      const timer = setTimeout(() => { timers.delete(timer); open(); }, 50);
      timers.add(timer);
    });
  }
  for (let index = 0; index < count; index++) open();
  return () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    for (const socket of sockets) socket.destroy();
  };
}

test('the overload socket bank replaces refused and expired admission leases', { timeout: hangBudget(3) }, async t => {
  const admitted = new Set();
  let refused = 0;
  const intake = createTcpServer(socket => {
    if (admitted.size === 2) { refused++; socket.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n'); return; }
    admitted.add(socket); socket.on('error', () => {});
    socket.once('close', () => admitted.delete(socket));
  });
  intake.listen(0, '127.0.0.1'); await once(intake, 'listening');
  t.after(() => { for (const socket of admitted) socket.destroy(); intake.close(); });
  const port = intake.address().port;
  const warm = connect(port, '127.0.0.1'); warm.on('error', () => {});
  t.after(() => warm.destroy());
  await waitFor(() => admitted.size === 1, 'warm request owns an admission slot');
  const warmLease = [...admitted][0];
  let observedRefusal = false;
  const release = occupyConnections(port, 2, () => { observedRefusal = true; }); t.after(release);
  await waitFor(() => refused > 0 && observedRefusal, 'bank observes its refused socket behind the warm request');
  warm.destroy();
  await waitFor(() => admitted.size === 2 && !admitted.has(warmLease), 'bank replaces the refused socket');
  const expired = [...admitted][0]; expired.destroy();
  await waitFor(() => admitted.size === 2 && !admitted.has(expired), 'bank replaces an expired silent lease');
});

test('Chromium reads cross-origin admission refusals and Retry-After; upload actually retries four times', { timeout: hangBudget(16) }, async t => {
  // Derive intake capacity from the actual binary; main may enlarge its short queue.
  const saved = [process.env.SNAPBACK4_LONG_WAITS, process.env.SNAPBACK4_CLAIM_WAITS];
  process.env.SNAPBACK4_LONG_WAITS = '1'; process.env.SNAPBACK4_CLAIM_WAITS = '1';
  t.after(() => { for (const [name, value] of [['SNAPBACK4_LONG_WAITS', saved[0]], ['SNAPBACK4_CLAIM_WAITS', saved[1]]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  const dir = mkdtempSync(join(tmpdir(), 'sb4-overload-browser-'));
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), `use personas alice
table photos:
  photo: image <=10000
  read <- allow
`);
  // Own startup here so admission contains only this fixture's explicit sockets.
  const host = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(host, 'exit'), stdout = captureStdout(host);
  let diagnostics = ''; host.stderr.on('data', bytes => { diagnostics += bytes; });
  t.after(async () => { if (host.exitCode === null && host.signalCode === null) await signalChild(host, 'SIGTERM'); await exited; rmSync(dir, { recursive: true, force: true }); });
  const url = await waitFor(() => { assert.equal(host.exitCode, null); return stdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; }, 'backend ready');
  const connections = Number((await waitFor(() => diagnostics.match(/HTTP connections=(\d+)/), 'reported admission capacity'))[1]);
  assert.ok(Number.isSafeInteger(connections) && connections > 0);
  // A transparent test proxy asks the backend to close warm connections, so
  // overload cannot reuse an admitted socket. It changes no CORS header/body.
  let saturated = false;
  const proxy = createServer((req, res) => {
    if (saturated) {
      // Drain the caller before dialing; send no bytes to the saturated host.
      // The raw upstream therefore has no unread request body to reset.
      req.once("end", () => {
        const upstream = connect(Number(new URL(url).port), "127.0.0.1"), chunks = [];
        upstream.on("data", bytes => chunks.push(bytes));
        upstream.on("error", () => res.destroy());
        res.on("close", () => upstream.destroy());
        upstream.once("end", () => {
          const reply = Buffer.concat(chunks), split = reply.indexOf("\r\n\r\n");
          const lines = reply.subarray(0, split).toString().split("\r\n");
          const status = lines.shift()?.match(/^HTTP\/1\.[01] (\d+)/);
          if (split < 0 || !status) { res.destroy(); return; }
          const headers = Object.fromEntries(lines.map(line => {
            const colon = line.indexOf(":"); return [line.slice(0, colon), line.slice(colon + 1).trim()];
          }));
          res.writeHead(Number(status[1]), { ...headers, connection: "close" }); res.end(reply.subarray(split + 4));
        });
      });
      req.resume();
    } else {
      const upstream = request(new URL(req.url, url), { method: req.method, headers: { ...req.headers, host: new URL(url).host, connection: "close" } }, reply => {
        res.writeHead(reply.statusCode, { ...reply.headers, connection: "close" }); reply.pipe(res);
      });
      upstream.on("error", () => res.destroy()); req.pipe(upstream);
    }
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); });
  const browserURL = `http://127.0.0.1:${proxy.address().port}`;
  const front = createServer((req, res) => {
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Admission witness</title>'); return; }
    if (!/^\/[a-z-]+\.js$/.test(req.url)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', 'text/javascript'); res.end(readFileSync(new URL(`../dist${req.url}`, import.meta.url)));
  });
  front.listen(0, '127.0.0.1'); await once(front, 'listening');
  t.after(() => { front.closeAllConnections(); front.close(); });
  const browser = await chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget()); await page.goto(`http://127.0.0.1:${front.address().port}`);
  const png = Buffer.alloc(2081); Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex').copy(png);
  const warm = await page.evaluate(async ({ url, png }) => {
    window.sdk = await import('/assets.js'); window.png = new Uint8Array(png);
    return window.sdk.uploadAsset(url, { 'x-snapback-persona': 'alice' }, fetch, window.png);
  }, { url: browserURL, png: [...png] });
  assert.equal(warm.ok, true, JSON.stringify(warm)); // includes a real browser preflight
  // Keep a bounded surplus of contenders: replacements race lease expiry too.
  // Exactly capacity contenders can continually trail the real admitted count.
  let bankRefused = false;
  t.after(occupyConnections(Number(new URL(url).port), connections * 2, () => { bankRefused = true; }));
  // Observe a real refusal from the bank itself. A separate HTTP probe can
  // acquire the final slot during intake, or reset a refusal with unread bytes.
  await waitFor(() => bankRefused && diagnostics.includes(`E_RATE_LIMIT at http: all ${connections} HTTP connections`),
    'connection leases are admitted and saturated', { diagnostics: () => diagnostics });
  saturated = true;
  const result = await page.evaluate(async url => {
    const response = await fetch(`${url}/schema`);
    const status = response.status, after = response.headers.get('retry-after'), body = await response.json();
    // Check the requested minimum delay with a controlled backoff clock;
    // The replenished silent leases retain the host's real five-second deadline.
    const schedule = window.setTimeout.bind(window), delays = [];
    window.setTimeout = (callback, delay, ...args) => { delays.push(delay); return schedule(callback, 0, ...args); };
    let attempts = 0;
    const upload = await window.sdk.uploadAsset(url, { 'x-snapback-persona': 'alice' }, (...args) => { attempts++; return fetch(...args); }, window.png);
    const preflight = await window.sdk.uploadAsset(url, { 'x-snapback-persona': 'alice', 'x-uncached-preflight': '1' }, fetch, window.png);
    window.setTimeout = schedule;
    return { status, after, body, attempts, delays, upload, preflight };
  }, browserURL);
  assert.equal(result.status, 503); assert.equal(result.after, '1');
  assert.equal(result.body.denied.family, 'limit'); assert.equal(result.body.denied.retryable, true);
  assert.equal(result.upload.why?.code, 'E_RATE_LIMIT', JSON.stringify(result)); assert.equal(result.attempts, 4);
  assert.equal(result.delays.length, 3); assert.ok(result.delays.every(delay => delay >= 1000 && delay <= 1250), JSON.stringify(result.delays));
  assert.equal(result.preflight.why?.code, 'E_OFFLINE'); assert.doesNotMatch(result.preflight.why.message, /unreachable/);
});

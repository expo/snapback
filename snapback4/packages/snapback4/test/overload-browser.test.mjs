import { hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { chromiumExecutable } from '../../../witness/lib.mjs';
import { server } from './helpers/app-server.mjs';

test('Chromium reads cross-origin admission refusals and Retry-After; upload actually retries four times', { timeout: hangBudget(16) }, async t => {
  // Smallest long-wait pools: the connection cap is then 128 + 1 + 1 (LLP 3000.036 §6).
  const saved = [process.env.SNAPBACK4_LONG_WAITS, process.env.SNAPBACK4_CLAIM_WAITS];
  process.env.SNAPBACK4_LONG_WAITS = '1'; process.env.SNAPBACK4_CLAIM_WAITS = '1';
  t.after(() => { for (const [name, value] of [['SNAPBACK4_LONG_WAITS', saved[0]], ['SNAPBACK4_CLAIM_WAITS', saved[1]]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  const { url } = await server(t, undefined, `use personas alice
table photos:
  photo: image <=10000
  read <- allow
`);
  // A transparent test proxy asks the backend to close warm connections, so
  // overload cannot reuse an admitted socket. It changes no CORS header/body.
  let saturated = false;
  const proxy = createServer((req, res) => {
    const upstream = request(new URL(req.url, url), { method: req.method, headers: { ...req.headers, host: new URL(url).host, connection: 'close' } }, reply => {
      res.writeHead(reply.statusCode, { ...reply.headers, connection: 'close' }); reply.pipe(res);
    });
    upstream.on('error', () => res.destroy());
    // During saturation the real server replies before seeing request bytes.
    // Withhold them to make reply delivery deterministic, isolating browser
    // CORS from the separately tested best-effort TCP reset path.
    if (saturated) req.resume(); else req.pipe(upstream);
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
  const held = [];
  t.after(() => { for (const socket of held) socket.destroy(); });
  await Promise.all(Array.from({ length: 130 }, async () => {
    const socket = connect(Number(new URL(url).port), '127.0.0.1'); held.push(socket); socket.on('error', () => {}); await once(socket, 'connect');
  }));
  await new Promise(resolve => setTimeout(resolve, 100));
  saturated = true;
  const result = await page.evaluate(async url => {
    const response = await fetch(`${url}/schema`);
    const status = response.status, after = response.headers.get('retry-after'), body = await response.json();
    let attempts = 0;
    const upload = await window.sdk.uploadAsset(url, { 'x-snapback-persona': 'alice' }, (...args) => { attempts++; return fetch(...args); }, window.png);
    const preflight = await window.sdk.uploadAsset(url, { 'x-snapback-persona': 'alice', 'x-uncached-preflight': '1' }, fetch, window.png);
    return { status, after, body, attempts, upload, preflight };
  }, browserURL);
  assert.equal(result.status, 503); assert.equal(result.after, '1');
  assert.equal(result.body.denied.family, 'limit'); assert.equal(result.body.denied.retryable, true);
  assert.equal(result.upload.why?.code, 'E_RATE_LIMIT', JSON.stringify(result)); assert.equal(result.attempts, 4);
  assert.equal(result.preflight.why?.code, 'E_OFFLINE'); assert.doesNotMatch(result.preflight.why.message, /unreachable/);
});

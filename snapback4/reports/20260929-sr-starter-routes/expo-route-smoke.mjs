// Run from the Snapback 4 workspace after scaffolding/installing target/sr-export.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { chromium } from 'playwright-core';
import { chromiumExecutable } from '../../witness/lib.mjs';
import { guest } from 'snapback4/auth';
import { createClient, mintId } from 'snapback4/client';
const root = resolve(import.meta.dirname, '../..'), app = join(root, 'target/sr-export');
const host = spawn(join(root, 'target/debug/snapback4'), ['dev', '--port', '0', '--no-watch'], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', browser, web, peer;
host.stdout.on('data', b => output += b); host.stderr.on('data', b => output += b);
const until = async (fn, label) => { for (let n = 0; n < 500; n++) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 20)); } throw Error(label); };
try {
  const url = await until(() => output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0], 'dev ready');
  const exported = spawnSync(join(app, 'node_modules/.bin/expo'), ['export', '--platform', 'web', '--output-dir', 'dist-smoke', '--clear', '--max-workers', '4'], { cwd: app, env: { ...process.env, EXPO_PUBLIC_SNAPBACK_URL: url }, encoding: 'utf8' });
  writeFileSync(join(import.meta.dirname, 'export-web-smoke.log'), exported.stdout + exported.stderr);
  assert.equal(exported.status, 0);
  const bob = (await guest(url)).session;
  peer = createClient({ url, token: bob.token });
  const op = (name, kind) => ({ name, kind });
  assert.equal((await peer.mutate(op('saveProfile', 'mutation'), { name: 'Bob' })).state, 'sent');
  web = createServer((req, res) => {
    const requested = join(app, 'dist-smoke', new URL(req.url, 'http://local').pathname);
    const file = existsSync(requested) && extname(requested) ? requested : join(app, 'dist-smoke/index.html');
    res.setHeader('content-type', ({ '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.png': 'image/png' })[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${web.address().port}/profile`);
  const guestResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/auth/guest');
  await page.getByRole('button', { name: 'Continue as a guest', exact: true }).click();
  const alice = (await (await guestResponse).json()).session;
  await page.getByRole('textbox', { name: 'Account to follow' }).fill(bob.principal).catch(async error => { console.log(await page.locator('body').innerText(), errors); throw error; });
  await page.getByRole('button', { name: 'Message Bob', exact: true }).waitFor();
  // Allow the initial empty owner partition to finish acquiring, independently of profile fallback.
  await page.waitForFunction(() => Object.keys(localStorage).some(k => k.includes('session')));
  await new Promise(r => setTimeout(r, 1500));
  await context.setOffline(true);
  const canonical = mintId();
  const created = await peer.mutate(op('openDirect', 'mutation'), { id: canonical, other: alice.principal });
  assert.equal(created.state, 'sent'); assert.equal(created.result, canonical);
  await page.getByRole('button', { name: 'Message Bob', exact: true }).click();
  const composer = page.getByTestId('composer');
  await composer.waitFor();
  assert.ok(!page.url().includes(canonical));
  await composer.fill('Expo route draft'); await composer.focus();
  await page.evaluate(() => { window.draftNode = document.querySelector('[data-testid="composer"]'); });
  await context.setOffline(false);
  await page.waitForURL(new RegExp('/conversation/' + canonical), { timeout: 20_000 });
  assert.equal(await composer.inputValue(), 'Expo route draft');
  assert.equal(await composer.evaluate(n => n === window.draftNode && document.activeElement === n), true);
  assert.deepEqual(errors, []);
  console.log('PASS: production Expo Router + React Native Web; offline creation, canonical URL replacement, same composer DOM node/draft/focus; zero page errors.');
} finally {
  await browser?.close(); await peer?.close();
  await new Promise(r => web ? web.close(r) : r());
  if (host.exitCode === null) { const done = new Promise(r => host.once('exit', r)); host.kill('SIGTERM'); await done; }
}

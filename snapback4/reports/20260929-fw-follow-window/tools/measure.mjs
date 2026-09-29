// Lane LL's two-account/two-context harness, narrowed to the reader's own edge.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, cpus, loadavg, availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { signup } from '../../../packages/snapback4/dist/auth.js';
import { processDevice } from '../../../packages/snapback4/dist/native.js';
import { chromiumExecutable } from '../../../witness/lib.mjs';
import { trace, observe, perform, render } from './trace.mjs';

const root = resolve(import.meta.dirname, '../../..');
const sdk = process.env.FW_LOCAL_MODULE ?? join(root, 'packages/snapback4/dist/local.js');
const { createLocalClient } = await import(pathToFileURL(sdk));
const runs = Number(process.env.FW_RUNS ?? 20), tier = process.env.FW_TIER ?? 'wasm';
const out = resolve(process.env.FW_OUT ?? '/tmp/fw.json');
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4-ll-measure');
const dir = mkdtempSync(join(tmpdir(), 'sb4-fw-'));
mkdirSync(join(dir, 'snapback'));
copyFileSync(join(import.meta.dirname, 'fixture.q'), join(dir, 'snapback/schema.q'));
for (const file of ['page.jsx', 'trace.mjs']) copyFileSync(join(import.meta.dirname, file), join(dir, file));
writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/page.jsx"></script>');
const host = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: dir, env: { ...process.env, LL_COMMIT_TRACE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '', buffer = '';
const commits = [], clients = [], samples = [];
host.stdout.on('data', x => output += x);
host.stderr.on('data', x => {
  errors += x; buffer += x;
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    const match = /^LL_COMMIT (\S+) (\d+) ([\d.]+)$/.exec(line);
    if (match) commits.push({ name: match[1], seq: Number(match[2]), at: Number(match[3]) });
  }
});
let browser, vite, watch;
const log = trace();
const loadWorkers = Array.from({ length: Number(process.env.FW_LOAD ?? 0) }, () => spawn(process.execPath, ['-e', 'while (true) {}'], { stdio: 'ignore' }));
async function until(fn, label, timeout = 20000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const result = await fn(); if (result) return result; await delay(10); }
  throw Error('timeout: ' + label + '\n' + errors.slice(-2500));
}
try {
  const url = await until(() => { if (host.exitCode !== null) throw Error(errors); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, 'server');
  const sessions = [];
  for (const name of ['alice', 'bob']) {
    const result = await signup(url, name + '@example.test', 'long-test-password');
    assert.ok(result.ok, JSON.stringify(result)); sessions.push(result.session);
  }
  const require = createRequire(join(root, 'package.json'));
  const { chromium } = require('playwright-core');
  const { createServer } = await import(pathToFileURL(createRequire(join(root, 'apps/chat/package.json')).resolve('vite')));
  const pkg = createRequire(join(root, 'packages/snapback4/package.json'));
  vite = await createServer({ root: dir, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } }, resolve: { alias: [
    ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: pkg.resolve(name) })),
    ...['local', 'web'].map(name => ({ find: 'snapback4/' + name, replacement: join(root, 'packages/snapback4/dist/' + name + '.js') })),
  ] } });
  await vite.listen();
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const pages = [];
  let publications = Promise.resolve();
  for (const [index, session] of sessions.entries()) {
    const context = await browser.newContext(), page = await context.newPage(); pages.push(page);
    page.on('pageerror', e => { errors += '\nBROWSER ' + e.stack; });
    await page.goto(vite.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.openClient);
    await page.evaluate(options => window.openClient(options), { url, session, tier, receiver: index === 1 });
    if (tier === 'process') {
      // Only Bob's transport/apply belongs to the receiver's stage timings.
      const clientLog = index === 1 ? log : trace();
      const client = await createLocalClient({ url, session, device: clientLog.device(processDevice({ binary: join(root, 'target/debug/snapback4'), dir: join(dir, 'device' + index) })), fetch: clientLog.fetch });
      clients.push(client); await client.sync();
      if (index === 1) watch = observe(client, log, read => { publications = publications.then(() => page.evaluate(read => window.receive(read), read)); });
    }
    if (index === 0) {
      if (tier === 'wasm') await page.evaluate(() => window.seed());
      else {
        for (const postId of ['first', 'second', 'third']) assert.equal((await clients[0].mutate({ kind: 'mutation', name: 'post' }, { postId, parentId: null })).state, 'sent');
        assert.equal((await clients[0].mutate({ kind: 'mutation', name: 'repost' }, { postId: 'first' })).state, 'sent');
      }
    }
  }
  const receiver = pages[1];
  await until(() => receiver.evaluate(() => window.ready(0)), 'initial empty feed');
  for (let run = 0; run < runs; run++) for (const op of ['follow', 'unfollow']) {
    await publications;
    await receiver.evaluate(() => window.prepare());
    log.events.length = 0;
    if (watch) log.mark('initial', { read: watch.getSnapshot(), ui: render(watch.getSnapshot()) });
    const commitStart = commits.length;
    const actor = sessions[0].principal;
    const write = tier === 'wasm' ? await receiver.evaluate(options => window.perform(options), { op, actor }) : await perform(clients[1], log, op, actor);
    let timeout = false;
    try { await until(() => receiver.evaluate(n => window.ready(n), op === 'follow' ? 4 : 0), op); } catch { timeout = true; }
    await publications;
    const browserEvents = await receiver.evaluate(() => window.events());
    const events = tier === 'wasm' ? browserEvents : [...log.events, ...browserEvents.filter(e => e.stage === 'react')].sort((a, b) => a.at - b.at);
    const commit = commits.slice(commitStart).find(c => c.name === op);
    assert.ok(commit, 'instrumented commit stamp');
    samples.push({ run, op, timeout, commit, write, events });
    writeFileSync(out, JSON.stringify({ metadata: { tier, runs, cpu: cpus()[0].model, loadWorkers: loadWorkers.length, cpus: availableParallelism(), load: loadavg(), browser: browser.version(), node: process.version, binary, sdk, processRenderBridge: tier === 'process', clock: 'UNIX milliseconds: Chromium/Node performance.timeOrigin + performance.now; server post-commit SystemTime' }, samples }, null, 2));
    console.log(JSON.stringify({ tier, run, op, timeout, publications: events.filter(e => e.stage === 'published').length }));
    assert.equal(timeout, false);
  }
} finally {
  for (const worker of loadWorkers) worker.kill();
  watch?.close();
  for (const client of clients) await client.close();
  await browser?.close(); await vite?.close();
  const exited = new Promise(resolve => host.once('exit', resolve));
  if (host.exitCode === null) { host.kill(); await exited; }
  rmSync(dir, { recursive: true, force: true });
}

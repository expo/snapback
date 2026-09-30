import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir, cpus, loadavg, availableParallelism } from 'node:os';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const sdkRoot = resolve(process.env.PR_LL_SDK ?? 'packages/snapback4/dist');
const { createLocalClient } = await import(pathToFileURL(join(sdkRoot, 'local.js')));
import { signup } from '../../../packages/snapback4/dist/auth.js';
import { processDevice } from '../../../packages/snapback4/dist/native.js';
import { chromiumExecutable } from '../../../witness/lib.mjs';

const root = resolve(import.meta.dirname, '../../..');
const runs = Number(process.env.LL_RUNS ?? 20), tier = process.env.LL_TIER ?? 'wasm';
const retention = process.env.LL_KEEP ?? 'none';
const out = resolve(process.env.LL_OUT ?? join(root, 'reports/20260929-ll-live-latency/baseline-' + tier + '.json'));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4-ll-measure');
const dir = mkdtempSync(join(tmpdir(), 'sb4-ll-'));
mkdirSync(join(dir, 'snapback'));
copyFileSync(join(root, 'reports/20260929-ll-live-latency/tools/fixture.q'), join(dir, 'snapback/schema.q'));
copyFileSync(join(root, 'reports/20260929-ll-live-latency/tools/page.jsx'), join(dir, 'page.jsx'));
writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/page.jsx"></script>');
const host = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: dir, env: { ...process.env, LL_COMMIT_TRACE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '', buffer = '';
const commits = [];
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
let browser, vite;
const devices = new Map();
let processSender;
const senderTrace = [];
const nodeNow = () => performance.timeOrigin + performance.now();
const samples = [];
const loadWorkers = Array.from({ length: Number(process.env.LL_LOAD ?? 0) }, () => spawn(process.execPath, ['-e', 'while (true) {}'], { stdio: 'ignore' }));
async function until(fn, label, timeout = 15000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const result = await fn(); if (result) return result; await delay(10); }
  throw Error('timeout: ' + label + '\n' + errors.slice(-2500));
}
try {
  const url = await until(() => { if (host.exitCode !== null) throw Error(errors); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, 'server');
  const alice = await signup(url, 'alice@example.test', 'long-test-password');
  const bob = await signup(url, 'bob@example.test', 'long-test-password');
  assert.ok(alice.ok, JSON.stringify(alice)); assert.ok(bob.ok, JSON.stringify(bob));
  const a = alice.session.principal, b = bob.session.principal;
  const rows = [{ table: 'profiles', row: { id: 'alice', principal: a, name: 'Alice' } }, { table: 'rooms', row: { id: 'room', title: 'Room' } }, ...[a, b].map((principal, i) => ({ table: 'members', row: { id: 'member' + i, room: 'room', principal } })), ...Array.from({ length: 20 }, (_, n) => ({ table: 'messages', row: { id: n === 19 ? 'anchor' : 'msg' + n, room: 'room', sender: a, ordinal: n === 19 ? 999999 : n, text: n === 19 ? 'Quoted anchor excerpt' : 'History ' + n } }))];
  const seeded = await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(rows) }).then(x => x.json());
  assert.equal(seeded.seeded, rows.length, JSON.stringify(seeded));
  const require = createRequire(join(root, 'package.json'));
  const { chromium } = require('playwright-core');
  const { createServer } = await import(pathToFileURL(createRequire(join(root, 'apps/chat/package.json')).resolve('vite')));
  const pkg = createRequire(join(root, 'packages/snapback4/package.json'));
  vite = await createServer({ root: dir, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } }, resolve: { alias: [
    ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: pkg.resolve(name) })),
    ...['local', 'web', 'react'].map(name => ({ find: 'snapback4/' + name, replacement: join(sdkRoot, name + '.js') })),
  ] } });
  await vite.listen();
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const pages = [];
  for (const [index, session] of [alice.session, bob.session].entries()) {
    const context = await browser.newContext();
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', e => { errors += '\nBROWSER ' + e.stack; });
    if (tier === 'process' && index === 0) {
      processSender = await createLocalClient({ url, session, device: processDevice({ binary: join(root, 'target/debug/snapback4'), dir: join(dir, 'sender') }), fetch: async (input, init) => {
        const path = new URL(input).pathname; senderTrace.push({ stage: 'request', path, at: nodeNow() });
        const response = await fetch(input, init); senderTrace.push({ stage: 'headers', path, at: nodeNow(), timing: response.headers.get('server-timing') }); return response;
      } });
      await processSender.sync();
      await page.exposeBinding('senderBridge', async (_, { method, op, args, bytes }) => method === 'mutate' ? processSender.mutate(op, args) : processSender.upload(new Uint8Array(bytes)));
    }
    if (tier === 'process') await page.exposeBinding('deviceBridge', async (_, value) => {
      if (value.method === 'open') { const core = await processDevice({ binary: join(root, 'target/debug/snapback4'), dir: join(dir, 'device' + index) }).open(value.name, value.backend); devices.set(index, core); return; }
      if (value.method === 'call') return devices.get(index).call(value.request);
      if (value.method === 'close') await devices.get(index)?.close();
    });
    await page.goto(vite.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.openClient);
    await page.evaluate(options => window.openClient(options), { url, session, tier, principal: a, receiver: index === 1, retention });
  }
  const [sender, receiver] = pages;
  await until(() => receiver.locator('#anchor').count(), 'React history');
  await delay(250);
  const flows = ['profile', 'reaction-add', 'reaction-replace', 'reaction-remove', 'reply', 'photo', 'feed-image', 'once-photo'];
  for (let run = 0; run < runs; run++) for (const flow of flows) {
    const value = flow === 'reaction-remove' ? null : flow === 'reaction-add' ? 'add-' + run : flow === 'reaction-replace' ? 'replace-' + run : flow + '-' + run;
    const query = flow === 'profile' ? 'profile' : flow.startsWith('reaction') ? 'reactionRows' : flow === 'feed-image' ? 'feed' : 'history';
    const expectation = { flow, value, query };
    await receiver.evaluate(e => window.prepare(e), expectation);
    await sender.evaluate(e => window.prepare(e), expectation);
    senderTrace.length = 0;
    const commitStart = commits.length;
    const write = await sender.evaluate(options => window.perform(options), { flow, value, ordinal: 100 + run * flows.length + flows.indexOf(flow) });
    let timeout = false;
    try { await until(() => receiver.evaluate(media => { const t = window.trial(); return t.published && t.reactCommit && (!media || t.assetReady) && (window.events.find(e => e.flow === 'reply') ? t.quoteReady : true); }, ['photo', 'feed-image', 'once-photo'].includes(flow)), flow, 12000); } catch { timeout = true; }
    if (flow === 'reply' && !timeout) { await receiver.locator('[data-quote="' + value + '"]').click(); assert.equal(await receiver.evaluate(() => location.hash), '#anchor'); }
    const trial = await receiver.evaluate(() => window.trial());
    const receiverEvents = await receiver.evaluate(() => window.events);
    const senderEvents = [...await sender.evaluate(() => window.events), ...senderTrace].sort((a, b) => a.at - b.at);
    const commit = commits.slice(commitStart).find(c => c.name === (flow.startsWith('reaction') ? 'setReaction' : flow === 'profile' ? 'editProfile' : flow === 'feed-image' ? 'post' : 'send'));
    assert.ok(commit, 'instrumented commit stamp');
    const sample = { run, flow, timeout, commit, trial, senderEvents, receiverEvents };
    samples.push(sample);
    console.log(JSON.stringify({ tier, run, flow, timeout, commitToPublished: trial.published ? +(trial.published - commit.at).toFixed(2) : null, react: trial.reactCommit ? +(trial.reactCommit - commit.at).toFixed(2) : null }));
    writeFileSync(out, JSON.stringify({ metadata: { tier, runs, retention, cpu: cpus()[0].model, loadWorkers: loadWorkers.length, cpus: availableParallelism(), load: loadavg(), browser: browser.version(), node: process.version, binary, source: 'fixture.q', clock: 'UNIX milliseconds; Chromium performance.timeOrigin + performance.now; server post-SQLite-commit SystemTime' }, samples }, null, 2));
  }
} finally {
  for (const worker of loadWorkers) worker.kill();
  await processSender?.close();
  await browser?.close();
  for (const core of devices.values()) await core.close();
  await vite?.close();
  const exited = new Promise(resolve => host.once('exit', resolve));
  if (host.exitCode === null) { host.kill(); await exited; }
  rmSync(dir, { recursive: true, force: true });
}

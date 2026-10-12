#!/usr/bin/env node
// @ref LLP 3000.011.003.000#8 — prove the exported app's SDK write, never an optimistic row.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync, globSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { idFrom } from '../dist/client.js';

function options(args) {
  const out = { export: 'dist', timeout: 30 };
  const flags = new Set(['url', 'as', 'email', 'password-env', 'mutation', 'args', 'timeout', 'export']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') return null;
    if (!flag.startsWith('--') && i === 0) { out.export = flag; continue; }
    const key = flag.slice(2);
    if (!flags.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`E_INPUT: witness web takes --${[...flags].join(', --')}`);
    out[key] = args[++i];
  }
  out.timeout = Number(out.timeout);
  if (!Number.isFinite(out.timeout) || out.timeout <= 0 || out.timeout > 600) throw Error('E_INPUT: --timeout must be seconds from 1 to 600');
  if (typeof out.args === 'string') out.args = JSON.parse(out.args);
  if (out.args !== undefined && (!out.args || Array.isArray(out.args) || typeof out.args !== 'object')) throw Error('E_INPUT: --args must be a JSON object');
  if (out.as && out.email) throw Error('E_INPUT: choose --as or --email');
  if (out.email && (!out['password-env'] || !process.env[out['password-env']])) throw Error('E_INPUT: --email requires --password-env naming a nonempty environment variable');
  return out;
}
function executable() {
  if (process.env.SNAPBACK4_CHROMIUM) {
    if (!existsSync(process.env.SNAPBACK4_CHROMIUM)) throw Error('E_WITNESS_BROWSER: SNAPBACK4_CHROMIUM is not a file');
    return process.env.SNAPBACK4_CHROMIUM;
  }
  const home = process.env.HOME;
  const paths = [
    ...globSync(`${home}/.cache/ms-playwright/chromium-*/chrome-linux*/chrome`).sort().reverse(),
    ...globSync(`${home}/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`).sort().reverse(),
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const path = paths.find(existsSync);
  if (!path) throw Error('E_WITNESS_BROWSER: no headless Chromium; set SNAPBACK4_CHROMIUM to its executable');
  return path;
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
async function webServer(directory) {
  const root = await realpath(resolve(directory));
  if (!existsSync(join(root, 'index.html'))) throw Error('E_WITNESS_EXPORT: export has no index.html; run build:web first');
  const server = createServer(async (request, response) => {
    try {
      let path = await realpath(resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)));
      if (path !== root && !path.startsWith(root + sep)) throw Error('outside export');
      if ((await stat(path)).isDirectory()) path = await realpath(join(path, 'index.html'));
      if (!path.startsWith(root + sep)) throw Error('outside export');
      response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.end(await readFile(path));
    } catch { response.writeHead(404).end('Not found'); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(yes => { server.closeAllConnections(); server.close(yes); }) };
}
async function backend(timeout, own) {
  const child = spawn(process.env.SNAPBACK4_BIN, ['dev', '--memory', '--port', '0', '--no-watch'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SNAPBACK4_SUPERVISOR_PID: String(process.pid) } });
  let output = '', errors = '';
  child.stderr.on('data', bytes => { errors = (errors + bytes).slice(-4096); });
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const done = new Promise(yes => child.once('close', yes)); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await done; clearTimeout(timer);
  };
  own({ close }); // Record ownership immediately, including readiness and signal races.
  try {
    const url = await new Promise((yes, no) => {
      const timer = setTimeout(() => no(Error('E_WITNESS_BACKEND: dev did not become ready')), timeout);
      child.once('error', () => { clearTimeout(timer); no(Error('E_WITNESS_BACKEND: cannot spawn snapback4 dev')); });
      child.once('exit', () => { clearTimeout(timer); no(Error(`E_WITNESS_BACKEND: dev exited before readiness; ${errors}`)); });
      child.stdout.on('data', bytes => { output += bytes; const line = output.split('\n')[0]; if (output.includes('\n') && /^http:\/\/127\.0\.0\.1:\d+$/.test(line)) { clearTimeout(timer); yes(line); } });
    });
    return { url, close };
  } catch (error) { await close(); throw error; }
}
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
async function run(o) {
  const browserPath = executable();
  let dev, web, browser;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= Promise.allSettled([browser?.close(), web?.close(), dev?.close()]);
  const interrupted = () => { void cleanup().finally(() => process.exit(130)); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    web = await webServer(o.export);
    dev = o.url ? null : await backend(o.timeout * 1000, owned => { dev = owned; });
    const api = o.url ?? dev.url;
    browser = await chromium.launch({ executablePath: browserPath, headless: true, timeout: o.timeout * 1000, args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] });
    const page = await browser.newPage(); // Fresh storage; the external backend is never reset.
    page.setDefaultTimeout(o.timeout * 1000);
    let pageError;
    page.on('pageerror', error => { pageError = error.message; });
    const url = new URL(web.url); url.searchParams.set('api', api); url.searchParams.set('witness', 'web');
    if (o.as) url.searchParams.set('as', o.as);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    if (o.email) {
      await page.getByLabel('Email', { exact: true }).fill(o.email);
      await page.getByLabel('Password', { exact: true }).fill(process.env[o['password-env']]);
      await page.getByRole('button', { name: o.url ? 'Sign in' : 'Sign up', exact: true }).click();
    } else if (!o.as) {
      const guest = page.getByRole('button', { name: 'Continue as a guest', exact: true });
      await guest.click();
    }
    try { await page.waitForFunction(() => window.__snapback4Witness?.viewer()); }
    catch { throw Error(`E_WITNESS_AUTH: app never signed in; check persona/password and its sign-in screen${pageError ? '; page threw an uncaught error' : ''}`); }
    const result = await page.evaluate(async ({ name, args }) => {
      const bridge = window.__snapback4Witness;
      const ready = await bridge.ready();
      if (!ready.ok) return { state: 'failed', why: ready.why };
      return { viewer: bridge.viewer() };
    }, { name: o.mutation, args: o.args });
    if (result.state === 'failed') throw Error(`E_WITNESS_READY: ${result.why.code}`);
    const plan = JSON.parse(process.env.SNAPBACK4_WEB_PLAN ?? '[]');
    const operation = plan.find(p => !o.mutation || p.name === o.mutation);
    o.mutation ??= operation?.name;
    o.args ??= Object.fromEntries(Object.entries(operation?.args ?? {}).map(([name, value]) => {
      if (value?.witnessArgumentRequired) throw Error(`E_WITNESS_ARGUMENT: ${name} needs --args with application values`);
      return [name, value?.witnessViewer ? result.viewer : value];
    }));
    const hash = createHash('sha256').update(JSON.stringify(canonical([result.viewer, o.mutation ?? 'first', o.args]))).digest('hex');
    const id = idFrom(`witness-web:${hash}`);
    const write = await Promise.race([
      page.evaluate(({ name, args, id }) => window.__snapback4Witness.mutate(name, args, id), { name: o.mutation, args: o.args, id }),
      new Promise((_, no) => { const timer = setTimeout(() => no(Error('E_WITNESS_SENT: timed out waiting for sent')), o.timeout * 1000); timer.unref(); }),
    ]);
    if (write.state !== 'sent') throw Error(`E_WITNESS_SENT: got ${write.state}${write.why ? ': ' + write.why.code : '; pending is not success'}`);
    if (pageError) throw Error('E_WITNESS_WEB: page threw an uncaught error; inspect the application');
    console.log(JSON.stringify({ witness: 'web', state: 'sent', id: write.id, mutation: o.mutation ?? 'first', replayed: write.replayed === true }));
  } finally { process.off('SIGINT', interrupted); process.off('SIGTERM', interrupted); await cleanup(); }
}
try {
  const o = options(process.argv.slice(2));
  if (!o) console.log('usage: snapback4 witness web [dist] [--url URL] [--as PERSONA | --email EMAIL --password-env NAME] [--mutation NAME --args JSON] [--timeout 30]\nSet SNAPBACK4_CHROMIUM to a Chromium executable. Run build:web first. Register the app with registerWebWitness(app, api) from snapback4/witness-web (starters do). An omitted --url starts an owned, fresh dev --memory.');
  else await run(o);
} catch (error) {
  // Playwright call logs can contain fill(password). Never print foreign exception text.
  let message = error.message?.startsWith('E_') ? error.message : 'E_WITNESS_WEB: browser operation failed; check the export, sign-in controls and Chromium';
  const at = process.argv.indexOf('--password-env');
  const password = at >= 0 ? process.env[process.argv[at + 1]] : undefined;
  if (password) for (const secret of [password, JSON.stringify(password).slice(1, -1)]) message = message.split(secret).join('[credential]');
  console.error(message); process.exitCode = 1;
}

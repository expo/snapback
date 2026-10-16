#!/usr/bin/env node
// @ref LLP 3000.011.003.000#8 — prove the exported app's SDK write, never an optimistic row.
import { synopsis } from './cli-usage.js';
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { existsSync, globSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { idFrom } from '../dist/client.js';

function options(args) {
  const out = { export: 'dist', timeout: 30 };
  const flags = new Set(['url', 'as', 'email', 'password-env', 'mutation', 'args', 'timeout', 'export', 'field', 'value', 'button', 'port-range']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') return null;
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
  if ([out.field, out.value, out.button].some(value => value !== undefined) && ![out.field, out.value, out.button].every(value => value !== undefined)) throw Error('E_INPUT: visible form proof requires --field LABEL --value TEXT --button LABEL');
  const range = out['port-range'] ?? (process.env.PORT_LO !== undefined || process.env.PORT_HI !== undefined ? `${process.env.PORT_LO}-${process.env.PORT_HI}` : undefined);
  if (range !== undefined) {
    const ports = /^(\d+)-(\d+)$/.exec(range);
    if (!ports || Number(ports[1]) < 1 || Number(ports[2]) > 65535 || Number(ports[1]) >= Number(ports[2])) throw Error('E_INPUT: browser proof port range needs 1 <= A < B <= 65535');
    out.range = [Number(ports[1]), Number(ports[2])];
  }
  return out;
}
function executable() {
  if ((process.env.SNAPBACK4_CHROMIUM ?? process.env.CHROME)) {
    if (!existsSync((process.env.SNAPBACK4_CHROMIUM ?? process.env.CHROME))) throw Error('E_WITNESS_BROWSER: SNAPBACK4_CHROMIUM/CHROME is not a file');
    return process.env.SNAPBACK4_CHROMIUM ?? process.env.CHROME;
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
async function webServer(directory, range) {
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
  const listen = port => new Promise((yes, no) => {
    const failed = error => { server.off('listening', ready); no(error); };
    const ready = () => { server.off('error', failed); yes(); };
    server.once('error', failed); server.once('listening', ready); server.listen(port, '127.0.0.1');
  });
  if (!range) await listen(0);
  else {
    let opened = false;
    for (let port = range[0]; port <= range[1]; port++) {
      try { await listen(port); opened = true; break; }
      catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
    }
    if (!opened) throw Error('E_WITNESS_PORT: every frontend port in the range is occupied');
  }
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(yes => { server.closeAllConnections(); server.close(yes); }) };
}
async function backend(timeout, own, range) {
  const port = range ? range.join('-') : '0';
  const child = spawn(process.env.SNAPBACK4_BIN, ['dev', '--memory', '--port', port, '--no-watch'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SNAPBACK4_SUPERVISOR_PID: String(process.pid) } });
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
  let chromium;
  try { ({ chromium } = await import('playwright-core')); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes("'playwright-core'")) {
      throw Error('E_WITNESS_BROWSER: witness web requires the optional playwright-core peer; install it with `npm install --save-dev playwright-core`, then `npx playwright-core install chromium`');
    }
    throw error;
  }
  const browserPath = executable();
  let dev, web, browser;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= Promise.allSettled([browser?.close(), web?.close(), dev?.close()]);
  const interrupted = () => { void cleanup().finally(() => process.exit(130)); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  try {
    web = await webServer(o.export, o.range);
    dev = o.url ? null : await backend(o.timeout * 1000, owned => { dev = owned; }, o.range);
    const api = o.url ?? dev.url;
    browser = await chromium.launch({ executablePath: browserPath, headless: true, timeout: o.timeout * 1000, args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] });
    const page = await browser.newPage(); // Fresh storage; the external backend is never reset.
    page.setDefaultTimeout(o.timeout * 1000);
    let pageError;
    page.on('pageerror', error => { pageError = error.message; });
    const url = new URL(web.url); url.searchParams.set('api', api); url.searchParams.set('witness', 'web');
    if (o.as) url.searchParams.set('as', o.as);
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    if (o.as) {
      // Web can select through ?as=; Expo and custom pages expose a picker.
      try {
        await page.waitForFunction(persona => window.__snapback4Witness?.viewer() === "dev:" + persona || [...document.querySelectorAll('button, [role="button"]')].some(button => button.textContent.trim() === persona), o.as);
        if (!await page.evaluate(persona => window.__snapback4Witness?.viewer() === "dev:" + persona, o.as)) await page.getByRole('button', { name: o.as, exact: true }).click();
      } catch { throw Error('E_WITNESS_AUTH: persona did not open; check the declared name and its picker button'); }
    }
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
    if (o.as && result.viewer !== 'dev:' + o.as) throw Error('E_WITNESS_AUTH: the selected persona did not become the app viewer');
    if (o.field) {
      // Arm before the click: a previous sent message or row is never evidence.
      const input = page.getByLabel(o.field, { exact: true });
      await input.fill('');
      await input.pressSequentially(o.value);
      const button = page.getByRole('button', { name: o.button, exact: true });
      await button.evaluate((element, { name, args }) => window.__snapback4Witness.beginForm(name, args, element), { name: o.mutation, args: o.args });
      await button.click();
      const write = await Promise.race([
        page.evaluate(() => window.__snapback4Witness.formResult()),
        new Promise((_, no) => { const timer = setTimeout(() => no(Error('E_WITNESS_SENT: visible form did not reach sent')), o.timeout * 1000); timer.unref(); }),
      ]);
      if (write?.state !== 'sent') throw Error(`E_WITNESS_SENT: visible form got ${write?.state ?? 'no write'}${write?.why ? ': ' + write.why.code : ''}`);
      if (pageError) throw Error('E_WITNESS_WEB: page threw an uncaught error; inspect the application');
      console.log(JSON.stringify({ witness: 'web', proof: 'visible-form', state: 'sent', id: write.id, mutation: write.mutation, field: o.field, button: o.button }));
      return;
    }
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
  if (!o) console.log(`usage: ${synopsis('witness')}\nSet SNAPBACK4_CHROMIUM to a Chromium executable. Run build:web first. Register the app with registerWebWitness(app, api) from snapback4/witness-web (starters do). An omitted --url starts an owned, fresh dev --memory.`);
  else await run(o);
} catch (error) {
  // Playwright call logs can contain fill(password). Never print foreign exception text.
  let message = error.message?.startsWith('E_') ? error.message : 'E_WITNESS_WEB: browser operation failed; check the export, sign-in controls and Chromium';
  const at = process.argv.indexOf('--password-env');
  const password = at >= 0 ? process.env[process.argv[at + 1]] : undefined;
  if (password) for (const secret of [password, JSON.stringify(password).slice(1, -1)]) message = message.split(secret).join('[credential]');
  console.error(message); process.exitCode = 1;
}

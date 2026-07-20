import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const serverBin = join(repoRoot, 'target', 'debug', 'snapback');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const selectedArm = option('arm');
const selectedBackend = option('backend');
const arms = selectedArm ? [selectedArm] : ['react', 'contract', 'vanilla'];
const backends = selectedBackend ? [selectedBackend] : ['snapback', 'supabase', 'convex', 'sqlite'];
const cells = arms.flatMap((arm) => backends.map((backend) => ({ arm, backend })));

const vanillaCells = cells.filter(({ arm }) => arm === 'vanilla');
const suite = createSuite('partiful matrix / twelve browser cells', {
  expectedChecks: (cells.length * 3) + vanillaCells.length,
});
const cleanups = [];
if (!existsSync(chromeBin) || !existsSync(serverBin)) {
  console.log('SKIP partiful matrix browser — Chrome or the Snapback server binary is unavailable');
  console.log('PASS partiful matrix browser — skipped (declared integration capability gap)');
  process.exit(0);
}

const urlOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } };
const waitUrl = async (url, child, label, timeout = 60_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await urlOk(url)) return;
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    await sleep(200);
  }
  throw new Error(`${label} did not become ready: ${url}`);
};

async function startSnapback() {
  const readyDir = mkdtempSync(join(tmpdir(), 'partiful-matrix-api-'));
  const readyFile = join(readyDir, 'ready.json');
  const child = spawn(serverBin, ['--port', '0', '--memory', '--ready-file', readyFile], { cwd: repoRoot, stdio: ['ignore','ignore','pipe'] });
  cleanups.push(() => child.kill('SIGTERM'), () => rmSync(readyDir, { recursive: true, force: true }));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(readyFile)) {
      const port = JSON.parse(readFileSync(readyFile, 'utf8')).port;
      const url = `http://127.0.0.1:${port}`;
      await waitUrl(`${url}/health`, child, 'Snapback');
      return url;
    }
    if (child.exitCode !== null) throw new Error('Snapback exited before readiness');
    await sleep(100);
  }
  throw new Error('Snapback readiness file timed out');
}

async function startGateway() {
  const port = await freePort();
  const child = spawn('bun', ['run', 'server.ts'], { cwd: join(demoRoot, 'backends', 'gateway'), env: { ...process.env, PARTIFUL_MATRIX_GATEWAY_PORT: String(port) }, stdio: ['ignore','pipe','pipe'] });
  cleanups.push(() => child.kill('SIGTERM'));
  const url = `http://127.0.0.1:${port}`;
  await waitUrl(`${url}/health`, child, 'matrix gateway');
  return url;
}

async function startVite({ arm, backend }, snapbackUrl, gatewayUrl) {
  const port = await freePort();
  const surface = join(demoRoot, 'surfaces', arm);
  const vite = join(surface, 'node_modules', '.bin', 'vite');
  const args = arm === 'contract'
    ? ['--bun', vite, '--config', join(surface, 'vite.config.ts'), '--mode', backend, '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    : [vite, '--mode', backend, '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const command = arm === 'contract' ? 'bun' : vite;
  const commandArgs = arm === 'contract' ? args : args.slice(1);
  let log = '';
  const child = spawn(command, commandArgs, { cwd: surface, env: { ...process.env, SNAPBACK_PARTIFUL_MATRIX_API: snapbackUrl, PARTIFUL_MATRIX_GATEWAY: gatewayUrl }, stdio: ['ignore','pipe','pipe'] });
  child.stdout.on('data', (chunk) => { log += chunk; }); child.stderr.on('data', (chunk) => { log += chunk; });
  const url = `http://127.0.0.1:${port}`;
  try { await waitUrl(url, child, `${arm}/${backend} Vite`); }
  catch (error) { throw new Error(`${error.message}\n${log.slice(-4000)}`); }
  return { url, stop: () => child.kill('SIGTERM') };
}

await runAcceptance(suite, async () => {
  const snapbackUrl = await startSnapback();
  const gatewayUrl = await startGateway();
  const chrome = await launchChromeCdp({ chromeBin, userDataPrefix: 'partiful-matrix-' });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.close());

  for (const cell of cells) {
    const vite = await startVite(cell, snapbackUrl, gatewayUrl);
    const page = await cdp.newPage();
    try {
      await page.navigate(`${vite.url}/?user=eve`);
      await suite.check(`${cell.arm} × ${cell.backend} boots its identified cell`, async () => {
        const boot = await page.eval(`(async()=>{const d=Date.now()+30000;while(!window.partifulMatrixReady){if(Date.now()>d)throw new Error('boot timeout');await new Promise(r=>setTimeout(r,50));}return await window.partifulMatrixReady;})()`);
        if (boot.arm !== undefined && boot.arm !== cell.arm) throw new Error(`wrong arm: ${boot.arm}`);
        if (boot.authoring !== cell.arm || boot.backend !== cell.backend) throw new Error(`wrong cell identity: ${JSON.stringify(boot)}`);
        const label = await page.pollText('matrix-label', cell.backend, 10_000);
        if (cell.arm === 'contract' && !label?.toLowerCase().includes(cell.backend)) throw new Error(`matrix label missing: ${label}`);
      });
      await suite.check(`${cell.arm} × ${cell.backend} renders the canonical feed`, async () => {
        const card = await page.pollText('event-card-event_sunset', 'Sunset Supper Club', 15_000);
        if (!card?.includes('Sunset Supper Club')) throw new Error(`canonical event missing: ${card}`);
      });
      await suite.check(`${cell.arm} × ${cell.backend} opens details and observes RSVP`, async () => {
        await page.click('open-event_sunset');
        if (cell.arm === 'contract') {
          await page.waitForNavigation();
          await page.eval(`(async()=>{const d=Date.now()+30000;while(!window.partifulMatrixReady){if(Date.now()>d)throw new Error('event boot timeout');await new Promise(r=>setTimeout(r,50));}return await window.partifulMatrixReady;})()`);
        }
        const event = await page.pollText('event-page', 'Sunset Supper Club', 15_000);
        if (!event?.includes('Sunset Supper Club')) throw new Error(`event detail missing: ${event}`);
        await page.click('rsvp-going');
        const guests = await page.pollText('guest-list', 'Going', 15_000);
        if (!guests?.includes('Eve') || !guests?.includes('Going')) throw new Error(`RSVP did not converge: ${guests}`);
      });
      if (cell.arm === 'vanilla') {
        await suite.check(`${cell.arm} × ${cell.backend} replaces its keyed subscription scope without leaks`, async () => {
          const eventScope = await page.eval('window.partifulMatrixDebug.snapshot()');
          if (eventScope.activeSubscriptions !== 3) throw new Error(`event scope should own three subscriptions: ${JSON.stringify(eventScope)}`);
          await page.click('back');
          const feed = await page.pollText('feed', 'Sunset Supper Club', 15_000);
          if (!feed?.includes('Sunset Supper Club')) throw new Error(`feed did not return after scope replacement: ${feed}`);
          const feedScope = await page.eval('window.partifulMatrixDebug.snapshot()');
          if (feedScope.activeSubscriptions !== 1) throw new Error(`feed scope should own one subscription: ${JSON.stringify(feedScope)}`);
          if (feedScope.disposedSubscriptions < eventScope.disposedSubscriptions + 3) throw new Error(`event subscriptions were not disposed: ${JSON.stringify({ eventScope, feedScope })}`);
          if (feedScope.generation <= eventScope.generation) throw new Error(`scope generation did not advance: ${JSON.stringify({ eventScope, feedScope })}`);
        });
      }
    } finally { vite.stop(); }
  }
}, { cleanups, reportExtra: { demo: 'partiful-matrix', cells: cells.map(({ arm, backend }) => `${arm}:${backend}`) } });

async function connectCdp(url) {
  const socket = new WebSocket(url); const pending = new Map(); let nextId = 1;
  const settle = (id) => { const value = pending.get(id); if (value) clearTimeout(value.timer); pending.delete(id); return value; };
  socket.addEventListener('message', async (event) => { const msg = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text()); if (msg.id && pending.has(msg.id)) { const request = settle(msg.id); msg.error ? request.reject(new Error(msg.error.message)) : request.resolve(msg.result || {}); } });
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', () => reject(new Error('CDP failed')), { once: true }); });
  const send = (method, params = {}, sessionId = null) => { const id = nextId++; socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); return new Promise((resolveSend, reject) => { const timer = setTimeout(() => { settle(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000); pending.set(id, { resolve: resolveSend, reject, timer }); }); };
  return { close: () => socket.close(), newPage: async () => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }); await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
    const evalRaw = async (expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; };
    const selector = (id) => `[data-testid="${id}"]`;
    return {
      navigate: (pageUrl) => send('Page.navigate', { url: pageUrl }, sessionId),
      waitForNavigation: () => sleep(300),
      eval: evalRaw,
      click: (id) => evalRaw(`(()=>{const el=document.querySelector('${selector(id)}');if(!el)throw new Error('missing ${id}');el.click();return true})()`),
      pollText: (id, pattern, timeout) => evalRaw(`(async()=>{const d=Date.now()+${timeout};let v=null;while(Date.now()<d){v=document.querySelector('${selector(id)}')?.textContent?.trim()??null;if(v&&new RegExp(${JSON.stringify(pattern)},'i').test(v))return v;await new Promise(r=>setTimeout(r,100));}return v})()`),
    };
  } };
}

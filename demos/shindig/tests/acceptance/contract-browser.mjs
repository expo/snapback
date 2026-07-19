// Shindig — Contract surface browser acceptance.
//
// The same product claims as react-browser.mjs, driven through the compiled
// .contract views: Ada throws a party through the real create form and her
// own feed updates live (no navigation), invites Grace whose open feed
// receives the card live, Grace's direct event URL renders the server's role
// denial as the locked page before she RSVPs and unlocks after, the guest
// list and wall propagate live across windows, and Eve sees nothing.
//
// Integration lane: needs the surface's bun dependencies + Chrome; skips
// with a structured diagnostic without them. The API server is the checkout's
// built binary spawned directly (cargo run would block on the build lock in a
// fleet-shared checkout).
//
// Run: node demos/shindig/tests/acceptance/contract-browser.mjs

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const surfaceDir = join(repoRoot, 'demos', 'shindig', 'surfaces', 'contract');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const serverBin = join(repoRoot, 'target', 'debug', 'snapback');

const EXPECTED_CHECKS = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
};

const suite = createSuite('shindig contract browser', { expectedChecks: EXPECTED_CHECKS });
const cleanups = [];

const exactPackage = join(surfaceDir, 'node_modules', '@exact', 'contract', 'package.json');
const viteBinary = join(surfaceDir, 'node_modules', '.bin', 'vite');
if (!existsSync(exactPackage) || !existsSync(viteBinary)) {
  console.log(`SKIP shindig contract browser — SNAPBACK_CAPABILITY_EXACT_MISSING (run bun install in ${surfaceDir})`);
  console.log('PASS shindig contract browser — skipped (declared capability gap)');
  process.exit(0);
}
if (!existsSync(chromeBin)) {
  console.log('SKIP shindig contract browser — SNAPBACK_CAPABILITY_CHROME_MISSING (set CHROME_BIN)');
  console.log('PASS shindig contract browser — skipped (declared capability gap)');
  process.exit(0);
}
if (!existsSync(serverBin)) {
  console.log('SKIP shindig contract browser — SNAPBACK_CAPABILITY_SERVER_BINARY_MISSING (cargo build first)');
  console.log('PASS shindig contract browser — skipped (declared capability gap)');
  process.exit(0);
}

async function spawnApi(apiPort) {
  const readyDir = mkdtempSync(join(tmpdir(), 'shindig-contract-api-'));
  cleanups.push(() => rmSync(readyDir, { recursive: true, force: true }));
  const child = spawn(
    serverBin,
    ['--port', String(apiPort), '--memory', '--ready-file', join(readyDir, 'ready.json')],
    { cwd: repoRoot, env: { ...process.env }, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  cleanups.push(() => child.kill('SIGTERM'));
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await urlOk(`${apiUrl}/health`)) return apiUrl;
    if (child.exitCode !== null) throw new Error('API server exited during startup');
    await sleep(300);
  }
  throw new Error('API server did not become healthy');
}

async function spawnVite(vitePort, apiUrl) {
  const child = spawn(
    'bun',
    ['--bun', 'node_modules/.bin/vite', '--config', join(surfaceDir, 'vite.config.ts'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
    { cwd: surfaceDir, env: { ...process.env, SNAPBACK_SHINDIG_API: apiUrl }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let viteLog = '';
  child.stdout.on('data', (d) => { viteLog += d; });
  child.stderr.on('data', (d) => { viteLog += d; });
  cleanups.push(() => child.kill('SIGTERM'));
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await urlOk(viteUrl)) return viteUrl;
    if (child.exitCode !== null) throw new Error(`Vite exited:\n${viteLog}`);
    await sleep(500);
  }
  throw new Error(`Vite did not become ready:\n${viteLog}`);
}

await runAcceptance(suite, async () => {
  const apiUrl = await spawnApi(await freePort());
  const viteUrl = await spawnVite(await freePort(), apiUrl);

  const chrome = await launchChromeCdp({ chromeBin, userDataPrefix: 'shindig-contract-' });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.close());

  const ada = await cdp.newPage();
  const grace = await cdp.newPage();
  const eve = await cdp.newPage();
  await ada.navigate(`${viteUrl}/?user=ada`);
  await grace.navigate(`${viteUrl}/?user=grace`);
  await eve.navigate(`${viteUrl}/?user=eve`);

  const waitBoot = (page) => page.eval(`(async () => {
    const d = Date.now() + 30000;
    while (!window.shindigContractReady) { if (Date.now() > d) throw new Error('surface never booted'); await new Promise(r=>setTimeout(r,50)); }
    await window.shindigContractReady;
    return window.shindigContract;
  })()`);

  let eventId = null;

  await suite.check('all three windows boot the compiled Contract surface', async () => {
    const a = await waitBoot(ada);
    await waitBoot(grace);
    await waitBoot(eve);
    if (a.screen !== 'feed') throw new Error(`ada should boot to feed, got ${a.screen}`);
    const empty = await ada.pollText('feed-empty', 'Nothing yet', 10000);
    if (!/Nothing yet/.test(empty ?? '')) throw new Error(`ada feed empty state missing: ${empty}`);
  });

  await suite.check("Ada creates a party and her feed updates live, no navigation", async () => {
    await ada.click('new-event');
    await ada.setValue('create-title', 'Rooftop Solstice');
    await ada.setValue('create-location', 'The roof');
    await ada.setValue('create-description', 'Golden hour, snacks, synths.');
    await ada.click('create-submit');
    const status = await ada.pollText('card-status', 'Hosting', 10000);
    if (status !== 'Hosting') throw new Error(`host card did not arrive live: ${status}`);
    eventId = await ada.eval(`document.querySelector('[data-testid^="feed-card-"]')?.dataset.testid.replace('feed-card-','') ?? null`);
    if (!eventId) throw new Error('could not read created event id from the feed card');
  });

  await suite.check('the manage screen renders the event page over the boot-bound scope', async () => {
    await ada.navigate(`${viteUrl}/?user=ada&event=${encodeURIComponent(eventId)}`);
    await waitBoot(ada);
    const page = await ada.pollText('event-page', 'Rooftop Solstice', 15000);
    if (!/Rooftop Solstice/.test(page ?? '')) throw new Error(`event page did not render: ${page}`);
    const guests = await ada.pollText('guest-list', 'Hosting', 10000);
    if (!/Hosting/.test(guests ?? '')) throw new Error(`host seat missing from guest list: ${guests}`);
  });

  await suite.check("inviting Grace lands the card in her open feed, live", async () => {
    await ada.click('invite-grace');
    const card = await grace.pollText('card-status', 'Invited', 10000);
    if (card !== 'Invited') throw new Error(`invited card did not arrive live: ${card}`);
  });

  await suite.check("Grace's direct event URL renders the server denial as the locked page", async () => {
    await grace.navigate(`${viteUrl}/?user=grace&event=${encodeURIComponent(eventId)}`);
    await waitBoot(grace);
    const locked = await grace.pollText('event-locked', 'Members only', 15000);
    if (!/Members only/.test(locked ?? '')) throw new Error(`locked page missing: ${locked}`);
  });

  await suite.check("Grace RSVPs from the card; Ada's guest list updates live", async () => {
    await grace.navigate(`${viteUrl}/?user=grace`);
    await waitBoot(grace);
    await grace.pollText('card-status', 'Invited', 10000);
    await grace.click('rsvp-going');
    const flipped = await grace.pollText('card-status', 'Going', 10000);
    if (flipped !== 'Going') throw new Error(`card did not flip: ${flipped}`);
    const onAda = await ada.pollText('guest-list', 'Grace', 10000);
    if (!/Grace/.test(onAda ?? '')) throw new Error(`Grace missing from Ada's live guest list: ${onAda}`);
    const going = await ada.pollText('guest-list', '2 GOING', 10000);
    if (!/2 GOING/.test(going ?? '')) throw new Error(`going count wrong: ${going}`);
  });

  await suite.check('wall posts propagate across windows', async () => {
    await grace.navigate(`${viteUrl}/?user=grace&event=${encodeURIComponent(eventId)}`);
    await waitBoot(grace);
    const unlocked = await grace.pollText('event-page', 'Rooftop Solstice', 15000);
    if (!/Rooftop Solstice/.test(unlocked ?? '')) throw new Error(`event page did not unlock for Grace: ${unlocked}`);
    await grace.setValue('wall-input', 'limes acquired 🍋');
    await grace.click('wall-send');
    const onAda = await ada.pollText('wall', 'limes acquired', 10000);
    if (!/limes acquired/.test(onAda ?? '')) throw new Error(`Grace's post never reached Ada's wall: ${onAda}`);
  });

  await suite.check("Eve's feed stays empty through all of it", async () => {
    await sleep(500);
    const still = await eve.text('feed-empty');
    if (!/Nothing yet/.test(still ?? '')) throw new Error(`member activity leaked into Eve's feed: ${still}`);
  });
}, { cleanups, reportExtra: { demo: 'shindig', surface: 'contract' } });

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const COMMAND_TIMEOUT_MS = 30_000;
  const settle = (id) => { const p = pending.get(id); if (p) clearTimeout(p.timer); pending.delete(id); return p; };
  const rejectAll = (reason) => { for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason)); };
  socket.addEventListener('message', async (e) => {
    const text = typeof e.data === 'string' ? e.data : await e.data.text();
    const msg = JSON.parse(text);
    if (msg.id && pending.has(msg.id)) { const p = settle(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result || {}); }
  });
  socket.addEventListener('close', () => rejectAll('CDP DevTools WebSocket closed while commands were in flight'));
  socket.addEventListener('error', () => rejectAll('CDP DevTools WebSocket errored while commands were in flight'));
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', () => rej(new Error('CDP failed')), { once: true }); });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { settle(id); rej(new Error(`CDP command timed out: ${method} (id ${id})`)); }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve: res, reject: rej, timer });
    });
  };
  return {
    close: () => socket.close(),
    newPage: async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      const evalRaw = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result?.value;
      };
      const sel = (id) => `[data-testid="${id}"]`;
      return {
        navigate: async (url) => {
          await send('Page.navigate', { url }, sessionId);
          await sleep(300);
        },
        activate: () => send('Target.activateTarget', { targetId }),
        eval: evalRaw,
        text: (id) => evalRaw(`document.querySelector('${sel(id)}')?.textContent.trim() ?? null`),
        exists: (id) => evalRaw(`!!document.querySelector('${sel(id)}')`),
        click: (id) => evalRaw(`(() => {
          const el = document.querySelector('${sel(id)}');
          if (!el) throw new Error('missing element ${id}');
          el.click();
          return true;
        })()`),
        setValue: (id, value) => evalRaw(`(() => {
          const el = document.querySelector('${sel(id)}');
          if (!el) throw new Error('missing input ${id}');
          const target = el.matches('input, textarea') ? el : el.querySelector('input, textarea');
          if (!target) throw new Error('no input inside ${id}');
          const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(target, ${JSON.stringify(value)});
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`),
        pollText: (id, pattern, ms) => evalRaw(`(async () => { const d = Date.now()+${ms}; let v; while (Date.now()<d) { v = document.querySelector('${sel(id)}')?.textContent.trim() ?? null; if (v !== null && new RegExp(${JSON.stringify(pattern)}).test(v)) return v; await new Promise(r=>setTimeout(r,120)); } return v; })()`),
      };
    },
  };
}

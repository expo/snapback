// Shindig — React surface browser acceptance.
//
// Two real browser windows over one fresh Snapback server: Ada throws a party
// through the real create form, invites Grace, and Grace's already-open feed
// receives the card live; Grace RSVPs from the card, Ada's guest list updates
// live, and wall posts propagate both ways. Eve's feed stays empty — member
// activity must not leak across the membership boundary.
//
// Integration lane: needs the surface's npm dependencies + Chrome; skips with
// a structured diagnostic without them.
//
// Run: node demos/shindig/tests/acceptance/react-browser.mjs

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
const surfaceDir = join(repoRoot, 'demos', 'shindig', 'surfaces', 'react');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const EXPECTED_CHECKS = 7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
};

const suite = createSuite('shindig react browser', { expectedChecks: EXPECTED_CHECKS });
const cleanups = [];

if (!existsSync(join(surfaceDir, 'node_modules', '.bin', 'vite'))) {
  console.log(`SKIP shindig react browser — SNAPBACK_CAPABILITY_REACT_DEPS_MISSING (run bun install in ${surfaceDir})`);
  console.log('PASS shindig react browser — skipped (declared capability gap)');
  process.exit(0);
}
if (!existsSync(chromeBin)) {
  console.log('SKIP shindig react browser — SNAPBACK_CAPABILITY_CHROME_MISSING (set CHROME_BIN)');
  console.log('PASS shindig react browser — skipped (declared capability gap)');
  process.exit(0);
}

// Always a fresh isolated pair on OS-assigned ports: no reuse, no provenance
// arbitration, no stale-server trap. The interactive dev recipe in the README
// uses the pinned ports; acceptance never does.
async function spawnApi(apiPort) {
  const env = { ...process.env };
  if (process.platform === 'darwin' && !env.DYLD_FRAMEWORK_PATH) {
    env.DYLD_FRAMEWORK_PATH = join(repoRoot, 'vendor', 'ibex', 'ios', 'Frameworks');
  }
  // Without a controlling terminal the server refuses to start unless the
  // impersonation capability can go to a ready-file sidecar — provide one.
  const readyDir = mkdtempSync(join(tmpdir(), 'shindig-react-api-'));
  cleanups.push(() => rmSync(readyDir, { recursive: true, force: true }));
  const child = spawn(
    'cargo',
    ['run', '--quiet', '--', '--port', String(apiPort), '--memory', '--ready-file', join(readyDir, 'ready.json')],
    { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  cleanups.push(() => child.kill('SIGTERM'));
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await urlOk(`${apiUrl}/health`)) return apiUrl;
    if (child.exitCode !== null) throw new Error('API server exited during startup');
    await sleep(500);
  }
  throw new Error('API server did not become healthy');
}

async function spawnVite(vitePort, apiUrl) {
  const child = spawn(
    join(surfaceDir, 'node_modules', '.bin', 'vite'),
    ['--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
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

  const chrome = await launchChromeCdp({ chromeBin, userDataPrefix: 'shindig-react-' });
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
    while (!window.shindigReady) { if (Date.now() > d) throw new Error('surface never booted'); await new Promise(r=>setTimeout(r,50)); }
    await window.shindigReady;
    return true;
  })()`);

  await suite.check('all three windows boot over the generated artifacts', async () => {
    await waitBoot(ada);
    await waitBoot(grace);
    await waitBoot(eve);
    const empty = await ada.pollText('feed-empty', 'Nothing yet', 10000);
    if (!/Nothing yet/.test(empty ?? '')) throw new Error(`ada feed empty state missing: ${empty}`);
  });

  await suite.check('Ada creates a party through the real form and lands on its page', async () => {
    await ada.click('new-event');
    await ada.setValue('create-title', 'Rooftop Solstice');
    await ada.setValue('create-description', 'Golden hour, snacks, synths.');
    await ada.setValue('create-location', 'The roof');
    await ada.setValue('create-when', '2026-08-01T18:00');
    await ada.click('create-submit');
    const page = await ada.pollText('event-page', 'Rooftop Solstice', 10000);
    if (!/Rooftop Solstice/.test(page ?? '')) throw new Error(`event page did not render: ${page}`);
    const guestList = await ada.pollText('guest-list', 'Ada', 10000);
    if (!/Hosting/.test(guestList ?? '')) throw new Error(`host seat missing from guest list: ${guestList}`);
  });

  await suite.check("inviting Grace lands the card in her open feed, live", async () => {
    const before = await grace.text('feed-empty');
    if (!/Nothing yet/.test(before ?? '')) throw new Error(`grace feed should start empty: ${before}`);
    await ada.click('invite-grace');
    const card = await grace.pollText('card-status', 'Invited', 10000);
    if (card !== 'Invited') throw new Error(`invited card did not arrive live: ${card}`);
  });

  await suite.check('Grace RSVPs from the card and it flips to Going', async () => {
    await grace.click('rsvp-going');
    const status = await grace.pollText('card-status', 'Going', 10000);
    if (status !== 'Going') throw new Error(`card did not flip: ${status}`);
  });

  await suite.check("Ada's guest list updates live with Grace's RSVP", async () => {
    const row = await ada.pollText('guest-list', 'Grace', 10000);
    if (!/Grace/.test(row ?? '')) throw new Error(`Grace missing from Ada's live guest list: ${row}`);
    const going = await ada.pollText('guest-list', '2 going', 10000);
    if (!/2 going/.test(going ?? '')) throw new Error(`going count wrong: ${going}`);
  });

  await suite.check('wall posts propagate across windows', async () => {
    await grace.eval(`document.querySelector('[data-testid="event-page"]') ? null : (() => {
      const open = [...document.querySelectorAll('button')].find((b) => /Open/.test(b.textContent));
      if (!open) throw new Error('open button missing after rsvp');
      open.click();
    })()`);
    const unlocked = await grace.pollText('event-page', 'Rooftop Solstice', 10000);
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
}, { cleanups, reportExtra: { demo: 'shindig', surface: 'react' } });

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
        navigate: (url) => send('Page.navigate', { url }, sessionId),
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
        // React controlled inputs need the native setter + an input event.
        setValue: (id, value) => evalRaw(`(() => {
          const el = document.querySelector('${sel(id)}');
          if (!el) throw new Error('missing input ${id}');
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`),
        pollText: (id, pattern, ms) => evalRaw(`(async () => { const d = Date.now()+${ms}; let v; while (Date.now()<d) { v = document.querySelector('${sel(id)}')?.textContent.trim() ?? null; if (v !== null && new RegExp(${JSON.stringify(pattern)}).test(v)) return v; await new Promise(r=>setTimeout(r,120)); } return v; })()`),
      };
    },
  };
}

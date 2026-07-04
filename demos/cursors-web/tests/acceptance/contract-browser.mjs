// Cursor presence — pure-Contract browser acceptance (ENG-22479 read side;
// ENG-22524 write side — the Exact LLP 0281 stage-0 proof).
//
// Two real browser windows on one Snapback room, driven end-to-end through
// the framework: real pointermove events feed the value channel declared in
// app.contract; the rated publish (rate=15 inside the generated
// sustainedHz=20 budget) carries presence through the mutation-shaped
// webCursorsPublish descriptor; client B's cursor appears in client A's
// `ephemeral` BINDING (and vice versa) through generated bindings alone —
// no imperative overlay, no pointer glue, no hand throttle anywhere in the
// demo. Plus: the compositor-only transform sink drives the local self dot,
// the channel/publish facts are live-observable through the same dataflow
// snapshot the agent surface serves (LLP 0281 §3.5), and the forced-map
// proof (forceEphemeralState is LOCAL-ONLY; dispose restores live state).
//
// Integration lane: needs the Exact checkout + bun + Chrome; skips with the
// standard structured diagnostic without them.
//
// Run: node demos/cursors-web/tests/acceptance/contract-browser.mjs

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import {
  freePort,
  readCommittedBundleHash,
  verifyApiProvenance,
  verifyViteProvenance,
} from '../../../_kit/provenance.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const surfaceDir = join(repoRoot, 'demos', 'cursors-web', 'surfaces', 'contract');
const artifactsJsonPath = join(repoRoot, 'demos', 'cursors-web', 'snapback', 'generated', 'artifacts.json');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Env-overridable pins. On the chosen ports, reuse is *verified*, never
// assumed (ENG-22757, the ENG-22753 pattern; the Diary 0008 2026-07-01 :4420
// gotcha): a running server is reused only when its provenance matches this
// checkout, otherwise the suite falls back — loudly — to a fresh server on a
// fresh OS-assigned port. Note the web surfaces provision schema-only (no
// functions bundle), so an externally started API server usually reports no
// loaded-bundle identity and is refused; that refusal is the safe default.
const API_PORT = Number(process.env.CURSORS_CONTRACT_API_PORT ?? 4425);
const VITE_PORT = Number(process.env.CURSORS_CONTRACT_VITE_PORT ?? 5184);
let apiPort = API_PORT;
let apiUrl = `http://127.0.0.1:${API_PORT}`;
let viteUrl = `http://127.0.0.1:${VITE_PORT}`;

const exactRoot = process.env.SNAPBACK_EXACT_ROOT
  ? resolve(process.env.SNAPBACK_EXACT_ROOT)
  : resolve(repoRoot, '..', 'exact');

const EXPECTED_CHECKS = 7;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => { try { return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } };

const suite = createSuite('cursors-web contract browser (ENG-22524)', { expectedChecks: EXPECTED_CHECKS });
const cleanups = [];
let cdp = null;
// Suite-owned API child so the ENG-22541 restart check can bounce it; stays
// null when an externally running server was reused.
let apiChild = null;
cleanups.push(() => apiChild?.kill('SIGTERM'));

async function spawnApi() {
  const env = { ...process.env };
  if (process.platform === 'darwin' && !env.DYLD_FRAMEWORK_PATH) {
    env.DYLD_FRAMEWORK_PATH = join(repoRoot, 'vendor', 'ibex', 'ios', 'Frameworks');
  }
  const child = spawn('cargo', ['run', '--quiet', '--', '--port', String(apiPort), '--memory'], { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'] });
  apiChild = child;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) { if (await urlOk(`${apiUrl}/health`)) return; if (child.exitCode !== null) throw new Error('API server exited'); await sleep(500); }
  throw new Error('API server did not become healthy');
}

async function stopApi() {
  const child = apiChild;
  apiChild = null;
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const hardKill = setTimeout(() => child.kill('SIGKILL'), 3_000);
    child.once('exit', () => { clearTimeout(hardKill); resolve(); });
    child.kill('SIGTERM');
  });
}

// Re-provision a fresh `--memory` server: loadSchema BEFORE ensure (diary
// 0011 hit exactly this; a schema-less restarted server leaves both arms
// honestly degraded, which is expected — the suite provisions, never the arms).
async function provisionApi() {
  const schemaManifest = JSON.parse(readFileSync(join(repoRoot, 'demos', 'cursors-web', 'snapback', 'generated', 'schema.manifest.json'), 'utf8'));
  const post = async (path, body) => {
    const res = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`POST ${path} failed: HTTP ${res.status} ${await res.text()}`);
  };
  await post('/_snapback/api/schema/load', schemaManifest);
  await post('/ephemeral/collections/ensure', {
    collections: schemaManifest.ephemeralCollections ?? [],
    schemaHash: schemaManifest.schemaHash ?? null,
    inputsHash: schemaManifest.inputsHash ?? null,
  });
}

async function ensureApi() {
  if (await urlOk(`${apiUrl}/health`)) {
    // Something healthy answers on the port — reuse it ONLY if it is
    // verifiably running this checkout's committed app (ENG-22757, the
    // ENG-22753 rule). "Healthy" alone was the Diary 0008 bug: /health says
    // nothing about which server (or whose checkout) is answering.
    const committed = readCommittedBundleHash(artifactsJsonPath);
    const verdict = await verifyApiProvenance(apiUrl, { appId: 'cursors-web', bundleHash: committed });
    if (verdict.ok) {
      console.log(`REUSED API server at :${apiPort} (bundleHash ${verdict.bundleHash})`);
      return;
    }
    apiPort = await freePort();
    console.error(
      `PROVENANCE MISMATCH: a server answers /health on :${API_PORT} but ${verdict.reason}. ` +
      `NOT reusing it — starting a fresh isolated API server on :${apiPort} (pin with CURSORS_CONTRACT_API_PORT).`,
    );
    apiUrl = `http://127.0.0.1:${apiPort}`;
  }
  await spawnApi();
}

async function ensureVite() {
  let vitePort = VITE_PORT;
  if (await urlOk(viteUrl)) {
    // Same rule as the API server (ENG-22757): a Vite answering on the port
    // is reused only when its source-provenance probe proves it serves THIS
    // checkout's surface tree against THIS run's API origin.
    const verdict = await verifyViteProvenance(viteUrl, { app: 'cursors-web', surface: 'contract', root: surfaceDir, apiOrigin: apiUrl });
    if (verdict.ok) {
      console.log(`REUSED Vite at :${vitePort} (root ${verdict.info.root}, api ${verdict.info.apiOrigin})`);
      return;
    }
    vitePort = await freePort();
    console.error(
      `PROVENANCE MISMATCH: a server answers on Vite :${VITE_PORT} but ${verdict.reason}. ` +
      `NOT reusing it — starting a fresh isolated Vite on :${vitePort} (pin with CURSORS_CONTRACT_VITE_PORT).`,
    );
    viteUrl = `http://127.0.0.1:${vitePort}`;
  }
  const child = spawn('bun', ['--bun', 'node_modules/.bin/vite', '--config', join(surfaceDir, 'vite.config.ts'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
    { cwd: exactRoot, env: { ...process.env, SNAPBACK_CURSORS_API: apiUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let viteLog = '';
  child.stdout.on('data', (d) => { viteLog += d; });
  child.stderr.on('data', (d) => { viteLog += d; });
  cleanups.push(() => child.kill('SIGTERM'));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) { if (await urlOk(viteUrl)) return; if (child.exitCode !== null) throw new Error(`Vite exited:\n${viteLog}`); await sleep(500); }
  throw new Error(`Vite did not become ready:\n${viteLog}`);
}

if (!existsSync(join(exactRoot, 'packages', 'exact-contract'))) {
  console.log(`SKIP cursors-web contract browser — SNAPBACK_CAPABILITY_EXACT_MISSING (no Exact at ${exactRoot})`);
  console.log('PASS cursors-web contract browser (ENG-22524) — skipped (declared capability gap)');
  process.exit(0);
}

await runAcceptance(suite, async () => {
  await ensureApi();
  await ensureVite();
  const chrome = await launchChrome();
  cleanups.push(() => chrome.stop());
  cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.close());

  const pageA = await cdp.newPage();
  const pageB = await cdp.newPage();
  await pageA.navigate(`${viteUrl}/?name=alice&color=%235e6ad2`);
  await pageB.navigate(`${viteUrl}/?name=bob&color=%232fbf71`);

  const waitBoot = (page) => page.eval(`(async () => {
    const d = Date.now() + 20000;
    while (!window.cursorsWeb) { if (Date.now() > d) throw new Error('surface never booted'); await new Promise(r=>setTimeout(r,50)); }
    await window.cursorsWebReady;
    return { connection: window.cursorsWeb.connection, name: window.cursorsWeb.identity.name };
  })()`);

  let a = null;
  let b = null;
  await suite.check('both windows boot the Contract surface over generated bindings', async () => {
    a = await waitBoot(pageA);
    b = await waitBoot(pageB);
    if (!a.connection || !b.connection) throw new Error('missing connection ids');
    if (a.connection === b.connection) throw new Error('windows must have distinct connections');
    return { a, b };
  });

  // Real pointer events against the stage element: the ONLY write path is
  // the value channel bound with pointermove= in app.contract — there is no
  // document-level listener left in the demo. Activate the window first,
  // like a real user moving a real pointer would: background tabs pause
  // rAF, so the channel's frame coalescing runs at the platform's hidden
  // cadence there (the LLP 0281 host-channel degradation, not a bug).
  const moveCursor = async (page, x, y) => {
    await page.activate();
    await page.eval(`(async () => {
      const stage = document.querySelector('[data-testid="cursor-stage"]');
      if (!stage) throw new Error('cursor-stage missing');
      stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ${x}, clientY: ${y}, pointerType: 'mouse' }));
      await new Promise(r => setTimeout(r, 120));
      stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ${x}, clientY: ${y}, pointerType: 'mouse' }));
      await new Promise(r => setTimeout(r, 60));
    })()`);
  };

  await suite.check("client B's cursor reaches client A's ephemeral BINDING through the rated publish (and vice versa)", async () => {
    await moveCursor(pageA, 210, 260);
    await moveCursor(pageB, 340, 180);
    // Each window renders each c in cursors.entries — keyed by connection.
    const badgeOnA = await pageA.pollText(`cursor-name-${b.connection}`, 'bob', 8000);
    if (badgeOnA !== 'bob') throw new Error(`B's cursor missing on A: ${badgeOnA}`);
    const badgeOnB = await pageB.pollText(`cursor-name-${a.connection}`, 'alice', 8000);
    if (badgeOnB !== 'alice') throw new Error(`A's cursor missing on B: ${badgeOnB}`);
    // Self-presence appears and is styled distinctly (weight 800 + white).
    const selfOnA = await pageA.eval(`(() => {
      const el = document.querySelector('[data-testid="cursor-name-${a.connection}"]');
      if (!el) return null;
      const style = getComputedStyle(el);
      return { text: el.textContent.trim(), weight: style.fontWeight };
    })()`);
    if (!selfOnA || selfOnA.text !== 'alice') throw new Error(`self cursor missing on A: ${JSON.stringify(selfOnA)}`);
    if (String(selfOnA.weight) !== '800') throw new Error(`self cursor not styled distinctly: ${JSON.stringify(selfOnA)}`);
    const count = await pageA.text('cursor-count');
    if (!/^2 /.test(count ?? '')) throw new Error(`expected 2 cursors on A, got: ${count}`);
    return { badgeOnA, badgeOnB, selfOnA, count };
  });

  await suite.check('the transform sink drives the self dot compositor-only (no reactive flush)', async () => {
    await moveCursor(pageA, 250, 300);
    const dot = await pageA.eval(`(async () => {
      const d = Date.now() + 4000;
      for (;;) {
        const el = document.querySelector('[data-testid="self-dot"]');
        if (el && /translate\\(242px(,| )/.test(el.style.transform ?? '')) {
          return { transform: el.style.transform, opacity: el.style.opacity };
        }
        if (Date.now() > d) return el ? { transform: el.style.transform, opacity: el.style.opacity } : null;
        await new Promise(r=>setTimeout(r,60));
      }
    })()`);
    // 250 - 8 (half the 16px dot) = 242; the channel value applied straight
    // to the DOM node through the host channel-apply seam.
    if (!dot || !/translate\(242px/.test(dot.transform ?? '')) {
      throw new Error(`self dot transform not applied by the channel sink: ${JSON.stringify(dot)}`);
    }
    if (Number(dot.opacity) !== 0.9) throw new Error(`self dot opacity sink not applied: ${JSON.stringify(dot)}`);
    return dot;
  });

  await suite.check('channel + rated-publish facts are live-observable (LLP 0281 §3.5) with receipts', async () => {
    const facts = await pageA.eval(`(() => {
      const snapshot = window.cursorsWeb.channels();
      const receipts = window.cursorsWeb.receipts();
      return {
        channels: snapshot.channels ?? [],
        publishReceipts: (receipts.receipts?.receipts ?? []).filter((r) => r.receipt.kind === 'publish').map((r) => r.receipt),
      };
    })()`);
    const channel = facts.channels[0];
    if (!channel || channel.binding !== 'pointer') throw new Error(`channel binding missing from snapshot: ${JSON.stringify(facts.channels)}`);
    if (!channel.publish || channel.publish.declaredRateHz !== 15) throw new Error(`declared publish rate missing: ${JSON.stringify(channel.publish)}`);
    if (channel.publish.descriptor !== 'webCursorsPublish') throw new Error(`publish descriptor fact wrong: ${JSON.stringify(channel.publish)}`);
    if (!(channel.publish.published >= 1)) throw new Error(`no publishes recorded: ${JSON.stringify(channel.publish)}`);
    if (!channel.publish.budget || channel.publish.budget.sustainedHz !== 20) throw new Error(`generated publishBudget facts missing: ${JSON.stringify(channel.publish)}`);
    if (!(channel.channels.self.writes >= 2)) throw new Error(`channel write counters missing: ${JSON.stringify(channel.channels)}`);
    const established = facts.publishReceipts.find((r) => r.event === 'established');
    if (!established || established.declaredRateHz !== 15 || established.bindingId !== 'pointer') {
      throw new Error(`publish established receipt missing: ${JSON.stringify(facts.publishReceipts)}`);
    }
    return { publish: channel.publish, establishedReceipt: established };
  });

  await suite.check('forceEphemeralState is LOCAL-ONLY and dispose restores live state', async () => {
    const forced = await pageA.eval('window.cursorsWeb.forceGhost()');
    if (!forced) throw new Error('forceEphemeralState unavailable on the provider');
    const ghostOnA = await pageA.pollText('cursor-name-ghost', 'Ghost', 5000);
    if (!/Ghost/.test(ghostOnA ?? '')) throw new Error(`forced ghost not rendered locally: ${ghostOnA}`);
    const countForced = await pageA.text('cursor-count');
    if (!/^1 /.test(countForced ?? '')) throw new Error(`forced map must replace live entries locally, got: ${countForced}`);

    // LOCAL-ONLY: the other window never sees the ghost, and keeps its live map.
    await moveCursor(pageB, 360, 200);
    await sleep(600);
    const ghostOnB = await pageB.exists('cursor-ghost');
    if (ghostOnB) throw new Error('forced ghost leaked to the other window (must be local-only)');
    const bStillLive = await pageB.text(`cursor-name-${a.connection}`);
    if (bStillLive !== 'alice') throw new Error(`B lost live entries during A's force: ${bStillLive}`);

    // Dispose restores the live map on A (ghost gone, real cursors back).
    await pageA.eval('window.cursorsWeb.disposeGhost()');
    const restored = await pageA.pollText(`cursor-name-${b.connection}`, 'bob', 5000);
    if (restored !== 'bob') throw new Error(`live map not restored after dispose: ${restored}`);
    const ghostGone = await pageA.exists('cursor-ghost');
    if (ghostGone) throw new Error('ghost lingered after dispose');
    return { ghostOnA, restored };
  });

  await suite.check('presence stays live after the force cycle (fresh moves propagate)', async () => {
    await moveCursor(pageB, 420, 300);
    const badge = await pageA.eval(`(async () => {
      const d = Date.now() + 8000;
      for (;;) {
        const el = document.querySelector('[data-testid="cursor-${b.connection}"]');
        if (el && parseInt(el.style.left, 10) >= 400) return el.style.left;
        if (Date.now() > d) return el ? el.style.left : null;
        await new Promise(r=>setTimeout(r,100));
      }
    })()`);
    if (!badge || parseInt(badge, 10) < 400) throw new Error(`B's fresh move did not propagate: ${badge}`);
    return { left: badge };
  });

  // ENG-22541 (diary 0011 reconnect probe, flip condition 3): a server
  // restart drops every subscription with its sockets (diary 0007's
  // close→disconnect wiring) and NO in-band needs_resync ever arrives — the
  // adapter must re-enter through a fresh snapshot-with-subscribe on socket
  // regain (the kit's own durable-lane needsResubscribe-on-open policy) and
  // must never present `live` over a dead room. Pre-fix: the banner returned
  // to `live` while B's fresh move never arrived (left stuck at 260px).
  const pollLeftAt = (page, key, x, ms) => page.eval(`(async () => {
    const d = Date.now() + ${ms};
    let last = null;
    for (;;) {
      const el = document.querySelector('[data-testid="cursor-${key}"]');
      last = el ? el.style.left : null;
      if (last === '${x}px') return last;
      if (Date.now() > d) return last;
      await new Promise(r=>setTimeout(r,100));
    }
  })()`);

  await suite.check('presence recovers after an API server restart (fresh re-subscribe on socket regain, ENG-22541)', async () => {
    if (!apiChild) {
      throw new Error(`restart check requires the suite-owned API server — stop the external server on ${apiUrl} (or set CURSORS_CONTRACT_API_PORT) and re-run`);
    }
    // Baseline: B parks at x=260 and A sees it (the probe's stuck value).
    await moveCursor(pageB, 260, 220);
    const baseline = await pollLeftAt(pageA, b.connection, 260, 8000);
    if (baseline !== '260px') throw new Error(`baseline move did not propagate before the restart: ${baseline}`);

    // Kill the API server mid-session: both windows must degrade honestly.
    await stopApi();
    const staleBanner = await pageA.pollText('map-status', 'connection: (stale|disconnected)', 25000);
    if (!/connection: (stale|disconnected)/.test(staleBanner ?? '')) {
      throw new Error(`banner did not degrade during the outage: ${staleBanner}`);
    }

    // Restart and re-provision, then wait out the reconnect budgets: the
    // socket backoff caps at 10s, and the banner may only return to `live`
    // once the fresh subscribe landed (connection-axis honesty, LLP 0034).
    await spawnApi();
    await provisionApi();
    const liveA = await pageA.pollText('map-status', 'connection: live', 30000);
    if (!/connection: live/.test(liveA ?? '')) throw new Error(`A never returned to live after the restart: ${liveA}`);
    const liveB = await pageB.pollText('map-status', 'connection: live', 30000);
    if (!/connection: live/.test(liveB ?? '')) throw new Error(`B never returned to live after the restart: ${liveB}`);

    // The flip-condition check (diary 0011 §verdict-c-3): B's FRESH move
    // reaches A — left 410px, not the frozen pre-restart 260px.
    await moveCursor(pageB, 410, 240);
    const left = await pollLeftAt(pageA, b.connection, 410, 15000);
    if (left !== '410px') {
      const banner = await pageA.text('map-status');
      throw new Error(`fresh move did not arrive after the restart (left: ${left ?? 'entry gone'}; banner: ${banner}) — dead room under a live banner`);
    }
    return { baseline, staleBanner, left };
  });
}, { cleanups, reportExtra: { demo: 'cursors-web', surface: 'contract', issue: 'ENG-22524' } });

// --- Minimal CDP harness (shared shape with all-aboard/tests/acceptance) ---

async function launchChrome() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'cursors-contract-'));
  const child = spawn(chromeBin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const [port] = readFileSync(portFile, 'utf8').trim().split('\n');
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json());
      return { ws: version.webSocketDebuggerUrl, stop: () => { try { child.kill('SIGKILL'); } catch {} rmSync(userDataDir, { recursive: true, force: true }); } };
    } catch { await sleep(100); }
  }
  throw new Error('Chrome did not expose DevToolsActivePort');
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  // A dropped DevTools WebSocket used to hang the suite forever: a command sent
  // on a dead socket gets no response, and there was no timeout, close/error
  // handler, or error propagation here, so every pending send() stayed
  // unresolved and the run wedged instead of failing (ENG-22804). Fail loudly
  // instead — settle() clears a command's per-response timeout, and rejectAll()
  // drains every in-flight command when the socket drops.
  const COMMAND_TIMEOUT_MS = 30_000;
  const settle = (id) => { const p = pending.get(id); if (p) clearTimeout(p.timer); pending.delete(id); return p; };
  const rejectAll = (reason) => { for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason)); };
  socket.addEventListener('message', async (e) => {
    const text = typeof e.data === 'string' ? e.data : await e.data.text();
    const msg = JSON.parse(text);
    if (msg.id && pending.has(msg.id)) { const p = settle(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result || {}); }
  });
  socket.addEventListener('close', () => rejectAll('CDP DevTools WebSocket closed while commands were in flight (socket dropped mid-run)'));
  socket.addEventListener('error', () => rejectAll('CDP DevTools WebSocket errored while commands were in flight (socket dropped mid-run)'));
  await new Promise((res, rej) => { socket.addEventListener('open', res, { once: true }); socket.addEventListener('error', () => rej(new Error('CDP failed')), { once: true }); });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { settle(id); rej(new Error(`CDP command timed out after ${COMMAND_TIMEOUT_MS}ms with no response: ${method} (id ${id}) — DevTools socket may be wedged`)); }, COMMAND_TIMEOUT_MS);
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
        pollText: (id, pattern, ms) => evalRaw(`(async () => { const d = Date.now()+${ms}; let v; while (Date.now()<d) { v = document.querySelector('${sel(id)}')?.textContent.trim() ?? null; if (v !== null && new RegExp(${JSON.stringify(pattern)}).test(v)) return v; await new Promise(r=>setTimeout(r,120)); } return v; })()`),
      };
    },
  };
}

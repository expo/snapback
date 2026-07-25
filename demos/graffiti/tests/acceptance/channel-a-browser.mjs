// Graffiti wall — Channel A browser acceptance (LLP 0090 rollout step 3,
// ENG-25454; contracts LLP 0091/0092).
//
// Drives the real Contract surface through the `snapback-vite` Channel A
// seam against a live local backend and proves the step-3 list end to end:
//   - before provisioning, the pageload degrades to the unhydrated shell
//     (bundle refused -> untransformed HTML, today's waterfall);
//   - after provisioning (schema + functions + seed + ROUTES via one
//     ensure), the served document carries the `__snapback_boot` payload
//     with the seeded rows and a resume token, under Cache-Control:
//     no-store, with no backend origin in the payload;
//   - first paint renders the inlined rows BEFORE any WebSocket frame;
//   - the (identity-carrying) session consumes the anonymously minted
//     preload via the alias key: exactly one listCells subscription, opened
//     with resumeFromToken under the caller's own user identity;
//   - resume after no change answers CurrentAsOf — the subscribe response
//     carries no snapshot and no live_replace ever arrives for the wall;
//   - §Scalability gate numbers are measured and reported (page-query
//     evaluation time, payload/HTML bytes, first-rows-visible /
//     proved-current / live-attached timings).
//
// Integration lane: needs bun + the surface's node_modules (`bun install` in
// demos/graffiti/surfaces/contract). Missing Exact packages skip-as-declared
// -gap unless SNAPBACK_REQUIRE_EXACT=1 (the cold-clone lane).
//
// Run: node demos/graffiti/tests/acceptance/channel-a-browser.mjs

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const backendDir = join(repoRoot, 'demos', 'graffiti', 'snapback');
const surfaceDir = join(repoRoot, 'demos', 'graffiti', 'surfaces', 'contract');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const surfaceExactPackage = join(surfaceDir, 'node_modules', '@exact', 'contract', 'package.json');

const gen = (file) => JSON.parse(readFileSync(join(backendDir, 'generated', file), 'utf8'));
const schemaManifest = gen('schema.manifest.json');
const functionsManifest = gen('functions.manifest.json');
const routesManifest = gen('routes.manifest.json');
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const SEED_CELLS = seed.tables.cells.length;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOk = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
};

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

const EXPECTED_CHECKS = 8;
const suite = createSuite('graffiti channel-a browser (LLP 0090 step 3)', {
  expectedChecks: EXPECTED_CHECKS,
});
const cleanups = [];

const fetchShell = async (viteUrl) => {
  const response = await fetch(`${viteUrl}/`, {
    headers: { accept: 'text/html' },
  });
  const html = await response.text();
  return { response, html };
};

const extractBootPayload = (html) => {
  const marker = 'id="__snapback_boot">';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const rest = html.slice(start + marker.length);
  const end = rest.indexOf('</script>');
  return { raw: rest.slice(0, end), payload: JSON.parse(rest.slice(0, end)) };
};

// Injected before ANY document script: instruments WebSocket frames, the
// live-subscribe POSTs, and the first seeded-cell paint so the ordering
// facts survive to assertion time.
const PROBE_SOURCE = `(() => {
  const probe = {
    wsOpenAt: null, wsFirstFrameAt: null, currentAsOfAt: null,
    liveReplaceFrames: 0, paintAt: null, bootPayloadBytes: null,
    subscribes: [], navStart: performance.now(),
  };
  window.__rqsProbe = probe;
  const RealWS = window.WebSocket;
  window.WebSocket = class extends RealWS {
    constructor(...args) {
      super(...args);
      // Only the Snapback live stream counts — the Vite dev client opens its
      // own HMR WebSocket, which is not part of the app's data path.
      const live = /\\/live\\/[^/]+\\/stream/.test(String(args[0] ?? ''));
      if (!live) return;
      this.addEventListener('open', () => {
        if (probe.wsOpenAt === null) probe.wsOpenAt = performance.now();
      });
      this.addEventListener('message', (event) => {
        if (probe.wsFirstFrameAt === null) probe.wsFirstFrameAt = performance.now();
        const text = typeof event.data === 'string' ? event.data : '';
        if (probe.currentAsOfAt === null && text.includes('"current_as_of"')) {
          probe.currentAsOfAt = performance.now();
        }
        if (text.includes('"live_replace"')) probe.liveReplaceFrames += 1;
      });
    }
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(typeof input === 'string' ? input : (input && input.url) || '');
    const response = await realFetch(input, init);
    if (/\\/live\\/[^/]+\\/subscribe/.test(url)) {
      let request = null;
      try { request = init && init.body ? JSON.parse(init.body) : null; } catch {}
      let body = null;
      try { body = await response.clone().json(); } catch {}
      probe.subscribes.push({
        url,
        at: performance.now(),
        sentResumeToken: Boolean(request && request.resumeFromToken && request.resumeFromToken.resume
          && request.resumeFromToken.resume.token),
        authUserId: (request && ((request.input && request.input.auth && request.input.auth.user_id)
          || (request.auth && request.auth.user_id))) || null,
        hasSnapshot: Boolean(body && body.snapshot),
      });
    }
    return response;
  };
  const seedPainted = () => {
    for (const cell of document.querySelectorAll('[data-testid^="cell-"]')) {
      const bg = (cell.getAttribute('style') || '') + ' ' + getComputedStyle(cell).backgroundColor;
      if (bg.includes('#e5484d') || bg.includes('229, 72, 77')) return true;
    }
    return false;
  };
  const check = () => {
    if (probe.bootPayloadBytes === null) {
      const el = document.getElementById('__snapback_boot');
      if (el) probe.bootPayloadBytes = el.textContent.length;
    }
    if (probe.paintAt === null && seedPainted()) probe.paintAt = performance.now();
  };
  // Belt and braces: a MutationObserver for tight ordering resolution plus a
  // polling fallback (the Vite dev loop can replace the document mid-boot —
  // dependency-optimization reloads — which would orphan an observer bound
  // to a stale root).
  const observe = () => {
    if (document.documentElement) {
      new MutationObserver(check).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
      });
    }
  };
  observe();
  document.addEventListener('DOMContentLoaded', () => { observe(); check(); });
  setInterval(check, 50);
})();`;

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const COMMAND_TIMEOUT_MS = 30_000;
  const settle = (id) => {
    const entry = pending.get(id);
    if (entry) clearTimeout(entry.timer);
    pending.delete(id);
    return entry;
  };
  const rejectAll = (reason) => {
    for (const id of [...pending.keys()]) settle(id)?.reject(new Error(reason));
  };
  socket.addEventListener('message', async (event) => {
    const text = typeof event.data === 'string' ? event.data : await event.data.text();
    const msg = JSON.parse(text);
    if (msg.id && pending.has(msg.id)) {
      const entry = settle(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result || {});
    }
  });
  socket.addEventListener('close', () => rejectAll('CDP socket closed mid-run'));
  socket.addEventListener('error', () => rejectAll('CDP socket errored mid-run'));
  await new Promise((res, rej) => {
    socket.addEventListener('open', res, { once: true });
    socket.addEventListener('error', () => rej(new Error('CDP connect failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        settle(id);
        rej(new Error(`CDP command timed out: ${method}`));
      }, COMMAND_TIMEOUT_MS);
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
        const result = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }, sessionId);
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result?.value;
      };
      return {
        addInitScript: (source) => send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId),
        navigate: (url) => send('Page.navigate', { url }, sessionId),
        close: () => send('Target.closeTarget', { targetId }),
        eval: evalRaw,
        evalPoll: async (expr, predicate, ms) => {
          const deadline = Date.now() + ms;
          let value;
          while (Date.now() < deadline) {
            value = await evalRaw(expr);
            if (predicate(value)) return value;
            await sleep(120);
          }
          return value;
        },
      };
    },
  };
}

async function main() {
  if (!existsSync(surfaceExactPackage)) {
    if (process.env.SNAPBACK_REQUIRE_EXACT === '1') {
      console.error(`FAIL graffiti channel-a browser — SNAPBACK_CAPABILITY_EXACT_MISSING (no @exact/contract at ${surfaceExactPackage}; run \`bun install\` in ${surfaceDir}) but SNAPBACK_REQUIRE_EXACT=1`);
      process.exit(1);
    }
    console.log(`SKIP graffiti channel-a browser — SNAPBACK_CAPABILITY_EXACT_MISSING (no @exact/contract at ${surfaceExactPackage}; run \`bun install\` in ${surfaceDir})`);
    console.log('PASS graffiti channel-a browser — skipped (declared capability gap)');
    return;
  }

  const metrics = {};

  await runAcceptance(suite, async () => {
    // Fresh isolated processes on OS-assigned ports every run: no fixed-port
    // reuse, so a stale server from another checkout can never answer.
    const server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      provenance: {
        appId: 'graffiti',
        artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
      },
    });
    cleanups.push(() => server.stop());
    const apiUrl = server.baseUrl;

    const vitePort = await freePort();
    const viteUrl = `http://127.0.0.1:${vitePort}`;
    const viteEnv = { ...process.env, SNAPBACK_GRAFFITI_API: apiUrl };
    delete viteEnv.SNAPBACK_ADMIN_TOKEN;
    const vite = spawn(
      'bun',
      ['--bun', 'node_modules/.bin/vite', '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
      { cwd: surfaceDir, env: viteEnv, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    cleanups.push(() => vite.kill('SIGTERM'));
    {
      const deadline = Date.now() + 60_000;
      for (;;) {
        if (await urlOk(viteUrl)) break;
        if (vite.exitCode !== null) throw new Error('Vite exited during startup');
        if (Date.now() > deadline) throw new Error('Vite did not become ready');
        await sleep(400);
      }
    }
    await suite.check('unprovisioned pageload degrades to the unhydrated shell', async () => {
      const { html } = await fetchShell(viteUrl);
      if (html.includes('__snapback_boot')) {
        throw new Error('shell carried a boot payload before the backend was provisioned');
      }
      if (!html.includes('main.ts')) throw new Error('degraded response is not the app shell');
      return { degraded: true };
    });

    await suite.check('one ensure provisions schema + functions + seed + routes', async () => {
      const client = new SnapbackClient(apiUrl, server.clientOptions);
      const outcome = await client.ensureApp({
        schema: schemaManifest,
        functions: functionsManifest,
        seed,
        routes: routesManifest,
      });
      if (outcome.routes !== 'provisioned') {
        throw new Error(`routes outcome ${outcome.routes}; ${JSON.stringify(outcome)}`);
      }
      return outcome;
    });

    await suite.check('served document inlines the wall under no-store', async () => {
      const started = Date.now();
      const { response, html } = await fetchShell(viteUrl);
      metrics.transformedPageMs = Date.now() - started;
      metrics.htmlBytes = Buffer.byteLength(html, 'utf8');
      if (response.headers.get('cache-control') !== 'no-store') {
        throw new Error(`transformed response cache-control: ${response.headers.get('cache-control')}`);
      }
      if (response.headers.get('etag') || response.headers.get('last-modified')) {
        throw new Error('transformed response must carry no validators');
      }
      const boot = extractBootPayload(html);
      if (!boot) throw new Error('transformed document lacks the __snapback_boot payload');
      metrics.payloadBytes = Buffer.byteLength(boot.raw, 'utf8');
      const entry = boot.payload.entries?.[0];
      if (entry?.function !== 'listCells') throw new Error('payload lacks the listCells entry');
      if ((entry.rows?.length ?? 0) !== SEED_CELLS) {
        throw new Error(`payload rows ${entry.rows?.length}; expected the ${SEED_CELLS} seeded cells`);
      }
      if (typeof entry.resume?.token !== 'string') throw new Error('payload entry lacks a resume token');
      if (boot.payload.route !== '/') throw new Error(`payload route ${boot.payload.route}`);
      // No backend origin may reach the HTML (LLP 0030 generated-app-facts).
      if (html.includes(apiUrl)) throw new Error('backend origin leaked into the served document');
      // The §0E.1 whole-output property over the embedded bytes.
      if (boot.raw.includes('<') || boot.raw.includes('>')) {
        throw new Error('embedded payload contains raw angle brackets');
      }
      return { payloadBytes: metrics.payloadBytes, htmlBytes: metrics.htmlBytes };
    });

    await suite.check('page-query evaluation cost is measured (scalability gate)', async () => {
      // The seam pays one anonymous read-mode bundle evaluation per
      // pageload; measure the endpoint directly for the gate record.
      const started = process.hrtime.bigint();
      const response = await fetch(`${apiUrl}/app/bundle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ route: '/', params: {}, mode: 'read' }),
      });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      if (!response.ok) throw new Error(`bundle evaluation failed: ${response.status}`);
      const bundle = await response.json();
      metrics.pageQueryMs = Math.round(elapsedMs * 100) / 100;
      metrics.bundleRows = bundle.entries?.[0]?.rows?.length ?? 0;
      return { pageQueryMs: metrics.pageQueryMs, rows: metrics.bundleRows };
    });

    const chrome = await launchChromeCdp({ chromeBin, userDataPrefix: 'graffiti-rqs-' });
    cleanups.push(() => chrome.stop());
    const cdp = await connectCdp(chrome.ws);
    cleanups.push(() => cdp.close());
    const page = await cdp.newPage();
    await page.addInitScript(PROBE_SOURCE);
    await page.navigate(`${viteUrl}/`);

    await suite.check('surface boots and consumes the inlined preload', async () => {
      // The Vite dev loop may replace the document mid-boot (dependency
      // optimization reload), killing an in-flight Runtime.evaluate; retry
      // until the (possibly reloaded) document reports ready.
      const deadline = Date.now() + 45_000;
      for (;;) {
        try {
          const ready = await page.eval(`(async () => {
            if (!window.graffitiReady) return false;
            await window.graffitiReady;
            return true;
          })()`);
          if (ready) break;
        } catch (error) {
          if (!/navigated or closed|Cannot find context/.test(String(error?.message))) throw error;
        }
        if (Date.now() > deadline) throw new Error('graffitiReady never appeared');
        await sleep(200);
      }
      const rqs = await page.eval('window.graffitiRqs');
      if (rqs?.preloadEntries !== 1) {
        throw new Error(`expected 1 preload entry, saw ${JSON.stringify(rqs)}`);
      }
      return rqs;
    });

    await suite.check('first paint renders inlined rows before any WebSocket frame', async () => {
      const probe = await page.evalPoll(
        'window.__rqsProbe',
        (value) => value && value.paintAt !== null,
        10_000,
      );
      if (probe?.paintAt === null || probe?.paintAt === undefined) {
        throw new Error(`seeded wall never painted: ${JSON.stringify(probe)}`);
      }
      if (probe.bootPayloadBytes === null) throw new Error('boot payload element absent in the browser');
      if (probe.wsFirstFrameAt !== null && probe.paintAt >= probe.wsFirstFrameAt) {
        throw new Error(`paint at ${probe.paintAt} did not precede the first WS frame at ${probe.wsFirstFrameAt}`);
      }
      metrics.firstRowsVisibleMs = Math.round(probe.paintAt - probe.navStart);
      metrics.liveAttachedMs = probe.wsOpenAt === null ? null : Math.round(probe.wsOpenAt - probe.navStart);
      return {
        firstRowsVisibleMs: metrics.firstRowsVisibleMs,
        wsFirstFrameAt: probe.wsFirstFrameAt,
        paintAt: probe.paintAt,
      };
    });

    await suite.check('one identity-carrying subscription resumes from the anonymous token (alias key, no refetch)', async () => {
      const probe = await page.evalPoll(
        'window.__rqsProbe',
        (value) => value && value.subscribes.length > 0 && value.currentAsOfAt !== null,
        15_000,
      );
      const subscribes = probe?.subscribes ?? [];
      const wall = subscribes.filter((entry) => entry.url.includes('/live/listCells/'));
      if (wall.length !== 1) {
        throw new Error(`expected exactly one listCells subscription, saw ${JSON.stringify(subscribes)}`);
      }
      if (!wall[0].sentResumeToken) throw new Error('subscribe carried no resumeFromToken');
      if (!wall[0].authUserId) throw new Error('subscribe was not identity-carrying');
      // Rung 1: no fresh snapshot in the subscribe answer, no live_replace on
      // the wire — held (inlined) rows were proved current by CurrentAsOf.
      if (wall[0].hasSnapshot) throw new Error('resume paid a full refetch (snapshot in subscribe response)');
      if (probe.currentAsOfAt === null) throw new Error('CurrentAsOf never arrived');
      if (probe.liveReplaceFrames !== 0) {
        throw new Error(`live_replace arrived ${probe.liveReplaceFrames} times after an unchanged resume`);
      }
      metrics.provedCurrentMs = Math.round(probe.currentAsOfAt - probe.navStart);
      return {
        provedCurrentMs: metrics.provedCurrentMs,
        subscribe: wall[0],
      };
    });

    await suite.check('wall rows survive proved-current with no discard flash', async () => {
      const cellCount = await page.eval(
        `document.querySelectorAll('[data-testid^="cell-"]').length`,
      );
      if (cellCount === 0) throw new Error('wall grid absent after resume settled');
      const painted = await page.eval(`(() => {
        let painted = 0;
        for (const cell of document.querySelectorAll('[data-testid^="cell-"]')) {
          const bg = (cell.getAttribute('style') || '') + ' ' + getComputedStyle(cell).backgroundColor;
          if (bg.includes('229, 72, 77') || bg.includes('#e5484d')) painted += 1;
        }
        return painted;
      })()`);
      if (painted === 0) throw new Error('seeded red cells vanished after the authoritative answer');
      console.log(`[channel-a metrics] ${JSON.stringify(metrics)}`);
      return { cellCount, painted, metrics };
    });
  }, { cleanups, reportExtra: { metrics } });
}

await main();

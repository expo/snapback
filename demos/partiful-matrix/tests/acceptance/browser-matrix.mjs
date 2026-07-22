import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite, runAcceptance, writeMachineReport } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import api from '../../snapback/generated/api.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const protocol = JSON.parse(readFileSync(join(demoRoot, 'acceptance', 'comparison-protocol.v1.json'), 'utf8'));
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const serverBin = join(repoRoot, 'target', 'debug', 'snapback');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const selectedArm = option('arm');
const selectedBackend = option('backend');
const receiptFile = option('receipt');
const productUi = process.argv.includes('--product-ui');
const productionWeb = process.argv.includes('--production-web');
const arms = productionWeb ? ['contract'] : selectedArm ? [selectedArm] : productUi ? ['react', 'contract'] : ['react', 'contract', 'vanilla'];
const backends = productionWeb ? ['snapback'] : selectedBackend ? [selectedBackend] : productUi ? ['snapback'] : ['snapback', 'supabase', 'convex', 'sqlite'];
const cells = arms.flatMap((arm) => backends.map((backend) => ({ arm, backend })));

const vanillaCells = cells.filter(({ arm }) => arm === 'vanilla');
const snapbackCells = cells.filter(({ backend }) => backend === 'snapback');
const productUiChecks = productUi
  ? (cells.length * 5) + cells.filter(({ arm, backend }) => arm === 'contract' && backend === 'snapback').length
  : 0;
const expectedChecks = productionWeb ? 9 : (cells.length * 3) + vanillaCells.length + snapbackCells.length + productUiChecks;
const suiteTitle = productionWeb
  ? 'partitime / production Contract web'
  : productUi
  ? 'partitime / product UI browser parity'
  : 'partiful matrix / twelve browser cells';
const suite = createSuite(suiteTitle, {
  expectedChecks,
});
const cleanups = [];
if (!existsSync(chromeBin) || !existsSync(serverBin)) {
  const missing = [
    ...(!existsSync(chromeBin) ? [{ prerequisite: 'chrome', path: chromeBin }] : []),
    ...(!existsSync(serverBin) ? [{ prerequisite: 'snapback-server', path: serverBin }] : []),
  ];
  const report = {
    ...runIdentity(),
    title: suiteTitle,
    passed: 0,
    total: 0,
    expectedChecks,
    ok: false,
    outcome: 'skip',
    skipClass: 'required-prerequisite-missing',
    skips: missing,
    results: [],
    cleanupErrors: [],
    cleanupErrorCount: 0,
  };
  if (receiptFile) writeMachineReport(receiptFile, report);
  console.error(`SKIP partiful matrix browser — required prerequisites unavailable: ${missing.map(({ prerequisite }) => prerequisite).join(', ')}`);
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  process.exit(1);
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
  const child = spawn(serverBin, ['--port', '0', '--memory', '--ready-file', readyFile], { cwd: repoRoot, detached: true, stdio: ['ignore','ignore','pipe'] });
  cleanups.push(
    () => rmSync(readyDir, { recursive: true, force: true }),
    () => stopChild(child, 'Snapback'),
  );
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

async function startGateway(snapbackUrl) {
  const port = await freePort();
  const child = spawn('bun', ['run', 'server.ts'], { cwd: join(demoRoot, 'backends', 'gateway'), detached: true, env: { ...process.env, PARTIFUL_MATRIX_GATEWAY_PORT: String(port), PARTIFUL_MATRIX_SNAPBACK_ORIGIN: snapbackUrl }, stdio: ['ignore','pipe','pipe'] });
  cleanups.push(() => stopChild(child, 'matrix gateway'));
  const url = `http://127.0.0.1:${port}`;
  await waitUrl(`${url}/health`, child, 'matrix gateway');
  const response = await fetch(`${url}/preflight`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`matrix gateway preflight returned HTTP ${response.status}`);
  const preflight = await response.json();
  for (const backend of ['snapback', 'sqlite']) {
    if (preflight.backends?.[backend]?.ok !== true) {
      throw new Error(`required local backend preflight failed (${backend}): ${JSON.stringify(preflight.backends?.[backend])}`);
    }
  }
  return { url, preflight };
}

async function startVite({ arm, backend }, snapbackUrl, gatewayUrl, { disablePollFallback = false } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await startViteAttempt(
        { arm, backend },
        snapbackUrl,
        gatewayUrl,
        { disablePollFallback },
      );
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(250);
    }
  }
  throw lastError;
}

async function startViteAttempt({ arm, backend }, snapbackUrl, gatewayUrl, { disablePollFallback }) {
  const port = await freePort();
  const surface = join(demoRoot, 'surfaces', arm);
  const vite = join(surface, 'node_modules', '.bin', 'vite');
  const args = arm === 'contract'
    ? ['--bun', vite, '--config', join(surface, 'vite.config.ts'), '--mode', backend, '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    : [vite, '--mode', backend, '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const command = arm === 'contract' ? 'bun' : vite;
  const commandArgs = arm === 'contract' ? args : args.slice(1);
  let log = '';
  const child = spawn(command, commandArgs, {
    cwd: surface,
    detached: true,
    env: {
      ...process.env,
      SNAPBACK_PARTIFUL_MATRIX_API: snapbackUrl,
      PARTIFUL_MATRIX_GATEWAY: gatewayUrl,
      PARTITIME_DISABLE_POLL_FALLBACK: disablePollFallback ? '1' : '0',
    },
    stdio: ['ignore','pipe','pipe'],
  });
  cleanups.push(() => stopChild(child, `${arm}/${backend} Vite`));
  child.stdout.on('data', (chunk) => { log += chunk; }); child.stderr.on('data', (chunk) => { log += chunk; });
  const url = `http://127.0.0.1:${port}`;
  try { await waitUrl(url, child, `${arm}/${backend} Vite`); }
  catch (error) {
    await stopChild(child, `${arm}/${backend} Vite startup`);
    throw new Error(`${error.message}\n${log.slice(-4000)}`);
  }
  return { url, stop: () => stopChild(child, `${arm}/${backend} Vite`) };
}

function buildProductionContract(snapbackUrl, gatewayUrl) {
  const surface = join(demoRoot, 'surfaces', 'contract');
  execFileSync('bun', ['run', 'build:snapback'], {
    cwd: surface,
    env: {
      ...process.env,
      PARTITIME_BASE_PATH: '/partitime/',
      PARTITIME_CANONICAL_ORIGIN: 'https://partitime.example',
      PARTITIME_DISABLE_POLL_FALLBACK: '1',
      SNAPBACK_PARTIFUL_MATRIX_API: snapbackUrl,
      PARTIFUL_MATRIX_GATEWAY: gatewayUrl,
    },
    stdio: 'pipe',
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function startProductionPreview(snapbackUrl, gatewayUrl) {
  const port = await freePort();
  const surface = join(demoRoot, 'surfaces', 'contract');
  const vite = join(surface, 'node_modules', '.bin', 'vite');
  let log = '';
  const child = spawn('bun', [
    '--bun', vite, 'preview', '--config', join(surface, 'vite.config.ts'),
    '--mode', 'snapback', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    '--outDir', 'dist/snapback',
  ], {
    cwd: surface,
    detached: true,
    env: {
      ...process.env,
      PARTITIME_BASE_PATH: '/partitime/',
      SNAPBACK_PARTIFUL_MATRIX_API: snapbackUrl,
      PARTIFUL_MATRIX_GATEWAY: gatewayUrl,
      PARTITIME_DISABLE_POLL_FALLBACK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cleanups.push(() => stopChild(child, 'Contract production preview'));
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitUrl(`${url}/partitime/`, child, 'Contract production preview');
  } catch (error) {
    await stopChild(child, 'Contract production preview startup');
    throw new Error(`${error.message}\n${log.slice(-4000)}`);
  }
  return { url, stop: () => stopChild(child, 'Contract production preview') };
}

const reportIdentity = {
  ...runIdentity(),
  demo: 'partiful-matrix',
  claimSetVersion: 'partitime.web.v1',
  cells: cells.map(({ arm, backend }) => `${arm}:${backend}`),
  transportWitnessCells: snapbackCells.map(({ arm, backend }) => `${arm}:${backend}`),
  backendHealth: null,
};

await runAcceptance(suite, async () => {
  const snapbackUrl = await startSnapback();
  const outOfBandClient = new SnapbackClient(snapbackUrl);
  const gateway = await startGateway(snapbackUrl);
  const gatewayUrl = gateway.url;
  reportIdentity.backendHealth = gateway.preflight;
  const chrome = await launchChromeCdp({ chromeBin, userDataPrefix: 'partiful-matrix-' });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.close());

  if (productionWeb) {
    buildProductionContract(snapbackUrl, gatewayUrl);
    const preview = await startProductionPreview(snapbackUrl, gatewayUrl);
    try {
      await runProductionWebChecks({ suite, cdp, previewUrl: preview.url, outOfBandClient });
    } finally {
      await preview.stop();
    }
    return;
  }

  for (const cell of cells) {
    const health = gateway.preflight.backends?.[cell.backend];
    if ((cell.backend === 'supabase' || cell.backend === 'convex') && health?.ok !== true) {
      skipRemoteCell(cell, health);
      continue;
    }
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
          await page.eval(`(async()=>{const d=Date.now()+30000;while(!window.partifulMatrixReady){if(Date.now()>d)throw new Error('event boot timeout');await new Promise(r=>setTimeout(r,50));}return await window.partifulMatrixReady;})()`);
        }
        const event = await page.pollText('event-page', 'Sunset Supper Club', 15_000);
        if (!event?.includes('Sunset Supper Club')) throw new Error(`event detail missing: ${event}`);
        const before = await page.pollText('guest-user_eve', 'Eve', 15_000);
        if (!before?.includes('Eve')) throw new Error(`Eve's RSVP row is missing: ${before}`);
        const next = before.includes('Going') ? { id: 'rsvp-maybe', label: 'Maybe' } : { id: 'rsvp-going', label: 'Going' };
        await page.click(next.id);
        const after = await page.pollText('guest-user_eve', next.label, 15_000);
        if (!after?.includes('Eve') || !after?.includes(next.label) || after === before) {
          throw new Error(`Eve's RSVP did not make an observed transition: ${JSON.stringify({ before, after, expected: next.label })}`);
        }
        return { actor: 'user_eve', before, after, transition: next.label };
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
          const startupMilestones = await page.eval('window.partifulMatrixDebug.startupMilestones()');
          for (const name of ['module-evaluated', 'boot-started', 'provider-ready', 'ui-mounted', 'first-authoritative-snapshot']) {
            if (!Number.isFinite(startupMilestones[name])) throw new Error(`missing vanilla startup milestone ${name}: ${JSON.stringify(startupMilestones)}`);
          }
          if (startupMilestones['provider-ready'] < startupMilestones['boot-started']) throw new Error(`provider-ready preceded boot-started: ${JSON.stringify(startupMilestones)}`);
          return { eventScope, feedScope, startupMilestones };
        });
      }
      if (productUi) {
        await runProductUiChecks({ suite, page, cell });
      }
    } finally {
      try { await page.close(); }
      finally { await vite.stop(); }
    }

    if (cell.backend === 'snapback') {
      await suite.check(`${cell.arm} × snapback proves unsolicited push with polling fallback disabled`, async () => {
        const witness = await startVite(cell, snapbackUrl, gatewayUrl, { disablePollFallback: true });
        const witnessPage = await cdp.newPage();
        try {
          await witnessPage.navigate(`${witness.url}/?user=eve`);
          await waitForMatrixBoot(witnessPage);
          await witnessPage.pollText('event-card-event_sunset', 'Sunset Supper Club', 15_000);
          await witnessPage.click('open-event_sunset');
          if (cell.arm === 'contract') {
            await waitForMatrixBoot(witnessPage);
          }
          await witnessPage.pollText('event-page', 'Sunset Supper Club', 15_000);
          const connectionBefore = await witnessPage.pollText('connection', 'live', 5_000);
          if (!connectionBefore?.toLowerCase().includes('live')) {
            throw new Error(`fallback-disabled surface did not establish a live stream: ${connectionBefore}`);
          }
          let before = await witnessPage.pollText('guest-user_eve', 'Eve', 15_000);
          const observations = [];
          for (let sampleIndex = 0; sampleIndex < 9; sampleIndex += 1) {
            const next = before?.includes('Going')
              ? { status: 'maybe', label: 'Maybe' }
              : { status: 'going', label: 'Going' };
            const startedAtMs = Date.now();
            await outOfBandClient.mutate(api.rsvp, {
              args: { eventId: 'event_sunset', guestName: 'Eve', status: next.status },
              userId: 'user_eve',
            });
            const after = await witnessPage.pollText('guest-user_eve', next.label, 5_000);
            const latencyMs = Date.now() - startedAtMs;
            if (!after?.includes('Eve') || after === before) {
              throw new Error(`out-of-band RSVP did not arrive unsolicited: ${JSON.stringify({ sampleIndex, before, after })}`);
            }
            observations.push({ sampleIndex, before, after, latencyMs });
            before = after;
          }
          const samples = observations.slice(2).map(({ latencyMs }) => latencyMs);
          const ordered = [...samples].sort((left, right) => left - right);
          const median = ordered[Math.floor(ordered.length / 2)];
          const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1];
          const evidence = await witnessPage.transportEvidence();
          const established = evidence.filter((event) => event.event === 'established');
          if (!established.some((event) => event.queryName === 'guestList' && event.transport === 'push')) {
            throw new Error(`guestList lacks push transport provenance: ${JSON.stringify(evidence)}`);
          }
          if (established.some((event) => event.pollFallbackEnabled !== false)) {
            throw new Error(`surface receipt does not prove fallback was disabled: ${JSON.stringify(evidence)}`);
          }
          return {
            actor: 'user_eve',
            mutationOrigin: 'out-of-band SnapbackClient',
            pollFallback: 'disabled',
            warmupCount: 2,
            sampleCount: 7,
            observations,
            freshnessLatencyMs: { samples, median, p95 },
            connectionBefore,
            established,
          };
        } finally {
          try { await witnessPage.close(); }
          finally { await witness.stop(); }
        }
      });
    }
  }
}, {
  cleanups,
  reportFile: receiptFile,
  reportExtra: reportIdentity,
});

async function runProductionWebChecks({ suite: activeSuite, cdp, previewUrl, outOfBandClient }) {
  const distRoot = join(demoRoot, 'surfaces', 'contract', 'dist', 'snapback');
  const staticExport = JSON.parse(readFileSync(join(distRoot, 'static-export.json'), 'utf8'));
  const baseUrl = `${previewUrl}/partitime/`;
  const eventUrl = `${baseUrl}events/event_sunset/`;

  await activeSuite.check('Contract production build emits immutable route artifacts', async () => {
    const asset = readFileSync(join(distRoot, 'assets', readFileSync(join(distRoot, 'index.html'), 'utf8').match(/assets\/([^"']+\.js)/)?.[1] ?? 'missing'));
    if (staticExport.pages.length !== 4 || asset.byteLength === 0) throw new Error(`incomplete production artifact: ${JSON.stringify(staticExport)}`);
    return {
      export: staticExport,
      javascript: { bytes: asset.byteLength, sha256: createHash('sha256').update(asset).digest('hex') },
    };
  });

  await activeSuite.check('Contract production feed is authoritative with JavaScript disabled', async () => {
    const page = await cdp.newPage();
    try {
      await page.setScriptExecutionDisabled(true);
      await page.navigate(baseUrl);
      await sleep(500);
      const state = await page.eval(`(()=>({text:document.querySelector('[data-testid="feed-ready"]')?.textContent??'',title:document.title,canonical:document.querySelector('link[rel="canonical"]')?.href,manifest:!!document.querySelector('[data-exact-contract-hydration]'),clientBooted:typeof window.partifulMatrixReady!=="undefined"}))()`);
      if (!state.text.includes('Sunset Supper Club') || !state.manifest || state.clientBooted) throw new Error(`feed is not a no-JS document: ${JSON.stringify(state)}`);
      return state;
    } finally { await page.close(); }
  });

  await activeSuite.check('Contract production event deep link is authoritative with route metadata and JavaScript disabled', async () => {
    const page = await cdp.newPage();
    try {
      await page.setScriptExecutionDisabled(true);
      await page.navigate(eventUrl);
      await sleep(500);
      const state = await page.eval(`(()=>({text:document.querySelector('[data-testid="event-page"]')?.textContent??'',title:document.title,description:document.querySelector('meta[name="description"]')?.content,canonical:document.querySelector('link[rel="canonical"]')?.href,route:document.getElementById('exact-root')?.dataset.partitimeStaticRoute}))()`);
      if (!state.text.includes('Sunset Supper Club') || state.title !== 'Sunset Supper Club · Partitime' || !state.description || !state.canonical.endsWith('/partitime/events/event_sunset/') || state.route !== '/events/event_sunset/') {
        throw new Error(`event no-JS document or metadata is incomplete: ${JSON.stringify(state)}`);
      }
      return state;
    } finally { await page.close(); }
  });

  await activeSuite.check('Contract production feed adopts every node without replacement, stale flash, or duplicate subscription', async () => {
    const page = await cdp.newPage();
    try {
      await page.navigate(baseUrl);
      const boot = await waitForMatrixBoot(page);
      const witness = await page.eval(`(()=>({sameRoot:window.__partitimeStaticWitness.root===document.getElementById('exact-root'),initialText:window.__partitimeStaticWitness.initialText,finalText:document.getElementById('exact-root').innerText,rootReplacements:window.__partitimeStaticWitness.rootReplacements,childListMutations:window.__partitimeStaticWitness.childListMutations,result:window.__exactContractHydrationResult}))()`);
      if (!boot.hydration || boot.hydration.result?.recreatedNodes !== 0 || boot.hydration.result?.mismatches?.length !== 0 || boot.hydration.provider?.underlyingSubscriptions !== 1 || !witness.sameRoot || witness.rootReplacements !== 0 || !witness.initialText.includes('Sunset Supper Club') || boot.hydration.adoptedText !== witness.initialText) {
        throw new Error(`feed adoption violated authority or subscription invariants: ${JSON.stringify({ boot, witness })}`);
      }
      return { hydration: boot.hydration, witness };
    } finally { await page.close(); }
  });

  await activeSuite.check('Contract production event adopts every node with exactly three live query subscriptions', async () => {
    const page = await cdp.newPage();
    try {
      await page.navigate(eventUrl);
      const boot = await waitForMatrixBoot(page);
      const witness = await page.eval(`(()=>({sameRoot:window.__partitimeStaticWitness.root===document.getElementById('exact-root'),initialText:window.__partitimeStaticWitness.initialText,finalText:document.getElementById('exact-root').innerText,rootReplacements:window.__partitimeStaticWitness.rootReplacements,result:window.__exactContractHydrationResult}))()`);
      if (boot.hydration?.result?.recreatedNodes !== 0 || boot.hydration?.result?.mismatches?.length !== 0 || boot.hydration?.provider?.underlyingSubscriptions !== 3 || !witness.sameRoot || witness.rootReplacements !== 0 || !witness.initialText.includes('Sunset Supper Club') || boot.hydration.adoptedText !== witness.initialText) {
        throw new Error(`event adoption violated authority or subscription invariants: ${JSON.stringify({ boot, witness })}`);
      }
      return { hydration: boot.hydration, witness };
    } finally { await page.close(); }
  });

  await activeSuite.check('Contract production assets and deep links honor the non-root base path', async () => {
    const page = await cdp.newPage();
    try {
      await page.navigate(eventUrl);
      await waitForMatrixBoot(page);
      const state = await page.eval(`(()=>({pathname:location.pathname,resources:performance.getEntriesByType('resource').map(x=>new URL(x.name).pathname).filter(x=>x.endsWith('.js')),scripts:[...document.scripts].filter(x=>x.src).map(x=>new URL(x.src).pathname)}))()`);
      if (state.pathname !== '/partitime/events/event_sunset/' || state.scripts.length !== 1 || state.scripts.some((path) => !path.startsWith('/partitime/assets/')) || state.resources.some((path) => !path.startsWith('/partitime/assets/'))) {
        throw new Error(`basePath escaped: ${JSON.stringify(state)}`);
      }
      return state;
    } finally { await page.close(); }
  });

  await activeSuite.check('Contract production history traverses feed and event without document reload', async () => {
    const page = await cdp.newPage();
    try {
      await page.navigate(baseUrl);
      await waitForMatrixBoot(page);
      const before = await page.eval(`(()=>{window.__partitimeDocumentIdentity=crypto.randomUUID();return {identity:window.__partitimeDocumentIdentity,navigations:performance.getEntriesByType('navigation').length}})()`);
      await page.click('open-event_sunset');
      await page.pollText('event-page', 'Sunset Supper Club', 15_000);
      const event = await page.eval(`({pathname:location.pathname,title:document.title,identity:window.__partitimeDocumentIdentity,navigations:performance.getEntriesByType('navigation').length})`);
      await page.eval('history.back()');
      await page.pollText('feed', 'Sunset Supper Club', 15_000);
      const after = await page.eval(`({pathname:location.pathname,title:document.title,identity:window.__partitimeDocumentIdentity,navigations:performance.getEntriesByType('navigation').length})`);
      if (event.pathname !== '/partitime/events/event_sunset/' || after.pathname !== '/partitime/' || event.identity !== before.identity || after.identity !== before.identity || event.navigations !== before.navigations || after.navigations !== before.navigations) {
        throw new Error(`history traversal reloaded or selected the wrong document: ${JSON.stringify({ before, event, after })}`);
      }
      return { before, event, after };
    } finally { await page.close(); }
  });

  await activeSuite.check('Contract production client metadata tracks the active route', async () => {
    const page = await cdp.newPage();
    try {
      await page.navigate(baseUrl);
      await waitForMatrixBoot(page);
      await page.click('open-event_sunset');
      await page.pollText('event-page', 'Sunset Supper Club', 15_000);
      const metadata = await page.eval(`({title:document.title,description:document.querySelector('meta[name="description"]')?.content,canonical:document.querySelector('link[rel="canonical"]')?.href,themeColor:document.querySelector('meta[name="theme-color"]')?.content})`);
      if (metadata.title !== 'Sunset Supper Club · Partitime' || !metadata.description?.includes('long table') || !metadata.canonical?.endsWith('/partitime/events/event_sunset/') || !metadata.themeColor) {
        throw new Error(`runtime route metadata is incomplete: ${JSON.stringify(metadata)}`);
      }
      return metadata;
    } finally { await page.close(); }
  });

  await activeSuite.check('Contract production hydrated event receives unsolicited Snapback push with polling disabled', async () => {
    const page = await cdp.newPage();
    try {
      await page.navigate(eventUrl);
      await waitForMatrixBoot(page);
      const before = await page.pollText('guest-user_eve', 'Eve', 15_000);
      const next = before?.includes('Going') ? { status: 'maybe', label: 'Maybe' } : { status: 'going', label: 'Going' };
      const startedAtMs = Date.now();
      await outOfBandClient.mutate(api.rsvp, { args: { eventId: 'event_sunset', guestName: 'Eve', status: next.status }, userId: 'user_eve' });
      const after = await page.pollText('guest-user_eve', next.label, 5_000);
      const evidence = await page.transportEvidence();
      const established = evidence.filter((entry) => entry.event === 'established');
      if (!after?.includes(next.label) || after === before || !established.some((entry) => entry.queryName === 'guestList' && entry.transport === 'push') || established.some((entry) => entry.pollFallbackEnabled !== false)) {
        throw new Error(`hydrated live delivery lacks push provenance: ${JSON.stringify({ before, after, evidence })}`);
      }
      return { before, after, latencyMs: Date.now() - startedAtMs, pollFallback: 'disabled', evidence };
    } finally { await page.close(); }
  });
}

function skipRemoteCell(cell, health) {
  const details = {
    skipClass: 'remote-dependency',
    backend: cell.backend,
    health,
  };
  for (const suffix of [
    'boots its identified cell',
    'renders the canonical feed',
    'opens details and observes RSVP',
  ]) {
    suite.skip(`${cell.arm} × ${cell.backend} ${suffix}`, details);
  }
  if (cell.arm === 'vanilla') {
    suite.skip(`${cell.arm} × ${cell.backend} replaces its keyed subscription scope without leaks`, details);
  }
}

async function waitForMatrixBoot(page) {
  return page.eval(`(async()=>{const d=Date.now()+30000;while(!window.partifulMatrixReady){if(Date.now()>d)throw new Error('boot timeout');await new Promise(r=>setTimeout(r,50));}return await window.partifulMatrixReady;})()`);
}

async function runProductUiChecks({ suite: activeSuite, page, cell }) {
  const label = `${cell.arm} × ${cell.backend}`;
  await activeSuite.check(`${label} traverses browser history without document reload`, async () => {
    const before = await page.eval(`(()=>{window.__partitimeDocumentIdentity??=crypto.randomUUID();return {identity:window.__partitimeDocumentIdentity,url:location.href,navigations:performance.getEntriesByType('navigation').length}})()`);
    await page.click('back');
    if (cell.arm === 'contract') await waitForMatrixBoot(page);
    await page.pollText('feed', 'Sunset Supper Club', 15_000);
    await page.eval('history.back()');
    if (cell.arm === 'contract') await waitForMatrixBoot(page);
    await page.pollText('event-page', 'Sunset Supper Club', 15_000);
    await page.eval('history.forward()');
    if (cell.arm === 'contract') await waitForMatrixBoot(page);
    await page.pollText('feed', 'Sunset Supper Club', 15_000);
    const after = await page.eval(`({identity:window.__partitimeDocumentIdentity,url:location.href,navigations:performance.getEntriesByType('navigation').length,event:new URLSearchParams(location.search).get('event')})`);
    if (after.identity !== before.identity || after.navigations !== before.navigations || after.event !== null) {
      throw new Error(`history traversal reloaded or ended on the wrong route: ${JSON.stringify({ before, after })}`);
    }
    return { before, after, traversal: ['feed', 'event', 'feed'] };
  });

  await activeSuite.check(`${label} responds at compact width and changes theme on one tree`, async () => {
    await page.setViewport(1280, 900);
    await page.eval(`(()=>{dispatchEvent(new Event('resize'));return new Promise(r=>setTimeout(r,100))})()`);
    const expanded = await page.eval(`(()=>{const shell=document.querySelector('[data-testid="product-shell"]');const title=document.querySelector('[data-testid="hero-title"]')??document.querySelector('.hero h1');if(!shell||!title)throw new Error('responsive surface missing');shell.__partitimeIdentity='retained';return {fontSize:parseFloat(getComputedStyle(title).fontSize),background:getComputedStyle(shell).backgroundColor,width:shell.getBoundingClientRect().width}})()`);
    await page.setViewport(390, 844);
    await page.eval(`(()=>{dispatchEvent(new Event('resize'));return new Promise(r=>setTimeout(r,100))})()`);
    const compact = await page.eval(`(()=>{const shell=document.querySelector('[data-testid="product-shell"]');const title=document.querySelector('[data-testid="hero-title"]')??document.querySelector('.hero h1');return {fontSize:parseFloat(getComputedStyle(title).fontSize),background:getComputedStyle(shell).backgroundColor,width:shell.getBoundingClientRect().width,identity:shell.__partitimeIdentity}})()`);
    if (!(compact.width < expanded.width) || !(compact.fontSize < expanded.fontSize)) {
      throw new Error(`responsive styles did not adapt: ${JSON.stringify({ expanded, compact })}`);
    }
    await page.click('theme-toggle');
    const themed = await page.eval(`(()=>{const shell=document.querySelector('[data-testid="product-shell"]');return {background:getComputedStyle(shell).backgroundColor,identity:shell.__partitimeIdentity}})()`);
    if (themed.identity !== 'retained' || themed.background === compact.background) {
      throw new Error(`theme replaced the tree or did not change the palette: ${JSON.stringify({ compact, themed })}`);
    }
    return { expanded, compact, themed, treeIdentityRetained: true };
  });

  await activeSuite.check(`${label} provides an accessible portal form and keyboard focus scope`, async () => {
    await page.eval(`document.querySelector('[data-testid="new-event"]')?.focus()`);
    await page.click('new-event');
    await page.pollText('create-panel', 'plan', 5_000);
    await page.eval('new Promise(r=>requestAnimationFrame(r))');
    const semantics = await page.eval(`(()=>{const panel=document.querySelector('[data-testid="create-panel"]');const overlay=document.querySelector('[data-testid="create-overlay"]');const shell=document.querySelector('[data-testid="product-shell"]');const description=document.querySelector('[data-testid="create-description"]');const box=overlay?.getBoundingClientRect();return {role:panel?.getAttribute('role'),modal:panel?.getAttribute('aria-modal'),labelledBy:panel?.getAttribute('aria-labelledby'),describedBy:panel?.getAttribute('aria-describedby'),portal:!!overlay&&(!shell?.contains(overlay)||(getComputedStyle(overlay).position==='fixed'&&box?.width>=innerWidth&&box?.height>=innerHeight)),portalDetached:!!overlay&&!shell?.contains(overlay),overlayPosition:overlay?getComputedStyle(overlay).position:null,descriptionTag:description?.tagName,activeTestId:document.activeElement?.getAttribute('data-testid')}})()`);
    if (semantics.role !== 'dialog' || semantics.modal !== 'true' || !semantics.labelledBy || !semantics.describedBy || !semantics.portal || semantics.descriptionTag !== 'TEXTAREA') {
      throw new Error(`dialog semantics or portal lowering are incomplete: ${JSON.stringify(semantics)}`);
    }
    await page.click('create-submit');
    await page.eval('new Promise(r=>setTimeout(r,0))');
    const validation = await page.eval(`(()=>{const title=document.querySelector('[data-testid="create-title"]');const location=document.querySelector('[data-testid="create-location"]');const titleError=document.querySelector('[data-testid="create-title-error"]');const locationError=document.querySelector('[data-testid="create-location-error"]');return {titleInvalid:title?.getAttribute('aria-invalid'),locationInvalid:location?.getAttribute('aria-invalid'),titleDescribedBy:title?.getAttribute('aria-describedby'),locationDescribedBy:location?.getAttribute('aria-describedby'),titleErrorRole:titleError?.getAttribute('role'),locationErrorRole:locationError?.getAttribute('role'),activeTestId:document.activeElement?.getAttribute('data-testid')}})()`);
    if (!validation.titleDescribedBy || !validation.locationDescribedBy || validation.titleErrorRole !== 'alert' || validation.locationErrorRole !== 'alert') {
      throw new Error(`validation errors are not accessibly associated: ${JSON.stringify(validation)}`);
    }
    const trapped = await page.eval(`(()=>{const panel=document.querySelector('[data-testid="create-panel"]');const nodes=[...panel.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled])')];nodes.at(-1)?.focus();return {last:nodes.at(-1)?.getAttribute('data-testid'),count:nodes.length}})()`);
    await page.key('Tab');
    const wrappedTo = await page.eval(`document.activeElement?.getAttribute('data-testid')`);
    if (!wrappedTo || !['create-close', 'create-emoji', 'create-title'].includes(wrappedTo)) {
      throw new Error(`focus trap did not wrap: ${JSON.stringify({ trapped, wrappedTo })}`);
    }
    await page.key('Escape');
    await page.eval('new Promise(r=>setTimeout(r,0))');
    const restored = await page.eval(`({overlay:!!document.querySelector('[data-testid="create-overlay"]'),activeTestId:document.activeElement?.getAttribute('data-testid')})`);
    if (restored.overlay || restored.activeTestId !== 'new-event') {
      throw new Error(`Escape dismissal did not restore opener focus: ${JSON.stringify(restored)}`);
    }
    return { semantics, validation, trapped, wrappedTo, restored };
  });

  await activeSuite.check(`${label} honors reduced-motion preference`, async () => {
    await page.emulateReducedMotion(true);
    await page.click('new-event');
    await page.pollText('create-panel', 'plan', 5_000);
    const motion = await page.eval(`(()=>{const overlay=document.querySelector('[data-testid="create-overlay"]');const panel=document.querySelector('[data-testid="create-panel"]');const style=getComputedStyle(panel);return {matches:matchMedia('(prefers-reduced-motion: reduce)').matches,animationDuration:style.animationDuration,transitionDuration:style.transitionDuration,overlayTransition:getComputedStyle(overlay).transitionDuration}})()`);
    if (!motion.matches || [motion.animationDuration, motion.transitionDuration, motion.overlayTransition].some((value)=>value && parseFloat(value) > 0.001)) {
      throw new Error(`reduced motion left an active transition: ${JSON.stringify(motion)}`);
    }
    await page.key('Escape');
    await page.emulateReducedMotion(false);
    return motion;
  });

  await activeSuite.check(`${label} mounts a bounded virtual guest window`, async () => {
    await page.click('open-event_sunset');
    if (cell.arm === 'contract') await waitForMatrixBoot(page);
    await page.pollText('event-page', 'Sunset Supper Club', 15_000);
    const virtual = await page.eval(`(()=>{const list=document.querySelector('[data-testid="virtual-guest-list"]');const mounted=[...list.querySelectorAll('[data-testid^="guest-"]')];return {tag:list?.tagName,mounted:mounted.length,totalText:list?.textContent?.trim(),height:list?.getBoundingClientRect().height,overflowY:getComputedStyle(list).overflowY}})()`);
    if (!virtual.tag || virtual.mounted < 1 || virtual.mounted > 10 || virtual.height > 360) {
      throw new Error(`virtual guest window is absent or unbounded: ${JSON.stringify(virtual)}`);
    }
    await page.click('back');
    if (cell.arm === 'contract') await waitForMatrixBoot(page);
    await page.pollText('feed', 'Sunset Supper Club', 15_000);
    return virtual;
  });

  if (cell.arm === 'contract' && cell.backend === 'snapback') {
    await activeSuite.check(`${label} forces loading error empty and ready through its provider`, async () => {
      const observations = [];
      for (const [state, testId, text] of [
        ['loading', 'feed-loading', 'Loading'],
        ['error', 'feed-error', 'Forced Partitime failure'],
        ['empty', 'feed-empty', 'No plans yet'],
        ['ready', 'feed-ready', 'Sunset Supper Club'],
      ]) {
        await page.eval(`window.partifulMatrixDebug.forceFeedState(${JSON.stringify(state)})`);
        const observed = await page.pollText(testId, text, 5_000);
        if (!observed?.includes(text)) throw new Error(`forced ${state} state did not render: ${observed}`);
        observations.push({ state, testId, observed });
      }
      await page.eval('window.partifulMatrixDebug.restoreFeedState()');
      return { provider: 'Snapback ContractDataProvider.forceQueryState', observations };
    });
  }
}

async function stopChild(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  terminateGroup(child, 'SIGTERM');
  const outcome = await Promise.race([
    closed.then(() => 'closed'),
    sleep(5_000).then(() => 'timeout'),
  ]);
  if (outcome === 'closed') return;
  terminateGroup(child, 'SIGKILL');
  const killed = await Promise.race([
    closed.then(() => 'closed'),
    sleep(5_000).then(() => 'timeout'),
  ]);
  if (killed !== 'closed') throw new Error(`${label} did not exit after SIGKILL`);
}

function terminateGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

function runIdentity() {
  const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const packageRecord = (arm, lockPath = join(demoRoot, 'surfaces', arm, 'bun.lock')) => {
    const root = join(demoRoot, 'surfaces', arm);
    const manifestPath = join(root, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    const resolvedDependencies = Object.fromEntries(Object.entries(dependencies).map(([name, requested]) => {
      const installedPath = join(root, 'node_modules', name, 'package.json');
      const installed = JSON.parse(readFileSync(installedPath, 'utf8'));
      return [name, {
        requested,
        resolvedName: installed.name,
        resolvedVersion: installed.version,
        manifestSha256: digest(installedPath),
      }];
    }));
    return {
      manifestSha256: digest(manifestPath),
      lockPath: relative(repoRoot, lockPath),
      lockSha256: digest(lockPath),
      dependencies,
      resolvedDependencies,
    };
  };
  let revision = null;
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(); } catch { /* receipt records null */ }
  let exactRevision = process.env.PARTITIME_EXACT_REVISION ?? null;
  if (exactRevision === null) {
    try {
      exactRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: resolve(repoRoot, '..', 'exact'),
        encoding: 'utf8',
      }).trim();
    } catch { /* an aggregate Step 0 run will reject a missing counterpart */ }
  }
  let chromeVersion = null;
  try { chromeVersion = execFileSync(chromeBin, ['--version'], { encoding: 'utf8' }).trim(); } catch { /* receipt records null */ }
  let bunVersion = null;
  try { bunVersion = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim(); } catch { /* receipt records null */ }
  const testPaths = [
    'demos/_kit/harness.mjs',
    'demos/_kit/chrome-process.mjs',
    'demos/_kit/server-process.mjs',
    'demos/partiful-matrix/tests/acceptance/browser-matrix.mjs',
    'demos/partiful-matrix/surfaces/react/src/App.tsx',
    'demos/partiful-matrix/surfaces/react/src/provider.ts',
    'demos/partiful-matrix/surfaces/contract/main.ts',
    'demos/partiful-matrix/surfaces/contract/provider.ts',
    'demos/partiful-matrix/surfaces/contract/feed.contract',
    'demos/partiful-matrix/surfaces/contract/event.contract',
    'demos/partiful-matrix/surfaces/vanilla/src/main.js',
    'demos/partiful-matrix/surfaces/vanilla/src/provider.js',
    'demos/partiful-matrix/surfaces/vanilla/src/lifecycle.js',
  ];
  const testInventory = testPaths.map((path) => ({ path, sha256: digest(join(repoRoot, path)) }));
  return {
    revision: { snapback: revision, exact: exactRevision },
    workloadVersion: protocol.workloadVersion,
    methodId: protocol.protocolId,
    thresholdFormulaSetId: protocol.thresholdFormulaSetId,
    environment: {
      node: process.version,
      bun: bunVersion,
      os: `${platform()}-${release()}-${arch()}`,
      chrome: chromeBin,
      chromeVersion,
      cpu: cpus()[0]?.model ?? null,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
    },
    packages: {
      react: packageRecord('react'),
      contract: packageRecord('contract'),
      vanilla: packageRecord('vanilla', join(repoRoot, 'bun.lock')),
    },
    artifacts: {
      inputsHash: artifactIndex.inputsHash,
      bundleHash: artifactIndex.bundleHash,
      diarySha256: digest(join(repoRoot, 'diaries', '0016-partiful-matrix.diary.md')),
      reportSha256: digest(join(demoRoot, 'REPORT.md')),
    },
    testInventory,
    testInventorySha256: createHash('sha256').update(JSON.stringify(testInventory)).digest('hex'),
  };
}

async function connectCdp(url) {
  const socket = new WebSocket(url); const pending = new Map(); let nextId = 1;
  const settle = (id) => { const value = pending.get(id); if (value) clearTimeout(value.timer); pending.delete(id); return value; };
  socket.addEventListener('message', async (event) => { const msg = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text()); if (msg.id && pending.has(msg.id)) { const request = settle(msg.id); msg.error ? request.reject(new Error(msg.error.message)) : request.resolve(msg.result || {}); } });
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', () => reject(new Error('CDP failed')), { once: true }); });
  // @ref LLP 0063#sequence — a cumulative gate must not lose a fast CDP reply;
  // register the correlation slot before the browser can answer.
  const send = (method, params = {}, sessionId = null) => new Promise((resolveSend, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      settle(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 30_000);
    pending.set(id, { resolve: resolveSend, reject, timer });
    try {
      socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    } catch (error) {
      settle(id);
      reject(error);
    }
  });
  return { close: () => socket.close(), newPage: async () => {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }); await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
    const evalRaw = async (expression) => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result?.value; };
    const selector = (id) => `[data-testid="${id}"]`;
    return {
      navigate: (pageUrl) => send('Page.navigate', { url: pageUrl }, sessionId),
      close: () => send('Target.closeTarget', { targetId }),
      waitForNavigation: () => sleep(300),
      setScriptExecutionDisabled: (value) => send('Emulation.setScriptExecutionDisabled', { value }, sessionId),
      setViewport: (width, height) => send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width < 600,
      }, sessionId),
      emulateReducedMotion: (enabled) => send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: enabled ? 'reduce' : 'no-preference' }],
      }, sessionId),
      key: async (key) => {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key }, sessionId);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key }, sessionId);
      },
      eval: evalRaw,
      click: (id) => evalRaw(`(()=>{const el=document.querySelector('${selector(id)}');if(!el)throw new Error('missing ${id}');el.click();return true})()`),
      text: (id) => evalRaw(`document.querySelector('${selector(id)}')?.textContent?.trim()??null`),
      pollText: (id, pattern, timeout) => evalRaw(`(async()=>{const d=Date.now()+${timeout};let v=null;while(Date.now()<d){v=document.querySelector('${selector(id)}')?.textContent?.trim()??null;if(v&&new RegExp(${JSON.stringify(pattern)},'i').test(v))return v;await new Promise(r=>setTimeout(r,100));}return v})()`),
      transportEvidence: () => evalRaw(`(async()=>{const ready=await window.partifulMatrixReady;return ready.transportEvidence?.()??ready.provider?.transportEvidence?.()??[];})()`),
    };
  } };
}

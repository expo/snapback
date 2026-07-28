import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSuite, runAcceptance, writeMachineReport } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import api from '../../snapback/generated/api.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json' with { type: 'json' };
import {
  isPrivateDeviceReachableIpv4,
  webdriverCapabilities,
} from './webdriver-capabilities.mjs';
import { runConjunctiveSubchecks } from './phase4-conjunctive.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const protocol = JSON.parse(readFileSync(join(demoRoot, 'acceptance', 'comparison-protocol.v1.json'), 'utf8'));
const phase4VisualSpec = JSON.parse(readFileSync(join(demoRoot, 'acceptance', 'visual-spec.v1.json'), 'utf8'));
const axeSource = readFileSync(join(repoRoot, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const geckoDriverBin = process.env.GECKODRIVER_BIN || '/opt/homebrew/bin/geckodriver';
const firefoxBin = process.env.FIREFOX_BIN || '/Applications/Firefox.app/Contents/MacOS/firefox';
const safariDriverBin = process.env.SAFARIDRIVER_BIN || '/System/Cryptexes/App/usr/bin/safaridriver';
const serverBin = join(repoRoot, 'target', 'debug', 'snapback');
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const selectedArm = option('arm');
const selectedBackend = option('backend');
const selectedBrowser = option('browser') ?? 'chrome';
const iosSimulatorUdid = option('ios-simulator-udid') ?? process.env.PARTITIME_IOS_SIMULATOR_UDID ?? null;
const iosDeviceUdid = option('ios-device-udid') ?? process.env.PARTITIME_IOS_DEVICE_UDID ?? null;
const isIosSafari = selectedBrowser === 'ios-safari';
const isPhysicalIosSafari = selectedBrowser === 'ios-safari-device';
const isAnyIosSafari = isIosSafari || isPhysicalIosSafari;
const physicalNetworkHost = option('physical-network-host') ?? process.env.PARTITIME_PHYSICAL_NETWORK_HOST ?? null;
const attendedPhysicalIos = isPhysicalIosSafari && process.argv.includes('--attended');
const attendedArtifactDir = option('attended-artifact-dir');
const attendedOperator = option('attended-operator') ?? process.env.PARTITIME_ATTENDED_OPERATOR ?? null;
// @tactical @ref https://github.com/ccheever/exact/blob/83ffa30bc56924252660fcefa7bf7185bf432c11/llp/0373-contract-and-exact-after-partitime.plan.md#12-implementation-record-2026-07-20
// The paired-device lane is only the qualifying text carrier named by the
// Phase-4 disposition. It stays attended, evidence-bound, and narrower than
// the complete iOS engine cell.
const serviceBindHost = isPhysicalIosSafari ? physicalNetworkHost : '127.0.0.1';
const servicePublicHost = isPhysicalIosSafari ? physicalNetworkHost : '127.0.0.1';
const receiptFile = option('receipt');
const productUi = process.argv.includes('--product-ui');
const phase4Only = process.argv.includes('--phase4-only');
const selectedPhase4Claim = option('phase4-claim');
const captureVisualDir = option('capture-visual-dir');
const selectedVisualTheme = option('visual-theme');
const selectedVisualViewport = option('visual-viewport');
const productionWeb = process.argv.includes('--production-web');
const phase4ClaimIds = new Set([
  'STEP4.UI.RESPONSIVE',
  'STEP4.UI.KEYBOARD',
  'STEP4.UI.FOCUS',
  'STEP4.UI.REDUCED-MOTION',
  'STEP4.UI.A11Y',
  'STEP4.UI.VISUAL',
]);
if (!['chrome', 'firefox', 'safari', 'ios-safari', 'ios-safari-device'].includes(selectedBrowser)) {
  throw new Error(`unknown --browser ${selectedBrowser}`);
}
if (isIosSafari && !iosSimulatorUdid) {
  throw new Error('--browser ios-safari requires --ios-simulator-udid or PARTITIME_IOS_SIMULATOR_UDID');
}
if (isPhysicalIosSafari && !iosDeviceUdid) {
  throw new Error('--browser ios-safari-device requires --ios-device-udid or PARTITIME_IOS_DEVICE_UDID');
}
if (isPhysicalIosSafari && !physicalNetworkHost) {
  throw new Error('--browser ios-safari-device requires --physical-network-host or PARTITIME_PHYSICAL_NETWORK_HOST');
}
if (isPhysicalIosSafari && !isPrivateDeviceReachableIpv4(physicalNetworkHost)) {
  throw new Error('--physical-network-host must be a private, link-local, or CGNAT IPv4 address on the paired device network');
}
if (isPhysicalIosSafari && !attendedPhysicalIos) {
  throw new Error('--browser ios-safari-device requires --attended');
}
if (isPhysicalIosSafari && !attendedArtifactDir) {
  throw new Error('--browser ios-safari-device requires --attended-artifact-dir');
}
if (isPhysicalIosSafari && !attendedOperator) {
  throw new Error('--browser ios-safari-device requires --attended-operator or PARTITIME_ATTENDED_OPERATOR');
}
if (
  isPhysicalIosSafari
  && selectedPhase4Claim
  && !['STEP4.UI.KEYBOARD', 'STEP4.UI.REDUCED-MOTION'].includes(selectedPhase4Claim)
) {
  throw new Error('physical iOS Safari is a supplemental text carrier for STEP4.UI.KEYBOARD and STEP4.UI.REDUCED-MOTION only');
}
if (selectedPhase4Claim && !phase4ClaimIds.has(selectedPhase4Claim)) {
  throw new Error(`unknown --phase4-claim ${selectedPhase4Claim}`);
}
if (captureVisualDir && selectedPhase4Claim !== 'STEP4.UI.VISUAL') {
  throw new Error('--capture-visual-dir requires --phase4-claim STEP4.UI.VISUAL');
}
if ((selectedVisualTheme || selectedVisualViewport) && !captureVisualDir) {
  throw new Error('--visual-theme and --visual-viewport require --capture-visual-dir');
}
if (selectedVisualTheme && !phase4VisualSpec.themes.some(({ id }) => id === selectedVisualTheme)) {
  throw new Error(`unknown --visual-theme ${selectedVisualTheme}`);
}
if (selectedVisualViewport && !phase4VisualSpec.viewports.some(({ id }) => id === selectedVisualViewport)) {
  throw new Error(`unknown --visual-viewport ${selectedVisualViewport}`);
}
const arms = productionWeb ? ['contract'] : selectedArm ? [selectedArm] : productUi ? ['react', 'contract'] : ['react', 'contract', 'vanilla'];
const backends = productionWeb ? ['snapback'] : selectedBackend ? [selectedBackend] : productUi ? ['snapback'] : ['snapback', 'supabase', 'convex', 'sqlite'];
const cells = arms.flatMap((arm) => backends.map((backend) => ({ arm, backend })));

const vanillaCells = cells.filter(({ arm }) => arm === 'vanilla');
const snapbackCells = cells.filter(({ backend }) => backend === 'snapback');
const productUiChecks = productUi && !phase4Only
  ? (cells.length * 5) + cells.filter(({ arm, backend }) => arm === 'contract' && backend === 'snapback').length
  : 0;
const phase4ClaimsPerCell = selectedPhase4Claim ? 1 : 6;
const phase4A11yDelta = productUi && !phase4Only && (!selectedPhase4Claim || selectedPhase4Claim === 'STEP4.UI.A11Y') && cells.some(({ arm }) => arm === 'react') && cells.some(({ arm }) => arm === 'contract') ? 1 : 0;
const phase4UiChecks = productUi ? (cells.length * phase4ClaimsPerCell) + phase4A11yDelta : 0;
const expectedChecks = productionWeb
  ? 9
  : phase4Only
    ? phase4UiChecks
    : (cells.length * 3) + vanillaCells.length + snapbackCells.length + productUiChecks + phase4UiChecks;
const suiteTitle = productionWeb
  ? 'partitime / production Contract web'
  : productUi
  ? 'partitime / product UI browser parity'
  : 'partiful matrix / twelve browser cells';
const suite = createSuite(suiteTitle, {
  expectedChecks,
});
const cleanups = [];
const phase4A11y = new Map();
const browserPrerequisites = selectedBrowser === 'chrome'
  ? [{ prerequisite: 'chrome', path: chromeBin }]
  : selectedBrowser === 'firefox'
    ? [{ prerequisite: 'geckodriver', path: geckoDriverBin }, { prerequisite: 'firefox', path: firefoxBin }]
    : [{ prerequisite: 'safaridriver', path: safariDriverBin }];
if (browserPrerequisites.some(({ path }) => !existsSync(path)) || !existsSync(serverBin)) {
  const missing = [
    ...browserPrerequisites.filter(({ path }) => !existsSync(path)),
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
  console.error(`SKIP partiful matrix ${selectedBrowser} — required prerequisites unavailable: ${missing.map(({ prerequisite }) => prerequisite).join(', ')}`);
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
  const child = spawn(serverBin, [
    '--host', serviceBindHost,
    '--port', '0',
    '--memory',
    '--ready-file', readyFile,
    ...(isPhysicalIosSafari ? ['--allow-insecure-dev-auth'] : []),
  ], {
    cwd: repoRoot,
    detached: true,
    env: {
      ...process.env,
      // The physical-device carrier binds plaintext only to the selected
      // private LAN address. Production correctly refuses the dev-auth
      // override, so make this lane's non-production posture explicit.
      ...(isPhysicalIosSafari ? { SNAPBACK_PROFILE: 'test' } : {}),
    },
    stdio: ['ignore','ignore','pipe'],
  });
  cleanups.push(
    () => rmSync(readyDir, { recursive: true, force: true }),
    () => stopChild(child, 'Snapback'),
  );
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (existsSync(readyFile)) {
      const port = JSON.parse(readFileSync(readyFile, 'utf8')).port;
      const localUrl = `http://${serviceBindHost}:${port}`;
      await waitUrl(`${localUrl}/health`, child, 'Snapback');
      return `http://${servicePublicHost}:${port}`;
    }
    if (child.exitCode !== null) throw new Error('Snapback exited before readiness');
    await sleep(100);
  }
  throw new Error('Snapback readiness file timed out');
}

async function startGateway(snapbackUrl) {
  const port = await freePort();
  const child = spawn('bun', ['run', 'server.ts'], {
    cwd: join(demoRoot, 'backends', 'gateway'),
    detached: true,
    env: {
      ...process.env,
      PARTIFUL_MATRIX_GATEWAY_HOST: serviceBindHost,
      PARTIFUL_MATRIX_GATEWAY_PORT: String(port),
      PARTIFUL_MATRIX_SNAPBACK_ORIGIN: snapbackUrl,
    },
    stdio: ['ignore','pipe','pipe'],
  });
  cleanups.push(() => stopChild(child, 'matrix gateway'));
  const localUrl = `http://${serviceBindHost}:${port}`;
  const url = `http://${servicePublicHost}:${port}`;
  await waitUrl(`${localUrl}/health`, child, 'matrix gateway');
  const response = await fetch(`${localUrl}/preflight`, { signal: AbortSignal.timeout(30_000) });
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
    ? ['--bun', vite, '--config', join(surface, 'vite.config.ts'), '--mode', backend, '--host', serviceBindHost, '--port', String(port), '--strictPort']
    : [vite, '--mode', backend, '--host', serviceBindHost, '--port', String(port), '--strictPort'];
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
  const localUrl = `http://${serviceBindHost}:${port}`;
  const url = `http://${servicePublicHost}:${port}`;
  try { await waitUrl(localUrl, child, `${arm}/${backend} Vite`); }
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
  let cdp;
  if (selectedBrowser === 'chrome') {
    const chrome = await launchChromeCdp({ chromeBin, userDataPrefix: 'partiful-matrix-' });
    cleanups.push(() => chrome.stop());
    cdp = await connectCdp(chrome.ws);
  } else {
    cdp = createWebDriverHarness({ browserName: selectedBrowser });
  }
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
      if (phase4Only) {
        await waitForMatrixBoot(page);
        await runPhase4UiClaimChecks({ suite, page, cell, baseUrl: vite.url, cdp });
        continue;
      }
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
        await runPhase4UiClaimChecks({ suite, page, cell, baseUrl: vite.url, cdp });
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
  if (phase4A11yDelta === 1) {
    await suite.check('STEP4.UI.A11Y axe delta keeps Contract at or below the React control', async () => {
      const react = phase4A11y.get('react:snapback');
      const contract = phase4A11y.get('contract:snapback');
      if (!react || !contract) throw new Error(`axe measurements are incomplete: ${JSON.stringify([...phase4A11y])}`);
      const newCriticalSerious = contract.criticalSerious.filter((item) => !react.criticalSerious.some((baseline) => baseline.id === item.id));
      if (newCriticalSerious.length > 0 || contract.criticalSerious.length > react.criticalSerious.length) {
        throw new Error(`Contract adds critical/serious axe violations: ${JSON.stringify({ react, contract, newCriticalSerious })}`);
      }
      return { claimId: 'STEP4.UI.A11Y', oracle: 'react-control-delta', react, contract, newCriticalSerious };
    });
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
      const before = await page.eval(`(()=>{window.__partitimeDocumentIdentity='document_'+performance.timeOrigin.toString(36)+'_'+Date.now().toString(36);return {identity:window.__partitimeDocumentIdentity,navigations:performance.getEntriesByType('navigation').length}})()`);
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

async function waitForMatrixBoot(page, label = 'matrix boot') {
  try {
    return await page.eval(`(async()=>{const d=Date.now()+30000;while(!window.partifulMatrixReady){if(Date.now()>d)throw new Error('boot timeout');await new Promise(r=>setTimeout(r,50));}return await window.partifulMatrixReady;})()`);
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

async function runProductUiChecks({ suite: activeSuite, page, cell }) {
  const label = `${cell.arm} × ${cell.backend}`;
  await activeSuite.check(`${label} traverses browser history without document reload`, async () => {
    const before = await page.eval(`(()=>{window.__partitimeDocumentIdentity??='document_'+performance.timeOrigin.toString(36)+'_'+Date.now().toString(36);return {identity:window.__partitimeDocumentIdentity,url:location.href,navigations:performance.getEntriesByType('navigation').length}})()`);
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
    await page.eval(`document.querySelector('[data-testid="create-event"]')?.focus()`);
    await page.click('create-event');
    await page.pollText('create-panel', 'plan', 5_000);
    await page.eval('new Promise(r=>requestAnimationFrame(r))');
    const semantics = await page.eval(`(()=>{const panel=document.querySelector('[data-testid="create-panel"]');const overlay=document.querySelector('[data-testid="create-overlay"]');const shell=document.querySelector('[data-testid="product-shell"]');const description=document.querySelector('[data-testid="event-description"]');const box=overlay?.getBoundingClientRect();return {role:panel?.getAttribute('role'),modal:panel?.getAttribute('aria-modal'),labelledBy:panel?.getAttribute('aria-labelledby'),describedBy:panel?.getAttribute('aria-describedby'),portal:!!overlay&&(!shell?.contains(overlay)||(getComputedStyle(overlay).position==='fixed'&&box?.width>=innerWidth&&box?.height>=innerHeight)),portalDetached:!!overlay&&!shell?.contains(overlay),overlayPosition:overlay?getComputedStyle(overlay).position:null,descriptionTag:description?.tagName,activeTestId:document.activeElement?.getAttribute('data-testid')}})()`);
    if (semantics.role !== 'dialog' || semantics.modal !== 'true' || !semantics.labelledBy || !semantics.describedBy || !semantics.portal || semantics.descriptionTag !== 'TEXTAREA') {
      throw new Error(`dialog semantics or portal lowering are incomplete: ${JSON.stringify(semantics)}`);
    }
    await page.click('create-event-submit');
    await page.eval('new Promise(r=>setTimeout(r,0))');
    const validation = await page.eval(`(()=>{const title=document.querySelector('[data-testid="event-title"]');const location=document.querySelector('[data-testid="event-location"]');const titleError=document.querySelector('[data-testid="event-title-error"]');const locationError=document.querySelector('[data-testid="event-location-error"]');return {titleInvalid:title?.getAttribute('aria-invalid'),locationInvalid:location?.getAttribute('aria-invalid'),titleDescribedBy:title?.getAttribute('aria-describedby'),locationDescribedBy:location?.getAttribute('aria-describedby'),titleErrorRole:titleError?.getAttribute('role'),locationErrorRole:locationError?.getAttribute('role'),activeTestId:document.activeElement?.getAttribute('data-testid')}})()`);
    if (!validation.titleDescribedBy || !validation.locationDescribedBy || validation.titleErrorRole !== 'alert' || validation.locationErrorRole !== 'alert') {
      throw new Error(`validation errors are not accessibly associated: ${JSON.stringify(validation)}`);
    }
    const trapped = await page.eval(`(()=>{const panel=document.querySelector('[data-testid="create-panel"]');const nodes=[...panel.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled])')];nodes.at(-1)?.focus();return {last:nodes.at(-1)?.getAttribute('data-testid'),count:nodes.length}})()`);
    await page.key('Tab');
    const wrappedTo = await page.eval(`document.activeElement?.getAttribute('data-testid')`);
    if (!wrappedTo || !['create-close', 'create-emoji', 'event-title'].includes(wrappedTo)) {
      throw new Error(`focus trap did not wrap: ${JSON.stringify({ trapped, wrappedTo })}`);
    }
    await page.key('Escape');
    await page.eval('new Promise(r=>setTimeout(r,0))');
    const restored = await page.eval(`({overlay:!!document.querySelector('[data-testid="create-overlay"]'),activeTestId:document.activeElement?.getAttribute('data-testid')})`);
    if (restored.overlay || restored.activeTestId !== 'create-event') {
      throw new Error(`Escape dismissal did not restore opener focus: ${JSON.stringify(restored)}`);
    }
    return { semantics, validation, trapped, wrappedTo, restored };
  });

  await activeSuite.check(`${label} honors reduced-motion preference`, async () => {
    await page.emulateReducedMotion(true);
    await page.click('create-event');
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
    // The preceding responsive assertion intentionally leaves the page at the
    // compact breakpoint. This assertion is about bounded mounting rather than
    // compact layout, so restore the fixture's canonical desktop viewport before
    // navigating. Keeping the two concerns separate also makes the virtual-list
    // witness reproducible across authoring arms.
    await page.setViewport(1280, 900);
    await page.eval(`(()=>{dispatchEvent(new Event('resize'));return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
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

async function runPhase4UiClaimChecks({ suite: activeSuite, page, cell, baseUrl, cdp }) {
  const cellId = `${cell.arm}:${cell.backend}`;
  const label = `${cell.arm} × ${cell.backend}`;

  await phase4Claim(activeSuite, 'STEP4.UI.RESPONSIVE', `${label} matches compact regular and expanded structure`, async () => {
    await loadPhase4Route(page, cell, baseUrl, '/', { user: 'eve' });
    const identity = await page.eval(`(()=>{window.__phase4ResponsiveIdentity='document_'+performance.timeOrigin.toString(36)+'_'+Date.now().toString(36);return window.__phase4ResponsiveIdentity})()`);
    const observations = [];
    const responsiveViewports = isAnyIosSafari
      ? [{ id: 'compact-device', width: null, height: null, columns: 1 }]
      : [
          { id: 'compact', width: 390, height: 844, columns: 1 },
          { id: 'regular', width: 768, height: 1024, columns: 2 },
          { id: 'expanded', width: 1280, height: 800, columns: 3 },
        ];
    for (const viewport of responsiveViewports) {
      if (!isAnyIosSafari) await page.setViewport(viewport.width, viewport.height);
      await page.eval(`(()=>{dispatchEvent(new Event('resize'));return new Promise(r=>setTimeout(r,120))})()`);
      const observed = await page.eval(`(()=>{const cards=[...document.querySelectorAll('[data-testid^="event-card-"]')];const xs=[...new Set(cards.map(node=>Math.round(node.getBoundingClientRect().x)))];return {count:cards.length,columns:xs.length,xs,width:innerWidth,identity:window.__phase4ResponsiveIdentity,path:location.pathname,cardRects:cards.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})}})()`);
      const widthMatches = isAnyIosSafari ? observed.width < 600 : observed.width === viewport.width;
      if (observed.count !== 3 || observed.columns !== viewport.columns || !widthMatches || observed.identity !== identity || observed.path !== '/') {
        throw new Error(`${viewport.id} structure drifted: ${JSON.stringify(observed)}`);
      }
      observations.push({ ...viewport, ...observed });
    }
    return { claimId: 'STEP4.UI.RESPONSIVE', cell: cellId, observations, documentIdentityRetained: true };
  });

  await phase4Claim(activeSuite, 'STEP4.UI.KEYBOARD', `${label} completes the product flow with real key events`, async () => {
    const reusableKeyboardPage = selectedBrowser === 'safari' || isAnyIosSafari ? page : null;
    const subchecks = await runConjunctiveSubchecks('STEP4.UI.KEYBOARD', [
      ['create', () => withPhase4KeyboardPage(cdp, cell, baseUrl, '/', async (taskPage) => {
      await taskPage.focus('create-event');
      await taskPage.key('Enter');
      await taskPage.waitForNavigation();
      if (cell.arm === 'contract') await waitForMatrixBoot(taskPage, 'keyboard create-route boot');
      await taskPage.pollText('create-panel', 'plan', 5_000);
      await tabTo(taskPage, (state) => state.testId === 'event-title');
      await taskPage.insertText('Keyboard Picnic');
      await tabTo(taskPage, (state) => state.testId === 'event-location');
      await taskPage.insertText('Dolores Park');
      await tabTo(taskPage, (state) => state.testId === 'create-event-submit');
      const beforeSubmit = await taskPage.eval(`(()=>({activeTestId:document.activeElement?.getAttribute('data-testid')??null,title:document.querySelector('[data-testid="event-title"]')?.value??null,location:document.querySelector('[data-testid="event-location"]')?.value??null,description:document.querySelector('[data-testid="event-description"]')?.value??null}))()`);
      await taskPage.key('Enter');
      await taskPage.waitForNavigation();
      const outcome = await taskPage.pollText(cell.arm === 'react' ? 'event-page' : 'feed', 'Keyboard Picnic', 8_000);
      if (!outcome?.includes('Keyboard Picnic')) {
        const afterSubmit = await taskPage.eval(`(()=>({activeTestId:document.activeElement?.getAttribute('data-testid')??null,path:location.pathname,summary:document.querySelector('[data-testid="form-error-summary"]')?.textContent?.trim()??null,titleError:document.querySelector('[data-testid="event-title-error"]')?.textContent?.trim()??null,locationError:document.querySelector('[data-testid="event-location-error"]')?.textContent?.trim()??null}))()`);
        throw new Error(`keyboard create flow did not land its outcome: ${JSON.stringify({ beforeSubmit, afterSubmit, outcome })}`);
      }
      return 'Keyboard Picnic';
      }, reusableKeyboardPage)],

      ['menu', () => withPhase4KeyboardPage(cdp, cell, baseUrl, '/', async (taskPage) => {
      await taskPage.focus('open-event_sunset');
      await taskPage.key('Enter');
      await taskPage.waitForNavigation();
      if (cell.arm === 'contract') await waitForMatrixBoot(taskPage, 'keyboard open-event boot');
      await taskPage.pollText('event-page', 'Sunset Supper Club', 15_000);
      await taskPage.focus('event-options-trigger');
      await taskPage.key('Enter');
      await taskPage.pollText('event-options-menu', 'Copy invite link', 5_000);
      if (selectedBrowser === 'safari' || isAnyIosSafari) await sleep(50);
      else await taskPage.eval('new Promise(r=>requestAnimationFrame(r))');
      const first = await taskPage.active();
      await taskPage.key('ArrowDown');
      const second = await taskPage.active();
      if (!first?.insideMenu || !second?.insideMenu || second.testId === first.testId || second.text === first.text) throw new Error(`menu arrow navigation failed: ${JSON.stringify({ first, second })}`);
      await taskPage.key('Escape');
      await assertFocused(taskPage, 'event-options-trigger', 'menu Escape');
      return { first, second };
      }, reusableKeyboardPage)],

      ['rsvp', () => withPhase4KeyboardPage(cdp, cell, baseUrl, '/events/event_sunset/', async (taskPage) => {
      const before = await taskPage.pollText('guest-user_eve', 'Eve', 5_000);
      const target = before?.includes('Going')
        ? { testId: 'rsvp-maybe', label: 'Maybe' }
        : { testId: 'rsvp-going', label: 'Going' };
      await taskPage.focus(target.testId);
      await taskPage.key('Space');
      const outcome = await taskPage.pollText('guest-user_eve', target.label, 5_000);
      if (!outcome?.includes(target.label) || outcome === before) {
        throw new Error(`Space did not activate an RSVP transition: ${JSON.stringify({ before, target, outcome })}`);
      }
      return { before, after: outcome, transition: target.label };
      }, reusableKeyboardPage)],

      ['guest', () => withPhase4KeyboardPage(cdp, cell, baseUrl, '/events/event_sunset/', async (taskPage) => {
      await taskPage.focus('guest-list-trigger');
      await taskPage.key('Enter');
      await taskPage.pollText('guest-list-sheet', 'Guest list', 5_000);
      await tabTo(taskPage, (state) => state.role === 'listbox' || (state.testId?.startsWith('guest-sheet-') && state.role === 'option'));
      const first = await taskPage.active();
      const firstDescendant = await taskPage.eval(`document.activeElement?.getAttribute('aria-activedescendant')??null`);
      await taskPage.key('ArrowDown');
      const second = await taskPage.active();
      const secondDescendant = await taskPage.eval(`document.activeElement?.getAttribute('aria-activedescendant')??null`);
      // Both WAI-ARIA listbox focus strategies are valid here: React keeps
      // DOM focus on the listbox and advances aria-activedescendant, while
      // Contract uses roving focus and enters the first option from the
      // initially focused listbox. A merge had accidentally restored the
      // older mutually-exclusive predicate and rejected that second model.
      const movedByDescendant = firstDescendant
        && secondDescendant
        && firstDescendant !== secondDescendant;
      const movedByOptionFocus = second.role === 'option'
        && second.testId !== first.testId;
      const moved = movedByDescendant || movedByOptionFocus;
      if (!moved) throw new Error(`guest-list arrow navigation failed: ${JSON.stringify({ first, second, firstDescendant, secondDescendant })}`);
      await taskPage.key('Escape');
      await assertFocused(taskPage, 'guest-list-trigger', 'guest sheet Escape');
      return { first, second, firstDescendant, secondDescendant };
      }, reusableKeyboardPage)],

      ['wall', () => withPhase4KeyboardPage(cdp, cell, baseUrl, '/events/event_sunset/', async (taskPage) => {
      await taskPage.focus('wall-message');
      await taskPage.insertText('Keyboard picnic');
      await taskPage.eval(`(()=>{const witness={seen:false,text:null};const inspect=()=>{const node=document.querySelector('[data-testid="wall-pending-status"]');if(node){witness.seen=true;witness.text=node.textContent}};const observer=new MutationObserver(inspect);observer.observe(document.body,{childList:true,subtree:true,characterData:true});inspect();window.__phase4PendingWitness={witness,observer};return true})()`);
      await taskPage.key('Enter');
      const pending = await taskPage.eval(`(async()=>{const d=Date.now()+2000;while(!window.__phase4PendingWitness?.witness.seen&&Date.now()<d)await new Promise(r=>setTimeout(r,20));const result=window.__phase4PendingWitness?.witness??null;window.__phase4PendingWitness?.observer.disconnect();delete window.__phase4PendingWitness;return result})()`);
      const posted = await taskPage.pollText('wall', 'Keyboard picnic', 5_000);
      if (!pending?.seen || !pending.text?.includes('Sending') || !posted?.includes('Keyboard picnic')) throw new Error(`wall submit lacks keyboard-visible pending and settled outcomes: ${JSON.stringify({ pending, posted })}`);
      return { pending, posted: 'Keyboard picnic' };
      }, reusableKeyboardPage)],
    ]);

    return {
      claimId: 'STEP4.UI.KEYBOARD',
      cell: cellId,
      tabTraversalKey: selectedBrowser === 'safari' ? 'Option+Tab (Safari full-control traversal)' : 'Tab',
      ...(isPhysicalIosSafari ? {
        attendedTextEvidence: await page.attendedEvidence(),
        attendedInputPolicy: 'The operator typed every requested value with the physical iPhone soft keyboard; WebDriver never issued an element value command.',
      } : {}),
      ...subchecks,
    };
  });

  await phase4Claim(activeSuite, 'STEP4.UI.FOCUS', `${label} traps and restores every overlay`, async () => {
    const observations = [];
    await loadPhase4Route(page, cell, baseUrl, '/', { user: 'eve' });
    await installFocusTrace(page);
    await page.focus('create-event'); await page.click('create-event');
    if (cell.arm === 'contract') await waitForMatrixBoot(page);
    await page.pollText('create-panel', 'plan', 5_000);
    observations.push({ overlay: 'create', opened: await waitForOverlayFocus(page, 'dialog', 'create') });
    await page.key('Escape'); observations.push({ overlay: 'create', dismissed: await assertFocused(page, 'create-event', 'create Escape') });

    await loadPhase4Route(page, cell, baseUrl, '/events/event_sunset/', { user: 'eve' });
    await page.focus('event-options-trigger'); await page.click('event-options-trigger');
    await page.pollText('event-options-menu', 'Copy invite link', 5_000);
    observations.push({ overlay: 'menu', opened: await waitForOverlayFocus(page, 'menu', 'menu') });
    await page.key('Escape'); observations.push({ overlay: 'menu', dismissed: await assertFocused(page, 'event-options-trigger', 'menu Escape') });

    await page.focus('guest-list-trigger'); await page.click('guest-list-trigger');
    await page.pollText('guest-list-sheet', 'Guest list', 5_000);
    observations.push({ overlay: 'guest-sheet', opened: await waitForOverlayFocus(page, 'dialog', 'guest sheet') });
    await page.click('guest-sheet-close'); observations.push({ overlay: 'guest-sheet', dismissed: await assertFocused(page, 'guest-list-trigger', 'guest explicit close') });
    await page.click('guest-list-trigger'); await page.pollText('guest-list-sheet', 'Guest list', 5_000);
    await page.click('guest-list-sheet-backdrop'); observations.push({ overlay: 'guest-sheet-scrim', dismissed: await assertFocused(page, 'guest-list-trigger', 'guest scrim') });

    await page.focus('rsvp-trigger'); await page.click('rsvp-trigger');
    await page.pollText('rsvp-confirm-dialog', 'Confirm RSVP', 5_000);
    observations.push({ overlay: 'rsvp', opened: await waitForOverlayFocus(page, 'dialog', 'RSVP dialog') });
    await page.click('rsvp-cancel'); observations.push({ overlay: 'rsvp-cancel', dismissed: await assertFocused(page, 'rsvp-trigger', 'RSVP cancel') });
    await page.click('rsvp-trigger'); await page.pollText('rsvp-confirm-dialog', 'Confirm RSVP', 5_000);
    await page.click('rsvp-confirm'); observations.push({ overlay: 'rsvp-confirm', dismissed: await assertFocused(page, 'rsvp-trigger', 'RSVP confirm') });

    await page.click('back');
    if (cell.arm === 'contract') await waitForMatrixBoot(page);
    observations.push({ route: 'event-to-feed', focused: await assertFocused(page, 'create-event', 'route back') });
    if (observations.some((entry) => entry.opened?.tag === 'BODY')) throw new Error(`an overlay opened with focus on body: ${JSON.stringify(observations)}`);
    return { claimId: 'STEP4.UI.FOCUS', cell: cellId, observations };
  });

  await phase4Claim(activeSuite, 'STEP4.UI.REDUCED-MOTION', `${label} preserves non-motion outcomes`, async () => {
    await page.emulateReducedMotion(true);
    try {
      const subchecks = await runConjunctiveSubchecks('STEP4.UI.REDUCED-MOTION', [
        ['overlay', async () => {
          await loadPhase4Route(page, cell, baseUrl, '/events/event_sunset/', { user: 'eve' });
          await page.click('guest-list-trigger'); await page.pollText('guest-list-sheet', 'Guest list', 5_000);
          const overlayMotion = await page.eval(`(()=>{const nodes=['guest-list-sheet','guest-list-sheet-overlay'].map(id=>document.querySelector('[data-testid="'+id+'"]')).filter(Boolean);return {matches:matchMedia('(prefers-reduced-motion: reduce)').matches,nodes:nodes.map(node=>{const s=getComputedStyle(node);return {animationDuration:s.animationDuration,transitionDuration:s.transitionDuration}})}})()`);
          if (!overlayMotion.matches || overlayMotion.nodes.some((entry) => parseFloat(entry.animationDuration) > 0.001 || parseFloat(entry.transitionDuration) > 0.001)) throw new Error(`reduced overlay motion remains: ${JSON.stringify(overlayMotion)}`);
          await page.key('Escape');
          return overlayMotion;
        }],
        ['rsvp', async () => {
          await loadPhase4Route(page, cell, baseUrl, '/events/event_sunset/', { user: 'eve' });
          await page.click('rsvp-trigger'); await page.pollText('rsvp-confirm-dialog', 'Confirm RSVP', 5_000); await page.click('rsvp-confirm');
          const rsvp = await page.pollText('guest-user_eve', 'Going', 5_000);
          if (!rsvp?.includes('Going')) throw new Error(`reduced-motion RSVP end state disappeared: ${JSON.stringify({ rsvp })}`);
          return 'Going';
        }],
        ['wall', async () => {
          await loadPhase4Route(page, cell, baseUrl, '/events/event_sunset/', { user: 'eve' });
          await page.focus('wall-message'); await page.insertText('Reduced motion status'); await page.key('Enter');
          const pending = await page.pollText('wall-pending-status', 'Sending', 1_500);
          if (!pending?.includes('Sending')) throw new Error(`reduced-motion wall end state disappeared: ${JSON.stringify({ pending })}`);
          return 'Sending…';
        }],
      ]);
      return {
        claimId: 'STEP4.UI.REDUCED-MOTION',
        cell: cellId,
        ...subchecks,
        ...(isPhysicalIosSafari ? {
          attendedTextEvidence: await page.attendedEvidence(),
          attendedInputPolicy: 'The operator typed every requested value with the physical iPhone soft keyboard; WebDriver never issued an element value command.',
        } : {}),
      };
    } finally {
      await page.emulateReducedMotion(false);
    }
  });

  await phase4Claim(activeSuite, 'STEP4.UI.A11Y', `${label} satisfies semantic clauses and records axe`, async () => {
    const audits = [];
    for (const scenario of [
      { path: '/', params: { user: 'eve' }, open: null },
      { path: '/events/event_sunset/', params: { user: 'eve' }, open: 'guest-list-trigger' },
      { path: '/events/new/', params: { user: 'eve' }, open: null },
    ]) {
      await loadPhase4Route(page, cell, baseUrl, scenario.path, scenario.params);
      if (scenario.open) { await page.click(scenario.open); await page.pollText('guest-list-sheet', 'Guest list', 5_000); }
      const semantics = await page.eval(`(()=>{const widgets=[...document.querySelectorAll('button,input,textarea,a,[role="menuitem"],[role="option"],[role="listbox"],[role="dialog"]')];const name=node=>node.getAttribute('aria-label')||node.getAttribute('aria-labelledby')?.split(/\\s+/).map(id=>document.getElementById(id)?.textContent??'').join(' ').trim()||[...(node.labels??[])].map(label=>label.textContent??'').join(' ').trim()||node.textContent?.trim()||node.getAttribute('title')||'';const unnamed=widgets.filter(node=>!name(node)).map(node=>({tag:node.tagName,role:node.getAttribute('role'),testId:node.getAttribute('data-testid')}));const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[aria-level]')].map(node=>Number(node.getAttribute('aria-level')||node.tagName.slice(1)));const skipped=headings.some((level,index)=>index>0&&level>headings[index-1]+1);return {main:document.querySelectorAll('main').length,unnamed,headings,skipped,listboxes:document.querySelectorAll('[role="listbox"]').length,dialogs:[...document.querySelectorAll('[role="dialog"]')].map(node=>({modal:node.getAttribute('aria-modal'),name:name(node)})),rsvpStates:[...document.querySelectorAll('[data-testid^="rsvp-"][role="radio"]')].map(node=>({id:node.getAttribute('data-testid'),checked:node.getAttribute('aria-checked')}))}})()`);
      if (semantics.main !== 1 || semantics.unnamed.length > 0 || semantics.skipped || (scenario.path.includes('/events/') && !scenario.path.includes('/new/') && semantics.listboxes < 1) || semantics.dialogs.some((dialog) => !dialog.name || dialog.modal !== 'true')) {
        throw new Error(`semantic S2 clauses failed at ${scenario.path}: ${JSON.stringify(semantics)}`);
      }
      await page.eval(`${axeSource}\n;true`);
      const axe = await page.eval(`axe.run(document,{resultTypes:['violations'],runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}}).then(result=>({violations:result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,help:v.help}))}))`);
      audits.push({ scenario, semantics, axe });
    }
    const criticalSerious = audits.flatMap((audit) => audit.axe.violations).filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
    const measurement = { claimId: 'STEP4.UI.A11Y', cell: cellId, axeVersion: '4.12.1', criticalSerious, totalViolations: audits.reduce((sum, audit) => sum + audit.axe.violations.length, 0), audits };
    phase4A11y.set(cellId, measurement);
    return measurement;
  });

  await phase4Claim(activeSuite, 'STEP4.UI.VISUAL', `${label} implements every representative state`, async () => {
    const states = [];
    const themes = captureVisualDir
      ? phase4VisualSpec.themes.filter(({ id }) => !selectedVisualTheme || id === selectedVisualTheme)
      : [phase4VisualSpec.themes[0]];
    const viewports = isIosSafari
      ? [{ id: 'compact-device', width: null, height: null }]
      : captureVisualDir
        ? phase4VisualSpec.viewports.filter(({ id }) => !selectedVisualViewport || id === selectedVisualViewport)
        : [phase4VisualSpec.viewports.at(-1)];
    for (const theme of themes) for (const viewport of viewports) {
      for (const state of phase4VisualSpec.states) {
        // A capture cell is an independent fixture. Keeping one browser target
        // across all 13 states allowed a slow route provider from an earlier
        // state to strand a later state on its loading shell. Use a fresh
        // target per retained image so one cell cannot contaminate another.
        const visualPage = captureVisualDir ? await cdp.newPage() : page;
        try {
          if (!isIosSafari) await visualPage.setViewport(viewport.width, viewport.height);
          try {
            await prepareVisualState({ page: visualPage, cell, baseUrl, state: state.id, theme: theme.id });
          } catch (error) {
            throw new Error(`${state.id}/${theme.id}/${viewport.id} setup failed: ${error.message}`);
          }
          await waitForFontsAndPaint(visualPage);
          const structural = await visualPage.eval(`(()=>{const ids=${JSON.stringify(state.requires)};return ids.map(id=>{const node=document.querySelector('[data-testid="'+id+'"]');if(!node)return {id,missing:true};const r=node.getBoundingClientRect();const s=getComputedStyle(node);return {id,missing:false,x:r.x,y:r.y,width:r.width,height:r.height,display:s.display,visibility:s.visibility,opacity:Number(s.opacity)}})})()`);
          const invalid = structural.filter((entry) => entry.missing || entry.width <= 0 || entry.height <= 0 || entry.display === 'none' || entry.visibility === 'hidden' || entry.opacity === 0);
          if (invalid.length > 0) {
            const diagnostic = await visualPage.eval(`(()=>({href:location.href,title:document.title,body:document.body?.innerText?.slice(0,500)??null,ready:window.partifulMatrixReady?true:false}))()`);
            throw new Error(`${state.id}/${theme.id}/${viewport.id} violates required visibility: ${JSON.stringify({ invalid, diagnostic })}`);
          }
          const relations = await visualPage.eval(`(()=>{const rect=id=>{const r=document.querySelector('[data-testid="'+id+'"]')?.getBoundingClientRect();return r?{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}:null};const cards=[...document.querySelectorAll('[data-testid^="event-card-"]')].map(node=>{const r=node.getBoundingClientRect();return {id:node.getAttribute('data-testid'),left:r.left,top:r.top,right:r.right,bottom:r.bottom}});const overlaps=[];for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){const a=cards[i],b=cards[j];if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push([a.id,b.id])}const trigger=rect('event-options-trigger'),menu=rect('event-options-menu');const contained=['event-options-menu','guest-list-sheet','rsvp-confirm-dialog'].map(id=>({id,rect:rect(id)})).filter(x=>x.rect).map(x=>({...x,inside:x.rect.left>=0&&x.rect.top>=0&&x.rect.right<=innerWidth&&x.rect.bottom<=innerHeight}));return {viewport:{width:innerWidth,height:innerHeight},cardOverlaps:overlaps,menuAnchor:trigger&&menu?{rightDelta:Math.abs(trigger.right-menu.right),verticalGap:menu.top-trigger.bottom}:null,contained}})()`);
          if (relations.cardOverlaps.length > 0 || relations.contained.some((entry) => !entry.inside) || (state.id === 'options-menu-open' && (!relations.menuAnchor || relations.menuAnchor.rightDelta > 2 || relations.menuAnchor.verticalGap < 0 || relations.menuAnchor.verticalGap > 16))) {
            throw new Error(`${state.id}/${theme.id}/${viewport.id} violates visual relations: ${JSON.stringify(relations)}`);
          }
          let artifact = null;
          if (captureVisualDir) {
            const artifactPath = resolve(repoRoot, captureVisualDir, cell.arm, theme.id, viewport.id, `${state.id}.png`);
            mkdirSync(dirname(artifactPath), { recursive: true });
            const viewportOnly = ['guest-list-sheet-open', 'create-event-form-default', 'create-event-form-validation-error', 'options-menu-open', 'rsvp-confirm-dialog-open'].includes(state.id);
            writeFileSync(artifactPath, Buffer.from(await visualPage.screenshot({ fullPage: !viewportOnly }), 'base64'));
            const image = readFileSync(artifactPath);
            artifact = { path: relative(repoRoot, artifactPath), sha256: createHash('sha256').update(image).digest('hex'), bytes: image.byteLength, approval: 'pending-human-review' };
          }
          states.push({ state: state.id, theme: theme.id, viewport: viewport.id, specVersion: phase4VisualSpec.specVersion, structural, relations, artifact });
        } finally {
          if (visualPage !== page) await visualPage.close();
        }
      }
    }
    return { claimId: 'STEP4.UI.VISUAL', cell: cellId, scope: captureVisualDir ? `${states.length}-cell isolated capture shard with pending human approvals` : '13-state structural preflight; full 156-cell baseline lane remains separately approval-gated', states };
  });
}

async function phase4Claim(activeSuite, claimId, title, check) {
  if (selectedPhase4Claim && selectedPhase4Claim !== claimId) return;
  return activeSuite.check(`${claimId} ${title}`, check);
}

async function withPhase4KeyboardPage(cdp, cell, baseUrl, pathname, run, reusablePage = null) {
  const taskPage = reusablePage ?? await cdp.newPage();
  try {
    if (!isIosSafari) await taskPage.setViewport(1280, 800);
    await loadPhase4Route(taskPage, cell, baseUrl, pathname, { user: 'eve' });
    return await run(taskPage);
  } finally {
    if (!reusablePage) await taskPage.close();
  }
}

async function loadPhase4Route(page, cell, baseUrl, pathname, params = {}) {
  const url = new URL(pathname.replace(/^\//, ''), `${baseUrl}/`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  await page.navigate(url.href);
  await page.waitForNavigation();
  const boot = await waitForMatrixBoot(page);
  if (boot.authoring !== cell.arm || boot.backend !== cell.backend) throw new Error(`wrong phase-4 cell after navigation: ${JSON.stringify(boot)}`);
  // Safari can strand an asynchronous WebDriver callback when navigation
  // retires the script context between animation frames. The boot receipt
  // above already proves the successor document is live; settle its paint
  // from the harness process before querying the route root.
  if (selectedBrowser === 'safari' || isAnyIosSafari) await sleep(100);
  else await page.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const routeRoot = pathname.includes('/events/new/')
    ? 'create-panel'
    : pathname.includes('/events/')
      ? 'event-page'
      : 'feed';
  await waitForTestId(page, routeRoot, `phase-4 route ${pathname}`);
  return boot;
}

async function waitForTestId(page, testId, label, timeoutMs = 5_000) {
  const result = await page.eval(`(async()=>{const d=Date.now()+${timeoutMs};let node=null;while(Date.now()<d){node=document.querySelector('[data-testid=${JSON.stringify(testId)}]');if(node)return {found:true,testId:node.getAttribute('data-testid'),path:location.pathname,readyState:document.readyState};await new Promise(r=>setTimeout(r,50));}return {found:false,testId:${JSON.stringify(testId)},path:location.pathname,readyState:document.readyState,bodyText:document.body?.textContent?.trim().slice(0,500)??null}})()`);
  if (!result?.found) throw new Error(`${label} did not render required target: ${JSON.stringify(result)}`);
  return result;
}

async function waitForFontsAndPaint(page) {
  if (selectedBrowser !== 'safari' && !isAnyIosSafari) {
    await page.eval(`(async()=>{await document.fonts?.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true})()`);
    return;
  }
  const deadline = Date.now() + 5_000;
  let status = null;
  while (Date.now() < deadline) {
    status = await page.eval(`document.fonts?.status??'loaded'`);
    if (status === 'loaded') {
      await sleep(100);
      return;
    }
    await sleep(50);
  }
  throw new Error(`Safari fonts did not settle before visual inspection: ${status}`);
}

async function tabTo(page, predicate, limit = 16) {
  const traversal = [];
  for (let index = 0; index < limit; index += 1) {
    const state = await page.active();
    if (predicate(state)) return state;
    traversal.push(state);
    await page.key('Tab');
  }
  const state = await page.active();
  traversal.push(state);
  throw new Error(`Tab traversal did not reach the requested target: ${JSON.stringify({ state, traversal })}`);
}

async function assertFocused(page, testId, label) {
  const deadline = Date.now() + 5_000;
  let state = null;
  while (Date.now() < deadline) {
    state = await page.active();
    if (state?.testId === testId) return state;
    await sleep(50);
  }
  const trace = await page.eval('globalThis.__partitimeFocusTrace ?? []');
  throw new Error(`${label} did not restore focus to ${testId}: ${JSON.stringify({ state, trace })}`);
}

async function installFocusTrace(page) {
  await page.eval(`(()=>{
    const trace=[];
    globalThis.__partitimeFocusTrace=trace;
    const snapshot=(phase,event)=>({
      phase,
      type:event?.type??null,
      key:event instanceof KeyboardEvent?event.key:null,
      defaultPrevented:event?.defaultPrevented??null,
      target:event?.target instanceof Element?event.target.getAttribute('data-testid'):null,
      active:document.activeElement instanceof Element?document.activeElement.getAttribute('data-testid')??document.activeElement.tagName:null,
      triggerConnected:document.querySelector('[data-testid="create-event"]')?.isConnected??false,
      panelConnected:document.querySelector('[data-testid="create-panel"]')?.isConnected??false
    });
    const record=(phase,event)=>{
      trace.push(snapshot(phase,event));
      if(trace.length>80)trace.shift();
    };
    for(const type of ['focusin','focusout','keydown','keyup']){
      document.addEventListener(type,event=>record('capture',event),true);
      document.addEventListener(type,event=>record('bubble',event));
    }
    new MutationObserver(()=>record('mutation',null)).observe(document.body,{childList:true,subtree:true});
    return true;
  })()`);
}

async function waitForOverlayFocus(page, kind, label) {
  const deadline = Date.now() + 5_000;
  let state = null;
  while (Date.now() < deadline) {
    state = await page.active();
    if ((kind === 'menu' && state?.insideMenu) || (kind === 'dialog' && state?.insideDialog)) return state;
    await sleep(50);
  }
  throw new Error(`${label} did not move focus into its overlay: ${JSON.stringify(state)}`);
}

async function prepareVisualState({ page, cell, baseUrl, state, theme = 'light' }) {
  const params = { user: 'eve', theme: theme === 'dark' ? 'night' : 'warm' };
  const event = () => loadPhase4Route(page, cell, baseUrl, '/events/event_sunset/', params);
  if (state === 'feed-empty') return loadPhase4Route(page, cell, baseUrl, '/', { ...params, uiState: 'feed-empty' });
  if (state === 'feed-loading-skeleton') return loadPhase4Route(page, cell, baseUrl, '/', { ...params, uiState: 'feed-loading' });
  if (state === 'feed-populated') return loadPhase4Route(page, cell, baseUrl, '/', params);
  if (state === 'event-detail-error') return loadPhase4Route(page, cell, baseUrl, '/events/event_sunset/', { ...params, uiState: 'event-error' });
  if (state === 'create-event-form-default') return loadPhase4Route(page, cell, baseUrl, '/events/new/', params);
  if (state === 'create-event-form-validation-error') {
    await loadPhase4Route(page, cell, baseUrl, '/events/new/', params);
    await page.click('create-event-submit');
    return;
  }
  await event();
  if (state === 'event-detail-going') { await page.click('rsvp-going'); await page.pollText('guest-user_eve', 'Going', 5_000); return; }
  if (state === 'event-detail-maybe') { await page.click('rsvp-maybe'); await page.pollText('guest-user_eve', 'Maybe', 5_000); return; }
  if (state === 'guest-list-sheet-open') { await page.click('guest-list-trigger'); await page.pollText('guest-list-sheet', 'Guest list', 5_000); return; }
  if (state === 'wall-composer-active') { await page.focus('wall-message'); return; }
  if (state === 'wall-optimistic-pending') {
    await loadPhase4Route(page, cell, baseUrl, '/events/event_sunset/', { ...params, uiState: 'wall-pending' });
    await page.pollText('wall-pending-status', 'Sending', 5_000);
    return;
  }
  if (state === 'options-menu-open') { await page.click('event-options-trigger'); await page.pollText('event-options-menu', 'Copy invite link', 5_000); return; }
  if (state === 'rsvp-confirm-dialog-open') { await page.click('rsvp-trigger'); await page.pollText('rsvp-confirm-dialog', 'Confirm RSVP', 5_000); }
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
  const simulatorIdentity = () => {
    if (!isIosSafari) return null;
    const accessibility = Object.fromEntries([
      ['fullKeyboardAccessEnabled', 'FullKeyboardAccessEnabled'],
      ['reduceMotionEnabled', 'ReduceMotionEnabled'],
    ].map(([field, preference]) => {
      try {
        const value = execFileSync('xcrun', ['simctl', 'spawn', iosSimulatorUdid, 'defaults', 'read', 'com.apple.Accessibility', preference], { encoding: 'utf8' }).trim();
        return [field, value === '1'];
      } catch {
        return [field, null];
      }
    }));
    try {
      const inventory = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', '--json'], { encoding: 'utf8' }));
      for (const [runtime, devices] of Object.entries(inventory.devices ?? {})) {
        const device = devices.find(({ udid }) => udid.toLowerCase() === iosSimulatorUdid.toLowerCase());
        if (device) return { udid: device.udid, name: device.name, state: device.state, runtime, accessibility };
      }
    } catch { /* receipt records an unresolved explicit identity */ }
    return { udid: iosSimulatorUdid, name: null, state: null, runtime: null, accessibility };
  };
  const physicalDeviceIdentity = () => {
    if (!isPhysicalIosSafari) return null;
    const inventoryDir = mkdtempSync(join(tmpdir(), 'partitime-physical-ios-inventory-'));
    const inventoryPath = join(inventoryDir, 'devices.json');
    try {
      execFileSync('xcrun', [
        'devicectl', 'list', 'devices',
        '--json-output', inventoryPath,
      ], { encoding: 'utf8' });
      const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
      const device = inventory.result?.devices?.find(
        (candidate) => candidate.hardwareProperties?.udid?.toLowerCase() === iosDeviceUdid.toLowerCase(),
      );
      if (!device) {
        return {
          udid: iosDeviceUdid,
          resolved: false,
          reason: 'explicit device was absent from devicectl inventory',
        };
      }
      return {
        udid: device.hardwareProperties?.udid ?? iosDeviceUdid,
        coreDeviceIdentifier: device.identifier ?? null,
        name: device.deviceProperties?.name ?? null,
        marketingName: device.hardwareProperties?.marketingName ?? null,
        hardwareModel: device.hardwareProperties?.hardwareModel ?? null,
        osVersion: device.deviceProperties?.osVersionNumber ?? null,
        osBuild: device.deviceProperties?.osBuildUpdate ?? null,
        developerModeStatus: device.deviceProperties?.developerModeStatus ?? null,
        pairingState: device.connectionProperties?.pairingState ?? null,
        resolved: true,
      };
    } catch (error) {
      return {
        udid: iosDeviceUdid,
        resolved: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      rmSync(inventoryDir, { recursive: true, force: true });
    }
  };
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
  const browserBinary = selectedBrowser === 'chrome' ? chromeBin : selectedBrowser === 'firefox' ? firefoxBin : safariDriverBin;
  let browserVersion = null;
  try { browserVersion = execFileSync(browserBinary, ['--version'], { encoding: 'utf8' }).trim(); } catch { /* receipt records null */ }
  let bunVersion = null;
  try { bunVersion = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim(); } catch { /* receipt records null */ }
  const testPaths = [
    'demos/_kit/harness.mjs',
    'demos/_kit/chrome-process.mjs',
    'demos/_kit/server-process.mjs',
    'demos/partiful-matrix/backends/gateway/server.ts',
    'demos/partiful-matrix/tests/acceptance/browser-matrix.mjs',
    'demos/partiful-matrix/tests/acceptance/phase4-conjunctive.mjs',
    'demos/partiful-matrix/tests/acceptance/step4-ui-claims.mjs',
    'demos/partiful-matrix/tests/acceptance/webdriver-capabilities.mjs',
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
      browser: selectedBrowser,
      browserBinary,
      browserVersion,
      iosSimulator: simulatorIdentity(),
      iosDevice: physicalDeviceIdentity(),
      physicalNetworkHost: isPhysicalIosSafari ? physicalNetworkHost : null,
      attendedOperator: isPhysicalIosSafari ? attendedOperator : null,
      attended: attendedPhysicalIos,
      chrome: selectedBrowser === 'chrome' ? chromeBin : null,
      chromeVersion: selectedBrowser === 'chrome' ? browserVersion : null,
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
    const evalRaw = async (expression) => {
      let result;
      try {
        result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
      } catch (error) {
        throw new Error(`${error.message}; expression=${String(expression).replace(/\s+/g, ' ').slice(0, 180)}`);
      }
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value;
    };
    const selector = (id) => `[data-testid="${id}"]`;
    return {
      navigate: (pageUrl) => send('Page.navigate', { url: pageUrl }, sessionId),
      close: () => send('Target.closeTarget', { targetId }),
      waitForNavigation: () => sleep(300),
      setScriptExecutionDisabled: (value) => send('Emulation.setScriptExecutionDisabled', { value }, sessionId),
      setViewport: (width, height) => send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width < 600,
      }, sessionId),
      screenshot: async ({ fullPage = false } = {}) => {
        const params = { format: 'png', fromSurface: true, captureBeyondViewport: fullPage };
        if (fullPage) {
          const metrics = await send('Page.getLayoutMetrics', {}, sessionId);
          const size = metrics.cssContentSize ?? metrics.contentSize;
          params.clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 };
        }
        return (await send('Page.captureScreenshot', params, sessionId)).data;
      },
      emulateReducedMotion: (enabled) => send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: enabled ? 'reduce' : 'no-preference' }],
      }, sessionId),
      key: async (key) => {
        const keyCodes = { Enter: 13, Space: 32, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35 };
        const virtualKeyCode = keyCodes[key] ?? 0;
        const resolved = key === 'Space' ? { key: ' ', code: 'Space', text: ' ' } : key === 'Enter' ? { key, code: key, text: '\r' } : { key, code: key };
        const codes = virtualKeyCode ? { windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode } : {};
        await send('Input.dispatchKeyEvent', { type: 'keyDown', ...resolved, ...codes }, sessionId);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...resolved, text: undefined, ...codes }, sessionId);
      },
      insertText: (text) => send('Input.insertText', { text }, sessionId),
      eval: evalRaw,
      focus: (id) => evalRaw(`(()=>{const el=document.querySelector('${selector(id)}');if(!(el instanceof HTMLElement))throw new Error('missing focus target ${id}');el.focus();return el===document.activeElement})()`),
      active: () => evalRaw(`(()=>{const el=document.activeElement;return {tag:el?.tagName??null,testId:el?.getAttribute('data-testid')??null,role:el?.getAttribute('role')??null,text:el?.textContent?.trim()??null,insideMenu:!!el?.closest('[role="menu"]'),insideDialog:!!el?.closest('[role="dialog"]')}})()`),
      click: (id) => evalRaw(`(()=>{const el=document.querySelector('${selector(id)}');if(!el)throw new Error('missing ${id}');el.click();return true})()`),
      text: (id) => evalRaw(`document.querySelector('${selector(id)}')?.textContent?.trim()??null`),
      pollText: (id, pattern, timeout) => evalRaw(`(async()=>{const d=Date.now()+${timeout};let v=null;while(Date.now()<d){v=document.querySelector('${selector(id)}')?.textContent?.trim()??null;if(v&&new RegExp(${JSON.stringify(pattern)},'i').test(v))return v;await new Promise(r=>setTimeout(r,100));}return v})()`),
      transportEvidence: () => evalRaw(`(async()=>{const ready=await window.partifulMatrixReady;return ready.transportEvidence?.()??ready.provider?.transportEvidence?.()??[];})()`),
    };
  } };
}

function createWebDriverHarness({ browserName }) {
  const pages = new Set();
  let closing = false;
  return {
    async newPage() {
      if (closing) throw new Error(`${browserName} WebDriver harness is closing`);
      const driver = await launchWebDriverServer(browserName);
      let sessionId = null;
      try {
        const capabilities = webdriverCapabilities({
          browserName,
          phase4Claim: selectedPhase4Claim,
          iosSimulatorUdid,
          iosDeviceUdid,
        });
        const created = await webdriverRequest(driver.url, '/session', {
          method: 'POST',
          body: { capabilities: { alwaysMatch: capabilities } },
          timeoutMs: 45_000,
        });
        sessionId = created.sessionId;
        if (!sessionId) throw new Error(`${browserName} WebDriver omitted sessionId`);
        if (isPhysicalIosSafari) {
          reportIdentity.environment.webdriverSessionCapabilities = created.capabilities ?? null;
        }
        const base = `/session/${sessionId}`;
        const bidi = typeof created.capabilities?.webSocketUrl === 'string'
          ? await connectBidi(created.capabilities.webSocketUrl)
          : null;
        const bidiTree = bidi ? await bidi.send('browsingContext.getTree', { maxDepth: 0 }) : null;
        const bidiContext = bidiTree?.contexts?.[0]?.context ?? null;
        await webdriverRequest(driver.url, `${base}/timeouts`, {
          method: 'POST',
          body: { script: 30_000, pageLoad: 30_000, implicit: 0 },
        });
        let closed = false;
        const attendedEvidence = [];
        const retainAttendedTextEvidence = async ({ testId, expectedValue }) => {
          const screenshotBase64 = await webdriverRequest(
            driver.url,
            `${base}/screenshot`,
            { method: 'GET' },
          );
          const screenshotBytes = Buffer.from(screenshotBase64, 'base64');
          const sequence = String(attendedEvidence.length + 1).padStart(2, '0');
          const safeTestId = testId.replace(/[^a-zA-Z0-9_-]/g, '-');
          const screenshotPath = resolve(
            attendedArtifactDir,
            `${sequence}-${safeTestId}.png`,
          );
          mkdirSync(dirname(screenshotPath), { recursive: true });
          writeFileSync(screenshotPath, screenshotBytes);
          const observation = await evalRaw(`(()=>{const el=document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)});return {testId:${JSON.stringify(testId)},value:el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?el.value:null,path:location.pathname,url:location.href,activeTestId:document.activeElement?.getAttribute('data-testid')??null}})()`);
          const entry = {
            sequence: Number(sequence),
            operator: attendedOperator,
            inputSource: 'operator-physical-soft-keyboard',
            webdriverValueCommandUsed: false,
            expectedValue,
            observation,
            screenshot: {
              path: relative(repoRoot, screenshotPath),
              sha256: createHash('sha256').update(screenshotBytes).digest('hex'),
              bytes: screenshotBytes.length,
            },
            observedAt: new Date().toISOString(),
          };
          attendedEvidence.push(entry);
          return entry;
        };
        const evalRaw = async (expression) => {
          let envelope;
          try {
            envelope = await webdriverRequest(driver.url, `${base}/execute/async`, {
              method: 'POST',
              body: {
                script: `const expression=arguments[0],done=arguments[arguments.length-1];Promise.resolve().then(()=>eval(expression)).then(value=>done({ok:true,value}),error=>done({ok:false,error:{message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:null}}));`,
                args: [expression],
              },
              timeoutMs: 35_000,
            });
          } catch (error) {
            const command = expression.replace(/\s+/g, ' ').slice(0, 180);
            throw new Error(`${browserName} script command failed (${command}): ${error.message}`);
          }
          if (!envelope?.ok) throw new Error(`${browserName} script failed: ${envelope?.error?.message ?? 'unknown error'}${envelope?.error?.stack ? `\n${envelope.error.stack}` : ''}`);
          return envelope.value;
        };
        const selector = (id) => `[data-testid="${id}"]`;
        const close = async () => {
          if (closed) return;
          closed = true;
          pages.delete(page);
          let firstError = null;
          try { bidi?.close(); }
          catch (error) { firstError = error; }
          try { await webdriverRequest(driver.url, base, { method: 'DELETE', timeoutMs: 10_000 }); }
          catch (error) { firstError = error; }
          try { await driver.stop(); }
          catch (error) { firstError ??= error; }
          if (firstError) throw firstError;
        };
        const page = {
          navigate: (pageUrl) => webdriverRequest(driver.url, `${base}/url`, { method: 'POST', body: { url: pageUrl }, timeoutMs: 35_000 }),
          close,
          // Safari can retire the current script context after a keyboard-
          // activated link or form submission. Match the CDP settle window so
          // the next async-script command attaches to the successor document.
          waitForNavigation: () => sleep(300),
          setScriptExecutionDisabled: async (value) => {
            if (value) throw new Error(`${browserName} WebDriver does not expose script-disable emulation`);
          },
          setViewport: (width, height) => isAnyIosSafari
            ? evalRaw(`({requested:{width:${width},height:${height}},actual:{width:innerWidth,height:innerHeight},fixedDeviceViewport:true})`)
            : bidi && bidiContext
              ? bidi.send('browsingContext.setViewport', { context: bidiContext, viewport: { width, height }, devicePixelRatio: 1 })
              : webdriverRequest(driver.url, `${base}/window/rect`, { method: 'POST', body: { width, height } }),
          screenshot: async () => webdriverRequest(driver.url, `${base}/screenshot`, { method: 'GET' }),
          emulateReducedMotion: async (enabled) => {
            if (!enabled) return;
            if (isPhysicalIosSafari) {
              console.log('\n[ATTENDED iOS] Enable Settings → Accessibility → Motion → Reduce Motion on the physical iPhone. The run will continue when Safari reports the preference.\n');
            }
            const matches = isPhysicalIosSafari
              ? await evalRaw(`(async()=>{const deadline=Date.now()+300000;while(Date.now()<deadline){if(matchMedia('(prefers-reduced-motion: reduce)').matches)return true;await new Promise(resolve=>setTimeout(resolve,250));}return false})()`)
              : await evalRaw(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
            if (!matches) throw new Error(`${browserName} WebDriver session cannot witness prefers-reduced-motion`);
          },
          key: async (key) => {
            const keys = { Enter: '\uE007', Space: ' ', Tab: '\uE004', Escape: '\uE00C', ArrowLeft: '\uE012', ArrowUp: '\uE013', ArrowRight: '\uE014', ArrowDown: '\uE015', Home: '\uE011', End: '\uE010' };
            const value = keys[key] ?? key;
            const actions = browserName === 'safari' && key === 'Tab'
              // macOS Safari uses Option+Tab for full-control traversal when
              // its user preference leaves plain Tab scoped to text fields.
              ? [
                  { type: 'keyDown', value: '\uE00A' },
                  { type: 'keyDown', value },
                  { type: 'keyUp', value },
                  { type: 'keyUp', value: '\uE00A' },
                ]
              : [{ type: 'keyDown', value }, { type: 'keyUp', value }];
            await webdriverRequest(driver.url, `${base}/actions`, {
              method: 'POST',
              body: { actions: [{ type: 'key', id: 'keyboard', actions }] },
            });
          },
          insertText: async (text) => {
            if (isPhysicalIosSafari) {
              const target = await evalRaw(`(()=>{const el=document.activeElement;return {testId:el?.getAttribute('data-testid')??null,value:el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?el.value:null}})()`);
              if (!target?.testId) {
                throw new Error('physical iOS attended text target has no data-testid');
              }
              console.log(`\n[ATTENDED iOS] On the iPhone, tap ${target.testId} if needed and TYPE exactly: ${JSON.stringify(text)}. Do not paste or press Return; the carrier will advance automatically.\n`);
              const observed = await evalRaw(`(async()=>{const deadline=Date.now()+300000;const selector=${JSON.stringify(`[data-testid="${target.testId}"]`)};while(Date.now()<deadline){const el=document.querySelector(selector);if((el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement)&&el.value===${JSON.stringify(text)})return {testId:${JSON.stringify(target.testId)},value:el.value};await new Promise(resolve=>setTimeout(resolve,250));}const el=document.querySelector(selector);return {testId:${JSON.stringify(target.testId)},value:el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?el.value:null,timeout:true}})()`);
              if (observed?.value !== text || observed.timeout) {
                throw new Error(`physical iOS operator text observation timed out: ${JSON.stringify({ expected: text, observed })}`);
              }
              await retainAttendedTextEvidence({
                testId: target.testId,
                expectedValue: text,
              });
              return;
            }
            const active = await webdriverRequest(driver.url, `${base}/element/active`, { method: 'GET' });
            const elementId = active?.['element-6066-11e4-a52e-4f735466cecf'];
            if (!elementId) throw new Error(`${browserName} WebDriver omitted active element id`);
            await webdriverRequest(driver.url, `${base}/element/${encodeURIComponent(elementId)}/value`, {
              method: 'POST',
              body: { text, value: [...text] },
            });
          },
          eval: evalRaw,
          focus: (id) => evalRaw(`(()=>{const el=document.querySelector('${selector(id)}');if(!(el instanceof HTMLElement))throw new Error('missing focus target ${id}');el.focus();return el===document.activeElement})()`),
          active: () => evalRaw(`(()=>{const el=document.activeElement;return {tag:el?.tagName??null,testId:el?.getAttribute('data-testid')??null,role:el?.getAttribute('role')??null,text:el?.textContent?.trim()??null,insideMenu:!!el?.closest('[role="menu"]'),insideDialog:!!el?.closest('[role="dialog"]')}})()`),
          click: (id) => evalRaw(`(()=>{const el=document.querySelector('${selector(id)}');if(!el)throw new Error('missing ${id}');el.click();return true})()`),
          text: (id) => evalRaw(`document.querySelector('${selector(id)}')?.textContent?.trim()??null`),
          pollText: (id, pattern, timeout) => evalRaw(`(async()=>{const d=Date.now()+${timeout};let v=null;while(Date.now()<d){v=document.querySelector('${selector(id)}')?.textContent?.trim()??null;if(v&&new RegExp(${JSON.stringify(pattern)},'i').test(v))return v;await new Promise(r=>setTimeout(r,100));}return v})()`),
          transportEvidence: () => evalRaw(`(async()=>{const ready=await window.partifulMatrixReady;return ready.transportEvidence?.()??ready.provider?.transportEvidence?.()??[];})()`),
          attendedEvidence: async () => attendedEvidence.map((entry) => structuredClone(entry)),
        };
        pages.add(page);
        return page;
      } catch (error) {
        try {
          if (sessionId) await webdriverRequest(driver.url, `/session/${sessionId}`, { method: 'DELETE', timeoutMs: 5_000 });
        } catch { /* retain primary failure */ }
        try { await driver.stop(); } catch { /* retain primary failure */ }
        throw new Error(`${error.message}${driver.log() ? `\n${driver.log().slice(-4_000)}` : ''}`);
      }
    },
    async close() {
      closing = true;
      const failures = [];
      for (const page of [...pages]) {
        try { await page.close(); } catch (error) { failures.push(error); }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, `${browserName} WebDriver cleanup failed`);
    },
  };
}

async function launchWebDriverServer(browserName) {
  const port = await freePort();
  const binary = browserName === 'firefox' ? geckoDriverBin : safariDriverBin;
  const args = browserName === 'firefox' ? ['--host', '127.0.0.1', '--port', String(port)] : ['-p', String(port)];
  let log = '';
  const child = spawn(binary, args, { cwd: repoRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { log = `${log}${chunk}`.slice(-16_000); });
  child.stderr.on('data', (chunk) => { log = `${log}${chunk}`.slice(-16_000); });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitUrl(`${url}/status`, child, `${browserName} WebDriver`, 15_000);
  } catch (error) {
    try { await stopChild(child, `${browserName} WebDriver startup`); } catch { /* retain primary */ }
    throw new Error(`${error.message}${log ? `\n${log}` : ''}`);
  }
  return { url, log: () => log, stop: () => stopChild(child, `${browserName} WebDriver`) };
}

async function webdriverRequest(origin, path, { method = 'GET', body = null, timeoutMs = 30_000 } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    ...(body === null ? {} : { headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  const value = payload?.value;
  if (!response.ok) {
    const error = typeof value?.error === 'string' ? value.error : value?.error ? JSON.stringify(value.error) : String(response.status);
    const message = typeof value?.message === 'string' ? value.message : value?.message ? JSON.stringify(value.message) : 'no diagnostic';
    throw new Error(`WebDriver ${method} ${path} failed: ${error} — ${message}`);
  }
  return value;
}

async function connectBidi(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const request = pending.get(id);
    if (request) clearTimeout(request.timer);
    pending.delete(id);
    return request;
  };
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (!message.id || !pending.has(message.id)) return;
    const request = settle(message.id);
    if (message.type === 'error') request.reject(new Error(`WebDriver BiDi ${request.method} failed: ${message.error} — ${message.message}`));
    else request.resolve(message.result ?? {});
  });
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('WebDriver BiDi connection failed')), { once: true });
  });
  return {
    send(method, params = {}) {
      return new Promise((resolveSend, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          settle(id);
          reject(new Error(`WebDriver BiDi timeout: ${method}`));
        }, 30_000);
        pending.set(id, { method, resolve: resolveSend, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { settle(id); reject(error); }
      });
    },
    close() { socket.close(); },
  };
}

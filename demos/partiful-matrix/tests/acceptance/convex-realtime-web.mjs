#!/usr/bin/env node
// React/Contract × convex-realtime: idiomatic browser-direct Convex cells.
//
// @ref LLP 0063#next-application-pressure-tests — the React follow-up row
// must use each provider's native client without the comparison gateway. This
// witness runs ConvexClient over its WebSocket with no polling path and proves
// an out-of-band mutation reaches the rendered product through that stream.

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { convexDeploymentUrl, createConvexAdapter } from '../../backends/gateway/convex.ts';
import { loadLocalSecrets, requireSecret } from '../../backends/gateway/secrets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const receiptFile = option('receipt');
const authoring = option('authoring') ?? 'react';
if (!['react', 'contract'].includes(authoring)) throw new Error(`unsupported --authoring ${authoring}`);
const surface = join(demoRoot, 'surfaces', authoring);
const gitDirtyAtStart = gitDirty();

const CHECKS = [
  'Convex deployment serves the canonical fixture and an isolated acceptance event',
  `${authoring} × convex-realtime boots browser-direct with push transport`,
  'opens details and performs an in-cell RSVP round trip',
  'observes out-of-band writes through Convex WebSocket push with no poll path',
  'Convex mutation authority refuses to displace the host',
  `normal ${authoring} teardown closes subscriptions and the Convex client`,
];
const suite = createSuite(`partiful matrix / ${authoring} × convex-realtime follow-up cell`, { expectedChecks: CHECKS.length });
const cleanups = [];

let deploymentUrl = null;
try {
  const secrets = loadLocalSecrets();
  const rawUrl = process.env.CONVEX_URL ?? requireSecret(secrets, 'CONVEX_URL', 'CONVEX_DEPLOY_KEY');
  deploymentUrl = convexDeploymentUrl(rawUrl);
} catch { /* remote-dependency skip below */ }

const remote = deploymentUrl ? createConvexAdapter(deploymentUrl) : null;
const probe = remote ? await probeDeployment(remote) : null;
const chromeAvailable = existsSync(chromeBin);
const convexPackage = readJsonIfPresent(join(surface, 'node_modules', 'convex', 'package.json'));

const reportIdentity = {
  demo: 'partiful-matrix',
  claimSetVersion: 'partitime.web.followup.v1',
  cell: `${authoring}:convex-realtime`,
  revision: gitRevision(),
  gitDirtyAtStart,
  sourceInputs: [
    ...(authoring === 'react' ? [
      'demos/partiful-matrix/surfaces/react/src/convex-direct.ts',
      'demos/partiful-matrix/surfaces/react/src/provider.ts',
      'demos/partiful-matrix/surfaces/react/src/main.tsx',
      'demos/partiful-matrix/surfaces/react/vite.config.mts',
      'demos/partiful-matrix/surfaces/react/bun.lock',
    ] : [
      'demos/partiful-matrix/surfaces/contract/convex-provider.ts',
      'demos/partiful-matrix/surfaces/contract/data/provider.generated.ts',
      'demos/partiful-matrix/surfaces/contract/data/provider.generated.contract-meta.ts',
      'demos/partiful-matrix/surfaces/contract/data/generated/generation.receipt.json',
      'demos/partiful-matrix/surfaces/contract/feed.contract',
      'demos/partiful-matrix/surfaces/contract/event.contract',
      'demos/partiful-matrix/surfaces/contract/main.ts',
      'demos/partiful-matrix/surfaces/contract/vite.config.ts',
      'demos/partiful-matrix/surfaces/contract/bun.lock',
    ]),
    'demos/partiful-matrix/backends/convex/convex/_generated/api.js',
    'demos/partiful-matrix/tests/acceptance/convex-realtime-web.mjs',
    ...(authoring === 'contract'
      ? ['demos/partiful-matrix/tests/acceptance/contract-convex-realtime-web.mjs']
      : []),
  ].map(fileIdentity),
  environment: {
    node: process.version,
    bun: toolVersion('bun', ['--version']),
    chromeVersion: toolVersion(chromeBin, ['--version']),
    convexClientVersion: convexPackage?.version ?? null,
  },
  deploymentOrigin: deploymentUrl ? new URL(deploymentUrl).origin : null,
  deploymentProbe: probe,
};

if (!probe?.ok || !chromeAvailable) {
  const details = probe?.ok
    ? { skipClass: 'required-prerequisite-missing', prerequisite: 'chrome', path: chromeBin }
    : { skipClass: 'remote-dependency', backend: 'convex-realtime', probe };
  for (const name of CHECKS) suite.skip(name, details);
  await runAcceptance(suite, async () => {}, { cleanups, reportFile: receiptFile, reportExtra: reportIdentity });
  process.exit(probe?.ok ? 1 : 0);
}

cleanups.push(() => remote.close());

await runAcceptance(suite, async () => {
  const acceptanceTitle = `[acceptance] convex direct ${randomUUID()}`;
  const acceptanceEventId = await remote.mutate('createEvent', {
    title: acceptanceTitle,
    emoji: '🧪',
    description: 'isolated browser-direct Convex acceptance event',
    location: 'Convex realtime test lab',
    startsAt: 1787000000000,
    hostName: 'Matrix Bot',
    accent: 'cobalt',
  }, 'user_matrix_acceptance');
  reportIdentity.acceptanceFixture = { eventId: acceptanceEventId, title: acceptanceTitle };
  cleanups.push(async function cleanupAcceptanceEvent() {
    const cleaned = await remote.cleanupAcceptanceEvent(acceptanceEventId);
    if (!cleaned) throw new Error(`Convex refused to clean acceptance event ${acceptanceEventId}`);
  });

  await suite.check(CHECKS[0], async () => {
    const events = await remote.query('listEvents', {});
    const isolated = Array.isArray(events)
      && events.some((event) => event?._id === acceptanceEventId && event?.title === acceptanceTitle);
    if (!isolated) throw new Error('isolated Convex acceptance event is missing after creation');
    return { ...probe, acceptanceEventId, isolatedFixture: true };
  });

  const vitePort = await freePort();
  let viteLog = '';
  const viteBin = join(surface, 'node_modules', '.bin', 'vite');
  const viteArgs = [
    ...(authoring === 'contract' ? ['--bun', viteBin, '--config', 'vite.config.ts'] : []),
    '--mode', 'convex-realtime', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
  ];
  const vite = spawn(authoring === 'contract' ? 'bun' : viteBin, viteArgs, {
    cwd: surface,
    detached: true,
    env: { ...process.env, CONVEX_URL: deploymentUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  vite.stdout.on('data', (chunk) => { viteLog += chunk; });
  vite.stderr.on('data', (chunk) => { viteLog += chunk; });
  cleanups.push(() => stopChild(vite, 'convex-realtime Vite'));
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(viteUrl, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* retry */ }
    if (vite.exitCode !== null) throw new Error(`Vite exited: ${viteLog.slice(-2000)}`);
    if (Date.now() > deadline) throw new Error(`Vite not ready: ${viteLog.slice(-2000)}`);
    await sleep(200);
  }

  const chrome = await launchChromeCdp({
    chromeBin,
    userDataPrefix: 'partiful-convex-rt-',
    stopOptions: { graceMs: 10_000 },
  });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.closeBrowser());
  const page = await cdp.newPage();
  // The WebSocket is intentionally long-lived. Navigate away before process
  // cleanup so the client can close without weakening the cleanup attestation.
  cleanups.push(() => page.navigate('about:blank').then(() => sleep(500)).catch(() => {}));

  await suite.check(CHECKS[1], async () => {
    await page.navigate(`${viteUrl}/?user=eve`);
    const boot = await page.eval(`(async()=>{const d=Date.now()+15000;while(!window.partifulMatrixReady){if(Date.now()>d)return {bootError:'global timeout',status:document.querySelector('#boot-status')?.textContent};await new Promise(r=>setTimeout(r,50));}return await Promise.race([window.partifulMatrixReady.then(ready=>({backend:ready.backend,authoring:ready.authoring,transport:ready.provider?.transport??ready.transport})).catch(error=>({bootError:String(error),stack:error?.stack,status:document.querySelector('#boot-status')?.textContent})),new Promise(resolve=>setTimeout(()=>resolve({bootError:'ready timeout',status:document.querySelector('#boot-status')?.textContent}),15000))]);})()`);
    if (boot.bootError) throw new Error(`cell boot failed: ${JSON.stringify(boot)}\nVite log:\n${viteLog.slice(-4000)}`);
    if (boot.backend !== 'convex-realtime' || boot.authoring !== authoring || boot.transport !== 'push') {
      throw new Error(`wrong cell identity: ${JSON.stringify(boot)}`);
    }
    const card = await page.pollText(`event-card-${acceptanceEventId}`, acceptanceTitle, 15_000);
    if (!card?.includes(acceptanceTitle)) throw new Error(`acceptance event missing: ${card}`);
    const evidence = await page.transportEvidence();
    const snapshot = evidence.some((event) => event.queryName === 'listEvents' && event.event === 'snapshot' && event.client === 'convex/browser');
    const connected = evidence.some((event) => event.queryName === 'listEvents' && event.event === 'connection' && event.socketConnected === true && event.connectionCount >= 1);
    if (!snapshot || !connected) {
      throw new Error(`listEvents lacks measured ConvexClient snapshot/connection evidence: ${JSON.stringify(evidence)}`);
    }
    return { ...boot, client: 'convex/browser', pollPath: 'absent', socketConnected: true };
  });

  await suite.check(CHECKS[2], async () => {
    await page.click(`open-${acceptanceEventId}`);
    const event = await page.pollText('event-page', acceptanceTitle, 15_000);
    if (!event?.includes(acceptanceTitle)) throw new Error(`event detail missing: ${event}`);
    const host = await page.pollText('guest-user_matrix_acceptance', 'Matrix Bot', 15_000);
    if (!host?.includes('Hosting')) throw new Error(`isolated host row is missing: ${host}`);
    await page.click('rsvp-going');
    const after = await page.pollText('guest-user_eve', 'Going', 15_000);
    if (!after?.includes('Going')) throw new Error(`RSVP did not settle: ${after}`);
    return { before: 'no Eve RSVP row', after, host: 'preserved' };
  });

  await suite.check(CHECKS[3], async () => {
    let before = await page.pollText('guest-user_eve', 'Eve', 15_000);
    const observations = [];
    for (let sampleIndex = 0; sampleIndex < 6; sampleIndex += 1) {
      const next = before?.includes('Going') ? { status: 'maybe', label: 'Maybe' } : { status: 'going', label: 'Going' };
      const evidenceBefore = await page.transportEvidence();
      const deliveryCountBefore = guestListUpdates(evidenceBefore);
      const startedAtMs = Date.now();
      await remote.mutate('rsvp', {
        eventId: acceptanceEventId,
        guestName: 'Eve',
        status: next.status,
      }, 'user_eve');
      const after = await page.pollText('guest-user_eve', next.label, 5_000);
      const latencyMs = Date.now() - startedAtMs;
      if (!after?.includes(next.label) || after === before) {
        throw new Error(`out-of-band RSVP did not arrive via push: ${JSON.stringify({ sampleIndex, before, after })}`);
      }
      const evidenceAfter = await page.transportEvidence();
      const deliveryCountAfter = guestListUpdates(evidenceAfter);
      if (deliveryCountAfter <= deliveryCountBefore) {
        throw new Error(`render changed without a new guestList Convex delivery: ${JSON.stringify({ sampleIndex, deliveryCountBefore, deliveryCountAfter })}`);
      }
      observations.push({ sampleIndex, latencyMs, deliveryCountBefore, deliveryCountAfter });
      before = after;
    }

    const evidence = await page.transportEvidence();
    const snapshots = evidence.filter((event) => event.event === 'snapshot' && event.transport === 'push');
    const connectedUpdates = evidence.filter((event) => event.event === 'update' && event.transport === 'push' && event.socketConnected === true && event.connectionCount >= 1);
    if (!snapshots.some((event) => event.queryName === 'guestList' && event.client === 'convex/browser')) {
      throw new Error(`guestList lacks ConvexClient stream provenance: ${JSON.stringify(evidence)}`);
    }
    if (!connectedUpdates.some((event) => event.queryName === 'guestList')) {
      throw new Error(`guestList lacks an update measured on a connected WebSocket: ${JSON.stringify(evidence)}`);
    }
    if (evidence.some((event) => event.transport === 'poll' || event.event === 'fallback')) {
      throw new Error(`a poll path appeared in the direct Convex witness: ${JSON.stringify(evidence)}`);
    }
    if (evidence.some((event) => event.pollFallbackEnabled !== false)) {
      throw new Error(`surface receipt does not prove poll fallback is absent: ${JSON.stringify(evidence)}`);
    }
    const samples = observations.slice(1).map(({ latencyMs }) => latencyMs);
    const ordered = [...samples].sort((left, right) => left - right);
    return {
      mutationOrigin: 'out-of-band Convex HTTP mutation client',
      observedTransport: 'convex/browser WebSocket',
      pollPath: 'absent',
      warmupCount: 1,
      sampleCount: samples.length,
      observations,
      freshnessLatencyMs: {
        samples,
        median: ordered[Math.floor(ordered.length / 2)],
        p95: ordered[Math.ceil(ordered.length * 0.95) - 1],
      },
      snapshotQueries: snapshots.map((event) => event.queryName),
      guestListConnectedPushUpdates: guestListUpdates(evidence),
    };
  });

  await suite.check(CHECKS[4], async () => {
    let refusal = null;
    try {
      await remote.mutate('rsvp', {
        eventId: acceptanceEventId,
        guestName: 'Ada',
        status: 'going',
      }, 'user_matrix_acceptance');
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }
    if (!refusal?.includes('host is already going')) {
      throw new Error(`expected the Convex mutation to reject host displacement, got: ${refusal}`);
    }
    return { refusal: 'server mutation invariant', message: refusal };
  });

  await suite.check(CHECKS[5], async () => {
    await page.eval(`(async()=>{const ready=await window.partifulMatrixReady;await ready.dispose();return true})()`);
    const evidence = await page.pollTransportEvent('provider-closed', 10_000);
    const disposedQueries = evidence.filter((event) => event.event === 'disposed').map((event) => event.queryName);
    if (!evidence.some((event) => event.event === 'provider-closed')) {
      throw new Error(`Convex provider did not close: ${JSON.stringify(evidence)}`);
    }
    if (disposedQueries.length === 0) {
      throw new Error(`React root teardown did not dispose query scopes: ${JSON.stringify(evidence)}`);
    }
    return { providerClosed: true, disposedQueries };
  });
}, {
  cleanups,
  reportFile: receiptFile,
  reportExtra: reportIdentity,
});

function guestListUpdates(evidence) {
  return evidence.filter((event) => event.queryName === 'guestList'
    && event.event === 'update'
    && event.transport === 'push'
    && event.socketConnected === true
    && event.connectionCount >= 1).length;
}

async function probeDeployment(adapter) {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const events = await adapter.query('listEvents', {});
      const canonical = Array.isArray(events) && events.some((event) => event?._id === 'event_sunset' && event?.title === 'Sunset Supper Club');
      attempts.push({ attempt, ok: canonical, rowCount: Array.isArray(events) ? events.length : null });
      return { ok: canonical, query: 'events:listEvents', rowCount: Array.isArray(events) ? events.length : null, canonicalFixture: canonical, attempts };
    } catch (error) {
      attempts.push({ attempt, ok: false, error: error instanceof Error ? error.message : String(error) });
      if (attempt < 3) await sleep(250 * attempt);
    }
  }
  return { ok: false, query: 'events:listEvents', error: attempts.at(-1)?.error ?? 'unknown probe failure', attempts };
}

function readJsonIfPresent(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
function gitRevision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(); } catch { return null; }
}
function gitDirty() {
  try {
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repoRoot, encoding: 'utf8' }).trim() !== '';
  } catch {
    return null;
  }
}
function fileIdentity(path) {
  const bytes = readFileSync(join(repoRoot, path));
  return { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}
function toolVersion(bin, args) {
  try { return execFileSync(bin, args, { encoding: 'utf8' }).trim(); } catch { return null; }
}

async function stopChild(child, label) {
  if (child.exitCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
  if (await Promise.race([closed.then(() => 'closed'), sleep(5_000).then(() => 'timeout')]) === 'closed') return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
  if (await Promise.race([closed.then(() => 'closed'), sleep(5_000).then(() => 'timeout')]) !== 'closed') {
    throw new Error(`${label} did not exit after SIGKILL`);
  }
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  const settle = (id) => {
    const value = pending.get(id);
    if (value) clearTimeout(value.timer);
    pending.delete(id);
    return value;
  };
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    if (message.id && pending.has(message.id)) {
      const request = settle(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result || {});
    }
  });
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP failed')), { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId += 1;
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolveSend, reject) => {
      const timer = setTimeout(() => { settle(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
      pending.set(id, { resolve: resolveSend, reject, timer });
    });
  };
  return {
    close: () => socket.close(),
    closeBrowser: async () => {
      try { await send('Browser.close'); } catch { /* browser may close before replying */ }
      if (socket.readyState === WebSocket.CLOSED) return;
      await Promise.race([
        new Promise((resolveClose) => socket.addEventListener('close', resolveClose, { once: true })),
        sleep(5_000),
      ]);
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
    },
    newPage: async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Runtime.enable', {}, sessionId);
      const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result?.value;
      };
      const selector = (id) => `[data-testid="${id}"]`;
      return {
        navigate: (pageUrl) => send('Page.navigate', { url: pageUrl }, sessionId),
        eval: evaluate,
        click: (id) => evaluate(`(()=>{const el=document.querySelector('${selector(id)}');if(!el)throw new Error('missing ${id}');el.click();return true})()`),
        pollText: (id, pattern, timeout) => evaluate(`(async()=>{const d=Date.now()+${timeout};let v=null;while(Date.now()<d){v=document.querySelector('${selector(id)}')?.textContent?.trim()??null;if(v&&new RegExp(${JSON.stringify(pattern)},'i').test(v))return v;await new Promise(r=>setTimeout(r,100));}return v})()`),
        transportEvidence: () => evaluate(`(async()=>{const ready=await window.partifulMatrixReady;return ready.transportEvidence?.()??ready.provider?.transportEvidence?.()??[];})()`),
        pollTransportEvent: (event, timeout) => evaluate(`(async()=>{const d=Date.now()+${timeout};let evidence=[];while(Date.now()<d){const ready=await window.partifulMatrixReady;evidence=ready.transportEvidence?.()??ready.provider?.transportEvidence?.()??[];if(evidence.some(entry=>entry.event===${JSON.stringify(event)}))return evidence;await new Promise(r=>setTimeout(r,50));}return evidence})()`),
      };
    },
  };
}

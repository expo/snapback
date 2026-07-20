#!/usr/bin/env node
// react × supabase-realtime: the idiomatic browser-direct Supabase cell.
//
// This is the follow-up matrix leg LLP 0063 gates WS4 on: supabase-js in the
// browser with the publishable key, freshness from Realtime postgres_changes
// instead of the local gateway's 1-second poll. The cell runs with poll
// fallback disabled, so every observed out-of-band update is push evidence.

import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchChromeCdp } from '../../../_kit/chrome-process.mjs';
import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { freePort } from '../../../_kit/provenance.mjs';
import { loadLocalSecrets, requireSecret } from '../../backends/gateway/secrets.mjs';
import { probeSupabasePublishable } from './supabase-probe.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const demoRoot = resolve(here, '..', '..');
const chromeBin = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const option = (name) => { const at = process.argv.indexOf(`--${name}`); return at < 0 ? null : process.argv[at + 1]; };
const receiptFile = option('receipt');

const CHECKS = [
  'publishable key authenticates against its entitled endpoints',
  'react × supabase-realtime boots browser-direct with push transport',
  'opens details and performs an in-cell RSVP round trip',
  'observes out-of-band writes via Realtime push with poll fallback disabled',
  'database, not client, refuses to displace the host',
];
const suite = createSuite('partiful matrix / supabase-realtime follow-up cell', { expectedChecks: CHECKS.length });
const cleanups = [];

let credentials = null;
try {
  const secrets = loadLocalSecrets();
  credentials = {
    url: process.env.SUPABASE_URL ?? requireSecret(secrets, 'SUPABASE_URL'),
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? requireSecret(secrets, 'SUPABASE_PUBLISHABLE_KEY'),
  };
} catch { /* remote-dependency skip below */ }

const probe = credentials ? await probeSupabasePublishable(credentials) : null;
const chromeAvailable = existsSync(chromeBin);

const reportIdentity = {
  demo: 'partiful-matrix',
  claimSetVersion: 'partitime.web.followup.v1',
  cell: 'react:supabase-realtime',
  revision: gitRevision(),
  environment: { node: process.version, bun: toolVersion('bun', ['--version']), chromeVersion: toolVersion(chromeBin, ['--version']) },
  publishableProbe: probe,
};

if (!probe?.ok || !chromeAvailable) {
  const details = probe?.ok
    ? { skipClass: 'required-prerequisite-missing', prerequisite: 'chrome', path: chromeBin }
    : { skipClass: 'remote-dependency', backend: 'supabase-realtime', probe };
  for (const name of CHECKS) suite.skip(name, details);
  await runAcceptance(suite, async () => {}, { cleanups, reportFile: receiptFile, reportExtra: reportIdentity });
  process.exit(probe?.ok ? 1 : 0);
}

const rest = async (path, init = {}) => fetch(`${credentials.url}/rest/v1${path}`, {
  ...init,
  headers: { apikey: credentials.publishableKey, 'content-type': 'application/json', ...init.headers },
  signal: AbortSignal.timeout(10_000),
});

async function outOfBandRsvp(status) {
  const read = await rest('/partiful_matrix_rsvps?event_id=eq.event_sunset&user_id=eq.user_eve&select=id,status');
  const current = (await read.json())[0];
  const response = await rest('/partiful_matrix_rsvps?on_conflict=event_id,user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: current?.id ?? `rsvp_${crypto.randomUUID()}`, event_id: 'event_sunset', user_id: 'user_eve', guest_name: 'Eve', status }),
  });
  if (!response.ok) throw new Error(`out-of-band RSVP failed: HTTP ${response.status} ${await response.text()}`);
}

await runAcceptance(suite, async () => {
  await suite.check(CHECKS[0], async () => {
    if (!probe.ok) throw new Error(`probe failed: ${JSON.stringify(probe.checks)}`);
    return probe.checks;
  });

  const vitePort = await freePort();
  const surface = join(demoRoot, 'surfaces', 'react');
  let viteLog = '';
  const vite = spawn(join(surface, 'node_modules', '.bin', 'vite'), ['--mode', 'supabase-realtime', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
    cwd: surface,
    detached: true,
    env: {
      ...process.env,
      SUPABASE_URL: credentials.url,
      SUPABASE_PUBLISHABLE_KEY: credentials.publishableKey,
      PARTITIME_DISABLE_POLL_FALLBACK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  vite.stdout.on('data', (chunk) => { viteLog += chunk; });
  vite.stderr.on('data', (chunk) => { viteLog += chunk; });
  cleanups.push(() => stopChild(vite, 'supabase-realtime Vite'));
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(viteUrl, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* retry */ }
    if (vite.exitCode !== null) throw new Error(`Vite exited: ${viteLog.slice(-2000)}`);
    if (Date.now() > deadline) throw new Error(`Vite not ready: ${viteLog.slice(-2000)}`);
    await sleep(200);
  }

  const chrome = await launchChromeCdp({ chromeBin, userDataPrefix: 'partiful-supabase-rt-' });
  cleanups.push(() => chrome.stop());
  const cdp = await connectCdp(chrome.ws);
  cleanups.push(() => cdp.close());
  const page = await cdp.newPage();
  // Realtime keeps sockets open; park the page first so Chrome's process
  // tree can exit inside the cleanup attestation window.
  cleanups.push(() => page.navigate('about:blank').then(() => sleep(500)).catch(() => {}));

  await suite.check(CHECKS[1], async () => {
    await page.navigate(`${viteUrl}/?user=eve`);
    const boot = await page.eval(`(async()=>{const d=Date.now()+30000;while(!window.partifulMatrixReady){if(Date.now()>d)throw new Error('boot timeout');await new Promise(r=>setTimeout(r,50));}const ready=await window.partifulMatrixReady;return {backend:ready.backend,authoring:ready.authoring};})()`);
    if (boot.backend !== 'supabase-realtime' || boot.authoring !== 'react') throw new Error(`wrong cell identity: ${JSON.stringify(boot)}`);
    const card = await page.pollText('event-card-event_sunset', 'Sunset Supper Club', 15_000);
    if (!card?.includes('Sunset Supper Club')) throw new Error(`canonical event missing: ${card}`);
    return boot;
  });

  await suite.check(CHECKS[2], async () => {
    await page.click('open-event_sunset');
    const event = await page.pollText('event-page', 'Sunset Supper Club', 15_000);
    if (!event?.includes('Sunset Supper Club')) throw new Error(`event detail missing: ${event}`);
    const before = await page.pollText('guest-user_eve', 'Eve', 15_000);
    if (!before?.includes('Eve')) throw new Error(`Eve's RSVP row is missing: ${before}`);
    const next = before.includes('Going') ? { id: 'rsvp-maybe', label: 'Maybe' } : { id: 'rsvp-going', label: 'Going' };
    await page.click(next.id);
    const after = await page.pollText('guest-user_eve', next.label, 15_000);
    if (!after?.includes(next.label) || after === before) throw new Error(`RSVP did not transition: ${JSON.stringify({ before, after })}`);
    return { before, after };
  });

  await suite.check(CHECKS[3], async () => {
    let before = await page.pollText('guest-user_eve', 'Eve', 15_000);
    const observations = [];
    for (let sampleIndex = 0; sampleIndex < 6; sampleIndex += 1) {
      const next = before?.includes('Going') ? { status: 'maybe', label: 'Maybe' } : { status: 'going', label: 'Going' };
      const startedAtMs = Date.now();
      await outOfBandRsvp(next.status);
      const after = await page.pollText('guest-user_eve', next.label, 5_000);
      const latencyMs = Date.now() - startedAtMs;
      if (!after?.includes(next.label) || after === before) {
        throw new Error(`out-of-band RSVP did not arrive via push: ${JSON.stringify({ sampleIndex, before, after })}`);
      }
      observations.push({ sampleIndex, latencyMs });
      before = after;
    }
    const evidence = await page.transportEvidence();
    const established = evidence.filter((event) => event.event === 'established' && event.transport === 'push');
    if (!established.some((event) => event.queryName === 'guestList')) {
      throw new Error(`guestList lacks Realtime channel provenance: ${JSON.stringify(evidence)}`);
    }
    if (evidence.some((event) => event.event === 'fallback')) {
      throw new Error(`poll fallback engaged during a push witness: ${JSON.stringify(evidence)}`);
    }
    if (established.some((event) => event.pollFallbackEnabled !== false)) {
      throw new Error(`surface receipt does not prove fallback was disabled: ${JSON.stringify(established)}`);
    }
    const changes = evidence.filter((event) => event.event === 'change' && event.transport === 'push');
    if (changes.length === 0) throw new Error('no postgres_changes deliveries were recorded');
    const samples = observations.slice(1).map(({ latencyMs }) => latencyMs);
    const ordered = [...samples].sort((left, right) => left - right);
    return {
      mutationOrigin: 'out-of-band PostgREST (publishable key)',
      pollFallback: 'disabled',
      warmupCount: 1,
      sampleCount: samples.length,
      observations,
      freshnessLatencyMs: { samples, median: ordered[Math.floor(ordered.length / 2)], p95: ordered[Math.ceil(ordered.length * 0.95) - 1] },
      establishedChannels: established.map((event) => event.queryName),
      pushDeliveries: changes.length,
    };
  });

  await suite.check(CHECKS[4], async () => {
    const response = await rest('/partiful_matrix_rsvps?on_conflict=event_id,user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: 'rsvp_sunset_ada', event_id: 'event_sunset', user_id: 'user_ada', guest_name: 'Ada', status: 'going' }),
    });
    const body = await response.text();
    if (response.ok) throw new Error('displacing the host was accepted; RLS hardening is not in force');
    if (!body.includes('row-level security')) throw new Error(`expected a row-level security refusal, got HTTP ${response.status}: ${body}`);
    return { status: response.status, refusal: 'row-level security policy (USING expression)' };
  });
}, {
  cleanups,
  reportFile: receiptFile,
  reportExtra: reportIdentity,
});

function gitRevision() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(); } catch { return null; }
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
      eval: evalRaw,
      click: (id) => evalRaw(`(()=>{const el=document.querySelector('${selector(id)}');if(!el)throw new Error('missing ${id}');el.click();return true})()`),
      pollText: (id, pattern, timeout) => evalRaw(`(async()=>{const d=Date.now()+${timeout};let v=null;while(Date.now()<d){v=document.querySelector('${selector(id)}')?.textContent?.trim()??null;if(v&&new RegExp(${JSON.stringify(pattern)},'i').test(v))return v;await new Promise(r=>setTimeout(r,100));}return v})()`),
      transportEvidence: () => evalRaw(`(async()=>{const ready=await window.partifulMatrixReady;return ready.transportEvidence?.()??ready.provider?.transportEvidence?.()??[];})()`),
    };
  } };
}

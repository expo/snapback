// B1 on-device witness driver — React Native durable RQS store arm on the
// iOS simulator. Host half of the loopback director/witness pattern (test
// infrastructure). Proves, on a real Hermes/expo-file-system carrier:
//   1. the default ladder resolves the durable file arm after the one-line
//      root registration (real navigator.product === 'ReactNative');
//   2. a retainable public query persists through the documented client
//      path (explicit flushResumeState — the LLP 0091 step-5 wiring);
//   3. the blob holds the retainable rows and NO protected bytes (sentinel);
//   4. an offline cold relaunch renders the RETAINED rows with honest
//      freshness ('retained') and a non-live connection;
//   5. protected queries never cold-render offline.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDir = join(import.meta.dirname, 'evidence');
mkdirSync(evidenceDir, { recursive: true });
const readyFile = join(root, '.snapback', 'dev.ready.json');

const UDID = 'E0E49A2F-54A7-4355-8EB4-D52138E3361B';
const BUNDLE_ID = 'dev.snapback.improvementsweep.shell';
const APP_PATH = '/Users/ccheever/Library/Developer/Xcode/DerivedData/ImprovementSweepNeutralShell-cpxjojrsjwclmlhaweidvrxgrifj/Build/Products/Release-iphonesimulator/ImprovementSweepNeutralShell.app';
const DIRECTOR_PORT = 4612;
const SENTINEL = 'SENTINEL_PROTECTED_B1_NEVER_AT_REST';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(50);
  }
};
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }

const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
const simctlQuiet = (...args) => { try { return simctl(...args); } catch { return null; } };
let shotIndex = 0;
const screenshot = (label) => {
  const file = join(evidenceDir, `b1-shot-${shotIndex++}-${label}.png`);
  try { simctl('io', UDID, 'screenshot', file); return file; } catch { return null; }
};

// ---------- director ----------
const events = [];
const cmdQueue = [];
const pendingResults = new Map();
let cmdSeq = 0;
let serverUrlForApp = null;
const director = createServer((req, res) => {
  const respond = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/config') { respond(200, { serverUrl: serverUrlForApp }); return; }
  if (req.method === 'GET' && req.url === '/cmd') {
    const started = Date.now();
    let gone = false;
    req.on('close', () => { gone = true; });
    const tryDeliver = () => {
      if (gone || res.destroyed || req.destroyed) return;
      const cmd = cmdQueue.shift();
      if (cmd) { try { respond(200, cmd); } catch { cmdQueue.unshift(cmd); } return; }
      if (Date.now() - started > 2_500) { respond(204); return; }
      setTimeout(tryDeliver, 50);
    };
    tryDeliver();
    return;
  }
  if (req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(raw); } catch { respond(400, {}); return; }
      if (req.url === '/event') { events.push({ receivedAt: Date.now(), ...body }); respond(200, {}); return; }
      if (req.url === '/result') {
        const waiter = pendingResults.get(body.id);
        if (waiter) { pendingResults.delete(body.id); waiter(body); }
        respond(200, {});
        return;
      }
      respond(404);
    });
    return;
  }
  respond(404);
});
function sendCmd(op, args = {}, timeoutMs = 40_000) {
  cmdSeq += 1;
  const id = cmdSeq;
  return new Promise((resolveCmd, rejectCmd) => {
    const timer = setTimeout(() => { pendingResults.delete(id); rejectCmd(new Error(`director timeout: ${op}`)); }, timeoutMs);
    pendingResults.set(id, (result) => { clearTimeout(timer); resolveCmd(result); });
    cmdQueue.push({ id, op, args });
  });
}
async function mustCmd(op, args, timeoutMs) {
  const result = await sendCmd(op, args, timeoutMs);
  if (!result.ok) throw new Error(`${op} failed on device: ${JSON.stringify(result.error)}`);
  return result.value;
}
let eventCursor = 0;
async function waitEvent(predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    while (eventCursor < events.length) {
      const event = events[eventCursor];
      eventCursor += 1;
      if (predicate(event)) return event;
    }
    if (Date.now() >= deadline) throw new Error(`timeout waiting for event: ${label}`);
    await sleep(50);
  }
}

// ---------- dev server ----------
const guards = [];
async function guardPorts() {
  for (let port = 4287; port <= 4297; port += 1) {
    const guard = createNetServer(() => {});
    await new Promise((resolveGuard) => {
      guard.once('error', () => resolveGuard());
      guard.listen(port, '127.0.0.1', () => { guards.push(guard); resolveGuard(); });
    });
  }
}
let child = null;
let ready = null;
let adminToken = null;
let impersonation = null;
const lifecycleEvents = [];
async function spawnDev(expectPort = null) {
  const executable = join(root, 'node_modules', '.bin', 'snapback');
  child = spawn(executable, ['dev', 'snapback'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let remainder = '';
  const startedFrom = lifecycleEvents.length;
  child.stdout.on('data', (chunk) => {
    remainder += chunk.toString('utf8');
    for (;;) {
      const nl = remainder.indexOf('\n');
      if (nl === -1) break;
      const line = remainder.slice(0, nl).trim();
      remainder = remainder.slice(nl + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event?.schemaVersion === 'snapback.dev.v1') lifecycleEvents.push(event);
      } catch { /* prose */ }
    }
  });
  child.stderr.on('data', () => {});
  ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try {
      const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
      return lifecycleEvents.slice(startedFrom).some((e) => e.state === 'generated-and-loaded') ? descriptor : null;
    } catch { return null; }
  }, 'dev ready', 90_000);
  assert(ready.port !== 4420 && ready.port > 4297, `own port only (got ${ready.port})`);
  if (expectPort !== null) assert(ready.port === expectPort, `port stable (${ready.port} vs ${expectPort})`);
  adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  serverUrlForApp = ready.serverUrl;
  return ready;
}
async function stopDev() {
  if (!child) return;
  const dying = child;
  child = null;
  dying.stdin.end();
  await until(() => (dying.exitCode !== null ? true : null), 'dev exit', 15_000).catch(() => dying.kill('SIGTERM'));
  let refused = false;
  try { await fetch(`${ready.serverUrl}/health`); } catch { refused = true; }
  assert(refused, 'server refuses after stop');
}

const protocolHeaders = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
async function mailboxCode(challengeId) {
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
  ).then((r) => r.json());
  assert(typeof mailbox.code === 'string', 'mailbox code');
  return mailbox.code;
}

const evidence = { startedAt: new Date().toISOString() };

async function main() {
  await guardPorts();
  await new Promise((resolveListen) => director.listen(DIRECTOR_PORT, '127.0.0.1', resolveListen));
  for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
    rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
  }
  await spawnDev();
  const basePort = ready.port;

  execFileSync('xcrun', ['simctl', 'bootstatus', UDID, '-b'], { encoding: 'utf8' });
  simctlQuiet('terminate', UDID, BUNDLE_ID);
  simctlQuiet('uninstall', UDID, BUNDLE_ID);
  // expo-secure-store keychain entries survive app uninstall on the iOS
  // simulator (a1/a4 sweep-arm hygiene fact) — reset for a fresh boot.
  simctlQuiet('keychain', UDID, 'reset');
  simctl('install', UDID, APP_PATH);
  eventCursor = events.length;
  simctl('launch', UDID, BUNDLE_ID);

  const boot = await waitEvent((e) => e.type === 'boot', 'boot', 40_000);
  assert(boot.hadStoredBearer === false, 'fresh install boots without a bearer');
  const ping = await mustCmd('ping');
  assert(ping.hermes === true, 'Hermes on-device');
  assert(ping.reactNativeNavigatorProduct === 'ReactNative', 'real RN navigator.product');
  evidence.identities = {
    platform: `${ping.platform} ${ping.platformVersion}`,
    hermes: ping.hermes,
    navigatorProduct: ping.reactNativeNavigatorProduct,
    client: 'published 0.1.8 closure + this branch client delta overlaid (index/rqs-store-default/rqs-store-expo/assets + d.mts)',
    server: `${ready.serverUrl} (0.1.8 runtime, notebook-app)`,
    app: APP_PATH,
  };

  // 1. Ladder fact on the REAL carrier.
  const ladder = await mustCmd('ladderInfo');
  assert(ladder.info.implementation === 'file' && ladder.info.durable === true && ladder.info.source === 'default',
    `ladder resolves the durable file arm on-device (got ${JSON.stringify(ladder.info)})`);
  evidence.ladder = ladder.info;

  // Sign in on-device.
  const { challengeId } = await mustCmd('requestCode', { email: 'b1@sweep-b1.test' });
  const code = await mailboxCode(challengeId);
  await mustCmd('exchange', { challengeId, code });

  // Protected sentinel rows exist in the session (and must never persist).
  const workspaceId = (await mustCmd('mutate', { name: 'createWorkspace', args: { name: 'B1 probe workspace' } })).result;
  await mustCmd('mutate', {
    name: 'createRecord',
    args: { workspaceId, title: SENTINEL, assigneeId: 'unused', assigneeName: 'B1', dueAt: 1785542400000, position: 1000, clientKey: 'b1-r1' },
  });
  const protectedLive = await mustCmd('liveProbe', {
    name: 'listRecords', args: { workspaceId }, connectionId: 'b1_protected', flush: true, holdMs: 300,
  });
  assert(protectedLive.rows === 1, 'protected rows flow live online');
  evidence.protectedOnline = { rows: protectedLive.rows, retention: protectedLive.retention };

  // 2. Retainable public query through the documented default path + flush.
  const online = await mustCmd('liveProbe', {
    name: 'listSites', connectionId: 'b1_sites', flush: true, holdMs: 300,
  });
  assert(online.rows === 3, `3 seeded sites online (got ${online.rows})`);
  assert(online.rqsStoreInfo?.implementation === 'file' && online.rqsStoreInfo?.durable === true,
    `client resolved the durable store (got ${JSON.stringify(online.rqsStoreInfo)})`);
  evidence.online = online;

  // 3. Blob facts: retainable rows at rest, sentinel NEVER at rest.
  const store = await mustCmd('readStoreFiles');
  assert(store.exists === true && store.names.some((n) => n.endsWith('.v1.json')), 'store blob written on-device');
  const blobText = Object.values(store.blobs).join('\n');
  assert(blobText.includes('Site') || blobText.includes('site'), 'retainable rows present in the blob');
  assert(!blobText.includes(SENTINEL), 'protected sentinel is NOT at rest in the store blob');
  evidence.storeFiles = { names: store.names, blobBytes: blobText.length, sentinelAtRest: blobText.includes(SENTINEL) };
  screenshot('online');

  // 4. Offline cold relaunch: retained render with honest facts.
  await stopDev();
  simctl('terminate', UDID, BUNDLE_ID);
  await sleep(500);
  eventCursor = events.length;
  simctl('launch', UDID, BUNDLE_ID);
  const coldBoot = await waitEvent((e) => e.type === 'boot', 'cold boot', 40_000);
  assert(coldBoot.hadStoredBearer === true, 'bearer survived relaunch (app keychain custody)');
  const cold = await mustCmd('liveProbe', {
    name: 'listSites', connectionId: 'b1_sites_cold', flush: false, holdMs: 200,
  }, 60_000);
  assert(cold.rows === 3, `retained render offline: 3 rows (got ${cold.rows})`);
  assert(cold.freshness === 'retained', `freshness 'retained' (got ${JSON.stringify(cold.freshness)})`);
  assert(cold.connection !== 'live', `connection is honest offline (got ${JSON.stringify(cold.connection)})`);
  evidence.coldRetainedRender = cold;
  screenshot('cold-retained');

  // 5. Protected queries never cold-render offline.
  let protectedCold = null;
  try {
    protectedCold = await mustCmd('liveProbe', {
      name: 'listRecords', args: { workspaceId }, connectionId: 'b1_protected_cold', holdMs: 100,
    }, 45_000);
  } catch (error) {
    protectedCold = { refused: String(error.message).slice(0, 200) };
  }
  assert(protectedCold.rows === undefined || protectedCold.rows === 0,
    `no protected cold render (got ${JSON.stringify(protectedCold).slice(0, 200)})`);
  evidence.protectedCold = protectedCold;

  // Teardown.
  simctlQuiet('terminate', UDID, BUNDLE_ID);
  simctl('uninstall', UDID, BUNDLE_ID);
  simctl('shutdown', UDID);
  evidence.cleanup = { app: 'uninstalled', simulator: 'shutdown', server: 'stopped (origin refuses)' };
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(evidenceDir, 'b1-witness.json'), JSON.stringify(evidence, null, 2));
  writeFileSync(join(evidenceDir, 'b1-witness-events.json'), JSON.stringify(events, null, 2));
  console.error('B1 WITNESS OK: ladder=file/durable, retained cold render, sentinel not at rest');
}

try {
  await main();
} catch (error) {
  console.error('B1 witness error:', error);
  process.exitCode = 2;
} finally {
  try { await stopDev(); } catch { /* already down */ }
  for (const guard of guards) { try { guard.close(); } catch { /* teardown */ } }
  director.close();
  writeFileSync(join(evidenceDir, 'b1-witness-events.json'), JSON.stringify(events, null, 2));
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
}

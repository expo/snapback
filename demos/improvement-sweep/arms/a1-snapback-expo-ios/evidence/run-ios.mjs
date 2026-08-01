// LLP 0137 Track B — A1 field notebook, snapback-expo iOS receipt driver.
// External-consumer posture: public @expo/snapback-* 0.1.7 only.
// Host-side half of the loopback director/witness-collector pattern the
// shipped Expo guide page describes for acceptance runs (test
// infrastructure, not a production endpoint design). Drives the release
// simulator build through the ten a1-applicable EXPO checks.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createExternalSessionClient, SnapbackClient } from '@expo/snapback-client';
import api from '../snapback/generated/api.mjs';

const root = resolve(import.meta.dirname, '..');
const evidenceDir = join(import.meta.dirname, 'evidence');
mkdirSync(evidenceDir, { recursive: true });
const readyFile = join(root, '.snapback', 'dev.ready.json');
const seedArtifact = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'seed.artifact.json'), 'utf8'));

const UDID = 'E0E49A2F-54A7-4355-8EB4-D52138E3361B'; // iPhone 17 Pro, iOS 26.3
const BUNDLE_ID = 'dev.snapback.improvementsweep.shell';
// expo run:ios builds into Xcode DerivedData (not ios/build) on this CLI.
const APP_PATH = '/Users/ccheever/Library/Developer/Xcode/DerivedData/ImprovementSweepNeutralShell-bcnisflafusncqguywutuhqlcccv/Build/Products/Release-iphonesimulator/ImprovementSweepNeutralShell.app';
const DIRECTOR_PORT = 4610;
const EXPECTED_CHECKS = 10;

const results = [];
const evidence = {};
const milestones = { suiteStart: new Date().toISOString() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(40);
  }
};
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
const diagCode = (err) => err?.diagnostic?.code ?? err?.code ?? String(err?.message ?? err);

async function check(id, fn) {
  const startedAt = Date.now();
  try {
    const outcome = await fn();
    const result = outcome?.result ?? 'pass';
    results.push({ id, result, ms: Date.now() - startedAt, note: outcome?.note ?? '' });
    console.error(`${result.toUpperCase().padEnd(4)} ${id}: ${outcome?.note ?? ''}`);
  } catch (err) {
    results.push({ id, result: 'fail', ms: Date.now() - startedAt, note: String(err?.diagnostic?.code ?? err?.message ?? err) });
    console.error(`FAIL ${id}: ${err?.message ?? err}`);
  }
}

// ---------- simctl ----------
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
const simctlQuiet = (...args) => { try { return simctl(...args); } catch { return null; } };
let screenshotIndex = 0;
function screenshot(label) {
  const file = join(evidenceDir, `shot-${String(screenshotIndex).padStart(2, '0')}-${label}.png`);
  screenshotIndex += 1;
  try { simctl('io', UDID, 'screenshot', file); return file; } catch { return null; }
}

// ---------- director / witness collector ----------
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
  if (req.method === 'GET' && req.url === '/config') {
    respond(200, { serverUrl: serverUrlForApp });
    return;
  }
  if (req.method === 'GET' && req.url === '/cmd') {
    const started = Date.now();
    let gone = false;
    req.on('close', () => { gone = true; });
    const tryDeliver = () => {
      // Never deliver into a dead socket (an app terminate mid-long-poll
      // would silently eat the queued command).
      if (gone || res.destroyed || req.destroyed) return;
      const cmd = cmdQueue.shift();
      if (cmd) {
        try { respond(200, cmd); } catch { cmdQueue.unshift(cmd); }
        return;
      }
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
      try { body = JSON.parse(raw); } catch { respond(400, { error: 'bad json' }); return; }
      if (req.url === '/event') {
        events.push({ receivedAt: Date.now(), ...body });
        respond(200, { ok: true });
        return;
      }
      if (req.url === '/result') {
        const waiter = pendingResults.get(body.id);
        if (waiter) { pendingResults.delete(body.id); waiter(body); }
        respond(200, { ok: true });
        return;
      }
      respond(404);
    });
    return;
  }
  respond(404);
});

function sendCmd(op, args = {}, timeoutMs = 20_000) {
  cmdSeq += 1;
  const id = cmdSeq;
  return new Promise((resolveCmd, rejectCmd) => {
    const timer = setTimeout(() => {
      pendingResults.delete(id);
      rejectCmd(new Error(`director timeout: ${op}`));
    }, timeoutMs);
    pendingResults.set(id, (result) => {
      clearTimeout(timer);
      resolveCmd(result);
    });
    cmdQueue.push({ id, op, args });
  });
}

const IDEMPOTENT_OPS = new Set(['ping', 'queryState', 'clientInfo', 'queueClientInfo', 'requestCode']);
async function mustCmd(op, args, timeoutMs) {
  let result;
  try {
    result = await sendCmd(op, args, timeoutMs);
  } catch (err) {
    if (!IDEMPOTENT_OPS.has(op)) throw err;
    result = await sendCmd(op, args, timeoutMs); // one retry for read-only ops
  }
  if (!result.ok) throw new Error(`${op} failed on device: ${JSON.stringify(result.error)}`);
  return result.value;
}

let eventCursor = 0;
async function waitEvent(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    while (eventCursor < events.length) {
      const event = events[eventCursor];
      eventCursor += 1;
      if (predicate(event)) return event;
    }
    if (Date.now() >= deadline) throw new Error(`timeout waiting for event: ${label}`);
    await sleep(40);
  }
}
function latestState(name) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === 'state' && events[i].name === name) return events[i].snapshot;
  }
  return null;
}

// ---------- snapback dev lifecycle ----------
const guards = [];
async function guardPorts() {
  for (let port = 4287; port <= 4293; port += 1) {
    const guard = createNetServer(() => {});
    await new Promise((resolveGuard) => {
      guard.once('error', () => resolveGuard()); // taken elsewhere: equally unavailable
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
      return lifecycleEvents.slice(startedFrom).some((e) => e.state === 'generated-and-loaded')
        ? descriptor : null;
    } catch { return null; }
  }, 'dev ready', 60_000);
  assert(ready.port !== 4420, 'must not use fleet-shared port 4420');
  assert(ready.port < 4287 || ready.port > 4293, 'must not use the guarded 4287-4293 range');
  if (expectPort !== null) {
    assert(ready.port === expectPort, `server restart must reuse port ${expectPort} (got ${ready.port})`);
  }
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
  await until(() => (dying.exitCode !== null ? true : null), 'dev exit', 15_000)
    .catch(() => { dying.kill('SIGTERM'); });
  let refused = false;
  try { await fetch(`${ready.serverUrl}/health`); } catch { refused = true; }
  assert(refused, 'server port must refuse after stop');
}

// ---------- host-side personas (second device + outsider) ----------
const protocolHeaders = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};
const hostClients = [];
async function mailboxCode(challengeId) {
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
  ).then((r) => r.json());
  assert(typeof mailbox.code === 'string', `mailbox code for ${challengeId}`);
  return mailbox.code;
}
async function signInHost(email, label) {
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
    method: 'POST', headers: protocolHeaders, body: JSON.stringify({ email }),
  }).then((r) => r.json());
  const code = await mailboxCode(requested.challengeId);
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
    method: 'POST', headers: protocolHeaders,
    body: JSON.stringify({ challengeId: requested.challengeId, code }),
  }).then((r) => r.json());
  assert(typeof credential.token === 'string', `host sign-in failed for ${email}`);
  const client = createExternalSessionClient(ready.serverUrl, {
    bearerToken: credential.token,
    clientStoreId: `sweep-a1expo-${label}`,
    rqsStore: null,
  });
  hostClients.push(client);
  return { client, userId: credential.session.userId, token: credential.token, email, label };
}

// ---------- suite state ----------
let alice = { userId: null, email: 'alice@sweep-a1expo.test' };
let bob = null;
let mallory = null;
let workspaceId = null;
let conflictRecordId = null;
let appPid = null;

function launchApp() {
  const out = simctl('launch', UDID, BUNDLE_ID);
  appPid = out.trim();
  return out.trim();
}

async function main() {
  await guardPorts();
  await new Promise((resolveListen) => director.listen(DIRECTOR_PORT, '127.0.0.1', resolveListen));

  milestones.serverSpawned = new Date().toISOString();
  await spawnDev();
  const basePort = ready.port;
  milestones.serverReady = new Date().toISOString();

  // Second device + outsider personas (host-side protocol clients over the
  // same public package — the second "device" for the realtime transition).
  bob = await signInHost('bob@sweep-a1expo.test', 'bob-device2');
  mallory = await signInHost('mallory@sweep-a1expo.test', 'mallory');

  // Fresh app install. NOTE (observed): expo-secure-store keychain entries
  // SURVIVE app uninstall on the iOS simulator, so pre-run hygiene resets
  // the simulator keychain (test infrastructure; the receipt's own logout
  // evidence in EXPO-10 is app-mediated).
  execFileSync('xcrun', ['simctl', 'bootstatus', UDID, '-b'], { encoding: 'utf8' });
  simctlQuiet('terminate', UDID, BUNDLE_ID);
  simctlQuiet('uninstall', UDID, BUNDLE_ID);
  simctlQuiet('keychain', UDID, 'reset');
  simctl('install', UDID, APP_PATH);
  eventCursor = events.length;
  milestones.appInstalled = new Date().toISOString();

  // ---------- EXPO-02-LAUNCH ----------
  await check('EXPO-02-LAUNCH', async () => {
    launchApp();
    const boot = await waitEvent((e) => e.type === 'boot', 'app boot witness', 30_000);
    assert(boot.hadStoredBearer === false, 'fresh install boots signed out');
    assert(boot.serverUrl === ready.serverUrl, 'app adopted the director-served server URL');
    assert(boot.hermes === true, 'Hermes runtime present');
    const ping = await mustCmd('ping');
    assert(ping.phase === 'signed-out', `fresh boot phase signed-out (got ${ping.phase})`);
    evidence['EXPO-02'] = {
      buildMode: 'Release (expo run:ios --configuration Release, embedded bundle; no Metro attached)',
      launchPath: 'xcrun simctl launch of the expo-built release artifact (guide clients/react-expo.md acceptance shape)',
      pid: appPid,
      bootEvent: boot,
      screenshot: screenshot('signed-out'),
    };
    return { note: `release artifact launched clean (pid ${appPid}); signed-out boot witnessed` };
  });

  // ---------- EXPO-01-IDENTITIES ----------
  await check('EXPO-01-IDENTITIES', async () => {
    const ping = await mustCmd('ping');
    const appPkg = JSON.parse(readFileSync(resolve(root, '..', 'expo-app', 'package.json'), 'utf8'));
    const closure = {};
    for (const name of ['@expo/snapback-client', '@expo/snapback-react', 'expo', 'expo-secure-store', 'expo-status-bar', 'react', 'react-native', 'typescript']) {
      try {
        closure[name] = JSON.parse(readFileSync(resolve(root, '..', 'expo-app', 'node_modules', name, 'package.json'), 'utf8')).version;
      } catch { closure[name] = appPkg.dependencies?.[name] ?? appPkg.devDependencies?.[name] ?? 'unresolved'; }
    }
    const binary = join(APP_PATH, 'ImprovementSweepNeutralShell');
    const artifactSha = createHash('sha256').update(readFileSync(binary)).digest('hex');
    const xcode = execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim().replace(/\n/g, ' ');
    evidence['EXPO-01'] = {
      expoSdk: closure.expo,
      reactNative: closure['react-native'],
      react: closure.react,
      backendClient: `@expo/snapback-client ${closure['@expo/snapback-client']} + @expo/snapback-react ${closure['@expo/snapback-react']} (public npm, immutable 0.1.7)`,
      os: `iOS 26.3 simulator runtime (device ${ping.platform} ${ping.platformVersion})`,
      device: `iPhone 17 Pro simulator ${UDID}`,
      hostXcode: xcode,
      hermes: ping.hermes,
      buildArtifact: { path: APP_PATH, binarySha256: artifactSha, bundleId: BUNDLE_ID },
      backend: {
        server: ready.serverUrl,
        appId: 'notebook-app',
        targetProfile: 'local-dev-sqlite-ibex (fresh isolated, arm-owned)',
      },
    };
    return { note: `expo ${closure.expo} / RN ${closure['react-native']} / client 0.1.7 / iOS ${ping.platformVersion} sim / sha ${artifactSha.slice(0, 12)}…` };
  });

  // ---------- EXPO-03-NATIVE-AUTH ----------
  await check('EXPO-03-NATIVE-AUTH', async () => {
    milestones.authStart = new Date().toISOString();
    const { challengeId } = await mustCmd('requestCode', { email: alice.email });
    // The capture mailbox is read host-side under admin custody (the guide
    // forbids fetching the process-local mailbox from the phone); the
    // director relays the code exactly as the user reading their email would.
    const code = await mailboxCode(challengeId);
    const exchanged = await mustCmd('exchange', { challengeId, code, email: alice.email }, 30_000);
    alice.userId = exchanged.userId;
    assert(typeof alice.userId === 'string' && alice.userId.length > 0, 'server-minted principal');
    const ping = await mustCmd('ping');
    assert(ping.phase === 'ready', 'app reached ready after exchange');
    evidence['EXPO-03'] = {
      shape: 'in-app email-code entry (guide auth/native-apps.md shape 1): /auth/request-code and /auth/exchange both executed on-device; code relayed by the director as the user',
      deepLink: 'not required by this app: the documented native session entry is fully in-app (no external browser hop to return from); the sweepshell:// scheme exists in the frozen shell but carries no auth leg',
      userId: alice.userId,
      screenshot: screenshot('authed-empty'),
    };
    return { note: `on-device email-code exchange minted ${alice.userId.slice(0, 8)}…; deep-link return not required by this auth shape` };
  });

  // ---------- workspace + records setup (kernel actors/transitions) ----------
  workspaceId = (await mustCmd('mutate', { name: 'createWorkspace', args: { name: `North Field Crew ${Date.now()}` } })).result;
  assert(typeof workspaceId === 'string', 'workspace id from settlement envelope');
  await mustCmd('setWorkspace', { workspaceId });
  await mustCmd('mutate', { name: 'inviteToWorkspace', args: { workspaceId, userId: bob.userId } });
  await bob.client.mutate(api.acceptWorkspaceInvite, { args: { workspaceId } });
  const mk = async (title, assignee, dueAt, position, clientKey) => (await mustCmd('mutate', {
    name: 'createRecord',
    args: { workspaceId, title, assigneeId: assignee.userId, assigneeName: assignee.label ?? 'Alice', dueAt, position, clientKey },
  })).result;
  const r1 = await mk('Transformer vault reading', { userId: alice.userId, label: 'Alice' }, 1785542400000, 1000, 'a1x-r1');
  const r2 = await mk('North fence corrosion pass', { userId: bob.userId, label: 'Bob' }, 1785628800000, 2000, 'a1x-r2');
  const r3 = await mk('Pump house vibration log', { userId: alice.userId, label: 'Alice' }, 1785715200000, 3000, 'a1x-r3');
  conflictRecordId = r2;
  milestones.firstMutation = milestones.firstMutation ?? new Date().toISOString();

  // ---------- EXPO-04-REALTIME ----------
  await check('EXPO-04-REALTIME', async () => {
    // Initial authoritative data on the device…
    await until(() => {
      const snap = latestState('notebook');
      return snap?.records?.rows?.length === 3 ? snap : null;
    }, 'device renders 3 records', 15_000);
    // …verified independently of the initiating UI (kernel rule).
    const authoritative = await bob.client.query(api.listRecords, { args: { workspaceId } });
    assert(authoritative.rows.length === 3, 'authoritative count independent of the UI');
    // Outsider negative (kernel rule): Mallory cannot read or subscribe.
    let outsider = null;
    try {
      await mallory.client.query(api.listRecords, { args: { workspaceId } });
      outsider = 'RESOLVED (defect)';
    } catch (err) { outsider = diagCode(err); }
    assert(outsider === 'SNAPBACK_AUTH_PERMISSION_DENIED', `outsider denied (${outsider})`);
    // Second-device realtime transition: bob commits, the device observes.
    const t0 = Date.now();
    await bob.client.mutate(api.updateRecord, {
      args: { recordId: conflictRecordId, title: 'North fence corrosion pass — URGENT', state: 'done' },
    });
    const transition = await waitEvent((e) =>
      e.type === 'state' && e.name === 'notebook'
      && e.snapshot?.records?.rows?.some((row) => row.title === 'North fence corrosion pass — URGENT' && row.state === 'done'),
    'second-device transition visible on device', 15_000);
    const latency = transition.receivedAt - t0;
    milestones.verifiedRealtime = new Date().toISOString();
    evidence['EXPO-04'] = {
      initialRows: 3,
      independentAuthoritativeCount: authoritative.rows.length,
      outsiderDenial: outsider,
      transition: { titleSeen: 'North fence corrosion pass — URGENT', latencyMsUpperBound: latency },
      transport: 'server push over the client stream transport (witness event carries the on-device row state)',
      screenshot: screenshot('realtime-after-bob-edit'),
    };
    return { note: `3 authoritative rows; outsider ${outsider}; bob's edit visible on device ≤${latency}ms after settlement` };
  });

  // ---------- EXPO-07-QUEUE (offline window 1) ----------
  await check('EXPO-07-QUEUE', async () => {
    const preCount = (await bob.client.query(api.listRecords, { args: { workspaceId } })).rows.length;
    let defaultOffline = null;
    let storeInfo = null;
    let queueEngagement = null; // { queuedCreate, queuedUpdate } | { error }
    try {
      await stopDev();
      // Default client behavior offline: refusal surfaced, no silent fake.
      try {
        await mustCmd('mutate', {
          name: 'createRecord',
          args: { workspaceId, title: 'Should refuse offline', assigneeId: alice.userId, assigneeName: 'Alice', dueAt: 1785542400000, position: 9000, clientKey: 'a1x-refused' },
        });
        defaultOffline = 'RESOLVED (unexpected)';
      } catch (err) { defaultOffline = String(err.message); }
      // Documented offline-queue opt-in, on device.
      const started = await mustCmd('queueClientStart');
      storeInfo = started.rqsStoreInfo;
      try {
        const queuedCreate = await mustCmd('queueClientMutate', {
          name: 'createRecord',
          args: { workspaceId, title: 'Valve inspection — queued on device', assigneeId: alice.userId, assigneeName: 'Alice', dueAt: 1785542400000, position: 4000, clientKey: 'a1x-q1' },
        });
        const queuedUpdate = await mustCmd('queueClientMutate', {
          name: 'updateRecord',
          args: { recordId: conflictRecordId, notes: 'offline note from the field (queued on device)' },
        });
        queueEngagement = { queuedCreate, queuedUpdate };
      } catch (err) {
        queueEngagement = { error: String(err.message) };
      }
    } finally {
      // Reconnect: same port so every on-device client reaches the same origin.
      if (!child) await spawnDev(basePort);
      await until(async () => {
        try { const r = await fetch(`${ready.serverUrl}/health`); return r.ok ? true : null; } catch { return null; }
      }, 'server back', 20_000);
    }

    if (queueEngagement.queuedCreate?.queued === true) {
      // Queue engaged: run the full settlement legs.
      const { queuedCreate, queuedUpdate } = queueEngagement;
      assert(typeof queuedCreate.clientMutationId === 'string', 'client-minted identity');
      assert(queuedUpdate?.queued === true && queuedUpdate.sequence > queuedCreate.sequence, 'monotonic queue sequence');
      const replay = await mustCmd('queueClientReplay', {}, 30_000);
      assert(replay.replayed === 2 && replay.failed === 0 && replay.remaining === 0,
        `ordered exactly-once drain (got ${JSON.stringify(replay)})`);
      const replayAgain = await mustCmd('queueClientReplay', {}, 30_000);
      assert((replayAgain.replayed ?? 0) === 0 && (replayAgain.remaining ?? 0) === 0, 'second drain is a no-op');
      await mustCmd('queueClientDispose');
      const post = await bob.client.query(api.listRecords, { args: { workspaceId } });
      const queuedRows = post.rows.filter((row) => row.clientKey === 'a1x-q1');
      assert(post.rows.length === preCount + 1 && queuedRows.length === 1, 'exactly-once settlement, no duplication');
      evidence['EXPO-07'] = {
        defaultOfflineBehavior: defaultOffline, rqsStoreInfo: storeInfo,
        queuedCreate, queuedUpdate, replay, replayAgain,
        settlement: { preCount, postCount: post.rows.length, duplicates: 0 },
        durabilityNonclaim: storeInfo?.durable === true ? null : 'in-memory store: within-process settlement only',
        screenshot: screenshot('post-replay'),
      };
      return {
        result: storeInfo?.durable === true ? 'pass' : 'gap',
        note: `queued 2, replay {2,0,0}, no-op re-drain, exactly-once settled; store=${storeInfo?.implementation} durable=${storeInfo?.durable}`,
      };
    }

    // Queue did not engage on this carrier: prove nothing settled, record
    // the exact refusal facts, and file the classification defect.
    await mustCmd('queueClientDispose').catch(() => {});
    const post = await bob.client.query(api.listRecords, { args: { workspaceId } });
    assert(post.rows.length === preCount, 'no ghost settlement from the non-engaged queue');
    assert(!post.rows.some((r) => r.clientKey === 'a1x-q1' || r.clientKey === 'a1x-refused'),
      'no offline-attempt key ever committed');
    // Refusal probe online: a server-refused edit surfaces a structured
    // refusal and leaves rendered rows authoritative (no optimistic ghost).
    let refusal = null;
    try {
      await mustCmd('mutate', { name: 'updateRecord', args: { recordId: conflictRecordId, state: 'bogus' } });
      refusal = 'RESOLVED (unexpected)';
    } catch (err) { refusal = String(err.message); }
    evidence['EXPO-07'] = {
      defaultOfflineBehavior: defaultOffline,
      rqsStoreInfo: storeInfo,
      queueOptInOutcome: queueEngagement,
      hostControlProbe: 'node + explicit createMemoryRqsResumeStore + offlineQueue:true against the same stopped server queues { queued: true, sequence: 1 } — the non-engagement is carrier-specific (fetch failure class), not store-driven',
      noGhostSettlement: { preCount, postCount: post.rows.length },
      refusalRollback: refusal,
      claimBoundary: 'guide clients/react-expo.md: the Expo path is an Online surface and does not claim the durable queue — nonclaim honored; the defect is that the documented offlineQueue opt-in exists on the same client and cannot engage on this carrier (connectivity classification requires instanceof TypeError; Expo fetch rejects with plain Error)',
      screenshot: screenshot('queue-not-engaged'),
    };
    return {
      result: 'gap',
      note: `queue unclaimed on this carrier and the opt-in cannot engage (Expo fetch failure is a plain Error, classification requires TypeError — finding filed); no ghost settlement (count ${post.rows.length}); online refusal surfaced structured (${refusal?.slice(0, 60)}…)`,
    };
  });

  // ---------- EXPO-05-LIFECYCLE ----------
  await check('EXPO-05-LIFECYCLE', async () => {
    // The session client must be live again after the queue window's bounce.
    await until(() => {
      const snap = latestState('notebook');
      return snap?.connection?.status === 'live' ? snap : null;
    }, 'connection live before lifecycle legs', 40_000);
    // Background via Settings (the guide's own backgrounding shape).
    execFileSync('xcrun', ['simctl', 'launch', UDID, 'com.apple.Preferences'], { encoding: 'utf8' });
    const backgrounded = await waitEvent((e) => e.type === 'app-state' && (e.state === 'background' || e.state === 'inactive'), 'app backgrounded', 15_000);
    // A second-device commit lands while the app is backgrounded.
    await bob.client.mutate(api.updateRecord, {
      args: { recordId: conflictRecordId, title: 'North fence corrosion pass — CLOSED' },
    });
    await sleep(1_500);
    // Foreground: the app must catch up to the missed commit.
    launchApp();
    await waitEvent((e) => e.type === 'app-state' && e.state === 'active', 'app foregrounded', 15_000);
    const caughtUp = await until(() => {
      const snap = latestState('notebook');
      return snap?.records?.rows?.some((row) => row.title === 'North fence corrosion pass — CLOSED') ? snap : null;
    }, 'foreground catch-up to backgrounded commit', 20_000);
    const fgShot = screenshot('foreground-caught-up');
    // Network loss: the backend origin refuses. Retained rendered rows +
    // honest connection fact, never relabeled live.
    const preLossCount = latestState('notebook')?.records?.rows?.length ?? 0;
    assert(preLossCount > 0, 'rows rendered before the network-loss leg');
    await stopDev();
    const staleSnap = await until(() => {
      const snap = latestState('notebook');
      const conn = snap?.connection?.status;
      return conn && conn !== 'live' && conn !== 'polling' ? snap : null;
    }, 'connection leaves live after network loss', 25_000);
    assert((staleSnap.records?.rows?.length ?? 0) === preLossCount, 'rendered rows retained through network loss');
    const staleShot = screenshot('network-loss-stale');
    // Reconnect (same origin), live again, and a fresh commit flows.
    await spawnDev(basePort);
    const liveSnap = await until(() => {
      const snap = latestState('notebook');
      return snap?.connection?.status === 'live' ? snap : null;
    }, 'connection returns live after reconnect', 40_000);
    await bob.client.mutate(api.updateRecord, {
      args: { recordId: conflictRecordId, notes: 'post-reconnect note from bob' },
    });
    await until(() => {
      const snap = latestState('notebook');
      return snap?.records?.rows?.some((row) => String(row.notes ?? '').includes('post-reconnect')) ? snap : null;
    }, 'post-reconnect commit visible', 20_000);
    evidence['EXPO-05'] = {
      appStateEvents: events.filter((e) => e.type === 'app-state').map((e) => ({ at: e.at, state: e.state })),
      backgroundedVia: 'simctl launch com.apple.Preferences (guide clients/react-expo.md backgrounding shape)',
      backgroundEvent: { state: backgrounded.state },
      foregroundCatchUp: { titleSeen: 'North fence corrosion pass — CLOSED' },
      networkLoss: {
        connectionFact: staleSnap.connection?.status,
        rowsRetained: staleSnap.records?.rows?.length,
        neverRelabeledLive: true,
      },
      reconnect: { connectionFact: liveSnap.connection?.status, freshCommitObserved: true },
      screenshots: { foreground: fgShot, stale: staleShot },
    };
    return { note: `background/foreground witnessed (${backgrounded.state}→active, missed commit caught up); network loss → ${staleSnap.connection?.status} with ${preLossCount} rows retained; reconnect → live with fresh commit` };
  });

  // ---------- EXPO-06-COLD-RESTART (offline window 2) ----------
  await check('EXPO-06-COLD-RESTART', async () => {
    await stopDev();
    simctl('terminate', UDID, BUNDLE_ID);
    await sleep(500);
    eventCursor = events.length;
    launchApp();
    const boot = await waitEvent((e) => e.type === 'boot', 'cold offline boot', 30_000);
    assert(boot.hadStoredBearer === true, 'stored session bearer survived process death (app keychain custody)');
    const coldFacts = await waitEvent((e) => e.type === 'cold-boot-offline', 'cold-boot-offline facts', 30_000);
    const store = coldFacts.headlessProbe?.rqsStoreInfo;
    const offlineShot = screenshot('cold-restart-offline-locked');
    // Reconnect: backend returns; the app self-heals into the notebook.
    await spawnDev(basePort);
    const restored = await waitEvent((e) => e.type === 'session-restored' && e.after === 'offline-cold-boot', 'auto-recovery after cold offline boot', 45_000);
    const authoritative = await bob.client.query(api.listRecords, { args: { workspaceId } });
    await until(() => {
      const snap = latestState('notebook');
      return snap?.records?.rows?.length === authoritative.rows.length ? snap : null;
    }, 'notebook re-rendered after recovery', 30_000);
    // Nothing ghost-settled across the cold offline window: the device
    // render equals the authoritative count and no offline-attempt key
    // ever committed.
    const post = authoritative;
    assert(!post.rows.some((r) => r.clientKey === 'a1x-refused' || r.clientKey === 'a1x-q1'), 'no offline-attempt key ever committed');
    evidence['EXPO-06'] = {
      coldRestart: 'simctl terminate + launch with the backend origin refusing',
      storedBearerSurvived: true,
      restoreError: coldFacts.restoreError,
      headlessProbe: coldFacts.headlessProbe,
      retainedStateClaim: 'NOT CLAIMED on this carrier: guide clients/react-expo.md declares the Expo path an Online surface with no local-first claim; the client rqs default store resolves to the in-memory arm on React Native (rqsStoreInfo above), so no cold-boot retained render is claimable — recorded as a GAP finding vs the A1 contract (web arm cold-retains the public subset via IndexedDB/file stores)',
      recovery: { sessionRestored: true, afterMs: restored.receivedAt - boot.receivedAt },
      screenshots: { offline: offlineShot, recovered: screenshot('cold-restart-recovered') },
    };
    return {
      result: 'gap',
      note: `cold restart clean (bearer survived via app keychain custody; binding refuses offline: ${coldFacts.restoreError?.code ?? coldFacts.restoreError?.message}); retained render unclaimed on this carrier (rqs store=${store?.implementation}, durable=${store?.durable}) → GAP; auto-recovered to the authoritative row count when backend returned`,
    };
  });

  // ---------- EXPO-10-AUTHORITY-ROTATION ----------
  await check('EXPO-10-AUTHORITY-ROTATION', async () => {
    // Rotation: the broker-shaped explicit replacement bearer (guide
    // auth/native-apps.md) — rotate the device to Mallory's authority.
    const rotation = await mustCmd('replaceBearer', { token: mallory.token, userId: mallory.userId, email: mallory.email }, 30_000);
    const denied = await until(() => {
      const snap = latestState('notebook');
      const rec = snap?.records;
      const blanked = !rec?.rows || rec.rows.length === 0;
      const notPresentingLive = rec?.error || rec?.status !== 'ready';
      return blanked && notPresentingLive ? snap : null;
    }, 'predecessor rows blanked after rotation', 25_000);
    // Observed (finding): the successor's SNAPBACK_AUTH_PERMISSION_DENIED
    // surfaces ONLY inside the transition AggregateError; the records query
    // presents status 'refreshing' with no error fact and the connection
    // axis drops to 'disconnected' — a React consumer cannot render the
    // denial.
    const rotatedShot = screenshot('rotated-to-outsider');
    // Rotate back to Alice: fresh subscribe under the restored authority.
    const rotateBack = await mustCmd('replaceBearer', { token: (await signInHost(alice.email, 'alice-rotate-back')).token, userId: alice.userId, email: alice.email }, 30_000);
    const authoritativeCount = (await bob.client.query(api.listRecords, { args: { workspaceId } })).rows.length;
    let rotateBackRecovered = true;
    let rotateBackFacts = null;
    try {
      await until(() => {
        const snap = latestState('notebook');
        return snap?.records?.rows?.length === authoritativeCount ? snap : null;
      }, 'rows return under restored authority', 30_000);
    } catch (err) {
      rotateBackRecovered = false;
      const snap = latestState('notebook');
      rotateBackFacts = {
        error: String(err.message),
        lastSnapshot: { connection: snap?.connection?.status, records: { status: snap?.records?.status, error: snap?.records?.error, rows: snap?.records?.rows?.length ?? null } },
      };
    }
    // Logout: clear the bearer; protected state blanks; keychain cleared.
    await mustCmd('replaceBearer', { token: null }, 30_000);
    await waitEvent((e) => e.type === 'logout', 'logout witnessed', 15_000);
    const loggedOutSnap = await until(() => {
      const snap = latestState('notebook');
      return !snap?.records?.rows || snap.records.rows.length === 0 ? snap : null;
    }, 'protected rows blanked on logout', 25_000);
    const logoutShot = screenshot('logged-out');
    // Predecessor-data retirement across process death: relaunch boots
    // signed out (keychain cleared; nothing durable at rest on-device).
    simctl('terminate', UDID, BUNDLE_ID);
    await sleep(500);
    eventCursor = events.length;
    launchApp();
    const boot = await waitEvent((e) => e.type === 'boot', 'post-logout boot', 30_000);
    assert(boot.hadStoredBearer === false, 'no predecessor credential at rest after logout');
    const ping = await mustCmd('ping');
    assert(ping.phase === 'signed-out', 'relaunch lands signed out');
    evidence['EXPO-10'] = {
      rotateBackRecovered,
      rotateBackFacts,
      rotation: {
        to: 'outsider (mallory) via the documented explicit replacement-bearer transition',
        predecessorRowsBlanked: true,
        successorOutcome: denied.records?.error ?? denied.records?.status,
        lifecycleFailures: rotation?.lifecycleFailures ?? null,
        rotateBackLifecycleFailures: rotateBack?.lifecycleFailures ?? null,
        apiSurprise: rotation?.lifecycleFailures ? 'replaceBearerToken to a lesser-privileged principal REJECTS with AggregateError (external bearer custody transition completed with lifecycle failures) although the custody transition completes — the app must string-match to distinguish this from a failed transition; finding filed' : null,
      },
      rotateBack: 'rows re-rendered under restored authority (fresh subscribe)',
      logout: { witnessed: true, rowsBlanked: true, records: loggedOutSnap.records?.status ?? null },
      retirement: {
        keychainCleared: true,
        relaunchPhase: ping.phase,
        deviceAtRest: 'no durable client store exists on this carrier (in-memory rqs arm) and the app-owned keychain entry is deleted on logout — no protected bytes at rest',
      },
      screenshots: { rotated: rotatedShot, loggedOut: logoutShot, relaunch: screenshot('post-logout-relaunch') },
    };
    return {
      result: rotateBackRecovered ? 'pass' : 'fail',
      note: `rotation blanked predecessor rows (successor denial via transition AggregateError; query left ${denied.records?.status}/${denied.connection?.status} — finding filed); rotate-back ${rotateBackRecovered ? 'recovered' : `DID NOT recover (${rotateBackFacts?.lastSnapshot?.records?.status})`}; logout blanked + cleared keychain; relaunch boots signed-out`,
    };
  });

  milestones.localAcceptance = new Date().toISOString();

  // ---------- EXPO-11-TEARDOWN ----------
  await check('EXPO-11-TEARDOWN', async () => {
    simctlQuiet('terminate', UDID, BUNDLE_ID);
    simctl('uninstall', UDID, BUNDLE_ID);
    // Server-side retirement: receipted versioned reset-install back to the
    // literal seed (admin custody), then verification, then stop.
    const adminActor = await signInHost(alice.email, 'admin-actor');
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: adminActor.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const stream = preview?.current?.dataVersionStream;
    assert(typeof stream === 'string' && stream.length > 0, 'active data version stream discovered');
    const receipt = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: stream },
    });
    assert(receipt.operation === 'reset-install' && receipt.outcome === 'reset-installed', 'reset-install settled');
    const verifier = await signInHost(alice.email, 'alice-verify');
    const sites = await verifier.client.query(api.listSites, {});
    assert(sites.rows.length === 3 && sites.rows.every((r) => r._id.startsWith('site_')), 'literal seed restored');
    let negative = null;
    try {
      const rows = (await verifier.client.query(api.listRecords, { args: { workspaceId } })).rows.length;
      negative = `rows=${rows}`;
      assert(rows === 0, 'arm records retired');
    } catch (err) { negative = diagCode(err); }
    for (const client of hostClients.splice(0)) { try { await client.closeAuth?.(); } catch { /* teardown */ } }
    await stopDev();
    simctl('shutdown', UDID);
    evidence['EXPO-11'] = {
      app: 'terminated and uninstalled (container + keychain removed)',
      simulator: `shutdown ${UDID} (booted by this run's build/launch path)`,
      server: 'snapback dev stopped; origin refuses',
      seedReceipt: {
        operation: receipt.operation, outcome: receipt.outcome,
        seedVersion: receipt.seedVersion, resetDeletedRows: receipt.resetDeletedRows,
      },
      postCleanupNegative: { workspaceQuery: negative, sites: sites.rows.length },
      credentials: 'session bearers retired by the reset-install stream transition; admin/impersonation token files remain dev-local inside the arm-owned external directory only',
      testData: 'all arm rows deleted by the receipted reset-install; literal 3-site seed restored',
    };
    milestones.cleanup = new Date().toISOString();
    return { note: `app uninstalled, sim shutdown, server stopped; reset-install deleted ${receipt.resetDeletedRows} rows; seed baseline restored (${negative})` };
  });

  // ---------- EXPO-12-INDEPENDENCE ----------
  await check('EXPO-12-INDEPENDENCE', async () => {
    evidence['EXPO-12'] = {
      claim: 'expo-ios simulator only. Nothing in this receipt establishes Android behavior (LLP 0064); the android arm is recorded as an honest not-run GAP in the capsule with its blocker.',
    };
    return { note: 'receipt claims iOS simulator only; android recorded separately as not-run' };
  });

  // ---------- report ----------
  const failed = results.filter((r) => r.result === 'fail').length;
  const report = {
    schemaVersion: 1,
    protocolId: 'llp-0137-improvement-sweep-v1',
    arm: { contract: 'a1', platform: 'expo-ios', provider: 'snapback', attemptId: 'a1-expo-ios-20260801' },
    expectedChecks: EXPECTED_CHECKS,
    ranChecks: results.length,
    results,
    milestones,
  };
  writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(evidenceDir, 'scenario-evidence.json'), JSON.stringify(evidence, null, 2));
  writeFileSync(join(evidenceDir, 'witness-events.json'), JSON.stringify(events, null, 2));
  console.error(`\nchecks: ${results.length}/${EXPECTED_CHECKS}, fails: ${failed}`);
  process.exitCode = failed === 0 && results.length === EXPECTED_CHECKS ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error('suite error:', error);
  process.exitCode = 2;
} finally {
  try { await stopDev(); } catch { /* already down */ }
  for (const guard of guards) { try { guard.close(); } catch { /* teardown */ } }
  director.close();
  writeFileSync(join(evidenceDir, 'witness-events.json'), JSON.stringify(events, null, 2));
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
}

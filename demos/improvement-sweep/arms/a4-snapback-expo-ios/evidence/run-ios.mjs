// LLP 0137 Track B — A4 event and invitation application, snapback-expo iOS
// receipt driver. External-consumer posture: public @expo/snapback-* 0.1.7
// only. Host-side half of the loopback director/witness-collector pattern
// the shipped Expo guide page describes for acceptance runs (test
// infrastructure, not a production endpoint design). Drives the release
// simulator build through the twelve a4-applicable EXPO checks.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createExternalSessionClient } from '@expo/snapback-client';
import api from '../snapback/generated/api.mjs';

const root = resolve(import.meta.dirname, '..');
const evidenceDir = join(import.meta.dirname, 'evidence');
mkdirSync(evidenceDir, { recursive: true });
const readyFile = join(root, '.snapback', 'dev.ready.json');
const seedArtifact = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'seed.artifact.json'), 'utf8'));

const UDID = 'E0E49A2F-54A7-4355-8EB4-D52138E3361B'; // iPhone 17 Pro, iOS 26.3
const BUNDLE_ID = 'dev.snapback.improvementsweep.shell';
// expo run:ios builds into Xcode DerivedData; this arm's project hash.
const APP_PATH = '/Users/ccheever/Library/Developer/Xcode/DerivedData/ImprovementSweepNeutralShell-cpxjojrsjwclmlhaweidvrxgrifj/Build/Products/Release-iphonesimulator/ImprovementSweepNeutralShell.app';
const DIRECTOR_PORT = 4611; // a4-expo arm's own director port (a1-expo owns 4610)
const EXPECTED_CHECKS = 12;
const EVENT = 'evt_lantern';
const SLUG = 'lantern-supper';

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
const sha256hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

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

// ---------- deterministic PNG builder (same fixture as the a4-web arm) ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}
function buildPng(width, height, tint) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 4;
      raw[p] = Math.floor((x / width) * 255);
      raw[p + 1] = Math.floor((y / height) * 255);
      raw[p + 2] = tint;
      raw[p + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
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

const IDEMPOTENT_OPS = new Set(['ping', 'queryState', 'clientInfo', 'requestCode', 'readAsset', 'query']);
async function mustCmd(op, args, timeoutMs) {
  let result;
  try {
    result = await sendCmd(op, args, timeoutMs);
  } catch (err) {
    if (!IDEMPOTENT_OPS.has(op)) throw err;
    result = await sendCmd(op, args, timeoutMs);
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
// Port discipline: this arm owns 4297 (director 4611); the a1-expo arm owns
// 4294/4610 and the web arms own 4288-4291; 4287-4296 are guard-blocked so
// the runtime scan lands on 4297; 4420 is never used.
const guards = [];
async function guardPorts() {
  for (let port = 4287; port <= 4296; port += 1) {
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
  child = spawn(executable, ['dev', 'snapback'], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
  });
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
  assert(ready.port > 4296, `must not use the guarded/peer 4287-4296 range (got ${ready.port})`);
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

// ---------- host-side personas (second device + cohost + outsider) ----------
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
    clientStoreId: `sweep-a4expo-${label}`,
    rqsStore: null,
  });
  hostClients.push(client);
  return { client, userId: credential.session.userId, token: credential.token, email, label };
}

// Anonymous public read: raw HTTP with only the protocol offer (the packaged
// client refuses to be anonymous outside a browser — finding 0137-a4-f6, cited).
async function anonQuery(name, args) {
  const res = await fetch(`${ready.serverUrl}/query/${encodeURIComponent(name)}`, {
    method: 'POST', headers: protocolHeaders, body: JSON.stringify({ args }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ---------- suite state ----------
let hana = { userId: null, email: 'hana@sweep-a4expo.test' };
let cora = null;
let gil = null;
let max = null;
let flyerAssetId = null;
let appPid = null;

function launchApp() {
  const out = simctl('launch', UDID, BUNDLE_ID);
  appPid = out.trim();
  return out.trim();
}

async function main() {
  await guardPorts();
  await new Promise((resolveListen) => director.listen(DIRECTOR_PORT, '127.0.0.1', resolveListen));

  // Fresh managed database each run so the supervisor installs the versioned
  // seed from scratch (the a4-web arm's pre-run shape).
  for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
    rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
  }

  milestones.serverSpawned = new Date().toISOString();
  await spawnDev();
  const basePort = ready.port;
  milestones.serverReady = new Date().toISOString();

  // Host-side personas over the same public package: cora = independent
  // verification client (cohost), gil = second device (guest), max = outsider.
  cora = await signInHost('cora@sweep-a4expo.test', 'cora');
  gil = await signInHost('gil@sweep-a4expo.test', 'gil-device2');
  max = await signInHost('max@sweep-a4expo.test', 'max');
  await cora.client.mutate(api.redeemInvite, { args: { code: 'INV-COHOST-5521', name: 'Cora', enteredVia: 'code' } });
  await gil.client.mutate(api.redeemInvite, { args: { code: 'INV-GUEST-7008', name: 'Gil', enteredVia: 'code' } });

  // Fresh app install. Observed by the a1-expo arm (cited): expo-secure-store
  // keychain entries SURVIVE app uninstall on the iOS simulator, so pre-run
  // hygiene resets the simulator keychain (test infrastructure; the receipt's
  // own logout evidence in EXPO-10 is app-mediated).
  // Deep-link hygiene (test infrastructure, discovered by this arm): iOS
  // shows a one-time 'Open in "<app>"?' confirmation for a custom scheme's
  // first open, which no headless simctl surface can answer. The approval
  // store is the simulator's com.apple.launchservices.schemeapproval.plist;
  // pre-approving the shell's sweepshell scheme there (while the device is
  // shut down) lets simctl openurl deliver without a UI tap. The dialog is
  // an OS product fact worth recording — a real user DOES see it once.
  simctlQuiet('shutdown', UDID);
  execFileSync('/usr/bin/plutil', [
    '-replace', 'com\\.apple\\.CoreSimulator\\.CoreSimulatorBridge-->sweepshell',
    '-string', BUNDLE_ID,
    `/Users/ccheever/Library/Developer/CoreSimulator/Devices/${UDID}/data/Library/Preferences/com.apple.launchservices.schemeapproval.plist`,
  ], { encoding: 'utf8' });
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
      webCryptoPrerequisite: 'consumer crypto polyfill required before any Snapback import (finding 0137-a1expo-f1, cited — not re-filed)',
      screenshot: screenshot('signed-out'),
    };
    return { note: `release artifact launched clean (pid ${appPid}); signed-out boot witnessed; f1 polyfill prerequisite cited` };
  });

  // ---------- EXPO-01-IDENTITIES ----------
  await check('EXPO-01-IDENTITIES', async () => {
    const ping = await mustCmd('ping');
    const appPkg = JSON.parse(readFileSync(resolve(root, '..', 'expo-app', 'package.json'), 'utf8'));
    const closure = {};
    for (const name of ['@expo/snapback-client', '@expo/snapback-react', 'expo', 'expo-crypto', 'expo-secure-store', 'expo-status-bar', 'react', 'react-native', 'typescript']) {
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
        appId: 'event-app',
        targetProfile: 'local-dev-sqlite-ibex (fresh isolated, arm-owned)',
        backendSources: 'schema/functions/seed adopted verbatim from the a4-snapback-web arm records (assistance event)',
      },
    };
    return { note: `expo ${closure.expo} / RN ${closure['react-native']} / client 0.1.7 / iOS ${ping.platformVersion} sim / sha ${artifactSha.slice(0, 12)}…` };
  });

  // ---------- EXPO-03-NATIVE-AUTH (email-code entry + invite deep link) ----------
  await check('EXPO-03-NATIVE-AUTH', async () => {
    milestones.authStart = new Date().toISOString();
    const { challengeId } = await mustCmd('requestCode', { email: hana.email });
    // The capture mailbox is read host-side under admin custody (the guide
    // forbids fetching the process-local mailbox from the phone); the
    // director relays the code exactly as the user reading their email would.
    const code = await mailboxCode(challengeId);
    const exchanged = await mustCmd('exchange', { challengeId, code, email: hana.email, name: 'Hana' }, 30_000);
    hana.userId = exchanged.userId;
    assert(typeof hana.userId === 'string' && hana.userId.length > 0, 'server-minted principal');
    const ping = await mustCmd('ping');
    assert(ping.phase === 'ready', 'app reached ready after exchange');
    // Deep-link return: the OS-level invite deep link (the shell's
    // sweepshell:// scheme). simctl openurl delivers it to the running app,
    // which parses the code exactly as the web arm's src/main.tsx parses
    // ?invite= and redeems through the same authority-creating mutation.
    eventCursor = events.length;
    simctl('openurl', UDID, `sweepshell://invite?code=INV-HOST-2214`);
    const received = await waitEvent((e) => e.type === 'deep-link-received', 'deep link received', 15_000);
    assert(received.code === 'INV-HOST-2214', `deep link code parsed (${received.code})`);
    const redeemed = await waitEvent((e) => e.type === 'deep-link-redeemed', 'deep link redeemed', 20_000);
    const settlement = redeemed.settlement?.result ?? {};
    assert(settlement.eventId === EVENT, 'redeem settled with the event id');
    assert(settlement.role === 'host' && settlement.enteredVia === 'deep-link', 'attributed deep-link entry');
    // Attribution verified independently of the device (kernel rule).
    const roster = await cora.client.query(api.guestList, { args: { eventId: EVENT } });
    const hanaRow = roster.rows.find((r) => r.name === 'Hana');
    assert(hanaRow && hanaRow.enteredVia === 'deep-link' && hanaRow.invitedByName === 'fixture', 'entry attributed on the roster');
    const detail = await cora.client.query(api.hostEventDetail, { args: { eventId: EVENT } });
    const invite = detail.rows[0]?.invites?.find((i) => i.code === 'INV-HOST-2214');
    assert(invite?.consumed === true, 'invite consumed');
    // Replay negative: the consumed code is not redeemable by another principal.
    let replay = null;
    try {
      await max.client.mutate(api.redeemInvite, { args: { code: 'INV-HOST-2214', name: 'Max', enteredVia: 'deep-link' } });
      replay = 'RESOLVED (defect)';
    } catch (err) { replay = diagCode(err); }
    assert(replay !== 'RESOLVED (defect)', 'consumed invite replay refused');
    evidence['EXPO-03'] = {
      shape: 'in-app email-code entry (guide auth/native-apps.md shape 1): /auth/request-code and /auth/exchange executed on-device; code relayed by the director as the user',
      deepLink: {
        url: 'sweepshell://invite?code=INV-HOST-2214 via simctl openurl (OS-level deep link into the running app)',
        osConfirmationDialog: 'iOS asks Open in "<app>"? on a custom scheme\'s first open; headless runs pre-approve via the simulator schemeapproval plist (test infrastructure) — a real user answers it once',
        parsedCode: received.code,
        settlement,
        rosterAttribution: { name: hanaRow?.name, enteredVia: hanaRow?.enteredVia, invitedByName: hanaRow?.invitedByName, status: hanaRow?.status },
        inviteConsumed: invite?.consumed === true,
        replayRefusal: replay,
      },
      userId: hana.userId,
      screenshot: screenshot('authed-host-via-deeplink'),
    };
    return { note: `on-device email-code exchange minted ${hana.userId.slice(0, 8)}…; OS deep link redeemed the host invite (attributed enteredVia=deep-link, invite consumed, replay ${replay})` };
  });

  // ---------- EXPO-04-REALTIME ----------
  await check('EXPO-04-REALTIME', async () => {
    // Initial authoritative data on the device: seeded event (6/12 seats),
    // 3 wall posts, roster with the three redeemed seats.
    const initial = await until(() => {
      const snap = latestState('event');
      const view = snap?.eventView?.rows?.[0];
      return view && view.goingSeats === 6 && snap?.wall?.rows?.length === 3 ? snap : null;
    }, 'device renders the seeded event (6/12 seats, 3 wall posts)', 20_000);
    // Independently verified (kernel rule).
    const authoritative = await cora.client.query(api.guestEventView, { args: { eventId: EVENT } });
    assert(authoritative.rows[0].goingSeats === 6 && authoritative.rows[0].capacity === 12, 'authoritative seats independent of the UI');
    const wallCount = (await cora.client.query(api.wallFeed, { args: { eventId: EVENT } })).rows.length;
    assert(wallCount === 3, 'authoritative wall count');
    // Private member fact rendered on-device (address), never anonymous:
    assert(initial.eventView.rows[0].privateAddress === '482 Alcatraz Ave, backyard gate code 7311', 'member-only address rendered for the seated host');
    const anon = await anonQuery('eventPreview', { slug: SLUG });
    assert(anon.status === 200 && anon.body?.rows?.[0] && !('privateAddress' in anon.body.rows[0]), 'anonymous preview excludes the address');
    // Outsider negative (kernel rule): max cannot read or subscribe.
    let outsider = null;
    try {
      await max.client.query(api.guestEventView, { args: { eventId: EVENT } });
      outsider = 'RESOLVED (defect)';
    } catch (err) { outsider = diagCode(err); }
    assert(outsider === 'SNAPBACK_AUTH_PERMISSION_DENIED', `outsider denied (${outsider})`);
    // Second-device realtime transitions: gil posts to the wall and RSVPs.
    const t0 = Date.now();
    await gil.client.mutate(api.postWall, {
      args: { eventId: EVENT, body: 'Rolling in from Temescal — anyone need a ride?', clientKey: 'a4x-gil-wall-1', authorName: 'Gil' },
    });
    const wallTransition = await waitEvent((e) =>
      e.type === 'state' && e.name === 'event'
      && e.snapshot?.wall?.rows?.some((row) => row.body?.includes('Temescal')),
    'gil wall post visible on device', 15_000);
    const wallLatency = wallTransition.receivedAt - t0;
    const t1 = Date.now();
    await gil.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 0 } });
    const seatTransition = await waitEvent((e) =>
      e.type === 'state' && e.name === 'event'
      && e.snapshot?.eventView?.rows?.[0]?.goingSeats === 7,
    'gil RSVP raises the on-device seat count to 7', 15_000);
    const seatLatency = seatTransition.receivedAt - t1;
    // Attribution: the wall author on-device is the server principal.
    const deviceWallRow = wallTransition.snapshot.wall.rows.find((row) => row.body?.includes('Temescal'));
    assert(deviceWallRow.authorId === gil.userId, 'wall author attributed to the server principal on-device');
    milestones.verifiedRealtime = new Date().toISOString();
    evidence['EXPO-04'] = {
      initial: { goingSeats: 6, capacity: 12, wallPosts: 3, privateAddressRendered: true },
      independentAuthoritative: { goingSeats: authoritative.rows[0].goingSeats, wallPosts: wallCount },
      anonymousBoundary: { status: anon.status, addressAbsent: true, fields: Object.keys(anon.body.rows[0]) },
      outsiderDenial: outsider,
      transitions: {
        wallPost: { latencyMsUpperBound: wallLatency, authorPrincipal: deviceWallRow.authorId },
        seatCount: { latencyMsUpperBound: seatLatency, goingSeats: 7 },
      },
      transport: 'server push over the client stream transport (witness events carry the on-device row state); steady-state caveat 0137-a1expo-f7 cited',
      screenshot: screenshot('realtime-after-gil'),
    };
    return { note: `seeded 6/12 + 3 wall posts rendered + address member-only; outsider ${outsider}; gil wall post ≤${wallLatency}ms and seat count ≤${seatLatency}ms after settlement` };
  });

  // ---------- EXPO-07-QUEUE (offline window 1) ----------
  await check('EXPO-07-QUEUE', async () => {
    const preWall = (await cora.client.query(api.wallFeed, { args: { eventId: EVENT } })).rows.length;
    let defaultOffline = null;
    let storeInfo = null;
    let queueEngagement = null;
    try {
      await stopDev();
      try {
        await mustCmd('mutate', {
          name: 'postWall',
          args: { eventId: EVENT, body: 'Should refuse offline', clientKey: 'a4x-refused', authorName: 'Hana' },
        });
        defaultOffline = 'RESOLVED (unexpected)';
      } catch (err) { defaultOffline = String(err.message); }
      const started = await mustCmd('queueClientStart');
      storeInfo = started.rqsStoreInfo;
      try {
        const queued = await mustCmd('queueClientMutate', {
          name: 'postWall',
          args: { eventId: EVENT, body: 'Queued from the field', clientKey: 'a4x-q1', authorName: 'Hana' },
        });
        queueEngagement = { queued };
      } catch (err) {
        queueEngagement = { error: String(err.message) };
      }
    } finally {
      if (!child) await spawnDev(basePort);
      await until(async () => {
        try { const r = await fetch(`${ready.serverUrl}/health`); return r.ok ? true : null; } catch { return null; }
      }, 'server back', 20_000);
    }

    if (queueEngagement.queued?.queued === true) {
      // Queue engaged (would contradict 0137-a1expo-f2): run settlement legs.
      const replay = await mustCmd('queueClientReplay', {}, 30_000);
      await mustCmd('queueClientDispose');
      const post = await cora.client.query(api.wallFeed, { args: { eventId: EVENT } });
      evidence['EXPO-07'] = { defaultOffline, rqsStoreInfo: storeInfo, queueEngagement, replay, postCount: post.rows.length };
      return { result: storeInfo?.durable === true ? 'pass' : 'gap', note: `queue ENGAGED (contradicts f2 — re-verify) and replayed; store durable=${storeInfo?.durable}` };
    }

    await mustCmd('queueClientDispose').catch(() => {});
    const post = await cora.client.query(api.wallFeed, { args: { eventId: EVENT } });
    assert(post.rows.length === preWall, 'no ghost settlement from the non-engaged queue');
    assert(!post.rows.some((r) => r.clientKey === 'a4x-q1' || r.clientKey === 'a4x-refused'), 'no offline-attempt key ever committed');
    // Online refusal probe: a server-refused mutation surfaces structured and
    // leaves rendered rows authoritative (no optimistic ghost).
    let refusal = null;
    try {
      await mustCmd('mutate', { name: 'updateRsvp', args: { eventId: EVENT, status: 'bogus', plusOnes: 0 } });
      refusal = 'RESOLVED (unexpected)';
    } catch (err) { refusal = String(err.message); }
    assert(refusal !== 'RESOLVED (unexpected)', 'invalid status refused');
    evidence['EXPO-07'] = {
      defaultOfflineBehavior: defaultOffline,
      rqsStoreInfo: storeInfo,
      queueOptInOutcome: queueEngagement,
      noGhostSettlement: { preWall, postWall: post.rows.length },
      refusalRollback: refusal,
      claimBoundary: 'guide clients/react-expo.md: the Expo path is an Online surface and does not claim the durable queue — nonclaim honored; the opt-in non-engagement is finding 0137-a1expo-f2 (cited, re-verified on this arm) and the missing durable store arm is 0137-a1expo-f3 (cited)',
      screenshot: screenshot('queue-not-engaged'),
    };
    return {
      result: 'gap',
      note: `queue unclaimed on this carrier and the opt-in did not engage (f2 re-verified: ${queueEngagement.error?.slice(0, 60)}…); no ghost settlement (wall ${post.rows.length}); online refusal structured`,
    };
  });

  // ---------- EXPO-05-LIFECYCLE ----------
  await check('EXPO-05-LIFECYCLE', async () => {
    await until(() => {
      const snap = latestState('event');
      return snap?.connection?.status === 'live' ? snap : null;
    }, 'connection live before lifecycle legs', 40_000);
    // Background via Settings (the guide's own backgrounding shape).
    execFileSync('xcrun', ['simctl', 'launch', UDID, 'com.apple.Preferences'], { encoding: 'utf8' });
    const backgrounded = await waitEvent((e) => e.type === 'app-state' && (e.state === 'background' || e.state === 'inactive'), 'app backgrounded', 15_000);
    // A second-device commit lands while the app is backgrounded.
    await gil.client.mutate(api.postWall, {
      args: { eventId: EVENT, body: 'Posted while the host phone was backgrounded', clientKey: 'a4x-gil-bg', authorName: 'Gil' },
    });
    await sleep(1_500);
    launchApp();
    await waitEvent((e) => e.type === 'app-state' && e.state === 'active', 'app foregrounded', 15_000);
    await until(() => {
      const snap = latestState('event');
      return snap?.wall?.rows?.some((row) => row.body?.includes('backgrounded')) ? snap : null;
    }, 'foreground catch-up to backgrounded commit', 20_000);
    const fgShot = screenshot('foreground-caught-up');
    // Network loss: the backend origin refuses. Retained rendered rows +
    // honest connection fact, never relabeled live.
    const preLossWall = latestState('event')?.wall?.rows?.length ?? 0;
    assert(preLossWall > 0, 'wall rendered before the network-loss leg');
    await stopDev();
    const staleSnap = await until(() => {
      const snap = latestState('event');
      const conn = snap?.connection?.status;
      return conn && conn !== 'live' && conn !== 'polling' ? snap : null;
    }, 'connection leaves live after network loss', 25_000);
    assert((staleSnap.wall?.rows?.length ?? 0) === preLossWall, 'rendered wall retained through network loss');
    const staleShot = screenshot('network-loss-stale');
    // Reconnect (same origin), live again, and a fresh commit flows.
    await spawnDev(basePort);
    const liveSnap = await until(() => {
      const snap = latestState('event');
      return snap?.connection?.status === 'live' ? snap : null;
    }, 'connection returns live after reconnect', 40_000);
    await gil.client.mutate(api.postWall, {
      args: { eventId: EVENT, body: 'Back online — see everyone Saturday!', clientKey: 'a4x-gil-reconnect', authorName: 'Gil' },
    });
    await until(() => {
      const snap = latestState('event');
      return snap?.wall?.rows?.some((row) => row.body?.includes('Back online')) ? snap : null;
    }, 'post-reconnect commit visible', 20_000);
    evidence['EXPO-05'] = {
      appStateEvents: events.filter((e) => e.type === 'app-state').map((e) => ({ at: e.at, state: e.state })),
      backgroundedVia: 'simctl launch com.apple.Preferences (guide clients/react-expo.md backgrounding shape)',
      backgroundEvent: { state: backgrounded.state },
      foregroundCatchUp: { bodySeen: 'Posted while the host phone was backgrounded' },
      networkLoss: {
        connectionFact: staleSnap.connection?.status,
        wallRetained: staleSnap.wall?.rows?.length,
        neverRelabeledLive: true,
      },
      reconnect: { connectionFact: liveSnap.connection?.status, freshCommitObserved: true },
      screenshots: { foreground: fgShot, stale: staleShot },
    };
    return { note: `background/foreground witnessed (${backgrounded.state}→active, missed wall post caught up); network loss → ${staleSnap.connection?.status} with ${preLossWall} posts retained; reconnect → live with fresh commit` };
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
    await spawnDev(basePort);
    const restored = await waitEvent((e) => e.type === 'session-restored' && e.after === 'offline-cold-boot', 'auto-recovery after cold offline boot', 45_000);
    const authoritative = await cora.client.query(api.wallFeed, { args: { eventId: EVENT } });
    await until(() => {
      const snap = latestState('event');
      return snap?.wall?.rows?.length === authoritative.rows.length ? snap : null;
    }, 'event re-rendered after recovery', 30_000);
    assert(!authoritative.rows.some((r) => r.clientKey === 'a4x-refused' || r.clientKey === 'a4x-q1'), 'no offline-attempt key ever committed');
    evidence['EXPO-06'] = {
      coldRestart: 'simctl terminate + launch with the backend origin refusing',
      storedBearerSurvived: true,
      restoreError: coldFacts.restoreError,
      headlessProbe: coldFacts.headlessProbe,
      retainedStateClaim: 'NOT CLAIMED on this carrier: guide clients/react-expo.md declares the Expo path an Online surface with no local-first claim; the client rqs default store resolves to the in-memory arm on React Native (finding 0137-a1expo-f3, cited — not re-filed), so no cold-boot retained render is claimable',
      recovery: { sessionRestored: true, afterMs: restored.receivedAt - boot.receivedAt },
      screenshots: { offline: offlineShot, recovered: screenshot('cold-restart-recovered') },
    };
    return {
      result: 'gap',
      note: `cold restart clean (bearer survived via app keychain custody; binding refuses offline: ${coldFacts.restoreError?.code ?? coldFacts.restoreError?.message}); retained render unclaimed on this carrier (rqs store=${store?.implementation}, durable=${store?.durable}) → GAP per f3 (cited); auto-recovered when backend returned`,
    };
  });

  // ---------- EXPO-08-FILES (flyer selection/upload from the device) ----------
  await check('EXPO-08-FILES', async () => {
    milestones.flyerUploadStart = new Date().toISOString();
    const flyerPng = buildPng(64, 48, 200);
    const uploaded = await mustCmd('uploadFlyer', {
      intent: 'flyerUpload',
      filename: 'lantern-flyer.png',
      base64: flyerPng.toString('base64'),
    }, 60_000);
    assert(uploaded.stage === 'complete', `on-device upload completed (${JSON.stringify(uploaded).slice(0, 300)})`);
    assert(uploaded.finalize?.task?.availability === 'ready', 'flyer published ready');
    flyerAssetId = uploaded.assetId;
    // Owner strict reads from the device: primary + renditions. Content
    // identity = the served primary digest, stable across reads (strip
    // re-encodes canonical bytes, so primary != uploaded — the a4-web arm
    // recorded the same fact).
    const primary = await mustCmd('readAsset', { assetId: flyerAssetId, variant: 'primary' }, 30_000);
    assert(primary.status === 200 && primary.pngMagic === true, `primary strict read on-device (${primary.status})`);
    const primaryAgain = await mustCmd('readAsset', { assetId: flyerAssetId, variant: 'primary' }, 30_000);
    assert(primary.sha256 === primaryAgain.sha256, 'served primary digest stable across reads (content identity)');
    assert(String(primary.cacheControl ?? '').includes('no-store'), 'strict delivery is no-store');
    // Renditions generate asynchronously — poll like the a4-web arm did.
    const card = await until(async () => {
      const r = await mustCmd('readAsset', { assetId: flyerAssetId, variant: 'card' }, 30_000);
      return r.status === 200 ? r : null;
    }, 'card rendition ready on-device', 20_000);
    const thumb = await until(async () => {
      const r = await mustCmd('readAsset', { assetId: flyerAssetId, variant: 'thumb' }, 30_000);
      return r.status === 200 ? r : null;
    }, 'thumb rendition ready on-device', 20_000);
    assert(card.contentType === 'image/png' && card.pngMagic === true, 'card rendition is a PNG on-device');
    assert(thumb.contentType === 'image/png', 'thumb rendition is a PNG on-device');
    // Reference the flyer from the queryable row (plain-string reference —
    // finding 0137-a1-f1 workaround, cited) and watch the live view + the
    // native Image component pick it up.
    await mustCmd('mutate', { name: 'setFlyerRef', args: { eventId: EVENT, assetId: flyerAssetId } });
    await until(() => {
      const snap = latestState('event');
      return snap?.eventView?.rows?.[0]?.flyerAssetId === flyerAssetId ? snap : null;
    }, 'flyer reference visible on the live view', 15_000);
    const imageOutcome = await waitEvent((e) => e.type === 'flyer-image', 'native Image load outcome', 20_000);
    const flyerShot = screenshot('flyer-rendered');
    // Anonymous preview reflects the flyer fact without leaking bytes.
    const anon = await anonQuery('eventPreview', { slug: SLUG });
    assert(anon.body?.rows?.[0]?.hasFlyer === true, 'public preview hasFlyer=true');
    const anonBytes = await mustCmd('readAsset', { assetId: flyerAssetId, variant: 'card', anonymous: true }, 30_000);
    assert(anonBytes.status !== 200, `anonymous byte read refused (${anonBytes.status})`);
    // Known 0.1.7 hole (cited, not re-filed): no non-owner viewer is
    // authorizable — typed attach refuses (0137-a1-f2) so membership
    // assetSharing is unreachable, and the pasteable lanes 404 (0137-a4-f3).
    let attachProbe = null;
    try {
      await mustCmd('mutate', { name: 'attachFlyer', args: { eventId: EVENT, assetId: flyerAssetId } });
      attachProbe = 'RESOLVED (fixed?)';
    } catch (err) { attachProbe = String(err.message).slice(0, 120); }
    let gilRead = null;
    try {
      const res = await fetch(`${ready.serverUrl}/assets/records/${flyerAssetId}/bytes/card`, {
        headers: { authorization: `Bearer ${gil.token}`, 'x-snapback-auth-client-protocol': '1' },
      });
      gilRead = res.status;
    } catch (err) { gilRead = String(err.message); }
    evidence['EXPO-08'] = {
      selection: 'deterministic PNG fixture delivered to the app by the director; the app treats it as the selected file (no interactive picker drivable headlessly on the simulator — recorded honestly)',
      uploadPath: 'on-device raw attempt/TUS/finalize over expo/fetch (packaged client exposes no upload helper — 0137-a1-f3 cited); Uint8Array TUS body + sha256 upload-checksum computed on-device via the f1 polyfill',
      uploaded: { assetId: flyerAssetId, tusStatus: uploaded.tusStatus, availability: uploaded.finalize?.task?.availability },
      contentIdentity: {
        uploadedSha256: sha256hex(flyerPng),
        primarySha256: primary.sha256,
        primaryEqualsUploaded: primary.sha256 === sha256hex(flyerPng),
        stableAcrossReads: primary.sha256 === primaryAgain.sha256,
        note: 'strip re-encodes canonical bytes (same fact the a4-web arm recorded); identity is the stable served digest',
      },
      strictDelivery: { primary: { status: primary.status, cacheControl: primary.cacheControl }, card: { status: card.status, contentType: card.contentType, sha256: card.sha256 }, thumb: { status: thumb.status, contentType: thumb.contentType } },
      nativeRender: { outcome: imageOutcome.outcome, detail: imageOutcome.detail ?? null, path: 'RN <Image source={{uri, headers}}> against the strict per-request-authorized byte lane' },
      publicBoundary: { hasFlyer: true, anonymousByteRead: anonBytes.status },
      nonOwnerHole: {
        attachProbe,
        seatedGuestStrictRead: gilRead,
        owned: 'no non-owner viewer authorizable on 0.1.7: typed attach refuses (0137-a1-f2, re-verified here), membership assetSharing unreachable, pasteable lanes unimplemented (0137-a4-f3); the ctx.fetch/effects fixes on main (117dcae2) are post-0.1.7 and NOT in this arm\'s pinned packages',
      },
      screenshot: flyerShot,
    };
    return { note: `on-device upload → ready (asset ${String(flyerAssetId).slice(0, 12)}…); served primary digest stable (strip re-encodes canonical bytes, a4-web fact); card+thumb renditions on-device; native Image ${imageOutcome.outcome}; anonymous bytes refused (${anonBytes.status}); non-owner hole re-verified (attach: ${attachProbe?.slice(0, 40)}…, guest read ${gilRead})` };
  });

  // ---------- EXPO-09-PUSH ----------
  await check('EXPO-09-PUSH', async () => {
    // Explicit GAP: Snapback 0.1.7 has no push-notification boundary. The
    // capability index row backend.notifications is design-only with an
    // explicit notifications:false manifest gap; nothing in the packaged
    // client registers device tokens or integrates APNs/expo-notifications;
    // and the app-authored bridge (an action posting to a push provider) is
    // unauthorable on 0.1.7 because the outbound effect lane is broken
    // (finding 0137-a4-f1; the ctx.fetch fix 117dcae2 landed on main after
    // the 0.1.7 publication and is not in this arm's pinned packages).
    const manifest = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'capability.manifest.json'), 'utf8'));
    const notifications = manifest?.capabilities?.notifications ?? manifest?.notifications ?? null;
    evidence['EXPO-09'] = {
      boundary: 'none on 0.1.7 — explicit GAP',
      capabilityManifest: { notifications },
      owners: [
        'guide/capabilities.md backend.notifications row: design-only, explicit notifications gap (issues/20260728-guide-gap-assets-and-notifications-capability-rows.md, llp/0045)',
        '0137-a4-f1 (outbound notification effects unauthorable on packaged 0.1.7; fixes on main at 117dcae2/7437e6e0 are post-publication)',
        '0137-a1expo-f5 (no hosted mobile path, so no production push relay either)',
      ],
      newFinding: '0137-a4expo-f1-no-mobile-push-notification-boundary (the mobile-specific fact: no device-token registration or APNs/FCM/expo-notifications lane exists in the packaged closure or guide)',
      applicationLedger: 'the A4 app-authored notifyIntents/notifyAttempts ledger exists in this backend (adopted from the web arm) but is application code, not a product push boundary; its provider call is unreachable on 0.1.7 (a4-f1)',
    };
    return {
      result: 'gap',
      note: 'no push-notification boundary on 0.1.7 (capability row design-only; no device-token/APNs lane in the packaged closure; app-authored bridge blocked by a4-f1) — explicit GAP, new mobile-scoped finding filed',
    };
  });

  // ---------- EXPO-10-AUTHORITY-ROTATION ----------
  await check('EXPO-10-AUTHORITY-ROTATION', async () => {
    // Rotation to a lesser-privileged principal (max holds no seat) via the
    // documented explicit replacement-bearer transition.
    const rotation = await mustCmd('replaceBearer', { token: max.token, userId: max.userId, email: max.email }, 30_000);
    const denied = await until(() => {
      const snap = latestState('event');
      const view = snap?.eventView;
      const blanked = !view?.rows || view.rows.length === 0;
      const notPresentingLive = view?.error || view?.status !== 'ready';
      return blanked && notPresentingLive ? snap : null;
    }, 'predecessor rows blanked after rotation', 25_000);
    const rotatedShot = screenshot('rotated-to-outsider');
    // Rotate back to Hana under a fresh session: does the client re-subscribe?
    const hanaBack = await signInHost(hana.email, 'hana-rotate-back');
    const rotateBack = await mustCmd('replaceBearer', { token: hanaBack.token, userId: hana.userId, email: hana.email }, 30_000);
    const authoritativeWall = (await cora.client.query(api.wallFeed, { args: { eventId: EVENT } })).rows.length;
    let rotateBackRecovered = true;
    let rotateBackFacts = null;
    try {
      await until(() => {
        const snap = latestState('event');
        return snap?.wall?.rows?.length === authoritativeWall ? snap : null;
      }, 'rows return under restored authority', 30_000);
    } catch (err) {
      rotateBackRecovered = false;
      const snap = latestState('event');
      rotateBackFacts = {
        error: String(err.message),
        lastSnapshot: {
          connection: snap?.connection?.status,
          eventView: { status: snap?.eventView?.status, error: snap?.eventView?.error, rows: snap?.eventView?.rows?.length ?? null },
          wall: { status: snap?.wall?.status, error: snap?.wall?.error, rows: snap?.wall?.rows?.length ?? null },
        },
      };
    }
    // Logout: clear the bearer; protected state blanks; keychain cleared.
    await mustCmd('replaceBearer', { token: null }, 30_000);
    await waitEvent((e) => e.type === 'logout', 'logout witnessed', 15_000);
    await until(() => {
      const snap = latestState('event');
      return !snap?.eventView?.rows || snap.eventView.rows.length === 0 ? snap : null;
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
      rotation: {
        to: 'outsider (max, no seat) via the documented explicit replacement-bearer transition',
        predecessorRowsBlanked: true,
        successorOutcome: denied.eventView?.error ?? denied.eventView?.status,
        lifecycleFailures: rotation?.lifecycleFailures ?? null,
        rotateBackLifecycleFailures: rotateBack?.lifecycleFailures ?? null,
      },
      rotateBackRecovered,
      rotateBackFacts,
      owned: 'finding 0137-a1expo-f4 (cited, re-verified on this arm — not re-filed): the downgrade transition rejects with AggregateError although custody completes, the successor denial never reaches the hook, and rotate-back does not re-subscribe attached handles',
      logout: { witnessed: true, rowsBlanked: true },
      retirement: {
        keychainCleared: true,
        relaunchPhase: ping.phase,
        deviceAtRest: 'no durable client store exists on this carrier (in-memory rqs arm, f3) and the app-owned keychain entry is deleted on logout — no protected bytes at rest',
      },
      screenshots: { rotated: rotatedShot, loggedOut: logoutShot, relaunch: screenshot('post-logout-relaunch') },
    };
    return {
      result: rotateBackRecovered ? 'pass' : 'fail',
      note: `rotation blanked predecessor rows (successor denial ${denied.eventView?.error ?? denied.eventView?.status}; lifecycle-failures AggregateError ${rotation?.lifecycleFailures ? 'observed' : 'absent'}); rotate-back ${rotateBackRecovered ? 'recovered' : `DID NOT recover (f4 re-verified: ${rotateBackFacts?.lastSnapshot?.connection})`}; logout blanked + cleared keychain; relaunch boots signed-out`,
    };
  });

  milestones.localAcceptance = new Date().toISOString();

  // ---------- EXPO-11-TEARDOWN ----------
  await check('EXPO-11-TEARDOWN', async () => {
    simctlQuiet('terminate', UDID, BUNDLE_ID);
    simctl('uninstall', UDID, BUNDLE_ID);
    // Retire the flyer asset (owner delete), then the seats (self-removal —
    // membership rows are unseedable/unresettable, 0137-a3-f1 cited), then a
    // receipted versioned reset-install back to the literal seed.
    const hanaAdmin = await signInHost(hana.email, 'hana-teardown');
    const deleted = await fetch(`${ready.serverUrl}/assets/records/${flyerAssetId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${hanaAdmin.token}`, 'x-snapback-auth-client-protocol': '1' },
    });
    const postDelete = await fetch(`${ready.serverUrl}/assets/records/${flyerAssetId}/bytes/card`, {
      headers: { authorization: `Bearer ${hanaAdmin.token}`, 'x-snapback-auth-client-protocol': '1' },
    });
    await hanaAdmin.client.mutate(api.setFlyerRef, { args: { eventId: EVENT, assetId: '' } });
    for (const seat of [hanaAdmin, cora, gil]) {
      await seat.client.mutate(api.leaveEvent, { args: { eventId: EVENT } });
    }
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: hanaAdmin.token, adminToken, rqsStore: null });
    hostClients.push(admin);
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const stream = preview?.current?.dataVersionStream;
    assert(typeof stream === 'string' && stream.length > 0, 'active data version stream discovered');
    const receipt = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: stream },
    });
    assert(receipt.operation === 'reset-install' && receipt.outcome === 'reset-installed', 'reset-install settled');
    // Post-cleanup verification: the literal fixture is back and a fresh
    // session holds no seat.
    const anon = await anonQuery('eventPreview', { slug: SLUG });
    assert(anon.body?.rows?.[0]?.goingSeats === 6 && anon.body.rows[0].hasFlyer === false, 'literal seed restored (6/12, no flyer)');
    const fresh = await signInHost(hana.email, 'hana-verify');
    let negative = null;
    try {
      await fresh.client.query(api.guestEventView, { args: { eventId: EVENT } });
      negative = 'RESOLVED (defect)';
    } catch (err) { negative = diagCode(err); }
    assert(negative === 'SNAPBACK_AUTH_PERMISSION_DENIED', `post-cleanup fresh session denied (${negative})`);
    for (const client of hostClients.splice(0)) { try { await client.closeAuth?.(); } catch { /* teardown */ } }
    await stopDev();
    simctl('shutdown', UDID);
    evidence['EXPO-11'] = {
      app: 'terminated and uninstalled (container removed; keychain entry already cleared by the in-run logout)',
      simulator: `shutdown ${UDID} (booted by this run's build/launch path)`,
      server: 'snapback dev stopped; origin refuses',
      flyer: { deleteStatus: deleted.status, postDeleteRead: postDelete.status },
      seats: 'hana/cora/gil self-removed (membership unseedable/unresettable — 0137-a3-f1 cited)',
      seedReceipt: {
        operation: receipt.operation, outcome: receipt.outcome,
        seedVersion: receipt.seedVersion, resetDeletedRows: receipt.resetDeletedRows,
      },
      postCleanupNegative: { guestEventView: negative, preview: { goingSeats: anon.body.rows[0].goingSeats, hasFlyer: anon.body.rows[0].hasFlyer } },
      credentials: 'session bearers retired by the reset-install stream transition; admin/impersonation token files remain dev-local inside the arm-owned external directory only',
    };
    milestones.cleanup = new Date().toISOString();
    return { note: `app uninstalled, sim shutdown, server stopped; flyer deleted (${deleted.status}→${postDelete.status}); seats self-removed; reset-install deleted ${receipt.resetDeletedRows} rows; fresh session denied (${negative})` };
  });

  // ---------- EXPO-12-INDEPENDENCE ----------
  await check('EXPO-12-INDEPENDENCE', async () => {
    let javaHome = null;
    try { execFileSync('/usr/libexec/java_home', [], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); javaHome = 'present'; }
    catch { javaHome = 'absent'; }
    evidence['EXPO-12'] = {
      claim: 'expo-ios simulator only. Nothing in this receipt establishes Android behavior (LLP 0064); the android arm is an honest not-run GAP with the same blocker the a1-expo arm recorded (cited): the host has no JDK, so expo run:android/gradle cannot execute.',
      jdk: javaHome,
    };
    assert(javaHome === 'absent', 'android blocker re-verified (JDK absent)');
    return { note: 'receipt claims iOS simulator only; android honest not-run (JDK absent, re-verified; a1-expo disposition cited)' };
  });

  // ---------- report ----------
  const failed = results.filter((r) => r.result === 'fail').length;
  const report = {
    schemaVersion: 1,
    protocolId: 'llp-0137-improvement-sweep-v1',
    arm: { contract: 'a4', platform: 'expo-ios', provider: 'snapback', attemptId: 'a4-expo-ios-20260801' },
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

// 0137 A1-Expo f7 evidence rerun driver — host half.
// Reproduces the A1 idle shape (signed-in provider holding the retainable
// public listSites + protected listRecords over the react hooks) on an iOS
// simulator, holds it idle, and collects the landed loss-detail
// instrumentation (closeCode / closeReason / errorPreceded / sinceOpenMs)
// from every live-stream manager state transition. Adapted from
// demos/rn-durable-store-witness/b1-run-ios.mjs (loopback director/witness
// pattern — test infrastructure, not a production endpoint design).
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.env.F7_ROOT ?? resolve(process.env.HOME, 'f7-rerun');
const REPO = process.env.F7_REPO ?? resolve(process.env.HOME, 'projects/snapback');
const UDID = process.env.F7_UDID;
const APP_PATH = process.env.F7_APP_PATH;
const IDLE_HOLD_MS = Number(process.env.F7_IDLE_HOLD_MS ?? 150_000);
const BUNDLE_ID = 'dev.snapback.improvementsweep.shell';
const DIRECTOR_PORT = 4610;
if (!UDID || !APP_PATH) throw new Error('F7_UDID and F7_APP_PATH are required');

const evidenceDir = join(ROOT, 'evidence');
mkdirSync(evidenceDir, { recursive: true });
const readyFile = join(ROOT, '.snapback', 'dev.ready.json');

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
  const file = join(evidenceDir, `f7-shot-${shotIndex++}-${label}.png`);
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

// ---------- dev server (repo CLI + repo runtime binary, same sha) ----------
let child = null;
let ready = null;
let adminToken = null;
let impersonation = null;
const lifecycleEvents = [];
async function spawnDev() {
  // Default: the repo CLI + repo runtime binary (same sha). F7_CLI overrides
  // to a consumer-installed published CLI (whose own packaged runtime binary
  // then serves) for era-faithful runs against the 0.1.8 closure.
  const cliPath = process.env.F7_CLI ?? join(REPO, 'packages/snapback-cli/cli.mjs');
  const env = { ...process.env };
  if (!process.env.F7_CLI) env.SNAPBACK_RUNTIME_BINARY = join(REPO, 'target/debug/snapback');
  child = spawn(process.execPath, [cliPath, 'dev', 'snapback'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
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
      return lifecycleEvents.slice(startedFrom).some((e) => e.state === 'generated-and-loaded') ? descriptor : null;
    } catch { return null; }
  }, 'dev ready', 120_000);
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

const evidence = { startedAt: new Date().toISOString(), idleHoldMs: IDLE_HOLD_MS };

function lossSummary(streamEvents) {
  const lost = streamEvents.filter((e) => e.state === 'lost');
  const byKey = new Map();
  for (const e of lost) {
    const d = e.detail ?? {};
    const key = JSON.stringify({
      closeCode: d.closeCode ?? null,
      closeReason: d.closeReason ?? null,
      errorPreceded: d.errorPreceded ?? null,
      wasOpen: d.wasOpen ?? null,
    });
    if (!byKey.has(key)) byKey.set(key, { signature: JSON.parse(key), count: 0, sinceOpenMs: [] });
    const bucket = byKey.get(key);
    bucket.count += 1;
    if (typeof d.sinceOpenMs === 'number') bucket.sinceOpenMs.push(d.sinceOpenMs);
  }
  const stats = (xs) => (xs.length === 0 ? null : {
    n: xs.length,
    min: Math.min(...xs),
    max: Math.max(...xs),
    mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
  });
  return {
    totalLost: lost.length,
    signatures: [...byKey.values()].map((b) => ({ ...b, sinceOpenMs: stats(b.sinceOpenMs) })),
  };
}

async function main() {
  await new Promise((resolveListen) => director.listen(DIRECTOR_PORT, '127.0.0.1', resolveListen));
  for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
    rmSync(join(ROOT, '.snapback', `dev.sqlite3${suffix}`), { force: true });
  }
  await spawnDev();

  execFileSync('xcrun', ['simctl', 'bootstatus', UDID, '-b'], { encoding: 'utf8' });
  simctlQuiet('terminate', UDID, BUNDLE_ID);
  simctlQuiet('uninstall', UDID, BUNDLE_ID);
  simctlQuiet('keychain', UDID, 'reset');
  simctl('install', UDID, APP_PATH);
  eventCursor = events.length;
  simctl('launch', UDID, BUNDLE_ID);

  const boot = await waitEvent((e) => e.type === 'boot', 'boot', 60_000);
  assert(boot.hadStoredBearer === false, 'fresh install boots without a bearer');
  const ping = await mustCmd('ping');
  assert(ping.hermes === true, 'Hermes on-device');
  evidence.identities = {
    platform: `${ping.platform} ${ping.platformVersion}`,
    hermes: ping.hermes,
    simulator: UDID,
    server: `${ready.serverUrl} (repo dev server, runtime binary @ origin/main)`,
    app: APP_PATH,
  };

  // Sign in on-device (alice — the A1 idle-shape principal).
  const { challengeId } = await mustCmd('requestCode', { email: 'alice@f7-evidence.test' });
  const code = await mailboxCode(challengeId);
  const { userId } = await mustCmd('exchange', { challengeId, code }, 90_000);
  evidence.userId = userId;

  // Raw-stack diagnosis: the same subscribe machinery headless, before the
  // provider mounts and starts any retry loop.
  try {
    evidence.headlessProbe = await mustCmd('headlessProbe', { name: 'listSites', connectionId: 'f7_headless', holdMs: 3000 }, 60_000);
  } catch (error) {
    evidence.headlessProbe = { driverError: String(error?.message ?? error) };
  }

  // The A1 shape: a workspace with protected rows + the public sites list.
  // Every step is best-effort: if the transport is broken at HEAD the idle
  // hold + witness capture must still happen — a broken step is itself
  // evidence, not a reason to abort.
  evidence.setupFailures = [];
  let workspaceId = null;
  try {
    workspaceId = (await mustCmd('mutate', { name: 'createWorkspace', args: { name: 'F7 evidence workspace' } }, 60_000)).result;
    for (let i = 0; i < 3; i += 1) {
      await mustCmd('mutate', {
        name: 'createRecord',
        args: {
          workspaceId,
          title: `F7 record ${i + 1}`,
          assigneeId: userId,
          assigneeName: 'Alice',
          dueAt: 1785542400000,
          position: 1000 + i,
          clientKey: `f7-r${i + 1}`,
        },
      }, 60_000);
    }
    await mustCmd('setWorkspace', { workspaceId });
  } catch (error) {
    evidence.setupFailures.push({ step: 'workspace-and-records', error: String(error?.message ?? error) });
  }

  // Wait until the notebook presents both queries (best-effort).
  try {
    await waitEvent(
      (e) => e.type === 'state' && e.name === 'notebook'
        && e.snapshot?.sites?.rows === 3 && e.snapshot?.records?.rows === 3,
      'notebook presents 3 sites + 3 records',
      60_000,
    );
  } catch (error) {
    evidence.setupFailures.push({ step: 'notebook-presentation', error: String(error?.message ?? error) });
  }
  screenshot('hold-start');

  // The idle hold this rerun exists for: nothing touches the app or the
  // server; the witness collects every stream-state transition.
  const holdStart = Date.now();
  evidence.holdStartedAt = new Date(holdStart).toISOString();
  await sleep(IDLE_HOLD_MS);
  const holdEnd = Date.now();
  screenshot('hold-end');

  const streamEvents = events
    .filter((e) => e.type === 'stream-state')
    .map((e) => ({ at: e.at, receivedAt: e.receivedAt, connectionId: e.connectionId, state: e.state, detail: e.detail ?? null }));
  const holdStream = streamEvents.filter((e) => e.receivedAt >= holdStart && e.receivedAt <= holdEnd);
  const notebookStates = events.filter((e) => e.type === 'state' && e.name === 'notebook');
  evidence.hold = {
    durationMs: holdEnd - holdStart,
    streamTransitions: holdStream.length,
    lostDuringHold: lossSummary(holdStream),
    lostOverall: lossSummary(streamEvents),
    connectionStatusFlips: notebookStates
      .filter((e) => e.receivedAt >= holdStart)
      .map((e) => ({ receivedAt: e.receivedAt, status: e.snapshot?.connection?.status, sites: e.snapshot?.sites?.status, siteRows: e.snapshot?.sites?.rows, records: e.snapshot?.records?.status, recordRows: e.snapshot?.records?.rows })),
  };
  const finalNotebook = notebookStates.at(-1)?.snapshot ?? null;
  evidence.finalNotebook = finalNotebook;
  const distinctErrors = new Map();
  for (const e of notebookStates) {
    for (const q of ['sites', 'records']) {
      const err = e.snapshot?.[q]?.error;
      if (err && typeof err === 'object') {
        const key = `${q}:${err.code}:${err.message}`;
        if (!distinctErrors.has(key)) distinctErrors.set(key, { query: q, ...err, firstAt: e.receivedAt, count: 0 });
        distinctErrors.get(key).count += 1;
      }
    }
  }
  evidence.queryErrors = [...distinctErrors.values()];
  evidence.tapHeartbeats = events.filter((e) => e.type === 'tap-heartbeat').map((e) => ({ receivedAt: e.receivedAt, managerCount: e.managerCount }));

  // Teardown.
  simctlQuiet('terminate', UDID, BUNDLE_ID);
  simctlQuiet('uninstall', UDID, BUNDLE_ID);
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(evidenceDir, 'f7-evidence.json'), JSON.stringify(evidence, null, 2));
  writeFileSync(join(evidenceDir, 'f7-witness-events.json'), JSON.stringify(events, null, 2));
  console.error(`F7 EVIDENCE CAPTURED: ${evidence.hold.streamTransitions} stream transitions during ${Math.round((holdEnd - holdStart) / 1000)}s idle hold; lost=${evidence.hold.lostDuringHold.totalLost}`);
}

try {
  await main();
} catch (error) {
  console.error('f7 driver error:', error);
  process.exitCode = 2;
} finally {
  try { await stopDev(); } catch { /* already down */ }
  director.close();
  writeFileSync(join(evidenceDir, 'f7-witness-events.json'), JSON.stringify(events, null, 2));
  setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
}

// LLP 0137 A6 (operations and workflow ledger) acceptance suite —
// Snapback web arm. External-consumer build: public @expo/snapback-* 0.1.7.
// 10 checks, contract demos/improvement-sweep/protocol/contracts/a6-operations-ledger.v1.json.
//
// The suite owns its dev server (SNAPBACK_OUTBOUND_ACTIONS=1 for the
// dispatch effect, SNAPBACK_CRON_DISABLED=1 so every scheduler run is a
// deterministic authenticated tick) and its own local dispatch provider
// server. Fresh managed database every run.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { SnapbackClient, createExternalSessionClient } from '@expo/snapback-client';

const root = resolve(import.meta.dirname);
const evidenceDir = join(root, 'a6-evidence');
mkdirSync(evidenceDir, { recursive: true });

const EXPECTED_CHECKS = 10;
const ORG = 'org_meridian';
const DISPATCH_TOKEN_CANARY = 'tok_a6_dispatch_c4n4ry_7b3f';
const results = [];
const evidence = {};
let child = null;
let ready = null;
let adminToken = null;
let impersonation = null;
let api = null;
let seedArtifact = null;
let artifacts = null;
let seedFixture = null;
const cleanups = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, label, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(25);
  }
};
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }
const diagCode = (err) => err?.diagnostic?.code ?? err?.code ?? String(err?.message ?? err);
// A versioned reset-install resets the authenticated live transport of
// every connected client; the first op after it throws
// SNAPBACK_AUTH_STREAM_RESET once and the client reconnects (arm
// observation, recorded in A6-09 evidence).
const streamResets = [];
const retryOnce = async (label, fn) => {
  try { return await fn(); } catch (err) {
    if (diagCode(err) === 'SNAPBACK_AUTH_STREAM_RESET') {
      streamResets.push(label);
      return await fn();
    }
    throw err;
  }
};
const sha256hex = (data) => createHash('sha256').update(data).digest('hex');

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
    if (process.env.A6_DEBUG) console.error(err?.stack ?? '');
  }
}
// An action refusal surfaces as an ok:false envelope; the original
// diagnostic code is not carried (known 0137-a4-f5 / 0137-a3-f3).
function actionRefusal(env) {
  if (env?.ok === false) {
    return env.error?.code ?? env.error?.diagnostic?.code ?? env.diagnostic?.code
      ?? `NOT_OK:${JSON.stringify(env.error ?? env).slice(0, 200)}`;
  }
  return `ALLOWED (defect): ${JSON.stringify(env?.result ?? env).slice(0, 120)}`;
}

const protocolHeaders = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};

// ---------- local dispatch provider (STRICT: requires the secret) ----------
const providerLedger = { requests: [] };
const providerServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk.toString('utf8'); });
  req.on('end', () => {
    const authValid = String(req.headers.authorization ?? '') === `Bearer ${DISPATCH_TOKEN_CANARY}`;
    let dedupeKey = '';
    try { dedupeKey = JSON.parse(raw).dedupeKey ?? ''; } catch { /* non-JSON */ }
    providerLedger.requests.push({ at: Date.now(), authValid, dedupeKey, bytes: raw.length });
    if (!authValid) { res.statusCode = 401; res.end('bad token'); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, ack: `dispatch ${dedupeKey} accepted` }));
  });
});
await new Promise((res) => providerServer.listen(0, '127.0.0.1', res));
const providerUrl = `http://127.0.0.1:${providerServer.address().port}/dispatch`;
const providerCount = (key) => providerLedger.requests.filter((r) => r.dedupeKey === key).length;

// ---------- dev server lifecycle ----------
const readyFile = join(root, '.snapback', 'dev.ready.json');
const lifecycleEvents = [];
let devStdoutRaw = '';
async function spawnDev() {
  // Own-ports discipline: guard-block prior arms' 4287-4292 during the
  // runtime's port scan; fleet-shared 4420 asserted below.
  const guards = [];
  for (const port of [4287, 4288, 4289, 4290, 4291, 4292]) {
    const guard = createServer(() => {});
    await new Promise((res) => {
      guard.once('error', () => res());
      guard.listen(port, '127.0.0.1', () => res());
    });
    guards.push(guard);
  }
  child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
  });
  let remainder = '';
  child.stdout.on('data', (chunk) => {
    const s = chunk.toString('utf8');
    devStdoutRaw += s;
    remainder += s;
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
  child.stderr.on('data', (chunk) => { devStdoutRaw += chunk.toString('utf8'); });
  ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try {
      const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
      return lifecycleEvents.some((e) => e.state === 'generated-and-loaded') ? descriptor : null;
    } catch { return null; }
  }, 'dev ready', 60_000);
  for (const guard of guards) guard.close();
  assert(ready.port !== 4420, 'must not use fleet-shared port 4420');
  assert(![4287, 4288, 4289, 4290, 4291, 4292].includes(ready.port), 'must not reuse prior arm ports');
  adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
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

async function signIn(email, label) {
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
    method: 'POST', headers: protocolHeaders, body: JSON.stringify({ email }),
  }).then((r) => r.json());
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: {
        'x-snapback-admin-token': adminToken,
        'x-snapback-impersonation-capability': impersonation,
      } },
  ).then((r) => r.json());
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
    method: 'POST', headers: protocolHeaders,
    body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
  }).then((r) => r.json());
  assert(typeof credential.token === 'string', `sign-in failed for ${email}: ${JSON.stringify(credential)}`);
  const client = new SnapbackClient(ready.serverUrl, {
    bearerToken: credential.token,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `sweep-a6-${label}-${process.pid}`,
    rqsStore: null,
  });
  cleanups.push(() => client.closeAuth?.());
  return { client, userId: credential.session.userId, token: credential.token, email, label };
}

const cronTick = () => fetch(`${ready.serverUrl}/_snapback/api/cron/tick`, {
  method: 'POST',
  headers: { 'x-snapback-admin-token': adminToken, 'content-type': 'application/json' },
  body: '{}',
}).then(async (r) => ({ status: r.status, runs: await r.json().catch(() => []) }));

const configCall = (verb, body) => fetch(`${ready.serverUrl}/_snapback/api/config/${verb}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-snapback-admin-token': adminToken, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// jobs_one_off_v1 admin surfaces (capability index row; no guide page yet —
// known GAP, issues/20260730-move3-jobs-slice-0070.md cited).
const jobsDrain = (nowMs) => fetch(`${ready.serverUrl}/_snapback/api/jobs/drain`, {
  method: 'POST',
  headers: { 'x-snapback-admin-token': adminToken, 'content-type': 'application/json' },
  body: JSON.stringify(nowMs === undefined ? {} : { nowMs }),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// The job status route is behind admin secret-read custody
// (SNAPBACK_ADMIN_SECRET_READ_REQUIRED without a lease). The mint proof
// root is local operator authority (ready-file sibling), so the packaged
// CLI mints the lease: `snapback secret-read-mint --ready-file ...`.
let secretReadLease = null;
async function mintSecretReadLease() {
  return await new Promise((res) => {
    execFile(join(root, 'node_modules', '.bin', 'snapback'),
      ['secret-read-mint', '--ready-file', readyFile, '--token', adminToken, '--admin-inspect'],
      { cwd: root }, (err, stdout, stderr) => {
        let body = null;
        try { body = JSON.parse(stdout); } catch { /* not JSON */ }
        secretReadLease = body?.lease ?? body?.result?.lease ?? (typeof body === 'string' ? body : null)
          ?? (stdout && !err ? stdout.trim() : null);
        res({ status: err ? 500 : 200, body: body ?? { stdout: stdout.slice(0, 300), stderr: String(stderr).slice(0, 300) } });
      });
  });
}

const jobsStatus = (jobId) => fetch(`${ready.serverUrl}/_snapback/api/jobs/${encodeURIComponent(jobId)}`, {
  headers: {
    'x-snapback-admin-token': adminToken,
    ...(secretReadLease ? { 'x-snapback-secret-read-lease': secretReadLease } : {}),
  },
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

// ---------- lifecycle ----------
const startedAtIso = new Date().toISOString();
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}

let exitCode = 2;
try {
  await spawnDev();
  api = (await import(`./snapback/generated/api.mjs?v=${Date.now()}`)).default;
  seedArtifact = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'seed.artifact.json'), 'utf8'));
  artifacts = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'artifacts.json'), 'utf8'));
  seedFixture = JSON.parse(readFileSync(join(root, 'snapback', 'seed.json'), 'utf8'));

  const dana = await signIn('dana@sweep-a6.test', 'dana');       // dispatcher
  const opal = await signIn('opal@sweep-a6.test', 'opal');       // operator
  const oscar = await signIn('oscar@sweep-a6.test', 'oscar');    // operator
  const mallory = await signIn('mallory@sweep-a6.test', 'mallory'); // outsider

  const suiteNow = Date.now();
  const HOUR = 3600_000;
  const DAY = 86_400_000;

  // ---------- A6-01-SEED (kernel) ----------
  let customersByName = new Map();
  await check('A6-01-SEED', async () => {
    const ids = new Set([dana.userId, opal.userId, oscar.userId, mallory.userId]);
    assert(ids.size === 4, 'four distinct authenticated principals');
    let preInvite = null;
    try { await dana.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } }); }
    catch (err) { preInvite = diagCode(err); }
    assert(preInvite === 'SNAPBACK_AUTH_PERMISSION_DENIED', `pre-invite denial (${preInvite})`);
    const dispatcherSeat = await dana.client.mutate(api.redeemInvite, { args: { code: 'INV-DISPATCH-5501' } });
    const opalSeat = await opal.client.mutate(api.redeemInvite, { args: { code: 'INV-OP-6601' } });
    const oscarSeat = await oscar.client.mutate(api.redeemInvite, { args: { code: 'INV-OP-6602' } });
    assert(dispatcherSeat.result.role === 'dispatcher' && opalSeat.result.role === 'operator'
      && oscarSeat.result.role === 'operator', 'seeded invite roles');
    const dash = (await dana.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } })).rows[0];
    assert(dash.orgName === 'Meridian Operations', 'org fixture name');
    assert(dash.jobSeq === 3, `seeded sequence counter (${dash.jobSeq})`);
    assert(dash.customers === 4 && dash.jobsTotal === 3, `seeded customers/jobs (${dash.customers}/${dash.jobsTotal})`);
    assert(dash.jobsOpen === 2 && dash.jobsDone === 1 && dash.jobsClaimed === 0 && dash.jobsCancelled === 0,
      'seeded statuses: 2 open, 1 done');
    assert(dash.steps === 7 && dash.stepsDone === 2, `seeded steps (${dash.steps}/${dash.stepsDone})`);
    assert(dash.activityRows === 4, `seeded activity trail (${dash.activityRows})`);
    assert(dash.attemptReceipts === 0 && dash.dispatchReceipts === 0 && dash.maintenanceReceipts === 0
      && dash.followUpReceipts === 0, 'runtime receipt tables named-empty');
    const customers = (await opal.client.query(api.customerList, { args: { orgId: ORG } })).rows;
    assert(customers.length === 4, 'operator reads the customer roster');
    customersByName = new Map(customers.map((c) => [c.name, c._id]));
    // seeded jobs carry their fixture sequence identity and statuses
    const jobs = (await oscar.client.query(api.jobList, { args: { orgId: ORG, fromMs: 0, toMs: 0, status: '' } })).rows;
    assert(JSON.stringify(jobs.map((j) => [j.display, j.status])) === JSON.stringify([
      ['JOB-3', 'open'], ['JOB-2', 'open'], ['JOB-1', 'done'],
    ]), `seeded job identity (${JSON.stringify(jobs.map((j) => j.display))})`);
    for (const seedRow of seedFixture.tables.jobs) {
      const served = jobs.find((j) => j.seq === seedRow.seq);
      assert(served && served.title === seedRow.title && served.status === seedRow.status,
        `seed fidelity for JOB-${seedRow.seq}`);
    }
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: dana.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    assert(preview?.current?.seedVersion === 'a6-ops.2026-08-01.1',
      `installed seed identity (${JSON.stringify(preview?.current)})`);
    evidence['A6-01'] = {
      targetIdentity: {
        serverUrl: ready.serverUrl, port: ready.port,
        appId: artifacts.appId ?? 'ops-app',
        inputsHash: artifacts.inputsHash, authMode: 'sessions',
      },
      authoritativeCounts: {
        customers: dash.customers, jobs: dash.jobsTotal, steps: dash.steps,
        activity: dash.activityRows, invites: 4, members: 3, jobSeq: dash.jobSeq,
        statuses: { open: dash.jobsOpen, claimed: dash.jobsClaimed, done: dash.jobsDone, cancelled: dash.jobsCancelled },
      },
      seedReceipt: {
        seedVersion: preview.current.seedVersion,
        dataVersionStream: preview.current.dataVersionStream ?? null,
      },
      personas: {
        dana: 'dispatcher', opal: 'operator (claiming actor)',
        oscar: 'operator (second claiming actor)', mallory: 'outsider (authenticated, no seat)',
      },
    };
    return { note: 'org + 4 customers + 3 jobs (seq 1-3, statuses split) + 7 steps + 4 activity rows + 4 invites seeded; 4 distinct principals; dispatcher/operator seats claimed' };
  });

  // ---------- A6-02-SEQUENCE ----------
  const jobIdBySeq = new Map();
  const jobBySpecKey = new Map();
  await check('A6-02-SEQUENCE', async () => {
    // Two-actor barrier: six concurrent creates from two distinct
    // authenticated clients race the seq allocator in one Promise.all.
    const specs = [
      { actor: dana, title: 'Inspect: Harborlight cold room', customer: 'Harborlight Clinic', scheduledFor: suiteNow + 1 * HOUR, key: 'run-inspect-harborlight' },
      { actor: opal, title: 'Calibrate: Delta Freight scales', customer: 'Delta Freight', scheduledFor: suiteNow + 2 * HOUR, key: 'run-calibrate-delta' },
      { actor: dana, title: 'Rewire: North Yard panel', customer: 'North Yard', scheduledFor: suiteNow + 3 * HOUR, key: 'run-rewire-northyard' },
      { actor: opal, title: 'Audit: Meridian Foods safety', customer: 'Meridian Foods', scheduledFor: suiteNow + 4 * HOUR, key: 'run-audit-meridian' },
      { actor: dana, title: 'Inventory: Harborlight stockroom', customer: 'Harborlight Clinic', scheduledFor: suiteNow + 5 * HOUR, key: 'run-inventory-harborlight' },
      { actor: opal, title: 'Plan: next-week window', customer: 'North Yard', scheduledFor: suiteNow + 7 * DAY, key: 'run-plan-nextweek' },
    ];
    const settled = await Promise.allSettled(specs.map((s) => s.actor.client.mutate(api.createJob, { args: {
      orgId: ORG, title: s.title, customerId: customersByName.get(s.customer),
      scheduledFor: s.scheduledFor, dedupeKey: s.key, creatorName: s.actor.label, followUpDelayMs: 0,
    } })));
    assert(settled.every((r) => r.status === 'fulfilled'), `all six concurrent creates settle (${JSON.stringify(settled.filter((r) => r.status === 'rejected').map((r) => String(r.reason)))})`);
    const allocated = settled.map((r) => r.value.result);
    const seqs = allocated.map((r) => r.seq).sort((a, b) => a - b);
    assert(JSON.stringify(seqs) === JSON.stringify([4, 5, 6, 7, 8, 9]),
      `gap-free duplicate-free allocation under contention (${JSON.stringify(seqs)})`);
    assert(allocated.every((r) => r.deduped === false), 'every create was a fresh insert');
    assert(allocated.every((r) => r.display === `JOB-${r.seq}`), 'human-visible identity derives from seq');
    for (const r of allocated) jobIdBySeq.set(r.seq, r.jobId);
    // the race assigns seqs nondeterministically: role assignment for later
    // checks is by dedupe key, never by assumed seq
    specs.forEach((s, i) => jobBySpecKey.set(s.key, { seq: allocated[i].seq, jobId: allocated[i].jobId, title: s.title }));
    // authoritative order: the served ledger agrees with the receipts
    const jobs = (await oscar.client.query(api.jobList, { args: { orgId: ORG, fromMs: 0, toMs: 0, status: '' } })).rows;
    assert(jobs.length === 9, `nine jobs total (${jobs.length})`);
    assert(JSON.stringify(jobs.map((j) => j.seq)) === JSON.stringify([9, 8, 7, 6, 5, 4, 3, 2, 1]),
      'authoritative order is the dense sequence, newest first');
    const titleBySeq = new Map(specs.map((s) => [allocated[specs.indexOf(s)].seq, s.title]));
    for (const [seq, title] of titleBySeq.entries()) {
      const served = jobs.find((j) => j.seq === seq);
      assert(served && served.title === title, `receipted seq ${seq} carries its own create's title`);
    }
    // idempotent re-create: same dedupe key returns the committed job and
    // burns no sequence number
    const reCreate = await dana.client.mutate(api.createJob, { args: {
      orgId: ORG, title: 'DIFFERENT title, same key', customerId: customersByName.get('Harborlight Clinic'),
      scheduledFor: suiteNow, dedupeKey: 'run-inspect-harborlight', creatorName: 'dana', followUpDelayMs: 0,
    } });
    assert(reCreate.result.deduped === true && reCreate.result.seq === allocated[0].seq,
      'same dedupe key returns the committed job');
    const dash = (await dana.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } })).rows[0];
    assert(dash.jobSeq === 9, `counter unburned by dedupe (${dash.jobSeq})`);
    evidence['A6-02'] = {
      twoActorBarrier: {
        actors: ['dana (dispatcher client)', 'opal (operator client)'],
        mechanism: 'six createJob mutations in one Promise.allSettled across two authenticated clients',
        results: allocated.map((r) => ({ seq: r.seq, display: r.display, deduped: r.deduped })),
      },
      sequenceReceipt: {
        allocated: seqs, dense: true, duplicates: 0,
        dedupeReplay: { deduped: true, seq: reCreate.result.seq, counterAfter: dash.jobSeq },
      },
      authoritativeOrder: jobs.map((j) => ({ seq: j.seq, display: j.display, title: j.title })),
      primitiveIdentity: 'hand-rolled counter row inside the serialized mutation transaction (the A3 arm\'s zero-ceremony ISS-n pattern); the dedicated sequence-allocation primitive is LLP 0135 (Accepted 2026-07-31, unimplemented on 0.1.7)',
    };
    return { note: 'six concurrent creates from two clients allocated JOB-4..JOB-9 gap-free and duplicate-free; dedupe replay returns the committed job without burning the counter' };
  });

  // ---------- A6-03-BOUNDED ----------
  await check('A6-03-BOUNDED', async () => {
    const j8 = jobBySpecKey.get('run-inventory-harborlight').jobId;
    // push the activity trail past the 20-row child bound (1 created + 24 notes)
    for (let i = 1; i <= 24; i += 1) {
      await opal.client.mutate(api.addJobNote, { args: { jobId: j8, actorName: 'opal', detail: `stockroom note ${i}` } });
    }
    const detail = (await oscar.client.query(api.jobDetail, { args: { jobId: j8 } })).rows[0];
    assert(detail.activityTotal === 25, `authoritative child count (${detail.activityTotal})`);
    assert(detail.activityShown === 20 && detail.recentActivity.length === 20,
      `child list stays bounded at 20 (${detail.activityShown})`);
    assert(detail.recentActivity[0].seq === 25 && detail.recentActivity[19].seq === 6,
      'bounded window is the newest 20, ordered');
    // bounded steps on a seeded job
    const seededJobs = (await oscar.client.query(api.jobList, { args: { orgId: ORG, fromMs: 0, toMs: 0, status: 'open' } })).rows;
    const j2row = seededJobs.find((j) => j.seq === 2);
    const j2 = (await oscar.client.query(api.jobDetail, { args: { jobId: j2row._id } })).rows[0];
    assert(j2.stepsTotal === 3 && j2.steps.length === 3 && j2.stepsDone === 0, 'seeded step children served bounded');
    // aggregate proof: dashboard counts equal the authoritative store,
    // independently recomputed from the dispatcher's full export
    const dash = (await dana.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } })).rows[0];
    const exported = (await dana.client.query(api.exportLedger, { args: { orgId: ORG } })).rows[0];
    assert(exported.counts.jobs === dash.jobsTotal && exported.counts.customers === dash.customers
      && exported.counts.activity === dash.activityRows && exported.counts.steps === dash.steps,
      `dashboard aggregates equal the export-derived authoritative counts (${JSON.stringify(exported.counts)})`);
    const statusRecount = {
      open: exported.jobs.filter((j) => j.status === 'open').length,
      claimed: exported.jobs.filter((j) => j.status === 'claimed').length,
      done: exported.jobs.filter((j) => j.status === 'done').length,
      cancelled: exported.jobs.filter((j) => j.status === 'cancelled').length,
    };
    assert(statusRecount.open === dash.jobsOpen && statusRecount.claimed === dash.jobsClaimed
      && statusRecount.done === dash.jobsDone && statusRecount.cancelled === dash.jobsCancelled,
      'per-status aggregates equal the authoritative recount');
    evidence['A6-03'] = {
      boundedQueryInventory: [
        { query: 'jobDetail', child: 'recentActivity', bound: 20, order: 'newest first' },
        { query: 'jobDetail', child: 'steps', bound: 50, order: 'seq' },
        { query: 'jobList', bound: 100, order: 'seq desc' },
        { query: 'customerList', bound: 100 },
        { query: 'attemptLedger', bound: 200 },
        { query: 'dispatchLedger / maintenanceLedger / followUpLedger', bound: 200 },
        { query: 'orgDashboard scans', bound: 500, note: 'take(N) before collect on every table scan' },
        { query: 'exportLedger', bound: '500 per table (documented export ceiling)' },
      ],
      aggregateProof: {
        overflowedChild: { activityTotal: detail.activityTotal, shown: detail.activityShown, newestSeq: detail.recentActivity[0].seq },
        dashboard: {
          jobsTotal: dash.jobsTotal, byStatus: statusRecount, steps: dash.steps,
          activityRows: dash.activityRows,
        },
        independentRecount: 'exportLedger full enumeration (dispatcher) recounted client-side',
      },
      authoritativeCounts: exported.counts,
    };
    return { note: `activity trail pushed to 25 rows: jobDetail child stays bounded at newest 20 while authoritative count reads 25; dashboard aggregates equal the export recount (${JSON.stringify(statusRecount)})` };
  });

  // ---------- A6-04-SCHEDULING ----------
  await check('A6-04-SCHEDULING', async () => {
    // ONE-OFF: the follow-up sweep is enqueued transactionally with the
    // job insert (jobs_one_off_v1 ctx.jobs.enqueue, delayMs 4000).
    const createEnvelope = await dana.client.mutate(api.createJob, { args: {
      orgId: ORG, title: 'Maintain: quarterly filter swap', customerId: customersByName.get('Meridian Foods'),
      scheduledFor: suiteNow + 6 * HOUR, dedupeKey: 'run-maintain-filters', creatorName: 'dana', followUpDelayMs: 4000,
    } });
    const created = createEnvelope.result;
    assert(created.seq === 10 && created.platformJobId !== '', `one-off enqueued transactionally (seq ${created.seq}, platform job ${created.platformJobId})`);
    jobIdBySeq.set(10, created.jobId);
    const enqueueFacts = createEnvelope.receipt?.enqueues ?? createEnvelope.enqueues ?? null;
    // schedule identity through the admin job route (secret-read custody)
    const mint = await mintSecretReadLease();
    assert(mint.status === 200 && secretReadLease, `secret-read lease minted (${mint.status}: ${JSON.stringify(mint.body).slice(0, 200)})`);
    const statusBefore = await jobsStatus(created.platformJobId);
    assert(statusBefore.status === 200, `job status route (${statusBefore.status}: ${JSON.stringify(statusBefore.body).slice(0, 200)})`);
    const rowBefore = statusBefore.body;
    // premature drain: before availableAt the job must NOT run
    const early = await jobsDrain(Date.now());
    const ledgerEarly = (await dana.client.query(api.followUpLedger, { args: { orgId: ORG } })).rows;
    assert(ledgerEarly.length === 0, `premature drain runs nothing (${JSON.stringify(early.body).slice(0, 200)})`);
    // forced drain at the injected clock past availableAt
    const drained = await jobsDrain(Date.now() + 5000);
    assert(drained.status === 200, `forced drain accepted (${drained.status}: ${JSON.stringify(drained.body).slice(0, 200)})`);
    const ledgerAfter = await until(async () => {
      const rows = (await dana.client.query(api.followUpLedger, { args: { orgId: ORG } })).rows;
      return rows.length >= 1 ? rows : null;
    }, 'follow-up run receipted', 10_000);
    assert(ledgerAfter.length === 1 && ledgerAfter[0].dedupeKey === 'followup-run-10'
      && ledgerAfter[0].jobSeqNum === 10, `exactly one follow-up run receipt (${JSON.stringify(ledgerAfter)})`);
    const statusAfter = await jobsStatus(created.platformJobId);
    // second drain: no re-run (terminal platform job)
    await jobsDrain(Date.now() + 8000);
    const ledgerFinal = (await dana.client.query(api.followUpLedger, { args: { orgId: ORG } })).rows;
    assert(ledgerFinal.length === 1, 'drained job does not re-run');
    // the generated declared job-status live query is unbootable on 0.1.7
    // (finding 0137-a6-f1; probe evidence retained): status is read through
    // the admin job route instead.
    const declaredStatusNote = 'defineJobStatusQuery boot-refused (0137-a6-f1); admin route GET /_snapback/api/jobs/{id} is the working status path';
    // the audit trail carries the scheduled run
    const jobDetail10 = (await opal.client.query(api.jobDetail, { args: { jobId: created.jobId } })).rows[0];
    assert(jobDetail10.recentActivity.some((a) => a.kind === 'follow-up'), 'audit trail carries the scheduled follow-up');

    // RECURRING: cron everyMs maintenance under deterministic ticks. The
    // first everyMs run is the epoch-0 catch-up (known 0137-a4-f4, cited).
    const ticks = [];
    let maintRows = [];
    for (let i = 0; i < 6; i += 1) {
      const tick = await cronTick();
      assert(tick.status === 200, `tick accepted (${tick.status})`);
      ticks.push(tick.runs.map((r) => ({ jobName: r.jobName, scheduledAtMs: r.scheduledAtMs, outcome: r.outcome })));
      maintRows = (await dana.client.query(api.maintenanceLedger, { args: { orgId: ORG } })).rows;
      if (maintRows.length >= 2) break;
      await sleep(1_100);
    }
    assert(maintRows.length >= 2, `recurrence: at least two receipted maintenance nominals (${maintRows.length})`);
    const nominals = new Set(maintRows.map((r) => r.dedupeKey));
    assert(nominals.size === maintRows.length, 'one receipt per nominal (dedupe custody)');
    const cronRuns = ticks.flat().filter((r) => r.jobName === 'maintenanceTick' && r.outcome === 'Succeeded');
    assert(cronRuns.length >= 2, `the scheduler ran the maintenance job repeatedly (${cronRuns.length})`);
    evidence['A6-04'] = {
      scheduleIdentity: {
        oneOff: {
          platformJobId: created.platformJobId,
          producer: 'createJob mutation (ctx.jobs.enqueue in the same transaction as the job insert; delayMs 4000, idempotencyKey followup-10, maxAttempts 1)',
          statusRowBeforeDrain: rowBefore,
          enqueueFactsOnMutationEnvelope: enqueueFacts,
        },
        recurring: { job: 'maintenanceTick (everyMs 1000, jitter false)', cronDisabled: 'suite-driven deterministic ticks' },
      },
      runReceipt: {
        prematureDrain: { ranNothing: true, response: early.body },
        forcedDrain: { response: drained.body, followUpReceipts: ledgerAfter },
        platformStatusAfter: statusAfter.body,
        secondDrainNoRerun: true,
        declaredJobStatusQuery: declaredStatusNote,
        auditTrail: jobDetail10.recentActivity.filter((a) => a.kind === 'follow-up' || a.kind === 'created'),
      },
      recurrenceProof: {
        receipts: maintRows.map((r) => ({ dedupeKey: r.dedupeKey, nominalMs: r.nominalMs, timedOutCount: r.timedOutCount, outcome: r.outcome })),
        distinctNominals: nominals.size,
        cronRunsObserved: cronRuns.length,
        epochCatchup: ticks.flat().find((r) => r.scheduledAtMs === 0) ?? null,
        epochNote: 'epoch-0 catch-up nominal receipted (known 0137-a4-f4, cited)',
      },
    };
    return { note: `one-off follow-up enqueued in the createJob transaction ran exactly once through the injected-clock drain (premature drain ran nothing); recurring maintenance receipted ${maintRows.length} distinct nominals under deterministic ticks` };
  });

  // ---------- A6-05-ATTEMPTS ----------
  await check('A6-05-ATTEMPTS', async () => {
    const j4 = jobBySpecKey.get('run-inspect-harborlight').jobId;
    // claim
    const claim1 = await opal.client.mutate(api.claimJob, { args: { jobId: j4, actorName: 'opal', leaseMs: 60_000 } });
    assert(claim1.result.claimed === true && claim1.result.fence === 1 && claim1.result.attemptSeq === 1, 'first claim');
    const snap1 = (await dana.client.query(api.attemptLedger, { args: { jobId: j4 } })).rows;
    assert(snap1.length === 1 && snap1[0].event === 'claimed', 'claim receipted');
    // release (operator gives the job back)
    const release = await opal.client.mutate(api.releaseJob, { args: { jobId: j4, fence: 1, actorName: 'opal', reason: 'missing parts' } });
    assert(release.result.fenced === false && release.result.status === 'open', 'release settles');
    const snap2 = (await dana.client.query(api.attemptLedger, { args: { jobId: j4 } })).rows;
    assert(snap2.length === 2 && snap2[1].event === 'released', 'release receipted');
    assert(JSON.stringify(snap2.slice(0, 1)) === JSON.stringify(snap1), 'append-only: earlier receipts byte-stable');
    // retry: the second operator claims attempt 2 with a short lease
    const claim2 = await oscar.client.mutate(api.claimJob, { args: { jobId: j4, actorName: 'oscar', leaseMs: 150 } });
    assert(claim2.result.claimed === true && claim2.result.fence === 2 && claim2.result.attemptSeq === 2, 'retry claim is attempt 2');
    // timeout: the lease expires and the maintenance pass times the claim out
    await sleep(220);
    const maint = await dana.client.action(api.runMaintenance, { args: { trigger: 'timeout-leg' } });
    assert(maint.ok !== false, `maintenance action ok (${JSON.stringify(maint).slice(0, 200)})`);
    assert(maint.result.timedOutCount === 1, `exactly one overdue lease expired (${JSON.stringify(maint.result)})`);
    const snap3 = (await dana.client.query(api.attemptLedger, { args: { jobId: j4 } })).rows;
    assert(snap3.length === 4 && snap3[3].event === 'timed-out' && snap3[3].actorName === 'maintenance',
      `timeout receipted (${JSON.stringify(snap3.map((r) => r.event))})`);
    assert(JSON.stringify(snap3.slice(0, 2)) === JSON.stringify(snap2), 'append-only holds across the timeout');
    // cancellation (dispatcher-only; operator refused first)
    let opalCancel = null;
    try { await opal.client.mutate(api.cancelJob, { args: { jobId: j4, reason: 'not mine to cancel', actorName: 'opal' } }); }
    catch (err) { opalCancel = diagCode(err); }
    assert(opalCancel === 'SNAPBACK_AUTH_PERMISSION_DENIED', `operator cannot cancel (${opalCancel})`);
    const cancel = await dana.client.mutate(api.cancelJob, { args: { jobId: j4, reason: 'customer withdrew the request', actorName: 'dana' } });
    assert(cancel.result.fenced === false && cancel.result.status === 'cancelled', 'cancellation settles');
    // late attempts against the terminal job: claim, complete, re-cancel
    const lateClaim = await opal.client.mutate(api.claimJob, { args: { jobId: j4, actorName: 'opal', leaseMs: 60_000 } });
    assert(lateClaim.result.claimed === false && lateClaim.result.status === 'cancelled', 'late claim rejected');
    const lateComplete = await oscar.client.mutate(api.completeJob, { args: { jobId: j4, fence: 2, actorName: 'oscar' } });
    assert(lateComplete.result.fenced === true, 'late completion fenced');
    const lateCancel = await dana.client.mutate(api.cancelJob, { args: { jobId: j4, reason: 'twice', actorName: 'dana' } });
    assert(lateCancel.result.fenced === true, 'repeat cancellation fenced');
    // the full ledger: strictly increasing, every event distinct and receipted
    const ledger = (await dana.client.query(api.attemptLedger, { args: { jobId: j4 } })).rows;
    assert(JSON.stringify(ledger.map((r) => r.event)) === JSON.stringify(
      ['claimed', 'released', 'claimed', 'timed-out', 'cancelled', 'claim-rejected', 'fenced', 'fenced']),
      `full receipt sequence (${JSON.stringify(ledger.map((r) => r.event))})`);
    assert(JSON.stringify(ledger.map((r) => r.seq)) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]), 'strictly increasing receipt seq');
    assert(JSON.stringify(ledger.slice(0, 4)) === JSON.stringify(snap3.slice(0, 4)), 'append-only: prior snapshot is a byte-stable prefix');
    // state-machine records mirror the transitions in the audit trail
    const detail = (await oscar.client.query(api.jobDetail, { args: { jobId: j4 } })).rows[0];
    const kinds = detail.recentActivity.map((a) => a.kind).reverse();
    assert(JSON.stringify(kinds) === JSON.stringify(['created', 'claimed', 'released', 'claimed', 'timed-out', 'cancelled']),
      `audit trail mirrors the state machine (${JSON.stringify(kinds)})`);
    assert(detail.status === 'cancelled' && detail.settledAt > 0 && detail.terminalDetail.includes('customer withdrew'),
      'terminal record settled');
    evidence['A6-05'] = {
      attemptLedger: ledger,
      appendOnlyProof: {
        snapshots: [snap1.length, snap2.length, snap3.length, ledger.length],
        prefixByteStable: true,
        mutationSurface: 'no operation in the app surface updates or deletes jobAttempts rows; every lifecycle mutation only inserts the next receipt',
      },
      stateMachineRecords: {
        transitions: kinds,
        terminal: { status: detail.status, settledAt: detail.settledAt, terminalDetail: detail.terminalDetail },
        authoritySplit: { operatorCancelRefusal: opalCancel, dispatcherCancel: 'settled' },
        lateAttempts: {
          claim: lateClaim.result, complete: { fenced: lateComplete.result.fenced }, recancel: { fenced: lateCancel.result.fenced },
        },
      },
    };
    return { note: 'claim, release, retry-claim, lease timeout, and cancellation each left append-only receipts (8 receipts, byte-stable prefixes); late claim/complete/re-cancel receipted without state change; audit trail mirrors the state machine' };
  });

  // ---------- A6-06-DISPATCH ----------
  await check('A6-06-DISPATCH', async () => {
    // secret custody through the admin config surface + endpoint via app data
    const set = await configCall('set', { entry: 'dispatchToken', value: DISPATCH_TOKEN_CANARY });
    assert(set.status === 200 && set.body.applyState === 'applied', `config set applied (${JSON.stringify(set.body)})`);
    const status = await configCall('status');
    const entry = status.body.entries.find((e) => e.name === 'dispatchToken');
    assert(entry.set === true && entry.secret === true, 'config status reports custody, never bytes');
    assert(!JSON.stringify(status.body).includes(DISPATCH_TOKEN_CANARY), 'status never discloses the value');
    await dana.client.mutate(api.setDispatchEndpoint, { args: { orgId: ORG, url: providerUrl } });
    // first dispatch: claim the calibrate job then send
    const calibrate = jobBySpecKey.get('run-calibrate-delta');
    const j5 = calibrate.jobId;
    const calKey = `dispatch-${calibrate.seq}`;
    await opal.client.mutate(api.claimJob, { args: { jobId: j5, actorName: 'opal', leaseMs: 60_000 } });
    const first = await opal.client.action(api.dispatchJob, { args: { jobId: `${j5}`, trigger: 'first' } });
    assert(first.ok !== false && first.result.outcome === 'sent', `first dispatch sent (${JSON.stringify(first).slice(0, 200)})`);
    assert(first.result.providerStatus === 200 && first.result.bytes > 0, 'provider acknowledged with bytes');
    assert(providerCount(calKey) === 1, `provider saw exactly one request (${providerCount(calKey)})`);
    // idempotent retry: same job, second call settles as deduped
    const retry = await opal.client.action(api.dispatchJob, { args: { jobId: `${j5}`, trigger: 'retry' } });
    assert(retry.result.outcome === 'deduped', `retry deduped (${JSON.stringify(retry.result)})`);
    assert(providerCount(calKey) === 1, 'retry did not reach the provider');
    // concurrent double-dispatch on the rewire job from two different actors
    const rewire = jobBySpecKey.get('run-rewire-northyard');
    const j6 = rewire.jobId;
    const rewKey = `dispatch-${rewire.seq}`;
    await oscar.client.mutate(api.claimJob, { args: { jobId: j6, actorName: 'oscar', leaseMs: 60_000 } });
    const [raceA, raceB] = await Promise.allSettled([
      dana.client.action(api.dispatchJob, { args: { jobId: `${j6}`, trigger: 'race-a' } }),
      oscar.client.action(api.dispatchJob, { args: { jobId: `${j6}`, trigger: 'race-b' } }),
    ]);
    assert(raceA.status === 'fulfilled' && raceB.status === 'fulfilled', 'both concurrent dispatches settle');
    const raceOutcomes = [raceA.value.result?.outcome ?? actionRefusal(raceA.value), raceB.value.result?.outcome ?? actionRefusal(raceB.value)].sort();
    assert(providerCount(rewKey) === 1, `concurrent dispatch reached the provider exactly once (${providerCount(rewKey)})`);
    // settlement is inspectable: the dispatcher reads the terminal ledger
    const ledger = await until(async () => {
      const rows = (await dana.client.query(api.dispatchLedger, { args: { orgId: ORG } })).rows;
      return rows.length === 2 ? rows : null;
    }, 'two settled dispatch rows', 10_000);
    assert(JSON.stringify(ledger.map((r) => [r.dedupeKey, r.outcome, r.providerStatus])) === JSON.stringify(
      [[calKey, 'sent', 200], [rewKey, 'sent', 200]]),
      `terminal settlement rows (${JSON.stringify(ledger.map((r) => [r.dedupeKey, r.outcome]))})`);
    // authority: operator cannot read the dispatch ledger; outsider refused
    let opalLedger = null;
    try { await opal.client.query(api.dispatchLedger, { args: { orgId: ORG } }); }
    catch (err) { opalLedger = diagCode(err); }
    assert(opalLedger === 'SNAPBACK_AUTH_PERMISSION_DENIED', `dispatch ledger dispatcher-only (${opalLedger})`);
    let malloryDispatch = null;
    try {
      const env = await mallory.client.action(api.dispatchJob, { args: { jobId: `${j5}`, trigger: 'forged' } });
      malloryDispatch = actionRefusal(env);
    } catch (err) { malloryDispatch = diagCode(err); }
    assert(!String(malloryDispatch).startsWith('ALLOWED'), `outsider dispatch refused (${malloryDispatch})`);
    // provider boundary: every arrived request carried the staged secret
    assert(providerLedger.requests.length === 2 && providerLedger.requests.every((r) => r.authValid),
      'every provider request carried the staged secret (server-side custody)');
    // canary scan across client-visible surfaces
    const scanTargets = {
      dispatchLedgerRows: JSON.stringify(ledger),
      actionEnvelopes: JSON.stringify([first, retry, raceA.value, raceB.value]),
      configStatus: JSON.stringify(status.body),
      devServerOutput: devStdoutRaw,
      allEvidenceSoFar: JSON.stringify(evidence),
    };
    const leaks = Object.entries(scanTargets).filter(([, s]) => s.includes(DISPATCH_TOKEN_CANARY)).map(([k]) => k);
    assert(leaks.length === 0, `canary leaked into: ${leaks}`);
    evidence['A6-06'] = {
      dedupeKey: {
        perJob: 'dispatch-<seq> derived in beginDispatch; unique index on dispatches.dedupeKey',
        retry: { key: calKey, outcome: retry.result.outcome, providerCountAfter: providerCount(calKey) },
        concurrentRace: { key: rewKey, outcomes: raceOutcomes, providerCount: providerCount(rewKey) },
      },
      providerBoundary: {
        strictProvider: '401 without the Bearer secret; suite-owned loopback server',
        requests: providerLedger.requests,
        custody: 'ctx.secrets staging + streamed egress lane (0137-a5-f1 cited); canary absent from all client-visible surfaces',
        canaryScan: { targets: Object.keys(scanTargets), leaks },
      },
      terminalSettlement: {
        rows: ledger,
        inspectionPath: 'dispatchLedger query (dispatcher-only)',
        authority: { operatorLedgerRead: opalLedger, outsiderDispatch: malloryDispatch },
      },
    };
    return { note: `dispatch settled 'sent' once per job (provider saw exactly 1 request per key across retry and a two-actor race); settlement inspectable in the dispatcher ledger; canary secret absent from ${Object.keys(scanTargets).length} client-visible surfaces` };
  });

  // ---------- A6-07-FENCING ----------
  await check('A6-07-FENCING', async () => {
    const j7 = jobBySpecKey.get('run-audit-meridian').jobId;
    // two operators claim the SAME open job concurrently
    const [claimA, claimB] = await Promise.allSettled([
      opal.client.mutate(api.claimJob, { args: { jobId: j7, actorName: 'opal', leaseMs: 60_000 } }),
      oscar.client.mutate(api.claimJob, { args: { jobId: j7, actorName: 'oscar', leaseMs: 60_000 } }),
    ]);
    assert(claimA.status === 'fulfilled' && claimB.status === 'fulfilled', 'both concurrent claims settle');
    const resA = claimA.value.result;
    const resB = claimB.value.result;
    const winners = [resA, resB].filter((r) => r.claimed);
    const losers = [resA, resB].filter((r) => !r.claimed);
    assert(winners.length === 1 && losers.length === 1, `exactly one owner (${JSON.stringify([resA, resB])})`);
    const winner = winners[0].owner === 'opal' ? opal : oscar;
    const loser = winners[0].owner === 'opal' ? oscar : opal;
    assert(losers[0].owner === winner.label, 'loser learns the authoritative owner');
    // the winner releases; the loser claims legitimately (fence advances)
    await winner.client.mutate(api.releaseJob, { args: { jobId: j7, fence: 1, actorName: winner.label, reason: 'handoff' } });
    const reclaim = await loser.client.mutate(api.claimJob, { args: { jobId: j7, actorName: loser.label, leaseMs: 60_000 } });
    assert(reclaim.result.claimed === true && reclaim.result.fence === 2, 'second claim advances the fence');
    // the PRIOR owner's late writes present the stale fence: all fenced
    const staleComplete = await winner.client.mutate(api.completeJob, { args: { jobId: j7, fence: 1, actorName: winner.label } });
    assert(staleComplete.result.fenced === true, 'prior owner\'s late completion fenced');
    const staleRelease = await winner.client.mutate(api.releaseJob, { args: { jobId: j7, fence: 1, actorName: winner.label, reason: 'stale' } });
    assert(staleRelease.result.fenced === true, 'prior owner\'s late release fenced');
    // the current owner's work with the current fence succeeds
    const finish = await loser.client.mutate(api.completeJob, { args: { jobId: j7, fence: 2, actorName: loser.label } });
    assert(finish.result.fenced === false && finish.result.status === 'done', 'current fence holder completes');
    // post-terminal claim rejected
    const lateClaim = await winner.client.mutate(api.claimJob, { args: { jobId: j7, actorName: winner.label, leaseMs: 60_000 } });
    assert(lateClaim.result.claimed === false && lateClaim.result.status === 'done', 'post-terminal claim rejected');
    // authoritative outcome + fence receipts
    const detail = (await dana.client.query(api.jobDetail, { args: { jobId: j7 } })).rows[0];
    assert(detail.status === 'done' && detail.ownerName === loser.label && detail.fence === 2,
      `authoritative outcome: ${loser.label} owns the completed job at fence 2`);
    const ledger = (await dana.client.query(api.attemptLedger, { args: { jobId: j7 } })).rows;
    const events = ledger.map((r) => r.event);
    assert(JSON.stringify(events) === JSON.stringify(
      ['claimed', 'claim-rejected', 'released', 'claimed', 'fenced', 'fenced', 'completed', 'claim-rejected']),
      `fence receipts in order (${JSON.stringify(events)})`);
    const fencedRows = ledger.filter((r) => r.event === 'fenced');
    assert(fencedRows.every((r) => r.actorName === winner.label)
      && JSON.stringify(fencedRows.map((r) => r.outcome).sort()) === JSON.stringify(['completeJob', 'releaseJob']),
      'both stale-fence lanes receipted against the prior owner');
    evidence['A6-07'] = {
      twoActorBarrier: {
        mechanism: 'Promise.allSettled claimJob from two distinct operator sessions on one open job',
        results: [resA, resB],
        winner: winner.label,
      },
      fenceReceipt: {
        fenceProgression: [1, 2],
        staleWrites: fencedRows,
        currentFenceWork: { completed: true, by: loser.label, fence: 2 },
      },
      authoritativeOutcome: {
        status: detail.status, ownerName: detail.ownerName, fence: detail.fence,
        terminalDetail: detail.terminalDetail,
        receiptSequence: events,
      },
    };
    return { note: `concurrent claims resolved to one owner (${winner.label}); after handoff the prior owner's stale-fence completion AND release were fenced with receipts while the fence-2 holder completed the job` };
  });

  // ---------- A6-08-DASHBOARD ----------
  await check('A6-08-DASHBOARD', async () => {
    const thisWeek = { fromMs: suiteNow - DAY, toMs: suiteNow + DAY };
    const wide = { fromMs: suiteNow - DAY, toMs: suiteNow + 14 * DAY };
    // the dispatcher holds the dashboard and the ranged job list live
    const dashHandle = await dana.client.liveQuery(api.orgDashboard, {
      args: { orgId: ORG, ...thisWeek }, connectionId: 'dana_dash', transport: 'stream' });
    await until(() => (dashHandle.connection === 'live' ? true : null), 'dashboard live');
    cleanups.push(() => dashHandle.dispose());
    const listHandle = await dana.client.liveQuery(api.jobList, {
      args: { orgId: ORG, ...thisWeek, status: '' }, connectionId: 'dana_list', transport: 'stream' });
    await until(() => (listHandle.connection === 'live' ? true : null), 'job list live');
    cleanups.push(() => listHandle.dispose());
    const baseline = dashHandle.rows[0];
    const nextWeek = jobBySpecKey.get('run-plan-nextweek');
    // range-filter proof (narrow): the next-week job is excluded
    const narrowSeqs = listHandle.rows.map((j) => j.seq).sort((a, b) => a - b);
    assert(!narrowSeqs.includes(nextWeek.seq), `next-week JOB-${nextWeek.seq} excluded from the weekly range (${JSON.stringify(narrowSeqs)})`);
    assert(baseline.jobsInRange === narrowSeqs.length, 'dashboard range count equals the ranged list');
    // a second live handle with the widened range includes it
    const wideHandle = await dana.client.liveQuery(api.jobList, {
      args: { orgId: ORG, ...wide, status: '' }, connectionId: 'dana_wide', transport: 'stream' });
    await until(() => (wideHandle.connection === 'live' ? true : null), 'wide list live');
    cleanups.push(() => wideHandle.dispose());
    const wideSeqs = wideHandle.rows.map((j) => j.seq).sort((a, b) => a - b);
    assert(wideSeqs.includes(nextWeek.seq), `widened range includes JOB-${nextWeek.seq} (${JSON.stringify(wideSeqs)})`);
    assert(wideSeqs.length === narrowSeqs.length + 1, 'exactly the range boundary separates the two views');
    // live update: an operator claims the inventory job while the dispatcher watches
    const inventory = jobBySpecKey.get('run-inventory-harborlight');
    const j8 = inventory.jobId;
    const claimedBaseline = baseline.jobsClaimed;
    const t0 = Date.now();
    await opal.client.mutate(api.claimJob, { args: { jobId: j8, actorName: 'opal', leaseMs: 120_000 } });
    await until(() => (dashHandle.rows[0]?.jobsClaimed === claimedBaseline + 1 ? true : null), 'dashboard delivered live');
    const dashMs = Date.now() - t0;
    await until(() => (listHandle.rows.find((j) => j.seq === inventory.seq)?.status === 'claimed' ? true : null), 'ranged list delivered live');
    const listMs = Date.now() - t0;
    const updated = dashHandle.rows[0];
    // live rows equal an independent authoritative snapshot
    const snapshot = (await oscar.client.query(api.orgDashboard, { args: { orgId: ORG, ...thisWeek } })).rows[0];
    assert(JSON.stringify(updated) === JSON.stringify(snapshot), 'live dashboard equals the authoritative snapshot');
    // outsider: the live subscription itself is denied
    let outsiderSub = null;
    try {
      const handle = await mallory.client.liveQuery(api.orgDashboard, {
        args: { orgId: ORG, ...thisWeek }, connectionId: 'mallory_dash', transport: 'stream' });
      await until(() => (handle.connection === 'live' || handle.error ? handle : null), 'mallory sub settles', 8_000);
      outsiderSub = handle.error ? diagCode(handle.error) : `CONNECTED (defect: ${handle.rows.length})`;
      await handle.dispose();
    } catch (err) { outsiderSub = diagCode(err); }
    assert(outsiderSub === 'SNAPBACK_AUTH_PERMISSION_DENIED', `outsider dashboard subscription denied (${outsiderSub})`);
    let outsiderList = null;
    try { await mallory.client.query(api.jobList, { args: { orgId: ORG, fromMs: 0, toMs: 0, status: '' } }); }
    catch (err) { outsiderList = diagCode(err); }
    assert(outsiderList === 'SNAPBACK_AUTH_PERMISSION_DENIED', `outsider list denied (${outsiderList})`);
    // the live handles are check-scoped: dispose before the A6-09 reset so
    // the reset's transport teardown meets no open subscriptions
    await wideHandle.dispose();
    await listHandle.dispose();
    await dashHandle.dispose();
    evidence['A6-08'] = {
      secondClient: {
        observer: 'dana (dispatcher session) watching; opal (operator session) mutating',
        deliveries: { dashboardMs: dashMs, rangedListMs: listMs },
        liveEqualsSnapshot: true,
      },
      transportAttribution: { connection: 'live', transport: 'stream', polling: 'never used as evidence' },
      rangeFilterProof: {
        narrow: { range: thisWeek, seqs: narrowSeqs, jobsInRange: baseline.jobsInRange },
        wide: { range: wide, seqs: wideSeqs },
        boundaryJob: `JOB-${nextWeek.seq} (scheduledFor +7d) excluded narrow, included wide`,
      },
      authority: { outsiderSubscription: outsiderSub, outsiderList },
    };
    return { note: `dispatcher dashboard and ranged list updated live in ${dashMs}/${listMs}ms over the managed stream; JOB-${nextWeek.seq} partitions the narrow/wide ranges exactly; outsider subscription denied` };
  });

  // ---------- A6-09-EXPORT-RESTORE ----------
  let danaPost = null;
  await check('A6-09-EXPORT-RESTORE', async () => {
    // authority: only the dispatcher can export
    let opalExport = null;
    try { await opal.client.query(api.exportLedger, { args: { orgId: ORG } }); }
    catch (err) { opalExport = diagCode(err); }
    assert(opalExport === 'SNAPBACK_AUTH_PERMISSION_DENIED', `export dispatcher-only (${opalExport})`);
    // export the full ledger (id-free natural-key projection)
    const before = (await dana.client.query(api.exportLedger, { args: { orgId: ORG } })).rows[0];
    const canonical = (payload) => {
      const activity = payload.activity.filter((a) => a.kind !== 'restored');
      return JSON.stringify({
        ...payload,
        activity,
        counts: { ...payload.counts, activity: activity.length },
      });
    };
    const digestBefore = sha256hex(canonical(before));
    const countsBefore = before.counts;
    assert(countsBefore.jobs === 10 && countsBefore.attempts > 0 && countsBefore.dispatches === 2
      && countsBefore.maintenanceRuns >= 2 && countsBefore.followUpRuns === 1,
      `export captures the full runtime ledger (${JSON.stringify(countsBefore)})`);
    // destruction event: a receipted versioned reset-install returns the
    // database to the literal seed fixture (runtime rows deleted)
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: dana.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const resetReceipt = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: preview.current.dataVersionStream },
    });
    assert(resetReceipt.operation === 'reset-install' && resetReceipt.outcome === 'reset-installed', 'reset-install settled');
    // membership is not a reset target (known 0137-a3-f1): the dispatcher
    // seat survives the reset. The reset tears down the authenticated live
    // transport of connected clients (SNAPBACK_AUTH_STREAM_RESET), so the
    // post-reset legs run on a fresh session for the same principal, with
    // retryOnce absorbing any one-shot reset on the old clients later.
    danaPost = await signIn('dana@sweep-a6.test', 'dana-post');
    const samePrincipal = danaPost.userId === dana.userId;
    let postResetAccess = 'granted';
    try { await danaPost.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } }); }
    catch (err) { postResetAccess = diagCode(err); }
    if (postResetAccess !== 'granted') {
      // observed on 0.1.7: the reset-install retires the whole pre-reset
      // authority world — pre-reset session tokens become invalid
      // (SNAPBACK_AUTH_REQUIRED) and a fresh sign-in for the same email
      // mints a NEW principal with no seat, so the operator re-enters
      // through the restored invite (reset never resurrects authority)
      const reseat = await danaPost.client.mutate(api.redeemInvite, { args: { code: 'INV-DISPATCH-5501' } });
      assert(reseat.result.role === 'dispatcher', 'restored invite reseats the dispatcher');
    }
    const wiped = (await danaPost.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } })).rows[0];
    assert(wiped.jobsTotal === 3 && wiped.attemptReceipts === 0 && wiped.dispatchReceipts === 0
      && wiped.maintenanceReceipts === 0 && wiped.followUpReceipts === 0 && wiped.jobSeq === 3,
      `reset returned the fixture (${JSON.stringify(wiped)})`);
    // restore from the export
    const restore = await danaPost.client.mutate(api.restoreLedger, { args: { orgId: ORG, payload: before } });
    assert(restore.result.jobsInserted === 7 && restore.result.jobsPatched === 3,
      `restore rebuilt the runtime jobs (${JSON.stringify(restore.result)})`);
    // round-trip verification: counts and the id-free digest match
    const after = (await danaPost.client.query(api.exportLedger, { args: { orgId: ORG } })).rows[0];
    const digestAfter = sha256hex(canonical(after));
    if (digestAfter !== digestBefore) {
      writeFileSync(join(evidenceDir, 'export-before.json'), JSON.stringify(JSON.parse(canonical(before)), null, 2));
      writeFileSync(join(evidenceDir, 'export-after.json'), JSON.stringify(JSON.parse(canonical(after)), null, 2));
    }
    assert(digestAfter === digestBefore,
      'round-trip digest equality over the id-free projection (restore audit row excluded)');
    const countsAfter = after.counts;
    assert(countsAfter.jobs === countsBefore.jobs && countsAfter.steps === countsBefore.steps
      && countsAfter.attempts === countsBefore.attempts && countsAfter.dispatches === countsBefore.dispatches
      && countsAfter.maintenanceRuns === countsBefore.maintenanceRuns
      && countsAfter.followUpRuns === countsBefore.followUpRuns
      && countsAfter.customers === countsBefore.customers,
      `verified counts round-trip (${JSON.stringify(countsAfter)} vs ${JSON.stringify(countsBefore)})`);
    assert(countsAfter.activity === countsBefore.activity + 1,
      'the restore itself is audited (exactly one new activity row, kind restored)');
    // the restored ledger is live again: sequence counter continues correctly
    const post = await danaPost.client.mutate(api.createJob, { args: {
      orgId: ORG, title: 'Post-restore continuity probe', customerId: customersByName.get('North Yard'),
      scheduledFor: suiteNow + 8 * HOUR, dedupeKey: 'run-post-restore-probe', creatorName: 'dana', followUpDelayMs: 0,
    } });
    assert(post.result.seq === 11, `sequence continues after restore (${post.result.seq})`);
    evidence['A6-09'] = {
      exportReceipt: {
        counts: countsBefore, digest: digestBefore,
        projection: 'id-free natural keys: jobs by seq, customers by name, children by (jobSeq, seq), receipts by dedupeKey',
        authority: { operatorExportRefusal: opalExport },
      },
      restoreReceipt: {
        resetInstall: { operation: resetReceipt.operation, outcome: resetReceipt.outcome, seedVersion: resetReceipt.seedVersion, resetDeletedRows: resetReceipt.resetDeletedRows },
        wipedFixtureCounts: { jobs: wiped.jobsTotal, attempts: wiped.attemptReceipts, jobSeq: wiped.jobSeq },
        restore: restore.result,
        restoreAudited: 'org-level activity row kind=restored (excluded from the digest comparison, counted explicitly)',
        streamResetBehavior: {
          observed: streamResets.slice(),
          note: 'the reset-install ends every connected client\'s authenticated live transport (SNAPBACK_AUTH_STREAM_RESET terminal on clients holding live handles); post-reset legs run on a fresh session',
        },
        authorityAfterReset: {
          samePrincipal,
          postResetAccess,
          note: 'the reset-install retires the whole pre-reset authority world on 0.1.7: pre-reset session tokens invalidate (SNAPBACK_AUTH_REQUIRED), and a fresh email-code sign-in mints a NEW principal (samePrincipal false) with no seat until it redeems the restored invite. Reset never resurrects authority (consistent with the A5 arm; membership unseedable per 0137-a3-f1, cited)',
        },
      },
      authoritativeCounts: {
        before: countsBefore, after: countsAfter, digestEqual: digestBefore === digestAfter,
        postRestoreSequence: post.result.seq,
      },
    };
    return { note: `export (10 jobs, ${countsBefore.attempts} attempt receipts, 2 dispatches) survived a receipted reset-install: restore rebuilt 7 jobs + patched 3, id-free digest equality holds, and the sequence continued at 11` };
  });

  // ---------- A6-10-CLEANUP (kernel) ----------
  await check('A6-10-CLEANUP', async () => {
    // config custody retired
    const unset = await configCall('unset', { entry: 'dispatchToken' });
    assert(unset.status === 200, `config unset (${unset.status})`);
    const status = await configCall('status');
    assert(status.body.entries.find((e) => e.name === 'dispatchToken').set === false, 'config entry cleared');
    // dispatch endpoint back to the fixture value
    const danaOps = danaPost ?? dana;
    await danaOps.client.mutate(api.setDispatchEndpoint, { args: { orgId: ORG, url: '' } });
    // platform job queue: nothing pending remains (far-future drain runs nothing)
    const finalDrain = await jobsDrain(Date.now() + 3600_000);
    const finalFollowUps = (await danaOps.client.query(api.followUpLedger, { args: { orgId: ORG } })).rows;
    assert(finalFollowUps.length === 1, `no pending one-off work re-ran at cleanup (${finalFollowUps.length})`);
    // schedules: the suite owned every tick; nothing autonomous remains
    const finalTick = await cronTick();
    // identities: seats self-remove where a live session still holds one.
    // The A6-09 reset invalidated the pre-reset session tokens (observed:
    // SNAPBACK_AUTH_REQUIRED on opal/oscar), so only the post-reset
    // dispatcher session holds a live seat to retire.
    const leaveOutcomes = {};
    for (const actor of [opal, oscar, danaOps]) {
      try {
        await retryOnce(`${actor.label} leaveOrg`, () => actor.client.mutate(api.leaveOrg, { args: { orgId: ORG } }));
        leaveOutcomes[actor.label] = 'left';
      } catch (err) { leaveOutcomes[actor.label] = diagCode(err); }
    }
    assert(leaveOutcomes[danaOps.label] === 'left', `the live seat self-removes (${JSON.stringify(leaveOutcomes)})`);
    let postLeave = null;
    try { await danaOps.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } }); }
    catch (err) { postLeave = diagCode(err); }
    assert(postLeave === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'authority retired before reset');
    // data: receipted versioned reset-install restores the literal fixture
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: danaOps.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const receipt = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: preview.current.dataVersionStream },
    });
    assert(receipt.operation === 'reset-install' && receipt.outcome === 'reset-installed', 'reset-install settled');
    // fixture verification requires a seat: the restored invite redeems again
    const verifier = await signIn('dana@sweep-a6.test', 'dana-verify');
    let stillDenied = null;
    try { await verifier.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } }); }
    catch (err) { stillDenied = diagCode(err); }
    assert(stillDenied === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'reset does not resurrect authority');
    const seat = await verifier.client.mutate(api.redeemInvite, { args: { code: 'INV-DISPATCH-5501' } });
    assert(seat.result.role === 'dispatcher', 'restored fixture invite redeemable');
    const dash = (await verifier.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } })).rows[0];
    assert(dash.jobsTotal === 3 && dash.jobSeq === 3 && dash.customers === 4, 'runtime jobs gone, seeded ledger back');
    assert(dash.attemptReceipts === 0 && dash.dispatchReceipts === 0 && dash.maintenanceReceipts === 0
      && dash.followUpReceipts === 0 && dash.activityRows === 4 && dash.steps === 7,
      'attempt/dispatch/maintenance/follow-up receipts cleared by the named-table reset');
    // final reset leaves the untouched fixture
    await verifier.client.mutate(api.leaveOrg, { args: { orgId: ORG } });
    const preview2 = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const receipt2 = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: preview2.current.dataVersionStream },
    });
    assert(receipt2.outcome === 'reset-installed', 'final reset settled');
    const finalProbe = await signIn('dana@sweep-a6.test', 'dana-final');
    let finalNegative = null;
    try { await finalProbe.client.query(api.orgDashboard, { args: { orgId: ORG, fromMs: 0, toMs: 0 } }); }
    catch (err) { finalNegative = diagCode(err); }
    assert(finalNegative === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'post-cleanup negative holds');
    evidence['A6-10'] = {
      targetBoundPlan: 'suite-owned dev database in the arm directory only; config unset through admin custody; dispatch endpoint reset to the fixture value; seats retired by self-removal (0137-a3-f1 cited); receipted versioned reset-installs; guard-blocked ports 4287-4292 during spawn; 4420 never used',
      cleanupReceipts: [
        { operation: receipt.operation, outcome: receipt.outcome, seedVersion: receipt.seedVersion, resetDeletedRows: receipt.resetDeletedRows },
        { operation: receipt2.operation, outcome: receipt2.outcome, resetDeletedRows: receipt2.resetDeletedRows },
      ],
      configCleared: true,
      schedules: { cronDisabledWholeRun: true, finalTickRuns: finalTick.runs.length, platformQueue: { farFutureDrain: finalDrain.status, reRuns: 0 } },
      postCleanupNegative: { leaveOutcomes, afterLeave: postLeave, afterReset: stillDenied, final: finalNegative },
      fixtureVerification: {
        jobs: dash.jobsTotal, jobSeq: dash.jobSeq, customers: dash.customers,
        steps: dash.steps, activity: dash.activityRows, receipts: 0,
      },
    };
    return { note: `config unset, endpoint reset, seats self-removed, two receipted reset-installs (deleted ${receipt.resetDeletedRows} + ${receipt2.resetDeletedRows} rows) restore the literal fixture; far-future drain re-ran nothing; final fresh-session negative denied` };
  });

  const failed = results.filter((r) => r.result === 'fail').length;
  const short = results.length !== EXPECTED_CHECKS;
  exitCode = failed === 0 && !short ? 0 : 1;
} catch (error) {
  console.error('suite error:', error);
  exitCode = 2;
} finally {
  for (const cleanup of cleanups.reverse()) { try { await cleanup(); } catch { /* teardown */ } }
  try { await stopDev(); } catch (error) { console.error('stopDev:', error?.message); }
  providerServer.close();
  const tally = { pass: 0, gap: 0, fail: 0, 'expected-refusal': 0 };
  for (const r of results) tally[r.result] = (tally[r.result] ?? 0) + 1;
  const report = {
    schemaVersion: 'sweep-a6.acceptance.v1',
    title: 'LLP 0137 A6 snapback-web acceptance',
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    expectedChecks: EXPECTED_CHECKS,
    observedChecks: results.length,
    tally,
    results,
    exitCode,
  };
  writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(evidenceDir, 'scenario-evidence.json'), JSON.stringify(evidence, null, 2));
  console.error(`\n${JSON.stringify({ tally, expected: EXPECTED_CHECKS, observed: results.length, exitCode })}`);
  process.exit(exitCode);
}

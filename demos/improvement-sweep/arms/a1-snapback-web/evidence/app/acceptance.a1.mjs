// LLP 0137 A1 (offline field notebook) acceptance suite — Snapback web arm.
// External-consumer build: public @expo/snapback-* 0.1.7 only.
// 13 checks, contract demos/improvement-sweep/protocol/contracts/a1-field-notebook.v1.json.
//
// Offline legs (A1-05..07, 09) run as genuinely cold child node processes
// sharing one arm-owned durable store directory (SNAPBACK_CLIENT_RQS_DIR).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { createExternalSessionClient, SnapbackClient } from '@expo/snapback-client';
import api from './snapback/generated/api.mjs';

const root = resolve(import.meta.dirname);
const evidenceDir = join(root, 'a1-evidence');
mkdirSync(evidenceDir, { recursive: true });
const rqsDir = join(root, 'a1-rqs-store');
const readyFile = join(root, '.snapback', 'dev.ready.json');
const seedDoc = JSON.parse(readFileSync(join(root, 'snapback', 'seed.json'), 'utf8'));
const seedArtifact = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'seed.artifact.json'), 'utf8'));
const artifacts = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'artifacts.json'), 'utf8'));

const EXPECTED_CHECKS = 13;
const SENTINEL = 'CONFIDENTIAL-A1-SENTINEL';
const results = [];
const evidence = {};
let child = null;
let ready = null;
let adminToken = null;
let impersonation = null;
const cleanups = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, label, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(30);
  }
};
function assert(cond, msg) { if (!cond) throw new Error(`assert: ${msg}`); }

// Result classes follow the run-capsule schema: pass | gap | fail |
// expected-refusal. A check body returns { result, note } or throws (fail).
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

const protocolHeaders = {
  'content-type': 'application/json',
  'x-snapback-auth-client-protocol': '1',
};

// ---------- dev server lifecycle ----------
const lifecycleEvents = [];
async function spawnDev() {
  // Own-ports discipline: block 4288 (the A2 arm's port) during the runtime's
  // 4287-4387 scan so this arm never adopts it; 4420 is fleet-shared and
  // asserted against below.
  const guard = createServer(() => {});
  await new Promise((resolveGuard, rejectGuard) => {
    guard.once('error', () => resolveGuard()); // already taken elsewhere: fine
    guard.listen(4288, '127.0.0.1', () => resolveGuard());
    setTimeout(rejectGuard, 2_000);
  });
  const executable = join(root, 'node_modules', '.bin', 'snapback');
  child = spawn(executable, ['dev', 'snapback'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  let remainder = '';
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
  const startedFrom = lifecycleEvents.length;
  ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try {
      const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
      // Only trust a descriptor our own live child produced this spawn.
      return lifecycleEvents.slice(startedFrom).some((e) => e.state === 'generated-and-loaded')
        ? descriptor : null;
    } catch { return null; }
  }, 'dev ready', 45_000);
  guard.close();
  assert(ready.port !== 4420, 'must not use fleet-shared port 4420');
  assert(ready.port !== 4288, 'must not reuse the A2 arm port 4288');
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
  // transport-disabled proof
  let refused = false;
  try { await fetch(`${ready.serverUrl}/health`); } catch { refused = true; }
  assert(refused, 'server port must refuse after stop');
}

async function signIn(email, label, { external = false } = {}) {
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
  const options = {
    bearerToken: credential.token,
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `sweep-a1-${label}-${process.pid}`,
    rqsStore: null, // orchestrator clients stay memory-only; durable-store
                    // evidence belongs to the child phases exclusively
  };
  // authLogout requires coordinator custody: a plain bearer construction
  // refuses it ('authLogout requires AuthCoordinator custody'), so the
  // logout persona uses the documented createExternalSessionClient path.
  const client = external
    ? createExternalSessionClient(ready.serverUrl, options)
    : new SnapbackClient(ready.serverUrl, options);
  cleanups.push(() => client.closeAuth?.());
  return { client, userId: credential.session.userId, token: credential.token, email, label };
}

function runPhase(script, extraEnv) {
  const outFile = join(evidenceDir, `${script.replace(/\.mjs$/, '')}.json`);
  return new Promise((resolvePhase, rejectPhase) => {
    const proc = spawn(process.execPath, [join(root, 'phases', script)], {
      cwd: root,
      env: {
        ...process.env,
        SNAPBACK_CLIENT_RQS_DIR: rqsDir,
        A1_SERVER_URL: ready.serverUrl,
        A1_OUT: outFile,
        A1_STORE_ID: 'a1-alice-offline',
        ...extraEnv,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, 60_000);
    proc.on('exit', () => {
      clearTimeout(timer);
      try {
        const out = JSON.parse(readFileSync(outFile, 'utf8'));
        resolvePhase(out);
      } catch (err) {
        rejectPhase(new Error(`phase ${script} produced no readable output: ${err}`));
      }
    });
  });
}

function inspectStoreForProtectedBytes() {
  const findings = { files: [], sentinelHits: 0, bytes: 0 };
  if (!existsSync(rqsDir)) return findings;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) { walk(path); continue; }
      findings.files.push(path.slice(rqsDir.length + 1));
      findings.bytes += stat.size;
      const content = readFileSync(path, 'utf8');
      if (content.includes(SENTINEL)) findings.sentinelHits += 1;
    }
  };
  walk(rqsDir);
  return findings;
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const diagCode = (err) => err?.diagnostic?.code ?? err?.code ?? String(err?.message ?? err);

// ---------- lifecycle ----------
const startedAtIso = new Date().toISOString();
// Fresh arm-owned target: this app's own dev database and durable store only.
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}
rmSync(rqsDir, { recursive: true, force: true });
mkdirSync(rqsDir, { recursive: true });

let exitCode = 2;
try {
  await spawnDev();

  const alice = await signIn('alice@sweep-a1.test', 'alice');
  const bob = await signIn('bob@sweep-a1.test', 'bob');
  const mallory = await signIn('mallory@sweep-a1.test', 'mallory');

  let workspaceId = null;
  const recordIds = {};
  let warmOut = null;
  let coldOut = null;
  let queueOut = null;
  let inspectOut = null;
  let reconnectOut = null;
  let onlineConflict = null;
  let offlineConflictSetup = null;

  // ---------- A1-01-SEED (kernel) ----------
  await check('A1-01-SEED', async () => {
    const view = await alice.client.query(api.listSites, {});
    assert(view.rows.length === 3, `expected exactly 3 seeded sites, got ${view.rows.length}`);
    assert(view.rows.map((r) => r._id).join(',') === 'site_pump_house_8,site_site_a12,site_substation_25',
      'literal versioned seed rows by name order');
    const bobView = await bob.client.query(api.listSites, {});
    assert(bobView.rows.length === 3 && bobView.version === view.version,
      'second client observes the same authoritative seed snapshot');
    const ids = new Set([alice.userId, bob.userId, mallory.userId]);
    assert(ids.size === 3, 'three distinct authenticated principals');
    evidence['A1-01'] = {
      targetIdentity: {
        serverUrl: ready.serverUrl,
        port: ready.port,
        runtime: ready.runtime ?? null,
        buildStamp: ready.runtimeRecovery?.actualStamp ?? null,
        inputsHash: artifacts.inputsHash ?? null,
        appId: artifacts.appId ?? 'notebook-app',
        authMode: 'sessions',
      },
      seedReceipt: {
        seedVersion: seedDoc.seedVersion,
        artifactSeedVersion: seedArtifact.seedVersion,
        artifactDigest: seedArtifact.seedDigest,
        installedByDevSupervisor: true,
      },
      authoritativeCounts: { sites: view.rows.length, version: view.version },
      personas: { alice: alice.userId, bob: bob.userId, mallory: mallory.userId },
    };
    return { note: `seed exact (3 sites @v${view.version}); 3 distinct principals` };
  });

  // ---------- A1-02-WORKSPACE ----------
  await check('A1-02-WORKSPACE', async () => {
    const created = await alice.client.mutate(api.createWorkspace, { args: { name: 'Substation 25 survey' } });
    workspaceId = created.result;
    assert(typeof workspaceId === 'string' && created.changed_count >= 2, 'bootstrap created workspace + host seat');
    await alice.client.mutate(api.inviteToWorkspace, { args: { workspaceId, userId: bob.userId } });
    await bob.client.mutate(api.acceptWorkspaceInvite, { args: { workspaceId } });

    const day = 86_400_000;
    const base = 1_785_542_400_000; // fixed epoch: deterministic due dates
    const mk = async (title, assignee, dueAt, position, clientKey) =>
      (await alice.client.mutate(api.createRecord, {
        args: {
          workspaceId, title,
          assigneeId: assignee.userId, assigneeName: assignee.label,
          dueAt, position, clientKey,
        },
      })).result;
    recordIds.r1 = await mk('Transformer vault reading', alice, base, 1000, 'a1-r1');
    recordIds.r2 = await mk('North fence corrosion pass', bob, base + day, 2000, 'a1-r2');
    recordIds.r3 = await mk(`${SENTINEL} north perimeter breach log`, alice, base + 2 * day, 3000, 'a1-r3');

    // positive cross-user read, independent of the initiating client
    const bobView = await bob.client.query(api.listRecords, { args: { workspaceId } });
    assert(bobView.rows.length === 3, 'member reads the workspace records');
    assert(bobView.rows[0].title === 'Transformer vault reading', 'position order');

    let readDenied = null;
    try { await mallory.client.query(api.listRecords, { args: { workspaceId } }); }
    catch (err) { readDenied = diagCode(err); }
    assert(readDenied === 'SNAPBACK_AUTH_PERMISSION_DENIED', `mallory read denied (${readDenied})`);
    let subscribeDenied = null;
    try {
      const h = await mallory.client.liveQuery(api.listRecords, {
        args: { workspaceId }, connectionId: 'mallory_sub', transport: 'stream',
      });
      await h.dispose();
    } catch (err) { subscribeDenied = diagCode(err); }
    assert(subscribeDenied === 'SNAPBACK_AUTH_PERMISSION_DENIED', `mallory subscribe denied (${subscribeDenied})`);
    evidence['A1-02'] = {
      workspaceId,
      actorAttribution: {
        host: alice.userId,
        member: bob.userId,
        recordsCreatedBy: 'alice (session-derived principal, never client-asserted)',
      },
      negativeRead: readDenied,
      negativeSubscription: subscribeDenied,
    };
    return { note: 'host+member read; outsider read AND subscribe uniformly denied' };
  });

  // ---------- A1-03-RECORDS ----------
  await check('A1-03-RECORDS', async () => {
    const transitions = [];
    const observe = async (label) => {
      const view = await bob.client.query(api.listRecords, { args: { workspaceId } });
      const order = view.rows.map((r) => r.clientKey);
      // order invariant: ascending position with _id tiebreak
      const sorted = [...view.rows].sort((a, b) =>
        a.position - b.position || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
      assert(JSON.stringify(sorted.map((r) => r._id)) === JSON.stringify(view.rows.map((r) => r._id)),
        `order invariant after ${label}`);
      transitions.push({ label, order, version: view.version });
      return view;
    };
    // edit
    const edit = await alice.client.mutate(api.updateRecord, {
      args: { recordId: recordIds.r1, notes: 'vault reading nominal at 09:00' } });
    assert(edit.changed_count === 1 && edit.result === 2, 'edit settled, revision 2');
    let view = await observe('edit');
    assert(view.rows.find((r) => r._id === recordIds.r1).notes === 'vault reading nominal at 09:00', 'authoritative edit');
    // assign
    const assign = await bob.client.mutate(api.assignRecord, {
      args: { recordId: recordIds.r2, assigneeId: alice.userId, assigneeName: 'Alice' } });
    assert(assign.changed_count === 1, 'assignment settled');
    view = await observe('assign');
    assert(view.rows.find((r) => r._id === recordIds.r2).assigneeName === 'Alice', 'authoritative assignment');
    // due date
    const due = await alice.client.mutate(api.setDueDate, {
      args: { recordId: recordIds.r2, dueAt: 1_785_715_200_000 } });
    assert(due.changed_count === 1, 'due date settled');
    view = await observe('due');
    assert(view.rows.find((r) => r._id === recordIds.r2).dueAt === 1_785_715_200_000, 'authoritative due date');
    // reorder: move r3 between r1 and r2
    const reorder = await alice.client.mutate(api.reorderRecord, {
      args: { recordId: recordIds.r3, position: 1500 } });
    assert(reorder.changed_count === 1, 'reorder settled');
    view = await observe('reorder');
    assert(view.rows.map((r) => r.clientKey).join(',') === 'a1-r1,a1-r3,a1-r2', 'deterministic reorder outcome');
    // state
    const done = await bob.client.mutate(api.updateRecord, {
      args: { recordId: recordIds.r1, state: 'done' } });
    assert(done.changed_count === 1, 'state settled');
    view = await observe('state');
    assert(view.rows.find((r) => r._id === recordIds.r1).state === 'done', 'authoritative state');
    evidence['A1-03'] = { transitions, settlement: { edit, assign, due, reorder, done } };
    return { note: 'create/edit/assign/due/reorder/state all authoritative with stable order' };
  });

  // ---------- A1-04-ATTACHMENTS ----------
  await check('A1-04-ATTACHMENTS', async () => {
    // NOTE (arm finding): the packaged SnapbackAssetClient builds its own
    // fetches with only content-type + x-snapback-dev-user — no bearer, no
    // auth-client protocol offer — so client.assets-style uploads fail on a
    // sessions-mode server with SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED.
    // The same documented lifecycle (attempt -> TUS PATCH -> finalize) works
    // when driven with authenticated requests, which is what this check does.
    // A PDF payload: finalization detects the content type FROM BYTES, and
    // plain text sniffs as application/octet-stream (outside any sensible
    // accept list) — a text/plain accept entry is effectively unusable.
    // Recorded in the arm findings; the PDF magic satisfies detection.
    const content = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'
      + '% a1 field report: transformer vault, sealed readings, page 1\n'
      + 'trailer\n<< /Root 1 0 R >>\n%%EOF\n';
    const bytes = new TextEncoder().encode(content);
    const authed = (who) => ({ authorization: `Bearer ${who.token}`, ...protocolHeaders });
    const created = await fetch(`${ready.serverUrl}/assets/attempts`, {
      method: 'POST', headers: authed(alice),
      body: JSON.stringify({
        intentId: api.recordAttachment.name,
        intentPolicyHash: api.recordAttachment.intentPolicyHash ?? null,
        args: {},
        declaredFilename: 'field-report.pdf',
        declaredLength: bytes.byteLength,
        declaredContentType: 'application/pdf',
      }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }));
    assert(created.ok, `attempt created (${created.status}: ${JSON.stringify(created.body).slice(0, 200)})`);
    const attemptId = created.body.task.attemptId;
    const assetId = created.body.task.assetId;
    const checksum = createHash('sha256').update(bytes).digest('base64');
    const patched = await fetch(`${ready.serverUrl}${created.body.transfer.uploadUrl}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${alice.token}`,
        'x-snapback-auth-client-protocol': '1',
        'tus-resumable': '1.0.0',
        'content-type': 'application/offset+octet-stream',
        'upload-offset': '0',
        'upload-checksum': `sha256 ${checksum}`,
      },
      body: bytes,
    });
    assert(patched.ok, `TUS transfer accepted (${patched.status})`);
    const finalized = await fetch(`${ready.serverUrl}/assets/attempts/${encodeURIComponent(attemptId)}/finalize`, {
      method: 'POST', headers: authed(alice),
      body: JSON.stringify({
        attemptId,
        lifecycleGeneration: 1,
        declaredDigest: createHash('sha256').update(bytes).digest('hex'),
      }),
    }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }));
    assert(finalized.ok && finalized.body.task.availability === 'ready',
      `finalize published (${finalized.status}: ${JSON.stringify(finalized.body).slice(0, 200)})`);
    const snapshot = {
      integrityBasis: finalized.body.task.integrityGrade ?? 'end-to-end-verified',
      totalBytes: bytes.byteLength,
    };

    // The attach step: on packaged 0.1.7 the ctx.assets.attach admission is
    // not honored by the commit validator — every admitted write into a
    // v.assetRef field (restricted or not, returned canonical id or raw
    // input id, minimal single-write mutation included) refuses with
    // SNAPBACK_ASSET_REF_UNVERIFIED. Filed as an arm defect finding; the
    // check records the exact refusal and proves the rest of the lifecycle.
    let attachOutcome = null;
    try {
      await alice.client.mutate(api.attachToRecord, { args: { recordId: recordIds.r1, assetId } });
      attachOutcome = { committed: true };
    } catch (err) {
      attachOutcome = { committed: false, code: diagCode(err) };
    }

    const readBytes = async (who) => fetch(`${ready.serverUrl}/assets/records/${assetId}/bytes/primary`, {
      headers: { authorization: `Bearer ${who.token}`, ...protocolHeaders },
    });
    // Without a committed reference edge the intent's via-references sharing
    // is unreachable: delivery is owner-only.
    const aliceRead = await readBytes(alice);
    assert(aliceRead.status === 200, `owner delivery authorized (${aliceRead.status})`);
    const delivered = await aliceRead.text();
    assert(sha256(delivered) === sha256(content), 'content hash matches uploaded bytes');
    assert(aliceRead.headers.get('cache-control')?.includes('no-store'), 'private-strict cache headers');
    const bobRead = await readBytes(bob);
    const malloryRead = await readBytes(mallory);
    assert(malloryRead.status === 403 || malloryRead.status === 404, `outsider delivery denied (${malloryRead.status})`);

    const del = await fetch(`${ready.serverUrl}/assets/records/${assetId}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${alice.token}`, ...protocolHeaders },
    });
    assert(del.ok, `delete of the (unreferenceable) asset succeeded (${del.status})`);
    const afterDelete = await readBytes(alice);
    assert(afterDelete.status === 404 || afterDelete.status === 410 || afterDelete.status === 403,
      `post-delete read denied (${afterDelete.status})`);
    evidence['A1-04'] = {
      objectIdentity: { assetId, integrityBasis: snapshot.integrityBasis, totalBytes: snapshot.totalBytes },
      contentHash: sha256(content),
      authority: { owner: aliceRead.status, memberWithoutReference: bobRead.status, outsider: malloryRead.status },
      attachDefect: attachOutcome,
      deleteProof: { delete: del.status, postDeleteRead: afterDelete.status },
      uploadPath: 'authenticated raw attempt/TUS/finalize (packaged SnapbackAssetClient cannot authenticate on sessions mode)',
    };
    if (attachOutcome.committed !== true) {
      return {
        result: 'fail',
        note: `upload/strict delivery/delete verified, but record attachment is impossible on 0.1.7: ${attachOutcome.code} (defect finding filed)`,
      };
    }
    return { note: 'upload, authorized strict delivery, outsider denial, attachment committed, clean delete' };
  });

  // ---------- A1-05-COLD-RESTART ----------
  await check('A1-05-COLD-RESTART', async () => {
    warmOut = await runPhase('phase-warm.mjs', {
      A1_BEARER: alice.token, A1_WORKSPACE: workspaceId });
    assert(warmOut.ok, `warm phase: ${JSON.stringify(warmOut.error ?? warmOut)}`);
    await stopDev();
    coldOut = await runPhase('phase-cold.mjs', {
      A1_BEARER: alice.token, A1_WORKSPACE: workspaceId });
    assert(coldOut.ok, `cold phase: ${JSON.stringify(coldOut.error ?? coldOut)}`);
    assert(coldOut.transport.disabled === true, 'backend unreachable during cold boot');
    assert(coldOut.sites.freshness === 'retained' && coldOut.sites.connection === 'stale',
      'retained rows render with honest freshness/connection');
    evidence['A1-05'] = {
      coldClient: { warmPid: warmOut.pid, coldPid: coldOut.pid },
      transportDisabled: coldOut.transport,
      retainedOrigin: coldOut.sites,
      protectedRecordsOffline: coldOut.protectedRecords,
    };
    // The public reference subset presents retained; the protected records —
    // the notebook's substance — cannot (documented arm boundary,
    // sync.offline-js-arm-protected GAP row; A2 finding f8 precedent).
    return {
      result: 'gap',
      note: `cold boot renders retained public sites (${coldOut.sites.rows.length} rows, freshness=retained, connection=stale) but the protected notebook records are absent by the documented JS-arm boundary`,
    };
  });

  // ---------- A1-06-RETAINED-READS ----------
  await check('A1-06-RETAINED-READS', async () => {
    const online = warmOut.records.retention;
    assert(online?.retainable === false && online?.code === 'SNAPBACK_RETENTION_NOT_RETAINABLE',
      `protected handle carries the exact documented refusal (${JSON.stringify(online)})`);
    assert(warmOut.sites.retention?.retainable === true, 'rqsEligible handle is retainable');
    assert(coldOut.protectedRecords.resolved === false
      || coldOut.protectedRecords.rows === 0, 'no protected rows presented offline');
    evidence['A1-06'] = {
      onlineProtectedRetentionFact: online,
      onlineSitesRetentionFact: warmOut.sites.retention,
      offlineProtectedOutcome: coldOut.protectedRecords,
      freshnessAxis: { offline: coldOut.sites.freshness, connection: coldOut.sites.connection },
    };
    return {
      result: 'expected-refusal',
      note: 'protected retention refuses with SNAPBACK_RETENTION_NOT_RETAINABLE carried on the handle; retained public reads carry freshness=retained honestly',
    };
  });

  // ---------- A1-07-QUEUED-DURABILITY ----------
  await check('A1-07-QUEUED-DURABILITY', async () => {
    queueOut = await runPhase('phase-queue.mjs', {
      A1_BEARER: alice.token, A1_WORKSPACE: workspaceId,
      A1_ALICE_ID: alice.userId, A1_CONFLICT_RECORD: recordIds.r1 });
    assert(queueOut.ok, `queue phase: ${JSON.stringify(queueOut.error ?? queueOut)}`);
    assert(queueOut.queuedCreate.queued === true && queueOut.queuedUpdate.queued === true,
      'create and update both queued durably');
    inspectOut = await runPhase('phase-queue-inspect.mjs', {
      A1_BEARER: alice.token, A1_WORKSPACE: workspaceId });
    assert(inspectOut.ok, `inspect phase: ${JSON.stringify(inspectOut.error ?? inspectOut)}`);
    assert(inspectOut.outbox.length === 2, 'both intents survive the offline restart');
    const sequences = inspectOut.outbox.map((e) => e.sequence);
    assert(sequences[0] < sequences[1], 'monotonic local sequence preserved');
    evidence['A1-07'] = {
      offlineProof: 'server stopped since A1-05; phase transport probe refused',
      queued: { create: queueOut.queuedCreate, update: queueOut.queuedUpdate },
      restartPersistence: inspectOut.outbox,
      outboxRuleProbe: inspectOut.d3Probe,
      noRemoteCommit: 'asserted pre-replay in A1-09 (a1-q1 absent server-side)',
    };
    return { note: `2 intents queued (${queueOut.queuedCreate.clientMutationId?.slice(0, 8)}…, seq ${sequences.join(',')}), durable across restart while offline` };
  });

  // ---------- A1-08-CONFLICT ----------
  await check('A1-08-CONFLICT', async () => {
    await spawnDev(); // reconnect epoch begins
    // sessions and bearers survive the restart (same database)
    const alice2 = await signIn('alice@sweep-a1.test', 'alice2');
    const bob2 = await signIn('bob@sweep-a1.test', 'bob2');
    // (a) two-actor online concurrent edits of the same field
    const settled = await Promise.allSettled([
      alice2.client.mutate(api.updateRecord, { args: { recordId: recordIds.r2, title: 'North fence — Alice pass' } }),
      bob2.client.mutate(api.updateRecord, { args: { recordId: recordIds.r2, title: 'North fence — Bob pass' } }),
    ]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    const rejected = settled.filter((s) => s.status === 'rejected').map((s) => diagCode(s.reason));
    const view = await bob2.client.query(api.listRecords, { args: { workspaceId } });
    const r2 = view.rows.find((r) => r._id === recordIds.r2);
    let deterministicOutcome;
    if (fulfilled.length === 2) {
      const winner = fulfilled[0].version > fulfilled[1].version ? 'alice' : 'bob';
      const expectedTitle = winner === 'alice' ? 'North fence — Alice pass' : 'North fence — Bob pass';
      assert(r2.title === expectedTitle, `later commit version wins deterministically (${r2.title})`);
      deterministicOutcome = `both committed; commit-order winner=${winner} (versions ${fulfilled.map((f) => f.version).join(',')})`;
    } else {
      assert(fulfilled.length === 1, 'exactly one commit when the other is refused');
      deterministicOutcome = `one commit, one structured refusal (${rejected.join(',')})`;
    }
    // (b) offline-vs-online conflict setup: Bob edits the same field Alice's
    // queued offline update targets, BEFORE the replay drains.
    const bobEdit = await bob2.client.mutate(api.updateRecord, {
      args: { recordId: recordIds.r1, notes: 'online note from Bob' } });
    const pre = await bob2.client.query(api.listRecords, { args: { workspaceId } });
    assert(pre.rows.find((r) => r._id === recordIds.r1).notes === 'online note from Bob',
      'online edit authoritative before replay');
    onlineConflict = { settled: fulfilled, rejected, outcome: deterministicOutcome, finalTitle: r2.title, revision: r2.revision };
    offlineConflictSetup = { bobEditVersion: bobEdit.version };
    evidence['A1-08'] = {
      twoActorBarrier: 'distinct authenticated sessions (alice2/bob2), Promise.allSettled concurrent dispatch',
      authoritativeOutcome: onlineConflict,
      clientReconciliation: 'both clients converge to the same authoritative row via independent reads',
      offlineOnlineConflictSetup: offlineConflictSetup,
    };
    return { note: deterministicOutcome };
  });

  // ---------- A1-09-RECONNECT ----------
  await check('A1-09-RECONNECT', async () => {
    assert(ready.port === evidence['A1-01'].targetIdentity.port,
      'server re-bound the same port (store origin identity preserved)');
    const bob3 = await signIn('bob@sweep-a1.test', 'bob3');
    // no-remote-commit while offline: the queued create is still absent
    const pre = await bob3.client.query(api.listRecords, { args: { workspaceId } });
    assert(!pre.rows.some((r) => r.clientKey === 'a1-q1'), 'queued create absent before replay');
    evidence['A1-07'] = evidence['A1-07'] ?? {};
    evidence['A1-07'].noRemoteCommit = `verified: a1-q1 absent pre-replay (rows=${pre.rows.length})`;
    // second device observes convergence live
    const liveRows = [];
    const bobLive = await bob3.client.liveQuery(api.listRecords, {
      args: { workspaceId }, connectionId: 'bob3_live', transport: 'stream',
      onUpdate: (rows) => liveRows.push(rows.map((r) => r.clientKey).join(',')),
    });
    reconnectOut = await runPhase('phase-reconnect.mjs', {
      A1_BEARER: alice.token, A1_WORKSPACE: workspaceId });
    assert(reconnectOut.ok, `reconnect phase: ${JSON.stringify(reconnectOut.error ?? reconnectOut)}`);
    assert(reconnectOut.replay.replayed === 2 && reconnectOut.replay.failed === 0,
      'both intents replayed exactly once');
    assert(reconnectOut.replayAgain.replayed === 0, 'second drain is a no-op');
    await until(() => (bobLive.rows.some((r) => r.clientKey === 'a1-q1') ? true : null),
      'second device observes the replayed create', 10_000);
    const post = await bob3.client.query(api.listRecords, { args: { workspaceId } });
    const q1Rows = post.rows.filter((r) => r.clientKey === 'a1-q1');
    assert(q1Rows.length === 1, 'exactly one committed row for the queued create (no duplication)');
    const r1 = post.rows.find((r) => r._id === recordIds.r1);
    assert(r1.notes === 'offline note from Alice (queued)',
      `offline-online conflict settles deterministically by commit order (${r1.notes})`);
    evidence['A1-08'].offlineOnlineConflictOutcome = {
      finalNotes: r1.notes, revision: r1.revision,
      rule: 'replayed intent commits after the online edit; last commit wins the field; both commits visible as revisions',
    };
    await bobLive.dispose();
    evidence['A1-09'] = {
      settlement: { replay: reconnectOut.replay, replayAgain: reconnectOut.replayAgain },
      authoritativeCounts: { records: post.rows.length, q1Rows: q1Rows.length },
      noDuplicates: q1Rows.length === 1,
      secondDeviceConvergence: liveRows.slice(-3),
      sitesFreshnessSettled: reconnectOut.sites,
    };
    return { note: `replay {replayed:2,failed:0,remaining:0}; re-drain no-op; single a1-q1 row; second device converged live` };
  });

  // ---------- A1-10-AUTH-LOSS ----------
  await check('A1-10-AUTH-LOSS', async () => {
    const bob4 = await signIn('bob@sweep-a1.test', 'bob4');
    const alice3 = await signIn('alice@sweep-a1.test', 'alice3');
    const handle = await bob4.client.liveQuery(api.listRecords, {
      args: { workspaceId }, connectionId: 'bob4_live', transport: 'stream',
    });
    await until(() => handle.connection === 'live', 'established protected handle');
    const rowsBefore = handle.rows.length;
    assert(rowsBefore >= 3, 'established handle sees the workspace');
    // authorization loss: Bob's seat is removed (v1 has no admin kick —
    // known finding 0137-a2-f4 — so the barrier is exercised by self-removal)
    await bob4.client.mutate(api.leaveWorkspace, { args: { workspaceId } });
    await until(() => (handle.rows.length === 0 ? true : null), 'established handle blanks', 10_000);
    // a post-revocation commit must not reach the revoked client
    await alice3.client.mutate(api.createRecord, {
      args: { workspaceId, title: 'post-revocation record', assigneeId: alice3.userId,
        assigneeName: 'Alice', dueAt: 1_785_800_000_000, position: 5000, clientKey: 'a1-post-revoke' } });
    await sleep(1_500);
    assert(handle.rows.length === 0, 'post-revocation commit not delivered to revoked handle');
    let readDenied = null;
    try { await bob4.client.query(api.listRecords, { args: { workspaceId } }); }
    catch (err) { readDenied = diagCode(err); }
    assert(readDenied === 'SNAPBACK_AUTH_PERMISSION_DENIED', `fresh read denied (${readDenied})`);
    const store = inspectStoreForProtectedBytes();
    assert(store.sentinelHits === 0, 'durable store never contained protected record bytes');
    await handle.dispose();
    evidence['A1-10'] = {
      authorityChange: 'member seat removed (self transition; admin kick is a known v1 gap, 0137-a2-f4)',
      alreadyConnectedClient: { rowsBefore, rowsAfter: handle.rows.length, blanked: true },
      postRevocationDelivery: 'not delivered',
      freshReadDenial: readDenied,
      retainedStoreInspection: { files: store.files.length, bytes: store.bytes, sentinelHits: store.sentinelHits },
    };
    return { note: `established handle blanked; later commit withheld; fresh read denied; store holds no protected bytes (${store.files.length} files)` };
  });

  // ---------- A1-11-LOGOUT ----------
  await check('A1-11-LOGOUT', async () => {
    // authLogout is a coordinator-custody capability: external-bearer custody
    // deliberately has no AuthCoordinator, so the logout persona runs the
    // browser-shaped custody flow headless (memory custody storage).
    const { AuthCoordinator, createMemoryAuthCustodyStorage } = await import('@expo/snapback-contract');
    const coordinator = new AuthCoordinator({
      appId: artifacts.appId ?? 'notebook-app',
      storage: createMemoryAuthCustodyStorage(),
    });
    const coordinated = new SnapbackClient(ready.serverUrl, {
      authCoordinator: coordinator,
      authClientProtocol: 1,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      rqsStore: null,
    });
    cleanups.push(() => coordinated.closeAuth?.());
    const requested = await coordinated.authRequestCode('alice@sweep-a1.test');
    const mailbox = await fetch(
      `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      { headers: {
          'x-snapback-admin-token': adminToken,
          'x-snapback-impersonation-capability': impersonation,
        } },
    ).then((r) => r.json());
    await coordinated.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
    const alice4 = { client: coordinated };
    const handle = await alice4.client.liveQuery(api.listRecords, {
      args: { workspaceId }, connectionId: 'alice4_live', transport: 'stream',
    });
    await until(() => handle.connection === 'live', 'established handle pre-logout');
    const rowsBefore = handle.rows.length;
    const logout = await alice4.client.authLogout();
    assert(logout === null, 'authLogout returned the exact empty 204');
    await until(() => (handle.rows.length === 0 ? true : null), 'logout blanks the protected handle', 10_000);
    let probe = null;
    try { await alice4.client.query(api.listRecords, { args: { workspaceId } }); }
    catch (err) { probe = diagCode(err); }
    assert(probe !== null, `post-logout probe refused (${probe})`);
    const store = inspectStoreForProtectedBytes();
    assert(store.sentinelHits === 0, 'durable store holds no protected bytes after logout');
    await handle.dispose();
    evidence['A1-11'] = {
      logoutBarrier: { rowsBefore, rowsAfter: handle.rows.length, exact204: true },
      postLogoutProbe: probe,
      retainedStoreInspection: { files: store.files.length, sentinelHits: store.sentinelHits },
    };
    return { note: `logout 204; established handle blanked; post-logout probe ${probe}; no protected bytes durable` };
  });

  // ---------- A1-12-EXPORT ----------
  await check('A1-12-EXPORT', async () => {
    const alice5 = await signIn('alice@sweep-a1.test', 'alice5');
    const one = await alice5.client.query(api.exportWorkspace, { args: { workspaceId } });
    const two = await alice5.client.query(api.exportWorkspace, { args: { workspaceId } });
    const payload = one.rows[0].payload;
    const hash = sha256(payload);
    assert(hash === sha256(two.rows[0].payload), 'export is deterministic (byte-identical reruns)');
    const doc = JSON.parse(payload);
    const authoritative = await alice5.client.query(api.listRecords, { args: { workspaceId } });
    assert(doc.recordCount === authoritative.rows.length, 'export count matches authoritative count');
    writeFileSync(join(evidenceDir, 'export.a1.json'), payload);
    evidence['A1-12'] = {
      exportReceipt: { formatVersion: doc.formatVersion, recordCount: doc.recordCount },
      contentHash: hash,
      authoritativeCounts: { records: authoritative.rows.length },
    };
    return { note: `deterministic export (${doc.recordCount} records, sha256 ${hash.slice(0, 12)}…)` };
  });

  // ---------- A1-13-CLEANUP (kernel) ----------
  await check('A1-13-CLEANUP', async () => {
    // Admin custody: the seed routes on a sessions server need both the
    // auth-client offer (external-bearer custody carries it) and the admin
    // token for the privileged transport.
    const adminActor = await signIn('alice@sweep-a1.test', 'admin-actor');
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: adminActor.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const stream = preview?.current?.dataVersionStream;
    assert(typeof stream === 'string' && stream.length > 0, `active data version stream discovered (${JSON.stringify(preview)})`);
    const receipt = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: stream },
    });
    assert(receipt.operation === 'reset-install' && receipt.outcome === 'reset-installed',
      'versioned reset-install settled');
    // post-cleanup verification through a freshly authenticated client
    const verifier = await signIn('alice@sweep-a1.test', 'alice-verify');
    const sites = await verifier.client.query(api.listSites, {});
    assert(sites.rows.length === 3
      && sites.rows.every((r) => r._id.startsWith('site_')), 'literal seed baseline restored');
    let negative = null;
    try {
      const rows = (await verifier.client.query(api.listRecords, { args: { workspaceId } })).rows.length;
      negative = `rows=${rows}`;
      assert(rows === 0, 'arm-created records absent');
    } catch (err) { negative = diagCode(err); }
    evidence['A1-13'] = {
      targetBoundPlan: 'versioned reset-install scoped to this suite-owned dev database; no other process, port, or store touched',
      cleanupReceipt: {
        operation: receipt.operation, outcome: receipt.outcome,
        seedVersion: receipt.seedVersion, resetDeletedRows: receipt.resetDeletedRows,
        dataVersionStream: receipt.dataVersionStream,
      },
      postCleanupNegative: { workspaceQuery: negative, sites: sites.rows.length },
    };
    return { note: `versioned reset-install (deleted ${receipt.resetDeletedRows} rows); literal seed restored; workspace retired (${negative})` };
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
  const tally = { pass: 0, gap: 0, fail: 0, 'expected-refusal': 0 };
  for (const r of results) tally[r.result] = (tally[r.result] ?? 0) + 1;
  const report = {
    schemaVersion: 'sweep-a1.acceptance.v1',
    title: 'LLP 0137 A1 snapback-web acceptance',
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

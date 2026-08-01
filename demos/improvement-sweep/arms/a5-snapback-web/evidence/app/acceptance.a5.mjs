// LLP 0137 A5 (collaborative AI research room) acceptance suite —
// Snapback web arm. External-consumer build: public @expo/snapback-* 0.1.7.
// 13 checks, contract demos/improvement-sweep/protocol/contracts/a5-research-room.v1.json.
//
// The suite owns its dev server (SNAPBACK_OUTBOUND_ACTIONS=1 for the
// refresh effect, SNAPBACK_CRON_DISABLED=1 so every scheduler run is a
// deterministic authenticated tick) and its own local refresh content
// server. Fresh managed database every run.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { SnapbackClient, createExternalSessionClient } from '@expo/snapback-client';

const root = resolve(import.meta.dirname);
const evidenceDir = join(root, 'a5-evidence');
mkdirSync(evidenceDir, { recursive: true });

const EXPECTED_CHECKS = 13;
const ROOM = 'room_arch';
const REFRESH_TOKEN_CANARY = 'tok_a5_refresh_c4n4ry_9d2e';
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
    if (process.env.A5_DEBUG) console.error(err?.stack ?? '');
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

// ---------- minimal valid PDF (magic-detectable; a1-f10 workaround) ----------
function buildPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  return Buffer.from([
    '%PDF-1.4',
    '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
    '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
    '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj',
    `4 0 obj <</Length ${stream.length}>> stream`,
    stream,
    'endstream endobj',
    '5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj',
    'trailer <</Root 1 0 R>>',
    '%%EOF',
  ].join('\n'), 'latin1');
}

// ---------- local refresh content server (STRICT: requires the secret) ----------
const REFRESH_PAYLOAD = 'refresh-payload: roadmap delta 2026-08-01';
const refreshLedgerLocal = { requests: [] };
const contentServer = http.createServer((req, res) => {
  const authValid = String(req.headers.authorization ?? '') === `Bearer ${REFRESH_TOKEN_CANARY}`;
  refreshLedgerLocal.requests.push({ at: Date.now(), authValid });
  if (!authValid) { res.statusCode = 401; res.end('bad token'); return; }
  res.setHeader('content-type', 'text/plain');
  res.end(REFRESH_PAYLOAD);
});
await new Promise((res) => contentServer.listen(0, '127.0.0.1', res));
const contentUrl = `http://127.0.0.1:${contentServer.address().port}/feed`;

// ---------- dev server lifecycle ----------
const readyFile = join(root, '.snapback', 'dev.ready.json');
const lifecycleEvents = [];
let devStdoutRaw = '';
async function spawnDev() {
  // Own-ports discipline: guard-block prior arms' 4287-4291 during the
  // runtime's port scan; fleet-shared 4420 asserted below.
  const guards = [];
  for (const port of [4287, 4288, 4289, 4290, 4291]) {
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
  assert(![4287, 4288, 4289, 4290, 4291].includes(ready.port), 'must not reuse prior arm ports');
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
    clientStoreId: `sweep-a5-${label}-${process.pid}`,
    rqsStore: null,
  });
  cleanups.push(() => client.closeAuth?.());
  return { client, userId: credential.session.userId, token: credential.token, email, label };
}

async function uploadFile(actor, intent, filename, bytes) {
  const authed = { authorization: `Bearer ${actor.token}`, ...protocolHeaders };
  const created = await fetch(`${ready.serverUrl}/assets/attempts`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({
      intentId: intent.name,
      intentPolicyHash: intent.intentPolicyHash ?? null,
      args: {},
      declaredFilename: filename,
      declaredLength: bytes.byteLength,
      declaredContentType: 'application/octet-stream',
    }),
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }));
  if (!created.ok) return { failed: 'attempt', status: created.status, body: created.body };
  const attemptId = created.body.task.attemptId;
  const assetId = created.body.task.assetId;
  const checksum = createHash('sha256').update(bytes).digest('base64');
  const patched = await fetch(`${ready.serverUrl}${created.body.transfer.uploadUrl}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${actor.token}`,
      'x-snapback-auth-client-protocol': '1',
      'tus-resumable': '1.0.0',
      'content-type': 'application/offset+octet-stream',
      'upload-offset': '0',
      'upload-checksum': `sha256 ${checksum}`,
    },
    body: bytes,
  });
  if (!patched.ok) return { failed: 'transfer', status: patched.status };
  const finalized = await fetch(`${ready.serverUrl}/assets/attempts/${encodeURIComponent(attemptId)}/finalize`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({ attemptId, lifecycleGeneration: 1, declaredDigest: sha256hex(bytes) }),
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }));
  if (!finalized.ok) return { failed: 'finalize', status: finalized.status, body: finalized.body };
  return { assetId, attemptId, finalize: finalized.body };
}

const readAssetBytes = (assetId, variant, token) => fetch(
  `${ready.serverUrl}/assets/records/${assetId}/bytes/${variant}`,
  { headers: token ? { authorization: `Bearer ${token}`, 'x-snapback-auth-client-protocol': '1' } : { 'x-snapback-auth-client-protocol': '1' } },
);

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

  const alice = await signIn('alice@sweep-a5.test', 'alice');
  const bruno = await signIn('bruno@sweep-a5.test', 'bruno');
  const mallory = await signIn('mallory@sweep-a5.test', 'mallory');

  // ---------- A5-01-SEED (kernel) ----------
  await check('A5-01-SEED', async () => {
    const ids = new Set([alice.userId, bruno.userId, mallory.userId]);
    assert(ids.size === 3, 'three distinct authenticated principals');
    let preInvite = null;
    try { await alice.client.query(api.roomOverview, { args: { roomId: ROOM } }); }
    catch (err) { preInvite = diagCode(err); }
    assert(preInvite === 'SNAPBACK_AUTH_PERMISSION_DENIED', `pre-invite denial (${preInvite})`);
    const ownerSeat = await alice.client.mutate(api.redeemInvite, { args: { code: 'INV-OWNER-3401' } });
    const memberSeat = await bruno.client.mutate(api.redeemInvite, { args: { code: 'INV-MEMBER-7702' } });
    assert(ownerSeat.result.role === 'owner' && memberSeat.result.role === 'member', 'seeded invite roles');
    const overview = (await alice.client.query(api.roomOverview, { args: { roomId: ROOM } })).rows[0];
    assert(overview.name === 'Backend architecture', 'room fixture name');
    assert(overview.questionSeq === 0 && overview.questionCount === 0 && overview.answerCount === 0, 'no runtime rows yet');
    assert(overview.sourceCount === 4 && overview.embeddingCount === 4, `seeded corpus (${overview.sourceCount}/${overview.embeddingCount})`);
    const sources = (await alice.client.query(api.sourceList, { args: { roomId: ROOM } })).rows;
    const titles = sources.map((s) => s.title);
    assert(JSON.stringify(titles) === JSON.stringify(['Architecture.pdf', 'Interview notes.md', 'Benchmarks.csv', 'Roadmap.txt']),
      `seeded source order (${titles})`);
    // seed identity: served hashes equal the literal fixture's
    for (const seedRow of seedFixture.tables.sources) {
      const served = sources.find((s) => s.title === seedRow.title);
      assert(served && served.contentSha256 === seedRow.contentSha256, `content hash for ${seedRow.title}`);
      assert(served.hasEmbedding === true, `embedding fixture present for ${seedRow.title}`);
    }
    const embeddings = (await bruno.client.query(api.embeddingInventory, { args: { roomId: ROOM } })).rows;
    assert(embeddings.length === 4 && embeddings.every((e) => e.dim === 32 && e.model === 'fixture-32'),
      'embeddings fixture: 4 rows, dim 32, model fixture-32');
    assert(embeddings.every((e) => e.sample.length === 4 && e.sample.every((n) => typeof n === 'number')),
      'embedding vectors carry numbers');
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: alice.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    assert(preview?.current?.seedVersion === 'a5-research.2026-08-01.2',
      `installed seed identity (${JSON.stringify(preview?.current)})`);
    evidence['A5-01'] = {
      targetIdentity: {
        serverUrl: ready.serverUrl, port: ready.port,
        appId: artifacts.appId ?? 'research-app',
        inputsHash: artifacts.inputsHash, authMode: 'sessions',
        runtime: ready.runtime ?? null,
      },
      authoritativeCounts: {
        sources: overview.sourceCount, embeddings: overview.embeddingCount,
        questions: overview.questionCount, answers: overview.answerCount,
        invites: 3, members: 2,
      },
      seedReceipt: {
        seedVersion: preview.current.seedVersion,
        dataVersionStream: preview.current.dataVersionStream ?? null,
      },
      personas: { alice: 'owner', bruno: 'member (second live client)', mallory: 'outsider (authenticated, no seat)' },
    };
    return { note: 'room + 4 sources + 4 embedding fixtures (dim 32) + 3 invites seeded; 3 distinct principals; owner/member seats claimed' };
  });

  // ---------- A5-02-SOURCES ----------
  let cancelNotesAssetId = null;
  let cancelNotesSourceId = null;
  let methodsAssetId = null;
  const CANCEL_NOTES_TEXT = 'Confirmed cancellation must fence late progress patches. A cancelled question never accepts a late answer.';
  const METHODS_TEXT = 'Method: two warmups then seven samples per probe; medians reported.';
  await check('A5-02-SOURCES', async () => {
    // (1) authorized upload: PDF (magic-detectable — a1-f10 cited) by the owner
    const pdfBytes = buildPdf(CANCEL_NOTES_TEXT);
    const up = await uploadFile(alice, api.sourceUpload, 'cancellation-notes.pdf', pdfBytes);
    assert(!up.failed, `pdf upload published (${up.failed}: ${JSON.stringify(up.body ?? {}).slice(0, 200)})`);
    cancelNotesAssetId = up.assetId;
    assert(up.finalize.task.availability === 'ready', 'pdf asset ready');
    // (2) octet-stream lane for text-shaped research files (md)
    const mdBytes = Buffer.from(`# Methods\n\n${METHODS_TEXT}\n`, 'utf8');
    const upMd = await uploadFile(alice, api.sourceUpload, 'methods.md', mdBytes);
    const mdLane = upMd.failed ? `refused at ${upMd.failed} (${upMd.status})` : 'ready';
    if (!upMd.failed) methodsAssetId = upMd.assetId;
    // (3) corpus rows with metadata (plain-string asset reference: a1-f1)
    const added = await alice.client.mutate(api.addSource, { args: {
      roomId: ROOM, title: 'Cancellation notes.pdf', kind: 'pdf', content: CANCEL_NOTES_TEXT,
      assetId: cancelNotesAssetId, contentSha256: sha256hex(CANCEL_NOTES_TEXT),
      byteLength: pdfBytes.byteLength, clientKey: 'up-cancel-notes', uploaderName: 'Alice',
    } });
    cancelNotesSourceId = added.result.sourceId;
    assert(added.result.deduped === false && added.result.embeddingDim === 32, 'source row + embedding fixture committed');
    let methodsSourceId = null;
    if (methodsAssetId) {
      const addedMd = await alice.client.mutate(api.addSource, { args: {
        roomId: ROOM, title: 'Methods.md', kind: 'md', content: METHODS_TEXT,
        assetId: methodsAssetId, contentSha256: sha256hex(METHODS_TEXT),
        byteLength: mdBytes.byteLength, clientKey: 'up-methods', uploaderName: 'Alice',
      } });
      methodsSourceId = addedMd.result.sourceId;
    }
    // metadata visible to the second member
    const list = (await bruno.client.query(api.sourceList, { args: { roomId: ROOM } })).rows;
    const cancelRow = list.find((s) => s.title === 'Cancellation notes.pdf');
    assert(cancelRow && cancelRow.assetId === cancelNotesAssetId && cancelRow.uploaderName === 'Alice',
      'metadata row carries the asset reference and uploader');
    // (4) download: owner strict read with stable content identity
    const read1 = await readAssetBytes(cancelNotesAssetId, 'primary', alice.token);
    assert(read1.status === 200, `owner primary delivery (${read1.status})`);
    assert(read1.headers.get('cache-control')?.includes('no-store'), 'private-strict cache headers');
    const bytes1 = Buffer.from(await read1.arrayBuffer());
    const read2 = await readAssetBytes(cancelNotesAssetId, 'primary', alice.token);
    const bytes2 = Buffer.from(await read2.arrayBuffer());
    assert(sha256hex(bytes1) === sha256hex(bytes2), 'content identity stable across reads');
    const servedEqualsUploaded = sha256hex(bytes1) === sha256hex(pdfBytes);
    // (5) the collaborative download leg: can the second MEMBER read the bytes?
    const brunoRead = await readAssetBytes(cancelNotesAssetId, 'primary', bruno.token);
    const malloryRead = await readAssetBytes(cancelNotesAssetId, 'primary', mallory.token);
    assert(malloryRead.status !== 200, `outsider denied the byte lane (${malloryRead.status})`);
    // the documented sharing lanes (re-verification of the known chain)
    const signed = await fetch(`${ready.serverUrl}/assets/records/${cancelNotesAssetId}/signed-url`, {
      method: 'POST', headers: { authorization: `Bearer ${alice.token}`, ...protocolHeaders },
      body: JSON.stringify({ variant: 'primary' }),
    });
    // (6) authority on deletion: the member cannot delete the owner's asset
    const brunoDelete = await fetch(`${ready.serverUrl}/assets/records/${methodsAssetId ?? cancelNotesAssetId}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${bruno.token}`, ...protocolHeaders },
    });
    assert(brunoDelete.status !== 200 && brunoDelete.status !== 204, `non-owner delete refused (${brunoDelete.status})`);
    let brunoRemove = null;
    try { await bruno.client.mutate(api.removeSource, { args: { sourceId: methodsSourceId ?? cancelNotesSourceId } }); }
    catch (err) { brunoRemove = diagCode(err); }
    assert(brunoRemove === 'SNAPBACK_AUTH_PERMISSION_DENIED', `member cannot remove another member's source (${brunoRemove})`);
    // (7) delete-proof on the probe file: owner deletes Methods.md
    let deleteProof = null;
    if (methodsAssetId && methodsSourceId) {
      const del = await fetch(`${ready.serverUrl}/assets/records/${methodsAssetId}`, {
        method: 'DELETE', headers: { authorization: `Bearer ${alice.token}`, ...protocolHeaders },
      });
      assert(del.ok, `owner delete accepted (${del.status})`);
      const post = await readAssetBytes(methodsAssetId, 'primary', alice.token);
      assert([403, 404, 410].includes(post.status), `deleted asset refuses (${post.status})`);
      await alice.client.mutate(api.removeSource, { args: { sourceId: methodsSourceId } });
      const after = (await alice.client.query(api.roomOverview, { args: { roomId: ROOM } })).rows[0];
      assert(after.sourceCount === 5 && after.embeddingCount === 5, `corpus back to 5 after removal (${after.sourceCount})`);
      deleteProof = { assetDelete: del.status, postDeleteRead: post.status, corpusRowRemoved: true };
    }
    evidence['A5-02'] = {
      objectIdentity: {
        cancelNotes: { assetId: cancelNotesAssetId, sourceId: cancelNotesSourceId, uploadedSha256: sha256hex(pdfBytes), bytes: pdfBytes.byteLength },
        methods: { assetId: methodsAssetId, lane: mdLane },
        uploadPath: 'authenticated raw attempt/TUS/finalize (packaged asset client cannot authenticate on sessions — known 0137-a1-f3, cited)',
      },
      contentHash: {
        servedPrimarySha256: sha256hex(bytes1), stableAcrossReads: true, servedEqualsUploaded,
        corpusTextSha256: sha256hex(CANCEL_NOTES_TEXT),
      },
      authority: {
        ownerRead: read1.status, memberRead: brunoRead.status, outsiderRead: malloryRead.status,
        signedUrlIssuance: signed.status,
        nonOwnerDelete: brunoDelete.status, nonUploaderRemoveSource: brunoRemove,
      },
      deleteProof,
      corpusSplit: 'extracted text lives in the sources row (member-readable retrieval corpus); raw bytes in the asset store are owner-locked on 0.1.7',
    };
    if (brunoRead.status !== 200) {
      return {
        result: 'fail',
        note: `owner upload/metadata/download/delete + outsider denial all verified (octet-stream md lane: ${mdLane}), but the seated MEMBER cannot download a shared source (${brunoRead.status}): no non-owner viewer is authorizable on 0.1.7 (known chain 0137-a1-f2/0137-a1-f3/0137-a4-f3, cited; signed-url ${signed.status}) — the collaborative file-sharing product fact fails`,
      };
    }
    return { note: `full source-file lifecycle verified incl. member download (${brunoRead.status})` };
  });

  // ---------- A5-03-OUTSIDER ----------
  await check('A5-03-OUTSIDER', async () => {
    const denied = {};
    for (const [name, fn] of Object.entries({
      roomOverview: () => mallory.client.query(api.roomOverview, { args: { roomId: ROOM } }),
      sourceList: () => mallory.client.query(api.sourceList, { args: { roomId: ROOM } }),
      sourceDetail: () => mallory.client.query(api.sourceDetail, { args: { sourceId: 'src_architecture' } }),
      searchSources: () => mallory.client.query(api.searchSources, { args: { roomId: ROOM, q: 'cancellation' } }),
      embeddingInventory: () => mallory.client.query(api.embeddingInventory, { args: { roomId: ROOM } }),
      questionFeed: () => mallory.client.query(api.questionFeed, { args: { roomId: ROOM } }),
      refreshLedger: () => mallory.client.query(api.refreshLedger, { args: { roomId: ROOM } }),
      askQuestion: () => mallory.client.mutate(api.askQuestion, { args: { roomId: ROOM, text: 'forged', dedupeKey: 'mallory-1', askerName: 'Mallory', ttlMs: 60000 } }),
      addSource: () => mallory.client.mutate(api.addSource, { args: { roomId: ROOM, title: 'x', kind: 'txt', content: 'x', assetId: '', contentSha256: 'x', byteLength: 1, clientKey: 'mallory-src', uploaderName: 'Mallory' } }),
      setRefreshSource: () => mallory.client.mutate(api.setRefreshSource, { args: { roomId: ROOM, url: 'http://127.0.0.1:1/x' } }),
    })) {
      try { await fn(); denied[name] = 'ALLOWED (defect)'; }
      catch (err) { denied[name] = diagCode(err); }
    }
    // live-subscription denial
    let subscribe = null;
    try {
      const handle = await mallory.client.liveQuery(api.questionFeed, {
        args: { roomId: ROOM }, connectionId: 'mallory_live', transport: 'stream' });
      await until(() => (handle.connection === 'live' || handle.error ? handle : null), 'mallory sub settles', 8_000);
      subscribe = handle.error ? diagCode(handle.error) : `CONNECTED (defect: ${handle.rows.length})`;
      await handle.dispose();
    } catch (err) { subscribe = diagCode(err); }
    denied.subscribe = subscribe;
    for (const [name, code] of Object.entries(denied)) {
      assert(code === 'SNAPBACK_AUTH_PERMISSION_DENIED', `${name} must deny uniformly (${code})`);
    }
    // file bytes + invite guess + action boundary
    const fileRead = await readAssetBytes(cancelNotesAssetId, 'primary', mallory.token);
    assert(fileRead.status !== 200, `outsider file read denied (${fileRead.status})`);
    let badInvite = null;
    try { await mallory.client.mutate(api.redeemInvite, { args: { code: 'INV-OWNER-0000' } }); }
    catch (err) { badInvite = diagCode(err); }
    assert(badInvite !== null, 'invite guess refused');
    let action = null;
    try {
      const env = await mallory.client.action(api.runAssistant, { args: { questionId: 'src_architecture', throughStage: '', fault: '' } });
      action = actionRefusal(env);
    } catch (err) { action = diagCode(err); }
    assert(!String(action).startsWith('ALLOWED'), `outsider action refused (${action})`);
    evidence['A5-03'] = {
      negativeQuery: denied,
      negativeFile: { primary: fileRead.status },
      negativeSubscription: subscribe,
      inviteGuess: badInvite,
      actionBoundary: { code: action, note: 'action refusal collapses the auth code (known 0137-a4-f5 / 0137-a3-f3, cited)' },
    };
    return { note: `outsider denied uniformly on ${Object.keys(denied).length} surfaces incl. live subscribe; file bytes ${fileRead.status}; action boundary refused (collapsed code, cited)` };
  });

  // ---------- A5-04-KEYWORD ----------
  await check('A5-04-KEYWORD', async () => {
    // Frozen expectation for the corpus at this point (4 seeds + Cancellation notes.pdf):
    const expected = [
      { title: 'Cancellation notes.pdf', score: 4 },
      { title: 'Architecture.pdf', score: 3 },
      { title: 'Interview notes.md', score: 1 },
    ];
    const mine = (await alice.client.query(api.searchSources, { args: { roomId: ROOM, q: 'cancellation safety' } })).rows;
    assert(JSON.stringify(mine.map((r) => ({ title: r.title, score: r.score }))) === JSON.stringify(expected),
      `frozen expected set (${JSON.stringify(mine.map((r) => [r.title, r.score]))})`);
    assert(mine.every((r) => r.snippet.length > 0), 'snippets extracted');
    // the second member sees the same room-scoped results
    const theirs = (await bruno.client.query(api.searchSources, { args: { roomId: ROOM, q: 'cancellation safety' } })).rows;
    assert(JSON.stringify(theirs) === JSON.stringify(mine), 'member-scoped retrieval identical for both members');
    const vectorQuery = (await bruno.client.query(api.searchSources, { args: { roomId: ROOM, q: 'vector' } })).rows;
    assert(vectorQuery.length === 1 && vectorQuery[0].title === 'Roadmap.txt', `distinct term partition (${JSON.stringify(vectorQuery.map((r) => r.title))})`);
    const empty = (await bruno.client.query(api.searchSources, { args: { roomId: ROOM, q: '!!' } })).rows;
    assert(empty.length === 0, 'no-term query returns nothing');
    evidence['A5-04'] = {
      indexOrQueryProof: 'membership-gated handler query (requireRole + by_room index scan + deterministic scoring); the native searchIndex cannot express room-member visibility on 0.1.7 (known 0137-a3-f2, cited)',
      authoritativeResults: {
        query: 'cancellation safety',
        results: mine.map((r) => ({ title: r.title, score: r.score, snippet: r.snippet.slice(0, 60) })),
        secondMemberIdentical: true,
        vectorTermPartition: vectorQuery.map((r) => r.title),
      },
    };
    return { note: `keyword retrieval returns the frozen expected set (${mine.map((r) => `${r.title}:${r.score}`).join(', ')}), identical for both members; native search index cited as inexpressible (a3-f2)` };
  });

  // ---------- A5-05-VECTOR ----------
  await check('A5-05-VECTOR', async () => {
    // Is there any vector surface on the packaged closure? (identity probe)
    const apiSurface = Object.keys(api).sort();
    const vectorish = apiSurface.filter((k) => k.toLowerCase().includes('vector') || k.toLowerCase().includes('semantic') || k.toLowerCase().includes('embed'));
    const schemaManifest = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'schema.manifest.json'), 'utf8'));
    const manifestText = JSON.stringify(schemaManifest);
    const fixture = (await bruno.client.query(api.embeddingInventory, { args: { roomId: ROOM } })).rows;
    assert(fixture.length === 5 && fixture.every((e) => e.dim === 32), 'deterministic 32-dim fixture retained (5 sources)');
    evidence['A5-05'] = {
      vectorPathIdentity: {
        ordinarySupportedPath: 'none on @expo/snapback-* 0.1.7',
        capabilityIndexRow: 'guide/capabilities.md backend.vector-search: maturity design-only, "no ordinary vector path ships today" (GAP row)',
        design: 'LLP 0132 (portable vector search) Accepted 2026-07-31 — unimplemented in the shipped packages',
        generatedSurfaceScan: { vectorishExports: vectorish, apiExportCount: apiSurface.length },
        manifestVectorMentions: manifestText.toLowerCase().includes('vector') ? 'schema stores the app fixture table only' : 'none',
      },
      deterministicResults: {
        fixture: fixture.map((e) => ({ title: e.title, dim: e.dim, sample: e.sample })),
        note: 'the embeddings fixture (deterministic charcode-folded 32-dim vectors) is STORED per the contract seed fact',
      },
      nonclaimIfGap: 'no semantic/vector retrieval is claimed: no in-handler cosine scan is offered as a vector path; the app exposes keyword retrieval only. Recording explicit GAP per the check wording.',
    };
    return {
      result: 'gap',
      note: 'no ordinary vector path on 0.1.7 (capability index GAP row; LLP 0132 Accepted-but-unimplemented cited); embeddings fixture stored and inventoried; explicit nonclaim recorded',
    };
  });

  // ---------- A5-06-PROGRESS ----------
  let q1 = null;
  const stageDeliveries = [];
  await check('A5-06-PROGRESS', async () => {
    const ask = await alice.client.mutate(api.askQuestion, { args: {
      roomId: ROOM, text: 'Which backend properties matter most for cancellation safety?',
      dedupeKey: 'q-cancel-safety-1', askerName: 'Alice', ttlMs: 60_000,
    } });
    q1 = ask.result.questionId;
    assert(ask.result.seq === 1 && ask.result.status === 'running', 'question accepted');
    // the second member observes the thread live over the managed stream
    const threadHandle = await bruno.client.liveQuery(api.questionThread, {
      args: { roomId: ROOM, questionId: q1 }, connectionId: 'bruno_thread', transport: 'stream' });
    await until(() => (threadHandle.connection === 'live' ? true : null), 'thread live');
    cleanups.push(() => threadHandle.dispose());
    await until(() => (threadHandle.rows[0]?.progress?.length === 1 ? true : null), 'accepted visible');
    // four separately committed durable stages, each observed live
    for (const [throughStage, expectedProgress] of [['retrieved', 2], ['ranked', 3], ['drafted', 4], ['', 5]]) {
      const t0 = Date.now();
      const step = await alice.client.action(api.runAssistant, { args: { questionId: q1, throughStage, fault: '' } });
      assert(step.ok !== false, `assistant step ok (${JSON.stringify(step).slice(0, 200)})`);
      await until(() => (threadHandle.rows[0]?.progress?.length === expectedProgress ? true : null),
        `progress ${expectedProgress} delivered live`);
      stageDeliveries.push({
        stage: threadHandle.rows[0].progress[expectedProgress - 1].stage,
        progressSeq: expectedProgress,
        deliveredMs: Date.now() - t0,
        status: threadHandle.rows[0].status,
      });
    }
    const finalThread = threadHandle.rows[0];
    assert(finalThread.status === 'complete' && finalThread.stage === 'answered', 'terminal completion');
    // durable sequence + terminal order from an independent snapshot
    const snapshot = (await alice.client.query(api.questionThread, { args: { roomId: ROOM, questionId: q1 } })).rows[0];
    assert(snapshot.progress.length === 5, `five durable progress rows (${snapshot.progress.length})`);
    assert(JSON.stringify(snapshot.progress.map((p) => p.seq)) === JSON.stringify([1, 2, 3, 4, 5]), 'strictly ordered sequence');
    assert(JSON.stringify(snapshot.progress.map((p) => p.stage)) ===
      JSON.stringify(['accepted', 'retrieved', 'ranked', 'drafted', 'answered']), 'pipeline stage order');
    assert(snapshot.status === 'complete' && snapshot.settledAt > 0, 'settled after the durable stream');
    const beforeTerminal = snapshot.progress.slice(0, 4).every((p) => p.at <= snapshot.settledAt);
    assert(beforeTerminal, 'every intermediate progress row committed at or before settlement');
    assert(JSON.stringify(finalThread.progress) === JSON.stringify(snapshot.progress),
      'live rows equal the authoritative snapshot');
    evidence['A5-06'] = {
      durableSequence: snapshot.progress,
      transportAttribution: {
        connection: 'live', transport: 'stream',
        observer: 'bruno (independent authenticated session)',
        perStageDeliveries: stageDeliveries,
        driver: 'four runAssistant action invocations (resumable step worker), each committing exactly one durable stage through the serialized assistStep mutation',
      },
      terminalOrder: {
        statusAfterStream: snapshot.status, settledAt: snapshot.settledAt,
        stageSequence: snapshot.progress.map((p) => p.stage),
      },
      aiBoundaryNonclaim: 'no external AI provider is called by the assistant: it is the deterministic in-transaction extractive pipeline (the contract-sanctioned stub). Plain ctx.fetch egress is unregistered (known 0137-a4-f1), but the STREAMED egress lane (ctx.streamAttempt + ctx.fetchStream) is proven working by this arm (finding 0137-a5-f1) and carries the A5-12 refresh — a streaming AI-provider call is therefore authorable on 0.1.7 through the documented streamed-actions pattern',
    };
    return { note: `4 durable stages streamed before terminal completion; observer deliveries ${stageDeliveries.map((d) => `${d.stage}:${d.deliveredMs}ms`).join(' ')}; live rows equal the snapshot` };
  });

  // ---------- A5-07-CITATIONS ----------
  await check('A5-07-CITATIONS', async () => {
    const thread = (await bruno.client.query(api.questionThread, { args: { roomId: ROOM, questionId: q1 } })).rows[0];
    const answer = thread.answer[0];
    assert(answer, 'answer present');
    assert(answer.citations.length === 2, `two citations (${answer.citations.length})`);
    const citedTitles = answer.citations.map((c) => c.title);
    assert(JSON.stringify(citedTitles) === JSON.stringify(['Cancellation notes.pdf', 'Architecture.pdf']),
      `expected citation set (${citedTitles})`);
    // source-id validation: every citation resolves to an authorized room source
    for (const citation of answer.citations) {
      const detail = (await bruno.client.query(api.sourceDetail, { args: { sourceId: citation.sourceId } })).rows[0];
      assert(detail && detail.title === citation.title, `citation ${citation.title} resolves for the member`);
    }
    assert(answer.text.length > 20 && answer.text.toLowerCase().includes('cancellation'), 'extractive answer text grounded');
    // negative: an invalid citation is refused at the terminal commit
    const scratch = await alice.client.mutate(api.askQuestion, { args: {
      roomId: ROOM, text: 'citation negative probe', dedupeKey: 'q-cite-neg-1', askerName: 'Alice', ttlMs: 60_000 } });
    let rejected = null;
    try {
      await alice.client.mutate(api.completeAnswer, { args: {
        questionId: scratch.result.questionId, text: 'bogus',
        citations: [{ sourceId: 'src_deleted_or_foreign', title: 'Nope.pdf' }],
      } });
    } catch (err) { rejected = String(err?.diagnostic?.details?.message ?? err?.message ?? diagCode(err)); }
    assert(rejected !== null, 'invalid citation refused');
    await alice.client.mutate(api.settleQuestion, { args: {
      questionId: scratch.result.questionId, outcome: 'failed', detail: 'probe question retired' } });
    evidence['A5-07'] = {
      authoritativeAnswer: { text: answer.text, citations: answer.citations, createdAt: answer.createdAt },
      sourceIdValidation: {
        memberResolvedAll: true,
        invalidCitationRefusal: rejected?.slice(0, 140),
        validationSite: 'completeAnswer validates each cited source exists in the question room inside the same transaction',
      },
      authority: 'citations resolve through membership-gated sourceDetail for the second member; outsider denial proven in A5-03',
    };
    return { note: `answer cites [${citedTitles.join(', ')}], both resolving for the second member; invalid citation refused at commit` };
  });

  // ---------- A5-08-CANCEL ----------
  let q2 = null;
  await check('A5-08-CANCEL', async () => {
    const ask = await alice.client.mutate(api.askQuestion, { args: {
      roomId: ROOM, text: 'Does semantic retrieval ship today?', dedupeKey: 'q-cancel-fence-1',
      askerName: 'Alice', ttlMs: 60_000 } });
    q2 = ask.result.questionId;
    // run the worker mid-pipeline (3 progress rows), then cancel
    await alice.client.action(api.runAssistant, { args: { questionId: q2, throughStage: 'ranked', fault: '' } });
    const cancel = await alice.client.mutate(api.settleQuestion, { args: {
      questionId: q2, outcome: 'cancelled', detail: 'asker cancelled before drafting' } });
    assert(cancel.result.fenced === false && cancel.result.status === 'cancelled', 'cancellation confirmed');
    const settledAt = cancel.result.settledAt;
    const before = (await bruno.client.query(api.questionThread, { args: { roomId: ROOM, questionId: q2 } })).rows[0];
    assert(before.progress.length === 3 && before.status === 'cancelled', 'cancelled mid-pipeline at 3 progress rows');
    // late-attempt injection: every durable patch lane the worker could use
    const lateAssist = await alice.client.action(api.runAssistant, { args: { questionId: q2, throughStage: '', fault: '' } });
    const lateProgress = await alice.client.mutate(api.appendProgress, { args: {
      questionId: q2, stage: 'drafted', detail: 'late worker progress (must fence)' } });
    assert(lateProgress.result.fenced === true, 'late progress patch fenced');
    const lateAnswer = await alice.client.mutate(api.completeAnswer, { args: {
      questionId: q2, text: 'late answer (must fence)',
      citations: [{ sourceId: 'src_architecture', title: 'Architecture.pdf' }] } });
    assert(lateAnswer.result.fenced === true, 'late answer commit fenced');
    const lateSettle = await alice.client.mutate(api.settleQuestion, { args: {
      questionId: q2, outcome: 'failed', detail: 'late resettle (must fence)' } });
    assert(lateSettle.result.fenced === true && lateSettle.result.status === 'cancelled', 'late resettle fenced');
    // authoritative log: no late patch landed; fences receipted append-only
    const after = (await bruno.client.query(api.questionThread, { args: { roomId: ROOM, questionId: q2 } })).rows[0];
    assert(after.progress.length === 3, `no late durable progress (${after.progress.length})`);
    assert(after.answer.length === 0, 'no late answer');
    assert(after.status === 'cancelled' && after.settledAt === settledAt, 'terminal record unchanged');
    const ledger = (await alice.client.query(api.attemptLedger, { args: { roomId: ROOM, questionId: q2 } })).rows;
    const fences = ledger.filter((r) => r.event === 'fenced').map((r) => r.outcome);
    assert(fences.includes('assistStep') && fences.includes('appendProgress')
      && fences.includes('completeAnswer') && fences.includes('settle:failed'),
      `every late lane receipted in the ledger (${fences})`);
    const retry = await alice.client.mutate(api.retryQuestion, { args: { questionId: q2 } });
    assert(retry.result.retried === false && retry.result.status === 'cancelled', 'cancelled is hard-terminal (retry refused)');
    evidence['A5-08'] = {
      cancelSettlement: { status: 'cancelled', settledAt, atProgress: 3, cancelledBy: 'asker (member settlement mutation)' },
      lateAttemptInjection: {
        lanes: ['runAssistant (worker step)', 'appendProgress', 'completeAnswer', 'settleQuestion(failed)'],
        allFenced: true,
        workerStepResult: lateAssist.result ?? lateAssist,
      },
      authoritativeLog: {
        progressAfter: after.progress.length, answersAfter: after.answer.length,
        fencedReceipts: ledger.filter((r) => r.event === 'fenced'),
        hardTerminal: retry.result,
      },
      fenceSite: 'in-transaction status check inside every durable-patch mutation (the streamed-actions guide contract: "in-transaction terminal checks are yours")',
    };
    return { note: 'confirmed cancellation at 3/5 stages; all four late durable-patch lanes fenced with append-only receipts; terminal record byte-stable; cancelled is hard-terminal' };
  });

  // ---------- A5-09-RETRY ----------
  await check('A5-09-RETRY', async () => {
    const countsBefore = (await alice.client.query(api.roomOverview, { args: { roomId: ROOM } })).rows[0];
    // idempotent re-ask: same dedupe key, even with different text
    const reAsk = await alice.client.mutate(api.askQuestion, { args: {
      roomId: ROOM, text: 'DIFFERENT text, same intent', dedupeKey: 'q-cancel-safety-1',
      askerName: 'Alice', ttlMs: 60_000 } });
    assert(reAsk.result.deduped === true && reAsk.result.questionId === q1, 'same dedupe key returns the committed question');
    // concurrent double-ask under one fresh dedupe key
    const [raceA, raceB] = await Promise.allSettled([
      alice.client.mutate(api.askQuestion, { args: { roomId: ROOM, text: 'race probe', dedupeKey: 'q-race-1', askerName: 'Alice', ttlMs: 60_000 } }),
      bruno.client.mutate(api.askQuestion, { args: { roomId: ROOM, text: 'race probe', dedupeKey: 'q-race-1', askerName: 'Bruno', ttlMs: 60_000 } }),
    ]);
    assert(raceA.status === 'fulfilled' && raceB.status === 'fulfilled', 'both concurrent asks settle');
    assert(raceA.value.result.questionId === raceB.value.result.questionId, 'concurrent asks converge on ONE question');
    const raceQ = raceA.value.result.questionId;
    assert([raceA.value.result.deduped, raceB.value.result.deduped].filter(Boolean).length === 1, 'exactly one insert, one dedupe');
    // worker retry against the COMPLETED q1: no duplicate answer, no new progress
    const retryRun = await alice.client.action(api.runAssistant, { args: { questionId: q1, throughStage: '', fault: '' } });
    const thread = (await bruno.client.query(api.questionThread, { args: { roomId: ROOM, questionId: q1 } })).rows[0];
    assert(thread.progress.length === 5 && thread.answer.length === 1, 'no duplicate progress or answer after re-run');
    assert(thread.status === 'complete' && thread.attemptCount === 1, 'terminal record unchanged');
    const ledger = (await alice.client.query(api.attemptLedger, { args: { roomId: ROOM, questionId: q1 } })).rows;
    const fencedReplay = ledger.filter((r) => r.event === 'fenced' && r.outcome === 'assistStep');
    assert(fencedReplay.length >= 1, 'replayed worker receipted as fenced, not re-run');
    const countsAfter = (await alice.client.query(api.roomOverview, { args: { roomId: ROOM } })).rows[0];
    assert(countsAfter.questionCount === countsBefore.questionCount + 1,
      `only the race question was added (${countsBefore.questionCount} -> ${countsAfter.questionCount})`);
    assert(countsAfter.answerCount === countsBefore.answerCount, 'answer count unchanged by retries');
    // retire the race question for the outcome matrix
    await alice.client.mutate(api.settleQuestion, { args: { questionId: raceQ, outcome: 'failed', detail: 'race probe retired' } });
    evidence['A5-09'] = {
      dedupeKey: {
        reAsk: { key: 'q-cancel-safety-1', deduped: true, sameQuestionId: true },
        concurrentRace: {
          key: 'q-race-1', converged: true,
          dedupedFlags: [raceA.value.result.deduped, raceB.value.result.deduped],
        },
      },
      attemptLedger: ledger,
      authoritativeCounts: {
        before: { questions: countsBefore.questionCount, answers: countsBefore.answerCount },
        after: { questions: countsAfter.questionCount, answers: countsAfter.answerCount },
        q1: { progress: thread.progress.length, answers: thread.answer.length, attemptCount: thread.attemptCount },
      },
      retryRun: retryRun.result ?? retryRun,
    };
    return { note: 'same-key re-ask and a concurrent two-client ask both converge on one question; worker replay against the completed question fenced (5 progress, 1 answer, unchanged)' };
  });

  // ---------- A5-10-OUTCOMES ----------
  await check('A5-10-OUTCOMES', async () => {
    // q3 failed (definite fault at draft), q4 timed-out (abandoned worker +
    // watchdog), q5 ambiguous (unprovable settlement)
    const ask3 = await alice.client.mutate(api.askQuestion, { args: {
      roomId: ROOM, text: 'fault injection: definite failure', dedupeKey: 'q-fail-1', askerName: 'Alice', ttlMs: 60_000 } });
    const q3 = ask3.result.questionId;
    const run3 = await alice.client.action(api.runAssistant, { args: { questionId: q3, throughStage: '', fault: 'fail-at-draft' } });
    assert(run3.result.status === 'failed' && run3.result.terminal === true, `q3 failed (${JSON.stringify(run3.result)})`);

    const ask4 = await alice.client.mutate(api.askQuestion, { args: {
      roomId: ROOM, text: 'fault injection: abandoned worker', dedupeKey: 'q-timeout-1', askerName: 'Alice', ttlMs: 50 } });
    const q4 = ask4.result.questionId;
    const run4 = await alice.client.action(api.runAssistant, { args: { questionId: q4, throughStage: '', fault: 'abandon-after-retrieve' } });
    assert(run4.result.abandoned === true && run4.result.status === 'running', 'q4 abandoned mid-flight');
    await sleep(60);
    const expire = await bruno.client.mutate(api.expireOverdue, { args: { roomId: ROOM, now: Date.now() } });
    assert(expire.result.expired.includes(q4), `watchdog expired q4 (${JSON.stringify(expire.result)})`);

    const ask5 = await alice.client.mutate(api.askQuestion, { args: {
      roomId: ROOM, text: 'fault injection: ambiguous settlement', dedupeKey: 'q-ambiguous-1', askerName: 'Alice', ttlMs: 60_000 } });
    const q5 = ask5.result.questionId;
    const run5 = await alice.client.action(api.runAssistant, { args: { questionId: q5, throughStage: '', fault: 'ambiguous-at-settle' } });
    assert(run5.result.status === 'ambiguous', `q5 ambiguous (${JSON.stringify(run5.result)})`);

    // the five distinct outcomes, observed simultaneously on the feed
    const feed = (await bruno.client.query(api.questionFeed, { args: { roomId: ROOM } })).rows;
    const byKey = {};
    for (const row of feed) byKey[row._id] = row;
    const matrix = {
      complete: byKey[q1]?.status, cancelled: byKey[q2]?.status,
      failed: byKey[q3]?.status, 'timed-out': byKey[q4]?.status, ambiguous: byKey[q5]?.status,
    };
    for (const [expected, got] of Object.entries(matrix)) {
      assert(got === expected, `outcome ${expected} distinct (${got})`);
    }
    const statuses = new Set(Object.values(matrix));
    assert(statuses.size === 5, 'five simultaneously distinct terminal states');
    // settlement + state machine records
    for (const [qid, name] of [[q3, 'failed'], [q4, 'timed-out'], [q5, 'ambiguous']]) {
      const t = (await bruno.client.query(api.questionThread, { args: { roomId: ROOM, questionId: qid } })).rows[0];
      assert(t.settledAt > 0 && t.terminalDetail.length > 0, `${name} settled with a terminal record`);
      assert(t.answer.length === 0, `${name} committed no answer`);
    }
    // retryability split: ambiguous reopens and converges; the retried
    // question completes without duplicating anything
    const retry5 = await alice.client.mutate(api.retryQuestion, { args: { questionId: q5 } });
    assert(retry5.result.retried === true && retry5.result.attemptCount === 2, 'ambiguous is retryable (attempt 2)');
    const rerun5 = await alice.client.action(api.runAssistant, { args: { questionId: q5, throughStage: '', fault: '' } });
    assert(rerun5.result.status === 'complete', 'retried ambiguous question converges to complete');
    const t5 = (await bruno.client.query(api.questionThread, { args: { roomId: ROOM, questionId: q5 } })).rows[0];
    assert(t5.answer.length === 1 && t5.attemptCount === 2, 'one answer after convergence, attempt count 2');
    const ledger5 = (await alice.client.query(api.attemptLedger, { args: { roomId: ROOM, questionId: q5 } })).rows;
    evidence['A5-10'] = {
      faultInjection: {
        failed: 'fault fail-at-draft (definite failure inside the step transaction)',
        timedOut: 'fault abandon-after-retrieve + deterministic expireOverdue watchdog',
        ambiguous: 'fault ambiguous-at-settle (unprovable terminal write)',
      },
      stateMachineRecords: {
        matrix,
        q5History: ledger5,
      },
      settlement: {
        fiveDistinctSimultaneous: true,
        retryability: { cancelled: 'hard-terminal (A5-08)', complete: 'hard-terminal (A5-09)', ambiguous: 'retryable -> converged complete, 1 answer, attempt 2' },
      },
    };
    return { note: 'complete, cancelled, failed, timed-out, ambiguous all simultaneously distinct with settlement records; ambiguous retries to complete without duplication' };
  });

  // ---------- A5-11-OBSERVER ----------
  await check('A5-11-OBSERVER', async () => {
    // fresh question; the second member holds BOTH the feed and the thread live
    const feedHandle = await bruno.client.liveQuery(api.questionFeed, {
      args: { roomId: ROOM }, connectionId: 'bruno_feed', transport: 'stream' });
    await until(() => (feedHandle.connection === 'live' ? true : null), 'feed live');
    cleanups.push(() => feedHandle.dispose());
    const feedBaseline = feedHandle.rows.length;
    const t0 = Date.now();
    const ask = await alice.client.mutate(api.askQuestion, { args: {
      roomId: ROOM, text: 'observer check: who sees progress live?', dedupeKey: 'q-observer-1',
      askerName: 'Alice', ttlMs: 60_000 } });
    const q6 = ask.result.questionId;
    await until(() => (feedHandle.rows.length === feedBaseline + 1 ? true : null), 'new question delivered live');
    const askMs = Date.now() - t0;
    const newRow = feedHandle.rows.find((r) => r._id === q6);
    assert(newRow && newRow.askerName === 'Alice' && newRow.status === 'running', 'feed row attributed to the asker');
    const threadHandle = await bruno.client.liveQuery(api.questionThread, {
      args: { roomId: ROOM, questionId: q6 }, connectionId: 'bruno_thread6', transport: 'stream' });
    await until(() => (threadHandle.connection === 'live' ? true : null), 'thread live');
    cleanups.push(() => threadHandle.dispose());
    await until(() => (threadHandle.rows[0]?.progress?.length === 1 ? true : null), 'thread snapshot');
    const t1 = Date.now();
    await alice.client.action(api.runAssistant, { args: { questionId: q6, throughStage: 'retrieved', fault: '' } });
    await until(() => (threadHandle.rows[0]?.progress?.length === 2 ? true : null), 'stage delivered to observer');
    const stageMs = Date.now() - t1;
    const t2 = Date.now();
    await alice.client.action(api.runAssistant, { args: { questionId: q6, throughStage: '', fault: '' } });
    await until(() => (threadHandle.rows[0]?.status === 'complete' ? true : null), 'terminal delivered to observer');
    const terminalMs = Date.now() - t2;
    // authority: the observer is a genuine second principal with a member seat
    assert(bruno.userId !== alice.userId, 'observer is a distinct principal');
    const snapshot = (await alice.client.query(api.questionThread, { args: { roomId: ROOM, questionId: q6 } })).rows[0];
    assert(JSON.stringify(threadHandle.rows[0].progress) === JSON.stringify(snapshot.progress),
      'observer rows equal the authoritative snapshot');
    evidence['A5-11'] = {
      secondClient: {
        observer: 'bruno (independent session, distinct principal)',
        handles: ['questionFeed', 'questionThread'],
        deliveries: { newQuestionMs: askMs, stageMs, terminalMs },
        alsoInA506: stageDeliveries,
      },
      transportAttribution: { connection: 'live', transport: 'stream', polling: 'never used as evidence' },
      authority: 'observer authorized by the roomMembers seat; the outsider subscription denial is A5-03 evidence; feed row attribution asserted against the asker principal',
    };
    return { note: `second member observed ask ${askMs}ms, stage ${stageMs}ms, terminal ${terminalMs}ms over the managed stream; rows equal the snapshot` };
  });

  // ---------- A5-12-REFRESH ----------
  await check('A5-12-REFRESH', async () => {
    // secret custody: canary token through the admin config surface
    const set = await configCall('set', { entry: 'refreshToken', value: REFRESH_TOKEN_CANARY });
    assert(set.status === 200 && set.body.applyState === 'applied', `config set applied (${JSON.stringify(set.body)})`);
    const status = await configCall('status');
    const entry = status.body.entries.find((e) => e.name === 'refreshToken');
    assert(entry.set === true && entry.secret === true, 'config status reports custody, never bytes');
    assert(!JSON.stringify(status.body).includes(REFRESH_TOKEN_CANARY), 'status never discloses the value');
    // the owner points the refresh at the suite's content endpoint
    await alice.client.mutate(api.setRefreshSource, { args: { roomId: ROOM, url: contentUrl } });
    // deterministic scheduler: suite-driven ticks (cron disabled). The first
    // everyMs run is the epoch-0 catch-up (known 0137-a4-f4, cited).
    const ticks = [];
    let refreshRuns = [];
    for (let i = 0; i < 8; i += 1) {
      const tick = await cronTick();
      assert(tick.status === 200, `tick accepted (${tick.status})`);
      ticks.push(tick.runs.map((r) => ({ jobName: r.jobName, scheduledAtMs: r.scheduledAtMs, outcome: r.outcome, runId: r.runId })));
      refreshRuns = (await alice.client.query(api.refreshLedger, { args: { roomId: ROOM } })).rows;
      if (refreshRuns.length >= 2) break;
      await sleep(1_100);
    }
    assert(refreshRuns.length >= 1, `refresh run receipted (${JSON.stringify(ticks).slice(0, 300)})`);
    const cronRuns = ticks.flat().filter((r) => r.jobName === 'refreshTick' && r.outcome === 'Succeeded');
    assert(cronRuns.length >= 1, 'the scheduler ran the refresh job');
    // the outbound leg rides the STREAMED egress lane (finding 0137-a5-f1:
    // ctx.fetchStream + streamAttempt work on 0.1.7 while plain ctx.fetch
    // stays unregistered per 0137-a4-f1)
    const outcomes = refreshRuns.map((r) => r.outcome);
    assert(outcomes.every((o) => o === 'fetched'), `every scheduled refresh fetched (${outcomes})`);
    assert(refreshRuns.every((r) => r.fetchedBytes === REFRESH_PAYLOAD.length),
      `payload fully drained (${refreshRuns.map((r) => r.fetchedBytes)})`);
    const providerReached = refreshLedgerLocal.requests.length > 0;
    assert(providerReached, 'the content endpoint was reached by the server');
    assert(refreshLedgerLocal.requests.every((r) => r.authValid),
      'every provider request carried the staged secret (server-side custody)');
    // owner-invoked manual run under the same dedupe custody
    const manual = await alice.client.action(api.runRefresh, { args: { trigger: 'manual-verify' } });
    const finalRuns = (await alice.client.query(api.refreshLedger, { args: { roomId: ROOM } })).rows;
    const dedupeKeys = new Set(finalRuns.map((r) => r.dedupeKey));
    assert(dedupeKeys.size === finalRuns.length, 'one receipt per nominal (dedupe custody)');
    // authority: member/outsider cannot read the ledger or run the refresh
    let brunoLedger = null;
    try { await bruno.client.query(api.refreshLedger, { args: { roomId: ROOM } }); }
    catch (err) { brunoLedger = diagCode(err); }
    assert(brunoLedger === 'SNAPBACK_AUTH_PERMISSION_DENIED', `refresh ledger owner-only (${brunoLedger})`);
    let malloryRun = null;
    try {
      const env = await mallory.client.action(api.runRefresh, { args: { trigger: 'forged' } });
      malloryRun = actionRefusal(env);
    } catch (err) { malloryRun = diagCode(err); }
    assert(!String(malloryRun).startsWith('ALLOWED'), `outsider refresh refused (${malloryRun})`);
    // canary scan: the secret value must be absent from every client-visible
    // surface — receipts, ledgers, tick responses, dev output, evidence
    const scanTargets = {
      refreshLedgerRows: JSON.stringify(finalRuns),
      cronTickResponses: JSON.stringify(ticks),
      manualActionEnvelope: JSON.stringify(manual),
      configStatus: JSON.stringify(status.body),
      devServerOutput: devStdoutRaw,
      allEvidenceSoFar: JSON.stringify(evidence),
    };
    const leaks = Object.entries(scanTargets).filter(([, s]) => s.includes(REFRESH_TOKEN_CANARY)).map(([k]) => k);
    assert(leaks.length === 0, `canary leaked into: ${leaks}`);
    evidence['A5-12'] = {
      scheduleIdentity: {
        job: 'refreshTick (everyMs 1000, jitter false)', cronDisabled: 'suite-driven deterministic ticks',
        runs: cronRuns.slice(0, 3),
        epochCatchup: ticks.flat().find((r) => r.scheduledAtMs === 0) ?? null,
        epochNote: 'epoch-0 catch-up nominal receipted (known 0137-a4-f4, cited)',
      },
      runReceipt: finalRuns.map((r) => ({ dedupeKey: r.dedupeKey, outcome: r.outcome, detail: r.detail.slice(0, 120), fetchedBytes: r.fetchedBytes })),
      outboundLeg: {
        providerReached,
        providerRequests: refreshLedgerLocal.requests,
        outcomes,
        fetchedBytes: refreshRuns.map((r) => r.fetchedBytes),
        lane: 'ctx.streamAttempt + ctx.fetchStream (guide backend/streamed-actions) with the Bearer secret staged via ctx.secrets — the streamed lane is the ONLY working egress on 0.1.7: plain ctx.fetch stays SNAPBACK_HANDLER_HOST_CALL_UNKNOWN (known 0137-a4-f1; narrowed by this arm\'s finding 0137-a5-f1, probe + first-run receipts retained)',
      },
      canarySecretScan: { targets: Object.keys(scanTargets), leaks, clean: true },
      redactedConfigProof: { entry: { name: entry.name, set: entry.set, secret: entry.secret }, valueDisclosed: false },
      authority: { memberLedgerRead: brunoLedger, outsiderRun: malloryRun },
    };
    return {
      note: `scheduled external refresh ran end to end over the STREAMED egress lane (${finalRuns.length} receipted nominals, dedupe custody, ${refreshRuns[0]?.fetchedBytes} bytes drained per run); every provider request carried the staged secret server-side; canary absent from ${Object.keys(scanTargets).length} client-visible surfaces; plain-fetch lane still broken (0137-a4-f1) — streamed lane finding 0137-a5-f1`,
    };
  });

  // ---------- A5-13-CLEANUP (kernel) ----------
  await check('A5-13-CLEANUP', async () => {
    // config custody retired
    const unset = await configCall('unset', { entry: 'refreshToken' });
    assert(unset.status === 200, `config unset (${unset.status})`);
    const status = await configCall('status');
    assert(status.body.entries.find((e) => e.name === 'refreshToken').set === false, 'config entry cleared');
    // refresh source disabled (app-data custody back to the fixture value)
    await alice.client.mutate(api.setRefreshSource, { args: { roomId: ROOM, url: '' } });
    // files: the remaining uploaded asset is retired
    const del = await fetch(`${ready.serverUrl}/assets/records/${cancelNotesAssetId}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${alice.token}`, ...protocolHeaders },
    });
    assert(del.ok, `asset delete accepted (${del.status})`);
    const post = await readAssetBytes(cancelNotesAssetId, 'primary', alice.token);
    assert([403, 404, 410].includes(post.status), `deleted asset refuses (${post.status})`);
    // schedules: the suite owned every tick; nothing autonomous remains
    const finalTick = await cronTick();
    // identities: seats self-remove (membership unseedable/unresettable — 0137-a3-f1 cited)
    for (const actor of [bruno, alice]) {
      await actor.client.mutate(api.leaveRoom, { args: { roomId: ROOM } });
    }
    let postLeave = null;
    try { await alice.client.query(api.roomOverview, { args: { roomId: ROOM } }); }
    catch (err) { postLeave = diagCode(err); }
    assert(postLeave === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'authority retired before reset');
    // data: receipted versioned reset-install restores the literal fixture
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: alice.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const receipt = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: preview.current.dataVersionStream },
    });
    assert(receipt.operation === 'reset-install' && receipt.outcome === 'reset-installed', 'reset-install settled');
    // fixture verification requires a seat: the restored owner invite redeems again
    const verifier = await signIn('alice@sweep-a5.test', 'alice-verify');
    let stillDenied = null;
    try { await verifier.client.query(api.roomOverview, { args: { roomId: ROOM } }); }
    catch (err) { stillDenied = diagCode(err); }
    assert(stillDenied === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'reset does not resurrect authority');
    const seat = await verifier.client.mutate(api.redeemInvite, { args: { code: 'INV-OWNER-3401' } });
    assert(seat.result.role === 'owner', 'restored fixture invite redeemable');
    const overview = (await verifier.client.query(api.roomOverview, { args: { roomId: ROOM } })).rows[0];
    assert(overview.sourceCount === 4 && overview.embeddingCount === 4, 'runtime sources gone, seeded corpus back');
    assert(overview.questionCount === 0 && overview.answerCount === 0 && overview.questionSeq === 0,
      'questions, answers, progress, attempts cleared by the named-table reset');
    const runs = (await verifier.client.query(api.refreshLedger, { args: { roomId: ROOM } })).rows;
    assert(runs.length === 0, 'refresh receipts cleared');
    const sources = (await verifier.client.query(api.sourceList, { args: { roomId: ROOM } })).rows;
    assert(sources.every((s) => s.assetId === ''), 'no dangling asset references in the fixture');
    // final reset leaves the untouched fixture
    await verifier.client.mutate(api.leaveRoom, { args: { roomId: ROOM } });
    const preview2 = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const receipt2 = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: preview2.current.dataVersionStream },
    });
    assert(receipt2.outcome === 'reset-installed', 'final reset settled');
    const finalProbe = await signIn('alice@sweep-a5.test', 'alice-final');
    let finalNegative = null;
    try { await finalProbe.client.query(api.roomOverview, { args: { roomId: ROOM } }); }
    catch (err) { finalNegative = diagCode(err); }
    assert(finalNegative === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'post-cleanup negative holds');
    evidence['A5-13'] = {
      targetBoundPlan: 'suite-owned dev database in the arm directory only; uploaded assets deleted and verified retired; config unset through admin custody; seats retired by self-removal (0137-a3-f1 cited); receipted versioned reset-installs',
      cleanupReceipts: [
        { operation: receipt.operation, outcome: receipt.outcome, seedVersion: receipt.seedVersion, resetDeletedRows: receipt.resetDeletedRows },
        { operation: receipt2.operation, outcome: receipt2.outcome, resetDeletedRows: receipt2.resetDeletedRows },
      ],
      configCleared: true,
      assetsRetired: { cancelNotes: { delete: del.status, postDeleteRead: post.status } },
      schedules: { cronDisabledWholeRun: true, finalTickRuns: finalTick.runs.length },
      postCleanupNegative: { afterLeave: postLeave, afterReset: stillDenied, final: finalNegative },
      fixtureVerification: {
        sources: overview.sourceCount, embeddings: overview.embeddingCount,
        questions: overview.questionCount, refreshRuns: runs.length, assetRefsClean: true,
      },
    };
    return { note: `config unset, asset retired, seats self-removed, two receipted reset-installs (deleted ${receipt.resetDeletedRows} + ${receipt2.resetDeletedRows} rows) restore the literal fixture; final fresh-session negative denied` };
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
  contentServer.close();
  const tally = { pass: 0, gap: 0, fail: 0, 'expected-refusal': 0 };
  for (const r of results) tally[r.result] = (tally[r.result] ?? 0) + 1;
  const report = {
    schemaVersion: 'sweep-a5.acceptance.v1',
    title: 'LLP 0137 A5 snapback-web acceptance',
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

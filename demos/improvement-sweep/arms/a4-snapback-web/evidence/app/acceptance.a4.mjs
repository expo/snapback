// LLP 0137 A4 (event and invitation application) acceptance suite —
// Snapback web arm. External-consumer build: public @expo/snapback-* 0.1.7.
// 11 checks, contract demos/improvement-sweep/protocol/contracts/a4-event-invitation.v1.json.
//
// The suite owns its dev server (SNAPBACK_OUTBOUND_ACTIONS=1 for the
// notification effect, SNAPBACK_CRON_DISABLED=1 so every scheduler run is a
// deterministic authenticated tick) and its own local notification provider
// with scripted fault injection. Fresh managed database every run.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { SnapbackClient, createExternalSessionClient } from '@expo/snapback-client';

const root = resolve(import.meta.dirname);
const evidenceDir = join(root, 'a4-evidence');
mkdirSync(evidenceDir, { recursive: true });

const EXPECTED_CHECKS = 11;
const EVENT = 'evt_lantern';
const NOTIFY_TOKEN = 'tok_a4_notify_7f31c2';
const results = [];
const evidence = {};
let child = null;
let ready = null;
let adminToken = null;
let impersonation = null;
let api = null;
let seedArtifact = null;
let artifacts = null;
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
    if (process.env.A4_DEBUG) console.error(err?.stack ?? '');
  }
}
// An action refusal surfaces as an ok:false envelope (not a throw); the
// original diagnostic code is not carried on the envelope (arm finding).
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

// ---------- minimal valid PNG (RGBA gradient) for the image pipeline ----------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter none
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

// ---------- local notification provider with scripted faults ----------
const providerLedger = { deliveries: new Map(), requests: [] };
let providerScript = [];
const provider = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const key = String(req.headers['x-idempotency-key'] ?? '');
    const authHeader = String(req.headers.authorization ?? '');
    const authValid = authHeader === `Bearer ${NOTIFY_TOKEN}`;
    providerLedger.requests.push({ key, authValid, at: Date.now() });
    if (!authValid) { res.statusCode = 401; res.end('bad token'); return; }
    const behavior = providerScript.shift() ?? 'ok';
    if (behavior === 'reject500') { res.statusCode = 500; res.end('provider unavailable'); return; }
    // The provider processes at most one delivery per idempotency key.
    let receipt = providerLedger.deliveries.get(key);
    if (!receipt) {
      receipt = { receiptId: `rcpt_${providerLedger.deliveries.size + 1}_${key.slice(0, 12)}`, count: 1 };
      providerLedger.deliveries.set(key, receipt);
    }
    if (behavior === 'ambiguous-drop') { req.socket.destroy(); return; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ receiptId: receipt.receiptId, deliveredCount: receipt.count }));
  });
});
await new Promise((res) => provider.listen(0, '127.0.0.1', res));
const providerUrl = `http://127.0.0.1:${provider.address().port}/notify`;

// ---------- dev server lifecycle ----------
const readyFile = join(root, '.snapback', 'dev.ready.json');
const lifecycleEvents = [];
async function spawnDev() {
  // Own-ports discipline: guard-block the prior arms' 4288/4289/4290 during
  // the runtime's port scan; fleet-shared 4420 asserted below.
  const guards = [];
  for (const port of [4288, 4289, 4290]) {
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
      return lifecycleEvents.some((e) => e.state === 'generated-and-loaded') ? descriptor : null;
    } catch { return null; }
  }, 'dev ready', 60_000);
  for (const guard of guards) guard.close();
  assert(ready.port !== 4420, 'must not use fleet-shared port 4420');
  assert(![4288, 4289, 4290].includes(ready.port), 'must not reuse prior arm ports');
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
    clientStoreId: `sweep-a4-${label}-${process.pid}`,
    rqsStore: null,
  });
  cleanups.push(() => client.closeAuth?.());
  return { client, userId: credential.session.userId, token: credential.token, email, label };
}

// Anonymous public read: the packaged SnapbackClient refuses to construct an
// unauthenticated protocol-offering client outside a browser, so anonymous
// access goes over raw HTTP with only the protocol offer (arm finding).
async function anonQuery(name, args) {
  const res = await fetch(`${ready.serverUrl}/query/${encodeURIComponent(name)}`, {
    method: 'POST', headers: protocolHeaders, body: JSON.stringify({ args }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function uploadImage(actor, intent, filename, bytes) {
  const authed = { authorization: `Bearer ${actor.token}`, ...protocolHeaders };
  const created = await fetch(`${ready.serverUrl}/assets/attempts`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({
      intentId: intent.name,
      intentPolicyHash: intent.intentPolicyHash ?? null,
      args: {},
      declaredFilename: filename,
      declaredLength: bytes.byteLength,
      declaredContentType: 'image/png',
    }),
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }));
  assert(created.ok, `attempt created (${created.status}: ${JSON.stringify(created.body).slice(0, 300)})`);
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
  assert(patched.ok, `TUS transfer accepted (${patched.status})`);
  const finalized = await fetch(`${ready.serverUrl}/assets/attempts/${encodeURIComponent(attemptId)}/finalize`, {
    method: 'POST', headers: authed,
    body: JSON.stringify({ attemptId, lifecycleGeneration: 1, declaredDigest: sha256hex(bytes) }),
  }).then(async (r) => ({ ok: r.ok, status: r.status, body: await r.json() }));
  assert(finalized.ok, `finalize accepted (${finalized.status}: ${JSON.stringify(finalized.body).slice(0, 300)})`);
  return { assetId, attemptId, finalize: finalized.body };
}

const readAssetBytes = (assetId, variant, token) => fetch(
  `${ready.serverUrl}/assets/records/${assetId}/bytes/${variant}`,
  { headers: token ? { authorization: `Bearer ${token}`, 'x-snapback-auth-client-protocol': '1' } : { 'x-snapback-auth-client-protocol': '1' } },
);
const readAssetRecord = (assetId, token) => fetch(
  `${ready.serverUrl}/assets/records/${assetId}`,
  { headers: { authorization: `Bearer ${token}`, 'x-snapback-auth-client-protocol': '1' } },
).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

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
  // load the generated surface AFTER the managed dev loop regenerates it
  api = (await import(`./snapback/generated/api.mjs?v=${Date.now()}`)).default;
  seedArtifact = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'seed.artifact.json'), 'utf8'));
  artifacts = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'artifacts.json'), 'utf8'));

  const hana = await signIn('hana@sweep-a4.test', 'hana');
  const cora = await signIn('cora@sweep-a4.test', 'cora');
  const gil = await signIn('gil@sweep-a4.test', 'gil');
  const mira = await signIn('mira@sweep-a4.test', 'mira');
  const max = await signIn('max@sweep-a4.test', 'max');

  // ---------- A4-01-SEED (kernel) ----------
  await check('A4-01-SEED', async () => {
    const ids = new Set([hana.userId, cora.userId, gil.userId, mira.userId, max.userId]);
    assert(ids.size === 5, 'five distinct authenticated principals');
    // The event is closed until a seat exists.
    let preInvite = null;
    try { await hana.client.query(api.guestEventView, { args: { eventId: EVENT } }); }
    catch (err) { preInvite = diagCode(err); }
    assert(preInvite === 'SNAPBACK_AUTH_PERMISSION_DENIED', `pre-invite denial (${preInvite})`);
    // Personas claim their seeded invites (host / cohost / guest).
    const hostSeat = await hana.client.mutate(api.redeemInvite, {
      args: { code: 'INV-HOST-2214', name: 'Hana', enteredVia: 'code' } });
    const cohostSeat = await cora.client.mutate(api.redeemInvite, {
      args: { code: 'INV-COHOST-5521', name: 'Cora', enteredVia: 'code' } });
    const guestSeat = await gil.client.mutate(api.redeemInvite, {
      args: { code: 'INV-GUEST-7008', name: 'Gil', enteredVia: 'code' } });
    assert(hostSeat.result.role === 'host' && cohostSeat.result.role === 'cohost' && guestSeat.result.role === 'guest',
      'seeded invite roles');
    // Authoritative counts across the capacity fixture.
    const view = (await hana.client.query(api.guestEventView, { args: { eventId: EVENT } })).rows[0];
    assert(view.capacity === 12 && view.plusOneLimit === 2, 'capacity fixture');
    assert(view.goingSeats === 6 && view.goingCount === 3 && view.maybeCount === 1,
      `seeded seat math (${JSON.stringify({ goingSeats: view.goingSeats, goingCount: view.goingCount })})`);
    const guests = (await hana.client.query(api.guestList, { args: { eventId: EVENT } })).rows;
    assert(guests.length === 8, `5 seeded + 3 entered rsvp rows (${guests.length})`);
    const wall = (await hana.client.query(api.wallFeed, { args: { eventId: EVENT } })).rows;
    assert(wall.length === 3 && wall.map((w) => w.seq).join(',') === '1,2,3', 'seeded wall posts');
    const detail = (await hana.client.query(api.hostEventDetail, { args: { eventId: EVENT } })).rows[0];
    assert(detail.invites.length === 4 && detail.invites.filter((i) => i.consumed).length === 3, 'invite fixture');
    assert(detail.reminders.length === 1 && detail.reminders[0].kind === 'day-before', 'reminder fixture');
    assert(detail.deliveries.length === 0, 'no deliveries yet');
    // Versioned-seed receipt through the administrative preview.
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: hana.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    assert(preview?.current?.seedVersion === 'a4-events.2026-08-01.2',
      `installed seed identity (${JSON.stringify(preview?.current)})`);
    evidence['A4-01'] = {
      targetIdentity: {
        serverUrl: ready.serverUrl, port: ready.port,
        appId: artifacts.appId ?? 'event-app',
        inputsHash: artifacts.inputsHash, authMode: 'sessions',
        runtime: ready.runtime ?? null,
      },
      authoritativeCounts: {
        rsvps: guests.length, goingSeats: view.goingSeats, goingCount: view.goingCount,
        maybeCount: view.maybeCount, capacity: view.capacity, wallPosts: wall.length,
        invites: detail.invites.length, reminders: detail.reminders.length,
      },
      seedReceipt: {
        seedVersion: preview.current.seedVersion,
        dataVersionStream: preview.current.dataVersionStream ?? null,
      },
      personas: { hana: 'host', cora: 'cohost', gil: 'guest', mira: 'guest (enters in A4-04)', max: 'outsider (authenticated, no seat)' },
    };
    return { note: 'capacity fixture seeded (12 cap, 6 going seats, 4 invites, 3 wall posts, 1 reminder); 5 distinct principals; invites redeemed host/cohost/guest' };
  });

  // ---------- A4-02-PREVIEW ----------
  await check('A4-02-PREVIEW', async () => {
    // anonymous read over raw HTTP: protocol offer, no credential
    const preview = await anonQuery('eventPreview', { slug: 'lantern-supper' });
    assert(preview.status === 200 && preview.body.rows.length === 1, `anonymous preview readable (${preview.status})`);
    const row = preview.body.rows[0];
    const expectedFields = ['blurb', 'capacity', 'city', 'goingSeats', 'hasFlyer', 'slug', 'spotsLeft', 'startsAt', 'title'];
    assert(JSON.stringify(Object.keys(row).sort()) === JSON.stringify(expectedFields),
      `field boundary is the exact public projection (${Object.keys(row).sort()})`);
    assert(row.goingSeats === 6 && row.spotsLeft === 6, 'public seat math');
    const rendered = JSON.stringify(preview.body);
    for (const secret of ['Alcatraz', 'gate code', 'Caterer', 'Budget', 'INV-', 'Pia', 'Quinn', 'seed:']) {
      assert(!rendered.includes(secret), `private fact "${secret}" must not leak into the preview`);
    }
    // negative private reads: anonymous callers get uniform denials
    const anonPrivate = {};
    for (const [name, args] of [
      ['guestEventView', { eventId: EVENT }],
      ['hostEventDetail', { eventId: EVENT }],
      ['guestList', { eventId: EVENT }],
      ['wallFeed', { eventId: EVENT }],
    ]) {
      const res = await anonQuery(name, args);
      anonPrivate[name] = res.body?.diagnostic?.code ?? res.status;
      assert(res.status !== 200, `${name} must refuse anonymously`);
    }
    for (const code of Object.values(anonPrivate)) {
      assert(code === 'SNAPBACK_AUTH_PERMISSION_DENIED', `anonymous denial uniform (${JSON.stringify(anonPrivate)})`);
    }
    // no-protocol-offer requests are refused at the auth boundary
    const bare = await fetch(`${ready.serverUrl}/query/eventPreview`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: { slug: 'lantern-supper' } }),
    });
    evidence['A4-02'] = {
      anonymousRead: { status: preview.status, row },
      fieldBoundary: { publicFields: expectedFields, negativesProbed: ['privateAddress', 'hostNotes', 'invite codes', 'guest identities', 'seed principals'] },
      negativePrivateRead: anonPrivate,
      offerlessRequest: { status: bare.status, code: (await bare.json().catch(() => null))?.diagnostic?.code ?? null },
      transportNote: 'packaged SnapbackClient cannot construct an anonymous protocol-offering client outside a browser; anonymous preview uses raw HTTP with the offer header (arm finding)',
    };
    return { note: 'anonymous preview serves exactly the public projection (6/12 seats); address/notes/invites/guests excluded; four private surfaces refuse uniformly' };
  });

  // ---------- A4-03-ROLES ----------
  await check('A4-03-ROLES', async () => {
    const matrix = {};
    // host: administrative writes
    const upd = await hana.client.mutate(api.updateEventDetails, {
      args: { eventId: EVENT, blurb: 'A long-table supper under paper lanterns. Bring a story and a friend.', hostNotes: 'Caterer arrives 5pm. Extra chairs in the garage. Budget $900. Check lanterns.' } });
    assert(upd.result === 1, 'host edits the event');
    await hana.client.mutate(api.createInvite, {
      args: { eventId: EVENT, code: 'INV-GUEST-EXTRA', role: 'guest', invitedByName: 'Hana' } });
    matrix.host = { updateEventDetails: 'allowed', createInvite: 'allowed', hostEventDetail: 'allowed' };
    // host and cohost RSVP as ordinary guests do
    const hanaRsvp = await hana.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 0 } });
    assert(hanaRsvp.result.goingSeats === 7, `host rsvp seats (${hanaRsvp.result.goingSeats})`);
    const coraRsvp = await cora.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 0 } });
    assert(coraRsvp.result.goingSeats === 8, `cohost rsvp seats (${coraRsvp.result.goingSeats})`);
    // guest: reads, RSVP, wall posts allowed
    const gilView = (await gil.client.query(api.guestEventView, { args: { eventId: EVENT } })).rows[0];
    assert(gilView.privateAddress.includes('Alcatraz'), 'seated guest sees the address');
    await gil.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'maybe', plusOnes: 0 } });
    const gilPost = await gil.client.mutate(api.postWall, {
      args: { eventId: EVENT, body: 'So excited — can I bring records?', clientKey: 'a4-03-gil', authorName: 'Gil' } });
    assert(gilPost.result === 4, `guest wall post sequenced (${gilPost.result})`);
    matrix.guest = { read: 'allowed', updateRsvp: 'allowed', postWall: 'allowed' };
    // cohost: moderation allowed
    const del = await cora.client.mutate(api.deleteWallPost, { args: { eventId: EVENT, seq: 4 } });
    assert(del.result === 4, 'cohost moderates the wall');
    matrix.cohost = { updateRsvp: 'allowed', deleteWallPost: 'allowed', createInvite: 'allowed', hostEventDetail: 'allowed' };
    await cora.client.query(api.hostEventDetail, { args: { eventId: EVENT } });
    // cohost negative: host-only administration
    let coraAdmin = null;
    try { await cora.client.mutate(api.updateEventDetails, { args: { eventId: EVENT, blurb: 'x', hostNotes: 'x' } }); }
    catch (err) { coraAdmin = diagCode(err); }
    matrix.cohost.updateEventDetails = coraAdmin;
    // guest negatives: host surfaces and moderation
    const gilDenied = {};
    for (const [name, fn] of Object.entries({
      hostEventDetail: () => gil.client.query(api.hostEventDetail, { args: { eventId: EVENT } }),
      notifyLedger: () => gil.client.query(api.notifyLedger, { args: { eventId: EVENT } }),
      updateEventDetails: () => gil.client.mutate(api.updateEventDetails, { args: { eventId: EVENT, blurb: 'x', hostNotes: 'x' } }),
      createInvite: () => gil.client.mutate(api.createInvite, { args: { eventId: EVENT, code: 'INV-GIL-FORGED', role: 'guest', invitedByName: 'Gil' } }),
      deleteWallPost: () => gil.client.mutate(api.deleteWallPost, { args: { eventId: EVENT, seq: 3 } }),
    })) {
      try { await fn(); gilDenied[name] = 'ALLOWED (defect)'; }
      catch (err) { gilDenied[name] = diagCode(err); }
    }
    matrix.guestNegative = gilDenied;
    // outsider: uniform denial on read, subscribe, and write
    const maxDenied = {};
    for (const [name, fn] of Object.entries({
      read: () => max.client.query(api.guestEventView, { args: { eventId: EVENT } }),
      guestList: () => max.client.query(api.guestList, { args: { eventId: EVENT } }),
      wall: () => max.client.query(api.wallFeed, { args: { eventId: EVENT } }),
      hostDetail: () => max.client.query(api.hostEventDetail, { args: { eventId: EVENT } }),
      writeRsvp: () => max.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 0 } }),
      writeWall: () => max.client.mutate(api.postWall, { args: { eventId: EVENT, body: 'x', clientKey: 'a4-max', authorName: 'Max' } }),
    })) {
      try { await fn(); maxDenied[name] = 'ALLOWED (defect)'; }
      catch (err) { maxDenied[name] = diagCode(err); }
    }
    let maxSubscribe = null;
    try {
      const handle = await max.client.liveQuery(api.wallFeed, {
        args: { eventId: EVENT }, connectionId: 'max_live', transport: 'stream' });
      await until(() => (handle.connection === 'live' || handle.error ? handle : null), 'max sub settles', 8_000);
      maxSubscribe = handle.error ? diagCode(handle.error) : `CONNECTED (defect: ${handle.rows.length})`;
      await handle.dispose();
    } catch (err) { maxSubscribe = diagCode(err); }
    maxDenied.subscribe = maxSubscribe;
    for (const [name, code] of Object.entries({ ...gilDenied, coraAdmin, ...maxDenied })) {
      assert(code === 'SNAPBACK_AUTH_PERMISSION_DENIED', `${name} must deny uniformly (${code})`);
    }
    let badInvite = null;
    try { await max.client.mutate(api.redeemInvite, { args: { code: 'INV-GUEST-0000', name: 'Max', enteredVia: 'code' } }); }
    catch (err) { badInvite = diagCode(err); }
    evidence['A4-03'] = { positiveRoleMatrix: matrix, negativeRoleMatrix: { guest: gilDenied, cohost: { updateEventDetails: coraAdmin }, outsider: maxDenied, badInviteGuess: badInvite } };
    return { note: 'host administers; cohost invites+moderates but cannot edit the event; guest reads/RSVPs/posts but denied all host surfaces; outsider denied uniformly incl. live subscribe' };
  });

  // ---------- A4-04-INVITE ----------
  await check('A4-04-INVITE', async () => {
    // The deep link the shell renders: /?contract=event&invite=<code>. The
    // suite enters exactly the way src/main.tsx does: parse the invite
    // parameter, then redeem it with enteredVia:'deep-link'.
    const deepLink = 'http://127.0.0.1:5173/?contract=event&invite=INV-GUEST-9143';
    const parsed = new URL(deepLink).searchParams.get('invite');
    assert(parsed === 'INV-GUEST-9143', 'deep link carries the invite code');
    const entry = await mira.client.mutate(api.redeemInvite, {
      args: { code: parsed, name: 'Mira', enteredVia: 'deep-link' } });
    assert(entry.result.role === 'guest' && entry.result.inviteCode === 'INV-GUEST-9143', 'deep-link entry seats the guest');
    assert(entry.result.invitedByName === 'Cora', 'entry attributed to the inviter');
    assert(entry.result.enteredVia === 'deep-link', 'entry channel recorded');
    const receipt = entry.receipt ?? entry;
    // attribution visible to the host on the authoritative guest list
    const guests = (await hana.client.query(api.guestList, { args: { eventId: EVENT } })).rows;
    const miraRow = guests.find((g) => g.name === 'Mira');
    assert(miraRow && miraRow.invitedByName === 'Cora' && miraRow.enteredVia === 'deep-link', 'guest list carries the attribution');
    const detail = (await hana.client.query(api.hostEventDetail, { args: { eventId: EVENT } })).rows[0];
    const consumed = detail.invites.find((i) => i.code === 'INV-GUEST-9143');
    assert(consumed && consumed.consumed === true, 'invite consumed');
    // a consumed invite cannot be replayed by another principal
    let replay = null;
    try { await max.client.mutate(api.redeemInvite, { args: { code: 'INV-GUEST-9143', name: 'Max', enteredVia: 'deep-link' } }); }
    catch (err) { replay = diagCode(err); }
    assert(replay !== null, 'consumed invite refuses replay');
    evidence['A4-04'] = {
      deepLink, parsedCode: parsed,
      settlement: {
        result: entry.result,
        receipt: { mutationId: receipt.mutationId ?? null, outcome: receipt.outcome ?? null, snapshotVersion: receipt.snapshotVersion ?? null, affectedTables: receipt.affectedTables ?? null },
      },
      attribution: { guestListRow: miraRow, inviteConsumed: true, replayRefusal: replay },
    };
    return { note: 'guest entered through the invite deep link; entry attributed (inviter, code, channel) on the settlement result and the host guest list; consumed invite refuses replay' };
  });

  // ---------- A4-05-CAPACITY ----------
  await check('A4-05-CAPACITY', async () => {
    const before = (await hana.client.query(api.guestEventView, { args: { eventId: EVENT } })).rows[0];
    assert(before.goingSeats === 8 && before.capacity === 12, `pre-contention seats (${before.goingSeats})`);
    // two-actor barrier: both guests request 3 seats (going +2) with 4 left
    const [gilTry, miraTry] = await Promise.allSettled([
      gil.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 2 } }),
      mira.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 2 } }),
    ]);
    const outcomes = [gilTry, miraTry];
    const winners = outcomes.filter((o) => o.status === 'fulfilled');
    const losers = outcomes.filter((o) => o.status === 'rejected');
    assert(winners.length === 1 && losers.length === 1, `exactly one contender commits (${winners.length} won)`);
    const winnerSeats = winners[0].value.result.goingSeats;
    assert(winnerSeats === 11, `winner fills to 11 of 12 (${winnerSeats})`);
    const loserCode = diagCode(losers[0].reason);
    const loserMessage = String(losers[0].reason?.diagnostic?.details?.message ?? losers[0].reason?.message ?? '');
    assert(loserMessage.includes('capacity exceeded'), `loser refused on capacity (${loserCode}: ${loserMessage.slice(0, 80)})`);
    const loser = gilTry.status === 'rejected' ? gil : mira;
    // the loser's retry at the same size still refuses (1 seat left)
    let retry = null;
    try { await loser.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 2 } }); }
    catch (err) { retry = String(err?.diagnostic?.details?.message ?? err?.message ?? ''); }
    assert(retry && retry.includes('capacity exceeded'), 'retry at 3 seats still refused');
    // the loser fits without plus-ones: exactly full
    const fit = await loser.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 0 } });
    assert(fit.result.goingSeats === 12, `event exactly full (${fit.result.goingSeats})`);
    // any further seat is refused; plus-one limit is enforced separately
    let overbook = null;
    try { await loser.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 1 } }); }
    catch (err) { overbook = String(err?.diagnostic?.details?.message ?? err?.message ?? ''); }
    assert(overbook && overbook.includes('capacity exceeded'), 'overbook upgrade refused');
    let limit = null;
    try { await loser.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'going', plusOnes: 3 } }); }
    catch (err) { limit = String(err?.diagnostic?.details?.message ?? err?.message ?? ''); }
    assert(limit && limit.includes('plus-ones must be between'), 'plus-one ceiling enforced');
    // authoritative counts from an independent session + the public preview
    const after = (await cora.client.query(api.guestEventView, { args: { eventId: EVENT } })).rows[0];
    assert(after.goingSeats === 12 && after.goingSeats <= after.capacity, 'authoritative count equals capacity, never above');
    const preview = await anonQuery('eventPreview', { slug: 'lantern-supper' });
    assert(preview.body.rows[0].goingSeats === 12 && preview.body.rows[0].spotsLeft === 0, 'public preview shows a full event');
    evidence['A4-05'] = {
      twoActorBarrier: 'Promise.allSettled: two seated guests each requesting 3 seats with 4 remaining',
      settlement: {
        winnerReceiptSeats: winnerSeats,
        loserRefusal: { code: loserCode, message: loserMessage.slice(0, 140) },
        loserRebooked: fit.result,
        structuredRefusalNote: 'capacity refusal arrives as SNAPBACK_HANDLER_FAILED prose, not a structured app code (known: finding 0137-a3-f3, not re-filed)',
      },
      authoritativeCount: { goingSeats: after.goingSeats, capacity: after.capacity, previewSpotsLeft: preview.body.rows[0].spotsLeft },
    };
    return { note: `concurrent 3-seat RSVPs: exactly one commits (11/12), loser refused then fits at 12/12; upgrade + plus-one-limit refusals hold; authoritative and public counts agree (${loserCode})` };
  });

  // ---------- A4-06-LIVE ----------
  await check('A4-06-LIVE', async () => {
    // second client: gil holds live handles for the wall and the counts
    const wallHandle = await gil.client.liveQuery(api.wallFeed, {
      args: { eventId: EVENT }, connectionId: 'gil_wall', transport: 'stream' });
    const viewHandle = await gil.client.liveQuery(api.guestEventView, {
      args: { eventId: EVENT }, connectionId: 'gil_view', transport: 'stream' });
    for (const [name, handle] of Object.entries({ wallHandle, viewHandle })) {
      await until(() => (handle.connection === 'live' ? true : null), `${name} live`);
      cleanups.push(() => handle.dispose());
    }
    const wallBaseline = wallHandle.rows.length;
    const seatsBaseline = viewHandle.rows[0]?.goingSeats ?? (await until(() => viewHandle.rows[0], 'view row present')).goingSeats;
    // live wall post from the host
    const t0 = Date.now();
    await hana.client.mutate(api.postWall, {
      args: { eventId: EVENT, body: 'Lanterns are up — see everyone Saturday!', clientKey: 'a4-06-hana', authorName: 'Hana' } });
    await until(() => (wallHandle.rows.length === wallBaseline + 1 ? true : null), 'live wall delivery');
    const wallMs = Date.now() - t0;
    const posted = wallHandle.rows.at(-1);
    assert(posted.authorId === hana.userId, 'wall post attributed to the server principal');
    // live guest-count change (cora drops to maybe: 12 -> 11 seats)
    const t1 = Date.now();
    await cora.client.mutate(api.updateRsvp, { args: { eventId: EVENT, status: 'maybe', plusOnes: 0 } });
    // (defensive ?: the single-record live handle can present a transient
    // empty frame mid-delivery — observed once across runs; diary note)
    await until(() => (viewHandle.rows[0]?.goingSeats === seatsBaseline - 1 ? true : null), 'live count delivery');
    const countMs = Date.now() - t1;
    // authority: live rows equal an independent snapshot
    const authoritative = (await cora.client.query(api.wallFeed, { args: { eventId: EVENT } })).rows;
    assert(JSON.stringify(wallHandle.rows.map((r) => r._id)) === JSON.stringify(authoritative.map((r) => r._id)),
      'live wall rows equal the authoritative snapshot');
    // presence through the genuinely ephemeral path (headless overlay lane;
    // the React presence pair is known-broken: findings 0137-a2-f1/f2)
    const durableBefore = (await gil.client.query(api.wallFeed, { args: { eventId: EVENT } })).version;
    const scope = { eventId: EVENT };
    const gilOverlay = await gil.client.subscribeEphemeral(api.ephemeral.eventPresence, {
      connectionId: 'gil_presence', scope });
    const hanaOverlay = await hana.client.subscribeEphemeral(api.ephemeral.eventPresence, {
      connectionId: 'hana_presence', scope });
    cleanups.push(() => gilOverlay.dispose());
    cleanups.push(() => hanaOverlay.dispose());
    for (let i = 0; i < 5; i += 1) {
      await hanaOverlay.publish({ name: 'Hana' }, { ttlMs: 10_000 });
      await gilOverlay.publish({ name: 'Gil' }, { ttlMs: 10_000 });
      await sleep(60);
    }
    await until(() => (gilOverlay.currentEntries().length === 2 ? true : null), 'both presences visible', 8_000);
    const names = gilOverlay.currentEntries().map((e) => e.value?.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(['Gil', 'Hana']), 'presence entries carry both guests');
    const durableAfter = (await gil.client.query(api.wallFeed, { args: { eventId: EVENT } })).version;
    assert(durableAfter === durableBefore, `10 presence publishes advanced durable version ${durableBefore} -> ${durableAfter}`);
    evidence['A4-06'] = {
      secondClient: 'gil (independent authenticated session), two stream handles + ephemeral overlay',
      transportAttribution: {
        connection: 'live', transport: 'stream',
        wallDeliveryMs: wallMs, countDeliveryMs: countMs,
        presence: 'ephemeral overlay lane over the managed stream (snapshot+delta); zero durable amplification verified against the store version',
        reactPresenceNonclaim: 'the React-arm presence pair is known-broken on 0.1.7 (findings 0137-a2-f1, 0137-a2-f2) — cited, not re-filed',
      },
      authoritativeCount: { goingSeatsBefore: seatsBaseline, goingSeatsAfter: viewHandle.rows[0]?.goingSeats },
      actorAttribution: { wallAuthorId: posted.authorId, matches: 'hana session principal' },
    };
    return { note: `wall post ${wallMs}ms and guest-count drop ${countMs}ms to the second client over the managed stream; presence via ephemeral overlay with durable version untouched` };
  });

  // ---------- A4-07-ASSETS ----------
  let flyerAssetId = null;
  let galleryAssetId = null;
  await check('A4-07-ASSETS', async () => {
    const flyerPng = buildPng(64, 48, 200);
    const up = await uploadImage(hana, api.flyerUpload, 'lantern-flyer.png', flyerPng);
    flyerAssetId = up.assetId;
    assert(up.finalize.task.availability === 'ready', `flyer published (${JSON.stringify(up.finalize.task).slice(0, 200)})`);
    const record = await until(async () => {
      const r = await readAssetRecord(up.assetId, hana.token);
      return r.status === 200 ? r.body : null;
    }, 'asset record readable', 10_000);
    // rendition identity: declared variants render from the canonical bytes
    const cardRes = await until(async () => {
      const r = await readAssetBytes(up.assetId, 'card', hana.token);
      return r.status === 200 ? r : null;
    }, 'card rendition ready', 15_000);
    const cardBytes = Buffer.from(await cardRes.arrayBuffer());
    assert(cardBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'card rendition is a PNG');
    const thumbRes = await readAssetBytes(up.assetId, 'thumb', hana.token);
    assert(thumbRes.status === 200, `thumb rendition ready (${thumbRes.status})`);
    const bestRes = await readAssetBytes(up.assetId, 'best?maxWidth=200', hana.token);
    // primary delivery + content identity
    const primaryRes = await readAssetBytes(up.assetId, 'primary', hana.token);
    assert(primaryRes.status === 200, 'owner primary delivery authorized');
    assert(primaryRes.headers.get('cache-control')?.includes('no-store'), 'private-strict cache headers');
    const primaryBytes = Buffer.from(await primaryRes.arrayBuffer());
    const primaryHash = sha256hex(primaryBytes);
    const primaryAgain = Buffer.from(await (await readAssetBytes(up.assetId, 'primary', hana.token)).arrayBuffer());
    assert(sha256hex(primaryAgain) === primaryHash, 'canonical content identity stable across reads');
    // attach probe: the documented typed-reference path (known 0137-a1-f2)
    let attachOutcome = null;
    try {
      const attach = await hana.client.mutate(api.attachFlyer, { args: { eventId: EVENT, assetId: up.assetId } });
      attachOutcome = { committed: true, rowId: attach.result };
    } catch (err) {
      attachOutcome = { committed: false, code: diagCode(err) };
    }
    // the queryable reference the app actually uses (plain-string workaround)
    await hana.client.mutate(api.setFlyerRef, { args: { eventId: EVENT, assetId: up.assetId } });
    const preview = await anonQuery('eventPreview', { slug: 'lantern-supper' });
    assert(preview.body.rows[0].hasFlyer === true, 'preview reflects the flyer reference');
    // authorization matrix on the strict lane
    const gilStrict = await readAssetBytes(up.assetId, 'primary', gil.token);
    const maxStrict = await readAssetBytes(up.assetId, 'primary', max.token);
    assert(maxStrict.status === 403 || maxStrict.status === 404, `outsider strict delivery denied (${maxStrict.status})`);
    // the documented pasteable lanes: private-signed issuance and the
    // public-immutable route (galleryUpload declares private-signed and
    // generated + uploaded + finalized cleanly)
    const galleryPng = buildPng(64, 48, 60);
    const gallery = await uploadImage(hana, api.galleryUpload, 'supper-table.png', galleryPng);
    galleryAssetId = gallery.assetId;
    const signed = await fetch(`${ready.serverUrl}/assets/records/${gallery.assetId}/signed-url`, {
      method: 'POST', headers: { authorization: `Bearer ${hana.token}`, ...protocolHeaders },
      body: JSON.stringify({ variant: 'primary' }),
    }).then(async (r) => ({ status: r.status, body: await r.text() }));
    const publicRoute = await fetch(`${ready.serverUrl}/assets/public/${gallery.assetId}/primary`);
    const galleryOwnerRead = await readAssetBytes(gallery.assetId, 'primary', hana.token);
    evidence['A4-07'] = {
      objectIdentity: {
        flyerAssetId: up.assetId, galleryAssetId: gallery.assetId,
        uploadedBytes: flyerPng.byteLength, uploadedSha256: sha256hex(flyerPng),
        recordSnapshot: JSON.stringify(record).slice(0, 800),
      },
      renditionIdentity: {
        card: { status: cardRes.status, bytes: cardBytes.byteLength, pngMagic: true },
        thumb: { status: thumbRes.status },
        bestFit: { status: bestRes.status },
        pipeline: 'image intent location:strip with declared variants card(480)/thumb(128)',
      },
      contentHash: {
        primarySha256: primaryHash,
        primaryEqualsUploaded: primaryHash === sha256hex(flyerPng),
        note: 'strip re-encodes canonical bytes; content identity is the served primary digest, verified stable across reads',
      },
      authorization: {
        ownerPrimary: primaryRes.status,
        seatedGuestStrict: gilStrict.status,
        outsiderStrict: maxStrict.status,
        uploadPath: 'authenticated raw attempt/TUS/finalize (packaged asset client cannot authenticate on sessions — known 0137-a1-f3, cited)',
      },
      attachDefect: attachOutcome,
      pasteableLanesDefect: {
        signedUrlIssuance: { status: signed.status, body: signed.body.slice(0, 120) },
        publicImmutableRoute: { status: publicRoute.status },
        galleryOwnerStrictRead: galleryOwnerRead.status,
        note: 'the assets guide documents both pasteable lanes as shipped; the packaged runtime serves neither route (arm finding)',
      },
      queryableReference: { workaround: 'events.flyerAssetId plain string (0137-a1-f1)', previewHasFlyer: true },
    };
    const failParts = [];
    if (!attachOutcome.committed) failParts.push(`typed attach refuses (${attachOutcome.code}; known 0137-a1-f2)`);
    if (signed.status !== 200) failParts.push(`signed-url issuance ${signed.status} (arm finding)`);
    if (failParts.length > 0) {
      return {
        result: 'fail',
        note: `upload + card/thumb renditions + owner strict delivery + stable content hash all verified, but no non-owner viewer is authorizable on 0.1.7: ${failParts.join('; ')}; guest strict read ${gilStrict.status}`,
      };
    }
    return { note: 'authenticated PNG upload published with renditions and delivered to authorized viewers' };
  });

  // ---------- A4-08-ASSET-REVOCATION ----------
  await check('A4-08-ASSET-REVOCATION', async () => {
    assert(flyerAssetId && galleryAssetId, 'A4-07 uploaded both assets');
    // (1) authority revocation stops strict delivery to a previously
    // authorized viewer: a second host session reads, then logs out
    const hana2 = await signIn('hana@sweep-a4.test', 'hana2');
    const beforeLogout = await readAssetBytes(flyerAssetId, 'primary', hana2.token);
    assert(beforeLogout.status === 200, `second host session delivers before revocation (${beforeLogout.status})`);
    // server-side session revocation (the packaged client's authLogout
    // demands AuthCoordinator custody an external-bearer client lacks, so
    // the suite drives the documented route directly)
    const logout = await fetch(`${ready.serverUrl}/auth/logout`, {
      method: 'POST', headers: { authorization: `Bearer ${hana2.token}`, ...protocolHeaders }, body: '{}',
    });
    assert(logout.status === 204, `logout accepted (${logout.status})`);
    const afterLogout = await until(async () => {
      const r = await readAssetBytes(flyerAssetId, 'primary', hana2.token);
      return r.status !== 200 ? r : null;
    }, 'revoked session denied', 10_000);
    assert([401, 403, 404].includes(afterLogout.status), `revoked session denied (${afterLogout.status})`);
    // (2) deletion stops delivery: gallery first (its pasteable lane never
    // existed on this runtime — the strict record routes still govern it)
    const delGallery = await fetch(`${ready.serverUrl}/assets/records/${galleryAssetId}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${hana.token}`, ...protocolHeaders },
    });
    assert(delGallery.ok, `gallery delete accepted (${delGallery.status})`);
    const postDeleteGallery = await readAssetBytes(galleryAssetId, 'primary', hana.token);
    assert([403, 404, 410].includes(postDeleteGallery.status), `deleted gallery refuses (${postDeleteGallery.status})`);
    // (3) flyer deletion stops the previously authorized owner's delivery
    const delFlyer = await fetch(`${ready.serverUrl}/assets/records/${flyerAssetId}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${hana.token}`, ...protocolHeaders },
    });
    assert(delFlyer.ok, `flyer delete accepted (${delFlyer.status})`);
    const postDeleteOwner = await readAssetBytes(flyerAssetId, 'primary', hana.token);
    assert([403, 404, 410].includes(postDeleteOwner.status), `post-delete owner read denied (${postDeleteOwner.status})`);
    // clear the app-level reference so the UI stops advertising the flyer
    await hana.client.mutate(api.setFlyerRef, { args: { eventId: EVENT, assetId: '' } });
    const preview = await anonQuery('eventPreview', { slug: 'lantern-supper' });
    assert(preview.body.rows[0].hasFlyer === false, 'preview reference cleared');
    evidence['A4-08'] = {
      deleteProof: {
        gallery: { delete: delGallery.status, ownerReadAfter: postDeleteGallery.status },
        flyer: { delete: delFlyer.status, ownerReadAfter: postDeleteOwner.status },
        appReferenceCleared: true,
      },
      authorityChange: {
        lane: 'session retirement on the private-strict lane (authLogout): the previously authorized second host session read 200, then denied',
        before: beforeLogout.status, after: afterLogout.status,
      },
      negativeDelivery: { revokedSession: afterLogout.status, deletedGallery: postDeleteGallery.status, deletedOwner: postDeleteOwner.status },
      nonclaim: 'the check facts are proven on the only reachable viewer set (owner sessions): membership/reference sharing (0137-a1-f2 chain) and the pasteable lanes (this arm) are unauthorable on 0.1.7, so no other previously-authorized viewer class exists to revoke',
    };
    return { note: `every request re-authorizes: revoked session denied (${afterLogout.status}) after a 200 read; deletion stops delivery on both assets (${postDeleteGallery.status}/${postDeleteOwner.status}); non-owner viewer classes do not exist on 0.1.7 (recorded nonclaim)` };
  });

  // ---------- A4-09-REMINDER ----------
  await check('A4-09-REMINDER', async () => {
    const before = (await hana.client.query(api.hostEventDetail, { args: { eventId: EVENT } })).rows[0];
    assert(before.deliveries.length === 0, 'no deliveries before the scheduler runs');
    // deterministic scheduler: the suite owns every tick (cron disabled).
    // The FIRST everyMs run is the epoch-anchor catch-up: it succeeds at
    // nominal slot 0 with trusted time 0, so the due-scan no-ops (arm
    // finding — receipt retained); a later tick runs at a real nominal.
    const ticks = [];
    let epochRun = null;
    let deliveredRun = null;
    for (let i = 0; i < 10 && !deliveredRun; i += 1) {
      const tick = await cronTick();
      assert(tick.status === 200, `tick accepted (${tick.status})`);
      ticks.push(tick.runs.map((r) => ({ scheduledAtMs: r.scheduledAtMs, outcome: r.outcome, runId: r.runId })));
      for (const run of tick.runs) {
        if (run.jobName !== 'reminderTick' || run.outcome !== 'Succeeded') continue;
        if (run.scheduledAtMs === 0) epochRun = run;
        else deliveredRun = run;
      }
      if (!deliveredRun) await sleep(1_100);
    }
    assert(deliveredRun, `a real-nominal reminderTick run succeeded (${JSON.stringify(ticks).slice(0, 400)})`);
    const after = await until(async () => {
      const d = (await hana.client.query(api.hostEventDetail, { args: { eventId: EVENT } })).rows[0];
      return d.deliveries.length > 0 ? d : null;
    }, 'delivery recorded', 10_000);
    assert(after.deliveries.length === 1, `exactly one delivery (${after.deliveries.length})`);
    const delivery = after.deliveries[0];
    assert(delivery.dedupeKey === 'rem_daybefore:day-before', `dedupe key (${delivery.dedupeKey})`);
    assert(delivery.recipients === 6, `recipients = going guests (${delivery.recipients})`);
    // idempotency: further ticks and a direct action call add nothing
    const tick2 = await cronTick();
    const manual = await hana.client.action(api.runReminder, { args: { trigger: 'manual-verify' } });
    assert(manual.result.delivered.length === 0 && manual.result.alreadyDelivered === 1,
      `re-run is a no-op (${JSON.stringify(manual.result)})`);
    const final = (await hana.client.query(api.hostEventDetail, { args: { eventId: EVENT } })).rows[0];
    assert(final.deliveries.length === 1, 'still exactly one delivery after re-ticks');
    // authority: an outsider cannot drive the reminder action. NOTE (arm
    // finding): the nested mutation's SNAPBACK_AUTH_PERMISSION_DENIED
    // collapses to SNAPBACK_HANDLER_FAILED at the action boundary — the
    // refusal holds but the auth code is lost.
    let maxRun = null;
    try {
      const env = await max.client.action(api.runReminder, { args: { trigger: 'forged' } });
      maxRun = actionRefusal(env);
    } catch (err) { maxRun = diagCode(err); }
    assert(!String(maxRun).startsWith('ALLOWED'), `outsider action refused (${maxRun})`);
    const stillOne = (await hana.client.query(api.hostEventDetail, { args: { eventId: EVENT } })).rows[0];
    assert(stillOne.deliveries.length === 1, 'the refused outsider run delivered nothing');
    evidence['A4-09'] = {
      scheduleIdentity: {
        jobName: deliveredRun.jobName, runId: deliveredRun.runId,
        scheduledAtMs: deliveredRun.scheduledAtMs, idempotencyKey: deliveredRun.idempotencyKey,
        schedule: 'everyMs 1000 jitter:false (acceptance-rig scan cadence)',
        cronDisabled: 'SNAPBACK_CRON_DISABLED=1: definitions load, autonomous claiming off, every run suite-driven',
      },
      epochCatchupFinding: {
        run: epochRun,
        fact: 'the everyMs catch-up run Succeeded at nominal slot 0 with trusted time 0, so the due-scan silently no-opped — time-gated scheduled logic is wrong on the first run of every everyMs job (arm finding)',
      },
      runReceipt: { run: deliveredRun, tickTrace: ticks, extraTick: tick2.runs, manualVerify: manual.result },
      dedupeKey: { value: delivery.dedupeKey, recipients: delivery.recipients, deliveredAt: delivery.deliveredAt, uniqueIndex: 'reminderDeliveries.by_dedupe' },
      outsiderActionDenied: maxRun,
    };
    return { note: `scheduled tick ran reminderTick (${deliveredRun.runId}) and recorded one delivery (6 recipients, dedupe ${delivery.dedupeKey}); epoch-0 catch-up no-op receipted (finding); re-tick + manual re-run are no-ops; outsider denied` };
  });

  // ---------- A4-10-EFFECT ----------
  await check('A4-10-EFFECT', async () => {
    // deployment config custody: the provider token never touches app data
    const set = await configCall('set', { entry: 'notifyToken', value: NOTIFY_TOKEN });
    assert(set.status === 200 && set.body.applyState === 'applied', `config set applied (${JSON.stringify(set.body)})`);
    const status = await configCall('status');
    const entry = status.body.entries.find((e) => e.name === 'notifyToken');
    assert(entry.set === true && entry.secret === true, 'config status reports custody, never bytes');
    assert(!JSON.stringify(status.body).includes(NOTIFY_TOKEN), 'status never discloses the value');
    // The action ctx surface on the packaged inline lane (arm evidence):
    const ctxProbe = await hana.client.action(api.inspectActionCtx, { args: {} });
    // The effect attempt: the provider is up and scripted, the token is in
    // custody, the ledger begins the attempt — and the outbound call is
    // structurally impossible on packaged 0.1.7 (arm finding, three lanes):
    //   module-form action: BUNDLE_UNSUPPORTED_EXPORT at generation vs
    //     SNAPBACK_HANDLER_EXPORT_MISSING at load (repro: probe-action-forms);
    //   inline global fetch: SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER;
    //   inline ctx.fetch: SNAPBACK_HANDLER_HOST_CALL_UNKNOWN host.fetch.
    const dedupeKey = 'notify-a4-full-house-1';
    const sendArgs = { eventId: EVENT, dedupeKey, body: 'Lantern Supper is full — see you Saturday!', providerUrl };
    providerScript = ['ok'];
    const attempt = await hana.client.action(api.sendNotification, { args: sendArgs });
    const hostCallDefect = attempt.result.detail.includes('SNAPBACK_HANDLER_HOST_CALL_UNKNOWN');
    const providerReached = providerLedger.requests.length > 0;
    // app-level ledger semantics still hold: the unreachable call was
    // classified ambiguous (never falsely failed or sent), non-terminal,
    // and retryable under the same key
    const midLedger = (await hana.client.query(api.notifyLedger, { args: { eventId: EVENT } })).rows[0];
    assert(midLedger.state === attempt.result.state && midLedger.attempts.length >= 1,
      'attempt ledger appended');
    const retry = await hana.client.action(api.sendNotification, { args: sendArgs });
    const ledger = (await hana.client.query(api.notifyLedger, { args: { eventId: EVENT } })).rows[0];
    // authority: a guest cannot fire the host notification effect (the
    // auth code collapses through the action boundary — arm finding, same
    // observable as A4-09's outsider run)
    let gilSend = null;
    try {
      const env = await gil.client.action(api.sendNotification, { args: { ...sendArgs, dedupeKey: 'notify-gil-forged' } });
      gilSend = actionRefusal(env);
    } catch (err) { gilSend = diagCode(err); }
    assert(!String(gilSend).startsWith('ALLOWED'), `guest effect refused (${gilSend})`);
    const forged = (await hana.client.query(api.notifyLedger, { args: { eventId: EVENT } })).rows
      .find((r) => r.dedupeKey === 'notify-gil-forged');
    assert(forged === undefined, 'the refused guest send created no intent');
    evidence['A4-10'] = {
      providerBoundary: {
        url: providerUrl, providerListening: true, providerReached,
        custody: 'notifyToken set through the admin config surface; status reports set:true secret:true and never the bytes',
      },
      actionCtxSurface: ctxProbe.result,
      faultInjection: 'scripted provider (500 / socket-drop / ok) stood ready; no request ever arrived',
      attemptLedger: ledger.attempts,
      ambiguousState: {
        state: midLedger.state, settledAt: midLedger.settledAt,
        note: 'the app classified the unreachable outbound call as ambiguous and kept it retryable — correct app semantics over a missing platform surface',
      },
      terminalSettlement: { reached: false, state: ledger.state, attemptCount: ledger.attemptCount },
      authoringDefect: {
        moduleForm: 'BUNDLE_UNSUPPORTED_EXPORT (every export form) at generation; an export-free file loads but fails SNAPBACK_HANDLER_EXPORT_MISSING',
        inlineGlobalFetch: 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER: fetch not in the inline allowlist (no egress awareness)',
        inlineCtxFetch: attempt.result.detail.slice(0, 160),
        runtimeKnowsHostFetch: 'the runtime binary contains "host.fetch" but the inline handler bridge never registers it',
      },
      guestDenied: gilSend,
    };
    assert(hostCallDefect && !providerReached, `expected the host-call defect (${attempt.result.detail.slice(0, 120)})`);
    return {
      result: 'fail',
      note: `outbound notification effect is UNAUTHORABLE on packaged 0.1.7: module-form actions cannot ship (export catch-22), inline actions deny fetch and host.fetch is unregistered (${retry.result.state} after retry; provider never reached; app ledger correctly kept the outcome ambiguous+retryable; config custody verified) — arm finding filed`,
    };
  });

  // ---------- A4-11-CLEANUP (kernel) ----------
  await check('A4-11-CLEANUP', async () => {
    // config custody retired (config survives app resets by design)
    const unset = await configCall('unset', { entry: 'notifyToken' });
    assert(unset.status === 200, `config unset (${unset.status})`);
    const status = await configCall('status');
    assert(status.body.entries.find((e) => e.name === 'notifyToken').set === false, 'config entry cleared');
    // files: both assets were deleted in A4-08. Their byte lanes refuse;
    // the metadata record survives as lifecycle evidence, so retirement is
    // asserted on availability, not on the record read.
    const assetRetired = async (assetId) => {
      const bytes = await readAssetBytes(assetId, 'primary', hana.token);
      const record = await readAssetRecord(assetId, hana.token);
      const availability = record.body?.availability ?? record.body?.task?.availability ?? record.status;
      return { bytes: bytes.status, record: record.status, availability };
    };
    const flyerGone = await assetRetired(flyerAssetId);
    const galleryGone = await assetRetired(galleryAssetId);
    for (const [name, state] of [['flyer', flyerGone], ['gallery', galleryGone]]) {
      assert(state.bytes !== 200 && state.availability !== 'ready',
        `${name} retired (bytes ${state.bytes}, availability ${state.availability})`);
    }
    // schedules: the suite owned every tick; a final tick finds nothing due
    const finalTick = await cronTick();
    const reminderRuns = finalTick.runs.filter((r) => r.jobName === 'reminderTick' && r.outcome === 'Succeeded');
    // identities: every seat self-removes (membership cannot be seeded or
    // reset — known 0137-a3-f1, cited not re-filed)
    for (const actor of [gil, mira, cora, hana]) {
      await actor.client.mutate(api.leaveEvent, { args: { eventId: EVENT } });
    }
    let postLeave = null;
    try { await hana.client.query(api.guestEventView, { args: { eventId: EVENT } }); }
    catch (err) { postLeave = diagCode(err); }
    assert(postLeave === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'authority retired before reset');
    // data: receipted versioned reset-install restores the literal fixture
    const admin = createExternalSessionClient(ready.serverUrl, {
      bearerToken: hana.token, adminToken, rqsStore: null });
    const preview = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const receipt = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: preview.current.dataVersionStream },
    });
    assert(receipt.operation === 'reset-install' && receipt.outcome === 'reset-installed', 'reset-install settled');
    // fixture verification requires a seat: the restored invite redeems again
    const verifier = await signIn('hana@sweep-a4.test', 'hana-verify');
    let stillDenied = null;
    try { await verifier.client.query(api.guestEventView, { args: { eventId: EVENT } }); }
    catch (err) { stillDenied = diagCode(err); }
    assert(stillDenied === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'reset does not resurrect authority');
    const seat = await verifier.client.mutate(api.redeemInvite, {
      args: { code: 'INV-HOST-2214', name: 'Hana', enteredVia: 'code' } });
    assert(seat.result.role === 'host', 'restored fixture invite redeemable');
    const view = (await verifier.client.query(api.guestEventView, { args: { eventId: EVENT } })).rows[0];
    assert(view.goingSeats === 6 && view.goingCount === 3, 'literal seed seat math restored');
    const wall = (await verifier.client.query(api.wallFeed, { args: { eventId: EVENT } })).rows;
    assert(wall.length === 3, 'runtime wall posts gone, seeded wall back');
    const detail = (await verifier.client.query(api.hostEventDetail, { args: { eventId: EVENT } })).rows[0];
    assert(detail.invites.length === 4, 'runtime invite gone, four fixture invites restored');
    assert(detail.invites.every((i) => i.code === 'INV-HOST-2214' || !i.consumed),
      'restored invites unconsumed (the host invite was just re-redeemed by the verifier)');
    assert(detail.deliveries.length === 0, 'reminder deliveries cleared by the named-table reset');
    const ledger = (await verifier.client.query(api.notifyLedger, { args: { eventId: EVENT } })).rows;
    assert(ledger.length === 0, 'notification intents and attempts cleared');
    assert(detail.hostNotes.includes('Budget $900.') && !detail.hostNotes.includes('Check lanterns'), 'event row restored to the literal fixture');
    // final reset leaves the database at the untouched fixture
    await verifier.client.mutate(api.leaveEvent, { args: { eventId: EVENT } });
    const preview2 = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    const receipt2 = await admin.resetInstallVersionedSeed(seedArtifact, {
      requestedMode: 'sessions',
      expectedDataVersionStream: { state: 'present', value: preview2.current.dataVersionStream },
    });
    assert(receipt2.outcome === 'reset-installed', 'final reset settled');
    const finalProbe = await signIn('hana@sweep-a4.test', 'hana-final');
    let finalNegative = null;
    try { await finalProbe.client.query(api.guestEventView, { args: { eventId: EVENT } }); }
    catch (err) { finalNegative = diagCode(err); }
    assert(finalNegative === 'SNAPBACK_AUTH_PERMISSION_DENIED', 'post-cleanup negative holds');
    evidence['A4-11'] = {
      targetBoundPlan: 'suite-owned dev database in the arm directory only; assets deleted in A4-08 and verified retired; config unset through the admin custody surface; seats retired by self-removal (0137-a3-f1 cited), then receipted versioned reset-installs',
      cleanupReceipts: [
        { operation: receipt.operation, outcome: receipt.outcome, seedVersion: receipt.seedVersion, resetDeletedRows: receipt.resetDeletedRows },
        { operation: receipt2.operation, outcome: receipt2.outcome, resetDeletedRows: receipt2.resetDeletedRows },
      ],
      configCleared: true,
      assetsRetired: { flyer: flyerGone, gallery: galleryGone, note: 'byte lanes refuse; metadata record retained as lifecycle evidence with non-ready availability' },
      schedules: { cronDisabledWholeRun: true, finalTickReminderRuns: reminderRuns.length },
      postCleanupNegative: { afterLeave: postLeave, afterReset: stillDenied, final: finalNegative },
      fixtureVerification: { goingSeats: view.goingSeats, wallPosts: wall.length, invitesUnconsumed: true, deliveries: 0, notifyIntents: 0 },
    };
    return { note: `config unset, assets retired, seats self-removed, two receipted reset-installs (deleted ${receipt.resetDeletedRows} + ${receipt2.resetDeletedRows} rows) restore the literal fixture incl. redeemable invites; final fresh-session negative denied` };
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
  provider.close();
  const tally = { pass: 0, gap: 0, fail: 0, 'expected-refusal': 0 };
  for (const r of results) tally[r.result] = (tally[r.result] ?? 0) + 1;
  const report = {
    schemaVersion: 'sweep-a4.acceptance.v1',
    title: 'LLP 0137 A4 snapback-web acceptance',
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

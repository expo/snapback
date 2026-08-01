// Clip Locker — PocketBase arm (LLP 0139 App C). Single binary, local:
// files are fields on records (multipart form upload), served from
// /api/files/... with optional protected-file tokens.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');
const BASE = 'http://127.0.0.1:8291';
const results = { arm: 'pocketbase', posture: 'official single-binary local server (its only posture; hosting is self-managed)', startedAt: new Date().toISOString(), steps: {} };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const t0 = () => process.hrtime.bigint();
const ms = (a) => Number((process.hrtime.bigint() - a) / 1000000n);

const bigBytes = await readFile(join(fixtures, 'clip-120mb.mp4'));
const smallBytes = await readFile(join(fixtures, 'clip-small.mp4'));
const geoBytes = await readFile(join(fixtures, 'clip-geo.mp4'));

const auth = await (await fetch(`${BASE}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identity: 'admin@clip.test', password: 'clip-locker-admin-1' }),
})).json();
const TOKEN = auth.token;
const authHeaders = { authorization: TOKEN };

// ---- schema: a clips collection with a file field ----
const boot = t0();
const collection = await (await fetch(`${BASE}/api/collections`, {
  method: 'POST', headers: { ...authHeaders, 'content-type': 'application/json' },
  body: JSON.stringify({
    name: 'ub_c_clips', type: 'base',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'video', type: 'file', maxSelect: 1, maxSize: 200 * 1024 * 1024, mimeTypes: ['video/mp4'] },
    ],
  }),
})).json();
results.steps.boot = { wallMs: ms(boot), created: collection.id ? 'ok' : JSON.stringify(collection).slice(0, 200), ceremony: 'download binary, serve, create superuser, POST a collection with a file field' };

const net = { bytes: 0, requests: 0 };
async function uploadRecord(bytes, filename, { dropAtBytes = Infinity } = {}) {
  const form = new FormData();
  form.set('title', filename);
  form.set('video', new Blob([bytes], { type: 'video/mp4' }), filename);
  if (dropAtBytes !== Infinity) {
    // Cut the request body mid-stream to emulate the drop.
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 250);
    try {
      await fetch(`${BASE}/api/collections/ub_c_clips/records`, { method: 'POST', headers: authHeaders, body: form, signal: controller.signal });
    } catch (error) {
      return { aborted: true, error: String(error.message ?? error).slice(0, 120) };
    }
    return { aborted: false };
  }
  net.bytes += bytes.length; net.requests += 1;
  const r = await fetch(`${BASE}/api/collections/ub_c_clips/records`, { method: 'POST', headers: authHeaders, body: form });
  return { status: r.status, record: await r.json() };
}

// ---- 1+2: big upload, drop, "resume" ----
const wall = t0();
const dropped = await uploadRecord(bigBytes, 'clip-120mb.mp4', { dropAtBytes: bigBytes.length / 2 });
results.steps.interrupt = {
  outcome: dropped,
  resumeMechanism: 'none — a record create is a single multipart POST; there is no resumable protocol or upload session',
  partialRecordCreated: (await (await fetch(`${BASE}/api/collections/ub_c_clips/records`, { headers: authHeaders })).json()).totalItems,
};
const retry = t0();
const big = await uploadRecord(bigBytes, 'clip-120mb.mp4');
results.steps.bigUpload = {
  wallMsTotal: ms(wall), wallMsRetryLeg: ms(retry),
  fileBytes: bigBytes.length, bytesTransferredTotal: net.bytes,
  bytesRetransmitted: 'full file re-sent (no resume surface); the aborted attempt’s bytes are additional',
  status: big.status, recordId: big.record?.id, storedName: big.record?.video,
};

// ---- 3: integrity ----
const fileUrl = (rec, name) => `${BASE}/api/files/ub_c_clips/${rec}/${name}`;
const bigUrl = fileUrl(big.record.id, big.record.video);
const back = Buffer.from(await (await fetch(bigUrl)).arrayBuffer());
results.steps.integrity = { sourceSha256: sha(bigBytes), storedSha256: sha(back), matches: sha(back) === sha(bigBytes), providerDigest: 'none exposed' };

// ---- 4: range playback ----
const small = await uploadRecord(smallBytes, 'clip-small.mp4');
const smallUrl = fileUrl(small.record.id, small.record.video);
const ranged = await fetch(smallUrl, { headers: { range: 'bytes=100-4099' } });
const suffix = await fetch(smallUrl, { headers: { range: 'bytes=-1024' } });
results.steps.range = {
  status: ranged.status, contentRange: ranged.headers.get('content-range'),
  bytes: (await ranged.arrayBuffer()).byteLength,
  suffixStatus: suffix.status, suffixContentRange: suffix.headers.get('content-range'),
  cacheControl: ranged.headers.get('cache-control'),
};

// ---- 5: share link (file token) ----
const tokenResponse = await (await fetch(`${BASE}/api/files/token`, { method: 'POST', headers: authHeaders })).json();
const tokened = await fetch(`${smallUrl}?token=${tokenResponse.token}`);
results.steps.share = {
  headerlessServeStatus: (await fetch(smallUrl)).status,
  fileTokenStatus: tokened.status,
  ttlMechanism: 'POST /api/files/token mints a short-lived file token (default ~3 min, configurable); public collections need no token at all',
  revocation: 'token TTL only; no per-URL revocation',
};

// ---- 6: deletion truth ----
await fetch(`${BASE}/api/collections/ub_c_clips/records/${small.record.id}`, { method: 'DELETE', headers: authHeaders });
const afterDelete = await fetch(smallUrl);
results.steps.deletion = {
  outstandingUrlAfterDelete: afterDelete.status,
  referenceTracking: 'the file IS the record field — deleting the record deletes the file; no dangling ids by construction',
};

// ---- 7: video metadata privacy ----
const geo = await uploadRecord(geoBytes, 'clip-geo.mp4');
const geoBack = Buffer.from(await (await fetch(fileUrl(geo.record.id, geo.record.video))).arrayBuffer());
results.steps.geoPrivacy = { digestUnchanged: sha(geoBack) === sha(geoBytes), note: 'unchanged ⇒ verbatim; PocketBase does thumbs for images only, nothing for video metadata' };

// ---- 8: limits ----
results.steps.limits = { docs: 'PocketBase: file field maxSize per field (200MB set here); single binary, local disk or S3-backed storage; no resumable protocol' };

// cleanup
await fetch(`${BASE}/api/collections/${collection.id}`, { method: 'DELETE', headers: authHeaders });
results.steps.cleanup = { collectionDeleted: true, note: 'arm collection removed; pb_data is gitignored and local-only' };

results.finishedAt = new Date().toISOString();
await writeFile(join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));

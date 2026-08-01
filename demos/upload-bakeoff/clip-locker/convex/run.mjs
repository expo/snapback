// Clip Locker — Convex arm (LLP 0139 App C). Official storage path:
// generateUploadUrl (mutation) → POST bytes → storageId in a mutation.
// Instrumented to count POST bytes and inject one drop at ~50%.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');
const secrets = await readFile('/Users/ccheever/Dropbox/APIKeys/dogfood-matrix-secrets.md', 'utf8');
const CONVEX_URL = secrets.match(/CONVEX_URL=(https?:\/\/[^\s]+)/)[1].replace(/\/$/, '');
const results = { arm: 'convex', deployment: 'shared dev deployment (namespace impossible — see collision note)', startedAt: new Date().toISOString(), steps: {} };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const t0 = () => process.hrtime.bigint();
const ms = (a) => Number((process.hrtime.bigint() - a) / 1000000n);

const bigBytes = await readFile(join(fixtures, 'clip-120mb.mp4'));
const smallBytes = await readFile(join(fixtures, 'clip-small.mp4'));
const geoBytes = await readFile(join(fixtures, 'clip-geo.mp4'));
const convex = new ConvexHttpClient(CONVEX_URL);

const net = { postBytes: 0, posts: 0, dropAtBytes: Infinity, dropped: false };
const realFetch = globalThis.fetch;

// Upload one blob through the official three-step path. `dropAt` aborts
// the stream mid-body to emulate the connection loss.
async function convexUpload(bytes, { dropAt = Infinity } = {}) {
  const uploadUrl = await convex.mutation('clips:generateUploadUrl', {});
  if (dropAt !== Infinity) {
    // Stream the body and cut it at dropAt bytes.
    const controller = new AbortController();
    let sent = 0;
    const body = new ReadableStream({
      pull(ctrl) {
        const CH = 1 << 20;
        if (sent >= bytes.length) return ctrl.close();
        if (sent + CH > dropAt) { controller.abort(); return ctrl.error(new Error('simulated drop')); }
        ctrl.enqueue(bytes.subarray(sent, sent + CH));
        sent += CH; net.postBytes += CH;
      },
    });
    await realFetch(uploadUrl, { method: 'POST', headers: { 'content-type': 'video/mp4' }, body, duplex: 'half', signal: controller.signal });
    return { aborted: true, sent };
  }
  net.posts += 1; net.postBytes += bytes.length;
  const r = await realFetch(uploadUrl, { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: bytes });
  const json = await r.json();
  return { status: r.status, storageId: json.storageId };
}

// ---- 1+2: big upload, drop at ~50%, then "resume" ----
const wall = t0();
let dropOutcome = null;
try {
  dropOutcome = await convexUpload(bigBytes, { dropAt: Math.floor(bigBytes.length / 2) });
} catch (error) {
  dropOutcome = { aborted: true, error: String(error.message ?? error).slice(0, 200) };
}
const bytesBeforeDrop = net.postBytes;
results.steps.interrupt = {
  plannedDropAtBytes: Math.floor(bigBytes.length / 2),
  transferredBeforeDrop: bytesBeforeDrop,
  outcome: dropOutcome,
  resumeMechanism: 'none — the official path has no resumable protocol; the upload URL is single-shot POST',
};

const retryStart = t0();
const uploaded = await convexUpload(bigBytes);
results.steps.bigUpload = {
  wallMsTotal: ms(wall),
  wallMsRetryLeg: ms(retryStart),
  fileBytes: bigBytes.length,
  postBytesTotal: net.postBytes,
  bytesRetransmitted: net.postBytes - bigBytes.length,
  posts: net.posts,
  storageId: uploaded.storageId,
  status: uploaded.status,
};

// ---- 3: integrity ----
const meta = await convex.query('clips:clipMeta', { storageId: uploaded.storageId });
const url = await convex.query('clips:clipUrl', { storageId: uploaded.storageId });
const back = Buffer.from(await (await realFetch(url)).arrayBuffer());
results.steps.integrity = {
  sourceSha256: sha(bigBytes),
  storedSha256: sha(back),
  matches: sha(back) === sha(bigBytes),
  providerDeclaredSha256: meta?.sha256 ?? null,
  size: meta?.size ?? null,
};

// ---- 4: range playback ----
const small = await convexUpload(smallBytes);
const smallUrl = await convex.query('clips:clipUrl', { storageId: small.storageId });
const ranged = await realFetch(smallUrl, { headers: { range: 'bytes=100-4099' } });
const suffix = await realFetch(smallUrl, { headers: { range: 'bytes=-1024' } });
results.steps.range = {
  status: ranged.status,
  contentRange: ranged.headers.get('content-range'),
  bytes: (await ranged.arrayBuffer()).byteLength,
  suffixStatus: suffix.status,
  suffixContentRange: suffix.headers.get('content-range'),
  cacheControl: ranged.headers.get('cache-control'),
};

// ---- 5: share link (their URL is the share; TTL/revocation posture) ----
const headerless = await realFetch(smallUrl);
results.steps.share = {
  headerlessServeStatus: headerless.status,
  ttlMechanism: 'getUrl() returns a long-lived unguessable URL; no TTL parameter, no per-issuance authorization',
  revocation: 'delete the file (or gate a custom HTTP action); no signed-URL expiry surface',
};

// ---- 6: deletion truth ----
const savedId = await convex.mutation('clips:saveClip', { title: 'the clip', storageId: small.storageId });
await convex.mutation('clips:deleteClip', { storageId: small.storageId, clipId: savedId });
const afterDelete = await realFetch(smallUrl);
const metaAfter = await convex.query('clips:clipMeta', { storageId: small.storageId });
results.steps.deletion = {
  outstandingUrlAfterDelete: afterDelete.status,
  systemMetadataAfterDelete: metaAfter,
  referenceTracking: 'none: the clips row held a storageId; deleting the file leaves dangling ids unless the app cleans up (documented app responsibility)',
};

// ---- 7: video metadata privacy ----
const geo = await convexUpload(geoBytes);
const geoUrl = await convex.query('clips:clipUrl', { storageId: geo.storageId });
const geoBack = Buffer.from(await (await realFetch(geoUrl)).arrayBuffer());
results.steps.geoPrivacy = {
  digestUnchanged: sha(geoBack) === sha(geoBytes),
  note: 'unchanged ⇒ location metadata served verbatim; no server-side media surface',
};

// ---- 8: limits ----
results.steps.limits = {
  docs: 'Convex file storage: no documented resumable protocol; upload URL is single-shot; file size limits per plan',
  observedBigUpload: results.steps.bigUpload.status ?? null,
};

// cleanup: remove our objects
for (const id of [uploaded.storageId, geo.storageId].filter(Boolean)) {
  await convex.mutation('clips:deleteClip', { storageId: id }).catch(() => {});
}
results.steps.cleanup = { deletedStorageIds: 'arm-owned only', note: 'Convex deploy is deployment-global: see the collision finding in the diary' };

results.finishedAt = new Date().toISOString();
await writeFile(join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));

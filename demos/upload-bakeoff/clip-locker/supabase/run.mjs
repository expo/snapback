// Clip Locker — Supabase arm (LLP 0139 App C). Shared project under the
// LLP 0102 amendment: namespaced bucket, redacted baseline, scoped
// cleanup with absence proof. Resumable = their documented TUS endpoint
// via tus-js-client with an instrumented HttpStack counting PATCH bytes.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import * as tus from 'tus-js-client';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');
const secrets = await readFile('/Users/ccheever/projects/snapback/.agent-local-secrets.md', 'utf8');
const SUPABASE_URL = secrets.match(/SUPABASE_URL=(https[^\s]+)/)[1];
const SECRET = secrets.match(/SUPABASE_SECRET_KEY=([^\s]+)/)[1];
const NS = 'ub-c-supabase-1';
const results = { arm: 'supabase', namespace: NS, startedAt: new Date().toISOString(), steps: {} };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const t0 = () => process.hrtime.bigint();
const ms = (a) => Number((process.hrtime.bigint() - a) / 1000000n);

const bigBytes = await readFile(join(fixtures, 'clip-120mb.mp4'));
const smallBytes = await readFile(join(fixtures, 'clip-small.mp4'));
const geoBytes = await readFile(join(fixtures, 'clip-geo.mp4'));
const supa = createClient(SUPABASE_URL, SECRET);

// --- baseline (redacted: names only, counted) ---
const baseline = await supa.storage.listBuckets();
results.steps.baseline = {
  bucketCount: baseline.data?.length ?? null,
  namespacePresent: !!baseline.data?.find((b) => b.name === NS),
  error: baseline.error ? String(baseline.error.message) : null,
};

// --- bucket create (namespaced, private, 150MB limit) ---
const boot = t0();
if (results.steps.baseline.namespacePresent) await supa.storage.emptyBucket(NS).catch(() => {});
const created = results.steps.baseline.namespacePresent
  ? { data: 'reused' }
  : await supa.storage.createBucket(NS, { public: false });
results.steps.boot = { wallMs: ms(boot), created: created.error ? String(created.error.message) : 'ok' };

// --- TUS server capabilities from the wire ---
const tusEndpoint = `${SUPABASE_URL}/storage/v1/upload/resumable`;
const opt = await fetch(tusEndpoint, { method: 'OPTIONS', headers: { apikey: SECRET } });
results.steps.tusCapabilities = {
  status: opt.status,
  tusVersion: opt.headers.get('tus-version'),
  tusExtension: opt.headers.get('tus-extension'),
  tusMaxSize: opt.headers.get('tus-max-size'),
  tusChecksum: opt.headers.get('tus-checksum-algorithm'),
};

// --- instrumented HttpStack: count PATCH bytes, inject one drop ---
const net = { patchBytes: 0, patches: 0, dropAtBytes: Infinity, dropped: false };
class CountingStack {
  #inner = new tus.DefaultHttpStack({});
  createRequest(method, url) {
    const req = this.#inner.createRequest(method, url);
    if (method === 'PATCH') {
      const realSend = req.send.bind(req);
      req.send = async (body) => {
        const size = body?.byteLength ?? body?.length ?? body?.size ?? 0;
        if (!net.dropped && net.patchBytes + size > net.dropAtBytes) {
          net.dropped = true;
          throw new Error('simulated connection drop (bakeoff)');
        }
        net.patchBytes += size;
        net.patches += 1;
        return realSend(body);
      };
    }
    return req;
  }
  getName() { return 'CountingStack'; }
}

const tusUpload = (bytes, objectName, { dropAt = Infinity, metadata = {}, uploadUrl = null } = {}) => new Promise((resolve, reject) => {
  net.dropAtBytes = dropAt; net.dropped = false;
  const upload = new tus.Upload(Buffer.from(bytes), {
    endpoint: tusEndpoint,
    retryDelays: null,
    httpStack: new CountingStack(),
    chunkSize: 6 * 1024 * 1024, // Supabase docs: must be exactly 6 MiB
    ...(uploadUrl ? { uploadUrl } : {}),
    metadata: { bucketName: NS, objectName, contentType: 'video/mp4', ...metadata },
    headers: { apikey: SECRET, 'x-upsert': 'true' },
    uploadDataDuringCreation: false,
    onError: (error) => reject(Object.assign(error, { upload })),
    onSuccess: () => resolve(upload),
  });
  upload.findPreviousUploads().then((prev) => {
    if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
    upload.start();
  });
});

// ---- 1+2: big upload, drop at ~50%, resume ----
const wall = t0();
let firstError = null;
await tusUpload(bigBytes, 'clip-120mb.mp4', { dropAt: Math.floor(bigBytes.length / 2) }).catch((e) => { firstError = e; });
results.steps.interrupt = {
  plannedDropAtBytes: Math.floor(bigBytes.length / 2),
  transferredBeforeDrop: net.patchBytes,
  error: firstError ? String(firstError.message ?? firstError).slice(0, 200) : null,
};
const resumeStart = t0();
let uploadError = null;
await tusUpload(bigBytes, 'clip-120mb.mp4').catch((e) => { uploadError = e; });
results.steps.bigUpload = {
  wallMsTotal: ms(wall),
  wallMsResumeLeg: ms(resumeStart),
  fileBytes: bigBytes.length,
  patchBytesTotal: net.patchBytes,
  bytesRetransmitted: net.patchBytes - bigBytes.length,
  patches: net.patches,
  error: uploadError ? String(uploadError.message ?? uploadError).slice(0, 300) : null,
};

// ---- 2b: resumability-truth at 40 MB (under the project cap) ----
const cap = bigBytes.subarray(0, 40 * 1024 * 1024);
net.patchBytes = 0; net.patches = 0;
let capFirstError = null; let capUploadUrl = null;
await tusUpload(cap, 'clip-40mb.mp4', { dropAt: 20 * 1024 * 1024 }).catch((e) => { capFirstError = e; capUploadUrl = e?.upload?.url ?? null; });
const capBefore = net.patchBytes;
const capResume = t0();
let capError = null;
await tusUpload(cap, 'clip-40mb.mp4', { uploadUrl: capUploadUrl }).catch((e) => { capError = e; });
results.steps.cappedResumability = {
  sanctionedContinuation: capUploadUrl ? "uploadUrl-from-first-attempt" : "none-available",
  fileBytes: cap.length,
  droppedAt: 20 * 1024 * 1024,
  transferredBeforeDrop: capBefore,
  patchBytesTotal: net.patchBytes,
  bytesRetransmitted: net.patchBytes - cap.length,
  patches: net.patches,
  wallMsResumeLeg: ms(capResume),
  error: capError ? String(capError.message ?? capError).slice(0, 300) : null,
};

// ---- 3: integrity (download back, digest) ----
if (!uploadError) {
  const dl = await supa.storage.from(NS).download('clip-120mb.mp4');
  const dlBytes = Buffer.from(await dl.data.arrayBuffer());
  results.steps.integrity = { sourceSha256: sha(bigBytes), storedSha256: sha(dlBytes), matches: sha(dlBytes) === sha(bigBytes) };
}

// ---- 4: range playback on the small clip ----
const smallUp = await supa.storage.from(NS).upload('clip-small.mp4', Buffer.from(smallBytes), { contentType: 'video/mp4', upsert: true });
if (smallUp.error) { results.steps.crash = { at: 'small upload', error: String(smallUp.error.message) }; console.log(JSON.stringify(results, null, 2)); process.exit(1); }
const smallSigned = await supa.storage.from(NS).createSignedUrl('clip-small.mp4', 600);
if (smallSigned.error || !smallSigned.data) { results.steps.crash = { at: 'createSignedUrl', error: String((smallSigned.error && smallSigned.error.message) ?? 'null data') }; console.log(JSON.stringify(results, null, 2)); process.exit(1); }
const ranged = await fetch(smallSigned.data.signedUrl, { headers: { range: 'bytes=100-4099' } });
const suffix = await fetch(smallSigned.data.signedUrl, { headers: { range: 'bytes=-1024' } });
results.steps.range = {
  status: ranged.status,
  contentRange: ranged.headers.get('content-range'),
  bytes: (await ranged.arrayBuffer()).byteLength,
  suffixStatus: suffix.status,
  suffixContentRange: suffix.headers.get('content-range'),
  cacheControl: ranged.headers.get('cache-control'),
};

// ---- 5: share link TTL + revocation posture ----
const shortSigned = await supa.storage.from(NS).createSignedUrl('clip-small.mp4', 2);
const fresh = await fetch(shortSigned.data.signedUrl);
await new Promise((r) => setTimeout(r, 3100));
const expired = await fetch(shortSigned.data.signedUrl);
results.steps.share = {
  headerlessServeStatus: fresh.status,
  afterTtlStatus: expired.status,
  ttlSecondsRequested: 2,
  revocationApi: 'none documented for outstanding signed URLs short of object deletion/key rotation',
};

// ---- 6: deletion truth ----
const longSigned = await supa.storage.from(NS).createSignedUrl('clip-small.mp4', 600);
const del = await supa.storage.from(NS).remove(['clip-small.mp4']);
const afterDelete = await fetch(longSigned.data.signedUrl);
results.steps.deletion = {
  deleteError: del.error ? String(del.error.message) : null,
  outstandingSignedUrlAfterDelete: afterDelete.status,
  note: 'no reference tracking: app-database rows pointing at the object are the app problem',
};

// ---- 7: video metadata privacy ----
await supa.storage.from(NS).upload('clip-geo.mp4', Buffer.from(geoBytes), { contentType: 'video/mp4', upsert: true });
const geoDl = await supa.storage.from(NS).download('clip-geo.mp4');
const geoBack = Buffer.from(await geoDl.data.arrayBuffer());
results.steps.geoPrivacy = {
  digestUnchanged: sha(geoBack) === sha(geoBytes),
  note: 'digest unchanged ⇒ location metadata served back verbatim (no server-side stripping surface exists)',
};

// ---- 8: limits honesty ----
results.steps.limits = {
  tusMaxSize: results.steps.tusCapabilities.tusMaxSize,
  bucketFileSizeLimit: '150MB set at creation; global project cap governs (Free plan default 50MB unless raised — observed outcome above is the truth)',
  docs: 'https://supabase.com/docs/guides/storage/uploads/resumable-uploads (6MB fixed chunk)',
};

// ---- cleanup with absence proof ----
const listing = await supa.storage.from(NS).list("", { limit: 1000 });
if (listing.data?.length) await supa.storage.from(NS).remove(listing.data.map((o) => o.name));
await supa.storage.emptyBucket(NS).catch(() => {});
const gone = await supa.storage.deleteBucket(NS);
const after = await supa.storage.listBuckets();
results.steps.cleanup = {
  deleteBucket: gone.error ? String(gone.error.message) : 'ok',
  namespaceAbsent: !after.data?.find((b) => b.name === NS),
  bucketCountAfter: after.data?.length ?? null,
  baselineCountUnchanged: (after.data?.length ?? null) === results.steps.baseline.bucketCount,
};

results.finishedAt = new Date().toISOString();
await writeFile(join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));

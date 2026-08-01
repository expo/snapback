// Clip Locker — Firebase arm (LLP 0139 App C). Hosted Storage is not
// provisioned on the probe project (both bucket hosts 404), so per LLP
// 0102's target-access amendment this runs the official local path: the
// Local Emulator Suite. Evidence confidence for target identity,
// deployment, operations, and cost is lowered accordingly.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase/app';
import { getStorage, connectStorageEmulator, ref, uploadBytesResumable, getDownloadURL, deleteObject, getMetadata } from 'firebase/storage';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');
const NS = 'ub-c-firebase-1';
const results = { arm: 'firebase', posture: 'Local Emulator Suite (hosted Storage not provisioned on the probe project — 404 on both bucket hosts)', startedAt: new Date().toISOString(), steps: {} };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const t0 = () => process.hrtime.bigint();
const ms = (a) => Number((process.hrtime.bigint() - a) / 1000000n);

const bigBytes = await readFile(join(fixtures, 'clip-120mb.mp4'));
const smallBytes = await readFile(join(fixtures, 'clip-small.mp4'));
const geoBytes = await readFile(join(fixtures, 'clip-geo.mp4'));

const app = initializeApp({ apiKey: 'AIzaSyCQTg1pK8bsBn8XnWZ97X4Ln7Y_tCkVMzs', projectId: 'snapback-probe', storageBucket: 'snapback-probe.firebasestorage.app' });
const storage = getStorage(app);
connectStorageEmulator(storage, '127.0.0.1', 9299);

// Count bytes actually PUT/POSTed to the emulator; inject one drop.
const net = { bytes: 0, requests: 0, dropAtBytes: Infinity, dropped: false };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const m = (init.method ?? 'GET').toUpperCase();
  if ((m === 'POST' || m === 'PUT') && init.body) {
    const size = init.body.byteLength ?? init.body.length ?? init.body.size ?? 0;
    if (size > 0) {
      if (!net.dropped && net.bytes + size > net.dropAtBytes) {
        net.dropped = true;
        throw new TypeError('fetch failed: simulated connection drop (bakeoff)');
      }
      net.bytes += size; net.requests += 1;
    }
  }
  return realFetch(url, init);
};
// The SDK uses XHR in browsers and fetch in Node ≥18 builds; if it uses
// its own transport we still get truth from the task's snapshot bytes.
const uploadResumable = (path, bytes, { dropAt = Infinity } = {}) => new Promise((resolve, reject) => {
  net.dropAtBytes = dropAt; net.dropped = false;
  const task = uploadBytesResumable(ref(storage, path), bytes, { contentType: 'video/mp4' });
  let lastTransferred = 0;
  task.on('state_changed',
    (snap) => { lastTransferred = snap.bytesTransferred; if (dropAt !== Infinity && snap.bytesTransferred >= dropAt) task.cancel(); },
    (error) => reject(Object.assign(error, { lastTransferred, task })),
    () => resolve({ lastTransferred, task }));
});

// ---- 1+2: big upload, cancel at ~50%, resume ----
const wall = t0();
let firstErr = null;
const dropAt = Math.floor(bigBytes.length / 2);
const first = await uploadResumable(`${NS}/clip-120mb.mp4`, bigBytes, { dropAt }).catch((e) => { firstErr = e; return e; });
results.steps.interrupt = {
  plannedDropAtBytes: dropAt,
  transferredBeforeDrop: first?.lastTransferred ?? null,
  sdkBytesCounted: net.bytes,
  error: firstErr ? String(firstErr.code ?? firstErr.message).slice(0, 160) : null,
  resumeMechanism: 'uploadBytesResumable session; SDK-managed, but the session handle is not exposed for cross-process resume',
};
const retryStart = t0();
const before = net.bytes;
const done = await uploadResumable(`${NS}/clip-120mb.mp4`, bigBytes);
results.steps.bigUpload = {
  wallMsTotal: ms(wall),
  wallMsResumeLeg: ms(retryStart),
  fileBytes: bigBytes.length,
  bytesOnSecondAttempt: net.bytes - before,
  bytesRetransmitted: (net.bytes - before) - 0, // second attempt restarts: all of it
  totalBytesBothAttempts: net.bytes,
  requests: net.requests,
};

// ---- 3: integrity ----
const bigUrl = await getDownloadURL(ref(storage, `${NS}/clip-120mb.mp4`));
const back = Buffer.from(await (await realFetch(bigUrl)).arrayBuffer());
const meta = await getMetadata(ref(storage, `${NS}/clip-120mb.mp4`));
results.steps.integrity = {
  sourceSha256: sha(bigBytes),
  storedSha256: sha(back),
  matches: sha(back) === sha(bigBytes),
  providerDeclaredMd5: meta.md5Hash ?? null,
  size: meta.size,
};

// ---- 4: range playback ----
await uploadResumable(`${NS}/clip-small.mp4`, smallBytes);
const smallUrl = await getDownloadURL(ref(storage, `${NS}/clip-small.mp4`));
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

// ---- 5: share link ----
results.steps.share = {
  headerlessServeStatus: (await realFetch(smallUrl)).status,
  ttlMechanism: 'getDownloadURL() returns a long-lived tokened URL; no TTL. Signed URLs with expiry exist only via the Admin SDK/GCS, not the client SDK',
  revocation: 'rotate/revoke the download token or delete the object; rules do not gate a tokened URL',
};

// ---- 6: deletion truth ----
await deleteObject(ref(storage, `${NS}/clip-small.mp4`));
const afterDelete = await realFetch(smallUrl);
results.steps.deletion = { outstandingUrlAfterDelete: afterDelete.status, referenceTracking: 'none; Firestore rows referencing the path dangle' };

// ---- 7: video metadata privacy ----
await uploadResumable(`${NS}/clip-geo.mp4`, geoBytes);
const geoUrl = await getDownloadURL(ref(storage, `${NS}/clip-geo.mp4`));
const geoBack = Buffer.from(await (await realFetch(geoUrl)).arrayBuffer());
results.steps.geoPrivacy = { digestUnchanged: sha(geoBack) === sha(geoBytes), note: 'unchanged ⇒ location metadata served verbatim (Extensions could resize images; no video metadata surface)' };

// ---- 8: limits ----
results.steps.limits = { docs: 'Firebase Storage: 5 TiB max object; resumable sessions valid 1 week; emulator posture here', emulator: 'firebase-tools emulators:start --only storage, port 9299' };

// cleanup
for (const p of [`${NS}/clip-120mb.mp4`, `${NS}/clip-geo.mp4`]) await deleteObject(ref(storage, p)).catch(() => {});
results.steps.cleanup = { note: 'emulator storage is ephemeral; arm objects deleted explicitly' };

results.finishedAt = new Date().toISOString();
await writeFile(join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
process.exit(0);

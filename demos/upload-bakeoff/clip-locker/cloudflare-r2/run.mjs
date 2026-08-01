// Clip Locker — Cloudflare R2 arm (LLP 0139 App C). The infra-style
// contender: S3-compatible multipart hand-driven, presigned GET/PUT.
// Namespace: a dedicated arm bucket, deleted at exit with absence proof.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client, CreateBucketCommand, DeleteBucketCommand, ListBucketsCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, ListPartsCommand, PutObjectCommand, GetObjectCommand,
  HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');
const cf = await readFile('/Users/ccheever/Dropbox/Startup/APIKeys/cloudflare.txt', 'utf8');
const ACCOUNT = cf.match(/Account ID\n([0-9a-f]{32})/)[1];
const ACCESS_KEY = cf.match(/Access Key ID\n([0-9a-f]{32})/)[1];
const SECRET_KEY = cf.match(/Secret Access Key\n([0-9a-f]{64})/)[1];
const NS = 'ub-c-r2-1';
const results = { arm: 'cloudflare-r2', namespace: NS, startedAt: new Date().toISOString(), steps: {} };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const t0 = () => process.hrtime.bigint();
const ms = (a) => Number((process.hrtime.bigint() - a) / 1000000n);

const bigBytes = await readFile(join(fixtures, 'clip-120mb.mp4'));
const smallBytes = await readFile(join(fixtures, 'clip-small.mp4'));
const geoBytes = await readFile(join(fixtures, 'clip-geo.mp4'));

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
});

const baseline = await s3.send(new ListBucketsCommand({}));
results.steps.baseline = { bucketCount: baseline.Buckets?.length ?? 0, namespacePresent: !!baseline.Buckets?.find((b) => b.Name === NS) };

const boot = t0();
if (!results.steps.baseline.namespacePresent) await s3.send(new CreateBucketCommand({ Bucket: NS }));
results.steps.boot = { wallMs: ms(boot), ceremony: 'S3 client config (account-scoped endpoint, region "auto"), bucket create; no server code yet' };

// ---- 1+2: multipart with a drop at ~50%, then resume from ListParts ----
const PART = 16 * 1024 * 1024;
const net = { bytes: 0, parts: 0 };
const wall = t0();
const create = await s3.send(new CreateMultipartUploadCommand({ Bucket: NS, Key: 'clip-120mb.mp4', ContentType: 'video/mp4' }));
const uploadId = create.UploadId;
const totalParts = Math.ceil(bigBytes.length / PART);
const dropAtPart = Math.ceil(totalParts / 2);
const uploaded = [];
let dropError = null;
for (let i = 1; i <= totalParts; i += 1) {
  if (i > dropAtPart) { dropError = `simulated connection drop before part ${i}`; break; }
  const body = bigBytes.subarray((i - 1) * PART, Math.min(i * PART, bigBytes.length));
  const r = await s3.send(new UploadPartCommand({ Bucket: NS, Key: 'clip-120mb.mp4', UploadId: uploadId, PartNumber: i, Body: body }));
  uploaded.push({ PartNumber: i, ETag: r.ETag });
  net.bytes += body.length; net.parts += 1;
}
const bytesBeforeDrop = net.bytes;
// The sanctioned resume: ask the service which parts it already has.
const listed = await s3.send(new ListPartsCommand({ Bucket: NS, Key: 'clip-120mb.mp4', UploadId: uploadId }));
const have = new Set((listed.Parts ?? []).map((p) => p.PartNumber));
results.steps.interrupt = {
  plannedDropAfterPart: dropAtPart,
  transferredBeforeDrop: bytesBeforeDrop,
  serverAcknowledgedParts: listed.Parts?.length ?? 0,
  error: dropError,
  resumeMechanism: 'ListParts + upload the missing part numbers (S3 multipart); requires the app to persist UploadId',
};
const resumeStart = t0();
for (let i = 1; i <= totalParts; i += 1) {
  if (have.has(i)) continue;
  const body = bigBytes.subarray((i - 1) * PART, Math.min(i * PART, bigBytes.length));
  const r = await s3.send(new UploadPartCommand({ Bucket: NS, Key: 'clip-120mb.mp4', UploadId: uploadId, PartNumber: i, Body: body }));
  uploaded.push({ PartNumber: i, ETag: r.ETag });
  net.bytes += body.length; net.parts += 1;
}
await s3.send(new CompleteMultipartUploadCommand({
  Bucket: NS, Key: 'clip-120mb.mp4', UploadId: uploadId,
  MultipartUpload: { Parts: uploaded.sort((a, b) => a.PartNumber - b.PartNumber) },
}));
results.steps.bigUpload = {
  wallMsTotal: ms(wall), wallMsResumeLeg: ms(resumeStart),
  fileBytes: bigBytes.length, bytesTransferredTotal: net.bytes,
  bytesRetransmitted: net.bytes - bigBytes.length, parts: net.parts, partSize: PART,
};

// ---- 3: integrity ----
const head = await s3.send(new HeadObjectCommand({ Bucket: NS, Key: 'clip-120mb.mp4' }));
const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: NS, Key: 'clip-120mb.mp4' }), { expiresIn: 600 });
const back = Buffer.from(await (await fetch(getUrl)).arrayBuffer());
results.steps.integrity = {
  sourceSha256: sha(bigBytes), storedSha256: sha(back), matches: sha(back) === sha(bigBytes),
  providerETag: head.ETag, note: 'multipart ETag is a composite, not a byte digest — cannot be compared to a source sha256',
};

// ---- 4: range playback ----
await s3.send(new PutObjectCommand({ Bucket: NS, Key: 'clip-small.mp4', Body: smallBytes, ContentType: 'video/mp4' }));
const smallUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: NS, Key: 'clip-small.mp4' }), { expiresIn: 600 });
const ranged = await fetch(smallUrl, { headers: { range: 'bytes=100-4099' } });
const suffix = await fetch(smallUrl, { headers: { range: 'bytes=-1024' } });
results.steps.range = {
  status: ranged.status, contentRange: ranged.headers.get('content-range'),
  bytes: (await ranged.arrayBuffer()).byteLength,
  suffixStatus: suffix.status, suffixContentRange: suffix.headers.get('content-range'),
  cacheControl: ranged.headers.get('cache-control'),
};

// ---- 5: share link TTL ----
const shortUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: NS, Key: 'clip-small.mp4' }), { expiresIn: 2 });
const fresh = await fetch(shortUrl);
await new Promise((r) => setTimeout(r, 3200));
const expired = await fetch(shortUrl);
results.steps.share = {
  headerlessServeStatus: fresh.status, afterTtlStatus: expired.status, ttlSecondsRequested: 2,
  revocation: 'no per-URL revocation; rotate credentials or delete the object (bucket is private by default — public access needs r2.dev or a custom domain)',
};

// ---- 6: deletion truth ----
const longUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: NS, Key: 'clip-small.mp4' }), { expiresIn: 600 });
await s3.send(new DeleteObjectCommand({ Bucket: NS, Key: 'clip-small.mp4' }));
const afterDelete = await fetch(longUrl);
results.steps.deletion = { outstandingSignedUrlAfterDelete: afterDelete.status, referenceTracking: 'none — object storage has no idea an app row referenced it' };

// ---- 7: video metadata privacy ----
await s3.send(new PutObjectCommand({ Bucket: NS, Key: 'clip-geo.mp4', Body: geoBytes, ContentType: 'video/mp4' }));
const geoUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: NS, Key: 'clip-geo.mp4' }), { expiresIn: 600 });
const geoBack = Buffer.from(await (await fetch(geoUrl)).arrayBuffer());
results.steps.geoPrivacy = { digestUnchanged: sha(geoBack) === sha(geoBytes), note: 'byte store: verbatim by definition; any stripping is the app’s Worker code' };

// ---- 8: limits ----
results.steps.limits = {
  docs: 'R2: 5 TiB max object, 5 GiB max part, 10,000 parts; multipart parts (except last) must be equal size; free egress',
  handBuilt: ['multipart lifecycle', 'UploadId custody', 'presign issuance service', 'auth/authorization entirely (a Worker)', 'DB linkage', 'metadata policy'],
};

// ---- cleanup with absence proof ----
const listing = await s3.send(new ListObjectsV2Command({ Bucket: NS }));
for (const o of listing.Contents ?? []) await s3.send(new DeleteObjectCommand({ Bucket: NS, Key: o.Key }));
await s3.send(new DeleteBucketCommand({ Bucket: NS }));
const after = await s3.send(new ListBucketsCommand({}));
results.steps.cleanup = {
  namespaceAbsent: !after.Buckets?.find((b) => b.Name === NS),
  bucketCountAfter: after.Buckets?.length ?? 0,
  baselineCountUnchanged: (after.Buckets?.length ?? 0) === results.steps.baseline.bucketCount,
};

results.finishedAt = new Date().toISOString();
await writeFile(join(here, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));

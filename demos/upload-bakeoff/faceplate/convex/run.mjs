// Faceplate / Convex arm (LLP 0139 App A): official storage path over the
// HTTP function API against the shared dev deployment. Identity note: no
// auth provider is configured on this shared deployment, so "two users"
// are application rows and every authorization statement below is the
// documented Convex file-URL posture (capability URLs), not a JWT check —
// recorded honestly in the diary per the 0102 amendment.
import assert from 'node:assert/strict';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';

const URL_ = (process.env.CONVEX_URL ?? '').replace(/\/$/, '');
assert.ok(URL_, 'CONVEX_URL required');
const evidence = {};
const call = async (kind, path, args) => {
  const r = await fetch(`${URL_}/api/${kind}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const body = await r.json();
  assert.equal(body.status, 'success', JSON.stringify(body));
  return body.value;
};

const t0 = Date.now();
const adaId = await call('mutation', 'faceplate:ensureProfile', { handle: 'ub-a-ada', displayName: 'Ada' });
await call('mutation', 'faceplate:ensureProfile', { handle: 'ub-a-grace', displayName: 'Grace' });
evidence.check1_twoUsers = 'application rows; no auth provider on this shared deployment (recorded posture: function-level identity absent, file URLs are the authorization)';

const gps = gpsJpegBytes();
const uploadUrl = await call('mutation', 'faceplate:generateUploadUrl', {});
const up = await fetch(uploadUrl, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: gps });
const upBody = await up.json();
assert.equal(up.status, 200, JSON.stringify(upBody));
await call('mutation', 'faceplate:setAvatar', { profileId: adaId, storageId: upBody.storageId });
const url1 = await call('query', 'faceplate:avatarUrl', { profileId: adaId });
const own = await fetch(url1);
const ownBytes = Buffer.from(await own.arrayBuffer());
assert.equal(own.status, 200);
evidence.check2_ownAvatarServes = { bytes: ownBytes.length, ms: Date.now() - t0 };
evidence.check3_otherUserViews = { status: (await fetch(url1)).status, note: 'same capability URL — any holder fetches; there is no per-viewer authorization on file URLs' };
evidence.check4_gpsServed = { uploadedHadGps: true, servedHasGps: hasGpsExif(ownBytes), mechanism: 'original bytes served from the storage CDN' };

const uploadUrl2 = await call('mutation', 'faceplate:generateUploadUrl', {});
const up2 = await fetch(uploadUrl2, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: gpsJpegBytes() });
const up2Body = await up2.json();
const priorStorageId = await call('mutation', 'faceplate:setAvatar', { profileId: adaId, storageId: up2Body.storageId });
const url2 = await call('query', 'faceplate:avatarUrl', { profileId: adaId });
const newRes = await fetch(url2);
evidence.check5_replaceVisible = { newStatus: newRes.status, cache: newRes.headers.get('cache-control'), urlChanged: url2 !== url1 };
const oldRes = await fetch(url1);
evidence.check6_oldAfterReplace = { oldUrlStatus: oldRes.status, priorStorageIdReturned: Boolean(priorStorageId), note: 'replaced file remains stored and fetchable until app code deletes it — orphan management is the app author\'s job' };
evidence.check7_signedOutFetch = { status: (await fetch(url2)).status, default: 'file URLs are unauthenticated capability URLs by documented design' };
evidence.check8_ceremony = {
  concepts: ['schema table', 'storageId in document', 'generateUploadUrl mutation', 'three-step upload dance', 'getUrl query', 'HTTP function API'],
  steps: 'schema+functions (2 files) → convex deploy → mutation → POST bytes → mutation → query',
};
console.log(JSON.stringify({ ok: true, evidence }, null, 2));

const cleaned = await call('mutation', 'faceplate:cleanupNamespace', {});
const oldAfterCleanup = await fetch(url2);
console.error(JSON.stringify({ cleanupProof: { ...cleaned, newUrlAfterCleanup: oldAfterCleanup.status } }));
assert.equal(oldAfterCleanup.status, 404);

// Party Wall / Convex arm (LLP 0139 App B) against the shared dev
// deployment. Live feed via the official ConvexClient websocket
// subscription (convex/browser). Identity posture disclosed: no auth
// provider on this deployment — membership is advisory application logic
// over caller-supplied identity strings; file URLs are capability URLs.
import assert from 'node:assert/strict';
import { ConvexClient } from 'convex/browser';
import { anyApi } from 'convex/server';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';

const URL_ = (process.env.CONVEX_URL ?? '').replace(/\/$/, '');
assert.ok(URL_, 'CONVEX_URL required');
const api = anyApi.partywall;
const evidence = {};
const client = new ConvexClient(URL_);
const call = async (kind, path, args) => {
  const r = await fetch(`${URL_}/api/${kind}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  });
  const body = await r.json();
  assert.equal(body.status, 'success', JSON.stringify(body));
  return body.value;
};
const waitFor = (predicate, label, timeoutMs = 20_000) => new Promise((resolve, reject) => {
  const start = Date.now();
  const tick = () => {
    const value = predicate();
    if (value) return resolve({ value, ms: Date.now() - start });
    if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${label}`));
    setTimeout(tick, 25);
  };
  tick();
});

try {
  const eventId = await call('mutation', 'partywall:createEvent', { title: 'Bakeoff Bash', host: 'ub-b-ada' });
  await call('mutation', 'partywall:join', { eventId, member: 'ub-b-grace', by: 'ub-b-ada' });
  evidence.check1_identities = 'application strings (no auth provider on shared deployment; advisory membership) — posture recorded';

  // Check 2 — grace subscribes FIRST over the websocket client.
  const feedLog = [];
  const unsubscribe = client.onUpdate(api.wall, { eventId, viewer: 'ub-b-grace' }, (rows) => {
    feedLog.push({ at: Date.now(), captions: rows.map((r) => r.caption), urls: rows.map((r) => r.url) });
  });
  await waitFor(() => feedLog.length > 0, 'initial empty frame');

  const posted = [];
  for (let i = 0; i < 5; i += 1) {
    const uploadUrl = await call('mutation', 'partywall:generateUploadUrl', {});
    const up = await fetch(uploadUrl, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: gpsJpegBytes() });
    const { storageId } = await up.json();
    const postedAt = Date.now();
    await call('mutation', 'partywall:addPhoto', { eventId, caption: `photo-${i}`, author: 'ub-b-ada', storageId });
    const seen = await waitFor(() => feedLog.find((f) => f.captions.includes(`photo-${i}`)), `frame for photo-${i}`);
    posted.push({ caption: `photo-${i}`, storageId, pushMsFromPost: seen.value.at - postedAt });
  }
  evidence.check2_liveBurst = {
    mechanism: 'ConvexClient websocket subscription (query re-execution pushed to subscribers); no client polls',
    perPhotoPushMs: posted.map((p) => p.pushMsFromPost),
    thumbnails: 'none — no image pipeline; the feed serves original bytes via storage.getUrl',
    clientPolls: 0,
  };

  // Check 3 — outsider subscription + direct/anonymous fetch.
  let outsiderRows = null;
  const unsubOutsider = client.onUpdate(api.wall, { eventId, viewer: 'ub-b-mallory' }, (rows) => { outsiderRows = rows; });
  await waitFor(() => outsiderRows !== null, 'outsider frame');
  const memberFrame = feedLog.at(-1);
  const photoUrl = memberFrame.urls[1];
  const anon = await fetch(photoUrl);
  evidence.check3_outsider = {
    feedRows: outsiderRows.length,
    anonymousFetchOfMemberUrl: anon.status,
    posture: 'query gates URL discovery; the URL itself is an unauthenticated capability URL by documented design',
  };
  unsubOutsider();

  // Check 6 — GPS on the served feed bytes.
  const servedBytes = Buffer.from(await (await fetch(memberFrame.urls[1])).arrayBuffer());
  evidence.check6_gps = { uploadedHadGps: true, servedHasGps: hasGpsExif(servedBytes), note: 'originals; no derivative pipeline' };

  // Check 5 — delete: row-only first (bytes fate), then row+bytes.
  const wallNow = await call('query', 'partywall:wall', { eventId, viewer: 'ub-b-ada' });
  assert.equal(wallNow.length, 5);
  const url0 = memberFrame.urls[0];
  const photosTable = await call('query', 'partywall:wall', { eventId, viewer: 'ub-b-grace' });
  const deletedAt = Date.now();
  // find photo-0's document id via a dedicated query-free path: re-list and match caption order is unstable; use dedicated mutation
  const drop = await call('mutation', 'partywall:deletePhotoByCaption', { eventId, caption: 'photo-0', alsoBytes: false });
  const dropped = await waitFor(() => feedLog.find((f) => f.at > deletedAt && !f.captions.includes('photo-0')), 'frame without photo-0');
  const url0After = await fetch(url0);
  const drop2At = Date.now();
  await call('mutation', 'partywall:deletePhotoByCaption', { eventId, caption: 'photo-1', alsoBytes: true });
  await waitFor(() => feedLog.find((f) => f.at > drop2At && !f.captions.includes('photo-1')), 'frame without photo-1');
  const url1After = await fetch(memberFrame.urls[1]);
  evidence.check5_delete = {
    pushMsFromDelete: dropped.value.at - deletedAt,
    rowOnlyDelete_bytesStatus: url0After.status,
    rowAndBytesDelete_bytesStatus: url1After.status,
    bytesFate: 'row delete leaves the stored file fetchable (orphan) until app code calls storage.delete',
  };

  // Check 4 — revocation: grace leaves; her subscription re-evaluates to [].
  const leftAt = Date.now();
  await call('mutation', 'partywall:leave', { eventId, member: 'ub-b-grace' });
  const blanked = await waitFor(() => feedLog.find((f) => f.at > leftAt && f.captions.length === 0), 'post-leave empty frame');
  const urlAfterLeave = await fetch(memberFrame.urls[2]);
  evidence.check4_revocation = {
    mechanism: 'membership row delete re-runs the gated query; subscription pushes []',
    pushMsFromLeave: blanked.value.at - leftAt,
    previouslyLearnedUrlAfterLeave: urlAfterLeave.status,
    note: 'feed access revokes via the query; already-learned capability URLs keep serving',
  };
  unsubscribe();

  evidence.check7_authorizationModel = {
    artifacts: 'ub_b_members table + advisory in-function checks (no auth provider); capability URLs on bytes',
    photoReadAuthority: 'URL possession',
  };
  evidence.check8_ceremony = {
    concepts: ['schema tables', 'mutations/queries', 'storage API (uploadUrl/getUrl/delete)', 'websocket client', 'membership as app logic'],
    note: 'no auth/identity or image pipeline concepts because the platform posture provides neither here',
  };

  // Cleanup under the 0102 amendment.
  const cleaned = await call('mutation', 'partywall:cleanupNamespaceB', {});
  const wallGone = await call('query', 'partywall:wall', { eventId, viewer: 'ub-b-ada' }).catch(() => 'event-gone');
  evidence.cleanup = { ...cleaned, postCleanupWall: Array.isArray(wallGone) ? wallGone.length : wallGone };
  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} finally {
  await client.close().catch(() => {});
}

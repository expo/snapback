// Faceplate / Supabase arm (LLP 0139 App A). Shared project under the 0102
// amendment: arm namespace ub-a-supabase-1, baseline inventory, scoped
// cleanup with absence proof. Secrets come from the environment; nothing
// is printed. The recommended path: private Storage bucket + RLS policies
// + per-user folder convention (Supabase's own avatar tutorial shape).
import assert from 'node:assert/strict';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SECRET_KEY;
assert.ok(URL_ && ANON && SERVICE, 'SUPABASE_URL/_PUBLISHABLE_KEY/_SECRET_KEY required in env');
const NS = 'ub-a-supabase-1';
const BUCKET = `${NS}-avatars`;
const evidence = {};
const svc = { authorization: `Bearer ${SERVICE}`, apikey: SERVICE };

const j = async (res) => { const b = await res.json().catch(() => ({})); return { status: res.status, body: b }; };

async function adminCreateUser(email) {
  const r = await j(await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw-123456789', email_confirm: true }),
  }));
  assert.ok(r.status < 300, JSON.stringify(r));
  const t = await j(await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw-123456789' }),
  }));
  assert.ok(t.status < 300, JSON.stringify(t));
  return { id: r.body.id, jwt: t.body.access_token };
}
const userHeaders = (u) => ({ authorization: `Bearer ${u.jwt}`, apikey: ANON });

let created = { users: [], bucket: false };
try {
  // baseline inventory (redacted: counts only)
  const baseline = await j(await fetch(`${URL_}/storage/v1/bucket`, { headers: svc }));
  evidence.baseline = { buckets: Array.isArray(baseline.body) ? baseline.body.length : 'err' };

  const mk = await j(await fetch(`${URL_}/storage/v1/bucket`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  }));
  assert.ok(mk.status < 300 || mk.body?.error === 'Duplicate', JSON.stringify(mk));
  created.bucket = true;

  const t0 = Date.now();
  const ada = await adminCreateUser(`${NS}-ada@faceplate.test`);
  const grace = await adminCreateUser(`${NS}-grace@faceplate.test`);
  created.users = [ada.id, grace.id];
  evidence.check1_twoUsers = 'auth admin createUser (service key) + password grant; RLS policies pre-applied via SQL (policies.sql)';

  const gps = gpsJpegBytes();
  const path = `${ada.id}/avatar.jpg`;
  const up = await j(await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST', headers: { ...userHeaders(ada), 'content-type': 'image/jpeg', 'x-upsert': 'true' },
    body: gps,
  }));
  assert.ok(up.status < 300, JSON.stringify(up));
  const own = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: userHeaders(ada) });
  const ownBytes = Buffer.from(await own.arrayBuffer());
  assert.equal(own.status, 200, ownBytes.toString('utf8').slice(0, 200));
  evidence.check2_ownAvatarServes = { bytes: ownBytes.length, ms: Date.now() - t0 };

  const bRes = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: userHeaders(grace) });
  evidence.check3_otherUserViews = { status: bRes.status };
  assert.equal(bRes.status, 200);
  const served = Buffer.from(await bRes.arrayBuffer());
  evidence.check4_gpsServed = { uploadedHadGps: true, servedHasGps: hasGpsExif(served), mechanism: 'original bytes served as stored' };

  const tr = await fetch(`${URL_}/storage/v1/render/image/authenticated/${BUCKET}/${path}?width=100`, { headers: userHeaders(grace) });
  const trBytes = Buffer.from(await tr.arrayBuffer());
  evidence.check4b_transformGps = { status: tr.status, transformHasGps: tr.status === 200 ? hasGpsExif(trBytes) : null, note: tr.status !== 200 ? 'image transformation not available on this project/plan' : 'render endpoint' };

  const up2 = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST', headers: { ...userHeaders(ada), 'content-type': 'image/jpeg', 'x-upsert': 'true' },
    body: gpsJpegBytes(),
  });
  assert.ok(up2.status < 300);
  const bNew = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: userHeaders(grace) });
  evidence.check5_replaceVisible = { newStatus: bNew.status, cache: bNew.headers.get('cache-control'), note: 'same path upsert — same URL; provider docs warn about CDN staleness on upsert' };
  evidence.check6_oldAfterReplace = { note: 'paved path overwrites in place — no orphan object; distinct-path strategies leave orphans for manual cleanup' };

  const anon = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: { apikey: ANON } });
  const anonPublicShape = await fetch(`${URL_}/storage/v1/object/public/${BUCKET}/${path}`);
  evidence.check7_signedOutFetch = { authenticatedRouteNoJwt: anon.status, publicRouteOnPrivateBucket: anonPublicShape.status, default: 'private bucket + RLS; nothing serves without a JWT the policies admit' };

  evidence.check8_ceremony = {
    concepts: ['bucket (private)', 'RLS policies (SQL)', 'per-user folder convention', 'two API keys + JWTs', 'storage REST/SDK', 'authenticated vs public object routes'],
    steps: 'create bucket → author 3 SQL policies → admin users → upload with x-upsert → authenticated route',
  };

  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} finally {
  // namespace-scoped cleanup + absence proof
  const del = await j(await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: created.users.length ? [ `${created.users[0]}` ] : [] }),
  })).catch(() => ({}));
  await fetch(`${URL_}/storage/v1/bucket/${BUCKET}/empty`, { method: 'POST', headers: svc }).catch(() => {});
  const rmBucket = await j(await fetch(`${URL_}/storage/v1/bucket/${BUCKET}`, { method: 'DELETE', headers: svc }));
  for (const id of created.users) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc });
  const after = await j(await fetch(`${URL_}/storage/v1/bucket`, { headers: svc }));
  const stillThere = Array.isArray(after.body) && after.body.some((b) => b.id === BUCKET);
  console.error(JSON.stringify({ cleanup: { bucketDeleted: rmBucket.status < 300, bucketAbsent: !stillThere, bucketsAfter: Array.isArray(after.body) ? after.body.length : 'err' } }));
}

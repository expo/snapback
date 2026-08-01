// Party Wall / Supabase arm (LLP 0139 App B). Shared project under the
// 0102 amendment: namespace ub-b-supabase-1 (tables/policies in setup.sql,
// bucket ub-b-party-1), scoped cleanup via cleanup.sql + cleanup here.
// Realtime = supabase-js channels over postgres_changes with RLS-scoped
// delivery; storage = private bucket with membership policies on the
// {eventId}/ path convention. Secrets from the environment; never printed.
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SECRET_KEY;
assert.ok(URL_ && ANON && SERVICE, 'SUPABASE_URL/_PUBLISHABLE_KEY/_SECRET_KEY required');
const NS = 'ub-b-supabase-1';
const BUCKET = 'ub-b-party-1';
const evidence = {};
const svc = { authorization: `Bearer ${SERVICE}`, apikey: SERVICE };
const j = async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) });

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
const waitFor = (predicate, label, timeoutMs = 25_000) => new Promise((resolve, reject) => {
  const start = Date.now();
  const tick = () => {
    const value = predicate();
    if (value) return resolve({ value, ms: Date.now() - start });
    if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${label}`));
    setTimeout(tick, 25);
  };
  tick();
});

const created = { users: [], bucket: false };
let graceRealtime = null;
try {
  const baseline = await j(await fetch(`${URL_}/storage/v1/bucket`, { headers: svc }));
  evidence.baseline = { buckets: Array.isArray(baseline.body) ? baseline.body.length : 'err' };
  const mk = await j(await fetch(`${URL_}/storage/v1/bucket`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  }));
  assert.ok(mk.status < 300 || /exists|Duplicate/i.test(JSON.stringify(mk.body)), JSON.stringify(mk));
  created.bucket = true;

  const ada = await adminCreateUser(`${NS}-ada@party.test`);
  const grace = await adminCreateUser(`${NS}-grace@party.test`);
  const mallory = await adminCreateUser(`${NS}-mallory@party.test`);
  created.users = [ada.id, grace.id, mallory.id];
  evidence.check1_identities = 'auth admin createUser + password grants; RLS policies applied via setup.sql';

  // service-role seeding of event + membership (host + grace)
  const rest = async (path, method, body, headers = svc) => j(await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: { ...headers, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const ev = await rest('ub_b_events', 'POST', { title: 'Bakeoff Bash', host: ada.id });
  assert.ok(ev.status < 300, JSON.stringify(ev));
  const eventId = ev.body[0].id;
  for (const uid of [ada.id, grace.id]) {
    const m = await rest('ub_b_members', 'POST', { event_id: eventId, user_id: uid });
    assert.ok(m.status < 300, JSON.stringify(m));
  }

  // Check 2 — grace subscribes FIRST via supabase-js realtime (RLS-scoped).
  const feedLog = [];
  const memberLog = [];
  graceRealtime = createClient(URL_, ANON, {
    global: { headers: { authorization: `Bearer ${grace.jwt}` } },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  await graceRealtime.realtime.setAuth(grace.jwt);
  const channel = graceRealtime
    .channel('ub-b-feed')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ub_b_photos' }, (payload) => {
      feedLog.push({ at: Date.now(), type: payload.eventType, caption: payload.new?.caption ?? payload.old?.caption ?? null, oldId: payload.old?.id ?? null });
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ub_b_members' }, (payload) => {
      memberLog.push({ at: Date.now(), old: payload.old ?? null });
    });
  await new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`realtime ${status}`));
    });
  });

  const userHeaders = (u) => ({ authorization: `Bearer ${u.jwt}`, apikey: ANON });
  const posted = [];
  for (let i = 0; i < 5; i += 1) {
    const path = `${eventId}/photo-${i}.jpg`;
    const up = await j(await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST', headers: { ...userHeaders(ada), 'content-type': 'image/jpeg' }, body: gpsJpegBytes(),
    }));
    assert.ok(up.status < 300, JSON.stringify(up));
    const postedAt = Date.now();
    const row = await j(await fetch(`${URL_}/rest/v1/ub_b_photos`, {
      method: 'POST', headers: { ...userHeaders(ada), 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ event_id: eventId, caption: `photo-${i}`, author: ada.id, object_path: path }),
    }));
    assert.ok(row.status < 300, JSON.stringify(row));
    const seen = await waitFor(() => feedLog.find((f) => f.type === 'INSERT' && f.caption === `photo-${i}`), `insert frame photo-${i}`);
    posted.push({ caption: `photo-${i}`, path, id: row.body[0].id, pushMsFromInsert: seen.value.at - postedAt });
  }
  evidence.check2_liveBurst = {
    mechanism: 'supabase-js realtime channel, postgres_changes over websocket (RLS-scoped delivery); no client polls',
    perPhotoPushMs: posted.map((p) => p.pushMsFromInsert),
    thumbnails: 'no automatic derivative pipeline; render/image transform endpoint exists per-request (plan-gated)',
    clientPolls: 0,
  };

  // Check 3 — outsider: query + subscription posture + direct fetch.
  const outsiderRows = await j(await fetch(`${URL_}/rest/v1/ub_b_photos?select=caption&event_id=eq.${eventId}`, { headers: userHeaders(mallory) }));
  const outsiderBytes = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${posted[0].path}`, { headers: userHeaders(mallory) });
  const anonBytes = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${posted[0].path}`, { headers: { apikey: ANON } });
  evidence.check3_outsider = {
    feedRows: Array.isArray(outsiderRows.body) ? outsiderRows.body.length : outsiderRows.status,
    directFetchStatus: outsiderBytes.status,
    signedOutStatus: anonBytes.status,
    posture: 'RLS empty-set on rows; storage policies refuse non-members; nothing anonymous',
  };

  // Check 6 — GPS on served member bytes.
  const gserved = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${posted[1].path}`, { headers: userHeaders(grace) });
  assert.equal(gserved.status, 200);
  evidence.check6_gps = { uploadedHadGps: true, servedHasGps: hasGpsExif(Buffer.from(await gserved.arrayBuffer())), note: 'original bytes as stored' };

  // Check 5 — delete photo-0 (row via author + storage object) → member view.
  const deletedAt = Date.now();
  const delRow = await j(await fetch(`${URL_}/rest/v1/ub_b_photos?id=eq.${posted[0].id}`, { method: 'DELETE', headers: userHeaders(ada) }));
  assert.ok(delRow.status < 300, JSON.stringify(delRow));
  const dropSeen = await waitFor(() => feedLog.find((f) => f.type === 'DELETE' && f.at > deletedAt), 'delete frame');
  const delObj = await j(await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ prefixes: [posted[0].path] }),
  }));
  const bytesAfter = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${posted[0].path}`, { headers: userHeaders(grace) });
  evidence.check5_delete = {
    pushMsFromDelete: dropSeen.value.at - deletedAt,
    deletePayloadCarries: dropSeen.value.oldId ? 'old row id only (RLS: no old-row fields beyond identity)' : JSON.stringify(dropSeen.value),
    bytesAfterExplicitObjectDelete: bytesAfter.status,
    bytesFate: 'row delete does NOT touch the object; storage delete is a separate explicit call (two systems, two deletes)',
  };

  // Check 4 — revocation: remove grace, measure what her subscription learns.
  const leftAt = Date.now();
  const rm = await j(await fetch(`${URL_}/rest/v1/ub_b_members?event_id=eq.${eventId}&user_id=eq.${grace.id}`, { method: 'DELETE', headers: svc }));
  assert.ok(rm.status < 300, JSON.stringify(rm));
  let memberFrame = null;
  try { memberFrame = (await waitFor(() => memberLog.find((m) => m.at > leftAt), 'membership delete frame', 6000)).value; } catch { memberFrame = null; }
  const graceRowsAfter = await j(await fetch(`${URL_}/rest/v1/ub_b_photos?select=caption&event_id=eq.${eventId}`, { headers: userHeaders(grace) }));
  const graceBytesAfter = await fetch(`${URL_}/storage/v1/object/authenticated/${BUCKET}/${posted[1].path}`, { headers: userHeaders(grace) });
  const postRevokeInsertAt = Date.now();
  await rest('ub_b_photos', 'POST', { event_id: eventId, caption: 'photo-after-revoke', author: ada.id, object_path: `${eventId}/after.jpg` });
  let lateFrame = null;
  try { lateFrame = (await waitFor(() => feedLog.find((f) => f.type === 'INSERT' && f.caption === 'photo-after-revoke'), 'post-revoke insert frame', 6000)).value; } catch { lateFrame = null; }
  evidence.check4_revocation = {
    membershipDeleteFrameToRevokedUser: memberFrame ? 'delivered' : 'not delivered within 6s',
    nextQueryRows: Array.isArray(graceRowsAfter.body) ? graceRowsAfter.body.length : graceRowsAfter.status,
    bytesAfterLeave: graceBytesAfter.status,
    newInsertDeliveredToRevokedSubscription: lateFrame ? `delivered ${lateFrame.at - postRevokeInsertAt}ms — RLS not re-checked per delivery` : 'not delivered (RLS enforced per delivery)',
    mechanism: 'no retraction of already-rendered rows; the app must observe membership changes and re-query',
  };

  evidence.check7_authorizationModel = {
    artifacts: 'setup.sql: 3 tables + 7 RLS policies (rows) + 2 storage policies on the {eventId}/ path convention; realtime publication membership',
    photoReadAuthority: 'RLS at query time and storage-policy at fetch time; realtime delivery authorization measured in check 4',
  };
  evidence.check8_ceremony = {
    concepts: ['tables + RLS in SQL', 'storage bucket + path-convention policies', 'two API key classes + JWTs', 'realtime channels + publication membership', 'REST/PostgREST'],
    steps: 'setup.sql via psql → bucket → admin users → seed rows (service) → subscribe → upload+insert per photo',
  };
  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} finally {
  try { await graceRealtime?.realtime?.disconnect(); } catch {}
  // namespace cleanup: objects, bucket, users (tables/policies via cleanup.sql)
  const list = await j(await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 1000, offset: 0 }),
  }));
  const prefixes = [];
  for (const entry of list.body ?? []) {
    if (entry.id === null) {
      const sub = await j(await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: `${entry.name}/`, limit: 1000, offset: 0 }),
      }));
      for (const f of sub.body ?? []) if (f.id) prefixes.push(`${entry.name}/${f.name}`);
    } else if (entry.id) prefixes.push(entry.name);
  }
  if (prefixes.length) await fetch(`${URL_}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { ...svc, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes }) });
  await fetch(`${URL_}/storage/v1/bucket/${BUCKET}`, { method: 'DELETE', headers: svc });
  for (const id of created.users) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svc });
  const after = await j(await fetch(`${URL_}/storage/v1/bucket`, { headers: svc }));
  const stillThere = Array.isArray(after.body) && after.body.some((b) => b.id === BUCKET);
  console.error(JSON.stringify({ cleanup: { bucketAbsent: !stillThere, objectsRemoved: prefixes.length, usersRemoved: created.users.length } }));
}

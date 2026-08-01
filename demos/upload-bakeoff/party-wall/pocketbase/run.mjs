// Party Wall / PocketBase arm (LLP 0139 App B). Single binary (reused from
// the App A arm dir, version recorded there), ephemeral data dir. Feed
// liveness via the official SSE realtime API with per-delivery rule checks;
// membership via a relation collection and @collection rules; files are
// PocketBase's default public-by-URL posture, recorded.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', '..', 'faceplate', 'pocketbase', 'pocketbase');
const PORT = 8800 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${PORT}`;
const evidence = {};
let proc = null;
let sse = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = (predicate, label, timeoutMs = 15_000) => new Promise((resolve, reject) => {
  const start = Date.now();
  const tick = () => {
    const value = predicate();
    if (value) return resolve({ value, ms: Date.now() - start });
    if (Date.now() - start > timeoutMs) return reject(new Error(`timeout: ${label}`));
    setTimeout(tick, 20);
  };
  tick();
});

async function startSse(headers) {
  const events = [];
  const controller = new AbortController();
  const res = await fetch(`${base}/api/realtime`, { headers: { accept: 'text/event-stream', ...headers }, signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let clientId = null;
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
          const ev = { at: Date.now() };
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) ev.event = line.slice(6).trim();
            if (line.startsWith('data:')) ev.data = line.slice(5).trim();
          }
          if (ev.event === 'PB_CONNECT') clientId = JSON.parse(ev.data).clientId;
          events.push(ev);
        }
      }
    } catch { /* aborted */ }
  })();
  await waitFor(() => clientId, 'PB_CONNECT');
  return { events, clientId: () => clientId, close: () => controller.abort() };
}

try {
  const dataDir = await mkdtemp(join(tmpdir(), 'party-wall-pb-'));
  await new Promise((res, rej) => {
    const p = spawn(BIN, ['superuser', 'upsert', 'admin@party.test', 'admin-password-123', '--dir', dataDir, '--migrationsDir', join(dataDir, 'migrations')], { stdio: 'ignore' });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`superuser exit ${c}`))));
  });
  proc = spawn(BIN, ['serve', `--http=127.0.0.1:${PORT}`, '--dir', dataDir, '--migrationsDir', join(dataDir, 'migrations')], { stdio: 'ignore' });
  let healthy = false;
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) { healthy = true; break; } } catch {} await sleep(250); }
  assert.ok(healthy, `pocketbase never became healthy on ${base}`);

  const adminAuth = await (await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: 'admin@party.test', password: 'admin-password-123' }),
  })).json();
  const admin = { authorization: adminAuth.token };

  // Collections. Membership gate expressed once per rule via @collection.
  const memberRule = '@collection.ub_b_members.event ?= event && @collection.ub_b_members.member ?= @request.auth.id';
  const mkCollection = async (spec) => {
    const r = await fetch(`${base}/api/collections`, {
      method: 'POST', headers: { ...admin, 'content-type': 'application/json' },
      body: JSON.stringify(spec),
    });
    const body = await r.json();
    assert.ok(r.status < 300, `${spec.name}: ${JSON.stringify(body)}`);
    return body;
  };
  const events_ = await mkCollection({
    name: 'ub_b_events', type: 'base',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'host', type: 'relation', collectionId: '_pb_users_auth_', maxSelect: 1, required: true },
    ],
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  });
  const members = await mkCollection({
    name: 'ub_b_members', type: 'base',
    fields: [
      { name: 'event', type: 'relation', collectionId: events_.id, maxSelect: 1, required: true },
      { name: 'member', type: 'relation', collectionId: '_pb_users_auth_', maxSelect: 1, required: true },
    ],
    listRule: 'member = @request.auth.id', viewRule: 'member = @request.auth.id',
    createRule: null, updateRule: null, deleteRule: null,
  });
  await mkCollection({
    name: 'ub_b_photos', type: 'base',
    fields: [
      { name: 'event', type: 'relation', collectionId: events_.id, maxSelect: 1, required: true },
      { name: 'caption', type: 'text', required: true },
      { name: 'author', type: 'relation', collectionId: '_pb_users_auth_', maxSelect: 1, required: true },
      { name: 'photo', type: 'file', maxSelect: 1, maxSize: 5_000_000, mimeTypes: ['image/jpeg', 'image/png'] },
    ],
    listRule: memberRule, viewRule: memberRule,
    createRule: `author = @request.auth.id && ${memberRule}`,
    deleteRule: 'author = @request.auth.id',
    updateRule: null,
  });

  const mkUser = async (email) => {
    const r = await fetch(`${base}/api/collections/users/records`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'pw-123456789', passwordConfirm: 'pw-123456789' }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    const auth = await (await fetch(`${base}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: email, password: 'pw-123456789' }),
    })).json();
    return { id: body.id, headers: { authorization: auth.token } };
  };
  const ada = await mkUser('ada@party.test');
  const grace = await mkUser('grace@party.test');
  const mallory = await mkUser('mallory@party.test');
  evidence.check1_identities = 'ordinary auth records + token auth; superuser only for collection bootstrap';

  const mkRecord = async (collection, headers, body) => {
    const r = await fetch(`${base}/api/collections/${collection}/records`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const parsed = await r.json();
    assert.ok(r.status < 300, `${collection}: ${JSON.stringify(parsed)}`);
    return parsed;
  };
  const event = await mkRecord('ub_b_events', admin, { title: 'Bakeoff Bash', host: ada.id });
  await mkRecord('ub_b_members', admin, { event: event.id, member: ada.id });
  await mkRecord('ub_b_members', admin, { event: event.id, member: grace.id });

  // Check 2 — grace subscribes FIRST over SSE with her auth.
  sse = await startSse(grace.headers);
  const sub = await fetch(`${base}/api/realtime`, {
    method: 'POST', headers: { ...grace.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: sse.clientId(), subscriptions: ['ub_b_photos'] }),
  });
  assert.equal(sub.status, 204, String(sub.status));
  const feedEvents = () => sse.events.filter((e) => e.event === 'ub_b_photos').map((e) => ({ at: e.at, ...JSON.parse(e.data) }));

  const posted = [];
  for (let i = 0; i < 5; i += 1) {
    const form = new FormData();
    form.append('event', event.id);
    form.append('caption', `photo-${i}`);
    form.append('author', ada.id);
    form.append('photo', new Blob([gpsJpegBytes()], { type: 'image/jpeg' }), `photo-${i}.jpg`);
    const postedAt = Date.now();
    const r = await fetch(`${base}/api/collections/ub_b_photos/records`, { method: 'POST', headers: ada.headers, body: form });
    const rec = await r.json();
    assert.ok(r.status < 300, JSON.stringify(rec));
    const seen = await waitFor(
      () => feedEvents().find((e) => e.action === 'create' && e.record?.caption === `photo-${i}`),
      `sse create for photo-${i}`,
    );
    posted.push({ caption: `photo-${i}`, id: rec.id, file: rec.photo, pushMsFromPost: seen.value.at - postedAt });
  }
  evidence.check2_liveBurst = {
    mechanism: 'official SSE realtime (per-delivery rule checks); no client polls',
    perPhotoPushMs: posted.map((p) => p.pushMsFromPost),
    thumbnails: 'on-the-fly ?thumb=WxH re-encode per request (no pre-declaration)',
    clientPolls: 0,
  };

  // Check 3 — outsider list + subscription + direct/anon file URL.
  const outsiderList = await (await fetch(`${base}/api/collections/ub_b_photos/records?filter=${encodeURIComponent(`event='${event.id}'`)}`, { headers: mallory.headers })).json();
  const fileUrl = (p) => `${base}/api/files/ub_b_photos/${p.id}/${p.file}`;
  const anonFile = await fetch(fileUrl(posted[0]));
  evidence.check3_outsider = {
    feedRows: outsiderList.totalItems ?? outsiderList.items?.length ?? 'err',
    signedOutFileStatus: anonFile.status,
    posture: 'rules gate records; files are public-by-URL by default (protected flag exists, opt-in per field)',
  };

  // Check 6 — GPS on the served ORIGINAL and on the thumb.
  const orig = Buffer.from(await (await fetch(fileUrl(posted[1]))).arrayBuffer());
  const thumbRes = await fetch(`${fileUrl(posted[1])}?thumb=100x100`);
  const thumb = Buffer.from(await thumbRes.arrayBuffer());
  evidence.check6_gps = { originalHasGps: hasGpsExif(orig), thumbHasGps: thumbRes.status === 200 ? hasGpsExif(thumb) : null };

  // Check 5 — author deletes photo-0 → SSE delete + file fate.
  const deletedAt = Date.now();
  const del = await fetch(`${base}/api/collections/ub_b_photos/records/${posted[0].id}`, { method: 'DELETE', headers: ada.headers });
  assert.equal(del.status, 204);
  const dropSeen = await waitFor(() => feedEvents().find((e) => e.action === 'delete' && e.record?.id === posted[0].id), 'sse delete');
  const fileAfter = await fetch(fileUrl(posted[0]));
  evidence.check5_delete = {
    pushMsFromDelete: dropSeen.value.at - deletedAt,
    bytesAfter: fileAfter.status,
    bytesFate: 'record delete removes the stored file with it — URL 404s',
  };

  // Check 4 — revocation: remove grace's membership; probe her live lane.
  const graceMembership = await (await fetch(`${base}/api/collections/ub_b_members/records?filter=${encodeURIComponent(`event='${event.id}' && member='${grace.id}'`)}`, { headers: admin })).json();
  const leftAt = Date.now();
  await fetch(`${base}/api/collections/ub_b_members/records/${graceMembership.items[0].id}`, { method: 'DELETE', headers: admin });
  const afterCount = feedEvents().length;
  const probe = new FormData();
  probe.append('event', event.id); probe.append('caption', 'photo-after-revoke'); probe.append('author', ada.id);
  probe.append('photo', new Blob([gpsJpegBytes()], { type: 'image/jpeg' }), 'after.jpg');
  await fetch(`${base}/api/collections/ub_b_photos/records`, { method: 'POST', headers: ada.headers, body: probe });
  let lateDelivery = null;
  try { lateDelivery = (await waitFor(() => feedEvents().slice(afterCount).find((e) => e.record?.caption === 'photo-after-revoke'), 'post-revoke sse', 5000)).value; } catch { lateDelivery = null; }
  const graceList = await (await fetch(`${base}/api/collections/ub_b_photos/records?filter=${encodeURIComponent(`event='${event.id}'`)}`, { headers: grace.headers })).json();
  const graceFile = await fetch(fileUrl(posted[1]), { headers: grace.headers });
  evidence.check4_revocation = {
    newEventToRevokedSubscription: lateDelivery ? `delivered ${lateDelivery.at - leftAt}ms — rules NOT re-checked per delivery` : 'not delivered (rules re-checked per delivery)',
    nextQueryRows: graceList.totalItems ?? graceList.items?.length ?? 'err',
    fileUrlAfterLeave: graceFile.status,
    mechanism: 'no retraction of rendered rows; file URLs remain public regardless of membership',
  };

  evidence.check7_authorizationModel = {
    artifacts: '@collection membership rule on list/view/create + author-only delete; membership relation collection; files outside the rule system (public URL)',
    photoReadAuthority: 'record rules for metadata; URL possession for bytes',
  };
  evidence.check8_ceremony = {
    concepts: ['collections + rule expressions', 'relation fields', 'SSE realtime + subscriptions', 'file field + URL/thumb params', 'superuser vs user auth'],
    steps: 'binary → superuser → 3 collections via admin API → users → subscribe → multipart create per photo',
  };
  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
} finally {
  sse?.close?.();
  proc?.kill('SIGTERM');
}

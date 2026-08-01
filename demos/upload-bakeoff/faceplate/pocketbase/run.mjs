// Faceplate / PocketBase arm (LLP 0139 App A). Official single-binary path:
// the default `users` auth collection already ships an `avatar` file field —
// PocketBase's own paved avatar pattern. Headless driver against a local
// instance on an ephemeral data dir.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gpsJpegBytes, hasGpsExif } from '../../_shared/gps-jpeg.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8791;
const base = `http://127.0.0.1:${PORT}`;
const evidence = {};
let proc = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fileForm(fields, fileField, bytes, filename) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append(fileField, new Blob([bytes], { type: 'image/jpeg' }), filename);
  return form;
}

try {
  const dataDir = await mkdtemp(join(tmpdir(), 'faceplate-pb-'));
  // superuser for bootstrap only (app users are ordinary auth records)
  await new Promise((res, rej) => {
    const p = spawn(join(here, 'pocketbase'), ['superuser', 'upsert', 'admin@faceplate.test', 'admin-password-123', '--dir', dataDir], { stdio: 'ignore' });
    p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`superuser exit ${c}`))));
  });
  proc = spawn(join(here, 'pocketbase'), ['serve', `--http=127.0.0.1:${PORT}`, '--dir', dataDir], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {} await sleep(250); }

  const t0 = Date.now();
  const mkUser = async (email) => {
    const r = await fetch(`${base}/api/collections/users/records`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'pw-123456789', passwordConfirm: 'pw-123456789' }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    const auth = await fetch(`${base}/api/collections/users/auth-with-password`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: email, password: 'pw-123456789' }),
    });
    const authBody = await auth.json();
    assert.equal(auth.status, 200, JSON.stringify(authBody));
    return { id: body.id, token: authBody.token };
  };
  const ada = await mkUser('ada@faceplate.test');
  const grace = await mkUser('grace@faceplate.test');
  evidence.check1_twoUsers = 'default users auth collection, email+password, token auth';

  const gps = gpsJpegBytes();
  const up = await fetch(`${base}/api/collections/users/records/${ada.id}`, {
    method: 'PATCH', headers: { authorization: ada.token },
    body: fileForm({}, 'avatar', gps, 'me.jpg'),
  });
  const upBody = await up.json();
  assert.equal(up.status, 200, JSON.stringify(upBody));
  const avatarUrl = `${base}/api/files/users/${ada.id}/${upBody.avatar}`;
  const own = await fetch(avatarUrl, { headers: { authorization: ada.token } });
  assert.equal(own.status, 200);
  evidence.check2_ownAvatarServes = { bytes: (await own.arrayBuffer()).byteLength, ms: Date.now() - t0 };

  const bRes = await fetch(avatarUrl, { headers: { authorization: grace.token } });
  evidence.check3_otherUserViews = { status: bRes.status };
  const served = Buffer.from(await bRes.arrayBuffer());
  evidence.check4_gpsServed = { uploadedHadGps: true, servedHasGps: hasGpsExif(served), mechanism: 'original bytes served as stored; no EXIF processing on the original' };
  const thumb = await fetch(`${avatarUrl}?thumb=100x100`);
  const thumbBytes = Buffer.from(await thumb.arrayBuffer());
  evidence.check4b_thumbGps = { status: thumb.status, thumbHasGps: hasGpsExif(thumbBytes) };

  const up2 = await fetch(`${base}/api/collections/users/records/${ada.id}`, {
    method: 'PATCH', headers: { authorization: ada.token },
    body: fileForm({}, 'avatar', gpsJpegBytes(), 'me2.jpg'),
  });
  const up2Body = await up2.json();
  assert.equal(up2.status, 200);
  const newUrl = `${base}/api/files/users/${ada.id}/${up2Body.avatar}`;
  const bNew = await fetch(newUrl, { headers: { authorization: grace.token } });
  evidence.check5_replaceVisible = { newStatus: bNew.status, cache: bNew.headers.get('cache-control') };
  const bOld = await fetch(avatarUrl);
  evidence.check6_oldAfterReplace = { oldUrlStatus: bOld.status, note: 'PocketBase deletes the replaced file from disk' };

  const anon = await fetch(newUrl);
  evidence.check7_signedOutFetch = { status: anon.status, default: 'files are public-by-URL unless the field is marked protected (then short-lived file tokens)' };

  evidence.check8_ceremony = {
    concepts: ['auth collection (built-in)', 'file field (built-in avatar)', 'multipart record write', 'file URL scheme', 'thumb param'],
    steps: 'download binary → superuser upsert → serve → REST only; zero authored backend files',
  };
  console.log(JSON.stringify({ ok: true, evidence }, null, 2));
  await rm(dataDir, { recursive: true, force: true });
} finally {
  if (proc) proc.kill();
}

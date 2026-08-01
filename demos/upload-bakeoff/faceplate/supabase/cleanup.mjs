// ub-a-supabase-1 namespace cleanup with absence proof (0102 amendment).
import assert from 'node:assert/strict';
const URL_ = process.env.SUPABASE_URL, SERVICE = process.env.SUPABASE_SECRET_KEY;
const NS = 'ub-a-supabase-1', BUCKET = `${NS}-avatars`;
const svc = { authorization: `Bearer ${SERVICE}`, apikey: SERVICE };
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });

// objects
const list = await j(await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
  method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
  body: JSON.stringify({ prefix: '', limit: 1000, offset: 0 }),
}));
let objectPaths = [];
if (list.status === 200 && Array.isArray(list.body)) {
  for (const entry of list.body) {
    if (entry.id === null) { // folder — list within
      const sub = await j(await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST', headers: { ...svc, 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: `${entry.name}/`, limit: 1000, offset: 0 }),
      }));
      for (const f of sub.body ?? []) if (f.id) objectPaths.push(`${entry.name}/${f.name}`);
    } else objectPaths.push(entry.name);
  }
  if (objectPaths.length) {
    const del = await j(await fetch(`${URL_}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers: { ...svc, 'content-type': 'application/json' },
      body: JSON.stringify({ prefixes: objectPaths }),
    }));
    console.error('objects deleted:', objectPaths.length, del.status);
  }
}
const rmB = await j(await fetch(`${URL_}/storage/v1/bucket/${BUCKET}`, { method: 'DELETE', headers: svc }));
// users in the namespace (paginate first page; our emails are prefixed)
const users = await j(await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, { headers: svc }));
const mine = (users.body.users ?? []).filter((u) => (u.email ?? '').startsWith(`${NS}-`));
for (const u of mine) await fetch(`${URL_}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: svc });
// absence proof
const after = await j(await fetch(`${URL_}/storage/v1/bucket`, { headers: svc }));
const usersAfter = await j(await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, { headers: svc }));
const proof = {
  bucketDeleteStatus: rmB.status,
  bucketAbsent: !(after.body ?? []).some((b) => b.id === BUCKET),
  bucketsRemaining: (after.body ?? []).length,
  nsUsersDeleted: mine.length,
  nsUsersRemaining: (usersAfter.body.users ?? []).filter((u) => (u.email ?? '').startsWith(`${NS}-`)).length,
};
console.log(JSON.stringify({ cleanupProof: proof }));
assert.equal(proof.bucketAbsent, true);
assert.equal(proof.nsUsersRemaining, 0);

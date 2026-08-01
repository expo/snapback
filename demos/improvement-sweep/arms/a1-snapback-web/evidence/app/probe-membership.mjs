// Probe: declarative membership-gated live query — filter or refusal for a
// non-member? (Stop-class if it discloses rows.)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@expo/snapback-client';
import api from './snapback/generated/api.mjs';

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}
rmSync(readyFile, { force: true });
const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'],
  { cwd: root, stdio: ['pipe', 'ignore', 'ignore'] });
let ready = null;
for (let i = 0; i < 300 && !ready; i += 1) {
  await sleep(100);
  if (existsSync(readyFile)) { try { ready = JSON.parse(readFileSync(readyFile, 'utf8')); } catch {} }
}
await sleep(1500);
const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
const headers = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
async function signIn(email) {
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
    method: 'POST', headers, body: JSON.stringify({ email }) }).then((r) => r.json());
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
  ).then((r) => r.json());
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
    method: 'POST', headers, body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
  }).then((r) => r.json());
  return { client: new SnapbackClient(ready.serverUrl, { bearerToken: credential.token, authClientProtocol: 1, rqsStore: null }), userId: credential.session.userId };
}
const alice = await signIn('alice@probe.test');
const mallory = await signIn('mallory@probe.test');
const ws = (await alice.client.mutate(api.createWorkspace, { args: { name: 'probe' } })).result;
await alice.client.mutate(api.createRecord, { args: {
  workspaceId: ws, title: 'SECRET probe record', assigneeId: alice.userId,
  assigneeName: 'Alice', dueAt: 1, position: 1000, clientKey: 'p1' } });
const aliceView = await alice.client.query(api.listRecords, { args: { workspaceId: ws } });
console.log('alice rows:', aliceView.rows.length);
try {
  const malloryView = await mallory.client.query(api.listRecords, { args: { workspaceId: ws } });
  console.log('MALLORY RESOLVED rows:', malloryView.rows.length,
    JSON.stringify(malloryView.rows.map((r) => r.title)));
} catch (err) {
  console.log('mallory refused:', err?.diagnostic?.code ?? err?.message);
}
try {
  const h = await mallory.client.liveQuery(api.listRecords, {
    args: { workspaceId: ws }, connectionId: 'm', transport: 'stream' });
  console.log('MALLORY SUBSCRIBE RESOLVED rows:', h.rows.length);
  await h.dispose();
} catch (err) {
  console.log('mallory subscribe refused:', err?.diagnostic?.code ?? err?.message);
}
child.stdin.end();
await sleep(1000);
process.exit(0);

// Probe: upload an asset (authenticated raw lifecycle), then inspect what
// ctx.assets.attach returns and whether an admitted insert commits.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
  method: 'POST', headers, body: JSON.stringify({ email: 'alice@probe.test' }) }).then((r) => r.json());
const mailbox = await fetch(
  `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
  { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
).then((r) => r.json());
const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
  method: 'POST', headers, body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
}).then((r) => r.json());
const token = credential.token;
const client = new SnapbackClient(ready.serverUrl, { bearerToken: token, authClientProtocol: 1, rqsStore: null });

const content = '%PDF-1.4\nprobe attach\n%%EOF\n';
const bytes = new TextEncoder().encode(content);
const authed = { authorization: `Bearer ${token}`, ...headers };
const created = await fetch(`${ready.serverUrl}/assets/attempts`, {
  method: 'POST', headers: authed,
  body: JSON.stringify({
    intentId: api.recordAttachment.name,
    intentPolicyHash: api.recordAttachment.intentPolicyHash ?? null,
    args: {}, declaredFilename: 'p.pdf', declaredLength: bytes.byteLength,
    declaredContentType: 'application/pdf',
  }),
}).then((r) => r.json());
const attemptId = created.task.attemptId;
await fetch(`${ready.serverUrl}${created.transfer.uploadUrl}`, {
  method: 'PATCH',
  headers: {
    authorization: `Bearer ${token}`, 'x-snapback-auth-client-protocol': '1',
    'tus-resumable': '1.0.0', 'content-type': 'application/offset+octet-stream',
    'upload-offset': '0',
    'upload-checksum': `sha256 ${createHash('sha256').update(bytes).digest('base64')}`,
  },
  body: bytes,
});
const finalized = await fetch(`${ready.serverUrl}/assets/attempts/${encodeURIComponent(attemptId)}/finalize`, {
  method: 'POST', headers: authed,
  body: JSON.stringify({ attemptId, lifecycleGeneration: 1,
    declaredDigest: createHash('sha256').update(bytes).digest('hex') }),
}).then((r) => r.json());
console.log('finalized availability:', finalized.task?.availability);
const assetId = finalized.task.assetId;
try {
  const probe = await client.mutate(api.debugAttach, { args: { assetId } });
  console.log('attach returns:', probe.result);
} catch (err) {
  console.log('debugAttach failed:', err?.diagnostic?.code ?? err?.message, JSON.stringify(err?.diagnostic ?? {}).slice(0, 300));
}
const ws = (await client.mutate(api.createWorkspace, { args: { name: 'probe-ws' } })).result;
const rec = (await client.mutate(api.createRecord, { args: {
  workspaceId: ws, title: 'probe record', assigneeId: credential.session.userId,
  assigneeName: 'Alice', dueAt: 1, position: 1000, clientKey: 'pa1' } })).result;
try {
  const attach = await client.mutate(api.attachToRecord, { args: { recordId: rec, assetId } });
  console.log('attachToRecord ok:', JSON.stringify({ changed: attach.changed_count }));
} catch (err) {
  console.log('attachToRecord failed:', err?.diagnostic?.code ?? err?.message,
    JSON.stringify(err?.diagnostic ?? {}).slice(0, 400));
}
console.log('finalize assetId form:', JSON.stringify(assetId));
try {
  const one = await client.mutate(api.debugAttachInsert, { args: { assetId, recordId: rec, workspaceId: ws } });
  console.log('debugAttachInsert ok:', JSON.stringify(one.result));
} catch (err) {
  console.log('debugAttachInsert failed:', err?.diagnostic?.code ?? err?.message);
}
try {
  const raw = await client.mutate(api.debugAttachInsertRaw, { args: { assetId, recordId: rec, workspaceId: ws } });
  console.log('debugAttachInsertRaw ok:', JSON.stringify(raw.result));
} catch (err) {
  console.log('debugAttachInsertRaw failed:', err?.diagnostic?.code ?? err?.message);
}
child.stdin.end();
await sleep(800);
process.exit(0);

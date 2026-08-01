// Node control for the B1 persist path: same server, same flow, node file
// store under an explicit directory. Prints the persist-relevant facts.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const readyFile = join(root, '.snapback', 'dev.ready.json');
const storeDir = join(import.meta.dirname, 'node-control-store');
rmSync(storeDir, { recursive: true, force: true });
mkdirSync(storeDir, { recursive: true });

const clientRoot = '/Users/ccheever/projects/snapback/.claude/worktrees/agent-a4f92dbc89b47044c/packages/snapback-client';
const { createExternalSessionClient } = await import(pathToFileURL(join(clientRoot, 'index.mjs')).href);
const { createFileRqsResumeStore } = await import(pathToFileURL(join(clientRoot, 'rqs-store-file.mjs')).href);
const { api } = await import(pathToFileURL(join(root, 'snapback', 'generated', 'api.mjs')).href);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, label, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(50);
  }
};

for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}
const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
});
let loaded = false;
child.stdout.on('data', (c) => { if (String(c).includes('generated-and-loaded')) loaded = true; });
const ready = await until(() => {
  if (!loaded || !existsSync(readyFile)) return null;
  try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
}, 'dev ready', 90_000);
const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
const headers = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };

const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
  method: 'POST', headers, body: JSON.stringify({ email: 'control@b1.test' }),
}).then((r) => r.json());
const mailbox = await fetch(
  `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
  { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
).then((r) => r.json());
const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
  method: 'POST', headers,
  body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
}).then((r) => r.json());

const store = createFileRqsResumeStore({ directory: storeDir });
await store.whenLockSettled();
const client = createExternalSessionClient(ready.serverUrl, {
  bearerToken: credential.token,
  rqsStore: store,
});
console.log('rqsStoreInfo:', JSON.stringify(client.rqsStoreInfo));

const handle = await client.liveQuery(api.listSites, { connectionId: 'b1_node_control', transport: 'stream' });
await sleep(500);
console.log('rows:', handle.rows.length, 'freshness:', handle.freshness, 'retention:', JSON.stringify(handle.retention));
console.log('rqsResume held:', Boolean(handle.rqsResume));
const flushed = await handle.flushResumeState?.();
console.log('flushed:', JSON.stringify(flushed));
await sleep(200);
console.log('store dir names:', JSON.stringify(readdirSync(storeDir)));
const blobs = readdirSync(storeDir).filter((n) => n.endsWith('.json'));
for (const name of blobs) {
  console.log('blob', name, readFileSync(join(storeDir, name), 'utf8').slice(0, 200));
}
await handle.dispose();
await client.closeAuth?.();
await store.close();
child.stdin.end();
await sleep(500);
process.exit(0);

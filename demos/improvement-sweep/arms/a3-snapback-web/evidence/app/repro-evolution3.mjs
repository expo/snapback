// Isolate: does an active sessions client (or admin preview) wedge the dev
// watch reload in an auth-mode transition?
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SnapbackClient, createExternalSessionClient } from '@expo/snapback-client';

const root = process.cwd();
const readyFile = join(root, '.snapback', 'dev.ready.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gen = () => new Promise((res) => spawn(join(root, 'node_modules', '.bin', 'snapback'), ['generate', 'snapback'], { cwd: root, stdio: 'ignore' }).on('exit', res));

const scenario = process.argv[2] ?? 'session';
for (const s of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) rmSync(join(root, '.snapback', `dev.sqlite3${s}`), { force: true });
copyFileSync('versions/schema.v1.mjs', 'snapback/schema.mjs');
copyFileSync('versions/functions.v1.mjs', 'snapback/functions.mjs');
await gen();
const api = (await import(`./snapback/generated/api.mjs?r=${Date.now()}`)).default;

const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
const events = [];
const feed = (c) => {
  out += c;
  for (const line of c.toString().split('\n')) {
    try { const e = JSON.parse(line.trim()); if (e?.schemaVersion === 'snapback.dev.v1') events.push(e); } catch {}
  }
};
child.stdout.on('data', feed);
child.stderr.on('data', feed);
const deadline = Date.now() + 30000;
while (Date.now() < deadline && !(existsSync(readyFile) && events.some((e) => e.state === 'generated-and-loaded'))) await sleep(50);
const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
console.log(scenario, ': v1 READY');

const headers = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
const signIn = async (email) => {
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, { method: 'POST', headers, body: JSON.stringify({ email }) }).then((r) => r.json());
  const mailbox = await fetch(`${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } }).then((r) => r.json());
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, { method: 'POST', headers, body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }) }).then((r) => r.json());
  return { client: new SnapbackClient(ready.serverUrl, { bearerToken: credential.token, authClientProtocol: 1, authInvalidationProtocol: 1, authorityDescriptorProtocol: 1, authorizedLeaseProtocol: 1, rqsStore: null }), token: credential.token };
};

let handle = null;
if (scenario !== 'idle') {
  const alice = await signIn('alice@sweep-a3.test');
  await alice.client.mutate(api.redeemInvite, { args: { code: 'INV-OWNER-7391' } });
  if (scenario === 'session' || scenario === 'live' || scenario === 'live2') {
    if (scenario === 'live' || scenario === 'live2') {
      handle = await alice.client.liveQuery(api.boardAggregates, { args: { orgId: 'org_relay' }, connectionId: 'probe', transport: 'stream' });
      const d = Date.now() + 8000;
      while (Date.now() < d && handle.connection !== 'live') await sleep(50);
      console.log('live handle:', handle.connection);
    }
  }
  if (scenario === 'preview') {
    const seedArtifact = JSON.parse(readFileSync(join(root, 'snapback', 'generated', 'seed.artifact.json'), 'utf8'));
    const admin = createExternalSessionClient(ready.serverUrl, { bearerToken: alice.token, adminToken, rqsStore: null });
    const p = await admin.previewVersionedSeed(seedArtifact, { requestedMode: 'sessions' });
    console.log('preview current:', JSON.stringify(p.current));
  }
  // leave the session open in all cases
  globalThis.__alice = alice;
}

if (scenario === 'live2' && handle) {
  await handle.dispose();
  handle = null;
  console.log('handle disposed BEFORE swap');
}
const loadedBefore = events.filter((e) => e.state === 'generated-and-loaded').length;
copyFileSync('versions/schema.v2.mjs', 'snapback/schema.mjs');
copyFileSync('versions/functions.v2.mjs', 'snapback/functions.mjs');
const d2 = Date.now() + 25000;
while (Date.now() < d2 && events.filter((e) => e.state === 'generated-and-loaded').length === loadedBefore) await sleep(100);
const reloaded = events.filter((e) => e.state === 'generated-and-loaded').length > loadedBefore;
console.log('reloaded:', reloaded, '| events:', JSON.stringify(events.map((e) => `${e.state}${e.ok === false ? '!' : ''}`)));
if (!reloaded) console.log('non-event tail:', out.split('\n').filter((l) => !l.includes('schemaVersion')).slice(-8).join('\n'));
// probe app-data admission
try {
  const probe = await (globalThis.__alice ?? (await signIn('alice@sweep-a3.test'))).client.query(api.boardAggregates, { args: { orgId: 'org_relay' } });
  console.log('post-swap query ok:', JSON.stringify(probe.rows[0]));
} catch (e) {
  console.log('post-swap query err:', e?.diagnostic?.code ?? e.message);
}
if (handle) {
  await handle.dispose().catch(() => {});
  console.log('handle disposed; waiting for admission to reopen...');
  const d3 = Date.now() + 20000;
  let reopened = null;
  while (Date.now() < d3) {
    try {
      const probe2 = await globalThis.__alice.client.query(api.boardAggregates, { args: { orgId: 'org_relay' } });
      reopened = JSON.stringify(probe2.rows[0]); break;
    } catch (e) { await sleep(500); }
  }
  console.log('after dispose:', reopened ?? 'STILL CLOSED after 20s');
  console.log('reload events full:', JSON.stringify(events, null, 1).slice(0, 2500));
console.log('raw tail:', out.split('\n').filter((l) => l.trim() && !l.includes('"schemaVersion":"snapback.dev.v1"')).slice(-6).join('\n'));
}
child.stdin.end();
await sleep(800);
process.exit(0);

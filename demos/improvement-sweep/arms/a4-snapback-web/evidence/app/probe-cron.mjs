// A4 arm probe: everyMs cron nominal-time behavior on packaged 0.1.7.
// Question: after the epoch-0 catch-up run, do subsequent deterministic
// ticks run at real-time nominals (so a due reminder actually delivers)?
import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { SnapbackClient } from '@expo/snapback-client';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const s of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) rmSync(`.snapback/dev.sqlite3${s}`, { force: true });
const guards = [];
for (const port of [4288, 4289, 4290]) {
  const g = createServer(() => {});
  await new Promise((res) => { g.once('error', () => res()); g.listen(port, '127.0.0.1', () => res()); });
  guards.push(g);
}
const child = spawn('./node_modules/.bin/snapback', ['dev', 'snapback'], {
  stdio: ['pipe', 'ignore', 'ignore'],
  env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
});
let ready = null;
for (let i = 0; i < 600 && !ready; i += 1) { await sleep(100); try { ready = JSON.parse(readFileSync('.snapback/dev.ready.json', 'utf8')); } catch {} }
for (const g of guards) g.close();
await sleep(1000);
console.log('port', ready.port);
const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
const protocolHeaders = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
const api = (await import('./snapback/generated/api.mjs')).default;

// host seat so we can read deliveries
const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
  method: 'POST', headers: protocolHeaders, body: JSON.stringify({ email: 'hana@sweep-a4.test' }) }).then((r) => r.json());
const mailbox = await fetch(`${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
  { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } }).then((r) => r.json());
const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
  method: 'POST', headers: protocolHeaders,
  body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }) }).then((r) => r.json());
const hana = new SnapbackClient(ready.serverUrl, { bearerToken: credential.token, authClientProtocol: 1, rqsStore: null, clientStoreId: `probe-cron-${process.pid}` });
await hana.mutate(api.redeemInvite, { args: { code: 'INV-HOST-2214', name: 'Hana', enteredVia: 'code' } });

for (let t = 0; t < 8; t += 1) {
  const res = await fetch(`${ready.serverUrl}/_snapback/api/cron/tick`, {
    method: 'POST', headers: { 'x-snapback-admin-token': adminToken, 'content-type': 'application/json' }, body: '{}' });
  const runs = await res.json();
  const detail = (await hana.client?.query?.(api.hostEventDetail, { args: { eventId: 'evt_lantern' } })) ??
    (await hana.query(api.hostEventDetail, { args: { eventId: 'evt_lantern' } }));
  const deliveries = detail.rows[0].deliveries;
  console.log(`tick ${t}:`, JSON.stringify(runs.map((r) => ({ s: r.scheduledAtMs, o: r.outcome }))),
    'deliveries:', deliveries.length, deliveries.map((d) => d.deliveredAt).join(','));
  if (deliveries.length > 0) break;
  await sleep(1100);
}
await hana.closeAuth?.();
child.stdin.end();
await sleep(1500);

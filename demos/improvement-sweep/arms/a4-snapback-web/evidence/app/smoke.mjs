// A4 arm smoke probe: anonymous preview, action invocation shape, cron tick,
// config API path. Owns its dev server; deletes the db for a fresh seed.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@expo/snapback-client';

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (predicate, label, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(25);
  }
};
const diagCode = (err) => err?.diagnostic?.code ?? err?.code ?? String(err?.message ?? err);

for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}

const guards = [];
for (const port of [4288, 4289, 4290]) {
  const guard = createServer(() => {});
  await new Promise((res) => {
    guard.once('error', () => res());
    guard.listen(port, '127.0.0.1', () => res());
  });
  guards.push(guard);
}
const lifecycleEvents = [];
const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
});
let remainder = '';
child.stdout.on('data', (chunk) => {
  remainder += chunk.toString('utf8');
  for (;;) {
    const nl = remainder.indexOf('\n');
    if (nl === -1) break;
    const line = remainder.slice(0, nl).trim();
    remainder = remainder.slice(nl + 1);
    if (!line) continue;
    console.log('DEV-OUT', line.slice(0, 400));
    try {
      const event = JSON.parse(line);
      if (event?.schemaVersion === 'snapback.dev.v1') lifecycleEvents.push(event);
    } catch { /* prose */ }
  }
});
child.stderr.on('data', (chunk) => { console.log('DEV-ERR', chunk.toString('utf8').slice(0, 400)); });

try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try {
      const descriptor = JSON.parse(readFileSync(readyFile, 'utf8'));
      return lifecycleEvents.some((e) => e.state === 'generated-and-loaded') ? descriptor : null;
    } catch { return null; }
  }, 'dev ready');
  for (const guard of guards) guard.close();
  console.log('ready:', ready.serverUrl, 'port', ready.port);
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  const protocolHeaders = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };

  const api = (await import('./snapback/generated/api.mjs')).default;

  // 1. anonymous public preview through the client (no bearer)
  const anon = new SnapbackClient(ready.serverUrl, {
    rqsStore: null, clientStoreId: `smoke-anon-${process.pid}`,
  });
  try {
    const preview = await anon.query(api.eventPreview, { args: { slug: 'lantern-supper' } });
    console.log('anon preview rows:', JSON.stringify(preview.rows));
  } catch (err) {
    console.log('anon preview refused:', diagCode(err));
  }
  // anonymous protected read must refuse
  try {
    const r = await anon.query(api.guestEventView, { args: { eventId: 'evt_lantern' } });
    console.log('anon protected read ALLOWED (defect):', r.rows.length);
  } catch (err) {
    console.log('anon protected read refused:', diagCode(err));
  }

  // 2. sign in one persona and check action invocation
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
    method: 'POST', headers: protocolHeaders, body: JSON.stringify({ email: 'hana@sweep-a4.test' }),
  }).then((r) => r.json());
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
  ).then((r) => r.json());
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
    method: 'POST', headers: protocolHeaders,
    body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
  }).then((r) => r.json());
  console.log('signed in:', credential.session?.userId);
  const hana = new SnapbackClient(ready.serverUrl, {
    bearerToken: credential.token, authClientProtocol: 1, rqsStore: null,
    clientStoreId: `smoke-hana-${process.pid}`,
  });
  const seat = await hana.mutate(api.redeemInvite, {
    args: { code: 'INV-HOST-2214', name: 'Hana', enteredVia: 'code' } });
  console.log('host seat:', JSON.stringify(seat.result));

  // 3. cron tick + inspect
  try {
    const tick = await hana.cronTick();
    console.log('cronTick (client):', JSON.stringify(tick).slice(0, 300));
  } catch (err) {
    console.log('client cronTick failed:', diagCode(err));
    const raw = await fetch(`${ready.serverUrl}/_snapback/api/cron/tick`, {
      method: 'POST',
      headers: { 'x-snapback-admin-token': adminToken, 'content-type': 'application/json' },
      body: '{}',
    });
    console.log('raw cron tick:', raw.status, (await raw.text()).slice(0, 300));
  }
  const inspect = await fetch(`${ready.serverUrl}/_snapback/api/inspect`, {
    headers: { 'x-snapback-admin-token': adminToken },
  }).then((r) => r.json());
  console.log('inspect cron:', JSON.stringify(inspect.cron ?? inspect).slice(0, 500));

  // 4. config API path probe
  for (const path of ['/_snapback/api/config/status', '/_snapback/api/config', '/_snapback/admin/api/config/status']) {
    const res = await fetch(`${ready.serverUrl}${path}`, {
      headers: { 'x-snapback-admin-token': adminToken },
    });
    console.log('config probe', path, res.status, res.status < 500 ? (await res.text()).slice(0, 200) : '');
  }

  // 5. action invocation via client
  try {
    const run = await hana.action(api.runReminder, { args: { trigger: 'smoke' } });
    console.log('action result:', JSON.stringify(run).slice(0, 300));
  } catch (err) {
    console.log('client action failed:', diagCode(err), String(err?.message ?? '').slice(0, 200));
  }

  await hana.closeAuth?.();
  await anon.closeAuth?.();
} finally {
  child.stdin.end();
  await until(() => (child.exitCode !== null ? true : null), 'dev exit', 15_000).catch(() => child.kill('SIGTERM'));
  console.log('dev stopped');
}

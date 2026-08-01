// Driver for the A5 streamed-action probe. Phase is inferred from the
// generated surface: it always runs probeAttempt; if probeFetchStream is
// generated it runs that too (against a local one-shot chunked server).
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@expo/snapback-client';

const root = resolve(import.meta.dirname);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(50);
  }
};

// local chunked upstream for the fetchStream phase
const upstreamSeen = [];
const upstream = http.createServer((req, res) => {
  upstreamSeen.push({ auth: String(req.headers.authorization ?? ''), probe: String(req.headers['x-probe'] ?? '') });
  res.setHeader('content-type', 'text/plain');
  res.write('chunk-one ');
  setTimeout(() => { res.write('chunk-two '); setTimeout(() => res.end('done'), 50); }, 50);
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/stream`;

for (const s of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${s}`), { force: true });
}
const guards = [];
for (const port of [4287, 4288, 4289, 4290, 4291, 4292]) {
  const g = createServer(() => {});
  await new Promise((res) => { g.once('error', () => res()); g.listen(port, '127.0.0.1', () => res()); });
  guards.push(g);
}
const devOut = [];
const child = spawn(join(root, 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
});
child.stdout.on('data', (c) => devOut.push(c.toString('utf8')));
child.stderr.on('data', (c) => devOut.push(c.toString('utf8')));
const readyFile = join(root, '.snapback', 'dev.ready.json');
let ready = null;
let bootFailure = null;
try {
  ready = await until(() => {
    if (child.exitCode !== null) throw new Error(`dev exited ${child.exitCode}: ${devOut.join('').slice(-800)}`);
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'dev ready', 60_000);
} catch (err) {
  bootFailure = String(err?.message ?? err);
}
for (const g of guards) g.close();

const result = { phase: null, bootFailure, devTail: null, probeAttempt: null, probeFetchStream: null };
try {
  if (!ready) {
    result.devTail = devOut.join('').slice(-1500);
    throw new Error('server never reached ready');
  }
  await sleep(800);
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  const ph = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
  const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
    method: 'POST', headers: ph, body: JSON.stringify({ email: 'probe@sweep-a5.test' }) }).then((r) => r.json());
  const mailbox = await fetch(
    `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
  ).then((r) => r.json());
  const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
    method: 'POST', headers: ph,
    body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }) }).then((r) => r.json());
  const client = new SnapbackClient(ready.serverUrl, {
    bearerToken: credential.token, authClientProtocol: 1, rqsStore: null, clientStoreId: `a5-probe-${process.pid}` });
  const api = (await import(`./snapback/generated/api.mjs?v=${Date.now()}`)).default;
  result.phase = api.probeFetchStream ? 'phase2-with-fetchstream' : 'phase1-attempt-only';

  const attempt = await client.action(api.probeAttempt, { args: { key: `k${Date.now()}` } });
  result.probeAttempt = attempt.result ?? attempt;

  if (api.probeFetchStream) {
    const fs1 = await client.action(api.probeFetchStream, { args: { url: upstreamUrl } });
    result.probeFetchStream = fs1.result ?? fs1;
    result.upstreamSawHeaders = upstreamSeen;
  }
  await client.closeAuth?.();
} catch (err) {
  result.error = String(err?.message ?? err);
} finally {
  child.stdin.end();
  await until(() => (child.exitCode !== null ? true : null), 'dev exit', 10_000).catch(() => child.kill('SIGTERM'));
  upstream.close();
  console.log(JSON.stringify(result, null, 2));
  writeFileSync(join(root, `probe-result-${result.phase ?? 'boot-failed'}.json`), JSON.stringify(result, null, 2));
}

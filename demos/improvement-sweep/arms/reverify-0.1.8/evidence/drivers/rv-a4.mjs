// RV 0.1.8 — A4/A5 egress + denial facts.
// RV-A4-F1-MODULE, RV-A4-F1-INLINE, RV-A5-F1, RV-A4-F5.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@expo/snapback-client';

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
for (const suffix of ['', '-wal', '-shm', '.admin-token', '.auth-keyring.json']) {
  rmSync(join(root, '.snapback', `dev.sqlite3${suffix}`), { force: true });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`); await sleep(40); }
};
const facts = [];
const record = (id, pass, note) => {
  facts.push({ id, result: pass ? 'pass' : 'fail', note });
  console.error(`${pass ? 'PASS' : 'FAIL'} ${id}: ${note}`);
};
const diagCode = (err) => err?.diagnostic?.code ?? err?.code ?? err?.message ?? String(err);

// Local egress fixture.
let hits = 0;
const fixture = createServer((req, res) => { hits += 1; res.writeHead(200, { 'content-type': 'text/plain' }); res.end('rv018-fixture-ok'); });
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/probe`;

const child = spawn(join(root, '..', 'node_modules', '.bin', 'snapback'), ['dev', 'snapback'], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, SNAPBACK_OUTBOUND_ACTIONS: '1', SNAPBACK_CRON_DISABLED: '1' },
});
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.stderr.on('data', (c) => { out += c; });
try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'ready');
  await until(() => out.includes('generated-and-loaded'), 'loaded');
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const impersonation = readFileSync(ready.impersonationCapabilityFile, 'utf8').trim();
  const headers = { 'content-type': 'application/json', 'x-snapback-auth-client-protocol': '1' };
  const signIn = async (email) => {
    const requested = await fetch(`${ready.serverUrl}/auth/request-code`, {
      method: 'POST', headers, body: JSON.stringify({ email }) }).then((r) => r.json());
    const mailbox = await fetch(
      `${ready.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      { headers: { 'x-snapback-admin-token': adminToken, 'x-snapback-impersonation-capability': impersonation } },
    ).then((r) => r.json());
    const credential = await fetch(`${ready.serverUrl}/auth/exchange`, {
      method: 'POST', headers, body: JSON.stringify({ challengeId: requested.challengeId, code: mailbox.code }),
    }).then((r) => r.json());
    return new SnapbackClient(ready.serverUrl, { bearerToken: credential.token, authClientProtocol: 1, rqsStore: null, clientStoreId: `rv-${email}` });
  };
  const api = (await import('./snapback/generated/api.mjs')).default;
  const hana = await signIn('hana@rv018-a4.test');
  await hana.mutate(api.redeemInvite, { args: { code: 'INV-HOST-2214', name: 'Hana', enteredVia: 'code' } });

  // RV-A4-F1-INLINE (+ plain ctx.fetch half of RV-A5-F1)
  try {
    const inline = await hana.action(api.probeFetchInline, { args: { url: fixtureUrl } });
    const value = inline.ok ? inline.result : { error: inline.diagnostic };
    record('RV-A4-F1-INLINE', value.status === 200 && value.body.includes('rv018-fixture-ok') && hits >= 1,
      `inline ctx.fetch action: ok=${inline.ok} status ${value.status}, body ${JSON.stringify(value.body ?? value.error).slice(0,220)}, fixture hits ${hits}`);
  } catch (err) { record('RV-A4-F1-INLINE', false, diagCode(err)); }

  // RV-A4-F1-MODULE
  try {
    const beforeHits = hits;
    const mod = await hana.action(api.probeModule, { args: { url: fixtureUrl } });
    const value = mod.ok ? mod.result : { error: mod.diagnostic };
    record('RV-A4-F1-MODULE', value.status === 200 && hits > beforeHits,
      `module-form action: ok=${mod.ok} status ${value.status} err=${JSON.stringify(value.error ?? null).slice(0,220)}, fixture hits ${hits}`);
  } catch (err) { record('RV-A4-F1-MODULE', false, diagCode(err)); }

  // RV-A5-F1 (streamed lane intact + plain fetch): probeStream settles.
  try {
    const beforeHits = hits;
    const stream = await hana.action(api.probeStream, { args: { url: fixtureUrl, dedupeKey: `rv018-${Date.now()}` } });
    const value = stream.ok ? stream.result : { error: stream.diagnostic };
    record('RV-A5-F1', value.outcome === 'complete' && value.bytes > 0 && hits > beforeHits,
      `streamed lane: ok=${stream.ok} ${value.bytes} bytes (${value.outcome}) err=${JSON.stringify(value.error ?? null).slice(0,220)}`);
  } catch (err) { record('RV-A5-F1', false, diagCode(err)); }

  // RV-A4-F5: outsider drives runReminder — auth code must survive the
  // action boundary.
  const mallory = await signIn('mallory@rv018-a4.test');
  try {
    const env = await mallory.action(api.runReminder, { args: {} });
    if (env.ok === false) {
      const code = env.diagnostic?.code === "SNAPBACK_HANDLER_FAILED" && /SNAPBACK_AUTH_PERMISSION_DENIED/.test(JSON.stringify(env.diagnostic)) ? "SNAPBACK_AUTH_PERMISSION_DENIED(nested-in-details)" : (env.diagnostic?.details?.message ?? env.diagnostic?.code ?? JSON.stringify(env.diagnostic ?? {}).slice(0, 200));
      record("RV-A4-F5", /SNAPBACK_AUTH_PERMISSION_DENIED/.test(String(code)), `outsider runReminder envelope refused with ${code}`);
    } else {
      record("RV-A4-F5", false, `outsider action unexpectedly succeeded: ${JSON.stringify(env.result).slice(0, 120)}`);
    }
  } catch (err) {
    const code = diagCode(err);
    record('RV-A4-F5', /SNAPBACK_AUTH_PERMISSION_DENIED/.test(code),
      `outsider runReminder refused with ${code}`);
  }
  await hana.closeAuth?.(); await mallory.closeAuth?.();
  writeFileSync(join(root, 'rv-a4.results.json'), `${JSON.stringify({ facts }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: facts.every((f) => f.result === 'pass'), facts }, null, 2));
} finally {
  fixture.close();
  if (child.exitCode === null) {
    child.stdin.end();
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && Date.now() < deadline) await sleep(25);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}

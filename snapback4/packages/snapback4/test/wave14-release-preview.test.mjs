import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { captureStdout } from './helpers/server-output.mjs';
import { waitFor, hangBudget } from './helpers/wait.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-wave14-preview-'));
  mkdirSync(join(dir, 'snapback'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const deployment = join(dir, 'deployment');
  const schema = join(dir, 'snapback/schema.q');
  const invoke = (...args) => spawnSync(binary, args, { cwd: dir, encoding: 'utf8', timeout: hangBudget(), env: { ...process.env, PORT_LO: undefined, PORT_HI: undefined } });
  const run = (...args) => { const result = invoke(...args); assert.equal(result.status, 0, result.stdout + result.stderr); return result; };
  return { deployment, schema, run };
}
async function serve(t, deployment) {
  const child = spawn(binary, ['serve', deployment, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const out = captureStdout(child); let err = ''; child.stderr.on('data', data => { err += data; });
  const closed = once(child, 'close'); let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    if (child.exitCode == null) child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), hangBudget());
    try { await closed; } finally { clearTimeout(timer); }
  };
  t.after(stop);
  await waitFor(() => { assert.equal(child.exitCode, null, out() + err); return /SNAPBACK4_READY/.test(err) && /http:\/\/127\.0\.0\.1:\d+/.test(out()); }, 'serve readiness', { diagnostics: () => out() + err });
  const url = out().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const signed = await (await fetch(url + '/auth/guest', { method: 'POST', body: '{}' })).json();
  const headers = { authorization: `Bearer ${signed.session.token}`, 'content-type': 'application/json' };
  const post = async (path, args) => (await fetch(url + path, { method: 'POST', headers, body: JSON.stringify({ args }), signal: AbortSignal.timeout(hangBudget()) })).json();
  return { post, stop };
}

// @ref LLP 3000.000.000#14-wave-14-rollback-narration — only consulted domains affect guards; a trailing refusal-preserving requirement tightens.
test('P24 domain scope, directional widening, refusal contracts and Boolean grouping', t => {
  const { schema, deployment, run } = fixture(t);
  const v1 = `use identity guests
table roles:
  principal: principal
  role: enum('captain', 'crew')
  status: enum('old')
  unique principal, role
  public
  online only
mutation approve():
  require exists roles[principal = viewer, role = 'captain'] else NO
  return true
mutation grouped(a: bool, b: bool, c: bool):
  require a and (b or c) else BASE 'base refusal'
  return true
`;
  const v2 = v1.replace("status: enum('old')", "status: enum('old', 'new')").replace("  return true\n", "  return true\n", 1).replace("  require a and (b or c) else BASE 'base refusal'", "  require a and (b or c) else BASE 'base refusal'\n  require b else EXTRA 'extra refusal'");
  writeFileSync(schema, v1); run('deploy', deployment);
  writeFileSync(schema, v2);
  const preview = run('deploy', deployment, '--check').stdout;
  assert.doesNotMatch(preview, /roles changed: .*guards? unproved/);
  assert.match(preview, /note: release 2 tightens grouped\.require/);
  assert.match(preview, /require \(a and \(b or c\)\) else BASE 'base refusal'/);
  run('deploy', deployment);
  const rollback = JSON.parse(run('rollback', deployment, '--to', '1', '--check', '--json').stdout);
  assert.ok(rollback.hazards.some(line => line.includes('loosens grouped.require') && line.includes('rollback users lose a current safety guard') && line.includes('bridge release')), JSON.stringify(rollback.hazards));
  writeFileSync(schema, v2.replace("BASE 'base refusal'", "RENAMED 'changed refusal'"));
  const changed = run('deploy', deployment, '--check').stdout;
  assert.match(changed, /WARNING.*grouped\.require.*BASE.*RENAMED/);
  assert.doesNotMatch(changed, /note:.*tightens grouped\.require/);
});

test('scan filters retain changed defaults for legacy rows that omitted the field', { timeout: hangBudget(4) }, async t => {
  const { schema, deployment, run } = fixture(t);
  const legacy = `use identity guests
table gates:
  public
  insert <- allow
  online only
mutation add():
  return insert gates {id: 'gate'}
`;
  const guarded = legacy.replace('table gates:\n', 'table gates:\n  blocked: bool default true\n') + `mutation book():
  require count(gates where .blocked) = 0 else BLOCKED
  return true
`;
  writeFileSync(schema, legacy); run('deploy', deployment);
  let host = await serve(t, deployment);
  assert.equal((await host.post('/m/add', {})).state, 'sent');
  await host.stop();
  writeFileSync(schema, guarded); run('deploy', deployment);
  host = await serve(t, deployment);
  assert.equal((await host.post('/m/book', {})).why.code, 'BLOCKED');
  await host.stop();
  writeFileSync(schema, guarded.replace('default true', 'default false'));
  assert.match(run('deploy', deployment, '--check').stdout, /gates changed: 1 guard unproved across book/);
});

test('a changed helper behind a reused probe cannot masquerade as a trailing-require tightening', { timeout: hangBudget(4) }, async t => {
  const { schema, deployment, run } = fixture(t);
  const v1 = `use identity guests
table gates:
  enabled: bool
  public
  insert <- allow
  online only
fn eligible(value: bool): value
mutation add():
  return insert gates {id: 'gate', enabled: false}
mutation book(ok: bool):
  require exists gates where eligible(.enabled) else BLOCKED
  return true
`;
  const v2 = v1.replace('fn eligible(value: bool): value', 'fn eligible(value: bool): true').replace('  require exists gates where eligible(.enabled) else BLOCKED', '  require exists gates where eligible(.enabled) else BLOCKED\n  require ok else EXTRA');
  writeFileSync(schema, v1); run('deploy', deployment);
  let host = await serve(t, deployment);
  assert.equal((await host.post('/m/add', {})).state, 'sent');
  assert.equal((await host.post('/m/book', {ok:true})).why.code, 'BLOCKED');
  await host.stop();
  writeFileSync(schema, v2);
  const preview=run('deploy', deployment, '--check').stdout;
  assert.match(preview, /WARNING .*book\.require/);
  assert.doesNotMatch(preview, /note: .*tightens book\.require/);
});

test('aggregate projections retain changed defaults for legacy rows that omitted the field', { timeout: hangBudget(4) }, async t => {
  const { schema, deployment, run } = fixture(t);
  const legacy = `use identity guests
table gates:
  public
  insert <- allow
  online only
mutation add():
  return insert gates {id: 'gate'}
`;
  const guarded = legacy.replace('table gates:\n', 'table gates:\n  score: int default 0\n') + `mutation limit():
  page = gates first 10 by .id
  require (max(page, .score) ?? 0) < 10 else LIMIT
  return true
`;
  writeFileSync(schema, legacy); run('deploy', deployment);
  let host = await serve(t, deployment);
  assert.equal((await host.post('/m/add', {})).state, 'sent');
  await host.stop();
  writeFileSync(schema, guarded); run('deploy', deployment);
  host = await serve(t, deployment);
  assert.equal((await host.post('/m/limit', {})).state, 'sent');
  await host.stop();
  writeFileSync(schema, guarded.replace('default 0', 'default 20'));
  assert.match(run('deploy', deployment, '--check').stdout, /gates changed: 1 guard unproved across limit/);
});

test('optional absence and row fallback defaults remain consulted dependencies', { timeout: hangBudget(4) }, async t => {
  const { schema, deployment, run } = fixture(t);
  const legacy = `use identity guests
table gates:
  public
  insert <- allow
  online only
mutation add():
  return insert gates {id: 'gate'}
`;
  const guarded = legacy.replace('table gates:\n', 'table gates:\n  flag: bool default true\n  blocked: bool default true\n') + `mutation optionalGuard(id: gates):
  row = gates[id]! else MISSING
  require row.flag = true else FLAG
  return true
mutation fallback(a: gates, b: gates):
  row = (gates[a] ?? gates[b])! else NOT_FOUND
  require row.blocked = false else BLOCKED
  return true
`;
  writeFileSync(schema, legacy); run('deploy', deployment);
  let host = await serve(t, deployment);
  assert.equal((await host.post('/m/add', {})).state, 'sent');
  await host.stop();
  writeFileSync(schema, guarded); run('deploy', deployment);
  host = await serve(t, deployment);
  assert.equal((await host.post('/m/optionalGuard', {id:'gate'})).state, 'sent');
  assert.equal((await host.post('/m/fallback', {a:'gate', b:'missing'})).why.code, 'BLOCKED');
  await host.stop();
  const target = guarded.replace('flag: bool default true', 'flag: bool ? default true').replace('blocked: bool default true', 'blocked: bool default false');
  writeFileSync(schema, target);
  assert.match(run('deploy', deployment, '--check').stdout, /gates changed: 2 guards unproved across fallback, optionalGuard/);
  run('deploy', deployment);
  host = await serve(t, deployment);
  assert.equal((await host.post('/m/optionalGuard', {id:'gate'})).why.code, 'FLAG');
  assert.equal((await host.post('/m/fallback', {a:'gate', b:'missing'})).state, 'sent');
  await host.stop();
});

test('rollback says what users get back and prints its resolved target first', { timeout: hangBudget(4) }, async t => {
  const { schema, deployment, run } = fixture(t);
  const v1 = `use identity guests
table entries:
  owner: principal
  status: enum('open')
  cap 2 by owner
  public
  insert <- allow
  update <- allow
  online only
mutation add():
  return insert entries {owner: viewer, status: 'open'}
query entriesList():
  return entries first 10 by .id
`;
  const v2 = v1.replace("enum('open')", "enum('open', 'review')").replace('  cap 2 by owner', '  cap 1 by owner').replace('  public\n  insert <- allow\n  update <- allow', '  read <- .owner = viewer\n  insert <- allow\n  update <- .owner = viewer').replace("status: 'open'", "status: 'review'");
  writeFileSync(schema, v1); run('deploy', deployment);
  writeFileSync(schema, v2); run('deploy', deployment);
  const host = await serve(t, deployment);
  assert.equal((await host.post('/m/add', {})).state, 'sent');
  await host.stop();

  const jsonResult = run('rollback', deployment, '--to', '1', '--check', '--json');
  const plan = JSON.parse(jsonResult.stdout);
  assert.match(jsonResult.stderr, /resolved rollback target: release 1 \(current release 2\)/);
  for (const fragment of [
    'rollback users lose current confidentiality',
    'rollback users lose current safety rule',
    "rollback users get release 1's entries population: 1 → 0",
    "rollback users get release 1's quotas on entries: current [cap 1 by owner] → target [cap 2 by owner]",
    'bridge release before activation',
    "entries.status: 1 row holds 'review'",
  ]) assert.ok(plan.hazards.some(line => line.includes(fragment)), `${fragment}: ${JSON.stringify(plan.hazards)}`);
  assert.ok(!plan.hazards.some(line => /entries changed: .*guards? unproved/.test(line)), JSON.stringify(plan.hazards));

  const preview = run('rollback', deployment, '--to', '1', '--check').stdout;
  assert.ok(preview.indexOf('resolved rollback target: release 1') < preview.indexOf('preview: release 1 would be current'), preview);
  const activated = run('rollback', deployment, '--to', '1').stdout;
  assert.ok(activated.indexOf('resolved rollback target: release 1') < activated.indexOf('release 1 is current as generation'), activated);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { captureStdout } from './helpers/server-output.mjs';
import { waitFor, hangBudget } from './helpers/wait.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-narr-')); mkdirSync(join(dir, 'snapback'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const deployment = join(dir, 'deployment'), schema = join(dir, 'snapback/schema.q');
  const invoke = (...args) => spawnSync(binary, args, { cwd: dir, encoding: 'utf8', timeout: hangBudget(), env: { ...process.env, PORT_LO: undefined, PORT_HI: undefined } });
  const run = (...args) => { const result = invoke(...args); assert.equal(result.status, 0, result.stdout + result.stderr); return result; };
  return { dir, deployment, schema, run, invoke };
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
  await waitFor(() => { assert.equal(child.exitCode, null, out() + err); return /SNAPBACK4_READY/.test(err); }, 'serve readiness', { diagnostics: () => out() + err });
  const url = out().match(/http:\/\/127\.0\.0\.1:\d+/)[0];
  const signIn = await (await fetch(url + '/auth/guest', { method: 'POST', body: '{}' })).json();
  const headers = { authorization: `Bearer ${signIn.session.token}`, 'content-type': 'application/json' };
  const post = async (path, args) => (await fetch(url + path, { method: 'POST', headers, body: JSON.stringify({ args }), signal: AbortSignal.timeout(hangBudget()) })).json();
  return { stop, post, child, log: () => out() + err };
}
const v1 = `use identity guests
table notes:
  body: text 1..80
  status: enum('draft') default 'draft'
  public
  insert <- allow
  update <- allow
  online only
mutation add(body: text 1..80):
  return insert notes {body}
query readNote(note: notes):
  return notes[note]
query guardedNote(note: notes):
  n = notes[note]! else MISSING_NOTE
  return n
job remind():
  chunk n in notes first 10 by byId:
    update notes[n.id] {body: n.body}
schedule remindDaily every 1d: remind
`;
const v2 = v1.replace("enum('draft')", "enum('draft', 'archived')") + `mutation archive(note: notes):
  update notes[note] {status: 'archived'}
`;
const v3 = v2.replace('  body: text', "  color: text <=20 default 'none'\n  body: text");

test('probe and deploy guide agree on exact compatibility, schedule, dormancy and shutdown narration', { timeout: hangBudget(4) }, async t => {
  const { schema, deployment, run } = fixture(t);
  writeFileSync(schema, v1); run('deploy', deployment);
  const host = await serve(t, deployment);
  const ids = [];
  for (const body of ['A', 'B', 'C']) { const write = await host.post('/m/add', { body }); assert.equal(write.state, 'sent'); ids.push(write.result.id); }
  writeFileSync(schema, v2);
  const widening = run('deploy', deployment);
  assert.equal(widening.stderr.trim(), "note: notes.status admits 'archived'; rows that later use those values become dormant on rollback to release 1");
  assert.doesNotMatch(widening.stderr, /WARNING|existing rows/);
  const zero = run('rollback', deployment, '--to', '1', '--check').stdout;
  assert.ok(zero.split('\n').includes('  note: notes.status: no stored values are incompatible with release 1'), zero);
  writeFileSync(schema, v3);
  const preview = run('deploy', deployment, '--check');
  assert.ok(preview.stdout.split('\n').includes('  note: job remind compiles differently because notes changed (added color); schedule remindDaily remains'), preview.stdout);
  assert.doesNotMatch(preview.stdout, /WARNING.*job remind|lacks.*schedule/);
  run('deploy', deployment);
  assert.equal((await host.post('/m/archive', { note: ids[0] })).state, 'sent');
  await host.stop();
  assert.equal(existsSync(join(deployment, 'serve.lock')), false, host.log());
  const warning = "WARNING notes.status: 1 row holds 'archived', which release 1 cannot hold; it becomes dormant on this switch and is restored on compatible forward";
  const samples = `samples: cells notes.color [${ids.slice(1).sort().join(', ')}]; rows notes [${ids[0]}]`;
  const plan = run('rollback', deployment, '--to', '1', '--check');
  assert.ok(plan.stdout.split('\n').includes(`  ${warning}`), plan.stdout);
  assert.ok(plan.stdout.includes(`1 row, 2 cells, 0 index entries dormant; ${samples}`), plan.stdout);
  assert.ok(plan.stdout.split('\n').includes(`  column:notes.color: 2 cells dormant (restored on compatible forward); sample ids [${ids.slice(1).sort().join(', ')}]`), plan.stdout);
  assert.match(plan.stdout, /release 1 lacks operation archive/);
  const rolled = run('rollback', deployment, '--to', '1');
  assert.equal(rolled.stderr.trim(), warning);
  assert.ok(rolled.stdout.includes(`1 row, 2 cells, 0 index entries dormant; ${samples}`), rolled.stdout);
  const old = await serve(t, deployment);
  assert.equal((await old.post('/q/readNote', { note: ids[0] })).data, null);
  assert.equal((await old.post('/q/guardedNote', { note: ids[0] })).denied.code, 'MISSING_NOTE');
  assert.equal('color' in (await old.post('/q/readNote', { note: ids[1] })).data, false);
  const forward = run('rollback', deployment, '--to', 'latest');
  assert.doesNotMatch(forward.stdout + forward.stderr, /WARNING|later use|incompatible/);
  assert.match(forward.stdout, /0 rows, 0 cells, 0 index entries dormant/);
  assert.match(forward.stdout, /1 narrowed row restored/);
  const restored = (await old.post('/q/readNote', { note: ids[0] })).data;
  assert.equal(restored.status, 'archived'); assert.equal(restored.color, 'none');
  await old.stop();
  const guide = run('guide', 'deploy').stdout;
  for (const text of ['1 row, 2 cells, 0 index entries dormant', 'cells notes.color [B, C]', 'Point query or mutation with an explicit `! else CODE` guard', 'Ignored by the older release', 'Clients across rollback', 'capability, not authorization']) assert.ok(guide.includes(text), text);
});

test('rollback preview distinguishes missing schedules, edited source and current rule clauses', { timeout: hangBudget(3) }, async t => {
  const { schema, deployment, run } = fixture(t);
  writeFileSync(schema, v1); run('deploy', deployment);
  writeFileSync(schema, v1.replace('body: n.body', "body: 'edited'").replace('  update <- allow', "  update <- viewer = 'service:ops'")); run('deploy', deployment);
  const changed = run('rollback', deployment, '--to', '1', '--check').stdout;
  assert.match(changed, /WARNING job remind source changes in release 1; schedule remindDaily remains/);
  assert.match(changed, /WARNING release 1 loosens notes.update; old: viewer = 'service:ops' \| new: allow/);
  writeFileSync(schema, v1.replace('schedule remindDaily every 1d: remind', 'schedule otherDaily every 2d: remind')); run('deploy', deployment);
  assert.match(run('rollback', deployment, '--to', '1', '--check').stdout, /release 1 lacks schedule otherDaily \(job remind\)/);
});

test('required-column removal and default-only edits never invent compatibility risk', t => {
  const { schema, deployment, run } = fixture(t);
  const old = "table values:\n  number: int\n  status: enum('a', 'b') default 'a'\n  public\n  online only\n";
  writeFileSync(schema, old); run('deploy', deployment);
  writeFileSync(schema, old.replace("default 'a'", "default 'b'"));
  for (const flags of [['--check'], []]) { const result = run('deploy', deployment, ...flags); assert.doesNotMatch(result.stdout + result.stderr, /WARNING|note: values.status|admits ;/); }
  writeFileSync(schema, old.replace('  number: int\n', ''));
  assert.match(run('deploy', deployment, '--check').stdout, /0 cells/); run('deploy', deployment);
});

test('edited module-qualified job source is distinct from dependencies', t => {
  const { dir, schema, deployment, run } = fixture(t);
  writeFileSync(schema, v1.slice(0, v1.indexOf('job remind():')));
  const job = join(dir, 'snapback/maintenance.q');
  const source = "job remind(\n  periodStart: time,\n  periodEnd: time\n):\n  chunk n in notes first 10 by byId:\n    update notes[n.id] {\nbody: n.body\n    }\nschedule remindDaily every 1d: maintenance.remind\n";
  writeFileSync(job, source); run('deploy', deployment);
  writeFileSync(job, source.replace('body: n.body', "body: 'changed'"));
  const plan = run('deploy', deployment, '--check').stdout;
  assert.match(plan, /WARNING job maintenance.remind source changes/); assert.doesNotMatch(plan, /dependencies changed|source comparison unavailable/);
});

test('stored sample text cannot suppress an incompatible-value warning', { timeout: hangBudget(2) }, async t => {
  const { schema, deployment, run } = fixture(t);
  writeFileSync(schema, v1.replaceAll('text 1..80', 'text 1..4')); run('deploy', deployment);
  writeFileSync(schema, v1); run('deploy', deployment);
  const host = await serve(t, deployment);
  assert.equal((await host.post('/m/add', { body: 'rows that later use' })).state, 'sent'); await host.stop();
  const result = run('rollback', deployment, '--to', '1');
  assert.match(result.stderr, /WARNING notes.body: 1 row holds 'rows that later use'/);
});


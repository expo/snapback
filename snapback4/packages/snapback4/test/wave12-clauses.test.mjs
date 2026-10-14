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
  return { viewer:signIn.session.principal, url, stop, post, child, log: () => out() + err };
}
const initial = `use identity guests
table notes:
  owner: principal
  body: text 1..80
  status: enum('draft') default 'draft'
  public
  insert <- .owner = viewer
  update <- allow
  online only
mutation add(body: text 1..80):
  return insert notes {owner: viewer, body}
mutation edit(note: notes, body: text 1..80):
  update notes[note] {body}
query list(c: cursor ?):
  return notes first 20 by .id after c
`;

test('guide and probe agree on widen, tighten, require, SIGTERM, rollback and forward clauses', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  writeFileSync(schema,initial);run('deploy',deployment);
  const host=await serve(t,deployment);
  const added=await host.post('/m/add',{body:'first'});assert.equal(added.state,'sent');
  // Exercise the table in guide testing with the same served bearer.
  const guest=await (await fetch(host.url+'/auth/guest',{method:'POST',body:'{}'})).json();
  const headers={authorization:'Bearer '+guest.session.token,'content-type':'application/json'};
  for (const [path,payload,status,code,state] of [
    ['/q/list', {args:{c:null}},200,null,null],
    ['/q/unknown', {args:{}},404,'E_OP',null],
    ['/m/list', {args:{c:null}},400,'E_OP',null],
    ['/m/add', '{broken',400,'E_INPUT',null],
    ['/m/add', {args:{body:42}},200,'E_INPUT','failed'],
    ['/q/list', {args:{c:42}},400,'E_INPUT',null],
  ]) {
    const response=await fetch(host.url+path,{method:'POST',headers,body:typeof payload==='string'?payload:JSON.stringify(payload)});
    const reply=await response.json();assert.equal(response.status,status,JSON.stringify(reply));
    if (code) assert.equal((reply.why??reply.denied).code,code);else assert.ok(Array.isArray(reply.data));
    if (state) assert.equal(reply.state,state);
  }
  const wide=initial.replace("enum('draft')","enum('draft', 'live')");
  writeFileSync(schema,wide);
  assert.match(run('deploy',deployment).stderr,/notes.status admits 'live'/);
  const tight=wide.replace('update <- allow','update <- .owner = viewer');
  writeFileSync(schema,tight);
  const tightening=run('deploy',deployment,'--check').stdout;
  assert.match(tightening,/note: release 3 tightens notes.update; old: allow \| new: .owner = viewer/);
  assert.doesNotMatch(tightening,/WARNING.*notes.update/);
  run('deploy',deployment);
  const required=tight.replace('  update notes[note]',"  require body != 'blocked' else BLOCKED\n  update notes[note]");
  writeFileSync(schema,required);
  const requirePreview=run('deploy',deployment,'--check').stdout;
  assert.match(requirePreview,/note: release 4 tightens edit.require; old: allow \| new: .*require \(body != 'blocked'\) else BLOCKED/);
  run('deploy',deployment);
  assert.equal((await host.post('/m/edit',{note:added.result.id,body:'blocked'})).why.code,'BLOCKED');
  await host.stop();
  const rollback=run('rollback',deployment,'--to','2','--check').stdout;
  assert.match(rollback,/WARNING release 2 loosens notes.update; old: .owner = viewer \| new: allow/);
  assert.match(rollback,/WARNING release 2 loosens edit.require; old: .*BLOCKED \| new: allow/);
  run('rollback',deployment,'--to','2');
  const forward=run('rollback',deployment,'--to','latest','--check').stdout;
  assert.match(forward,/note: release 4 tightens notes.update/);
  assert.match(forward,/note: release 4 tightens edit.require/);
  run('rollback',deployment,'--to','latest');
  const guide=run('guide','deploy').stdout;
  for(const text of ['old and new rule clauses','proved tightening is a note','loosening or unproved implication is a WARNING','including rollback that removes a new guard'])assert.ok(guide.includes(text),text);
  run('check');
  const generated=readFileSync(join(schema,'../../snapback/generated/api.ts'),'utf8');
  assert.match(generated,/Unwrap with isReady\(read\) && read.data, or matchRead/);
});

test('changed nested/local requirements and changed dependency definitions stay warnings', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const nested=initial.replace('  update notes[note]',"  if body = 'blocked':\n    require false else BLOCKED\n  update notes[note]");
  writeFileSync(schema,nested);run('deploy',deployment);
  writeFileSync(schema,nested.replace('require false else BLOCKED','require true else BLOCKED'));
  assert.match(run('deploy',deployment,'--check').stdout,/WARNING.*implication unproved.*edit.require.*old:.*if \(body.*new:/);
  writeFileSync(schema,initial);run('deploy',deployment);
  const changed=initial.replace('update <- allow','update <- .owner = viewer').replace('body: text 1..80','body: text 1..100');
  writeFileSync(schema,changed);
  assert.match(run('deploy',deployment,'--check').stdout,/WARNING.*implication unproved.*notes.update/);
});

test('missing reference Unknown cannot suppress a loosening warning as Boolean equivalence', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=`use identity guests
table parents:
  owner: principal
  public
  online only
table notes:
  parent: parents
  body: text 1..80
  public
  insert <- allow
  update <- .parent.owner = viewer or .parent.owner != viewer
  online only
mutation add(parent: parents):
  return insert notes {parent, body: 'before'}
mutation edit(note: notes):
  update notes[note] {body: 'after'}
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);
  const added=await host.post('/m/add',{parent:'missing'});
  assert.equal(added.state,'sent',JSON.stringify(added));
  assert.equal((await host.post('/m/edit',{note:added.result.id})).why.code,'E_RULE');
  writeFileSync(schema,source.replace('update <- .parent.owner = viewer or .parent.owner != viewer','update <- allow'));
  const preview=run('deploy',deployment,'--check').stdout;
  assert.match(preview,/WARNING release 2 loosens notes.update; old:.*parents.*new: allow/);
  assert.doesNotMatch(preview,/keeps equivalent notes.update/);
  run('deploy',deployment);
  assert.equal((await host.post('/m/edit',{note:added.result.id})).state,'sent');
});

test('identity changes retain warnings and equivalent requirements keep their refusal contract', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  writeFileSync(schema,initial);run('deploy',deployment);
  writeFileSync(schema,initial.replace('identity guests','identity password').replace('update <- allow','update <- .owner = viewer'));
  assert.match(run('deploy',deployment,'--check').stdout,/WARNING.*implication unproved.*notes.update/);
  const guarded=initial.replace('  update notes[note]',"  require viewer = 'service:ops' else NOT_OPERATOR\n  update notes[note]");
  writeFileSync(schema,guarded);run('deploy',deployment);
  writeFileSync(schema,guarded.replace("viewer = 'service:ops'","'service:ops' = viewer"));
  assert.match(run('deploy',deployment,'--check').stdout,/note:.*keeps equivalent edit.require/);
  writeFileSync(schema,guarded.replace('else NOT_OPERATOR','else OPERATOR_REQUIRED'));
  assert.match(run('deploy',deployment,'--check').stdout,/WARNING.*implication unproved.*edit.require.*NOT_OPERATOR.*OPERATOR_REQUIRED/);
});

test('self-table read changes cannot certify a reference-rule tightening', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=`use identity guests
table nodes:
  owner: principal
  parent: nodes ?
  value: int default 0
  read <- .owner = viewer
  insert <- allow
  update <- .parent.owner != viewer
  online only
mutation add(id: id, owner: principal, parent: nodes ?):
  return insert nodes {id, owner, parent}
mutation bump(node: nodes):
  update nodes[node] {value: 1}
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);
  assert.equal((await host.post('/m/add',{id:'parent',owner:'service:other',parent:null})).state,'sent');
  assert.equal((await host.post('/m/add',{id:'child',owner:host.viewer,parent:'parent'})).state,'sent');
  assert.equal((await host.post('/m/bump',{node:'child'})).why.code,'E_RULE');
  const next=source.replace('read <- .owner = viewer','read <- allow').replace('update <- .parent.owner != viewer','update <- .parent.owner != viewer and .owner = viewer');
  writeFileSync(schema,next);
  const preview=run('deploy',deployment,'--check').stdout;
  assert.match(preview,/WARNING.*implication unproved.*nodes.update/);
  assert.doesNotMatch(preview,/note:.*tightens nodes.update/);
  run('deploy',deployment);
  assert.equal((await host.post('/m/bump',{node:'child'})).state,'sent');
});

test('equivalent conjunctions preserve first-failure association and local guard changes warn', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const guarded=initial.replace('  update notes[note]',"  require body != 'a' else FIRST\n  require body != 'b' else SECOND\n  update notes[note]");
  writeFileSync(schema,guarded);run('deploy',deployment);
  const host=await serve(t,deployment);
  const added=await host.post('/m/add',{body:'before'});
  const note=added.result.id;
  assert.equal((await host.post('/m/edit',{note,body:'a'})).why.code,'FIRST');
  const swapped=guarded.replace("body != 'a' else FIRST","body != 'b' else FIRST").replace("body != 'b' else SECOND","body != 'a' else SECOND");
  writeFileSync(schema,swapped);
  assert.match(run('deploy',deployment,'--check').stdout,/WARNING.*implication unproved.*edit.require/);
  run('deploy',deployment);
  assert.equal((await host.post('/m/edit',{note,body:'a'})).why.code,'SECOND');
  const local=initial.replace('  update notes[note]',"  allowed = body != 'blocked'\n  require allowed else BLOCKED\n  update notes[note]");
  writeFileSync(schema,local);run('deploy',deployment);
  assert.equal((await host.post('/m/edit',{note,body:'blocked'})).why.code,'BLOCKED');
  writeFileSync(schema,local.replace("allowed = body != 'blocked'",'allowed = true'));
  const preview=run('deploy',deployment,'--check').stdout;
  assert.match(preview,/WARNING.*implication unproved.*edit.require/);
  assert.match(preview,/old:.*allowed = \(body != 'blocked'\).*new:.*allowed = true/);
  run('deploy',deployment);
  assert.equal((await host.post('/m/edit',{note,body:'blocked'})).state,'sent');
});

test('leading program equality stays total for nullable scalar arguments', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=initial+`mutation nullable(note: notes, x: text <=10 ?):
  require x = 'a' or x != 'a' else BLOCKED
  update notes[note] {body: 'after'}
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);
  const added=await host.post('/m/add',{body:'before'});
  assert.equal((await host.post('/m/nullable',{note:added.result.id,x:null})).state,'sent');
  writeFileSync(schema,source.replace("x = 'a' or x != 'a'","x != 'a' or x = 'a'"));
  assert.match(run('deploy',deployment,'--check').stdout,/note:.*keeps equivalent nullable.require/);
});

test('nested guards display changed enclosing bindings across control-flow scopes', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=initial.replace('  update notes[note]',"  allowed = body != 'blocked'\n  if true:\n    require allowed else BLOCKED\n  update notes[note]");
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);
  const added=await host.post('/m/add',{body:'before'});
  assert.equal((await host.post('/m/edit',{note:added.result.id,body:'blocked'})).why.code,'BLOCKED');
  writeFileSync(schema,source.replace("allowed = body != 'blocked'",'allowed = true'));
  const preview=run('deploy',deployment,'--check').stdout;
  assert.match(preview,/WARNING.*implication unproved.*edit.require/);
  assert.match(preview,/old:.*\/then\/0 with allowed = \(body != 'blocked'\).*new:.*\/then\/0 with allowed = true/);
  run('deploy',deployment);
  assert.equal((await host.post('/m/edit',{note:added.result.id,body:'blocked'})).state,'sent');
});

test('the farm named-image tightening compares effective old/next rules and protects the reverse', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=initial.replace("enum('draft')","enum('draft', 'archived')").replace('update <- allow','update <- .owner = viewer')+`mutation transfer(note: notes, owner: principal):
  update notes[note] {owner}
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);
  const added=await host.post('/m/add',{body:'before'});
  const tight=source.replace('update <- .owner = viewer',"update (old, next) <- next.owner = viewer and old.owner = viewer and old.status != 'archived'");
  writeFileSync(schema,tight);
  const preview=run('deploy',deployment,'--check').stdout;
  assert.match(preview,/note: release 2 tightens notes.update/);
  assert.doesNotMatch(preview,/WARNING.*notes.update/);
  run('deploy',deployment);
  assert.match(run('rollback',deployment,'--to','1','--check').stdout,/WARNING release 1 loosens notes.update/);
  run('rollback',deployment,'--to','1');
  const other=await (await fetch(host.url+'/auth/guest',{method:'POST',body:'{}'})).json();
  const take=async()=> (await fetch(host.url+'/m/transfer',{method:'POST',headers:{authorization:'Bearer '+other.session.token,'content-type':'application/json'},body:JSON.stringify({args:{note:added.result.id,owner:other.session.principal}})})).json();
  assert.equal((await take()).why.code,'E_RULE');
  writeFileSync(schema,source.replace('update <- .owner = viewer','update (old, next) <- next.owner = viewer'));
  assert.match(run('deploy',deployment,'--check').stdout,/WARNING.*loosens notes.update/);
  run('deploy',deployment);
  assert.equal((await take()).state,'sent');
});

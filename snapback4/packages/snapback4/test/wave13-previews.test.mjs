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
// @ref LLP 3000.000.000#13-wave-13-preview-decisions — H9 noise budget and DT7 golden effects.
const probe = `use identity guests
table roles:
  principal: principal
  role: enum('captain', 'crew')
  unique principal, role
  immutable principal, role
  public
  online only
table notes:
  status: enum('draft') default 'draft'
  body: text <=80
  public
  insert <- allow
  online only
mutation add():
  require exists roles[principal = viewer, role = 'captain'] else NO
  return insert notes {body: 'one'}
mutation edit():
  require exists roles[principal = viewer, role = 'captain'] else NO
  return true
mutation remove():
  require exists roles[principal = viewer, role = 'captain'] else NO
  return true
`;
const additive = probe.replace("enum('draft')", "enum('draft', 'live')").replace('  body: text <=80', "  body: text <=80\n  color: text <=10 default 'none'")+`table audit:
  value: int
  public
  online only
`;

test('H9 additive preview-noise budget: unchanged probe guards print zero WARNINGs in both directions', t => {
  const {schema,deployment,run}=fixture(t);
  writeFileSync(schema,probe);run('deploy',deployment);
  writeFileSync(schema,additive);
  const deploy=run('deploy',deployment,'--check').stdout;
  assert.equal((deploy.match(/WARNING/g)??[]).length,0,deploy);
  assert.doesNotMatch(deploy,/\.require/);
  run('deploy',deployment);
  const rollback=run('rollback',deployment,'--to','1','--check').stdout;
  assert.equal((rollback.match(/WARNING/g)??[]).length,0,rollback);
  assert.doesNotMatch(rollback,/\.require/);
  const guide=run('guide','deploy').stdout;
  assert.ok(guide.indexOf('## Rollback after widening') < guide.indexOf('## Bridge a safety gate'));
  assert.ok(guide.indexOf('## Bridge a safety gate') < guide.indexOf('## What the old release sees'));
});

test('changed probe dependencies group guards once; unused probe columns and unrelated writes stay silent', t => {
  const {schema,deployment,run}=fixture(t);
  writeFileSync(schema,probe);run('deploy',deployment);
  writeFileSync(schema,probe.replace('  role: enum',"  label: text <=20 default 'staff'\n  role: enum"));
  assert.doesNotMatch(run('deploy',deployment,'--check').stdout,/WARNING|\.require/);
  writeFileSync(schema,probe.replace('  public\n  online only\ntable notes:',"  read <- .principal = viewer\n  online only\ntable notes:"));
  const changed=run('deploy',deployment,'--check').stdout;
  assert.equal((changed.match(/roles changed: 3 guards unproved across add, edit, remove/g)??[]).length,1,changed);
  assert.doesNotMatch(changed,/add.require|edit.require|remove.require/);
  // No guard warning when only a post-guard write changes.
  writeFileSync(schema,probe.replace("body: 'one'","body: 'other'"));
  assert.doesNotMatch(run('deploy',deployment,'--check').stdout,/WARNING|\.require/);
});

test('stable exists probes participate in leading Boolean implication', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe.replace('mutation edit():','mutation edit(ok: bool):');
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replace("mutation edit(ok: bool):\n  require exists roles[principal = viewer, role = 'captain']", "mutation edit(ok: bool):\n  require exists roles[principal = viewer, role = 'captain'] and ok"));
  assert.match(run('deploy',deployment,'--check').stdout,/note: release 2 tightens edit.require/);
});

const safety = `use identity guests
table parents:
  state: enum('clear', 'hold')
  public
  insert <- allow
  online only
table children:
  parent: parents
  public
  insert <- allow
  online only
mutation parent(id: id):
  return insert parents {id, state: 'hold'}
mutation child(id: id, parent: parents):
  return insert children {id, parent}
mutation book():
  require count(parents[] first 20 by .id) = 0 else HELD
  return true
mutation pay():
  require count(parents[] first 20 by .id) = 0 else HELD
  return true
query legsList():
  return parents first 20 by .id
query dayCount():
  return count(parents[] first 20 by .id)
query childList():
  return children first 20 by .id
`;

test('DT7 golden preview: query/count populations, dormant dependents, then grouped safety dependencies', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  writeFileSync(schema,safety);run('deploy',deployment);
  writeFileSync(schema,safety.replace("enum('clear', 'hold')","enum('clear', 'hold', 'inspection')").replace("state: 'hold'","state: 'inspection'"));run('deploy',deployment);
  const host=await serve(t,deployment);
  assert.equal((await host.post('/m/parent',{id:'p'})).state,'sent');
  assert.equal((await host.post('/m/child',{id:'c',parent:'p'})).state,'sent');
  await host.stop();
  const plan=JSON.parse(run('rollback',deployment,'--to','1','--check','--json').stdout);
  assert.deepEqual(plan.hazards.slice(0,4),[
    'queries/counts childList read children: active table population 1 → 0, 1 active row leaves; verify filtered results and progress denominators before selecting release 1 (dependency, not a query-result count)',
    'queries/counts dayCount, legsList read parents: active table population 1 → 0, 1 active row leaves; verify filtered results and progress denominators before selecting release 1 (dependency, not a query-result count)',
    'dependent children: 1 active row goes dormant with parent tables parents; preserve these linked records in a bridge or accept their absence in release 1',
    "release 1's safety dependencies on parents: `book`, `pay` cannot see 1 dormant parents row (sample ids [p]); verify refusal cases and preserve this gate in a bridge release or pause the workflow (guide deploy; dependency, not a predicate match)",
  ]);
  const text=run('rollback',deployment,'--to','1','--check').stdout;
  assert.ok(text.indexOf('WARNING queries/counts') < text.indexOf('tables.parents.columns.state'));
  assert.equal(plan.plan.items.filter(i=>i.kind==='rows').reduce((n,i)=>n+i.rows,0),2);
  run('rollback',deployment,'--to','1');
  const again=JSON.parse(run('rollback',deployment,'--to','1','--check','--json').stdout);
  assert.ok(!again.hazards.some(h=>h.includes('active rows leave')||h.startsWith('dependent')));
});

test('deploy and hot receipts report exact literal backfills, excluding explicit fields', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=safety.replace("state: enum('clear', 'hold')", "state: enum('clear', 'hold')\n  color: text <=10 default 'none'");
  writeFileSync(schema,safety);run('deploy',deployment);
  const host=await serve(t,deployment);
  for(const id of ['one','two'])assert.equal((await host.post('/m/parent',{id})).state,'sent');
  writeFileSync(schema,source);
  const plan=JSON.parse(run('deploy',deployment,'--check','--json').stdout);
  assert.deepEqual(plan.backfills,["parents.color ← 'none' on 2 rows"]);
  assert.match(run('deploy',deployment).stdout,/backfill: parents.color ← 'none' on 2 rows/);
  assert.equal((await host.post('/m/parent',{id:'explicit'})).state,'sent');
  await host.stop();
  writeFileSync(schema,source.replace("default 'none'","default 'blue'"));
  assert.deepEqual(JSON.parse(run('deploy',deployment,'--check','--json').stdout).backfills,["parents.color ← 'blue' on 2 rows"]);
  assert.match(run('deploy',deployment).stdout,/backfill: parents.color ← 'blue' on 2 rows/);
});

test('one changed dependency counts only the guards it affects, and a function body cannot hide behind an unchanged call', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe.replace('mutation edit():',"fn allowed(): true\nmutation edit():").replaceAll("  require exists roles[principal = viewer, role = 'captain'] else NO\n  return true", "  require exists roles[principal = viewer, role = 'captain'] else NO\n  require allowed() else BLOCKED\n  return true");
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replace('fn allowed(): true','fn allowed(): false'));
  const changed=run('deploy',deployment,'--check').stdout;
  assert.match(changed,/compiled guard changed: 2 guards unproved across edit, remove/);
  writeFileSync(schema,source.replace('  public\n  online only\ntable notes:',"  read <- .principal = viewer\n  online only\ntable notes:"));
  const deps=run('deploy',deployment,'--check').stdout;
  assert.match(deps,/roles changed: 3 guards unproved across add, edit, remove/);
});

test('optional defaults do not invent historical backfills in preview, cold or hot receipts', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  writeFileSync(schema,safety);run('deploy',deployment);
  const host=await serve(t,deployment);
  assert.equal((await host.post('/m/parent',{id:'old'})).state,'sent');
  const optional=safety.replace("state: enum('clear', 'hold')", "state: enum('clear', 'hold')\n  color: text <=10 ? default 'red'");
  writeFileSync(schema,optional);
  assert.deepEqual(JSON.parse(run('deploy',deployment,'--check','--json').stdout).backfills,[]);
  assert.deepEqual(JSON.parse(run('deploy',deployment,'--json').stdout).backfills,[]);
  assert.equal((await host.post('/q/legsList',{})).data[0].color,null);
  await host.stop();
  writeFileSync(schema,optional.replace("default 'red'","default 'blue'"));
  assert.deepEqual(JSON.parse(run('deploy',deployment,'--json').stdout).backfills,[]);
});

test('removing an unconsulted narrowing column can restore a probe row and must change guard dependencies', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=`use identity guests
table gates:
  state: enum('hold', 'inspection')
  public
  insert <- allow
  online only
mutation add():
  return insert gates {id: 'gate', state: 'inspection'}
mutation book(item: gates):
  require exists gates[item] else MISSING
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);assert.equal((await host.post('/m/add',{})).state,'sent');
  writeFileSync(schema,source.replace("enum('hold', 'inspection')","enum('hold')").replace("state: 'inspection'","state: 'hold'"));run('deploy',deployment);
  assert.equal((await host.post('/m/book',{item:'gate'})).why.code,'MISSING');
  const dropped=source.replace("  state: enum('hold', 'inspection')\n",'').replace(", state: 'inspection'",'');
  writeFileSync(schema,dropped);
  const preview=run('deploy',deployment,'--check').stdout;
  assert.match(preview,/gates changed: 1 guard unproved across book/);
  run('deploy',deployment);
  assert.equal((await host.post('/m/book',{item:'gate'})).state,'sent');
  await host.stop();
});

test('short-circuit alternatives remain guard dependencies, while unused arguments do not', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`table delegates:
  principal: principal
  unique principal
  immutable principal
  public
  online only
mutation approve():
  require exists roles[principal = viewer, role = 'captain'] or exists delegates[viewer] else NO
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replace('mutation edit():','mutation edit(unused: bool ?):'));
  assert.doesNotMatch(run('deploy',deployment,'--check').stdout,/WARNING|edit.require/);
  writeFileSync(schema,source.replace('  immutable principal\n  public','  immutable principal\n  read <- .principal = viewer'));
  assert.match(run('deploy',deployment,'--check').stdout,/delegates changed: 1 guard unproved across approve/);
});

test('row-presence guards and field guards ignore new unconsulted defaulted columns', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`mutation publish(note: notes):
  n = notes[note]! else NOT_FOUND
  require n.body != 'blocked' else BLOCKED
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replace('  body: text <=80',"  body: text <=80\n  label: text <=20 default 'label'"));
  assert.doesNotMatch(run('deploy',deployment,'--check').stdout,/WARNING|publish.require/);
  writeFileSync(schema,source.replace('  body: text <=80','  body: text <=90'));
  assert.match(run('deploy',deployment,'--check').stdout,/notes changed: 2 guards unproved across publish/);
});

test('same-transaction writes are guard inputs only when they reach a consulted table', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`mutation prepare():
  insert roles {principal: viewer, role: 'captain'}
  require exists roles[principal = viewer, role = 'captain'] else NO
  return true
mutation unrelated():
  insert notes {body: 'first'}
  require exists roles[principal = viewer, role = 'captain'] else NO
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replace("insert roles {principal: viewer, role: 'captain'}", "insert roles {principal: viewer, role: 'crew'}").replace("body: 'first'","body: 'second'"));
  const plan=run('deploy',deployment,'--check').stdout;
  assert.match(plan,/compiled guard changed: 1 guard unproved across prepare/);
  assert.doesNotMatch(plan,/unrelated.require|across unrelated/);
});

test('equal branch assignments and list accumulation cannot suppress a changed guard', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`mutation branch(flag: bool):
  ok = false
  if flag:
    ok = false
  else:
    ok = false
  require ok else BLOCKED
  return true
mutation accumulated():
  xs = []
  for role in roles first 10 by .id:
    xs = xs + [role.id]
  require count(xs) = 0 else HELD
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replaceAll('    ok = false','    ok = true'));
  assert.match(run('deploy',deployment,'--check').stdout,/compiled guard changed: 1 guard unproved across branch/);
  writeFileSync(schema,source.replace('  public\n  online only\ntable notes:',"  read <- deny\n  online only\ntable notes:"));
  const changed=run('deploy',deployment,'--check').stdout;
  assert.match(changed,/roles changed: 4 guards unproved across accumulated, add, edit, remove/);
});

test('maintained parent fields lead guard and user-effect narration to their source populations', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=`use identity guests
table parents:
  holdCount: count holds by parent
  public
  insert <- allow
  online only
table holds:
  parent: parents
  state: enum('hold', 'inspection')
  public
  insert <- allow
  online only
mutation parent():
  return insert parents {id: 'parent'}
mutation hold():
  return insert holds {parent: 'parent', state: 'inspection'}
mutation book():
  p = parents['parent']! else MISSING
  require p.holdCount = 0 else HELD
  return true
query total():
  return parents['parent']
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);
  assert.equal((await host.post('/m/parent',{})).state,'sent');
  assert.equal((await host.post('/m/hold',{})).state,'sent');
  assert.equal((await host.post('/m/book',{})).why.code,'HELD');
  writeFileSync(schema,source.replace("enum('hold', 'inspection')","enum('hold')").replace("state: 'inspection'","state: 'hold'"));
  const plan=JSON.parse(run('deploy',deployment,'--check','--json').stdout);
  assert.ok(plan.hazards.some(h=>h.startsWith('queries/counts total read holds: active table population 1 → 0')),JSON.stringify(plan.hazards));
  assert.ok(plan.hazards.some(h=>h.includes('safety dependencies on holds: `book`')),JSON.stringify(plan.hazards));
  assert.ok(plan.hazards.some(h=>h.includes('holds changed: 1 guard unproved across book')),JSON.stringify(plan.hazards));
  run('deploy',deployment);
  assert.equal((await host.post('/m/book',{})).state,'sent');
  assert.equal((await host.post('/q/total',{})).data.holdCount,0);
  await host.stop();
});

test('earlier conditional writes retain their own read dependencies transitively', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`table permissions:
  principal: principal
  unique principal
  public
  online only
mutation prepareRole():
  if exists permissions[viewer]:
    insert roles {principal: viewer, role: 'captain'}
  require exists roles[principal = viewer, role = 'captain'] else NO
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replace('  unique principal\n  public','  unique principal\n  read <- deny'));
  assert.match(run('deploy',deployment,'--check').stdout,/permissions changed: 1 guard unproved across prepareRole/);
});

test('loop guards depend on the element type of used argument lists', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`mutation fromList(values: [int] <=3):
  for value in values:
    require value >= 0 else NEGATIVE
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replace('[int] <=3','[int 0..10] <=3'));
  assert.match(run('deploy',deployment,'--check').stdout,/arguments changed: 1 guard unproved across fromList/);
});

test('tightening preserves warnings for changed codes/messages and first-failure regions', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`mutation guarded(ok: bool, extra: bool, third: bool):
  require ok else OLD
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replace('require ok else OLD','require ok and extra else NEW'));
  const renamed=run('deploy',deployment,'--check').stdout;
  assert.match(renamed,/WARNING.*guarded.require.*OLD.*NEW/);
  assert.doesNotMatch(renamed,/note:.*tightens guarded.require/);
  const ordered=source.replace('require ok else OLD','require ok else FIRST\n  require extra else SECOND');
  writeFileSync(schema,ordered);run('deploy',deployment);
  writeFileSync(schema,ordered.replace('require ok else FIRST','require ok and third else FIRST'));
  assert.match(run('deploy',deployment,'--check').stdout,/WARNING.*guarded.require/);
});

test('optional-null narrowing retains rows dormant and never invents a literal backfill', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  writeFileSync(schema,safety);run('deploy',deployment);
  const host=await serve(t,deployment);assert.equal((await host.post('/m/parent',{id:'legacy'})).state,'sent');
  const optional=safety.replace("state: enum('clear', 'hold')", "state: enum('clear', 'hold')\n  color: text <=10 ? default 'red'");
  writeFileSync(schema,optional);run('deploy',deployment);
  assert.equal((await host.post('/q/legsList',{})).data[0].color,null);
  writeFileSync(schema,optional.replace("text <=10 ? default 'red'","text <=10 default 'red'"));
  const projected=JSON.parse(run('deploy',deployment,'--check','--json').stdout);
  assert.deepEqual(projected.backfills,[]);
  assert.ok(projected.plan.items.some(i=>i.path==='parents' && i.rows===1),JSON.stringify(projected.plan.items));
  assert.deepEqual(JSON.parse(run('deploy',deployment,'--json').stdout).backfills,[]);
  assert.deepEqual((await host.post('/q/legsList',{})).data,[]);await host.stop();
});

test('later loop iterations include carried guard assignments', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`mutation repeated(values: [int] <=2):
  ok = true
  for value in values:
    require ok else BLOCKED
    ok = false
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);
  assert.equal((await host.post('/m/repeated',{values:[1,2]})).why.code,'BLOCKED');
  writeFileSync(schema,source.replace('    ok = false','    ok = true'));
  assert.match(run('deploy',deployment,'--check').stdout,/compiled guard changed: 1 guard unproved across repeated/);
  run('deploy',deployment);
  assert.equal((await host.post('/m/repeated',{values:[1,2]})).state,'sent');await host.stop();
});

test('earlier deletes include reference cascade/keep policies used by a later guard', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=`use identity guests
table parents:
  value: int
  public
  insert <- allow
  delete <- allow
  online only
table children:
  parent: parents on delete cascade
  unique parent
  public
  insert <- allow
  online only
mutation seed():
  insert parents {id: 'p', value: 1}
  insert children {id: 'c', parent: 'p'}
mutation remove():
  delete parents['p']
  require exists children[id = 'c'] else MISSING
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);assert.equal((await host.post('/m/seed',{})).state,'sent');
  assert.equal((await host.post('/m/remove',{})).why.code,'MISSING');
  writeFileSync(schema,source.replace('on delete cascade','on delete keep'));
  assert.match(run('deploy',deployment,'--check').stdout,/children changed: 1 guard unproved across remove/);
  run('deploy',deployment);assert.equal((await host.post('/m/remove',{})).state,'sent');await host.stop();
});

test('conditional loop-carried assignments retain their control reads through local bindings', t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`table permissions:
  principal: principal
  unique principal
  public
  online only
mutation conditional(values: [int] <=2):
  ok = true
  for value in values:
    require ok else BLOCKED
    permission = exists permissions[viewer]
    if permission:
      ok = false
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  writeFileSync(schema,source.replace('  unique principal\n  public','  unique principal\n  read <- deny'));
  assert.match(run('deploy',deployment,'--check').stdout,/permissions changed: 1 guard unproved across conditional/);
});

test('an effect retains its incoming condition when both branches overwrite that binding', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe.replace('  public\n  online only\ntable notes:', '  public\n  insert <- allow\n  delete <- allow\n  online only\ntable notes:')+`table permissions:
  principal: principal
  unique principal
  public
  insert <- allow
  online only
mutation permit():
  return insert permissions {principal: viewer}
mutation clear():
  role = roles[principal = viewer, role = 'captain']! else MISSING
  delete roles[role.id]
mutation prepareRole():
  permission = exists permissions[viewer]
  if permission:
    insert roles {principal: viewer, role: 'captain'}
    permission = false
  else:
    permission = false
  require exists roles[principal = viewer, role = 'captain'] else NO
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);assert.equal((await host.post('/m/permit',{})).state,'sent');
  assert.equal((await host.post('/m/prepareRole',{})).state,'sent');assert.equal((await host.post('/m/clear',{})).state,'sent');
  writeFileSync(schema,source.replace('  unique principal\n  public','  unique principal\n  read <- deny'));
  assert.match(run('deploy',deployment,'--check').stdout,/permissions changed: 1 guard unproved across prepareRole/);
  run('deploy',deployment);assert.equal((await host.post('/m/prepareRole',{})).why.code,'NO');await host.stop();
});

test('loop exit conditions remain dependencies of later iteration guards', {timeout:hangBudget(4)}, async t => {
  const {schema,deployment,run}=fixture(t);
  const source=probe+`table permissions:
  principal: principal
  unique principal
  public
  insert <- allow
  online only
mutation permit():
  return insert permissions {principal: viewer}
mutation repeated(values: [int] <=2):
  ok = true
  for value in values:
    require ok else BLOCKED
    if exists permissions[viewer]:
      return true
    ok = false
  return true
`;
  writeFileSync(schema,source);run('deploy',deployment);
  const host=await serve(t,deployment);assert.equal((await host.post('/m/permit',{})).state,'sent');
  assert.equal((await host.post('/m/repeated',{values:[1,2]})).state,'sent');
  writeFileSync(schema,source.replace('  unique principal\n  public','  unique principal\n  read <- deny'));
  assert.match(run('deploy',deployment,'--check').stdout,/permissions changed: 1 guard unproved across repeated/);
  run('deploy',deployment);assert.equal((await host.post('/m/repeated',{values:[1,2]})).why.code,'BLOCKED');await host.stop();
});

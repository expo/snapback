import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const legacy = process.env.SNAPBACK4_F2_LEGACY_BIN;
const source = `use personas alice
table posts:
  authorId: principal
  immutable authorId
  read <- allow
  sync public
table likes:
  postId: posts
  immutable postId
  read <- allow
  sync public
maintain totals: count likes by postId.authorId
  read <- allow
query totals():
  return totals first 10 by byGroup
`;

test('published 0.2.33 rejects F2 stores, serving, backend opening and device adoption', {
  skip: !legacy && 'set SNAPBACK4_F2_LEGACY_BIN to the published 0.2.33 platform binary', timeout: 90_000,
}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-recorded-compatibility-'));
  const children = [];
  t.after(async () => {
    for (const {child, exited} of children) { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; }
    rmSync(dir, {recursive:true, force:true});
  });
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), source);
  const run = (bin, args, input = '') => spawnSync(bin, args, {cwd:dir, input, encoding:'utf8', timeout:20_000});
  const version = run(legacy, ['--version']);
  assert.match(version.stdout, /snapback4 0\.2\.33/);
  const child = spawn(binary, ['dev','--no-watch','--port','0'], {cwd:dir, stdio:['ignore','pipe','pipe']});
  const exited = once(child, 'exit'); children.push({child,exited});
  let log = '';
  for (const stream of [child.stdout,child.stderr]) stream.on('data', data => {log += data;});
  let url;
  for (let i=0; i<1500; i++) {
    url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) break;
    assert.equal(child.exitCode,null,log); await delay(20);
  }
  assert.ok(url, log);
  const seeded = await fetch(url+'/seed', {method:'POST',headers:{'x-snapback-persona':'alice'},body:JSON.stringify([{table:'posts',row:{id:'p',authorId:'dev:alice'}},{table:'likes',row:{id:'l',postId:'p'}}])});
  assert.equal(seeded.status,200,await seeded.text());
  const response = await fetch(url+'/schema', {headers:{'x-snapback-persona':'alice'}});
  assert.equal(response.status,200);
  const payload = await response.json();
  const backend = payload.backend ?? payload;
  assert.ok(backend.schema?.tables.likes.recorded, JSON.stringify(payload));
  writeFileSync(join(dir,'backend.json'),JSON.stringify(backend));
  const rejected = result => {
    assert.notEqual(result.status,0, result.stdout+result.stderr);
    assert.match(result.stdout+result.stderr,/unknown variant [`'"]?Recorded/, result.stdout+result.stderr);
  };
  rejected(run(legacy,['device',join(dir,'old-open/device.sqlite'),'backend.json']));
  const stripped = structuredClone(backend);
  for (const table of Object.values(stripped.schema.tables)) table.constraints = table.constraints.filter(c => c !== 'Recorded');
  writeFileSync(join(dir,'unmarked.json'),JSON.stringify(stripped));
  // Positive control: only the strict marker distinguishes this simple F2
  // backend from a schema the old decoder silently accepted.
  const old = run(legacy,['device',join(dir,'old-adopt/device.sqlite'),'unmarked.json'], JSON.stringify({op:'adopt',backend})+'\n');
  const replies = old.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(replies[0].ok,old.stdout+old.stderr);
  assert.ok(replies.at(-1).denied,old.stdout+old.stderr);
  assert.match(JSON.stringify(replies.at(-1)),/unknown variant [`'"]?Recorded/);
  child.kill(); await exited;
  // Doctor opens the active stored generation without adopting caller source.
  const opened = run(legacy,['doctor','--store',join(dir,'.snapback4/store.sqlite')]);
  assert.notEqual(opened.status,0,opened.stdout+opened.stderr);
  assert.match(opened.stdout+opened.stderr,/invalid stored schema.*unknown variant [`'"]?Recorded/);
  const deployed = run(binary,['deploy',join(dir,'release')]);
  assert.equal(deployed.status,0,deployed.stdout+deployed.stderr);
  // Use source the old compiler understands, so serving must refuse the
  // stored F2 generation rather than merely refusing the new Quarry syntax.
  writeFileSync(join(dir,'release/releases/1/snapback/schema.q'),source.split('maintain totals:')[0]);
  rejected(run(legacy,['serve',join(dir,'release'),'--port','0']));
  const database = new DatabaseSync(join(dir,'.snapback4/store.sqlite'));
  database.exec("UPDATE r SET data = 'not-json' WHERE t = (SELECT num FROM _catalog WHERE name = 'likes')");
  database.close();
  const doctor = run(binary,['doctor','--store',join(dir,'.snapback4/store.sqlite')]);
  assert.notEqual(doctor.status,0,doctor.stdout+doctor.stderr);
  assert.match(doctor.stdout+doctor.stderr,/attribution FAIL/);
});

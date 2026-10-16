import {recordedCompatibility} from './helpers/schema-capability-fixtures.mjs';
import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState } from './helpers/wait.mjs';
import { hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const legacy = process.env.SNAPBACK4_F2_LEGACY_BIN;
const source = recordedCompatibility.source;

test('published 0.2.33 rejects F2 stores, serving, backend opening and device adoption', {
  skip: !legacy && 'set SNAPBACK4_F2_LEGACY_BIN to the published 0.2.33 platform binary', timeout: hangBudget(14),
}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-recorded-compatibility-'));
  const children = [];
  t.after(async () => {
    for (const {child, exited} of children) { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited; }
    rmSync(dir, {recursive:true, force:true});
  });
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), source);
  const run = (bin, args, input = '', cwd = dir) => spawnSync(bin, args, {cwd, input, encoding:'utf8', timeout:hangBudget()});
  const version = run(legacy, ['--version']);
  assert.equal(createHash('sha256').update(readFileSync(legacy)).digest('hex'),'6a7b34e8fe4b4e142a44aaeac37ddd76c8b5ebccff290088f290bb3770a710f6','published darwin-arm64 0.2.33 bytes');
  assert.match(version.stdout, /snapback4 0\.2\.33/);
  const child = spawn(binary, ['dev','--no-watch','--port','0'], {cwd:dir, stdio:['ignore','pipe','pipe']});
  const readStdout = captureStdout(child);
  const exited = once(child, 'exit'); children.push({child,exited});
  let log = '';
  for (const stream of [child.stdout,child.stderr]) stream.on('data', data => {log += data;});
  let url;
  url = await awaitState(() => { assert.equal(child.exitCode,null,log); return readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; }, "compatibility server", { diagnostics: () => log });
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
    assert.match(result.stdout+result.stderr,/unknown variant [`'"]?Capabilities/, result.stdout+result.stderr);
  };
  rejected(run(legacy,['device',join(dir,'old-open/device.sqlite'),'backend.json']));
  const constraints = Object.values(backend.schema.tables).flatMap(table => table.constraints);
  assert.ok(!constraints.some(c => c === 'Recorded' || c === 'Capabilities'));
  assert.deepEqual(constraints.filter(c => c?.Capabilities), [{Capabilities:recordedCompatibility.capabilities}]);
  const stripped = structuredClone(backend);
  for (const table of Object.values(stripped.schema.tables)) table.constraints = table.constraints.filter(c => !c?.Capabilities);
  assert.ok(Object.values(stripped.schema.tables).every(table => !table.constraints.some(c => c === 'Recorded' || c === 'Capabilities' || c?.Capabilities)));
  writeFileSync(join(dir,'unmarked.json'),JSON.stringify(stripped));
  // Positive control: only the strict marker distinguishes this simple F2
  // backend from a schema the old decoder silently accepted.
  const old = run(legacy,['device',join(dir,'old-adopt/device.sqlite'),'unmarked.json'], JSON.stringify({op:'adopt',backend})+'\n');
  const replies = old.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(old.status,0,old.stdout+old.stderr);
  assert.equal(replies.length,2,old.stdout+old.stderr);
  assert.ok(replies[0].ok,old.stdout+old.stderr);
  assert.equal(replies[0].denied,undefined);
  assert.ok(replies.at(-1).denied,old.stdout+old.stderr);
  assert.match(JSON.stringify(replies.at(-1)),/unknown variant [`'"]?Capabilities/);
  child.kill(); await exited;
  // Doctor opens the active stored generation without adopting caller source.
  const opened = run(legacy,['doctor','--store',join(dir,'.snapback4/store.sqlite')]);
  assert.notEqual(opened.status,0,opened.stdout+opened.stderr);
  assert.match(opened.stdout+opened.stderr,/invalid stored schema.*unknown variant [`'"]?Capabilities/);
  const deployed = run(binary,['deploy',join(dir,'release')]);
  assert.equal(deployed.status,0,deployed.stdout+deployed.stderr);
  // Use source the old compiler understands, so serving must refuse the
  // stored F2 generation rather than merely refusing the new Quarry syntax.
  writeFileSync(join(dir,'release/releases/1/snapback/schema.q'),source.split('maintain totals:')[0]);
  rejected(run(legacy,['serve',join(dir,'release'),'--port','0']));
  const plain = join(dir,'plain');
  mkdirSync(join(plain,'snapback'),{recursive:true});
  writeFileSync(join(plain,'snapback/schema.q'),source.split('maintain totals:')[0]);
  const start = async (bin,args,cwd) => {
    const child=spawn(bin,args,{cwd,stdio:['ignore','pipe','pipe']});
    const readStdout = captureStdout(child);
    const exited=once(child,'exit'); children.push({child,exited});
    let log=''; for (const stream of [child.stdout,child.stderr]) stream.on('data',data=>{log+=data;});
    const url = await awaitState(() => { assert.equal(child.exitCode,null,log); return readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; }, "compatibility server", { diagnostics: () => log });
    return {child,exited,url};
  };
  const plainDev=await start(binary,['dev','--no-watch','--port','0'],plain);
  const plainResponse=await fetch(plainDev.url+'/schema',{headers:{'x-snapback-persona':'alice'}});
  assert.equal(plainResponse.status,200);
  const plainPayload=await plainResponse.json(); const plainBackend=plainPayload.backend??plainPayload;
  assert.ok(Object.values(plainBackend.schema.tables).every(table=>!Object.keys(table.recorded??{}).length && !table.constraints.some(c => c === 'Recorded' || c === 'Capabilities' || c?.Capabilities)));
  writeFileSync(join(plain,'backend.json'),JSON.stringify(plainBackend));
  plainDev.child.kill();await plainDev.exited;
  const accepted=run(legacy,['device',join(plain,'device.sqlite'),'backend.json'],JSON.stringify({op:'adopt',backend:plainBackend})+'\n',plain);
  assert.equal(accepted.status,0,accepted.stdout+accepted.stderr);
  const acceptedReplies=accepted.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(acceptedReplies.length,2);assert.ok(acceptedReplies.every(reply=>Object.hasOwn(reply,'ok') && !reply.denied));
  const plainDoctor=run(legacy,['doctor','--store',join(plain,'.snapback4/store.sqlite')],'',plain);
  assert.equal(plainDoctor.status,0,plainDoctor.stdout+plainDoctor.stderr);
  const plainDeploy=run(binary,['deploy',join(plain,'release')],'',plain);
  assert.equal(plainDeploy.status,0,plainDeploy.stdout+plainDeploy.stderr);
  const plainServe=await start(legacy,['serve',join(plain,'release'),'--port','0'],plain);
  plainServe.child.kill();await plainServe.exited;
  const database = new DatabaseSync(join(dir,'.snapback4/store.sqlite'));
  database.exec("UPDATE r SET data = 'not-json' WHERE t = (SELECT num FROM _catalog WHERE name = 'likes')");
  database.close();
  const doctor = run(binary,['doctor','--store',join(dir,'.snapback4/store.sqlite')]);
  assert.notEqual(doctor.status,0,doctor.stdout+doctor.stderr);
  assert.match(doctor.stdout+doctor.stderr,/attribution FAIL/);
});

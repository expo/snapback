import {mkdtempSync,writeFileSync,readFileSync,rmSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {runFile} from '/home/ccheever/sb4-intent/lane-qf/snapback4/scripts/run-client-tests.mjs';
import {processTable,identity,live} from '/home/ccheever/sb4-intent/lane-qf/snapback4/scripts/test-processes.mjs';
const out='/home/ccheever/sb4-intent/lane-qf/snapback4/reports/20261002-qf-qualification-flakes/round2/';
const dir=mkdtempSync(join(tmpdir(),'qf-r2-real-stall-')),file=join(dir,'stall.test.mjs'),pidFile=join(dir,'orphan');
writeFileSync(file,`import test from 'node:test';import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';test('deliberate no-progress fixture',()=>{writeFileSync(${JSON.stringify(pidFile)},execFileSync('/bin/sh',['-c','sleep 1800 </dev/null >/dev/null 2>&1 & echo $!'])); console.log('REAL_STALL_READY'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);});`);
let group;const started=new Date().toISOString();
try {
 const result=await runFile(file,{onStart:child=>{group=child.pid;writeFileSync('/tmp/qf-r2-stall-group',String(group))},onOutput:text=>appendFileSync(out+'stall.log',text)});
 const orphan=identity(Number(readFileSync(pidFile,'utf8')));
 const survivors=processTable().filter(row=>row.alive&&row.group===group);
 const record={started,finished:new Date().toISOString(),result,survivors,orphanAlive:!!orphan&&live(orphan)};
 writeFileSync(out+'stall.json',JSON.stringify(record,null,2)+'\n');
 assert.equal(result.reason,'TEST_FILE_HANG'); assert.equal(result.stallMs,900000); assert.equal(result.passed,false);
 assert.ok(result.elapsed>=900000&&result.elapsed<915000,JSON.stringify(record));
 assert.deepEqual(survivors,[]);assert.equal(record.orphanAlive,false);
 console.log(record);
}finally{rmSync(dir,{recursive:true,force:true});}

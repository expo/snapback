import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
const moduleURL = process.env.SNAPBACK4_TEST_WORKER_LEDGER ?? new URL('../dist/worker-ledger.js', import.meta.url).href;
const {WorkerLedger} = await import(moduleURL);

for (const abort of [false, true]) test(`two processes retain a completed receipt across a real busy COMMIT${abort ? ' after cancellation' : ''}`, {timeout:10_000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-ledger-commit-'));
  const children = [];
  t.after(async () => {
    for (const s of children) { if (s.child.exitCode === null) s.child.kill('SIGKILL'); await s.done; }
    rmSync(dir, {recursive:true,force:true});
  });
  const script = join(dir, 'worker.mjs');
  writeFileSync(script, `
import {WorkerLedger} from ${JSON.stringify(moduleURL)};
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
const exec=DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec=function(sql){
  try {return exec.call(this,sql);}
  catch(error){if(error.errcode===5) process.send({event:'busy',sql});throw error;}
};
const stop=new AbortController();
process.on('message',message=>{if(message==='abort')stop.abort();});
const ledger=await WorkerLedger.open('ledger.sqlite',stop.signal);
process.send({event:'ready'});
await once(process,'message');
try {
  const result=await ledger.run('same-effect',async()=>{
    process.send({event:'performed'});
    await once(process,'message');
    return 'original-receipt';
  },stop.signal);
  process.send({event:'result',result});
} catch(error) { process.send({event:'error',error:String(error)}); }
ledger.close();process.disconnect();
`);
  const start = name => {
    const child = fork(script, [name], {cwd:dir,stdio:['ignore','ignore','pipe','ipc']});
    const s = {child,done:once(child,'exit'),events:[],log:''};
    child.on('message', message => s.events.push(message));
    child.stderr.on('data', bytes => {s.log += bytes;}); children.push(s); return s;
  };
  const wait = async (s, predicate) => {
    for (let n=0;n<1000;n++) {const found=s.events.find(predicate);if(found)return found;await sleep(5);}
    assert.fail(JSON.stringify(s.events)+' '+s.log);
  };
  const first=start('first'), second=start('second');
  await Promise.all([first,second].map(s=>wait(s,e=>e.event==='ready')));
  const reader = new DatabaseSync(join(dir,'ledger.sqlite'));
  try {
    first.child.send('run'); await wait(first,e=>e.event==='performed');
    reader.exec('BEGIN'); reader.prepare('SELECT * FROM completions').all();
    first.child.send('finish-provider');
    // This is SQLite's real lock result, not an injected COMMIT failure.
    await wait(first,e=>e.event==='busy' && e.sql==='COMMIT');
    if (abort) first.child.send('abort', () => {});
    second.child.send('run');
    await wait(second,e=>e.event==='busy' || e.event==='performed');
    // Keep the real reader through more than 100 failed commit attempts, so
    // a large retry cap cannot silently discard the completed receipt.
    await wait(first,e=>e.event==='error' || (e.event==='busy' && first.events.filter(e=>e.event==='busy' && e.sql==='COMMIT').length>=110));
    reader.exec('ROLLBACK');
    const secondOutcome = await wait(second,e=>['performed','result','error'].includes(e.event));
    if (secondOutcome.event==='performed') second.child.send('finish-provider');
  } finally {reader.close();}
  await Promise.all(children.map(s=>s.done));
  const events=children.flatMap(s=>s.events);
  t.diagnostic(JSON.stringify(children.map(s=>s.events)));
  assert.deepEqual(events.filter(e=>e.event==='error'), [], 'ordinary contention must retain the completed transaction');
  assert.equal(events.filter(e=>e.event==='performed').length, 1);
  assert.deepEqual(events.filter(e=>e.event==='result').map(e=>e.result), ['original-receipt','original-receipt']);
  const reopened=await WorkerLedger.open(join(dir,'ledger.sqlite'),new AbortController().signal);
  try {assert.equal(await reopened.run('same-effect',async()=>assert.fail('receipt lost after process exit'),new AbortController().signal),'original-receipt');}
  finally {reopened.close();}
});

test('aborting a waiter blocked on SQLITE_BUSY prevents its handler after the lock is released', async t => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-ledger-abort-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'ledger.sqlite'), stop=new AbortController();
  const ledger=await WorkerLedger.open(path,stop.signal), holder=new DatabaseSync(path);
  let busy, calls=0;
  const blocked=new Promise(resolve=>{busy=resolve;});
  const exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    try {return exec.call(this,sql);}
    catch(error){if(error.errcode===5)busy();throw error;}
  });
  holder.exec('BEGIN IMMEDIATE');
  try {
    const pending=ledger.run('aborted',async()=>{calls++;return 'wrong';},stop.signal);
    const result=pending.then(value=>({value}),error=>({error}));
    await blocked;
    stop.abort(); holder.exec('ROLLBACK');
    const settled=await result;
    assert.equal(settled.error?.name,'AbortError');
    assert.equal(calls,0);
    assert.equal(holder.prepare('SELECT count(*) n FROM completions').get().n,0);
  } finally {holder.close();ledger.close();}
});

test('aborting initialization blocked on SQLITE_BUSY rejects after the writer lock is released', {timeout:5_000}, async t => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-ledger-open-abort-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'ledger.sqlite'), stop=new AbortController(), holder=new DatabaseSync(path);
  let busy;
  const blocked=new Promise(resolve=>{busy=resolve;});
  const exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    try {return exec.call(this,sql);}
    catch(error){if(error.errcode===5)busy();throw error;}
  });
  holder.exec('BEGIN IMMEDIATE');
  try {
    const pending=WorkerLedger.open(path,stop.signal);
    const result=pending.then(value=>({value}),error=>({error}));
    await blocked;
    stop.abort(); holder.exec('ROLLBACK');
    const settled=await result;
    // Close even a mutant's successful open before reporting the failure.
    settled.value?.close();
    assert.equal(settled.error?.name,'AbortError');
    assert.equal(holder.prepare("SELECT count(*) n FROM sqlite_master WHERE name='completions'").get().n,0);
  } finally {holder.close();}
});

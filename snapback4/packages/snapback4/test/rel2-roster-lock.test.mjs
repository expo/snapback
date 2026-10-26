import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {rosterLock} from '../dist/proof-roster-lock.js';
const moduleUrl=new URL('../dist/proof-roster-lock.js',import.meta.url).href;
function fixture(t){const root=mkdtempSync(join(tmpdir(),'rel2-lock-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return join(root,'roster.json.lock');}

test('roster records a private holder and renewable lease; a legacy marker is reclaimable',t=>{
 const path=fixture(t);writeFileSync(path,'',{mode:0o600});
 const lock=rosterLock(path);
 try {
  const held=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(held.holder.pid,process.pid);assert.ok(held.holder.host);assert.ok(held.token);
  assert.ok(held.lease.expiresAt>held.lease.renewedAt);assert.equal(statSync(path).mode&0o777,0o600);
  assert.throws(()=>rosterLock(path),/E_PRODUCTION_ROSTER_BUSY/);
  // A late or forged diagnostic lease never takes kernel ownership away.
  writeFileSync(path,JSON.stringify({...held,lease:{renewedAt:0,expiresAt:1}}));
  assert.throws(()=>rosterLock(path),/E_PRODUCTION_ROSTER_BUSY/);
 } finally {lock.release();}
 assert.equal(JSON.parse(readFileSync(path,'utf8')).released,true);
 rosterLock(path).release();
});

for(const signal of ['SIGTERM','SIGKILL'])test(`roster reclaims ${signal} owner and serializes simultaneous reclaimers`,{skip:process.platform==='win32'},async t=>{
 const path=fixture(t);
 const child=spawn(process.execPath,['--input-type=module','-e',`import {rosterLock} from ${JSON.stringify(moduleUrl)};const lock=rosterLock(${JSON.stringify(path)});process.stdout.write('held\\n');setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 await once(child.stdout,'data');assert.throws(()=>rosterLock(path),/E_PRODUCTION_ROSTER_BUSY/);
 const exited=once(child,'exit');child.kill(signal);await exited;
 assert.equal(JSON.parse(readFileSync(path,'utf8')).released,false);
 const owned=rosterLock(path);
 try{assert.equal(JSON.parse(readFileSync(path,'utf8')).holder.pid,process.pid);assert.throws(()=>rosterLock(path),/E_PRODUCTION_ROSTER_BUSY/);}finally{owned.release();}
});

test('a failed lease renewal fences each delayed identity retry',async t=>{
 const {provisionAccounts}=await import('../dist/proof.js');
 const {mkdirSync}=await import('node:fs');
 const path=fixture(t),directory=join(path,'..');
 let calls=0,temporary;
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
 t.mock.method(globalThis,'fetch',async url=>{
  if(url.endsWith('/auth/config'))return Response.json({environment:'production',development:false,password:true});
  if(url.endsWith('/schema'))return Response.json({service_identities:['service:operator']});
  assert.ok(url.endsWith('/auth/signup'));calls++;
  const lock=join(directory,'proof-accounts/default.json.lock');
  temporary=lock+'.'+JSON.parse(readFileSync(lock,'utf8')).token+'.tmp';mkdirSync(temporary);
  return Response.json({denied:{code:'E_RATE_LIMIT',family:'auth',message:'wait',retryable:true,retryAfterMs:15000}},{status:429});
 });
 const done=assert.rejects(provisionAccounts({url:'http://example',operatorToken:async()=> 'operator',deploymentDir:directory},{roles:{member:1},provision:{name:'provision'}}),/unable to renew holder lease/);
 await new Promise(setImmediate);
 assert.equal(calls,1);
 t.mock.timers.tick(10000);rmSync(temporary,{recursive:true});
 t.mock.timers.tick(5000);await done;
 assert.equal(calls,1,'no account request after renewal failure');
});

test('concurrent processes reclaim one kernel owner without replacing its inode',async t=>{
 const {createInterface}=await import('node:readline');const path=fixture(t);
 const children=Array.from({length:4},()=>{
  const source=`import {rosterLock} from ${JSON.stringify(moduleUrl)};process.stdout.write('ready\\n');process.stdin.once('data',()=>{try{const lock=rosterLock(${JSON.stringify(path)});process.stdout.write('held\\n');process.stdin.once('end',()=>{lock.release();process.exit(0)});}catch(error){if(!String(error).includes('E_PRODUCTION_ROSTER_BUSY'))throw error;process.stdout.write('busy\\n');process.exit(0)}});`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['pipe','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();return {child,lines,exited:once(child,'exit')};
 });
 await Promise.all(children.map(async({lines})=>assert.equal((await lines.next()).value,'ready')));
 for(const {child}of children)child.stdin.write('claim\n');
 const results=await Promise.all(children.map(async({lines})=>(await lines.next()).value));
 assert.equal(results.filter(r=>r==='held').length,1);assert.equal(results.filter(r=>r==='busy').length,3);
 for(const {child}of children)child.stdin.end();await Promise.all(children.map(c=>c.exited));
 rosterLock(path).release();
});

test('same-process BUSY attempts cannot cancel another process exclusion',async t=>{
 const path=fixture(t),owned=rosterLock(path);t.after(()=>owned.release());
 for(let i=0;i<3;i++)assert.throws(()=>rosterLock(path),/E_PRODUCTION_ROSTER_BUSY/);
 const source=`import {rosterLock} from ${JSON.stringify(moduleUrl)};try{const lock=rosterLock(${JSON.stringify(path)});lock.release();process.stdout.write('acquired')}catch(error){if(!String(error).includes('E_PRODUCTION_ROSTER_BUSY'))throw error;process.stdout.write('busy')}`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');});
 let result='';child.stdout.on('data',chunk=>{result+=chunk});await once(child,'exit');
 assert.equal(result,'busy');owned.assertHeld();
});

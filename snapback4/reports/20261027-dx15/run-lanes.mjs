// Read-only originals -> private copies. Scope: production account/inspection regressions.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,copyFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {cli,deploy,startServe,snapshotAll} from '../../packages/snapback4/dist/proof.js';
import {signup,login} from '../../packages/snapback4/dist/auth.js';
const root=resolve(import.meta.dirname,'../..'),original='/home/ccheever/sb4-loop/wave31/apps',base='/tmp/dx15-replay/lanes';mkdirSync(base,{recursive:true});
const env={SNAPBACK4_BIN:join(root,'target/debug/snapback4')},results=[];
for(const id of (process.argv.includes('--only-006')?['006']:['006','007','014','021','030','042'])){
 const lane=readdirSync(original).find(n=>n.startsWith(id+'-snapback-')),src=join(original,lane),cwd=join(base,lane);mkdirSync(join(cwd,'snapback'),{recursive:true});
 const files=readdirSync(join(src,'snapback')).filter(n=>n.endsWith('.q')||n==='security-reviews.json'),hashes={};
 for(const file of files){const bytes=readFileSync(join(src,'snapback',file));hashes[file]=createHash('sha256').update(bytes).digest('hex');copyFileSync(join(src,'snapback',file),join(cwd,'snapback',file));}
 const opts={cwd,env,logsDir:join(cwd,'private-logs')};let host;
 try{
  const check=await cli(['check','--json'],opts);assert.equal(check.code,0,check.stderr);
  await deploy('production','snapback',opts);
  const source=readFileSync(join(cwd,'snapback/schema.q'),'utf8'),roleText=source.match(/mutation provision\(principal: principal, role: enum\(([^)]+)\)/)?.[1];assert.ok(roleText);
  // One of each original declared role keeps replay below unnecessary auth budgets.
  const roles=Object.fromEntries([...roleText.matchAll(/'([^']+)'/g)].map(m=>[m[1],1]));const plan={roles,provision:{name:'provision'}};
  let principals;
  for(let run=0;run<2;run++){
   host=await startServe('production',{...opts,provisionUsers:plan});
   const ids=Object.values(host.sessions).flat().map(a=>a.principal);
   if(principals)assert.deepEqual(ids,principals);else principals=ids;
   const next={...roles,[Object.keys(roles)[0]]:2};
   await assert.rejects(host.provisionAccounts({...plan,roles:next}),/supplied plan.*pinned plan/);
   const rosterTable=source.match(/mutation provision[\s\S]*?return upsert\s+(\w+)/)?.[1]??'roles';
   const rows=await snapshotAll(rosterTable,{...opts,release:'production'});assert.equal(rows.length,ids.length);
   if(id==='006'&&run===0){
    let attempts=0;
    const lost=await signup(host.url,'lost-reply@example.test','long-enough-replay-password',{timeoutMs:2000},async(...args)=>{attempts++;const response=await fetch(...args);if(response.ok)throw Error('replay lost applied signup reply');return response;});
    assert.equal(lost.ok,false);assert.equal(lost.why.code,'E_OFFLINE');assert.match(lost.why.message,/signup outcome is unknown/);assert.equal(attempts,1);
    assert.equal((await login(host.url,'lost-reply@example.test','long-enough-replay-password',{timeoutMs:10000})).ok,true);
   }
   await host.stop();host=undefined;
  }
  results.push({lane,sourceHashes:hashes,ok:true,replay:'check; fresh production deploy; two roster starts with one real user per original declared role; stable principals; plan diff before auth; complete roles snapshot',roleCount:Object.keys(roles).length,...(id==='006'?{lostSignup:'real applied signup reply discarded; stable unknown-outcome why; login succeeds, no signup resubmission'}:{})});
 }catch(error){results.push({lane,sourceHashes:hashes,ok:false,error:String(error).slice(0,1200)});}
 finally{await host?.stop();rmSync(cwd,{recursive:true,force:true});}
 writeFileSync(join(import.meta.dirname,process.argv.includes('--only-006')?'lane-006-retry.json':'lane-replays.json'),JSON.stringify({scope:'original source copies; task-specific production/inspection acceptance, not full original day-two release/UI scripts',results},null,2)+'\n');
 console.log(JSON.stringify({lane,ok:results.at(-1).ok}));
}
if(results.some(r=>!r.ok))process.exitCode=1;

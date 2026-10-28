import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,statSync,writeFileSync,rmSync} from 'node:fs';
import {once} from 'node:events';
const cwd='/tmp/scaf1-evidence/packed-final-corrected/scaf1/custom';
const dir=mkdtempSync('/tmp/scaf1-probe-control-');
const child=spawn(process.execPath,['scripts/proof-scaffold/probe-serve.mjs'],{cwd,env:{...process.env,SNAPBACK4_PROBE_DIRECTORY:dir},stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
const closed=once(child,'exit');let ready;
const timer=setTimeout(()=>child.kill('SIGTERM'),45000);timer.unref();
try {
 const start=Date.now();while(!ready && Date.now()-start<35000){for(const line of stdout.split('\n')){try{const x=JSON.parse(line);if(x.backendUrl&&x.credentialsFile)ready=x;}catch{}}if(!ready)await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,'generated probe readiness missing: '+stderr);assert.equal(stdout.trim().split('\n').length,1,'one readiness line');
 const users=JSON.parse(readFileSync(ready.credentialsFile));assert.equal(statSync(ready.credentialsFile).mode&0o777,0o600);
 const {login}=await import(cwd+'/node_modules/snapback4/dist/auth.js').catch(()=>import('/tmp/scaf1-evidence/packed-final-corrected/scaf1/node_modules/snapback4/dist/auth.js'));
 for(const accounts of Object.values(users))for(const account of accounts){const r=await login(ready.backendUrl,account.email,account.password);assert.equal(r.ok,true);assert.equal(r.session.principal,account.principal);}
 child.kill('SIGTERM');const [code,signal]=await closed;assert.equal(code,0,'clean signal exit '+signal+stderr);
 const report={status:'passed',roles:Object.fromEntries(Object.entries(users).map(([r,v])=>[r,v.length])),realPasswordSignins:true,privateRosterMode:'0600',readinessLines:1,signalExit:code,limitations:'backend-only generated preview; app-owned frontend/build/readiness integration remains explicit'};
 writeFileSync('/tmp/scaf1-evidence/probe-generated.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{clearTimeout(timer);if(child.exitCode===null)child.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}

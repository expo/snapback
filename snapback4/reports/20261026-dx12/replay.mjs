// Read-only wave inputs; no stdout/stderr/credential payload enters measurements.
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {withServeScript,command,cli} from '../../packages/snapback4/dist/proof.js';
const root=resolve(import.meta.dirname,'../..'), repo=resolve(root,'..');
const evidence='/home/ccheever/sb4-loop/wave29/apps', work='/tmp/dx12-replay', out=import.meta.dirname;
const before=join(work,'control/package/snapback4'),after=process.argv.includes('--deploys')?join(work,'control-after/snapback4'):join(root,'target/debug/snapback4');
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const rows=[];mkdirSync(work,{recursive:true,mode:0o700});
function run(bin,args,cwd,timeout=60000){return new Promise(resolve=>{
 const binarySha256=digest(bin), began=performance.now();let stdout='',stderr='';const child=spawn(bin,args,{cwd,env:{...process.env,SNAPBACK4_BIN:bin},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
 child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,binarySha256,ms:Math.round(performance.now()-began),lines:(stdout+stderr).split('\n').filter(Boolean).length,stdout,stderr});});
});}
const apps=readdirSync(evidence).filter(n=>/^\d+-snapback-/.test(n));
const publicResult=r=>({code:r.code,signal:r.signal,binarySha256:r.binarySha256,ms:r.ms,lines:r.lines});
try {
if(process.argv.includes('--deploys')){
 mkdirSync(join(work,'control'),{recursive:true});if(!existsSync(before))execFileSync('tar',['-xzf','/home/ccheever/sb4-loop/dist/0.4.42/snapback4-linux-x64-0.4.42.tgz','-C',join(work,'control')]);
 mkdirSync(join(work,'control-after'),{recursive:true});if(!process.argv.includes('--resume')||!existsSync(after))cpSync(join(root,'target/debug/snapback4'),after);
 if(process.argv.includes('--resume')&&existsSync(join(out,'deploy-measurements.json'))){const prior=JSON.parse(readFileSync(join(out,'deploy-measurements.json'),'utf8'));if(prior.provenance.before===digest(before)&&prior.provenance.after===digest(after))rows.push(...prior.rows);}
 const selected=apps.filter(name=>!rows.some(row=>row.lane===name));
 let next=0;const workers=await Promise.allSettled(Array.from({length:4},async()=>{while(next<selected.length){const name=selected[next++];const row={lane:name,before:{},after:{}};
 for(const [label,bin] of [['before',before],['after',after]]){const cwd=join(work,'deploys',name,label);rmSync(cwd,{recursive:true,force:true});mkdirSync(join(cwd,'snapback'),{recursive:true});
 for(const name2 of readdirSync(join(evidence,name,'snapback')))if(name2.endsWith('.q'))cpSync(join(evidence,name,'snapback',name2),join(cwd,'snapback',name2));
 row[label]=publicResult(await run(bin,['deploy','production'],cwd));}
 rows.push(row);writeFileSync(join(out,'deploy-measurements.json'),JSON.stringify({provenance:{before:digest(before),after:digest(after),method:'fresh production deploy; identical copied .q modules; four workers; complete stdout+stderr line counts; no source decisions/fixtures'},rows},null,2)+'\n');
 console.log(JSON.stringify({deploy:name,before:row.before.code,after:row.after.code}));
 }}));
 const errors=workers.filter(r=>r.status==='rejected').map(r=>r.reason);if(errors.length)throw new AggregateError(errors,'deploy replay workers failed after every worker settled');
}
if(process.argv.includes('--serves')){
 const data=[];
 for(const number of (process.env.DX12_LANES ? process.env.DX12_LANES.split(',') : ['009','010','021','031','039','041','043','050'])){
 const name=apps.find(n=>n.startsWith(number+'-')),src=join(evidence,name),cwd=join(work,'serves',name);mkdirSync(cwd,{recursive:true});
 for(const entry of readdirSync(src,{withFileTypes:true})){
  if(['node_modules','.git','.agent.ndjson','.harness','logs','.scratch','.checkpoint'].includes(entry.name))continue;
  const path=join(src,entry.name);if(!entry.isDirectory()&&!entry.isFile())continue;
  cpSync(path,join(cwd,entry.name),{recursive:true,filter:p=>{try{return !statSync(p).isSocket();}catch{return false;}}});
 }
 mkdirSync(join(cwd,'node_modules'),{recursive:true});
 for(const dependency of readdirSync(join(root,'node_modules'))){if(dependency==='snapback4'||dependency==='.bin')continue;try{symlinkSync(join(root,'node_modules',dependency),join(cwd,'node_modules',dependency));}catch{}}
 try{symlinkSync(join(root,'packages/snapback4'),join(cwd,'node_modules/snapback4'));}catch{} mkdirSync(join(cwd,'node_modules/.bin'),{recursive:true});for(const bin of readdirSync(join(root,'node_modules/.bin'))) {if(bin==='snapback4')continue;try{symlinkSync(join(root,'node_modules/.bin',bin),join(cwd,'node_modules/.bin',bin));}catch{}}try{symlinkSync(join(root,'packages/snapback4/bin/snapback4.js'),join(cwd,'node_modules/.bin/snapback4'));}catch{}
 const env={SNAPBACK4_BIN:after,PATH:join(cwd,'node_modules/.bin')+':'+process.env.PATH};
 const began=performance.now();let commandCode;let result;let diagnostic; const debug=process.env.DX12_DEBUG==='1';
 try {
 await withServeScript('prod:serve',async(ready)=>{
  const users=join(cwd,'dx12-users.json');writeFileSync(users,JSON.stringify(ready.users),{mode:0o600});
  const calls=await command('npm',['run','--silent','client:calls'],{cwd,env:{...process.env,...env,BACKEND_URL:ready.backendUrl,CALLS_USERS:users},secret:true,timeoutMs:120000});commandCode=calls.code;if(debug)writeFileSync(join(cwd,'calls-diagnostic.txt'),calls.stdout+'\n'+calls.stderr,{mode:0o600});
  if(calls.code!==0)throw Error('client:calls failed');
 },{cwd,env,deployment:'deploy',timeoutMs:60000,thenTimeoutMs:135000,stopTimeoutMs:5000});
 result={ok:true};
 }catch(error){result={ok:false,error:typeof error?.report==='object'?error.report.failures.map(f=>f.code):'callback/startup/cleanup rejected'};}
 const lock=await cli(['serve','deploy','--wait-stopped'],{cwd,env,timeoutMs:10000});
 data.push({lane:name,...result,commandCode,ms:Math.round(performance.now()-began),lockReleased:lock.code===0});
 writeFileSync(join(out,process.env.DX12_LANES?'serve-retry-measurements.json':'serve-measurements.json'),JSON.stringify({provenance:{binary:digest(after),method:'unchanged copied prod:serve + client:calls through withServeScript; private 0600 users bridge for legacy CALLS_USERS; 60s startup/proof bounds; no credentials or command output retained'},rows:data},null,2)+'\n');console.log(JSON.stringify(data.at(-1)));
 }
}

} finally {
  // This script owns only its named replay copies; callers own the unpacked controls.
  if(process.argv.includes('--deploys')) {rmSync(join(work,'deploys'),{recursive:true,force:true});rmSync(join(work,'control-after'),{recursive:true,force:true});}
  if(process.argv.includes('--serves')) rmSync(join(work,'serves'),{recursive:true,force:true});
}

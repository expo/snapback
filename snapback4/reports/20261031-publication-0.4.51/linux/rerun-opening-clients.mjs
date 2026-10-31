// One complete client-check rerun after the PUB051 standalone-six flake classification.
// Original affected receipt and exit are never edited. No builds or uploads.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {planAffected,CARGO_ENV} from '/home/ccheever/sb4-pub-0441/snapback4/scripts/affected.mjs';
const root='/home/ccheever/sb4-pub-0441', records='/home/ccheever/sb4-pub-0451-records';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const head=git('rev-parse','HEAD');
assert.equal(git('status','--porcelain'),'');
assert.equal(readFileSync(records+'/opening-affected.exit','utf8').trim(),'1');
const file=readdirSync(root+'/target/affected').filter(n=>n.startsWith(head.slice(0,12)+'-')&&n.endsWith('.json')).sort().at(-1);
assert.ok(file);
const parentPath=root+'/target/affected/'+file,parentBytes=readFileSync(parentPath),parent=JSON.parse(parentBytes);
assert.ok(parent.complete&&parent.unchanged&&!parent.ok);
assert.equal(parent.head,head);
assert.deepEqual(parent.results.filter(r=>r.status!==0).map(r=>r.id),['client-tests']);
assert.equal(readFileSync(records+'/opening-live-margin-six/source.sha','utf8').trim(),head);
for(let i=1;i<=6;i++)assert.equal(readFileSync(records+'/opening-live-margin-six/run-'+i+'.exit','utf8').trim(),'0');
const observed=()=>{
 assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'');
 const plan=planAffected({root,base:parent.base,head});
 assert.equal(plan.inputDigest,parent.inputDigest);assert.deepEqual(plan.observedFiles,parent.observedFiles);
 return {head,inputDigest:plan.inputDigest};
};
const runtime=()=>{
 const version=JSON.parse(readFileSync(root+'/snapback4/packages/snapback4/package.json')).version;
 const cli=root+'/snapback4/target/debug/snapback4';
 assert.equal(execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),'snapback4 '+version);
 const wasm=readFileSync(root+'/snapback4/packages/snapback4/dist/wasm/snapback4_device_bg.wasm');
 const sections=WebAssembly.Module.customSections(new WebAssembly.Module(wasm),'snapback4.engine');assert.equal(sections.length,1);
 assert.equal(JSON.parse(new TextDecoder().decode(sections[0])).version,version);
 return {version,node:process.version,cliSha256:sha(readFileSync(cli)),wasmSha256:sha(wasm)};
};
const receiptPath=records+'/opening-client-full-rerun-receipt.json';
const fd=openSync(receiptPath,'wx');closeSync(fd); // exactly one full rerun, no overwrite
const receipt={schemaVersion:'pub051.client-rerun.v1',head,inputDigest:parent.inputDigest,parentReceipt:parentPath,parentSha256:sha(parentBytes),
 started:new Date().toISOString(),before:observed(),runtimeBefore:runtime(),results:[],complete:false};
const persist=()=>writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n');persist();
for(const id of ['client-tests','client-models']){
 const step=parent.steps.find(s=>s.id===id);assert.ok(step);
 for(const dependency of [...(step.requires??[]),...Object.values(step.fileRequires??{}).flat()])assert.ok(parent.results.some(r=>r.id===dependency&&r.status===0));
 const log=records+'/opening-client-full-rerun-'+id+'.log',out=openSync(log,'wx'),started=Date.now();
 let result;
 try{
  result=await new Promise(resolveResult=>{
   const child=spawn('timeout',['--kill-after=10s',step.timeoutSeconds+'s',...step.argv],{
    cwd:resolve(root,step.cwd),env:{...process.env,...CARGO_ENV,RUST_MIN_STACK:'33554432'},stdio:['ignore',out,out]});
   child.on('error',e=>resolveResult({status:null,error:String(e)}));child.on('close',(status,signal)=>resolveResult({status,signal}));
  });
 }finally{closeSync(out);}
 receipt.results.push({id,argv:step.argv,cwd:step.cwd,timeoutSeconds:step.timeoutSeconds,...result,log,elapsedMs:Date.now()-started});
 writeFileSync(records+'/opening-client-full-rerun-'+id+'.exit',String(result.status)+'\n');persist();
}
receipt.after=observed();receipt.runtimeAfter=runtime();receipt.complete=true;receipt.finished=new Date().toISOString();
receipt.ok=receipt.results.every(r=>r.status===0);persist();
const effective={schemaVersion:'pub051.affected-requalification.v1',head,inputDigest:parent.inputDigest,parentSha256:sha(parentBytes),
 originalReceipt:parentPath,rerunReceipt:receiptPath,rerunSha256:sha(readFileSync(receiptPath)),
 classification:'live-margin-settlement passed alone6/6; one full client check rerun including both models',
 checks:parent.results.map(r=>({id:r.id,originalStatus:r.status,status:r.id==='client-tests'?receipt.results.find(x=>x.id===r.id).status:r.status,
 evidence:r.id==='client-tests'?receiptPath:parentPath})),ok:receipt.ok&&parent.results.filter(r=>r.id!=='client-tests').every(r=>r.status===0)};
writeFileSync(records+'/opening-effective-qualification.json',JSON.stringify(effective,null,2)+'\n');
console.log(JSON.stringify({head,complete:receipt.complete,ok:effective.ok,parentReceipt:parentPath,rerunReceipt:receiptPath},null,2));
if(!effective.ok)process.exitCode=1;

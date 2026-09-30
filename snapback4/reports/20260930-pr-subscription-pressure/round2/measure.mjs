// Paired SDK comparison on the SAME current server/device; run from snapback4/.
import {cpSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='reports/20260930-pr-subscription-pressure/round2', live='packages/snapback4/dist';
cpSync(live,'target/pr-r2-final/dist',{recursive:true});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(root+'/LL-INPUTS.json',JSON.stringify(Object.fromEntries(['target/debug/snapback4-ll-measure','target/debug/snapback4',...['final','round1'].flatMap(v=>['local','local-reads','observe-watch','read-work'].map(n=>`target/pr-r2-${v}/dist/${n}.js`))].map(p=>[p,hash(p)])),null,2)+'\n');
try {
 for(const tier of ['wasm','process'])for(const load of [0,3])for(const label of ['round1','final']){
  cpSync(`target/pr-r2-${label}/dist`,live,{recursive:true});
  const result=spawnSync('taskset',['-c','0-3',process.execPath,'reports/20260929-ll-live-latency/tools/measure.mjs'],{env:{...process.env,LL_KEEP:'viewed',LL_TIER:tier,LL_RUNS:'20',LL_LOAD:String(load),LL_OUT:`${root}/ll-${label}-${tier}-${load}.json`},encoding:'utf8',maxBuffer:16*1024*1024});
  writeFileSync(`${root}/ll-${label}-${tier}-${load}.log`,(result.stdout??'')+(result.stderr??''));
  writeFileSync(`${root}/ll-${label}-${tier}-${load}.exit`,`${result.status}\n`);
  console.log(label,tier,load,result.status);
  if(result.status!==0)throw Error('LL cell failed');
 }
}finally{cpSync('target/pr-r2-final/dist',live,{recursive:true})}

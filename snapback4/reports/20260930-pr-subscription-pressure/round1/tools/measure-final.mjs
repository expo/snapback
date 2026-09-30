// Measure the final SDK after the new-mount cut fence; baseline remains the paired round0 run.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root='reports/20260930-pr-subscription-pressure/round1';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(root+'/LL-FINAL-INPUTS.json',JSON.stringify(Object.fromEntries(['packages/snapback4/dist/local.js','packages/snapback4/dist/local-reads.js','packages/snapback4/dist/wasm/snapback4_device_bg.wasm','target/debug/snapback4','target/debug/snapback4-ll-measure'].map(p=>[p,hash(p)])),null,2)+'\n');
for(const tier of ['wasm','process']) for(const load of [0,3]) {
  const result=spawnSync('taskset',['-c','0-3',process.execPath,'reports/20260929-ll-live-latency/tools/measure.mjs'],{
    env:{...process.env,LL_KEEP:'viewed',LL_TIER:tier,LL_RUNS:'20',LL_LOAD:String(load),LL_OUT:`${root}/ll-final-${tier}-${load}.json`},encoding:'utf8',maxBuffer:16*1024*1024});
  writeFileSync(`${root}/ll-final-${tier}-${load}.log`,(result.stdout??'')+(result.stderr??''));
  writeFileSync(`${root}/ll-final-${tier}-${load}.exit`,String(result.status)+'\n');
  console.log(tier,load,'exit',result.status);
  if(result.status!==0) throw Error('LL final harness failed');
}

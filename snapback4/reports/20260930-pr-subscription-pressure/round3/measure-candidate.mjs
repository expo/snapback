// Final detached-only candidate, isolated from the still-running full suite.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const out='reports/20260930-pr-subscription-pressure/round3',base='target/pr-r3-ll-control';
const files=['local','local-reads','read-work'].map(n=>`${base}/packages/snapback4/dist/${n}.js`);
files.push('target/debug/snapback4','target/debug/snapback4-ll-measure','packages/snapback4/src/wasm/snapback4_device_bg.wasm');
writeFileSync(`${out}/LL-CANDIDATE-INPUTS.json`,JSON.stringify(Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),null,2)+'\n');
for(const tier of ['wasm','process'])for(const load of [0,3]){
 const result=spawnSync('taskset',['-c','0-3',process.execPath,`${base}/reports/20260929-ll-live-latency/tools/measure.mjs`],{env:{...process.env,LL_KEEP:'viewed',LL_TIER:tier,LL_RUNS:'20',LL_LOAD:String(load),LL_OUT:resolve(`${out}/ll-candidate-${tier}-${load}.json`)},encoding:'utf8',maxBuffer:16*1024*1024});
 writeFileSync(`${out}/ll-candidate-${tier}-${load}.log`,(result.stdout??'')+(result.stderr??''));
 writeFileSync(`${out}/ll-candidate-${tier}-${load}.exit`,`${result.status}\n`);
 console.log(tier,load,result.status);if(result.status!==0)throw Error('candidate measurement failed');
}

// Final SDK verification, unchanged LL driver and current measured server/device.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='reports/20260930-pr-subscription-pressure/round2', label=process.argv[2]??'qualified';
const files=['local','local-reads','local-query','observe-watch','read-work','app-client','read-observation','read-episode'].map(n=>`packages/snapback4/dist/${n}.js`);
files.push('target/debug/snapback4','target/debug/snapback4-ll-measure','packages/snapback4/src/wasm/snapback4_device_bg.wasm');
writeFileSync(`${root}/LL-${label.toUpperCase()}-INPUTS.json`,JSON.stringify(Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),null,2)+'\n');
for(const tier of ['wasm','process'])for(const load of [0,3]){
 const result=spawnSync('taskset',['-c','0-3',process.execPath,'reports/20260929-ll-live-latency/tools/measure.mjs'],{env:{...process.env,LL_KEEP:'viewed',LL_TIER:tier,LL_RUNS:'20',LL_LOAD:String(load),LL_OUT:`${root}/ll-${label}-${tier}-${load}.json`},encoding:'utf8',maxBuffer:16*1024*1024});
 writeFileSync(`${root}/ll-${label}-${tier}-${load}.log`,(result.stdout??'')+(result.stderr??''));
 writeFileSync(`${root}/ll-${label}-${tier}-${load}.exit`,`${result.status}\n`);
 console.log(tier,load,result.status);if(result.status!==0)throw Error('LL verification failed');
}

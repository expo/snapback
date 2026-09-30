// Run from snapback4/. The unchanged LL driver; isolated artifact swaps, always restored.
import { cpSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root='reports/20260930-pr-subscription-pressure/round1';
while (existsSync(root+'/hold-ll')) await new Promise(resolve=>setTimeout(resolve,500));
const built='target/pr-round1', live='packages/snapback4/dist', binary='target/debug/snapback4';
cpSync(live,built+'/dist',{recursive:true}); copyFileSync(binary,built+'/device');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
writeFileSync(root+'/LL-INPUTS.json',JSON.stringify({round0Device:hash('target/debug/snapback4-ll-measure'),round1Device:hash(binary),round0Wasm:hash('target/pr-round0/dist/wasm/snapback4_device_bg.wasm'),round1Wasm:hash(live+'/wasm/snapback4_device_bg.wasm'),server:hash('target/debug/snapback4-ll-measure')},null,2)+'\n');
try {
  for(const tier of ['wasm','process']) for(const load of [0,3]) for(const label of ['round0','round1']) {
    cpSync(`target/pr-${label}/dist`,live,{recursive:true});
    copyFileSync(label==='round0'?'target/debug/snapback4-ll-measure':built+'/device',binary);
    const result=spawnSync('taskset',['-c','0-3',process.execPath,'reports/20260929-ll-live-latency/tools/measure.mjs'],{
      env:{...process.env,LL_KEEP:'viewed',LL_TIER:tier,LL_RUNS:'20',LL_LOAD:String(load),LL_OUT:`${root}/ll-${label}-${tier}-${load}.json`},encoding:'utf8',maxBuffer:16*1024*1024});
    writeFileSync(`${root}/ll-${label}-${tier}-${load}.log`,(result.stdout??'')+(result.stderr??''));
    writeFileSync(`${root}/ll-${label}-${tier}-${load}.exit`,String(result.status)+'\n');
    console.log(label,tier,load,'exit',result.status);
    if(result.status!==0) throw Error('LL harness failed');
  }
} finally {cpSync(built+'/dist',live,{recursive:true});copyFileSync(built+'/device',binary);}

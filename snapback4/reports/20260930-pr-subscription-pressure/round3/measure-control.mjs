// Isolated round-2 SDK tree; the full suite's live SDK is never replaced.
import {cpSync,mkdirSync,symlinkSync,existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve('.'),out='reports/20260930-pr-subscription-pressure/round3',base='target/pr-r3-ll-control';
mkdirSync(base+'/packages/snapback4',{recursive:true});
cpSync('target/pr-r3-round2/dist',base+'/packages/snapback4/dist',{recursive:true});
cpSync('packages/snapback4/package.json',base+'/packages/snapback4/package.json');
cpSync('reports/20260929-ll-live-latency/tools',base+'/reports/20260929-ll-live-latency/tools',{recursive:true});
mkdirSync(base+'/witness',{recursive:true});cpSync('witness/lib.mjs',base+'/witness/lib.mjs');
mkdirSync(base+'/target/debug',{recursive:true});
for(const [from,to] of [['node_modules','node_modules'],['target/debug/snapback4','target/debug/snapback4'],['target/debug/snapback4-ll-measure','target/debug/snapback4-ll-measure']])if(!existsSync(base+'/'+to))symlinkSync(resolve(from),base+'/'+to);
for(const [i,label] of ['round2','final','round2','final'].entries()){
 const tool=(label==='round2'?base+'/':'')+'reports/20260929-ll-live-latency/tools/measure.mjs';
 const result=spawnSync('taskset',['-c','0-3',process.execPath,tool],{env:{...process.env,LL_KEEP:'viewed',LL_TIER:'process',LL_RUNS:'20',LL_LOAD:'3',LL_OUT:resolve(`${out}/ll-control-${i}-${label}.json`)},encoding:'utf8',maxBuffer:16*1024*1024});
 writeFileSync(`${out}/ll-control-${i}-${label}.log`,(result.stdout??'')+(result.stderr??''));
 writeFileSync(`${out}/ll-control-${i}-${label}.exit`,`${result.status}\n`);
 console.log(i,label,result.status);if(result.status!==0)throw Error('comparison failed');
}

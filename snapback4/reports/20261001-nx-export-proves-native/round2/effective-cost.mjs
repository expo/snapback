import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {performance} from 'node:perf_hooks';import assert from 'node:assert/strict';
const report=path.resolve('reports/20261001-nx-export-proves-native/round2'),helper=path.resolve('crates/snapback4/src/verbs/witness/effective-config.mjs');
for(const starter of ['plain','social']){
 const project=path.resolve('target/nx',starter),times=[];let effective;
 for(let i=0;i<6;i++){
  const start=performance.now(),r=spawnSync(process.execPath,[helper,project],{cwd:project,encoding:'utf8',maxBuffer:16*1024*1024});const ms=performance.now()-start;
  assert.equal(r.status,0,r.stderr);effective=JSON.parse(r.stdout.split('\n').findLast(x=>x.startsWith('SNAPBACK4_EFFECTIVE_CONFIG=')).split('SNAPBACK4_EFFECTIVE_CONFIG=')[1]);
  assert.equal(effective.retainApplicationJs,false);if(i>0)times.push(ms);
 }
 const result={starter,samples:times,medianMs:times.toSorted((a,b)=>a-b)[2],retainApplicationJs:effective.retainApplicationJs,mods:effective.mods.map(m=>m.mod)};
 fs.writeFileSync(path.join(report,`${starter}-effective-cost.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}

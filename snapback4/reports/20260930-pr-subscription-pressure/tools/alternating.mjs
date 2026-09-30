// Adjacent before/after loaded measurements, with exact built SDK module swaps.
// Product source is untouched and every modified artifact is restored in finally.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = 'reports/20260930-pr-subscription-pressure';
const files = ['local','local-reads','client','read-work','read-observation','read-episode','app-client'];
const fixed = new Map(files.map(name => [name, readFileSync(`packages/snapback4/dist/${name}.js`)]));
try {
  for (const label of ['main','fixed','main2','fixed2']) {
    for (const [name, bytes] of fixed) writeFileSync(`packages/snapback4/dist/${name}.js`, label.startsWith('main') ? readFileSync(`target/pr-main/dist/${name}.js`) : bytes);
    const result = spawnSync('taskset', ['-c','0-3',process.execPath,'reports/20260929-ll-live-latency/tools/measure.mjs'], {
      env: {...process.env,LL_KEEP:'viewed',LL_TIER:'process',LL_RUNS:'20',LL_LOAD:'3',LL_OUT:`${root}/ll-control-${label}.json`}, encoding:'utf8', maxBuffer:16*1024*1024,
    });
    writeFileSync(`${root}/ll-control-${label}.log`,(result.stdout??'')+(result.stderr??''));
    writeFileSync(`${root}/ll-control-${label}.exit`,String(result.status)+'\n');
    if (result.status !== 0) throw Error(`measurement failed: ${label}`);
    console.log(label,'complete');
  }
} finally { for (const [name, bytes] of fixed) writeFileSync(`packages/snapback4/dist/${name}.js`,bytes); }

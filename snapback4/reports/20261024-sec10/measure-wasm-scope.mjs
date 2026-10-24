// Preserve the canonical measurement and budget check while keeping its own
// append-only metrology output outside the selector's immutable source digest.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
const out=resolve(process.argv[2]);mkdirSync(out,{recursive:true});
const path=resolve('metrics/wasm.jsonl');const before=readFileSync(path);const scratch=mkdtempSync(join(tmpdir(),'sb4-sec10-wasm-'));
let status=1;
try{
 const result=spawnSync('timeout',['10800s','env','CARGO_INCREMENTAL=0','CARGO_PROFILE_DEV_DEBUG=0','CARGO_PROFILE_TEST_DEBUG=0','bash','scripts/measure-wasm.sh'],{cwd:process.cwd(),env:{...process.env,TMPDIR:scratch},stdio:'inherit'});
 status=result.status??1;const after=readFileSync(path);
 if(!after.equals(before)){
  if(!after.subarray(0,before.length).equals(before))throw new Error('measurement changed existing metrology; preserve file for review');
  const suffix=after.subarray(before.length);const lines=suffix.toString('utf8').trim().split('\n');
  if(lines.length!==1)throw new Error('unexpected concurrent metrology append; preserve file for review');
  const measurement=JSON.parse(lines[0]);writeFileSync(join(out,'wasm-measurement.jsonl'),suffix);writeFileSync(path,before);
  if(measurement.over!==0||measurement.wasm.gzip>measurement.budget)status=1;
 }else if(status===0){throw new Error('canonical measurement returned no receipt');}
}finally{rmSync(scratch,{recursive:true,force:true});}
process.exitCode=status;

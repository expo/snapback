import { runFile } from '../../scripts/run-client-tests.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Evidence runner, not a suite gate. Launch with taskset -c 64-71 from snapback4.
const [label, roundsArg = '5', selection = 'all'] = process.argv.slice(2);
const dir = resolve('target/ft-client-flakes', label);
mkdirSync(dir, { recursive: true });
const files = selection === 'all' ? ['local-e2e','app-global','server-clock-wire','store-reset-reconnect','react','residency','typing-expiry','web-admission-review','web-session-authority','web-start','acquisition','delivery-fault-matrix','mixed-evidence-oracle'] : selection.split(',');
const loops = Array.from({length: 8}, () => spawn('bash', ['-c','while :; do :; done'], {stdio:'ignore'}));
const exits = loops.map(child => once(child,'exit'));
writeFileSync(dir + '/load.json', JSON.stringify({pid:process.pid, cpus: '64-71 (inherited taskset)', loops:loops.map(c=>c.pid), slots:8, rounds:Number(roundsArg), files}, null, 2));
const jobs = Array.from({length:Number(roundsArg)}, (_, i) => files.map(file=>({file, round:i+1}))).flat();
const results=[];
try {
  await Promise.all(Array.from({length:8}, async () => {
    while(jobs.length) {
      const job=jobs.shift(), started=Date.now();
      const path=`${dir}/${job.file}-${job.round}.log`;
      const result=await runFile(`packages/snapback4/test/${job.file}.test.mjs`, {
        env: job.file==='delivery-fault-matrix' ? {RG_MATRIX_SITE:'48,49'} : process.env.FT_FOCUS && job.file==='web-admission-review' ? {SNAPBACK4_WEB_ADMISSION_FOCUS:'hiding during strict|receipt.*save|receipt.*abort|acknowledgement'} : {},
        nodeArgs: process.env.FT_FOCUS && job.file==='acquisition' ? [process.env.FT_FOCUS === 'receipts' ? '--test-name-pattern=^W5R2a (wasm|process):' : '--test-name-pattern=^W5R2a (wasm|process):|^sequence by wasm: provisional'] : [],
        onOutput:text=>appendFileSync(path,text),
      });
      const record={...job,ms:Date.now()-started,...result};
      results.push(record); appendFileSync(dir+'/results.jsonl',JSON.stringify(record)+'\n');
      console.log(JSON.stringify({file:job.file,round:job.round,ms:record.ms,passed:result.passed,code:result.code,counts:result.counts}));
    }
  }));
} finally {
  for(const loop of loops) if(loop.exitCode===null && loop.signalCode===null) loop.kill('SIGTERM');
  await Promise.all(exits);
  writeFileSync(dir+'/load-reaped.json',JSON.stringify(loops.map(c=>({pid:c.pid,exitCode:c.exitCode,signalCode:c.signalCode})),null,2));
}
writeFileSync(dir+'/summary.json',JSON.stringify(results,null,2));

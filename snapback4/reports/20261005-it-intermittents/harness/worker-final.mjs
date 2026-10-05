import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, out, group, tasks] = process.argv.slice(2);
process.chdir(root);
const { runFile } = await import(pathToFileURL(join(root,'scripts/run-client-tests.mjs')));
mkdirSync(out,{recursive:true});
const abort = new AbortController();
process.once('SIGTERM',()=>abort.abort());process.once('SIGINT',()=>abort.abort());
const hogs=Array.from({length:1},()=>spawn(process.execPath,['-e','while(true){ Math.sqrt(Math.random()); }'],{stdio:'ignore'}));
writeFileSync(join(out,`group-${group}.json`),JSON.stringify({pid:process.pid,hogs:hogs.map(p=>p.pid),affinity:readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:.*$/m)[0],began:new Date().toISOString()}));
try {
 for(const task of JSON.parse(readFileSync(tasks))) {
  if(abort.signal.aborted) break;
  const file=`packages/snapback4/test/${task.file}.test.mjs`,name=`${task.file}-${String(task.iteration).padStart(2,'0')}`;
  let log='';const started=new Date().toISOString();
  const result=await runFile(file,{nodeArgs:['--import','/tmp/sb4-it-probe.mjs'], signal:abort.signal,onOutput:s=>log+=s});
  const logSha=createHash('sha256').update(log).digest('hex');
  writeFileSync(join(out,name+'.log.gz'),gzipSync(log));
  appendFileSync(join(out,`group-${group}.jsonl`),JSON.stringify({name,started,ended:new Date().toISOString(),...result,logSha})+'\n');
  process.stdout.write(JSON.stringify({name,passed:result.passed,elapsed:result.elapsed,counts:result.counts})+'\n');
 }
} finally {for(const hog of hogs)hog.kill('SIGTERM');}

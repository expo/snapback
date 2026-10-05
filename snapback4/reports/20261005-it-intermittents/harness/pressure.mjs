import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [root,out]=process.argv.slice(2);process.chdir(root);mkdirSync(out,{recursive:true});
const {runFile}=await import(pathToFileURL(join(root,'scripts/run-client-tests.mjs')));
const files=['read-through','read-through-upsert','readauth','read-through-provenance','social-starter','admit-before-identity'];
const jobs=Array.from({length:20},(_,i)=>files.map(file=>({file,iteration:i+1}))).flat();
const abort=new AbortController();process.once('SIGTERM',()=>abort.abort());process.once('SIGINT',()=>abort.abort());
const hogs=Array.from({length:2},()=>spawn(process.execPath,['-e','while(true){Math.sqrt(Math.random());}'],{stdio:'ignore'}));
writeFileSync(join(out,'manifest.json'),JSON.stringify({began:new Date().toISOString(),root,pid:process.pid,hogs:hogs.map(p=>p.pid),affinity:readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:.*$/m)[0],cpuSample:JSON.parse(readFileSync('/tmp/sb4-it-pressure-cpus.json')),files,concurrency:12,jobs},null,2));
let cursor=0;
try{await Promise.all(Array.from({length:12},async()=>{
 while(cursor<jobs.length&&!abort.signal.aborted){const task=jobs[cursor++],name=`${task.file}-pressure-${task.iteration}`,started=new Date().toISOString();let log='';
 const result=await runFile(`packages/snapback4/test/${task.file}.test.mjs`,{nodeArgs:['--import','/tmp/sb4-it-probe.mjs'],signal:abort.signal,onOutput:s=>log+=s});
 writeFileSync(join(out,name+'.log.gz'),gzipSync(log));const row={name,started,ended:new Date().toISOString(),...result,logSha:createHash('sha256').update(log).digest('hex')};
 appendFileSync(join(out,'runs.jsonl'),JSON.stringify(row)+'\n');process.stdout.write(JSON.stringify({name,passed:result.passed,counts:result.counts})+'\n');
 }
}));}finally{for(const hog of hogs)hog.kill('SIGTERM');}

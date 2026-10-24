// Run the selector's three affected Cargo invocations concurrently; preserve
// each invocation, environment, timeout, exit status and complete external log.
import {spawn} from 'node:child_process';
import {createWriteStream,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const steps=JSON.parse(process.argv[2]);const out=resolve(process.argv[3]);mkdirSync(out,{recursive:true});
const env=['CARGO_INCREMENTAL=0','CARGO_PROFILE_DEV_DEBUG=0','CARGO_PROFILE_TEST_DEBUG=0'];
const results=await Promise.all(steps.map(step=>new Promise(done=>{
 if(step.cwd!=='snapback4'||step.argv[0]!=='cargo')throw new Error('expected selector Cargo step in snapback4');
 const start=Date.now();const path=resolve(out,step.id.replaceAll(':','-')+'.log');const log=createWriteStream(path);
 console.log(`start ${step.id}; log ${path}`);
 const child=spawn('timeout',[`${step.timeoutSeconds}s`,'env',...env,...step.argv],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 child.on('error',error=>{log.write(String(error));});
 child.on('close',(status,signal)=>{log.end(()=>{const result={id:step.id,argv:step.argv,status,signal,elapsedMs:Date.now()-start,log:path};console.log(JSON.stringify(result));done(result);});});
})));
writeFileSync(resolve(out,'rust-results.json'),JSON.stringify(results,null,2)+'\n');process.exitCode=results.every(result=>result.status===0)?0:1;

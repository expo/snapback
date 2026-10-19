import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {stopServer} from '/home/ccheever/sb4-loop/prewave17/exact2/scripts/retest-snapback-readme.mjs';
const exec=promisify(execFile),base='/home/ccheever/sb4-loop/prewave17',output='/tmp/integ17',binary='/home/ccheever/projects/snapback-sb4loop/snapback4/target/debug/snapback4',client='/tmp/integ17/prepared-qualified/snapback4-0.4.33.tgz';
const env={...process.env,SNAPBACK4_BIN:binary,CHROME:'/home/ccheever/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',CARGO_INCREMENTAL:'0',CARGO_PROFILE_DEV_DEBUG:'0',CARGO_PROFILE_TEST_DEBUG:'0',CARGO_BUILD_JOBS:'4',PATH:'/home/ccheever/.bun-1.4.2/bin:'+process.env.PATH};const rows=[];let seq=0;
async function run(cmd,args,cwd){let result;try{result=await exec('timeout',['2400s',cmd,...args],{cwd,env,timeout:2410000,maxBuffer:32*1024*1024});}catch(e){writeFileSync(join(output,'exact-closeout-error.log'),e.stdout+e.stderr);throw e;}writeFileSync(join(output,'exact-closeout-'+String(++seq).padStart(2,'0')+'.log'),result.stdout+result.stderr);rows.push({cmd:'timeout',args:['2400s',cmd,...args],cwd,exit:0});writeFileSync(join(output,'exact-closeout-commands.json'),JSON.stringify(rows,null,2)+'\n');console.log(cmd,args.join(' '),'passed');return result.stdout;}
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal((await run(binary,['--version'],base)).trim(),'snapback4 0.4.33');
writeFileSync(join(output,'exact-closeout-binding.json'),JSON.stringify({binary,client,binarySha256:sha(binary),clientSha256:sha(client),source:await run('git',['rev-parse','HEAD'],'/home/ccheever/projects/snapback-sb4loop'),exactSource:await run('git',['rev-parse','HEAD'],join(base,'exact2'))},null,2)+'\n');
for(const name of ['synced','online']){
 const project=join(base,name),app=join(project,'app'),priorDevice=name==='synced'?sha(join(app,'assets/snapback4.wasm')):null;
 await run('npm',['install','--ignore-scripts','--omit=optional','--no-audit','--no-fund',client],project);
 assert.equal(JSON.parse(readFileSync(join(project,'node_modules/snapback4/package.json'),'utf8')).version,'0.4.33');
 const s=createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const port=s.address().port;await new Promise(ok=>s.close(ok));
 await run('bun',['exact.mjs','snapback','--rebuild','--port',String(port)],app);
 if(name==='synced'){assert.equal(sha(join(app,'assets/snapback4.wasm')),priorDevice,'Exact merged device bytes unchanged');assert.equal(JSON.parse(readFileSync(join(app,'assets/snapback4.wasm.json'),'utf8')).version,'0.4.33');}
 const server=spawn('timeout',['1800s',binary,'dev','--port',String(port),'--no-watch'],{cwd:project,env,stdio:['ignore','pipe','pipe']});let log='';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 try{const end=Date.now()+30000;while(!/SNAPBACK4_READY/.test(log)){assert.equal(server.exitCode,null,log);assert.ok(Date.now()<end,log);await new Promise(r=>setTimeout(r,50));}const r=await run('bun',['exact.mjs','test','web','--backend',`http://127.0.0.1:${port}`],app);assert.match(r,/2 passed, 0 failed/);}finally{await stopServer(server);writeFileSync(join(output,'exact-closeout-'+name+'-backend.log'),log);}
}
console.log('Final prepared0.4.33 pack Exact synced and online qualification passed');

import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {extractExamples,stopServer} from './exact2/scripts/retest-snapback-readme.mjs';
const base=import.meta.dirname,sdk=join(base,'exact2'),sb='/home/ccheever/projects/snapback-sb4loop/snapback4';
const binary=join(sb,'target/debug/snapback4'),client=join(sb,'target/integ15-pack3/snapback4-0.4.31.tgz');
const env={...process.env,SNAPBACK4_BIN:binary,CHROME:'/home/ccheever/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',CARGO_INCREMENTAL:'0',CARGO_PROFILE_DEV_DEBUG:'0',CARGO_PROFILE_TEST_DEBUG:'0',CARGO_BUILD_JOBS:'4'};
env.PATH='/home/ccheever/.bun-1.4.2/bin:'+env.PATH;
const commands=[];let seq=0;
function run(cmd,args,cwd,limit=1800000){const r=spawnSync(cmd,args,{cwd,env,encoding:'utf8',timeout:limit,maxBuffer:32*1024*1024});writeFileSync(join(base,'exact-final-'+String(++seq).padStart(2,'0')+'.log'),r.stdout+r.stderr);commands.push({cmd,args,cwd,exit:r.status});writeFileSync(join(base,'commands-final.json'),JSON.stringify(commands,null,2));console.log(cmd,args.join(' '),'exit',r.status);assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;}
const end=Date.now()+1200000;while(!existsSync(client)){assert.ok(Date.now()<end,'prepared pack deadline');await new Promise(r=>setTimeout(r,1000));}
const examples=extractExamples(readFileSync(join(sdk,'snapback4/README.md'),'utf8'),readFileSync(join(sdk,'docs/recipes/snapback-auth.md'),'utf8')).filter(e=>['A complete app','A complete mixed identity app'].includes(e.name));
for(const example of examples){
 const project=join(base,example.online?'online-guest-final':'synced-final'),app=join(project,'app');mkdirSync(join(project,'snapback'),{recursive:true});
 writeFileSync(join(project,'package.json'),JSON.stringify({private:true,type:'module'}));
 run('npm',['install','--ignore-scripts','--omit=optional','--no-audit','--no-fund',client],project,300000);
 writeFileSync(join(project,'snapback/schema.q'),example.blocks[0]+'\n');
 const reservation=createServer();await new Promise(ok=>reservation.listen(0,'127.0.0.1',ok));const port=reservation.address().port;await new Promise(ok=>reservation.close(ok));
 run('bun',[join(sdk,'scripts/exact.mjs'),'new',app,'--snapback',...(example.online?['--online']:[]),'--port',String(port)],project);
 for(const [i,name] of ['app.contract','app.ts','app.test.contract'].entries())writeFileSync(join(app,name),example.blocks[i+1]+'\n');
 const manifest=JSON.parse(readFileSync(join(app,'app.json'),'utf8'));manifest.app.id=/export const appId\s*=\s*['"]([^'"]+)['"]/.exec(example.blocks[2])[1];writeFileSync(join(app,'app.json'),JSON.stringify(manifest,null,2));
 run('bun',['exact.mjs','snapback','--port',String(port)],app);
 run('bun',['exact.mjs','contract','types','app.contract','-o','app.contract.d.ts'],app);
 let server=spawn(binary,['dev','--port',String(port),'--no-watch'],{cwd:project,env,stdio:['ignore','pipe','pipe']});let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);
 try{
  const ready=Date.now()+30000;while(!/SNAPBACK4_READY/.test(output)){assert.equal(server.exitCode,null,output);assert.ok(Date.now()<ready,output);await new Promise(r=>setTimeout(r,50));}
  for(let round=0;round<2;round++){const result=run('bun',['exact.mjs','test','web','--backend',`http://127.0.0.1:${port}`],app);assert.match(result,/2 passed, 0 failed/);}
 }finally{await stopServer(server);writeFileSync(join(project,'backend.log'),output);}
}
console.log('Exact merged-tree qualification passed: synced and bare-identity guest online, twice each');

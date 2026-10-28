// Installed-consumer VER1 proof: no source binary override or workspace imports.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const [packArg,outArg,registry='http://127.0.0.1:4873/']=process.argv.slice(2),packs=resolve(packArg),out=resolve(outArg);
mkdirSync(out,{recursive:true});
const env={...process.env,CI:'1',EXPO_NO_TELEMETRY:'1',npm_config_registry:registry,npm_config_audit:'false',npm_config_fund:'false'};delete env.SNAPBACK4_BIN;
async function run(cwd,cmd,args){const start=performance.now();let stdout='',stderr='';const c=spawn(cmd,args,{cwd,env,stdio:'pipe'});c.stdin.end();c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);const code=await new Promise((r,j)=>{c.once('error',j);c.once('close',r);});return {code,stdout,stderr,ms:Math.round(performance.now()-start)};}
const results=[];
for(const [name,flags] of [['web',['--web']],['password',['--web','--online','--password']],['expo',['--expo']]]){
 const cwd=join(out,name);mkdirSync(cwd);writeFileSync(join(cwd,'package.json'),'{"private":true,"type":"module"}');
 let r=await run(cwd,'npm',['install','--ignore-scripts','--no-audit','--no-fund',join(packs,'snapback4-0.4.46.tgz'),join(packs,'snapback4-linux-x64-0.4.46.tgz')]);assert.equal(r.code,0,r.stderr);
 const cli=join(cwd,'node_modules/.bin/snapback4');r=await run(cwd,cli,['init',...flags,'--no-install']);assert.equal(r.code,0,r.stdout+r.stderr);
 // npm resolves every dependency against the same read-only overlay/mirror.
 r=await run(cwd,process.execPath,['scripts/install.mjs']);assert.equal(r.code,0,r.stdout+r.stderr);const installMs=r.ms;
 r=await run(cwd,'npm',['run','--silent','verify']);writeFileSync(join(cwd,'verify-run.json'),JSON.stringify(r));assert.equal(r.code,0,r.stdout+r.stderr+'\n'+readFileSync(join(cwd,'.snapback4/last/verify.txt'),'utf8'));
 assert.ok(r.stdout.trim().split('\n').length<=3,r.stdout);assert.match(r.stdout,/4\/4 phases/);
 results.push({name,installMs,verifyMs:r.ms,summary:r.stdout});
 if(name==='password'){
   r=await run(cwd,'npm',['run','--silent','probe:serve']);assert.equal(r.code,1,r.stderr);assert.match(r.stderr,/E_PROBE_IDLE.*10 seconds/);assert.ok(r.ms<=15000,JSON.stringify({idleMs:r.ms,stderr:r.stderr}));results.at(-1).idleMs=r.ms;
   r=await run(cwd,'npm',['run','--silent','probe:serve']);assert.equal(r.code,1);assert.match(r.stderr,/E_PROBE_IDLE: previous run/);results.at(-1).repeatIdleMs=r.ms;
 }
 console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');

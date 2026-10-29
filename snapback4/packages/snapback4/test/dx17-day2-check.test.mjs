import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, statSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {command, deploy, cli} from '../dist/proof.js';
const root=resolve(import.meta.dirname,'../../..'), sdk=join(root,'packages/snapback4');
const wrapper=join(sdk,'bin/snapback4.js'), env={SNAPBACK4_BIN:join(root,'target/debug/snapback4')};
function fixture(t){
 const cwd=mkdtempSync(join(tmpdir(),'dx17-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 mkdirSync(join(cwd,'node_modules/.bin'),{recursive:true});symlinkSync(sdk,join(cwd,'node_modules/snapback4'));
 symlinkSync(wrapper,join(cwd,'node_modules/.bin/snapback4'));mkdirSync(join(cwd,'scripts'));mkdirSync(join(cwd,'v1'));
 const doc=readFileSync(join(root,'crates/snapback4-lang/src/guide/day2.md'),'utf8');
 const stage=JSON.parse(doc.match(/```json\n([\s\S]*?)```/)[1]);
 const scripts={...stage,check:'node finite.mjs check',acceptance:'node finite.mjs acceptance','frontend:proof':'node finite.mjs frontend',
 'day2:proof':'node finite.mjs day2','client:calls':'node calls.mjs','prod:serve':'node scripts/prod-serve.mjs','probe:serve':'node scripts/prod-serve.mjs'};
 writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts}));
 writeFileSync(join(cwd,'v1/package.json'),JSON.stringify({type:'module',scripts:{'client:calls':'node ../calls.mjs'}}));
 writeFileSync(join(cwd,'finite.mjs'),`import{appendFileSync,existsSync,mkdirSync,writeFileSync}from'node:fs';
 const phase=process.argv[2];appendFileSync('sequence',phase+'\\n');
 if(phase===process.env.FAIL_PHASE){console.error('Error: deliberate finite failure');process.exit(7);}
 if(phase===process.env.HANG_PHASE){const{spawn}=await import('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync('hung-pid',String(child.pid));await new Promise(()=>{});}
 if(phase==='frontend'){if(existsSync('dist'))throw Error('stale dist');mkdirSync('dist');}
 if(phase==='day2'){if(existsSync('day2-proof.json'))throw Error('stale proof');writeFileSync('day2-proof.json',JSON.stringify({ok:true}));}
 console.log('full finite output '+phase);
 `);
 // This uses the literal production recipe, real password signup and operator provisioning.
 writeFileSync(join(cwd,'scripts/prod-serve.mjs'),doc.match(/```js\n([\s\S]*?)```/)[1]);
 writeFileSync(join(cwd,'calls.mjs'),`import assert from'node:assert/strict';import{readFileSync,statSync,appendFileSync}from'node:fs';
 const users=JSON.parse(readFileSync(process.env.CALLS_USERS));assert.equal(statSync(process.env.CALLS_USERS).mode&511,384);
 if(process.env.FAIL_CLIENT){console.error('Error: deliberate client failure');process.exit(7);}
 assert.equal(users.member.length,2);assert.equal(users.admin.length,2);appendFileSync('../'.repeat(process.cwd().endsWith('/v1')?1:0)+'users-paths',process.env.CALLS_USERS+'\\n');
 const reply=await fetch(process.env.BACKEND_URL+'/q/myRole',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+users.member[0].token},body:'{"args":{}}'});
 assert.equal(reply.status,200);console.log('private-client-output-sentinel');
 `);
 return cwd;
}
async function check(cwd,args=[],extra={}){
 return command(process.execPath,[wrapper,'day2-check','--deployment','deploy','--up-ms','20','--timeout-ms','30000',...args],{cwd,env:{...env,...extra},timeoutMs:180_000,secret:true});
}
test('day2 checker runs literal stage/roster recipes, repeat requirements and frozen clients without credential output',{skip:process.platform==='win32'},async t=>{
 const cwd=fixture(t);mkdirSync(join(cwd,'snapback'));
 const schema=readFileSync(join(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8').match(/```quarry\n([\s\S]*?)```/)[1];
 writeFileSync(join(cwd,'snapback/schema.q'),schema);
 assert.equal((await cli(['check'],{cwd,env})).code,0);
 await deploy('deploy','snapback',{cwd,env});
 writeFileSync(join(cwd,'snapback/schema.q'),schema.replace('  body: text 1..200\n','  body: text 1..200\n  label: text <=20 default \'new\'\n'));
 await deploy('deploy','snapback',{cwd,env});
 const before=JSON.parse((await cli(['releases','deploy','--json'],{cwd,env})).stdout);
 for(let i=0;i<2;i++){
  const r=await check(cwd);assert.equal(r.code,0,r.stdout+r.stderr);assert.match(r.stdout,/16\/16 phases/);assert.ok(r.stdout.trim().split('\n').length<=3,r.stdout);
  const report=JSON.parse(readFileSync(join(cwd,'.snapback4/last/day2-check.json')));
  assert.equal(report.phases.length,16);assert.equal(report.ok,true);assert.equal(report.failed,null);
  assert.equal(statSync(join(cwd,'.snapback4/last/day2-check.json')).mode&511,384);
  assert.ok(!JSON.stringify(report).includes('private-client-output-sentinel'));
  assert.ok(!JSON.stringify(report).includes('"password"'));
 }
 assert.deepEqual(readFileSync(join(cwd,'sequence'),'utf8').trim().split('\n'),Array(2).fill(['check','acceptance','acceptance','frontend','frontend','day2','day2']).flat());
 const paths=readFileSync(join(cwd,'users-paths'),'utf8').trim().split('\n');assert.equal(paths.length,16);for(const p of paths)assert.equal(existsSync(p),false,'private users removed');
 const after=JSON.parse((await cli(['releases','deploy','--json'],{cwd,env})).stdout);
 assert.equal(after.live.source,before.live.source,'leaves v2 selected');
 const failed=await check(cwd,[],{FAIL_CLIENT:'1'});assert.equal(failed.code,7,failed.stdout+failed.stderr);
 const failure=JSON.parse(readFileSync(join(cwd,'.snapback4/last/day2-check.json')));
 assert.equal(failure.phases.length,9);assert.equal(failure.phases.at(-1).code,7);
 assert.equal(failure.phases.at(-1).receipt.lockReleased,true,'cleanup receipt retained on client failure');
 assert.match(failure.phases.at(-1).logs.stderr,/stderr.log$/);
 // Execute the actual shipped temporary scaffold; it is deliberately not a
 // production-contract producer, and must receive an actionable refusal.
 assert.equal((await cli(['init','--adapt','--day2','--apply'],{cwd,env:{...env,SNAPBACK4_INIT_INSTALL:'0'}})).code,0);
 const pkg=JSON.parse(readFileSync(join(cwd,'package.json')));pkg.scripts['day2:proof']='node scripts/day2-proof.mjs versions/v1 versions/v2';
 writeFileSync(join(cwd,'package.json'),JSON.stringify(pkg));
 const temporary=await check(cwd);assert.equal(temporary.code,1,temporary.stdout+temporary.stderr);
 assert.match(temporary.stdout,/temporary scaffold does not satisfy/);
 assert.match(temporary.stdout,/guide day2/);
});
test('first failure preserves exit and complete output, never starts later proofs or stages',{skip:process.platform==='win32'},async t=>{
 const cwd=fixture(t),r=await check(cwd,[],{FAIL_PHASE:'acceptance'});
 assert.equal(r.code,7,r.stderr);assert.match(r.stdout,/FAIL acceptance 1\/2; exit 7/);assert.match(r.stdout,/deliberate finite failure/);
 assert.deepEqual(readFileSync(join(cwd,'sequence'),'utf8').trim().split('\n'),['check','acceptance']);
 const report=JSON.parse(readFileSync(join(cwd,'.snapback4/last/day2-check.json')));assert.equal(report.phases[1].code,7);assert.match(report.phases[0].stdout,/full finite output/);
});
test('missing contracts and invalid options refuse before scripts; help requires no binary',async t=>{
 const cwd=fixture(t);rmSync(join(cwd,'v1/package.json'));
 const r=await check(cwd);assert.equal(r.code,2);assert.equal(existsSync(join(cwd,'sequence')),false);
 const bad=await check(cwd,['--up-ms','0']);assert.equal(bad.code,2);assert.match(bad.stderr,/positive and finite/);
 const help=await command(process.execPath,[wrapper,'day2-check','--help'],{cwd,env:{SNAPBACK4_BIN:'/missing'},secret:true});assert.equal(help.code,0);assert.match(help.stdout,/--deployment DIR/);
});
test('a timed-out authored proof stops later phases and reaps its descendants',{skip:process.platform==='win32'},async t=>{
 const cwd=fixture(t),r=await check(cwd,['--timeout-ms','1500'],{HANG_PHASE:'acceptance'});
 assert.equal(r.code,1,r.stdout+r.stderr);assert.match(r.stdout,/FAIL acceptance/);
 assert.deepEqual(readFileSync(join(cwd,'sequence'),'utf8').trim().split('\n'),['check','acceptance']);
 const pid=Number(readFileSync(join(cwd,'hung-pid'),'utf8'));
 assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
});

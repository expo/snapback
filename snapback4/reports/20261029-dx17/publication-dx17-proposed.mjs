// Literal day-two packet and its checker through installed tarballs, no source binary override.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runToolchainCommand} from './publication-starters.mjs';
const consumer=String.raw`
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,statSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {cli,command,deploy,rollback,startServe,uniqueName,snapshotAll,exhaustPages} from 'snapback4/proof';
import {createClient} from 'snapback4/client';
const cwd=join(process.cwd(),uniqueName('dx17'));mkdirSync(join(cwd,'snapback'),{recursive:true});mkdirSync(join(cwd,'scripts'));
async function checked(args){const r=await cli(args,{cwd});assert.equal(r.code,0,r.stdout+r.stderr);return r.stdout;}
const packet=await checked(['guide','day2','--repeat']);assert.ok(Buffer.byteLength(packet)<=8000);assert.ok(!packet.includes('Truncated:'));
const fence=String.fromCharCode(96).repeat(3);
const block=(text,kind)=>text.match(new RegExp(fence+kind+'\\n([\\s\\S]*?)'+fence))[1];
const scripts=JSON.parse(block(packet,'json'));const roster=block(packet,'js');
const staging=await checked(['guide','staging','--repeat']);const source=block(staging,'quarry');
writeFileSync(join(cwd,'snapback/schema.q'),source);
writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{...scripts,
 check:'snapback4 check',acceptance:'node finite.mjs acceptance','frontend:proof':'node finite.mjs frontend',
 'day2:proof':'node business.mjs','client:calls':'node calls.mjs','prod:serve':'exec node scripts/prod-serve.mjs','probe:serve':'exec node scripts/prod-serve.mjs'}}));
writeFileSync(join(cwd,'scripts/prod-serve.mjs'),roster);
writeFileSync(join(cwd,'finite.mjs'),"import{mkdirSync,existsSync}from'node:fs';if(process.argv[2]==='frontend'){if(existsSync('dist'))throw Error('dist not removed');mkdirSync('dist');}\n");
const calls=String.raw` + '`' + String.raw`
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createClient}from'snapback4/client';import{exhaustPages}from'snapback4/proof';import{api}from'./snapback/generated/api.ts';
const users=JSON.parse(readFileSync(process.env.CALLS_USERS));
for(const accounts of Object.values(users))for(const account of accounts){
 const client=createClient({url:process.env.BACKEND_URL,session:account});
 try{const rows=await exhaustPages(c=>client.query(api.myNotes,{c}));
 const expected=JSON.parse(readFileSync(process.env.DX17_EXPECTED,'utf8'));
 for(const row of expected.filter(r=>r.owner===account.principal))assert.ok(rows.some(r=>r.id===row.id&&r.body===row.body),'missing v2-native row through frozen caller');
 }finally{client.close();}
}
` + '`' + String.raw`;
writeFileSync(join(cwd,'calls.mjs'),calls);writeFileSync(join(cwd,'expected.json'),'[]');
await checked(['check']);await checked(['init','--adapt','--day2','--apply']);
await checked(['deploy','./deploy','--save-version','versions/v3']);
const v2=source.replace('  body: text 1..200\n',"  body: text 1..200\n  label: text <=20 default 'new'\n");
writeFileSync(join(cwd,'snapback/schema.q'),v2);await checked(['check']);await checked(['deploy','./deploy','--save-version','versions/v4']);
// Miniature assertion-bearing production proof, deliberately separate from the temporary scaffold.
writeFileSync(join(cwd,'business.mjs'),String.raw` + '`' + String.raw`
import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';
import{startServe,rollback,snapshotAll,uniqueName}from'snapback4/proof';import{createClient}from'snapback4/client';
let expected=JSON.parse(readFileSync('expected.json','utf8'));
const host=await startServe('./deploy',{provisionUsers:{roles:{member:2,admin:2},provision:{kind:'mutation',name:'provision'}}});
try{
 await rollback('./deploy',1);
 for(const stage of ['v1','v2']){
  if(stage==='v2')await rollback('./deploy','latest');
  const account=host.sessions.member[0],client=createClient({url:host.url,session:account});
  try{const w=await client.mutate({kind:'mutation',name:'add'},{body:uniqueName(stage)});assert.equal(w.state,'sent');}finally{client.close();}
 }
 const after=await snapshotAll('notes',{release:'./deploy'});for(const old of expected)assert.ok(after.some(r=>r.id===old.id&&r.body===old.body));
 for(const row of after)assert.equal(row.label,'new');
 expected=after;writeFileSync('expected.json',JSON.stringify(after));
 await rollback('./deploy',1);assert.deepEqual(await snapshotAll('notes',{release:'./deploy'}),expected);
 await rollback('./deploy','latest');assert.deepEqual(await snapshotAll('notes',{release:'./deploy'}),expected);
 writeFileSync('day2-proof.json',JSON.stringify({ok:true,recordsCheckedAfterV2:expected.length}));
}finally{await host.stop();}
` + '`' + String.raw`);
for(let run=0;run<2;run++){
 const r=await cli(['day2-check','--deployment','./deploy','--up-ms','25'],{cwd,env:{DX17_EXPECTED:join(cwd,'expected.json')},timeoutMs:240_000});assert.equal(r.code,0,r.stdout+r.stderr);assert.match(r.stdout,/16\/16 phases/);assert.ok(r.stdout.trim().split('\n').length<=3);
 const report=JSON.parse(readFileSync(join(cwd,'.snapback4/last/day2-check.json')));assert.equal(report.ok,true);assert.equal(report.phases.length,16);assert.equal(statSync(join(cwd,'.snapback4/last/day2-check.json')).mode&511,384);
 assert.ok(!JSON.stringify(report).includes('"password"'));assert.equal(existsSync(join(cwd,'deploy/proof-accounts/default.json')),true);
}
console.log('DX17 packed: bounded packet, literal stage/roster scripts, two complete checks, v2-native rows through frozen v1, retained migration values');
`;
export async function proveDX17(cwd){
 writeFileSync(join(cwd,'dx17.mjs'),consumer);
 const env={...process.env};delete env.SNAPBACK4_BIN;
 await runToolchainCommand(process.execPath,['dx17.mjs'],{cwd,env,timeout:600_000});
 return {status:'passed',runs:2,phasesPerRun:16,literalStageScripts:true,realAccounts:true,frozenV1ReturnsV2Rows:true};
}

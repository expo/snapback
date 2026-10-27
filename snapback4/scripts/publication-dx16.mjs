// @ref LLP 3000.037.000#9 — run frozen callers and the generated proof twice from the installed package.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runToolchainCommand} from './publication-starters.mjs';
export const dx16Consumer=String.raw`
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {cli,command,startServe,deploy,rollback,snapshotAll,freshUser,uniqueName} from 'snapback4/proof';
import {createClient} from 'snapback4/client';
// A plain starter and ordinary adaptation are day-one work, not historical capture.
const fresh=join(process.cwd(),uniqueName('dx16-dayone'));mkdirSync(fresh);
const freshCli=async args=>{const r=await cli(args,{cwd:fresh,env:{SNAPBACK4_INIT_INSTALL:'0'}});assert.equal(r.code,0,r.stdout+r.stderr);return r;};
await freshCli(['init','--web']);assert.equal(existsSync(join(fresh,'v1')),false);
await freshCli(['init','--adapt','--apply']);assert.equal(existsSync(join(fresh,'v1')),false);
const business="use identity password\ntable business:\n  title: text <=80\n  public 'business records'\n  online only\nquery listDayOne():\n  return business first 20 by .id\n";
writeFileSync(join(fresh,'snapback/schema.q'),business);
const freshPackage=JSON.parse(readFileSync(join(fresh,'package.json'),'utf8'));freshPackage.scripts['client:calls']='node calls.mjs';writeFileSync(join(fresh,'package.json'),JSON.stringify(freshPackage));
writeFileSync(join(fresh,'calls.mjs'),"import {api} from './snapback/generated/api.ts';if(!api.listDayOne)throw Error('wrong frozen API');console.log('day-one business captured');\n");
await freshCli(['types']);await freshCli(['init','--adapt','--day2','--apply']);
assert.equal(readFileSync(join(fresh,freshPackage.type==='module'?'v1/snapback/schema.q':'v1/.source/snapback/schema.q'),'utf8'),business);
const frozenBusiness=await command('npm',['--prefix','v1','run','--silent','client:calls'],{cwd:fresh});assert.equal(frozenBusiness.code,0,frozenBusiness.stderr);assert.match(frozenBusiness.stdout,/day-one business captured/);
const cwd=join(process.cwd(),uniqueName('dx16-app'));mkdirSync(join(cwd,'snapback'),{recursive:true});mkdirSync(join(cwd,'tools'));mkdirSync(join(cwd,'helpers'));mkdirSync(join(cwd,'src'));
const source="use identity password\ntable roles:\n  principal: principal\n  role: enum('member')\n  unique principal\n  read <- .principal = viewer or viewer = 'service:operator'\n  insert <- viewer = 'service:operator'\n  online only\nmutation provision(principal: principal, role: enum('member')):\n  return insert roles {principal,role}\ntable rows:\n  owner: principal\n  title: text <=80\n  cap 1 by owner\n  read <- .owner = viewer\n  insert <- .owner = viewer and exists roles[principal = viewer]\n  online only\nmutation add(title: text <=80):\n  return insert rows {owner:viewer,title}\nquery list():\n  return rows where .owner = viewer first 20 by .id\n";
writeFileSync(join(cwd,'snapback/schema.q'),source);writeFileSync(join(cwd,'src/App.tsx'),'export default function App(){return null;}\n');
writeFileSync(join(cwd,'package.json'),JSON.stringify({private:true,type:'module',scripts:{'client:calls':'node tools/calls.mjs'}}));
writeFileSync(join(cwd,'helpers/check.mjs'),'export const check=()=>true;\n');
writeFileSync(join(cwd,'tools/calls.mjs'),"// Don't replace the historical handles.\nimport {check} from '../helpers/check.mjs';\nimport {readFileSync} from 'node:fs';\nimport {createClient} from 'snapback4/client';\nimport {api} from '../snapback/generated/api.ts';\nconst users=JSON.parse(readFileSync(process.env.CALLS_USERS));const client=createClient({url:process.env.BACKEND_URL,session:users.member[0]});try {const read=await client.query(api.list,{});if(!check()||read.data?.length!==1)throw Error('frozen v1 read failed '+JSON.stringify(read));console.log(JSON.stringify({ok:true,rows:read.data.length}));}finally{client.close();}\n");
async function checked(args){const r=await cli(args,{cwd});assert.equal(r.code,0,r.stdout+r.stderr);return r.stdout;}
await checked(['check']);await checked(['init','--adapt','--day2','--apply']);
const frozen=readFileSync(join(cwd,'v1/snapback/generated/api.ts'),'utf8');
const two=source.replace('  title: text <=80\n','  title: text <=80\n  color: text <=20 default \'blue\'\n');
writeFileSync(join(cwd,'versions/v2/schema.q'),two);writeFileSync(join(cwd,'snapback/schema.q'),two);await checked(['check']);assert.equal(readFileSync(join(cwd,'v1/snapback/generated/api.ts'),'utf8'),frozen);
const script=join(cwd,'scripts/day2-proof.mjs');let proof=readFileSync(script,'utf8');
proof="import {freshUser,command} from 'snapback4/proof';\nimport {createClient} from 'snapback4/client';\nimport {api} from '../v1/snapback/generated/api.ts';\nlet member;\n"+proof;
const start=proof.indexOf('  // BUSINESS_ASSERTION_BEGIN'),end=proof.indexOf('  // BUSINESS_ASSERTION_END');assert.ok(start>0&&end>start);
const hook="  // BUSINESS_ASSERTION_BEGIN\n  if(!member)member=await freshUser(host,{role:'member',provision:api.provision});\n  const client=createClient({url,session:member});\n  try {if(release==='v1'){const write=await client.mutate(api.add,{title:runName});assert.equal(write.state,'sent',JSON.stringify(write));}const read=await client.query(api.list,{});assert.equal(read.data?.length,1,JSON.stringify(read));}finally{client.close();}\n  const old=await command('npm',['--prefix','v1','run','--silent','client:calls'],{cwd:process.cwd(),env:{BACKEND_URL:url,CALLS_USERS:JSON.stringify({member:[member]})}});assert.equal(old.code,0,old.stdout+old.stderr);\n  return [];\n";
writeFileSync(script,proof.slice(0,start)+hook+proof.slice(end));
for(let run=0;run<2;run++){const r=await command('npm',['run','--silent','day2:proof'],{cwd,timeoutMs:300_000});assert.equal(r.code,0,r.stdout+r.stderr);}
await deploy('production','versions/v1',{cwd});const host=await startServe('production',{cwd});
try {const member=await freshUser(host,{role:'member',provision:{name:'provision'}});const client=createClient({url:host.url,session:member});try{assert.equal((await client.mutate({name:'add',kind:'mutation'},{title:uniqueName()})).state,'sent');}finally{client.close();}
await deploy('production','versions/v2',{cwd});const live=await snapshotAll('rows',{cwd,release:'production'});assert.equal(live.length,1);assert.equal(live[0].color,'blue');await rollback('production',1,{cwd});const retained=await snapshotAll('rows',{cwd,release:'production'});assert.deepEqual(retained,live);await rollback('production','latest',{cwd});assert.deepEqual(await snapshotAll('rows',{cwd,release:'production'}),live);
}finally{await host.stop();}
console.log('DX16 packed: two generated proof runs, frozen ESM/API + inline users at all transitions, fresh role users, complete retained snapshots');
`;
export async function proveDX16(cwd){
 writeFileSync(join(cwd,'dx16.mjs'),dx16Consumer);
 const env={...process.env};delete env.SNAPBACK4_BIN;
 await runToolchainCommand(process.execPath,['dx16.mjs'],{cwd,env,timeout:600_000});
 return {status:'passed',freshStarterCapture:true,runs:2,frozenApi:true,inlineUsers:true,freshUsers:true,retainedSnapshot:true};
}

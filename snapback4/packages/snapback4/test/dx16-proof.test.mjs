import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {uniqueName,freshUser,deploy,startServe,cli,snapshotAll,rollback} from '../dist/proof.js';
import {createClient} from '../dist/client.js';
const root=resolve(import.meta.dirname,'../../..'),env={SNAPBACK4_BIN:join(root,'target/debug/snapback4')};
function project(t,source){const cwd=mkdtempSync(join(tmpdir(),'dx16-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),source);return cwd;}
const schema=`use identity password
table roles:
  principal: principal
  role: enum('member')
  unique principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('member')):
  return insert roles {principal,role}
table rows:
  owner: principal
  title: text <=80
  cap 1 per owner
  read <- .owner = viewer
  insert <- .owner = viewer and exists roles[principal = viewer]
  online only
mutation add(title: text <=80):
  return insert rows {owner:viewer,title}
query list():
  return rows where .owner = viewer first 20 by .id
`;
test('wave33 Muse 011/005/004: two proof runs use fresh users and names without cap collisions',async t=>{
 const cwd=project(t,schema);await deploy('production','snapback',{cwd,env});const host=await startServe('production',{cwd,env});
 try{const principals=new Set(),names=new Set();for(let run=0;run<2;run++){
  const account=await freshUser(host,{role:'member',provision:{name:'provision'}});assert.ok(!principals.has(account.principal));principals.add(account.principal);
  const title=uniqueName('proof');assert.ok(!names.has(title));names.add(title);const client=createClient({url:host.url,session:account});
  try{const write=await client.mutate({name:'add',kind:'mutation'},{title});assert.equal(write.state,'sent',JSON.stringify(write));}finally{client.close();}
 }
 const roleless=await freshUser(host);assert.equal(roleless.role,'users');assert.ok(roleless.token);
 }finally{await host.stop();}
 assert.equal((await snapshotAll('rows',{cwd,env,release:'production'})).length,2);
 assert.throws(()=>uniqueName('../bad'),/E_PROOF_USAGE/);
});
test('wave33 Muse production lookups: bounded digest has helpers and roster/account shapes',()=>{
 const digest=readFileSync(join(root,'crates/snapback4-lang/src/guide/api_proof.md'),'utf8');
 for(const word of ['startServe','provisionAccounts','StagingAccount','freshUser','uniqueName','proof-accounts/default.json','roles'])assert.ok(digest.includes(word),word);
 assert.ok(Buffer.byteLength(digest)<=8000);
});

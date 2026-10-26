// Historical holderless-marker reproduction. Uses synthetic identity replies only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {provisionAccounts} from '../../packages/snapback4/dist/proof-accounts.js';

const baseline='bcf780d30729158da09d731d2e9e84aa31738f30';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const root=mkdtempSync(join(tmpdir(),'rel2-roster-proof-'));
const original=globalThis.fetch,hashes={};
let requests=0;
try {
  for(const name of ['proof-accounts','identity-request','http-response']) {
    const source=execFileSync('git',['show',`${baseline}:snapback4/packages/snapback4/src/${name}.ts`],{cwd:repo,encoding:'utf8'});
    hashes[name+'.ts']=createHash('sha256').update(source).digest('hex');
    const emitted=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
      .replace(/(["'])\.\/([^"']+)\.ts\1/g,(_,quote,name)=>`${quote}./${name}.mjs${quote}`);
    writeFileSync(join(root,name+'.mjs'),emitted);
  }
  const directory=join(root,'deployment');
  mkdirSync(join(directory,'proof-accounts'),{recursive:true,mode:0o700});
  const lock=join(directory,'proof-accounts/default.json.lock');
  writeFileSync(lock,'',{mode:0o600});
  globalThis.fetch=async input=>{
    requests++;
    const url=new URL(String(input));assert.equal(url.host,'rel2.invalid');
    if(url.pathname==='/auth/config')return Response.json({environment:'production',development:false,password:true});
    if(url.pathname==='/schema')return Response.json({service_identities:['service:operator']});
    if(url.pathname==='/auth/signup')return Response.json({session:{principal:'user:synthetic',kind:'user',token:'synthetic-session',expiresAt:Date.now()+100000}});
    assert.equal(url.pathname,'/m/provision');return Response.json({state:'sent'});
  };
  const host={url:'http://rel2.invalid',deploymentDir:directory,operatorToken:async()=> 'synthetic-operator'};
  const options={roles:{member:1},provision:{name:'provision'}};
  const old=await import(pathToFileURL(join(root,'proof-accounts.mjs')));
  await assert.rejects(old.provisionAccounts(host,options),/E_PRODUCTION_ROSTER_BUSY/);
  assert.equal(requests,0,'the old stale marker refuses before any identity I/O');
  const sessions=await provisionAccounts(host,options);
  assert.equal(sessions.member.length,1);assert.equal(requests,4);
  const released=JSON.parse(readFileSync(lock,'utf8'));
  assert.equal(released.released,true);assert.equal(released.holder.pid,process.pid);
  assert.ok(released.lease.expiresAt>=released.lease.renewedAt);
  console.log(JSON.stringify({baseline,baselineModules:hashes,before:{code:'E_PRODUCTION_ROSTER_BUSY',identityRequests:0},after:{status:'passed',accounts:1,identityRequests:requests,holderRecorded:true,leaseRecorded:true,released:true},realIdentityRequests:0},null,2));
} finally {globalThis.fetch=original;rmSync(root,{recursive:true,force:true});}

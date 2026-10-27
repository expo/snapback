import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const installed='/tmp/dx15-replay/consumers-final/proof-kit/node_modules',cwd='/tmp/dx15-replay/literal-production';
mkdirSync(join(cwd,'snapback'),{recursive:true});mkdirSync(join(cwd,'scripts'));mkdirSync(join(cwd,'dist'));
symlinkSync(installed,join(cwd,'node_modules'),'dir');
const pkg=join(installed,'snapback4'),binary=join(installed,'snapback4-linux-x64/snapback4'),kit=await import(pathToFileURL(join(pkg,'dist/proof.js')));
const env={SNAPBACK4_BIN:binary,SNAPBACK4_PROOF_LOGS:join(cwd,'private-logs')};
const capture=args=>execFileSync(binary,args,{cwd,encoding:'utf8',timeout:60000});
const production=capture(['guide','production','--full']),staging=capture(['guide','staging','--full']);
const source=staging.match(/```quarry\n([\s\S]*?)\n```/)[1],script=production.split('<!-- DX15 PRODUCTION SERVE BEGIN -->')[1].match(/```js\n([\s\S]*?)\n```/)[1];
writeFileSync(join(cwd,'snapback/schema.q'),source);capture(['check']);capture(['deploy','production']);
writeFileSync(join(cwd,'scripts/prod-serve.mjs'),script);writeFileSync(join(cwd,'dist/index.html'),'<h1>Packed production host</h1>');
writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{'prod:serve':'node scripts/prod-serve.mjs'}}));
const reports=[],principals=[];
try{
 for(let n=0;n<2;n++){
  const report=await kit.serveCheck({cwd,env,deployment:'production',upMs:150,then:async ready=>{
   assert.equal((await fetch(ready.frontendUrl+'/deep/link')).status,200);
   for(const role of ['admin','member']){
    const account=ready.accounts[role][0];assert.equal(account.kind,'user');assert.equal(account.role,role);assert.ok(account.token&&account.password&&account.expiresAt);
    const response=await fetch(ready.backendUrl+'/q/myRole',{method:'POST',headers:{authorization:`Bearer ${account.token}`,'content-type':'application/json'},body:'{"args":{}}'});
    assert.equal((await response.json()).data.role,role);
    if(n===0)principals.push(account.principal);else assert.equal(account.principal,principals[['admin','member'].indexOf(role)]);
   }
  }});
  assert.equal(report.ok,true,JSON.stringify(report));assert.ok(report.upMs>=150);reports.push(report);
 }
 writeFileSync(join(import.meta.dirname,'literal-production.json'),JSON.stringify({ok:true,recipe:'exact production serve fence, installed packs; generated api.provision; real role users; SPA fallback; two SIGTERM/lock-release runs with stable principals',snippetSha256:createHash('sha256').update(script).digest('hex'),reports},null,2)+'\n');
}finally{rmSync(cwd,{recursive:true,force:true});}

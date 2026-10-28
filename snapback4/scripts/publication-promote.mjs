// @ref LLP 3000.000.000.003#6-staging-snapshot-promotion-rel4-stretch-proposal — installed password accounts, assets and release history cross the production boundary; credentials and replica identity do not.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function provePromote(cwd) {
  const {cli,startServe}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/proof.js')));
  const {signup,login}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/auth.js')));
  const env={SNAPBACK4_BIN:undefined,PORT_LO:'31000',PORT_HI:'31999'};
  const invoke=(...args)=>cli(args,{cwd,env});
  const call=async(...args)=>{const r=await invoke(...args);assert.equal(r.code,0,r.stderr+r.stdout);return r.stdout;};
  const json=async(...args)=>JSON.parse(await call(...args,'--json'));
  const source=(name,text)=>{const path=join(cwd,name);mkdirSync(path,{recursive:true});writeFileSync(join(path,'schema.q'),text);return path;};
  const old=`use identity password
table notes:
  owner: principal
  body: text <=100
  quote: int 1..10
  scan: file <=1000
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
query list():
  return notes where .owner = viewer first 20 by .id
mutation add(body: text <=100, quote: int 1..10, scan: file <=1000):
  return insert notes {owner:viewer,body,quote,scan}
`;
  const v1=source('promote-v1',old),v2=source('promote-v2',old.replaceAll('int 1..10','int 1..20'));
  const stage=join(cwd,'promote-staging'),production=join(cwd,'promote-production');
  await call('deploy',stage,'--schema',v1,'--staging');
  const host=await startServe(stage,{cwd,env});let stopped=false;
  const post=async(url,token,kind,name,args)=>{const r=await fetch(`${url}/${kind}/${name}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({args}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return r.json();};
  try {
    const identity=await signup(host.url,'promotion@example.test','real-password-123');assert.ok(identity.ok);const user=identity.session;
    const service=await host.operatorToken();
    const bytes='retained promotion asset\n';
    const uploaded=await fetch(host.url+'/assets?as=file&name=retained.txt',{method:'POST',headers:{authorization:`Bearer ${user.token}`,'content-type':'text/plain'},body:bytes,signal:AbortSignal.timeout(10000)});assert.equal(uploaded.status,200);const asset=(await uploaded.json()).asset;
    const row=await post(host.url,user.token,'m','add',{body:'retained data',quote:10,scan:{id:asset.id}});assert.equal(row.state,'sent');
    await call('deploy',stage,'--schema',v2,'--staging');
    const live=await invoke('promote',stage,production,'--check');assert.notEqual(live.code,0);assert.match(live.stderr+live.stdout,/source must be stopped/);assert.equal(existsSync(production),false);
    await host.stop();stopped=true;
    const before=await json('releases',stage);
    const preview=await json('promote',stage,production,'--check');assert.equal(preview.preview,true);assert.equal(existsSync(production),false);
    const result=await json('promote',stage,production);assert.notEqual(result.promotion.sourceStore,result.promotion.destinationStore);assert.ok(result.promotion.revokedSessions>=2);
    assert.deepEqual(JSON.parse(readFileSync(join(production,'promotion.json'),'utf8')),result.promotion);
    const after=await json('releases',production);for(const key of ['current','latest','generation','revision','events'])assert.deepEqual(after[key],before[key]);
    const duplicate=await invoke('promote',stage,production);assert.notEqual(duplicate.code,0);assert.match(duplicate.stderr+duplicate.stdout,/destination already exists/);
    const prod=await startServe(production,{cwd,env});
    try {
      const config=await (await fetch(prod.url+'/auth/config',{signal:AbortSignal.timeout(10000)})).json();assert.equal(config.environment,'production');assert.equal(config.devDoors,false);
      for(const token of [user.token,typeof service==='string'?service:service.token]) {
        const denied=await fetch(prod.url+'/q/list',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:'{"args":{}}',signal:AbortSignal.timeout(10000)});assert.equal(denied.status,401);
      }
      const signed=await login(prod.url,'promotion@example.test','real-password-123');assert.ok(signed.ok);assert.equal(signed.session.principal,user.principal);
      const read=async()=>{const rows=(await post(prod.url,signed.session.token,'q','list',{})).data;assert.equal(rows.length,1);assert.equal(rows[0].id,row.result.id);assert.equal(rows[0].scan.id,asset.id);const content=await fetch(prod.url+'/assets/'+asset.id,{headers:{authorization:`Bearer ${signed.session.token}`},signal:AbortSignal.timeout(10000)});assert.equal(content.status,200);assert.equal(await content.text(),bytes);};
      await read();for(let cycle=0;cycle<2;cycle++){await call('rollback',production,'--to','1');await read();await call('rollback',production,'--to','latest');await read();}
    } finally {await prod.stop();}
    assert.deepEqual(await json('releases',stage),before);
    const original=await startServe(stage,{cwd,env});try{assert.equal((await post(original.url,user.token,'q','list',{})).data[0].id,row.result.id);}finally{await original.stop();}
    return {status:'passed',realPasswordAccounts:true,oldTokensRefused:true,freshStoreIdentity:true,assetBytesAndHomes:true,releaseHistory:true,sourceUnchanged:true,cycles:2};
  } finally {if(!stopped)await host.stop();}
}

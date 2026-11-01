// @ref LLP 3000.000.000.003#reviews-and-verification — frozen v1 reads execute against packed release cycles.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function proveREL3(cwd) {
  const {cli,startServe}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/proof.js')));
  const {guest}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/auth.js')));
  const env={SNAPBACK4_BIN:undefined,PORT_LO:'31000',PORT_HI:'31999'};
  const call=async(...args)=>{const r=await cli(args,{cwd,env});assert.equal(r.code,0,r.stderr+r.stdout);return r.stdout;};
  const json=async(...args)=>JSON.parse(await call(...args,'--json'));
  const old=`use identity guests
table items:
  label: text <=40
  public 'shared'
  insert <- allow
  online only
query list(c: cursor ?):
  return items first 2 by .id after c
query one(id: items):
  item = items[id]
  if item = null:
    return null
  return item
mutation add(label: text <=40):
  return insert items {label}
`;
  const next=old.replace('  label: text <=40','  title: text <=160 renamed from label')
    .replace('add(label: text <=40)','add(title: text <=160 alias label)')
    .replace('insert items {label}','insert items {title}')
    +'alias result list.label = title\nalias result one.label = title\nalias result add.label = title\n';
  const source=(name,text)=>{const path=join(cwd,name);mkdirSync(path,{recursive:true});writeFileSync(join(path,'schema.q'),text);return path;};
  const v1=source('rel3-v1',old),v2=source('rel3-v2',next),deployment=join(cwd,'rel3-deployment');
  await call('deploy',deployment,'--schema',v1);
  const host=await startServe(deployment,{cwd,env});
  try {
    const identity=await guest(host.url);assert.ok(identity.ok);const session=identity.session;
    const post=async(kind,op,args)=>{const r=await fetch(`${host.url}/${kind}/${op}`,{method:'POST',headers:{authorization:`Bearer ${session.token}`,'content-type':'application/json'},body:JSON.stringify({args}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return r.json();};
    const first=await post('m','add',{label:'frozen caller'});assert.equal(first.state,'sent');
    const review=await call('deploy',deployment,'--schema',v2,'--check');
    assert.match(review,/RESULT REVIEW/);assert.match(review,/covered by alias list\.label = title/);
    await call('deploy',deployment,'--schema',v2);
    const wide='w'.repeat(120);const created=await post('m','add',{label:wide});assert.equal(created.state,'sent');assert.equal(created.result.label,wide);
    const read=async()=>{const out=await post('q','list',{c:null});assert.equal(out.data.length,2);assert.deepEqual(out.data.map(r=>r.label).sort(),['frozen caller',wide].sort());assert.equal((await post('q','one',{id:'absent'})).data,null);assert.equal((await post('q','one',{id:first.result.id})).data.label,'frozen caller');};
    await read();
    for(let cycle=0;cycle<2;cycle++) {
      const preview=await json('rollback',deployment,'--to','1','--check');assert.equal(preview.visibility.hiddenRows,0);
      await call('rollback',deployment,'--to','1');await read();
      const before=await json('releases',deployment);
      const unchanged=await json('rollback',deployment,'--to','1');assert.equal(unchanged.unchanged,true);assert.match(unchanged.message,/already live/);
      assert.deepEqual(await json('releases',deployment),before);
      await call('rollback',deployment,'--to','latest');await read();
    }
    return {status:'passed',lanes:['041','012','024','005','023'],frozenReads:true,wideNativeRows:true,explicitNull:true,idempotent:true,cycles:2};
  } finally {await host.stop();}
}

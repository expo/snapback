// @ref LLP 3000.000.000.003#5-loosen-required-and-release-refusals-rel4 — exercise the installed CLI, real null writes and retained rows.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function proveREL4(cwd) {
  const {cli,startServe}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/proof.js')));
  const {guest}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/auth.js')));
  const env={SNAPBACK4_BIN:undefined,PORT_LO:'31000',PORT_HI:'31999'};
  const invoke=(...args)=>cli(args,{cwd,env});
  const call=async(...args)=>{const r=await invoke(...args);assert.equal(r.code,0,r.stderr+r.stdout);return r.stdout;};
  const json=async(...args)=>JSON.parse(await call(...args,'--json'));
  const source=(name,text)=>{const path=join(cwd,name);mkdirSync(path,{recursive:true});writeFileSync(join(path,'schema.q'),text);return path;};
  const old=`use identity guests
table jobs:
  price: int 1..100
  cap 100
  public 'shared quote fixture'
  insert <- allow
  online only
query list():
  return jobs first 20 by .id
mutation add(price: int 1..100):
  return insert jobs {price}
`;
  const nullable=old.replaceAll('price: int 1..100','price: int 1..100 ?');
  const next=nullable+"invariant jobs always .price = null or .price != null\nrollback 1 hides jobs where price = null because 'An unquoted price is pending.'\n";
  const v1=source('rel4-v1',old),v2=source('rel4-v2',next),deployment=join(cwd,'rel4-deployment');
  await call('deploy',deployment,'--schema',v1);
  const host=await startServe(deployment,{cwd,env});
  try {
    const identity=await guest(host.url);assert.ok(identity.ok);
    const post=async(kind,name,args)=>{const r=await fetch(`${host.url}/${kind}/${name}`,{method:'POST',headers:{authorization:`Bearer ${identity.session.token}`,'content-type':'application/json'},body:JSON.stringify({args}),signal:AbortSignal.timeout(10000)});assert.equal(r.status,200);return r.json();};
    assert.equal((await post('m','add',{price:10})).state,'sent');
    const gate=await invoke('deploy',deployment,'--schema',source('rel4-unanswered',nullable),'--check');
    assert.notEqual(gate.code,0);assert.match(gate.stderr+gate.stdout,/adoption preflight: READY \(first\)/);assert.match(gate.stderr+gate.stdout,/security gate \(second\)/);
    await call('deploy',deployment,'--schema',v2,'--check');await call('deploy',deployment,'--schema',v2);
    assert.equal((await post('m','add',{price:null})).state,'sent');
    const preview=await json('deploy',deployment,'--schema',v2,'--check');assert.ok(preview.rollbackViewEffects.every(v=>v.ready));
    for(let cycle=0;cycle<2;cycle++) {
      const planned=await json('rollback',deployment,'--to','1','--check');assert.equal(planned.visibility.hiddenRows,1);
      await call('rollback',deployment,'--to','1');
      assert.equal((await post('q','list',{})).data.length,1);
      assert.match(JSON.stringify(await post('m','add',{price:null})),/ROLLBACK_NULL/);
      await call('rollback',deployment,'--to','latest');
      const rows=(await post('q','list',{})).data;assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.price).sort(),[10,null].sort());
    }
    const bad=`table jobs:
  public
  online only
table photos:
  job: jobs on delete cascade
  photo: file <=1000 ?
  createdAt: time default now
  immutable job
  read through .job
  online only
extract photos from jobs via job: {photo:photo}
`;
    const invalid=await invoke('check','--schema',source('rel4-clock',bad));assert.notEqual(invalid.code,0);assert.match(invalid.stderr+invalid.stdout,/photos\.createdAt/);assert.match(invalid.stderr+invalid.stdout,/literal default/);
    await call('check','--schema',source('rel4-clock-safe',bad.replace('createdAt: time default now','createdAt: time ?')));
    return {status:'passed',nullWrites:true,invariants:true,globalCap:true,adoptionBeforeSecurity:true,extractDefaultCheck:true,cycles:2};
  } finally {await host.stop();}
}

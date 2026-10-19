// @ref LLP 3000.000.000#16-release-reactivation-and-rollback-foresight-rel5 — run the same transitions with development and installed binaries.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export async function releaseTransitions({ cli, startServe }, parent) {
  const root=mkdtempSync(join(parent,'release-transitions-'));
  const active=new Set();
  try {
    const fixture=name=> {
      const cwd=join(root,name);mkdirSync(join(cwd,'snapback'),{recursive:true});
      const deployment=join(cwd,'deployment'),schema=join(cwd,'snapback/schema.q');
      const invoke=args=>cli(args,{cwd,timeoutMs:60_000});
      const run=async args=>{const r=await invoke(args);assert.equal(r.code,0,r.stdout+r.stderr);return r;};
      const status=async()=>JSON.parse((await run(['releases',deployment,'--json'])).stdout);
      const releases=()=>readdirSync(join(deployment,'releases')).sort();
      const source=text=>writeFileSync(schema,text);
      const serve=async()=> {
        const host=await startServe(deployment,{cwd,timeoutMs:60_000});active.add(host);
        const signed=await (await fetch(host.url+'/auth/guest',{method:'POST',body:'{}'})).json();
        assert.ok(signed.session?.token,JSON.stringify(signed));
        const headers={'content-type':'application/json',authorization:'Bearer '+signed.session.token};
        const post=async(path,args={},id)=> {
          const r=await fetch(host.url+path,{method:'POST',headers,body:JSON.stringify({args,...(id?{id}:{})}),signal:AbortSignal.timeout(30_000)});
          return r.json();
        };
        return {host,post};
      };
      return {cwd,deployment,schema,invoke,run,status,releases,source,serve};
    };
    const f=fixture('reactivation');
    const v1=`use identity guests
table items:
  body: text <=40
  public 'release proof'
  insert <- allow
  update <- allow
mutation add(body: text <=40):
  return insert items {body}
query list():
  return items first 20 by .id
`;
    const v2=v1.replace('  body: text','  extra: text <=40 default \'default\'\n  body: text')+`mutation mark(id: items):
  return update items[id] {extra: 'preserved'}
`;
    f.source(v1);await f.run(['deploy',f.deployment]);
    f.source(v2);await f.run(['deploy',f.deployment]);await f.run(['rollback',f.deployment,'--to','1']);
    const before=await f.status();
    const check=JSON.parse((await f.run(['deploy',f.deployment,'--check','--json'])).stdout);
    assert.equal(check.plan.release,2);assert.deepEqual(await f.status(),before);assert.deepEqual(f.releases(),['1','2']);
    assert.equal(JSON.parse((await f.run(['deploy',f.deployment,'--json'])).stdout).release,2);
    const {host,post}=await f.serve();
    const added=await post('/m/add',{body:'kept'},'rel5-add');assert.equal(added.state,'sent',JSON.stringify(added));
    const id=added.result.id;
    assert.equal((await post('/m/mark',{id},'rel5-mark')).state,'sent');
    await f.run(['rollback',f.deployment,'--to','1','--restore-dormant']);
    await f.run(['deploy',f.deployment]);
    assert.equal((await f.status()).release,2);assert.equal((await post('/q/list')).data[0].extra,'preserved');
    const unchanged=await f.status();assert.equal(JSON.parse((await f.run(['deploy',f.deployment,'--json'])).stdout).unchanged,true);
    assert.deepEqual(await f.status(),unchanged);
    f.source(v2.replace('  body: text','  required: int\n  body: text').replace('insert items {body}','insert items {body, required: 1}'));
    const failed=await f.invoke(['deploy',f.deployment]);assert.equal(failed.code,1);assert.match(failed.stderr,/E_ADOPT/);
    assert.deepEqual(f.releases(),['1','2']);assert.deepEqual(await f.status(),unchanged);
    assert.equal((await post('/q/list')).data[0].extra,'preserved');
    await host.stop();active.delete(host);
    // Failure after validation, before database commit, also cleans its numeric source.
    f.source(v2.replace("return items first 20", "return items first 19"));
    rmSync(join(f.deployment,'current'));mkdirSync(join(f.deployment,'current'));
    const pointerFailure=await f.invoke(['deploy',f.deployment]);assert.equal(pointerFailure.code,1);assert.match(pointerFailure.stderr,/current must be a regular/);
    assert.deepEqual(f.releases(),['1','2']);rmSync(join(f.deployment,'current'),{recursive:true});writeFileSync(join(f.deployment,'current'),'2\n');

    const g=fixture('foresight');
    const prior=`use identity guests
table gauges:
  minPressure: int 0..2000
  public 'rollback proof'
  insert <- allow
mutation add():
  return insert gauges {minPressure: 4}
`;
    const next=prior.replace('  minPressure: int 0..2000\n','  lowPressure: int 0..2000 default 0\n').replace('{minPressure: 4}','{lowPressure: 4}');
    g.source(prior);await g.run(['deploy',g.deployment]);g.source(next);
    const foresight=JSON.parse((await g.run(['deploy',g.deployment,'--check','--json'])).stdout);
    assert.ok(foresight.hazards.some(s=>s.includes('gauges.minPressure')&&s.includes('new rows')&&s.includes('--to 1 --check --bridge')));
    assert.match((await g.run(['deploy',g.deployment])).stderr,/rollback foresight.*gauges.minPressure/);
    const h=await g.serve();assert.equal((await h.post('/m/add',{},'rel5-new-gauge')).state,'sent');
    const rollback=await g.invoke(['rollback',g.deployment,'--to','1','--check']);assert.equal(rollback.code,1);assert.match(rollback.stderr,/minPressure/);
    await h.host.stop();active.delete(h.host);

    const c=fixture('contracts');
    // Execute both Quarry blocks from the installed guide, without source substitutions.
    const guide=(await c.run(['guide','deploy','--section','Keep v1 clients working'])).stdout;
    const blocks=[...guide.matchAll(/```quarry\n([\s\S]*?)```/g)].map(m=>m[1]);assert.equal(blocks.length,2,guide);
    c.source(blocks[0]);await c.run(['deploy',c.deployment]);
    const oldHost=await c.serve();const frozenArgs={name:'Ada',obsolete:'old input'};
    assert.deepEqual((await oldHost.post('/q/greet',frozenArgs)).data,{message:'Ada!'});
    c.source(blocks[1]);
    const safe=JSON.parse((await c.run(['deploy',c.deployment,'--check','--json'])).stdout);assert.deepEqual(safe.clientCompatibility,[]);
    await c.run(['deploy',c.deployment]);
    assert.deepEqual((await oldHost.post('/q/greet',frozenArgs)).data,{message:'Ada!'});
    assert.deepEqual((await oldHost.post('/q/greeting',{name:'Ada'})).data,{message:'Ada!'});
    await oldHost.host.stop();active.delete(oldHost.host);
    const unsafe=blocks[1].replace("suffix: text <=1 default '!'","suffix: text <=1").replace(', obsolete: text <=40 deprecated','');
    c.source(unsafe);
    const diff=JSON.parse((await c.run(['deploy',c.deployment,'--check','--json'])).stdout).clientCompatibility.join('\n');
    assert.match(diff,/greet.*argument suffix retyped or narrowed/);assert.match(diff,/greet.*removed argument obsolete/);
    mkdirSync(join(c.cwd,'versions/v1'),{recursive:true});writeFileSync(join(c.cwd,'versions/v1/schema.q'),blocks[0]);
    writeFileSync(join(c.cwd,'snapback/client-compatibility.json'),JSON.stringify({baseline:'versions/v1',since_release:2}));
    const baseline=await c.run(['check']);assert.match(baseline.stderr,/old-client compatibility \(baseline .*new required argument suffix/);
    const generated=readFileSync(join(c.cwd,'snapback/generated/api.ts'),'utf8');assert.match(generated,/suffix: string/);assert.doesNotMatch(generated,/suffix\?:/);
    return {status:'passed',reactivation:['cold','hot','same-id','dormant-values','unchanged'],refusals:['adoption','post-validation-pointer','no-candidate-left'],rollbackForesight:'dropped-required-column-and-later-writes',oldClients:'installed-guide-and-signature-diff-and-baseline'};
  } finally {
    try {for(const host of active)await host.stop();} finally {rmSync(root,{recursive:true,force:true});}
  }
}

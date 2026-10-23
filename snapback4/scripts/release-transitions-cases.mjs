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
      const serve=async(options={})=> {
        const host=await startServe(deployment,{cwd,timeoutMs:60_000,...options});active.add(host);
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
    const unsafePreview=await g.invoke(['deploy',g.deployment,'--check','--json']);
    assert.equal(unsafePreview.code,1);assert.match(unsafePreview.stderr,/minPressure/);assert.match(unsafePreview.stderr,/guarded|truthful|compatible/);
    const unsafeDeploy=await g.invoke(['deploy',g.deployment,'--json']);assert.equal(unsafeDeploy.code,1);assert.match(unsafeDeploy.stderr,/minPressure/);
    assert.deepEqual(g.releases(),['1'],'an unrepresented required old field refuses before a release is adopted');
    const compatible=next+"\ndown gauges oldMinimum(lowPressure: int 0..2000): {minPressure:lowPressure}\n";
    g.source(compatible);const foresight=JSON.parse((await g.run(['deploy',g.deployment,'--check','--json'])).stdout);
    assert.ok(!foresight.hazards.some(s=>s.startsWith('rollback foresight:')&&s.includes('gauges.minPressure')),'a truthful authored reverse resolves the old-row risk');
    await g.run(['deploy',g.deployment,'--json']);
    const h=await g.serve();assert.equal((await h.post('/m/add',{},'rel5-new-gauge')).state,'sent');
    const rollback=JSON.parse((await g.run(['rollback',g.deployment,'--to','1','--check','--json'])).stdout);assert.equal(rollback.visibility.hiddenRows,0);
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
    const coldRollback=await c.run(['rollback',c.deployment,'--to','1','--verbose']);
    assert.match(coldRollback.stderr,/old-client compatibility.*release 2.*greeting.*removed operation/);
    const hotRollback=await c.serve();
    await c.run(['rollback',c.deployment,'--to','2']);
    const hotWarning=await c.run(['rollback',c.deployment,'--to','1','--verbose']);
    assert.match(hotWarning.stderr,/old-client compatibility.*release 2.*greeting.*removed operation/);
    await hotRollback.host.stop();active.delete(hotRollback.host);
    const d=fixture('projected-domains');
    const rows=`use identity guests
table items:
  n: int 0..10
  label: text 1..20
  public 'result domain proof'
query list():
  return items first 10 by .id {n, label}
`;
    d.source(rows);await d.run(['deploy',d.deployment]);
    d.source(rows.replace('int 0..10','int 0..20').replace('text 1..20','text 0..20'));
    const domains=JSON.parse((await d.run(['deploy',d.deployment,'--check','--json'])).stdout).clientCompatibility.join('\n');
    assert.match(domains,/RESULT REVIEW.*items.label/);assert.match(domains,/RESULT REVIEW.*items.n/);
    // Cross-lane acceptance: retained release identity owns its backfill receipts.
    const b=fixture('backfill-reactivation');
    const original=`use identity guests
table counters:
  value: int
  public 'release backfill proof'
  insert <- allow
mutation add(value: int):
  return insert counters {value}
query list():
  return counters first 20 by .id
`;
    const transformed=original.replace('mutation add(value: int):','mutation current(value: int default 10):')+`alias add = current
backfill counters increment(value: int): {value: value + 1}
`;
    b.source(original);await b.run(['deploy',b.deployment]);
    const backfillHost=await b.serve();
    assert.equal((await backfillHost.post('/m/add',{value:4},'integ18-original')).state,'sent');
    b.source(transformed);
    const combined=JSON.parse((await b.run(['deploy',b.deployment,'--check','--json'])).stdout);
    assert.ok(combined.backfills.length,JSON.stringify(combined));
    assert.ok(Array.isArray(combined.clientCompatibility),JSON.stringify(combined));
    assert.equal((await backfillHost.post('/q/list')).data[0].value,4,'preview is read-only');
    await b.run(['deploy',b.deployment]);
    assert.equal((await backfillHost.post('/q/list')).data[0].value,5);
    for(let round=0;round<2;round++) {
      await b.run(['rollback',b.deployment,'--to','1']);
      assert.equal((await backfillHost.post('/q/list')).data[0].value,4);
      await b.run(['deploy',b.deployment]);
      assert.equal((await b.status()).release,2);
      assert.equal((await backfillHost.post('/q/list')).data[0].value,5,'non-idempotent backfill runs once per historical view');
      assert.deepEqual(b.releases(),['1','2']);
    }
    assert.equal((await backfillHost.post('/m/add',{},'integ18-default')).result.value,10,'alias shares the default');
    assert.equal((await backfillHost.post('/m/current',{value:20},'integ18-native')).result.value,20);
    await b.run(['rollback',b.deployment,'--to','1']);
    await b.run(['deploy',b.deployment]);
    assert.deepEqual((await backfillHost.post('/q/list')).data.map(row=>row.value).sort((a,b)=>a-b),[5,10,20],'native outputs survive reactivation');
    await backfillHost.host.stop();active.delete(backfillHost.host);
    const timed=fixture('reverse-preview-staging-clock');
    const timedV1=`use identity guests
table parents:
  until: time
  expire at .until
  public 'staging preview'
  insert <- allow
  online only
table children:
  parent: parents on delete restrict
  public 'staging preview'
  insert <- allow
  online only
table items:
  n: int
  public 'staging preview'
  insert <- allow
  online only
mutation setup():
  p = insert parents {until:now + 3600000}
  insert children {parent:p.id}
  return insert items {n:1}
`;
    timed.source(timedV1);await timed.run(['deploy',timed.deployment,'--staging']);
    const clockHost=await timed.serve({clockOffset:'-2h'});
    assert.equal((await clockHost.post('/m/setup',{},'integ18-clock')).state,'sent');
    timed.source(timedV1+'backfill items double(n: int): {n:n * 2}\n');
    const timedPreview=JSON.parse((await timed.run(['deploy',timed.deployment,'--check','--json'])).stdout);
    assert.ok(timedPreview.backfills.length);
    assert.ok(!timedPreview.hazards.some(line=>line.includes('refuses on the post-deploy snapshot')),JSON.stringify(timedPreview));
    await clockHost.host.stop();active.delete(clockHost.host);
    // Preview capture must survive activation changing SQLite temp_store for
    // live-parent restoration. Exercise both live and captured read-through
    // records across rollback preview and retained-source deploy restoration.
    const p=fixture('preview-live-and-captured-refs');
    const refs=`use identity guests
table liveParents:
  owner: principal
  access: enum('open','pending','closed')
  immutable owner, access
  read <- .owner = viewer and .access != 'closed'
  insert <- .owner = viewer
  online only
table liveChildren:
  parent: liveParents
  body: enum('live','captured','other')
  note: text ?
  unused: text ?
  immutable parent
  cap 5 by parent
  read through live .parent
  insert <- allow
  online only
table capturedParents:
  owner: principal
  access: enum('open','pending','closed')
  immutable owner, access
  read <- .owner = viewer and .access != 'closed'
  insert <- .owner = viewer
  online only
table capturedChildren:
  parent: capturedParents
  body: enum('live','captured','other')
  immutable parent
  read through .parent
  insert <- allow
  online only
mutation setup():
  liveParent = insert liveParents {owner:viewer, access:'open'}
  insert liveChildren {parent:liveParent.id, body:'live', note:null}
  capturedParent = insert capturedParents {owner:viewer, access:'open'}
  return insert capturedChildren {parent:capturedParent.id, body:'captured'}
query liveRows():
  return liveChildren first 10 by .id
query capturedRows():
  return capturedChildren first 10 by .id
`;
    const narrowed=refs.replaceAll("body: enum('live','captured','other')","body: enum('other')\n  later: text ?").replace("body:'live'","body:'other'").replace("body:'captured'","body:'other'");
    p.source(refs);await p.run(['deploy',p.deployment]);
    const refHost=await p.serve();assert.equal((await refHost.post('/m/setup',{},'dorm-preview-refs')).state,'sent');
    assert.equal((await refHost.post('/q/liveRows')).data[0].body,'live');
    assert.equal((await refHost.post('/q/capturedRows')).data[0].body,'captured');
    p.source(narrowed);await p.run(['deploy',p.deployment]);
    const dormantRows=JSON.parse((await p.run(['sql','SELECT id, body, note, later, _snapback_state, _snapback_source, _snapback_columns FROM liveChildren','--release',p.deployment,'--dormant','--json-objects'])).stdout);
    assert.equal(dormantRows.rows.length,1,JSON.stringify(dormantRows));
    assert.equal(dormantRows.rows[0].body,'live');assert.equal(dormantRows.rows[0]._snapback_state,'dormant-row');assert.equal(dormantRows.rows[0]._snapback_source,'narrowed');
    assert.equal(dormantRows.rows[0].note,null);assert.equal(dormantRows.rows[0].later,null);
    const provided=JSON.parse(dormantRows.rows[0]._snapback_columns);assert.ok(provided.includes('note'),JSON.stringify(provided));assert.ok(!provided.includes('later'),JSON.stringify(provided));
    const retainedRows=JSON.parse((await p.run(['sql','SELECT id, body, _snapback_state, _snapback_source FROM capturedChildren','--release',p.deployment,'--all-releases','--json-objects'])).stdout);
    assert.equal(retainedRows.rows.length,1,JSON.stringify(retainedRows));assert.equal(retainedRows.rows[0]._snapback_source,'narrowed');
    const internal=await p.invoke(['sql','SELECT * FROM _dormant_rows','--release',p.deployment,'--dormant']);assert.equal(internal.code,1);assert.match(internal.stderr,/E_SQL_INTERNAL/);
    const beforeRefPreview=await p.status();
    const checked=await p.run(['rollback',p.deployment,'--to','1','--check','--json']);
    assert.equal(JSON.parse(checked.stdout).plan.release,1);assert.deepEqual(await p.status(),beforeRefPreview);
    p.source(refs);const restored=JSON.parse((await p.run(['deploy',p.deployment,'--restore-dormant','--json'])).stdout);
    assert.equal(restored.sourceRelease,1);assert.equal((await p.status()).release,restored.release);
    assert.equal(readFileSync(join(p.deployment,'releases',String(restored.release),'snapback/schema.q'),'utf8'),refs,'registration parent preserves exact retained source');
    assert.equal((await refHost.post('/q/liveRows')).data[0].body,'live');
    assert.equal((await refHost.post('/q/capturedRows')).data[0].body,'captured');
    const activeAndRetained=JSON.parse((await p.run(['sql','SELECT body, _snapback_state, _snapback_source, _snapback_columns FROM liveChildren','--release',p.deployment,'--all-releases','--json-objects'])).stdout);
    assert.equal(activeAndRetained.rows.length,1);assert.equal(activeAndRetained.rows[0].body,'live');assert.equal(activeAndRetained.rows[0]._snapback_state,'active');assert.equal(activeAndRetained.rows[0]._snapback_source,null);
    assert.ok(p.releases().every(name=>/^\d+$/.test(name)),'no stage survives source requalification');
    assert.ok(JSON.parse(readFileSync(join(p.deployment,'releases',String(restored.release),'rollback-views.json'),'utf8')).some(view=>view.target===2),'reactivated wider source guards rollback to the narrower predecessor');
    // A predicate-only change preserves captured parent/lifetime evidence;
    // selecting the retained broader rule must not require recapture.
    const predicate=refs.replaceAll(".access != 'closed'",".access = 'open'");
    p.source(predicate);await p.run(['deploy',p.deployment]);
    assert.equal((await refHost.post('/q/capturedRows')).data[0].body,'captured');
    await p.run(['rollback',p.deployment,'--to','1','--check']);
    await p.run(['rollback',p.deployment,'--to','1']);
    assert.equal((await refHost.post('/q/capturedRows')).data[0].body,'captured');
    await refHost.host.stop();active.delete(refHost.host);
    return {status:'passed',reactivation:['cold','hot','same-id','dormant-values','unchanged','backfill-receipts','live-and-captured-ref-preview'],refusals:['adoption','post-validation-pointer','no-candidate-left'],rollbackForesight:'dropped-required-column-and-later-writes',oldClients:'installed-guide-signature-diff-baseline-projected-domains'};
  } finally {
    try {for(const host of active)await host.stop();} finally {rmSync(root,{recursive:true,force:true});}
  }
}

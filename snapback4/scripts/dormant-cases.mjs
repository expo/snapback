// @ref LLP 3000.000.000#19-dormant-visibility-and-migration-dorm — the same business assertions run against development and packed binaries.
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';

export async function dormantCases({cli,startServe},parent) {
  const cwd=mkdtempSync(join(parent,'dormant-cases-'));
  let host;
  try {
    mkdirSync(join(cwd,'snapback'));
    const deployment=join(cwd,'deployment'),schema=join(cwd,'snapback/schema.q');
    const invoke=args=>cli(args,{cwd,timeoutMs:60_000});
    const run=async args=>{const result=await invoke(args);assert.equal(result.code,0,result.stderr+result.stdout);return result;};
    const old=`use identity guests
table entries:
  owner: principal
  count: int 1..1000
  reason: text <=100 ?
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
mutation add(count: int 1..1000, reason: text <=100 ?):
  return insert entries {owner:viewer, count, reason}
mutation edit(entry: entries, count: int 1..1000):
  return update entries[entry] {count}
mutation reason(entry: entries, reason: text <=100 ?):
  return update entries[entry] {reason}
query all():
  return entries where .owner = viewer first 100 by .id
`;
    const newer=`use identity guests
table entries:
  owner: principal
  count: int 0..1000
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
table explanations:
  owner: principal
  entry: entries
  text: text <=100
  unique entry
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
mutation add(count: int 0..1000, reason: text <=100):
  row = insert entries {owner:viewer, count}
  insert explanations {owner:viewer, entry:row.id, text:reason}
  return row
mutation explain(entry: entries, reason: text <=100):
  return update explanations[entry = entry] {text:reason}
query all():
  return entries where .owner = viewer first 100 by .id
down entries legacyReason(id: id):
  {reason:(explanations[entry = id] ! else MISSING_REASON).text}
`;
    writeFileSync(schema,old);await run(['deploy',deployment]);
    host=await startServe(deployment,{cwd,timeoutMs:60_000});
    const auth=await (await fetch(host.url+'/auth/guest',{method:'POST',body:'{}',signal:AbortSignal.timeout(30_000)})).json();
    assert.ok(auth.session?.token,JSON.stringify(auth));
    const post=async(path,args={})=>{
      const response=await fetch(host.url+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.session.token},body:JSON.stringify({args}),signal:AbortSignal.timeout(30_000)});
      return response.json();
    };
    const historical=await post('/m/add',{count:2,reason:'original v1 reason'});assert.equal(historical.state,'sent',JSON.stringify(historical));
    writeFileSync(schema,newer);await run(['deploy',deployment]);
    const native=await post('/m/add',{count:3,reason:'exact v2 text'});assert.equal(native.state,'sent',JSON.stringify(native));
    const zero=await post('/m/add',{count:0,reason:'zero is not one'});assert.equal(zero.state,'sent',JSON.stringify(zero));
    const preview=JSON.parse((await run(['rollback',deployment,'--to','1','--check','--json'])).stdout);
    assert.equal(preview.visibility.hiddenRows,1,JSON.stringify(preview));
    assert.equal(preview.visibility.emptyCells,0,'declared reverse keeps reason text');
    assert.equal(preview.visibility.newerOnlyRows,2);
    assert.equal((await post('/q/all')).data.length,3,'preview never activates');
    await run(['rollback',deployment,'--to','1']);
    const oldRows=(await post('/q/all')).data;
    assert.equal(oldRows.length,2,'unrepresentable zero is dormant');
    assert.equal(oldRows.find(row=>row.id===native.result.id).reason,'exact v2 text');
    assert.equal(oldRows.find(row=>row.id===historical.result.id).reason,'original v1 reason','saved preimage wins without a side-table lookup');
    const retained=JSON.parse((await run(['sql','SELECT _snapback_state, COUNT(*) FROM explanations GROUP BY _snapback_state','--release',deployment,'--dormant','--json'])).stdout);
    assert.equal(retained.rows.reduce((n,row)=>n+row[1],0),2);
    const all=JSON.parse((await run(['sql','SELECT COUNT(*) FROM entries','--release',deployment,'--all-releases','--json'])).stdout);
    assert.ok(all.rows[0][0]>=3,'active plus retained images');
    assert.equal((await post('/m/edit',{entry:native.result.id,count:7})).state,'sent');
    await run(['deploy',deployment]);
    const forward=(await post('/q/all')).data;
    assert.equal(forward.length,3);
    assert.equal(forward.find(row=>row.id===native.result.id).count,7,'unrelated old-source edit survives');
    assert.equal(forward.find(row=>row.id===zero.result.id).count,0,'exact zero restored');
    assert.ok(!('reason' in forward.find(row=>row.id===native.result.id)),'old projected field is absent from v2');
    assert.equal((await post('/m/explain',{entry:native.result.id,reason:'current v2 text'})).state,'sent');
    await run(['rollback',deployment,'--to','1']);
    assert.equal((await post('/q/all')).data.find(row=>row.id===native.result.id).reason,'current v2 text','prior down image never suppresses current truth');
    assert.equal((await post('/m/reason',{entry:native.result.id,reason:'authored old edit'})).state,'sent');
    const refused=await invoke(['deploy',deployment]);assert.equal(refused.code,1,refused.stderr+refused.stdout);assert.match(refused.stderr,/E_ADOPT|conflict|changed/i);
    assert.equal((await post('/q/all')).data.find(row=>row.id===native.result.id).reason,'authored old edit','failed forward preserves old edit');
    assert.equal((await post('/m/reason',{entry:native.result.id,reason:'current v2 text'})).state,'sent');
    await run(['deploy',deployment]);
    const migrations=await migrationCycles({cli,startServe},cwd);
    return {status:'passed',oldTableHidden:1,oldViewTextsPreserved:2,newerOnlyRows:2,forwardExactZero:true,unrelatedOldEditPreserved:true,projectedEditRefused:true,...migrations};
  } finally {
    try {await host?.stop();} finally {rmSync(cwd,{recursive:true,force:true});}
  }
}

// New v1 writes after rollback need both the rename and the required label on
// forward activation. Exercise repeated activation through the public CLI/HTTP.
async function migrationCycles({cli,startServe},parent) {
  const cwd=mkdtempSync(join(parent,'migration-cycles-'));
  let host;
  try {
    mkdirSync(join(cwd,'snapback'));
    const deployment=join(cwd,'deployment'),schema=join(cwd,'snapback/schema.q');
    const run=async args=>{const r=await cli(args,{cwd,timeoutMs:60_000});assert.equal(r.code,0,r.stderr+r.stdout);return r;};
    const old=`use identity guests
table pickups:
  owner: principal
  title: text <=40
  weight: int
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation add(title: text <=40, weight: int):
  return insert pickups {owner:viewer,title,weight}
query all():
  return pickups where .owner = viewer first 100 by .id
`;
    const newer=old.replace('  title: text <=40','  name: text <=40 renamed from title\n  label: text <=20')
      .replace('return insert pickups {owner:viewer,title,weight}',"return insert pickups {owner:viewer,name:title,label:'heavy' if weight > 100 else 'light',weight}")
      +"backfill pickups labels(weight: int):\n  {label:'heavy' if weight > 100 else 'light'}\n";
    writeFileSync(schema,old);await run(['deploy',deployment]);
    host=await startServe(deployment,{cwd,timeoutMs:60_000});
    const auth=await(await fetch(host.url+'/auth/guest',{method:'POST',body:'{}',signal:AbortSignal.timeout(30_000)})).json();
    assert.ok(auth.session?.token,JSON.stringify(auth));
    const post=async(path,args={})=>(await fetch(host.url+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.session.token},body:JSON.stringify({args}),signal:AbortSignal.timeout(30_000)})).json();
    assert.equal((await post('/m/add',{title:'historical',weight:50})).state,'sent');
    writeFileSync(schema,newer);await run(['deploy',deployment]);
    assert.equal((await post('/m/add',{title:'native',weight:200})).state,'sent','old argument spelling remains explicitly mapped by the operation body');
    for(let cycle=0;cycle<2;cycle++) {
      await run(['rollback',deployment,'--to','1']);
      const older=(await post('/q/all')).data;
      assert.ok(older.every(row=>typeof row.title==='string'),'old source sees carried title');
      assert.equal((await post('/m/add',{title:'while-old-'+cycle,weight:150})).state,'sent');
      await run(['deploy',deployment]);
      const forward=(await post('/q/all')).data;
      assert.equal(forward.length,3+cycle);
      for(const row of forward) {
        assert.equal(typeof row.name,'string');assert.equal(row.label,row.weight>100?'heavy':'light');
        assert.ok(!('title' in row),'v2 exposes the declared new column');
      }
    }
    return {columnRenameHistoricalAndNative:true,forwardBackfillCatchup:2};
  } finally {
    try {await host?.stop();} finally {rmSync(cwd,{recursive:true,force:true});}
  }
}

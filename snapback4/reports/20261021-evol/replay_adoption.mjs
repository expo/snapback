import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {cli,startServe} from 'snapback4/proof';
async function nativeCase({cli,startServe},parent) {
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
  update <- .owner = viewer
  online only
mutation add(title: text <=40, weight: int):
  return insert pickups {owner:viewer,title,weight}
query all():
  return pickups where .owner = viewer first 100 by .id
`;
    const newer=old.replace('  title: text <=40','  name: text <=40 renamed from title\n  label: text <=20')
      .replace('return insert pickups {owner:viewer,title,weight}',"return insert pickups {owner:viewer,name:title,label:'heavy' if weight > 100 else 'light',weight}")
      +"backfill pickups labels(weight: int):\n  {label:'heavy' if weight > 100 else 'light'}\nmutation revise(item: pickups, weight: int):\n  return update pickups[item] {weight,label:'heavy' if weight > 100 else 'light'}\n";
    writeFileSync(schema,old);await run(['deploy',deployment]);
    host=await startServe(deployment,{cwd,timeoutMs:60_000});
    const auth=await(await fetch(host.url+'/auth/guest',{method:'POST',body:'{}',signal:AbortSignal.timeout(30_000)})).json();
    assert.ok(auth.session?.token,JSON.stringify(auth));
    const post=async(path,args={})=>(await fetch(host.url+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.session.token},body:JSON.stringify({args}),signal:AbortSignal.timeout(30_000)})).json();
    const historical=await post('/m/add',{title:'historical',weight:50});assert.equal(historical.state,'sent');
    writeFileSync(schema,newer);await run(['deploy',deployment]);
    const native=await post('/m/add',{title:'native',weight:200});assert.equal(native.state,'sent');
    for(const [item,weight] of [[native.result.id,50]]) assert.equal((await post('/m/revise',{item,weight})).state,'sent','ordinary v2 edits survive re-entry');
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


async function migratedCase({cli,startServe},parent) {
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
  update <- .owner = viewer
  online only
mutation add(title: text <=40, weight: int):
  return insert pickups {owner:viewer,title,weight}
query all():
  return pickups where .owner = viewer first 100 by .id
`;
    const newer=old.replace('  title: text <=40','  name: text <=40 renamed from title\n  label: text <=20')
      .replace('return insert pickups {owner:viewer,title,weight}',"return insert pickups {owner:viewer,name:title,label:'heavy' if weight > 100 else 'light',weight}")
      +"backfill pickups labels(weight: int):\n  {label:'heavy' if weight > 100 else 'light'}\nmutation revise(item: pickups, weight: int):\n  return update pickups[item] {weight,label:'heavy' if weight > 100 else 'light'}\n";
    writeFileSync(schema,old);await run(['deploy',deployment]);
    host=await startServe(deployment,{cwd,timeoutMs:60_000});
    const auth=await(await fetch(host.url+'/auth/guest',{method:'POST',body:'{}',signal:AbortSignal.timeout(30_000)})).json();
    assert.ok(auth.session?.token,JSON.stringify(auth));
    const post=async(path,args={})=>(await fetch(host.url+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.session.token},body:JSON.stringify({args}),signal:AbortSignal.timeout(30_000)})).json();
    const historical=await post('/m/add',{title:'historical',weight:50});assert.equal(historical.state,'sent');
    writeFileSync(schema,newer);await run(['deploy',deployment]);
    const native=await post('/m/add',{title:'native',weight:200});assert.equal(native.state,'sent');
    for(const [item,weight] of [[historical.result.id,200]]) assert.equal((await post('/m/revise',{item,weight})).state,'sent','ordinary v2 edits survive re-entry');
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


async function nullableCase({cli,startServe},parent) {
  const cwd=mkdtempSync(join(parent,'migration-cycles-'));
  let host;
  try {
    mkdirSync(join(cwd,'snapback'));
    const deployment=join(cwd,'deployment'),schema=join(cwd,'snapback/schema.q');
    const run=async args=>{const r=await cli(args,{cwd,timeoutMs:60_000});assert.equal(r.code,0,r.stderr+r.stdout);return r;};
    const old=`use identity guests
table pickups:
  owner: principal
  title: text <=40 ?
  weight: int
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
mutation add(title: text <=40, weight: int):
  return insert pickups {owner:viewer,title,weight}
query all():
  return pickups where .owner = viewer first 100 by .id
`;
    const newer=old.replace('  title: text <=40 ?','  name: text <=40 ? renamed from title\n  label: text <=20')
      .replace('return insert pickups {owner:viewer,title,weight}',"return insert pickups {owner:viewer,name:title,label:'heavy' if weight > 100 else 'light',weight}")
      +"backfill pickups labels(weight: int):\n  {label:'heavy' if weight > 100 else 'light'}\nmutation revise(item: pickups, weight: int):\n  return update pickups[item] {weight,label:'heavy' if weight > 100 else 'light'}\n";
    writeFileSync(schema,old);await run(['deploy',deployment]);
    host=await startServe(deployment,{cwd,timeoutMs:60_000});
    const auth=await(await fetch(host.url+'/auth/guest',{method:'POST',body:'{}',signal:AbortSignal.timeout(30_000)})).json();
    assert.ok(auth.session?.token,JSON.stringify(auth));
    const post=async(path,args={})=>(await fetch(host.url+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth.session.token},body:JSON.stringify({args}),signal:AbortSignal.timeout(30_000)})).json();
    const historical=await post('/m/add',{title:'historical',weight:50});assert.equal(historical.state,'sent');
    writeFileSync(schema,newer);await run(['deploy',deployment]);
    const native=await post('/m/add',{title:'native',weight:200});assert.equal(native.state,'sent');
    for(const [item,weight] of []) assert.equal((await post('/m/revise',{item,weight})).state,'sent','ordinary v2 edits survive re-entry');
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

const result={};for(const [name,fn] of [['native',nativeCase],['migrated',migratedCase],['nullable',nullableCase]]){try{await fn({cli,startServe},tmpdir());result[name]={passed:true};}catch(e){result[name]={passed:false,message:String(e.message).slice(0,4000)};}}console.log(JSON.stringify(result));

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {loadWasm} from './helpers/published-capabilities.mjs';
import {hangBudget} from './helpers/wait.mjs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const published=process.env.RX_PUBLISHED_ROOT;
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
const unsupported=/rule-reference-v2|unknown variant [`'"]?ReferenceChain/;

// Forward upgrades are a different fence from old engines refusing new chains:
// cost explanations must not turn unchanged legacy source into a new generation.
for(const shape of ['zero-hop','one-hop']) test(`published 0.4.13 ${shape} upgrade keeps backend bytes, acquisition and images on native and wasm`,{
  skip:!published?'set RX_PUBLISHED_ROOT to verified extracted snapback4 and the host platform 0.4.13 packages':false,
  timeout:hangBudget(5),
},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sb4-rx-upgrade-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const fixtures=join(root,'crates/snapback4-lang/tests/fixtures/rx');
  mkdirSync(join(dir,'snapback'));
  writeFileSync(join(dir,'snapback/schema.q'),readFileSync(join(fixtures,`legacy-${shape}.q`)));
  const oldBinary=join(published,`snapback4-${process.platform}-${process.arch}/package/snapback4`);
  const run=(bin,args,input='')=>{
    const result=spawnSync(bin,args,{cwd:dir,input,encoding:'utf8',timeout:hangBudget()});
    assert.equal(result.status,0,result.stdout+result.stderr);
    return result.stdout;
  };
  assert.match(run(oldBinary,['--version']),/0\.4\.13/);
  const stored=()=>{
    const db=new DatabaseSync(join(dir,'.snapback4/store.sqlite'),{readOnly:true});
    try {
      const row=db.prepare('SELECT generation,schema,programs FROM _generations ORDER BY generation DESC LIMIT 1').get();
      const programs=Object.values(JSON.parse(row.programs)).sort((a,b)=>a.name.localeCompare(b.name));
      return {generation:row.generation,schema:row.schema,programs:row.programs,
        backend:`{"generation":${row.generation},"schema":${row.schema},"programs":[${programs.map(p=>JSON.stringify(p)).join(',')}]}`,
        rows:db.prepare('SELECT * FROM r ORDER BY t,id').all()};
    } finally {db.close();}
  };
  run(oldBinary,['run','setup','{}','--as','alice']);
  const before=stored();
  assert.equal(before.backend,readFileSync(join(fixtures,`legacy-${shape}.json`),'utf8').trimEnd());
  run(binary,['run','noop','{}','--as','alice']);
  const after=stored();
  const hash=text=>createHash('sha256').update(text).digest('hex');
  assert.equal(hash(after.schema),hash(before.schema),'schema hash');
  assert.deepEqual(after,before,'generation, exact backend bytes and server rows');
  const backend=JSON.parse(after.backend);
  const apply={op:'apply',first:true,page:{snapshot:true,generation:before.generation,watermark:42,more:false,events:[
    {table:'parents',id:'p',kind:'put',data:{id:'p',owner:'dev:alice'}},
    {table:'members',id:'m',kind:'put',data:{id:'m',parent:'p',principal:'dev:alice'}},
    {table:'children',id:'c',kind:'put',data:{id:'c',parent:'p'}},
  ]}};
  const query={op:'query',name:'child',viewer:'dev:alice',args:{id:'c'},now:100};
  const pending={op:'admit',entry:{id:'pending',seq:1,op:'change',args:{id:'c',parent:'p'},viewer:'dev:alice',now:100,predictable:true}};
  const available=reply=>{
    assert.equal(reply.ok?.denied,undefined,JSON.stringify(reply));
    assert.equal(reply.ok?.data?.id,'c',JSON.stringify(reply));
  };
  const beforeFile=join(dir,'before.json'),afterFile=join(dir,'after.json');
  writeFileSync(beforeFile,before.backend);writeFileSync(afterFile,after.backend);
  const nativePath=join(dir,'device.sqlite');
  const native=(bin,file,requests)=>{
    const replies=run(bin,['device',nativePath,...(file?[file]:[])],requests.map(r=>JSON.stringify(r)).join('\n')+'\n').trim().split('\n').map(r=>JSON.parse(r));
    assert.equal(replies.shift().ok.device,nativePath);
    assert.equal(replies.length,requests.length);
    return replies;
  };
  const initial=native(oldBinary,beforeFile,[apply,{op:'state'},query,pending]);
  assert.equal(initial[1].ok.watermark,42);available(initial[2]);
  assert.equal(initial[3].denied,undefined,JSON.stringify(initial[3]));
  const images=()=>{
    const db=new DatabaseSync(nativePath,{readOnly:true});
    try {
      return Object.fromEntries(['r','i','_device_base','_device_snapshot'].map(table=>{
        const rows=db.prepare(`SELECT * FROM "${table}"`).all().map(row=>JSON.stringify(row)).sort();
        // Completed acquisition has no private staging snapshot. The ordinary
        // row/index tables and the confirmed base beneath the pending edit do.
        if(table!=='_device_snapshot')assert.ok(rows.length>0,`${table} contains acquired images/indexes`);
        return [table,rows];
      }));
    } finally {db.close();}
  };
  const keptImages=images();
  const upgraded=native(binary,afterFile,[{op:'state'},query,{op:'adopt',backend},{op:'state'},query]);
  for(const index of [0,3]){
    assert.equal(upgraded[index].ok.watermark,42);
    assert.equal(upgraded[index].ok.generation,before.generation);
  }
  for(const index of [1,4])available(upgraded[index]);
  assert.deepEqual(images(),keptImages,'native upgrade preserves all image and index rows');
  available(native(binary,undefined,[query])[0]);

  const Legacy=await loadWasm(join(published,'snapback4/package/dist/wasm'));
  const Current=await loadWasm(join(root,'packages/snapback4/src/wasm'));
  const call=(device,request)=>JSON.parse(device.call(JSON.stringify(request)));
  const legacy=new Legacy(before.backend,'[]');
  call(legacy,apply);available(call(legacy,query));
  assert.equal(call(legacy,pending).denied,undefined);
  const retained=legacy.drain();legacy.free();
  // Cover initial installation over a persisted store and explicit live adoption.
  for(const mode of ['open','adopt']){
    const device=new Current(mode==='open'?after.backend:undefined,retained);
    try {
      available(call(device,query));
      if(mode==='adopt')assert.equal(call(device,{op:'adopt',backend}).denied,undefined);
      const state=call(device,{op:'state'});
      assert.equal(state.ok.watermark,42);assert.equal(state.ok.generation,before.generation);
      available(call(device,query));
    } finally {device.free();}
  }
  t.diagnostic(`${shape}: schema ${hash(after.schema)}, ${Buffer.byteLength(after.backend)} backend bytes; generation ${after.generation}, watermark 42 retained`);
});

for(const shape of ['chain','final']) test(`published 0.4.13 rejects RX ${shape} on initial device open, persisted reopen and engine store`,{
  skip:!published?'set RX_PUBLISHED_ROOT to verified extracted snapback4 and the host platform 0.4.13 packages':false,
  timeout:hangBudget(5),
},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sb4-rx-fence-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'snapback'));
  const rule=shape==='chain'?'insert <- .message.root.owner = viewer':'insert <- allow\n  after insert <- exists roots[.message.root]';
  writeFileSync(join(dir,'snapback/schema.q'),`use personas alice\ntable roots:\n  owner: principal\n  public\n  sync public\ntable messages:\n  root: roots\n  public\n  sync public\ntable children:\n  message: messages\n  public\n  ${rule}\n  sync public\nmutation noop():\n  return true\n`);
  const run=(bin,args,input='')=>spawnSync(bin,args,{cwd:dir,input,encoding:'utf8',timeout:hangBudget()});
  const made=run(binary,['run','noop','{}','--as','alice']);
  assert.equal(made.status,0,made.stdout+made.stderr);
  const path=join(dir,'.snapback4/store.sqlite');
  const db=new DatabaseSync(path,{readOnly:true});
  const stored=db.prepare('SELECT generation,schema FROM _generations ORDER BY generation DESC LIMIT 1').get();db.close();
  const backend={generation:stored.generation,schema:JSON.parse(stored.schema),programs:[]};
  const caps=Object.values(backend.schema.tables).flatMap(t=>t.constraints).flatMap(c=>c.Capabilities??[]);
  assert.ok(caps.includes('rule-reference-v2'));
  const oldBinary=join(published,`snapback4-${process.platform}-${process.arch}/package/snapback4`);
  assert.match(run(oldBinary,['--version']).stdout,/0\.4\.13/);
  const legacy=await loadWasm(join(published,'snapback4/package/dist/wasm'));
  const current=await loadWasm(join(root,'packages/snapback4/src/wasm'));
  assert.throws(()=>new legacy(JSON.stringify(backend),'[]'),unsupported);
  const device=new current(JSON.stringify(backend),'[]');
  const kept=device.drain();device.free();
  assert.throws(()=>new legacy(undefined,kept),unsupported);
  const reopened=new current(undefined,kept);reopened.free();
  const file=join(dir,'backend.json');writeFileSync(file,JSON.stringify(backend));
  const fresh=run(oldBinary,['device',join(dir,'old.sqlite'),file]);
  assert.notEqual(fresh.status,0);assert.match(fresh.stdout+fresh.stderr,unsupported);
  const currentPath=join(dir,'current.sqlite');
  const opened=run(binary,['device',currentPath,file]);assert.equal(opened.status,0,opened.stdout+opened.stderr);
  const before=readFileSync(currentPath);
  const oldOpen=run(oldBinary,['device',currentPath]);assert.notEqual(oldOpen.status,0);assert.match(oldOpen.stdout+oldOpen.stderr,unsupported);
  assert.deepEqual(readFileSync(currentPath),before);
  const beforeStore=readFileSync(path);
  const doctor=run(oldBinary,['doctor','--store',path]);assert.notEqual(doctor.status,0);assert.match(doctor.stdout+doctor.stderr,unsupported);
  assert.deepEqual(readFileSync(path),beforeStore);
});

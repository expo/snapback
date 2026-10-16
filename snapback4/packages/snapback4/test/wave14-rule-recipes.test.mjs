// Execute exact guide sources through packed client/native packages, with no checkout binary fallback.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const binary = process.env.SNAPBACK4_BIN || join(root, 'target/debug/snapback4');
const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
const invoke = (command, args, cwd, env = process.env) => {
  const out = spawnSync(command, args, {cwd, env, encoding:'utf8', timeout:120000});
  assert.equal(out.status, 0, `${command} ${args.join(' ')}\n${out.stdout}\n${out.stderr}`);
  return out.stdout;
};

test('packed rule recipes run as written and preserve authority at boundaries', {timeout:300000}, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-rules4-packed-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  const env = {...process.env}; delete env.SNAPBACK4_BIN;
  const nodeModules = join(dir, 'node_modules'); mkdirSync(nodeModules);
  const pack = (source, destination) => {
    const result = JSON.parse(invoke('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir], source));
    mkdirSync(destination, {recursive:true});
    invoke('tar', ['-xzf', join(dir, result[0].filename), '-C', destination, '--strip-components=1'], dir);
    return join(dir,result[0].filename);
  };
  const clientTarball=pack(join(root, 'packages/snapback4'), join(nodeModules,'snapback4'));
  const nativeName = `snapback4-${process.platform}-${process.arch}`;
  const nativeSource = join(dir, 'native'); mkdirSync(nativeSource);
  copyFileSync(join(root, 'packages', nativeName, 'package.json'), join(nativeSource, 'package.json'));
  copyFileSync(binary, join(nativeSource, 'snapback4'));
  const nativeTarball=pack(nativeSource, join(nodeModules,nativeName));
  invoke('npm',['install','--ignore-scripts','--omit=optional','--no-audit','--no-fund',clientTarball,nativeTarball],dir,env);
  const cliPath = join(nodeModules, 'snapback4/bin/snapback4.js');
  const guide = name => invoke(process.execPath, [cliPath, 'guide', name, '--full'], dir, env);
  const blocks = name => [...guide(name).matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(m=>m[1]);
  const recipes = blocks('rule-recipes'), rules = blocks('rules');
  const {startDev} = await import(pathToFileURL(join(nodeModules,'snapback4/dist/proof.js')));
  const {createClient}=await import(pathToFileURL(join(nodeModules,'snapback4/dist/client.js')));
  const {createLocalClient} = await import(pathToFileURL(join(nodeModules,'snapback4/dist/local.js')));
  const {webDevice,memoryPersistence} = await import(pathToFileURL(join(nodeModules,'snapback4/dist/web.js')));
  const wasm=readFileSync(join(nodeModules,'snapback4/dist/wasm/snapback4_device_bg.wasm'));
  async function until(predicate,label) {
    const end=performance.now()+15000;
    while(!predicate()) { assert.ok(performance.now()<end,label);await new Promise(r=>setTimeout(r,25)); }
  }
  async function project(t, marker, sourceBlocks = recipes) {
    const source = sourceBlocks.find(s=>s.includes(marker)); assert.ok(source, marker);
    const cwd = join(dir, marker.replace(/\W/g,'_')); mkdirSync(join(cwd,'snapback'),{recursive:true});
    writeFileSync(join(cwd,'snapback/schema.q'), source);
    const checked = JSON.parse(invoke(process.execPath,[cliPath,'check','--json'],cwd,env));
    assert.equal(checked.ok,true); assert.deepEqual(checked.notes.filter(n=>n.code!=='N_NO_PRODUCTION_WRITER'),[]);
    const host = await startDev({cwd,env:{SNAPBACK4_BIN:'',PORT_LO:'47000',PORT_HI:'47999'},args:['--no-memory','--port','0','--no-watch','--hold-schedules'],timeoutMs:30000});
    t.after(()=>host.stop());
    const post = async (path, who, body) => {
      const response = await fetch(host.url+path,{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':who},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      return response.json();
    };
    const seed = async rows => assert.equal((await post('/seed','alice',rows)).seeded,rows.length);
    const mutate = (op,who,args={})=>post('/m/'+op,who,{args});
    const sent = async (op,who,args={})=>{const reply=await mutate(op,who,args);assert.equal(reply.state,'sent',JSON.stringify(reply));return reply.result;};
    const failed = async (op,who,args,code)=>{const reply=await mutate(op,who,args);assert.equal(reply.why?.code,code,JSON.stringify(reply));return reply;};
    const query = (op,who,args={})=>post('/q/'+op,who,{args});
    const read = async (op,who,args={})=>{const reply=await query(op,who,args);assert.ok('data' in reply,JSON.stringify(reply));return reply.data;};
    return {cwd,host,post,seed,mutate,sent,failed,query,read};
  }
  await t.test('the compact opening recipe grants only its owner', async t=>{
    const p=await project(t,'table ownRuleRecords:');
    await p.sent('ownRuleRecord','alice');
    assert.equal((await p.read('ownRuleRecordBy','alice',{owner:'dev:alice'})).owner,'dev:alice');
    assert.equal(await p.read('ownRuleRecordBy','bob',{owner:'dev:alice'}),null);
  });
  await t.test('current department transfer maintains every existing child atomically', async t=>{
    const p = await project(t,'table rosterFolders:');
    await p.seed([
      {table:'departments',row:{id:'old',title:'Old'}},{table:'departments',row:{id:'new',title:'New'}},
      {table:'departmentRoster',row:{id:'a',department:'old',principal:'dev:alice'}},
      {table:'departmentRoster',row:{id:'b',department:'new',principal:'dev:bob'}},
      {table:'rosterFolders',row:{id:'folder',department:'old'}},
    ]);
    const replicas = [];
    for (const persona of ['alice','bob']) {
      const opener=webDevice({wasm,persist:memoryPersistence()});let core;
      const client=await createLocalClient({url:p.host.url,persona,device:{open:async(...args)=>{core=await opener.open(...args);return core;}}});
      t.after(()=>client.close());await client.sync();
      replicas.push({client,query:async file=>(await core.call({op:'query',name:'rosterFile',viewer:`dev:${persona}`,args:{file},now:Date.now()})).ok});
    }
    const a=await p.sent('addRosterFile','alice',{folder:'folder',body:'private'});
    const b=await p.sent('addRosterFile','alice',{folder:'folder',body:'second'});
    for(let i=2;i<20;i++) await p.sent('addRosterFile','alice',{folder:'folder',body:`boundary ${i}`});
    await p.failed('addRosterFile','alice',{folder:'folder',body:'over cap'},'E_CONSTRAINT');
    assert.equal(await p.read('rosterFile','bob',{file:a.id}),null);
    for(const replica of replicas) await replica.client.sync();
    assert.equal((await replicas[0].query(a.id)).data.body,'private');
    assert.equal((await replicas[1].query(a.id)).data,null);
    await p.failed('transferRosterFolder','alice',{folder:'folder',department:'new'},'OPERATOR_ONLY');
    const token=invoke(process.execPath,[cliPath,'token','--service','ops','--quiet'],p.cwd,env).trim();
    const moved=await fetch(p.host.url+'/m/transferRosterFolder',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({args:{folder:'folder',department:'new'}}),signal:AbortSignal.timeout(15000)}).then(r=>r.json());
    assert.equal(moved.state,'sent',JSON.stringify(moved));
    for(const row of [a,b]) {
      assert.equal(await p.read('rosterFile','alice',{file:row.id}),null);
      assert.equal((await p.read('rosterFile','bob',{file:row.id})).department,'new');
    }
    for(const replica of replicas) await replica.client.sync();
    const old=await replicas[0].query(a.id), fresh=await replicas[1].query(a.id);
    assert.equal(old.data,null,JSON.stringify(old));
    assert.equal(fresh.data.body,'private',JSON.stringify(fresh));
    await p.failed('addRosterFile','alice',{folder:'folder',body:'old roster'},'NOT_FOUND');
    await p.failed('addRosterFile','bob',{folder:'folder',body:'new roster at cap'},'E_CONSTRAINT');
  });
  await t.test('private waitlist publishes occupancy without exposing membership', async t=>{
    const p = await project(t,'table privateWaitlist:');
    await p.seed([{table:'waitSlots',row:{id:'slot',label:'Morning'}}]);
    assert.equal(await p.read('occupancy','carol',{slot:'slot'}),0);
    await p.sent('joinWaitlist','alice',{slot:'slot'});
    assert.equal(await p.read('occupancy','carol',{slot:'slot'}),1);
    assert.equal(await p.read('myWait','bob',{slot:'slot'}),null);
    await p.sent('leaveWaitlist','alice',{slot:'slot'});
    assert.equal(await p.read('occupancy','carol',{slot:'slot'}),0);
  });
  await t.test('membership pages stop at grant expiry without relying on cleanup', async t=>{
    const p = await project(t,'table timedMembers:');
    const now=Date.now();
    await p.seed([{table:'memberRooms',row:{id:'room',label:'Room'}},{table:'timedMembers',row:{id:'member',room:'room',principal:'dev:alice',expiresAt:now+60000}}]);
    await p.sent('memberPage','alice',{room:'room',body:'Private'});
    const client=createClient({url:p.host.url,persona:'alice',waitSeconds:1});t.after(()=>client.close());
    const watch=client.observe({kind:'query',name:'memberPageList'},{room:'room',c:null});
    const unsubscribe=watch.subscribe(()=>{});t.after(()=>{unsubscribe();watch.close();});
    await until(()=>watch.getSnapshot()?.data?.length===1,'held member page loads');
    const before=await p.query('memberPageList','alice',{room:'room',c:null});
    assert.equal(before.complete,true,JSON.stringify(before));assert.equal(before.data.length,1);
    assert.equal((await p.query('memberPageList','bob',{room:'room',c:null})).denied.code,'MEMBERSHIP_REQUIRED');
    await p.post('/dev/clock/advance','alice',{duration:'2m'});
    await until(()=>watch.getSnapshot()?.denied?.code==='MEMBERSHIP_REQUIRED','held page loses authority at membership expiry');
    assert.equal((await p.query('memberPageList','alice',{room:'room',c:null})).denied.code,'MEMBERSHIP_REQUIRED');
    await p.failed('memberPage','alice',{room:'room',body:'Expired'},'E_RULE');
  });
  await t.test('bare union has an explicit cold-start tradeoff and both audiences read', async t=>{
    assert.match(guide('rule-recipes'),/cold-start work and storage grow/);
    const p = await project(t,'table unionNotes:');
    await p.seed([{table:'unionTeams',row:{id:'team',label:'Team'}},{table:'unionRoster',row:{id:'a',team:'team',principal:'dev:alice'}},{table:'unionRoster',row:{id:'b',team:'team',principal:'dev:bob'}}]);
    await p.sent('unionNote','alice',{team:'team',body:'Both'});
    assert.equal((await p.read('teamUnionNotes','bob',{team:'team',c:null})).length,1);
    assert.equal((await p.read('teamUnionNotes','carol',{team:'team',c:null})).length,0);
    assert.equal((await p.read('ownUnionNotes','alice',{c:null})).length,1);
  });
  await t.test('public mirror requires its own image placement and never publishes private notes', async t=>{
    const p = await project(t,'table privateImages:');
    const upload = async()=>{
      const response=await fetch(p.host.url+'/assets',{method:'POST',headers:{'x-snapback-persona':'alice','content-type':'image/png'},body:png,signal:AbortSignal.timeout(15000)});
      const body=await response.json();assert.equal(response.ok,true,JSON.stringify(body));assert.ok(body.asset?.id,JSON.stringify(body));return body.asset;
    };
    const privateId=await upload();
    const saved=await p.sent('savePrivateImage','alice',{image:privateId,note:'private note'});
    await p.failed('publishImage','alice',{source:saved.id,image:privateId},'E_ASSET_PLACED');
    const publicId=await upload();assert.notEqual(privateId.id,publicId.id);
    await p.failed('publishImage','bob',{source:saved.id,image:publicId},'NOT_FOUND');
    await p.sent('publishImage','alice',{source:saved.id,image:publicId});
    await p.failed('unpublishImage','bob',{source:saved.id},'E_RULE');
    const visible=await p.read('publishedImage','bob',{source:saved.id});
    assert.ok(visible);assert.equal('note'in visible,false);
    assert.equal(await p.read('privateImage','bob',{source:saved.id}),null);
    const get= id=>fetch(p.host.url+'/assets/'+id.id,{headers:{'x-snapback-persona':'bob'},signal:AbortSignal.timeout(15000)});
    assert.equal((await get(privateId)).status,404);
    assert.equal((await get(publicId)).status,200);
    await p.sent('unpublishImage','alice',{source:saved.id});
    assert.equal((await get(publicId)).status,404);
  });
  await t.test('staff guard and table read rule agree, with custom refusal before lookup', async t=>{
    const p = await project(t,'table staffCases:');
    await p.seed([{table:'queryStaff',row:{id:'staff',principal:'dev:bob'}}]);
    const row=await p.sent('newStaffCase','alice',{body:'Case'});
    assert.equal((await p.read('staffCase','bob',{case:row.id})).body,'Case');
    assert.equal(await p.read('ownOrStaffCase','carol',{case:row.id}),null);
    assert.equal((await p.query('staffCase','carol',{case:row.id})).denied.code,'STAFF_ONLY');
    assert.equal((await p.read('ownCases','alice',{c:null})).length,1);
  });
  await t.test('upsert refusal ladder executes before a later custom require and rolls back', async t=>{
    const p=await project(t,'table ladderCounters:',rules);
    await p.seed([{table:'ladderCounters',row:{id:'a',owner:'dev:alice',value:0,open:false}}]);
    await p.failed('ladderPut','alice',{owner:'dev:alice'},'E_RULE');
    await p.failed('ladderPut','bob',{owner:'dev:alice'},'NOT_FOUND');
    await p.failed('ladderPut','bob',{owner:'dev:bob'},'AFTER_WRITE');
    assert.equal(await p.read('ladderCounter','bob',{owner:'dev:bob'}),null);
    const logs=readFileSync(p.host.logs.stderr,'utf8');
    // The evidence writer aggregates for one second; local run below exercises exact require attribution too.
    assert.ok(logs.includes('SNAPBACK4_READY'));
    const path=join(p.cwd,'snapback/schema.q');
    writeFileSync(path,readFileSync(path,'utf8').replace('require false else AFTER_WRITE','require false else DISK_NEW'));
    const run=spawnSync(process.execPath,[cliPath,'run','ladderPut','{"owner":"dev:bob"}','--as','bob','--port',new URL(p.host.url).port],{cwd:p.cwd,env,encoding:'utf8',timeout:15000});
    assert.equal(run.status,1,run.stdout+run.stderr);assert.match(run.stderr,/mutation require/);assert.match(run.stderr,/require false else AFTER_WRITE/);assert.doesNotMatch(run.stderr,/DISK_NEW/);
  });
});

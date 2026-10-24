// @ref LLP 3000.000.000#20-visible-rollback-views-roll — packed, real-user cold/hot cycles and byte authority.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function proveRollInstalled(cwd,binary,run){
  const {startServe,cli:proofCli}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/proof.js')));
  const {guest}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/auth.js')));
  const source=(name,text)=>{const path=join(cwd,name);mkdirSync(path,{recursive:true});writeFileSync(join(path,'schema.q'),text);return path;};
  const cliAt=async(at,...args)=>{const r=await proofCli(args,{cwd:at,env:{SNAPBACK4_BIN:undefined,PORT_LO:'31000',PORT_HI:'31999'}});assert.equal(r.code,0,r.stderr+r.stdout);return r;};
  const cli=(...args)=>cliAt(cwd,...args);
  const json=async(...args)=>{const r=await cli(...args,'--json');return JSON.parse(r.stdout);};
  // The rollback fixtures deliberately loosen one column to represent pending
  // values. Record only that column's review; adding a presence invariant would
  // also change the independent workflow intent being tested by these cycles.
  async function optionalSource(name, before, after, table, column) {
    const project=join(cwd,name);
    const path=join(project,'snapback');mkdirSync(path,{recursive:true});
    writeFileSync(join(path,'schema.q'),before);
    const check=async(...args)=>proofCli(['check',...args],{cwd:project,env:{SNAPBACK4_BIN:undefined,PORT_LO:'31000',PORT_HI:'31999'}});
    const baseline=await check();assert.equal(baseline.code,0,baseline.stderr+baseline.stdout);
    writeFileSync(join(path,'schema.q'),after);
    const inspected=await check('--json');
    assert.ok(inspected.code===0||inspected.code===1,inspected.stderr+inspected.stdout);
    const report=JSON.parse(inspected.stdout);
    const sites=report.security.notes.filter(n=>n.code==='N_PRESENCE_LOOSENING'&&n.message.startsWith(`${table}.${column}:`))
      .map(n=>`${n.site.file}:${n.site.line}:${n.site.col}`);
    const decisions=report.securityReviews.filter(n=>n.code==='N_PRESENCE_LOOSENING'&&sites.includes(n.site));
    assert.equal(decisions.length,1,JSON.stringify(report));
    const acknowledged=await check('--ack-security',decisions[0].id,'--reason',
      `This rollback fixture deliberately permits pending/null ${table}.${column} values; current workflow guards remain enforced.`);
    assert.equal(acknowledged.code,0,acknowledged.stderr+acknowledged.stdout);
    return {path,project};
  }
  const hostOptions={cwd,env:{SNAPBACK4_BIN:undefined,PORT_LO:'31000',PORT_HI:'31999'},timeoutMs:30000};
  async function users(host){const a=await guest(host.url),b=await guest(host.url);assert.ok(a.ok&&b.ok);return [a.session,b.session];}
  async function post(host,session,name,args,kind='m'){
    const r=await fetch(`${host.url}/${kind}/${name}`,{method:'POST',headers:{authorization:`Bearer ${session.token}`,'content-type':'application/json'},body:JSON.stringify({args}),signal:AbortSignal.timeout(10000)});
    assert.equal(r.status,200,await r.clone().text());return r.json();
  }
  const old=`use identity guests
table items:
  owner: principal
  amount: int 100..50000
  input: int
  metric: int
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
table payments:
  amount: int
  read <- deny
  insert <- allow
  online only
mutation add(amount: int 100..50000):
  return insert items {owner:viewer,amount,input:1,metric:0}
mutation edit(id: items, metric: int):
  update items[id] {metric}
mutation pay(id: items):
  a = items[id] ! else MISSING
  return insert payments {amount:a.amount}
query item(id: items):
  return items[id]
`;
  const next=old.replaceAll('amount: int 100..50000','amount: int 100..50000 ?').replace('  return insert payments','  require a.amount != null else NO_AMOUNT\n  return insert payments')+'backfill items metrics(input: int): {metric:input * 10}\n';
  const dir=join(cwd,'roll-money');await cli('deploy',dir,'--schema',source('roll-v1',old));let host=await startServe(dir,hostOptions);
  try{
    const [alice,bob]=await users(host);const first=await post(host,alice,'add',{amount:100});assert.equal(first.state,'sent');
    const candidate=await optionalSource('roll-v2',old,next,'items','amount');const plan=JSON.parse((await cliAt(candidate.project,'deploy',dir,'--schema',candidate.path,'--check','--json')).stdout);assert.equal(plan.rollbackViews.length,1);
    await cliAt(candidate.project,'deploy',dir,'--schema',candidate.path);assert.equal((await post(host,alice,'edit',{id:first.result.id,metric:99})).state,'sent');
    const pending=await post(host,alice,'add',{amount:null});assert.equal(pending.state,'sent');
    for(let round=0;round<2;round++){
      const selected=await json('rollback',dir,'--to','1');assert.equal(selected.rollbackView.target,1);
      assert.equal((await post(host,alice,'item',{id:pending.result.id},'q')).data.amount,null);
      assert.equal((await post(host,bob,'item',{id:pending.result.id},'q')).data,null);
      assert.equal((await post(host,alice,'pay',{id:pending.result.id})).why.code,'NO_AMOUNT');
      assert.equal((await post(host,alice,'item',{id:first.result.id},'q')).data.metric,99);
      await cli('rollback',dir,'--to','latest');assert.equal((await post(host,alice,'item',{id:first.result.id},'q')).data.metric,99);
    }
    const exact=await json('rollback',dir,'--to','1','--exact','--check');assert.equal(exact.visibility.hiddenRows,1);
  }finally{await host.stop();}
  const media=`use identity guests
table customers:
  read <- allow
  insert <- allow
  online only
table orders:
  owner: principal
  immutable owner
  buyer: customers
  scan: file <=1000
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation customer():
  return insert customers {}
mutation add(buyer: customers, scan: file <=1000):
  return insert orders {owner:viewer,buyer,scan}
query order(id: orders):
  return orders[id]
`;
  const extracted=media.replace('  buyer: customers','  customer: customers renamed from buyer').replace('  scan: file <=1000\n','').replace('mutation add(buyer: customers, scan: file <=1000):\n  return insert orders {owner:viewer,buyer,scan}\n','')+`table scans:
  order: orders on delete cascade
  scan: file <=1000
  immutable order
  read through .order
  online only
extract scans from orders via order: {scan:scan}
query scan(id: scans):
  return scans[id]
`;
  const md=join(cwd,'roll-media');await cli('deploy',md,'--schema',source('media-v1',media));host=await startServe(md,hostOptions);
  try{
    const [alice,bob]=await users(host);const customer=await post(host,alice,'customer',{});assert.equal(customer.state,'sent');
    const bytes='a real retained file\n';const upload=await fetch(host.url+'/assets?as=file&name=names.txt',{method:'POST',headers:{authorization:`Bearer ${alice.token}`,'content-type':'text/plain'},body:bytes,signal:AbortSignal.timeout(10000)});assert.equal(upload.status,200);const asset=(await upload.json()).asset;
    const order=await post(host,alice,'add',{buyer:customer.result.id,scan:{id:asset.id}});assert.equal(order.state,'sent');
    const path=source('media-v2',extracted);await json('deploy',md,'--schema',path,'--check');await cli('deploy',md,'--schema',path);
    for(let round=0;round<2;round++){
      assert.equal((await post(host,alice,'scan',{id:order.result.id},'q')).data.scan.id,asset.id);
      assert.equal((await post(host,bob,'scan',{id:order.result.id},'q')).data,null);
      for(const [session,status]of [[alice,200],[bob,404]]){const r=await fetch(host.url+'/assets/'+asset.id,{headers:{authorization:`Bearer ${session.token}`},signal:AbortSignal.timeout(10000)});assert.equal(r.status,status);if(status===200)assert.equal(await r.text(),bytes);}
      await cli('rollback',md,'--to','1');assert.equal((await post(host,alice,'order',{id:order.result.id},'q')).data.scan.id,asset.id);
      assert.equal((await post(host,alice,'order',{id:order.result.id},'q')).data.buyer,customer.result.id);await cli('rollback',md,'--to','latest');
    }
  }finally{await host.stop();}
  // A current literal/helper repair must survive the default old-client view,
  // even when all table guards and input names are unchanged.
  const intentOld=`use identity guests
table docs:
  owner: principal
  secret: text <=40 read <- .owner = viewer
  read <- allow
  insert <- allow
  online only
mutation create(owner: principal, secret: text <=40):
  return insert docs {owner,secret}
query doc(id: docs):
  return docs[id]
`;
  const intentNext=intentOld.replace('  secret: text <=40 read','  secret: text <=80 ? read').replace('mutation create(owner: principal,','mutation create(actor: principal alias owner,').replace('{owner,secret}','{owner:viewer,secret}')+'invariant docs.secret write only .owner = viewer\n';
  const intentDir=join(cwd,'roll-current-intent');
  await cli('deploy',intentDir,'--schema',source('intent-v1',intentOld));
  host=await startServe(intentDir,hostOptions);
  try {
    const [alice,bob]=await users(host);
    const candidate=await optionalSource('intent-v2',intentOld,intentNext,'docs','secret');await cliAt(candidate.project,'deploy',intentDir,'--schema',candidate.path);
    const selected=await json('rollback',intentDir,'--to','1');assert.equal(selected.rollbackView.target,1);
    const created=await post(host,alice,'create',{owner:bob.principal,secret:'current-intent'});
    assert.equal(created.state,'sent');assert.equal(created.result.owner,alice.principal);
    assert.equal((await post(host,alice,'doc',{id:created.result.id},'q')).data.secret,'current-intent');
    assert.equal((await post(host,bob,'doc',{id:created.result.id},'q')).data.secret,undefined);
    await host.stop();host=await startServe(intentDir,hostOptions);
    assert.equal((await post(host,alice,'doc',{id:created.result.id},'q')).data.secret,'current-intent');
    const restarted=await post(host,alice,'create',{owner:bob.principal,secret:'after-restart'});
    assert.equal(restarted.state,'sent');assert.equal(restarted.result.owner,alice.principal);
    await cli('rollback',intentDir,'--to','latest');
  } finally {await host.stop();}
  const guardedOld=intentOld.replace('  owner: principal','  owner: principal\n  legacy: int ?')
    .replace('create(owner: principal,','create(owner: principal alias legacyOwner,')
    .replace('{owner,secret}','{owner:helpers.ownerFor(owner),secret}')+'alias protected = create\n';
  const guardedNext=guardedOld.replace('  legacy: int ?\n','').replace(' alias legacyOwner','').replace('alias protected = create\n','')+
    "mutation guarded(owner: principal, secret: text <=40):\n  require viewer = 'service:ops' else OPS\n  return insert docs {owner:helpers.ownerFor(owner),secret}\nalias protected = guarded\ninvariant docs.secret write only .owner = viewer\ninvariant docs.protected only viewer = 'service:ops'\n";
  const guardedV1=source('guarded-closure-v1',guardedOld);writeFileSync(join(guardedV1,'helpers.q'),'fn ownerFor(value: principal): value\n');
  const guardedV2=source('guarded-closure-v2',guardedNext);writeFileSync(join(guardedV2,'helpers.q'),'fn ownerFor(value: principal): viewer\n');
  const guardedDir=join(cwd,'roll-guarded-current');await cli('deploy',guardedDir,'--schema',guardedV1);host=await startServe(guardedDir,hostOptions);
  try {
    const [alice,bob]=await users(host);const before=await post(host,alice,'create',{legacyOwner:alice.principal,secret:'v1'});assert.equal(before.state,'sent');
    await cli('deploy',guardedDir,'--schema',guardedV2);const selected=await json('rollback',guardedDir,'--to','1');assert.equal(selected.rollbackView.target,1);
    const created=await post(host,alice,'create',{legacyOwner:bob.principal,secret:'qualified helper'});assert.equal(created.state,'sent');assert.equal(created.result.owner,alice.principal);
    const blocked=await post(host,alice,'protected',{legacyOwner:bob.principal,secret:'rebound alias'});assert.equal(blocked.state,'failed');assert.equal(blocked.why.code,'OPS');
    assert.equal((await post(host,alice,'doc',{id:before.result.id},'q')).data.secret,'v1');
    await host.stop();host=await startServe(guardedDir,hostOptions);
    const restarted=await post(host,alice,'protected',{legacyOwner:bob.principal,secret:'still guarded'});assert.equal(restarted.state,'failed');assert.equal(restarted.why.code,'OPS');
    await cli('rollback',guardedDir,'--to','latest');
  }finally{await host.stop();}
  const ordinary=`use identity guests
table items:
  owner: principal
  label: text 1..100
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation add(label: text 1..100):
  return insert items {owner:viewer,label}
query item(id: items):
  return items[id]
invariant items.read only .owner = viewer
`;
  const renamed=ordinary.replace('  label: text 1..100','  title: text 1..100 renamed from label')
    .replace('add(label: text 1..100)','add(title: text 1..100 alias label)').replace('{owner:viewer,label}','{owner:viewer,title}');
  const split=ordinary.replace('  label: text 1..100','  invitation: text 1..100\n  envelope: text 1..100')
    .replace('add(label: text 1..100)','add(invitation: text 1..100, envelope: text 1..100)')
    .replace('{owner:viewer,label}','{owner:viewer,invitation,envelope}')+
    'backfill items invitationFromLabel(label: text 1..100): {invitation:label}\nbackfill items envelopeFromLabel(label: text 1..100): {envelope:label}\ndown items oldLabel(invitation: text 1..100): {label:invitation}\n';
  const required=ordinary.replace('  label: text 1..100','  label: text 1..100\n  priority: int 1..9 default 3');
  for(const [name,candidate,args]of [['rename',renamed,{title:'v2'}],['split',split,{invitation:'v2',envelope:'separate'}],['required',required,{label:'v2'}]]) {
    const deployment=join(cwd,'roll-invariant-'+name);
    await cli('deploy',deployment,'--schema',source('ordinary-'+name+'-v1',ordinary));
    host=await startServe(deployment,hostOptions);
    try {
      const [alice,bob]=await users(host);const original=await post(host,alice,'add',{label:'v1'});assert.equal(original.state,'sent');
      const path=source('ordinary-'+name+'-v2',candidate);
      const plan=await json('deploy',deployment,'--schema',path,'--check');assert.equal(plan.rollbackViews.length,0);
      await cli('deploy',deployment,'--schema',path);const added=await post(host,alice,'add',args);assert.equal(added.state,'sent');
      await cli('rollback',deployment,'--to','1');
      for(const [id,label]of [[original.result.id,'v1'],[added.result.id,'v2']])assert.equal((await post(host,alice,'item',{id},'q')).data.label,label);
      assert.equal((await post(host,bob,'item',{id:original.result.id},'q')).data,null);
      await cli('rollback',deployment,'--to','latest');
    }finally{await host.stop();}
  }
  const workerRoot=join(cwd,'intent-worker-project');mkdirSync(join(workerRoot,'snapback'),{recursive:true});
  writeFileSync(join(workerRoot,'snapback/schema.q'),intentNext);
  const worker=join(workerRoot,'snapback/worker.mjs');writeFileSync(worker,'export {}; // original\n');
  const workerDir=join(workerRoot,'deployment');
  const workerCall=(args)=>proofCli(args,{cwd:workerRoot,env:{SNAPBACK4_BIN:undefined}});
  for(let attempt=0;attempt<2;attempt++) {
    const initial=await workerCall(['deploy',workerDir]);assert.equal(initial.code,0,initial.stderr+initial.stdout);
  }
  writeFileSync(worker,'export {}; // changed executable, identical Quarry\n');
  const refused=await workerCall(['deploy',workerDir,'--check']);
  assert.equal(refused.code,1);assert.match(refused.stderr+refused.stdout,/authored worker bundle/);
  return {status:'passed',visibleRollback:true,currentGuards:true,currentIntentWorkflow:true,guardedCurrentClosure:true,invariantRenameSplitRequired:true,executableOnlyRefusal:true,editedOutputs:true,referenceRename:true,privateFileExtraction:true,cycles:2};
}

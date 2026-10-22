// @ref LLP 3000.000.000#20-visible-rollback-views-roll — packed, real-user cold/hot cycles and byte authority.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function proveRollInstalled(cwd,binary,run){
  const {startServe,cli:proofCli}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/proof.js')));
  const {guest}=await import(pathToFileURL(join(cwd,'node_modules/snapback4/dist/auth.js')));
  const source=(name,text)=>{const path=join(cwd,name);mkdirSync(path,{recursive:true});writeFileSync(join(path,'schema.q'),text);return path;};
  const cli=async(...args)=>{const r=await proofCli(args,{cwd,env:{SNAPBACK4_BIN:undefined,PORT_LO:'31000',PORT_HI:'31999'}});assert.equal(r.code,0,r.stderr+r.stdout);return r;};
  const json=async(...args)=>{const r=await cli(...args,'--json');return JSON.parse(r.stdout);};
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
    const candidate=source('roll-v2',next);const plan=await json('deploy',dir,'--schema',candidate,'--check');assert.equal(plan.rollbackViews.length,1);
    await cli('deploy',dir,'--schema',candidate);assert.equal((await post(host,alice,'edit',{id:first.result.id,metric:99})).state,'sent');
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
  const intentNext=intentOld.replace('{owner,secret}','{owner:viewer,secret}')+'invariant docs.secret write only .owner = viewer\n';
  const intentDir=join(cwd,'roll-current-intent');
  await cli('deploy',intentDir,'--schema',source('intent-v1',intentOld));
  host=await startServe(intentDir,hostOptions);
  try {
    const [alice,bob]=await users(host);
    const path=source('intent-v2',intentNext);await cli('deploy',intentDir,'--schema',path);
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
  return {status:'passed',visibleRollback:true,currentGuards:true,currentIntentWorkflow:true,editedOutputs:true,referenceRename:true,privateFileExtraction:true,cycles:2};
}

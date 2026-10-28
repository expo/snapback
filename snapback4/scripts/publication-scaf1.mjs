// @ref LLP 3000.011.003.000.000#19-generated-proof-scaffolding-scaf1 — execute emitted code through installed tarballs and reject missing/incorrect proofs.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runToolchainCommand } from './publication-starters.mjs';
export async function proveScaffolds(client, platform, directory) {
  const cwd=join(resolve(directory),'scaf1');mkdirSync(join(cwd,'snapback'),{recursive:true});
  const env={...process.env,CI:'1',npm_config_audit:'false',npm_config_fund:'false'};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  writeFileSync(join(cwd,'package.json'),JSON.stringify({private:true,type:'module'}));
  const run=(cmd,args)=>runToolchainCommand(cmd,args,{cwd,env,timeout:300000});
  await run('npm',['install','--no-save','--ignore-scripts','--no-audit','--no-fund',resolve(client),resolve(platform)]);
  const cli=join(cwd,'node_modules/.bin/snapback4');
  writeFileSync(join(cwd,'snapback/schema.q'),source);
  await run(cli,['check']);
  const capture=args=>spawnSync(process.execPath,args,{cwd,env,encoding:'utf8',timeout:60000});
  for(const file of ['cases.mjs','host.mjs','acceptance.mjs','frontend-proof.mjs','probe-serve.mjs']) {
    const out=capture(['--check',`scripts/proof-scaffold/${file}`]);assert.equal(out.status,0,out.stderr);
  }
  const unfilled=capture(['scripts/proof-scaffold/acceptance.mjs']);assert.notEqual(unfilled.status,0);assert.match(unfilled.stderr,/E_PROOF_SCENARIO/);
  const ui=capture(['scripts/proof-scaffold/frontend-proof.mjs']);assert.notEqual(ui.status,0);assert.match(ui.stderr,/E_FRONTEND_SCENARIO/);
  writeFileSync(join(cwd,'fill.mjs'),fill);
  await run(process.execPath,['--import','./fill.mjs','scripts/proof-scaffold/acceptance.mjs']);
  writeFileSync(join(cwd,'wrong.mjs'),`import {cases} from './scripts/proof-scaffold/cases.mjs'; cases.find(c=>c.op==='provision'&&!c.guard).expected={code:'WRONG_CODE'};`);
  const refusal=capture(['--import','./fill.mjs','--import','./wrong.mjs','scripts/proof-scaffold/acceptance.mjs']);
  assert.notEqual(refusal.status,0);assert.match(refusal.stderr,/WRONG_CODE/);assert.match(refusal.stderr,/NOT_OPERATOR/);
  writeFileSync(join(cwd,'wrong.mjs'),`import {cases} from './scripts/proof-scaffold/cases.mjs'; cases.splice(cases.findIndex(c=>c.op==='approve'&&c.role==='member'&&!c.guard),1);`);
  const missing=capture(['--import','./fill.mjs','--import','./wrong.mjs','scripts/proof-scaffold/acceptance.mjs']);assert.notEqual(missing.status,0);assert.match(missing.stderr,/approve\/member/);
  // Builder ownership survives both a changed schema and a later successful check.
  const path=join(cwd,'scripts/proof-scaffold/cases.mjs');const edited=readFileSync(path,'utf8')+'\n// builder-owned\n';writeFileSync(path,edited);
  writeFileSync(join(cwd,'snapback/schema.q'),source+'\nquery added():\n  return 1\n');await run(cli,['check']);assert.equal(readFileSync(path,'utf8'),edited);
  const grown=capture(['--import','./fill.mjs','scripts/proof-scaffold/acceptance.mjs']);assert.notEqual(grown.status,0);assert.match(grown.stderr,/added/);
  const factsPath=join(cwd,'scripts/proof-scaffold/schema.json');
  const facts=readFileSync(factsPath,'utf8')+'\n';writeFileSync(factsPath,facts);
  writeFileSync(join(cwd,'snapback/schema.q'),source+'\nquery added():\n  return 1\nquery addedAgain():\n  return 2\n');await run(cli,['check']);assert.equal(readFileSync(factsPath,'utf8'),facts);
  const stale=capture(['--import','./fill.mjs','scripts/proof-scaffold/acceptance.mjs']);assert.notEqual(stale.status,0);assert.match(stale.stderr,/schema.json was edited or is stale/);
  const result={status:'passed',syntax:5,realAccounts:'admin/member/roleless signup plus sign-in',positive:'operation/role/guard cases, real image/file uploads, staging deadline and approval who/why reread',negative:['unfilled acceptance','unfilled frontend','wrong refusal code','missing excluded role','new operation with preserved edits','edited stale schema facts'],qualification:false};
  writeFileSync(join(resolve(directory),'scaf1.json'),JSON.stringify(result,null,2)+'\n');return result;
}
const source=`use identity password
table roles:
  principal: principal
  role: enum('admin', 'member')
  unique principal
  read <- .principal = viewer or viewer = 'service:operator'
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('admin', 'member')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] {principal,role}
table notes:
  owner: principal
  picture: image <=10000
  document: file <=10000 ('text/plain')
  dueAt: time
  approvedBy: principal ? default null
  reason: text <=100 default ''
  read <- .owner = viewer or exists roles[viewer, role = 'admin']
  insert <- .owner = viewer
  update <- .owner = viewer or exists roles[viewer, role = 'admin']
  online only
mutation add(picture: image <=10000, document: file <=10000):
  require exists roles[viewer] else NOT_MEMBER
  return insert notes {owner: viewer, picture, document, dueAt: now + 1d}
query note(note: notes):
  return notes[note]
mutation approve(note: notes, reason: text 1..100):
  require exists roles[viewer, role = 'admin'] else NOT_ADMIN
  r = notes[note] ! else NOT_FOUND
  update notes[note] {approvedBy: viewer, reason}
mutation finish(note: notes):
  r = notes[note] ! else NOT_FOUND
  require now < r.dueAt else DEADLINE
  return null
`;
const fill=String.raw`
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {cases} from './scripts/proof-scaffold/cases.mjs';
const create=async(ctx,account)=>{
  const r=await ctx.call('add',account,{picture:await ctx.upload(account,'image'),document:await ctx.upload(account,'file','text/plain')});
  assert.equal(r.state,'sent',JSON.stringify(r));return r.result.id;
};
for(const c of cases) {
  const code=c.expected?.code;
  if(c.op==='provision') { c.expected={code:'NOT_OPERATOR'};c.args=async(ctx,a)=>({principal:a.principal,role:'member'});continue; }
  if(c.guard) {
    if(code==='NOT_MEMBER') c.role='users';
    if(code==='NOT_ADMIN') c.role='member';
    if(code==='NOT_FOUND') c.role='admin';
    if(code==='DEADLINE') {c.role='admin';c.advance='2d';}
  } else if(c.op==='add'&&c.role==='users') c.expected={code:'NOT_MEMBER'};
  else if(c.op==='approve'&&c.role!=='admin') c.expected={code:'NOT_ADMIN'};
  else if(c.op==='finish'&&c.role==='users') c.expected={code:'NOT_FOUND'};
  c.args=async(ctx,a)=>{
    if(c.op==='add') return {picture:await ctx.upload(a,'image'),document:await ctx.upload(a,'file','text/plain')};
    if(c.guard&&code==='NOT_FOUND') return {note:'missing',...(c.op==='approve'?{reason:'Proof reason'}:{})};
    const owner=a.role==='users'?ctx.sessions.member[0]:a;
    return {note:await create(ctx,owner),...(c.op==='approve'?{reason:'Proof reason'}:{})};
  };
  if(!c.expected.code) c.assert=async(r,ctx,a,args)=>{
    if(c.op==='add') {assert.equal(r.result.owner,a.principal);assert.ok(r.result.picture);assert.ok(r.result.document);}
    if(c.op==='note') assert.equal(r.data?.owner??null,a.role==='users'?null:a.principal);
    if(c.op==='approve') {
      const row=(await ctx.call('note',a,{note:args.note})).data;
      ctx.assertApproval(row,a,args.reason,{by:'approvedBy',why:'reason'});
    }
    if(c.op==='finish') assert.equal(r.result,null);
  };
}
`;
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){const [client,platform,out]=process.argv.slice(2);if(!client||!platform||!out)throw Error('usage: publication-scaf1.mjs client.tgz platform.tgz out');console.log(JSON.stringify(await proveScaffolds(client,platform,out)));}

// Execute the published security card and starter through actual npm packs.
import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('packed security card and starter run as written; broad reads refute', {timeout:240000}, t=>{
 const dir=mkdtempSync(join(tmpdir(),'sb4-security-packed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const run=(cmd,args,cwd=dir,expected=0)=>{const r=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:120000,env:{...process.env,SNAPBACK4_BIN:''}});assert.equal(r.status,expected,`${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);return r.stdout;};
 const pack=source=>join(dir,JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],source))[0].filename);
 const client=pack(join(root,'packages/snapback4'));const nativeName=`snapback4-${process.platform}-${process.arch}`;
 const native=join(dir,'native');mkdirSync(native);copyFileSync(join(root,'packages',nativeName,'package.json'),join(native,'package.json'));copyFileSync(process.env.SNAPBACK4_BIN||join(root,'target/debug/snapback4'),join(native,'snapback4'));
 copyFileSync(join(root,'packages',nativeName,'THIRD-PARTY-NOTICES'),join(native,'THIRD-PARTY-NOTICES'));
 const platform=pack(native);writeFileSync(join(dir,'package.json'),'{}');
 if(process.env.SNAPBACK4_SECURITY_PACK_EVIDENCE){
  const evidence=process.env.SNAPBACK4_SECURITY_PACK_EVIDENCE;mkdirSync(evidence,{recursive:true});
  const digest=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
  for(const file of [client,platform])copyFileSync(file,join(evidence,basename(file)));
  writeFileSync(join(evidence,'packs.json'),JSON.stringify({source:process.env.SNAPBACK4_SECURITY_SOURCE||null,client:{file:basename(client),sha256:digest(client)},platform:{file:basename(platform),sha256:digest(platform)},binarySha256:digest(join(native,'snapback4'))},null,2)+'\n');
 }

 run('npm',['install','--ignore-scripts','--omit=optional','--no-audit','--no-fund',client,platform]);
 const cli=join(dir,'node_modules/snapback4/bin/snapback4.js');const command=(args,cwd=dir,code=0)=>run(process.execPath,[cli,...args],cwd,code);
 for(const method of ['guests','password']){
  const app=join(dir,`revocation-${method}`);mkdirSync(join(app,'snapback'),{recursive:true});
  writeFileSync(join(app,'snapback/schema.q'),`use identity ${method}\ntable notes:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\ninvariant notes.read only .owner = viewer\nquery notes():\n  return notes first 10 by .id\nmutation add():\n  return insert notes { owner: viewer }\n`);
  const output=command(['test'],app);
  assert.match(output,/security live-session revocation HTTP: 14 attempts refused/);
 }
 const guide=command(['guide','security','--full']);const blocks=[...guide.matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(m=>m[1]);assert.ok(blocks.length);
 for(let i=0;i<blocks.length;i++){
  const app=join(dir,`card-${i}`);mkdirSync(join(app,'snapback'),{recursive:true});writeFileSync(join(app,'snapback/schema.q'),blocks[i]);
  let checked=JSON.parse(command(['check','--json'],app));assert.equal(checked.ok,true);assert.ok(checked.security.invariants.length);
  assert.ok(checked.security.invariants.every(v=>['proved','unproved'].includes(v.status)),JSON.stringify(checked.security));assert.ok(checked.security.invariants.every(v=>v.direct_rule==='proved'));
  const audited=JSON.parse(command(['audit','--json'],app));assert.equal(audited.format,1);assert.ok(audited.exposures.some(x=>x.table==='privateNotes'));
  assert.ok(command(['test'],app).includes('security tests:'));
  writeFileSync(join(app,'snapback/schema.q'),blocks[i].replace('read <- .patient = viewer','read <- allow'));
  checked=JSON.parse(command(['check','--json'],app,1));assert.equal(checked.ok,false);assert.ok(checked.security.invariants.some(v=>v.status==='refuted'));
  command(['test'],app,1);
 }
 const starter=join(dir,'starter');command(['init',starter,'--online']);const source=readFileSync(join(starter,'snapback/schema.q'),'utf8');assert.ok(source.includes('invariant todos.read only .ownerId = viewer'));
 command(['check'],starter);assert.ok(command(['test'],starter).includes('security tests:'));
 const social=join(dir,'social');command(['init',social,'--template','social']);
 command(['check'],social);assert.ok(command(['test'],social).includes('security tests:'));
 const web=join(dir,'web');command(['init',web,'--web']);
 command(['check'],web);assert.ok(command(['test'],web).includes('security tests:'));
 for(const mode of ['web','expo']){
  const chat=join(dir,`chat-${mode}`);command(['init',chat,'--template','chat',`--${mode}`]);
  assert.ok(readFileSync(join(chat,'snapback/schema.q'),'utf8').includes('invariant messages.read only exists memberships[.conversationId, viewer]'));
  command(['check'],chat);assert.ok(command(['test'],chat).includes('security tests:'));
 }
 const production=join(dir,'production');mkdirSync(join(production,'snapback'),{recursive:true});
 copyFileSync(join(web,'recipes/production/schema.q'),join(production,'snapback/schema.q'));
 command(['check'],production);assert.ok(command(['test'],production).includes('security tests:'));
});

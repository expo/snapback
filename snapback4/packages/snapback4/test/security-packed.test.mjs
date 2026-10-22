// Execute the published security card and starter through actual npm packs.
import test from 'node:test';
import {proveSecurity} from '../../../scripts/publication-security.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('packed security card and starter run as written; broad reads refute', {timeout:360000}, async t=>{
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

 const result=await proveSecurity(client,platform,dir);
 assert.equal(result.status,'passed');
 const installed=readdirSync(dir).filter(name=>name.startsWith('security-policy-'));
 assert.equal(installed.length,1);
 const project=join(dir,installed[0]),cli=join(project,'node_modules/snapback4/bin/snapback4.js');
 for(const [code,fact] of [
  ['N_RETAINED_ROLE_GRANT','A recipient role required when storing a grant'],
  ['N_OPTIONAL_UPLOAD_CREATE','An optional upload argument can be omitted'],
  ['N_ROLE_WIDE_WRITE','A global role plus viewer attribution'],
  ['N_CREATE_EDIT_ASYMMETRY','An argument-supplied column has a specific change guard'],
  ['N_PRIVATE_CREATE_EDIT_ASYMMETRY','A caller can initialize a private column'],
  ['N_EVIDENCE_REMOVAL','Delete, detachment or explicit clearing'],
  ['E_SECURITY_NOTES','the individual disposition file is malformed'],
 ]){
  const excerpt=run(process.execPath,[cli,'why',code],project).split('\n\n').slice(1).join('\n\n');
  assert.ok(excerpt.includes('### '+code),`installed why selects its dedicated definition: ${code}`);
  assert.ok(excerpt.includes(fact),`installed defining fact: ${code}`);
 }
 // SEC8 presence intent is copied verbatim from the installed guide. Both
 // forms must compile and gate an optional creator through the actual pack.
 const uploads=run(process.execPath,[cli,'guide','uploads','--full'],project);
 const presence=uploads.match(/`invariant documents[^`]+`/g);
 assert.equal(presence.length,2);
 const presenceDir=join(dir,'presence-intent');mkdirSync(join(presenceDir,'snapback'),{recursive:true});
 const schema=[...uploads.matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(m=>m[1]).find(s=>s.includes('table documents:')&&s.includes('mutation place('));
 assert.ok(schema,'the installed upload recipe supplies the complete context');
 for(const candidate of presence){
  writeFileSync(join(presenceDir,'snapback/schema.q'),schema+'\n'+candidate.slice(1,-1)+'\n');
  assert.equal(JSON.parse(run(process.execPath,[cli,'check','--json'],presenceDir)).ok,true,'guide source and candidate run verbatim');
  const optional=schema.replace("  scan: file <=10000 ('application/pdf')","  scan: file <=10000 ('application/pdf') ?").replace("mutation place(scan: file <=10000 ('application/pdf')):","mutation place(scan: file <=10000 ('application/pdf') ?):");
  writeFileSync(join(presenceDir,'snapback/schema.q'),optional+'\n'+candidate.slice(1,-1)+'\n');
  const result=JSON.parse(run(process.execPath,[cli,'check','--json'],presenceDir,1));
  assert.ok(result.securityReviews.some(r=>r.code==='N_OPTIONAL_UPLOAD_CREATE'&&r.gated));
 }
 // The installed wrapper must expose the focused day-two advice and allow
 // intentional optionality without shipping a pre-acknowledged source file.
 for(const lane of ['003','040','030','042','028']){
  const cwd=join(dir,'day-two-'+lane);mkdirSync(join(cwd,'snapback'),{recursive:true});
  writeFileSync(join(cwd,'snapback/schema.q'),readFileSync(new URL('../../../crates/snapback4-lang/tests/security/wave23/'+lane+'.q',import.meta.url)));
  const checked=JSON.parse(run(process.execPath,[cli,'check','--json'],cwd));
  assert.equal(checked.ok,true,`installed day-two check ${lane}`);
  assert.ok(!checked.securityReviews.some(r=>r.code==='N_OPTIONAL_UPLOAD_CREATE'));
  if(lane==='030'){
   const stale=checked.security.notes.filter(n=>n.code==='N_STALE_CREATION_CHECK');
   assert.equal(stale.length,2,'independent applications and permits eligibility questions stay separate');
   assert.ok(stale.some(n=>n.message.startsWith('applications:')&&n.message.includes('operatorFlags.suspended')));
   assert.ok(stale.some(n=>n.message.startsWith('permits:')&&n.message.includes('applications.lastPassed,status')));
  }
  if(lane==='028')assert.equal(checked.security.notes.filter(n=>n.code==='N_EVIDENCE_REMOVAL').length,1);
  if(lane==='042'){
   const text=run(process.execPath,[cli,'check'],cwd);
   assert.match(text,/N_PRIVATE_CREATE_EDIT_ASYMMETRY/);
   const inventory=text.indexOf('N_INSERT_WRITE_INTENT');
   assert.ok(inventory<0||text.indexOf('N_PRIVATE_CREATE_EDIT_ASYMMETRY')<inventory);
  }
 }
 assert.ok(result.guideCases.every(c=>c.broadRead==='refuted'));
 assert.equal(result.starters.length,7);
 if(process.env.SNAPBACK4_SECURITY_PACK_EVIDENCE)
  writeFileSync(join(process.env.SNAPBACK4_SECURITY_PACK_EVIDENCE,'security-evidence.json'),JSON.stringify(result,null,2)+'\n');
});

// @ref LLP 3000.036.004#133-coverage-and-bounded-checking — compact output never drops structured evidence.
test('check keeps invariant details behind verbose and preserves complete JSON', {timeout:120000}, t=>{
 const dir=mkdtempSync(join(tmpdir(),'sb4-security-summary-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(dir,'snapback'));writeFileSync(join(dir,'package.json'),'{}');
 writeFileSync(join(dir,'snapback/schema.q'),"table notes:\n  owner: principal\n  read <- .owner = viewer\n  online only\n"+Array.from({length:8},()=>"invariant notes.read only .owner = viewer\n").join(''));
 const binary=process.env.SNAPBACK4_BIN||join(root,'target/debug/snapback4');
 const invoke=(...args)=>{const r=spawnSync(binary,args,{cwd:dir,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);return r;};
 const compact=invoke('check'),text=compact.stdout+compact.stderr;
 assert.match(text,/security: \d+ proved, \d+ refuted, \d+ unproved/);
 assert.equal((text.match(/— N_INVARIANT_RESTATES_RULE:/g)||[]).length,1,'restating sites share one table questionnaire');
 assert.match(text,/8 underlying questions/);
 assert.match(text,/snapback4 test/);assert.match(text,/snapback4 audit/);
 assert.doesNotMatch(text,/security Unproved:|counterexample \{/);
 const full=invoke('check','--verbose');assert.match(full.stdout+full.stderr,/whole-protocol noninterference/);
 const json=JSON.parse(invoke('check','--json').stdout);assert.equal(json.security.invariants.length,8);
 assert.equal(json.security.notes.filter(n=>n.code==='N_INVARIANT_RESTATES_RULE').length,8);
});

test('an escalation note stays visible above repeated broad-read advice', {timeout:60000}, t=>{
 const dir=mkdtempSync(join(tmpdir(),'sb4-security-rank-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(dir,'snapback'));writeFileSync(join(dir,'package.json'),'{}');
 const source="table roles:\n  principal: principal\n  role: enum('owner','member')\n  unique principal\n  read <- allow\n  insert <- .principal = viewer\n  online only\ntable secrets:\n  read <- exists roles[viewer, role = 'owner']\n  online only\nmutation register(role: enum('owner','member')):\n  return insert roles {principal: viewer,role}\n"+Array.from({length:8},(_,n)=>`table public${n}:\n  read <- allow\n  online only\n`).join('');
 writeFileSync(join(dir,'snapback/schema.q'),source);
 const binary=process.env.SNAPBACK4_BIN||join(root,'target/debug/snapback4');
 const result=spawnSync(binary,['check'],{cwd:dir,encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/N_PRIVILEGE_ESCALATION/);
 const broad=result.stdout.indexOf('N_BROAD_READ');
 assert.ok(broad<0||result.stdout.indexOf('N_PRIVILEGE_ESCALATION')<broad);
 assert.equal((result.stdout.match(/— N_BROAD_READ:/g)||[]).length,9,'every likely-hole audience survives the cap');
});

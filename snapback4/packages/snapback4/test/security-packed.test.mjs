// Execute the published security card and starter through actual npm packs.
import test from 'node:test';
import {proveSecurity} from '../../../scripts/publication-security.mjs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
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
 assert.match(text,/more actionable notes in check --verbose\/JSON/);
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
 assert.match(result.stdout,/more actionable notes/);
});

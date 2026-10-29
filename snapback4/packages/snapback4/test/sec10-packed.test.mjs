import '../../../scripts/test-npm-cache.mjs';
import {guideReference} from '../../../scripts/publication-guide.mjs';
// SEC10's documented repairs through installed client and native tarballs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('packed approval decisions, nonblank guards and text minimums run as documented',{timeout:300000},t=>{
 const dir=mkdtempSync(join(tmpdir(),'sb4-sec10-packed-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const run=(command,args,cwd=dir,status=0)=>{const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:120000,env:{...process.env,SNAPBACK4_BIN:''}});assert.equal(r.status,status,`${command} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);return r.stdout;};
 const pack=source=>join(dir,JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],source))[0].filename);
 const client=pack(join(root,'packages/snapback4'));const nativeName=`snapback4-${process.platform}-${process.arch}`;
 const native=join(dir,'native');mkdirSync(native);copyFileSync(join(root,'packages',nativeName,'package.json'),join(native,'package.json'));
 copyFileSync(process.env.SNAPBACK4_BIN||join(root,'target/debug/snapback4'),join(native,'snapback4'));
 copyFileSync(join(root,'packages',nativeName,'THIRD-PARTY-NOTICES'),join(native,'THIRD-PARTY-NOTICES'));
 const platform=pack(native);writeFileSync(join(dir,'package.json'),'{}');run('npm',['install','--ignore-scripts','--no-audit','--no-fund',client,platform]);
 assert.match(readFileSync(join(dir,'node_modules/snapback4/THIRD-PARTY-NOTICES'),'utf8'),/UNICODE LICENSE V3/);
 const cli=join(dir,'node_modules/snapback4/bin/snapback4.js');mkdirSync(join(dir,'snapback'));
 const card=guideReference(cli,'security',{cwd:dir});assert.match(card,/N_BLANK_TEXT_GUARD/);assert.match(card,/trim\(value\) != ''/);
 for(const code of ['N_APPROVAL_NOT_ENFORCED','N_BLANK_TEXT_GUARD','N_TEXT_EVIDENCE','N_MEDIA_PRIVATE_FIELDS'])assert.match(run(process.execPath,[cli,'why',code]),new RegExp(code));
 const recipe=[...card.matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(m=>m[1]).find(s=>s.includes("query required(value: text 1..30)"));assert.ok(recipe,'complete installed recipe');
 let source=recipe.replace("trim(value) != ''","value != ''").replace("  d = docs[doc] ! else NOT_FOUND\n  require d.approved else NO_APPROVAL\n",'')+'\n';
 const write=()=>writeFileSync(join(dir,'snapback/schema.q'),source);write();
 let checked=JSON.parse(run(process.execPath,[cli,'check','--json'],dir));assert.ok(checked.securityReviews.some(r=>r.code==='N_BLANK_TEXT_GUARD'&&!r.gated));assert.ok(checked.securityReviews.some(r=>r.code==='N_APPROVAL_NOT_ENFORCED'&&!r.gated));
 source=source.replace("value != ''","trim(value) != ''");write();
 checked=JSON.parse(run(process.execPath,[cli,'check','--json'],dir));assert.ok(!checked.securityReviews.some(r=>r.code==='N_BLANK_TEXT_GUARD'));
 const decision=checked.securityReviews.find(r=>r.code==='N_APPROVAL_NOT_ENFORCED');assert.ok(decision);
 run(process.execPath,[cli,'check','--ack-security',decision.id,'--reason','informational approval record: this draft may finish independently']);
 source=recipe+'\n';write();
 assert.equal(JSON.parse(run(process.execPath,[cli,'check','--json'])).ok,true);
 const created=JSON.parse(run(process.execPath,[cli,'run','create','{}','--as','clerk','--json']));
 const result=run(process.execPath,[cli,'run','approve',JSON.stringify({doc:created.result.id,value:' \t '}),'--as','clerk','--json'],dir,1);assert.match(result,/EMPTY_REASON/);
 assert.match(run(process.execPath,[cli,'run','required',JSON.stringify({value:'\u2003 \t'}),'--as','clerk','--json'],dir,1),/E_INPUT/);
 for(const value of ['\u200b','\u2060','\u200c','\u202e','\ufeff','\u00ad','\ufe0f']){assert.match(run(process.execPath,[cli,'run','required',JSON.stringify({value}),'--as','clerk','--json'],dir,1),/E_INPUT/);assert.match(run(process.execPath,[cli,'run','approve',JSON.stringify({doc:created.result.id,value}),'--as','clerk','--json'],dir,1),/EMPTY_REASON/);}
 assert.match(run(process.execPath,[cli,'run','required',JSON.stringify({value:'❤️'}),'--as','clerk','--json']),/❤️/);
 assert.match(run(process.execPath,[cli,'run','required',JSON.stringify({value:' a '}),'--as','clerk','--json']),/ a /);
 assert.ok(readFileSync(join(dir,'snapback/security-reviews.json'),'utf8').includes('informational approval record'));
 const info=join(dir,'informational');mkdirSync(join(info,'snapback'),{recursive:true});
 source="table docs:\n  rewindApproved: bool default false\n  status: enum('draft','done') default 'draft'\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create():\n  return insert docs {}\nmutation approveRewind(doc: docs):\n  update docs[doc] {rewindApproved:true}\nmutation finish(doc: docs):\n  update docs[doc] {status:'done'}\n";
 writeFileSync(join(info,'snapback/schema.q'),source);checked=JSON.parse(run(process.execPath,[cli,'check','--json'],info));
 assert.ok(checked.securityReviews.some(r=>r.code==='N_APPROVAL_INFORMATIONAL'&&!r.gated));
 assert.ok(!checked.securityReviews.some(r=>r.code==='N_APPROVAL_NOT_ENFORCED'));
 for(const [code,fact] of [['N_APPROVAL_INFORMATIONAL','It does not block deployment.'],['N_INSERT_TABLE_AUTHORITY','Confirm the declared table insert and edit audiences']]){const why=run(process.execPath,[cli,'why',code]);assert.match(why,new RegExp(code));assert.ok(why.includes(fact),why);}
 const edit=join(dir,'edit-guard');mkdirSync(join(edit,'snapback'),{recursive:true});
 source="table docs:\n  title: text <=80\n  read <- allow\n  insert <- allow\n  update <- allow\n  online only\nmutation create(title: text <=80):\n  return insert docs {title}\nmutation edit(doc: docs,title: text <=80):\n  require viewer = 'service:editor' else NOT_EDITOR\n  update docs[doc] {title}\n";
 writeFileSync(join(edit,'snapback/schema.q'),source);checked=JSON.parse(run(process.execPath,[cli,'check','--json'],edit));
 assert.ok(checked.securityReviews.some(r=>r.code==='N_INSERT_WRITE_INTENT'&&!r.gated));
 source+="invariant docs.title update only viewer = 'service:editor'\n";writeFileSync(join(edit,'snapback/schema.q'),source);
 checked=JSON.parse(run(process.execPath,[cli,'check','--json'],edit));
 assert.ok(!checked.securityReviews.some(r=>r.code==='N_INSERT_WRITE_INTENT'));

 // The installed wrapper must execute the guide's witness-specific answer,
 // including explicit permission for the observed operation and caller.
 const witnessed=join(dir,'witnessed');mkdirSync(join(witnessed,'snapback'),{recursive:true});
 const original=readFileSync(new URL('../../../crates/snapback4-lang/tests/security/sec10-shipping/w30-033.q',import.meta.url),'utf8');
 writeFileSync(join(witnessed,'snapback/schema.q'),original);
 checked=JSON.parse(run(process.execPath,[cli,'check','--json'],witnessed,1));
 const concrete=checked.securityReviews.find(r=>r.code==='N_APPROVAL_NOT_ENFORCED'&&r.witness?.operation==='advanceJob');assert.ok(concrete?.gated,'a concrete workflow effect is gated');
 const rejected=JSON.parse(run(process.execPath,[cli,'check','--ack-security',concrete.id,'--reason','one decision','--json'],witnessed,2));assert.equal(rejected.problems[0].code,'E_SECURITY_NOTES');
 const prose=`witness ${concrete.witness.id}; permit advanceJob as ${concrete.witness.viewer}; intended effect: advanceJob may deliberately proceed under this explicit test specification`;
 const rejectedProse=JSON.parse(run(process.execPath,[cli,'check','--ack-security',concrete.id,'--reason',prose,'--json'],witnessed,2));assert.equal(rejectedProse.problems[0].code,'E_SECURITY_NOTES');
 const answer=`witness ${concrete.witness.id}; allow jobs.advanceJob when true`;
 const answered=JSON.parse(run(process.execPath,[cli,'check','--ack-security',concrete.id,'--reason',answer,'--json'],witnessed));assert.ok(answered.securityReviews.some(r=>r.id===concrete.id&&r.acknowledged));
 writeFileSync(join(witnessed,'snapback/schema.q'),'-- independent comment\n'+original);
 const retained=JSON.parse(run(process.execPath,[cli,'check','--json'],witnessed));assert.ok(retained.securityReviews.some(r=>r.id===concrete.id&&r.acknowledged));

});

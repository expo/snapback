// @ref LLP 3000.011.003.000.000#11-wave-14-truthful-starter-custody-day4 — H9 executes the installed binary, with baseline negative controls.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runToolchainCommand } from "./publication-starters.mjs";

const oldProof = readFileSync(new URL("../crates/snapback4/src/verbs/init/previous/day2-proof-0.4.29.mjs", import.meta.url), "utf8");
const template = readFileSync(new URL("../crates/snapback4/src/verbs/init/day2-proof.mjs", import.meta.url), "utf8");
export const day4Consumer = String.raw`
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {cli,command} from 'snapback4/proof';
const source="use identity guests\ntable notes:\n  title: text <=80\n  public 'shared'\n  insert <- allow\nquery list():\n  return notes first 10 by .id\nmutation add(title: text <=80):\n  return insert notes {title}\n";
const oldProof=OLD_PROOF;
const template=DAY2_TEMPLATE;
const mode=process.argv[2];
const cwd=join(process.cwd(),'day4-'+mode);mkdirSync(join(cwd,'snapback'),{recursive:true});
writeFileSync(join(cwd,'snapback/schema.q'),source);
const run=async args=>{const r=await cli(args,{cwd});assert.equal(r.code,0,r.stdout+r.stderr);return r.stdout;};
await run(['init','--web']);
const pkg=()=>JSON.parse(readFileSync(join(cwd,'package.json')));
const save=p=>writeFileSync(join(cwd,'package.json'),JSON.stringify(p));
if(mode==='custom'){
 writeFileSync(join(cwd,'scripts/day2-proof.mjs'),"const versions=['versions/v1','versions/v2']; // application-owned\n");
 writeFileSync(join(cwd,'scripts/frontend-proof.mjs'),'// application-owned business proof\n');
 const p=pkg();p.scripts['day2:proof']='node scripts/day2-proof.mjs';save(p);
 for(const args of [['check'],['init','--adapt']]){
  const text=await run(args);assert.doesNotMatch(text,/passes no saved versions|proof infrastructure needs updating|no write scenario|add versions\//);
 }
}else if(mode==='removed'){
 rmSync(join(cwd,'scripts/day2-proof.mjs'),{force:true});rmSync(join(cwd,'versions'),{recursive:true,force:true});
 const p=pkg();delete p.scripts['day2:proof'];save(p);
 for(const args of [['check'],['init','--adapt']]){
  const text=await run(args);assert.doesNotMatch(text,/proof infrastructure needs updating|add scripts\/day2-proof|add versions\//);
 }
 await run(['init','--adapt','--apply']);
 assert.equal(pkg().snapback4.starter.day2,false);assert.equal(existsSync(join(cwd,'scripts/day2-proof.mjs')),false);
}else if(mode==='legacy'){
 rmSync(join(cwd,'versions'),{recursive:true,force:true});mkdirSync(join(cwd,'versions'));
 const stale=source.replace('title: text <=80','title: text <=40');
 for(const v of ['v1','v2'])writeFileSync(join(cwd,'versions/'+v+'.q'),stale);
 writeFileSync(join(cwd,'scripts/day2-proof.mjs'),oldProof);
 const p=pkg();delete p.snapback4;p.scripts['day2:proof']='node scripts/day2-proof.mjs versions/v1.q versions/v2.q';save(p);
 const preview=await run(['init','--adapt']);
 await run(['init','--adapt','--apply']);
 assert.equal(readFileSync(join(cwd,'versions/v1/schema.q'),'utf8'),source);
 assert.equal(readFileSync(join(cwd,'versions/v1.q'),'utf8'),stale);
 assert.equal(pkg().scripts['day2:proof'],'node scripts/day2-proof.mjs versions/v1 versions/v2');
 assert.match(preview,/versions\/v1 versions\/v2/);
}else if(mode==='optin'){
 for(const flag of ['--web','--expo']){
  const fresh=join(cwd,flag.slice(2));mkdirSync(fresh);
  const made=await cli(['init',flag,'--day2'],{cwd:fresh});assert.equal(made.code,0,made.stdout+made.stderr);
  assert.ok(existsSync(join(fresh,'versions/v1/schema.q')));
  assert.ok(existsSync(join(fresh,'scripts/day2-proof.mjs')));
 }
}else if(mode==='template'){
 await run(['init','--adapt','--day2','--apply']);
 // Execute the emitted template with real business assertions and a fresh
 // explicit ./deploy. Both saved versions have an authored persisted-row case.
 for(const v of ['v1','v2']){
  writeFileSync(join(cwd,'versions/'+v+'/fixtures/notes.jsonl'),'{"id":"fixture-note","title":"fixture"}\n');
  writeFileSync(join(cwd,'versions/'+v+'/fixtures/test.cases.jsonl'),'{"op":"list","count":1}\n');
 }
 let text=readFileSync(join(cwd,'scripts/day2-proof.mjs'),'utf8');assert.equal(text,template);
 text=text.replace(/  assert.fail\(.*\);/, BUSINESS_CHECK);
 writeFileSync(join(cwd,'scripts/day2-proof.mjs'),text);
 const result=await command('npm',['run','day2:proof','--','versions/v1','versions/v2','./deploy'],{cwd});
 assert.equal(result.code,0,result.stdout+result.stderr);assert.ok(existsSync(join(cwd,'deploy/store.sqlite')));
 const again=await command('npm',['run','day2:proof','--','versions/v1','versions/v2','./deploy'],{cwd});
 assert.notEqual(again.code,0);assert.match(again.stderr,/destination already exists/);
}else throw Error('unknown DAY4 mode '+mode);
console.log('DAY4 H9 '+mode+' passed');
`.replace("OLD_PROOF", JSON.stringify(oldProof)).replace("DAY2_TEMPLATE", JSON.stringify(template)).replace("BUSINESS_CHECK", "\"  const session=await (await fetch(url+'/auth/guest',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json();\\n  if(release==='v1'){const sent=await (await fetch(url+'/m/add',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.session.token},body:'{\\\"id\\\":\\\"day4-create\\\",\\\"args\\\":{\\\"title\\\":\\\"persisted proof\\\"}}'})).json();assert.equal(sent.state,'sent');}\\n  const answer=await (await fetch(url+'/q/list',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.session.token},body:'{\\\"args\\\":{}}'})).json();\\n  assert.equal(answer.data.length,1,release);assert.equal(answer.data[0].title,'persisted proof',release);\"");

export async function proveDay4(cwd) {
  writeFileSync(join(cwd, "day4.mjs"), day4Consumer);
  const env={...process.env,CI:"1"};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  const checks=[];
  for(const mode of ["custom","removed","legacy","optin","template"]){
    await runToolchainCommand(process.execPath,["day4.mjs",mode],{cwd,env,timeout:120_000});
    checks.push({mode,status:"passed"});
  }
  return {status:"passed",checks};
}

import {mkdtempSync,mkdirSync,readFileSync,readdirSync,cpSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {getEncoding} from '/home/ccheever/projects/snapback-sb4loop/snapback4/node_modules/js-tiktoken/dist/index.js';
const out=import.meta.dirname,repo='/home/ccheever/projects/snapback-sb4loop',binary=join(out,'snapback4-0.4.46-final'),enc=getEncoding('o200k_base');
const run=(args,cwd)=>{const r=spawnSync('timeout',['--kill-after=5s','120s',binary,...args],{cwd,encoding:'utf8',maxBuffer:16e6,env:{...process.env,SNAPBACK4_INIT_INSTALL:'0'}});return {args,exit:r.status,stdout:r.stdout??'',stderr:r.stderr??'',tokens:enc.encode((r.stdout??'')+(r.stderr??'')).length};};
const results=[];
for(const id of ['001','022','011','021']){
 const source=join(process.env.HOME,'sb4-loop/wave32/apps',readdirSync(join(process.env.HOME,'sb4-loop/wave32/apps')).find(n=>n.startsWith(id+'-snapback-'))),dir=mkdtempSync(join(tmpdir(),'i30-read-'));
 const skip=new Set(['node_modules','.git','.snapback4','deploy','deployment','production','staging','dist','v1','v2','logs','artifacts']);
 try{
  for(const n of readdirSync(source))if(!skip.has(n)&&!n.startsWith('.env')&&!n.endsWith('.sqlite')&&!n.includes('users.json'))cpSync(join(source,n),join(dir,n),{recursive:true,filter:p=>!p.split('/').some(s=>skip.has(s)||s.endsWith('-owner')||s.endsWith('-token'))});
  mkdirSync(join(dir,'node_modules'),{recursive:true});symlinkSync(join(repo,'snapback4/packages/snapback4'),join(dir,'node_modules/snapback4'),'dir'); symlinkSync(join(repo,'snapback4/node_modules/playwright-core'),join(dir,'node_modules/playwright-core'),'dir');
  const path=join(repo,`snapback4/reports/20261027-dx16/after-${id}-reads.jsonl.gz`),before=gunzipSync(readFileSync(path)).toString().trim().split('\n').map(JSON.parse);
  const reads=before.map(r=>run(r.args,dir));const check=run(['check'],dir);
  const old=JSON.parse(readFileSync(join(repo,'snapback4/reports/20261027-dx16/model-replays.json'))).results.find(r=>r.phase==='after'&&r.id===id);
  const oldCliTokens=before.reduce((s,r)=>s+enc.encode(r.output).length,0),cliTokens=reads.reduce((s,r)=>s+r.tokens,0);
  results.push({id,method:'Deterministic replay of all retained native-model guide/init commands on a fresh private copy; no new agent session. Full current command outputs counted. Retain prior non-CLI documentation; recompute every CLI read and replace old automatic change notes with the entire current check output as a conservative bound, using o200k_base.',reads,cliTokens,oldCliTokens,oldStrictTokens:old.docsPlusAutomaticChangeNotes,oldAutomaticChangeNoteTokens:old.automaticChangeNoteTokens,retainedNonCliDocsTokens:old.docsTokens-oldCliTokens,strictReplayedTokens:old.docsTokens+cliTokens-oldCliTokens+check.tokens,checkExit:check.exit,checkOutputTokens:check.tokens,check});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
const day1=mkdtempSync(join(tmpdir(),'i30-day1-'));
try{const reads=[run(['guide','start'],day1),run(['guide','workflow'],day1)];const readme=readFileSync(join(repo,'snapback4/packages/snapback4/README.md'),'utf8');results.push({kind:'TOK1 day-one routed path',method:'Actual fresh-project start + routed workflow + README before first schema; deterministic instruction replay, not whole-session token evidence.',reads,docsTokensBeforeSchema:reads.reduce((s,r)=>s+r.tokens,0)+enc.encode(readme).length,budget:10000});}finally{rmSync(day1,{recursive:true,force:true});}
writeFileSync(join(out,'reading-replay.json'),JSON.stringify(results,null,2)+'\n');for(const r of results)console.log(JSON.stringify({id:r.id,kind:r.kind,cliTokens:r.cliTokens,strictReplayedTokens:r.strictReplayedTokens,docsTokensBeforeSchema:r.docsTokensBeforeSchema}));

for(const r of results){if(r.id){if(r.checkExit!==0||r.strictReplayedTokens>12000)throw Error(`Day-two reading budget/check failed: ${r.id}`);}else if(r.docsTokensBeforeSchema>10000)throw Error("Day-one reading budget failed");}

const historicalWrongSections=new Set([
 JSON.stringify(['guide','api','proof','--section','Serve script and reusable accounts']),
 JSON.stringify(['guide','deploy','--section','Persistent production: SQLite v1']),
]);
for(const r of results){
 const failures=r.reads.filter(x=>x.exit!==0);
 if(r.id==='021'){
  if(failures.length!==2||failures.some(x=>x.exit!==1||!historicalWrongSections.has(JSON.stringify(x.args))))throw Error('Historical wrong-section replay changed; assess actual outputs');
 }else if(failures.length)throw Error('Unexpected documentation/init refusal: '+JSON.stringify(failures.map(x=>({args:x.args,exit:x.exit}))));
}

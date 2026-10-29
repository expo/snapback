import{readFileSync,readdirSync,existsSync,writeFileSync}from'node:fs';import{join}from'node:path';import{nestedCommands}from'/home/ccheever/sb4-loop/bakeoff/harn37.mjs';
const evidence='/tmp/dx17/evidence',rows=[];
for(const phase of ['before','after-final','after-route','after-observe'])for(const n of [2,5,9,11,18]){
 const lp=`${evidence}/${phase}-${n}-launch.json`;if(!existsSync(lp))continue;const {dir,a}=JSON.parse(readFileSync(lp));const archive=join(dir,'.harness/sessions');if(!existsSync(archive))continue;
 const calls=[];
 const accept=(name,raw)=>{let value;try{value=JSON.parse(raw)}catch{};if(value?.cmd)calls.push(value.cmd);else if(name==='bash'&&value?.command)calls.push(value.command);else if(/exec$/.test(name))calls.push(...nestedCommands(raw).map(c=>c.args.cmd).filter(Boolean));};
 for(const f of readdirSync(archive).filter(f=>f.endsWith('.jsonl')))for(const line of readFileSync(join(archive,f),'utf8').split('\n')){
  let d;try{d=JSON.parse(line)}catch{continue}const p=d.payload??{};
  if(p.type==='custom_tool_call')accept(p.name,p.input);
  if(p.type==='function_call')accept(p.name,p.arguments);
  const e=p.event??{};if(e.kind==='assistant_tool_calls_committed')for(const t of e.tool_calls??[])accept(t.name,t.args);
 }
 const guide=calls.filter(c=>/\bsnapback4\s+guide\b/.test(c));
 const checker=join(dir,'.snapback4/last/day2-check.json');let receipt=null;if(existsSync(checker)){try{const r=JSON.parse(readFileSync(checker));receipt={ok:r.ok,phases:r.phases?.length,failed:r.failed}}catch{}}
 rows.push({phase,n,model:a.model,commandInputs:calls.length,guideMentionBatches:guide.length,guideCards:guide.flatMap(c=>[...c.matchAll(/\bsnapback4\s+guide(?:\s+([a-z][a-z0-9/-]*))?/g)].map(m=>m[1]??'index')),checkerReceipt:receipt,checkerMentionBatches:calls.filter(c=>/\bsnapback4\s+day2-check\b/.test(c)).length,warning:'Guide/checker mentions are static command-input extraction, not execution counts. Heredoc/script text can mention commands; checker receipt separately records an actual invocation.'});
}
writeFileSync(evidence+'/replay-command-analysis.json',JSON.stringify({rows},null,2));console.log(rows.map(({phase,n,guideMentionBatches,checkerReceipt})=>({phase,n,guideMentionBatches,checkerReceipt})));

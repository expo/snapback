import{readFileSync,writeFileSync,existsSync,readdirSync}from'node:fs';
import{join}from'node:path';
import{getEncoding}from'js-tiktoken';
import{gunzipSync}from'node:zlib';
const dir=process.env.DX16_EVIDENCE??import.meta.dirname,encoding=getEncoding('o200k_base'),results=[];
const parsed=file=>(existsSync(file)?readFileSync(file,'utf8'):gunzipSync(readFileSync(file+'.gz')).toString('utf8')).split('\n').flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}});
const docCommand=c=>/\bguide\s/.test(c)||/snapback4\s+init\s+.*--day2/.test(c)||/\b(cat|head|tail|sed|rg|grep|read_file)\b[\s\S]*node_modules\/snapback4\/(README|SERVER|CLIENT|dist)/.test(c);
for(const phase of ['before','after'])for(const id of ['001','022','011','021']){
 const path=join(dir,`${phase}-${id}-run.json`);if(!existsSync(path))continue;
 const meta=JSON.parse(readFileSync(path)),events=parsed(join(dir,`${phase}-${id}.ndjson`)),reads=[];let calls,input,cached,native,docs=0;
 if(meta.model==='codex'){
  const usage=events.filter(e=>e.type==='turn.completed').at(-1)?.usage;if(!usage)continue;input=usage.input_tokens;cached=usage.cached_input_tokens;
  const thread=events.find(e=>e.type==='thread.started').thread_id;
  const folder=join(process.env.HOME,'.codex/sessions/2026/10/27'),session=readdirSync(folder).find(p=>p.endsWith(thread+'.jsonl'));
  const counts=parsed(join(folder,session)).filter(e=>e.type==='event_msg'&&e.payload?.type==='token_count'&&e.payload.info);
  calls=new Map(counts.map(e=>[e.payload.info.total_token_usage.input_tokens,e.payload.info])).size;native={threadId:thread,usage};
  for(const e of events)if(e.type==='item.completed'&&e.item?.type==='command_execution'&&docCommand(e.item.command??'')){
   const tokens=encoding.encode(e.item.aggregated_output??'').length;docs+=tokens;reads.push({command:e.item.command,tokens});
  }
 }else{
  const usage=events.filter(e=>e.payload_type==='run.usage').at(-1)?.payload;if(!usage)continue;calls=usage.calls;input=usage.models.reduce((n,m)=>n+m.input_tokens,0);cached=usage.models.reduce((n,m)=>n+m.cached_tokens,0);native=usage;
  for(const e of events)if(e.payload_type==='tool.result'){
   const p=e.payload;let value;try{value=JSON.parse(p.text)}catch{value={output:p.text}}
   const command=value.command??'',tool=p.correlation_facts?.tool_name;
   if(docCommand(command)||(tool==='read_file'&&/node_modules\/snapback4\//.test(p.text))){const tokens=encoding.encode(value.output??p.text).length;docs+=tokens;reads.push({command,tool,tokens});}
  }
 }
 const cliReads=parsed(join(dir,`${phase}-${id}-reads.jsonl`));
 const cliGuideTokens=cliReads.reduce((n,r)=>n+encoding.encode(r.output).length,0);
 results.push({...meta,calls,inputTokens:input,cachedInputTokens:cached,uncachedInputTokens:input-cached,docsTokens:docs,cliGuideAndInitTokens:cliGuideTokens,reads,native});
}
const report={method:'Paired real native-model discovery sessions on copies of original wave-32 apps, using the exact wave-33 day-two briefs/backend instructions, ending at an implementation/proof plan. No app implementation, deploy, production accounts, frontend build or full day-two score. Same model CLIs/flags as run-bakeoff.mjs. Docs are o200k_base tokens from actual tool-visible package/guide/init outputs; batched surrounding output is conservatively included. Raw CLI stdout is an independent cross-check, not substituted for tool-visible bytes. Native total/cached/uncached input, calls and wall include provider waits and concurrent host load.',baseline:'Retained original 0.4.44 client/platform tarballs from ~/sb4-loop/dist/0.4.44; after uses installed candidate tarballs. README/card/digest bytes and artifact hashes are recorded. Whole-wave input means are contextual and not paired full-app comparisons.',wave33Means:{codexInput:5090000,museInput:21900000},targets:{docsPerLane:12000,codexInputReductionAgainstWaveMean:800000,museInputReductionAgainstWaveMean:3000000,fullAppInputTargetEstablished:false},results};
writeFileSync(join(dir,'model-replays.json'),JSON.stringify(report,null,2)+'\n');console.log(results.map(r=>({phase:r.phase,id:r.id,calls:r.calls,input:r.inputTokens,cached:r.cachedInputTokens,docs:r.docsTokens,minutes:r.wallMinutes})));

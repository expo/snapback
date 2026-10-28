import{readFileSync,writeFileSync,existsSync,readdirSync}from'node:fs';
import{join}from'node:path';
import{getEncoding}from'js-tiktoken';
import{gunzipSync}from'node:zlib';
const dir=process.env.DX16_EVIDENCE??import.meta.dirname,encoding=getEncoding('o200k_base'),results=[];
const parsed=file=>(existsSync(file)?readFileSync(file,'utf8'):gunzipSync(readFileSync(file+'.gz')).toString('utf8')).split('\n').flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}});
const docCommand=c=>/\bguide\s/.test(c)||/snapback4\s+init\s+.*--day2/.test(c)||/\b(cat|head|tail|sed|rg|grep|read_file)\b[\s\S]*node_modules\/snapback4\/(README|SERVER|CLIENT|dist)/.test(c);
// Attribute echo-delimited compound tool output to its producing command.
// Keep unmatched/unsegmented output conservative; do not count app source as docs.
const helpOrCheck=c=>/snapback4\s+[^;]*(?:--help|\bcheck\b)/.test(c);
function oneOutput(command,output,changes=false){
 if(changes){
  if(docCommand(command)||/snapback4\s+[^;]*--help/.test(command))return '';
  const prefix=output.split(/\ncheck:/)[0];
  return /runtime changes:|^## \d+\.\d+\.\d+/m.test(prefix)?prefix:'';
 }
 if(docCommand(command)||/snapback4\s+[^;]*--help/.test(command))return output;
 return '';
}
function attributedOutput(command,output,changes=false){
 const commands=command.split(/;\s*echo\s+(?:={3,}|-{3,})\s*;/);
 if(commands.length===1)return oneOutput(command,output,changes);
 const parts=output.split(/(?:^|\n)(?:={3,}|-{3,})\r?\n/);
 if(parts.length!==commands.length)return oneOutput(command,output,changes);
 return parts.map((part,i)=>oneOutput(commands[i],part,changes)).filter(Boolean).join('\n');
}
for(const phase of ['before','after'])for(const id of ['001','022','011','021']){
 const path=join(dir,`${phase}-${id}-run.json`);if(!existsSync(path))continue;
 const meta=JSON.parse(readFileSync(path)),events=parsed(join(dir,`${phase}-${id}.ndjson`)),reads=[];let calls,input,cached,native,docs=0,upper=0,automatic=0;
 if(meta.model==='codex'){
  const usage=events.filter(e=>e.type==='turn.completed').at(-1)?.usage;if(!usage)continue;input=usage.input_tokens;cached=usage.cached_input_tokens;
  const thread=events.find(e=>e.type==='thread.started').thread_id;
  const stored=join(dir,`${phase}-${id}-usage.json`);
  const counts=existsSync(stored)?JSON.parse(readFileSync(stored)).tokenCounts.map(e=>({payload:{info:e.info}})):(()=>{
   const folder=join(process.env.HOME,'.codex/sessions/2026/10/27'),session=readdirSync(folder).find(p=>p.endsWith(thread+'.jsonl'));
   return parsed(join(folder,session)).filter(e=>e.type==='event_msg'&&e.payload?.type==='token_count'&&e.payload.info);
  })();
  calls=new Map(counts.map(e=>[e.payload.info.total_token_usage.input_tokens,e.payload.info])).size;native={threadId:thread,usage};
  for(const e of events)if(e.type==='item.completed'&&e.item?.type==='command_execution'&&(docCommand(e.item.command??'')||helpOrCheck(e.item.command??''))){
   const output=e.item.aggregated_output??'';automatic+=encoding.encode(attributedOutput(e.item.command,output,true)).length;const tokens=encoding.encode(attributedOutput(e.item.command,output)).length;const conservative=encoding.encode(output).length;docs+=tokens;upper+=conservative;reads.push({command:e.item.command,tokens,batchedUpperBound:conservative});
  }
 }else{
  const usage=events.filter(e=>e.payload_type==='run.usage').at(-1)?.payload;if(!usage)continue;calls=usage.calls;input=usage.models.reduce((n,m)=>n+m.input_tokens,0);cached=usage.models.reduce((n,m)=>n+m.cached_tokens,0);native=usage;
  for(const e of events)if(e.payload_type==='tool.result'){
   const p=e.payload;let value;try{value=JSON.parse(p.text)}catch{value={output:p.text}}
   const command=value.command??'',tool=p.correlation_facts?.tool_name;
   if(docCommand(command)||helpOrCheck(command)||(tool==='read_file'&&/node_modules\/snapback4\//.test(p.text))){const output=value.output??p.text;automatic+=encoding.encode(attributedOutput(command,output,true)).length;const tokens=encoding.encode(attributedOutput(command,output)).length;const conservative=encoding.encode(output).length;docs+=tokens;upper+=conservative;reads.push({command,tool,tokens,batchedUpperBound:conservative});}
  }
 }
 const cliReads=parsed(join(dir,`${phase}-${id}-reads.jsonl`));
 const cliGuideTokens=cliReads.reduce((n,r)=>n+encoding.encode(r.output).length,0);
 results.push({...meta,calls,inputTokens:input,cachedInputTokens:cached,uncachedInputTokens:input-cached,docsTokens:docs,automaticChangeNoteTokens:automatic,docsPlusAutomaticChangeNotes:docs+automatic,docsAndBatchedSourceUpperBound:upper,cliGuideAndInitTokens:cliGuideTokens,reads,native});
}
const report={method:'Paired real native-model discovery sessions on copies of original wave-32 apps, using the exact wave-33 day-two briefs/backend instructions, ending at an implementation/proof plan. No app implementation, deploy, production accounts, frontend build or full day-two score. Same model CLIs/flags as run-bakeoff.mjs. Docs are o200k_base tokens from actual tool-visible package/guide/init outputs; Echo-delimited compound command output is attributed to its producing command; app source/check outputs are excluded when unambiguously separated. Guide/init/help/package reads are counted as documentation (wave33 docs category, with day2 handover included). Automatic runtime-change notes from check are separately measured as check ceremony, matching wave33 tx/agg.py; docsPlusAutomaticChangeNotes also exposes the stricter all-instructional-text total. Unmatched batches remain conservative; docsAndBatchedSourceUpperBound retains the original whole-batch count. Raw CLI stdout is an independent cross-check, not substituted for tool-visible bytes. Native total/cached/uncached input, calls and wall include provider waits and concurrent host load.',baseline:'Retained original 0.4.44 client/platform tarballs from ~/sb4-loop/dist/0.4.44; after uses installed candidate tarballs. README/card/digest bytes and artifact hashes are recorded. Whole-wave input means are contextual and not paired full-app comparisons.',wave33Means:{codexInput:5090000,museInput:21900000},targets:{docsPerLane:12000,codexInputReductionAgainstWaveMean:800000,museInputReductionAgainstWaveMean:3000000,fullAppInputTargetEstablished:false},results};
writeFileSync(join(dir,'model-replays.json'),JSON.stringify(report,null,2)+'\n');console.log(results.map(r=>({phase:r.phase,id:r.id,calls:r.calls,input:r.inputTokens,cached:r.cachedInputTokens,docs:r.docsTokens,minutes:r.wallMinutes})));

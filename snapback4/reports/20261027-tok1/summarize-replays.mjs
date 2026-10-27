import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {getEncoding} from 'js-tiktoken';
import {gunzipSync} from 'node:zlib';
const dir=import.meta.dirname, encoding=getEncoding('o200k_base'),results=[];
const parsed=file=>(existsSync(file)?readFileSync(file,'utf8'):gunzipSync(readFileSync(file+'.gz')).toString('utf8')).split('\n').flatMap(l=>{try{return[JSON.parse(l)];}catch{return[];}});
const docCommand=c=>/\bguide\s/.test(c)||/\b(cat|head|tail|sed|rg|grep|read_file)\b[\s\S]*node_modules\/snapback4\/(README|SERVER|CLIENT|dist)/.test(c);
const schemaWrite=c=>/snapback\/[^\s'"`]*\.q/.test(c)&&(/(?:cat|tee)\s*[>]|writeFile|write_text|write_file|apply_patch|\*\*\* Add File/.test(c));
for(const phase of ['before','after'])for(const id of ['001','025','019','028']){
 const path=join(dir,`${phase}-${id}-run.json`);if(!existsSync(path))continue;
 const meta=JSON.parse(readFileSync(path)),events=parsed(join(dir,`${phase}-${id}.ndjson`));let calls,cached,input,native,seenSchema=false,docsBefore=0,docsTotal=0;const reads=[];
 if(meta.model==='codex'){
  const usage=events.filter(e=>e.type==='turn.completed').at(-1)?.usage;if(!usage)continue;input=usage.input_tokens;cached=usage.cached_input_tokens;
  const thread=events.find(e=>e.type==='thread.started').thread_id;
  const folder=join(process.env.HOME,'.codex/sessions/2026/10/27');const session=readdirSync(folder).find(p=>p.endsWith(thread+'.jsonl'));
  const counts=parsed(join(folder,session)).filter(e=>e.type==='event_msg'&&e.payload?.type==='token_count'&&e.payload.info);
  const unique=new Map(counts.map(e=>[e.payload.info.total_token_usage.input_tokens,e.payload.info]));calls=unique.size;native={threadId:thread,usage};
  for(const e of events){if(e.type!=='item.completed')continue;const i=e.item;
   if(i.type==='file_change'&&i.changes?.some(c=>/snapback\/.*\.q$/.test(c.path)))seenSchema=true;
   const c=i.command??'';if(schemaWrite(c))seenSchema=true;
   if(i.type==='command_execution'&&docCommand(c)){const tokens=encoding.encode(i.aggregated_output??'').length;docsTotal+=tokens;if(!seenSchema)docsBefore+=tokens;reads.push({command:c.slice(0,260),tokens,beforeSchema:!seenSchema});}
  }
 }else{
  const usage=events.filter(e=>e.payload_type==='run.usage').at(-1)?.payload;if(!usage)continue;
  calls=usage.calls;input=usage.models.reduce((a,m)=>a+m.input_tokens,0);cached=usage.models.reduce((a,m)=>a+m.cached_tokens,0);native=usage;
  for(const e of events){if(e.payload_type!=='tool.result')continue;const p=e.payload;let value;try{value=JSON.parse(p.text);}catch{value={output:p.text};}
   const c=value.command??'',tool=p.correlation_facts?.tool_name;
   if(schemaWrite(c)||(tool==='write_file'&&/snapback\/.*\.q/.test(p.text)))seenSchema=true;
   if(docCommand(c)||(tool==='read_file'&&/node_modules\/snapback4\//.test(p.text))){const tokens=encoding.encode(value.output??p.text).length;docsTotal+=tokens;if(!seenSchema)docsBefore+=tokens;reads.push({command:c.slice(0,260),tool,tokens,beforeSchema:!seenSchema});}
  }
 }
 // Cross-check guide reads against the CLI's filesystem-observed first-write boundary.
 const logged=join(dir,`${phase}-${id}-reads.jsonl`);const cliReads=(existsSync(logged)||existsSync(logged+'.gz'))?parsed(logged):[];
 const cliBefore=cliReads.filter(r=>r.beforeSchema).reduce((n,r)=>n+encoding.encode(r.output).length,0);
 const record={...meta,calls,inputTokens:input,cachedInputTokens:cached,uncachedInputTokens:input-cached,docsTokensBeforeSchema:docsBefore,totalDocsOutputTokens:docsTotal,cliGuideTokensBeforeSchema:cliBefore,firstSchemaWriteLocated:seenSchema,reads,native};results.push(record);
}
const report={method:'Same CLIs/models/flags as harness, one fresh before/after session per idea. Scope ends after first compiling initial backend and SDK lookup, not a full application. Native input/cache/call counts; o200k_base counts of actual docs tool outputs (surrounding command output included). First schema write located in tool stream and independently cross-checked by CLI logging. Wall includes model/tool/provider waits; concurrent host work was present.',baseline:'wave32 packed 0.4.43; README byte-identical to f032742ac8',results};
writeFileSync(join(dir,'model-replays.json'),JSON.stringify(report,null,2)+'\n');
console.log(results.map(r=>({phase:r.phase,id:r.id,calls:r.calls,input:r.inputTokens,cached:r.cachedInputTokens,docsBefore:r.docsTokensBeforeSchema,located:r.firstSchemaWriteLocated,minutes:r.wallMinutes})));

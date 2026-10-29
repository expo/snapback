import{readFileSync,existsSync,writeFileSync}from'node:fs';import{join}from'node:path';
const phase=process.argv[2],n=Number(process.argv[3]),base='/tmp/dx17/evidence';
const l=JSON.parse(readFileSync(`${base}/${phase}-${n}-launch.json`)),r=JSON.parse(readFileSync(`${base}/${phase}-${n}-result.json`));
const parse=text=>text.split('\n').flatMap(x=>{try{return[JSON.parse(x)];}catch{return[];}});
const events=parse(readFileSync(`${base}/${phase}-${n}.ndjson`,'utf8'));
let completions=[],basis;
if(l.a.model==='muse'){
 // Public terminal event UUIDs are synthetic, and recorded_at is logical.
 // Keep native local allowance timestamps as a labeled sensitivity only.
 completions=events.filter(e=>e.stream?.kind==='exec.usage'&&e.payload?.completed_calls>0).map(e=>e.payload?.allowance?.as_of_ms).filter(Number.isFinite);basis='exec.usage allowance.as_of_ms; sensitivity, not the harness process-wall metric';
}else{
 const archive=join(l.dir,'.harness/sessions/manifest.json');
 if(existsSync(archive)){const m=JSON.parse(readFileSync(archive));for(const s of m.sessions)for(const f of s.files)completions.push(...parse(readFileSync(join(l.dir,'.harness/sessions',f),'utf8')).filter(e=>e.type==='event_msg'&&e.payload?.type==='task_complete').map(e=>Date.parse(e.timestamp)).filter(Number.isFinite));}
 basis='archived native task_complete.timestamp';
}
const started=Date.parse(l.started),first=completions.length?Math.min(...completions):null,last=completions.length?Math.max(...completions):null;
const {terminalAt,terminalWallMs,processShutdownAfterTerminalMs,...original}=r;
const result={...original,initialCompletionWallMs:first===null?null:first-started,finalNativeCompletionWallMs:last===null?null:last-started,completionTimeBasis:basis,postInitialCompletionDelayMs:first===null?null:r.wallMs-(first-started),postTerminalCleanup:existsSync(`${base}/${phase}-${n}-post-terminal-cleanup.json`)};
writeFileSync(`${base}/${phase}-${n}-result.json`,JSON.stringify(result,null,2));console.log({phase,n,processWallMinutes:r.wallMs/60000,initialCompletionSensitivityMinutes:result.initialCompletionWallMs/60000,postTerminalCleanup:result.postTerminalCleanup});

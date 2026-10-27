// Real native model CLIs/flags, copied day-one apps and the original day-two brief.
import {mkdirSync,cpSync,writeFileSync,readFileSync,existsSync,readdirSync,unlinkSync,openSync,closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
const base='/tmp/dx16-replay',evidence=process.env.DX16_EVIDENCE??import.meta.dirname,phase=process.argv[2]??'before';
const ids=process.argv.slice(3).length?process.argv.slice(3):['001','022','011','021'];
for(const id of ids){
 const name=readdirSync(join(process.env.HOME,'sb4-loop/wave32/apps')).find(p=>p.startsWith(id+'-snapback-'));
 const source=join(process.env.HOME,'sb4-loop/wave32/apps',name),second=join(process.env.HOME,'sb4-loop/wave33/apps',name),dir=join(base,phase+'-'+id);
 mkdirSync(dir,{recursive:true});
 const excluded=new Set(['node_modules','.git','.snapback4','deploy','deployment','production','staging','dist','v1','v2','logs','artifacts']);
 for(const item of readdirSync(source))if(!excluded.has(item)&&!item.startsWith('.env')&&!item.endsWith('.sqlite')&&!item.includes('users.json')){
   cpSync(join(source,item),join(dir,item),{recursive:true,filter:p=>!p.split('/').some(part=>excluded.has(part))});
 }
 cpSync(join(base,phase+'-seed/node_modules'),join(dir,'node_modules'),{recursive:true});
 for(const name of ['DIARY.md','REPORT.md','friction.jsonl'])if(existsSync(join(dir,name)))cpSync(join(dir,name),join(dir,'PREVIOUS-'+name));
 const idea=JSON.parse(readFileSync(join(second,'.lane-idea.json'))),original=readFileSync(join(second,'BRIEF.md'),'utf8').replaceAll(second,dir);
 const scope=`READING REPLAY SCOPE OVERRIDE: Work only in ${dir}. This is the day-two reading/discovery phase of the following exact harness task, with the copied day-one app and installed package. The milestone for this session is DAY2-PLAN.md with exact commands, source-shape choices and compact pseudocode for the release/frozen-client/production proof. Stop there: do not change backend/UI sources, deploy, provision users, run full proof scripts, install frontends or build the app. Inspect original app sources only as needed to choose the change route. Begin with the installed CLI's handover, npx snapback4 init --adapt --day2 (preview only), then follow its recommended documentation path. Use docs on demand to resolve the v1 save, change, preview, v2, rollback, forward, frozen v1 client, reruns and persistent production roster. You may run check and CLI help. Do not inspect other lanes, repository checkouts, transcripts or model session logs. Do not ask questions. State unresolved limits in the plan. This scope override replaces implementation/delivery instructions below; the original brief supplies the same change, constraints and APIs as the harness.\n\n`;
 const brief=scope+original+'\n\nReminder: stop at the reading/discovery plan, no implementation or end-to-end score.\n';
 writeFileSync(join(dir,'REPLAY-BRIEF.md'),brief);writeFileSync(join(evidence,`${phase}-${id}-brief.md`),brief);
 const bin=join(dir,'node_modules/.bin/snapback4');unlinkSync(bin);
 writeFileSync(join(dir,'cli-log.mjs'),`import{spawnSync}from'node:child_process';import{appendFileSync}from'node:fs';const args=process.argv.slice(2);const r=spawnSync(${JSON.stringify(process.execPath)},['node_modules/snapback4/bin/snapback4.js',...args],{encoding:'utf8',maxBuffer:16000000,env:process.env});if(args[0]==='guide'||args[0]==='init')appendFileSync('reads.jsonl',JSON.stringify({at:Date.now(),args,output:r.stdout})+'\\n');process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');process.exit(r.status??1);`);
 writeFileSync(bin,`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(dir,'cli-log.mjs'))} "$@"\n`,{mode:0o755});
 const out=openSync(join(evidence,`${phase}-${id}.ndjson`),'w',0o600);
 const cmd=idea.model==='codex'?join(process.env.HOME,'.local/bin/codex'):join(process.env.HOME,'sb4-loop/muse-exec.sh');
 const args=idea.model==='codex'?['exec','--dangerously-bypass-approvals-and-sandbox','--skip-git-repo-check','--json','--color','never','-m','gpt-6.1-sol','-c','model_reasoning_effort=high','-C',dir,'-o',join(dir,'FINAL.md'),'-']:['--yolo','--json','--model','muse-spark-1.3-contributor','--reasoning-effort','high','--prompt-file',join(dir,'REPLAY-BRIEF.md')];
 const started=Date.now(),child=spawn(cmd,args,{cwd:dir,env:{...process.env,SNAPBACK4_INIT_INSTALL:'0'},stdio:['pipe',out,out]});child.stdin.end(idea.model==='codex'?brief:undefined);
 const code=await new Promise(res=>child.once('exit',res));closeSync(out);
 const record={phase,id,model:idea.model,code,wallMinutes:(Date.now()-started)/60000,scope:'day-two reading/discovery plan for exact harness brief, not full application'};
 writeFileSync(join(evidence,`${phase}-${id}-run.json`),JSON.stringify(record,null,2)+'\n');
 for(const [from,to] of [['reads.jsonl',`${phase}-${id}-reads.jsonl`],['DAY2-PLAN.md',`${phase}-${id}-plan.md`]])if(existsSync(join(dir,from)))cpSync(join(dir,from),join(evidence,to));
 console.log(JSON.stringify(record));
}

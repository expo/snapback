// Real builder CLIs, paired scope: discovery -> first checked application schema + SDK lookup.
import {mkdirSync,cpSync,writeFileSync,readFileSync,existsSync,readdirSync,unlinkSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
const base='/tmp/tok1-replay', evidence=import.meta.dirname;
const phase=process.argv[2] ?? 'before';
const ids=['001','025','019','028'];
for(const id of ids){
 const source=join(process.env.HOME,'sb4-loop/wave32/apps',readdirSync(join(process.env.HOME,'sb4-loop/wave32/apps')).find(p=>p.startsWith(id+'-snapback-')));
 const idea=JSON.parse(readFileSync(join(source,'.lane-idea.json'))), dir=join(base,phase+'-'+id);
 mkdirSync(dir,{recursive:true}); cpSync(join(base,phase+'-seed/node_modules'),join(dir,'node_modules'),{recursive:true});
 writeFileSync(join(dir,'package.json'),JSON.stringify({private:true,type:'module'}));
 writeFileSync(join(dir,'IDEA.json'),JSON.stringify(idea,null,2));
 const brief=`You are replaying a fresh builder's FIRST backend authoring milestone for this app. Work only in ${dir}; do not inspect other lanes, repository checkouts, transcripts, or your model session logs. Read node_modules/snapback4/README.md first and follow the package's recommended reading path. Build a complete initial Quarry schema in snapback/*.q for this spec, with roles, private fields, required evidence, server-time guards and approval operations. Use the installed snapback4 CLI to check it and fix compilation. Stop at a compiling initial backend; do not install/build a frontend, run a security campaign, deploy, provision accounts or write a full application. After compilation, use the published package's guide/types to look up exact headless query/mutate/observe, password login and proof-host signatures needed for later acceptance; put a short usage example in SDK-NOTES.md. Use documentation on demand, and do not ask questions. Finish with the schema/check status and any design limits. This is a reading-to-schema replay, not an end-to-end app bakeoff.\n\n${idea.title}\n${idea.spec}\n`;
 writeFileSync(join(dir,'BRIEF.md'),brief);writeFileSync(join(evidence,`${phase}-${id}-brief.md`),brief);
 const node=process.execPath,bin=join(dir,'node_modules/.bin/snapback4');unlinkSync(bin);
 writeFileSync(join(dir,'cli-log.mjs'),`import{spawnSync}from'node:child_process';import{appendFileSync,existsSync,readdirSync}from'node:fs';const before=!existsSync('snapback')||!readdirSync('snapback').some(p=>p.endsWith('.q'));const t=Date.now();const r=spawnSync(${JSON.stringify(node)},['node_modules/snapback4/bin/snapback4.js',...process.argv.slice(2)],{encoding:'utf8',maxBuffer:16000000,env:process.env});if(process.argv[2]==='guide')appendFileSync('reads.jsonl',JSON.stringify({at:t,beforeSchema:before,args:process.argv.slice(2),output:r.stdout})+'\\n');process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');process.exit(r.status??1);`);
 writeFileSync(bin,`#!/bin/sh\nexec ${JSON.stringify(node)} ${JSON.stringify(join(dir,'cli-log.mjs'))} "$@"\n`,{mode:0o755});
 const out=await import('node:fs').then(f=>f.openSync(join(evidence,`${phase}-${id}.ndjson`),'w',0o600));
 const cmd=idea.model==='codex'?join(process.env.HOME,'.local/bin/codex'):join(process.env.HOME,'sb4-loop/muse-exec.sh');
 const args=idea.model==='codex'?['exec','--dangerously-bypass-approvals-and-sandbox','--skip-git-repo-check','--json','--color','never','-m','gpt-6.1-sol','-c','model_reasoning_effort=high','-C',dir,'-o',join(dir,'FINAL.md'),'-']:['--yolo','--json','--model','muse-spark-1.3-contributor','--reasoning-effort','high','--prompt-file',join(dir,'BRIEF.md')];
 const began=Date.now(), child=spawn(cmd,args,{cwd:dir,env:{...process.env,SNAPBACK4_INIT_INSTALL:'0'},stdio:['pipe',out,out]});
 if(idea.model==='codex')child.stdin.end(brief);else child.stdin.end();
 const code=await new Promise(res=>child.once('exit',res));
 const record={phase,id,model:idea.model,code,wallMinutes:(Date.now()-began)/60000,scope:'first checked application schema plus SDK discovery; no frontend/provisioning/end-to-end score'};
 writeFileSync(join(evidence,`${phase}-${id}-run.json`),JSON.stringify(record,null,2)+'\n');
 if(existsSync(join(dir,'reads.jsonl')))cpSync(join(dir,'reads.jsonl'),join(evidence,`${phase}-${id}-reads.jsonl`));
 if(existsSync(join(dir,'snapback')))cpSync(join(dir,'snapback'),join(evidence,`${phase}-${id}-schema`),{recursive:true,filter:p=>!p.includes('/generated')});
 console.log(JSON.stringify(record));
}

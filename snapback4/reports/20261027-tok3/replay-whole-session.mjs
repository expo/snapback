import {readFileSync,writeFileSync,mkdirSync,createWriteStream,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {builderEnvironment} from '/home/ccheever/sb4-loop/bakeoff/harn34.mjs';
const phase=process.argv[2], registry=process.argv[3]??'http://127.0.0.1:4873/';
const assignments=JSON.parse(readFileSync('/home/ccheever/sb4-loop/wave34/assignments.json'));
const selected=[1,39,19,18].map(n=>assignments.find(a=>a.n===n&&a.backend==='snapback')).filter(a=>!process.env.TOK3_REPLAY_ONLY||process.env.TOK3_REPLAY_ONLY.split(',').map(Number).includes(a.n));
async function run(a,i){
 i=[1,39,19,18].indexOf(a.n);
 const dir=`/tmp/tok3-replay/${phase}/${a.id}`,tmp=`/tmp/tok3-replay/t/${phase==='clean-before'?'cb':phase==='clean-after'?'ca':phase.slice(0,3)}-${a.n}`;mkdirSync(dir,{recursive:true});mkdirSync(tmp,{recursive:true});
 const old='/home/ccheever/sb4-loop/wave34/apps/'+a.id;
 let brief=readFileSync(old+'/BRIEF.md','utf8').replaceAll(old,dir);
 const lo=(phase==='before'?41010:phase==='clean-before'?44010:phase==='clean-after'?45010:phase==='final'?43010:42010)+i*10;
 brief=brief.replaceAll(String(a.portLo+9),String(lo+9)).replaceAll(String(a.portLo),String(lo));
 writeFileSync(dir+'/BRIEF.md',brief);
 const env=builderEnvironment({...process.env,PORT_LO:String(lo),PORT_HI:String(lo+9),TMPDIR:tmp,PATH:`/home/ccheever/sb4-loop/bakeoff/proc-shims:/home/ccheever/.bun-1.4.2/bin:${process.env.PATH}`,SB4_LANE:`tok3-${phase}-${a.n}`,SB4_LANE_DIRS:dir+':'+tmp,SB4_GUARD_LOG:'/tmp/tok3-evidence/guard.jsonl',CHROME:'/home/ccheever/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',CI:'1',EXPO_NO_TELEMETRY:'1',npm_config_registry:registry});
 delete env.FORCE_COLOR;delete env.NO_COLOR;
 for(const k of Object.keys(env))if(/^(CONVEX_|SUPABASE_|DATABASE_URL$|POSTGRES_URL$|HARNESS_BACKEND_)/.test(k))delete env[k];
 const args=a.model==='codex'?['exec','--dangerously-bypass-approvals-and-sandbox','--skip-git-repo-check','--json','--color','never','-m','gpt-6.1-sol','-c','model_reasoning_effort=high','-C',dir,'-o',dir+'/.agent-final.md','-']:['--yolo','--json','--model','muse-spark-1.3-contributor','--reasoning-effort','high','--prompt-file',dir+'/BRIEF.md'];
 const cmd=a.model==='codex'?'/home/ccheever/.local/bin/codex':'/home/ccheever/sb4-loop/muse-exec.sh';
 const start=Date.now(),child=spawn(cmd,args,{cwd:dir,env,stdio:['pipe','pipe','pipe']});
 const log=createWriteStream(`/tmp/tok3-evidence/${phase}-${a.n}.ndjson`);child.stdout.pipe(log);child.stderr.pipe(createWriteStream(`/tmp/tok3-evidence/${phase}-${a.n}.stderr`));
 if(a.model==='codex')child.stdin.end(brief);else child.stdin.end();
 writeFileSync(`/tmp/tok3-evidence/${phase}-${a.n}-launch.json`,JSON.stringify({a,dir,cmd,args,started:new Date(start).toISOString(),pid:child.pid,initialPackageInstalled:existsSync(dir+'/node_modules/snapback4')},null,2));
 const status=await new Promise(done=>child.on('close',done));
 writeFileSync(`/tmp/tok3-evidence/${phase}-${a.n}-result.json`,JSON.stringify({status,wallMs:Date.now()-start,report:existsSync(dir+'/REPORT.md')},null,2));
 console.log(phase,a.id,status,Math.round((Date.now()-start)/1000));
}
let next=0;await Promise.all(Array.from({length:Number(process.env.TOK3_REPLAY_CONCURRENCY??2)},(_,i)=>i).map(async()=>{while(next<selected.length){let i=next++;await run(selected[i],i);}}));

import {readFileSync,writeFileSync,mkdirSync,createWriteStream,existsSync,renameSync,copyFileSync,rmSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {builderEnvironment} from '/home/ccheever/sb4-loop/bakeoff/harn34.mjs';
import {rebaseCopy} from '/home/ccheever/sb4-loop/bakeoff/harn36.mjs';
const phase=process.argv[2],registry=process.argv[3]??'http://127.0.0.1:4873/';
const selected=[9,11,18,2,5],wave='/home/ccheever/sb4-loop/wave35';
const assignments=JSON.parse(readFileSync(wave+'/assignments.json')).filter(a=>a.backend==='snapback'&&selected.includes(a.n));
const excludes=['node_modules','./.agent.ndjson','./.agent-final.md','./.lane-status.json','./.lane-claim','./.tmp','./BRIEF.md','./.RESUME.md','./.FEEDBACK.md','./.checkpoint','./.harness','./.lane-idea.json','./probe','./dist','./.verify-dist','./logs/harness','./day2-proof.json','./deploy'];
async function run(a){
 const dir=`/tmp/dx17/${phase}/apps/${a.id}`,tmp=`/tmp/dx17/t/${phase}-${a.n}`;
 mkdirSync(dir,{recursive:true});mkdirSync(tmp,{recursive:true});
 const lo=(phase==='before'?51000:52000)+a.n*10;
 execFileSync('bash',['-c','tar "$@" -cf - . | tar -xf - -C "$DX17_DEST"','copy',...excludes.map(e=>'--exclude='+e)],{cwd:a.sourceLane,env:{...process.env,DX17_DEST:dir},timeout:600_000});
 const restored=[];
 const status=JSON.parse(readFileSync(a.sourceLane+'/.lane-status.json'));
 for(const rel of status.probe?.tampered??[]){
  const p=join('/home/ccheever/sb4-loop/wave34/probe-sources',a.id,rel);
  if(existsSync(p)&&!rel.startsWith('..')){copyFileSync(p,join(dir,rel));restored.push(rel);}
 }
 for(const f of ['DIARY.md','REPORT.md','friction.jsonl']){
  const frozen=join(a.sourceLane,'.harness/notes',f),current=join(dir,f);
  if(existsSync(frozen))copyFileSync(frozen,join(dir,'PREVIOUS-'+f));else if(existsSync(current))copyFileSync(current,join(dir,'PREVIOUS-'+f));
  rmSync(current,{force:true});
 }
 const rebased=rebaseCopy(dir,{from:a.sourceLane,to:dir,oldPort:a.portLo,newPort:lo});
 writeFileSync(dir+'/.day2-from.json',JSON.stringify({from:a.sourceLane,wave:'34',restored,rebased,sourcePortLo:a.portLo,portLo:lo}));
 let brief=readFileSync(join(wave,'apps',a.id,'BRIEF.md'),'utf8').replaceAll(join(wave,'apps',a.id),dir).replaceAll('snapback4@0.4.46','snapback4@0.4.48').replaceAll(String(a.portLo+9),String(lo+9)).replaceAll(String(a.portLo),String(lo));
 writeFileSync(dir+'/BRIEF.md',brief);
 const env=builderEnvironment({...process.env,PORT_LO:String(lo),PORT_HI:String(lo+9),TMPDIR:tmp,PATH:`/home/ccheever/sb4-loop/bakeoff/proc-shims:/home/ccheever/.bun-1.4.2/bin:${process.env.PATH}`,SB4_LANE:`dx17-${phase}-${a.n}`,SB4_LANE_DIRS:dir+':'+tmp,SB4_GUARD_LOG:'/tmp/dx17/evidence/guard.jsonl',CHROME:'/home/ccheever/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',CI:'1',EXPO_NO_TELEMETRY:'1',npm_config_registry:registry});
 for(const k of Object.keys(env))if(/^(CONVEX_|SUPABASE_|DATABASE_URL$|POSTGRES_URL$|HARNESS_BACKEND_)/.test(k))delete env[k];
 delete env.SNAPBACK4_BIN;delete env.FORCE_COLOR;delete env.NO_COLOR;
 const args=a.model==='codex'?['exec','--dangerously-bypass-approvals-and-sandbox','--skip-git-repo-check','--json','--color','never','-m','gpt-6.1-sol','-c','model_reasoning_effort=high','-C',dir,'-o',dir+'/.agent-final.md','-']:['--yolo','--json','--model','muse-spark-1.3-contributor','--reasoning-effort','high','--prompt-file',dir+'/BRIEF.md'];
 const cmd=a.model==='codex'?'/home/ccheever/.local/bin/codex':'/home/ccheever/sb4-loop/muse-exec.sh';
 const started=Date.now(),child=spawn(cmd,args,{cwd:dir,env,stdio:['pipe','pipe','pipe']});
 child.stdout.pipe(createWriteStream(`/tmp/dx17/evidence/${phase}-${a.n}.ndjson`));child.stderr.pipe(createWriteStream(`/tmp/dx17/evidence/${phase}-${a.n}.stderr`));
 if(a.model==='codex')child.stdin.end(brief);else child.stdin.end();
 writeFileSync(`/tmp/dx17/evidence/${phase}-${a.n}-launch.json`,JSON.stringify({a,dir,cmd,args,started:new Date(started).toISOString(),pid:child.pid,registry},null,2));
 const code=await new Promise(done=>child.on('close',done));
 writeFileSync(`/tmp/dx17/evidence/${phase}-${a.n}-result.json`,JSON.stringify({code,wallMs:Date.now()-started,report:existsSync(dir+'/REPORT.md')},null,2));
 console.log(phase,a.id,code,Math.round((Date.now()-started)/1000));
}
let next=0;await Promise.all(Array.from({length:2},async()=>{while(next<assignments.length)await run(assignments[next++]);}));

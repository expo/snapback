// Whole native sessions: the harness's exact rendered brief, CLI flags and builder environment.
import http from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,createWriteStream,existsSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const home=process.env.HOME, bake=join(home,'sb4-loop/bakeoff');
const {builderEnvironment}=await import(join(bake,'harn34.mjs'));
const phase=process.argv[2], root=resolve(import.meta.dirname,'../..'), evidence=join(root,'target/tok6/evidence');
if(!['before','after'].includes(phase))throw Error('before|after');
mkdirSync(evidence,{recursive:true});
const label=process.env.TOK6_RUN_LABEL??phase;
if(!/^[a-z0-9-]+$/.test(label))throw Error('unsafe run label');
const selected=(process.env.TOK6_ONLY??'1,2,5,39,18,19').split(',').map(Number),all=JSON.parse(readFileSync(join(home,'sb4-loop/wave34/assignments.json')));
const packages=new Map();
for(const name of ['snapback4','snapback4-linux-x64','snapback4-expo']){
 const filename=`${name}-0.4.49.tgz`,bytes=readFileSync(join(root,'target/tok6',phase,filename));
 const manifest=JSON.parse(execFileSync('tar',['-xOf',join(root,'target/tok6',phase,filename),'package/package.json'],{encoding:'utf8'}));
 packages.set(name,{filename,bytes,manifest});
}
const registry=http.createServer(async(req,res)=>{try{
 const path=decodeURIComponent(req.url.split('?')[0]).slice(1),name=path.split('/-/')[0],p=packages.get(name);
 if(p&&path.includes('/-/')){res.end(p.bytes);return;}
 if(p){const manifest={...p.manifest,dist:{tarball:`http://127.0.0.1:${registry.address().port}/${name}/-/${p.filename}`,integrity:'sha512-'+createHash('sha512').update(p.bytes).digest('base64'),shasum:createHash('sha1').update(p.bytes).digest('hex')}};res.setHeader('content-type','application/json');res.end(JSON.stringify({name,'dist-tags':{latest:'0.4.49'},versions:{'0.4.49':manifest}}));return;}
 const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
 const response=await fetch('http://127.0.0.1:4873'+req.url,{method:req.method,headers:{accept:req.headers.accept??'*/*',...(req.headers['content-type']?{'content-type':req.headers['content-type']}:{})},...(body.length?{body}:{})});
 res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/octet-stream'});res.end(Buffer.from(await response.arrayBuffer()));
}catch(error){res.writeHead(500);res.end(error.message);}});
await new Promise(r=>registry.listen(0,'127.0.0.1',r));
const registryUrl=`http://127.0.0.1:${registry.address().port}/`;
const harness=readFileSync(join(bake,'run-bakeoff.mjs'),'utf8');
const frontendText=harness.split('const FRONTENDS = ')[1].split('\nconst template = ')[0].trim().replace(/;$/,'');
const FRONTENDS=Function(`return (${frontendText})`)();
const template=readFileSync(join(bake,'brief-bakeoff.md'),'utf8'),backend=readFileSync(join(bake,'backends/snapback.md'),'utf8');
writeFileSync(join(evidence,`${label}-method.json`),JSON.stringify({phase,label,selected,harnessSha256:createHash('sha256').update(harness).digest('hex'),templateSha256:createHash('sha256').update(template).digest('hex'),backendSha256:createHash('sha256').update(backend).digest('hex'),registryUrl},null,2));
async function run(n){
 const a=all.find(a=>a.n===n&&a.backend==='snapback'),i=selected.indexOf(n);
 const dir=`/tmp/tok6/${label}/${a.id}`,tmp=`/tmp/tk6${label.replace('before','b').replace('after','a')}${n}`;
 if(existsSync(dir))throw Error('refuse nonempty replay root '+dir);
 mkdirSync(dir,{recursive:true});mkdirSync(tmp,{recursive:true});
 const lo=(phase==='before'?46010:47010)+i*10,fe=FRONTENDS[a.frontend];
 const section=backend.replaceAll('{VERSION}','0.4.49').replaceAll('{EXPO_ADAPTER}',a.frontend==='expo'?' (for the Expo frontend, also `snapback4-expo@0.4.49`, with `--save-exact`)':'');
 const brief=template.replaceAll('{BACKEND_SECTION}',section).replaceAll('{BACKEND_NAME}','Snapback 4').replaceAll('{TITLE}',a.title).replaceAll('{SPEC}',a.spec).replaceAll('{LANE}',dir).replaceAll('{FRONTEND}',fe.name).replaceAll('{FRONTEND_NOTES}',fe.notes).replaceAll('{FRONTEND_PROOF}',fe.proof).replaceAll('{PORT_LO}',String(lo)).replaceAll('{PORT_HI}',String(lo+9));
 writeFileSync(join(dir,'BRIEF.md'),brief);
 let env=builderEnvironment({...process.env,PORT_LO:String(lo),PORT_HI:String(lo+9),TMPDIR:tmp,PATH:`${bake}/proc-shims:${home}/.bun-1.4.2/bin:${process.env.PATH}`,SB4_LANE:`tok6-${label}-${n}`,SB4_LANE_DIRS:dir+':'+tmp,SB4_GUARD_LOG:join(evidence,'guard.jsonl'),CHROME:join(home,'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),CI:'1',EXPO_NO_TELEMETRY:'1',npm_config_registry:registryUrl});
 delete env.FORCE_COLOR;delete env.NO_COLOR;
 for(const k of Object.keys(env))if(/^(CONVEX_|SUPABASE_|PROD_DATABASE_URL$|PROD_POSTGRES_URL$|DATABASE_URL$|POSTGRES_URL$|HARNESS_BACKEND_)/.test(k))delete env[k];
 const args=a.model==='codex'?['exec','--dangerously-bypass-approvals-and-sandbox','--skip-git-repo-check','--json','--color','never','-m','gpt-6.1-sol','-c','model_reasoning_effort=high','-C',dir,'-o',join(dir,'.agent-final.md'),'-']:['--yolo','--json','--model','muse-spark-1.3-contributor','--reasoning-effort','high','--prompt-file',join(dir,'BRIEF.md')];
 const cmd=a.model==='codex'?join(home,'.local/bin/codex'):join(home,'sb4-loop/muse-exec.sh');
 const start=Date.now(),child=spawn('systemd-run',['--user','--scope','-q','-p','MemoryMax=40G','-p','OOMPolicy=continue',cmd,...args],{cwd:dir,env,stdio:['pipe','pipe','pipe']});
 child.stdout.pipe(createWriteStream(join(evidence,`${label}-${n}.ndjson`)));child.stderr.pipe(createWriteStream(join(evidence,`${label}-${n}.stderr`)));
 if(a.model==='codex')child.stdin.end(brief);else child.stdin.end();
 writeFileSync(join(evidence,`${label}-${n}-launch.json`),JSON.stringify({a,dir,cmd,args,started:new Date(start).toISOString(),initialPackageInstalled:existsSync(join(dir,'node_modules/snapback4'))},null,2));
 console.log('started',label,n,a.model);
 const status=await new Promise(done=>child.on('close',done));
 writeFileSync(join(evidence,`${label}-${n}-result.json`),JSON.stringify({status,wallMs:Date.now()-start,report:existsSync(join(dir,'REPORT.md'))},null,2));
 console.log('completed',label,n,status,Math.round((Date.now()-start)/1000));
}
let next=0;try{await Promise.all(Array.from({length:Number(process.env.TOK6_CONCURRENCY??3)},async()=>{while(next<selected.length)await run(selected[next++]);}));}finally{registry.close();}

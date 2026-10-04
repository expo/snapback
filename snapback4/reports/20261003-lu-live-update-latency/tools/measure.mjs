// Run with taskset on at most 16 CPUs. No installed package/private interpreter shortcuts.
import assert from 'node:assert/strict';
import {stages} from './stages.mjs';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,appendFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir,availableParallelism,loadavg} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {chromiumExecutable} from '../../../witness/lib.mjs';
const root=resolve(import.meta.dirname,'../../..');
const suite=process.env.LU_SUITE==='1';
const monotonicOffset=performance.timeOrigin+performance.now()-Number(process.hrtime.bigint())/1e6;
assert.equal(process.platform,'linux','the qualification load is Linux affinity scoped');
const affinity=readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(.*)$/m)[1];
assert.equal(process.env.LU_AFFINITY_LOCKED,String(process.pid),'launch through tools/confine.py to freeze descendant affinity');
assert.match(readFileSync('/proc/self/status','utf8'),/^NoNewPrivs:\s*1$/m);
assert.match(readFileSync('/proc/self/status','utf8'),/^Seccomp:\s*2$/m);
const allowed=new Set(affinity.split(',').flatMap(range=>{const [a,b=a]=range.split('-').map(Number);return Array.from({length:b-a+1},(_,i)=>a+i);}));
assert.ok(availableParallelism()<=16&&allowed.size<=16,`refusing ${availableParallelism()} CPUs; use taskset`);
const history=Number(process.env.LU_HISTORY??0),refollow=process.env.LU_REFOLLOW==='1';
const runs=Number(process.env.LU_RUNS??30),levels=(process.env.LU_LEVELS??'0,20,120').split(',').map(Number);
const out=resolve(process.env.LU_OUT??join(root,'target/lu-measure.json'));
const binary=resolve(process.env.SNAPBACK4_BIN??join(root,'target/lu-before'));
const dir=mkdtempSync(join(tmpdir(),'sb4-lu-'));mkdirSync(join(dir,'snapback'));
copyFileSync(join(import.meta.dirname,'schema.q'),join(dir,'snapback/schema.q'));
copyFileSync(join(import.meta.dirname,'page.jsx'),join(dir,'page.jsx'));
writeFileSync(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/page.jsx"></script>');
const trace=join(dir,'trace.jsonl');
const host=spawn(binary,['dev','--port','0','--no-watch'],{cwd:dir,env:{...process.env,...(suite?{SNAPBACK4_READ_TRACE:trace}:{})},stdio:['ignore','pipe','pipe']});
const hostClosed=new Promise(resolve=>host.once('close',resolve));
let stdout='',stderr='',buffer='',browser,vite,burners,stopBurners,sampler;
const server=[],samples=[],loads=[],errors=[],requests=[],active=new Set();let requestId=0;
writeFileSync(out+'.jsonl','');
host.stdout.on('data',x=>stdout+=x);host.stderr.on('data',x=>{
  buffer+=x;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.startsWith('LU '))server.push(JSON.parse(line.slice(3)));else stderr+=line+'\n';}
});
let stopping=false;
const stop=()=>{stopping=true;burners?.stdin.end();void browser?.close();};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
async function until(fn,label,timeout=120000){const end=performance.now()+timeout;while(performance.now()<end){if(stopping)throw Error('measurement interrupted');const v=await fn();if(v)return v;await delay(10);}throw Error(`timeout: ${label}\n${stderr.slice(-2000)}\n${errors.join('\n')}`);}
function cpu(){return readFileSync('/proc/stat','utf8').split('\n').filter(s=>/^cpu\d+ /.test(s)&&allowed.has(Number(s.match(/^cpu(\d+)/)[1]))).map(s=>s.trim().split(/\s+/).map((x,i)=>i?Number(x):x));}
const save=()=>writeFileSync(out,JSON.stringify({metadata:{runs,levels,history,refollow,affinity,cpus:availableParallelism(),binary,browser:browser?.version(),clock:'Unix milliseconds, same host',label:process.env.LU_LABEL??'baseline'},samples,server,loads,errors,requests},null,2));
try{
 const url=await until(()=>{assert.equal(host.exitCode,null,stderr);return stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];},'server');
 const post=async(path,body,persona='alice')=>fetch(url+path,{method:'POST',headers:{'x-snapback-persona':persona},body:JSON.stringify(body)}).then(r=>r.json());
 const n=runs*levels.length+4;
 const seed=[{table:'rooms',row:{id:'room',title:'Room'}},...['alice','bob','carol'].map(name=>({table:'members',row:{id:name,room:'room',principal:'dev:'+name}})),
  {table:'messages',row:{id:'anchor',room:'room',sender:'dev:alice',ordinal:0,text:'anchor'}}];
 const seeded=await post('/seed',seed);assert.equal(seeded.seeded,seed.length,JSON.stringify(seeded));
 for(let i=0;i<n;i++){const r=await post('/m/post',{id:crypto.randomUUID(),args:{postId:'post'+i}},'carol');assert.equal(r.state,'sent',JSON.stringify(r));}
 for(let i=0;i<history;i++){const r=await post('/m/post',{id:crypto.randomUUID(),args:{postId:'old'+i}});assert.equal(r.state,'sent',JSON.stringify(r));}
 for(const persona of ['bob','carol']){const r=await post('/m/follow',{id:crypto.randomUUID(),args:{actor:'dev:alice'}},persona);assert.equal(r.state,'sent',JSON.stringify(r));}
 const warmed=await post('/dev/clock/advance',{duration:'+1ms'});assert.ok(!warmed.denied,JSON.stringify(warmed));
 console.log('seed ready',history);
 const require=createRequire(join(root,'package.json')),pkg=createRequire(join(root,'packages/snapback4/package.json'));
 const {chromium}=require('playwright-core');
 const {createServer}=await import(createRequire(join(root,'apps/chat/package.json')).resolve('vite'));
 vite=await createServer({root:dir,configFile:false,logLevel:'error',server:{hmr:false,host:'127.0.0.1',port:0,fs:{allow:[root,dir]}},resolve:{alias:[
  ...['react','react/jsx-runtime','react/jsx-dev-runtime','react-dom','react-dom/client'].map(name=>({find:new RegExp('^'+name+'$'),replacement:pkg.resolve(name)})),
  ...['local','web','react','inspection','wasm/snapback4_device'].map(name=>({find:'snapback4/'+name,replacement:join(root,process.env.LU_SDK??'packages/snapback4/dist',name+'.js')}))
 ]},plugins:suite?[{name:'lu-trace',configureServer(server){server.middlewares.use((req,res,next)=>{
   if(!req.url.startsWith('/backend/'))return next();
   const id=++requestId,path=req.url.slice('/backend'.length);requests.push({id,path,at:Date.now()});
   const up=httpRequest(url+path,{method:req.method,headers:{...req.headers,host:new URL(url).host,'x-snapback-ct':String(id)}},response=>{
    res.writeHead(response.statusCode,{...response.headers,'x-lu-request':String(id)});response.pipe(res);
    response.on('end',()=>active.delete(up));
   });active.add(up);up.on('error',e=>{active.delete(up);res.destroy(e);});res.on('close',()=>{up.destroy();active.delete(up);});req.pipe(up);
  });}}]:[]});await vite.listen();
 browser=await chromium.launch({executablePath:chromiumExecutable(),headless:true,args:['--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const pages=[];for(const persona of ['alice','bob','carol']){
  const context=await browser.newContext(),page=await context.newPage();pages.push(page);
  page.setDefaultTimeout(120000);page.on('pageerror',e=>errors.push(e.stack));
  await page.goto(vite.resolvedUrls.local[0]);await page.waitForFunction(()=>window.openClient);
  await page.evaluate(o=>window.openClient(o),{url:suite?vite.resolvedUrls.local[0]+'backend':url,persona});await page.waitForFunction(()=>window.ready);
 }
 const [sender,...receivers]=pages;let serial=0;
 for(const count of levels){
  if(count){
   burners=spawn('python3',[join(import.meta.dirname,'load.py'),String(count)],{detached:true,stdio:['pipe','pipe','inherit']});
   const done=new Promise(resolve=>burners.once('close',resolve));let ready='';burners.stdout.on('data',x=>ready+=x);
   stopBurners=async()=>{burners.stdin.end();await done;burners=undefined;};
   await until(()=>{assert.equal(burners.exitCode,null);return ready.includes('ready');},'burners');
  }
  await delay(count?2000:200);
  sampler=setInterval(()=>loads.push({at:Date.now(),burners:count,load:loadavg(),cpu:cpu()}),1000);
  loads.push({at:Date.now(),burners:count,load:loadavg(),cpu:cpu()});
  for(let i=0;i<runs;i++,serial++)for(const shape of ['repost','message','reaction']){
   const value=shape==='repost'?'post'+serial:shape+'-'+serial;
   const expected={query:shape==='repost'?'home':shape==='message'?'history':'reactionRows',value};
   for(const page of pages)await page.evaluate(e=>window.prepare(e),expected);
   const start=server.length;
   if(refollow)for(const name of ['unfollow','follow']){const r=await post('/m/'+name,{id:crypto.randomUUID(),args:{actor:'dev:alice'}},'bob');assert.equal(r.state,'sent',JSON.stringify(r));}
   const request=shape==='repost'?{name:'repost',args:{postId:value}}:shape==='message'?{name:'send',args:{id:value,ordinal:serial+1}}:{name:'react',args:{emoji:value}};
   const write=await sender.evaluate(o=>window.perform(o),request);
   const views=[];for(const page of receivers){await until(()=>page.evaluate(()=>window.result().trial.render),'render '+shape+' '+i);views.push(await page.evaluate(()=>window.result()));}
   // No explicit sync or app polling. Only wait for instrumentation to drain its pipe.
   let commit;
   if(suite){
    const receipt=(await sender.evaluate(()=>window.result())).events.find(e=>e.stage==='response'&&e.path==='/m/'+request.name);
    assert.ok(receipt?.request,'the browser mutation has a server trace id');
    const stamp=await until(()=>readFileSync(trace,'utf8').split('\n').slice(0,-1).filter(Boolean).map(x=>JSON.parse(x)).find(x=>String(x.id)===receipt.request),'server trace');
    assert.ok(stamp.started<stamp.mutation_commit&&stamp.mutation_commit<stamp.encode_start);
    commit={stage:'commit',name:request.name,seq:write.seq,at:stamp.mutation_commit/1e6+monotonicOffset};
   }else{
    await until(()=>server.slice(start).some(e=>e.stage==='commit'&&e.name===request.name),'commit trace');
    commit=server.slice(start).find(e=>e.stage==='commit'&&e.name===request.name);
   }
   if(!suite&&shape==='repost')await until(()=>server.slice(start).some(e=>e.stage==='delivery'&&e.kind==='delivery'&&e.done&&e.at>=commit.at),'delivery trace');
   const sample={burners:count,run:i,serial,shape,value,commit,write,views,sender:await sender.evaluate(()=>window.result()),server:server.slice(start)};
   appendFileSync(out+'.jsonl',JSON.stringify(sample)+'\n');
   samples.push({...sample,sender:undefined,server:sample.server.filter(e=>e.stage!=='delivery'||e.done),views:views.map(v=>({trial:v.trial,inspection:v.inspection,stages:stages(sample,v)}))});
   server.length=0;
   console.log(JSON.stringify({burners:count,run:i,shape,ms:views.map(v=>+(v.trial.render-commit.at).toFixed(2))}));save();
  }
  clearInterval(sampler);sampler=undefined;await stopBurners?.();stopBurners=undefined;
 }
 assert.deepEqual(errors,[]);save();
}finally{
 clearInterval(sampler);
 try { await stopBurners?.(); save(); }
 finally { try { await browser?.close(); for(const req of active)req.destroy(); await vite?.close(); }
 finally { if(host.exitCode===null){host.kill('SIGTERM');await hostClosed;}rmSync(dir,{recursive:true,force:true}); } }
}

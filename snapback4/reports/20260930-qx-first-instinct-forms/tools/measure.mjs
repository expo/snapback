// Adapted from reports/20260929-ll-live-latency/tools/measure.mjs: same real
// Chromium React observer and processDevice bridge; measures the writer's screen.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir,cpus,loadavg} from 'node:os';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createLocalClient} from '../../../packages/snapback4/dist/local.js';
import {signup} from '../../../packages/snapback4/dist/auth.js';
import {processDevice} from '../../../packages/snapback4/dist/native.js';
import {chromiumExecutable} from '../../../witness/lib.mjs';
const root=resolve(import.meta.dirname,'../../..'), tier=process.env.QX_TIER??'wasm', runs=Number(process.env.QX_RUNS??20);
const binary=resolve(process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4'));
const out=resolve(process.env.QX_OUT), dir=mkdtempSync(join(tmpdir(),'sb4-qx-'));
mkdirSync(join(dir,'snapback'));copyFileSync(join(import.meta.dirname,'fixture.q'),join(dir,'snapback/schema.q'));copyFileSync(join(import.meta.dirname,'page.jsx'),join(dir,'page.jsx'));
writeFileSync(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/page.jsx"></script>');
const host=spawn(binary,['dev','--port','0','--no-watch'],{cwd:dir,stdio:['ignore','pipe','pipe']});
let output='',errors='',browser,vite,core,nodeClient;host.stdout.on('data',x=>output+=x);host.stderr.on('data',x=>errors+=x);
async function until(fn,label){const end=performance.now()+20000;while(performance.now()<end){if(await fn())return;await delay(10);}throw Error(label+'\n'+errors.slice(-2000));}
const samples=[];
try{
 await until(()=>output.match(/http:\/\/127\.0\.0\.1:\d+/),'server');const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
 const result=await signup(url,'alice@example.test','long-test-password');assert.ok(result.ok,JSON.stringify(result));const session=result.session;
 const rows=[{table:'conversations',row:{id:'room',title:'Room',creatorId:session.principal,lastOrdinal:1}},{table:'members',row:{id:'member',conversation:'room',principal:session.principal,joinedOrdinal:0}},{table:'messages',row:{id:'anchor',conversation:'room',sender:session.principal,ordinal:1,recipients:0,text:'Hello',at:1}}];
 const seeded=await fetch(url+'/seed',{method:'POST',body:JSON.stringify(rows)}).then(r=>r.json());assert.equal(seeded.seeded,rows.length,JSON.stringify(seeded));
 const require=createRequire(join(root,'package.json')),pkg=createRequire(join(root,'packages/snapback4/package.json'));
 const {chromium}=require('playwright-core');const {createServer}=await import(pathToFileURL(createRequire(join(root,'apps/chat/package.json')).resolve('vite')));
 vite=await createServer({root:dir,configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:[root,dir]}},resolve:{alias:[...['react','react/jsx-runtime','react/jsx-dev-runtime','react-dom','react-dom/client'].map(name=>({find:new RegExp('^'+name+'$'),replacement:pkg.resolve(name)})),...['local','web','react'].map(name=>({find:'snapback4/'+name,replacement:join(root,'packages/snapback4/dist/'+name+'.js')}))]}});await vite.listen();
 browser=await chromium.launch({executablePath:chromiumExecutable(),headless:true,args:['--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']});const page=await browser.newPage();page.on('pageerror',e=>errors+='\n'+e.stack);
 if(tier==='process')await page.exposeBinding('processBridge',async(_,{method,url,session,op,args})=>{
  if(method==='open'){
   nodeClient=await createLocalClient({url,session,device:processDevice({binary,dir:join(dir,'device')})});await nodeClient.sync();
   const watch=nodeClient.observe({kind:'query',name:'reactionRows'},{message:'anchor'});
   watch.subscribe(()=>{void page.evaluate(read=>window.processRead(read),watch.getSnapshot()).catch(e=>errors+='\n'+e.stack);});
   await page.evaluate(read=>window.processRead(read),watch.getSnapshot());return;
  }
  if(method==='mutate')return nodeClient.mutate(op,args);
  if(method==='sync')return nodeClient.sync();
 });
 await page.goto(vite.resolvedUrls.local[0]);await page.waitForFunction(()=>window.openClient);await page.evaluate(options=>window.openClient(options),{url,session,tier});
 for(let run=0;run<runs;run++){
  for(const flow of ['insert','update']){
   const value=flow+'-'+run;const write=await page.evaluate(value=>window.perform({value}),value);assert.equal(write.state,'sent',JSON.stringify(write));
   await until(()=>page.evaluate(()=>!!window.trial().render),'render');const trial=await page.evaluate(()=>window.trial());
   samples.push({run,flow,...trial});console.log(JSON.stringify({tier,run,flow,visible:trial.render-trial.call,published:trial.published-trial.call}));
  }
  assert.equal((await page.evaluate(()=>window.clear())).state,'sent');
 }
 writeFileSync(out,JSON.stringify({metadata:{tier,runs,binary,node:process.version,browser:browser.version(),cpu:cpus()[0].model,load:loadavg(),clock:'Chromium performance.now milliseconds',fixture:'social starter plus read-through reactions',measurement:'writer call to observer publication and React layout effect'},samples,errors},null,2));
}finally{await nodeClient?.close();await browser?.close();await core?.close();await vite?.close();if(host.exitCode===null){const exited=new Promise(r=>host.once('exit',r));host.kill();await exited;}rmSync(dir,{recursive:true,force:true});}

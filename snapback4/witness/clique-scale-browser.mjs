// Real builder web export, fresh Chromium store per account/device condition.
// node witness/clique-scale-browser.mjs EXPORT_DIR OUTPUT [u0001|u0500] [worker|default]
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {chromium} from 'playwright-core';
import {chromiumExecutable} from './lib.mjs';
const [dir,output,account='u0001',mode='default']=process.argv.slice(2);
assert.ok(dir&&output);
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 try {let file;try{file=readFileSync(join(resolve(dir),path==='/' ? 'index.html':path));}catch{if(extname(path))throw Error('missing asset');file=readFileSync(join(resolve(dir),'index.html'));}
 res.setHeader('Content-Type',({'.js':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(path)]??'text/html');res.end(file);
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:chromiumExecutable(),headless:true,args:['--enable-precise-memory-info']});
const result={account,mode,chromium:browser.version(),responses:[],errors:[]};
const pending=[];
try{
 const context=await browser.newContext();const page=await context.newPage();
 await page.addInitScript(()=>{
  window.__tasks=[];window.__workers=[];
  new PerformanceObserver(list=>window.__tasks.push(...list.getEntries().map(x=>({at:x.startTime,ms:x.duration})))).observe({type:'longtask',buffered:true});
  const Original=Worker;window.Worker=class extends Original{constructor(...args){super(...args);window.__workers.push(this);}};
 });
 page.on('pageerror',e=>result.errors.push(e.message));
 page.on('response',r=>{if(!r.url().includes('/sync'))return;pending.push((async()=>{
  const text=await r.text();let body;try{body=JSON.parse(text);}catch{return;}
  const tables=Object.create(null);for(const event of body.events??[]){const t=event.table??event.t??'unknown';const entry=tables[t]??={rows:0,bytes:0};entry.rows++;entry.bytes+=Buffer.byteLength(JSON.stringify(event));}
  result.responses.push({status:r.status(),serverTiming:r.headers()['server-timing'],bytes:Buffer.byteLength(text),rows:body.events?.length??0,tables,snapshot:body.snapshot,more:body.more,at:Date.now(),request:JSON.parse(r.request().postData()??'{}').limit});
 })().catch(e=>result.errors.push(String(e))));});
 const navigationStart=performance.now();
 await page.goto(`http://127.0.0.1:${server.address().port}/?worker=${mode==='worker'?1:0}`);
 await page.getByTestId('sm-auth-email').fill(`${account}@example.com`);
 await page.getByTestId('sm-auth-password').fill('CliqueScale!20260808');
 const cdp=process.env.SS_PROFILE?await context.newCDPSession(page):null;
 if(cdp){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
 result.started=await page.evaluate(()=>performance.now());
 await page.getByTestId('sm-auth-submit').click();
 try{await page.getByTestId('offline-access-status').filter({hasText:'Offline access ready'}).waitFor({timeout:240000});result.ready=true;}
 catch(e){result.ready=false;result.failure=String(e);result.screen=await page.locator('body').innerText();}
 result.ended=await page.evaluate(()=>performance.now());result.readyMs=result.ended-result.started;
 result.navigationToReadyMs=performance.now()-navigationStart;
 if(cdp){const {profile}=await cdp.send('Profiler.stop');writeFileSync(`${output}.cpuprofile`,JSON.stringify(profile));}
 result.diagnostic=await page.evaluate(async()=>{
  let worker;
  if(window.__workers.length){worker=await new Promise(resolve=>{const w=window.__workers.at(-1);const listener=e=>{if(e.data.ssProfile){w.removeEventListener('message',listener);resolve(e.data.ssProfile);}};w.addEventListener('message',listener);w.postMessage({ssProfile:true});setTimeout(()=>resolve({timeout:true}),5000);});}
  return {page:window.__ss,worker,longTasks:window.__tasks,heap:performance.memory.usedJSHeapSize};
 });
 await Promise.all(pending);
 result.longestTask=Math.max(0,...result.diagnostic.longTasks.filter(x=>x.at<result.ended&&x.at+x.ms>result.started).map(x=>x.ms));
 writeFileSync(output,JSON.stringify(result,null,2));
 console.log(JSON.stringify({output,ready:result.ready,readyMs:result.readyMs,longestTask:result.longestTask,responses:result.responses.length,rows:result.responses.reduce((n,p)=>n+p.rows,0),errors:result.errors}));
 if(!result.ready || result.errors.length) process.exitCode=1;
 if(mode==='worker') assert.ok(result.diagnostic.worker?.wasm?.some(call=>call.op==='apply'), 'Worker measurement must actually run the device in its Worker');
}finally{await browser.close();await new Promise(r=>server.close(r));}

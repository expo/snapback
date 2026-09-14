import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {extname, resolve} from 'node:path';
import {chromium} from '/Users/ccheever/clique-sb4-20260913-relaxed-3models/lanes/muse-snapback4/choreography/node_modules/playwright/index.mjs';

const root='/Users/ccheever/projects/snapback-lanebriefs/navigation-durability-probe-20260914/immediate-close';
const packageRoot='/Users/ccheever/projects/snapback-ceremony-third/runs/run-1/node_modules/snapback4';
const binary='/Users/ccheever/projects/snapback-ceremony-third/runs/run-1/node_modules/snapback4-darwin-arm64/snapback4';
const source=`use personas alice
table notes:
  text: text <=100
  principal: principal
  by byPrincipal: principal, id
  read <- .principal = viewer
  insert <- .principal = viewer
  sync to .principal
query mine():
  return notes[viewer] first 20 by byPrincipal
mutation add(text: text <=100):
  insert notes { text, principal: viewer }
`;
mkdirSync(root+'/snapback',{recursive:true});
writeFileSync(root+'/snapback/schema.q',source);
const check=spawnSync(binary,['check','--residency'],{cwd:root,encoding:'utf8'});
writeFileSync(root+'/check.txt',check.stdout+check.stderr);
assert.equal(check.status,0,check.stdout+check.stderr);
const server=spawn(binary,['dev','--port','0','--fresh','--no-watch'],{cwd:root,stdio:['ignore','pipe','pipe']});
const ended=once(server,'exit');let log='',backend,browser,context;
server.stdout.on('data',b=>{log+=b;backend??=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});
server.stderr.on('data',b=>{log+=b;});
const web=createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Published admission durability control</title>');return;}
  if(!pathname.startsWith('/sdk/')){res.writeHead(404);res.end();return;}
  const path=resolve(packageRoot+'/dist',pathname.slice(5));
  if(!path.startsWith(packageRoot+'/dist/')){res.writeHead(403);res.end();return;}
  try{res.setHeader('content-type',extname(path)==='.wasm'?'application/wasm':'text/javascript');res.end(readFileSync(path));}
  catch{res.writeHead(404);res.end();}
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,message){const stop=Date.now()+60000;do{if(await fn())return;await sleep(30);}while(Date.now()<stop);throw Error(message);}
async function authoritative(){const r=await fetch(backend+'/q/mine',{method:'POST',headers:{'x-snapback-persona':'alice','content-type':'application/json'},body:'{"args":{}}'});assert.equal(r.status,200);return r.json();}
try{
  await until(()=>{assert.equal(server.exitCode,null,log);return backend;},'server did not listen');
  await new Promise(r=>web.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+web.address().port;
  browser=await chromium.launch({headless:true});context=await browser.newContext();
  let page=await context.newPage();await page.goto(origin);
  const admitted=await page.evaluate(async url=>{
    const {createLocalClient}=await import('/sdk/local.js');const {webDevice}=await import('/sdk/web.js');
    const opener=webDevice();window.offline=false;window.core=null;window.storeName=null;
    window.client=await createLocalClient({url,persona:'alice',waitSeconds:1,fetch:(...args)=>window.offline?Promise.reject(new TypeError('controlled backend offline')):fetch(...args),device:{open:async(...args)=>{window.storeName=args[0];window.core=await opener.open(...args);return window.core;}}});
    await window.client.sync();window.offline=true;
    const mutation=await window.client.mutate({kind:'mutation',name:'add'},{text:'awaited-before-page-close'});
    return {mutation,storeName:window.storeName};
  },backend);
  assert.equal(admitted.mutation.state,'pending');
  await page.close(); // Deliberately no client.close(): the browsing document disappears.
  const before=await authoritative();assert.equal(before.data.length,0);
  page=await context.newPage();await page.goto(origin);
  const reopened=await page.evaluate(async name=>{
    const {webDevice}=await import('/sdk/web.js');const core=await webDevice().open(name,null);
    const queued=(await core.call({op:'queued'})).ok;await core.close();
    return {queuedCount:queued.length,queuedIds:queued.map(x=>x.id)};
  },admitted.storeName);
  assert.equal(reopened.queuedCount,1);
  await page.evaluate(async url=>{
    const {createLocalClient}=await import('/sdk/local.js');const {webDevice}=await import('/sdk/web.js');
    window.client=await createLocalClient({url,persona:'alice',waitSeconds:1,device:webDevice()});await window.client.sync();
  },backend);
  let confirmed;await until(async()=>{confirmed=await authoritative();return confirmed.data?.length===1;},'reopened queue did not settle');
  assert.equal(confirmed.data[0].text,'awaited-before-page-close');
  const result={observedAt:new Date().toISOString(),pin:'0.2.10',binary,serverPid:server.pid,backend,origin,admitted,reopened,authoritativeRowsAfterCloseBeforeReconnect:before.data.length,authoritativeRowsAfterReconnect:confirmed.data.length,method:'Headless Chromium, default IndexedDB persistence, backend fetch blocked before awaited mutation; next asynchronous controller action closes page without client.close, queue inspection or server read before closure; new page opens stored device with null backend and finds one queued mutation; reconnect settles it once. No keepalive/write-through path.',limits:'One reduced awaited-admission case, not full Muse settings app, arbitrary pre-admission tab destruction, process crash, or power-loss proof. Controller handoff after evaluate is not a zero-nanosecond kill.',pass:true};
  writeFileSync(root+'/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({pass:true,before:before.data.length,afterCloseQueued:reopened.queuedCount,afterReconnect:confirmed.data.length}));
}finally{
  await context?.close();await browser?.close();web.closeAllConnections();await new Promise(r=>web.close(r));
  if(server.exitCode===null&&server.signalCode===null)server.kill('SIGTERM');await ended;
  writeFileSync(root+'/server.log',log);
}

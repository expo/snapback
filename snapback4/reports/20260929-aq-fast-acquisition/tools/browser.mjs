// Private fixture browser measurement. No builder code is executed.
// node reports/20260929-aq-fast-acquisition/tools/browser.mjs URL OUTPUT [SDK_DIST] [RUNS]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { createRequire } from 'node:module';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { chromiumExecutable, root } from '../../../witness/lib.mjs';

const [api, output, source = 'packages/snapback4/dist', runs = '5'] = process.argv.slice(2);
assert.ok(api && output, 'URL OUTPUT [SDK_DIST] [RUNS]');
const dir = resolve(root, 'target/aq-browser');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'package.json'), JSON.stringify({type:'module',imports:{'#fetch':'./sdk/default-fetch.js'}}));
cpSync(resolve(source), join(dir, 'sdk'), { recursive: true });
const sdk = join(dir, 'sdk'), diagnostic = process.env.AQ_DIAGNOSTIC === '1';
const edit = (file, f) => writeFileSync(join(sdk, file), f(readFileSync(join(sdk, file), 'utf8')));
if (diagnostic) {
  edit('wasm/snapback4_device.js', s => s + `
const aq = globalThis.__aq ??= {calls:[],saves:[],transactions:[],json:{},origin:performance.timeOrigin};
for (const method of ['call','drain']) {
 const original=WebDevice.prototype[method];
 WebDevice.prototype[method]=function(...args){
  const op=method==='call' ? /"op":"([^"]+)"/.exec(args[0])?.[1] : method;
  const at=performance.now();try{return original.apply(this,args);}finally{aq.calls.push({op,at,ms:performance.now()-at});}
 };
}
const txs=new WeakMap(), transaction=IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction=function(...args){
 const tx=transaction.apply(this,args), item={at:performance.now(),mode:tx.mode,durability:tx.durability,gets:0,puts:0,deletes:0,sizes:[],putMs:0};
 txs.set(tx,item);for(const event of ['complete','abort'])tx.addEventListener(event,()=>aq.transactions.push({...item,event,ms:performance.now()-item.at}));return tx;
};
for(const method of ['put','get','getAll','getAllKeys','delete']){
 const original=IDBObjectStore.prototype[method];
 IDBObjectStore.prototype[method]=function(...args){const item=txs.get(this.transaction);if(item){item[method==='put'?'puts':method==='delete'?'deletes':'gets']++;if(method==='put')item.sizes.push({s:args[0].s,chars:args[0].v?.length??0});}const at=performance.now();try{return original.apply(this,args);}finally{if(item&&method==='put')item.putMs+=performance.now()-at;}};
}
for(const method of ['parse','stringify']){
 const original=JSON[method];JSON[method]=function(...args){const at=performance.now();try{return original.apply(this,args);}finally{const item=aq.json[method]??={count:0,ms:0};item.count++;item.ms+=performance.now()-at;}};
}
`);
  edit('web-idb.js', s => {
    const start = s.indexOf('const save = async (name, changes, current) => {');
    assert.ok(start >= 0);
    const end = s.indexOf('\n    };', start), body = s.slice(start, end);
    return s.slice(0, start) + body.replace('=> {', '=> { const at=performance.now();')
      .replace('db.close();', 'db.close(); globalThis.__aq?.saves.push({at,ms:performance.now()-at,changes:changes.length});') + s.slice(end);
  });
  edit('web-worker-entry.js', s => s.replace('serveWorker(globalThis);', `
globalThis.addEventListener('message',e=>{if(e.data?.aqProfile){e.stopImmediatePropagation();postMessage({aqProfile:globalThis.__aq});}});
serveWorker(globalThis);`));
}
writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Cold acquisition</title><script type="module" src="/entry.js"></script>');
writeFileSync(join(dir, 'entry.js'), `
import {createApp} from './sdk/app.js';
import {login,keepSession,localStorageSessionStore} from './sdk/auth.js';
import {webDevice,indexedDbPersistence} from './sdk/web.js';
import {acquisition} from './sdk/acquisition.js';
window.sdk={createApp,login,keepSession,localStorageSessionStore,webDevice,indexedDbPersistence,acquisition};`);
const require = createRequire(join(root, 'apps/chat/package.json'));
const { build } = await import(require.resolve('vite'));
await build({ root: dir, logLevel: 'silent', build: { target: 'es2022', minify: false, assetsInlineLimit: 0 } });
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    const file = join(dir, 'dist', path === '/' ? 'index.html' : path);
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' }[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.AQ_CHROMIUM??chromiumExecutable(), headless: true });
const samples = [];
try {
  for (let run = 0; run < Number(runs); run++) for (const mode of (process.env.AQ_MODES?.split(',')??(run % 2 ? ['worker','default'] : ['default','worker']))) {
    const host = { at: new Date().toISOString(), hostname: os.hostname(), cpus: os.cpus().length,
      cpu: os.cpus()[0].model, load: os.loadavg(), freeMemory: os.freemem(), stat: readFileSync('/proc/stat','utf8').split('\n')[0], pressure: readFileSync('/proc/pressure/cpu','utf8') };
    const context = await browser.newContext(), page = await context.newPage(), errors = [], wire = [], pending = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => {
      if (new URL(r.url()).pathname !== '/sync') return;
      pending.push((async () => {
        const body = await r.body(), p = JSON.parse(body.toString());
        wire.push({bytes:body.length,rows:p.events?.length??0,snapshot:p.snapshot,more:p.more,
          markers:p.acquisitions?.length??0,serverTiming:r.headers()['server-timing'],timing:r.request().timing()});
      })().catch(e => errors.push(String(e))));
    });
    await page.addInitScript(() => {
      window.aqWorkers=[];const Original=Worker;window.Worker=class extends Original {constructor(...args){super(...args);window.aqWorkers.push(this);}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.sdk);
    const cdp=process.env.AQ_PROFILE?await context.newCDPSession(page):null;
    let navigationStart;
    if(cdp){
      await cdp.send('Performance.enable');
      navigationStart=(await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='NavigationStart').value;
      await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
    }
    const result = await page.evaluate(async ({api,mode,diagnostic,account}) => {
      const { createApp,login,keepSession,localStorageSessionStore,webDevice,indexedDbPersistence,acquisition }=window.sdk;
      const sessionStore=localStorageSessionStore(), signed=await login(api,`${account}@example.com`,'CliqueScale!20260808');
      if(!signed.ok)throw Error(JSON.stringify(signed));
      await keepSession(api,signed.session,sessionStore);
      const pages=[], requests=[], expected=new Map(), progress=[], tasks=[];
      const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration}))));observer.observe({type:'longtask'});
      let offline=false, firstScreen, clientReady;
      const start=performance.now();
      const app=createApp({url:api,sessionStore,device:webDevice({worker:mode==='worker'}),fetch:async(input,init)=>{
        if(offline)throw new TypeError('measurement offline');
        const path=new URL(input).pathname, at=performance.now(), r=await fetch(input,init);
        const item={path,at,headersMs:performance.now()-at,status:r.status,serverTiming:r.headers.get('server-timing')};requests.push(item);
        if(path==='/sync'){
          const original=r.json.bind(r);r.json=async()=>{
            const begin=performance.now();let body;
            if(diagnostic){const text=await r.text(),received=performance.now();body=JSON.parse(text);item.bodyReadMs=received-begin;item.decodeMs=performance.now()-received;}
            else body=await original();
            item.bodyAndDecodeMs=performance.now()-begin;
            pages.push(body);return body;
          };
        }
        return r;
      }});
      let client,stopProgress=()=>{},stopScreen=()=>{},stopAcquired=()=>{},resolveAcquired;
      const acquiring=new Promise(resolve=>{resolveAcquired=resolve;});
      const arm=()=>{
        if(client||app.auth.state!=='signed-in')return;
        client=app.client;clientReady=performance.now()-start;
        const a=acquisition(client);stopProgress=a.subscribe(()=>progress.push({at:performance.now()-start,...a.read()}));
        const screen=client.observe({kind:'query',name:'chat.inbox'},{c:null});
        const read=()=>{if(firstScreen===undefined&&'data' in screen.getSnapshot())firstScreen=performance.now()-start;};
        stopScreen=screen.subscribe(read);read();
        const check=()=>{if(client.acquired)resolveAcquired(performance.now()-start);};
        stopAcquired=client.onAcquired(check);check();
      };
      const stopAuth=app.auth.onChange(arm);arm();
      const opened=await app.ready;if(!opened.ok)throw Error(JSON.stringify(opened));
      arm();
      const acquired=await Promise.race([acquiring,new Promise((_,reject)=>setTimeout(()=>reject(Error('acquisition timeout')),240000))]);
      const end=performance.now();
      let profile=globalThis.__aq&&structuredClone(globalThis.__aq);
      if(diagnostic&&mode==='worker')profile=await new Promise(resolve=>{
        const w=window.aqWorkers.at(-1),listener=e=>{if(e.data.aqProfile){w.removeEventListener('message',listener);resolve(e.data.aqProfile);}};
        w.addEventListener('message',listener);w.postMessage({aqProfile:true});
      });
      const residency=await client.residency();
      stopAuth();stopAcquired();stopScreen();stopProgress();observer.disconnect();offline=true;
      const inbox=await client.query({kind:'query',name:'chat.inbox'},{c:null});
      await app.close();
      const persist=indexedDbPersistence(), names=(await indexedDB.databases()).map(d=>d.name).filter(n=>n===`snapback4-${encodeURIComponent(api+':'+signed.session.principal)}`);
      const stores=[];for(const name of names)stores.push(...await persist.load(name));
      const rows=stores.filter(c=>c.s==='r'),counts={};for(const row of rows){const [table]=JSON.parse(row.k);counts[table]=(counts[table]??0)+1;}
      const plain=value=>{
        if(value==='Null')return null;
        const [kind,v]=Object.entries(value)[0];
        if(kind==='Row'||kind==='Map')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,plain(x)]));
        if(kind==='Array')return v.map(plain);
        return v;
      };
      const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
      for(const p of pages)for(const e of p.events??[]){const key=JSON.stringify([e.table,e.id]);if(e.kind==='put')expected.set(key,canonical(e.data));else if(e.kind==='del')expected.delete(key);else throw Error('fixture changed scopes during measurement');}
      const mismatches=[];for(const row of rows)if(expected.get(row.k)!==canonical(plain(JSON.parse(row.v))))mismatches.push(row.k);
      const held=new Set(rows.map(r=>r.k));
      const verification={expectedRows:expected.size,storedRows:rows.length,mismatches:mismatches.length,missing:[...expected.keys()].filter(k=>!held.has(k)).length};
      const responseStats=pages.map(p=>({rows:p.events?.length??0,bytes:new TextEncoder().encode(JSON.stringify(p)).length,snapshot:p.snapshot,more:p.more,markers:p.acquisitions?.length??0}));
      return {mode,origin:performance.timeOrigin,start,end,acquiredMs:acquired,clientReadyMs:clientReady,firstScreenMs:firstScreen,residency,requests,responseStats,progress,profile,tasks,
        offlineInbox:{complete:inbox.complete,rows:inbox.data?.length,denied:inbox.denied},counts,verification,storeNames:names.length};
    }, {api,mode,diagnostic,account:process.env.AQ_ACCOUNT??'u0500'});
    await Promise.all(pending);
    if(cdp){
      const {profile}=await cdp.send('Profiler.stop');
      writeFileSync(`${output}.${mode}.${run}.cpuprofile`,JSON.stringify(profile));
      writeFileSync(`${output}.${mode}.${run}.window.json`,JSON.stringify({
        from:navigationStart*1e6+result.start*1e3,to:navigationStart*1e6+(result.start+result.acquiredMs)*1e3,host
      }));
    }
    const sample = {run,host,chromium:browser.version(),diagnostic,...result,wire,errors};samples.push(sample);
    writeFileSync(output,JSON.stringify(samples,null,2));
    console.log(JSON.stringify({run,mode,ms:result.acquiredMs,firstScreen:result.firstScreenMs,pages:result.responseStats.length,offline:result.offlineInbox,counts:result.counts,errors}));
    await context.close();
    assert.deepEqual(errors,[]);
    assert.equal(result.offlineInbox.complete,true);
    assert.equal(result.verification.mismatches,0,JSON.stringify(result.verification));
    assert.equal(result.verification.missing,0,JSON.stringify(result.verification));
    assert.equal(result.verification.storedRows,result.verification.expectedRows);
  }
} finally {await browser.close();await new Promise(r=>server.close(r));}

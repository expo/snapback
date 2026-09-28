// @ref LLP 3000.028#6 — actual Chromium IndexedDB allocation from the identical authorized replica rows.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {build} from 'vite';
const sb4=resolve(import.meta.dirname,'../..'),out=join(sb4,'reports/20260928-ok-owner-key-coverage');
const work=join(import.meta.dirname,'.work/ok/browser'),cost=join(sb4,'crates/snapback4-device/target/owner-key-cost');
mkdirSync(work,{recursive:true});
writeFileSync(join(work,'entry.mjs'),`import {webDevice} from '${join(sb4,'packages/snapback4/src/web.ts')}';window.ownerKeyOpener=webDevice;`);
await build({root:work,logLevel:'silent',build:{outDir:join(work,'dist'),minify:'oxc',lib:{entry:join(work,'entry.mjs'),formats:['es'],fileName:'entry'}}});
let selected,db,positions;
const pageSize=Number(process.env.OWNER_BROWSER_PAGE_SIZE??10000);
function wire(value){
  if(value==='Null')return null;
  const [kind,data]=Object.entries(value)[0];
  if(kind==='Row'||kind==='Map')return Object.fromEntries(Object.entries(data).map(([k,v])=>[k,wire(v)]));
  if(kind==='Array')return data.map(wire);
  return data;
}
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end('<script type="module" src="/entry.mjs"></script>');return;}
  if(url.pathname==='/entry.mjs'){res.setHeader('content-type','text/javascript');res.end(readFileSync(join(work,'dist/entry.mjs')));return;}
  if(url.pathname==='/device.wasm'){res.setHeader('content-type','application/wasm');res.end(readFileSync(join(sb4,'packages/snapback4/src/wasm/snapback4_device_bg.wasm')));return;}
  res.setHeader('content-type','application/json');
  if(url.pathname==='/backend'){res.end(readFileSync(join(selected,'backend.json')));return;}
  if(url.pathname==='/page'){
    const after=Number(url.searchParams.get('after')??0),position=positions.get(after);
    const rows=db.prepare('select r.t,c.name as table_name,r.id,r.data from r join _catalog c on c.num=r.t where (r.t,r.id)>(?,?) order by r.t,r.id limit ?').all(...position,pageSize);
    if(rows.length)positions.set(after+rows.length,[rows.at(-1).t,rows.at(-1).id]);
    const first=after===0;
    const groups=JSON.parse(db.prepare("select value from _meta where key='device:history:groups'").get()?.value??'{}');
    const held=Object.fromEntries(Object.entries(groups).map(([table,groups])=>[table,Object.entries(groups).filter(([,v])=>v==='Held').map(([k])=>JSON.parse(k))]));
    const generation=JSON.parse(readFileSync(join(selected,'backend.json'),'utf8')).generation;
    const total=db.prepare('select count(*) as n from r').get().n;
    const more=after+rows.length<total;
    const page={snapshot:true,stage_snapshot:true,generation,watermark:1,more,after:first?null:String(after),next:more?String(after+rows.length):null,
      events:rows.map(r=>({table:r.table_name,id:r.id,kind:'put',data:wire(JSON.parse(r.data))}))};
    if(first)page.held=held;
    res.end(JSON.stringify(page));return;
  }
  res.statusCode=404;res.end('{}');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/home/ccheever/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--enable-precise-memory-info']});
const resultPath=join(out,process.env.OWNER_BROWSER_OUTPUT??'browser-costs.json');
const results=existsSync(resultPath)?JSON.parse(readFileSync(resultPath,'utf8')).results:[];
function payloadHash(path){
  const copy=new DatabaseSync(path,{readOnly:true}),hash=createHash('sha256');
  for(const row of copy.prepare('select c.name,r.id,r.data from r join _catalog c on c.num=r.t order by r.t,r.id').iterate())hash.update(JSON.stringify(row)+'\n');
  hash.update(copy.prepare("select value from _meta where key='device:history:groups'").get()?.value??'{}');
  copy.close();return hash.digest('hex');
}
const cases=[...[1000,100000,1000000].flatMap(n=>['summaries','public','own_rows','keys'].flatMap(mode=>['empty','prolific'].map(viewer=>({n,mode,viewer,dir:`${n}-${mode}`})))),
  ...['summaries','public','own_rows','keys'].flatMap(mode=>['empty','u0500','u0001'].map(viewer=>({n:'fixture',mode,viewer,dir:`fixture-${mode}`})))];
try {
  for(const {n,mode,viewer,dir} of cases){
    if(process.env.OWNER_BROWSER_SIZE && String(n)!==process.env.OWNER_BROWSER_SIZE)continue;
    if(process.env.OWNER_BROWSER_MODE && mode!==process.env.OWNER_BROWSER_MODE)continue;
    if(process.env.OWNER_BROWSER_VIEWER && viewer!==process.env.OWNER_BROWSER_VIEWER)continue;
    if(results.some(r=>r.keys===n && r.mode===mode && r.viewer===viewer && !r.error))continue;
    selected=join(cost,dir);assert.ok(existsSync(join(selected,'cost.json')),`native case must finish: ${selected}`);
    // Public synthetic arms deliver identical replicas to both viewers: measure each distinct payload once.
    const identical=typeof n==='number' && viewer==='prolific' && ['summaries','public'].includes(mode)
      && results.find(r=>r.keys===n && r.mode===mode && r.viewer==='empty');
    if(identical){
      const digest=payloadHash(join(selected,'empty.sqlite'));
      assert.equal(payloadHash(join(selected,'prolific.sqlite')),digest);
      results.push({...identical,viewer,measurementReusedFrom:'empty',payloadSha256:digest});
      writeFileSync(resultPath,JSON.stringify({chromium:browser.version(),results},null,2)+'\n');
      console.log(n,mode,viewer,'identical authorized payload',digest);continue;
    }
    db=new DatabaseSync(join(selected,`${viewer}.sqlite`),{readOnly:true});positions=new Map([[0,[0,'']]]);
    const context=await browser.newContext(),page=await context.newPage();
    await page.goto(origin);await page.waitForFunction(()=>!!window.ownerKeyOpener);
    page.on('console',m=>{if(m.text().startsWith('owner-progress'))console.log(n,mode,viewer,m.text());});
    const evaluation=page.evaluate(async()=>{
      const started=performance.now(),raw=await fetch('/backend').then(r=>r.text()),backend=JSON.parse(raw);
      const opener=window.ownerKeyOpener({wasm:new URL('/device.wasm',location.href)}),core=await opener.open('owner-cost',backend);
      let after=0,pages=0,rows=0,wire=raw.length,peakJs=0,peakWasm=0;
      do {
        const raw=await fetch(`/page?after=${after}`).then(r=>r.text());wire+=new TextEncoder().encode(raw).length;
        const p=JSON.parse(raw),r=await core.call({op:'apply',page:p,first:pages===0});if(r.denied)throw Error(JSON.stringify(r));
        rows+=p.events.length;pages++;after=p.more?Number(p.next):null;
        if(rows%100000===0)console.log('owner-progress',rows);
        peakJs=Math.max(peakJs,performance.memory?.usedJSHeapSize??0);
        const residency=await core.call({op:'residency'});peakWasm=Math.max(peakWasm,residency.ok?.wasmHeapBytes??0);
        window.ownerCostProgress={phase:'staging',rows,pages,wireBytes:wire,peakJsHeap:peakJs,peakWasmHeap:peakWasm,elapsedMs:performance.now()-started};
      }while(after!==null);
      window.ownerCostProgress.phase='publication';
      const r=await core.call({op:'apply',page:{snapshot:false,snapshot_catchup:true,generation:backend.generation,watermark:1,more:false,events:[]}});if(r.denied)throw Error(JSON.stringify(r));
      const state=await core.call({op:'sync_state'});if(!state.ok.acquired)throw Error('did not publish acquisition');
      const coldMs=performance.now()-started,residency=await core.call({op:'residency'});
      window.ownerCostProgress.phase='acquired';
      peakJs=Math.max(peakJs,performance.memory?.usedJSHeapSize??0);
      peakWasm=Math.max(peakWasm,residency.ok?.wasmHeapBytes??0);
      await core.close();
      return {coldOpenerMs:coldMs,pages,decodedRows:rows,wireBytes:wire,peakJsHeap:peakJs,peakWasmHeap:peakWasm,residency:residency.ok,estimate:await navigator.storage.estimate()};
    });
    let timer,result;
    try {
      result=await Promise.race([evaluation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('browser acquisition timeout; no completed-replica claim')),Number(process.env.OWNER_BROWSER_TIMEOUT_MS??1500000));})]);
    } catch(error) {
      result={error:String(error),progress:await page.evaluate(()=>window.ownerCostProgress??null).catch(()=>null)};
    } finally {clearTimeout(timer);}
    const cdp=await context.newCDPSession(page),storage=await cdp.send('Storage.getUsageAndQuota',{origin});
    results.push({keys:n,mode,viewer,pageSize,...result,storage});
    writeFileSync(resultPath,JSON.stringify({chromium:browser.version(),results},null,2)+'\n');
    console.log(n,mode,viewer,result.coldOpenerMs,storage.usage);
    await context.close();db.close();db=undefined;
  }
  if(results.some(r=>r.error))process.exitCode=1;
}finally{db?.close();await browser.close();await new Promise(r=>server.close(r));}

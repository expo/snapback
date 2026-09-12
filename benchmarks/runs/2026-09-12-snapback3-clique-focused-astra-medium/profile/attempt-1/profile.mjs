import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {chromium} from '@playwright/test';
const root=process.cwd(),dir=path.join(root,'diagnostic'),origin='http://127.0.0.1:54905',node='/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node';
const report={kind:'independent instrumented CPU-attribution diagnostic; never a normal timing repeat',actor:'u0500',expectedMessages:10000,origin,startedEpochMs:Date.now(),controllerPid:process.pid,node:process.version,playwright:JSON.parse(fs.readFileSync('node_modules/playwright/package.json')).version,clkTck:Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'})),phases:[],processes:[],samples:[],network:[],errors:[]};
const save=()=>fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const stat=pid=>{try{const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8'),x=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);return{pid,startTicks:x[19],userTicks:Number(x[11]),systemTicks:Number(x[12]),rssPages:Number(x[21]),state:x[0]}}catch{return null}};
const children=pid=>{try{return fs.readFileSync('/proc/'+pid+'/task/'+pid+'/children','utf8').trim().split(/\s+/).filter(Boolean).map(Number)}catch{return[]}};
const command=pid=>{try{return fs.readFileSync('/proc/'+pid+'/cmdline','utf8').replaceAll('\0',' ')}catch{return''}};
const descendants=pid=>{const out=[];for(const child of children(pid)){out.push(child,...descendants(child))}return out};
const seen=new Map();
let owner,worker,context,cdp,sampling=false,sampler,profilerRunning=false,browserPid,deadline;
const observeProcesses=()=>{const ids=[process.pid,owner?.pid,worker,browserPid,...(browserPid?descendants(browserPid):[])].filter(Boolean),rows=[];for(const pid of [...new Set(ids)]){const s=stat(pid);if(!s)continue;if(!seen.has(pid)){const r={...s,command:command(pid),firstSeenEpochMs:Date.now(),role:pid===process.pid?'diagnostic-controller':pid===owner?.pid?'node-owner':pid===worker?'rust-worker':'chromium'};seen.set(pid,r);report.processes.push(r)}rows.push(s)}return rows};
const takeSample=async label=>{const epochStart=Date.now(),processes=observeProcesses();let metrics={};if(cdp)try{metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))}catch(e){report.errors.push({scope:'metrics',error:String(e)})}const s={label,epochStart,epochEnd:Date.now(),processes,metrics};report.samples.push(s);return s};
const phase=async name=>{let browser;try{browser=await context.pages()[0].evaluate(()=>({epochMs:Date.now(),timeOrigin:performance.timeOrigin,now:performance.now()}))}catch{}const p={name,epochMs:Date.now(),browser};report.phases.push(p);save();return p};
const ownedBrowserPids=profile=>execFileSync('ps',['-eo','pid,ppid,args'],{encoding:'utf8'}).split('\n').filter(l=>l.includes('--user-data-dir='+profile)).map(l=>Number(l.trim().split(/\s+/)[0]));
try{
 const logOut=fs.openSync(path.join(dir,'owner.stdout.log'),'w'),logErr=fs.openSync(path.join(dir,'owner.stderr.log'),'w');
 const env={...process.env,PATH:path.dirname(node)+':/usr/local/bin:/usr/bin:/bin'};for(const k of ['SNAPBACK3_WORKER','NODE_OPTIONS','NODE_PATH','CI'])delete env[k];
 owner=spawn(node,['node_modules/snapback3/dist/cli.mjs','dev','.', '--host','127.0.0.1','--port','54905'],{cwd:root,env,stdio:['ignore',logOut,logErr]});fs.closeSync(logOut);fs.closeSync(logErr);
 report.ownerCommand=[node,'node_modules/snapback3/dist/cli.mjs','dev','.', '--host','127.0.0.1','--port','54905'];observeProcesses();save();
 const startup=Date.now();while(true){if(owner.exitCode!==null)throw Error('Owner exited '+owner.exitCode);try{const r=await fetch(origin+'/api/health');if(r.ok){report.initialHealth=await r.json();worker=report.initialHealth.pid;break}}catch{}if(Date.now()-startup>60000)throw Error('Owner health timeout');await sleep(200)}
 assert.equal(report.initialHealth.seq,1);observeProcesses();await phase('owner-seeded-ready');
 const profile=path.join(dir,'browser-profile');assert(!fs.existsSync(profile));report.browserProfile=profile;
 context=await chromium.launchPersistentContext(profile,{headless:true,args:['--no-sandbox','--enable-precise-memory-info'],viewport:{width:1200,height:850}});
 const roots=ownedBrowserPids(profile);assert.equal(roots.length,1);browserPid=roots[0];observeProcesses();save();
 await context.addInitScript(()=>{window.profileLongTasks={count:0,totalMs:0,maxMs:0};new PerformanceObserver(list=>{for(const e of list.getEntries()){const s=window.profileLongTasks;s.count++;s.totalMs+=e.duration;s.maxMs=Math.max(s.maxMs,e.duration)}}).observe({entryTypes:['longtask']})});
 const page=context.pages()[0]??await context.newPage();cdp=await context.newCDPSession(page);
 await cdp.send('Network.enable');await cdp.send('Performance.enable');await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
 const net=new Map();let receiving=0;cdp.on('Network.requestWillBeSent',e=>{let op;try{op=JSON.parse(e.request.postData??'null')?.op}catch{}net.set(e.requestId,{id:e.requestId,path:new URL(e.request.url).pathname,method:e.request.method,op,startTimestamp:e.timestamp,wallTime:e.wallTime})});
 cdp.on('Network.responseReceived',e=>{const n=net.get(e.requestId);if(n)Object.assign(n,{status:e.response.status,responseTimestamp:e.timestamp,fromDiskCache:e.response.fromDiskCache,fromServiceWorker:e.response.fromServiceWorker})});
 cdp.on('Network.dataReceived',e=>{const n=net.get(e.requestId);receiving+=e.encodedDataLength;if(n){n.dataBytes=(n.dataBytes??0)+e.dataLength;n.encodedDataEventBytes=(n.encodedDataEventBytes??0)+e.encodedDataLength}});
 cdp.on('Network.loadingFinished',e=>{const n=net.get(e.requestId);if(n)Object.assign(n,{endTimestamp:e.timestamp,encodedDataLength:e.encodedDataLength})});
 cdp.on('Network.loadingFailed',e=>{const n=net.get(e.requestId);if(n)Object.assign(n,{failedTimestamp:e.timestamp,error:e.errorText,canceled:e.canceled})});
 page.on('pageerror',e=>report.errors.push({scope:'pageerror',error:String(e)}));
 report.intervalBefore=await takeSample('before-profiler-start');report.profilerStartBracket={before:Date.now()};await cdp.send('Profiler.start');profilerRunning=true;report.profilerStartBracket.after=Date.now();
 sampling=true;sampler=(async()=>{while(sampling){await takeSample('interval');await sleep(500)}})();
 deadline=setTimeout(()=>{report.watchdogTriggeredEpochMs=Date.now();context?.close().catch(()=>{})},300000);
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForFunction(()=>window.clique&&window.runAcquisition,null,{timeout:30000});await phase('app-loaded');
 await page.evaluate(async()=>{await clique.ready;await clique.auth.persona('u0500')});await phase('authenticated');
 await page.getByTestId('sm-chats-item').first().waitFor({state:'visible',timeout:20000});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await phase('first-inbox-driver-paint-boundary');
 await page.getByTestId('conversation-id').fill('g0001');await page.getByTestId('conversation-id').press('Enter');
 await page.getByTestId('message-mg0001-00001').scrollIntoViewIfNeeded({timeout:20000});
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await phase('first-history-driver-paint-boundary');
 report.acquisitionBefore=await takeSample('before-authored-acquisition');
 await page.evaluate(()=>{window.runAcquisition().catch(()=>{})});await phase('authored-acquisition-started');
 await page.waitForFunction(()=>window.acquisition&&window.acquisition.status!=='running',null,{polling:1000,timeout:240000});
 await phase('authored-acquisition-observed-end');
 sampling=false;await sampler;report.samplerStoppedEpochMs=Date.now();
 report.intervalAfter=await takeSample('after-acquisition-before-inspection');
 report.profilerStopBracket={before:Date.now()};const profileData=await cdp.send('Profiler.stop');profilerRunning=false;report.profilerStopBracket.after=Date.now();fs.writeFileSync(path.join(dir,'browser-main-thread.cpuprofile'),JSON.stringify(profileData),{mode:0o600});report.cpuProfile={path:'browser-main-thread.cpuprofile',sha256:crypto.createHash('sha256').update(JSON.stringify(profileData)).digest('hex'),nodes:profileData.nodes.length,samples:profileData.samples?.length??0,startTime:profileData.startTime,endTime:profileData.endTime};
 report.heapBeforeForcedGC=await takeSample('end-heap-before-forced-gc');
 try{report.forcedGC={before:Date.now()};await cdp.send('HeapProfiler.collectGarbage');report.forcedGC.after=Date.now();report.heapAfterForcedGC=await takeSample('end-heap-after-forced-gc')}catch(e){report.forcedGC={supported:false,error:String(e)}}
 report.inspectionStartedEpochMs=Date.now();
 report.observation=await page.evaluate(()=>({acquisition:{status:acquisition.status,error:acquisition.error,start:acquisition.start,end:acquisition.end,conversations:acquisition.conversations.length,ids:acquisition.ids,pages:acquisition.pages,resourceWaits:acquisition.resourceWaits,lastFetched:acquisition.lastFetched,lastDurable:acquisition.lastDurable},storageTimings:storageTimings.map(t=>({kind:t.kind,start:t.start,end:t.end,rowCount:t.rowCount,messageIdCount:t.messageIds?.length,resourceCount:t.resources?.length,operationCount:t.operationCount})),longTasks:profileLongTasks,storageEstimate:null}));
 const expected=JSON.parse(fs.readFileSync(path.join(dir,'expected-u0500-ids.json'))),ids=report.observation.acquisition.ids,set=new Set(ids),wanted=new Set(expected);
 report.verification={expected:expected.length,observed:ids.length,unique:set.size,missing:expected.filter(x=>!set.has(x)),extras:ids.filter(x=>!wanted.has(x))};assert.equal(report.observation.acquisition.status,'complete');assert.equal(ids.length,10000);assert.equal(set.size,10000);assert.equal(report.verification.missing.length,0);assert.equal(report.verification.extras.length,0);
 fs.writeFileSync(path.join(dir,'acquired-ids.json'),JSON.stringify(ids)+'\n',{mode:0o600});delete report.observation.acquisition.ids;
 report.observation.storageEstimate=await page.evaluate(()=>navigator.storage.estimate());
 report.finalHealth=await(await fetch(origin+'/api/health')).json();assert.equal(report.finalHealth.seq,1);
 report.network=[...net.values()];report.receivedEncodedDataEvents=receiving;
 report.status='complete-exact-10000-instrumented';
}catch(error){report.status='diagnostic-failed';report.errors.push({scope:'run',error:String(error)});if(sampling){sampling=false;await sampler?.catch(()=>{})}if(cdp&&profilerRunning)try{const p=await cdp.send('Profiler.stop');profilerRunning=false;fs.writeFileSync(path.join(dir,'browser-main-thread.partial.cpuprofile'),JSON.stringify(p),{mode:0o600})}catch(e){report.errors.push({scope:'partial-profile',error:String(e)})}}
finally{
 clearTimeout(deadline);sampling=false;await sampler?.catch(()=>{});
 report.beforeStopProcesses=observeProcesses();save();
 if(context)await context.close().catch(e=>report.errors.push({scope:'browser-close',error:String(e)}));
 if(owner&&owner.exitCode===null){owner.kill('SIGTERM');const end=Date.now()+10000;while(owner.exitCode===null&&Date.now()<end)await sleep(100);if(owner.exitCode===null){owner.kill('SIGKILL');report.errors.push({scope:'owner-stop',error:'SIGTERM exceeded10s; exact owned PID killed'})}}
 if(worker&&stat(worker)?.startTicks===seen.get(worker)?.startTicks){process.kill(worker,'SIGTERM');await sleep(100)}
 report.stoppedOwnedProcesses=report.processes.filter(p=>p.pid!==process.pid).map(p=>({pid:p.pid,role:p.role,originalStartTicks:p.startTicks,sameProcessPresent:stat(p.pid)?.startTicks===p.startTicks}));
 report.finishedEpochMs=Date.now();report.controllerFinishedByNaturalExit=true;save();console.log(JSON.stringify({status:report.status,errors:report.errors,phases:report.phases.map(p=>({name:p.name,epochMs:p.epochMs})),cpuProfile:report.cpuProfile,ownedRemaining:report.stoppedOwnedProcesses.filter(p=>p.sameProcessPresent)}));
}

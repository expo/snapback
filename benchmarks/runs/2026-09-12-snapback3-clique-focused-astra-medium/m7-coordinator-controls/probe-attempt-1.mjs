import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Coordinator diagnostic only. Run against the separately prepared private copies.
const root=path.resolve(process.argv[2]);
const deps=path.resolve(process.argv[3]);
const authHelper=path.resolve(process.argv[4]);
const require=createRequire(path.join(deps,'package.json'));
const {chromium}=require('playwright');
const {authenticate}=await import(pathToFileURL(authHelper));
const EXPECT_OP='731cbc48-b0ea-4e0a-819d-a74e5bc59a19';
const EXPECT_MSG='m7-old-client-53b5260a-4163-4f90-bc91-5e937ce2d100';
const out={kind:'separate coordinator diagnostic; not a new grade',startedEpochMs:Date.now(),operationId:EXPECT_OP,messageId:EXPECT_MSG,processes:[],oldClient:[],polls:[],failures:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const clean=e=>e?{code:String(e.code??e.name??'unknown').slice(0,100),message:String(e.message??e).replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,350)}:null;
function proc(pid){try {const s=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const tail=s.slice(s.lastIndexOf(')')+2).split(' ');return {pid,ppid:Number(tail[1]),startTick:tail[19],state:tail[0]};}catch{return null;}}
function descendants(pid){const all=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).map(Number).map(proc).filter(Boolean);const ids=new Set([pid]);let changed=true;while(changed){changed=false;for(const p of all)if(ids.has(p.ppid)&&!ids.has(p.pid)){ids.add(p.pid);changed=true;}}return all.filter(p=>ids.has(p.pid));}
function own(pid,role){for(const p of descendants(pid))if(!out.processes.some(x=>x.pid===p.pid&&x.startTick===p.startTick))out.processes.push({...p,role:p.pid===pid?role:`${role}-descendant`});}
async function stop(pid,role){own(pid,role);const tracked=out.processes.filter(p=>p.role===role||p.role===`${role}-descendant`);const send=(p,signal)=>{const now=proc(p.pid);if(now?.startTick===p.startTick&&now.state!=='Z'){process.kill(p.pid,signal);}};const parent=tracked.find(p=>p.pid===pid);if(parent)send(parent,'SIGTERM');for(let i=0;i<30&&tracked.some(p=>proc(p.pid)?.startTick===p.startTick&&proc(p.pid)?.state!=='Z');i++)await wait(100);for(const p of tracked)send(p,'SIGTERM');await wait(250);for(const p of tracked)send(p,'SIGKILL');for(const p of tracked){const now=proc(p.pid);p.afterStop=now?.startTick===p.startTick?now.state:'absent';}}
async function serve(app,port){const log=fs.openSync(path.join(root,`owner-${port}.log`),'a');const p=spawn(process.execPath,[path.join(deps,'node_modules/snapback3/dist/cli.mjs'),'serve',path.join(root,app),'--host','127.0.0.1','--port',String(port)],{stdio:['ignore',log,log]});own(p.pid,`owner-${port}`);for(let i=0;i<100;i++){if(p.exitCode!==null)throw Error(`Owner exited ${p.exitCode}`);try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){own(p.pid,`owner-${port}`);return p;}}catch{}await wait(100);}throw Error('Owner readiness timeout');}
async function readMessage(url){const {client}=await authenticate({url,actor:'alice'});try{const resource=client.watch('messages.page',{conversationId:'d-alice-bob',c:null});let s;for(let i=0;i<3;i++){s=await resource.refresh();if(Array.isArray(s.data))break;await wait(150);}return {status:s.status,complete:s.complete,fresh:s.fresh,seq:s.seq,error:clean(s.error),observedRows:Array.isArray(s.data)?s.data.length:null,originalMessagePresent:Array.isArray(s.data)?s.data.some(m=>m.id===EXPECT_MSG):null,next:s.next??null};}finally{client.close();}}
let owner,context,browserPid;
try{
 owner=await serve('app-oldclient',54910);
 out.serverBefore=await readMessage('http://127.0.0.1:54910');
 context=await chromium.launchPersistentContext(path.join(root,'old-client-profile'),{headless:true,offline:true});
 out.processes.push({...proc(process.pid),role:'controller'});
 const ours=descendants(process.pid);browserPid=ours.find(p=>{try{return fs.readFileSync(`/proc/${p.pid}/cmdline`,'utf8').includes('--remote-debugging-pipe');}catch{return false;}})?.pid;
 if(browserPid)own(browserPid,'chromium');
 const page=await context.newPage();
 page.on('pageerror',e=>out.failures.push({phase:'pageerror',error:clean(e)}));
 try{await page.goto('http://127.0.0.1:54910',{waitUntil:'load',timeout:12000});}catch(e){out.failures.push({phase:'offline-navigation',error:clean(e)});}
 await page.waitForFunction(()=>!!window.clique,{timeout:12000});
 const observe=async phase=>out.oldClient.push(await page.evaluate(({phase,id})=>{const c=window.clique;const s=c.getSnapshot();const clean=e=>e?{code:String(e.code??e.name??'unknown'),message:String(e.message??e).slice(0,350)}:null;const slim=o=>o?{id:o.id,op:o.op,status:o.status,error:clean(o.error),receipt:o.receipt?{state:o.receipt.state,seq:o.receipt.seq,reason:o.receipt.reason??null}:null}:null;let op;try{op=c.operation(id)?.getSnapshot();}catch(e){op={error:clean(e)};}return {phase,epochMs:Date.now(),clientStatus:s.status,clientError:clean(s.error),operation:slim(op),pending:s.pending.map(slim)};},{phase,id:EXPECT_OP}));
 await observe('offline-restored');
 out.onlineStartEpochMs=Date.now();await context.setOffline(false);
 for(let i=0;i<5;i++){await wait(5000);await observe(`online-${(i+1)*5}s`);}
 out.onlineEndEpochMs=Date.now();
 out.onlineObservedMs=out.onlineEndEpochMs-out.onlineStartEpochMs;
 out.serverAfter=await readMessage('http://127.0.0.1:54910');
 await context.close();context=null;if(browserPid)await stop(browserPid,'chromium');
 await stop(owner.pid,'owner-54910');owner=null;
}catch(e){out.failures.push({phase:'old-client',error:clean(e)});}finally{if(context)await context.close().catch(()=>{});if(browserPid)await stop(browserPid,'chromium');if(owner){await stop(owner.pid,'owner-54910');owner=null;}}
try{
 owner=await serve('app-final',54903);
 const bounds=JSON.parse(fs.readFileSync(path.join(root,'bounds-input.json'),'utf8'));
 const group=bounds.checks.find(x=>x.id==='setup.group').detail.data.id;
 const poll=bounds.checks.find(x=>x.id==='setup.vote-poll').detail.data.id;
 out.pollControl={group,poll,actor:'dave'};
 const {client}=await authenticate({url:'http://127.0.0.1:54903',actor:'dave'});
 try{const r=client.watch('polls.get',{conversationId:group,pollId:poll});for(let i=0;i<4;i++){try{const s=await r.refresh();out.polls.push({attempt:i+1,epochMs:Date.now(),status:s.status,fresh:s.fresh,complete:s.complete,seq:s.seq,dataPresent:s.data!==undefined,data:s.data??null,error:clean(s.error)});}catch(e){out.polls.push({attempt:i+1,epochMs:Date.now(),threw:clean(e)});}await wait(300);}}finally{client.close();}
}catch(e){out.failures.push({phase:'poll-query',error:clean(e)});}finally{if(owner)await stop(owner.pid,'owner-54903');}
out.finishedEpochMs=Date.now();
fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({oldClient:out.oldClient,serverBefore:out.serverBefore,serverAfter:out.serverAfter,onlineObservedMs:out.onlineObservedMs,polls:out.polls,failures:out.failures}));

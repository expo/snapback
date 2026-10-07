// @ref LLP 3000.030#15 — diagnostic failures must not become custody failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { maintenanceEvidence, observedMaintenance } from './helpers/maintenance-evidence.mjs';

const binary=process.env.SNAPBACK4_EXPORT_TEST_BINARY || new URL('../../../target/debug/snapback4',import.meta.url).pathname;
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sb4-em-diagnostic-'));
  const native=path.join(root,'artifacts/native-smoke');fs.mkdirSync(native,{recursive:true});
  return {root,native};
}
function tree(root) {
  return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?tree(path.join(root,e.name)):[path.join(root,e.name)]);
}
const read=file=>JSON.parse(fs.readFileSync(file));
function identity(pid) {
  const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').at(-1).split(' ');
  return {pid,start:[fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8'),stat[19]]};
}

test('maintenance snapshots bound tails, files, inventory, bytes and retained history',{timeout:30000},async()=>{
  const f=fixture(),base=fs.mkdtempSync(path.join(os.tmpdir(),'sb4-em-evidence-'));
  const saved=process.env.SNAPBACK4_MAINTENANCE_EVIDENCE;
  process.env.SNAPBACK4_MAINTENANCE_EVIDENCE=base;
  try {
    fs.writeFileSync(path.join(f.native,'maintenance.log'),Buffer.alloc(16*1024*1024,120));
    for(let i=0;i<400;i++)fs.writeFileSync(path.join(f.native,`record-${i}.json`),JSON.stringify({value:'x'.repeat(16000)}));
    const out=await maintenanceEvidence(f,'probe');assert.ok(out);
    const meta=read(path.join(out,'snapshot.json')),files=tree(out);
    assert.ok(fs.statSync(path.join(out,'files/maintenance.log')).size<=16384);
    assert.match(fs.readFileSync(path.join(out,'files/maintenance.log'),'utf8'),/^\[truncated: omitted/);
    assert.ok(meta.files.length<=256);assert.ok(meta.capturedFiles<=64);
    assert.ok(meta.truncated.includes('total-bytes'));assert.ok(meta.truncated.includes('inventory-or-time'));
    assert.ok(files.reduce((sum,p)=>sum+fs.statSync(p).size,0)<=1024*1024);
    assert.equal(fs.statSync(out).mode&0o777,0o700);
    for(const file of files)assert.equal(fs.statSync(file).mode&0o777,0o600);
    for(let i=0;i<5;i++)assert.ok(await maintenanceEvidence(f,'drain-timeout'));
    const failure=await maintenanceEvidence(f,'drain-timeout');
    for(let i=0;i<6;i++)assert.ok(await maintenanceEvidence(f,'cleanup'));
    const scope=path.dirname(failure),snapshots=fs.readdirSync(scope).filter(n=>n.startsWith('snapshot-'));
    assert.equal(snapshots.length,8);assert.equal(snapshots.filter(n=>n.includes('-failure-')).length,4);
    assert.ok(fs.existsSync(failure),'successful captures preserve recent failures');
  } finally {
    if(saved===undefined)delete process.env.SNAPBACK4_MAINTENANCE_EVIDENCE;else process.env.SNAPBACK4_MAINTENANCE_EVIDENCE=saved;
    fs.rmSync(f.root,{recursive:true,force:true});fs.rmSync(base,{recursive:true,force:true});
  }
});

test('maintenance capture refuses stale birth, unrelated commands and foreign groups; arguments stay private',{skip:process.platform!=='linux',timeout:15000},async()=>{
  const f=fixture(),base=fs.mkdtempSync(path.join(os.tmpdir(),'sb4-em-processes-'));
  const saved=process.env.SNAPBACK4_MAINTENANCE_EVIDENCE;process.env.SNAPBACK4_MAINTENANCE_EVIDENCE=base;
  const children=[];
  const start=async(args,options={})=>{
    const child=spawn(process.execPath,args,{stdio:'ignore',...options});children.push([child,once(child,'exit')]);await once(child,'spawn');return child;
  };
  try {
    const stale=await start(['-e','setInterval(()=>{},1000)','synthetic-secret=stale']);
    const wrong=await start(['-e','setInterval(()=>{},1000)','synthetic-secret=command']);
    fs.mkdirSync(path.join(f.root,'bin'));fs.writeFileSync(path.join(f.root,'bin/keeper.mjs'),'setInterval(()=>{},1000)');
    const foreign=await start([path.join(f.root,'bin/keeper.mjs'),'synthetic-secret=group'],{detached:true});
    const holder=spawn('python3',['-c','import sys,fcntl; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX); print("ready",flush=True); sys.stdin.read()',path.join(f.native,'retention.lock'),'synthetic-secret=owned'],{stdio:['pipe','pipe','inherit']});
    children.push([holder,once(holder,'exit')]);await once(holder.stdout,'data');
    const staleRecord=identity(stale.pid);staleRecord.start[1]='0';
    fs.writeFileSync(path.join(f.native,'maintenance-next.json'),JSON.stringify({process:staleRecord}));
    fs.writeFileSync(path.join(f.native,'maintenance-active.json'),JSON.stringify({process:identity(wrong.pid)}));
    fs.writeFileSync(path.join(f.native,'maintenance-result.json'),JSON.stringify({process:identity(foreign.pid)}));
    const out=await maintenanceEvidence(f,'probe');assert.ok(out);
    const processes=read(path.join(out,'processes.json'));
    assert.ok(processes.processes.some(p=>p.pid===holder.pid),'our real held lease has a captured process');
    for(const pid of [stale.pid,wrong.pid,foreign.pid]) {
      assert.ok(!processes.processes.some(p=>p.pid===pid));
      assert.ok(processes.rejected.some(p=>p.pid===pid));
    }
    const captured=tree(out).map(file=>fs.readFileSync(file,'utf8')).join('\n');
    assert.ok(!captured.includes('synthetic-secret'));
    assert.ok(processes.processes.every(p=>p.arguments.length<=8&&p.fds.length<=16));
  } finally {
    for(const [child,exited] of children){child.kill('SIGKILL');await exited;}
    if(saved===undefined)delete process.env.SNAPBACK4_MAINTENANCE_EVIDENCE;else process.env.SNAPBACK4_MAINTENANCE_EVIDENCE=saved;
    fs.rmSync(f.root,{recursive:true,force:true});fs.rmSync(base,{recursive:true,force:true});
  }
});

test('a FIFO trace sink cannot delay an observer deadline, lease release or the test drain wait',{timeout:15000},async()=>{
  const f=fixture();let holder,observer,heldExit,observerExit;
  try {
    assert.equal(spawnSync('mkfifo',[path.join(f.native,'retention-trace.jsonl')]).status,0);
    // Test-side timestamps also have no synchronous open of this FIFO.
    await observedMaintenance(f,false,async()=>{});
    holder=spawn('python3',['-c','import sys,fcntl; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX); print("ready",flush=True); sys.stdin.read()',path.join(f.native,'retention.lock')],{stdio:['pipe','pipe','inherit']});
    heldExit=once(holder,'exit');await once(holder.stdout,'data');
    fs.writeFileSync(path.join(f.native,'maintenance-request.json'),'{"state":"pending"}');
    const started=performance.now();
    observer=spawn('python3',['-c',"import os,fcntl,sys; f=open(sys.argv[1]+'/maintenance-next.lock','a'); fcntl.flock(f,fcntl.LOCK_EX); os.dup2(f.fileno(),3); os.set_inheritable(3,True); os.execve(sys.argv[2],[sys.argv[2],'witness','export-maintain',sys.argv[1],sys.argv[3]],os.environ)",f.native,binary,String(Date.now()+1500)],{cwd:f.root,env:{...process.env,SNAPBACK4_DEBUG_RETENTION:'1'},stdio:['pipe','ignore','pipe']});
    let output='';observer.stderr.on('data',x=>output+=x);observer.stdin.on('error',()=>{});
    observerExit=once(observer,'exit');observer.stdin.end('s');
    const watchdog=setTimeout(()=>observer.kill('SIGKILL'),4000);
    const [code,signal]=await observerExit;clearTimeout(watchdog);observer=null;
    assert.equal(signal,null,output);assert.equal(code,1,output);assert.match(output,/60-minute deadline/);
    assert.ok(performance.now()-started<4000);
    assert.equal(spawnSync('python3',['-c',"import fcntl,sys; f=open(sys.argv[1],'a'); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)",path.join(f.native,'maintenance-next.lock')]).status,0,'queue lease is released');
    assert.ok(fs.statSync(path.join(f.native,'retention-trace.jsonl')).isFIFO());
  } finally {
    if(observer){observer.kill('SIGKILL');await observerExit;}
    if(holder){holder.stdin.end();await heldExit;}
    fs.rmSync(f.root,{recursive:true,force:true});
  }
});

test('a stuck collector leaves the event loop running and preserves the original drain error',{timeout:10000},async()=>{
  const f=fixture(),saved=process.env.PATH;
  const bin=path.join(f.root,'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'python3'),'#!/bin/sh\nexec /bin/sleep 60\n',{mode:0o700});
  process.env.PATH=bin+':'+saved;
  const original=new Error('original drain assertion');let ticks=0;
  const timer=setInterval(()=>ticks++,10),started=performance.now();
  try {
    await assert.rejects(observedMaintenance(f,false,async()=>{throw original;}),error=>error===original);
    assert.ok(performance.now()-started<3000,'capture stops at its separate two-second bound');
    assert.ok(ticks>50,'capture never blocks the test event loop');
  } finally {clearInterval(timer);process.env.PATH=saved;fs.rmSync(f.root,{recursive:true,force:true});}
});


test('partial write errors cannot recover snapshot byte or file budget',{timeout:10000},()=>{
  const f=fixture(),base=fs.mkdtempSync(path.join(os.tmpdir(),'sb4-em-partial-'));
  try {
    for(let i=0;i<300;i++)fs.writeFileSync(path.join(f.native,`data-${i}.log`),Buffer.alloc(16384,120));
    const collector=new URL('./helpers/maintenance-evidence.py',import.meta.url).pathname;
    const script=`import importlib.util,sys,os
sys.path.insert(0,os.path.dirname(sys.argv[1]))
spec=importlib.util.spec_from_file_location('capture',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
real=os.fdopen
class Partial:
 def __init__(self,fd,*args): self.file=real(fd,*args)
 def __enter__(self): return self
 def __exit__(self,*args): self.file.close()
 def write(self,data):
  self.file.write(data[:len(data)//2]); self.file.flush(); raise OSError(5,'injected partial write')
os.fdopen=Partial
try: m.snapshot(dict(root=sys.argv[2],base=sys.argv[3],scope='partial-test',reason='probe'))
except OSError: pass
`;
    const run=spawnSync('python3',['-c',script,collector,f.root,base],{timeout:5000,encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const files=tree(base).filter(p=>!p.endsWith('/capture.lock'));
    assert.ok(files.length>0&&files.length<=67);
    assert.ok(files.reduce((sum,p)=>sum+fs.statSync(p).size,0)<=1024*1024);
  } finally {fs.rmSync(f.root,{recursive:true,force:true});fs.rmSync(base,{recursive:true,force:true});}
});

// Real owned-simulator cancellation through the shipped wrapper (no system changes).
import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';import {gzipSync} from 'node:zlib';
const starter=process.argv[2],stage=process.argv[3]??'selection';
const report=path.resolve('reports/20261001-nx-export-proves-native/round1'),project=path.resolve('target/nx',starter);
const tool=path.resolve('target/nx',`${starter}-interrupt-${stage}`);fs.mkdirSync(tool,{recursive:true});
const identity=path.join(tool,'created.json'),target=path.join(tool,'wrapper.pid');
if(stage==='selection'){
fs.writeFileSync(path.join(tool,'xcrun'),`#!/usr/bin/python3
import os, sys, subprocess, json, signal
from pathlib import Path
args=sys.argv[1:]
if args[:2]==['simctl','create']:
    r=subprocess.run(['/usr/bin/xcrun']+args,capture_output=True,text=True)
    if r.returncode==0:
        Path(${JSON.stringify(identity)}).write_text(json.dumps({'udid':r.stdout.strip(),'name':args[2],'runtime':args[4]}))
        print(r.stdout, end='', flush=True)
        os.kill(int(Path(${JSON.stringify(target)}).read_text()),signal.SIGINT)
    else:
        print(r.stderr,file=sys.stderr)
    sys.exit(r.returncode)
os.execv('/usr/bin/xcrun',['xcrun']+args)
`,{mode:0o755});
}
const artifacts=path.join(project,'artifacts/native-smoke'),before=new Set(fs.existsSync(artifacts)?fs.readdirSync(artifacts):[]);
const label=`${starter}-interrupt-${stage}`,fd=fs.openSync(path.join(report,label+'.log'),'wx');
const env={...process.env,PATH:`${stage==='selection'?tool+':':''}/Users/ccheever/.volta/tools/image/node/24.18.0/bin:${project}/node_modules/.bin:${process.env.PATH}`,SNAPBACK4_BIN:path.resolve('target/production/snapback4'),SNAPBACK4_SMOKE_DEVICE_PREFIX:stage==='selection'?`sb4-nx-r1-cancel-${starter}-`:'sb4-nx-r1-',CI:'1'};
// npm adds ancestor .bin directories. Reuse the recorded tool PATH so this
// direct-wrapper signal control tests a warm run rather than changing its key.
if(stage==='running')env.PATH=JSON.parse(fs.readFileSync(path.join(project,'.snapback4-witness/export-base.json'))).exportFingerprint.toolchain.environment.PATH;
const started=Date.now(),child=spawn('/Users/ccheever/.volta/tools/image/node/24.18.0/bin/node',[path.join(project,'node_modules/snapback4-expo/export-ios.mjs')],{cwd:project,env,stdio:['ignore',fd,fd]});
fs.writeFileSync(target,String(child.pid));const done=once(child,'close');
if(stage==='running'){
  const deadline=Date.now()+60_000;let launched=false;
  while(Date.now()<deadline&&child.exitCode===null){
    const fresh=fs.readdirSync(artifacts).filter(n=>!before.has(n));
    if(fresh.some(n=>fs.existsSync(path.join(artifacts,n,'smoke-ios-launch.log'))&&fs.statSync(path.join(artifacts,n,'smoke-ios-launch.log')).size>0)){launched=true;break;}
    await new Promise(r=>setTimeout(r,50));
  }
  if(!launched){child.kill('SIGTERM');await done;}
  assert.equal(launched,true,'warm app launched before cancellation');child.kill('SIGTERM');
}
const [status,signal]=await done;fs.closeSync(fd);
assert.equal(status,stage==='selection'?130:143);
const fresh=fs.readdirSync(artifacts).filter(n=>!before.has(n));assert.equal(fresh.length,1);
const dir=path.join(artifacts,fresh[0]),receipt=JSON.parse(fs.readFileSync(path.join(dir,'smoke-ios-run.json')));
assert.notEqual(receipt.phase,'environment');assert.match(receipt.error,/E_WITNESS_INTERRUPTED/);
let deleted;
if(stage==='selection'){
  const created=JSON.parse(fs.readFileSync(identity));
  const list=JSON.parse(spawnSync('/usr/bin/xcrun',['simctl','list','devices','--json'],{encoding:'utf8'}).stdout);
  assert.equal(Object.values(list.devices).flat().some(d=>d.udid===created.udid),false);
  assert.equal(fs.existsSync(path.join(process.env.HOME,'.local/state/snapback4/witness/simulators',created.udid+'.json')),false);
  assert.equal(receipt.simulator.deleted,true);deleted=created;
}else{
  const launch=fs.readFileSync(path.join(dir,'smoke-ios-launch.log'),'utf8');
  const pids=[...launch.matchAll(/: (\d+)/g)].map(m=>m[1]);
  const listing=spawnSync('/usr/bin/xcrun',['simctl','spawn',receipt.udid,'launchctl','list'],{encoding:'utf8'});assert.equal(listing.status,0);
  assert.equal(listing.stdout.split('\n').some(line=>pids.some(pid=>line.startsWith(pid+'\t'))),false);
  const port=receipt.backend.port;const net=await import('node:net');await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(port,'127.0.0.1',()=>s.close(resolve));});
}
for(const name of ['preparation-tmp','base.app','export.app'])assert.equal(fs.existsSync(path.join(dir,name)),false);
const row={starter,stage,status,signal,durationMs:Date.now()-started,deleted,receipt};
fs.writeFileSync(path.join(report,label+'.json'),JSON.stringify(row,null,2));
fs.writeFileSync(path.join(report,label+'-receipt.json.gz'),gzipSync(fs.readFileSync(path.join(dir,'smoke-ios-run.json'))));
console.log(JSON.stringify({starter,stage,status,deleted,durationMs:row.durationMs}));

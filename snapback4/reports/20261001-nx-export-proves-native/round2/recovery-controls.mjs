import fs from 'node:fs'; import path from 'node:path'; import {spawn,spawnSync} from 'node:child_process'; import {once} from 'node:events'; import assert from 'node:assert/strict';
const report=path.resolve('reports/20261001-nx-export-proves-native/round2');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const starter of (process.argv.length>2?process.argv.slice(2):['plain','social'])){
 const project=path.resolve('target/nx',starter),root=path.join(project,'artifacts/native-smoke');
 const run=label=>{const result=spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'});assert.equal(result.status,0);return JSON.parse(fs.readFileSync(path.join(report,`${starter}-${label}.json`)));};
 run('recovery-prime');
 for(const mode of ['wrapper','driver']){
  const before=new Set(fs.readdirSync(root));
  const fd=fs.openSync(path.join(report,`${starter}-kill-${mode}.log`),'wx');
  const env={...process.env,PATH:JSON.parse(fs.readFileSync(path.join(project,'.snapback4-witness/export-base.json'))).exportFingerprint.toolchain.environment.PATH,SNAPBACK4_BIN:process.env.NX_BIN||path.resolve('target/nx/timing-cli'),SNAPBACK4_SMOKE_DEVICE_PREFIX:process.env.NX_SMOKE_DEVICE_PREFIX||'sb4-nx-r2-',CI:'1'};
  const child=spawn(process.execPath,[path.join(project,'node_modules/snapback4-expo/export-ios.mjs')],{cwd:project,env,stdio:['ignore',fd,fd]});const exit=once(child,'close');
  let live,dir;
  const end=Date.now()+90_000;
  while(Date.now()<end&&child.exitCode===null){
   const fresh=fs.readdirSync(root).filter(n=>/^\d+-\d+$/.test(n)&&!before.has(n));
   if(fresh.length===1){dir=path.join(root,fresh[0]);try{live=JSON.parse(fs.readFileSync(path.join(dir,'live.json')));}catch{}}
   if(live?.app?.pid&&live?.children?.backend?.pid)break;
   await sleep(20);
  }
  assert.ok(live?.app?.pid,'real app and backend were recorded before SIGKILL');
  if(mode==='driver'){child.kill('SIGSTOP');process.kill(live.owner.pid,'SIGKILL');}
  // Kill the wrapper in both controls so it cannot mark this run completed.
  child.kill('SIGKILL');const [status,signal]=await exit;fs.closeSync(fd);assert.equal(signal,'SIGKILL');
  // Keep identities and original process evidence even after bounded pruning.
  fs.writeFileSync(path.join(report,`${starter}-kill-${mode}-before.json`),JSON.stringify({wrapperPid:child.pid,status,signal,dir,live},null,2));
  const next=run(`recover-${mode}`);assert.equal(next.receiptExit,0);
  const finished=JSON.parse(fs.readFileSync(path.join(dir,'finished.json')));assert.equal(finished.abandoned,true);assert.equal(finished.recovered,true);
  for(const name of ['export.app','base.app','build.xcresult','preparation-tmp'])assert.equal(fs.existsSync(path.join(dir,name)),false);
  for(const process of [live.app,...Object.values(live.children)]){
   if(!process?.pid)continue;
   const ps=spawnSync('/bin/ps',['-p',String(process.pid),'-o','stat='],{encoding:'utf8'});
   assert.ok(ps.status!==0||ps.stdout.trim().startsWith('Z'),`recorded process ${process.pid} stopped`);
  }
  const old=live.simulator.udid;
  const listing=JSON.parse(spawnSync('/usr/bin/xcrun',['simctl','list','devices','--json'],{encoding:'utf8'}).stdout);
  const device=Object.values(listing.devices).flat().find(d=>d.udid===old);assert.equal(device?.state,'Shutdown');
  fs.writeFileSync(path.join(report,`${starter}-kill-${mode}-result.json`),JSON.stringify({starter,mode,oldDevice:old,oldState:device.state,finished,next},null,2));
 }
}

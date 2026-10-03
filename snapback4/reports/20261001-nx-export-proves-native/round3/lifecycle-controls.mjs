import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';import {createHash} from 'node:crypto';import {gzipSync} from 'node:zlib';
const report=path.resolve('reports/20261001-nx-export-proves-native/round3'),nodeDir=path.dirname(process.execPath),binary=process.env.NX_BIN||path.resolve('target/nx/timing-cli');const delay=ms=>new Promise(r=>setTimeout(r,ms));
const read=p=>{try{return JSON.parse(fs.readFileSync(p))}catch{return null}};const hash=b=>createHash('sha256').update(b).digest('hex');
const suffix=process.env.NX_CONTROL_RUN ? '-'+process.env.NX_CONTROL_RUN : '';
const results=[];
function archive(dir,label){const out=path.join(report,'evidence',label);fs.mkdirSync(out,{recursive:true});const rows=[];for(const name of fs.readdirSync(dir)){if(!/\.(json|jsonl|log|stdout|stderr)$/.test(name))continue;const bytes=fs.readFileSync(path.join(dir,name));fs.writeFileSync(path.join(out,name+'.gz'),gzipSync(bytes));rows.push({name,sha256:hash(bytes),bytes:bytes.length});}fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify(rows,null,2));}

for(const starter of process.argv.slice(2).length?process.argv.slice(2):['plain','social']){
 const project=path.resolve('target/nx',starter),root=path.join(project,'artifacts/native-smoke');
 const env={...process.env,PATH:read(path.join(project,'.snapback4-witness/export-base.json'))?.exportFingerprint.toolchain.environment.PATH??`${project}/node_modules/.bin:${nodeDir}:${process.env.PATH}`,SNAPBACK4_BIN:binary,SNAPBACK4_SMOKE_DEVICE_PREFIX:'sb4-nx-r3-',CI:'1'};
 const run=label=>{label+=suffix;const r=spawnSync(process.execPath,[path.join(report,'run.mjs'),starter,label],{stdio:'inherit'});assert.equal(r.status,0);return read(path.join(report,`${starter}-${label}.json`))};
 const start=(label,extra={})=>{
  label+=suffix;
  const before=new Set(fs.readdirSync(root)),fd=fs.openSync(path.join(report,`${starter}-${label}.log`),'wx');
  const child=spawn(process.execPath,[path.join(project,'node_modules/snapback4-expo/export-ios.mjs')],{cwd:project,env:{...env,...extra},stdio:['ignore',fd,fd]});const ended=once(child,'close').then(([status,signal])=>{fs.closeSync(fd);return {status,signal}});
  return {child,ended,before,label};
 };
 const wait=async (run,predicate)=>{
  const end=Date.now()+120000;while(Date.now()<end){
   for(const n of fs.readdirSync(root).filter(n=>/^\d+-\d+$/.test(n)&&!run.before.has(n))){const dir=path.join(root,n),live=read(path.join(dir,'live.json'));if(live&&predicate(live,dir))return {dir,live}}
   if(run.child.exitCode!==null||run.child.signalCode)throw Error(`run exited before control: ${run.label}`);await delay(20);
  }throw Error('control timed out: '+run.label);
 };
 const stopped=pid=>{const r=spawnSync('/bin/ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'});return r.status!==0||r.stdout.trim().startsWith('Z')};
 const clean=(dir,live)=>{
  assert.equal(read(path.join(dir,'finished.json'))?.recovered,true);
  for(const name of ['export.app','base.app','build.xcresult','preparation-tmp'])assert.equal(fs.existsSync(path.join(dir,name)),false,name);
  for(const record of [live.app,...Object.values(live.children)])if(record?.pid)assert.ok(stopped(record.pid),String(record.pid));
  if(live.children.preparation?.group){const r=spawnSync('/bin/ps',['-axo','pgid=,stat='],{encoding:'utf8'});assert.ok(!r.stdout.split('\n').some(line=>{const a=line.trim().split(/\s+/);return a[0]===String(live.children.preparation.group)&&!a[1]?.startsWith('Z')}))}
 };
 run('lifecycle-prime');env.PATH=read(path.join(project,'.snapback4-witness/export-base.json')).exportFingerprint.toolchain.environment.PATH;
 // The genuine wrapper survives SIGKILL of only its genuine native driver.
 let a=start('driver-only-death');let record=await wait(a,l=>l.app?.pid&&l.children.backend?.pid);process.kill(record.live.owner.pid,'SIGKILL');const exit=await a.ended;assert.notEqual(exit.status,0);clean(record.dir,record.live);archive(record.dir,`${starter}-${a.label}`);results.push({starter,mode:a.label,...record,exit,cleaned:true});
 run('after-driver-only');
 // Command-boundary preparation fixture starts a resistant descendant in the
 // actual owned group. No fabricated build/proof result is supplied.
 const shim=path.join(project,'artifacts/control-shim');fs.mkdirSync(shim,{recursive:true});const heartbeat=path.join(shim,'heartbeat');
 const workerCode=`import signal,time;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);p=Path(${JSON.stringify(heartbeat)});\nwhile True: p.open('a').write('x');time.sleep(.02)`;
 fs.writeFileSync(path.join(shim,'node'),`#!/usr/bin/python3\nimport os,sys,subprocess,time\nfrom pathlib import Path\nif len(sys.argv)>1 and sys.argv[1].endswith('/prepare.mjs'):\n out=Path(sys.argv[4]);(out/'export.app').mkdir();(out/'preparation-tmp').mkdir(exist_ok=True)\n code=${JSON.stringify(workerCode)}\n child=subprocess.Popen(['/usr/bin/python3','-c',code])\n while True: time.sleep(1)\nelse: os.execv(${JSON.stringify(process.execPath)},[${JSON.stringify(process.execPath)}]+sys.argv[1:])\n`,{mode:0o755});
 a=start('live-preparation-child',{PATH:`${shim}:${env.PATH}`});record=await wait(a,l=>l.children.preparation?.group&&fs.existsSync(heartbeat));process.kill(record.live.owner.pid,'SIGKILL');const prepExit=await a.ended;assert.notEqual(prepExit.status,0);clean(record.dir,record.live);archive(record.dir,`${starter}-${a.label}`);const bytes=fs.readFileSync(heartbeat);await delay(150);assert.deepEqual(fs.readFileSync(heartbeat),bytes);results.push({starter,mode:a.label,...record,exit:prepExit,heartbeatStopped:true,cleaned:true});
 fs.rmSync(path.join(shim,'node'));run('after-preparation-child');
 // Real create, but the simctl boundary buffers its UUID until killed. The
 // journal's exact unique name/runtime is the only discovery authority.
 const made=path.join(shim,'created.json');
 fs.writeFileSync(path.join(shim,'xcrun'),`#!/usr/bin/python3\nimport os,sys,subprocess,time,json\nfrom pathlib import Path\nif sys.argv[1:3]==['simctl','create']:\n r=subprocess.run(['/usr/bin/xcrun']+sys.argv[1:],capture_output=True,text=True,check=True)\n Path(${JSON.stringify(made)}).write_text(json.dumps({'udid':r.stdout.strip(),'args':sys.argv[1:],'pid':os.getpid()}))\n print(r.stdout.strip())\n while True: time.sleep(1)\nelse: os.execv('/usr/bin/xcrun',['/usr/bin/xcrun']+sys.argv[1:])\n`,{mode:0o755});
 a=start('buffered-create-kill',{PATH:`${shim}:${env.PATH}`,SNAPBACK4_SMOKE_DEVICE_PREFIX:`sb4-nx-r3-buffered-${starter}-`});record=await wait(a,l=>l.children.create?.pid&&fs.existsSync(made));const created=read(made);assert.equal(record.live.children.create.pid,created.pid);assert.equal(fs.readFileSync(path.join(record.dir,'simulator-create.stdout'),'utf8'),'');
 process.kill(record.live.owner.pid,'SIGKILL');const createExit=await a.ended;assert.notEqual(createExit.status,0);clean(record.dir,record.live);archive(record.dir,`${starter}-${a.label}`);
 const devices=JSON.parse(spawnSync('/usr/bin/xcrun',['simctl','list','devices','--json'],{encoding:'utf8'}).stdout);assert.ok(!Object.values(devices.devices).flat().some(d=>d.udid===created.udid));results.push({starter,mode:a.label,...record,created,exit:createExit,deleted:true,emptyStdout:true});fs.rmSync(path.join(shim,'xcrun'));
 // Distinct exports overlap while A holds custody. B must either prove its
 // own bundle or refuse; it cannot change the bundle proven by A.
 const source=path.join(project,starter==='plain'?'App.tsx':'app/_layout.tsx'),original=fs.readFileSync(source,'utf8');
 try{
  fs.writeFileSync(source,original+`\nconsole.log('NX concurrent A ${starter}');\n`);a=start('concurrent-a');record=await wait(a,l=>l.app?.pid&&l.children.backend?.pid);process.kill(record.live.owner.pid,'SIGSTOP');
  const metadata=read(path.join(record.dir,'export/metadata.json')),aHash=hash(fs.readFileSync(path.join(record.dir,'export',metadata.fileMetadata.ios.bundle)));
  fs.writeFileSync(source,original+`\nconsole.log('NX concurrent B ${starter}');\n`);const b=start('concurrent-b');const bExit=await b.ended;
  const bLog=fs.readFileSync(path.join(report,`${starter}-${b.label}.log`),'utf8');const aLog=fs.readFileSync(path.join(report,`${starter}-${a.label}.log`),'utf8');
  const bundles=text=>[...text.matchAll(/_expo\/static\/js\/ios\/([^\s]+\.hbc)/g)].map(m=>m[1]);assert.notDeepEqual(bundles(aLog),bundles(bLog));assert.match(bLog,/another witness holds/);
  process.kill(record.live.owner.pid,'SIGCONT');const aExit=await a.ended;assert.equal(aExit.status,0);assert.notEqual(bExit.status,0);
  const receipt=read(path.join(record.dir,'smoke-ios-run.json'));assert.equal(receipt.installed.javascript.sha256,aHash);const dist=read(path.join(project,'dist/metadata.json'));assert.equal(hash(fs.readFileSync(path.join(project,'dist',dist.fileMetadata.ios.bundle))),aHash);
  results.push({starter,mode:'concurrent-wrappers',aExit,bExit,aExportNames:bundles(aLog),bExportNames:bundles(bLog),bRefusedCustody:true,privateHash:aHash,loadedHash:receipt.installed.javascript.sha256,distHash:aHash,receiptPath:path.join(record.dir,'smoke-ios-run.json')});
 }finally{fs.writeFileSync(source,original);if(!stopped(record.live.owner.pid))process.kill(record.live.owner.pid,'SIGCONT')}
 fs.writeFileSync(path.join(report,`${starter}-lifecycle-controls.json`),JSON.stringify(results.filter(r=>r.starter===starter),null,2)+'\n');
}

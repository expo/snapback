import{existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync}from'node:fs';import{spawn,execFileSync}from'node:child_process';import{join}from'node:path';
import{day2Check}from'/home/ccheever/sb4-loop/bakeoff/day2check.mjs';
import{verifyServe}from'/home/ccheever/sb4-loop/bakeoff/probe.mjs';
import{serveEnvironment}from'/home/ccheever/sb4-loop/bakeoff/harn34.mjs';
import{archiveSessions}from'/home/ccheever/sb4-loop/bakeoff/sessions34.mjs';
import{priceLane,loadPrices}from'/home/ccheever/sb4-loop/bakeoff/pricing.mjs';
const phase=process.argv[2],n=Number(process.argv[3]),evidence='/tmp/dx17/evidence';
const launch=JSON.parse(readFileSync(`${evidence}/${phase}-${n}-launch.json`)),{a,dir:lane}=launch;
const tmp=`/tmp/dx17/t/${phase}-${a.n}`,lo=(phase==='before'?51000:phase==='after-route'?53000:52000)+a.n*10;
const env={...process.env,PORT_LO:String(lo),PORT_HI:String(lo+9),TMPDIR:tmp,CHROME:'/home/ccheever/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',CI:'1',EXPO_NO_TELEMETRY:'1',npm_config_registry:launch.registry};delete env.SNAPBACK4_BIN;delete env.SNAPBACK4_PROBE_HOLD;
const results=[];
const sh=(cmd)=>new Promise(done=>{const started=Date.now(),child=spawn('bash',['-c',cmd],{cwd:lane,env,detached:true,stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1_800_000);child.on('close',code=>{clearTimeout(timer);done({cmd,code,ms:Date.now()-started,out});});});
for(const script of ['check','acceptance','acceptance','frontend:proof','frontend:proof','day2:proof','day2:proof']){
 if(script==='frontend:proof')rmSync(join(lane,'dist'),{recursive:true,force:true});if(script==='day2:proof')rmSync(join(lane,'day2-proof.json'),{force:true});
 const result=await sh('npm run '+script);if(script==='day2:proof'){try{result.result=JSON.parse(readFileSync(join(lane,'day2-proof.json')));}catch{result.result={missing:true};}}results.push(result);
}
const frozen=`/tmp/dx17/${phase}/v1-clients/${a.id}`;mkdirSync(frozen,{recursive:true});
execFileSync('bash',['-c','tar --exclude=node_modules -cf - . | tar -xf - -C "$DX17_FROZEN"'],{cwd:join('/home/ccheever/sb4-loop/wave34/v1-clients',a.id),env:{...process.env,DX17_FROZEN:frozen},timeout:600_000});
const drill=await day2Check({lane,env,backend:'snapback',v1ClientDir:frozen,change:a.change,spec:a.spec,judge:false,releaseTask:true,log:()=>{}});
const probeServe=await verifyServe({lane,env,dir:join(lane,'.harness/verify-serve'),aliveMs:30_000});
copyFileSync(`${evidence}/${phase}-${n}.ndjson`,join(lane,'.agent.ndjson'));
const archive=archiveSessions(lane);const prices=loadPrices('/home/ccheever/sb4-loop/bakeoff/prices.json');const priced=priceLane(lane,{prices});
writeFileSync(`${evidence}/${phase}-${n}-verification.json`,JSON.stringify({results,drill,probeServe,archive,priced},null,2));
console.log(JSON.stringify({phase,n,proofs:results.map(x=>({script:x.cmd,code:x.code})),drill:drill.status,probe:probeServe.ok,costUsd:priced.costUsd,calls:priced.costPricing.units.length,archiveMissing:archive.missing}));

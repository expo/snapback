import{readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';import{verifyServe}from'/home/ccheever/sb4-loop/bakeoff/probe.mjs';
const phase=process.argv[2],n=Number(process.argv[3]),base='/tmp/dx17/evidence',launch=JSON.parse(readFileSync(`${base}/${phase}-${n}-launch.json`)),lane=launch.dir;
const lo=(phase==='before'?51000:phase==='after-route'?53000:phase==='after-observe'?54000:52000)+n*10,env={...process.env,PORT_LO:String(lo),PORT_HI:String(lo+9),TMPDIR:`/tmp/dx17/t/${phase}-${n}`,CHROME:'/home/ccheever/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',CI:'1',npm_config_registry:launch.registry};delete env.SNAPBACK4_BIN;delete env.SNAPBACK4_PROBE_HOLD;
const file=`${base}/${phase}-${n}-verification.json`,data=JSON.parse(readFileSync(file));
if(!data.probeServe)data.probeServe=await verifyServe({lane,env,dir:join(lane,'.harness/verify-serve'),aliveMs:30_000});
if(!data.lastProof){try{data.lastProof=JSON.parse(readFileSync(join(lane,'day2-proof.json')));}catch{data.lastProof={missing:true};}}
writeFileSync(file,JSON.stringify(data,null,2));console.log(JSON.stringify({phase,n,probe:data.probeServe.status,lastProof:data.lastProof.ok}));

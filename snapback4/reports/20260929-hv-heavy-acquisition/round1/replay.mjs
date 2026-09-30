// Replays captured real acquisition commands in a fresh Chromium wasm instance.
// Usage: node replay.mjs WASM_DIR OUT.json [REPETITIONS]
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {chromiumExecutable} from '../../../witness/lib.mjs';
const [source,output,reps='5']=process.argv.slice(2), dir=resolve(source);
const captures={u0001:resolve('../target/hv/baseline-profile.json.commands.json'),u0500:resolve('../target/hv/probe-capture.json.commands.json')};
const server=createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.slice(1);
  res.setHeader('Content-Type',name.endsWith('.wasm')?'application/wasm':name.endsWith('.js')?'text/javascript':'application/json');
  try {
    let data=captures[name]?readFileSync(captures[name]):readFileSync(join(dir,name));
    if(name==='snapback4_device.js')data=Buffer.concat([data,Buffer.from('\nexport function heapBytes(){return wasm.memory.buffer.byteLength;}\n')]);
    res.end(data);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:chromiumExecutable()});
const all=[];
try {
for(let run=0;run<Number(reps);run++)for(const account of ['u0001','u0500']) {
 const host={at:new Date().toISOString(),hostname:os.hostname(),load:os.loadavg(),cpu:os.cpus()[0].model,pressure:readFileSync('/proc/pressure/cpu','utf8')};
 const context=await browser.newContext(),page=await context.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/u0500`);
 const result=await page.evaluate(async account=>{
  const {default:init,WebDevice,heapBytes}=await import('/snapback4_device.js');await init();
  const input=await(await fetch('/'+account)).json(),device=new WebDevice(JSON.stringify(input.backend),'[]');
  while(device.drain_chunk()!=='[]'){}
  const calls=[];
  for(const command of input.commands){
    const op=JSON.parse(command).op;
    if(op==='apply')device.profile_reset?.();
    const at=performance.now(),reply=JSON.parse(device.call(command)),ms=performance.now()-at;
    if(reply.denied)throw Error(JSON.stringify(reply));
    const phases=op==='apply'&&device.profile_take?JSON.parse(device.profile_take()):null;
    const drainAt=performance.now();let drainBytes=0;
    for(;;){const chunk=device.drain_chunk();if(chunk==='[]')break;drainBytes+=chunk.length;}
    calls.push({op,ms,phases,heap:heapBytes(),drainMs:performance.now()-drainAt,drainBytes});
  }
  const state=JSON.parse(device.call(JSON.stringify({op:'sync_state',capture:false})));
  device.free();return {calls,state};
 },account);
 assert.equal(result.state.ok.acquired,true);
 all.push({run,account,host,chromium:browser.version(),...result});
 writeFileSync(output,JSON.stringify(all,null,2));
 console.log(account,run,result.calls.filter(c=>c.op==='apply').reduce((s,c)=>s+c.ms,0).toFixed(1));
 await context.close();
}
}finally{await browser.close();await new Promise(r=>server.close(r));}

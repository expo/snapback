import assert from'node:assert/strict';import{mkdirSync,writeFileSync}from'node:fs';
import{startServe,killGroup}from'/home/ccheever/sb4-loop/bakeoff/probe.mjs';
const cwd=process.argv[2],dir=process.argv[3];mkdirSync(dir,{recursive:true});
const h=await startServe({lane:cwd,env:{...process.env},probeDir:dir,readyMs:30000,accept:j=>Boolean(j.backendUrl)});
try{assert.equal(h.ok,true,JSON.stringify({why:h.why}));await new Promise(r=>setTimeout(r,11500));assert.equal(h.child.exitCode,null);assert.equal(h.exited(),null);writeFileSync(dir+'/result.json',JSON.stringify({ok:true,heldBeyondIdleMs:11500,harness:'bakeoff/probe.mjs startServe + harn34 serveEnvironment',sourceUnmodified:true}));console.log('actual harness startServe held an empty probe beyond 10s');}
finally{if(h.child){const closed=new Promise(r=>h.child.once('close',r));killGroup(h.child.pid,'SIGTERM');const timer=setTimeout(()=>killGroup(h.child.pid,'SIGKILL'),5000);await closed;clearTimeout(timer);}}
